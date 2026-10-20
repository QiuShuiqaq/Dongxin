#ifndef MQTT_AGENT_H
#define MQTT_AGENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "stm32_protocol.h"

void mqtt_agent_init(void);
bool mqtt_agent_is_connected(void);
esp_err_t mqtt_agent_report_state(void);
esp_err_t mqtt_agent_report_stm32_link(
    const char *direction,
    const char *event_type,
    const uint8_t *frame,
    size_t frame_length,
    const dx_stm32_status_t *status,
    bool valid,
    const char *result,
    uint32_t rejected_frames,
    uint32_t discarded_bytes
);
esp_err_t mqtt_agent_report_voice_test(
    const char *test_session_id,
    const char *status,
    const char *message
);
esp_err_t mqtt_agent_report_audio_test(
    const char *test_id,
    const char *status,
    const char *message
);

#endif
