#include <stdio.h>
#include <string.h>
#include <time.h>

#include "esp_log.h"
#include "nvs.h"

#include "app_config.h"
#include "command_queue.h"
#include "device_command.h"
#include "sample_uart_monitor.h"
#include "uart_bridge.h"
#include "wifi_manager.h"

_Static_assert(DX_STM32_FRAME_SIZE == DX_MCU_FRAME_SIZE, "STM32 and legacy frames must both be 32 bytes");

static const char *TAG = "DEVICE_COMMAND";
static const size_t COMMAND_ID_SIZE = 64;
static const size_t RECENT_COMMAND_COUNT = 8;
static char s_recent_command_ids[8][64];
static size_t s_recent_command_index;
static bool s_recent_commands_loaded;

static bool parse_action(const cJSON *json, dx_cloud_action_t *action);
static void frame_to_hex(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    char out_hex[DX_MCU_FRAME_SIZE * 2 + 1]
);
static bool was_recently_executed(const char *command_id);
static void remember_command(const char *command_id);
static void load_last_command(void);

bool device_command_is_fresh(const cJSON *command, dx_device_command_result_t *out_result)
{
    if (out_result == NULL) return false;
    const cJSON *expiry = cJSON_GetObjectItemCaseSensitive(command, "expireAtUnixMs");
    const time_t now = time(NULL);
    const char *code = NULL;
    if (!cJSON_IsNumber(expiry)) code = "MISSING_COMMAND_EXPIRY";
    else if (!wifi_manager_time_is_synced() || now < (time_t)1704067200) {
        code = "DEVICE_CLOCK_UNSYNCED";
    }
    else {
        const double now_ms = (double)now * 1000.0;
        if (!(expiry->valuedouble > now_ms && expiry->valuedouble <= now_ms + 120000.0)) {
            code = "EXPIRED_COMMAND";
        }
    }
    if (code == NULL) return true;
    memset(out_result, 0, sizeof(*out_result));
    out_result->status = "rejected";
    snprintf(out_result->error_code, sizeof(out_result->error_code), "%s", code);
    snprintf(out_result->message, sizeof(out_result->message),
             "Remote command rejected: %s", code);
    ESP_LOGW(TAG, "%s", out_result->message);
    return false;
}

esp_err_t device_command_execute_json(
    const char *command_id,
    const cJSON *actions,
    int expected_control_revision,
    dx_device_command_result_t *out_result
)
{
    if (command_id == NULL || actions == NULL || out_result == NULL ||
        !cJSON_IsArray(actions) || cJSON_GetArraySize(actions) == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_result, 0, sizeof(*out_result));
    out_result->status = "success";
    int action_count = cJSON_GetArraySize(actions);
    if (action_count != 1) {
        out_result->status = "rejected";
        snprintf(
            out_result->error_code,
            sizeof(out_result->error_code),
            "MULTI_ACTION_NOT_SUPPORTED"
        );
        snprintf(
            out_result->message,
            sizeof(out_result->message),
            "当前固件要求每个commandId只包含一个动作"
        );
        return ESP_OK;
    }
    load_last_command();
    if (was_recently_executed(command_id)) {
        out_result->duplicate = true;
        strcpy(out_result->mcu_frame, "DUPLICATE");
        strcpy(out_result->execution_path, "DEDUPLICATED");
        ESP_LOGW(TAG, "Duplicate command ignored: %s", command_id);
        return ESP_OK;
    }

    for (int index = 0; index < action_count; index++) {
        dx_cloud_action_t action;
        if (!parse_action(cJSON_GetArrayItem(actions, index), &action)) {
            out_result->status = "failed";
            break;
        }

        if (sample_uart_monitor_is_control_ready()) {
            uint8_t frame[DX_STM32_FRAME_SIZE] = {0};
            esp_err_t err = sample_uart_monitor_execute_action(
                action.code,
                action.value,
                action.target_temperature,
                action.duration_minutes,
                expected_control_revision,
                frame
            );
            if (frame[0] != 0U) {
                frame_to_hex(frame, out_result->mcu_frame);
            }
            strcpy(out_result->execution_path, "STM32_UART_VERIFIED_ACK");
            if (err != ESP_OK) {
                if (err == ESP_ERR_INVALID_STATE && expected_control_revision >= 0) {
                    out_result->status = "rejected";
                    strcpy(out_result->error_code, "STALE_STM32_REVISION");
                    strcpy(out_result->message, "本地控制已改变设备状态，旧在线指令已拒绝");
                } else if (err == ESP_ERR_NOT_SUPPORTED || err == ESP_ERR_INVALID_ARG) {
                    out_result->status = "rejected";
                    snprintf(
                        out_result->error_code,
                        sizeof(out_result->error_code),
                        "%s",
                        err == ESP_ERR_NOT_SUPPORTED
                            ? "STM32_STAGE_LOCKED_OR_UNSUPPORTED"
                            : "INVALID_STM32_ACTION"
                    );
                    snprintf(
                        out_result->message,
                        sizeof(out_result->message),
                        "%s",
                        err == ESP_ERR_NOT_SUPPORTED
                            ? "当前固件控制阶段未开放该动作，或样机协议不支持"
                            : "动作参数无法映射到STM32协议"
                    );
                } else if (err == ESP_ERR_TIMEOUT) {
                    out_result->status = "timeout";
                    strcpy(out_result->error_code, "STM32_ACK_TIMEOUT");
                    strcpy(out_result->message, "命令已发送，但2秒内未收到STM32匹配回执");
                } else if (err == ESP_ERR_INVALID_RESPONSE) {
                    out_result->status = "failed";
                    strcpy(out_result->error_code, "STM32_STATE_MISMATCH");
                    strcpy(out_result->message, "STM32已回传，但实际状态与命令不一致");
                } else {
                    out_result->status = "failed";
                    strcpy(out_result->error_code, "STM32_UART_WRITE_FAILED");
                    snprintf(
                        out_result->message,
                        sizeof(out_result->message),
                        "%s",
                        esp_err_to_name(err)
                    );
                }
                break;
            }
            strcpy(out_result->message, "STM32匹配回执已确认");
        } else if (uart_bridge_is_ready()) {
            uint8_t frame[DX_MCU_FRAME_SIZE];
            esp_err_t err = uart_bridge_send_action_with_frame(&action, frame);
            if (err != ESP_OK) {
                out_result->status = "failed";
                break;
            }
            frame_to_hex(frame, out_result->mcu_frame);
            strcpy(out_result->execution_path, "LEGACY_MCU_UART");
        } else {
            dx_control_result_t control_result;
            esp_err_t err = command_queue_execute_sync(
                DX_COMMAND_SOURCE_MQTT,
                command_id,
                &action,
                &control_result
            );
            if (err != ESP_OK) {
                out_result->status = "failed";
                snprintf(
                    out_result->error_code,
                    sizeof(out_result->error_code),
                    "COMMAND_QUEUE_ERROR"
                );
                snprintf(
                    out_result->message,
                    sizeof(out_result->message),
                    "%s",
                    esp_err_to_name(err)
                );
                break;
            }
            snprintf(
                out_result->execution_path,
                sizeof(out_result->execution_path),
                "%s",
                control_result.execution_path
            );
            snprintf(
                out_result->error_code,
                sizeof(out_result->error_code),
                "%s",
                control_result.code
            );
            snprintf(
                out_result->message,
                sizeof(out_result->message),
                "%s",
                control_result.message
            );
            if (control_result.status == DX_CONTROL_REJECTED) {
                out_result->status = "rejected";
                break;
            }
            if (control_result.status == DX_CONTROL_FAILED) {
                out_result->status = "failed";
                break;
            }
        }
    }

    /* Failed UART transactions remain retryable after a transient MCU/network issue. */
    if (strcmp(out_result->status, "success") == 0) {
        remember_command(command_id);
    }
    ESP_LOGI(TAG, "Command %s -> %s (%d action(s))", command_id, out_result->status, action_count);
    return ESP_OK;
}

static bool parse_action(const cJSON *json, dx_cloud_action_t *action)
{
    if (json == NULL || action == NULL) {
        return false;
    }

    const cJSON *code = cJSON_GetObjectItemCaseSensitive(json, "code");
    const cJSON *value = cJSON_GetObjectItemCaseSensitive(json, "value");
    if (!cJSON_IsString(code) || !cJSON_IsString(value) ||
        code->valuestring == NULL || value->valuestring == NULL) {
        return false;
    }

    action->code = code->valuestring;
    action->value = value->valuestring;
    action->target_temperature = -1;
    action->duration_minutes = -1;

    const cJSON *target_temperature =
        cJSON_GetObjectItemCaseSensitive(json, "targetTemperature");
    if (cJSON_IsNumber(target_temperature)) {
        action->target_temperature = target_temperature->valueint;
    }
    const cJSON *duration_minutes =
        cJSON_GetObjectItemCaseSensitive(json, "durationMinutes");
    if (cJSON_IsNumber(duration_minutes)) {
        action->duration_minutes = duration_minutes->valueint;
    }
    return true;
}

static void frame_to_hex(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    char out_hex[DX_MCU_FRAME_SIZE * 2 + 1]
)
{
    for (size_t index = 0; index < DX_MCU_FRAME_SIZE; index++) {
        snprintf(&out_hex[index * 2], 3, "%02X", frame[index]);
    }
    out_hex[DX_MCU_FRAME_SIZE * 2] = '\0';
}

static bool was_recently_executed(const char *command_id)
{
    for (size_t index = 0; index < RECENT_COMMAND_COUNT; index++) {
        if (strncmp(s_recent_command_ids[index], command_id, COMMAND_ID_SIZE) == 0) {
            return true;
        }
    }
    return false;
}

static void remember_command(const char *command_id)
{
    snprintf(
        s_recent_command_ids[s_recent_command_index],
        COMMAND_ID_SIZE,
        "%s",
        command_id
    );
    s_recent_command_index = (s_recent_command_index + 1) % RECENT_COMMAND_COUNT;

    nvs_handle_t handle;
    esp_err_t err = nvs_open("dx_command", NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Could not open command NVS: %s", esp_err_to_name(err));
        return;
    }
    err = nvs_set_str(handle, "last_id", command_id);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Could not persist command id: %s", esp_err_to_name(err));
    }
}

static void load_last_command(void)
{
    if (s_recent_commands_loaded) {
        return;
    }
    s_recent_commands_loaded = true;

    nvs_handle_t handle;
    esp_err_t err = nvs_open("dx_command", NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return;
    }
    size_t length = COMMAND_ID_SIZE;
    err = nvs_get_str(handle, "last_id", s_recent_command_ids[0], &length);
    nvs_close(handle);
    if (err == ESP_OK && s_recent_command_ids[0][0] != '\0') {
        s_recent_command_index = 1;
        ESP_LOGI(TAG, "Loaded last executed command id from NVS");
    }
}
