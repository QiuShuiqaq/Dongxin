#include "wifi_setup_portal.h"

#include "sdkconfig.h"

#if defined(CONFIG_DX_WIFI_PROVISIONING) && CONFIG_DX_WIFI_PROVISIONING

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

static const char *TAG = "WIFI_SETUP";
static const uint32_t SETUP_WINDOW_MS = 10U * 60U * 1000U;
static const int64_t SUBMISSION_GUARD_US = 75LL * 1000LL * 1000LL;

static esp_netif_t *s_ap_netif;
static httpd_handle_t s_server;
static esp_timer_handle_t s_close_timer;
static SemaphoreHandle_t s_lock;
static TaskHandle_t s_stop_task;
static dx_wifi_setup_submit_cb_t s_submit;
static dx_wifi_setup_radio_start_cb_t s_start_radio;
static dx_wifi_setup_radio_stop_cb_t s_stop_radio;
static dx_wifi_setup_state_t s_state;
static bool s_starting;
static bool s_stopping;
static bool s_submitting;
static bool s_close_requested;
static char s_csrf_token[33];
static int64_t s_close_deadline_us;

static bool request_host_is_ap(httpd_req_t *req)
{
    char host[32];
    esp_netif_ip_info_t info;
    if (s_ap_netif == NULL || esp_netif_get_ip_info(s_ap_netif, &info) != ESP_OK ||
        httpd_req_get_hdr_value_str(req, "Host", host, sizeof(host)) != ESP_OK) {
        return false;
    }
    char expected[24];
    snprintf(expected, sizeof(expected), IPSTR, IP2STR(&info.ip));
    const size_t length = strlen(expected);
    return strncmp(host, expected, length) == 0 &&
        (host[length] == '\0' || strcmp(host + length, ":80") == 0);
}

static esp_err_t reject_request(httpd_req_t *req)
{
    httpd_resp_set_status(req, "403 Forbidden");
    return httpd_resp_sendstr(req, "Forbidden");
}

static esp_err_t open_ap_session(httpd_handle_t server, int socket_fd)
{
    (void)server;
    struct sockaddr_in local = {0};
    socklen_t length = sizeof(local);
    esp_netif_ip_info_t info;
    if (s_ap_netif == NULL ||
        esp_netif_get_ip_info(s_ap_netif, &info) != ESP_OK ||
        getsockname(socket_fd, (struct sockaddr *)&local, &length) != 0 ||
        local.sin_family != AF_INET || local.sin_addr.s_addr != info.ip.addr) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

static esp_err_t index_handler(httpd_req_t *req)
{
    if (!request_host_is_ap(req)) return reject_request(req);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    static const char *before_token =
        "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>东信设备配网</title>"
        "<style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.5rem;color:#183044}"
        "label{display:block;margin:1.4rem 0 .4rem}input{box-sizing:border-box;width:100%;padding:.7rem;font:inherit}"
        "button{margin-top:1.5rem;padding:.7rem 1.2rem;font:inherit;background:#126c63;color:white;border:0;cursor:pointer}"
        "#status{min-height:2rem;margin-top:1rem}</style>"
        "<h1>设备配网</h1><form id='form'>"
        "<label for='ssid'>2.4 GHz Wi-Fi 名称</label><input id='ssid' maxlength='32' required autocomplete='off'>"
        "<label for='password'>Wi-Fi 密码</label><input id='password' type='password' maxlength='63' autocomplete='off'>"
        "<button type='submit'>连接网络</button></form><p id='status' role='status'></p>"
        "<script>const token='";
    static const char *after_token =
        "';const status=document.getElementById('status');let noticeUntil=0;"
        "document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();"
        "const name=document.getElementById('ssid').value,pass=document.getElementById('password').value;"
        "const size=s=>new TextEncoder().encode(s).length;"
        "if(size(name)>32){status.textContent='Wi-Fi 名称不能超过 32 字节';return;}"
        "if(size(pass)>63||(size(pass)>0&&size(pass)<8)){status.textContent='Wi-Fi 密码须为 8 至 63 字节';return;}"
        "status.textContent='正在连接...';try{const r=await fetch('/api/wifi',{method:'POST',"
        "headers:{'Content-Type':'application/json','X-DX-CSRF':token},"
        "body:JSON.stringify({ssid:document.getElementById('ssid').value,"
        "password:document.getElementById('password').value})});"
        "if(r.status===503){noticeUntil=Date.now()+10000;status.textContent='配网即将结束或暂不可用，请重新开启后重试。';return;}"
        "if(!r.ok)throw Error(await r.text());document.getElementById('password').value='';"
        "}catch(err){status.textContent='配网请求失败，请稍后重试'}});"
        "setInterval(async()=>{if(Date.now()<noticeUntil)return;try{const r=await fetch('/api/status',{cache:'no-store'});"
        "if(!r.ok)return;const data=await r.json();"
        "status.textContent=({idle:'等待输入',connecting:'正在连接...',connected:'连接成功，配网即将结束。',"
        "failed:'连接失败，请检查 Wi-Fi 名称和密码后重试。'})[data.state]||'等待输入';"
        "}catch(e){}},1500);</script></html>";
    if (httpd_resp_sendstr_chunk(req, before_token) != ESP_OK ||
        httpd_resp_sendstr_chunk(req, s_csrf_token) != ESP_OK ||
        httpd_resp_sendstr_chunk(req, after_token) != ESP_OK) {
        return ESP_FAIL;
    }
    return httpd_resp_sendstr_chunk(req, NULL);
}

static esp_err_t status_handler(httpd_req_t *req)
{
    if (!request_host_is_ap(req)) return reject_request(req);
    static const char *states[] = {"idle", "connecting", "connected", "failed"};
    xSemaphoreTake(s_lock, portMAX_DELAY);
    dx_wifi_setup_state_t state = s_state;
    xSemaphoreGive(s_lock);
    if (state < DX_WIFI_SETUP_IDLE || state > DX_WIFI_SETUP_FAILED) state = DX_WIFI_SETUP_IDLE;
    char response[48];
    snprintf(response, sizeof(response), "{\"state\":\"%s\"}", states[state]);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, response);
}

static esp_err_t begin_submission(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const int64_t now = esp_timer_get_time();
    /* Leave time for the trial connection without extending the setup window. */
    if (s_server == NULL || s_stopping || s_submitting || s_close_requested ||
        s_state == DX_WIFI_SETUP_CONNECTED || s_close_timer == NULL ||
        s_close_deadline_us - now < SUBMISSION_GUARD_US) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    s_submitting = true;
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

static void end_submission(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_submitting = false;
    if (s_server != NULL && esp_timer_get_time() >= s_close_deadline_us) {
        xTaskNotifyGive(s_stop_task);
    }
    xSemaphoreGive(s_lock);
}

static esp_err_t submit_handler(httpd_req_t *req)
{
    char token[sizeof(s_csrf_token)];
    if (!request_host_is_ap(req) ||
        httpd_req_get_hdr_value_str(req, "X-DX-CSRF", token, sizeof(token)) != ESP_OK ||
        strcmp(token, s_csrf_token) != 0) {
        return reject_request(req);
    }
    if (req->content_len <= 0 || req->content_len > 512) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid request size");
    }
    char body[513];
    size_t received = 0;
    while (received < (size_t)req->content_len) {
        const int amount = httpd_req_recv(req, body + received, req->content_len - received);
        if (amount <= 0) {
            httpd_resp_set_status(req, "408 Request Timeout");
            return httpd_resp_sendstr(req, "Request incomplete");
        }
        received += (size_t)amount;
    }
    body[received] = '\0';
    cJSON *json = cJSON_ParseWithLength(body, received);
    const cJSON *ssid = cJSON_GetObjectItemCaseSensitive(json, "ssid");
    const cJSON *password = cJSON_GetObjectItemCaseSensitive(json, "password");
    const size_t ssid_length = cJSON_IsString(ssid) ? strlen(ssid->valuestring) : 0;
    const size_t password_length = cJSON_IsString(password) ? strlen(password->valuestring) : 0;
    const bool valid = cJSON_IsObject(json) &&
        cJSON_IsString(ssid) && cJSON_IsString(password) &&
        ssid_length > 0 && ssid_length <= 32 &&
        (password_length == 0 || (password_length >= 8 && password_length <= 63));
    if (!valid) {
        cJSON_Delete(json);
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid network name or password");
    }
    esp_err_t err = begin_submission();
    if (err != ESP_OK) {
        cJSON_Delete(json);
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_sendstr(req, "Setup session is closing");
    }
    err = s_submit == NULL
        ? ESP_ERR_INVALID_STATE
        : s_submit(ssid->valuestring, password->valuestring);
    end_submission();
    cJSON_Delete(json);
    if (err != ESP_OK) {
        httpd_resp_set_status(req, err == ESP_ERR_INVALID_STATE ? "409 Conflict" : "503 Service Unavailable");
        return httpd_resp_sendstr(req, "Connection could not start");
    }
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{\"accepted\":true}");
}

static bool stop_portal(bool only_if_expired);

static void stop_task(void *arg)
{
    (void)arg;
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        while (stop_portal(true)) vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

static void on_close_timer(void *arg)
{
    (void)arg;
    if (s_stop_task != NULL) xTaskNotifyGive(s_stop_task);
}

esp_err_t wifi_setup_portal_init(dx_wifi_setup_radio_start_cb_t start,
                                 dx_wifi_setup_radio_stop_cb_t stop)
{
    if (start == NULL || stop == NULL) return ESP_ERR_INVALID_ARG;
    if (s_lock != NULL) return ESP_ERR_INVALID_STATE;
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) return ESP_ERR_NO_MEM;
    if (xTaskCreate(stop_task, "wifi_setup_stop", 3072, NULL, 4, &s_stop_task) != pdPASS) {
        vSemaphoreDelete(s_lock);
        s_lock = NULL;
        return ESP_ERR_NO_MEM;
    }
    s_start_radio = start;
    s_stop_radio = stop;
    return ESP_OK;
}

void wifi_setup_portal_close_after(uint32_t delay_ms)
{
    if (s_lock == NULL) return;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_close_timer != NULL) {
        s_close_requested = true;
        const int64_t now = esp_timer_get_time();
        const int64_t requested_deadline = now + (int64_t)delay_ms * 1000;
        if (requested_deadline < s_close_deadline_us) s_close_deadline_us = requested_deadline;
        (void)esp_timer_stop(s_close_timer);
        if (s_close_deadline_us <= now) {
            xTaskNotifyGive(s_stop_task);
        } else if (esp_timer_start_once(s_close_timer, (uint64_t)(s_close_deadline_us - now)) != ESP_OK) {
            ESP_LOGE(TAG, "Could not schedule setup portal closure");
            s_close_deadline_us = now;
            xTaskNotifyGive(s_stop_task);
        }
    }
    xSemaphoreGive(s_lock);
}

esp_err_t wifi_setup_portal_start(const char *setup_password, dx_wifi_setup_submit_cb_t submit)
{
    if (setup_password == NULL || submit == NULL ||
        strlen(setup_password) < 12 || strlen(setup_password) > 63) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_lock == NULL || s_start_radio == NULL || s_stop_radio == NULL) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_starting || s_stopping || (s_ap_netif != NULL && s_server == NULL)) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    if (s_server != NULL) {
        xSemaphoreGive(s_lock);
        return ESP_OK;
    }
    s_starting = true;
    s_ap_netif = esp_netif_create_default_wifi_ap();
    if (s_ap_netif == NULL) {
        s_starting = false;
        xSemaphoreGive(s_lock);
        return ESP_ERR_NO_MEM;
    }
    uint8_t mac[6];
    esp_err_t err = esp_wifi_get_mac(WIFI_IF_STA, mac);
    if (err != ESP_OK) goto fail;
    wifi_config_t ap_config = {0};
    snprintf((char *)ap_config.ap.ssid, sizeof(ap_config.ap.ssid),
             "DX-SETUP-%02X%02X%02X", mac[3], mac[4], mac[5]);
    snprintf((char *)ap_config.ap.password, sizeof(ap_config.ap.password), "%s", setup_password);
    ap_config.ap.ssid_len = strlen((char *)ap_config.ap.ssid);
    ap_config.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ap_config.ap.max_connection = 1;
    ap_config.ap.channel = 1;
    s_close_requested = false;
    s_close_deadline_us = esp_timer_get_time() + (int64_t)SETUP_WINDOW_MS * 1000;
    uint8_t token_bytes[16];
    esp_fill_random(token_bytes, sizeof(token_bytes));
    for (size_t i = 0; i < sizeof(token_bytes); ++i) {
        snprintf(s_csrf_token + i * 2, 3, "%02x", token_bytes[i]);
    }
    s_submit = submit;
    s_state = DX_WIFI_SETUP_IDLE;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.open_fn = open_ap_session;
    config.max_uri_handlers = 3;
    config.max_open_sockets = 4;
    config.stack_size = 5120;
    config.recv_wait_timeout = 5;
    config.send_wait_timeout = 5;
    err = httpd_start(&s_server, &config);
    if (err != ESP_OK) goto fail;
    const httpd_uri_t index = {.uri = "/", .method = HTTP_GET, .handler = index_handler};
    const httpd_uri_t status = {.uri = "/api/status", .method = HTTP_GET, .handler = status_handler};
    const httpd_uri_t submit_uri = {.uri = "/api/wifi", .method = HTTP_POST, .handler = submit_handler};
    err = httpd_register_uri_handler(s_server, &index);
    if (err == ESP_OK) err = httpd_register_uri_handler(s_server, &status);
    if (err == ESP_OK) err = httpd_register_uri_handler(s_server, &submit_uri);
    if (err != ESP_OK) goto fail;
    const esp_timer_create_args_t timer_args = {.callback = on_close_timer, .name = "wifi_setup_window"};
    err = esp_timer_create(&timer_args, &s_close_timer);
    if (err != ESP_OK) goto fail;
    const int64_t remaining_us = s_close_deadline_us - esp_timer_get_time();
    if (remaining_us <= 0) {
        err = ESP_ERR_TIMEOUT;
        goto fail;
    }
    err = esp_timer_start_once(s_close_timer, (uint64_t)remaining_us);
    if (err != ESP_OK) goto fail;
    // Do not hold the portal mutex while the manager waits for Wi-Fi events.
    xSemaphoreGive(s_lock);
    err = s_start_radio(&ap_config);
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (err != ESP_OK) goto fail;
    s_starting = false;
    if (s_close_requested || esp_timer_get_time() >= s_close_deadline_us) {
        xTaskNotifyGive(s_stop_task);
    }
    ESP_LOGI(TAG, "Setup AP ready: %s, browse to http://192.168.4.1", ap_config.ap.ssid);
    xSemaphoreGive(s_lock);
    return ESP_OK;

fail:
    s_starting = false;
    s_close_requested = true;
    s_close_deadline_us = esp_timer_get_time();
    xSemaphoreGive(s_lock);
    xTaskNotifyGive(s_stop_task);
    return err;
}

static bool stop_portal(bool only_if_expired)
{
    if (s_lock == NULL) return false;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_ap_netif == NULL || s_stopping) {
        xSemaphoreGive(s_lock);
        return false;
    }
    const int64_t now = esp_timer_get_time();
    if (!only_if_expired) {
        s_close_requested = true;
        s_close_deadline_us = now;
    }
    if (s_starting || s_submitting || (only_if_expired && now < s_close_deadline_us)) {
        xSemaphoreGive(s_lock);
        return false;
    }
    s_stopping = true;
    httpd_handle_t server = s_server;
    s_server = NULL;
    esp_timer_handle_t timer = s_close_timer;
    s_close_timer = NULL;
    xSemaphoreGive(s_lock);
    if (timer != NULL) {
        (void)esp_timer_stop(timer);
        esp_timer_delete(timer);
    }
    esp_err_t err = server == NULL ? ESP_OK : httpd_stop(server);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Could not stop setup HTTP server: %s", esp_err_to_name(err));
        xSemaphoreTake(s_lock, portMAX_DELAY);
        s_server = server;
        s_stopping = false;
        xSemaphoreGive(s_lock);
        return true;
    }
    memset(s_csrf_token, 0, sizeof(s_csrf_token));
    err = s_stop_radio();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Could not disable setup AP; retaining interface and retrying: %s",
                 esp_err_to_name(err));
        xSemaphoreTake(s_lock, portMAX_DELAY);
        s_stopping = false;
        xSemaphoreGive(s_lock);
        return true;
    }
    esp_netif_destroy_default_wifi(s_ap_netif);
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_ap_netif = NULL;
    s_submit = NULL;
    s_stopping = false;
    ESP_LOGI(TAG, "Setup AP closed");
    xSemaphoreGive(s_lock);
    return false;
}

void wifi_setup_portal_stop(void)
{
    if (stop_portal(false) && s_stop_task != NULL) xTaskNotifyGive(s_stop_task);
}

bool wifi_setup_portal_is_active(void)
{
    if (s_lock == NULL) return false;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const bool active = s_ap_netif != NULL || s_starting;
    xSemaphoreGive(s_lock);
    return active;
}

void wifi_setup_portal_set_state(dx_wifi_setup_state_t state)
{
    if (s_lock == NULL) return;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_server != NULL && !s_stopping) s_state = state;
    xSemaphoreGive(s_lock);
}

#else

esp_err_t wifi_setup_portal_init(dx_wifi_setup_radio_start_cb_t start,
                                 dx_wifi_setup_radio_stop_cb_t stop)
{
    (void)start;
    (void)stop;
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t wifi_setup_portal_start(const char *setup_password, dx_wifi_setup_submit_cb_t submit)
{
    (void)setup_password;
    (void)submit;
    return ESP_ERR_NOT_SUPPORTED;
}

void wifi_setup_portal_stop(void) {}
bool wifi_setup_portal_is_active(void) { return false; }
void wifi_setup_portal_set_state(dx_wifi_setup_state_t state) { (void)state; }
void wifi_setup_portal_close_after(uint32_t delay_ms) { (void)delay_ms; }

#endif
