#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

void wifi_manager_init(void);
bool wifi_manager_is_connected(void);
bool wifi_manager_wait_connected(int timeout_ms);
esp_err_t wifi_manager_get_network_info(char *ip, size_t ip_capacity, int *rssi);

#endif
