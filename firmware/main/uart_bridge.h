#ifndef UART_BRIDGE_H
#define UART_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "device_state.h"

#define DX_MCU_FRAME_SIZE 32

typedef enum {
    DX_MCU_MESSAGE_ACK = 0,
    DX_MCU_MESSAGE_STATE = 1
} dx_mcu_message_type_t;

typedef struct {
    dx_mcu_message_type_t type;
    uint8_t sequence;
    uint8_t original_command;
    uint8_t result_code;
    dx_device_state_t state;
} dx_mcu_message_t;

typedef struct {
    const char *code;
    const char *value;
    int target_temperature;
    int duration_minutes;
} dx_cloud_action_t;

void uart_bridge_init(void);
bool uart_bridge_is_ready(void);
esp_err_t uart_bridge_run_self_test(void);
esp_err_t uart_bridge_build_frame(
    const dx_cloud_action_t *action,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
);
esp_err_t uart_bridge_build_frame_with_sequence(
    const dx_cloud_action_t *action,
    uint8_t sequence,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
);
bool uart_bridge_validate_frame(const uint8_t frame[DX_MCU_FRAME_SIZE]);
esp_err_t uart_bridge_parse_mcu_frame(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    dx_mcu_message_t *out_message
);
esp_err_t uart_bridge_send_action(const dx_cloud_action_t *action);
esp_err_t uart_bridge_send_action_with_frame(
    const dx_cloud_action_t *action,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
);
esp_err_t uart_bridge_request_state(void);

#endif // UART_BRIDGE_H
