import { ExportOutlined, ReloadOutlined, StopOutlined, UsbOutlined } from '@ant-design/icons';
import { Alert, App, Button, Empty, Select, Space, Tag } from 'antd';
import { useEffect, useState } from 'react';
import {
  getCiMonitorRecord, getCiMonitorRecords, getCurrentLocalAgentJob, getLocalAgentHealth, getLocalSerialPorts,
  startLocalAgentJob, stopLocalAgentJob,
  type CiMonitorMode, type CiMonitorRecordSummary, type LocalAgentHealth, type LocalAgentJob, type LocalSerialPort,
} from './api';

const modeOptions = [
  { value: 'UART1_PROTOCOL', label: 'UART1 · 指令帧 · 9600' },
  { value: 'UART0_LOG', label: 'UART0 · 调试日志 · 921600' },
] as const;

export default function Ci1302MonitorPanel() {
  const { message } = App.useApp();
  const [health, setHealth] = useState<LocalAgentHealth | null>(null);
  const [ports, setPorts] = useState<LocalSerialPort[]>([]);
  const [job, setJob] = useState<LocalAgentJob | null>(null);
  const [viewedRecord, setViewedRecord] = useState<LocalAgentJob | null>(null);
  const [records, setRecords] = useState<CiMonitorRecordSummary[]>([]);
  const [mode, setMode] = useState<CiMonitorMode>('UART1_PROTOCOL');
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ciJob = viewedRecord ?? (job?.action === 'CI_MONITOR' ? job : null);
  const running = job?.status === 'RUNNING';

  async function refresh(includePorts = false) {
    try {
      const [nextHealth, nextJob, nextPorts, nextRecords] = await Promise.all([
        getLocalAgentHealth(), getCurrentLocalAgentJob(),
        includePorts ? getLocalSerialPorts() : Promise.resolve(null),
        includePorts ? getCiMonitorRecords() : Promise.resolve(null),
      ]);
      setHealth(nextHealth);
      setJob(nextJob);
      setError(null);
      if (nextPorts) {
        setPorts(nextPorts);
        const preferred = mode === 'UART1_PROTOCOL' ? 'COM7' : 'COM6';
        setPort((current) => nextPorts.some((item) => item.path === current)
          ? current : nextPorts.some((item) => item.path === preferred) ? preferred : '');
      }
      if (nextRecords) setRecords(nextRecords);
    } catch (cause) {
      setHealth(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { void refresh(true); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void refresh(); }, 500);
    return () => window.clearInterval(timer);
  }, [running, job?.id]);

  async function start() {
    if (!port || busy || running) return;
    setBusy(true);
    try {
      const next = await startLocalAgentJob({
        action: 'CI_MONITOR', boardId: 'ci1302', port, monitorMode: mode,
      });
      setViewedRecord(null);
      setJob(next);
      message.success(`已开始只读监听 ${port}，请现在对 CI 板说话`);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!job || job.action !== 'CI_MONITOR' || job.status !== 'RUNNING') return;
    setBusy(true);
    try {
      setJob(await stopLocalAgentJob(job.id));
      setViewedRecord(null);
      window.setTimeout(() => { void refresh(true); }, 300);
      message.success('监听已停止；本次记录可导出');
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function exportRecord() {
    if (!ciJob) return;
    const blob = new Blob([JSON.stringify({
      format: 'dongxin-ci1302-serial-observation-v1',
      note: '只读串口观察；不等于 CI 与 STM32 联调验收',
      ...ciJob,
    }, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `ci1302-${ciJob.port || 'unknown'}-${ciJob.id}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function openRecord(id: string) {
    try {
      setViewedRecord(await getCiMonitorRecord(id));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <div className="ci-monitor-page">
    <Alert type="info" showIcon title="CI1302 实板监听 · 只读"
      description="当前 CI 开发板独立接电脑；此功能只接收串口数据，不发送控制帧、不烧录、不操作样机。请保持音量适中。" />
    <section className="workspace-section">
      <div className="ci-monitor-heading">
        <div><h2>连接与监听</h2><p>先点击开始，再对 CI 板说“智能管家”和一个出厂固定词，最后点击停止。</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh(true)}>重新检测</Button>
      </div>
      {!health ? <Alert type="warning" showIcon title="本机设备助手未连接" description={error || '请启动项目本机服务；云端网页需要插有开发板的电脑运行设备助手。'} /> : null}
      <div className="ci-monitor-controls">
        <label>监听内容
          <Select aria-label="CI1302 监听内容" value={mode} disabled={running || busy}
            options={modeOptions.map((item) => ({ ...item }))}
            onChange={(next: CiMonitorMode) => {
              setMode(next);
              const preferred = next === 'UART1_PROTOCOL' ? 'COM7' : 'COM6';
              setPort(ports.some((item) => item.path === preferred) ? preferred : '');
            }} />
        </label>
        <label>本机串口
          <Select aria-label="CI1302 本机串口" value={port || undefined} disabled={running || busy}
            placeholder="请选择串口" onChange={setPort}
            options={ports.map((item) => ({ value: item.path, label: `${item.path} · ${item.manufacturer || '串口设备'}` }))} />
        </label>
        <Space wrap>
          <Button type="primary" icon={<UsbOutlined />} disabled={!health || !port || running || busy} loading={busy && !running} onClick={() => void start()}>开始监听</Button>
          <Button danger icon={<StopOutlined />} disabled={!job || job.action !== 'CI_MONITOR' || job.status !== 'RUNNING' || busy} onClick={() => void stop()}>停止监听</Button>
          <Button icon={<ExportOutlined />} disabled={!ciJob || !ciJob.logs.length} onClick={exportRecord}>导出记录</Button>
        </Space>
      </div>
      <p className="ci-monitor-note">{mode === 'UART1_PROTOCOL'
        ? '推荐：当前 USB-TTL 预计为 COM7。只接 CI J4 的 TX1→转换器 RXD、GND→GND。原始字节始终显示；只有符合 V1 校验的 8 字节帧才标记为候选帧。'
        : '调试：当前 CI 板自身 USB 预计为 COM6。这里显示 UART0 日志，不等于 UART1 指令帧。打开 COM6 可能出现板卡启动日志。'} COM 号可能变化，请以设备管理器和接线为准。</p>
      {job?.status === 'RUNNING' && job.action !== 'CI_MONITOR' ? <Alert type="warning" showIcon title="已有本机任务运行" description="请先在固件烧录页面结束当前任务，再启动 CI 监听。" /> : null}
    </section>
    <section className="workspace-section">
      <div className="ci-monitor-heading"><div><h2>实时接收</h2><p>记录原始数据，不把出厂固件语义 ID 擅自映射为浴霸动作。</p></div>
        <Tag color={ciJob?.status === 'RUNNING' ? 'green' : ciJob?.status === 'FAILED' ? 'red' : 'default'}>
          {ciJob?.status === 'RUNNING' ? '正在监听' : ciJob?.status === 'FAILED' ? '监听失败' : ciJob ? '已停止' : '等待开始'}
        </Tag>
      </div>
      <div className="ci-monitor-stats">
        <span>端口 <strong>{ciJob?.port || '—'}</strong></span>
        <span>收到字节 <strong>{ciJob?.receivedBytes ?? 0}</strong></span>
        <span>V1 候选帧 <strong>{ciJob?.validFrames ?? 0}</strong></span>
        <span>开始时间 <strong>{ciJob ? new Date(ciJob.startedAt).toLocaleString('zh-CN') : '—'}</strong></span>
      </div>
      <div className="ci-monitor-log" role="log" aria-label="CI1302 串口实时数据">
        {ciJob?.logs.length ? ciJob.logs.map((entry, index) => <div key={`${entry.at}-${index}`}>
          <time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
          <code>{entry.text}</code>
        </div>) : <Empty description="暂无串口数据。请先开始监听，再说出厂唤醒词；0 字节不等于识别失败。" />}
      </div>
      {ciJob?.status !== 'RUNNING' && ciJob?.receivedBytes === 0 ? <p className="ci-monitor-note">如已听到 CI 语音回应但仍是 0 字节，请核对 TX1/RXD/GND 接线；出厂固件也可能没有启用 UART1 识别输出。</p> : null}
    </section>
    <section className="workspace-section">
      <div className="ci-monitor-heading"><div><h2>最近记录</h2><p>停止后保存在当前电脑的 D 盘项目目录；只存串口数据，不存音频。保留原始记录，可逐次导出。</p></div>
        <Button size="small" onClick={() => void refresh(true)}>刷新记录</Button>
      </div>
      <div className="ci-monitor-records">
        {job?.action === 'CI_MONITOR' ? <Button size="small" type={!viewedRecord ? 'primary' : 'default'} onClick={() => setViewedRecord(null)}>查看当前监听</Button> : null}
        {records.length ? records.map((record) => <button type="button" key={record.id} className={viewedRecord?.id === record.id ? 'selected' : ''} onClick={() => void openRecord(record.id)}>
          <strong>{new Date(record.startedAt).toLocaleString('zh-CN')} · {record.port} · {record.monitorMode === 'UART1_PROTOCOL' ? 'UART1 指令帧' : 'UART0 日志'}</strong>
          <span>{record.receivedBytes} 字节 · {record.validFrames} 个 V1 候选帧 · {record.status}</span>
        </button>) : <span className="ci-monitor-note">暂无已保存记录。</span>}
      </div>
    </section>
  </div>;
}
