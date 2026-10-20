#ifndef SAMPLE_UART_MONITOR_H
#define SAMPLE_UART_MONITOR_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "stm32_protocol.h"

/* Starts the staged UART adapter for the existing Dongxin STM32 sample. */
esp_err_t sample_uart_monitor_init(void);
bool sample_uart_monitor_is_control_ready(void);
int sample_uart_monitor_control_stage(void);
esp_err_t sample_uart_monitor_execute_action(
    const char *code,
    const char *value,
    int target_temperature,
    int duration_minutes,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
);

#endif // SAMPLE_UART_MONITOR_H
