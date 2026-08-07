const api = require('../../utils/api');

Page({
  data: {
    question: '',
    selectedCategory: '',
    result: null,
    searching: false,
    categories: [
      { label: '全部', value: '' },
      { label: '使用', value: 'USAGE' },
      { label: '安装', value: 'INSTALL' },
      { label: '故障', value: 'TROUBLESHOOTING' },
      { label: '售后', value: 'AFTER_SALES' },
      { label: '保养', value: 'MAINTENANCE' }
    ],
    quickQuestions: ['浴霸有故障码怎么办', '怎么清洁浴霸', '弱暖和强暖有什么区别']
  },

  handleInput(event) {
    this.setData({ question: event.detail.value });
  },

  selectCategory(event) {
    this.setData({ selectedCategory: event.currentTarget.dataset.value });
  },

  useQuickQuestion(event) {
    this.setData({ question: event.currentTarget.dataset.question }, () => {
      this.search();
    });
  },

  async search() {
    const question = this.data.question.trim();
    if (!question || this.data.searching) {
      return;
    }

    this.setData({ searching: true });
    try {
      const result = await api.queryKnowledge(question, this.data.selectedCategory || undefined);
      this.setData({ result });
    } finally {
      this.setData({ searching: false });
    }
  }
});
