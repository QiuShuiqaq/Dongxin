/*
 * WiFi connection management for the C3 development firmware.
 *
 * This first implementation uses a compile-time STA configuration. NVS
 * provisioning can be added after the basic device-to-server path is proven.
 */

#include <stdio.h>

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "wifi_manager.h"
#include "app_config.h"

static const char *TAG = "WIFI_MGR";

static EventGroupHandle_t s_wifi_event_group;
static esp_event_handler_instance_t s_wifi_event_instance;
static esp_event_handler_instance_t s_ip_event_instance;
static esp_netif_t *s_sta_netif;
static int s_retry_count;

static const int WIFI_CONNECTED_BIT = BIT0;
static const int WIFI_FAIL_BIT = BIT1;

static void on_wifi_event(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data
)
{
    (void)arg;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "WiFi STA started, connecting to configured network");
        esp_wifi_connect();
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_wifi_event_group != NULL) {
            xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
        if (s_retry_count < 10) {
            s_retry_count++;
            ESP_LOGW(TAG, "WiFi disconnected, retry %d/10", s_retry_count);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGE(TAG, "WiFi connection failed after 10 retries");
        }
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        s_retry_count = 0;
        xEventGroupClearBits(s_wifi_event_group, WIFI_FAIL_BIT);
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ESP_LOGI(TAG, "WiFi connected, IP address: " IPSTR, IP2STR(&event->ip_info.ip));
    }
}

void wifi_manager_init(void)
{
    if (DX_WIFI_SSID[0] == '\0') {
        ESP_LOGW(TAG, "WiFi is not configured. Set DX_WIFI_SSID in app_config.h");
        return;
    }

    s_wifi_event_group = xEventGroupCreate();
    if (s_wifi_event_group == NULL) {
        ESP_LOGE(TAG, "Failed to create WiFi event group");
        return;
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    s_sta_netif = esp_netif_create_default_wifi_sta();
    if (s_sta_netif == NULL) {
        ESP_LOGE(TAG, "Failed to create default WiFi STA interface");
        return;
    }

    wifi_init_config_t wifi_init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_init_config));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT,
        ESP_EVENT_ANY_ID,
        &on_wifi_event,
        NULL,
        &s_wifi_event_instance
    ));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT,
        IP_EVENT_STA_GOT_IP,
        &on_wifi_event,
        NULL,
        &s_ip_event_instance
    ));

    wifi_config_t wifi_config = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_OPEN,
        },
    };
    snprintf((char *)wifi_config.sta.ssid, sizeof(wifi_config.sta.ssid), "%s", DX_WIFI_SSID);
    snprintf((char *)wifi_config.sta.password, sizeof(wifi_config.sta.password), "%s", DX_WIFI_PASSWORD);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "WiFi manager initialized");
}

bool wifi_manager_is_connected(void)
{
    if (s_wifi_event_group == NULL) {
        return false;
    }

    return (xEventGroupGetBits(s_wifi_event_group) & WIFI_CONNECTED_BIT) != 0;
}

bool wifi_manager_wait_connected(int timeout_ms)
{
    if (s_wifi_event_group == NULL) {
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(timeout_ms)
    );

    return (bits & WIFI_CONNECTED_BIT) != 0;
}

esp_err_t wifi_manager_get_network_info(char *ip, size_t ip_capacity, int *rssi)
{
    if (ip == NULL || ip_capacity == 0 || rssi == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ip[0] = '\0';
    *rssi = 0;

    if (!wifi_manager_is_connected() || s_sta_netif == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    wifi_ap_record_t ap_info;
    esp_err_t err = esp_wifi_sta_get_ap_info(&ap_info);
    if (err != ESP_OK) {
        return err;
    }

    esp_netif_ip_info_t ip_info;
    err = esp_netif_get_ip_info(s_sta_netif, &ip_info);
    if (err != ESP_OK) {
        return err;
    }

    snprintf(ip, ip_capacity, IPSTR, IP2STR(&ip_info.ip));
    *rssi = ap_info.rssi;
    return ESP_OK;
}
