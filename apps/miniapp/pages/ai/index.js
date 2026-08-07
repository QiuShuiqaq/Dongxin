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
        text: result.replyText || '已处理'
      };
      this.setData({
        messages: [...this.data.messages, assistantMessage],
        lastIntent: formatIntent(result.aiResult.intent || result.aiResult.resultType)
      });
    } finally {
      this.setData({ sending: false });
    }
  }
});

