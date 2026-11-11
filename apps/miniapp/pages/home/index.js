const api = require('../../utils/api');
const { formatIntent, formatOnline } = require('../../utils/format');

Page({
  data: {
    device: null,
    state: null,
    error: '',
    busy: false,
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
    try {
      const data = await api.getDeviceOverview();
      const state = data.state;
      if (!state) throw new Error('服务端未返回设备状态');
      this.setData({
        device: data.device,
        state: { ...state, onlineText: formatOnline(state.isOnline) },
        modeTags: (state.activeModes || []).map(formatIntent),
        error: ''
      });
    } catch (error) {
      this.setData({ device: null, state: null, modeTags: [], error: error.message || '读取设备失败' });
    }
  },

  async handleCommand(event) {
    if (this.data.busy || !this.data.state?.isOnline) {
      wx.showToast({ title: '设备未连接', icon: 'none' });
      return;
    }
    const intent = event.currentTarget.dataset.intent;
    this.setData({ busy: true });
    try {
      const result = await api.sendDeviceCommand(intent);
      if (result.command?.status === 'APPLIED') {
        this.updateState(result.state);
        wx.showToast({ title: '设备已确认', icon: 'success' });
      } else {
        wx.showToast({ title: result.delivery === 'QUEUED_FOR_DEVICE' ? '设备暂不可达' : '等待设备回执', icon: 'none' });
        await this.loadData();
      }
    } catch (error) {
      wx.showToast({ title: error.message || '控制失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
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

