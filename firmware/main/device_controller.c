#include "device_controller.h"

#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "app_config.h"
#include "device_state.h"
#include "direct_control_hal.h"
#include "mqtt_agent.h"

static const char *TAG = "DEVICE_CONTROLLER";
static SemaphoreHandle_t s_mutex;
static bool s_ready;
static int64_t s_heater_started_us;
static int64_t s_active_started_us;
static int64_t s_cooldown_until_us;
static int64_t s_timer_until_us;
static int64_t s_dry_started_us;

static void monitor_task(void *arg);
static void set_result(
    dx_control_result_t *result,
    dx_control_status_t status,
    const char *code,
    const char *message
);
static void recompute_power(dx_device_state_t *state);
static esp_err_t apply_and_publish_state(
    const dx_device_state_t *next,
    dx_control_result_t *result
);
static esp_err_t apply_action(
    const dx_cloud_action_t *action,
    dx_device_state_t *state,
    dx_control_result_t *result
);
static void begin_cooldown_if_needed(
    bool heater_was_active,
    dx_device_state_t *state
);

esp_err_t device_controller_init(void)
{
    if (s_ready) {
        return ESP_OK;
    }
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = direct_control_hal_init();
    if (err != ESP_OK) {
        return err;
    }

    dx_device_state_t initial;
    ESP_RETURN_ON_ERROR(device_state_get(&initial), TAG, "could not read initial state");
    initial.power = false;
    initial.light = false;
    initial.heater = DX_HEATER_OFF;
    initial.ventilation = false;
    initial.fan = false;
    initial.swing = false;
    initial.dry = false;
    initial.bath_mode = false;
    initial.constant_temperature = false;
    initial.target_temperature = 40;
    initial.running_minutes = 0;
    initial.fault_code[0] = '\0';
    ESP_RETURN_ON_ERROR(direct_control_hal_apply(&initial), TAG, "safe output initialization failed");
    ESP_RETURN_ON_ERROR(device_state_update(&initial), TAG, "initial state update failed");

    s_ready = true;
    if (xTaskCreate(monitor_task, "control_monitor", 4096, NULL, 6, NULL) != pdPASS) {
        s_ready = false;
        (void)direct_control_hal_emergency_shutdown();
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "Unified direct controller ready via %s", direct_control_hal_execution_path());
    return ESP_OK;
}

esp_err_t device_controller_execute(
    const dx_cloud_action_t *action,
    dx_control_result_t *out_result
)
{
    if (!s_ready || action == NULL || out_result == NULL ||
        action->code == NULL || action->value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(out_result, 0, sizeof(*out_result));
    snprintf(
        out_result->execution_path,
        sizeof(out_result->execution_path),
        "%s",
        direct_control_hal_execution_path()
    );

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    dx_device_state_t state;
    esp_err_t err = device_state_get(&state);
    if (err == ESP_OK) {
        err = apply_action(action, &state, out_result);
    }
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t device_controller_emergency_stop(const char *fault_code)
{
    if (!s_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t hal_err = direct_control_hal_emergency_shutdown();
    dx_device_state_t state;
    esp_err_t state_err = device_state_get(&state);
    if (state_err == ESP_OK) {
        state.power = false;
        state.light = false;
        state.heater = DX_HEATER_OFF;
        state.ventilation = false;
        state.fan = false;
        state.swing = false;
        state.dry = false;
        state.bath_mode = false;
        state.constant_temperature = false;
        snprintf(
            state.fault_code,
            sizeof(state.fault_code),
            "%s",
            fault_code == NULL ? "E000_EMERGENCY_STOP" : fault_code
        );
        state_err = device_state_update(&state);
        if (state_err == ESP_OK) {
            (void)mqtt_agent_report_state();
        }
    }
    s_heater_started_us = 0;
    s_active_started_us = 0;
    s_cooldown_until_us = 0;
    s_timer_until_us = 0;
    s_dry_started_us = 0;
    xSemaphoreGive(s_mutex);
    return hal_err != ESP_OK ? hal_err : state_err;
}

static esp_err_t apply_action(
    const dx_cloud_action_t *action,
    dx_device_state_t *state,
    dx_control_result_t *result
)
{
    const int64_t now = esp_timer_get_time();
    const bool heater_was_active = state->heater != DX_HEATER_OFF;
    const bool bath_command = strcmp(action->code, "bath") == 0;
    const bool constant_command = strcmp(action->code, "constantTemperature") == 0;
    bool mode_enable_requested = false;
    dx_cloud_action_t normalized_action = *action;

    if (bath_command || constant_command) {
        if (strcmp(action->value, "on") != 0 &&
            strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "模式命令只接受 on/off");
            return ESP_OK;
        }
        mode_enable_requested = strcmp(action->value, "on") == 0;
        if (constant_command && mode_enable_requested && !DX_ENABLE_NTC_CONTROL) {
            set_result(
                result,
                DX_CONTROL_REJECTED,
                "SENSOR_NOT_READY",
                "NTC驱动和标定未完成，暂不允许启动恒温"
            );
            return ESP_OK;
        }
        normalized_action.code = "heater";
        normalized_action.value = mode_enable_requested ? "weak" : "off";
        action = &normalized_action;
    }

    if (strcmp(action->code, "light") == 0) {
        if (strcmp(action->value, "on") == 0) {
            state->light = true;
        } else if (strcmp(action->value, "off") == 0) {
            state->light = false;
        } else {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "照明只接受 on/off");
            return ESP_OK;
        }
    } else if (strcmp(action->code, "heater") == 0) {
        if (strcmp(action->value, "weak") != 0 &&
            strcmp(action->value, "strong") != 0 &&
            strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "取暖只接受 weak/strong/off");
            return ESP_OK;
        }
        if (strcmp(action->value, "off") != 0 && state->fault_code[0] != '\0') {
            set_result(result, DX_CONTROL_REJECTED, "FAULT_LOCKED", "设备故障锁定期间禁止开启取暖");
            return ESP_OK;
        }
        if (strcmp(action->value, "off") == 0) {
            state->heater = DX_HEATER_OFF;
            s_heater_started_us = 0;
            begin_cooldown_if_needed(heater_was_active, state);
        } else {
            state->dry = false;
            s_dry_started_us = 0;
            if (!state->fan) {
                dx_device_state_t fan_first = *state;
                fan_first.fan = true;
                fan_first.ventilation = false;
                recompute_power(&fan_first);
                esp_err_t err = direct_control_hal_apply(&fan_first);
                if (err != ESP_OK) {
                    (void)direct_control_hal_emergency_shutdown();
                    set_result(result, DX_CONTROL_FAILED, "HAL_WRITE_FAILED", "风机预启动失败，取暖未开启");
                    return err;
                }
                err = device_state_update(&fan_first);
                if (err != ESP_OK) {
                    (void)direct_control_hal_emergency_shutdown();
                    dx_device_state_t failed = fan_first;
                    failed.power = false;
                    failed.light = false;
                    failed.heater = DX_HEATER_OFF;
                    failed.ventilation = false;
                    failed.fan = false;
                    failed.swing = false;
                    failed.dry = false;
                    snprintf(
                        failed.fault_code,
                        sizeof(failed.fault_code),
                        "E004_STATE_SYNC"
                    );
                    if (device_state_update(&failed) == ESP_OK) {
                        (void)mqtt_agent_report_state();
                    }
                    set_result(
                        result,
                        DX_CONTROL_FAILED,
                        "STATE_UPDATE_FAILED",
                        "风机已预启动但状态更新失败，已紧急关断"
                    );
                    return err;
                }
                (void)mqtt_agent_report_state();
                *state = fan_first;
                vTaskDelay(pdMS_TO_TICKS(DX_FAN_PREHEAT_DELAY_MS));
            }
            state->ventilation = false;
            state->fan = true;
            state->heater = strcmp(action->value, "strong") == 0
                ? DX_HEATER_STRONG
                : DX_HEATER_WEAK;
            if (!heater_was_active) {
                s_heater_started_us = now;
            }
            s_cooldown_until_us = 0;
        }
        if (bath_command) {
            state->bath_mode = mode_enable_requested;
            state->constant_temperature = false;
        } else if (constant_command) {
            state->bath_mode = false;
            state->constant_temperature = mode_enable_requested;
        } else {
            state->bath_mode = false;
            state->constant_temperature = false;
        }
    } else if (strcmp(action->code, "ventilation") == 0) {
        bool enabled = strcmp(action->value, "on") == 0;
        if (!enabled && strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "换气只接受 on/off");
            return ESP_OK;
        }
        if (enabled && heater_was_active) {
            set_result(result, DX_CONTROL_REJECTED, "HEATER_INTERLOCK", "取暖运行时不能直接切换到换气");
            return ESP_OK;
        }
        if (enabled && s_cooldown_until_us > now) {
            set_result(result, DX_CONTROL_REJECTED, "COOLDOWN_INTERLOCK", "取暖散热期间不能切换到换气");
            return ESP_OK;
        }
        state->ventilation = enabled;
        if (enabled) {
            state->fan = false;
            state->dry = false;
            state->bath_mode = false;
            state->constant_temperature = false;
            s_dry_started_us = 0;
        }
    } else if (strcmp(action->code, "fan") == 0) {
        bool enabled = strcmp(action->value, "on") == 0;
        if (!enabled && strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "吹风只接受 on/off");
            return ESP_OK;
        }
        if (!enabled && (heater_was_active || s_cooldown_until_us > now)) {
            set_result(result, DX_CONTROL_REJECTED, "COOLDOWN_INTERLOCK", "取暖或散热期间不能关闭风机");
            return ESP_OK;
        }
        state->fan = enabled;
        state->dry = false;
        s_dry_started_us = 0;
        if (enabled) {
            state->ventilation = false;
        }
    } else if (strcmp(action->code, "swing") == 0) {
        bool enabled = strcmp(action->value, "on") == 0;
        if (!enabled && strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "摆风只接受 on/off");
            return ESP_OK;
        }
        if (enabled && !state->fan && !state->ventilation && !state->dry) {
            set_result(result, DX_CONTROL_REJECTED, "AIRFLOW_REQUIRED", "开启摆风前必须先开启风路");
            return ESP_OK;
        }
        state->swing = enabled;
    } else if (strcmp(action->code, "dry") == 0) {
        bool enabled = strcmp(action->value, "on") == 0;
        if (!enabled && strcmp(action->value, "off") != 0) {
            set_result(result, DX_CONTROL_REJECTED, "INVALID_VALUE", "干燥只接受 on/off");
            return ESP_OK;
        }
        if (enabled) {
            if (heater_was_active) {
                state->heater = DX_HEATER_OFF;
                s_heater_started_us = 0;
                begin_cooldown_if_needed(true, state);
            }
            if (!state->dry) {
                s_dry_started_us = now;
            }
            state->dry = true;
            state->bath_mode = false;
            state->constant_temperature = false;
            state->fan = true;
            state->ventilation = false;
        } else {
            state->dry = false;
            s_dry_started_us = 0;
            if (s_cooldown_until_us <= now && state->heater == DX_HEATER_OFF) {
                state->fan = false;
            }
        }
    } else if (strcmp(action->code, "temperature") == 0) {
        if (action->target_temperature < 30 || action->target_temperature > 45) {
            set_result(result, DX_CONTROL_REJECTED, "TEMPERATURE_RANGE", "目标温度范围为30至45摄氏度");
            return ESP_OK;
        }
        state->target_temperature = (int16_t)action->target_temperature;
    } else if (strcmp(action->code, "timer") == 0) {
        if (action->duration_minutes <= 0 || action->duration_minutes > 120) {
            set_result(result, DX_CONTROL_REJECTED, "TIMER_RANGE", "定时范围为1至120分钟");
            return ESP_OK;
        }
        s_timer_until_us = now + (int64_t)action->duration_minutes * 60 * 1000000;
    } else if (strcmp(action->code, "standby") == 0) {
        state->light = false;
        state->heater = DX_HEATER_OFF;
        state->ventilation = false;
        state->swing = false;
        state->dry = false;
        state->bath_mode = false;
        state->constant_temperature = false;
        begin_cooldown_if_needed(heater_was_active, state);
        if (!heater_was_active && s_cooldown_until_us <= now) {
            state->fan = false;
        }
        s_heater_started_us = 0;
        s_timer_until_us = 0;
        s_dry_started_us = 0;
    } else {
        set_result(result, DX_CONTROL_REJECTED, "UNSUPPORTED", "当前固件不支持该控制动作");
        return ESP_OK;
    }

    recompute_power(state);
    if (state->power && s_active_started_us == 0) {
        s_active_started_us = now;
    } else if (!state->power) {
        s_active_started_us = 0;
        state->running_minutes = 0;
    }
    return apply_and_publish_state(state, result);
}

static esp_err_t apply_and_publish_state(
    const dx_device_state_t *next,
    dx_control_result_t *result
)
{
    esp_err_t err = direct_control_hal_apply(next);
    if (err != ESP_OK) {
        (void)direct_control_hal_emergency_shutdown();
        dx_device_state_t failed = *next;
        failed.power = false;
        failed.light = false;
        failed.heater = DX_HEATER_OFF;
        failed.ventilation = false;
        failed.fan = false;
        failed.swing = false;
        failed.dry = false;
        failed.bath_mode = false;
        failed.constant_temperature = false;
        snprintf(failed.fault_code, sizeof(failed.fault_code), "E003_IO_EXPANDER");
        if (device_state_update(&failed) == ESP_OK) {
            (void)mqtt_agent_report_state();
        }
        s_heater_started_us = 0;
        s_active_started_us = 0;
        s_cooldown_until_us = 0;
        s_timer_until_us = 0;
        s_dry_started_us = 0;
        set_result(result, DX_CONTROL_FAILED, "HAL_WRITE_FAILED", "板级输出失败，已执行紧急关断");
        return err;
    }
    esp_err_t state_err = device_state_update(next);
    if (state_err != ESP_OK) {
        (void)direct_control_hal_emergency_shutdown();
        dx_device_state_t failed = *next;
        failed.power = false;
        failed.light = false;
        failed.heater = DX_HEATER_OFF;
        failed.ventilation = false;
        failed.fan = false;
        failed.swing = false;
        failed.dry = false;
        failed.bath_mode = false;
        failed.constant_temperature = false;
        snprintf(failed.fault_code, sizeof(failed.fault_code), "E004_STATE_SYNC");
        if (device_state_update(&failed) == ESP_OK) {
            (void)mqtt_agent_report_state();
        }
        s_heater_started_us = 0;
        s_active_started_us = 0;
        s_cooldown_until_us = 0;
        s_timer_until_us = 0;
        s_dry_started_us = 0;
        set_result(result, DX_CONTROL_FAILED, "STATE_UPDATE_FAILED", "状态更新失败，已紧急关断");
        return state_err;
    }
    (void)mqtt_agent_report_state();
    set_result(result, DX_CONTROL_APPLIED, "APPLIED", "命令已通过本地安全状态机执行");
    return ESP_OK;
}

static void monitor_task(void *arg)
{
    (void)arg;
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
            continue;
        }
        if (direct_control_hal_health_check() != ESP_OK) {
            (void)direct_control_hal_emergency_shutdown();
            dx_device_state_t failed;
            if (device_state_get(&failed) == ESP_OK) {
                failed.power = false;
                failed.light = false;
                failed.heater = DX_HEATER_OFF;
                failed.ventilation = false;
                failed.fan = false;
                failed.swing = false;
                failed.dry = false;
                failed.bath_mode = false;
                failed.constant_temperature = false;
                snprintf(failed.fault_code, sizeof(failed.fault_code), "E003_IO_EXPANDER");
                (void)device_state_update(&failed);
                (void)mqtt_agent_report_state();
            }
            s_heater_started_us = 0;
            s_active_started_us = 0;
            s_cooldown_until_us = 0;
            s_timer_until_us = 0;
            s_dry_started_us = 0;
            xSemaphoreGive(s_mutex);
            continue;
        }

        const int64_t now = esp_timer_get_time();
        dx_device_state_t state;
        if (device_state_get(&state) != ESP_OK) {
            xSemaphoreGive(s_mutex);
            continue;
        }
        bool changed = false;
        if (s_heater_started_us > 0 &&
            now - s_heater_started_us >=
                (int64_t)DX_HEATER_MAX_CONTINUOUS_MINUTES * 60 * 1000000) {
            state.heater = DX_HEATER_OFF;
            state.fan = true;
            state.bath_mode = false;
            state.constant_temperature = false;
            s_heater_started_us = 0;
            s_cooldown_until_us = now + (int64_t)DX_FAN_COOLDOWN_SECONDS * 1000000;
            changed = true;
        }
        if (s_timer_until_us > 0 && now >= s_timer_until_us) {
            bool had_heat = state.heater != DX_HEATER_OFF;
            state.light = false;
            state.heater = DX_HEATER_OFF;
            state.ventilation = false;
            state.swing = false;
            state.dry = false;
            state.bath_mode = false;
            state.constant_temperature = false;
            begin_cooldown_if_needed(had_heat, &state);
            if (!had_heat) {
                state.fan = false;
            }
            s_timer_until_us = 0;
            s_heater_started_us = 0;
            s_dry_started_us = 0;
            changed = true;
        }
        if (s_cooldown_until_us > 0 && now >= s_cooldown_until_us &&
            state.heater == DX_HEATER_OFF && !state.dry) {
            state.fan = false;
            s_cooldown_until_us = 0;
            changed = true;
        }
        if (s_dry_started_us > 0 &&
            now - s_dry_started_us >=
                (int64_t)DX_DRY_MAX_MINUTES * 60 * 1000000) {
            state.dry = false;
            s_dry_started_us = 0;
            if (state.heater == DX_HEATER_OFF && s_cooldown_until_us <= now) {
                state.fan = false;
            }
            changed = true;
        }
        if (state.power && s_active_started_us > 0) {
            uint32_t minutes = (uint32_t)((now - s_active_started_us) / 60000000);
            if (minutes != state.running_minutes) {
                state.running_minutes = minutes;
                changed = true;
            }
        }
        if (changed) {
            recompute_power(&state);
            if (direct_control_hal_apply(&state) == ESP_OK) {
                if (device_state_update(&state) == ESP_OK) {
                    (void)mqtt_agent_report_state();
                } else {
                    (void)direct_control_hal_emergency_shutdown();
                    state.power = false;
                    state.light = false;
                    state.heater = DX_HEATER_OFF;
                    state.ventilation = false;
                    state.fan = false;
                    state.swing = false;
                    state.dry = false;
                    state.bath_mode = false;
                    state.constant_temperature = false;
                    snprintf(
                        state.fault_code,
                        sizeof(state.fault_code),
                        "E004_STATE_SYNC"
                    );
                    if (device_state_update(&state) == ESP_OK) {
                        (void)mqtt_agent_report_state();
                    }
                    s_heater_started_us = 0;
                    s_active_started_us = 0;
                    s_cooldown_until_us = 0;
                    s_timer_until_us = 0;
                    s_dry_started_us = 0;
                }
            } else {
                (void)direct_control_hal_emergency_shutdown();
                state.power = false;
                state.light = false;
                state.heater = DX_HEATER_OFF;
                state.ventilation = false;
                state.fan = false;
                state.swing = false;
                state.dry = false;
                state.bath_mode = false;
                state.constant_temperature = false;
                snprintf(state.fault_code, sizeof(state.fault_code), "E003_IO_EXPANDER");
                (void)device_state_update(&state);
                (void)mqtt_agent_report_state();
                s_heater_started_us = 0;
                s_active_started_us = 0;
                s_cooldown_until_us = 0;
                s_timer_until_us = 0;
                s_dry_started_us = 0;
            }
        }
        xSemaphoreGive(s_mutex);
    }
}

static void set_result(
    dx_control_result_t *result,
    dx_control_status_t status,
    const char *code,
    const char *message
)
{
    result->status = status;
    snprintf(result->code, sizeof(result->code), "%s", code);
    snprintf(result->message, sizeof(result->message), "%s", message);
}

static void recompute_power(dx_device_state_t *state)
{
    state->power = state->light || state->heater != DX_HEATER_OFF ||
        state->ventilation || state->fan || state->swing || state->dry;
}

static void begin_cooldown_if_needed(
    bool heater_was_active,
    dx_device_state_t *state
)
{
    if (!heater_was_active) {
        return;
    }
    state->fan = true;
    s_cooldown_until_us = esp_timer_get_time() +
        (int64_t)DX_FAN_COOLDOWN_SECONDS * 1000000;
}
