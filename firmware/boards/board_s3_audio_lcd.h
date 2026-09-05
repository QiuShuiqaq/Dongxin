/**
 * @file board_s3_audio_lcd.h
 * @brief 幻尔 ESP32-S3 开发板 V1.1 板级引脚定义
 * 
 * 硬件规格：
 *   - 主控: ESP32-S3-WROOM (Xtensa LX7 双核 240MHz)
 *   - Flash: 16MB
 *   - PSRAM: 8MB (Octal SPI)
 *   - 音频Codec: ES8311 (I2S + I2C)
 *   - 屏幕: ST7789 320x240 SPI LCD
 *   - 触摸: FT6206 (I2C)
 *   - IO扩展: XL9555 (I2C, 16路IO)
 *   - 传感器: AP3216C(光环境) + AHT30(温湿度) + QMI8658(六轴IMU)
 *   - 麦克风: 模拟麦克风(经ES8311 ADC)
 *   - 扬声器: 经功放(ES8311 DAC + MUTE控制)
 *   - SD卡: SPI接口
 *   - LED: 2个(GPIO43/GPIO44)
 *   - 按键: 4个(经XL9555)
 * 
 * @note 本文件从官方示例代码(01_audio_es8311/02_spilcd/03_touch)提取
 */
#ifndef __BOARD_S3_AUDIO_LCD_H
#define __BOARD_S3_AUDIO_LCD_H

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "driver/spi_master.h"
#include "esp_lcd_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================
 *  主控与存储
 * ============================================================ */
#define BOARD_NAME              "Hiwonder ESP32-S3 DevKit V1.1"
#define BOARD_CHIP              "ESP32-S3-WROOM"
#define BOARD_FLASH_SIZE        (16 * 1024 * 1024)   /* 16MB */
#define BOARD_PSRAM_SIZE        (8 * 1024 * 1024)    /* 8MB */
#define BOARD_HAS_PSRAM         1

/* ============================================================
 *  I2C 总线 0 — 传感器 / XL9555 / 触摸 / EEPROM
 *  (官方示例称 MYIIC)
 * ============================================================ */
#define I2C0_PORT               I2C_NUM_0
#define I2C0_SDA                GPIO_NUM_38
#define I2C0_SCL                GPIO_NUM_48
#define I2C0_SPEED              400000  /* 400KHz */

/* I2C0 设备地址 */
#define XL9555_I2C_ADDR         0x20    /* IO扩展芯片 */
#define FT6206_I2C_ADDR         0x38    /* 触摸芯片 (7bit地址) */
#define AP3216C_I2C_ADDR        0x1E    /* 光环境传感器 */
#define AHT30_I2C_ADDR          0x38    /* 温湿度传感器 (注意: 与FT6206同地址? 需实际确认) */
#define QMI8658_I2C_ADDR        0x6B    /* 六轴IMU */

/* ============================================================
 *  I2C 总线 1 — ES8311 音频Codec
 * ============================================================ */
#define I2C1_PORT               I2C_NUM_1
#define I2C1_SDA                GPIO_NUM_4
#define I2C1_SCL                GPIO_NUM_5
#define I2C1_SPEED              400000

#define ES8311_I2C_ADDR_7BIT    0x18
#define ES8311_I2C_ADDR_8BIT    0x30    /* 0x18 << 1 */
#define ES8311_I2C_ADDR         ES8311_I2C_ADDR_7BIT

/* ============================================================
 *  I2S — 音频数据 (ES8311)
 * ============================================================ */
#define I2S_PORT                I2S_NUM_0
#define I2S_MCLK                GPIO_NUM_45
#define I2S_BCLK                GPIO_NUM_39
#define I2S_LRCLK               GPIO_NUM_41   /* WS */
#define I2S_DOUT                GPIO_NUM_42   /* ESP32 -> ES8311 (播放) */
#define I2S_DIN                 GPIO_NUM_40   /* ES8311 -> ESP32 (录音) */

#define AUDIO_SAMPLE_RATE       16000
#define AUDIO_BITS_PER_SAMPLE   16
#define AUDIO_CHANNELS          1       /* 单声道 */
#define AUDIO_MIC_GAIN_DB       25.0f   /* 麦克风增益 */
#define AUDIO_SPEAKER_VOLUME    70      /* 扬声器音量 (0-100) */

/* ============================================================
 *  SPI 总线 — LCD屏幕 + SD卡
 * ============================================================ */
#define SPI_HOST                SPI2_HOST
#define SPI_SCLK                GPIO_NUM_21
#define SPI_MOSI                GPIO_NUM_47
#define SPI_MISO                GPIO_NUM_14

/* LCD (ST7789) */
#define LCD_DC                  GPIO_NUM_3
#define LCD_CS                  GPIO_NUM_2
#define LCD_RST                 GPIO_NUM_NC  /* 不接，软件复位 */
#define LCD_PWR                 GPIO_NUM_NC  /* 不接，常供电 */
#define LCD_DRIVER              "ST7789"
#define LCD_WIDTH               320
#define LCD_HEIGHT              240
#define LCD_COLOR_FORMAT        LCD_COLOR_PIXEL_FORMAT_RGB565

/* SD卡 */
#define SD_CS                   GPIO_NUM_0

/* ============================================================
 *  XL9555 IO扩展芯片引脚映射
 *  (16位掩码: bit0-7 = P0, bit8-15 = P1)
 * ============================================================ */
#define XL9555_INT_PIN          GPIO_NUM_46   /* XL9555中断输出 */

/* P0 端口 */
#define XL9555_CAMERA_LED       0x0001   /* P0.0 摄像头LED */
#define XL9555_IMU_INT1         0x0002   /* P0.1 IMU中断 */
#define XL9555_TF_CS             0x0008   /* P0.3 TF卡CS(备用) */
#define XL9555_KEY1              0x0010   /* P0.4 按键1 */
#define XL9555_KEY2              0x0020   /* P0.5 按键2 */
#define XL9555_KEY3              0x0040   /* P0.6 按键3 */
#define XL9555_KEY4              0x0080   /* P0.7 按键4 */

/* P1 端口 */
#define XL9555_AP_INT            0x0100   /* P1.0 光环境传感器中断 */
#define XL9555_TP_INT            0x0200   /* P1.1 触摸中断 */
#define XL9555_LCD_CS            0x2000   /* P1.5 LCD CS(备用) */
#define XL9555_BACKLIGHT         0x4000   /* P1.6 屏幕背光控制 */
#define XL9555_MUTE              0x8000   /* P1.7 扬声器静音(1=播放, 0=静音) */

/* ============================================================
 *  LED (直连GPIO)
 * ============================================================ */
#define LED0_PIN                GPIO_NUM_43
#define LED1_PIN                GPIO_NUM_44

/* ============================================================
 *  触摸 (FT6206)
 * ============================================================ */
#define TOUCH_CHIP              "FT6206"
#define TOUCH_RST_PIN           GPIO_NUM_NC   /* 不接 */
#define TOUCH_INT_PIN           XL9555_TP_INT /* 经XL9555读取 */
#define TOUCH_MAX_POINTS        2

/* ============================================================
 *  UART (需根据实际硬件确认)
 * ============================================================ */
/* ESP32-S3 默认UART0用于USB串口调试，引脚可能为GPIO43/44但被LED占用
   实际使用Type-C的USB-UART桥接芯片，无需手动配置GPIO */
#define CONSOLE_UART_PORT       UART_NUM_0
#define CONSOLE_UART_BAUD       115200

/* ============================================================
 *  传感器
 * ============================================================ */
#define SENSOR_ALS              "AP3216C"   /* 光环境(光照+接近+红外) */
#define SENSOR_TEMP_HUMI        "AHT30"      /* 温湿度 */
#define SENSOR_IMU              "QMI8658"    /* 六轴(加速度+陀螺仪) */

/* ============================================================
 *  分区表建议 (16MB Flash)
 * ============================================================ */
/*
 * Name,   Type, SubType, Offset,   Size,    Flags
 * nvs,    data, nvs,     0x9000,   0x6000,
 * phy,    data, phy,     0xf000,   0x1000,
 * factory,app, factory,  0x10000,  0x300000,  (3MB application)
 * storage,data, fat,     0x310000, 0xA00000,  (10MB resource storage)
 * ota_0,  app,  ota_0,   0xD10000, 0x2F0000,  (~3MB OTA partition)
 */

#ifdef __cplusplus
}
#endif

#endif /* __BOARD_S3_AUDIO_LCD_H */
