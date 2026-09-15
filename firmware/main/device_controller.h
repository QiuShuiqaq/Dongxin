#ifndef DX_DEVICE_CONTROLLER_H
#define DX_DEVICE_CONTROLLER_H

#include "esp_err.h"
#include "uart_bridge.h"

typedef enum {
    DX_CONTROL_APPLIED = 0,
    DX_CONTROL_REJECTED,
    DX_CONTROL_FAILED,
} dx_control_status_t;

typedef struct {
    dx_control_status_t status;
    char code[40];
    char message[120];
    char execution_path[32];
} dx_control_result_t;

esp_err_t device_controller_init(void);
esp_err_t device_controller_execute(
    const dx_cloud_action_t *action,
    dx_control_result_t *out_result
);
esp_err_t device_controller_emergency_stop(const char *fault_code);

#endif
