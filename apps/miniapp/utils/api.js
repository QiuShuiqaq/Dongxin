const DEFAULT_PROVIDER_ID = 'aliyun-qwen3-7-flash';
const DEFAULT_PROMPT_ID = 'bath-heater-intent-v1';

function getConfiguration() {
  const config = getApp().globalData;
  const baseUrl = (config.apiBaseUrl || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(baseUrl)) {
    throw new Error('请先配置小程序 API 地址');
  }
  return { baseUrl, deviceId: config.deviceId };
}

function request(path, options = {}) {
  let baseUrl;
  try {
    baseUrl = getConfiguration().baseUrl;
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: 6000,
      header: { 'content-type': 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(new Error(response.data?.error?.message || `HTTP ${response.statusCode}`));
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络请求失败'));
      }
    });
  });
}

function getDeviceId() {
  const deviceId = getConfiguration().deviceId;
  if (!deviceId) throw new Error('请先配置测试设备 ID');
  return encodeURIComponent(deviceId);
}

function getDeviceOverview() {
  let deviceId;
  try {
    deviceId = getDeviceId();
  } catch (error) {
    return Promise.reject(error);
  }
  return Promise.all([
    request(`/api/devices/${deviceId}`),
    request(`/api/devices/${deviceId}/state`)
  ]).then(([device, state]) => ({ device, state }));
}

function getProactiveSettings() {
  return request('/api/proactive/settings');
}

function sendDeviceCommand(intent, slots = {}) {
  let deviceId;
  try {
    deviceId = getDeviceId();
  } catch (error) {
    return Promise.reject(error);
  }
  return request(`/api/devices/${deviceId}/commands`, {
    method: 'POST',
    data: { intent, slots }
  });
}

function runVoiceTurn(text) {
  let deviceId;
  try {
    deviceId = getConfiguration().deviceId;
    if (!deviceId) throw new Error('请先配置测试设备 ID');
  } catch (error) {
    return Promise.reject(error);
  }
  return request('/api/voice/turn', {
    method: 'POST',
    data: {
      deviceId,
      providerId: DEFAULT_PROVIDER_ID,
      promptId: DEFAULT_PROMPT_ID,
      text,
      applyToDevice: true
    }
  });
}

function queryKnowledge(question, category) {
  return request('/api/knowledge/query', {
    method: 'POST',
    data: { question, category, limit: 3 }
  });
}

function updateProactiveSettings(settings) {
  return request('/api/proactive/settings', {
    method: 'PATCH',
    data: settings
  });
}

module.exports = {
  getDeviceOverview,
  getProactiveSettings,
  queryKnowledge,
  request,
  runVoiceTurn,
  sendDeviceCommand,
  updateProactiveSettings
};
