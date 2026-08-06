import type { AiResult, DeviceIntent, DeviceState, SafetyResult } from '@dongxin/shared';

const heatingIntents = new Set<DeviceIntent>(['HEAT_WEAK_ON', 'HEAT_STRONG_ON', 'CONSTANT_TEMP_ON']);

export function applySafetyRules(aiResult: AiResult, deviceState: DeviceState): SafetyResult {
  if (aiResult.resultType !== 'DEVICE_CONTROL' || !aiResult.intent) {
    return {
      decision: aiResult.resultType === 'REJECT' ? 'REJECTED' : 'NO_ACTION',
      commands: [],
      reason: '模型结果不是设备控制指令',
      speak: aiResult.speak || '我可以继续为您解答'
    };
  }

  if (!deviceState.isOnline) {
    return {
      decision: 'REJECTED',
      commands: [],
      reason: '设备模拟器处于离线状态',
      speak: '设备当前离线，不能执行控制动作'
    };
  }

  if (deviceState.faultCode && heatingIntents.has(aiResult.intent)) {
    return {
      decision: 'REJECTED',
      commands: [],
      reason: `设备存在故障码 ${deviceState.faultCode}，禁止开启取暖`,
      speak: '设备存在故障，请先排查后再开启取暖'
    };
  }

  if (aiResult.intent === 'SET_TEMP') {
    const temperature = aiResult.slots.temperature;
    if (typeof temperature !== 'number' || temperature < 30 || temperature > 45) {
      return {
        decision: 'REJECTED',
        commands: [],
        reason: '目标温度必须在 30 到 45 摄氏度之间',
        speak: '温度只能设置在 30 到 45 度之间'
      };
    }
  }

  if (aiResult.intent === 'HEAT_STRONG_ON' && aiResult.confidence < 0.85) {
    return {
      decision: 'NEEDS_CONFIRMATION',
      commands: [],
      reason: '强暖属于较高功率动作，低置信度时需要二次确认',
      speak: '是否确认打开强暖？'
    };
  }

  const duration = aiResult.slots.durationMinutes;
  if (duration && duration > 120) {
    return {
      decision: 'REJECTED',
      commands: [],
      reason: '运行时长超过 120 分钟上限',
      speak: '最长只能设置 120 分钟'
    };
  }

  return {
    decision: aiResult.requiresConfirm ? 'NEEDS_CONFIRMATION' : 'APPROVED',
    commands: aiResult.requiresConfirm ? [] : [aiResult.intent],
    reason: aiResult.requiresConfirm ? '模型要求二次确认' : '通过安全规则',
    speak: aiResult.speak || '已执行'
  };
}
