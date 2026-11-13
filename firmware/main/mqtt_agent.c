#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_crt_bundle.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_client.h"

#include "app_config.h"
#include "board_lab.h"
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
static volatile bool s_connected;
static volatile uint32_t s_connection_generation;
static unsigned long s_message_sequence;
static uint32_t s_message_boot_nonce;
static portMUX_TYPE s_message_id_lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_ci_boot_nonce;
static uint32_t s_ci_boot_nonce_extra;
static uint32_t s_ci_event_counter;
static bool s_ci_local_pending;
static dx_stm32_status_t s_ci_local_pending_status;
static char s_ci_local_pending_id[48];
static uint32_t s_ci_local_pending_counter;
static volatile bool s_downlinks_subscribed;
static bool s_connection_setup_running;
static volatile bool s_subscription_requested;
static volatile int s_subscription_ids[4];
static volatile uint8_t s_subscription_ack_mask;
static TickType_t s_subscription_requested_at;
static int s_ci_inflight_message_id = -1;
static uint32_t s_ci_inflight_counter;
static TickType_t s_ci_inflight_started_at;
static bool s_ci_enqueuing;
static int s_ci_early_ack_id = -1;
static portMUX_TYPE s_connection_setup_lock = portMUX_INITIALIZER_UNLOCKED;
static portMUX_TYPE s_ci_pending_lock = portMUX_INITIALIZER_UNLOCKED;
static SemaphoreHandle_t s_ci_publish_mutex;
static char s_command_topic[160];
static char s_voice_test_topic[160];
static char s_audio_test_topic[160];
static char s_board_test_topic[160];
static char s_rx_buffer[2048];
static QueueHandle_t s_command_queue;

typedef struct {
    size_t length;
    uint32_t connection_generation;
    char payload[2048];
} dx_mqtt_command_message_t;

static cJSON *build_state(void);
static esp_err_t publish_envelope(
    const char *message_type,
    cJSON *data,
    int qos,
    bool retain
);
static esp_err_t enqueue_envelope(const char *message_type, cJSON *data, int *message_id);
static void publish_registration(void);
static void publish_heartbeat(void);
static void publish_online_status(void);
static void handle_command_payload(const char *payload, size_t payload_length);
static bool handle_voice_test_control(const cJSON *data);
static bool handle_audio_test_control(const cJSON *data);
static bool handle_board_test_control(const cJSON *data);
static void command_dispatch_task(void *arg);
static esp_err_t publish_ci_event_with_id(const dx_stm32_status_t *status, const char *event_id, int *message_id);
static esp_err_t enqueue_local_ci_event(const dx_stm32_status_t *status, const char *event_id, uint32_t counter);
static bool flush_pending_ci_event(void);
static void complete_connection_setup(void);

static void store_ci_pending(const dx_stm32_status_t *status, const char *event_id, uint32_t counter)
{
    portENTER_CRITICAL(&s_ci_pending_lock);
    if (!s_ci_local_pending || counter >= s_ci_local_pending_counter) {
        s_ci_local_pending_status = *status;
        strncpy(s_ci_local_pending_id, event_id, sizeof(s_ci_local_pending_id) - 1);
        s_ci_local_pending_id[sizeof(s_ci_local_pending_id) - 1] = '\0';
        s_ci_local_pending_counter = counter;
        s_ci_local_pending = true;
    }
    portEXIT_CRITICAL(&s_ci_pending_lock);
}

static bool snapshot_ci_pending(dx_stm32_status_t *status, char event_id[48], uint32_t *counter)
{
    portENTER_CRITICAL(&s_ci_pending_lock);
    const bool pending = s_ci_local_pending;
    if (pending) {
        *status = s_ci_local_pending_status;
        memcpy(event_id, s_ci_local_pending_id, sizeof(s_ci_local_pending_id));
        *counter = s_ci_local_pending_counter;
    }
    portEXIT_CRITICAL(&s_ci_pending_lock);
    return pending;
}

static bool ci_event_reconciliation_complete(void)
{
    portENTER_CRITICAL(&s_ci_pending_lock);
    const bool complete = !s_ci_local_pending;
    portEXIT_CRITICAL(&s_ci_pending_lock);
    return complete;
}

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

esp_err_t mqtt_agent_report_ci_event(const dx_stm32_status_t *status)
{
    if (status == NULL || status->ci_event_type == DX_STM32_CI_EVENT_NONE) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_ci_boot_nonce == 0U && s_ci_boot_nonce_extra == 0U) {
        s_ci_boot_nonce = esp_random();
        s_ci_boot_nonce_extra = esp_random();
        if (s_ci_boot_nonce == 0U && s_ci_boot_nonce_extra == 0U) s_ci_boot_nonce = 1U;
    }
    char event_id[48];
    snprintf(event_id, sizeof(event_id), "c3-%08lx%08lx-%08lx",
             (unsigned long)s_ci_boot_nonce, (unsigned long)s_ci_boot_nonce_extra,
             (unsigned long)++s_ci_event_counter);
    const uint32_t event_counter = s_ci_event_counter;
    const bool local = status->ci_event_type == DX_STM32_CI_EVENT_LOCAL_APPLIED;
    if (local) store_ci_pending(status, event_id, event_counter);
    if (!s_connected || s_ci_publish_mutex == NULL) {
        return ESP_OK;
    }
    if (xSemaphoreTake(s_ci_publish_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t result = ESP_ERR_INVALID_STATE;
    if (s_connected) {
        portENTER_CRITICAL(&s_ci_pending_lock);
        const bool inflight = s_ci_inflight_message_id >= 0;
        portEXIT_CRITICAL(&s_ci_pending_lock);
        if (local && inflight) {
            result = ESP_OK;
        } else {
            int message_id = -1;
            result = local ? enqueue_local_ci_event(status, event_id, event_counter)
                           : publish_ci_event_with_id(status, event_id, &message_id);
        }
    }
    xSemaphoreGive(s_ci_publish_mutex);
    return result;
}

static esp_err_t publish_ci_event_with_id(const dx_stm32_status_t *status, const char *event_id, int *message_id)
{
    cJSON *data = cJSON_CreateObject();
    cJSON *payload = cJSON_CreateObject();
    if (data == NULL || payload == NULL) {
        cJSON_Delete(data);
        cJSON_Delete(payload);
        return ESP_ERR_NO_MEM;
    }
    const bool local = status->ci_event_type == DX_STM32_CI_EVENT_LOCAL_APPLIED;
    cJSON_AddStringToObject(data, "eventId", event_id);
    cJSON_AddStringToObject(data, "eventType", local ? "LOCAL_CONTROL" : "CI_WAKE");
    cJSON_AddStringToObject(payload, "source", "CI1302");
    cJSON_AddNumberToObject(payload, "semanticId", status->ci_semantic_id);
    cJSON_AddNumberToObject(payload, "eventSequence", status->ci_event_sequence);
    if (local) {
        const char *intent = NULL;
        switch (status->ci_semantic_id) {
            case 2U: intent = "LIGHT_ON"; break;
            case 3U: intent = "LIGHT_OFF"; break;
            case 8U: intent = "VENTILATION_ON"; break;
            case 9U: intent = "VENTILATION_OFF"; break;
            case 10U: intent = "FAN_ON"; break;
            case 11U: intent = "FAN_OFF"; break;
            default: break;
        }
        if (intent != NULL) cJSON_AddStringToObject(payload, "intent", intent);
        cJSON *state = cJSON_CreateObject();
        if (state == NULL) {
            cJSON_Delete(data);
            cJSON_Delete(payload);
            return ESP_ERR_NO_MEM;
        }
        cJSON_AddStringToObject(state, "light", status->light ? "on" : "off");
        cJSON_AddStringToObject(state, "fan", status->fan ? "on" : "off");
        cJSON_AddStringToObject(state, "ventilation", status->ventilation ? "on" : "off");
        cJSON_AddStringToObject(state, "heater", status->heater_strong ? "strong" :
                                (status->heater_weak ? "weak" : "off"));
        cJSON_AddStringToObject(state, "swing", status->swing ? "on" : "off");
        cJSON_AddStringToObject(state, "dry", status->dry ? "on" : "off");
        cJSON_AddItemToObject(payload, "state", state);
    }
    cJSON_AddItemToObject(data, "payload", payload);
    return enqueue_envelope("event", data, message_id);
}

static esp_err_t enqueue_local_ci_event(const dx_stm32_status_t *status, const char *event_id, uint32_t counter)
{
    const uint32_t generation = s_connection_generation;
    portENTER_CRITICAL(&s_ci_pending_lock);
    s_ci_enqueuing = true;
    s_ci_early_ack_id = -1;
    portEXIT_CRITICAL(&s_ci_pending_lock);

    int message_id = -1;
    const esp_err_t result = publish_ci_event_with_id(status, event_id, &message_id);
    portENTER_CRITICAL(&s_ci_pending_lock);
    s_ci_enqueuing = false;
    if (result == ESP_OK && s_connected && generation == s_connection_generation) {
        if (s_ci_early_ack_id == message_id) {
            if (s_ci_local_pending && s_ci_local_pending_counter <= counter) {
                s_ci_local_pending = false;
                s_ci_local_pending_id[0] = '\0';
            }
        } else {
            s_ci_inflight_message_id = message_id;
            s_ci_inflight_counter = counter;
            s_ci_inflight_started_at = xTaskGetTickCount();
        }
    }
    s_ci_early_ack_id = -1;
    portEXIT_CRITICAL(&s_ci_pending_lock);
    return result;
}

static bool flush_pending_ci_event(void)
{
    if (s_ci_publish_mutex == NULL ||
        xSemaphoreTake(s_ci_publish_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) return false;
    dx_stm32_status_t pending;
    char pending_id[48];
    uint32_t pending_counter = 0U;
    const bool has_pending = snapshot_ci_pending(&pending, pending_id, &pending_counter);
    bool delivered = !has_pending;
    if (has_pending && s_connected) {
        portENTER_CRITICAL(&s_ci_pending_lock);
        if (s_ci_inflight_message_id >= 0 &&
            (TickType_t)(xTaskGetTickCount() - s_ci_inflight_started_at) >= pdMS_TO_TICKS(15000)) {
            s_ci_inflight_message_id = -1;
        }
        const bool inflight = s_ci_inflight_message_id >= 0;
        portEXIT_CRITICAL(&s_ci_pending_lock);
        if (!inflight) {
            (void)enqueue_local_ci_event(&pending, pending_id, pending_counter);
        }
    }
    xSemaphoreGive(s_ci_publish_mutex);
    return delivered;
}

static void complete_connection_setup(void)
{
    portENTER_CRITICAL(&s_connection_setup_lock);
    if (!s_connected || s_downlinks_subscribed || s_connection_setup_running) {
        portEXIT_CRITICAL(&s_connection_setup_lock);
        return;
    }
    s_connection_setup_running = true;
    const uint32_t generation = s_connection_generation;
    portEXIT_CRITICAL(&s_connection_setup_lock);

    if (!flush_pending_ci_event() || !s_connected || generation != s_connection_generation) goto done;
    if (s_subscription_requested &&
        (TickType_t)(xTaskGetTickCount() - s_subscription_requested_at) < pdMS_TO_TICKS(10000)) goto done;
    s_subscription_requested = true;
    s_subscription_requested_at = xTaskGetTickCount();
    s_subscription_ack_mask = 0;
    for (size_t i = 0; i < 4; i++) s_subscription_ids[i] = -1;
    const char *topics[4] = {s_command_topic, s_voice_test_topic, s_audio_test_topic, s_board_test_topic};
    bool requested = true;
    for (size_t i = 0; i < 4; i++) {
        const int id = esp_mqtt_client_subscribe(s_client, topics[i], 1);
        s_subscription_ids[i] = id;
        if (id < 0) requested = false;
    }
    if (!requested) ESP_LOGW(TAG, "Downlink subscription request failed; retrying");
done:
    portENTER_CRITICAL(&s_connection_setup_lock);
    s_connection_setup_running = false;
    portEXIT_CRITICAL(&s_connection_setup_lock);
}

esp_err_t mqtt_agent_report_stm32_link(
    const char *direction,
    const char *event_type,
    const uint8_t *frame,
    size_t frame_length,
    const dx_stm32_status_t *status,
    bool valid,
    const char *result,
    uint32_t rejected_frames,
    uint32_t discarded_bytes
)
{
    if (direction == NULL || event_type == NULL ||
        frame_length > DX_STM32_FRAME_SIZE ||
        (frame_length > 0U && frame == NULL)) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *data = cJSON_CreateObject();
    if (data == NULL) {
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(data, "direction", direction);
    cJSON_AddStringToObject(data, "eventType", event_type);
    cJSON_AddBoolToObject(data, "valid", valid);
    cJSON_AddStringToObject(data, "result", result == NULL ? "" : result);
    cJSON_AddNumberToObject(data, "rejectedFrames", rejected_frames);
    cJSON_AddNumberToObject(data, "discardedBytes", discarded_bytes);

    char frame_hex[DX_STM32_FRAME_SIZE * 3U] = {0};
    for (size_t index = 0; index < frame_length; index++) {
        snprintf(
            &frame_hex[index * 3U],
            sizeof(frame_hex) - index * 3U,
            index + 1U == frame_length ? "%02X" : "%02X ",
            frame[index]
        );
    }
    cJSON_AddStringToObject(data, "frame", frame_hex);

    if (status != NULL) {
        cJSON_AddNumberToObject(data, "command", status->command);
        cJSON_AddNumberToObject(data, "value", status->value);
        cJSON *parsed = cJSON_CreateObject();
        if (parsed != NULL) {
            cJSON_AddNumberToObject(parsed, "temperatureCelsius", status->temperature_celsius);
            cJSON_AddNumberToObject(parsed, "remainingMinutes", status->remaining_minutes);
            cJSON_AddBoolToObject(parsed, "light", status->light);
            cJSON_AddBoolToObject(parsed, "ventilation", status->ventilation);
            cJSON_AddBoolToObject(parsed, "fan", status->fan);
            cJSON_AddStringToObject(
                parsed,
                "heater",
                status->heater_strong ? "strong" : (status->heater_weak ? "weak" : "off")
            );
            cJSON_AddBoolToObject(parsed, "swing", status->swing);
            cJSON_AddBoolToObject(parsed, "dry", status->dry);
            cJSON_AddBoolToObject(parsed, "networkControlEnabled", status->network_control_enabled);
            cJSON_AddItemToObject(data, "state", parsed);
        }
    } else if (frame_length >= 5U) {
        cJSON_AddNumberToObject(data, "command", frame[3]);
        cJSON_AddNumberToObject(data, "value", frame[4]);
    }
    return publish_envelope("stm32-link", data, 1, false);
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
            s_connection_generation++;
            s_downlinks_subscribed = false;
            s_subscription_requested = false;
            s_subscription_ack_mask = 0;
            device_state_set_online(true);
            break;
        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            s_downlinks_subscribed = false;
            s_subscription_requested = false;
            if (s_command_queue != NULL) xQueueReset(s_command_queue);
            portENTER_CRITICAL(&s_ci_pending_lock);
            s_ci_inflight_message_id = -1;
            portEXIT_CRITICAL(&s_ci_pending_lock);
            device_state_set_online(false);
            ESP_LOGW(TAG, "Disconnected; ESP-MQTT will reconnect automatically");
            break;
        case MQTT_EVENT_PUBLISHED:
            portENTER_CRITICAL(&s_ci_pending_lock);
            if (event->msg_id == s_ci_inflight_message_id) {
                const uint32_t acknowledged = s_ci_inflight_counter;
                if (s_ci_local_pending && s_ci_local_pending_counter <= acknowledged) {
                    s_ci_local_pending = false;
                    s_ci_local_pending_id[0] = '\0';
                }
                s_ci_inflight_message_id = -1;
            } else if (s_ci_enqueuing && s_ci_inflight_message_id < 0) {
                s_ci_early_ack_id = event->msg_id;
            }
            portEXIT_CRITICAL(&s_ci_pending_lock);
            break;
        case MQTT_EVENT_SUBSCRIBED:
            if (!s_connected || !s_subscription_requested || s_downlinks_subscribed) break;
            for (size_t i = 0; i < 4; i++) {
                if (event->msg_id == s_subscription_ids[i]) s_subscription_ack_mask |= (uint8_t)(1U << i);
            }
            if (s_subscription_ack_mask == 0x0FU) {
                s_downlinks_subscribed = true;
                ESP_LOGI(TAG, "Connected, subscribed to command, voice, audio and board test topics");
                publish_registration();
                publish_online_status();
                mqtt_agent_report_state();
            }
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
                    .connection_generation = s_connection_generation,
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
        while (!s_connected || !s_downlinks_subscribed || !ci_event_reconciliation_complete()) {
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        if (message.connection_generation != s_connection_generation) continue;
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
    const cJSON *expected_revision = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "expectedControlRevision");
    if (handle_voice_test_control(data) ||
        handle_audio_test_control(data) ||
        handle_board_test_control(data)) {
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
    esp_err_t err = ESP_OK;
    if (device_command_is_fresh(data, &result)) {
        err = device_command_execute_json(
            command_id->valuestring,
            actions,
            cJSON_IsNumber(expected_revision) && expected_revision->valueint >= 0 &&
                expected_revision->valueint <= 255 ? expected_revision->valueint : -1,
            &result
        );
    }
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
    const cJSON *continuous = cJSON_GetObjectItemCaseSensitive(data, "continuous");
    const cJSON *settings = cJSON_GetObjectItemCaseSensitive(data, "settings");
    if (!cJSON_IsString(action) || action->valuestring == NULL ||
        !cJSON_IsString(session_id) || session_id->valuestring == NULL) {
        ESP_LOGE(TAG, "Voice test control payload is invalid");
        return true;
    }

    esp_err_t err;
    if (strcmp(action->valuestring, "start") == 0) {
        const bool asr_only = cJSON_IsString(mode) && mode->valuestring != NULL &&
            strcmp(mode->valuestring, "ASR_ONLY") == 0;
        const bool ci_wake_online_fallback = cJSON_IsString(mode) &&
            mode->valuestring != NULL &&
            strcmp(mode->valuestring, "CI_WAKE_ONLINE_FALLBACK") == 0;
        err = voice_engine_start_test(
            session_id->valuestring,
            asr_only,
            ci_wake_online_fallback,
            cJSON_IsTrue(continuous),
            cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(settings, "endpointSilenceMs"))
                ? cJSON_GetObjectItemCaseSensitive(settings, "endpointSilenceMs")->valueint : 800,
            cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(settings, "idleTimeoutMs"))
                ? cJSON_GetObjectItemCaseSensitive(settings, "idleTimeoutMs")->valueint : 30000,
            cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(settings, "maxUtteranceSeconds"))
                ? cJSON_GetObjectItemCaseSensitive(settings, "maxUtteranceSeconds")->valueint : 12,
            cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(settings, "voiceThreshold"))
                ? cJSON_GetObjectItemCaseSensitive(settings, "voiceThreshold")->valueint : 350,
            cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(settings, "noiseMultiplier"))
                ? (int)(cJSON_GetObjectItemCaseSensitive(settings, "noiseMultiplier")->valuedouble * 10) : 30
        );
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
    const cJSON *volume = cJSON_GetObjectItemCaseSensitive(data, "volumePercent");
    const cJSON *listen_after_playback = cJSON_GetObjectItemCaseSensitive(data, "listenAfterPlayback");
    if (!cJSON_IsString(action) || action->valuestring == NULL ||
        !cJSON_IsString(test_id) || test_id->valuestring == NULL) {
        ESP_LOGE(TAG, "Audio test control payload is invalid");
        return true;
    }

    esp_err_t err;
    if (strcmp(action->valuestring, "play") == 0 &&
        cJSON_IsString(audio_path) && audio_path->valuestring != NULL) {
        int volume_percent = DX_LICHUANG_PLAYBACK_DEFAULT_VOLUME;
        if (cJSON_IsNumber(volume)) {
            volume_percent = volume->valueint;
        }
        if (volume_percent < DX_LICHUANG_PLAYBACK_MIN_VOLUME ||
            volume_percent > DX_LICHUANG_PLAYBACK_MAX_VOLUME) {
            err = ESP_ERR_INVALID_ARG;
        } else {
            err = voice_engine_start_audio_test(
                test_id->valuestring,
                audio_path->valuestring,
                volume_percent,
                cJSON_IsTrue(listen_after_playback)
            );
        }
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

static bool handle_board_test_control(const cJSON *data)
{
    const cJSON *type = data == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(data, "type");
    if (!cJSON_IsString(type) || type->valuestring == NULL ||
        strcmp(type->valuestring, "board_test") != 0) {
        return false;
    }

    const cJSON *request_id = cJSON_GetObjectItemCaseSensitive(data, "requestId");
    const cJSON *action = cJSON_GetObjectItemCaseSensitive(data, "action");
    const cJSON *params = cJSON_GetObjectItemCaseSensitive(data, "params");
    if (!cJSON_IsString(request_id) || request_id->valuestring == NULL ||
        !cJSON_IsString(action) || action->valuestring == NULL) {
        ESP_LOGE(TAG, "Board test control payload is invalid");
        return true;
    }

    cJSON *result = NULL;
    char message[128] = {0};
    const esp_err_t err = board_lab_execute(
        action->valuestring,
        cJSON_IsObject(params) ? params : NULL,
        &result,
        message,
        sizeof(message)
    );
    cJSON *response = cJSON_CreateObject();
    if (response == NULL) {
        cJSON_Delete(result);
        return true;
    }
    cJSON_AddStringToObject(response, "requestId", request_id->valuestring);
    cJSON_AddStringToObject(response, "action", action->valuestring);
    cJSON_AddStringToObject(response, "status", err == ESP_OK ? "COMPLETED" : "FAILED");
    cJSON_AddStringToObject(
        response,
        "message",
        message[0] != '\0' ? message : esp_err_to_name(err)
    );
    if (result != NULL) {
        cJSON_AddItemToObject(response, "result", result);
    }
    publish_envelope("board-test", response, 1, false);
    ESP_LOGI(
        TAG,
        "Board test request=%s action=%s result=%s",
        request_id->valuestring,
        action->valuestring,
        esp_err_to_name(err)
    );
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
    cJSON_AddBoolToObject(
        capabilities,
        "mqttCommand",
        DX_STM32_CONTROL_STAGE > 0 || DX_ENABLE_UART_BRIDGE || DX_ENABLE_PCF8574
    );
    cJSON_AddBoolToObject(capabilities, "uartBridge", DX_ENABLE_UART_BRIDGE);
    cJSON_AddBoolToObject(capabilities, "textSimulation", DX_ENABLE_TEXT_SIMULATION);
    cJSON_AddBoolToObject(capabilities, "audio", DX_ENABLE_AUDIO);
    cJSON_AddBoolToObject(
        capabilities,
        "audioPlayback",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(
        capabilities,
        "voiceTestControl",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(
        capabilities,
        "boardLab",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(
        capabilities,
        "displayControl",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(
        capabilities,
        "sensorTelemetry",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(
        capabilities,
        "touchTelemetry",
        DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    );
    cJSON_AddBoolToObject(capabilities, "directControl", DX_ENABLE_PCF8574);
    cJSON_AddBoolToObject(
        capabilities,
        "stm32UartMonitor",
        DX_ENABLE_SAMPLE_UART_MONITOR
    );
    cJSON_AddBoolToObject(
        capabilities,
        "stm32UartControl",
        DX_ENABLE_SAMPLE_UART_MONITOR && DX_STM32_CONTROL_STAGE > 0
    );
    cJSON_AddBoolToObject(
        capabilities,
        "stm32LightControl",
        DX_ENABLE_SAMPLE_UART_MONITOR && DX_STM32_CONTROL_STAGE >= 1
    );
    cJSON_AddBoolToObject(
        capabilities,
        "stm32AirControl",
        DX_ENABLE_SAMPLE_UART_MONITOR && DX_STM32_CONTROL_STAGE >= 2
    );
    cJSON_AddBoolToObject(
        capabilities,
        "stm32HeaterControl",
        DX_ENABLE_SAMPLE_UART_MONITOR && DX_STM32_CONTROL_STAGE >= 3
    );
    cJSON_AddBoolToObject(
        capabilities,
        "virtualHal",
        direct_control_hal_is_virtual() &&
            !(DX_ENABLE_SAMPLE_UART_MONITOR && DX_STM32_CONTROL_STAGE == 0)
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

static esp_err_t publish_envelope_internal(
    const char *message_type,
    cJSON *data,
    int qos,
    bool retain,
    bool enqueue,
    int *published_id
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
    portENTER_CRITICAL(&s_message_id_lock);
    if (s_message_boot_nonce == 0U) {
        s_message_boot_nonce = esp_random();
        if (s_message_boot_nonce == 0U) s_message_boot_nonce = 1U;
    }
    const uint32_t boot_nonce = s_message_boot_nonce;
    const unsigned long sequence = ++s_message_sequence;
    portEXIT_CRITICAL(&s_message_id_lock);
    snprintf(message_id, sizeof(message_id), "esp32-%08lx-%lu",
        (unsigned long)boot_nonce, sequence);
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
    int message_id_number = enqueue
        ? esp_mqtt_client_enqueue(s_client, topic, payload, 0, qos, retain ? 1 : 0, true)
        : esp_mqtt_client_publish(s_client, topic, payload, 0, qos, retain ? 1 : 0);
    cJSON_free(payload);
    if (published_id != NULL) *published_id = message_id_number;
    return message_id_number >= 0 ? ESP_OK : ESP_FAIL;
}

static esp_err_t publish_envelope(const char *message_type, cJSON *data, int qos, bool retain)
{
    return publish_envelope_internal(message_type, data, qos, retain, false, NULL);
}

static esp_err_t enqueue_envelope(const char *message_type, cJSON *data, int *message_id)
{
    return publish_envelope_internal(message_type, data, 1, false, true, message_id);
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
    snprintf(
        s_board_test_topic,
        sizeof(s_board_test_topic),
        "dongxin/v1/devices/%s/down/board-test",
        DX_DEVICE_ID
    );
    static const char offline_message[] =
        "{\"version\":\"1.0\",\"messageId\":\"lwt\",\"deviceId\":\"" DX_DEVICE_ID
        "\",\"sentAt\":\"broker\",\"data\":{\"state\":{\"isOnline\":false}}}";
    static const char offline_topic[] =
        "dongxin/v1/devices/" DX_DEVICE_ID "/up/status";
    const esp_mqtt_client_config_t config = {
        .broker.address.uri = DX_MQTT_BROKER_URI,
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach,
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
    uint32_t next_heartbeat_ms = 1000U + esp_random() % (DX_HEARTBEAT_INTERVAL_SECONDS * 1000U);
    uint32_t next_state_report_ms = 1000U + esp_random() % (DX_STATE_REPORT_INTERVAL_SECONDS * 1000U);
    uint32_t last_connection_generation = s_connection_generation;
    while (true) {
        TickType_t now = xTaskGetTickCount();
        if (s_connected && !s_downlinks_subscribed) complete_connection_setup();
        else if (s_connected) (void)flush_pending_ci_event();
        if (s_connection_generation != last_connection_generation) {
            last_connection_generation = s_connection_generation;
            last_heartbeat = now;
            last_state_report = now;
            next_heartbeat_ms = 1000U + esp_random() % (DX_HEARTBEAT_INTERVAL_SECONDS * 1000U);
            next_state_report_ms = 1000U + esp_random() % (DX_STATE_REPORT_INTERVAL_SECONDS * 1000U);
        }
        if (s_connected && now - last_heartbeat >= pdMS_TO_TICKS(next_heartbeat_ms)) {
            publish_heartbeat();
            last_heartbeat = now;
            next_heartbeat_ms = DX_HEARTBEAT_INTERVAL_SECONDS * 1000U + esp_random() % 120000U;
        }
        if (s_connected && now - last_state_report >= pdMS_TO_TICKS(next_state_report_ms)) {
            mqtt_agent_report_state();
            last_state_report = now;
            next_state_report_ms = DX_STATE_REPORT_INTERVAL_SECONDS * 1000U + esp_random() % 300000U;
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
    s_ci_publish_mutex = xSemaphoreCreateMutex();
    if (s_ci_publish_mutex == NULL) {
        ESP_LOGE(TAG, "Could not allocate CI event publish mutex");
        return;
    }
    s_command_queue = xQueueCreate(
        MQTT_COMMAND_QUEUE_DEPTH,
        sizeof(dx_mqtt_command_message_t)
    );
    if (s_command_queue == NULL) {
        vSemaphoreDelete(s_ci_publish_mutex);
        s_ci_publish_mutex = NULL;
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
        vSemaphoreDelete(s_ci_publish_mutex);
        s_ci_publish_mutex = NULL;
        ESP_LOGE(TAG, "Could not start MQTT command dispatch task");
        return;
    }
    ESP_LOGI(TAG, "MQTT agent starting, broker=%s", DX_MQTT_BROKER_URI);
    xTaskCreate(mqtt_task, "mqtt_agent", 6144, NULL, 5, NULL);
}
