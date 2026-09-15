#ifndef DX_BOARD_PROFILE_H
#define DX_BOARD_PROFILE_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    const char *name;
    const char *chip;
    const char *control_backend;
    const char *voice_control_link;
    const char *voice_audio_link;
    const char *local_controller_link;
    bool has_audio;
    bool has_display;
    bool has_touch;
    bool has_io_expander;
    bool has_psram;
    bool has_sensors;
    uint8_t io_expander_count;
} dx_board_profile_t;

const dx_board_profile_t *dx_board_profile_get(void);

#endif
