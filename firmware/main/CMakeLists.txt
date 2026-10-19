# 东信智能浴霸AI联网版 - 主程序构建配置
idf_component_register(
    SRCS
        "app_main.c"
        "board_support.c"
        "board_profile.c"
        "board_lab.c"
        "wifi_manager.c"
        "cloud_agent.c"
        "mqtt_agent.c"
        "device_command.c"
        "command_queue.c"
        "device_controller.c"
        "direct_control_hal.c"
        "pcf8574.c"
        "uart_bridge.c"
        "sample_uart_monitor.c"
        "voice_engine.c"
        "device_state.c"
    INCLUDE_DIRS "."
    REQUIRES esp_wifi esp_event esp_netif esp_http_client mqtt esp_timer esp_psram esp_driver_uart esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_driver_spi esp_driver_ledc esp_lcd json nvs_flash es8311
    EMBED_FILES "assets/wake_ack_16k_mono.pcm"
)
