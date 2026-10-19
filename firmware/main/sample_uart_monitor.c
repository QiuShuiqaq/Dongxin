#include "sample_uart_monitor.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "app_config.h"

#define SAMPLE_FRAME_SIZE 32

static const char *TAG = "SAMPLE_UART_RX";
static bool s_ready;

static void monitor_task(void *arg);
static bool validate_sample_frame(const uint8_t frame[SAMPLE_FRAME_SIZE]);
static void log_sample_frame(const uint8_t frame[SAMPLE_FRAME_SIZE]);

esp_err_t sample_uart_monitor_init(void)
{
#if !DX_ENABLE_SAMPLE_UART_MONITOR
    ESP_LOGI(TAG, "Passive sample monitor disabled by configuration");
    return ESP_OK;
#else
#if DX_ENABLE_UART_BRIDGE
#error "The passive sample monitor and active UART bridge cannot share UART1"
#endif
    if (s_ready) {
        return ESP_OK;
    }

    const uart_config_t config = {
        .baud_rate = DX_SAMPLE_UART_BAUD_RATE,
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
            UART_PIN_NO_CHANGE,
            DX_SAMPLE_UART_RX_GPIO,
            UART_PIN_NO_CHANGE,
            UART_PIN_NO_CHANGE
        );
    }
    if (err == ESP_OK) {
        err = uart_driver_install(UART_NUM_1, 1024, 0, 0, NULL, 0);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Passive UART initialization failed: %s", esp_err_to_name(err));
        return err;
    }

    if (xTaskCreate(monitor_task, "sample_uart_rx", 3072, NULL, 5, NULL) != pdPASS) {
        uart_driver_delete(UART_NUM_1);
        return ESP_ERR_NO_MEM;
    }

    s_ready = true;
    ESP_LOGI(
        TAG,
        "Receive-only sample monitor ready: RX=GPIO%d, %d 8N1; GPIO%d TX is reserved and disabled",
        DX_SAMPLE_UART_RX_GPIO,
        DX_SAMPLE_UART_BAUD_RATE,
        DX_SAMPLE_UART_TX_RESERVED_GPIO
    );
    return ESP_OK;
#endif
}

static void monitor_task(void *arg)
{
    (void)arg;
    uint8_t frame[SAMPLE_FRAME_SIZE];
    size_t frame_length = 0;
    uint32_t invalid_frames = 0;

    while (true) {
        uint8_t chunk[64];
        int received = uart_read_bytes(UART_NUM_1, chunk, sizeof(chunk), pdMS_TO_TICKS(250));
        if (received <= 0) {
            continue;
        }

        for (int index = 0; index < received; index++) {
            const uint8_t byte = chunk[index];
            if (frame_length == 0 && byte != 0x02) {
                continue;
            }

            frame[frame_length++] = byte;
            if (frame_length < SAMPLE_FRAME_SIZE) {
                continue;
            }

            if (validate_sample_frame(frame)) {
                log_sample_frame(frame);
                frame_length = 0;
                continue;
            }

            invalid_frames++;
            size_t next_header = 1;
            while (next_header < SAMPLE_FRAME_SIZE && frame[next_header] != 0x02) {
                next_header++;
            }
            if (next_header < SAMPLE_FRAME_SIZE) {
                frame_length = SAMPLE_FRAME_SIZE - next_header;
                memmove(frame, &frame[next_header], frame_length);
            } else {
                frame_length = 0;
            }
            ESP_LOGW(TAG, "Invalid sample frame discarded (count=%lu)", (unsigned long)invalid_frames);
        }
    }
}

static bool validate_sample_frame(const uint8_t frame[SAMPLE_FRAME_SIZE])
{
    if (frame[0] != 0x02 || frame[1] != 0xCA || frame[2] != 0x07 ||
        frame[30] != 0x0B || frame[31] != 0x04) {
        return false;
    }

    uint8_t checksum = 0;
    for (int index = 2; index <= 28; index++) {
        checksum ^= frame[index];
    }
    return checksum == frame[29];
}

static void log_sample_frame(const uint8_t frame[SAMPLE_FRAME_SIZE])
{
    const uint8_t status = frame[10];
    const uint8_t extended_status = frame[12];

    ESP_LOGI(
        TAG,
        "STM32 frame command=0x%02X value=%u temp=%uC remaining=%umin "
        "light=%u ventilation=%u fan=%u heatWeak=%u heatStrong=%u swing=%u dry=%u "
        "mode=%u network=%u",
        frame[3],
        frame[4],
        frame[8],
        frame[11],
        (status >> 0) & 0x01,
        (status >> 1) & 0x01,
        (status >> 2) & 0x01,
        (status >> 3) & 0x01,
        (status >> 4) & 0x01,
        (status >> 5) & 0x01,
        (status >> 6) & 0x01,
        (extended_status >> 0) & 0x01,
        (extended_status >> 1) & 0x01
    );
    ESP_LOG_BUFFER_HEX_LEVEL(TAG, frame, SAMPLE_FRAME_SIZE, ESP_LOG_INFO);
}
