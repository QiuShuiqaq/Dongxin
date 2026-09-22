#ifndef MQTT_AGENT_H
#define MQTT_AGENT_H

#include <stdbool.h>

#include "esp_err.h"

void mqtt_agent_init(void);
bool mqtt_agent_is_connected(void);
esp_err_t mqtt_agent_report_state(void);
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
