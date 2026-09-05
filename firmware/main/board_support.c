#include "app_config.h"
#include "board_support.h"

#include <stdbool.h>

#include "esp_log.h"

#if DX_TARGET_BOARD == DX_BOARD_S3
#include "../boards/board_s3_audio_lcd.h"

#include "freertos/FreeRTOS.h"

static const char *TAG = "BOARD_SUPPORT";
static bool s_i2c0_ready;
static bool s_i2c1_ready;

static esp_err_t init_i2c_bus(i2c_port_t port, gpio_num_t sda, gpio_num_t scl, uint32_t speed)
{
    const i2c_config_t config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = sda,
        .scl_io_num = scl,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = speed
    };

    esp_err_t err = i2c_param_config(port, &config);
    if (err != ESP_OK) {
        return err;
    }

    err = i2c_driver_install(port, config.mode, 0, 0, 0);
    if (err == ESP_ERR_INVALID_STATE) {
        return ESP_OK;
    }
    return err;
}

static esp_err_t probe_i2c_address(i2c_port_t port, uint8_t address)
{
    i2c_cmd_handle_t command = i2c_cmd_link_create();
    if (command == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = i2c_master_start(command);
    if (err == ESP_OK) {
        err = i2c_master_write_byte(command, (address << 1) | I2C_MASTER_WRITE, true);
    }
    if (err == ESP_OK) {
        err = i2c_master_stop(command);
    }
    if (err == ESP_OK) {
        err = i2c_master_cmd_begin(port, command, pdMS_TO_TICKS(50));
    }

    i2c_cmd_link_delete(command);
    return err;
}

static void scan_i2c_bus(i2c_port_t port, const char *bus_name)
{
    int found = 0;

    ESP_LOGI(TAG, "Scanning %s", bus_name);
    for (uint8_t address = 0x03; address <= 0x77; address++) {
        esp_err_t err = probe_i2c_address(port, address);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "%s device responded at 0x%02X", bus_name, address);
            found++;
        }
    }

    if (found == 0) {
        ESP_LOGW(TAG, "No devices responded on %s", bus_name);
    } else {
        ESP_LOGI(TAG, "%s scan complete, %d device(s) found", bus_name, found);
    }
}

esp_err_t dx_board_support_init(void)
{
    esp_err_t err = init_i2c_bus(I2C0_PORT, I2C0_SDA, I2C0_SCL, I2C0_SPEED);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C0 init failed: %s", esp_err_to_name(err));
        return err;
    }
    s_i2c0_ready = true;
    scan_i2c_bus(I2C0_PORT, "I2C0");

    err = init_i2c_bus(I2C1_PORT, I2C1_SDA, I2C1_SCL, I2C1_SPEED);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C1 init failed: %s", esp_err_to_name(err));
        return err;
    }
    s_i2c1_ready = true;
    scan_i2c_bus(I2C1_PORT, "I2C1");

    ESP_LOGI(
        TAG,
        "S3 board buses ready: I2C0=%s I2C1=%s; audio/display drivers remain disabled",
        s_i2c0_ready ? "yes" : "no",
        s_i2c1_ready ? "yes" : "no"
    );
    return ESP_OK;
}

#else

esp_err_t dx_board_support_init(void)
{
    return ESP_OK;
}

#endif
