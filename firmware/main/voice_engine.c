/*
 * 语音引擎模块
 * 职责：适配CI1302控制事件与I2S PCM、转发在线语音、请求提示音/播报
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
    ESP_LOGI(TAG, "TODO: 适配CI1302 UART0 115200控制事件和资源版本");
    ESP_LOGI(TAG, "TODO: 适配CI1302 I2S 16kHz/16bit/mono PCM采集与播放");
    ESP_LOGI(TAG, "TODO: 映射平台发布的唤醒词、离线语义ID和提示音资源");
    ESP_LOGI(TAG, "TODO: 未命中时通过在线ASR/规则/知识库/LLM/TTS链路处理");
}
