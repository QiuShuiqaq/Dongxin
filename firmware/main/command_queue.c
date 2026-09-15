#include "command_queue.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "app_config.h"

static const char *TAG = "COMMAND_QUEUE";
static QueueHandle_t s_queue;

typedef struct {
    dx_command_source_t source;
    char command_id[64];
    char code[24];
    char value[24];
    int target_temperature;
    int duration_minutes;
    SemaphoreHandle_t completion;
    dx_control_result_t *result;
} dx_queued_command_t;

static void worker_task(void *arg);
static const char *source_name(dx_command_source_t source);

esp_err_t command_queue_init(void)
{
    if (s_queue != NULL) {
        return ESP_OK;
    }
    s_queue = xQueueCreate(DX_COMMAND_QUEUE_DEPTH, sizeof(dx_queued_command_t));
    if (s_queue == NULL) {
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(worker_task, "command_worker", 5120, NULL, 7, NULL) != pdPASS) {
        vQueueDelete(s_queue);
        s_queue = NULL;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "Unified command queue ready, depth=%d", DX_COMMAND_QUEUE_DEPTH);
    return ESP_OK;
}

esp_err_t command_queue_execute_sync(
    dx_command_source_t source,
    const char *command_id,
    const dx_cloud_action_t *action,
    dx_control_result_t *out_result
)
{
    if (s_queue == NULL || command_id == NULL || action == NULL ||
        action->code == NULL || action->value == NULL || out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    SemaphoreHandle_t completion = xSemaphoreCreateBinary();
    if (completion == NULL) {
        return ESP_ERR_NO_MEM;
    }
    dx_queued_command_t queued = {
        .source = source,
        .target_temperature = action->target_temperature,
        .duration_minutes = action->duration_minutes,
        .completion = completion,
        .result = out_result,
    };
    snprintf(queued.command_id, sizeof(queued.command_id), "%s", command_id);
    snprintf(queued.code, sizeof(queued.code), "%s", action->code);
    snprintf(queued.value, sizeof(queued.value), "%s", action->value);

    BaseType_t sent = source == DX_COMMAND_SOURCE_SAFETY
        ? xQueueSendToFront(s_queue, &queued, pdMS_TO_TICKS(1000))
        : xQueueSend(s_queue, &queued, pdMS_TO_TICKS(1000));
    if (sent != pdTRUE) {
        vSemaphoreDelete(completion);
        return ESP_ERR_TIMEOUT;
    }
    xSemaphoreTake(completion, portMAX_DELAY);
    vSemaphoreDelete(completion);
    return ESP_OK;
}

static void worker_task(void *arg)
{
    (void)arg;
    while (true) {
        dx_queued_command_t queued;
        if (xQueueReceive(s_queue, &queued, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        dx_cloud_action_t action = {
            .code = queued.code,
            .value = queued.value,
            .target_temperature = queued.target_temperature,
            .duration_minutes = queued.duration_minutes,
        };
        esp_err_t err = device_controller_execute(&action, queued.result);
        if (err != ESP_OK && queued.result->code[0] == '\0') {
            queued.result->status = DX_CONTROL_FAILED;
            snprintf(queued.result->code, sizeof(queued.result->code), "CONTROL_ERROR");
            snprintf(
                queued.result->message,
                sizeof(queued.result->message),
                "控制器执行失败: %s",
                esp_err_to_name(err)
            );
        }
        ESP_LOGI(
            TAG,
            "command=%s source=%s action=%s:%s result=%s",
            queued.command_id,
            source_name(queued.source),
            queued.code,
            queued.value,
            queued.result->code
        );
        xSemaphoreGive(queued.completion);
    }
}

static const char *source_name(dx_command_source_t source)
{
    switch (source) {
        case DX_COMMAND_SOURCE_SAFETY: return "SAFETY";
        case DX_COMMAND_SOURCE_BLE_PANEL: return "BLE_PANEL";
        case DX_COMMAND_SOURCE_BLE_REMOTE: return "BLE_REMOTE";
        case DX_COMMAND_SOURCE_CI1302_OFFLINE: return "CI1302_OFFLINE";
        case DX_COMMAND_SOURCE_MQTT: return "MQTT";
        case DX_COMMAND_SOURCE_ONLINE_AI: return "ONLINE_AI";
        case DX_COMMAND_SOURCE_TIMER: return "TIMER";
        default: return "UNKNOWN";
    }
}
