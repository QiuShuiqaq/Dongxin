const DEFAULT_DEVICE_ID = 'demo-bath-heater-001';
const DEFAULT_PROVIDER_ID = 'aliyun-qwen3-7-flash';
const DEFAULT_PROMPT_ID = 'bath-heater-intent-v1';

const localState = {
  isOnline: true,
  activeModes: [],
  targetTemperature: 40,
  ambientTemperature: 26,
  humidity: 58,
  hasOccupancy: true,
  voiceBroadcastEnabled: true,
  faultCode: null,
  updatedAt: new Date().toISOString()
};

let localProactiveSettings = {
  enabled: false,
  mode: 'PRACTICAL',
  minIntervalMinutes: 10,
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '07:00'
  },
  updatedAt: new Date().toISOString()
};

function getBaseUrl() {
  try {
    const app = getApp();
    return app.globalData.apiBaseUrl || 'http://127.0.0.1:3077';
  } catch (error) {
    return 'http://127.0.0.1:3077';
  }
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${path}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: 6000,
      header: {
        'content-type': 'application/json'
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }

        reject(new Error(response.data?.error?.message || `HTTP ${response.statusCode}`));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function getDeviceId() {
  try {
    return getApp().globalData.deviceId || DEFAULT_DEVICE_ID;
  } catch (error) {
    return DEFAULT_DEVICE_ID;
  }
}

function getBootstrap() {
  return request('/api/bootstrap').catch(() => ({
    devices: [
      {
        id: DEFAULT_DEVICE_ID,
        name: '东信浴霸样机',
        model: 'DX-AI-01',
        protocol: 'SIMULATOR',
        status: 'ONLINE'
      }
    ],
    deviceState: { ...localState },
    knowledgeDocuments: [],
    proactiveSettings: { ...localProactiveSettings },
    logs: []
  }));
}

function sendDeviceCommand(intent, slots = {}) {
  const deviceId = getDeviceId();
  return request(`/api/devices/${deviceId}/commands`, {
    method: 'POST',
    data: { intent, slots }
  }).catch(() => simulateCommand(intent, slots));
}

function runVoiceTurn(text) {
  const deviceId = getDeviceId();
  return request('/api/voice/turn', {
    method: 'POST',
    data: {
      deviceId,
      providerId: DEFAULT_PROVIDER_ID,
      promptId: DEFAULT_PROMPT_ID,
      text,
      applyToDevice: true
    }
  }).catch(() => simulateVoiceTurn(text));
}

function queryKnowledge(question, category) {
  return request('/api/knowledge/query', {
    method: 'POST',
    data: {
      question,
      category,
      limit: 3
    }
  }).catch(() => ({
    answer: '资料里暂时没有找到直接答案，建议联系官方售后。',
    hits: [],
    usedFallback: true
  }));
}

function updateProactiveSettings(settings) {
  localProactiveSettings = {
    ...localProactiveSettings,
    ...settings,
    quietHours: {
      ...localProactiveSettings.quietHours,
      ...(settings.quietHours || {})
    },
    updatedAt: new Date().toISOString()
  };

  return request('/api/proactive/settings', {
    method: 'PATCH',
    data: settings
  }).catch(() => ({ ...localProactiveSettings }));
}

function triggerProactiveEvent(eventType) {
  return request('/api/proactive/events', {
    method: 'POST',
    data: {
      deviceId: getDeviceId(),
      eventType,
      ambientTemperature: localState.ambientTemperature,
      humidity: localState.humidity,
      hasOccupancy: localState.hasOccupancy,
      occurredAt: new Date().toISOString()
    }
  }).catch(() => simulateProactive(eventType));
}

function simulateCommand(intent, slots = {}) {
  if (intent === 'SET_TEMP' && typeof slots.temperature === 'number') {
    localState.targetTemperature = slots.temperature;
  } else if (intent === 'STANDBY') {
    localState.activeModes = localState.activeModes.filter((mode) => mode === 'LIGHT_ON' || mode === 'NIGHT_LIGHT_ON');
  } else if (intent.endsWith('_OFF')) {
    const onIntent = intent.replace('_OFF', '_ON');
    localState.activeModes = localState.activeModes.filter((mode) => mode !== onIntent);
  } else if (!localState.activeModes.includes(intent)) {
    localState.activeModes = [...localState.activeModes.filter((mode) => !isExclusiveMode(mode)), intent];
  }

  localState.updatedAt = new Date().toISOString();
  return {
    state: { ...localState },
    command: {
      id: `local-${Date.now()}`,
      deviceId: getDeviceId(),
      intent,
      slots,
      status: 'APPLIED'
    }
  };
}

function simulateVoiceTurn(text) {
  let intent = null;
  let replyText = '我还没理解你的意思，可以再说具体一点。';

  if (text.includes('冷') || text.includes('暖')) {
    intent = text.includes('太冷') || text.includes('强') ? 'HEAT_STRONG_ON' : 'HEAT_WEAK_ON';
    replyText = intent === 'HEAT_STRONG_ON' ? '已为你打开强暖。' : '已为你打开弱暖。';
  } else if (text.includes('灯')) {
    intent = text.includes('关') ? 'LIGHT_OFF' : 'LIGHT_ON';
    replyText = intent === 'LIGHT_ON' ? '已为你打开照明。' : '已为你关闭照明。';
  } else if (text.includes('换气') || text.includes('闷')) {
    intent = 'VENTILATION_ON';
    replyText = '已为你打开换气。';
  }

  const commandResult = intent ? simulateCommand(intent) : { state: { ...localState }, command: null };
  return {
    sessionId: `local-${Date.now()}`,
    replyText,
    aiResult: {
      resultType: intent ? 'DEVICE_CONTROL' : 'NEED_CLARIFY',
      intent,
      confidence: intent ? 0.86 : 0.45,
      slots: {},
      requiresConfirm: false,
      speak: replyText
    },
    safetyResult: {
      decision: intent ? 'APPROVED' : 'NO_ACTION',
      commands: intent ? [intent] : [],
      reason: intent ? '本地模拟通过' : '本地模拟未识别控制意图',
      speak: replyText
    },
    deviceState: commandResult.state,
    commandRecord: commandResult.command
  };
}

function simulateProactive(eventType) {
  if (!localProactiveSettings.enabled) {
    return {
      shouldSpeak: false,
      speak: '',
      requiresConfirm: false,
      suggestedIntent: null,
      reason: '主动沟通未开启',
      deviceState: { ...localState }
    };
  }

  const byType = {
    OCCUPANCY_ENTER: ['HEAT_WEAK_ON', '你来了，浴室现在有点凉，要不要先开弱暖？'],
    LOW_TEMPERATURE: ['HEAT_WEAK_ON', '浴室温度偏低，要不要先开弱暖？'],
    HIGH_HUMIDITY: ['VENTILATION_ON', '浴室湿度有点高，要不要开一会儿换气？'],
    LONG_RUNNING: ['STANDBY', '设备已经运行一段时间了，要不要检查一下是否需要关闭？']
  };
  const matched = byType[eventType];

  return {
    shouldSpeak: Boolean(matched),
    speak: matched ? matched[1] : '',
    requiresConfirm: Boolean(matched),
    suggestedIntent: matched ? matched[0] : null,
    reason: matched ? '本地模拟触发' : '当前事件不需要播报',
    deviceState: { ...localState }
  };
}

function isExclusiveMode(intent) {
  return ['HEAT_WEAK_ON', 'HEAT_STRONG_ON', 'DRY_ON', 'DEFOG_ON', 'BATH_MODE_ON', 'CONSTANT_TEMP_ON'].includes(intent);
}

module.exports = {
  getBootstrap,
  getDeviceId,
  queryKnowledge,
  request,
  runVoiceTurn,
  sendDeviceCommand,
  triggerProactiveEvent,
  updateProactiveSettings
};
