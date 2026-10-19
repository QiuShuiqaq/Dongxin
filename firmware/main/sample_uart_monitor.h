#ifndef SAMPLE_UART_MONITOR_H
#define SAMPLE_UART_MONITOR_H

#include "esp_err.h"

/* Starts the receive-only monitor for the existing Dongxin STM32 sample. */
esp_err_t sample_uart_monitor_init(void);

#endif // SAMPLE_UART_MONITOR_H
