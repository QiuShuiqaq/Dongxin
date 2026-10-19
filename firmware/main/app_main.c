/*
 * 东信智能浴霸 AI 联网模块
 * ESP32-C3/S3 staged firmware
 *
 * 当前系统链路：
 *   online audio / cloud -> ESP32-C3 -> STM32 protocol adapter -> existing controller
 *
 * 本固件职责：
 *   1. WiFi连接与配网
 *   2. MQTT设备消息和在线语音传输
 *   3. STM32状态接收和后续双向协议适配
 *   4. 立创板在线ASR/LLM/TTS验证
 *   5. 后续接入CI1302唤醒和断网固定命令
 *
 * direct_control_hal/PCF8574仅保留为研发模拟和降本预研资产，
 * 不属于当前样机控制主链路。
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
#include "board_lab.h"
#include "cloud_agent.h"
#include "command_queue.h"
#include "device_controller.h"
#include "mqtt_agent.h"
#include "sample_uart_monitor.h"
#include "device_state.h"
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

// 语音交互（离线语音识别 + 联网AI对话 + TTS播报）
extern void voice_engine_init(void);

// 设备状态管理（照明/取暖/换气/摆风/温度/故障码）
extern void device_state_init(void);

/* ============================================================
 *  主入口
 * ============================================================ */

void app_main(void)
{
    /* Hold the Lichuang power amplifier off before slower subsystems start. */
    voice_engine_preinit();
    /* Hold the active-low LCD backlight off until an explicit board-lab command. */
    board_lab_preinit();

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

    // 4. 研发模拟控制器与统一命令队列（不驱动当前STM32样机）
    ESP_ERROR_CHECK(device_controller_init());
    ESP_ERROR_CHECK(command_queue_init());
    ESP_LOGI(TAG, "[4/9] C3命令队列初始化完成（当前不控制STM32负载）");

    // 5. 现有STM32样机只读监听；TX未配置，禁止发送
    ret = sample_uart_monitor_init();
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "东信样机被动串口监听未启动: %s", esp_err_to_name(ret));
    }
    ESP_LOGI(TAG, "[5/9] STM32串口只读监听初始化完成");

    // 6. WiFi连接初始化
#if DX_ENABLE_WIFI
    wifi_manager_init();
#else
    ESP_LOGI(TAG, "[5/6] WiFi管理已按配置关闭");
#endif
    ESP_LOGI(TAG, "[6/9] WiFi管理初始化完成");

    // 7. 云端通信初始化
    cloud_agent_init();
    mqtt_agent_init();
    ESP_LOGI(TAG, "[7/9] 云端通信代理初始化完成");

    // 8. 当前开发板在线语音验证；CI1302在后续硬件阶段接入
    voice_engine_init();
    ESP_LOGI(TAG, "[8/9] 在线语音验证引擎初始化完成");

    // 9. 开发板外设；所有输出默认关闭，仅响应显式研发指令
    board_lab_init();
    ESP_LOGI(TAG, "[9/9] 开发板外设初始化完成");

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
