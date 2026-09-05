#ifndef DX_BOARD_PROFILE_H
#define DX_BOARD_PROFILE_H

#include <stdbool.h>

typedef struct {
    const char *name;
    const char *chip;
    bool has_audio;
    bool has_display;
    bool has_touch;
    bool has_io_expander;
    bool has_psram;
    bool has_sensors;
} dx_board_profile_t;

const dx_board_profile_t *dx_board_profile_get(void);

#endif
