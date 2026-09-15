#ifndef DEVICE_COMMAND_H
#define DEVICE_COMMAND_H

#include <stdbool.h>

#include "cJSON.h"
#include "esp_err.h"
#include "uart_bridge.h"

typedef struct {
    const char *status;
    char mcu_frame[DX_MCU_FRAME_SIZE * 2 + 1];
    char execution_path[32];
    char error_code[40];
    char message[120];
    bool duplicate;
} dx_device_command_result_t;

esp_err_t device_command_execute_json(
    const char *command_id,
    const cJSON *actions,
    dx_device_command_result_t *out_result
);

#endif
