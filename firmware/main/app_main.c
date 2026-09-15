/*
 * 东信高端智能浴霸（直流款·AI联网版）
 * ESP32-C3/S3 staged firmware
 *
 * 系统链路：
 *   BLE/CI1302/cloud -> ESP32 command queue -> safety controller -> local HAL
 *
 * 本固件职责：
 *   1. WiFi连接与配网
 *   2. MQTT device messaging and synchronous online voice transport
 *   3. C3 direct load control through PCF8574/GPIO/ADC
 *   4. CI1302 offline voice and I2S online audio
 *   5. 设备状态上报与控制指令下发
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"

#include "app_config.h"
#include "board_profile.h"
#include "board_support.h"
#include "cloud_agent.h"
#include "command_queue.h"
#include "device_controller.h"
#include "mqtt_agent.h"
#include "device_state.h"
#include "uart_bridge.h"
#include "voice_engine.h"
#include "wifi_manager.h"

static const char *TAG = "DX_HEATER";

/* ============================================================
 *  模块初始化函数声明（后续逐步实现）
 * ============================================================ */

// WiFi连接管理（STA模式 + SmartConfig配网）
extern void wifi_manager_init(void);

// 云端通信（HTTPS客户端 + JSON解析 + 设备注册/心跳/状态上报）
extern void cloud_agent_init(void);

// 旧MCU UART兼容测试资产（32字节固定帧协议）
extern void uart_bridge_init(void);

// 语音交互（离线语音识别 + 联网AI对话 + TTS播报）
extern void voice_engine_init(void);

// 设备状态管理（照明/取暖/换气/摆风/温度/故障码）
extern void device_state_init(void);

/* ============================================================
 *  主入口
 * ============================================================ */

void app_main(void)
{
    const dx_board_profile_t *board = dx_board_profile_get();

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "  东信智能浴霸 AI联网版 固件启动");
    ESP_LOGI(TAG, "  芯片: %s", board->chip);
    ESP_LOGI(TAG, "  固件版本: %s", DX_FIRMWARE_VERSION);
    ESP_LOGI(TAG, "  板型: %s (%s)", board->name, board->chip);
    ESP_LOGI(TAG, "========================================");

    // 1. 初始化NVS（保存后续配网和设备配置）
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_LOGI(TAG, "[1/8] NVS 初始化完成");

    // 2. 板级总线和硬件自检
    ret = dx_board_support_init();
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "板级自检未完成: %s", esp_err_to_name(ret));
    }
    ESP_LOGI(TAG, "[2/8] 板级自检完成");

    // 3. 设备状态管理初始化
    device_state_init();
    ESP_LOGI(TAG, "[3/8] 设备状态管理初始化完成");

    // 4. C3直控内核与统一命令队列
    ESP_ERROR_CHECK(device_controller_init());
    ESP_ERROR_CHECK(command_queue_init());
    ESP_LOGI(TAG, "[4/8] C3直控内核初始化完成");

    // 5. 旧MCU UART仅保留兼容和协议回归
    ESP_ERROR_CHECK(uart_bridge_run_self_test());
    uart_bridge_init();
    ESP_LOGI(TAG, "[5/8] 旧MCU UART兼容层初始化完成");

    // 6. WiFi连接初始化
#if DX_ENABLE_WIFI
    wifi_manager_init();
#else
    ESP_LOGI(TAG, "[5/6] WiFi管理已按配置关闭");
#endif
    ESP_LOGI(TAG, "[6/8] WiFi管理初始化完成");

    // 7. 云端通信初始化
    cloud_agent_init();
    mqtt_agent_init();
    ESP_LOGI(TAG, "[7/8] 云端通信代理初始化完成");

    // 8. 语音引擎初始化（CI1302 SDK映射确认后实现）
    voice_engine_init();
    ESP_LOGI(TAG, "[8/8] 语音引擎初始化完成");

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "  系统启动完成，进入主循环");
    ESP_LOGI(TAG, "========================================");

    // 主循环：心跳、状态监控、看门狗
    while (1) {
        // 打印系统运行状态（每30秒）
        ESP_LOGI(TAG, "系统运行中 - 空闲堆内存: %u bytes", (unsigned int)esp_get_free_heap_size());
        vTaskDelay(pdMS_TO_TICKS(30000));
    }
}
