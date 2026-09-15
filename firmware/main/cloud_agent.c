/*
 * Cloud access for the first real device-to-server slice.
 *
 * This version registers the device and sends heartbeats. It deliberately
 * does not implement control or audio until the MCU and audio pin contracts
 * are confirmed.
 */

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "app_config.h"
#include "cloud_agent.h"
#include "device_command.h"
#include "device_state.h"
#include "wifi_manager.h"

static const char *TAG = "CLOUD_AGENT";
static const size_t RESPONSE_BUFFER_SIZE = 2048;
static unsigned long s_request_sequence;

typedef struct {
    char *buffer;
    size_t capacity;
    size_t length;
    bool overflow;
} response_buffer_t;

static esp_err_t http_event_handler(esp_http_client_event_t *event)
{
    if (event == NULL || event->event_id != HTTP_EVENT_ON_DATA) {
        return ESP_OK;
    }

    response_buffer_t *response = (response_buffer_t *)event->user_data;
    if (response == NULL || event->data == NULL || event->data_len <= 0) {
        return ESP_OK;
    }

    size_t available = response->capacity > response->length + 1
        ? response->capacity - response->length - 1
        : 0;
    size_t copy_length = (size_t)event->data_len;
    if (copy_length > available) {
        copy_length = available;
        response->overflow = true;
    }
    if (copy_length > 0) {
        memcpy(response->buffer + response->length, event->data, copy_length);
        response->length += copy_length;
        response->buffer[response->length] = '\0';
    }
    return ESP_OK;
}

static esp_err_t http_request_json(
    esp_http_client_method_t method,
    const char *path,
    const char *json_body,
    char *response,
    size_t response_capacity
)
{
    if (DX_GATEWAY_BASE_URL[0] == '\0' || path == NULL ||
        response == NULL || response_capacity == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    char url[256];
    const char *separator =
        DX_GATEWAY_BASE_URL[strlen(DX_GATEWAY_BASE_URL) - 1] == '/' ? "" : "/";
    int written = snprintf(
        url,
        sizeof(url),
        "%s%sapi/device/v1%s",
        DX_GATEWAY_BASE_URL,
        separator,
        path
    );
    if (written < 0 || (size_t)written >= sizeof(url)) {
        ESP_LOGE(TAG, "Gateway URL is too long");
        return ESP_ERR_INVALID_SIZE;
    }

    response_buffer_t response_buffer = {
        .buffer = response,
        .capacity = response_capacity,
        .length = 0,
        .overflow = false
    };
    response[0] = '\0';

    esp_http_client_config_t config = {
        .url = url,
        .method = method,
        .timeout_ms = DX_HTTP_TIMEOUT_MS,
        .keep_alive_enable = true,
        .event_handler = http_event_handler,
        .user_data = &response_buffer
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Id", DX_DEVICE_ID);
    char request_id[32];
    snprintf(request_id, sizeof(request_id), "c3-%lu", ++s_request_sequence);
    esp_http_client_set_header(client, "X-Request-Id", request_id);
    char timestamp[24];
    snprintf(timestamp, sizeof(timestamp), "%lu", (unsigned long)time(NULL));
    esp_http_client_set_header(client, "X-Timestamp", timestamp);
    if (method == HTTP_METHOD_POST) {
        if (json_body == NULL) {
            esp_http_client_cleanup(client);
            return ESP_ERR_INVALID_ARG;
        }
        esp_http_client_set_post_field(client, json_body, (int)strlen(json_body));
    }

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        int content_length = esp_http_client_get_content_length(client);
        ESP_LOGI(
            TAG,
            "%s %s -> HTTP %d, content-length=%d, received=%u%s",
            method == HTTP_METHOD_GET ? "GET" : "POST",
            path,
            status_code,
            content_length,
            (unsigned int)response_buffer.length,
            response_buffer.overflow ? " (truncated)" : ""
        );
        if (status_code < 200 || status_code >= 300) {
            err = ESP_FAIL;
        }
    } else {
        response[0] = '\0';
        ESP_LOGW(
            TAG,
            "%s %s failed: %s",
            method == HTTP_METHOD_GET ? "GET" : "POST",
            path,
            esp_err_to_name(err)
        );
    }

    esp_http_client_cleanup(client);
    return err;
}

static esp_err_t http_post_json(
    const char *path,
    const char *json_body,
    char *response,
    size_t response_capacity
)
{
    return http_request_json(
        HTTP_METHOD_POST,
        path,
        json_body,
        response,
        response_capacity
    );
}

static esp_err_t http_get_json(
    const char *path,
    char *response,
    size_t response_capacity
)
{
    return http_request_json(
        HTTP_METHOD_GET,
        path,
        NULL,
        response,
        response_capacity
    );
}

static void add_common_device_fields(cJSON *root)
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    char mac_text[18];
    snprintf(
        mac_text,
        sizeof(mac_text),
        "%02X:%02X:%02X:%02X:%02X:%02X",
        mac[0],
        mac[1],
        mac[2],
        mac[3],
        mac[4],
        mac[5]
    );

    cJSON_AddStringToObject(root, "deviceId", DX_DEVICE_ID);
    cJSON_AddStringToObject(root, "model", DX_DEVICE_MODEL);
    cJSON_AddStringToObject(root, "firmwareVersion", DX_FIRMWARE_VERSION);
    cJSON_AddStringToObject(root, "protocolVersion", DX_PROTOCOL_VERSION);
    cJSON_AddStringToObject(root, "mac", mac_text);
}

static void add_state_fields(cJSON *root, const dx_device_state_t *state)
{
    cJSON *state_json = cJSON_CreateObject();
    if (state_json == NULL) {
        return;
    }

    cJSON_AddBoolToObject(state_json, "isOnline", state->is_online);
    cJSON_AddStringToObject(state_json, "power", state->power ? "on" : "off");
    cJSON_AddStringToObject(state_json, "light", state->light ? "on" : "off");
    const char *heater =
        state->heater == DX_HEATER_STRONG
            ? "strong"
            : state->heater == DX_HEATER_WEAK ? "weak" : "off";
    cJSON_AddStringToObject(state_json, "heater", heater);
    cJSON_AddStringToObject(
        state_json,
        "ventilation",
        state->ventilation ? "on" : "off"
    );
    cJSON_AddStringToObject(state_json, "fan", state->fan ? "on" : "off");
    cJSON_AddStringToObject(state_json, "swing", state->swing ? "on" : "off");
    cJSON_AddStringToObject(state_json, "dry", state->dry ? "on" : "off");
    cJSON_AddStringToObject(state_json, "bathMode", state->bath_mode ? "on" : "off");
    cJSON_AddStringToObject(
        state_json,
        "constantTemperature",
        state->constant_temperature ? "on" : "off"
    );
    cJSON_AddNumberToObject(
        state_json,
        "targetTemperature",
        (double)state->target_temperature
    );
    cJSON_AddNumberToObject(
        state_json,
        "ambientTemperature",
        (double)state->ambient_temperature
    );
    cJSON_AddNumberToObject(state_json, "humidity", (double)state->humidity);
    cJSON_AddBoolToObject(state_json, "hasOccupancy", state->has_occupancy);
    if (state->fault_code[0] == '\0') {
        cJSON_AddNullToObject(state_json, "faultCode");
    } else {
        cJSON_AddStringToObject(state_json, "faultCode", state->fault_code);
    }
    cJSON_AddNumberToObject(
        state_json,
        "runningMinutes",
        (double)state->running_minutes
    );
    cJSON_AddItemToObject(root, "state", state_json);
}

static esp_err_t report_command_result(
    const char *command_id,
    const dx_device_command_result_t *result
)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL || command_id == NULL || result == NULL) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }

    cJSON_AddStringToObject(root, "deviceId", DX_DEVICE_ID);
    cJSON_AddStringToObject(root, "commandId", command_id);
    cJSON_AddStringToObject(root, "status", result->status);
    cJSON_AddStringToObject(root, "executedAt", "device-now");
    if (result->mcu_frame[0] != '\0') {
        cJSON_AddStringToObject(root, "mcuFrame", result->mcu_frame);
    }
    if (result->execution_path[0] != '\0') {
        cJSON_AddStringToObject(root, "executionPath", result->execution_path);
    }
    if (result->message[0] != '\0') {
        cJSON_AddStringToObject(root, "message", result->message);
    }
    if (strcmp(result->status, "success") != 0 && result->error_code[0] != '\0') {
        cJSON *error = cJSON_CreateObject();
        if (error != NULL) {
            cJSON_AddStringToObject(error, "code", result->error_code);
            cJSON_AddStringToObject(error, "message", result->message);
            cJSON_AddItemToObject(root, "error", error);
        }
    }

    dx_device_state_t state;
    if (device_state_get(&state) == ESP_OK) {
        add_state_fields(root, &state);
    }

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    char response[RESPONSE_BUFFER_SIZE];
    esp_err_t err = http_post_json("/commands/result", body, response, sizeof(response));
    cJSON_free(body);
    return err;
}

static esp_err_t execute_polled_command(const cJSON *command)
{
    const cJSON *command_id_json =
        cJSON_GetObjectItemCaseSensitive(command, "commandId");
    const cJSON *actions = cJSON_GetObjectItemCaseSensitive(command, "actions");
    if (!cJSON_IsString(command_id_json) || command_id_json->valuestring == NULL ||
        !cJSON_IsArray(actions) || cJSON_GetArraySize(actions) == 0) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    dx_device_command_result_t result;
    esp_err_t err = device_command_execute_json(
        command_id_json->valuestring,
        actions,
        &result
    );
    if (err != ESP_OK) {
        return err;
    }
    return report_command_result(command_id_json->valuestring, &result);
}

static esp_err_t poll_commands(void)
{
    char path[256];
    int written = snprintf(
        path,
        sizeof(path),
        "/commands/poll?deviceId=%s&limit=5",
        DX_DEVICE_ID
    );
    if (written < 0 || (size_t)written >= sizeof(path)) {
        return ESP_ERR_INVALID_SIZE;
    }

    char response[RESPONSE_BUFFER_SIZE];
    esp_err_t err = http_get_json(path, response, sizeof(response));
    if (err != ESP_OK || response[0] == '\0') {
        return err;
    }

    cJSON *root = cJSON_Parse(response);
    if (root == NULL) {
        return ESP_ERR_INVALID_RESPONSE;
    }
    cJSON *data = cJSON_GetObjectItemCaseSensitive(root, "data");
    cJSON *commands = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "commands");
    if (!cJSON_IsArray(commands)) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_RESPONSE;
    }

    int command_count = cJSON_GetArraySize(commands);
    for (int index = 0; index < command_count; index++) {
        cJSON *command = cJSON_GetArrayItem(commands, index);
        if (execute_polled_command(command) != ESP_OK) {
            ESP_LOGW(TAG, "Command execution result could not be reported");
        }
    }
    cJSON_Delete(root);
    return ESP_OK;
}

static esp_err_t register_device(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *capabilities = cJSON_CreateObject();
    if (root == NULL || capabilities == NULL) {
        cJSON_Delete(root);
        cJSON_Delete(capabilities);
        return ESP_ERR_NO_MEM;
    }

    add_common_device_fields(root);
    cJSON_AddTrueToObject(capabilities, "voiceAudioUpload");
    cJSON_AddTrueToObject(capabilities, "ttsPlayback");
    cJSON_AddTrueToObject(capabilities, "deviceStateReport");
    cJSON_AddTrueToObject(capabilities, "commandPolling");
    cJSON_AddTrueToObject(capabilities, "sensorReport");
    cJSON_AddItemToObject(root, "capabilities", capabilities);

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    char response[RESPONSE_BUFFER_SIZE];
    esp_err_t err = http_post_json("/register", body, response, sizeof(response));
    ESP_LOGI(TAG, "Register response: %s", response[0] != '\0' ? response : "<empty>");
    cJSON_free(body);
    return err;
}

static esp_err_t send_heartbeat(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *network = cJSON_CreateObject();
    if (root == NULL || network == NULL) {
        cJSON_Delete(root);
        cJSON_Delete(network);
        return ESP_ERR_NO_MEM;
    }

    add_common_device_fields(root);
    cJSON_AddNumberToObject(network, "freeHeapBytes", (double)esp_get_free_heap_size());
    char ip[16];
    int rssi = 0;
    if (wifi_manager_get_network_info(ip, sizeof(ip), &rssi) == ESP_OK) {
        cJSON_AddStringToObject(network, "ip", ip);
        cJSON_AddNumberToObject(network, "rssi", (double)rssi);
    }
    cJSON_AddItemToObject(root, "network", network);

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    char response[RESPONSE_BUFFER_SIZE];
    esp_err_t err = http_post_json("/heartbeat", body, response, sizeof(response));
    ESP_LOGI(TAG, "Heartbeat response: %s", response[0] != '\0' ? response : "<empty>");
    cJSON_free(body);
    return err;
}

esp_err_t cloud_agent_report_state(void)
{
    if (!wifi_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    dx_device_state_t state;
    esp_err_t state_err = device_state_get(&state);
    if (state_err != ESP_OK) {
        return state_err;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return ESP_ERR_NO_MEM;
    }

    add_common_device_fields(root);
    add_state_fields(root, &state);

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ESP_ERR_NO_MEM;
    }

    char response[RESPONSE_BUFFER_SIZE];
    esp_err_t err = http_post_json("/state", body, response, sizeof(response));
    ESP_LOGI(TAG, "State report -> %s", err == ESP_OK ? "ok" : "failed");
    cJSON_free(body);
    return err;
}

static void cloud_task(void *arg)
{
    (void)arg;

    if (DX_GATEWAY_BASE_URL[0] == '\0') {
        ESP_LOGW(TAG, "Gateway URL is not configured");
        vTaskDelete(NULL);
        return;
    }

    bool registered = false;
    TickType_t last_heartbeat = 0;
    TickType_t last_state_report = 0;
    TickType_t last_command_poll = 0;

    while (true) {
        if (wifi_manager_is_connected()) {
            device_state_set_online(true);
            if (!registered) {
                if (register_device() == ESP_OK) {
                    registered = true;
                    ESP_LOGI(TAG, "Device registration completed");
                    cloud_agent_report_state();
                    last_heartbeat = xTaskGetTickCount();
                    last_state_report = last_heartbeat;
                    last_command_poll = 0;
                } else {
                    ESP_LOGW(TAG, "Device registration did not complete");
                }
            }
            if (!registered) {
                vTaskDelay(pdMS_TO_TICKS(5000));
                continue;
            }

            TickType_t now = xTaskGetTickCount();
            if (last_command_poll == 0 ||
                now - last_command_poll >= pdMS_TO_TICKS(DX_COMMAND_POLL_INTERVAL_SECONDS * 1000)) {
                if (poll_commands() != ESP_OK) {
                    ESP_LOGW(TAG, "Command polling did not complete");
                }
                last_command_poll = now;
            }

            if (last_heartbeat == 0 ||
                now - last_heartbeat >= pdMS_TO_TICKS(DX_HEARTBEAT_INTERVAL_SECONDS * 1000)) {
                if (send_heartbeat() != ESP_OK) {
                    ESP_LOGW(TAG, "Heartbeat did not complete");
                }
                last_heartbeat = now;
            }

            if (last_state_report == 0 ||
                now - last_state_report >= pdMS_TO_TICKS(DX_STATE_REPORT_INTERVAL_SECONDS * 1000)) {
                if (cloud_agent_report_state() != ESP_OK) {
                    ESP_LOGW(TAG, "State report did not complete");
                }
                last_state_report = now;
            }
        } else {
            registered = false;
            device_state_set_online(false);
            last_heartbeat = 0;
            last_state_report = 0;
            last_command_poll = 0;
            ESP_LOGW(TAG, "Skipping heartbeat because WiFi is offline");
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void cloud_agent_init(void)
{
#if !DX_ENABLE_CLOUD
    ESP_LOGI(TAG, "Cloud agent disabled by configuration");
    return;
#endif
    ESP_LOGI(TAG, "Cloud agent initialized");
    /* Polling and command-result HTTP calls nest response buffers and cJSON work. */
    xTaskCreate(cloud_task, "cloud_agent", 12288, NULL, 5, NULL);
}
