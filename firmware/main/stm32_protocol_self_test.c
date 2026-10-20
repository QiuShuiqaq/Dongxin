#include "stm32_protocol_self_test.h"

#include <string.h>

#include "stm32_protocol.h"

bool dx_stm32_protocol_self_test(void)
{
    static const uint8_t captured_status_frame[DX_STM32_FRAME_SIZE] = {
        0x02, 0xCA, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x1E, 0x01, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x1A, 0x0B, 0x04,
    };

    dx_stm32_status_t status;
    if (!dx_stm32_decode_status_frame(
            captured_status_frame,
            sizeof(captured_status_frame),
            &status
        ) ||
        status.command != DX_STM32_COMMAND_STATUS ||
        status.temperature_celsius != 30U ||
        status.raw_status != 0U ||
        !status.network_control_enabled ||
        status.mode_active) {
        return false;
    }

    uint8_t damaged_frame[DX_STM32_FRAME_SIZE];
    memcpy(damaged_frame, captured_status_frame, sizeof(damaged_frame));
    damaged_frame[10] ^= 0x01U;
    if (dx_stm32_validate_status_frame(damaged_frame, sizeof(damaged_frame))) {
        return false;
    }

    const dx_stm32_command_request_t light_on = {
        .command = DX_STM32_COMMAND_LIGHT,
        .value = 1,
    };
    uint8_t command_frame[DX_STM32_FRAME_SIZE];
    if (!dx_stm32_build_command_frame(&light_on, command_frame) ||
        command_frame[0] != 0x02U || command_frame[1] != 0xCFU ||
        command_frame[3] != DX_STM32_COMMAND_LIGHT || command_frame[4] != 1U ||
        command_frame[29] != 0x07U || command_frame[30] != 0x0FU ||
        command_frame[31] != 0x04U) {
        return false;
    }

    dx_stm32_stream_parser_t parser;
    dx_stm32_stream_parser_init(&parser);
    uint8_t parsed_frame[DX_STM32_FRAME_SIZE];
    const uint8_t noise[] = {0x55, 0x02, 0x11, 0x7E};
    for (size_t index = 0; index < sizeof(noise); index++) {
        if (dx_stm32_stream_parser_feed(&parser, noise[index], parsed_frame) ==
            DX_STM32_FEED_FRAME_READY) {
            return false;
        }
    }
    for (size_t index = 0; index < sizeof(captured_status_frame); index++) {
        dx_stm32_feed_result_t result = dx_stm32_stream_parser_feed(
            &parser,
            captured_status_frame[index],
            parsed_frame
        );
        if (index + 1U < sizeof(captured_status_frame) &&
            result == DX_STM32_FEED_FRAME_READY) {
            return false;
        }
        if (index + 1U == sizeof(captured_status_frame) &&
            result != DX_STM32_FEED_FRAME_READY) {
            return false;
        }
    }
    if (memcmp(parsed_frame, captured_status_frame, sizeof(parsed_frame)) != 0) {
        return false;
    }

    uint8_t boundary_frame[DX_STM32_FRAME_SIZE];
    memset(boundary_frame, 0x55, sizeof(boundary_frame));
    boundary_frame[0] = 0x02U;
    boundary_frame[1] = 0xCAU;
    boundary_frame[DX_STM32_FRAME_SIZE - 1U] = 0x02U;
    for (size_t index = 0; index < sizeof(boundary_frame); index++) {
        (void)dx_stm32_stream_parser_feed(&parser, boundary_frame[index], parsed_frame);
    }
    if (parser.length != 1U) {
        return false;
    }
    for (size_t index = 1; index < sizeof(captured_status_frame); index++) {
        dx_stm32_feed_result_t result = dx_stm32_stream_parser_feed(
            &parser,
            captured_status_frame[index],
            parsed_frame
        );
        if (index + 1U == sizeof(captured_status_frame) &&
            result != DX_STM32_FEED_FRAME_READY) {
            return false;
        }
    }
    return memcmp(parsed_frame, captured_status_frame, sizeof(parsed_frame)) == 0;
}
