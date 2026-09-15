#include "direct_control_hal.h"

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"

#include "app_config.h"
#include "pcf8574.h"

static const char *TAG = "DIRECT_HAL";
static bool s_ready;

enum {
    LOAD_LIGHT = 0,
    LOAD_FAN = 1,
    LOAD_VENTILATION = 2,
    LOAD_HEAT_WEAK = 3,
    LOAD_HEAT_STRONG = 4,
};

#if DX_ENABLE_PCF8574
static esp_err_t set_load_enable(bool enabled);
static void set_active_low(uint8_t *value, uint8_t bit, bool active);
#endif

esp_err_t direct_control_hal_init(void)
{
#if !DX_ENABLE_PCF8574
    s_ready = true;
    ESP_LOGW(TAG, "Virtual HAL active; no physical load can be energized");
    return ESP_OK;
#else
    if (DX_LOAD_ENABLE_GPIO < 0 || DX_PCF8574_I2C_SDA_GPIO < 0 ||
        DX_PCF8574_I2C_SCL_GPIO < 0) {
        ESP_LOGE(TAG, "Production PCF8574 pins are not configured");
        return ESP_ERR_INVALID_ARG;
    }

    gpio_config_t enable_config = {
        .pin_bit_mask = 1ULL << DX_LOAD_ENABLE_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&enable_config), TAG, "load-enable GPIO config failed");
    ESP_RETURN_ON_ERROR(set_load_enable(false), TAG, "load-enable safe state failed");

    const dx_pcf8574_config_t config = {
        .port = (i2c_port_t)DX_PCF8574_I2C_PORT,
        .sda_gpio = DX_PCF8574_I2C_SDA_GPIO,
        .scl_gpio = DX_PCF8574_I2C_SCL_GPIO,
        .frequency_hz = DX_PCF8574_I2C_FREQUENCY_HZ,
        .addresses = {
            DX_PCF8574_ADDRESS_0,
            DX_PCF8574_ADDRESS_1,
            DX_PCF8574_ADDRESS_2,
        },
        .device_count = 3,
        .enable_internal_pullups = false,
    };
    esp_err_t err = dx_pcf8574_init(&config);
    if (err != ESP_OK) {
        (void)set_load_enable(false);
        return err;
    }
    err = dx_pcf8574_all_off();
    if (err != ESP_OK) {
        (void)set_load_enable(false);
        return err;
    }
    s_ready = true;
    ESP_LOGI(TAG, "PCF8574 direct-control HAL ready; load enable remains off");
    return ESP_OK;
#endif
}

esp_err_t direct_control_hal_apply(const dx_device_state_t *state)
{
    if (!s_ready || state == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (state->heater != DX_HEATER_OFF && !state->fan) {
        return ESP_ERR_INVALID_ARG;
    }

#if !DX_ENABLE_PCF8574
    ESP_LOGI(
        TAG,
        "Virtual outputs: light=%d fan=%d ventilation=%d heater=%d swing=%d dry=%d",
        state->light,
        state->fan,
        state->ventilation,
        state->heater,
        state->swing,
        state->dry
    );
    return ESP_OK;
#else
    /* Swing motor phases remain off until the motor model and sequence are frozen. */
    if (state->swing) {
        return ESP_ERR_NOT_SUPPORTED;
    }

    uint8_t load_bank = 0xFF;
    uint8_t auxiliary_bank = 0xFF;
    set_active_low(&load_bank, LOAD_LIGHT, state->light);
    set_active_low(&load_bank, LOAD_FAN, state->fan);
    set_active_low(&load_bank, LOAD_VENTILATION, state->ventilation);
    set_active_low(&load_bank, LOAD_HEAT_WEAK, state->heater == DX_HEATER_WEAK);
    set_active_low(&load_bank, LOAD_HEAT_STRONG, state->heater == DX_HEATER_STRONG);

    esp_err_t err = dx_pcf8574_write(0, load_bank);
    if (err == ESP_OK) {
        err = dx_pcf8574_write(1, auxiliary_bank);
    }
    if (err != ESP_OK) {
        (void)set_load_enable(false);
        return err;
    }

    bool any_output = load_bank != 0xFF || auxiliary_bank != 0xFF;
    err = set_load_enable(any_output);
    if (err != ESP_OK) {
        (void)set_load_enable(false);
    }
    return err;
#endif
}

esp_err_t direct_control_hal_emergency_shutdown(void)
{
#if !DX_ENABLE_PCF8574
    ESP_LOGW(TAG, "Virtual emergency shutdown applied");
    return ESP_OK;
#else
    esp_err_t enable_err = set_load_enable(false);
    esp_err_t pcf_err = dx_pcf8574_all_off();
    return enable_err != ESP_OK ? enable_err : pcf_err;
#endif
}

esp_err_t direct_control_hal_health_check(void)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
#if !DX_ENABLE_PCF8574
    return ESP_OK;
#else
    return dx_pcf8574_health_check();
#endif
}

bool direct_control_hal_is_virtual(void)
{
#if DX_ENABLE_PCF8574
    return false;
#else
    return true;
#endif
}

const char *direct_control_hal_execution_path(void)
{
    return direct_control_hal_is_virtual() ? "LOCAL_VIRTUAL" : "LOCAL_PCF8574";
}

#if DX_ENABLE_PCF8574
static esp_err_t set_load_enable(bool enabled)
{
    int level = enabled
        ? DX_LOAD_ENABLE_ACTIVE_LEVEL
        : !DX_LOAD_ENABLE_ACTIVE_LEVEL;
    return gpio_set_level((gpio_num_t)DX_LOAD_ENABLE_GPIO, level);
}

static void set_active_low(uint8_t *value, uint8_t bit, bool active)
{
    if (active) {
        *value &= (uint8_t)~(1U << bit);
    }
}
#endif
