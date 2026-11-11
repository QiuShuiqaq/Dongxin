import type { AiResult, DeviceIntent } from '@dongxin/shared';
import { isConversationEnd } from './conversation.service.js';

export function matchOnlineRule(text: string): AiResult | null {
  const normalized = normalizeRuleText(text);
  if (["谢谢", "感谢", "辛苦了"].includes(normalized)) return chat('不客气，我在。');
  if (isConversationEnd(normalized) || normalized === '晚安') {
    return chat("好的，再见。");
  }
  if (["你好", "您好", "早上好", "晚上好", "在吗"].includes(normalized)) {
    return chat("您好，我是 AI 浴霸助手小东，有什么可以帮您？");
  }
  if (["你是谁", "你能做什么", "有什么功能"].includes(normalized)) {
    return chat("我是 AI 浴霸助手小东，可以帮您控制浴霸并回答产品问题。");
  }
  if (looksLikeProblem(normalized)) {
    return null;
  }
  return matchDirectDeviceCommand(normalized);
}

export function matchDirectDeviceCommand(text: string): AiResult | null {
  const commands: Array<{
    intent: DeviceIntent;
    words: string[];
    speak: string;
    requiresConfirm?: boolean;
  }> = [
    { intent: "LIGHT_OFF", words: ["关灯", "关闭照明"], speak: "已关闭照明。" },
    { intent: "LIGHT_ON", words: ["开灯", "打开照明"], speak: "已打开照明。" },
    {
      intent: "VENTILATION_OFF",
      words: ["关闭换气", "关掉换气", "关闭通风"],
      speak: "已关闭换气。",
    },
    {
      intent: "VENTILATION_ON",
      words: ["开启换气", "打开换气", "开始换气", "通风"],
      speak: "已打开换气。",
    },
    {
      intent: "FAN_OFF",
      words: ["关闭吹风", "关掉吹风"],
      speak: "已关闭吹风。",
    },
    {
      intent: "FAN_ON",
      words: ["打开吹风", "开启吹风", "凉风"],
      speak: "已打开吹风。",
    },
    {
      intent: "SWING_OFF",
      words: ["关闭摆风", "关掉摆风"],
      speak: "已关闭摆风。",
    },
    {
      intent: "SWING_ON",
      words: ["打开摆风", "开启摆风", "扫风"],
      speak: "已打开摆风。",
    },
    {
      intent: "HEAT_WEAK_OFF",
      words: ["关闭弱暖", "关闭取暖", "关闭暖风"],
      speak: "已关闭暖风。",
    },
    {
      intent: "HEAT_WEAK_ON",
      words: ["打开弱暖", "开启弱暖", "开启取暖", "打开暖风", "有点冷"],
      speak: "已打开弱暖。",
    },
    {
      intent: "HEAT_STRONG_ON",
      words: ["打开强暖", "开启强暖", "强暖"],
      speak: "即将打开强暖。",
      requiresConfirm: true,
    },
    {
      intent: "DRY_OFF",
      words: ["关闭干燥", "关闭除湿"],
      speak: "已关闭干燥。",
    },
    {
      intent: "DRY_ON",
      words: ["打开干燥", "开启干燥", "除湿"],
      speak: "已打开干燥。",
    },
    {
      intent: "DEFOG_ON",
      words: ["打开除雾", "开启除雾"],
      speak: "已打开除雾。",
    },
    {
      intent: "STANDBY",
      words: ["全部关闭", "关闭浴霸", "浴霸关机", "待机"],
      speak: "已进入待机。",
    },
  ];

  if (looksLikeProblem(text)) {
    return null;
  }

  const match = commands.find((command) =>
    command.words.includes(normalizeRuleText(text)),
  );
  if (match) {
    return control(match.intent, match.speak, match.requiresConfirm ?? false);
  }

  const temperatureMatch = normalizeRuleText(text).match(/^(?:设置|调到|调整到|温度设置为|温度调到|设置温度为?)(\d{2})度$/);
  if (temperatureMatch) {
    const temperature = Number(temperatureMatch[1]);
    return {
      resultType: "DEVICE_CONTROL",
      intent: "SET_TEMP",
      confidence: 0.96,
      slots: { temperature },
      requiresConfirm: false,
      speak: `已将温度设置为 ${temperature} 度。`,
    };
  }

  return null;
}


function chat(speak: string): AiResult {
  return {
    resultType: "CHAT",
    intent: null,
    confidence: 0.98,
    slots: {},
    requiresConfirm: false,
    speak,
  };
}

function control(
  intent: DeviceIntent,
  speak: string,
  requiresConfirm = false,
): AiResult {
  return {
    resultType: "DEVICE_CONTROL",
    intent,
    confidence: 0.98,
    slots: {},
    requiresConfirm,
    speak,
  };
}


export function looksLikeProblem(text: string): boolean {
  return matches(text, [
    "问题",
    "故障",
    "出问题",
    "坏了",
    "为什么",
    "怎么回事",
    "能不能",
    "是否",
    "好像",
    "不工作",
    "不能用",
    "失灵",
    "反馈",
    "咨询",
  ]);
}

function matches(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function normalizeRuleText(text: string): string {
  return text.replace(/[\s，。！？、,.!?]/g, '').replace(/^(?:请|麻烦)?(?:帮我|给我)?/, '').replace(/(?:一下|吧)$/, '');
}
