import { App, Alert, Button, InputNumber, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { simulateProactiveSensor, type ProactiveSensorSimulation, type SimulatedSensorEvent } from './api';

const scenarios: Array<{ value: SimulatedSensorEvent; label: string }> = [
  { value: 'OCCUPANCY_ENTER', label: '进入浴室问候 · 雷达' },
  { value: 'LOW_TEMPERATURE', label: '环境提醒 · 温度偏低' },
  { value: 'HIGH_HUMIDITY', label: '环境提醒 · 湿度偏高' },
  { value: 'LONG_RUNNING', label: '运行提醒 · 设备运行较久' },
];

export default function ProactiveSimulationPanel({ deviceId }: { deviceId: string | null }) {
  const { message } = App.useApp();
  const [eventType, setEventType] = useState<SimulatedSensorEvent>('OCCUPANCY_ENTER');
  const [volume, setVolume] = useState(20);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [humidity, setHumidity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProactiveSensorSimulation | null>(null);

  async function run(playToDevice: boolean) {
    if (!deviceId || busy) return;
    setBusy(true);
    try {
      const response = await simulateProactiveSensor({
        deviceId, eventType, playToDevice, volumePercent: volume,
        ambientTemperature: temperature, humidity,
      });
      setResult(response);
      if (playToDevice && response.playback) message.success('已发送播报任务，请核对开发板播放状态');
      else if (!response.decision.shouldSpeak) message.info(`本次未播报：${response.decision.reason}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '场景模拟失败');
    } finally {
      setBusy(false);
    }
  }

  return <section className="workspace-section" aria-label="主动沟通硬件模拟">
    <div className="workspace-section-heading"><h3>主动沟通 · 硬件模拟</h3><Tag color="blue">仅研发</Tag></div>
    <Alert type="info" showIcon title="模拟触发，不改变真实设备状态"
      description="选择传感器事件后先预览结果；播报须再次确认。没有提供温湿度数值时，问候不会播报虚构读数。" />
    <div className="proactive-simulation-controls">
      <label>触发事件
        <Select aria-label="主动沟通模拟事件" value={eventType} options={scenarios} onChange={(value) => { setEventType(value); setResult(null); }} />
      </label>
      <label>模拟温度（可选）
        <span className="proactive-sensor-input"><InputNumber aria-label="模拟浴室温度" min={-10} max={50} value={temperature} onChange={setTemperature} placeholder="未提供" /><span>℃</span></span>
      </label>
      <label>模拟湿度（可选）
        <span className="proactive-sensor-input"><InputNumber aria-label="模拟浴室湿度" min={0} max={100} value={humidity} onChange={setHumidity} placeholder="未提供" /><span>%</span></span>
      </label>
      <label>开发板音量
        <span className="proactive-sensor-input"><InputNumber aria-label="主动沟通播报音量" min={5} max={80} value={volume} onChange={(value) => setVolume(value ?? 20)} /><span>%</span></span>
      </label>
    </div>
    <div className="proactive-simulation-actions">
      <Button disabled={!deviceId || busy} loading={busy} onClick={() => void run(false)}>预览判断</Button>
      <Button type="primary" disabled={!deviceId || busy} onClick={() => Modal.confirm({
        title: '确认从开发板播报？',
        content: `将使用 ${volume}% 音量播放。请让扬声器远离耳朵；本次不会自动执行任何设备动作。`,
        okText: '确认播报', cancelText: '取消', onOk: () => run(true),
      })}>播报并收听回答</Button>
    </div>
    {result ? <div className="module-result" style={{ marginTop: 12 }}>
      <span>{scenarios.find((item) => item.value === result.event.eventType)?.label} · 模拟结果</span>
      <strong>{result.decision.shouldSpeak ? result.decision.speak : `跳过：${result.decision.reason}`}</strong>
      <p>建议动作：{result.decision.suggestedIntent ?? '无'} · 设备动作：未执行</p>
      {result.playback ? <p>播放任务：{result.playback.id ?? '未知'} · {result.playback.status ?? '已发送'}</p> : null}
    </div> : null}
  </section>;
}
