/*
 * WiFi connection management for the C3 development firmware.
 *
 * Stored STA credentials take precedence over the single-device pilot default.
 * The setup AP is opened only when no network exists or setup is requested.
 */

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "wifi_manager.h"
#include "wifi_setup_portal.h"
#include "app_config.h"

static const char *TAG = "WIFI_MGR";

static EventGroupHandle_t s_wifi_event_group;
static esp_event_handler_instance_t s_wifi_event_instance;
static esp_event_handler_instance_t s_ip_event_instance;
static esp_netif_t *s_sta_netif;
static esp_timer_handle_t s_retry_timer;
static esp_timer_handle_t s_candidate_timer;
static SemaphoreHandle_t s_credentials_lock;
static SemaphoreHandle_t s_transition_lock;
static TaskHandle_t s_candidate_task;
static TaskHandle_t s_retry_task;
static unsigned int s_retry_count;
static volatile bool s_time_synced;
static volatile TickType_t s_last_time_sync_tick;
static bool s_wifi_started;
static bool s_radio_running;
static bool s_radio_stop_pending;
static bool s_radio_transition;
static bool s_have_active_credentials;
static bool s_candidate_pending;
static bool s_candidate_reverting;
static bool s_candidate_committed;
static bool s_candidate_transition;
static bool s_candidate_attempt_started;
static bool s_candidate_link_observed;
static int64_t s_candidate_deadline_us;

typedef struct {
    uint8_t version;
    char ssid[33];
    char password[64];
} wifi_credentials_t;

static wifi_credentials_t s_active_credentials;
static wifi_credentials_t s_candidate_credentials;

#define WIFI_CREDENTIALS_VERSION 1U
#define WIFI_CANDIDATE_TIMEOUT_MS 45000U
#define WIFI_STOP_EVENT_TIMEOUT_MS 5000U

static const int WIFI_CONNECTED_BIT = BIT0;
static const int WIFI_STA_STOPPED_BIT = BIT1;

static void schedule_reconnect(void);

static void set_radio_transition(bool transitioning)
{
    xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
    s_radio_transition = transitioning;
    xSemaphoreGive(s_credentials_lock);
}

/* Called only with s_transition_lock held.  A late STOP event must be
 * consumed before starting the driver again. */
static esp_err_t wait_for_radio_stop(void)
{
    if (!s_radio_stop_pending) return ESP_OK;
    if (!(xEventGroupWaitBits(s_wifi_event_group, WIFI_STA_STOPPED_BIT, pdTRUE, pdTRUE,
                             pdMS_TO_TICKS(WIFI_STOP_EVENT_TIMEOUT_MS)) & WIFI_STA_STOPPED_BIT)) {
        return ESP_ERR_TIMEOUT;
    }
    s_radio_stop_pending = false;
    return ESP_OK;
}

#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING
static esp_err_t stop_radio(void)
{
    esp_err_t err = wait_for_radio_stop();
    if (err != ESP_OK || !s_radio_running) return err;
    xEventGroupClearBits(s_wifi_event_group, WIFI_STA_STOPPED_BIT | WIFI_CONNECTED_BIT);
    err = esp_wifi_stop();
    if (err == ESP_ERR_WIFI_NOT_STARTED) {
        s_radio_running = false;
        s_radio_stop_pending = false;
        return ESP_OK;
    }
    if (err != ESP_OK) return err;
    s_radio_running = false;
    s_radio_stop_pending = true;
    return wait_for_radio_stop();
}
#endif

static esp_err_t start_station_radio(void)
{
    esp_err_t err = wait_for_radio_stop();
    if (err == ESP_OK) err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err == ESP_OK) err = esp_wifi_start();
    if (err == ESP_OK) s_radio_running = true;
    return err;
}

static bool credentials_valid(const wifi_credentials_t *credentials)
{
    if (credentials == NULL || credentials->version != WIFI_CREDENTIALS_VERSION) return false;
    const size_t ssid_length = strnlen(credentials->ssid, sizeof(credentials->ssid));
    const size_t password_length = strnlen(credentials->password, sizeof(credentials->password));
    return ssid_length > 0 && ssid_length <= 32 &&
        (password_length == 0 || (password_length >= 8 && password_length <= 63));
}

static bool load_stored_credentials(wifi_credentials_t *credentials)
{
    nvs_handle_t nvs;
    if (nvs_open("dx_wifi", NVS_READONLY, &nvs) != ESP_OK) return false;
    size_t length = sizeof(*credentials);
    const esp_err_t err = nvs_get_blob(nvs, "station", credentials, &length);
    nvs_close(nvs);
    return err == ESP_OK && length == sizeof(*credentials) && credentials_valid(credentials);
}

static esp_err_t save_stored_credentials(const wifi_credentials_t *credentials)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open("dx_wifi", NVS_READWRITE, &nvs);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(nvs, "station", credentials, sizeof(*credentials));
    if (err == ESP_OK) err = nvs_commit(nvs);
    nvs_close(nvs);
    return err;
}

static esp_err_t set_sta_credentials(const wifi_credentials_t *credentials)
{
    if (!credentials_valid(credentials)) return ESP_ERR_INVALID_ARG;
    wifi_config_t config = {.sta = {.threshold.authmode = WIFI_AUTH_OPEN}};
    if (credentials->password[0] != '\0') {
        config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    }
    memcpy(config.sta.ssid, credentials->ssid, strlen(credentials->ssid));
    memcpy(config.sta.password, credentials->password, strlen(credentials->password));
#if DX_WIFI_LOCK_BSSID
    const uint8_t preferred_bssid[6] = DX_WIFI_BSSID;
    config.sta.bssid_set = true;
    memcpy(config.sta.bssid, preferred_bssid, sizeof(preferred_bssid));
#endif
    return esp_wifi_set_config(WIFI_IF_STA, &config);
}

#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING
static esp_err_t start_setup_radio(wifi_config_t *config)
{
    if (config == NULL) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_transition_lock, portMAX_DELAY);
    set_radio_transition(true);
    (void)esp_timer_stop(s_retry_timer);
    esp_err_t err = stop_radio();
    if (err == ESP_OK) err = esp_wifi_set_mode(WIFI_MODE_APSTA);
    if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_AP, config);
    if (err == ESP_OK) {
        err = esp_wifi_start();
        if (err == ESP_OK) {
            s_radio_running = true;
        } else {
            // Treat a failed start as uncertain until stop confirms otherwise.
            s_radio_running = true;
            const esp_err_t stop_err = stop_radio();
            if (stop_err == ESP_ERR_WIFI_NOT_STARTED) {
                s_radio_running = false;
            } else if (stop_err != ESP_OK && stop_err != ESP_ERR_TIMEOUT) {
                ESP_LOGE(TAG, "Failed to stop WiFi after setup start error: %s", esp_err_to_name(stop_err));
            }
        }
    }
    set_radio_transition(false);
    xSemaphoreGive(s_transition_lock);
    schedule_reconnect();
    return err;
}

static esp_err_t stop_setup_radio(void)
{
    xSemaphoreTake(s_transition_lock, portMAX_DELAY);
    set_radio_transition(true);
    (void)esp_timer_stop(s_retry_timer);
    esp_err_t err = wait_for_radio_stop();
    bool ap_disabled = !s_radio_running && !s_radio_stop_pending;
    if (err == ESP_OK && s_radio_running) {
        err = esp_wifi_set_mode(WIFI_MODE_STA);
        if (err == ESP_OK) {
            ap_disabled = true;
        } else {
            ESP_LOGW(TAG, "Could not disable setup AP normally; stopping WiFi: %s", esp_err_to_name(err));
            err = stop_radio();
            ap_disabled = !s_radio_running && !s_radio_stop_pending;
        }
    }
    if (ap_disabled && !s_radio_running) {
        // A timeout here leaves the radio off; the reconnect worker will wait
        // for the old STOP event before starting the station again.
        const esp_err_t restore_err = start_station_radio();
        if (restore_err != ESP_OK) {
            ESP_LOGW(TAG, "Station recovery deferred: %s", esp_err_to_name(restore_err));
        }
    }
    set_radio_transition(false);
    xSemaphoreGive(s_transition_lock);
    schedule_reconnect();
    return ap_disabled ? ESP_OK : err;
}

static bool revert_candidate_if_pending(bool only_if_expired)
{
    wifi_credentials_t previous = {0};
    xSemaphoreTake(s_transition_lock, portMAX_DELAY);
    xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
    if (!s_candidate_pending ||
        (only_if_expired && esp_timer_get_time() < s_candidate_deadline_us)) {
        xSemaphoreGive(s_credentials_lock);
        xSemaphoreGive(s_transition_lock);
        return false;
    }
    s_candidate_pending = false;
    s_candidate_reverting = true;
    s_candidate_transition = false;
    s_candidate_attempt_started = false;
    s_candidate_link_observed = false;
    const bool have_previous = s_have_active_credentials;
    if (have_previous) previous = s_active_credentials;
    xSemaphoreGive(s_credentials_lock);
    (void)esp_timer_stop(s_candidate_timer);
    (void)esp_timer_stop(s_retry_timer);
    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    const esp_err_t disconnect_err = esp_wifi_disconnect();
    if (disconnect_err != ESP_OK) {
        ESP_LOGW(TAG, "Could not stop trial connection: %s", esp_err_to_name(disconnect_err));
    }
    wifi_mode_t mode;
    if (esp_wifi_get_mode(&mode) == ESP_OK && mode == WIFI_MODE_AP) {
        const esp_err_t mode_err = esp_wifi_set_mode(WIFI_MODE_APSTA);
        if (mode_err != ESP_OK) ESP_LOGW(TAG, "Could not restart STA: %s", esp_err_to_name(mode_err));
    }
    if (have_previous) {
        esp_err_t restore_err = set_sta_credentials(&previous);
        if (restore_err == ESP_OK) restore_err = esp_wifi_connect();
        if (restore_err != ESP_OK) {
            ESP_LOGW(TAG, "Previous WiFi restore will be retried: %s", esp_err_to_name(restore_err));
        }
    }
    xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
    s_candidate_reverting = false;
    xSemaphoreGive(s_credentials_lock);
    xSemaphoreGive(s_transition_lock);
    if (have_previous) {
        // An intentional disconnect event can arrive during the revert and be
        // suppressed; always leave a delayed retry as a recovery backstop.
        const esp_err_t retry_err = esp_timer_start_once(s_retry_timer, 10000000ULL);
        if (retry_err != ESP_OK && retry_err != ESP_ERR_INVALID_STATE) {
            ESP_LOGE(TAG, "Could not schedule previous WiFi retry: %s", esp_err_to_name(retry_err));
        }
    }
    wifi_setup_portal_set_state(DX_WIFI_SETUP_FAILED);
    return true;
}

static void candidate_timeout_task(void *arg)
{
    (void)arg;
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (revert_candidate_if_pending(true)) {
            ESP_LOGW(TAG, "New WiFi credentials did not connect within the setup window");
        }
    }
}
#endif

static void on_candidate_timeout(void *arg)
{
    (void)arg;
    if (s_candidate_task != NULL) xTaskNotifyGive(s_candidate_task);
}

#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING
static esp_err_t submit_new_credentials(const char *ssid, const char *password)
{
    wifi_credentials_t candidate = {.version = WIFI_CREDENTIALS_VERSION};
    const size_t ssid_length = strlen(ssid);
    const size_t password_length = strlen(password);
    if (ssid_length == 0 || ssid_length > 32 ||
        (password_length != 0 && (password_length < 8 || password_length > 63))) {
        return ESP_ERR_INVALID_ARG;
    }
    memcpy(candidate.ssid, ssid, ssid_length);
    memcpy(candidate.password, password, password_length);
    xSemaphoreTake(s_transition_lock, portMAX_DELAY);
    xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
    if (s_candidate_pending || s_candidate_reverting || s_candidate_committed) {
        xSemaphoreGive(s_credentials_lock);
        xSemaphoreGive(s_transition_lock);
        return ESP_ERR_INVALID_STATE;
    }
    s_candidate_credentials = candidate;
    s_candidate_pending = true;
    s_candidate_transition = true;
    s_candidate_attempt_started = false;
    s_candidate_link_observed = false;
    s_candidate_deadline_us = esp_timer_get_time() + WIFI_CANDIDATE_TIMEOUT_MS * 1000ULL;
    xSemaphoreGive(s_credentials_lock);
    wifi_setup_portal_set_state(DX_WIFI_SETUP_CONNECTING);
    (void)esp_timer_stop(s_retry_timer);
    esp_err_t err = esp_timer_start_once(s_candidate_timer, WIFI_CANDIDATE_TIMEOUT_MS * 1000ULL);
    // Stop and restart the STA interface before testing even the same SSID.
    // This separates the new authentication from queued events for the old link.
    if (err == ESP_OK) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_STA_STOPPED_BIT | WIFI_CONNECTED_BIT);
        err = esp_wifi_set_mode(WIFI_MODE_AP);
    }
    if (err == ESP_OK && !(xEventGroupWaitBits(s_wifi_event_group, WIFI_STA_STOPPED_BIT,
                                               pdTRUE, pdTRUE, pdMS_TO_TICKS(5000)) & WIFI_STA_STOPPED_BIT)) {
        err = ESP_ERR_TIMEOUT;
    }
    if (err == ESP_OK) err = esp_wifi_set_mode(WIFI_MODE_APSTA);
    if (err == ESP_OK) err = set_sta_credentials(&candidate);
    if (err == ESP_OK) {
        xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
        s_candidate_transition = false;
        s_candidate_attempt_started = true;
        xSemaphoreGive(s_credentials_lock);
    }
    if (err == ESP_OK) err = esp_wifi_connect();
    xSemaphoreGive(s_transition_lock);
    if (err != ESP_OK) {
        (void)revert_candidate_if_pending(false);
        return err;
    }
    return ESP_OK;
}
#endif

static void schedule_reconnect(void)
{
    if (s_retry_timer == NULL) return;

    xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
    const bool should_connect = !s_radio_transition && !s_candidate_reverting && !s_candidate_transition &&
        (s_have_active_credentials || s_candidate_pending);
    xSemaphoreGive(s_credentials_lock);
    if (!should_connect) return;

    const unsigned int exponent = s_retry_count < 5U ? s_retry_count : 5U;
    uint32_t delay_ms = 1000U << exponent;
    if (delay_ms > 30000U) delay_ms = 30000U;
    const esp_err_t err = esp_timer_start_once(s_retry_timer, (uint64_t)delay_ms * 1000U);
    if (err == ESP_OK) {
        if (s_retry_count < 6U) s_retry_count++;
        ESP_LOGW(TAG, "WiFi disconnected; reconnecting in %lu ms", (unsigned long)delay_ms);
    } else if (err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Could not schedule WiFi reconnect: %s", esp_err_to_name(err));
    }
}

static void retry_wifi_connection(void *arg)
{
    (void)arg;
    if (s_retry_task != NULL) xTaskNotifyGive(s_retry_task);
}

static void retry_wifi_task(void *arg)
{
    (void)arg;
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (wifi_manager_is_connected()) continue;
        xSemaphoreTake(s_transition_lock, portMAX_DELAY);
        xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
        const bool should_connect = !s_candidate_reverting && !s_candidate_transition &&
            (s_have_active_credentials || s_candidate_pending);
        wifi_credentials_t credentials = s_candidate_pending ? s_candidate_credentials : s_active_credentials;
        xSemaphoreGive(s_credentials_lock);
        if (!should_connect) {
            xSemaphoreGive(s_transition_lock);
            continue;
        }
        set_radio_transition(true);
        esp_err_t err = ESP_OK;
        if (!s_radio_running) err = start_station_radio();
        if (err == ESP_OK) err = set_sta_credentials(&credentials);
        if (err == ESP_OK) err = esp_wifi_connect();
        set_radio_transition(false);
        xSemaphoreGive(s_transition_lock);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "WiFi reconnect could not start: %s", esp_err_to_name(err));
            schedule_reconnect();
        }
    }
}

static void on_time_synced(struct timeval *value)
{
    if (value == NULL || value->tv_sec < (time_t)1704067200) return;
    s_last_time_sync_tick = xTaskGetTickCount();
    s_time_synced = true;
    ESP_LOGI(TAG, "SNTP time synchronized");
}

static void on_wifi_event(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data
)
{
    (void)arg;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        schedule_reconnect();
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_STOP) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        xEventGroupSetBits(s_wifi_event_group, WIFI_STA_STOPPED_BIT);
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_CONNECTED) {
        xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
        if (s_candidate_pending && s_candidate_attempt_started) s_candidate_link_observed = true;
        xSemaphoreGive(s_credentials_lock);
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
        s_candidate_link_observed = false;
        xSemaphoreGive(s_credentials_lock);
        if (s_wifi_event_group != NULL) {
            xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
        schedule_reconnect();
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        wifi_ap_record_t access_point = {0};
        esp_netif_ip_info_t current_ip = {0};
        if (esp_wifi_sta_get_ap_info(&access_point) == ESP_OK &&
            esp_netif_get_ip_info(s_sta_netif, &current_ip) == ESP_OK &&
            current_ip.ip.addr != 0 && current_ip.ip.addr == event->ip_info.ip.addr) {
            s_retry_count = 0;
            if (s_retry_timer != NULL) (void)esp_timer_stop(s_retry_timer);
            xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
            ESP_LOGI(TAG, "WiFi connected, IP address: " IPSTR, IP2STR(&event->ip_info.ip));
            xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
            const bool candidate_connected = s_candidate_pending && s_candidate_attempt_started &&
                s_candidate_link_observed &&
                strncmp((const char *)access_point.ssid, s_candidate_credentials.ssid,
                        sizeof(access_point.ssid)) == 0;
            esp_err_t err = ESP_OK;
            if (candidate_connected) {
                (void)esp_timer_stop(s_candidate_timer);
                err = save_stored_credentials(&s_candidate_credentials);
                if (err == ESP_OK) {
                    s_active_credentials = s_candidate_credentials;
                    s_have_active_credentials = true;
                    s_candidate_pending = false;
                    s_candidate_committed = true;
                }
            }
            xSemaphoreGive(s_credentials_lock);
            if (candidate_connected && err == ESP_OK) {
                wifi_setup_portal_set_state(DX_WIFI_SETUP_CONNECTED);
                wifi_setup_portal_close_after(4000U);
                ESP_LOGI(TAG, "New WiFi credentials verified and stored");
            } else if (candidate_connected) {
                ESP_LOGE(TAG, "New WiFi credentials could not be stored: %s", esp_err_to_name(err));
                xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
                s_candidate_deadline_us = esp_timer_get_time();
                xSemaphoreGive(s_credentials_lock);
                if (s_candidate_task != NULL) xTaskNotifyGive(s_candidate_task);
            }
        }
    }
}

void wifi_manager_init(void)
{
    s_credentials_lock = xSemaphoreCreateMutex();
    s_transition_lock = xSemaphoreCreateMutex();
    if (s_credentials_lock == NULL || s_transition_lock == NULL) {
        ESP_LOGE(TAG, "Failed to create WiFi credential lock");
        return;
    }
    if (load_stored_credentials(&s_active_credentials)) {
        s_have_active_credentials = true;
        ESP_LOGI(TAG, "Using stored WiFi configuration");
    } else if (DX_WIFI_SSID[0] != '\0') {
        s_active_credentials.version = WIFI_CREDENTIALS_VERSION;
        snprintf(s_active_credentials.ssid, sizeof(s_active_credentials.ssid), "%s", DX_WIFI_SSID);
        snprintf(s_active_credentials.password, sizeof(s_active_credentials.password), "%s", DX_WIFI_PASSWORD);
        s_have_active_credentials = credentials_valid(&s_active_credentials);
        if (s_have_active_credentials) ESP_LOGI(TAG, "Using device pilot WiFi configuration");
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

    esp_sntp_config_t sntp_config = ESP_NETIF_SNTP_DEFAULT_CONFIG("ntp.aliyun.com");
    sntp_config.sync_cb = on_time_synced;
    const esp_err_t sntp_err = esp_netif_sntp_init(&sntp_config);
    if (sntp_err != ESP_OK) {
        ESP_LOGW(TAG, "SNTP initialization failed; remote commands will remain blocked: %s",
                 esp_err_to_name(sntp_err));
    }

    wifi_init_config_t wifi_init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_init_config));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

    const esp_timer_create_args_t retry_timer_config = {
        .callback = retry_wifi_connection,
        .name = "wifi_reconnect",
    };
    ESP_ERROR_CHECK(esp_timer_create(&retry_timer_config, &s_retry_timer));
    const esp_timer_create_args_t candidate_timer_config = {
        .callback = on_candidate_timeout,
        .name = "wifi_setup_trial",
    };
    ESP_ERROR_CHECK(esp_timer_create(&candidate_timer_config, &s_candidate_timer));
    if (xTaskCreate(retry_wifi_task, "wifi_reconnect", 3072, NULL, 4, &s_retry_task) != pdPASS) {
        ESP_LOGE(TAG, "Could not start WiFi reconnect worker");
        return;
    }
#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING
    if (xTaskCreate(candidate_timeout_task, "wifi_setup_revert", 3072, NULL, 4,
                    &s_candidate_task) != pdPASS) {
        ESP_LOGE(TAG, "WiFi setup disabled: could not start timeout worker");
    }
    const esp_err_t portal_err = wifi_setup_portal_init(start_setup_radio, stop_setup_radio);
    if (portal_err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi setup portal initialization failed: %s", esp_err_to_name(portal_err));
    }
#endif

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

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    if (s_have_active_credentials) {
        ESP_ERROR_CHECK(set_sta_credentials(&s_active_credentials));
    }
    ESP_ERROR_CHECK(esp_wifi_start());
    s_radio_running = true;
    s_wifi_started = true;
    if (!s_have_active_credentials) {
        ESP_LOGW(TAG, "No WiFi network configured; opening local setup if enabled");
        const esp_err_t err = wifi_manager_start_provisioning();
        if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
            ESP_LOGE(TAG, "Local WiFi setup could not start: %s", esp_err_to_name(err));
        }
    }
    ESP_LOGI(TAG, "WiFi manager initialized");
}

esp_err_t wifi_manager_start_provisioning(void)
{
#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING
    if (!s_wifi_started) return ESP_ERR_INVALID_STATE;
    if (s_candidate_task == NULL) return ESP_ERR_NO_MEM;
    if (!wifi_setup_portal_is_active()) {
        xSemaphoreTake(s_credentials_lock, portMAX_DELAY);
        s_candidate_committed = false;
        xSemaphoreGive(s_credentials_lock);
    }
    return wifi_setup_portal_start(DX_WIFI_SETUP_PASSWORD, submit_new_credentials);
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

bool wifi_manager_provisioning_is_active(void)
{
    return wifi_setup_portal_is_active();
}

bool wifi_manager_is_connected(void)
{
    if (s_wifi_event_group == NULL) {
        return false;
    }

    return (xEventGroupGetBits(s_wifi_event_group) & WIFI_CONNECTED_BIT) != 0;
}

bool wifi_manager_time_is_synced(void)
{
    const TickType_t max_age = pdMS_TO_TICKS(60000) * 360U;
    return s_time_synced &&
        (TickType_t)(xTaskGetTickCount() - s_last_time_sync_tick) < max_age;
}

bool wifi_manager_wait_connected(int timeout_ms)
{
    if (s_wifi_event_group == NULL) {
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT,
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
