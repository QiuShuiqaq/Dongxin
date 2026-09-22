#include "app_config.h"
#include "board_profile.h"

#if CONFIG_IDF_TARGET_ESP32C3 && \
    DX_TARGET_BOARD != DX_BOARD_C3 && \
    DX_TARGET_BOARD != DX_BOARD_C3_LICHUANG_AUDIO
#error "ESP-IDF target is ESP32-C3 but DX_TARGET_BOARD is not a C3 board"
#endif

#if CONFIG_IDF_TARGET_ESP32S3 && DX_TARGET_BOARD != DX_BOARD_S3
#error "ESP-IDF target is ESP32-S3 but DX_TARGET_BOARD is not DX_BOARD_S3"
#endif

#if DX_TARGET_BOARD == DX_BOARD_S3
#include "../boards/board_s3_audio_lcd.h"

static const dx_board_profile_t s_board_profile = {
    .name = BOARD_NAME,
    .chip = BOARD_CHIP,
    .control_backend = "S3 validation HAL",
    .voice_control_link = "development board",
    .voice_audio_link = "development board I2S",
    .local_controller_link = "BLE",
    .has_audio = true,
    .has_display = true,
    .has_touch = true,
    .has_io_expander = true,
    .has_psram = true,
    .has_sensors = true,
    .io_expander_count = 1,
};
#elif DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
static const dx_board_profile_t s_board_profile = {
    .name = "Lichuang ESP32-C3 Audio Board",
    .chip = "ESP32-C3",
    .control_backend = "virtual HAL",
    .voice_control_link = "push-to-talk wake-word validation",
    .voice_audio_link = "ES8311 I2S PCM 16kHz/16bit/mono",
    .local_controller_link = "ESP32-C3 integrated BLE",
    .has_audio = true,
    .has_display = true,
    .has_touch = true,
    .has_io_expander = false,
    .has_psram = false,
    .has_sensors = true,
    .io_expander_count = 0,
};
#else
static const dx_board_profile_t s_board_profile = {
    .name = "ESP32-C3 SuperMini",
    .chip = "ESP32-C3",
    .control_backend = DX_ENABLE_PCF8574 ? "3 x PCF8574" : "virtual HAL",
    .voice_control_link = "CI1302 UART0 115200 8N1",
    .voice_audio_link = "CI1302 I2S PCM 16kHz/16bit/mono",
    .local_controller_link = "ESP32-C3 integrated BLE",
    .has_audio = false,
    .has_display = false,
    .has_touch = false,
    .has_io_expander = DX_ENABLE_PCF8574,
    .has_psram = false,
    .has_sensors = false,
    .io_expander_count = DX_ENABLE_PCF8574 ? 3 : 0,
};
#endif

const dx_board_profile_t *dx_board_profile_get(void)
{
    return &s_board_profile;
}
