#ifndef CLOUD_AGENT_H
#define CLOUD_AGENT_H

#include "esp_err.h"

void cloud_agent_init(void);
esp_err_t cloud_agent_report_state(void);

#endif
