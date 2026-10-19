#ifndef VOICE_ENGINE_H
#define VOICE_ENGINE_H

#include <stdbool.h>

#include "esp_err.h"

void voice_engine_preinit(void);
void voice_engine_init(void);
esp_err_t voice_engine_start_test(const char *test_session_id, bool asr_only);
esp_err_t voice_engine_stop_test(const char *test_session_id);
esp_err_t voice_engine_start_audio_test(
    const char *test_id,
    const char *audio_path,
    int volume_percent
);
esp_err_t voice_engine_stop_audio_test(const char *test_id);

#endif // VOICE_ENGINE_H
