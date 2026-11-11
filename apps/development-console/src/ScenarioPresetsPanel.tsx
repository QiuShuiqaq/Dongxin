import { App, Alert, Button, Select, Tag } from 'antd';
import { useState } from 'react';
import { evaluateDevelopmentScenario, type DevelopmentScenario, type DevelopmentScenarioResult } from './api';

const options: Array<{ value: DevelopmentScenario; label: string }> = [
  { value: 'WIFI_DOWN_FIXED_COMMAND', label: '断网 · 固定词' },
  { value: 'WIFI_DOWN_OPEN_QUESTION', label: '断网 · 开放问题' },
  { value: 'CLOUD_TIMEOUT', label: '云端超时' },
  { value: 'RECONNECT_STALE_COMMAND', label: '恢复联网 · 旧命令' },
  { value: 'DUPLICATE_LOCAL_EVENT', label: '重复本地事件' },
];

export default function ScenarioPresetsPanel({ deviceId }: { deviceId: string | null }) {
  const { message } = App.useApp();
  const [scenario, setScenario] = useState<DevelopmentScenario>('WIFI_DOWN_FIXED_COMMAND');
  const [result, setResult] = useState<DevelopmentScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!deviceId) return;
    setBusy(true);
    try { setResult(await evaluateDevelopmentScenario(deviceId, scenario)); }
    catch (error) { message.error(error instanceof Error ? error.message : '预设检查失败'); }
    finally { setBusy(false); }
  }
  return <section className="workspace-section" aria-label="故障预设推演">
    <div className="workspace-section-heading"><h3>故障预设</h3><Tag color="orange">只推演，不改网络</Tag></div>
    <Alert type="info" showIcon title="安全的断网预演"
      description="不会断开真实 Wi-Fi、修改设备状态、调用付费模型或触发样机负载。真实断网验收仍需在有人值守时单独进行。" />
    <div className="voice-test-actions" style={{ marginTop: 12 }}>
      <Select aria-label="故障预设类型" style={{ minWidth: 230 }} options={options} value={scenario} onChange={setScenario} />
      <Button onClick={() => void run()} disabled={!deviceId} loading={busy}>查看预期时序</Button>
    </div>
    {result ? <div className="module-result" style={{ marginTop: 12 }}>
      <strong>{result.title}</strong>
      <ol>{result.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
      <p>预期：{result.expected}</p><p>{result.note}</p>
    </div> : null}
  </section>;
}
