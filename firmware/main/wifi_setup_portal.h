#ifndef DX_WIFI_SETUP_PORTAL_H
#define DX_WIFI_SETUP_PORTAL_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_wifi.h"

typedef esp_err_t (*dx_wifi_setup_submit_cb_t)(const char *ssid, const char *password);
typedef esp_err_t (*dx_wifi_setup_radio_start_cb_t)(wifi_config_t *config);
typedef esp_err_t (*dx_wifi_setup_radio_stop_cb_t)(void);

typedef enum {
    DX_WIFI_SETUP_IDLE = 0,
    DX_WIFI_SETUP_CONNECTING,
    DX_WIFI_SETUP_CONNECTED,
    DX_WIFI_SETUP_FAILED,
} dx_wifi_setup_state_t;

esp_err_t wifi_setup_portal_init(dx_wifi_setup_radio_start_cb_t start,
                                 dx_wifi_setup_radio_stop_cb_t stop);
esp_err_t wifi_setup_portal_start(const char *setup_password, dx_wifi_setup_submit_cb_t submit);
void wifi_setup_portal_stop(void);
bool wifi_setup_portal_is_active(void);
void wifi_setup_portal_set_state(dx_wifi_setup_state_t state);
void wifi_setup_portal_close_after(uint32_t delay_ms);

#endif
