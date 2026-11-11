import { z } from 'zod';

const ScenarioSchema = z.object({
  deviceId: z.string().min(1),
  scenario: z.enum(['WIFI_DOWN_FIXED_COMMAND', 'WIFI_DOWN_OPEN_QUESTION', 'CLOUD_TIMEOUT', 'RECONNECT_STALE_COMMAND', 'DUPLICATE_LOCAL_EVENT']),
});

/** Pure rehearsal: no persistent device state, MQTT message, paid AI call or load command. */
export function evaluateDevelopmentScenario(input: unknown) {
  const { deviceId, scenario } = ScenarioSchema.parse(input);
  const cases = {
    WIFI_DOWN_FIXED_COMMAND: {
      title: 'Wi-Fi 断开 · 固定词命中',
      steps: ['CI1302 识别固定词', 'STM32 按本地互锁执行', 'C3/云端不可用，不参与该动作', '网络恢复后仅上报真实状态，不补发旧控制'],
      expected: '本地控制保持可用；不调用 ASR、LLM、TTS',
    },
    WIFI_DOWN_OPEN_QUESTION: {
      title: 'Wi-Fi 断开 · 开放问题',
      steps: ['CI1302 唤醒但未命中固定词', 'C3 检测在线链路不可用', '不缓存问题等待联网重放', '向用户提示当前不能在线回答'],
      expected: '不执行设备动作；不把旧语音在恢复联网后重新上传',
    },
    CLOUD_TIMEOUT: {
      title: '云端超时',
      steps: ['C3 上传本句音频', '服务端任务超时或队列拒绝', '在线指令不得延迟执行', '本地固定词与遥控器照常工作'],
      expected: '当前轮次失败可见；无过期控制或伪成功播报',
    },
    RECONNECT_STALE_COMMAND: {
      title: '恢复联网 · 旧指令',
      steps: ['在线控制生成后网络断开', '本地控制推进版本', '网络恢复并尝试投递旧命令', '有效期／版本校验拒绝旧命令'],
      expected: '不重放失效的取暖、风机或照明动作',
    },
    DUPLICATE_LOCAL_EVENT: {
      title: '本地事件重复上报',
      steps: ['STM32 只执行一次本地命令', 'C3 上报同一事件 ID', 'MQTT QoS 1 重复到达', '服务端复用既有记录，不再次推进控制'],
      expected: '设备只执行一次；事件去重结果可追踪',
    },
  } as const;
  return { simulation: true, deviceId, scenario, ...cases[scenario],
    actionExecuted: false, deviceStateChanged: false,
    note: '这是预设逻辑推演，不代表真实断网或样机测试通过。' };
}
