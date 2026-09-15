/*
 * UART通信桥接模块
 *
 * 当前实现只落地协议帧生成和校验。UART物理初始化默认关闭，待东信
 * 确认 C3 与主控板的 TX/RX 引脚、串口参数和最终命令码后启用。
 */

#include <string.h>

#include "driver/uart.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "app_config.h"
#include "device_state.h"
#include "mqtt_agent.h"
#include "uart_bridge.h"

static const char *TAG = "UART_BRIDGE";
static bool s_uart_ready;
static uint8_t s_tx_sequence;
static SemaphoreHandle_t s_transaction_mutex;
static SemaphoreHandle_t s_ack_semaphore;
static volatile bool s_waiting_for_ack;
static volatile uint8_t s_expected_sequence;
static volatile uint8_t s_expected_command;
static volatile uint8_t s_ack_result_code;

typedef enum {
    DX_MCU_RESPONSE_NONE = 0,
    DX_MCU_RESPONSE_ACK,
    DX_MCU_RESPONSE_STATE
} dx_mcu_response_type_t;

static volatile dx_mcu_response_type_t s_expected_response;

static uint8_t command_code(const dx_cloud_action_t *action, uint8_t *value);
static uint8_t frame_checksum(const uint8_t frame[DX_MCU_FRAME_SIZE]);
static void build_state_query_frame(uint8_t sequence, uint8_t out_frame[DX_MCU_FRAME_SIZE]);
static void uart_rx_task(void *arg);
static void state_query_task(void *arg);
static void process_received_frame(const uint8_t frame[DX_MCU_FRAME_SIZE]);
static esp_err_t run_transaction(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    dx_mcu_response_type_t expected_response
);
static bool wait_for_response(TickType_t ticks, uint8_t *result_code);

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
        err = uart_driver_install(UART_NUM_1, 2048, 2048, 0, NULL, 0);
    }

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "UART init failed: %s", esp_err_to_name(err));
        return;
    }

    s_transaction_mutex = xSemaphoreCreateMutex();
    s_ack_semaphore = xSemaphoreCreateBinary();
    if (s_transaction_mutex == NULL || s_ack_semaphore == NULL) {
        ESP_LOGE(TAG, "UART synchronization objects could not be created");
        uart_driver_delete(UART_NUM_1);
        return;
    }

    s_uart_ready = true;
    if (xTaskCreate(uart_rx_task, "uart_rx", 4096, NULL, 6, NULL) != pdPASS) {
        ESP_LOGE(TAG, "UART RX task could not be created");
        s_uart_ready = false;
        uart_driver_delete(UART_NUM_1);
        return;
    }
    if (xTaskCreate(state_query_task, "mcu_state_query", 3072, NULL, 4, NULL) != pdPASS) {
        ESP_LOGW(TAG, "MCU state query task could not be created");
    }
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
    return uart_bridge_build_frame_with_sequence(action, 0, out_frame);
}

esp_err_t uart_bridge_build_frame_with_sequence(
    const dx_cloud_action_t *action,
    uint8_t sequence,
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
    out_frame[28] = sequence;
    out_frame[29] = frame_checksum(out_frame);
    out_frame[30] = 0x0F;
    out_frame[31] = 0x04;
    return ESP_OK;
}

static void build_state_query_frame(
    uint8_t sequence,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
)
{
    memset(out_frame, 0, DX_MCU_FRAME_SIZE);
    out_frame[0] = 0x02;
    out_frame[1] = 0xCF;
    out_frame[2] = 0x07;
    out_frame[3] = 0x00;
    out_frame[28] = sequence;
    out_frame[29] = frame_checksum(out_frame);
    out_frame[30] = 0x0F;
    out_frame[31] = 0x04;
}

bool uart_bridge_validate_frame(const uint8_t frame[DX_MCU_FRAME_SIZE])
{
    if (frame == NULL) {
        return false;
    }

    if (frame[0] != 0x02 || frame[2] != 0x07) {
        return false;
    }
    bool valid_direction_and_tail =
        (frame[1] == 0xCF && frame[30] == 0x0F) ||
        (frame[1] == 0xCA && frame[30] == 0x0B);
    if (!valid_direction_and_tail || frame[31] != 0x04) {
        return false;
    }
    return frame[29] == frame_checksum(frame);
}

esp_err_t uart_bridge_send_action(const dx_cloud_action_t *action)
{
    return uart_bridge_send_action_with_frame(action, NULL);
}

esp_err_t uart_bridge_send_action_with_frame(
    const dx_cloud_action_t *action,
    uint8_t out_frame[DX_MCU_FRAME_SIZE]
)
{
    if (!s_uart_ready) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_transaction_mutex == NULL || s_ack_semaphore == NULL ||
        xSemaphoreTake(s_transaction_mutex, pdMS_TO_TICKS(2500)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    uint8_t frame[DX_MCU_FRAME_SIZE];
    s_tx_sequence++;
    if (s_tx_sequence == 0) {
        s_tx_sequence = 1;
    }
    esp_err_t err = uart_bridge_build_frame_with_sequence(action, s_tx_sequence, frame);
    if (err != ESP_OK) {
        xSemaphoreGive(s_transaction_mutex);
        return err;
    }

    if (out_frame != NULL) {
        memcpy(out_frame, frame, sizeof(frame));
    }

    esp_err_t transaction_result = run_transaction(frame, DX_MCU_RESPONSE_ACK);
    if (transaction_result == ESP_OK) {
        uint8_t state_query[DX_MCU_FRAME_SIZE];
        s_tx_sequence++;
        if (s_tx_sequence == 0) {
            s_tx_sequence = 1;
        }
        build_state_query_frame(s_tx_sequence, state_query);
        transaction_result = run_transaction(state_query, DX_MCU_RESPONSE_STATE);
        if (transaction_result != ESP_OK) {
            ESP_LOGW(
                TAG,
                "MCU ACK succeeded but post-command state verification failed: %s",
                esp_err_to_name(transaction_result)
            );
        }
    }
    xSemaphoreGive(s_transaction_mutex);
    return transaction_result;
}

esp_err_t uart_bridge_request_state(void)
{
    if (!s_uart_ready) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_transaction_mutex == NULL || s_ack_semaphore == NULL ||
        xSemaphoreTake(s_transaction_mutex, pdMS_TO_TICKS(2500)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    s_tx_sequence++;
    if (s_tx_sequence == 0) {
        s_tx_sequence = 1;
    }
    uint8_t frame[DX_MCU_FRAME_SIZE];
    build_state_query_frame(s_tx_sequence, frame);
    esp_err_t transaction_result = run_transaction(frame, DX_MCU_RESPONSE_STATE);
    xSemaphoreGive(s_transaction_mutex);
    return transaction_result;
}

static esp_err_t run_transaction(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    dx_mcu_response_type_t expected_response
)
{
    while (xSemaphoreTake(s_ack_semaphore, 0) == pdTRUE) {
    }
    s_expected_sequence = frame[28];
    s_expected_command = frame[3];
    s_ack_result_code = 0xFF;
    s_expected_response = expected_response;
    s_waiting_for_ack = true;

    int written = uart_write_bytes(UART_NUM_1, frame, DX_MCU_FRAME_SIZE);
    if (written != DX_MCU_FRAME_SIZE) {
        s_waiting_for_ack = false;
        s_expected_response = DX_MCU_RESPONSE_NONE;
        return ESP_FAIL;
    }

    uint8_t result_code = 0xFF;
    bool received_response = wait_for_response(pdMS_TO_TICKS(500), &result_code);
    if (!received_response) {
        ESP_LOGW(
            TAG,
            "No %s for seq=%u; retrying once",
            expected_response == DX_MCU_RESPONSE_ACK ? "ACK" : "state",
            frame[28]
        );
        written = uart_write_bytes(UART_NUM_1, frame, DX_MCU_FRAME_SIZE);
        if (written == DX_MCU_FRAME_SIZE) {
            received_response = wait_for_response(pdMS_TO_TICKS(1500), &result_code);
        }
    }
    s_waiting_for_ack = false;
    s_expected_response = DX_MCU_RESPONSE_NONE;

    if (!received_response) {
        ESP_LOGE(TAG, "UART transaction seq=%u timed out after retry", frame[28]);
        return ESP_ERR_TIMEOUT;
    }
    if (expected_response == DX_MCU_RESPONSE_ACK && result_code != 0) {
        ESP_LOGW(TAG, "MCU rejected command seq=%u result=0x%02X", frame[28], result_code);
        return ESP_ERR_INVALID_RESPONSE;
    }
    return ESP_OK;
}

static bool wait_for_response(TickType_t ticks, uint8_t *result_code)
{
    if (xSemaphoreTake(s_ack_semaphore, ticks) != pdTRUE) {
        return false;
    }
    if (result_code != NULL) {
        *result_code = s_ack_result_code;
    }
    return true;
}

static void uart_rx_task(void *arg)
{
    (void)arg;
    uint8_t frame[DX_MCU_FRAME_SIZE];
    size_t frame_length = 0;

    while (true) {
        uint8_t chunk[64];
        int received = uart_read_bytes(UART_NUM_1, chunk, sizeof(chunk), pdMS_TO_TICKS(100));
        if (received <= 0) {
            continue;
        }

        for (int index = 0; index < received; index++) {
            uint8_t byte = chunk[index];
            if (frame_length == 0 && byte != 0x02) {
                continue;
            }
            frame[frame_length++] = byte;
            if (frame_length != DX_MCU_FRAME_SIZE) {
                continue;
            }

            if (uart_bridge_validate_frame(frame)) {
                process_received_frame(frame);
                frame_length = 0;
                continue;
            }

            size_t next_header = 1;
            while (next_header < DX_MCU_FRAME_SIZE && frame[next_header] != 0x02) {
                next_header++;
            }
            if (next_header < DX_MCU_FRAME_SIZE) {
                frame_length = DX_MCU_FRAME_SIZE - next_header;
                memmove(frame, &frame[next_header], frame_length);
            } else {
                frame_length = 0;
            }
            ESP_LOGW(TAG, "Discarded invalid MCU frame and resynchronized RX");
        }
    }
}

static void process_received_frame(const uint8_t frame[DX_MCU_FRAME_SIZE])
{
    dx_mcu_message_t message;
    esp_err_t err = uart_bridge_parse_mcu_frame(frame, &message);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "MCU frame parse failed: %s", esp_err_to_name(err));
        return;
    }

    if (message.type == DX_MCU_MESSAGE_ACK) {
        if (s_waiting_for_ack && s_expected_response == DX_MCU_RESPONSE_ACK &&
            message.sequence == s_expected_sequence &&
            message.original_command == s_expected_command) {
            s_ack_result_code = message.result_code;
            xSemaphoreGive(s_ack_semaphore);
        } else {
            ESP_LOGW(
                TAG,
                "Ignoring unexpected ACK seq=%u command=0x%02X",
                message.sequence,
                message.original_command
            );
        }
        return;
    }

    if (device_state_update(&message.state) == ESP_OK) {
        /* State reports are authoritative and are forwarded immediately. */
        (void)mqtt_agent_report_state();
    }
    if (s_waiting_for_ack && s_expected_response == DX_MCU_RESPONSE_STATE &&
        message.sequence == s_expected_sequence) {
        s_ack_result_code = 0;
        xSemaphoreGive(s_ack_semaphore);
    }
}

static void state_query_task(void *arg)
{
    (void)arg;
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(DX_MCU_STATE_QUERY_INTERVAL_SECONDS * 1000));
        esp_err_t err = uart_bridge_request_state();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "Periodic MCU state query failed: %s", esp_err_to_name(err));
        }
    }
}

esp_err_t uart_bridge_parse_mcu_frame(
    const uint8_t frame[DX_MCU_FRAME_SIZE],
    dx_mcu_message_t *out_message
)
{
    if (frame == NULL || out_message == NULL || !uart_bridge_validate_frame(frame) ||
        frame[1] != 0xCA) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_message, 0, sizeof(*out_message));
    out_message->sequence = frame[28];
    if (frame[3] == 0x7F) {
        if (frame[5] > 0x05) {
            return ESP_ERR_INVALID_RESPONSE;
        }
        out_message->type = DX_MCU_MESSAGE_ACK;
        out_message->original_command = frame[4];
        out_message->result_code = frame[5];
        return ESP_OK;
    }
    if (frame[3] != 0x10) {
        return ESP_ERR_NOT_SUPPORTED;
    }
    if (frame[4] > 1 || frame[5] > 1 || frame[6] > DX_HEATER_STRONG ||
        frame[7] > 1 || frame[8] > 1 || frame[9] > 1 || frame[10] > 1 ||
        frame[11] < 30 || frame[11] > 45 || frame[14] > 100 || frame[15] > 1) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    out_message->type = DX_MCU_MESSAGE_STATE;
    out_message->state.is_online = true;
    out_message->state.power = frame[4] == 1;
    out_message->state.light = frame[5] == 1;
    out_message->state.heater = (dx_heater_level_t)frame[6];
    out_message->state.ventilation = frame[7] == 1;
    out_message->state.fan = frame[8] == 1;
    out_message->state.swing = frame[9] == 1;
    out_message->state.dry = frame[10] == 1;
    out_message->state.target_temperature = frame[11];
    int16_t temperature_x100 = (int16_t)((uint16_t)frame[12] | ((uint16_t)frame[13] << 8));
    out_message->state.ambient_temperature = (float)temperature_x100 / 100.0f;
    out_message->state.humidity = frame[14];
    out_message->state.has_occupancy = frame[15] == 1;
    uint16_t fault_code = (uint16_t)frame[16] | ((uint16_t)frame[17] << 8);
    if (fault_code != 0) {
        snprintf(
            out_message->state.fault_code,
            sizeof(out_message->state.fault_code),
            "MCU-%04X",
            fault_code
        );
    }
    out_message->state.running_minutes =
        (uint32_t)frame[18] |
        ((uint32_t)frame[19] << 8) |
        ((uint32_t)frame[20] << 16) |
        ((uint32_t)frame[21] << 24);
    return ESP_OK;
}

esp_err_t uart_bridge_run_self_test(void)
{
    uint8_t frame[DX_MCU_FRAME_SIZE];
    dx_cloud_action_t light = {
        .code = "light", .value = "on", .target_temperature = -1, .duration_minutes = -1
    };
    if (uart_bridge_build_frame_with_sequence(&light, 0x2A, frame) != ESP_OK ||
        frame[3] != 0x01 || frame[4] != 0x01 || frame[28] != 0x2A ||
        frame[29] != 0x2D || !uart_bridge_validate_frame(frame)) {
        ESP_LOGE(TAG, "UART self-test failed: command frame");
        return ESP_FAIL;
    }
    frame[29] ^= 0x01;
    if (uart_bridge_validate_frame(frame)) {
        ESP_LOGE(TAG, "UART self-test failed: checksum rejection");
        return ESP_FAIL;
    }

    dx_cloud_action_t temperature = {
        .code = "temperature", .value = "set", .target_temperature = 38, .duration_minutes = -1
    };
    if (uart_bridge_build_frame(&temperature, frame) != ESP_OK ||
        frame[3] != 0x07 || frame[4] != 38) {
        ESP_LOGE(TAG, "UART self-test failed: temperature frame");
        return ESP_FAIL;
    }
    dx_cloud_action_t standby = {
        .code = "standby", .value = "on", .target_temperature = -1, .duration_minutes = -1
    };
    if (uart_bridge_build_frame(&standby, frame) != ESP_OK ||
        frame[3] != 0x08 || frame[4] != 1) {
        ESP_LOGE(TAG, "UART self-test failed: standby frame");
        return ESP_FAIL;
    }

    build_state_query_frame(0x2B, frame);
    if (frame[3] != 0x00 || frame[4] != 0x00 || frame[28] != 0x2B ||
        !uart_bridge_validate_frame(frame)) {
        ESP_LOGE(TAG, "UART self-test failed: state query frame");
        return ESP_FAIL;
    }

    memset(frame, 0, sizeof(frame));
    frame[0] = 0x02;
    frame[1] = 0xCA;
    frame[2] = 0x07;
    frame[3] = 0x10;
    frame[4] = 1;
    frame[5] = 1;
    frame[6] = 1;
    frame[11] = 38;
    int16_t temperature_x100 = 2567;
    frame[12] = (uint8_t)(temperature_x100 & 0xFF);
    frame[13] = (uint8_t)((temperature_x100 >> 8) & 0xFF);
    frame[14] = 72;
    frame[15] = 1;
    frame[18] = 8;
    frame[29] = frame_checksum(frame);
    frame[30] = 0x0B;
    frame[31] = 0x04;
    dx_mcu_message_t message;
    if (uart_bridge_parse_mcu_frame(frame, &message) != ESP_OK ||
        message.type != DX_MCU_MESSAGE_STATE || !message.state.light ||
        message.state.target_temperature != 38 ||
        message.state.ambient_temperature < 25.66f ||
        message.state.ambient_temperature > 25.68f ||
        message.state.humidity != 72 || message.state.running_minutes != 8) {
        ESP_LOGE(TAG, "UART self-test failed: state parsing");
        return ESP_FAIL;
    }

    memset(frame, 0, sizeof(frame));
    frame[0] = 0x02;
    frame[1] = 0xCA;
    frame[2] = 0x07;
    frame[3] = 0x7F;
    frame[4] = 0x01;
    frame[5] = 0x00;
    frame[28] = 0x2A;
    frame[29] = frame_checksum(frame);
    frame[30] = 0x0B;
    frame[31] = 0x04;
    if (uart_bridge_parse_mcu_frame(frame, &message) != ESP_OK ||
        message.type != DX_MCU_MESSAGE_ACK ||
        message.original_command != 0x01 || message.result_code != 0 ||
        message.sequence != 0x2A) {
        ESP_LOGE(TAG, "UART self-test failed: ACK parsing");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "UART protocol V0.2 self-test passed");
    return ESP_OK;
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
    if (strcmp(action->code, "temperature") == 0 &&
        strcmp(action->value, "set") == 0 &&
        action->target_temperature >= 30 &&
        action->target_temperature <= 45) {
        *value = (uint8_t)action->target_temperature;
        return 0x07;
    }
    if (strcmp(action->code, "standby") == 0 &&
        strcmp(action->value, "on") == 0) {
        *value = 0x01;
        return 0x08;
    }
    if (strcmp(action->code, "network") == 0) {
        if (strcmp(action->value, "enable") == 0) {
            *value = 0x01;
        } else if (strcmp(action->value, "disable") != 0) {
            return 0;
        }
        return 0x0C;
    }

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
