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

/*
 * When no board is specified explicitly, follow the ESP-IDF target selected
 * by the build directory. This keeps C3 and S3 builds reproducible without
 * editing this header between builds.
 */
#ifndef DX_TARGET_BOARD
#if defined(CONFIG_IDF_TARGET_ESP32S3) && CONFIG_IDF_TARGET_ESP32S3
#define DX_TARGET_BOARD DX_BOARD_S3
#elif defined(CONFIG_IDF_TARGET_ESP32C3) && CONFIG_IDF_TARGET_ESP32C3
#define DX_TARGET_BOARD DX_BOARD_C3
#else
#define DX_TARGET_BOARD DX_BOARD_C3
#endif
#endif

#if DX_TARGET_BOARD == DX_BOARD_S3
#define DX_DEVICE_ID "DX-S3-DEVKIT-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-S3-DEV"
#else
#define DX_DEVICE_ID "DX-C3-SUPERMINI-HW466AB-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-C3-SUPERMINI"
#endif

#define DX_FIRMWARE_VERSION "0.4.0-direct-control"
#define DX_PROTOCOL_VERSION "1.0"

/* Feature switches for the staged board bring-up. */
#define DX_ENABLE_WIFI 1
#define DX_ENABLE_CLOUD 0
#define DX_ENABLE_MQTT 1
#define DX_ENABLE_UART_BRIDGE 0
#define DX_ENABLE_AUDIO 0
#define DX_ENABLE_TEXT_SIMULATION 1
#define DX_ENABLE_NTC_CONTROL 0

/*
 * The current SuperMini has no Dongxin load board attached, so it uses the
 * virtual direct-control HAL. Enable the PCF8574 backend only for a reviewed
 * Dongxin schematic with the final pins filled in below.
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
#else
#define DX_MQTT_DEVICE_SECRET "dongxin-local-c3-001"
#endif
#define DX_MQTT_KEEPALIVE_SECONDS 60

#define DX_HEARTBEAT_INTERVAL_SECONDS 30
#define DX_STATE_REPORT_INTERVAL_SECONDS 30
#define DX_COMMAND_POLL_INTERVAL_SECONDS 3
#define DX_HTTP_TIMEOUT_MS 5000
#define DX_WIFI_CONNECT_TIMEOUT_SECONDS 30

/* Legacy MCU UART test asset. The new C3 board does not use this path for load
 * control; CI1302 has a separate UART0 control link in its board profile. */
#if DX_TARGET_BOARD == DX_BOARD_S3
#define DX_UART_TX_GPIO 17
#define DX_UART_RX_GPIO 18
#else
#define DX_UART_TX_GPIO 4
#define DX_UART_RX_GPIO 5
#endif
#define DX_UART_BAUD_RATE 115200
#define DX_MCU_STATE_QUERY_INTERVAL_SECONDS 30

#endif
