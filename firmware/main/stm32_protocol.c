#include "stm32_protocol.h"

#include <string.h>

#define STM32_STATUS_HEADER_0 0x02U
#define STM32_STATUS_HEADER_1 0xCAU
#define STM32_STATUS_TAIL_0 0x0BU
#define STM32_STATUS_TAIL_1 0x04U

#define STM32_COMMAND_HEADER_0 0x02U
#define STM32_COMMAND_HEADER_1 0xCFU
#define STM32_COMMAND_TAIL_0 0x0FU
#define STM32_COMMAND_TAIL_1 0x04U

enum {
    FRAME_PRODUCT_TYPE = 2,
    FRAME_COMMAND = 3,
    FRAME_VALUE = 4,
    FRAME_BEEP_COUNT = 5,
    FRAME_TEMPERATURE = 8,
    FRAME_MODEL_CODE = 9,
    FRAME_STATUS = 10,
    FRAME_REMAINING_MINUTES = 11,
    FRAME_EXTENDED_STATUS = 12,
    FRAME_NETWORK_STATUS = 28,
    FRAME_CHECKSUM = 29,
    FRAME_TAIL_0 = 30,
    FRAME_TAIL_1 = 31,
};

static bool is_binary(uint8_t value)
{
    return value <= 1U;
}

uint8_t dx_stm32_frame_checksum(const uint8_t frame[DX_STM32_FRAME_SIZE])
{
    uint8_t checksum = 0;
    if (frame == NULL) {
        return 0;
    }
    for (size_t index = FRAME_PRODUCT_TYPE; index < FRAME_CHECKSUM; index++) {
        checksum ^= frame[index];
    }
    return checksum;
}

bool dx_stm32_validate_status_frame(const uint8_t *frame, size_t length)
{
    return frame != NULL && length == DX_STM32_FRAME_SIZE &&
        frame[0] == STM32_STATUS_HEADER_0 &&
        frame[1] == STM32_STATUS_HEADER_1 &&
        frame[FRAME_PRODUCT_TYPE] == DX_STM32_PRODUCT_TYPE &&
        frame[FRAME_TAIL_0] == STM32_STATUS_TAIL_0 &&
        frame[FRAME_TAIL_1] == STM32_STATUS_TAIL_1 &&
        dx_stm32_frame_checksum(frame) == frame[FRAME_CHECKSUM];
}

bool dx_stm32_decode_status_frame(
    const uint8_t *frame,
    size_t length,
    dx_stm32_status_t *out_status
)
{
    if (out_status == NULL || !dx_stm32_validate_status_frame(frame, length)) {
        return false;
    }

    const uint8_t status = frame[FRAME_STATUS];
    const uint8_t extended_status = frame[FRAME_EXTENDED_STATUS];
    memset(out_status, 0, sizeof(*out_status));
    out_status->command = frame[FRAME_COMMAND];
    out_status->value = frame[FRAME_VALUE];
    out_status->temperature_celsius = frame[FRAME_TEMPERATURE];
    out_status->model_code = frame[FRAME_MODEL_CODE];
    out_status->remaining_minutes = frame[FRAME_REMAINING_MINUTES];
    out_status->raw_status = status;
    out_status->raw_extended_status = extended_status;
    out_status->light = (status & 0x01U) != 0;
    out_status->ventilation = (status & 0x02U) != 0;
    out_status->fan = (status & 0x04U) != 0;
    out_status->heater_weak = (status & 0x08U) != 0;
    out_status->heater_strong = (status & 0x10U) != 0;
    out_status->swing = (status & 0x20U) != 0;
    out_status->dry = (status & 0x40U) != 0;
    out_status->mode_active = (extended_status & 0x01U) != 0;
    out_status->network_control_enabled = (extended_status & 0x02U) != 0;
    out_status->control_revision = frame[17];
    if (frame[FRAME_COMMAND] == DX_STM32_CI_EVENT_COMMAND && frame[13] == 0xC1U &&
        (frame[14] == DX_STM32_CI_EVENT_WAKE || frame[14] == DX_STM32_CI_EVENT_LOCAL_APPLIED) &&
        (frame[15] == 1U || frame[15] == 2U || frame[15] == 3U ||
         frame[15] == 8U || frame[15] == 9U || frame[15] == 10U || frame[15] == 11U)) {
        out_status->ci_event_type = frame[14];
        out_status->ci_semantic_id = frame[15];
        out_status->ci_event_sequence = frame[16];
    }
    return true;
}

bool dx_stm32_command_value_is_valid(const dx_stm32_command_request_t *request)
{
    if (request == NULL) {
        return false;
    }

    switch (request->command) {
        case DX_STM32_COMMAND_STATUS:
        case DX_STM32_COMMAND_POWER_OFF:
        case DX_STM32_COMMAND_NETWORK_STATUS:
            return request->value == 0;
        case DX_STM32_COMMAND_LIGHT:
        case DX_STM32_COMMAND_VENTILATION:
        case DX_STM32_COMMAND_FAN:
        case DX_STM32_COMMAND_SWING:
        case DX_STM32_COMMAND_MODE:
        case DX_STM32_COMMAND_NETWORK_ENABLE:
            return is_binary(request->value);
        case DX_STM32_COMMAND_HEATER:
            return request->value <= 2U;
        case DX_STM32_COMMAND_DRY:
            return request->value <= 2U;
        case DX_STM32_COMMAND_INDICATOR:
            return request->value <= 3U;
        case DX_STM32_COMMAND_BEEPER:
            return (request->value == 1U || request->value == 2U) &&
                request->beep_count > 0U;
        case DX_STM32_COMMAND_TIMER:
            return request->value <= 120U;
        case DX_STM32_COMMAND_RESET_NETWORK:
            return request->value == 0x0AU;
        default:
            return false;
    }
}

bool dx_stm32_build_command_frame(
    const dx_stm32_command_request_t *request,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
)
{
    if (out_frame == NULL || !dx_stm32_command_value_is_valid(request)) {
        return false;
    }

    memset(out_frame, 0, DX_STM32_FRAME_SIZE);
    out_frame[0] = STM32_COMMAND_HEADER_0;
    out_frame[1] = STM32_COMMAND_HEADER_1;
    out_frame[FRAME_PRODUCT_TYPE] = DX_STM32_PRODUCT_TYPE;
    out_frame[FRAME_COMMAND] = request->command;
    out_frame[FRAME_VALUE] = request->value;
    out_frame[FRAME_BEEP_COUNT] = request->beep_count;
    if (request->command == DX_STM32_COMMAND_NETWORK_STATUS) {
        out_frame[FRAME_NETWORK_STATUS] = request->network_online ? 1U : 0U;
    }
    out_frame[FRAME_CHECKSUM] = dx_stm32_frame_checksum(out_frame);
    out_frame[FRAME_TAIL_0] = STM32_COMMAND_TAIL_0;
    out_frame[FRAME_TAIL_1] = STM32_COMMAND_TAIL_1;
    return true;
}

void dx_stm32_stream_parser_init(dx_stm32_stream_parser_t *parser)
{
    if (parser != NULL) {
        memset(parser, 0, sizeof(*parser));
    }
}

dx_stm32_feed_result_t dx_stm32_stream_parser_feed(
    dx_stm32_stream_parser_t *parser,
    uint8_t byte,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
)
{
    if (parser == NULL || out_frame == NULL) {
        return DX_STM32_FEED_FRAME_REJECTED;
    }

    if (parser->length == 0U) {
        if (byte != STM32_STATUS_HEADER_0) {
            parser->discarded_bytes++;
            return DX_STM32_FEED_INCOMPLETE;
        }
        parser->buffer[parser->length++] = byte;
        return DX_STM32_FEED_INCOMPLETE;
    }

    if (parser->length == 1U && byte != STM32_STATUS_HEADER_1) {
        if (byte == STM32_STATUS_HEADER_0) {
            parser->buffer[0] = byte;
            parser->discarded_bytes++;
        } else {
            parser->length = 0;
            parser->discarded_bytes += 2U;
        }
        return DX_STM32_FEED_INCOMPLETE;
    }

    parser->buffer[parser->length++] = byte;
    if (parser->length < DX_STM32_FRAME_SIZE) {
        return DX_STM32_FEED_INCOMPLETE;
    }

    if (dx_stm32_validate_status_frame(parser->buffer, parser->length)) {
        memcpy(out_frame, parser->buffer, DX_STM32_FRAME_SIZE);
        parser->length = 0;
        return DX_STM32_FEED_FRAME_READY;
    }

    parser->rejected_frames++;
    size_t next_header = 1U;
    while (next_header + 1U < DX_STM32_FRAME_SIZE &&
           !(parser->buffer[next_header] == STM32_STATUS_HEADER_0 &&
             parser->buffer[next_header + 1U] == STM32_STATUS_HEADER_1)) {
        next_header++;
    }
    if (next_header + 1U < DX_STM32_FRAME_SIZE) {
        parser->length = DX_STM32_FRAME_SIZE - next_header;
        memmove(parser->buffer, &parser->buffer[next_header], parser->length);
        parser->discarded_bytes += (uint32_t)next_header;
    } else if (parser->buffer[DX_STM32_FRAME_SIZE - 1U] == STM32_STATUS_HEADER_0) {
        parser->buffer[0] = STM32_STATUS_HEADER_0;
        parser->length = 1U;
        parser->discarded_bytes += DX_STM32_FRAME_SIZE - 1U;
    } else {
        parser->length = 0;
        parser->discarded_bytes += DX_STM32_FRAME_SIZE;
    }
    return DX_STM32_FEED_FRAME_REJECTED;
}
