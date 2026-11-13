import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateDevelopmentScenario } from '../services/developmentScenario.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';

const scenarios = [
  { id: 'WIFI_DOWN_FIXED_COMMAND', title: '断网 · 固定命令', category: '网络', summary: '推演断网后 CI1302 固定词的本地控制路径' },
  { id: 'WIFI_DOWN_OPEN_QUESTION', title: '断网 · 开放提问', category: '网络', summary: '推演在线回答不可用时的处理方式' },
  { id: 'CI_WAKE_ONLY', title: 'CI 唤醒', category: '语音', summary: '推演单唤醒词入口和后续在线采音的分工' },
  { id: 'OCCUPANCY_ENTER', title: '有人进入', category: '主动沟通', summary: '推演人感事件触发问候，不向样机播报' },
  { id: 'PROVISIONING_LONG_PRESS', title: '长按进入配网', category: '配网', summary: '推演墙面板长按后的配网事件；当前硬件事件尚未接通' },
  { id: 'CLOUD_TIMEOUT', title: '云端超时', category: '语音', summary: '推演语音轮次超时后的动作边界' },
  { id: 'RECONNECT_STALE_COMMAND', title: '重连 · 过期命令', category: '控制', summary: '推演旧控制命令在重连后被拒绝' },
  { id: 'DUPLICATE_LOCAL_EVENT', title: '本地事件重复', category: '控制', summary: '推演 MQTT QoS 1 重发事件的幂等处理' },
] as const;

const ScenarioIdSchema = z.enum(scenarios.map((item) => item.id) as [
  (typeof scenarios)[number]['id'], ...(typeof scenarios)[number]['id'][]
]);
const RunScenarioSchema = z.object({
  deviceId: z.literal('DX-SIM-001'),
  scenario: ScenarioIdSchema,
}).strict();

const additionalCases = {
  CI_WAKE_ONLY: {
    title: 'CI 唤醒',
    steps: [
      'CI1302 识别“小东小东”并通过 STM32 通知 C3',
      'C3 保留唤醒后的语音采集窗口，等待固定词识别结果',
      '固定词命中由 STM32 执行并回传真实状态；未命中才考虑上传已采集语音',
    ],
    expected: '唤醒词只说一次；不能由这次推演证明实体采音时序已经通过',
  },
  OCCUPANCY_ENTER: {
    title: '有人进入',
    steps: [
      '以虚构人感事件进入主动沟通流程',
      '生成问候候选：“你来了，有什么需要我帮忙的吗？”',
      '等待用户明确表达需求；不执行设备控制',
    ],
    expected: '只展示预期问候，不读取真实传感器、不播放音频、不创建会话',
  },
  PROVISIONING_LONG_PRESS: {
    title: '长按进入配网',
    steps: [
      '以虚构墙面板长按事件作为配网请求入口',
      '预期 STM32 向 C3 上报专用配网事件，C3 校验后开启限时热点',
      '用户通过手机提交家庭 Wi-Fi，C3 取得 IP 后才保存配置并连接云端',
    ],
    expected: '只验证预设流程展示；墙面板长按事件尚未接入当前样机，未开启任何真实热点',
  },
} as const;

export async function registerLabRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/lab/scenarios', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    return { scenarios };
  });

  server.post('/api/operations/lab/scenarios/evaluate', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const { deviceId, scenario } = RunScenarioSchema.parse(request.body);
    const result = scenario in additionalCases
      ? { deviceId, scenario, ...additionalCases[scenario as keyof typeof additionalCases] }
      : evaluateDevelopmentScenario({ deviceId, scenario });
    return {
      ...result,
      simulation: true,
      actionExecuted: false,
      deviceStateChanged: false,
      audioPlayed: false,
      mqttPublished: false,
      note: '这是预设逻辑推演，不代表真实设备、网络或语音链路测试通过。',
    };
  });
}
