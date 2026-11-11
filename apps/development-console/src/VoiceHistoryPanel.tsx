import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Select, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getVoiceHistory } from './api';
import type { VoiceHistorySession } from './api';

const PAGE_SIZE = 30;
const labels: Record<VoiceHistorySession['channel'], string> = {
  'llm-test': 'LLM 对话',
  pipeline: '整链路文字',
  'device-test': '开发板语音',
  'asr-test': 'ASR 识别',
};

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function VoiceHistoryPanel({ deviceId, revision }: { deviceId: string; revision: number }) {
  const [sessions, setSessions] = useState<VoiceHistorySession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  async function refresh() {
    if (!deviceId) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const next = await getVoiceHistory(deviceId, 0, PAGE_SIZE);
      if (request !== sequence.current) return;
      setSessions(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
      setHasMore(next.length === PAGE_SIZE);
      setError('');
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [deviceId, revision]);

  async function loadMore() {
    if (!deviceId || loading) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const next = await getVoiceHistory(deviceId, sessions.length, PAGE_SIZE);
      if (request !== sequence.current) return;
      setSessions((previous) => [...previous, ...next]);
      setHasMore(next.length === PAGE_SIZE);
      setError('');
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }

  const visible = useMemo(() => sessions.filter((item) => filter === 'all' || item.channel === filter), [sessions, filter]);
  const selected = sessions.find((item) => item.id === selectedId) ?? null;

  return <section id="voice-history" className="workspace-section voice-history-section">
    <div className="voice-history-header">
      <div><h2><HistoryOutlined /> 历史记录</h2><p>仅保存文本和测试结果；历史记录可查阅，不会恢复已结束的模型上下文。</p></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()} aria-label="刷新历史记录" />
    </div>
    {error ? <Alert type="error" showIcon message="历史记录读取失败" description={error} /> : null}
    <div className="voice-history-layout">
      <div className="voice-history-index">
        <Select aria-label="历史记录类型" value={filter} onChange={(value) => { setFilter(value); setSelectedId(null); }} options={[
          { label: '全部类型', value: 'all' },
          ...Object.entries(labels).map(([value, label]) => ({ value, label })),
        ]} />
        <div className="voice-history-list">
          {visible.map((item) => <button type="button" className={selected?.id === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedId(item.id)}>
            <span>{labels[item.channel]} <time>{dateTime(item.updatedAt)}</time></span>
            <strong>{item.turns.at(-1)?.text || item.status || '无识别文本'}</strong>
            <small>{item.turns.length} 轮{item.status ? ` · ${item.status}` : ''}</small>
          </button>)}
          {!visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '正在读取' : '暂无记录'} /> : null}
        </div>
        {hasMore ? <Button block loading={loading} onClick={() => void loadMore()}>加载更早记录</Button> : null}
      </div>
      <div className="voice-history-detail">
        {selected ? <>
          <div className="voice-history-detail-head"><div><strong>{labels[selected.channel]}</strong><span>{dateTime(selected.createdAt)} · {selected.id.slice(0, 8)}</span></div><Tag>{selected.turns.length} 轮</Tag></div>
          {selected.turns.length ? selected.turns.map((turn) => <div className="voice-history-turn" key={turn.id}>
            <time>{dateTime(turn.at)} · {turn.route}{turn.latencyMs !== null ? ` · ${turn.latencyMs} ms` : ''}{turn.costCny !== null ? ` · ¥${turn.costCny.toFixed(4)}` : ''}</time>
            <p><span>你</span>{turn.text}</p>
            {turn.reply ? <p className="assistant"><span>小东</span>{turn.reply}</p> : null}
            {turn.error ? <Alert type="error" showIcon message={turn.error} /> : null}
          </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selected.status || '本次没有识别文本'} />}
        </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一条记录查看对话" />}
      </div>
    </div>
  </section>;
}
