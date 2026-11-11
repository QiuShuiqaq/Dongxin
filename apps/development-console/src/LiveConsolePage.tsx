import { ReloadOutlined } from '@ant-design/icons';
import type { DeviceExecutionTrace } from '@dongxin/shared';
import { Alert, Button, Empty, Segmented, Space, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDevelopmentLiveData } from './api';
import type { DevelopmentLiveData } from './api';

type FeedKind = 'ALL' | 'VOICE' | 'AUDIO' | 'BATCH' | 'UART' | 'COMMAND';
interface FeedItem {
  id: string;
  at: string;
  kind: Exclude<FeedKind, 'ALL'>;
  title: string;
  detail: string;
  status: string;
}

const kindLabel: Record<Exclude<FeedKind, 'ALL'>, string> = {
  VOICE: '语音', AUDIO: '播报', BATCH: '批量', UART: '串口', COMMAND: '控制',
};

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未同步' : date.toLocaleString('zh-CN', { hour12: false });
}

function traceTime(trace: DeviceExecutionTrace) {
  return trace.completedAt && !Number.isNaN(new Date(trace.completedAt).getTime())
    ? trace.completedAt : trace.startedAt;
}

export default function LiveConsolePage({
  deviceId, traces, autoRefresh,
}: {
  deviceId: string;
  traces: DeviceExecutionTrace[];
  autoRefresh: boolean;
}) {
  const [data, setData] = useState<DevelopmentLiveData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<FeedKind>('ALL');
  const sequence = useRef(0);

  async function refresh() {
    if (!deviceId) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const next = await getDevelopmentLiveData(deviceId);
      if (request !== sequence.current) return;
      setData(next);
      setError('');
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    void refresh();
    const timer = autoRefresh ? window.setInterval(() => void refresh(), 5000) : null;
    return () => {
      sequence.current += 1;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [deviceId, autoRefresh]);

  const feed = useMemo(() => {
    if (!data) return [];
    const items: FeedItem[] = [
      ...data.voiceTests.map((test) => ({
        id: `voice-${test.id}`, at: test.updatedAt, kind: 'VOICE' as const,
        title: `${test.mode === 'ASR_ONLY' ? 'ASR 识别' : '语音整链路'} · ${test.status}`,
        detail: [test.transcript, test.reply, test.stages.filter((stage) => stage.status === 'FAILED').map((stage) => `${stage.key}: ${stage.error || '失败'}`).join('；'), test.message].filter(Boolean).join(' · '),
        status: test.status,
      })),
      ...data.audioTests.map((test) => ({
        id: `audio-${test.id}`, at: test.updatedAt, kind: 'AUDIO' as const,
        title: `开发板播报 · ${test.status}`,
        detail: `${test.text} · ${test.message}`, status: test.status,
      })),
      ...data.batchTests.map((test) => ({
        id: `batch-${test.id}`, at: test.updatedAt, kind: 'BATCH' as const,
        title: `${test.kind} 批量测试 · ${test.status}`,
        detail: `${test.name} · ${test.completed}/${test.total}${test.error ? ` · ${test.error}` : ''}`,
        status: test.status,
      })),
      ...data.linkEvents.map((event) => ({
        id: `uart-${event.id}`, at: event.createdAt, kind: 'UART' as const,
        title: `${event.payload.direction || '串口'} · ${event.payload.eventType || '事件'}`,
        detail: event.payload.result || event.payload.frame || '已收到样机回传',
        status: event.payload.valid === false ? 'FAILED' : 'COMPLETED',
      })),
      ...data.conversations.map((session) => ({
        id: `conversation-${session.id}`, at: session.updatedAt, kind: 'VOICE' as const,
        title: session.channel === 'llm-test' ? 'LLM 对话' : '整链路文字对话',
        detail: session.lastTurn ? `${session.lastTurn.text} → ${session.lastTurn.reply}` : '暂无轮次',
        status: session.lastTurn?.error ? 'FAILED' : 'COMPLETED',
      })),
      ...traces.filter((trace) => trace.deviceId === deviceId).slice(0, 12).map((trace) => ({
        id: `command-${trace.commandId}`, at: traceTime(trace), kind: 'COMMAND' as const,
        title: `${trace.intent} · ${trace.status}`,
        detail: trace.message || trace.executionPath || (trace.status === 'QUEUED' ? '等待设备回执' : '设备回执已记录'), status: trace.status,
      })),
    ];
    return items.filter((item) => kind === 'ALL' || item.kind === kind)
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  }, [data, traces, kind, deviceId]);

  const latestVoice = data?.voiceTests[0];
  const latestAudio = data?.audioTests[0];
  const runningBatch = data?.batchTests.find((item) => ['QUEUED', 'RUNNING'].includes(item.status));

  return <div className="page-stack live-console">
    <div className="live-console-toolbar">
      <div><strong>设备与测试监测</strong><span>{data ? `采样于 ${dateTime(data.sampledAt)} · ${autoRefresh ? '每 5 秒轮询' : '自动刷新已暂停'}` : '等待数据'}</span></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button>
    </div>
    {error ? <Alert type="error" showIcon message="监测数据更新失败" description={error} /> : null}
    <div className="live-status-grid">
      <div><span>开发板</span><strong>{data?.device.status === 'ONLINE' ? '在线' : data?.device.status === 'FAULT' ? '故障' : '离线'}</strong><small>{data?.device.name || '未选择设备'}</small></div>
      <div><span>MQTT 网关</span><strong>{data?.mqtt.connected ? '已连接' : '未连接'}</strong><small>{data?.mqtt.enabled ? '服务已启用' : '服务未启用'}</small></div>
      <div><span>语音测试</span><strong>{latestVoice?.status || '无记录'}</strong><small>{latestVoice ? `${latestVoice.mode} · ${dateTime(latestVoice.updatedAt)}` : '等待首次测试'}</small></div>
      <div><span>开发板播报</span><strong>{latestAudio?.status || '无记录'}</strong><small>{latestAudio ? dateTime(latestAudio.updatedAt) : '进程内状态，重启后不可查'}</small></div>
      <div><span>批量测试</span><strong>{runningBatch?.status || '无运行任务'}</strong><small>{runningBatch ? runningBatch.name : `${data?.batchTests.length || 0} 条近期记录`}</small></div>
    </div>
    <section className="workspace-section">
      <div className="live-feed-header"><div><h2>测试事件</h2><p>仅展示后端已接收的数据；设备状态和串口回传以各自上报时间为准。</p></div>
        <Segmented aria-label="事件类型" value={kind} onChange={setKind} options={[
          { label: '全部', value: 'ALL' }, { label: '语音', value: 'VOICE' }, { label: '播报', value: 'AUDIO' },
          { label: '批量', value: 'BATCH' }, { label: '串口', value: 'UART' }, { label: '控制', value: 'COMMAND' },
        ]} />
      </div>
      {feed.length ? <div className="live-event-list">{feed.map((item) => <div className="live-event" key={item.id}>
        <time>{dateTime(item.at)}</time>
        <div><Space size={7}><Tag color={item.status === 'FAILED' || item.status === 'REJECTED' ? 'red' : item.status === 'RUNNING' || item.status === 'RECORDING' ? 'blue' : 'default'}>{kindLabel[item.kind]}</Tag><strong>{item.title}</strong></Space><p>{item.detail}</p></div>
      </div>)}</div> : <Empty description={loading ? '正在读取' : '当前设备暂无该类测试事件'} />}
    </section>
  </div>;
}
