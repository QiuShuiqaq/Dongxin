#ifndef BOARD_LAB_H
#define BOARD_LAB_H

#include "cJSON.h"
#include "esp_err.h"

void board_lab_init(void);
void board_lab_preinit(void);
esp_err_t board_lab_execute(
    const char *action,
    const cJSON *params,
    cJSON **result,
    char *message,
    size_t message_size
);

#endif // BOARD_LAB_H
