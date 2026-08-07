const api = require('../../utils/api');
const { formatIntent, formatOnline } = require('../../utils/format');

Page({
  data: {
    device: null,
    state: null,
    modeTags: [],
    quickCommands: [
      { label: '照明', mark: '灯', intent: 'LIGHT_ON' },
      { label: '弱暖', mark: '暖', intent: 'HEAT_WEAK_ON' },
      { label: '强暖', mark: '热', intent: 'HEAT_STRONG_ON' },
      { label: '换气', mark: '风', intent: 'VENTILATION_ON' },
      { label: '摆风', mark: '摆', intent: 'SWING_ON' },
      { label: '待机', mark: '待', intent: 'STANDBY' }
    ]
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    const data = await api.getBootstrap();
    const state = data.deviceState;
    this.setData({
      device: data.devices?.[0] || null,
      state: {
        ...state,
        onlineText: formatOnline(state.isOnline)
      },
      modeTags: (state.activeModes || []).map(formatIntent)
    });
  },

  async handleCommand(event) {
    const intent = event.currentTarget.dataset.intent;
    const result = await api.sendDeviceCommand(intent);
    this.updateState(result.state);
    wx.showToast({ title: '已执行', icon: 'success' });
  },

  updateState(state) {
    this.setData({
      state: {
        ...state,
        onlineText: formatOnline(state.isOnline)
      },
      modeTags: (state.activeModes || []).map(formatIntent)
    });
  },

  goControl() {
    wx.switchTab({ url: '/pages/control/index' });
  },

  goAi() {
    wx.switchTab({ url: '/pages/ai/index' });
  }
});

