/*
 * 语音引擎模块
 * 职责：离线语音唤醒与识别（27项本地指令）、联网AI对话（豆包SDK）、TTS语音播报
 * 双引擎：离线稳定（断网可用）、联网智能（自然对话/生活服务/内容服务）
 */

#include "esp_log.h"
#include "board_profile.h"
#include "voice_engine.h"

static const char *TAG = "VOICE_ENG";

void voice_engine_init(void)
{
    const dx_board_profile_t *board = dx_board_profile_get();

    ESP_LOGI(TAG, "语音引擎初始化（桩版本）");
    ESP_LOGI(
        TAG,
        "Active board: %s (%s), audio=%s display=%s touch=%s ioexpander=%s psram=%s sensors=%s",
        board->name,
        board->chip,
        board->has_audio ? "yes" : "no",
        board->has_display ? "yes" : "no",
        board->has_touch ? "yes" : "no",
        board->has_io_expander ? "yes" : "no",
        board->has_psram ? "yes" : "no",
        board->has_sensors ? "yes" : "no"
    );
    ESP_LOGI(TAG, "TODO: 初始化音频Codec、麦克风采集、扬声器播放");
    ESP_LOGI(TAG, "TODO: 加载离线语音模型（唤醒词'小东' + 27项本地指令）");
    ESP_LOGI(TAG, "TODO: 集成语音前端（VAD/AEC/NS）、远场降噪");
    ESP_LOGI(TAG, "TODO: 联网模式对接豆包对话SDK、TTS播报");
}
