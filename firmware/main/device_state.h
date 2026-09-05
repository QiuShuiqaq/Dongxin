#ifndef DEVICE_STATE_H
#define DEVICE_STATE_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

typedef enum {
    DX_HEATER_OFF = 0,
    DX_HEATER_WEAK = 1,
    DX_HEATER_STRONG = 2
} dx_heater_level_t;

typedef struct {
    bool is_online;
    bool power;
    bool light;
    dx_heater_level_t heater;
    bool ventilation;
    bool fan;
    bool swing;
    bool dry;
    int16_t target_temperature;
    float ambient_temperature;
    uint8_t humidity;
    bool has_occupancy;
    char fault_code[32];
    uint32_t running_minutes;
} dx_device_state_t;

void device_state_init(void);
esp_err_t device_state_get(dx_device_state_t *out_state);
esp_err_t device_state_set_online(bool is_online);
esp_err_t device_state_update(const dx_device_state_t *next_state);

#endif
