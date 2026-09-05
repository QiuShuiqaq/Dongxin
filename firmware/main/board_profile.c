#include "app_config.h"
#include "board_profile.h"

#if CONFIG_IDF_TARGET_ESP32C3 && DX_TARGET_BOARD != DX_BOARD_C3
#error "ESP-IDF target is ESP32-C3 but DX_TARGET_BOARD is not DX_BOARD_C3"
#endif

#if CONFIG_IDF_TARGET_ESP32S3 && DX_TARGET_BOARD != DX_BOARD_S3
#error "ESP-IDF target is ESP32-S3 but DX_TARGET_BOARD is not DX_BOARD_S3"
#endif

#if DX_TARGET_BOARD == DX_BOARD_S3
#include "../boards/board_s3_audio_lcd.h"

static const dx_board_profile_t s_board_profile = {
    .name = BOARD_NAME,
    .chip = BOARD_CHIP,
    .has_audio = true,
    .has_display = true,
    .has_touch = true,
    .has_io_expander = true,
    .has_psram = true,
    .has_sensors = true,
};
#else
static const dx_board_profile_t s_board_profile = {
    .name = "ESP32-C3 SuperMini",
    .chip = "ESP32-C3",
    .has_audio = false,
    .has_display = false,
    .has_touch = false,
    .has_io_expander = false,
    .has_psram = false,
    .has_sensors = false,
};
#endif

const dx_board_profile_t *dx_board_profile_get(void)
{
    return &s_board_profile;
}
