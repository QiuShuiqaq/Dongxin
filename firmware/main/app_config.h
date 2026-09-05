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
#define DX_DEVICE_ID "DX-C3-SUPERMINI-001"
#define DX_DEVICE_MODEL "DX-AI-BATH-C3-DEV"
#endif

#define DX_FIRMWARE_VERSION "0.2.0-wifi"
#define DX_PROTOCOL_VERSION "0.1"

/* Feature switches for the staged board bring-up. */
#define DX_ENABLE_WIFI 1
#define DX_ENABLE_CLOUD 1
#define DX_ENABLE_UART_BRIDGE 0
#define DX_ENABLE_AUDIO 0

/*
 * Use the computer's LAN IP during local testing.
 * Do not use localhost or 127.0.0.1 because those point to the C3 itself.
 */
#define DX_WIFI_SSID ""
#define DX_WIFI_PASSWORD ""
#define DX_GATEWAY_BASE_URL "http://192.168.0.107:3077"

#define DX_HEARTBEAT_INTERVAL_SECONDS 30
#define DX_STATE_REPORT_INTERVAL_SECONDS 30
#define DX_HTTP_TIMEOUT_MS 5000
#define DX_WIFI_CONNECT_TIMEOUT_SECONDS 30

/*
 * The UART and audio pins are intentionally unset until Dongxin confirms
 * the actual wiring. Do not use these values for a hardware build.
 */
#define DX_UART_TX_GPIO (-1)
#define DX_UART_RX_GPIO (-1)
#define DX_UART_BAUD_RATE 115200

#endif
