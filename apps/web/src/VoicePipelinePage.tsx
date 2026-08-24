import {
  ArrowRightOutlined,
  AudioOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  StopOutlined
} from '@ant-design/icons';
import type {
  DeviceProfile,
  ModelProvider,
  PromptVersion,
  VoicePipelineResponse,
  VoicePipelineStageKey,
  VoicePipelineStage
} from '@dongxin/shared';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  message
} from 'antd';
import { Fragment, useEffect, useRef, useState } from 'react';
import { runVoicePipeline } from './api';

const { Text, Title } = Typography;

type PipelineInputMode = 'TEXT_SIMULATION' | 'BROWSER_AUDIO';

interface VoicePipelinePageProps {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  devices: DeviceProfile[];
  llmProviders: ModelProvider[];
  selectedDeviceId: string;
  selectedProviderId: string;
  selectedPromptId: string;
}

export function VoicePipelinePage(props: VoicePipelinePageProps) {
  const [inputMode, setInputMode] = useState<PipelineInputMode>('TEXT_SIMULATION');
  const [text, setText] = useState('空气有点闷，开启换气');
  const [selectedDeviceId, setSelectedDeviceId] = useState(props.selectedDeviceId);
  const [selectedProviderId, setSelectedProviderId] = useState(props.selectedProviderId);
  const [selectedAsrProviderId, setSelectedAsrProviderId] = useState('');
  const [selectedTtsProviderId, setSelectedTtsProviderId] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState(props.selectedPromptId);
  const [applyToDevice, setApplyToDevice] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState<'AUTO' | 'HIT' | 'MISS'>('AUTO');
  const [result, setResult] = useState<VoicePipelineResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [apiMessage, messageHolder] = message.useMessage();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSelectedDeviceId(props.selectedDeviceId);
  }, [props.selectedDeviceId]);

  useEffect(() => {
    setSelectedProviderId(props.selectedProviderId);
  }, [props.selectedProviderId]);

  useEffect(() => {
    const defaultProvider = props.llmProviders.find((provider) => provider.enabled)?.id || props.llmProviders[0]?.id || '';
    if (!props.llmProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(defaultProvider);
    }
  }, [props.llmProviders, selectedProviderId]);

  useEffect(() => {
    const asrProviders = props.providers.filter((provider) => provider.serviceType === 'ASR');
    const defaultProvider = asrProviders.find((provider) => provider.enabled)?.id || asrProviders[0]?.id || '';
    if (!asrProviders.some((provider) => provider.id === selectedAsrProviderId)) {
      setSelectedAsrProviderId(defaultProvider);
    }
  }, [props.providers, selectedAsrProviderId]);

  useEffect(() => {
    const ttsProviders = props.providers.filter((provider) => provider.serviceType === 'TTS');
    const defaultProvider = ttsProviders.find((provider) => provider.enabled)?.id || ttsProviders[0]?.id || '';
    if (!ttsProviders.some((provider) => provider.id === selectedTtsProviderId)) {
      setSelectedTtsProviderId(defaultProvider);
    }
  }, [props.providers, selectedTtsProviderId]);

  useEffect(() => {
    setSelectedPromptId(props.selectedPromptId);
  }, [props.selectedPromptId]);

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  async function runTextTest() {
    if (!text.trim()) {
      apiMessage.warning('请输入测试语句');
      return;
    }

    await executePipeline({
      inputSource: 'TEXT_SIMULATION',
      text: text.trim()
    });
  }

  async function runRecordedAudio() {
    if (!recordedBlob) {
      apiMessage.warning('请先录制一段语音');
      return;
    }

    await executePipeline({
      inputSource: 'BROWSER_AUDIO',
      audioBase64: await blobToBase64(recordedBlob),
      mimeType: recordedBlob.type || 'audio/webm'
    });
  }

  async function executePipeline(input: {
    inputSource: 'TEXT_SIMULATION' | 'BROWSER_AUDIO';
    text?: string;
    audioBase64?: string;
    mimeType?: string;
  }) {
    setRunning(true);
    try {
      const nextResult = await runVoicePipeline({
        deviceId: selectedDeviceId,
        providerId: selectedProviderId || undefined,
        asrProviderId: selectedAsrProviderId || undefined,
        ttsProviderId: selectedTtsProviderId || undefined,
        promptId: selectedPromptId || undefined,
        applyToDevice,
        simulateOffline,
        ...input
      });
      setResult(nextResult);
      apiMessage.success(`闭环完成：${routeLabel(nextResult.route)}`);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      apiMessage.error('当前浏览器不支持麦克风录音');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaChunksRef.current = [];
      setRecordedBlob(null);
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  return (
    <Space orientation="vertical" size={16} className="full-width voice-pipeline-page">
      {messageHolder}
      <Card size="small">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={8}>
            <Title level={5} style={{ margin: 0 }}>
              完整语音闭环测试
            </Title>
            <Text type="secondary">从输入开始，查看离线、在线规则、ASR、知识库、LLM、安全和播报结果。</Text>
          </Col>
          <Col xs={24} md={12} xl={5}>
            <Text type="secondary">输入方式</Text>
            <Segmented
              block
              value={inputMode}
              onChange={(value) => setInputMode(value as PipelineInputMode)}
              options={[
                { label: '文本模拟', value: 'TEXT_SIMULATION' },
                { label: '浏览器录音', value: 'BROWSER_AUDIO' }
              ]}
            />
          </Col>
          <Col xs={24} md={12} xl={5}>
            <Text type="secondary">测试设备</Text>
            <Select
              className="full-width"
              value={selectedDeviceId}
              onChange={setSelectedDeviceId}
              options={props.devices.map((device) => ({ label: `${device.name} (${device.id})`, value: device.id }))}
            />
          </Col>
          <Col xs={24} md={12} xl={3}>
            <Text type="secondary">执行设备命令</Text>
            <div>
              <Switch checked={applyToDevice} onChange={setApplyToDevice} />
            </div>
          </Col>
          <Col xs={24} md={12} xl={3}>
            <Text type="secondary">离线判断</Text>
            <Select
              className="full-width"
              value={simulateOffline}
              onChange={setSimulateOffline}
              options={[
                { label: '自动', value: 'AUTO' },
                { label: '强制命中', value: 'HIT' },
                { label: '强制未命中', value: 'MISS' }
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="输入"
            extra={
              inputMode === 'TEXT_SIMULATION' ? (
                <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => void runTextTest()}>
                  运行闭环
                </Button>
              ) : recording ? (
                <Button danger icon={<StopOutlined />} onClick={stopRecording}>
                  停止录音
                </Button>
              ) : (
                <Button type="primary" icon={<AudioOutlined />} onClick={() => void startRecording()}>
                  开始录音
                </Button>
              )
            }
          >
            {inputMode === 'TEXT_SIMULATION' ? (
              <>
                <Input.TextArea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  autoSize={{ minRows: 7, maxRows: 12 }}
                  placeholder="例如：我发现设备的开启换气功能好像出了问题"
                />
                <Space wrap style={{ marginTop: 12 }}>
                  {['小东小东', '空气有点闷，开启换气', '我发现开启换气功能好像出了问题', '你的回答我很满意，再见'].map(
                    (sample) => (
                      <Button key={sample} size="small" onClick={() => setText(sample)}>
                        {sample}
                      </Button>
                    )
                  )}
                </Space>
              </>
            ) : (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert
                  type={recording ? 'warning' : 'info'}
                  showIcon
                  title={recording ? '正在录音，请说完后点击停止录音。' : '录音会先上传到后端 ASR，再进入同一套闭环。'}
                />
                {recordedUrl ? <audio controls src={recordedUrl} className="full-width" /> : null}
                {recordedBlob ? (
                  <Button
                    icon={<CloudUploadOutlined />}
                    loading={running}
                    onClick={() => void runRecordedAudio()}
                    disabled={recording}
                  >
                    上传录音并测试
                  </Button>
                ) : null}
              </Space>
            )}
          </Card>

          <Card size="small" title="本次测试服务配置" style={{ marginTop: 16 }}>
            <Space orientation="vertical" size={12} className="full-width">
              <Select
                value={selectedProviderId}
                onChange={setSelectedProviderId}
                className="full-width"
                placeholder="选择复杂问题使用的 LLM"
                options={props.llmProviders.map((provider) => ({
                  label: `${provider.name} · ${provider.model}`,
                  value: provider.id
                }))}
              />
              <Select
                allowClear
                value={selectedAsrProviderId || undefined}
                onChange={(value) => setSelectedAsrProviderId(value || '')}
                className="full-width"
                placeholder="选择音频识别使用的 ASR"
                options={props.providers
                  .filter((provider) => provider.serviceType === 'ASR')
                  .map((provider) => ({
                    label: `${provider.name} · ${provider.model}`,
                    value: provider.id
                  }))}
                notFoundContent="请先在模型供应商中新增 ASR 配置"
              />
              <Select
                allowClear
                value={selectedTtsProviderId || undefined}
                onChange={(value) => setSelectedTtsProviderId(value || '')}
                className="full-width"
                placeholder="选择播报使用的 TTS"
                options={props.providers
                  .filter((provider) => provider.serviceType === 'TTS')
                  .map((provider) => ({
                    label: `${provider.name} · ${provider.model}`,
                    value: provider.id
                  }))}
                notFoundContent="请先在模型供应商中新增 TTS 配置"
              />
              <Select
                value={selectedPromptId}
                onChange={setSelectedPromptId}
                className="full-width"
                placeholder="选择提示词版本"
                options={props.prompts.map((prompt) => ({
                  label: `${prompt.name} v${prompt.version}`,
                  value: prompt.id
                }))}
              />
              <Text type="secondary">文本模拟会跳过 ASR；离线路径会跳过云端 TTS。浏览器录音和设备音频会按这里选择的 ASR、LLM、TTS 依次测试。</Text>
            </Space>
          </Card>

          <Card size="small" title="真实设备音频入口" style={{ marginTop: 16 }}>
            <Text code>POST /api/device/v1/voice-audio</Text>
            <Divider style={{ margin: '12px 0' }} />
            <Text type="secondary">
              WiFi 语音模块将音频转为 Base64 后调用该接口。服务端会强制使用 DEVICE_AUDIO、执行设备命令并记录完整阶段日志。
            </Text>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <PipelineResult result={result} />
        </Col>
      </Row>
    </Space>
  );
}

function PipelineResult(props: { result: VoicePipelineResponse | null }) {
  if (!props.result) {
    return (
      <Card size="small" title="闭环结果">
        <Alert type="info" showIcon title="运行一次文本或录音测试后，这里显示每个阶段的状态、耗时、费用和最终结果。" />
      </Card>
    );
  }

  const result = props.result;
  return (
    <Space orientation="vertical" size={12} className="full-width">
      <Card size="small" title="本次结果">
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>
            <Statistic title="路由" value={routeLabel(result.route)} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="总耗时" value={result.totalLatencyMs} suffix="ms" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="本次费用" value={result.cost.totalCny} precision={6} prefix="￥" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="总 Token" value={result.cost.totalTokens} />
          </Col>
        </Row>
        <Divider />
        <Descriptions size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="识别文本">{result.transcript || '未获得文本'}</Descriptions.Item>
          <Descriptions.Item label="最终回复">{result.replyText || '无播报文本'}</Descriptions.Item>
          <Descriptions.Item label="设备命令">{result.commandRecord?.intent || '无'}</Descriptions.Item>
          <Descriptions.Item label="安全结果">{result.safetyResult.decision}</Descriptions.Item>
        </Descriptions>
        {result.ttsAudioBase64 && result.ttsAudioMimeType ? (
          <audio
            controls
            className="full-width"
            src={`data:${result.ttsAudioMimeType};base64,${result.ttsAudioBase64}`}
          />
        ) : null}
        <Divider style={{ margin: '12px 0' }} />
        <Descriptions size="small" column={{ xs: 2, md: 4 }}>
          <Descriptions.Item label="ASR">￥{result.cost.asrCny.toFixed(6)}</Descriptions.Item>
          <Descriptions.Item label="LLM">￥{result.cost.llmCny.toFixed(6)}</Descriptions.Item>
          <Descriptions.Item label="TTS">￥{result.cost.ttsCny.toFixed(6)}</Descriptions.Item>
          <Descriptions.Item label="费用估算">{result.cost.isEstimated ? '是' : '否'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="处理链路">
        <PipelineFlowChart result={result} />
        <Collapse
          ghost
          items={[
            {
              key: 'details',
              label: `阶段明细（${result.stages.length}）`,
              children: (
                <div className="voice-stage-list">
                  {result.stages.map((stage) => (
                    <StageRow key={stage.key} stage={stage} />
                  ))}
                </div>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function PipelineFlowChart(props: { result: VoicePipelineResponse }) {
  const { result } = props;
  const actualStages = getActualStages(result);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    if (actualStages.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        if (current >= actualStages.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 240);

    return () => window.clearInterval(timer);
  }, [result.sessionId, actualStages.length]);

  const visibleStages = actualStages.slice(0, visibleCount);
  const activeKey =
    visibleCount > 0 && visibleCount < actualStages.length
      ? actualStages[visibleCount - 1]?.key
      : null;

  return (
    <div className="pipeline-flow-panel">
      <div className="pipeline-flow-summary">
        <Text strong>实际线路：{routeLabel(result.route)}</Text>
        <Text type="secondary">
          {visibleCount < actualStages.length
            ? `正在经过第 ${visibleCount + 1} 个节点`
            : `已完成 ${actualStages.length} 个节点`}
        </Text>
      </div>
      <div className="pipeline-flow">
        {visibleStages.map((stage, index) => {
          return (
            <Fragment key={`${stage.key}-${index}`}>
              <FlowNode stage={stage} active={stage.key === activeKey} step={index + 1} />
              {index < visibleStages.length - 1 ? <ArrowRightOutlined className="pipeline-flow-arrow" /> : null}
            </Fragment>
          );
        })}
        {!visibleStages.length ? <Text type="secondary">正在准备执行线路…</Text> : null}
      </div>
    </div>
  );
}

function FlowNode(props: {
  stage: VoicePipelineStage;
  active: boolean;
  step: number;
}) {
  const label = props.stage.label || stageLabel(props.stage.key);
  const status = props.stage.status;
  const stateLabel =
    status === 'MATCHED'
      ? '命中'
      : status === 'COMPLETED'
        ? '完成'
        : status === 'FAILED'
          ? '失败'
          : status === 'NOT_CONFIGURED'
            ? '未配置'
            : '跳过';
  const stateClass =
    status === 'FAILED'
      ? 'failed'
      : status === 'NOT_CONFIGURED'
        ? 'not-configured'
        : status === 'SKIPPED'
          ? 'skipped'
          : status === 'MATCHED'
            ? 'matched'
            : 'completed';

  return (
    <div className={`pipeline-flow-node pipeline-flow-node-${stateClass}${props.active ? ' pipeline-flow-node-active' : ''}`}>
      <span className="pipeline-flow-step">{props.step}</span>
      <Text strong>{label}</Text>
      <Tag color={stateClass === 'skipped' ? 'default' : stateClass === 'failed' ? 'red' : stateClass === 'not-configured' ? 'orange' : 'blue'}>
        {stateLabel}
      </Tag>
      {props.stage.result ? <Text type="secondary">{props.stage.result}</Text> : null}
    </div>
  );
}

function getActualStages(result: VoicePipelineResponse): VoicePipelineStage[] {
  const visibleKeys = new Set<VoicePipelineStageKey>([
    'INPUT',
    'ASR',
    'WAKE_WORD',
    'OFFLINE_INTENT',
    'ONLINE_RULE',
    'KNOWLEDGE',
    'LLM',
    'SAFETY',
    'DEVICE',
    'TTS'
  ]);

  const routeTerminalKeys: Record<VoicePipelineResponse['route'], VoicePipelineStageKey[]> = {
    OFFLINE: ['INPUT', 'WAKE_WORD', 'OFFLINE_INTENT', 'SAFETY', 'DEVICE', 'TTS'],
    ONLINE_RULE: ['INPUT', 'ASR', 'WAKE_WORD', 'OFFLINE_INTENT', 'ONLINE_RULE', 'SAFETY', 'DEVICE', 'TTS'],
    KNOWLEDGE: ['INPUT', 'ASR', 'WAKE_WORD', 'OFFLINE_INTENT', 'ONLINE_RULE', 'KNOWLEDGE', 'SAFETY', 'DEVICE', 'TTS'],
    LLM: ['INPUT', 'ASR', 'WAKE_WORD', 'OFFLINE_INTENT', 'ONLINE_RULE', 'LLM', 'SAFETY', 'DEVICE', 'TTS'],
    UNRESOLVED: ['INPUT', 'ASR', 'WAKE_WORD', 'OFFLINE_INTENT', 'ONLINE_RULE', 'KNOWLEDGE', 'LLM', 'SAFETY', 'DEVICE', 'TTS']
  };
  const routeKeys = new Set(routeTerminalKeys[result.route]);

  return result.stages.filter((stage) => {
    if (!visibleKeys.has(stage.key)) {
      return false;
    }
    if (stage.status !== 'SKIPPED') {
      return true;
    }
    return routeKeys.has(stage.key) && ['ASR', 'OFFLINE_INTENT', 'DEVICE', 'TTS'].includes(stage.key);
  });
}

function stageLabel(key: VoicePipelineStageKey | undefined): string {
  switch (key) {
    case 'INPUT':
      return '用户输入';
    case 'ASR':
      return 'ASR';
    case 'WAKE_WORD':
      return '唤醒词';
    case 'OFFLINE_INTENT':
      return '离线模块';
    case 'ONLINE_RULE':
      return '在线规则';
    case 'KNOWLEDGE':
      return '企业知识库';
    case 'LLM':
      return 'LLM';
    case 'SAFETY':
      return '安全校验';
    case 'TTS':
      return 'TTS';
    case 'DEVICE':
      return '设备执行';
    default:
      return '处理阶段';
  }
}

function StageRow(props: { stage: VoicePipelineStage }) {
  const { stage } = props;
  const color =
    stage.status === 'FAILED'
      ? 'red'
      : stage.status === 'NOT_CONFIGURED'
        ? 'orange'
        : stage.status === 'SKIPPED'
          ? 'default'
          : stage.status === 'MATCHED'
            ? 'blue'
            : 'green';

  return (
    <div className="voice-stage-row">
      <div className="voice-stage-icon">
        {stage.status === 'COMPLETED' || stage.status === 'MATCHED' ? (
          <CheckCircleOutlined />
        ) : stage.status === 'FAILED' ? (
          <StopOutlined />
        ) : (
          <ExperimentOutlined />
        )}
      </div>
      <div className="voice-stage-content">
        <div className="voice-stage-head">
          <Text strong>{stage.label}</Text>
          <Space size={6}>
            <Tag color={color}>{stage.status}</Tag>
            <Text type="secondary">{stage.latencyMs} ms</Text>
            {stage.costCny > 0 ? <Text type="secondary">￥{stage.costCny.toFixed(6)}</Text> : null}
          </Space>
        </div>
        <Text type="secondary">{stage.result || stage.error || '-'}</Text>
        {stage.source ? <Text type="secondary">来源：{stage.source}</Text> : null}
        {stage.error ? <Alert type="error" showIcon title={stage.error} style={{ marginTop: 6 }} /> : null}
      </div>
    </div>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function routeLabel(route: VoicePipelineResponse['route']): string {
  switch (route) {
    case 'OFFLINE':
      return '离线';
    case 'ONLINE_RULE':
      return '在线规则';
    case 'KNOWLEDGE':
      return '知识库';
    case 'LLM':
      return 'LLM';
    case 'UNRESOLVED':
    default:
      return '未完成';
  }
}
