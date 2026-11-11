const api = require('../../utils/api');
const { formatIntent } = require('../../utils/format');

Page({
  data: {
    inputText: '',
    sending: false,
    messages: [
      {
        id: 'init',
        role: 'assistant',
        text: '你好，我在。'
      }
    ],
    lastIntent: ''
  },

  handleInput(event) {
    this.setData({ inputText: event.detail.value });
  },

  async send() {
    const text = this.data.inputText.trim();
    if (!text || this.data.sending) {
      return;
    }

    const userMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text
    };
    this.setData({
      inputText: '',
      sending: true,
      messages: [...this.data.messages, userMessage]
    });

    try {
      const result = await api.runVoiceTurn(text);
      const assistantMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: result.replyText || '服务端未返回回复'
      };
      this.setData({
        messages: [...this.data.messages, assistantMessage],
        lastIntent: result.aiResult ? formatIntent(result.aiResult.intent || result.aiResult.resultType) : ''
      });
    } catch (error) {
      this.setData({
        messages: [...this.data.messages, {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: `请求失败：${error.message || '网络异常'}`
        }]
      });
    } finally {
      this.setData({ sending: false });
    }
  }
});

