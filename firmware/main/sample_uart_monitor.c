#include "sample_uart_monitor.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "app_config.h"
#include "device_state.h"
#include "mqtt_agent.h"
#include "stm32_protocol.h"
#include "stm32_protocol_self_test.h"

static const char *TAG = "STM32_UART";

#if DX_ENABLE_SAMPLE_UART_MONITOR
static bool s_ready;
static uint32_t s_network_status_requests;
static SemaphoreHandle_t s_command_mutex;
static SemaphoreHandle_t s_tx_mutex;
static SemaphoreHandle_t s_ack_signal;
static portMUX_TYPE s_ack_lock = portMUX_INITIALIZER_UNLOCKED;
static bool s_ack_pending;
static bool s_ack_matches;
static uint8_t s_pending_command;
static uint8_t s_pending_value;

static void monitor_task(void *arg);
static void handle_status_frame(const uint8_t frame[DX_STM32_FRAME_SIZE]);
static void log_status_frame(
    const uint8_t frame[DX_STM32_FRAME_SIZE],
    const dx_stm32_status_t *status
);
static bool apply_status_to_device_state(const dx_stm32_status_t *status);
static bool status_matches_request(
    const dx_stm32_status_t *status,
    uint8_t command,
    uint8_t value
);
static esp_err_t write_frame(const uint8_t frame[DX_STM32_FRAME_SIZE]);
static esp_err_t map_action_to_request(
    const char *code,
    const char *value,
    int target_temperature,
    int duration_minutes,
    dx_stm32_command_request_t *request,
    int *required_stage
);
static void reply_network_status(void);
#endif

esp_err_t sample_uart_monitor_init(void)
{
#if !DX_ENABLE_SAMPLE_UART_MONITOR
    ESP_LOGI(TAG, "STM32 sample UART adapter disabled by configuration");
    return ESP_OK;
#else
#if DX_ENABLE_UART_BRIDGE
#error "The STM32 sample adapter and legacy UART bridge cannot share UART1"
#endif
    if (s_ready) {
        return ESP_OK;
    }

#if DX_ENABLE_STM32_PROTOCOL_SELF_TEST
    if (!dx_stm32_protocol_self_test()) {
        ESP_LOGE(TAG, "STM32 protocol self-test failed; UART adapter not started");
        return ESP_ERR_INVALID_RESPONSE;
    }
    ESP_LOGI(TAG, "STM32 protocol self-test passed (captured frame, checksum, TX builder, resync)");
#endif

    s_command_mutex = xSemaphoreCreateMutex();
    s_tx_mutex = xSemaphoreCreateMutex();
    s_ack_signal = xSemaphoreCreateBinary();
    if (s_command_mutex == NULL || s_tx_mutex == NULL || s_ack_signal == NULL) {
        return ESP_ERR_NO_MEM;
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
        const int tx_gpio = DX_STM32_CONTROL_STAGE > 0
            ? DX_SAMPLE_UART_TX_GPIO
            : UART_PIN_NO_CHANGE;
        err = uart_set_pin(
            UART_NUM_1,
            tx_gpio,
            DX_SAMPLE_UART_RX_GPIO,
            UART_PIN_NO_CHANGE,
            UART_PIN_NO_CHANGE
        );
    }
    if (err == ESP_OK) {
        err = uart_driver_install(UART_NUM_1, 1024, 0, 0, NULL, 0);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "STM32 UART initialization failed: %s", esp_err_to_name(err));
        return err;
    }

    s_ready = true;
    if (xTaskCreate(monitor_task, "stm32_uart_rx", 4096, NULL, 5, NULL) != pdPASS) {
        s_ready = false;
        uart_driver_delete(UART_NUM_1);
        return ESP_ERR_NO_MEM;
    }

    if (DX_STM32_CONTROL_STAGE > 0) {
        ESP_LOGI(
            TAG,
            "STM32 UART adapter ready: TX=GPIO%d RX=GPIO%d, %d 8N1, control stage=%d",
            DX_SAMPLE_UART_TX_GPIO,
            DX_SAMPLE_UART_RX_GPIO,
            DX_SAMPLE_UART_BAUD_RATE,
            DX_STM32_CONTROL_STAGE
        );
    } else {
        ESP_LOGI(
            TAG,
            "STM32 receive-only monitor ready: RX=GPIO%d, %d 8N1",
            DX_SAMPLE_UART_RX_GPIO,
            DX_SAMPLE_UART_BAUD_RATE
        );
    }
    return ESP_OK;
#endif
}

bool sample_uart_monitor_is_control_ready(void)
{
#if DX_ENABLE_SAMPLE_UART_MONITOR
    return s_ready && DX_STM32_CONTROL_STAGE > 0;
#else
    return false;
#endif
}

int sample_uart_monitor_control_stage(void)
{
#if DX_ENABLE_SAMPLE_UART_MONITOR
    return DX_STM32_CONTROL_STAGE;
#else
    return 0;
#endif
}

esp_err_t sample_uart_monitor_execute_action(
    const char *code,
    const char *value,
    int target_temperature,
    int duration_minutes,
    uint8_t out_frame[DX_STM32_FRAME_SIZE]
)
{
#if !DX_ENABLE_SAMPLE_UART_MONITOR
    (void)code;
    (void)value;
    (void)target_temperature;
    (void)duration_minutes;
    (void)out_frame;
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (!sample_uart_monitor_is_control_ready() || out_frame == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    dx_stm32_command_request_t request;
    int required_stage = 0;
    esp_err_t err = map_action_to_request(
        code,
        value,
        target_temperature,
        duration_minutes,
        &request,
        &required_stage
    );
    if (err != ESP_OK) {
        return err;
    }
    if (required_stage > DX_STM32_CONTROL_STAGE) {
        ESP_LOGW(
            TAG,
            "STM32 command blocked by staged control gate: command=0x%02X required=%d current=%d",
            request.command,
            required_stage,
            DX_STM32_CONTROL_STAGE
        );
        return ESP_ERR_NOT_SUPPORTED;
    }
    if (!dx_stm32_build_command_frame(&request, out_frame)) {
        return ESP_ERR_INVALID_ARG;
    }
    if (xSemaphoreTake(s_command_mutex, pdMS_TO_TICKS(2500)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    while (xSemaphoreTake(s_ack_signal, 0) == pdTRUE) {
    }
    portENTER_CRITICAL(&s_ack_lock);
    s_pending_command = request.command;
    s_pending_value = request.value;
    s_ack_matches = false;
    s_ack_pending = true;
    portEXIT_CRITICAL(&s_ack_lock);

    err = write_frame(out_frame);
    if (err == ESP_OK) {
        (void)mqtt_agent_report_stm32_link(
            "TX",
            "COMMAND",
            out_frame,
            DX_STM32_FRAME_SIZE,
            NULL,
            true,
            "SENT",
            0,
            0
        );
        if (xSemaphoreTake(s_ack_signal, pdMS_TO_TICKS(DX_STM32_ACK_TIMEOUT_MS)) != pdTRUE) {
            err = ESP_ERR_TIMEOUT;
            (void)mqtt_agent_report_stm32_link(
                "TX",
                "COMMAND_TIMEOUT",
                out_frame,
                DX_STM32_FRAME_SIZE,
                NULL,
                true,
                "ACK_TIMEOUT",
                0,
                0
            );
        } else {
            portENTER_CRITICAL(&s_ack_lock);
            const bool matches = s_ack_matches;
            portEXIT_CRITICAL(&s_ack_lock);
            if (!matches) {
                err = ESP_ERR_INVALID_RESPONSE;
            }
        }
    }

    portENTER_CRITICAL(&s_ack_lock);
    s_ack_pending = false;
    portEXIT_CRITICAL(&s_ack_lock);
    xSemaphoreGive(s_command_mutex);
    return err;
#endif
}

#if DX_ENABLE_SAMPLE_UART_MONITOR
static void monitor_task(void *arg)
{
    (void)arg;
    dx_stm32_stream_parser_t parser;
    dx_stm32_stream_parser_init(&parser);

    while (true) {
        uint8_t chunk[64];
        int received = uart_read_bytes(UART_NUM_1, chunk, sizeof(chunk), pdMS_TO_TICKS(250));
        if (received <= 0) {
            continue;
        }

        for (int index = 0; index < received; index++) {
            uint8_t frame[DX_STM32_FRAME_SIZE];
            dx_stm32_feed_result_t result = dx_stm32_stream_parser_feed(
                &parser,
                chunk[index],
                frame
            );
            if (result == DX_STM32_FEED_FRAME_READY) {
                handle_status_frame(frame);
            } else if (result == DX_STM32_FEED_FRAME_REJECTED &&
                       (parser.rejected_frames == 1U || parser.rejected_frames % 10U == 0U)) {
                ESP_LOGW(
                    TAG,
                    "Invalid STM32 frame discarded (frames=%lu bytes=%lu)",
                    (unsigned long)parser.rejected_frames,
                    (unsigned long)parser.discarded_bytes
                );
                (void)mqtt_agent_report_stm32_link(
                    "RX",
                    "FRAME_REJECTED",
                    parser.buffer,
                    parser.length,
                    NULL,
                    false,
                    "CHECKSUM_OR_BOUNDARY_ERROR",
                    parser.rejected_frames,
                    parser.discarded_bytes
                );
            }
        }
    }
}

static void handle_status_frame(const uint8_t frame[DX_STM32_FRAME_SIZE])
{
    dx_stm32_status_t status;
    if (!dx_stm32_decode_status_frame(frame, DX_STM32_FRAME_SIZE, &status)) {
        ESP_LOGW(TAG, "Validated frame could not be decoded");
        return;
    }

    if (status.command == DX_STM32_COMMAND_NETWORK_STATUS) {
        s_network_status_requests++;
        if (s_network_status_requests == 1U || s_network_status_requests % 120U == 0U) {
            ESP_LOGI(
                TAG,
                "STM32 network-status requests observed=%lu",
                (unsigned long)s_network_status_requests
            );
            (void)mqtt_agent_report_stm32_link(
                "RX",
                "NETWORK_STATUS_REQUEST",
                frame,
                DX_STM32_FRAME_SIZE,
                &status,
                true,
                sample_uart_monitor_is_control_ready() ? "REPLIED" : "READ_ONLY",
                0,
                0
            );
        }
        if (sample_uart_monitor_is_control_ready()) {
            reply_network_status();
        }
        return;
    }

    bool pending_command = false;
    bool ack_matches = false;
    portENTER_CRITICAL(&s_ack_lock);
    if (s_ack_pending && status.command == s_pending_command) {
        pending_command = true;
        ack_matches = status_matches_request(
            &status,
            s_pending_command,
            s_pending_value
        );
        s_ack_matches = ack_matches;
    }
    portEXIT_CRITICAL(&s_ack_lock);

    log_status_frame(frame, &status);
    (void)mqtt_agent_report_stm32_link(
        "RX",
        pending_command ? (ack_matches ? "COMMAND_ACK" : "COMMAND_ACK_MISMATCH") : "STATUS",
        frame,
        DX_STM32_FRAME_SIZE,
        &status,
        true,
        pending_command ? (ack_matches ? "APPLIED" : "STATE_MISMATCH") : "OBSERVED",
        0,
        0
    );

    if (apply_status_to_device_state(&status) && mqtt_agent_is_connected()) {
        esp_err_t err = mqtt_agent_report_state();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "Could not publish updated STM32 state: %s", esp_err_to_name(err));
        }
    }
    if (pending_command) {
        xSemaphoreGive(s_ack_signal);
    }
}

static bool status_matches_request(
    const dx_stm32_status_t *status,
    uint8_t command,
    uint8_t value
)
{
    if (status->command != command || status->value != value) {
        return false;
    }
    switch (command) {
        case DX_STM32_COMMAND_LIGHT:
            return status->light == (value == 1U);
        case DX_STM32_COMMAND_VENTILATION:
            return status->ventilation == (value == 1U);
        case DX_STM32_COMMAND_FAN:
            return status->fan == (value == 1U);
        case DX_STM32_COMMAND_HEATER:
            if (value == 0U) {
                return !status->heater_weak && !status->heater_strong;
            }
            return value == 1U ? status->heater_weak : status->heater_strong;
        case DX_STM32_COMMAND_SWING:
            return status->swing == (value == 1U);
        case DX_STM32_COMMAND_DRY:
            return status->dry == (value != 0U);
        case DX_STM32_COMMAND_POWER_OFF:
            return !status->ventilation && !status->fan && !status->heater_weak &&
                !status->heater_strong && !status->swing && !status->dry;
        default:
            return true;
    }
}

static esp_err_t write_frame(const uint8_t frame[DX_STM32_FRAME_SIZE])
{
    if (xSemaphoreTake(s_tx_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    int written = uart_write_bytes(UART_NUM_1, frame, DX_STM32_FRAME_SIZE);
    esp_err_t err = written == (int)DX_STM32_FRAME_SIZE
        ? uart_wait_tx_done(UART_NUM_1, pdMS_TO_TICKS(200))
        : ESP_FAIL;
    xSemaphoreGive(s_tx_mutex);
    return err;
}

static esp_err_t map_action_to_request(
    const char *code,
    const char *value,
    int target_temperature,
    int duration_minutes,
    dx_stm32_command_request_t *request,
    int *required_stage
)
{
    if (code == NULL || value == NULL || request == NULL || required_stage == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(request, 0, sizeof(*request));
    *required_stage = 1;

    if (strcmp(code, "light") == 0) {
        request->command = DX_STM32_COMMAND_LIGHT;
    } else if (strcmp(code, "fan") == 0) {
        request->command = DX_STM32_COMMAND_FAN;
        *required_stage = 2;
    } else if (strcmp(code, "ventilation") == 0) {
        request->command = DX_STM32_COMMAND_VENTILATION;
        *required_stage = 2;
    } else if (strcmp(code, "swing") == 0) {
        request->command = DX_STM32_COMMAND_SWING;
        *required_stage = 2;
    } else if (strcmp(code, "heater") == 0) {
        request->command = DX_STM32_COMMAND_HEATER;
        *required_stage = strcmp(value, "off") == 0 ? 1 : 3;
        request->value = strcmp(value, "weak") == 0
            ? 1U
            : (strcmp(value, "strong") == 0 ? 2U : 0U);
        if (strcmp(value, "weak") != 0 && strcmp(value, "strong") != 0 &&
            strcmp(value, "off") != 0) {
            return ESP_ERR_INVALID_ARG;
        }
        return ESP_OK;
    } else if (strcmp(code, "dry") == 0) {
        request->command = DX_STM32_COMMAND_DRY;
        *required_stage = strcmp(value, "off") == 0 ? 1 : 3;
    } else if (strcmp(code, "standby") == 0) {
        if (strcmp(value, "on") != 0) {
            return ESP_ERR_INVALID_ARG;
        }
        request->command = DX_STM32_COMMAND_POWER_OFF;
        request->value = 0U;
        return ESP_OK;
    } else if (strcmp(code, "timer") == 0) {
        if (strcmp(value, "set") != 0 || duration_minutes < 0 || duration_minutes > 120) {
            return ESP_ERR_INVALID_ARG;
        }
        request->command = DX_STM32_COMMAND_TIMER;
        request->value = (uint8_t)duration_minutes;
        *required_stage = 3;
        return ESP_OK;
    } else if (strcmp(code, "temperature") == 0 ||
               strcmp(code, "bath") == 0 ||
               strcmp(code, "constantTemperature") == 0) {
        (void)target_temperature;
        return ESP_ERR_NOT_SUPPORTED;
    } else {
        return ESP_ERR_NOT_SUPPORTED;
    }

    if (strcmp(value, "on") == 0) {
        request->value = 1U;
    } else if (strcmp(value, "off") == 0) {
        request->value = 0U;
    } else {
        return ESP_ERR_INVALID_ARG;
    }
    return ESP_OK;
}

static void reply_network_status(void)
{
    dx_stm32_command_request_t request = {
        .command = DX_STM32_COMMAND_NETWORK_STATUS,
        .value = 0,
        .network_online = mqtt_agent_is_connected(),
    };
    uint8_t frame[DX_STM32_FRAME_SIZE];
    if (!dx_stm32_build_command_frame(&request, frame)) {
        return;
    }
    esp_err_t err = write_frame(frame);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Network-status reply failed: %s", esp_err_to_name(err));
    }
}

static void log_status_frame(
    const uint8_t frame[DX_STM32_FRAME_SIZE],
    const dx_stm32_status_t *status
)
{
    ESP_LOGI(
        TAG,
        "STM32 frame command=0x%02X value=%u temp=%uC remaining=%umin "
        "light=%u ventilation=%u fan=%u heatWeak=%u heatStrong=%u swing=%u dry=%u "
        "mode=%u network=%u",
        status->command,
        status->value,
        status->temperature_celsius,
        status->remaining_minutes,
        status->light,
        status->ventilation,
        status->fan,
        status->heater_weak,
        status->heater_strong,
        status->swing,
        status->dry,
        status->mode_active,
        status->network_control_enabled
    );
    if (status->heater_weak && status->heater_strong) {
        ESP_LOGW(TAG, "STM32 reported weak and strong heater bits simultaneously");
    }
    ESP_LOG_BUFFER_HEX_LEVEL(TAG, frame, DX_STM32_FRAME_SIZE, ESP_LOG_INFO);
}

static bool apply_status_to_device_state(const dx_stm32_status_t *status)
{
    dx_device_state_t current;
    if (device_state_get(&current) != ESP_OK) {
        ESP_LOGW(TAG, "Could not read device state for STM32 synchronization");
        return false;
    }

    dx_device_state_t next = current;
    next.light = status->light;
    next.ventilation = status->ventilation;
    next.fan = status->fan;
    next.swing = status->swing;
    next.dry = status->dry;
    next.heater = status->heater_strong
        ? DX_HEATER_STRONG
        : (status->heater_weak ? DX_HEATER_WEAK : DX_HEATER_OFF);
    next.ambient_temperature = (float)status->temperature_celsius;
    next.power = next.light || next.ventilation || next.fan || next.swing ||
        next.dry || next.heater != DX_HEATER_OFF;

    const bool changed = next.power != current.power ||
        next.light != current.light ||
        next.ventilation != current.ventilation ||
        next.fan != current.fan ||
        next.swing != current.swing ||
        next.dry != current.dry ||
        next.heater != current.heater ||
        next.ambient_temperature != current.ambient_temperature;
    if (!changed) {
        return false;
    }
    if (device_state_update(&next) != ESP_OK) {
        ESP_LOGW(TAG, "Could not update device state from STM32 frame");
        return false;
    }
    ESP_LOGI(TAG, "Unified device state synchronized from STM32");
    return true;
}
#endif
