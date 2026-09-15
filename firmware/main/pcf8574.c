#include "pcf8574.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "PCF8574";
static dx_pcf8574_config_t s_config;
static uint8_t s_shadow[DX_PCF8574_MAX_DEVICES];
static SemaphoreHandle_t s_mutex;
static bool s_ready;

static esp_err_t write_raw(size_t device_index, uint8_t value);
static esp_err_t read_raw(size_t device_index, uint8_t *out_value);

esp_err_t dx_pcf8574_init(const dx_pcf8574_config_t *config)
{
    if (config == NULL || config->device_count == 0 ||
        config->device_count > DX_PCF8574_MAX_DEVICES ||
        config->sda_gpio < 0 || config->scl_gpio < 0 ||
        config->frequency_hz == 0 || config->frequency_hz > 100000) {
        return ESP_ERR_INVALID_ARG;
    }

    s_ready = false;
    s_config = *config;
    memset(s_shadow, 0xFF, sizeof(s_shadow));
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
    }
    if (s_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }

    const i2c_config_t i2c_config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = config->sda_gpio,
        .scl_io_num = config->scl_gpio,
        .sda_pullup_en = config->enable_internal_pullups
            ? GPIO_PULLUP_ENABLE
            : GPIO_PULLUP_DISABLE,
        .scl_pullup_en = config->enable_internal_pullups
            ? GPIO_PULLUP_ENABLE
            : GPIO_PULLUP_DISABLE,
        .master.clk_speed = config->frequency_hz,
    };
    esp_err_t err = i2c_param_config(config->port, &i2c_config);
    if (err == ESP_OK) {
        err = i2c_driver_install(config->port, I2C_MODE_MASTER, 0, 0, 0);
        if (err == ESP_ERR_INVALID_STATE) {
            err = ESP_OK;
        }
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C initialization failed: %s", esp_err_to_name(err));
        return err;
    }

    for (size_t index = 0; index < config->device_count; index++) {
        err = write_raw(index, 0xFF);
        if (err != ESP_OK) {
            ESP_LOGE(
                TAG,
                "Device 0x%02X did not accept safe state: %s",
                config->addresses[index],
                esp_err_to_name(err)
            );
            return err;
        }
        uint8_t input = 0;
        err = read_raw(index, &input);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Device 0x%02X probe failed", config->addresses[index]);
            return err;
        }
        ESP_LOGI(TAG, "Device 0x%02X ready, initial pins=0x%02X", config->addresses[index], input);
    }

    s_ready = true;
    return ESP_OK;
}

bool dx_pcf8574_is_ready(void)
{
    return s_ready;
}

esp_err_t dx_pcf8574_write(size_t device_index, uint8_t value)
{
    if (!s_ready || device_index >= s_config.device_count) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = write_raw(device_index, value);
    if (err == ESP_OK) {
        s_shadow[device_index] = value;
    }
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t dx_pcf8574_read(size_t device_index, uint8_t *out_value)
{
    if (!s_ready || out_value == NULL || device_index >= s_config.device_count) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = read_raw(device_index, out_value);
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t dx_pcf8574_all_off(void)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t result = ESP_OK;
    for (size_t index = 0; index < s_config.device_count; index++) {
        esp_err_t err = write_raw(index, 0xFF);
        if (err == ESP_OK) {
            s_shadow[index] = 0xFF;
        } else if (result == ESP_OK) {
            result = err;
        }
    }
    xSemaphoreGive(s_mutex);
    return result;
}

esp_err_t dx_pcf8574_health_check(void)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t result = ESP_OK;
    for (size_t index = 0; index < s_config.device_count; index++) {
        uint8_t pins = 0;
        esp_err_t err = read_raw(index, &pins);
        if (err != ESP_OK) {
            result = err;
            break;
        }
    }
    xSemaphoreGive(s_mutex);
    return result;
}

static esp_err_t write_raw(size_t device_index, uint8_t value)
{
    i2c_cmd_handle_t command = i2c_cmd_link_create();
    if (command == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = i2c_master_start(command);
    if (err == ESP_OK) {
        err = i2c_master_write_byte(
            command,
            (s_config.addresses[device_index] << 1) | I2C_MASTER_WRITE,
            true
        );
    }
    if (err == ESP_OK) {
        err = i2c_master_write_byte(command, value, true);
    }
    if (err == ESP_OK) {
        err = i2c_master_stop(command);
    }
    if (err == ESP_OK) {
        err = i2c_master_cmd_begin(s_config.port, command, pdMS_TO_TICKS(50));
    }
    i2c_cmd_link_delete(command);
    return err;
}

static esp_err_t read_raw(size_t device_index, uint8_t *out_value)
{
    i2c_cmd_handle_t command = i2c_cmd_link_create();
    if (command == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = i2c_master_start(command);
    if (err == ESP_OK) {
        err = i2c_master_write_byte(
            command,
            (s_config.addresses[device_index] << 1) | I2C_MASTER_READ,
            true
        );
    }
    if (err == ESP_OK) {
        err = i2c_master_read_byte(command, out_value, I2C_MASTER_NACK);
    }
    if (err == ESP_OK) {
        err = i2c_master_stop(command);
    }
    if (err == ESP_OK) {
        err = i2c_master_cmd_begin(s_config.port, command, pdMS_TO_TICKS(50));
    }
    i2c_cmd_link_delete(command);
    return err;
}
