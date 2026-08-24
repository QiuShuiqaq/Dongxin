import type { AiResult, DeviceIntent } from '@dongxin/shared';
import { answerKnowledgeQuestion } from './knowledge.service.js';

export type LowCostIntentSource = 'rule' | 'knowledge';

export interface LowCostIntentResult {
  source: LowCostIntentSource;
  aiResult: AiResult;
}

const knowledgeKeywords = [
  '安装',
  '说明书',
  '怎么用',
  '使用',
  '故障',
  '故障码',
  '报错',
  '售后',
  '保修',
  '质保',
  '维修',
  '清洁',
  '保养',
  '参数',
  '型号',
  '漏电',
  '异响',
  '不工作',
  '没反应',
  '客服电话',
  '联系谁'
];

export async function resolveLowCostIntent(inputText: string): Promise<LowCostIntentResult | null> {
  const localResult = matchLocalIntent(inputText);
  if (localResult) {
    return {
      source: 'rule',
      aiResult: localResult
    };
  }

  if (!looksLikeKnowledgeQuestion(inputText)) {
    return null;
  }

  const knowledge = await answerKnowledgeQuestion({
    question: inputText,
    limit: 2
  });

  return {
    source: 'knowledge',
    aiResult: chat(limitSpeak(knowledge.answer))
  };
}

function matchLocalIntent(text: string): AiResult | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  if (matches(normalized, ['谢谢', '谢了', '辛苦了'])) {
    return chat('不客气，我在。');
  }
  if (matches(normalized, ['你好', '在吗', '小东小东'])) {
    return chat('我在，可以帮您控制浴霸。');
  }
  if (matches(normalized, ['你能做什么', '有什么功能', '可以干什么'])) {
    return chat('可以控制照明、取暖、换气、吹风、摆风和除湿。');
  }
  if (matches(normalized, ['讲个笑话', '逗我', '开心一点'])) {
    return chat('洗澡放轻松，水汽交给我，心情交给热风。');
  }

  if (matches(normalized, ['关灯', '关闭照明'])) {
    return control('LIGHT_OFF', '已关闭照明');
  }
  if (matches(normalized, ['打开夜灯', '开夜灯', '夜灯'])) {
    return control('NIGHT_LIGHT_ON', '已打开夜灯');
  }
  if (matches(normalized, ['关闭夜灯', '关夜灯'])) {
    return control('NIGHT_LIGHT_OFF', '已关闭夜灯');
  }
  if (matches(normalized, ['开灯', '打开灯', '打开照明', '照明'])) {
    return control('LIGHT_ON', '已打开照明');
  }
  if (matches(normalized, ['关闭换气', '关换气', '关闭通风'])) {
    return control('VENTILATION_OFF', '已关闭换气');
  }
  if (matches(normalized, ['打开换气', '开换气', '通风', '空气不好', '有味道'])) {
    return control('VENTILATION_ON', '已打开换气');
  }
  if (matches(normalized, ['关闭吹风', '关吹风'])) {
    return control('FAN_OFF', '已关闭吹风');
  }
  if (matches(normalized, ['打开吹风', '开吹风', '凉风'])) {
    return control('FAN_ON', '已打开吹风');
  }
  if (matches(normalized, ['关闭摆风', '关摆风', '关闭扫风'])) {
    return control('SWING_OFF', '已关闭摆风');
  }
  if (matches(normalized, ['打开摆风', '开摆风', '扫风'])) {
    return control('SWING_ON', '已打开摆风');
  }
  if (matches(normalized, ['关闭强暖', '关强暖'])) {
    return control('HEAT_STRONG_OFF', '已关闭强暖');
  }
  if (matches(normalized, ['关闭弱暖', '关弱暖', '关闭暖风', '关暖风', '关闭取暖'])) {
    return control('HEAT_WEAK_OFF', '已关闭暖风');
  }
  if (matches(normalized, ['强暖', '大暖风'])) {
    return control('HEAT_STRONG_ON', '是否确认打开强暖？', true);
  }
  if (matches(normalized, ['弱暖', '小暖风', '取暖', '有点冷', '好冷'])) {
    return control('HEAT_WEAK_ON', '已打开弱暖');
  }
  if (matches(normalized, ['关闭除湿', '关除湿', '关闭干燥', '关干燥'])) {
    return control('DRY_OFF', '已关闭除湿');
  }
  if (matches(normalized, ['打开除湿', '开除湿', '干燥', '潮湿'])) {
    return control('DRY_ON', '已打开除湿');
  }
  if (matches(normalized, ['关闭除雾', '关除雾'])) {
    return control('DEFOG_OFF', '已关闭除雾');
  }
  if (matches(normalized, ['打开除雾', '开除雾', '镜子起雾'])) {
    return control('DEFOG_ON', '已打开除雾');
  }
  if (matches(normalized, ['退出沐浴模式', '关闭沐浴模式'])) {
    return control('BATH_MODE_OFF', '已退出沐浴模式');
  }
  if (matches(normalized, ['沐浴模式', '洗澡模式'])) {
    return control('BATH_MODE_ON', '已打开沐浴模式');
  }
  if (matches(normalized, ['关闭恒温', '关恒温'])) {
    return control('CONSTANT_TEMP_OFF', '已关闭恒温');
  }
  if (matches(normalized, ['打开恒温', '开恒温', '恒温'])) {
    return control('CONSTANT_TEMP_ON', '已打开恒温');
  }
  if (matches(normalized, ['打开语音播报', '开启语音播报'])) {
    return control('VOICE_BROADCAST_ON', '已打开语音播报');
  }
  if (matches(normalized, ['关闭语音播报', '关掉语音播报'])) {
    return control('VOICE_BROADCAST_OFF', '已关闭语音播报');
  }
  if (matches(normalized, ['声音大一点', '音量大一点', '调大音量'])) {
    return control('VOLUME_UP', '已调大音量');
  }
  if (matches(normalized, ['声音小一点', '音量小一点', '调小音量'])) {
    return control('VOLUME_DOWN', '已调小音量');
  }
  if (matches(normalized, ['全部关闭', '全部关', '关闭浴霸', '关机', '待机'])) {
    return control('STANDBY', '已关闭浴霸主要功能');
  }

  const temperatureMatch = normalized.match(/([3-4][0-9])\s*度/);
  if (temperatureMatch) {
    return {
      resultType: 'DEVICE_CONTROL',
      intent: 'SET_TEMP',
      confidence: 0.96,
      slots: {
        temperature: Number(temperatureMatch[1])
      },
      requiresConfirm: false,
      speak: `已将温度设置为 ${temperatureMatch[1]} 度`
    };
  }

  const timerMatch = normalized.match(/(\d+)\s*分钟/);
  if (timerMatch && matches(normalized, ['定时', '分钟后', '过'])) {
    return {
      resultType: 'DEVICE_CONTROL',
      intent: 'SET_TIMER',
      confidence: 0.9,
      slots: {
        durationMinutes: Number(timerMatch[1])
      },
      requiresConfirm: false,
      speak: `已设置 ${timerMatch[1]} 分钟定时`
    };
  }

  return null;
}

function looksLikeKnowledgeQuestion(text: string): boolean {
  return knowledgeKeywords.some((keyword) => text.includes(keyword));
}

function control(intent: DeviceIntent, speak: string, requiresConfirm = false): AiResult {
  return {
    resultType: 'DEVICE_CONTROL',
    intent,
    confidence: 0.98,
    slots: {},
    requiresConfirm,
    speak
  };
}

function chat(speak: string): AiResult {
  return {
    resultType: 'CHAT',
    intent: null,
    confidence: 0.92,
    slots: {},
    requiresConfirm: false,
    speak
  };
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function limitSpeak(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 50 ? `${normalized.slice(0, 48)}…` : normalized;
}
