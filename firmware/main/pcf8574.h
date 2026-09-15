#ifndef DX_PCF8574_H
#define DX_PCF8574_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "driver/i2c.h"
#include "esp_err.h"

#define DX_PCF8574_MAX_DEVICES 3

typedef struct {
    i2c_port_t port;
    int sda_gpio;
    int scl_gpio;
    uint32_t frequency_hz;
    uint8_t addresses[DX_PCF8574_MAX_DEVICES];
    size_t device_count;
    bool enable_internal_pullups;
} dx_pcf8574_config_t;

esp_err_t dx_pcf8574_init(const dx_pcf8574_config_t *config);
bool dx_pcf8574_is_ready(void);
esp_err_t dx_pcf8574_write(size_t device_index, uint8_t value);
esp_err_t dx_pcf8574_read(size_t device_index, uint8_t *out_value);
esp_err_t dx_pcf8574_all_off(void);
esp_err_t dx_pcf8574_health_check(void);

#endif
