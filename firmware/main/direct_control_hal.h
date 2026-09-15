#ifndef DX_DIRECT_CONTROL_HAL_H
#define DX_DIRECT_CONTROL_HAL_H

#include <stdbool.h>

#include "device_state.h"
#include "esp_err.h"

esp_err_t direct_control_hal_init(void);
esp_err_t direct_control_hal_apply(const dx_device_state_t *state);
esp_err_t direct_control_hal_emergency_shutdown(void);
esp_err_t direct_control_hal_health_check(void);
bool direct_control_hal_is_virtual(void);
const char *direct_control_hal_execution_path(void);

#endif
