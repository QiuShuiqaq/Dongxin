#ifndef DX_STM32_PROTOCOL_H
#define DX_STM32_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define DX_STM32_FRAME_SIZE 32U
#define DX_STM32_PRODUCT_TYPE 0x07U
#define DX_STM32_CI_EVENT_COMMAND 0xD0U

typedef enum {
    DX_STM32_CI_EVENT_NONE = 0,
    DX_STM32_CI_EVENT_WAKE = 1,
    DX_STM32_CI_EVENT_LOCAL_APPLIED = 2,
} dx_stm32_ci_event_t;

typedef enum {
    DX_STM32_COMMAND_STATUS = 0x00,
    DX_STM32_COMMAND_LIGHT = 0x01,
    DX_STM32_COMMAND_VENTILATION = 0x02,
    DX_STM32_COMMAND_FAN = 0x03,
    DX_STM32_COMMAND_HEATER = 0x04,
    DX_STM32_COMMAND_SWING = 0x05,
    DX_STM32_COMMAND_DRY = 0x06,
    DX_STM32_COMMAND_INDICATOR = 0x07,
    DX_STM32_COMMAND_BEEPER = 0x08,
    DX_STM32_COMMAND_TIMER = 0x09,
    DX_STM32_COMMAND_RESET_NETWORK = 0x0A,
    DX_STM32_COMMAND_MODE = 0x0B,
    DX_STM32_COMMAND_NETWORK_ENABLE = 0x0C,
    DX_STM32_COMMAND_POWER_OFF = 0x0F,
    DX_STM32_COMMAND_NETWORK_STATUS = 0xA3,
} dx_stm32_command_t;

typedef struct {
    uint8_t command;
    uint8_t value;
    uint8_t temperature_celsius;
    uint8_t model_code;
    uint8_t remaining_minutes;
    uint8_t raw_status;
    uint8_t raw_extended_status;
    bool light;
    bool ventilation;
    bool fan;
    bool heater_weak;
    bool heater_strong;
    bool swing;
    bool dry;
    bool mode_active;
    bool network_control_enabled;
    uint8_t ci_event_type;
    uint8_t ci_semantic_id;
    uint8_t ci_event_sequence;
    uint8_t control_revision;
} dx_stm32_status_t;

typedef struct {
    uint8_t command;
    uint8_t value;
    uint8_t beep_count;
    bool network_online;
} dx_stm32_command_request_t;

typedef struct {
    uint8_t buffer[DX_STM32_FRAME_SIZE];
    size_t length;
    uint32_t rejected_frames;
    uint32_t discarded_bytes;
} dx_stm32_stream_parser_t;

typedef enum {
    DX_STM32_FEED_INCOMPLETE = 0,
    DX_STM32_FEED_FRAME_READY,
    DX_STM32_FEED_FRAME_REJECTED,
} dx_stm32_feed_result_t;

uint8_t dx_stm32_frame_checksum(const uint8_t frame[DX_STM32_FRAME_SIZE]);
bool dx_stm32_validate_status_frame(const uint8_t *frame, size_t length);
bool dx_stm32_decode_status_frame(
    const uint8_t *frame,
    size_t length,
    dx_stm32_status_t *out_status
);
bool dx_stm32_command_value_is_valid(const dx_stm32_command_request_t *request);
bool dx_stm32_build_command_frame(
    const dx_stm32_command_request_t *request,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
);
void dx_stm32_stream_parser_init(dx_stm32_stream_parser_t *parser);
dx_stm32_feed_result_t dx_stm32_stream_parser_feed(
    dx_stm32_stream_parser_t *parser,
    uint8_t byte,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
);

#endif // DX_STM32_PROTOCOL_H
