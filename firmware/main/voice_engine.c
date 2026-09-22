#include "voice_engine.h"

#include <inttypes.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "app_config.h"
#include "board_profile.h"
#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "mqtt_agent.h"

#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "es8311.h"
#include "wifi_manager.h"
#endif

static const char *TAG = "VOICE_ENG";

#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO

#define VOICE_TASK_STACK_SIZE 8192
#define VOICE_TASK_PRIORITY 5
#define VOICE_REQUEST_QUEUE_DEPTH 2
#define VOICE_TEST_SESSION_ID_SIZE 40
#define AUDIO_TEST_ID_SIZE 40
#define AUDIO_TEST_PATH_SIZE 192
#define AUDIO_TEST_MAX_BYTES (512 * 1024)
#define VOICE_IO_BUFFER_SIZE 2048
#define VOICE_RESPONSE_BUFFER_SIZE (16 * 1024)
#define VOICE_MCLK_MULTIPLE 384
#define VOICE_MCLK_FREQUENCY (DX_VOICE_SAMPLE_RATE * VOICE_MCLK_MULTIPLE)
#define VOICE_TOTAL_BYTES \
    (DX_VOICE_SAMPLE_RATE * DX_VOICE_CHANNELS * (DX_VOICE_BITS_PER_SAMPLE / 8) * DX_VOICE_RECORD_SECONDS)

static i2s_chan_handle_t s_rx_channel;
static i2s_chan_handle_t s_tx_channel;
static es8311_handle_t s_codec;
static QueueHandle_t s_voice_request_queue;
static QueueHandle_t s_audio_test_queue;
static volatile bool s_capture_active;
static volatile bool s_capture_pending;
static volatile bool s_cancel_requested;
static volatile bool s_playback_active;
static volatile bool s_playback_pending;
static volatile bool s_playback_cancel_requested;

typedef struct {
    char test_session_id[VOICE_TEST_SESSION_ID_SIZE];
    bool asr_only;
} voice_test_request_t;

typedef struct {
    char test_id[AUDIO_TEST_ID_SIZE];
    char audio_path[AUDIO_TEST_PATH_SIZE];
} audio_test_request_t;

extern const uint8_t wake_ack_pcm_start[]
    asm("_binary_wake_ack_16k_mono_pcm_start");
extern const uint8_t wake_ack_pcm_end[]
    asm("_binary_wake_ack_16k_mono_pcm_end");

static esp_err_t configure_i2c(void)
{
    const i2c_config_t config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = (gpio_num_t)DX_LICHUANG_I2C_SDA_GPIO,
        .scl_io_num = (gpio_num_t)DX_LICHUANG_I2C_SCL_GPIO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = 100000,
    };

    esp_err_t err = i2c_param_config((i2c_port_t)DX_LICHUANG_I2C_PORT, &config);
    if (err != ESP_OK) {
        return err;
    }

    err = i2c_driver_install((i2c_port_t)DX_LICHUANG_I2C_PORT, I2C_MODE_MASTER, 0, 0, 0);
    return err == ESP_ERR_INVALID_STATE ? ESP_OK : err;
}

static esp_err_t configure_i2s(void)
{
    i2s_chan_config_t channel_config = I2S_CHANNEL_DEFAULT_CONFIG(
        (i2s_port_t)DX_LICHUANG_I2S_PORT,
        I2S_ROLE_MASTER
    );
    channel_config.auto_clear = true;
    channel_config.dma_desc_num = 8;
    channel_config.dma_frame_num = 512;

    esp_err_t err = i2s_new_channel(&channel_config, &s_tx_channel, &s_rx_channel);
    if (err != ESP_OK) {
        return err;
    }

    i2s_std_config_t standard_config = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(DX_VOICE_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT,
            I2S_SLOT_MODE_MONO
        ),
        .gpio_cfg = {
            .mclk = (gpio_num_t)DX_LICHUANG_I2S_MCLK_GPIO,
            .bclk = (gpio_num_t)DX_LICHUANG_I2S_BCLK_GPIO,
            .ws = (gpio_num_t)DX_LICHUANG_I2S_WS_GPIO,
            .dout = (gpio_num_t)DX_LICHUANG_I2S_DOUT_GPIO,
            .din = (gpio_num_t)DX_LICHUANG_I2S_DIN_GPIO,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    standard_config.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_384;
    standard_config.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;

    err = i2s_channel_init_std_mode(s_tx_channel, &standard_config);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_init_std_mode(s_rx_channel, &standard_config);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_enable(s_tx_channel);
    if (err != ESP_OK) {
        return err;
    }
    err = i2s_channel_enable(s_rx_channel);
    if (err != ESP_OK) {
        i2s_channel_disable(s_tx_channel);
    }
    return err;
}

static esp_err_t configure_codec(void)
{
    s_codec = es8311_create(
        (i2c_port_t)DX_LICHUANG_I2C_PORT,
        ES8311_ADDRRES_0
    );
    if (s_codec == NULL) {
        return ESP_ERR_NO_MEM;
    }

    const es8311_clock_config_t clock_config = {
        .mclk_inverted = false,
        .sclk_inverted = false,
        .mclk_from_mclk_pin = true,
        .mclk_frequency = VOICE_MCLK_FREQUENCY,
        .sample_frequency = DX_VOICE_SAMPLE_RATE,
    };

    esp_err_t err = es8311_init(
        s_codec,
        &clock_config,
        ES8311_RESOLUTION_16,
        ES8311_RESOLUTION_16
    );
    if (err != ESP_OK) {
        return err;
    }
    if ((err = es8311_sample_frequency_config(
             s_codec,
             VOICE_MCLK_FREQUENCY,
             DX_VOICE_SAMPLE_RATE
         )) != ESP_OK) {
        return err;
    }
    if ((err = es8311_voice_volume_set(s_codec, 0, NULL)) != ESP_OK) {
        return err;
    }
    if ((err = es8311_voice_mute(s_codec, true)) != ESP_OK) {
        return err;
    }
    if ((err = es8311_microphone_config(s_codec, false)) != ESP_OK) {
        return err;
    }
    return es8311_microphone_gain_set(s_codec, ES8311_MIC_GAIN_18DB);
}

static esp_err_t configure_button(void)
{
    const gpio_config_t button_config = {
        .pin_bit_mask = 1ULL << DX_LICHUANG_RECORD_BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    return gpio_config(&button_config);
}

static const char *json_string_or(const cJSON *object, const char *name, const char *fallback)
{
    const cJSON *item = object == NULL
        ? NULL
        : cJSON_GetObjectItemCaseSensitive(object, name);
    return cJSON_IsString(item) && item->valuestring != NULL
        ? item->valuestring
        : fallback;
}

static bool log_pipeline_response(char *response, int status_code)
{
    cJSON *root = cJSON_Parse(response);
    if (root == NULL) {
        ESP_LOGE(TAG, "HTTP %d returned invalid JSON: %.240s", status_code, response);
        return false;
    }

    const cJSON *success = cJSON_GetObjectItemCaseSensitive(root, "success");
    const cJSON *data = cJSON_GetObjectItemCaseSensitive(root, "data");
    if (!cJSON_IsTrue(success) || !cJSON_IsObject(data)) {
        ESP_LOGE(TAG, "HTTP %d pipeline error: %.400s", status_code, response);
        cJSON_Delete(root);
        return false;
    }

    const cJSON *ai_result = cJSON_GetObjectItemCaseSensitive(data, "aiResult");
    const cJSON *safety_result = cJSON_GetObjectItemCaseSensitive(data, "safetyResult");
    ESP_LOGI(TAG, "ASR transcript: %s", json_string_or(data, "transcript", "<none>"));
    ESP_LOGI(TAG, "Pipeline route: %s", json_string_or(data, "route", "<unknown>"));
    ESP_LOGI(TAG, "Result type: %s", json_string_or(ai_result, "resultType", "<unknown>"));
    ESP_LOGI(TAG, "Intent: %s", json_string_or(ai_result, "intent", "<none>"));
    ESP_LOGI(TAG, "Safety decision: %s", json_string_or(safety_result, "decision", "<unknown>"));
    ESP_LOGI(TAG, "Safety reason: %s", json_string_or(safety_result, "reason", "<none>"));
    const char *reply_text = json_string_or(data, "replyText", "<none>");
    ESP_LOGI(TAG, "Reply text: %s", reply_text);
    const bool should_play_wake_ack = strcmp(reply_text, "我在") == 0;

    cJSON_Delete(root);
    return should_play_wake_ack;
}

static esp_err_t begin_audio_output(void)
{
    if (s_tx_channel == NULL || s_codec == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    static const int16_t silence[256] = {0};
    size_t bytes_written = 0;
    esp_err_t err = i2s_channel_write(
        s_tx_channel,
        silence,
        sizeof(silence),
        &bytes_written,
        pdMS_TO_TICKS(250)
    );
    if (err == ESP_OK) {
        err = es8311_voice_volume_set(s_codec, DX_LICHUANG_WAKE_ACK_VOLUME, NULL);
    }
    if (err == ESP_OK) {
        err = es8311_voice_mute(s_codec, false);
    }
    if (err == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(15));
        gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 1);
        return ESP_OK;
    }

    gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 0);
    es8311_voice_mute(s_codec, true);
    es8311_voice_volume_set(s_codec, 0, NULL);
    ESP_LOGE(TAG, "Audio output start failed: %s", esp_err_to_name(err));
    return err;
}

static void end_audio_output(void)
{
    static const int16_t silence[256] = {0};
    size_t bytes_written = 0;
    i2s_channel_write(
        s_tx_channel,
        silence,
        sizeof(silence),
        &bytes_written,
        pdMS_TO_TICKS(250)
    );
    vTaskDelay(pdMS_TO_TICKS(80));
    gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 0);
    es8311_voice_mute(s_codec, true);
    es8311_voice_volume_set(s_codec, 0, NULL);
}

static esp_err_t play_wake_ack(void)
{
    esp_err_t err = begin_audio_output();
    if (err != ESP_OK) {
        return err;
    }
    const size_t audio_length = (size_t)(wake_ack_pcm_end - wake_ack_pcm_start);
    size_t bytes_written = 0;
    ESP_LOGI(TAG, "Playing low-volume local wake acknowledgement");
    err = i2s_channel_write(
        s_tx_channel,
        wake_ack_pcm_start,
        audio_length,
        &bytes_written,
        pdMS_TO_TICKS(2500)
    );
    end_audio_output();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wake acknowledgement playback failed: %s", esp_err_to_name(err));
    }
    return err;
}

static esp_err_t download_and_play_audio_test(const audio_test_request_t *request)
{
    static const char *allowed_prefix = "/api/device/v1/audio-tests/";
    if (request == NULL ||
        strncmp(request->audio_path, allowed_prefix, strlen(allowed_prefix)) != 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!wifi_manager_wait_connected(DX_WIFI_CONNECT_TIMEOUT_SECONDS * 1000)) {
        return ESP_ERR_INVALID_STATE;
    }

    char url[320];
    const int url_length = snprintf(url, sizeof(url), "%s%s", DX_GATEWAY_BASE_URL, request->audio_path);
    if (url_length <= 0 || (size_t)url_length >= sizeof(url)) {
        return ESP_ERR_INVALID_SIZE;
    }
    uint8_t *buffer = malloc(VOICE_IO_BUFFER_SIZE);
    if (buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }
    const esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = DX_VOICE_HTTP_TIMEOUT_MS,
        .buffer_size = VOICE_IO_BUFFER_SIZE,
        .keep_alive_enable = true,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        free(buffer);
        return ESP_ERR_NO_MEM;
    }
    esp_http_client_set_header(client, "X-Device-Id", DX_DEVICE_ID);

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        goto cleanup;
    }
    const int64_t content_length = esp_http_client_fetch_headers(client);
    const int status_code = esp_http_client_get_status_code(client);
    if (status_code < 200 || status_code >= 300 || content_length <= 0 ||
        content_length > AUDIO_TEST_MAX_BYTES) {
        err = ESP_ERR_INVALID_SIZE;
        goto close_connection;
    }
    if (s_playback_cancel_requested) {
        err = ESP_ERR_INVALID_STATE;
        goto close_connection;
    }
    err = begin_audio_output();
    if (err != ESP_OK) {
        goto close_connection;
    }
    mqtt_agent_report_audio_test(request->test_id, "PLAYING", "Low-volume PCM playback started");

    size_t total_bytes = 0;
    while (!s_playback_cancel_requested) {
        const int bytes_read = esp_http_client_read(client, (char *)buffer, VOICE_IO_BUFFER_SIZE);
        if (bytes_read < 0) {
            err = ESP_FAIL;
            break;
        }
        if (bytes_read == 0) {
            err = ESP_OK;
            break;
        }
        size_t bytes_written = 0;
        err = i2s_channel_write(
            s_tx_channel,
            buffer,
            (size_t)bytes_read,
            &bytes_written,
            pdMS_TO_TICKS(1000)
        );
        if (err != ESP_OK || bytes_written != (size_t)bytes_read) {
            err = ESP_FAIL;
            break;
        }
        total_bytes += (size_t)bytes_read;
        if (total_bytes > AUDIO_TEST_MAX_BYTES) {
            err = ESP_ERR_INVALID_SIZE;
            break;
        }
    }
    if (s_playback_cancel_requested) {
        err = ESP_ERR_INVALID_STATE;
    }
    end_audio_output();

close_connection:
    esp_http_client_close(client);
cleanup:
    gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 0);
    es8311_voice_mute(s_codec, true);
    es8311_voice_volume_set(s_codec, 0, NULL);
    esp_http_client_cleanup(client);
    free(buffer);
    return err;
}

static esp_err_t write_all(esp_http_client_handle_t client, const uint8_t *data, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        if (s_cancel_requested) {
            return ESP_ERR_INVALID_STATE;
        }
        const int written = esp_http_client_write(
            client,
            (const char *)data + offset,
            (int)(length - offset)
        );
        if (written <= 0) {
            return ESP_FAIL;
        }
        offset += (size_t)written;
    }
    return ESP_OK;
}

static esp_err_t capture_and_upload(const char *test_session_id, bool asr_only)
{
    const bool remote_test = test_session_id != NULL && test_session_id[0] != '\0';
    if (!wifi_manager_wait_connected(DX_WIFI_CONNECT_TIMEOUT_SECONDS * 1000)) {
        ESP_LOGE(TAG, "Recording cancelled: WiFi is not connected");
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t *audio_buffer = malloc(VOICE_IO_BUFFER_SIZE);
    char *response_buffer = malloc(VOICE_RESPONSE_BUFFER_SIZE);
    if (audio_buffer == NULL || response_buffer == NULL) {
        free(audio_buffer);
        free(response_buffer);
        return ESP_ERR_NO_MEM;
    }

    const esp_http_client_config_t http_config = {
        .url = asr_only ? DX_VOICE_PCM_ASR_ONLY_URL : DX_VOICE_PCM_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = DX_VOICE_HTTP_TIMEOUT_MS,
        .buffer_size = 2048,
        .buffer_size_tx = 2048,
        .keep_alive_enable = true,
    };
    esp_http_client_handle_t client = esp_http_client_init(&http_config);
    if (client == NULL) {
        free(audio_buffer);
        free(response_buffer);
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_set_header(client, "Content-Type", "application/octet-stream");
    esp_http_client_set_header(client, "X-Device-Id", DX_DEVICE_ID);
    if (remote_test) {
        esp_http_client_set_header(client, "X-Voice-Test-Session-Id", test_session_id);
    }

    size_t discarded = 0;
    while (i2s_channel_read(s_rx_channel, audio_buffer, VOICE_IO_BUFFER_SIZE, &discarded, 0) == ESP_OK &&
           discarded > 0) {
    }

    ESP_LOGI(TAG, "Preparing silent recording; speak after a short pause");
    esp_err_t err = ESP_OK;
    bool play_ack_after_cleanup = false;
    if (s_cancel_requested) {
        err = ESP_ERR_INVALID_STATE;
        goto cleanup;
    }
    err = esp_http_client_open(client, VOICE_TOTAL_BYTES);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Voice HTTP connection failed: %s", esp_err_to_name(err));
        goto cleanup;
    }

    ESP_LOGI(
        TAG,
        "Silent recording started: %d seconds, say wake word and request now",
        DX_VOICE_RECORD_SECONDS
    );
    if (remote_test) {
        mqtt_agent_report_voice_test(
            test_session_id,
            "RECORDING",
            "Microphone capture started; amplifier remains muted"
        );
    }

    size_t total_bytes = 0;
    uint64_t magnitude_sum = 0;
    uint32_t peak = 0;
    uint32_t sample_count = 0;

    while (total_bytes < VOICE_TOTAL_BYTES) {
        if (s_cancel_requested) {
            err = ESP_ERR_INVALID_STATE;
            ESP_LOGW(TAG, "Voice capture cancelled by development console");
            goto close_connection;
        }
        const size_t bytes_to_read = (VOICE_TOTAL_BYTES - total_bytes) < VOICE_IO_BUFFER_SIZE
            ? (VOICE_TOTAL_BYTES - total_bytes)
            : VOICE_IO_BUFFER_SIZE;
        size_t bytes_read = 0;
        err = i2s_channel_read(
            s_rx_channel,
            audio_buffer,
            bytes_to_read,
            &bytes_read,
            pdMS_TO_TICKS(1000)
        );
        if (err != ESP_OK || bytes_read == 0) {
            ESP_LOGE(TAG, "I2S read failed after %u bytes: %s", (unsigned)total_bytes, esp_err_to_name(err));
            goto close_connection;
        }

        const int16_t *samples = (const int16_t *)audio_buffer;
        const size_t samples_in_buffer = bytes_read / sizeof(int16_t);
        for (size_t index = 0; index < samples_in_buffer; index++) {
            const int32_t sample = samples[index];
            const uint32_t magnitude = sample < 0 ? (uint32_t)(-sample) : (uint32_t)sample;
            magnitude_sum += magnitude;
            if (magnitude > peak) {
                peak = magnitude;
            }
        }
        sample_count += (uint32_t)samples_in_buffer;

        err = write_all(client, audio_buffer, bytes_read);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "PCM upload failed after %u bytes", (unsigned)total_bytes);
            goto close_connection;
        }
        total_bytes += bytes_read;
    }

    ESP_LOGI(
        TAG,
        "Silent recording complete: bytes=%u avg_level=%" PRIu32 " peak=%" PRIu32,
        (unsigned)total_bytes,
        sample_count == 0 ? 0 : (uint32_t)(magnitude_sum / sample_count),
        peak
    );
    if (remote_test) {
        mqtt_agent_report_voice_test(
            test_session_id,
            "UPLOADING",
            "PCM capture complete; waiting for server response"
        );
    }

    if (s_cancel_requested) {
        err = ESP_ERR_INVALID_STATE;
        goto close_connection;
    }

    if (esp_http_client_fetch_headers(client) < 0) {
        err = ESP_FAIL;
        ESP_LOGE(TAG, "Failed to read voice HTTP response headers");
        goto close_connection;
    }

    const int response_length = esp_http_client_read_response(
        client,
        response_buffer,
        VOICE_RESPONSE_BUFFER_SIZE - 1
    );
    if (response_length < 0) {
        err = ESP_FAIL;
        ESP_LOGE(TAG, "Failed to read voice HTTP response body");
        goto close_connection;
    }
    response_buffer[response_length] = '\0';

    const int status_code = esp_http_client_get_status_code(client);
    ESP_LOGI(TAG, "Voice pipeline HTTP status: %d, response bytes=%d", status_code, response_length);
    play_ack_after_cleanup = log_pipeline_response(response_buffer, status_code);
    err = status_code >= 200 && status_code < 300 ? ESP_OK : ESP_FAIL;

close_connection:
    esp_http_client_close(client);
cleanup:
    esp_http_client_cleanup(client);
    free(response_buffer);
    free(audio_buffer);
    if (err == ESP_OK && play_ack_after_cleanup && !s_cancel_requested) {
        err = play_wake_ack();
    }
    return err;
}

static void voice_capture_task(void *argument)
{
    (void)argument;
    int previous_level = 1;

    ESP_LOGI(TAG, "Press GPIO%d once to open a %d-second silent recording window",
             DX_LICHUANG_RECORD_BUTTON_GPIO, DX_VOICE_RECORD_SECONDS);
    while (true) {
        audio_test_request_t audio_request;
        if (s_audio_test_queue != NULL &&
            xQueueReceive(s_audio_test_queue, &audio_request, 0) == pdTRUE) {
            s_playback_pending = false;
            s_playback_active = true;
            esp_err_t playback_err = s_playback_cancel_requested
                ? ESP_ERR_INVALID_STATE
                : download_and_play_audio_test(&audio_request);
            if (s_playback_cancel_requested) {
                mqtt_agent_report_audio_test(audio_request.test_id, "CANCELLED", "Playback cancelled");
            } else if (playback_err == ESP_OK) {
                mqtt_agent_report_audio_test(audio_request.test_id, "COMPLETED", "Playback completed");
            } else {
                char message[96];
                snprintf(message, sizeof(message), "Playback failed: %s", esp_err_to_name(playback_err));
                mqtt_agent_report_audio_test(audio_request.test_id, "FAILED", message);
            }
            s_playback_active = false;
            s_playback_cancel_requested = false;
        }

        voice_test_request_t request;
        if (s_voice_request_queue != NULL &&
            xQueueReceive(s_voice_request_queue, &request, 0) == pdTRUE) {
            s_capture_pending = false;
            s_capture_active = true;
            if (s_cancel_requested) {
                mqtt_agent_report_voice_test(
                    request.test_session_id,
                    "CANCELLED",
                    "Voice test cancelled before recording started"
                );
            } else {
                esp_err_t err = capture_and_upload(request.test_session_id, request.asr_only);
                if (s_cancel_requested) {
                    mqtt_agent_report_voice_test(
                        request.test_session_id,
                        "CANCELLED",
                        "Voice recording cancelled"
                    );
                } else if (err != ESP_OK) {
                    char message[96];
                    snprintf(message, sizeof(message), "Voice capture failed: %s", esp_err_to_name(err));
                    mqtt_agent_report_voice_test(request.test_session_id, "FAILED", message);
                    ESP_LOGE(TAG, "%s", message);
                }
            }
            s_capture_active = false;
            s_cancel_requested = false;
        }

        const int current_level = gpio_get_level((gpio_num_t)DX_LICHUANG_RECORD_BUTTON_GPIO);
        if (!s_capture_active && !s_capture_pending && !s_playback_active && !s_playback_pending &&
            previous_level == 1 && current_level == 0) {
            vTaskDelay(pdMS_TO_TICKS(40));
            if (gpio_get_level((gpio_num_t)DX_LICHUANG_RECORD_BUTTON_GPIO) == 0) {
                s_capture_active = true;
                s_cancel_requested = false;
                esp_err_t err = capture_and_upload(NULL, false);
                s_capture_active = false;
                if (err != ESP_OK) {
                    ESP_LOGE(TAG, "Voice capture request failed: %s", esp_err_to_name(err));
                }
                while (gpio_get_level((gpio_num_t)DX_LICHUANG_RECORD_BUTTON_GPIO) == 0) {
                    vTaskDelay(pdMS_TO_TICKS(20));
                }
            }
        }
        previous_level = current_level;
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

#endif

esp_err_t voice_engine_start_test(const char *test_session_id, bool asr_only)
{
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    if (test_session_id == NULL || test_session_id[0] == '\0' ||
        strlen(test_session_id) >= VOICE_TEST_SESSION_ID_SIZE) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_voice_request_queue == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_capture_active || s_capture_pending) {
        return ESP_ERR_INVALID_STATE;
    }

    voice_test_request_t request = {0};
    strncpy(request.test_session_id, test_session_id, sizeof(request.test_session_id) - 1);
    request.asr_only = asr_only;
    s_cancel_requested = false;
    s_capture_pending = true;
    if (xQueueSend(s_voice_request_queue, &request, 0) != pdTRUE) {
        s_capture_pending = false;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "Voice test queued from development console: %s", test_session_id);
    return ESP_OK;
#else
    (void)test_session_id;
    (void)asr_only;
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t voice_engine_stop_test(const char *test_session_id)
{
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    if (test_session_id == NULL || test_session_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_capture_active && !s_capture_pending) {
        return ESP_ERR_INVALID_STATE;
    }
    s_cancel_requested = true;
    ESP_LOGI(TAG, "Voice test stop requested: %s", test_session_id);
    return ESP_OK;
#else
    (void)test_session_id;
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t voice_engine_start_audio_test(const char *test_id, const char *audio_path)
{
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    if (test_id == NULL || audio_path == NULL || test_id[0] == '\0' || audio_path[0] == '\0' ||
        strlen(test_id) >= AUDIO_TEST_ID_SIZE || strlen(audio_path) >= AUDIO_TEST_PATH_SIZE) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_audio_test_queue == NULL || s_playback_active || s_playback_pending ||
        s_capture_active || s_capture_pending) {
        return ESP_ERR_INVALID_STATE;
    }
    audio_test_request_t request = {0};
    strncpy(request.test_id, test_id, sizeof(request.test_id) - 1);
    strncpy(request.audio_path, audio_path, sizeof(request.audio_path) - 1);
    s_playback_cancel_requested = false;
    s_playback_pending = true;
    if (xQueueSend(s_audio_test_queue, &request, 0) != pdTRUE) {
        s_playback_pending = false;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "Audio test queued from development console: %s", test_id);
    return ESP_OK;
#else
    (void)test_id;
    (void)audio_path;
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t voice_engine_stop_audio_test(const char *test_id)
{
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    if (test_id == NULL || test_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_playback_active && !s_playback_pending) {
        return ESP_ERR_INVALID_STATE;
    }
    s_playback_cancel_requested = true;
    ESP_LOGI(TAG, "Audio test stop requested: %s", test_id);
    return ESP_OK;
#else
    (void)test_id;
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

void voice_engine_preinit(void)
{
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 0);
    gpio_set_direction((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level((gpio_num_t)DX_LICHUANG_PA_ENABLE_GPIO, 0);
#endif
}

void voice_engine_init(void)
{
    const dx_board_profile_t *board = dx_board_profile_get();
    ESP_LOGI(TAG, "Voice engine board=%s audio=%s", board->name, board->has_audio ? "yes" : "no");

#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
    voice_engine_preinit();

    esp_err_t err = configure_i2s();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2S microphone init failed: %s", esp_err_to_name(err));
        return;
    }
    if ((err = configure_i2c()) != ESP_OK) {
        ESP_LOGE(TAG, "ES8311 I2C init failed: %s", esp_err_to_name(err));
        return;
    }
    if ((err = configure_codec()) != ESP_OK) {
        ESP_LOGE(TAG, "ES8311 codec init failed: %s", esp_err_to_name(err));
        return;
    }
    if ((err = configure_button()) != ESP_OK) {
        ESP_LOGE(TAG, "Record button init failed: %s", esp_err_to_name(err));
        return;
    }

    s_voice_request_queue = xQueueCreate(
        VOICE_REQUEST_QUEUE_DEPTH,
        sizeof(voice_test_request_t)
    );
    if (s_voice_request_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create voice test request queue");
        return;
    }
    s_audio_test_queue = xQueueCreate(
        VOICE_REQUEST_QUEUE_DEPTH,
        sizeof(audio_test_request_t)
    );
    if (s_audio_test_queue == NULL) {
        vQueueDelete(s_voice_request_queue);
        s_voice_request_queue = NULL;
        ESP_LOGE(TAG, "Failed to create audio test request queue");
        return;
    }

    BaseType_t task_result = xTaskCreate(
        voice_capture_task,
        "voice_capture",
        VOICE_TASK_STACK_SIZE,
        NULL,
        VOICE_TASK_PRIORITY,
        NULL
    );
    if (task_result != pdPASS) {
        vQueueDelete(s_voice_request_queue);
        vQueueDelete(s_audio_test_queue);
        s_voice_request_queue = NULL;
        s_audio_test_queue = NULL;
        ESP_LOGE(TAG, "Failed to create voice capture task");
        return;
    }

    ESP_LOGI(TAG, "Silent ASR test mode ready; amplifier GPIO%d remains low",
             DX_LICHUANG_PA_ENABLE_GPIO);
#else
    ESP_LOGI(TAG, "CI1302 voice adapter is not enabled for this board profile");
#endif
}
