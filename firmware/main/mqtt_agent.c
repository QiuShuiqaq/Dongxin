#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "mqtt_client.h"

#include "app_config.h"
#include "device_command.h"
#include "device_state.h"
#include "direct_control_hal.h"
#include "mqtt_agent.h"
#include "voice_engine.h"
#include "wifi_manager.h"

static const char *TAG = "MQTT_AGENT";
static const size_t MQTT_RX_BUFFER_SIZE = 2048;
static const size_t MQTT_COMMAND_QUEUE_DEPTH = 4;
static esp_mqtt_client_handle_t s_client;
static bool s_connected;
static unsigned long s_message_sequence;
static char s_command_topic[160];
static char s_voice_test_topic[160];
static char s_audio_test_topic[160];
static char s_rx_buffer[2048];
static QueueHandle_t s_command_queue;

typedef struct {
    size_t length;
    char payload[2048];
} dx_mqtt_command_message_t;

static cJSON *build_state(void);
static esp_err_t publish_envelope(
    const char *message_type,
    cJSON *data,
    int qos,
    bool retain
);
static void publish_registration(void);
static void publish_heartbeat(void);
static void publish_online_status(void);
static void handle_command_payload(const char *payload, size_t payload_length);
static bool handle_voice_test_control(const cJSON *data);
static bool handle_audio_test_control(const cJSON *data);
static void command_dispatch_task(void *arg);

bool mqtt_agent_is_connected(void)
{
    return s_connected;
}

esp_err_t mqtt_agent_report_state(void)
{
    cJSON *data = cJSON_CreateObject();
    cJSON *state = build_state();
    if (data == NULL || state == NULL) {
        cJSON_Delete(data);
        cJSON_Delete(state);
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddItemToObject(data, "state", state);
    cJSON_AddStringToObject(data, "reportedAt", "device-clock-unsynced");
    return publish_envelope("state", data, 1, true);
}

esp_err_t mqtt_agent_report_voice_test(
    const char *test_session_id,
    const char *status,
    const char *message
)
{
    if (test_session_id == NULL || test_session_id[0] == '\0' ||
        status == NULL || status[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    cJSON *data = cJSON_CreateObject();
    if (data == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(data, "testSessionId", test_session_id);
    cJSON_AddStringToObject(data, "status", status);
    cJSON_AddStringToObject(data, "message", message == NULL ? "" : message);
    return publish_envelope("voice-test", data, 1, false);
}

esp_err_t mqtt_agent_report_audio_test(
    const char *test_id,
    const char *status,
    const char *message
)
{
    if (test_id == NULL || test_id[0] == '\0' || status == NULL || status[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    cJSON *data = cJSON_CreateObject();
    if (data == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(data, "testId", test_id);
    cJSON_AddStringToObject(data, "status", status);
    cJSON_AddStringToObject(data, "message", message == NULL ? "" : message);
    return publish_envelope("audio-test", data, 1, false);
}

static void mqtt_event_handler(
    void *handler_args,
    esp_event_base_t base,
    int32_t event_id,
    void *event_data
)
{
    (void)handler_args;
    (void)base;
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            s_connected = true;
            device_state_set_online(true);
            esp_mqtt_client_subscribe(s_client, s_command_topic, 1);
            esp_mqtt_client_subscribe(s_client, s_voice_test_topic, 1);
            esp_mqtt_client_subscribe(s_client, s_audio_test_topic, 1);
            ESP_LOGI(TAG, "Connected, subscribed to command, voice test and audio test topics");
            publish_registration();
            publish_online_status();
            mqtt_agent_report_state();
            break;
        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            device_state_set_online(false);
            ESP_LOGW(TAG, "Disconnected; ESP-MQTT will reconnect automatically");
            break;
        case MQTT_EVENT_DATA:
            if (event->total_data_len <= 0 ||
                (size_t)event->total_data_len >= MQTT_RX_BUFFER_SIZE ||
                event->current_data_offset < 0 || event->data_len < 0) {
                ESP_LOGE(TAG, "MQTT command payload is invalid or too large");
                break;
            }
            if ((size_t)(event->current_data_offset + event->data_len) >= MQTT_RX_BUFFER_SIZE) {
                ESP_LOGE(TAG, "MQTT command fragment exceeds receive buffer");
                break;
            }
            memcpy(
                s_rx_buffer + event->current_data_offset,
                event->data,
                (size_t)event->data_len
            );
            if (event->current_data_offset + event->data_len == event->total_data_len) {
                s_rx_buffer[event->total_data_len] = '\0';
                dx_mqtt_command_message_t message = {
                    .length = (size_t)event->total_data_len,
                };
                memcpy(message.payload, s_rx_buffer, message.length + 1);
                if (s_command_queue == NULL ||
                    xQueueSend(s_command_queue, &message, 0) != pdTRUE) {
                    ESP_LOGE(TAG, "MQTT command queue is unavailable or full");
                }
            }
            break;
        case MQTT_EVENT_ERROR:
            ESP_LOGW(TAG, "MQTT transport error");
            break;
        default:
            break;
    }
}

static void command_dispatch_task(void *arg)
{
    (void)arg;
    while (true) {
        dx_mqtt_command_message_t message;
        if (xQueueReceive(s_command_queue, &message, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        handle_command_payload(message.payload, message.length);
    }
}

static void handle_command_payload(const char *payload, size_t payload_length)
{
    cJSON *root = cJSON_ParseWithLength(payload, payload_length);
    const cJSON *data = root == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(root, "data");
    const cJSON *command_id = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "commandId");
    const cJSON *actions = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "actions");
    if (handle_voice_test_control(data) || handle_audio_test_control(data)) {
        cJSON_Delete(root);
        return;
    }
    if (!cJSON_IsString(command_id) || command_id->valuestring == NULL ||
        !cJSON_IsArray(actions)) {
        ESP_LOGE(TAG, "MQTT command envelope is invalid");
        cJSON_Delete(root);
        return;
    }

    dx_device_command_result_t result;
    esp_err_t err = device_command_execute_json(
        command_id->valuestring,
        actions,
        &result
    );
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Command parse failed: %s", esp_err_to_name(err));
        cJSON_Delete(root);
        return;
    }

    cJSON *result_data = cJSON_CreateObject();
    if (result_data != NULL) {
        cJSON_AddStringToObject(result_data, "commandId", command_id->valuestring);
        cJSON_AddStringToObject(result_data, "status", result.status);
        cJSON_AddStringToObject(result_data, "executedAt", "device-clock-unsynced");
        if (result.mcu_frame[0] != '\0') {
            cJSON_AddStringToObject(result_data, "mcuFrame", result.mcu_frame);
        }
        if (result.execution_path[0] != '\0') {
            cJSON_AddStringToObject(result_data, "executionPath", result.execution_path);
        }
        if (result.message[0] != '\0') {
            cJSON_AddStringToObject(result_data, "message", result.message);
        }
        if (strcmp(result.status, "success") != 0 && result.error_code[0] != '\0') {
            cJSON *error = cJSON_CreateObject();
            if (error != NULL) {
                cJSON_AddStringToObject(error, "code", result.error_code);
                cJSON_AddStringToObject(error, "message", result.message);
                cJSON_AddItemToObject(result_data, "error", error);
            }
        }
        cJSON *state = build_state();
        if (state != NULL) {
            cJSON_AddItemToObject(result_data, "state", state);
        }
        publish_envelope("command-result", result_data, 1, false);
    }
    cJSON_Delete(root);
}

static bool handle_voice_test_control(const cJSON *data)
{
    const cJSON *type = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "type");
    if (!cJSON_IsString(type) || type->valuestring == NULL ||
        strcmp(type->valuestring, "voice_test") != 0) {
        return false;
    }

    const cJSON *action = cJSON_GetObjectItemCaseSensitive(data, "action");
    const cJSON *session_id = cJSON_GetObjectItemCaseSensitive(data, "testSessionId");
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(data, "mode");
    if (!cJSON_IsString(action) || action->valuestring == NULL ||
        !cJSON_IsString(session_id) || session_id->valuestring == NULL) {
        ESP_LOGE(TAG, "Voice test control payload is invalid");
        return true;
    }

    esp_err_t err;
    if (strcmp(action->valuestring, "start") == 0) {
        const bool asr_only = cJSON_IsString(mode) && mode->valuestring != NULL &&
            strcmp(mode->valuestring, "ASR_ONLY") == 0;
        err = voice_engine_start_test(session_id->valuestring, asr_only);
    } else if (strcmp(action->valuestring, "stop") == 0) {
        err = voice_engine_stop_test(session_id->valuestring);
    } else {
        err = ESP_ERR_INVALID_ARG;
    }
    if (err != ESP_OK) {
        char message[96];
        snprintf(message, sizeof(message), "Voice test control rejected: %s", esp_err_to_name(err));
        mqtt_agent_report_voice_test(session_id->valuestring, "FAILED", message);
        ESP_LOGE(TAG, "%s", message);
    }
    return true;
}

static bool handle_audio_test_control(const cJSON *data)
{
    const cJSON *type = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "type");
    if (!cJSON_IsString(type) || type->valuestring == NULL ||
        strcmp(type->valuestring, "audio_test") != 0) {
        return false;
    }

    const cJSON *action = cJSON_GetObjectItemCaseSensitive(data, "action");
    const cJSON *test_id = cJSON_GetObjectItemCaseSensitive(data, "testId");
    const cJSON *audio_path = cJSON_GetObjectItemCaseSensitive(data, "audioPath");
    if (!cJSON_IsString(action) || action->valuestring == NULL ||
        !cJSON_IsString(test_id) || test_id->valuestring == NULL) {
        ESP_LOGE(TAG, "Audio test control payload is invalid");
        return true;
    }

    esp_err_t err;
    if (strcmp(action->valuestring, "play") == 0 &&
        cJSON_IsString(audio_path) && audio_path->valuestring != NULL) {
        err = voice_engine_start_audio_test(test_id->valuestring, audio_path->valuestring);
    } else if (strcmp(action->valuestring, "stop") == 0) {
        err = voice_engine_stop_audio_test(test_id->valuestring);
    } else {
        err = ESP_ERR_INVALID_ARG;
    }
    if (err != ESP_OK) {
        char message[96];
        snprintf(message, sizeof(message), "Audio test control rejected: %s", esp_err_to_name(err));
        mqtt_agent_report_audio_test(test_id->valuestring, "FAILED", message);
        ESP_LOGE(TAG, "%s", message);
    }
    return true;
}

static void publish_registration(void)
{
    cJSON *data = cJSON_CreateObject();
    cJSON *capabilities = cJSON_CreateObject();
    if (data == NULL || capabilities == NULL) {
        cJSON_Delete(data);
        cJSON_Delete(capabilities);
        return;
    }

    uint8_t mac[6] = {0};
    char mac_text[18];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(
        mac_text,
        sizeof(mac_text),
        "%02X:%02X:%02X:%02X:%02X:%02X",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    );
    cJSON_AddStringToObject(data, "model", DX_DEVICE_MODEL);
    cJSON_AddStringToObject(data, "firmwareVersion", DX_FIRMWARE_VERSION);
    cJSON_AddStringToObject(data, "protocolVersion", DX_PROTOCOL_VERSION);
    cJSON_AddStringToObject(data, "mac", mac_text);
    cJSON_AddBoolToObject(capabilities, "deviceStateReport", true);
    cJSON_AddBoolToObject(capabilities, "mqttCommand", true);
    cJSON_AddBoolToObject(capabilities, "uartBridge", DX_ENABLE_UART_BRIDGE);
    cJSON_AddBoolToObject(capabilities, "textSimulation", DX_ENABLE_TEXT_SIMULATION);
    cJSON_AddBoolToObject(capabilities, "audio", DX_ENABLE_AUDIO);
    cJSON_AddBoolToObject(
        capabilities,
        "voiceTestControl",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(capabilities, "directControl", true);
    cJSON_AddBoolToObject(
        capabilities,
        "virtualHal",
        direct_control_hal_is_virtual()
    );
    cJSON_AddBoolToObject(capabilities, "pcf8574", DX_ENABLE_PCF8574);
    cJSON_AddBoolToObject(capabilities, "ci1302", false);
    cJSON_AddBoolToObject(capabilities, "bleLocalControllers", false);
    cJSON_AddItemToObject(data, "capabilities", capabilities);
    publish_envelope("register", data, 1, true);
}

static void publish_heartbeat(void)
{
    cJSON *data = cJSON_CreateObject();
    cJSON *network = cJSON_CreateObject();
    if (data == NULL || network == NULL) {
        cJSON_Delete(data);
        cJSON_Delete(network);
        return;
    }

    char ip[16];
    int rssi = 0;
    if (wifi_manager_get_network_info(ip, sizeof(ip), &rssi) == ESP_OK) {
        cJSON_AddStringToObject(network, "ip", ip);
        cJSON_AddNumberToObject(network, "rssi", rssi);
    }
    cJSON_AddNumberToObject(network, "freeHeapBytes", esp_get_free_heap_size());
    cJSON_AddStringToObject(data, "firmwareVersion", DX_FIRMWARE_VERSION);
    cJSON_AddItemToObject(data, "network", network);
    publish_envelope("heartbeat", data, 0, false);
}

static void publish_online_status(void)
{
    cJSON *data = cJSON_CreateObject();
    cJSON *state = cJSON_CreateObject();
    if (data == NULL || state == NULL) {
        cJSON_Delete(data);
        cJSON_Delete(state);
        return;
    }
    cJSON_AddBoolToObject(state, "isOnline", true);
    cJSON_AddItemToObject(data, "state", state);
    publish_envelope("status", data, 1, true);
}

static cJSON *build_state(void)
{
    dx_device_state_t state;
    if (device_state_get(&state) != ESP_OK) {
        return NULL;
    }

    cJSON *json = cJSON_CreateObject();
    if (json == NULL) {
        return NULL;
    }
    cJSON_AddBoolToObject(json, "isOnline", state.is_online);
    cJSON_AddStringToObject(json, "power", state.power ? "on" : "off");
    cJSON_AddStringToObject(json, "light", state.light ? "on" : "off");
    cJSON_AddStringToObject(
        json,
        "heater",
        state.heater == DX_HEATER_STRONG
            ? "strong"
            : state.heater == DX_HEATER_WEAK ? "weak" : "off"
    );
    cJSON_AddStringToObject(json, "ventilation", state.ventilation ? "on" : "off");
    cJSON_AddStringToObject(json, "fan", state.fan ? "on" : "off");
    cJSON_AddStringToObject(json, "swing", state.swing ? "on" : "off");
    cJSON_AddStringToObject(json, "dry", state.dry ? "on" : "off");
    cJSON_AddStringToObject(json, "bathMode", state.bath_mode ? "on" : "off");
    cJSON_AddStringToObject(
        json,
        "constantTemperature",
        state.constant_temperature ? "on" : "off"
    );
    cJSON_AddNumberToObject(json, "targetTemperature", state.target_temperature);
    cJSON_AddNumberToObject(json, "ambientTemperature", state.ambient_temperature);
    cJSON_AddNumberToObject(json, "humidity", state.humidity);
    cJSON_AddBoolToObject(json, "hasOccupancy", state.has_occupancy);
    if (state.fault_code[0] == '\0') {
        cJSON_AddNullToObject(json, "faultCode");
    } else {
        cJSON_AddStringToObject(json, "faultCode", state.fault_code);
    }
    cJSON_AddNumberToObject(json, "runningMinutes", state.running_minutes);
    return json;
}

static esp_err_t publish_envelope(
    const char *message_type,
    cJSON *data,
    int qos,
    bool retain
)
{
    if (data == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_connected || s_client == NULL) {
        cJSON_Delete(data);
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        cJSON_Delete(data);
        return ESP_ERR_NO_MEM;
    }
    char message_id[48];
    snprintf(message_id, sizeof(message_id), "esp32-%llu-%lu",
        (unsigned long long)(esp_timer_get_time() / 1000), ++s_message_sequence);
    char sent_at[40];
    snprintf(sent_at, sizeof(sent_at), "uptime-ms-%llu",
        (unsigned long long)(esp_timer_get_time() / 1000));
    cJSON_AddStringToObject(root, "version", "1.0");
    cJSON_AddStringToObject(root, "messageId", message_id);
    cJSON_AddStringToObject(root, "deviceId", DX_DEVICE_ID);
    cJSON_AddStringToObject(root, "sentAt", sent_at);
    cJSON_AddItemToObject(root, "data", data);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }
    char topic[160];
    snprintf(
        topic,
        sizeof(topic),
        "dongxin/v1/devices/%s/up/%s",
        DX_DEVICE_ID,
        message_type
    );
    int message_id_number = esp_mqtt_client_publish(
        s_client,
        topic,
        payload,
        0,
        qos,
        retain ? 1 : 0
    );
    cJSON_free(payload);
    return message_id_number >= 0 ? ESP_OK : ESP_FAIL;
}

static void mqtt_task(void *arg)
{
    (void)arg;
    while (!wifi_manager_is_connected()) {
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    snprintf(
        s_command_topic,
        sizeof(s_command_topic),
        "dongxin/v1/devices/%s/down/command",
        DX_DEVICE_ID
    );
    snprintf(
        s_voice_test_topic,
        sizeof(s_voice_test_topic),
        "dongxin/v1/devices/%s/down/voice-test",
        DX_DEVICE_ID
    );
    snprintf(
        s_audio_test_topic,
        sizeof(s_audio_test_topic),
        "dongxin/v1/devices/%s/down/audio-test",
        DX_DEVICE_ID
    );
    static const char offline_message[] =
        "{\"version\":\"1.0\",\"messageId\":\"lwt\",\"deviceId\":\"" DX_DEVICE_ID
        "\",\"sentAt\":\"broker\",\"data\":{\"state\":{\"isOnline\":false}}}";
    static const char offline_topic[] =
        "dongxin/v1/devices/" DX_DEVICE_ID "/up/status";
    const esp_mqtt_client_config_t config = {
        .broker.address.uri = DX_MQTT_BROKER_URI,
        .credentials.username = DX_MQTT_USERNAME,
        .credentials.client_id = DX_DEVICE_ID,
        .credentials.authentication.password = DX_MQTT_DEVICE_SECRET,
        .session.keepalive = DX_MQTT_KEEPALIVE_SECONDS,
        .session.last_will.topic = offline_topic,
        .session.last_will.msg = offline_message,
        .session.last_will.qos = 1,
        .session.last_will.retain = 1,
        .network.reconnect_timeout_ms = 3000,
        .task.stack_size = 6144,
        .buffer.size = 2048
    };
    s_client = esp_mqtt_client_init(&config);
    if (s_client == NULL) {
        ESP_LOGE(TAG, "MQTT client initialization failed");
        vTaskDelete(NULL);
        return;
    }
    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    ESP_ERROR_CHECK(esp_mqtt_client_start(s_client));

    TickType_t last_heartbeat = xTaskGetTickCount();
    TickType_t last_state_report = last_heartbeat;
    while (true) {
        TickType_t now = xTaskGetTickCount();
        if (s_connected && now - last_heartbeat >= pdMS_TO_TICKS(DX_HEARTBEAT_INTERVAL_SECONDS * 1000)) {
            publish_heartbeat();
            last_heartbeat = now;
        }
        if (s_connected && now - last_state_report >= pdMS_TO_TICKS(DX_STATE_REPORT_INTERVAL_SECONDS * 1000)) {
            mqtt_agent_report_state();
            last_state_report = now;
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void mqtt_agent_init(void)
{
#if !DX_ENABLE_MQTT
    ESP_LOGI(TAG, "MQTT agent disabled by configuration");
    return;
#endif
    s_command_queue = xQueueCreate(
        MQTT_COMMAND_QUEUE_DEPTH,
        sizeof(dx_mqtt_command_message_t)
    );
    if (s_command_queue == NULL) {
        ESP_LOGE(TAG, "Could not allocate MQTT command queue");
        return;
    }
    if (xTaskCreate(
            command_dispatch_task,
            "mqtt_commands",
            6144,
            NULL,
            6,
            NULL
        ) != pdPASS) {
        vQueueDelete(s_command_queue);
        s_command_queue = NULL;
        ESP_LOGE(TAG, "Could not start MQTT command dispatch task");
        return;
    }
    ESP_LOGI(TAG, "MQTT agent starting, broker=%s", DX_MQTT_BROKER_URI);
    xTaskCreate(mqtt_task, "mqtt_agent", 6144, NULL, 5, NULL);
}
