/*
 * UART通信桥接模块
 *
 * 当前实现只落地协议帧生成和校验。UART物理初始化默认关闭，待东信
 * 确认 C3 与主控板的 TX/RX 引脚、串口参数和最终命令码后启用。
 */

#include <string.h>

#include "driver/uart.h"
#include "esp_log.h"

#include "app_config.h"
#include "uart_bridge.h"

static const char *TAG = "UART_BRIDGE";
static bool s_uart_ready;

static uint8_t command_code(const dx_cloud_action_t *action, uint8_t *value);
static uint8_t frame_checksum(const uint8_t frame[DX_MCU_FRAME_SIZE]);

void uart_bridge_init(void)
{
#if !DX_ENABLE_UART_BRIDGE
    ESP_LOGI(TAG, "UART bridge disabled by configuration");
    return;
#endif

    if (DX_UART_TX_GPIO < 0 || DX_UART_RX_GPIO < 0) {
        ESP_LOGW(TAG, "UART pins are not configured; bridge remains disabled");
        return;
    }

    const uart_config_t config = {
        .baud_rate = DX_UART_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT
    };

    esp_err_t err = uart_param_config(UART_NUM_1, &config);
    if (err == ESP_OK) {
        err = uart_set_pin(
            UART_NUM_1,
            DX_UART_TX_GPIO,
            DX_UART_RX_GPIO,
            UART_PIN_NO_CHANGE,
            UART_PIN_NO_CHANGE
        );
    }
    if (err == ESP_OK) {
        err = uart_driver_install(UART_NUM_1, 2048, 2048, 10, NULL, 0);
    }

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "UART init failed: %s", esp_err_to_name(err));
        return;
    }

    s_uart_ready = true;
    ESP_LOGI(
        TAG,
        "UART1 ready, TX=%d RX=%d baud=%d",
        DX_UART_TX_GPIO,
        DX_UART_RX_GPIO,
        DX_UART_BAUD_RATE
    );
}

bool uart_bridge_is_ready(void)
{
    return s_uart_ready;
}

esp_err_t uart_bridge_build_frame(
    const dx_cloud_action_t *action,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
)
{
    if (
        action == NULL ||
        out_frame == NULL ||
        action->code == NULL ||
        action->value == NULL
    ) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_frame, 0, DX_MCU_FRAME_SIZE);
    out_frame[0] = 0x02;
    out_frame[1] = 0xCF;
    out_frame[2] = 0x07;

    uint8_t value = 0;
    uint8_t command = command_code(action, &value);
    if (command == 0) {
        return ESP_ERR_NOT_SUPPORTED;
    }

    out_frame[3] = command;
    out_frame[4] = value;
    out_frame[29] = frame_checksum(out_frame);
    out_frame[30] = 0x0F;
    out_frame[31] = 0x04;
    return ESP_OK;
}

bool uart_bridge_validate_frame(const uint8_t frame[DX_MCU_FRAME_SIZE])
{
    if (frame == NULL) {
        return false;
    }

    if (frame[0] != 0x02 || frame[1] != 0xCF || frame[2] != 0x07) {
        return false;
    }
    if (frame[30] != 0x0F || frame[31] != 0x04) {
        return false;
    }
    return frame[29] == frame_checksum(frame);
}

esp_err_t uart_bridge_send_action(const dx_cloud_action_t *action)
{
    if (!s_uart_ready) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[DX_MCU_FRAME_SIZE];
    esp_err_t err = uart_bridge_build_frame(action, frame);
    if (err != ESP_OK) {
        return err;
    }

    int written = uart_write_bytes(UART_NUM_1, frame, sizeof(frame));
    return written == DX_MCU_FRAME_SIZE ? ESP_OK : ESP_FAIL;
}

static uint8_t command_code(const dx_cloud_action_t *action, uint8_t *value)
{
    if (strcmp(action->code, "light") == 0) {
        if (strcmp(action->value, "on") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x01;
    }
    if (strcmp(action->code, "ventilation") == 0) {
        if (strcmp(action->value, "on") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x02;
    }
    if (strcmp(action->code, "fan") == 0) {
        if (strcmp(action->value, "on") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x03;
    }
    if (strcmp(action->code, "heater") == 0) {
        if (strcmp(action->value, "weak") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "strong") == 0) {
            *value = 0x02;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x04;
    }
    if (strcmp(action->code, "swing") == 0) {
        if (strcmp(action->value, "on") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x05;
    }
    if (strcmp(action->code, "dry") == 0) {
        if (strcmp(action->value, "on") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "off") != 0) {
            return 0;
        }
        return 0x06;
    }
    if (strcmp(action->code, "timer") == 0 &&
        strcmp(action->value, "set") == 0 &&
        action->duration_minutes >= 0 &&
        action->duration_minutes <= 120) {
        *value = (uint8_t)action->duration_minutes;
        return 0x09;
    }
    if (strcmp(action->code, "network") == 0) {
        if (strcmp(action->value, "enable") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "disable") != 0) {
            return 0;
        }
        return 0x0C;
    }

    /*
     * Temperature and standby are intentionally not mapped here. Their
     * byte-level definitions must be confirmed by the MCU owner first.
     */
    return 0;
}

static uint8_t frame_checksum(const uint8_t frame[DX_MCU_FRAME_SIZE])
{
    uint8_t checksum = 0;
    for (int index = 2; index <= 28; index++) {
        checksum ^= frame[index];
    }
    return checksum;
}
