const api = require('../../utils/api');
const { formatMode } = require('../../utils/format');

Page({
  data: {
    settings: null,
    modeText: '',
    modes: [
      { label: '实用提醒', value: 'PRACTICAL' },
      { label: '轻松模式', value: 'RELAXED' },
      { label: '安静模式', value: 'QUIET' }
    ],
    lastDecision: null
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    const data = await api.getBootstrap();
    const settings = data.proactiveSettings;
    this.setData({
      settings,
      modeText: formatMode(settings.mode)
    });
  },

  async toggleEnabled(event) {
    const settings = {
      ...this.data.settings,
      enabled: event.detail.value
    };
    await this.saveSettings(settings);
  },

  async changeMode(event) {
    const settings = {
      ...this.data.settings,
      mode: event.detail.value
    };
    await this.saveSettings(settings);
  },

  async changeQuietEnabled(event) {
    const settings = {
      ...this.data.settings,
      quietHours: {
        ...this.data.settings.quietHours,
        enabled: event.detail.value
      }
    };
    await this.saveSettings(settings);
  },

  changeQuietStart(event) {
    this.setData({
      'settings.quietHours.start': event.detail.value
    });
  },

  changeQuietEnd(event) {
    this.setData({
      'settings.quietHours.end': event.detail.value
    });
  },

  async saveQuietHours() {
    await this.saveSettings(this.data.settings);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  async saveSettings(settings) {
    const nextSettings = await api.updateProactiveSettings(settings);
    this.setData({
      settings: nextSettings,
      modeText: formatMode(nextSettings.mode)
    });
  },

  async previewEnter() {
    const decision = await api.triggerProactiveEvent('OCCUPANCY_ENTER');
    this.setData({ lastDecision: decision });
  }
});

