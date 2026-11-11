const api = require('../../utils/api');
const { formatIntent } = require('../../utils/format');

Page({
  data: {
    state: null,
    error: '',
    busy: false,
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
    try {
      const data = await api.getDeviceOverview();
      if (!data.state) throw new Error('服务端未返回设备状态');
      this.updateState(data.state);
      this.setData({ error: '' });
    } catch (error) {
      this.setData({ state: null, modeTags: [], error: error.message || '读取设备失败' });
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

  decreaseTemp() {
    const nextTemp = Math.max(30, this.data.targetTemperature - 1);
    this.setData({ targetTemperature: nextTemp });
  },

  increaseTemp() {
    const nextTemp = Math.min(45, this.data.targetTemperature + 1);
    this.setData({ targetTemperature: nextTemp });
  },

  async applyTemperature() {
    if (this.data.busy || !this.data.state?.isOnline) {
      wx.showToast({ title: '设备未连接', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await api.sendDeviceCommand('SET_TEMP', {
        temperature: this.data.targetTemperature
      });
      if (result.command?.status === 'APPLIED') {
        this.updateState(result.state);
        wx.showToast({ title: '设备已确认', icon: 'success' });
      } else {
        wx.showToast({ title: result.delivery === 'QUEUED_FOR_DEVICE' ? '设备暂不可达' : '等待设备回执', icon: 'none' });
        await this.loadData();
      }
    } catch (error) {
      wx.showToast({ title: error.message || '设置失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  updateState(state) {
    this.setData({
      state,
      targetTemperature: state.targetTemperature,
      modeTags: (state.activeModes || []).map(formatIntent)
    });
  }
});

