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
#include "device_state.h"
#include "wifi_manager.h"

static const char *TAG = "CLOUD_AGENT";
static const size_t RESPONSE_BUFFER_SIZE = 2048;
static unsigned long s_request_sequence;

static esp_err_t http_post_json(
    const char *path,
    const char *json_body,
    char *response,
    size_t response_capacity
)
{
    if (DX_GATEWAY_BASE_URL[0] == '\0' || path == NULL || json_body == NULL) {
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

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = DX_HTTP_TIMEOUT_MS,
        .keep_alive_enable = true,
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
    esp_http_client_set_post_field(client, json_body, (int)strlen(json_body));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        int content_length = esp_http_client_get_content_length(client);
        int received = esp_http_client_read_response(
            client,
            response,
            (int)(response_capacity - 1)
        );
        if (received >= 0) {
            response[received] = '\0';
        } else {
            response[0] = '\0';
        }
        ESP_LOGI(
            TAG,
            "POST %s -> HTTP %d, content-length=%d, received=%d",
            path,
            status_code,
            content_length,
            received
        );
        if (status_code < 200 || status_code >= 300) {
            err = ESP_FAIL;
        }
    } else {
        response[0] = '\0';
        ESP_LOGW(TAG, "POST %s failed: %s", path, esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return err;
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

    while (true) {
        if (wifi_manager_is_connected()) {
            device_state_set_online(true);
            if (!registered) {
                if (register_device() == ESP_OK) {
                    registered = true;
                    ESP_LOGI(TAG, "Device registration completed");
                    cloud_agent_report_state();
                } else {
                    ESP_LOGW(TAG, "Device registration did not complete");
                }
            }
            if (!registered) {
                vTaskDelay(pdMS_TO_TICKS(5000));
                continue;
            }
            if (send_heartbeat() != ESP_OK) {
                ESP_LOGW(TAG, "Heartbeat did not complete");
            }
            if (cloud_agent_report_state() != ESP_OK) {
                ESP_LOGW(TAG, "State report did not complete");
            }
        } else {
            registered = false;
            device_state_set_online(false);
            ESP_LOGW(TAG, "Skipping heartbeat because WiFi is offline");
        }
        vTaskDelay(
            pdMS_TO_TICKS(
                DX_HEARTBEAT_INTERVAL_SECONDS * 1000
            )
        );
    }
}

void cloud_agent_init(void)
{
#if !DX_ENABLE_CLOUD
    ESP_LOGI(TAG, "Cloud agent disabled by configuration");
    return;
#endif
    ESP_LOGI(TAG, "Cloud agent initialized");
    xTaskCreate(cloud_task, "cloud_agent", 6144, NULL, 5, NULL);
}
