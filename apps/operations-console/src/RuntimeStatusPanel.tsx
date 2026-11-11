import { Alert, Table, Tag } from 'antd';
import type { OperationsConsoleData, RuntimeStatus } from './api';

export default function RuntimeStatusPanel({ status, mqtt }: { status: RuntimeStatus; mqtt: OperationsConsoleData['mqtt'] }) {
  const queues = [{ key: '语音会话', ...status.voice }, ...Object.entries(status.stages).map(([key, value]) => ({ key, ...value })),
    ...(mqtt.upstream ? [{ key: 'MQTT 上行', ...mqtt.upstream }] : [])];
  const usage = status.usage;
  const retention = status.retention;
  return <>
    <section className="ops-panel" aria-label="语音调度与调用量">
      <div className="panel-title"><h3>语音调度与调用量</h3><Tag>单进程 · 30秒刷新</Tag></div>
      <Table size="small" pagination={false} rowKey="key" dataSource={queues} scroll={{ x: 650 }} columns={[
        { title: '处理环节', dataIndex: 'key' },
        { title: '执行中 / 上限', render: (_, row) => `${row.active} / ${row.limits.concurrency}` },
        { title: '排队 / 上限', render: (_, row) => `${row.waiting} / ${row.limits.maxWaiting}` },
        { title: '完成', dataIndex: 'completed' },
        { title: '失败', dataIndex: 'failed' },
        { title: '满载拒绝', dataIndex: 'rejected' },
        { title: '排队超时', dataIndex: 'expired' },
        { title: '排队取消', dataIndex: 'cancelled' },
      ]} />
      <p className="runtime-note">队列计数自本次服务启动累计；设备请求优先于研发批量任务。同一设备依次处理，排队超时后需要重新发起。MQTT 重复消息复用 {mqtt.replay?.reused ?? 0} 次。</p>
      <div className="infra-grid runtime-stats">
        {(['ASR', 'LLM', 'TTS'] as const).map((stage) => <article className="runtime-stat" key={stage}>
          <span>{stage} 今日尝试调用</span><strong>{usage[stage]}</strong>
          <small>{usage.dailyLimits[stage] ? `每日上限 ${usage.dailyLimits[stage]}` : '未设每日次数上限'}</small>
        </article>)}
        <article className="runtime-stat"><span>今日估算费用</span><strong>¥{usage.estimatedCostCny.toFixed(4)}</strong>
          <small>{usage.budgetCny ? `估算阈值 ¥${usage.budgetCny}` : '未设费用阈值'}</small></article>
      </div>
      <p className="runtime-note">调用量按 UTC 日（{usage.date}）累计，今日失败 {usage.failed} 次。费用按已配置单价估算，以服务商账单为准；费用阈值不包含在途调用的最终费用。</p>
    </section>
    <section className="ops-panel" aria-label="缓存与数据保留">
      <div className="panel-title"><h3>缓存与数据保留</h3></div>
      <p>语音文本历史：{status.storage?.voiceHistory === 'postgres' ? 'PostgreSQL' : '本地 JSON'}。</p>
      <p>短回复缓存命中 {status.ttsCache.hits} 次，占用 {(status.ttsCache.bytes / 1048576).toFixed(2)} / {(status.ttsCache.maxBytes / 1048576).toFixed(0)} MB；设备请求复用 {status.requestReplay.reused} 次。</p>
      <p>文本保留目标 {retention.policy.textDays} 天。{status.storage?.voiceHistory === 'postgres'
        ? '数据库过期文本在服务启动及每小时自动分批清理；维护失败会在下方提示。'
        : '本地历史还受条数上限约束。'} 系统日志 {retention.policy.logs} 条，设备事件 {retention.policy.events} 条，命令 {retention.policy.commands} 条。</p>
      <p>最近维护：{retention.lastRunAt ? new Date(retention.lastRunAt).toLocaleString('zh-CN') : '尚未完成'}；本轮清理 {retention.removedRecords} 条记录。</p>
      <p className="runtime-note">日常麦克风录音不落盘。人工选定的 ASR 测试集录音单独保留，不参与运行日志自动清理。短回复音频仅驻留内存并自动过期。</p>
      {retention.error && <Alert type="error" showIcon title={retention.error} />}
    </section>
  </>;
}
