#ifndef DX_COMMAND_QUEUE_H
#define DX_COMMAND_QUEUE_H

#include "device_controller.h"
#include "esp_err.h"

typedef enum {
    DX_COMMAND_SOURCE_SAFETY = 0,
    DX_COMMAND_SOURCE_BLE_PANEL,
    DX_COMMAND_SOURCE_BLE_REMOTE,
    DX_COMMAND_SOURCE_CI1302_OFFLINE,
    DX_COMMAND_SOURCE_MQTT,
    DX_COMMAND_SOURCE_ONLINE_AI,
    DX_COMMAND_SOURCE_TIMER,
} dx_command_source_t;

esp_err_t command_queue_init(void);
esp_err_t command_queue_execute_sync(
    dx_command_source_t source,
    const char *command_id,
    const dx_cloud_action_t *action,
    dx_control_result_t *out_result
);

#endif
