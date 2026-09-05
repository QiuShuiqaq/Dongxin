/*
 * 设备状态管理模块
 * 职责：维护浴霸全量状态（照明/弱暖/强暖/吹风/换气/摆风/温度/模式/故障码）
 *       状态变更通知、状态持久化、状态同步到云端和主控
 */

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "device_state.h"

static const char *TAG = "DEV_STATE";

#if 0
// 旧的内部状态结构体，仅保留历史参考
typedef struct {
    bool power;            // 总开关
    bool light;            // 照明
    uint8_t heat_mode;     // 0=关闭 1=弱暖 2=强暖
    bool blow;             // 吹风
    bool ventilation;      // 换气
    bool swing;            // 摆风
    uint8_t target_temp;   // 目标温度 (℃)
    uint8_t current_temp;  // 当前温度 (℃)
    uint8_t mode;          // 工作模式
    bool ai_online;        // AI联网状态
    uint16_t fault_code;   // 故障码
} heater_state_t;
#endif

static dx_device_state_t g_state;
static SemaphoreHandle_t s_state_mutex;

void device_state_init(void)
{
    s_state_mutex = xSemaphoreCreateMutex();
    if (s_state_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create state mutex");
        return;
    }

    memset(&g_state, 0, sizeof(g_state));
    g_state.target_temperature = 30;
    ESP_LOGI(TAG, "设备状态管理初始化完成");
}

esp_err_t device_state_get(dx_device_state_t *out_state)
{
    if (out_state == NULL || s_state_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_state_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    *out_state = g_state;
    xSemaphoreGive(s_state_mutex);
    return ESP_OK;
}

esp_err_t device_state_set_online(bool is_online)
{
    if (s_state_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_state_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    g_state.is_online = is_online;
    xSemaphoreGive(s_state_mutex);
    return ESP_OK;
}

esp_err_t device_state_update(const dx_device_state_t *next_state)
{
    if (next_state == NULL || s_state_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_state_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    g_state = *next_state;
    g_state.fault_code[sizeof(g_state.fault_code) - 1] = '\0';
    xSemaphoreGive(s_state_mutex);
    return ESP_OK;
}
