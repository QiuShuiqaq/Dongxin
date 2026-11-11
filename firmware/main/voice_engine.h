#ifndef VOICE_ENGINE_H
#define VOICE_ENGINE_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

void voice_engine_preinit(void);
void voice_engine_init(void);
void voice_engine_on_ci_event(uint8_t event_type);
esp_err_t voice_engine_start_test(
    const char *test_session_id,
    bool asr_only,
    bool ci_wake_online_fallback,
    bool continuous,
    int endpoint_silence_ms,
    int idle_timeout_ms,
    int max_utterance_seconds,
    int voice_threshold,
    int noise_multiplier_tenths
);
esp_err_t voice_engine_stop_test(const char *test_session_id);
esp_err_t voice_engine_start_audio_test(
    const char *test_id,
    const char *audio_path,
    int volume_percent,
    bool listen_after_playback
);
esp_err_t voice_engine_stop_audio_test(const char *test_id);

#endif // VOICE_ENGINE_H
