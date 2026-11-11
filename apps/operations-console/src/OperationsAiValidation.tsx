import type { BatchTestRun, DeviceProfile, ModelProvider, TestSetSummary } from '@dongxin/shared';
import { Alert, App, Button, Empty, Input, InputNumber, Segmented, Select, Space, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import {
  cancelOperationsAiRun,
  exportOperationsAiRun,
  getOperationsAiRun,
  getOperationsAiRuns,
  getOperationsAiTestSets,
  previewOperationsAi,
  startOperationsAiRun,
} from './api';
import type { OperationsAiPreview } from './api';

interface Props {
  providers: ModelProvider[];
  devices: DeviceProfile[];
  canManage: boolean;
}

export default function OperationsAiValidation({ providers, devices, canManage }: Props) {
  const { message, modal } = App.useApp();
  const llmProviders = providers.filter((item) => item.serviceType === 'LLM' && item.enabled);
  const [view, setView] = useState<'single' | 'batch'>('single');
  const [mode, setMode] = useState<'PIPELINE' | 'LLM'>('PIPELINE');
  const [providerId, setProviderId] = useState(llmProviders[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<OperationsAiPreview | null>(null);
  const [testSets, setTestSets] = useState<TestSetSummary[]>([]);
  const [testSetId, setTestSetId] = useState('');
  const [runName, setRunName] = useState('文本回归测试');
  const [maxCases, setMaxCases] = useState(10);
  const [runs, setRuns] = useState<BatchTestRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<BatchTestRun | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!llmProviders.some((item) => item.id === providerId)) setProviderId(llmProviders[0]?.id ?? '');
  }, [providers]);
  useEffect(() => {
    void Promise.all([getOperationsAiTestSets(), getOperationsAiRuns()]).then(([sets, recent]) => {
      setTestSets(sets);
      setRuns(recent);
    }).catch((error) => message.error(error instanceof Error ? error.message : '验证记录加载失败'));
  }, []);
  useEffect(() => {
    if (!runs.some((item) => item.status === 'QUEUED' || item.status === 'RUNNING')) return;
    const timer = window.setInterval(() => {
      void getOperationsAiRuns().then(setRuns).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runs]);

  function confirmSingle() {
    if (!text.trim() || !providerId || !canManage) return;
    modal.confirm({
      title: '运行单条 AI 验证？',
      content: mode === 'PIPELINE' ? '按在线规则、知识库、模型和安全校验顺序预览；规则或知识库命中时不调用模型。不会下发设备指令或生成语音。' : '仅调用所选 LLM，可能产生少量费用；不向设备下发命令。',
      okText: '确认运行',
      onOk: async () => {
        setBusy(true);
        setPreview(null);
        try {
          setPreview(await previewOperationsAi({ text: text.trim(), providerId, deviceId: deviceId || undefined, mode }));
        } catch (error) {
          message.error(error instanceof Error ? error.message : '验证失败');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  function confirmBatch() {
    if (!testSetId || !providerId || !canManage) return;
    const count = Math.min(maxCases, testSets.find((item) => item.id === testSetId)?.caseCount ?? maxCases);
    modal.confirm({
      title: `运行最多 ${count} 条文本验证？`,
      content: mode === 'PIPELINE' ? '每条语料按在线完整文本链路运行；只有未被规则或知识库解决的输入才调用 LLM。任务不下发设备命令或生成语音。' : '每条语料会调用一次 LLM 并计费。任务不下发设备命令；可停止和导出。',
      okText: '确认运行',
      onOk: async () => {
        setBusy(true);
        try {
          const run = await startOperationsAiRun({
            name: runName.trim() || '文本回归测试', providerId, testSetId,
            deviceId: deviceId || undefined, maxCases, mode,
          });
          setRuns((current) => [run, ...current]);
          if (run.auditRecorded) message.success('批量任务已开始');
          else message.warning('任务已开始，但审计记录未写入；本次结果不能用于正式报告');
        } catch (error) {
          message.error(error instanceof Error ? error.message : '任务启动失败');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function openRun(id: string) {
    try { setSelectedRun(await getOperationsAiRun(id)); }
    catch (error) { message.error(error instanceof Error ? error.message : '任务读取失败'); }
  }

  return <div className="ops-stack">
    <Alert type="info" showIcon title="文本验证不控制设备，也不播放语音" description="未命中规则或知识库时可能产生模型费用。测试集需经双方确认后，其通过率才能作为合同验收依据。" />
    <div className="ops-workbar"><Segmented aria-label="AI 验证类型" value={view} onChange={(value) => setView(value as 'single' | 'batch')} options={[{ label: '单条验证', value: 'single' }, { label: '批量与报告', value: 'batch' }]} /></div>
    <section className="ops-panel ops-ai-validation">
      <div className="ops-ai-fields">
        <label>验证范围<Select aria-label="AI 验证范围" value={mode} onChange={setMode} options={[{ value: 'PIPELINE', label: '在线完整文本链路' }, { value: 'LLM', label: '仅测试 LLM' }]} /></label>
        <label>LLM 模型<Select aria-label="验证模型" value={providerId || undefined} onChange={setProviderId} placeholder="选择已启用模型" options={llmProviders.map((item) => ({ value: item.id, label: `${item.name} · ${item.model}` }))} /></label>
        <label>设备状态上下文<Select aria-label="验证设备上下文" value={deviceId} onChange={setDeviceId} options={[{ value: '', label: '虚拟测试设备（默认）' }, ...devices.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))]} /></label>
      </div>
      {view === 'single' ? <>
        <label className="ops-ai-text-label">输入语料<Input.TextArea aria-label="单条测试语料" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} rows={3} placeholder="例如：浴室有点闷，帮我换一下气" /></label>
        <Space><Button type="primary" disabled={!canManage || !providerId || !text.trim()} loading={busy} onClick={confirmSingle}>运行验证</Button></Space>
        {preview ? <div className="ops-ai-result">
          <Space wrap><Tag color="blue">{preview.aiResult.resultType}</Tag><Tag>{preview.aiResult.intent ?? '无控制意图'}</Tag><Tag color={preview.safetyResult.decision === 'APPROVED' ? 'green' : 'orange'}>{preview.safetyResult.decision}</Tag><Tag>未下发设备</Tag></Space>
          {preview.mode === 'LLM' && preview.error ? <Alert type="error" title={preview.error} /> : null}
          {preview.mode === 'PIPELINE' ? <Space wrap>{preview.stages.filter((stage) => ['ONLINE_RULE', 'KNOWLEDGE', 'LLM', 'SAFETY', 'DEVICE'].includes(stage.key)).map((stage) => <Tag key={stage.key} color={stage.status === 'FAILED' ? 'red' : stage.status === 'MATCHED' ? 'green' : undefined}>{stage.key}: {stage.status}</Tag>)}</Space> : null}
          {preview.mode === 'PIPELINE' && preview.stages.some((stage) => stage.status === 'FAILED') ? <Alert type="error" title={preview.stages.find((stage) => stage.status === 'FAILED')?.error || '处理失败'} /> : null}
          {!preview.auditRecorded ? <Alert type="warning" title="本次验证的审计记录未写入，请勿将结果用于正式报告" /> : null}
          <p>{preview.mode === 'PIPELINE' ? preview.replyText || '没有回复文本' : preview.aiResult.speak || '没有回复文本'}</p>
          <div>安全校验后的建议动作：{preview.safetyResult.commands.length ? preview.safetyResult.commands.join('、') : '无'}（仅预览，未下发）</div>
          <small>{preview.mode === 'PIPELINE' ? `处理路径：${preview.route} · ` : ''}参数：{JSON.stringify(preview.aiResult.slots)} · 耗时 {preview.mode === 'PIPELINE' ? preview.totalLatencyMs : preview.latencyMs} ms · 输入/输出 Token {preview.mode === 'PIPELINE' ? preview.cost.inputTokens : preview.usage.inputTokens ?? 0}/{preview.mode === 'PIPELINE' ? preview.cost.outputTokens : preview.usage.outputTokens ?? 0} · 费用估算 ¥{(preview.mode === 'PIPELINE' ? preview.cost.totalCny : preview.usage.costCny ?? 0).toFixed(4)}</small>
          {preview.mode === 'PIPELINE' ? <details><summary>查看处理步骤</summary><Table rowKey="key" size="small" pagination={false} dataSource={preview.stages} columns={[{ title: '步骤', dataIndex: 'key' }, { title: '状态', dataIndex: 'status' }, { title: '来源', dataIndex: 'source' }, { title: '结果', dataIndex: 'result' }, { title: '耗时 ms', dataIndex: 'latencyMs' }]} /></details> : null}
        </div> : null}
      </> : <>
        <div className="ops-ai-fields">
          <label>测试集<Select aria-label="批量测试集" value={testSetId || undefined} onChange={setTestSetId} placeholder="选择测试集" options={testSets.map((item) => ({ value: item.id, label: `${item.name} · ${item.caseCount} 条` }))} /></label>
          <label>本次最多运行<InputNumber aria-label="批量测试条数" min={1} max={50} value={maxCases} onChange={(value) => setMaxCases(value ?? 10)} /></label>
        </div>
        <label className="ops-ai-text-label">任务名称<Input aria-label="批量任务名称" value={runName} maxLength={100} onChange={(event) => setRunName(event.target.value)} /></label>
        <Space><Button type="primary" disabled={!canManage || !providerId || !testSetId} loading={busy} onClick={confirmBatch}>启动批量验证</Button><Button onClick={() => void getOperationsAiRuns().then(setRuns).catch((error) => message.error(String(error)))}>刷新记录</Button></Space>
      </>}
    </section>
    {view === 'batch' ? <section className="ops-panel"><h3>批量任务记录</h3>
      <Table rowKey="id" size="small" scroll={{ x: 1050 }} dataSource={runs} pagination={{ pageSize: 10 }} locale={{ emptyText: '暂无批量任务' }} columns={[
        { title: '任务', dataIndex: 'name', ellipsis: true },
        { title: '范围', dataIndex: 'kind', width: 100, render: (value: string) => value === 'PIPELINE' ? '完整链路' : '仅 LLM' },
        { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag>{value}</Tag> },
        { title: '通过/完成', width: 120, render: (_, row: BatchTestRun) => `${row.summary.passed}/${row.summary.completed}` },
        { title: '通过率', width: 90, render: (_, row: BatchTestRun) => `${(row.summary.passRate * 100).toFixed(1)}%` },
        { title: '平均耗时', width: 100, render: (_, row: BatchTestRun) => `${row.summary.averageLatencyMs.toFixed(0)} ms` },
        { title: '费用估算', width: 100, render: (_, row: BatchTestRun) => `¥${row.summary.totalCostCny.toFixed(4)}` },
        { title: '操作', width: 200, render: (_, row: BatchTestRun) => <Space><Button size="small" onClick={() => void openRun(row.id)}>明细</Button><Button size="small" onClick={() => void exportOperationsAiRun(row.id).catch((error) => message.error(String(error)))}>导出</Button>{canManage && ['QUEUED', 'RUNNING'].includes(row.status) ? <Button size="small" danger onClick={() => void cancelOperationsAiRun(row.id).then(() => getOperationsAiRuns().then(setRuns)).catch((error) => message.error(String(error)))}>停止</Button> : null}</Space> },
      ]} />
    </section> : null}
    {view === 'batch' && selectedRun ? <section className="ops-panel"><Space><h3>{selectedRun.name} · 明细</h3><Button size="small" onClick={() => void openRun(selectedRun.id)}>刷新</Button><Button size="small" onClick={() => setSelectedRun(null)}>收起</Button></Space>
      {selectedRun.items.length ? <Table rowKey="id" size="small" scroll={{ x: 1080 }} dataSource={selectedRun.items} pagination={{ pageSize: 20 }} columns={[
        { title: '#', dataIndex: 'sequence', width: 50 },
        { title: '输入', dataIndex: 'inputText', width: 230, ellipsis: true },
        { title: '预期意图', dataIndex: 'expectedIntent', width: 110 },
        { title: '实际意图', dataIndex: 'actualIntent', width: 110 },
        { title: '判定', dataIndex: 'passed', width: 80, render: (value: boolean) => <Tag color={value ? 'green' : 'red'}>{value ? '通过' : '未通过'}</Tag> },
        { title: '耗时', dataIndex: 'latencyMs', width: 90, render: (value: number) => `${value} ms` },
        { title: '费用估算', dataIndex: 'costCny', width: 100, render: (value: number) => `¥${value.toFixed(4)}` },
        { title: '说明', dataIndex: 'failureReason', ellipsis: true },
      ]} /> : <Empty description="任务尚无结果" />}
    </section> : null}
  </div>;
}
