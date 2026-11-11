const api = require('../../utils/api');
const { formatMode } = require('../../utils/format');

Page({
  data: {
    settings: null,
    error: '',
    modeText: '',
    modes: [
      { label: '实用提醒', value: 'PRACTICAL' },
      { label: '轻松模式', value: 'RELAXED' },
      { label: '安静模式', value: 'QUIET' }
    ]
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    try {
      const settings = await api.getProactiveSettings();
      if (!settings) throw new Error('服务端未返回主动沟通设置');
      this.setData({ settings, modeText: formatMode(settings.mode), error: '' });
    } catch (error) {
      this.setData({ settings: null, error: error.message || '读取设置失败' });
    }
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
  },

  async saveSettings(settings) {
    try {
      const nextSettings = await api.updateProactiveSettings(settings);
      this.setData({ settings: nextSettings, modeText: formatMode(nextSettings.mode) });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
      await this.loadData();
    }
  }
});

