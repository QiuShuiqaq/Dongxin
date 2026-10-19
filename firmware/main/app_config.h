#ifndef DX_APP_CONFIG_H
#define DX_APP_CONFIG_H

#include "sdkconfig.h"

/*
 * First-stage development configuration.
 *
 * Fill in the Wi-Fi and gateway values before flashing a network test build.
 * Do not put LLM, ASR, TTS or other third-party API keys in this firmware.
 */

/*
 * Board target selection.
 * Keep C3 as the default low-cost verification board.
 * Switch to DX_BOARD_S3 when building the S3 validation board image.
 */
#define DX_BOARD_C3 0
#define DX_BOARD_S3 1
#define DX_BOARD_C3_LICHUANG_AUDIO 2

/*
 * When no board is specified explicitly, follow the ESP-IDF target selected
 * by the build directory. This keeps C3 and S3 builds reproducible without
 * editing this header between builds.
 */
#ifndef DX_TARGET_BOARD
#if defined(CONFIG_IDF_TARGET_ESP32S3) && CONFIG_IDF_TARGET_ESP32S3
#define DX_TARGET_BOARD DX_BOARD_S3
#elif defined(CONFIG_DX_BOARD_C3_LICHUANG_AUDIO) && CONFIG_DX_BOARD_C3_LICHUANG_AUDIO
#define DX_TARGET_BOARD DX_BOARD_C3_LICHUANG_AUDIO
#elif defined(CONFIG_IDF_TARGET_ESP32C3) && CONFIG_IDF_TARGET_ESP32C3
#define DX_TARGET_BOARD DX_BOARD_C3
#else
#define DX_TARGET_BOARD DX_BOARD_C3
#endif
#endif

#if DX_TARGET_BOARD == DX_BOARD_S3
#define DX_DEVICE_ID "DX-S3-DEVKIT-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-S3-DEV"
#elif DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
#define DX_DEVICE_ID "DX-C3-LICHUANG-AUDIO-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-C3-LICHUANG-AUDIO"
#else
#define DX_DEVICE_ID "DX-C3-SUPERMINI-HW466AB-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-C3-SUPERMINI"
#endif

#define DX_FIRMWARE_VERSION "0.6.0-stm32-monitor"
#define DX_PROTOCOL_VERSION "1.0"

/* Feature switches for the staged board bring-up. */
#define DX_ENABLE_WIFI 1
#define DX_ENABLE_CLOUD 0
#define DX_ENABLE_MQTT 1
/* Retired V0.2 simulator protocol. It is incompatible with the current STM32
 * sample and must remain disabled. A reviewed adapter will replace it. */
#define DX_ENABLE_UART_BRIDGE 0
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
#define DX_ENABLE_SAMPLE_UART_MONITOR 1
#else
#define DX_ENABLE_SAMPLE_UART_MONITOR 0
#endif
#if DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
#define DX_ENABLE_AUDIO 1
#else
#define DX_ENABLE_AUDIO 0
#endif
#define DX_ENABLE_TEXT_SIMULATION 1
#define DX_ENABLE_NTC_CONTROL 0

/*
 * Historical cost-reduction research only. The current product baseline keeps
 * the existing STM32 controller, so PCF8574 direct control must stay disabled.
 * The virtual HAL remains available for C3 command-queue software tests.
 */
#define DX_ENABLE_PCF8574 0
#define DX_PCF8574_I2C_PORT 0
#define DX_PCF8574_I2C_SDA_GPIO -1
#define DX_PCF8574_I2C_SCL_GPIO -1
#define DX_PCF8574_I2C_FREQUENCY_HZ 100000
#define DX_PCF8574_ADDRESS_0 0x20
#define DX_PCF8574_ADDRESS_1 0x21
#define DX_PCF8574_ADDRESS_2 0x22
#define DX_LOAD_ENABLE_GPIO -1
#define DX_LOAD_ENABLE_ACTIVE_LEVEL 1

/* Safe placeholders; thermal testing may change these values. */
#define DX_FAN_PREHEAT_DELAY_MS 1000
#define DX_FAN_COOLDOWN_SECONDS 120
#define DX_HEATER_MAX_CONTINUOUS_MINUTES 60
#define DX_DRY_MAX_MINUTES 60
#define DX_COMMAND_QUEUE_DEPTH 8

/*
 * Use the computer's LAN IP during local testing.
 * Do not use localhost or 127.0.0.1 because those point to the C3 itself.
 */
#define DX_WIFI_SSID "TP-LINK_3DB722"
/* TP-LINK_3DB722 is an open network, so the password stays empty. */
#define DX_WIFI_PASSWORD ""
/* Leave roaming enabled by default; set to 1 only when the AP BSSID is known
 * to be stable and association diagnostics require pinning it. */
#define DX_WIFI_LOCK_BSSID 0
#define DX_WIFI_BSSID {0xC8, 0x94, 0xBB, 0xB0, 0xA3, 0xAC}
#define DX_GATEWAY_BASE_URL "http://192.168.16.146:3077"
#define DX_MQTT_BROKER_URI "mqtt://192.168.16.146:1883"
#define DX_MQTT_USERNAME DX_DEVICE_ID
/* Development credential only. Production credentials are provisioned per device. */
#if DX_TARGET_BOARD == DX_BOARD_S3
#define DX_MQTT_DEVICE_SECRET "dongxin-local-s3-001"
#elif DX_TARGET_BOARD == DX_BOARD_C3_LICHUANG_AUDIO
#define DX_MQTT_DEVICE_SECRET "dongxin-local-lichuang-001"
#else
#define DX_MQTT_DEVICE_SECRET "dongxin-local-c3-001"
#endif
#define DX_MQTT_KEEPALIVE_SECONDS 60

#define DX_HEARTBEAT_INTERVAL_SECONDS 30
#define DX_STATE_REPORT_INTERVAL_SECONDS 30
#define DX_COMMAND_POLL_INTERVAL_SECONDS 3
#define DX_HTTP_TIMEOUT_MS 5000
#define DX_WIFI_CONNECT_TIMEOUT_SECONDS 30

/* Lichuang ESP32-C3 audio validation board. The PA stays disabled at boot and
 * is enabled only for an explicit, bounded playback request. */
#define DX_LICHUANG_I2C_PORT 0
#define DX_LICHUANG_I2C_SDA_GPIO 0
#define DX_LICHUANG_I2C_SCL_GPIO 1
#define DX_LICHUANG_I2S_PORT 0
#define DX_LICHUANG_I2S_MCLK_GPIO 10
#define DX_LICHUANG_I2S_BCLK_GPIO 8
#define DX_LICHUANG_I2S_WS_GPIO 12
#define DX_LICHUANG_I2S_DOUT_GPIO 11
#define DX_LICHUANG_I2S_DIN_GPIO 7
#define DX_LICHUANG_RECORD_BUTTON_GPIO 9
#define DX_LICHUANG_PA_ENABLE_GPIO 13
#define DX_LICHUANG_WAKE_ACK_VOLUME 8
#define DX_LICHUANG_PLAYBACK_DEFAULT_VOLUME 20
#define DX_LICHUANG_PLAYBACK_MIN_VOLUME 5
#define DX_LICHUANG_PLAYBACK_MAX_VOLUME 80
#define DX_VOICE_SAMPLE_RATE 16000
#define DX_VOICE_BITS_PER_SAMPLE 16
#define DX_VOICE_CHANNELS 1
#define DX_VOICE_RECORD_SECONDS 6
#define DX_VOICE_HTTP_TIMEOUT_MS 45000
#define DX_VOICE_PCM_URL \
    DX_GATEWAY_BASE_URL "/api/device/v1/voice-pcm?deviceId=" DX_DEVICE_ID \
    "&sampleRate=16000&bitsPerSample=16&channels=1&requireWakeWord=1&synthesizeSpeech=0&testMode=FULL_PIPELINE"
#define DX_VOICE_PCM_ASR_ONLY_URL \
    DX_GATEWAY_BASE_URL "/api/device/v1/voice-pcm?deviceId=" DX_DEVICE_ID \
    "&sampleRate=16000&bitsPerSample=16&channels=1&requireWakeWord=0&synthesizeSpeech=0&testMode=ASR_ONLY"

/* Retired V0.2 MCU simulator protocol. Do not use these pins with the STM32
 * sample; its real protocol will be implemented in a separate adapter. */
#if DX_TARGET_BOARD == DX_BOARD_S3
#define DX_UART_TX_GPIO 17
#define DX_UART_RX_GPIO 18
#else
#define DX_UART_TX_GPIO 4
#define DX_UART_RX_GPIO 5
#endif
#define DX_UART_BAUD_RATE 115200
#define DX_MCU_STATE_QUERY_INTERVAL_SECONDS 30

/* Existing Dongxin STM32 sample, receive-only bring-up on the Lichuang board.
 * GPIO18 is reserved for a future reviewed TX path and is not configured. */
#define DX_SAMPLE_UART_TX_RESERVED_GPIO 18
#define DX_SAMPLE_UART_RX_GPIO 19
#define DX_SAMPLE_UART_BAUD_RATE 115200

#endif
