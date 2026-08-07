const api = require('../../utils/api');
const { formatIntent } = require('../../utils/format');

Page({
  data: {
    state: null,
    modeTags: [],
    targetTemperature: 40,
    commandGroups: [
      {
        title: '基础',
        commands: [
          { label: '照明', mark: '灯', intent: 'LIGHT_ON' },
          { label: '关灯', mark: '关', intent: 'LIGHT_OFF' },
          { label: '夜灯', mark: '夜', intent: 'NIGHT_LIGHT_ON' }
        ]
      },
      {
        title: '风暖',
        commands: [
          { label: '弱暖', mark: '暖', intent: 'HEAT_WEAK_ON' },
          { label: '强暖', mark: '热', intent: 'HEAT_STRONG_ON' },
          { label: '吹风', mark: '吹', intent: 'FAN_ON' }
        ]
      },
      {
        title: '环境',
        commands: [
          { label: '换气', mark: '风', intent: 'VENTILATION_ON' },
          { label: '摆风', mark: '摆', intent: 'SWING_ON' },
          { label: '待机', mark: '待', intent: 'STANDBY' }
        ]
      }
    ]
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    const data = await api.getBootstrap();
    this.updateState(data.deviceState);
  },

  async handleCommand(event) {
    const intent = event.currentTarget.dataset.intent;
    const result = await api.sendDeviceCommand(intent);
    this.updateState(result.state);
    wx.showToast({ title: '已执行', icon: 'success' });
  },

  decreaseTemp() {
    const nextTemp = Math.max(30, this.data.targetTemperature - 1);
    this.setData({ targetTemperature: nextTemp });
  },

  increaseTemp() {
    const nextTemp = Math.min(45, this.data.targetTemperature + 1);
    this.setData({ targetTemperature: nextTemp });
  },

  async applyTemperature() {
    const result = await api.sendDeviceCommand('SET_TEMP', {
      temperature: this.data.targetTemperature
    });
    this.updateState(result.state);
    wx.showToast({ title: '温度已设置', icon: 'success' });
  },

  updateState(state) {
    this.setData({
      state,
      targetTemperature: state.targetTemperature,
      modeTags: (state.activeModes || []).map(formatIntent)
    });
  }
});

