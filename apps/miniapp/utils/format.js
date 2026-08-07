const intentLabels = {
  LIGHT_ON: '照明',
  LIGHT_OFF: '关闭照明',
  NIGHT_LIGHT_ON: '夜灯',
  HEAT_WEAK_ON: '弱暖',
  HEAT_STRONG_ON: '强暖',
  FAN_ON: '吹风',
  VENTILATION_ON: '换气',
  SWING_ON: '摆风',
  PURIFY_ON: '净化',
  DRY_ON: '干燥',
  DEFOG_ON: '除雾',
  BATH_MODE_ON: '沐浴',
  CONSTANT_TEMP_ON: '恒温',
  STANDBY: '待机',
  SET_TEMP: '设温'
};

const modeLabels = {
  PRACTICAL: '实用提醒',
  RELAXED: '轻松模式',
  QUIET: '安静模式'
};

function formatIntent(intent) {
  return intentLabels[intent] || intent || '无';
}

function formatMode(mode) {
  return modeLabels[mode] || mode || '未设置';
}

function formatOnline(isOnline) {
  return isOnline ? '在线' : '离线';
}

module.exports = {
  formatIntent,
  formatMode,
  formatOnline,
  intentLabels,
  modeLabels
};

