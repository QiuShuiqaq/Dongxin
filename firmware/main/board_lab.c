#include "board_lab.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "app_config.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "wifi_manager.h"

static const char *TAG = "BOARD_LAB";

#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO

#define LAB_I2C_TIMEOUT_MS 100
#define LAB_LCD_HOST SPI2_HOST
#define LAB_LCD_SCLK_GPIO 3
#define LAB_LCD_MOSI_GPIO 5
#define LAB_LCD_DC_GPIO 6
#define LAB_LCD_CS_GPIO 4
#define LAB_LCD_BACKLIGHT_GPIO 2
#define LAB_LCD_WIDTH 320
#define LAB_LCD_HEIGHT 240
#define LAB_LCD_LINES_PER_TRANSFER 12
#define LAB_BACKLIGHT_MAX_DUTY 1023

#define LAB_ADDR_ES8311 0x18
#define LAB_ADDR_QMC5883L 0x0D
#define LAB_ADDR_FT6336 0x38
#define LAB_ADDR_QMI8658C 0x6A
#define LAB_ADDR_GXHTC3 0x70

static esp_lcd_panel_handle_t s_panel;
static bool s_display_ready;
static bool s_display_on;
static int s_brightness_percent;
static char s_pattern[24] = "BLACK";
static bool s_qmi_initialized;
static bool s_qmc_initialized;
static SemaphoreHandle_t s_lcd_transfer_done;

static bool lcd_transfer_done_callback(
    esp_lcd_panel_io_handle_t panel_io,
    esp_lcd_panel_io_event_data_t *event_data,
    void *user_context
)
{
    (void)panel_io;
    (void)event_data;
    BaseType_t high_priority_task_woken = pdFALSE;
    xSemaphoreGiveFromISR(
        (SemaphoreHandle_t)user_context,
        &high_priority_task_woken
    );
    return high_priority_task_woken == pdTRUE;
}

static esp_err_t i2c_probe(uint8_t address)
{
    i2c_cmd_handle_t command = i2c_cmd_link_create();
    if (command == NULL) {
        return ESP_ERR_NO_MEM;
    }
    i2c_master_start(command);
    i2c_master_write_byte(command, (address << 1) | I2C_MASTER_WRITE, true);
    i2c_master_stop(command);
    const esp_err_t err = i2c_master_cmd_begin(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        command,
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
    i2c_cmd_link_delete(command);
    return err;
}

static esp_err_t i2c_read_register(uint8_t address, uint8_t reg, void *data, size_t length)
{
    return i2c_master_write_read_device(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        address,
        &reg,
        1,
        data,
        length,
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
}

static esp_err_t i2c_write_register(uint8_t address, uint8_t reg, uint8_t value)
{
    const uint8_t payload[] = {reg, value};
    return i2c_master_write_to_device(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        address,
        payload,
        sizeof(payload),
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
}

static esp_err_t i2c_write_command(uint8_t address, uint8_t first, uint8_t second)
{
    const uint8_t payload[] = {first, second};
    return i2c_master_write_to_device(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        address,
        payload,
        sizeof(payload),
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
}

static esp_err_t wait_for_register_mask(uint8_t address, uint8_t reg, uint8_t mask)
{
    for (int attempt = 0; attempt < 200; ++attempt) {
        uint8_t value = 0;
        const esp_err_t err = i2c_read_register(address, reg, &value, 1);
        if (err != ESP_OK) {
            return err;
        }
        if ((value & mask) != 0) {
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    return ESP_ERR_TIMEOUT;
}

static uint8_t crc8(const uint8_t *data, size_t length)
{
    uint8_t crc = 0xFF;
    for (size_t index = 0; index < length; ++index) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

static esp_err_t sample_environment(float *temperature, float *humidity)
{
    if (i2c_probe(LAB_ADDR_GXHTC3) != ESP_OK) {
        return ESP_ERR_NOT_FOUND;
    }
    esp_err_t err = i2c_write_command(LAB_ADDR_GXHTC3, 0x35, 0x17);
    if (err != ESP_OK) {
        return err;
    }
    vTaskDelay(pdMS_TO_TICKS(2));
    err = i2c_write_command(LAB_ADDR_GXHTC3, 0x7C, 0xA2);
    if (err != ESP_OK) {
        return err;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
    uint8_t data[6] = {0};
    err = i2c_master_read_from_device(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        LAB_ADDR_GXHTC3,
        data,
        sizeof(data),
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
    i2c_write_command(LAB_ADDR_GXHTC3, 0xB0, 0x98);
    if (err != ESP_OK || crc8(data, 2) != data[2] || crc8(data + 3, 2) != data[5]) {
        return ESP_ERR_INVALID_CRC;
    }
    const uint16_t raw_temperature = ((uint16_t)data[0] << 8) | data[1];
    const uint16_t raw_humidity = ((uint16_t)data[3] << 8) | data[4];
    *temperature = 175.0f * raw_temperature / 65535.0f - 45.0f;
    *humidity = 100.0f * raw_humidity / 65535.0f;
    return ESP_OK;
}

static esp_err_t initialize_qmi(void)
{
    if (s_qmi_initialized) {
        return ESP_OK;
    }
    uint8_t id = 0;
    esp_err_t err = i2c_read_register(LAB_ADDR_QMI8658C, 0x00, &id, 1);
    if (err != ESP_OK || id != 0x05) {
        return ESP_ERR_NOT_FOUND;
    }
    if ((err = i2c_write_register(LAB_ADDR_QMI8658C, 0x60, 0xB0)) != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));
    if ((err = i2c_write_register(LAB_ADDR_QMI8658C, 0x02, 0x40)) != ESP_OK) return err;
    if ((err = i2c_write_register(LAB_ADDR_QMI8658C, 0x08, 0x03)) != ESP_OK) return err;
    if ((err = i2c_write_register(LAB_ADDR_QMI8658C, 0x03, 0x95)) != ESP_OK) return err;
    if ((err = i2c_write_register(LAB_ADDR_QMI8658C, 0x04, 0xD5)) != ESP_OK) return err;
    err = wait_for_register_mask(LAB_ADDR_QMI8658C, 0x2E, 0x03);
    if (err != ESP_OK) return err;
    uint8_t discarded_sample[12];
    err = i2c_read_register(
        LAB_ADDR_QMI8658C,
        0x35,
        discarded_sample,
        sizeof(discarded_sample)
    );
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));
    s_qmi_initialized = true;
    return ESP_OK;
}

static esp_err_t sample_motion(cJSON *motion)
{
    esp_err_t err = initialize_qmi();
    if (err != ESP_OK) {
        return err;
    }
    uint8_t raw[12] = {0};
    int16_t values[6] = {0};
    bool valid_sample = false;
    for (int attempt = 0; attempt < 200; ++attempt) {
        err = wait_for_register_mask(LAB_ADDR_QMI8658C, 0x2E, 0x03);
        if (err != ESP_OK) return err;
        err = i2c_read_register(LAB_ADDR_QMI8658C, 0x35, raw, sizeof(raw));
        if (err != ESP_OK) return err;
        bool saturated = false;
        for (size_t index = 0; index < 6; ++index) {
            values[index] = (int16_t)(
                ((uint16_t)raw[index * 2 + 1] << 8) | raw[index * 2]
            );
            saturated = saturated || values[index] == INT16_MAX || values[index] == INT16_MIN;
        }
        const bool acceleration_present =
            values[0] != 0 || values[1] != 0 || values[2] != 0;
        if (!saturated && acceleration_present) {
            valid_sample = true;
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    if (!valid_sample) return ESP_ERR_INVALID_RESPONSE;
    const float ax = values[0];
    const float ay = values[1];
    const float az = values[2];
    cJSON_AddNumberToObject(motion, "accelX", values[0]);
    cJSON_AddNumberToObject(motion, "accelY", values[1]);
    cJSON_AddNumberToObject(motion, "accelZ", values[2]);
    cJSON_AddNumberToObject(motion, "gyroX", values[3]);
    cJSON_AddNumberToObject(motion, "gyroY", values[4]);
    cJSON_AddNumberToObject(motion, "gyroZ", values[5]);
    cJSON_AddNumberToObject(motion, "roll", atan2f(ay, az) * 57.2957795f);
    cJSON_AddNumberToObject(motion, "pitch", atan2f(-ax, sqrtf(ay * ay + az * az)) * 57.2957795f);
    return ESP_OK;
}

static esp_err_t initialize_qmc(void)
{
    if (s_qmc_initialized) {
        return ESP_OK;
    }
    uint8_t id = 0;
    esp_err_t err = i2c_read_register(LAB_ADDR_QMC5883L, 0x0D, &id, 1);
    if (err != ESP_OK || id != 0xFF) {
        return ESP_ERR_NOT_FOUND;
    }
    if ((err = i2c_write_register(LAB_ADDR_QMC5883L, 0x0A, 0x80)) != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(10));
    if ((err = i2c_write_register(LAB_ADDR_QMC5883L, 0x09, 0x05)) != ESP_OK) return err;
    if ((err = i2c_write_register(LAB_ADDR_QMC5883L, 0x0A, 0x00)) != ESP_OK) return err;
    if ((err = i2c_write_register(LAB_ADDR_QMC5883L, 0x0B, 0x01)) != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(25));
    s_qmc_initialized = true;
    return ESP_OK;
}

static esp_err_t sample_compass(cJSON *compass)
{
    esp_err_t err = initialize_qmc();
    if (err != ESP_OK) {
        return err;
    }
    err = wait_for_register_mask(LAB_ADDR_QMC5883L, 0x06, 0x01);
    if (err != ESP_OK) {
        return err;
    }
    uint8_t raw[6] = {0};
    err = i2c_read_register(LAB_ADDR_QMC5883L, 0x00, raw, sizeof(raw));
    if (err != ESP_OK) {
        return err;
    }
    const int16_t x = (int16_t)(((uint16_t)raw[1] << 8) | raw[0]);
    const int16_t y = (int16_t)(((uint16_t)raw[3] << 8) | raw[2]);
    const int16_t z = (int16_t)(((uint16_t)raw[5] << 8) | raw[4]);
    float heading = atan2f((float)y, (float)x) * 57.2957795f;
    if (heading < 0) heading += 360.0f;
    cJSON_AddNumberToObject(compass, "x", x);
    cJSON_AddNumberToObject(compass, "y", y);
    cJSON_AddNumberToObject(compass, "z", z);
    cJSON_AddNumberToObject(compass, "heading", heading);
    return ESP_OK;
}

static esp_err_t sample_touch(cJSON *touch)
{
    uint8_t reg = 0x02;
    uint8_t raw[5] = {0};
    const esp_err_t err = i2c_master_write_read_device(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        LAB_ADDR_FT6336,
        &reg,
        1,
        raw,
        sizeof(raw),
        pdMS_TO_TICKS(LAB_I2C_TIMEOUT_MS)
    );
    if (err != ESP_OK) {
        return err;
    }
    const int points = raw[0] & 0x0F;
    cJSON_AddBoolToObject(touch, "pressed", points > 0);
    cJSON_AddNumberToObject(touch, "points", points);
    if (points > 0) {
        cJSON_AddNumberToObject(touch, "x", ((raw[1] & 0x0F) << 8) | raw[2]);
        cJSON_AddNumberToObject(touch, "y", ((raw[3] & 0x0F) << 8) | raw[4]);
    }
    return ESP_OK;
}

static esp_err_t configure_backlight(void)
{
    const ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 5000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    esp_err_t err = ledc_timer_config(&timer);
    if (err != ESP_OK) return err;
    const ledc_channel_config_t channel = {
        .gpio_num = LAB_LCD_BACKLIGHT_GPIO,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = LAB_BACKLIGHT_MAX_DUTY,
        .hpoint = 0,
    };
    return ledc_channel_config(&channel);
}

static esp_err_t set_brightness(int percent)
{
    if (!s_display_ready || percent < 0 || percent > 100) {
        return ESP_ERR_INVALID_ARG;
    }
    const uint32_t duty = LAB_BACKLIGHT_MAX_DUTY -
        ((uint32_t)LAB_BACKLIGHT_MAX_DUTY * (uint32_t)percent / 100U);
    esp_err_t err = ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
    if (err == ESP_OK) err = ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
    if (err == ESP_OK) s_brightness_percent = percent;
    return err;
}

static uint16_t pattern_color(const char *pattern, int x, int y)
{
    if (strcmp(pattern, "WHITE") == 0) return 0xFFFF;
    if (strcmp(pattern, "RED") == 0) return 0xF800;
    if (strcmp(pattern, "GREEN") == 0) return 0x07E0;
    if (strcmp(pattern, "BLUE") == 0) return 0x001F;
    if (strcmp(pattern, "CHECKERBOARD") == 0) return ((x / 24 + y / 24) % 2) ? 0xFFFF : 0x0000;
    if (strcmp(pattern, "COLOR_BARS") == 0) {
        static const uint16_t colors[] = {0xF800, 0xFFE0, 0x07E0, 0x07FF, 0x001F, 0xF81F, 0xFFFF, 0x0000};
        int index = x * 8 / LAB_LCD_WIDTH;
        if (index > 7) index = 7;
        return colors[index];
    }
    return 0x0000;
}

static esp_err_t draw_pattern(const char *pattern)
{
    if (!s_display_ready || pattern == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    uint16_t *buffer = heap_caps_malloc(
        LAB_LCD_WIDTH * LAB_LCD_LINES_PER_TRANSFER * sizeof(uint16_t),
        MALLOC_CAP_DMA
    );
    if (buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = ESP_OK;
    for (int y = 0; y < LAB_LCD_HEIGHT && err == ESP_OK; y += LAB_LCD_LINES_PER_TRANSFER) {
        const int lines = (LAB_LCD_HEIGHT - y) < LAB_LCD_LINES_PER_TRANSFER
            ? LAB_LCD_HEIGHT - y
            : LAB_LCD_LINES_PER_TRANSFER;
        for (int row = 0; row < lines; ++row) {
            for (int x = 0; x < LAB_LCD_WIDTH; ++x) {
                const uint16_t color = pattern_color(pattern, x, y + row);
                buffer[row * LAB_LCD_WIDTH + x] = (uint16_t)((color << 8) | (color >> 8));
            }
        }
        err = esp_lcd_panel_draw_bitmap(s_panel, 0, y, LAB_LCD_WIDTH, y + lines, buffer);
        if (err == ESP_OK &&
            xSemaphoreTake(s_lcd_transfer_done, pdMS_TO_TICKS(1000)) != pdTRUE) {
            err = ESP_ERR_TIMEOUT;
        }
    }
    free(buffer);
    if (err == ESP_OK) {
        snprintf(s_pattern, sizeof(s_pattern), "%s", pattern);
    }
    return err;
}

static esp_err_t initialize_display(void)
{
    esp_err_t err = configure_backlight();
    if (err != ESP_OK) return err;
    s_lcd_transfer_done = xSemaphoreCreateBinary();
    if (s_lcd_transfer_done == NULL) return ESP_ERR_NO_MEM;
    const spi_bus_config_t bus = {
        .sclk_io_num = LAB_LCD_SCLK_GPIO,
        .mosi_io_num = LAB_LCD_MOSI_GPIO,
        .miso_io_num = -1,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = LAB_LCD_WIDTH * LAB_LCD_LINES_PER_TRANSFER * sizeof(uint16_t),
    };
    err = spi_bus_initialize(LAB_LCD_HOST, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;
    esp_lcd_panel_io_handle_t io = NULL;
    const esp_lcd_panel_io_spi_config_t io_config = {
        .dc_gpio_num = LAB_LCD_DC_GPIO,
        .cs_gpio_num = LAB_LCD_CS_GPIO,
        .pclk_hz = 20 * 1000 * 1000,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .spi_mode = 0,
        .trans_queue_depth = 1,
        .on_color_trans_done = lcd_transfer_done_callback,
        .user_ctx = s_lcd_transfer_done,
    };
    if ((err = esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LAB_LCD_HOST, &io_config, &io)) != ESP_OK) return err;
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = -1,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
    };
    if ((err = esp_lcd_new_panel_st7789(io, &panel_config, &s_panel)) != ESP_OK) return err;
    if ((err = esp_lcd_panel_reset(s_panel)) != ESP_OK) return err;
    if ((err = esp_lcd_panel_init(s_panel)) != ESP_OK) return err;
    if ((err = esp_lcd_panel_swap_xy(s_panel, true)) != ESP_OK) return err;
    if ((err = esp_lcd_panel_mirror(s_panel, true, false)) != ESP_OK) return err;
    if ((err = esp_lcd_panel_invert_color(s_panel, true)) != ESP_OK) return err;
    s_display_ready = true;
    set_brightness(0);
    esp_lcd_panel_disp_on_off(s_panel, false);
    return ESP_OK;
}

static void add_component(cJSON *array, const char *id, const char *name, uint8_t address)
{
    cJSON *item = cJSON_CreateObject();
    if (item == NULL) return;
    char address_text[8];
    snprintf(address_text, sizeof(address_text), "0x%02X", address);
    cJSON_AddStringToObject(item, "id", id);
    cJSON_AddStringToObject(item, "name", name);
    cJSON_AddStringToObject(item, "address", address_text);
    cJSON_AddBoolToObject(item, "present", i2c_probe(address) == ESP_OK);
    cJSON_AddItemToArray(array, item);
}

static cJSON *build_snapshot(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *system = cJSON_CreateObject();
    cJSON *network = cJSON_CreateObject();
    cJSON *components = cJSON_CreateArray();
    cJSON *environment = cJSON_CreateObject();
    cJSON *motion = cJSON_CreateObject();
    cJSON *compass = cJSON_CreateObject();
    cJSON *touch = cJSON_CreateObject();
    cJSON *display = cJSON_CreateObject();
    cJSON *button = cJSON_CreateObject();
    if (!root || !system || !network || !components || !environment || !motion ||
        !compass || !touch || !display || !button) {
        cJSON_Delete(root); cJSON_Delete(system); cJSON_Delete(network); cJSON_Delete(components);
        cJSON_Delete(environment); cJSON_Delete(motion); cJSON_Delete(compass); cJSON_Delete(touch);
        cJSON_Delete(display); cJSON_Delete(button);
        return NULL;
    }

    cJSON_AddNumberToObject(system, "uptimeMs", (double)(esp_timer_get_time() / 1000));
    cJSON_AddNumberToObject(system, "freeHeapBytes", esp_get_free_heap_size());
    cJSON_AddNumberToObject(system, "minimumFreeHeapBytes", esp_get_minimum_free_heap_size());
    cJSON_AddStringToObject(system, "firmwareVersion", DX_FIRMWARE_VERSION);
    char ip[16] = "-";
    int rssi = 0;
    if (wifi_manager_get_network_info(ip, sizeof(ip), &rssi) == ESP_OK) {
        cJSON_AddStringToObject(network, "ip", ip);
        cJSON_AddNumberToObject(network, "rssi", rssi);
    }

    add_component(components, "es8311", "ES8311 音频Codec", LAB_ADDR_ES8311);
    add_component(components, "qmc5883l", "QMC5883L 电子罗盘", LAB_ADDR_QMC5883L);
    add_component(components, "ft6336", "FT6336 电容触摸", LAB_ADDR_FT6336);
    add_component(components, "qmi8658c", "QMI8658C 六轴传感器", LAB_ADDR_QMI8658C);
    add_component(components, "gxhtc3", "GXHTC3 温湿度", LAB_ADDR_GXHTC3);

    float temperature = 0;
    float humidity = 0;
    const esp_err_t environment_err = sample_environment(&temperature, &humidity);
    cJSON_AddBoolToObject(environment, "available", environment_err == ESP_OK);
    if (environment_err == ESP_OK) {
        cJSON_AddNumberToObject(environment, "temperatureC", temperature);
        cJSON_AddNumberToObject(environment, "humidityPercent", humidity);
    }
    const esp_err_t motion_err = sample_motion(motion);
    cJSON_AddBoolToObject(motion, "available", motion_err == ESP_OK);
    const esp_err_t compass_err = sample_compass(compass);
    cJSON_AddBoolToObject(compass, "available", compass_err == ESP_OK);
    const esp_err_t touch_err = sample_touch(touch);
    cJSON_AddBoolToObject(touch, "available", touch_err == ESP_OK);
    cJSON_AddBoolToObject(button, "pressed", gpio_get_level((gpio_num_t)DX_LICHUANG_RECORD_BUTTON_GPIO) == 0);
    cJSON_AddBoolToObject(display, "available", s_display_ready);
    cJSON_AddBoolToObject(display, "on", s_display_on);
    cJSON_AddNumberToObject(display, "brightnessPercent", s_brightness_percent);
    cJSON_AddStringToObject(display, "pattern", s_pattern);

    cJSON_AddItemToObject(root, "system", system);
    cJSON_AddItemToObject(root, "network", network);
    cJSON_AddItemToObject(root, "components", components);
    cJSON_AddItemToObject(root, "environment", environment);
    cJSON_AddItemToObject(root, "motion", motion);
    cJSON_AddItemToObject(root, "compass", compass);
    cJSON_AddItemToObject(root, "touch", touch);
    cJSON_AddItemToObject(root, "button", button);
    cJSON_AddItemToObject(root, "display", display);
    return root;
}

void board_lab_init(void)
{
    const esp_err_t err = initialize_display();
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Board lab ready; LCD remains off until an explicit command");
    } else {
        ESP_LOGE(TAG, "Board lab display initialization failed: %s", esp_err_to_name(err));
    }
}

void board_lab_preinit(void)
{
    const gpio_config_t backlight = {
        .pin_bit_mask = 1ULL << LAB_LCD_BACKLIGHT_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&backlight) == ESP_OK) {
        gpio_set_level(LAB_LCD_BACKLIGHT_GPIO, 1);
    }
}

esp_err_t board_lab_execute(
    const char *action,
    const cJSON *params,
    cJSON **result,
    char *message,
    size_t message_size
)
{
    if (action == NULL || result == NULL || message == NULL || message_size == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    *result = NULL;
    if (strcmp(action, "snapshot") == 0) {
        *result = build_snapshot();
        snprintf(message, message_size, "Board snapshot completed");
        return *result == NULL ? ESP_ERR_NO_MEM : ESP_OK;
    }
    if (strcmp(action, "display_pattern") == 0) {
        const cJSON *pattern = cJSON_GetObjectItemCaseSensitive(params, "pattern");
        const cJSON *brightness = cJSON_GetObjectItemCaseSensitive(params, "brightnessPercent");
        if (!cJSON_IsString(pattern) || pattern->valuestring == NULL) return ESP_ERR_INVALID_ARG;
        const char *allowed[] = {"BLACK", "WHITE", "RED", "GREEN", "BLUE", "CHECKERBOARD", "COLOR_BARS"};
        bool valid = false;
        for (size_t index = 0; index < sizeof(allowed) / sizeof(allowed[0]); ++index) {
            if (strcmp(pattern->valuestring, allowed[index]) == 0) valid = true;
        }
        if (!valid) return ESP_ERR_INVALID_ARG;
        int target_brightness = cJSON_IsNumber(brightness) ? brightness->valueint : s_brightness_percent;
        if (target_brightness < 0 || target_brightness > 100) return ESP_ERR_INVALID_ARG;
        esp_err_t err = esp_lcd_panel_disp_on_off(s_panel, true);
        if (err == ESP_OK) err = draw_pattern(pattern->valuestring);
        if (err == ESP_OK) err = set_brightness(target_brightness);
        if (err != ESP_OK) return err;
        s_display_on = true;
        *result = build_snapshot();
        snprintf(message, message_size, "Display pattern applied");
        return *result == NULL ? ESP_ERR_NO_MEM : ESP_OK;
    }
    if (strcmp(action, "display_power") == 0) {
        const cJSON *enabled = cJSON_GetObjectItemCaseSensitive(params, "enabled");
        const cJSON *brightness = cJSON_GetObjectItemCaseSensitive(params, "brightnessPercent");
        if (!cJSON_IsBool(enabled) || !s_display_ready) return ESP_ERR_INVALID_ARG;
        int target_brightness = cJSON_IsNumber(brightness) ? brightness->valueint : s_brightness_percent;
        if (target_brightness < 0 || target_brightness > 100) return ESP_ERR_INVALID_ARG;
        const bool turn_on = cJSON_IsTrue(enabled);
        esp_err_t err = set_brightness(turn_on ? target_brightness : 0);
        if (err == ESP_OK) err = esp_lcd_panel_disp_on_off(s_panel, turn_on);
        if (err != ESP_OK) return err;
        s_display_on = turn_on;
        if (turn_on) s_brightness_percent = target_brightness;
        *result = build_snapshot();
        snprintf(message, message_size, "Display power updated");
        return *result == NULL ? ESP_ERR_NO_MEM : ESP_OK;
    }
    return ESP_ERR_NOT_SUPPORTED;
}

#else

void board_lab_init(void)
{
}

void board_lab_preinit(void)
{
}

esp_err_t board_lab_execute(
    const char *action,
    const cJSON *params,
    cJSON **result,
    char *message,
    size_t message_size
)
{
    (void)action; (void)params; (void)result; (void)message; (void)message_size;
    return ESP_ERR_NOT_SUPPORTED;
}

#endif
