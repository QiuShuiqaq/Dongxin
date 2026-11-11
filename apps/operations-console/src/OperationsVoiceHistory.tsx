import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, App, Button, Input, Select, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { getOperationsVoiceHistory } from './api';
import type { OperationsVoiceHistoryItem, OperationsVoiceHistoryPage } from './api';

type Filters = { deviceId: string; result: string; from: string; to: string };
const emptyFilters: Filters = { deviceId: '', result: '', from: '', to: '' };

export default function OperationsVoiceHistory() {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OperationsVoiceHistoryPage>({ items: [], total: 0, page: 1, pageSize: 20 });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = { page: String(page), pageSize: '20' };
    if (filters.deviceId.trim()) query.deviceId = filters.deviceId.trim();
    if (filters.result) query.result = filters.result;
    if (filters.from) query.from = new Date(filters.from).toISOString();
    if (filters.to) query.to = new Date(filters.to).toISOString();
    void getOperationsVoiceHistory(query)
      .then((value) => { if (active) setResult(value); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page, refresh]);

  function apply() {
    if (draft.from && draft.to && new Date(draft.from) > new Date(draft.to)) {
      message.warning('开始时间不能晚于结束时间');
      return;
    }
    setPage(1);
    setFilters({ ...draft });
  }

  return <section className="ops-panel ops-voice-history">
    <div className="panel-title"><h2>线上语音记录</h2><span className="ops-ai-service-caption">{error ? '记录暂不可用' : `共 ${result.total} 轮`}</span></div>
    <div className="ops-voice-filters">
      <Input aria-label="按设备编号筛选" placeholder="设备编号" value={draft.deviceId} allowClear onChange={(event) => setDraft((state) => ({ ...state, deviceId: event.target.value }))} onPressEnter={apply} />
      <Select aria-label="按处理结果筛选" placeholder="全部结果" allowClear value={draft.result || undefined} options={[{ value: 'COMPLETED', label: '完成' }, { value: 'FAILED', label: '失败' }]} onChange={(value) => setDraft((state) => ({ ...state, result: value || '' }))} />
      <label><span>开始</span><input aria-label="开始时间" type="datetime-local" value={draft.from} onChange={(event) => setDraft((state) => ({ ...state, from: event.target.value }))} /></label>
      <label><span>结束</span><input aria-label="结束时间" type="datetime-local" value={draft.to} onChange={(event) => setDraft((state) => ({ ...state, to: event.target.value }))} /></label>
      <Button type="primary" icon={<SearchOutlined />} onClick={apply}>查询</Button>
      <Button icon={<ReloadOutlined />} aria-label="刷新语音记录" onClick={() => setRefresh((value) => value + 1)} />
    </div>
    {error ? <Alert type="error" showIcon message="语音记录加载失败" description={error} action={<Button size="small" onClick={() => setRefresh((value) => value + 1)}>重试</Button>} /> : null}
    <Table<OperationsVoiceHistoryItem>
      rowKey="id"
      size="small"
      loading={loading}
      scroll={{ x: 980 }}
      dataSource={loading || error ? [] : result.items}
      locale={{ emptyText: error ? '无法获取记录' : '当前条件下没有线上设备语音记录' }}
      pagination={{ current: page, pageSize: 20, total: error ? 0 : result.total, showSizeChanger: false, onChange: setPage }}
      expandable={{ expandedRowRender: (item) => <div className="ops-voice-detail">
        <div><strong>用户</strong><p>{item.inputText || '未识别到文字'}</p></div>
        <div><strong>小东</strong><p>{item.replyText || '未生成回复'}</p></div>
        {item.error ? <div className="ops-voice-error"><strong>错误</strong><p>{item.error}</p></div> : null}
        <small>会话 {item.sessionId} · 输入 {item.inputSource === 'DEVICE_AUDIO' ? '设备录音' : '设备文本'}{item.intent ? ` · 意图 ${item.intent}` : ''}{item.commandStatus ? ` · 控制结果 ${item.commandStatus}` : ''}</small>
      </div> }}
      columns={[
        { title: '时间', dataIndex: 'createdAt', width: 172, render: (value: string) => formatDate(value) },
        { title: '设备', dataIndex: 'deviceId', width: 210, ellipsis: true },
        { title: '对话', key: 'conversation', ellipsis: true, render: (_, item) => <span title={`${item.inputText}\n${item.replyText}`}>{item.inputText || '未识别'} → {item.replyText || '未回复'}</span> },
        { title: '路由', dataIndex: 'route', width: 108, ellipsis: true },
        { title: '结果', dataIndex: 'result', width: 84, render: (value: string) => <Tag color={value === 'COMPLETED' ? 'green' : 'red'}>{value === 'COMPLETED' ? '完成' : '失败'}</Tag> },
        { title: '耗时', dataIndex: 'latencyMs', width: 86, render: (value: number | null) => value === null ? '-' : `${value} ms` },
        { title: '该轮估算费用', dataIndex: 'costCny', width: 112, render: (value: number | null) => value === null ? '-' : `¥${value.toFixed(4)}` },
      ]}
    />
  </section>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
