#ifndef UART_BRIDGE_H
#define UART_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#define DX_MCU_FRAME_SIZE 32

typedef struct {
    const char *code;
    const char *value;
    int target_temperature;
    int duration_minutes;
} dx_cloud_action_t;

void uart_bridge_init(void);
bool uart_bridge_is_ready(void);
esp_err_t uart_bridge_build_frame(
    const dx_cloud_action_t *action,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
);
bool uart_bridge_validate_frame(const uint8_t frame[DX_MCU_FRAME_SIZE]);
esp_err_t uart_bridge_send_action(const dx_cloud_action_t *action);

#endif // UART_BRIDGE_H
