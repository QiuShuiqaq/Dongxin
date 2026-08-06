import {
  ApiOutlined,
  BellOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { Bubble, Sender, XProvider } from '@ant-design/x';
import type {
  AiResult,
  DeviceProfile,
  DeviceIntent,
  DeviceState,
  EvaluationRun,
  KnowledgeDocument,
  KnowledgeQueryResponse,
  ModelProvider,
  ProactiveDecision,
  ProactiveSettings,
  PromptVersion,
  ProviderSecretStatus,
  SystemLog,
  TestCase
} from '@dongxin/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  theme
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import {
  clearProviderApiKey,
  createKnowledgeDocument,
  getBootstrap,
  getDevices,
  getKnowledgeDocuments,
  getLogs,
  getProviderSecretStatuses,
  getProactiveSettings,
  queryKnowledge,
  patchDeviceState,
  recordDeviceEvent,
  runProactiveEvent,
  runChatTest,
  runEvaluation,
  sendDeviceCommand,
  updateProactiveSettings,
  saveProviderApiKey,
  updateProviders
} from './api';
import type { BootstrapData, ChatTestResponse } from './api';

const { Header, Content, Sider } = Layout;
const { Text, Title } = Typography;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type AppSection = 'intent' | 'safety' | 'providers' | 'devices' | 'knowledge' | 'proactive' | 'logs' | 'data';

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('mock-local');
  const [selectedPromptId, setSelectedPromptId] = useState('bath-heater-intent-v1');
  const [selectedDeviceId, setSelectedDeviceId] = useState('demo-bath-heater-001');
  const [senderValue, setSenderValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [lastChatResult, setLastChatResult] = useState<ChatTestResponse | null>(null);
  const [activeSection, setActiveSection] = useState<AppSection>('intent');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '输入浴霸语音测试句，例如：有点冷、浴室空气不好、温度调到 42 度。'
    }
  ]);
  const [apiMessage, messageHolder] = message.useMessage();

  useEffect(() => {
    void refresh();
  }, []);

  const providers = bootstrap?.providers ?? [];
  const prompts = bootstrap?.prompts ?? [];
  const testCases = bootstrap?.testCases ?? [];
  const evaluations = bootstrap?.evaluations ?? [];
  const deviceState = bootstrap?.deviceState;
  const latestEvaluation = evaluations[0];

  const providerOptions = providers.map((provider) => ({
    label: provider.name,
    value: provider.id
  }));
  const promptOptions = prompts.map((prompt) => ({
    label: `${prompt.name} v${prompt.version}`,
    value: prompt.id
  }));

  async function refresh() {
    try {
      const data = await getBootstrap();
      setBootstrap(data);
      if (!data.providers.some((provider) => provider.id === selectedProviderId)) {
        setSelectedProviderId(data.providers[0]?.id || '');
      }
      if (!data.prompts.some((prompt) => prompt.id === selectedPromptId)) {
        setSelectedPromptId(data.prompts[0]?.id || '');
      }
      if (!data.devices.some((device) => device.id === selectedDeviceId)) {
        setSelectedDeviceId(data.devices[0]?.id || '');
      }
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSend(value: string) {
    const inputText = value.trim();
    if (!inputText) {
      return;
    }

    setSenderValue('');
    setIsSending(true);
    setChatMessages((messages) => [
      ...messages,
      { id: crypto.randomUUID(), role: 'user', content: inputText }
    ]);

    try {
      const result = await runChatTest({
        providerId: selectedProviderId,
        promptId: selectedPromptId,
        inputText,
        applyToDevice: true
      });
      setLastChatResult(result);
      setBootstrap((current) => (current ? { ...current, deviceState: result.deviceState } : current));
      setChatMessages((messages) => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `${result.safetyResult.speak}\n\n意图：${result.aiResult.intent || result.aiResult.resultType}；规则：${result.safetyResult.decision}；延迟：${result.latencyMs}ms`
        }
      ]);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  }

  async function handleRunEvaluation() {
    setIsEvaluating(true);
    try {
      const run = await runEvaluation({
        providerIds: [selectedProviderId],
        promptId: selectedPromptId
      });
      apiMessage.success(`评测完成：${run.summary.passed}/${run.summary.total}`);
      await refresh();
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEvaluating(false);
    }
  }

  async function updateDeviceState(patch: Partial<DeviceState>) {
    try {
      const nextState = await patchDeviceState(patch);
      setBootstrap((current) => (current ? { ...current, deviceState: nextState } : current));
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleProvidersChange(nextProviders: ModelProvider[]) {
    try {
      const savedProviders = await updateProviders(nextProviders);
      setBootstrap((current) => (current ? { ...current, providers: savedProviders } : current));
      apiMessage.success('模型供应商配置已保存');
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSendDeviceCommand(
    deviceId: string,
    input: { intent: string; slots?: Record<string, unknown> }
  ) {
    try {
      const result = await sendDeviceCommand(deviceId, input);
      setBootstrap((current) => (current ? { ...current, deviceState: result.state } : current));
      await refresh();
      apiMessage.success('设备指令已执行');
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRecordDeviceEvent(
    deviceId: string,
    input: { type: string; payload?: Record<string, unknown> }
  ) {
    try {
      await recordDeviceEvent(deviceId, input);
      await refresh();
      apiMessage.success('设备事件已上报');
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateKnowledgeDocument(input: {
    title: string;
    category: string;
    content: string;
    tags: string[];
    status?: 'DRAFT' | 'PUBLISHED';
  }) {
    try {
      await createKnowledgeDocument(input);
      await refresh();
      apiMessage.success('知识库资料已保存');
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleQueryKnowledge(input: {
    question: string;
    category?: string;
    limit?: number;
  }) {
    return queryKnowledge(input);
  }

  async function handleUpdateProactiveSettings(input: Partial<NonNullable<BootstrapData['proactiveSettings']>>) {
    try {
      const settings = await updateProactiveSettings(input);
      setBootstrap((current) => (current ? { ...current, proactiveSettings: settings } : current));
      await refresh();
      apiMessage.success('主动沟通设置已更新');
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTriggerProactiveEvent(input: {
    deviceId?: string;
    eventType: 'OCCUPANCY_ENTER' | 'OCCUPANCY_LEAVE' | 'LOW_TEMPERATURE' | 'HIGH_HUMIDITY' | 'LONG_RUNNING';
    ambientTemperature?: number | null;
    humidity?: number | null;
    hasOccupancy?: boolean | null;
    occurredAt?: string;
  }) {
    try {
      const decision = await runProactiveEvent(input);
      await refresh();
      apiMessage.success('主动沟通事件已触发');
      return decision;
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 6,
          colorPrimary: '#1677ff',
          colorSuccess: '#2f9e44',
          colorWarning: '#d48806',
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}
    >
      <XProvider>
        {messageHolder}
        <Layout className="app-shell">
          <Sider className="app-sider" width={236}>
            <div className="brand-block">
              <div className="brand-mark">DX</div>
              <div>
                <Text strong>东信浴霸 AI Lab</Text>
                <Text type="secondary" className="brand-subtitle">
                  本地研发测试平台
                </Text>
              </div>
            </div>
            <div className="nav-group">
              <NavItem
                icon={<ExperimentOutlined />}
                label="意图测试"
                active={activeSection === 'intent'}
                onClick={() => setActiveSection('intent')}
              />
              <NavItem
                icon={<SafetyCertificateOutlined />}
                label="安全规则"
                active={activeSection === 'safety'}
                onClick={() => setActiveSection('safety')}
              />
              <NavItem
                icon={<CloudServerOutlined />}
                label="模型供应商"
                active={activeSection === 'providers'}
                onClick={() => setActiveSection('providers')}
              />
              <NavItem
                icon={<DatabaseOutlined />}
                label="设备管理"
                active={activeSection === 'devices'}
                onClick={() => setActiveSection('devices')}
              />
              <NavItem
                icon={<BookOutlined />}
                label="知识库"
                active={activeSection === 'knowledge'}
                onClick={() => setActiveSection('knowledge')}
              />
              <NavItem
                icon={<BellOutlined />}
                label="主动沟通"
                active={activeSection === 'proactive'}
                onClick={() => setActiveSection('proactive')}
              />
              <NavItem
                icon={<HistoryOutlined />}
                label="日志"
                active={activeSection === 'logs'}
                onClick={() => setActiveSection('logs')}
              />
              <NavItem
                icon={<RobotOutlined />}
                label="本地数据"
                active={activeSection === 'data'}
                onClick={() => setActiveSection('data')}
              />
            </div>
          </Sider>
          <Layout>
            <Header className="app-header">
              <div>
                <Title level={4}>AI 大模型接入研发测试台</Title>
                <Text type="secondary">模型只输出意图，设备动作由规则引擎和模拟器决定。</Text>
              </div>
              <Space>
                <Badge status={deviceState?.isOnline ? 'success' : 'default'} text="本地 API" />
                <Tag color="blue">Ant Design X</Tag>
                <Button onClick={() => void refresh()}>刷新</Button>
              </Space>
            </Header>
            <Content className="app-content">
              {activeSection === 'intent' && (
                <IntentWorkspace
                  providers={providers}
                  prompts={prompts}
                  testCases={testCases}
                  evaluations={evaluations}
                  providerOptions={providerOptions}
                  promptOptions={promptOptions}
                  selectedProviderId={selectedProviderId}
                  selectedPromptId={selectedPromptId}
                  onProviderChange={setSelectedProviderId}
                  onPromptChange={setSelectedPromptId}
                  deviceState={deviceState}
                  onDevicePatch={updateDeviceState}
                  chatMessages={chatMessages}
                  senderValue={senderValue}
                  isSending={isSending}
                  lastChatResult={lastChatResult}
                  onSenderChange={setSenderValue}
                  onSend={handleSend}
                  isEvaluating={isEvaluating}
                  onRunEvaluation={handleRunEvaluation}
                />
              )}
              {activeSection === 'safety' && <SafetyRulesPage deviceState={deviceState} />}
              {activeSection === 'providers' && (
                <ProvidersPage providers={providers} onProvidersChange={handleProvidersChange} />
              )}
              {activeSection === 'devices' && (
                <DevicesPage
                  devices={bootstrap?.devices ?? []}
                  deviceState={deviceState}
                  selectedDeviceId={selectedDeviceId}
                  onSelectedDeviceIdChange={setSelectedDeviceId}
                  onRefresh={refresh}
                  onPatchDeviceState={updateDeviceState}
                  onSendCommand={handleSendDeviceCommand}
                  onRecordEvent={handleRecordDeviceEvent}
                />
              )}
              {activeSection === 'knowledge' && (
                <KnowledgePage
                  documents={bootstrap?.knowledgeDocuments ?? []}
                  onCreateDocument={handleCreateKnowledgeDocument}
                  onQueryKnowledge={handleQueryKnowledge}
                />
              )}
              {activeSection === 'proactive' && (
                <ProactivePage
                  settings={bootstrap?.proactiveSettings}
                  logs={bootstrap?.logs ?? []}
                  onUpdateSettings={handleUpdateProactiveSettings}
                  onTriggerEvent={handleTriggerProactiveEvent}
                />
              )}
              {activeSection === 'logs' && <LogsPage logs={bootstrap?.logs ?? []} onRefresh={refresh} />}
              {activeSection === 'data' && (
                <LocalDataPage testCases={testCases} prompts={prompts} evaluations={evaluations} />
              )}
            </Content>
          </Layout>
        </Layout>
      </XProvider>
    </ConfigProvider>
  );
}

function NavItem(props: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={props.active ? 'nav-item nav-item-active' : 'nav-item'}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function ControlPanel(props: {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  providerOptions: { label: string; value: string }[];
  promptOptions: { label: string; value: string }[];
  selectedProviderId: string;
  selectedPromptId: string;
  onProviderChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  deviceState?: DeviceState;
  onDevicePatch: (patch: Partial<DeviceState>) => Promise<void>;
}) {
  const activeProvider = props.providers.find((provider) => provider.id === props.selectedProviderId);
  const activePrompt = props.prompts.find((prompt) => prompt.id === props.selectedPromptId);

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Card title="测试上下文" size="small">
        <Form layout="vertical">
          <Form.Item label="模型供应商">
            <Select
              value={props.selectedProviderId}
              options={props.providerOptions}
              onChange={props.onProviderChange}
            />
          </Form.Item>
          <Form.Item label="Prompt 版本">
            <Select value={props.selectedPromptId} options={props.promptOptions} onChange={props.onPromptChange} />
          </Form.Item>
        </Form>
        <Space wrap>
          <Tag color={activeProvider?.enabled ? 'green' : 'orange'}>
            {activeProvider?.enabled ? '已启用' : '未启用'}
          </Tag>
          <Tag>{activeProvider?.type}</Tag>
          <Tag color="blue">{activePrompt?.status}</Tag>
        </Space>
      </Card>

      <Card title="设备模拟器" size="small">
        {props.deviceState ? (
          <Space orientation="vertical" size={12} className="full-width">
            <Flex justify="space-between" align="center">
              <Text>在线状态</Text>
              <Switch
                checked={props.deviceState.isOnline}
                onChange={(isOnline) => void props.onDevicePatch({ isOnline })}
              />
            </Flex>
            <Flex justify="space-between" align="center">
              <Text>雷达有人</Text>
              <Switch
                checked={props.deviceState.hasOccupancy}
                onChange={(hasOccupancy) => void props.onDevicePatch({ hasOccupancy })}
              />
            </Flex>
            <Flex justify="space-between" align="center">
              <Text>语音播报</Text>
              <Switch
                checked={props.deviceState.voiceBroadcastEnabled}
                onChange={(voiceBroadcastEnabled) => void props.onDevicePatch({ voiceBroadcastEnabled })}
              />
            </Flex>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="目标温度">{props.deviceState.targetTemperature}℃</Descriptions.Item>
              <Descriptions.Item label="环境温度">{props.deviceState.ambientTemperature}℃</Descriptions.Item>
              <Descriptions.Item label="故障码">{props.deviceState.faultCode || '无'}</Descriptions.Item>
            </Descriptions>
            <Divider className="compact-divider" />
            <Text type="secondary">当前模式</Text>
            <Space wrap>
              {props.deviceState.activeModes.length ? (
                props.deviceState.activeModes.map((mode) => <Tag key={mode}>{mode}</Tag>)
              ) : (
                <Tag>无</Tag>
              )}
            </Space>
          </Space>
        ) : (
          <Text type="secondary">等待本地 API 数据</Text>
        )}
      </Card>
    </Space>
  );
}

function IntentWorkspace(props: {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  testCases: TestCase[];
  evaluations: EvaluationRun[];
  providerOptions: { label: string; value: string }[];
  promptOptions: { label: string; value: string }[];
  selectedProviderId: string;
  selectedPromptId: string;
  onProviderChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  deviceState?: DeviceState;
  onDevicePatch: (patch: Partial<DeviceState>) => Promise<void>;
  chatMessages: ChatMessage[];
  senderValue: string;
  isSending: boolean;
  lastChatResult: ChatTestResponse | null;
  onSenderChange: (value: string) => void;
  onSend: (value: string) => Promise<void>;
  isEvaluating: boolean;
  onRunEvaluation: () => Promise<void>;
}) {
  const latestEvaluation = props.evaluations[0];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={7}>
        <ControlPanel
          providers={props.providers}
          prompts={props.prompts}
          providerOptions={props.providerOptions}
          promptOptions={props.promptOptions}
          selectedProviderId={props.selectedProviderId}
          selectedPromptId={props.selectedPromptId}
          onProviderChange={props.onProviderChange}
          onPromptChange={props.onPromptChange}
          deviceState={props.deviceState}
          onDevicePatch={props.onDevicePatch}
        />
      </Col>
      <Col xs={24} xl={17}>
        <Tabs
          defaultActiveKey="chat"
          items={[
            {
              key: 'chat',
              label: '单句意图测试',
              children: (
                <ChatLab
                  messages={props.chatMessages}
                  senderValue={props.senderValue}
                  isSending={props.isSending}
                  lastChatResult={props.lastChatResult}
                  onSenderChange={props.onSenderChange}
                  onSend={props.onSend}
                />
              )
            },
            {
              key: 'batch',
              label: '批量评测',
              children: (
                <EvaluationLab
                  testCases={props.testCases}
                  latestEvaluation={latestEvaluation}
                  isEvaluating={props.isEvaluating}
                  onRunEvaluation={props.onRunEvaluation}
                />
              )
            },
            {
              key: 'providers',
              label: '模型配置',
              children: <ProviderTable providers={props.providers} />
            },
            {
              key: 'logs',
              label: '评测记录',
              children: <EvaluationHistory evaluations={props.evaluations} />
            }
          ]}
        />
      </Col>
    </Row>
  );
}

function SafetyRulesPage(props: { deviceState?: DeviceState }) {
  const [checked, setChecked] = useState(false);
  const state = props.deviceState;
  const rules = [
    {
      name: '设备离线禁止控制',
      level: '阻断',
      color: 'red',
      detail: '设备不在线时，所有模型控制结果都不能下发。'
    },
    {
      name: '故障状态禁止取暖',
      level: '阻断',
      color: 'red',
      detail: '检测到设备故障码时，禁止弱暖、强暖和恒温动作。'
    },
    {
      name: '强暖低置信度确认',
      level: '确认',
      color: 'orange',
      detail: '强暖意图置信度低于 85% 时，转为二次确认，不直接执行。'
    },
    {
      name: '温度范围校验',
      level: '校验',
      color: 'blue',
      detail: '目标温度必须限制在 30℃ 到 45℃。'
    },
    {
      name: '模式互斥',
      level: '约束',
      color: 'green',
      detail: '取暖、沐浴、干燥、除雾和恒温等模式不能同时生效。'
    }
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="控制边界"
        title="安全规则"
        description="所有模型输出都必须经过这里，规则引擎通过后才允许进入设备状态机。"
        extra={
          <Button type="primary" onClick={() => setChecked(true)}>
            检查当前设备
          </Button>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="已启用规则" size="small">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={rules}
              columns={[
                { title: '规则', dataIndex: 'name', width: 190 },
                { title: '等级', dataIndex: 'level', width: 90, render: (value, rule) => <Tag color={rule.color}>{value}</Tag> },
                { title: '说明', dataIndex: 'detail' },
                { title: '状态', width: 80, render: () => <Tag color="green">启用</Tag> }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="当前检查结果" size="small">
            {checked ? (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert
                  type={state?.isOnline && !state.faultCode ? 'success' : 'error'}
                  showIcon
                  title={state?.isOnline && !state.faultCode ? '当前设备可接受控制' : '当前设备存在控制阻断'}
                />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="在线状态">{state?.isOnline ? '在线' : '离线'}</Descriptions.Item>
                  <Descriptions.Item label="故障码">{state?.faultCode || '无'}</Descriptions.Item>
                  <Descriptions.Item label="有人感应">{state?.hasOccupancy ? '是' : '否'}</Descriptions.Item>
                </Descriptions>
              </Space>
            ) : (
              <Text type="secondary">点击“检查当前设备”运行一次设备前置条件检查。</Text>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function ProvidersPage(props: {
  providers: ModelProvider[];
  onProvidersChange: (providers: ModelProvider[]) => Promise<void>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [secretStatuses, setSecretStatuses] = useState<ProviderSecretStatus[]>([]);
  const [secretStatusLoading, setSecretStatusLoading] = useState(false);
  const [secretSavingId, setSecretSavingId] = useState<string | null>(null);
  const [secretClearingId, setSecretClearingId] = useState<string | null>(null);
  const [secretModalProvider, setSecretModalProvider] = useState<ModelProvider | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [secretMessage, secretMessageHolder] = message.useMessage();
  const statusByProviderId = useMemo(
    () => new Map(secretStatuses.map((status) => [status.providerId, status])),
    [secretStatuses]
  );

  useEffect(() => {
    void refreshSecretStatuses();
  }, [props.providers]);

  async function refreshSecretStatuses() {
    if (!props.providers.length) {
      setSecretStatuses([]);
      return;
    }

    setSecretStatusLoading(true);
    try {
      setSecretStatuses(await getProviderSecretStatuses());
    } catch (error) {
      secretMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSecretStatusLoading(false);
    }
  }

  async function handleEnabledChange(provider: ModelProvider, enabled: boolean) {
    setSavingId(provider.id);
    try {
      await props.onProvidersChange(
        props.providers.map((item) => (item.id === provider.id ? { ...item, enabled } : item))
      );
      if (enabled && provider.apiKeyEnv && !statusByProviderId.get(provider.id)?.isConfigured) {
        secretMessage.warning('已启用供应商，但 API Key 未配置，真实调用会失败。');
      }
    } finally {
      setSavingId(null);
    }
  }

  function openSecretModal(provider: ModelProvider) {
    setSecretModalProvider(provider);
    setApiKeyInput('');
  }

  function closeSecretModal() {
    setSecretModalProvider(null);
    setApiKeyInput('');
  }

  async function handleSaveApiKey() {
    const provider = secretModalProvider;
    const apiKey = apiKeyInput.trim();
    if (!provider) {
      return;
    }

    if (!apiKey) {
      secretMessage.warning('请先填写 API Key。');
      return;
    }

    setSecretSavingId(provider.id);
    try {
      const status = await saveProviderApiKey(provider.id, apiKey);
      setSecretStatuses((current) => upsertProviderSecretStatus(current, status));
      closeSecretModal();
      secretMessage.success('API Key 已保存到 apps/api/.env');
    } catch (error) {
      secretMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSecretSavingId(null);
    }
  }

  async function handleClearApiKey(provider: ModelProvider) {
    setSecretClearingId(provider.id);
    try {
      const status = await clearProviderApiKey(provider.id);
      setSecretStatuses((current) => upsertProviderSecretStatus(current, status));
      secretMessage.success(`${provider.apiKeyEnv} 已从 apps/api/.env 清除`);
    } catch (error) {
      secretMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSecretClearingId(null);
    }
  }

  return (
    <Space orientation="vertical" size={16} className="full-width">
      {secretMessageHolder}
      <PageIntro
        eyebrow="模型接入"
        title="模型供应商"
        description="管理本地评测可以使用的模型。API Key 可在此录入到本地 apps/api/.env，页面只展示配置状态。"
      />
      <Card size="small" title="供应商清单">
        <Table
          rowKey="id"
          dataSource={props.providers}
          pagination={false}
          loading={secretStatusLoading}
          scroll={{ x: 1120 }}
          columns={[
            { title: '供应商', dataIndex: 'name', width: 210 },
            { title: '类型', dataIndex: 'type', width: 170 },
            { title: '模型', dataIndex: 'model', width: 240 },
            { title: 'Key 环境变量', dataIndex: 'apiKeyEnv', width: 180, render: (value) => value || '无需 Key' },
            {
              title: 'API Key 状态',
              width: 130,
              render: (_, provider) => {
                if (!provider.apiKeyEnv) {
                  return <Tag>无需 Key</Tag>;
                }

                return statusByProviderId.get(provider.id)?.isConfigured ? (
                  <Tag color="green">已配置</Tag>
                ) : (
                  <Tag color="red">未配置</Tag>
                );
              }
            },
            {
              title: '启用评测',
              width: 120,
              render: (_, provider) => (
                <Switch
                  checked={provider.enabled}
                  loading={savingId === provider.id}
                  onChange={(enabled) => void handleEnabledChange(provider, enabled)}
                />
              )
            },
            { title: '备注', dataIndex: 'notes', ellipsis: true },
            {
              title: '操作',
              width: 190,
              render: (_, provider) => {
                const isConfigured = Boolean(statusByProviderId.get(provider.id)?.isConfigured);
                const canConfigure = Boolean(provider.apiKeyEnv);

                return (
                  <Space size={8}>
                    <Button
                      size="small"
                      icon={<KeyOutlined />}
                      disabled={!canConfigure}
                      onClick={() => openSecretModal(provider)}
                    >
                      配置
                    </Button>
                    <Popconfirm
                      title="清除本地 API Key"
                      description={`只会从 apps/api/.env 删除 ${provider.apiKeyEnv}。`}
                      okText="清除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleClearApiKey(provider)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!canConfigure || !isConfigured}
                        loading={secretClearingId === provider.id}
                      >
                        清除
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>
      <Alert
        type="info"
        showIcon
        title="采购配置提示"
        description="启用真实供应商前，请使用企业采购账号的 Key；模型 ID、Base URL 和价格仍由 data/model-providers.json 维护。"
      />
      <Modal
        title={secretModalProvider ? `配置 ${secretModalProvider.name} API Key` : '配置 API Key'}
        open={Boolean(secretModalProvider)}
        okText="保存到本地 .env"
        cancelText="取消"
        confirmLoading={Boolean(secretModalProvider && secretSavingId === secretModalProvider.id)}
        onOk={() => void handleSaveApiKey()}
        onCancel={closeSecretModal}
      >
        <Space orientation="vertical" size={12} className="full-width">
          <Alert
            type="warning"
            showIcon
            title="页面不会回显已保存的密钥"
            description={`保存后会写入 apps/api/.env 的 ${secretModalProvider?.apiKeyEnv || '-'}，并立即更新当前本地 API 进程。`}
          />
          <Form layout="vertical">
            <Form.Item label="API Key" required>
              <Input.Password
                value={apiKeyInput}
                placeholder="粘贴企业采购账号生成的 API Key"
                autoComplete="off"
                onChange={(event) => setApiKeyInput(event.target.value)}
                onPressEnter={() => void handleSaveApiKey()}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </Space>
  );
}

function upsertProviderSecretStatus(
  statuses: ProviderSecretStatus[],
  nextStatus: ProviderSecretStatus
): ProviderSecretStatus[] {
  const nextStatuses = statuses.filter((status) => status.providerId !== nextStatus.providerId);
  return [...nextStatuses, nextStatus];
}

const knowledgeCategoryOptions = [
  { label: '产品', value: 'PRODUCT' },
  { label: '安装', value: 'INSTALL' },
  { label: '使用', value: 'USAGE' },
  { label: '故障', value: 'TROUBLESHOOTING' },
  { label: '售后', value: 'AFTER_SALES' },
  { label: '保养', value: 'MAINTENANCE' },
  { label: '其他', value: 'OTHER' }
];

const deviceCommandOptions: Array<{ label: string; intent: DeviceIntent; slots?: Record<string, unknown> }> = [
  { label: '开灯', intent: 'LIGHT_ON' },
  { label: '关灯', intent: 'LIGHT_OFF' },
  { label: '弱暖', intent: 'HEAT_WEAK_ON' },
  { label: '强暖', intent: 'HEAT_STRONG_ON' },
  { label: '换气', intent: 'VENTILATION_ON' },
  { label: '摆风', intent: 'SWING_ON' },
  { label: '待机', intent: 'STANDBY' },
  { label: '42 度', intent: 'SET_TEMP', slots: { temperature: 42 } }
];

function DevicesPage(props: {
  devices: DeviceProfile[];
  deviceState?: DeviceState;
  selectedDeviceId: string;
  onSelectedDeviceIdChange: (id: string) => void;
  onRefresh: () => Promise<void>;
  onPatchDeviceState: (patch: Partial<DeviceState>) => Promise<void>;
  onSendCommand: (deviceId: string, input: { intent: string; slots?: Record<string, unknown> }) => Promise<void>;
  onRecordEvent: (deviceId: string, input: { type: string; payload?: Record<string, unknown> }) => Promise<void>;
}) {
  const selectedDevice = props.devices.find((device) => device.id === props.selectedDeviceId) ?? props.devices[0];
  const deviceState = props.deviceState;
  const statusColumns: ColumnsType<DeviceProfile> = [
    { title: '设备名', dataIndex: 'name', width: 160 },
    { title: '型号', dataIndex: 'model', width: 140 },
    { title: '协议', dataIndex: 'protocol', width: 110 },
    {
      title: '状态',
      width: 110,
      render: (_, device) => <Tag color={device.status === 'ONLINE' ? 'green' : device.status === 'FAULT' ? 'red' : 'default'}>{device.status}</Tag>
    },
    { title: '备注', dataIndex: 'notes', ellipsis: true }
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="设备联调"
        title="设备管理"
        description="这里先对接测试样机和模拟数据，后面真实设备接入时只替换协议层。"
        extra={<Button onClick={() => void props.onRefresh()}>刷新</Button>}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="设备清单">
            <Table
              rowKey="id"
              rowSelection={{
                type: 'radio',
                selectedRowKeys: selectedDevice ? [selectedDevice.id] : [],
                onChange: (keys) => props.onSelectedDeviceIdChange(String(keys[0] ?? ''))
              }}
              columns={statusColumns}
              dataSource={props.devices}
              pagination={false}
              locale={{ emptyText: '暂无设备' }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={selectedDevice ? `${selectedDevice.name} 状态` : '设备状态'}>
            {deviceState ? (
              <Space orientation="vertical" size={14} className="full-width">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="设备编号">{selectedDevice?.id || '-'}</Descriptions.Item>
                  <Descriptions.Item label="协议">{selectedDevice?.protocol || '-'}</Descriptions.Item>
                  <Descriptions.Item label="在线状态">{deviceState.isOnline ? '在线' : '离线'}</Descriptions.Item>
                  <Descriptions.Item label="目标温度">{deviceState.targetTemperature}℃</Descriptions.Item>
                  <Descriptions.Item label="环境温度">{deviceState.ambientTemperature}℃</Descriptions.Item>
                  <Descriptions.Item label="环境湿度">{deviceState.humidity ?? '-'}%</Descriptions.Item>
                  <Descriptions.Item label="故障码">{deviceState.faultCode || '无'}</Descriptions.Item>
                </Descriptions>
                <Space wrap>
                  <Button
                    type={deviceState.isOnline ? 'primary' : 'default'}
                    onClick={() => void props.onPatchDeviceState({ isOnline: !deviceState.isOnline })}
                  >
                    {deviceState.isOnline ? '设为离线' : '设为在线'}
                  </Button>
                  <Button onClick={() => void props.onPatchDeviceState({ hasOccupancy: !deviceState.hasOccupancy })}>
                    {deviceState.hasOccupancy ? '清除有人' : '有人进入'}
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onPatchDeviceState({
                        voiceBroadcastEnabled: !deviceState.voiceBroadcastEnabled
                      })
                    }
                  >
                    {deviceState.voiceBroadcastEnabled ? '关闭播报' : '开启播报'}
                  </Button>
                </Space>
                <Space wrap>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'LIGHT_ON' })}>
                    开灯
                  </Button>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'HEAT_WEAK_ON' })}>
                    弱暖
                  </Button>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'HEAT_STRONG_ON' })}>
                    强暖
                  </Button>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'VENTILATION_ON' })}>
                    换气
                  </Button>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'STANDBY' })}>
                    待机
                  </Button>
                  <Button onClick={() => void props.onSendCommand(selectedDevice?.id || '', { intent: 'SET_TEMP', slots: { temperature: 42 } })}>
                    42 度
                  </Button>
                </Space>
                <Divider className="compact-divider" />
                <Space wrap>
                  <Button onClick={() => void props.onRecordEvent(selectedDevice?.id || '', { type: 'OCCUPANCY', payload: { hasOccupancy: true } })}>
                    上报有人
                  </Button>
                  <Button onClick={() => void props.onRecordEvent(selectedDevice?.id || '', { type: 'OCCUPANCY', payload: { hasOccupancy: false } })}>
                    上报无人
                  </Button>
                  <Button onClick={() => void props.onRecordEvent(selectedDevice?.id || '', { type: 'RADAR', payload: { hasOccupancy: true, distance: 1.2 } })}>
                    雷达触发
                  </Button>
                  <Button onClick={() => void props.onRecordEvent(selectedDevice?.id || '', { type: 'FAULT', payload: { faultCode: 'E01' } })}>
                    模拟故障
                  </Button>
                </Space>
              </Space>
            ) : (
              <Text type="secondary">等待设备状态数据。</Text>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function KnowledgePage(props: {
  documents: KnowledgeDocument[];
  onCreateDocument: (input: {
    title: string;
    category: string;
    content: string;
    tags: string[];
    status?: 'DRAFT' | 'PUBLISHED';
  }) => Promise<void>;
  onQueryKnowledge: (input: {
    question: string;
    category?: string;
    limit?: number;
  }) => Promise<KnowledgeQueryResponse>;
}) {
  const [docForm] = Form.useForm();
  const [queryForm] = Form.useForm();
  const [queryResult, setQueryResult] = useState<KnowledgeQueryResponse | null>(null);
  const [querying, setQuerying] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleCreate(values: Record<string, unknown>) {
    setSaving(true);
    try {
      await props.onCreateDocument({
        title: String(values.title || ''),
        category: String(values.category || 'OTHER'),
        content: String(values.content || ''),
        tags: String(values.tags || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        status: (values.status as 'DRAFT' | 'PUBLISHED') || 'PUBLISHED'
      });
      docForm.resetFields();
    } finally {
      setSaving(false);
    }
  }

  async function handleQuery(values: Record<string, unknown>) {
    setQuerying(true);
    try {
      const result = await props.onQueryKnowledge({
        question: String(values.question || ''),
        category: values.category ? String(values.category) : undefined,
        limit: values.limit ? Number(values.limit) : 3
      });
      setQueryResult(result);
    } finally {
      setQuerying(false);
    }
  }

  const documentColumns: ColumnsType<KnowledgeDocument> = [
    { title: '标题', dataIndex: 'title', width: 220 },
    { title: '分类', dataIndex: 'category', width: 150 },
    { title: '状态', dataIndex: 'status', width: 120, render: (value) => <Tag color={value === 'PUBLISHED' ? 'green' : 'default'}>{value}</Tag> },
    { title: '标签', dataIndex: 'tags', render: (value: string[]) => value.join(', ') || '-' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 220 }
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="售后资料"
        title="知识库"
        description="先把东信现有产品资料整理成可检索资料，后面再换成更完整的 RAG。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={13}>
          <Card size="small" title="资料清单">
            <Table rowKey="id" columns={documentColumns} dataSource={props.documents} pagination={{ pageSize: 8 }} />
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          <Space orientation="vertical" size={16} className="full-width">
            <Card size="small" title="新增资料">
              <Form form={docForm} layout="vertical" onFinish={(values) => void handleCreate(values)}>
                <Form.Item name="title" label="标题" rules={[{ required: true }]}>
                  <Input placeholder="例如：常见故障排查" />
                </Form.Item>
                <Form.Item name="category" label="分类" initialValue="OTHER" rules={[{ required: true }]}>
                  <Select options={knowledgeCategoryOptions} />
                </Form.Item>
                <Form.Item name="tags" label="标签">
                  <Input placeholder="多个标签用英文逗号分隔" />
                </Form.Item>
                <Form.Item name="content" label="内容" rules={[{ required: true }]}>
                  <Input.TextArea rows={5} />
                </Form.Item>
                <Form.Item name="status" label="状态" initialValue="PUBLISHED">
                  <Select
                    options={[
                      { label: '发布', value: 'PUBLISHED' },
                      { label: '草稿', value: 'DRAFT' }
                    ]}
                  />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={saving}>
                  保存资料
                </Button>
              </Form>
            </Card>
            <Card size="small" title="知识问答">
              <Form form={queryForm} layout="vertical" onFinish={(values) => void handleQuery(values)}>
                <Form.Item name="question" label="问题" rules={[{ required: true }]}>
                  <Input.TextArea rows={3} placeholder="例如：浴霸有故障码怎么处理" />
                </Form.Item>
                <Form.Item name="category" label="分类筛选">
                  <Select allowClear options={knowledgeCategoryOptions} />
                </Form.Item>
                <Form.Item name="limit" label="返回条数" initialValue={3}>
                  <InputNumber min={1} max={10} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={querying}>
                  查询
                </Button>
              </Form>
              <Divider className="compact-divider" />
              {queryResult ? (
                <Space orientation="vertical" size={12} className="full-width">
                  <Alert type={queryResult.usedFallback ? 'warning' : 'success'} showIcon title={queryResult.answer} />
                  <Space wrap>
                    {queryResult.hits.map((hit) => (
                      <Tag key={hit.documentId} color="blue">
                        {hit.title}
                      </Tag>
                    ))}
                  </Space>
                </Space>
              ) : (
                <Text type="secondary">提交一个问题后在这里显示答案。</Text>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}

function ProactivePage(props: {
  settings?: ProactiveSettings;
  logs: SystemLog[];
  onUpdateSettings: (input: Partial<ProactiveSettings>) => Promise<void>;
  onTriggerEvent: (input: {
    deviceId?: string;
    eventType: 'OCCUPANCY_ENTER' | 'OCCUPANCY_LEAVE' | 'LOW_TEMPERATURE' | 'HIGH_HUMIDITY' | 'LONG_RUNNING';
    ambientTemperature?: number | null;
    humidity?: number | null;
    hasOccupancy?: boolean | null;
    occurredAt?: string;
  }) => Promise<ProactiveDecision>;
}) {
  const [form] = Form.useForm();
  const [triggering, setTriggering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastDecision, setLastDecision] = useState<ProactiveDecision | null>(null);

  useEffect(() => {
    if (props.settings) {
      form.setFieldsValue(props.settings);
    }
  }, [form, props.settings]);

  async function handleSave(values: Record<string, unknown>) {
    setSaving(true);
    try {
      await props.onUpdateSettings(values as Partial<ProactiveSettings>);
    } finally {
      setSaving(false);
    }
  }

  async function handleTrigger(eventType: 'OCCUPANCY_ENTER' | 'OCCUPANCY_LEAVE' | 'LOW_TEMPERATURE' | 'HIGH_HUMIDITY' | 'LONG_RUNNING') {
    setTriggering(true);
    try {
      const decision = await props.onTriggerEvent({
        eventType,
        deviceId: 'demo-bath-heater-001',
        ambientTemperature: 24,
        humidity: 68,
        hasOccupancy: eventType !== 'OCCUPANCY_LEAVE',
        occurredAt: new Date().toISOString()
      });
      setLastDecision(decision);
    } finally {
      setTriggering(false);
    }
  }

  const proactiveLogs = props.logs.filter((log) => log.type === 'PROACTIVE');

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="主动交互"
        title="主动沟通"
        description="先把触发、话术、频率和安静时段放在后台，后面再接真实雷达事件。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="设置">
            <Form form={form} layout="vertical" onFinish={(values) => void handleSave(values)}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="mode" label="模式" initialValue="PRACTICAL">
                <Select
                  options={[
                    { label: '实用提醒', value: 'PRACTICAL' },
                    { label: '轻松模式', value: 'RELAXED' },
                    { label: '安静模式', value: 'QUIET' }
                  ]}
                />
              </Form.Item>
              <Form.Item name="minIntervalMinutes" label="最小间隔" initialValue={10}>
                <InputNumber min={1} max={120} />
              </Form.Item>
              <Form.Item label="安静时段">
                <Space.Compact block>
                  <Form.Item name={['quietHours', 'enabled']} valuePropName="checked" noStyle>
                    <Switch />
                  </Form.Item>
                  <Form.Item name={['quietHours', 'start']} noStyle initialValue="22:00">
                    <Input style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item name={['quietHours', 'end']} noStyle initialValue="07:00">
                    <Input style={{ width: 120 }} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存设置
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="触发测试">
            <Space wrap>
              <Button loading={triggering} onClick={() => void handleTrigger('OCCUPANCY_ENTER')}>
                人感进入
              </Button>
              <Button loading={triggering} onClick={() => void handleTrigger('LOW_TEMPERATURE')}>
                温度偏低
              </Button>
              <Button loading={triggering} onClick={() => void handleTrigger('HIGH_HUMIDITY')}>
                湿度偏高
              </Button>
              <Button loading={triggering} onClick={() => void handleTrigger('LONG_RUNNING')}>
                长时间运行
              </Button>
            </Space>
            <Divider className="compact-divider" />
            {lastDecision ? (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert type={lastDecision.shouldSpeak ? 'success' : 'info'} showIcon title={lastDecision.reason} />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="播报">{lastDecision.shouldSpeak ? lastDecision.speak : '无'}</Descriptions.Item>
                  <Descriptions.Item label="建议动作">{lastDecision.suggestedIntent || '无'}</Descriptions.Item>
                  <Descriptions.Item label="需确认">{lastDecision.requiresConfirm ? '是' : '否'}</Descriptions.Item>
                </Descriptions>
              </Space>
            ) : (
              <Text type="secondary">点击按钮模拟一次主动沟通触发。</Text>
            )}
          </Card>
        </Col>
      </Row>
      <Card size="small" title="最近日志">
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 5 }}
          dataSource={proactiveLogs}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 220 },
            { title: '摘要', dataIndex: 'summary' },
            { title: '内容', width: 180, render: (_, log) => log.payload?.eventType || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}

function LogsPage(props: { logs: SystemLog[]; onRefresh: () => Promise<void> }) {
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const filteredLogs = typeFilter === 'ALL' ? props.logs : props.logs.filter((log) => log.type === typeFilter);

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="运行痕迹"
        title="日志"
        description="把 AI、设备、知识库和主动沟通的记录放到一起，便于现场回看。"
        extra={<Button onClick={() => void props.onRefresh()}>刷新</Button>}
      />
      <Card size="small" title="日志列表">
        <Space style={{ marginBottom: 12 }}>
          <Select
            value={typeFilter}
            style={{ width: 180 }}
            onChange={setTypeFilter}
            options={[
              { label: '全部', value: 'ALL' },
              { label: '语音', value: 'VOICE' },
              { label: 'AI', value: 'AI' },
              { label: '设备', value: 'DEVICE' },
              { label: '命令', value: 'COMMAND' },
              { label: '知识库', value: 'KNOWLEDGE' },
              { label: '主动沟通', value: 'PROACTIVE' },
              { label: '错误', value: 'ERROR' }
            ]}
          />
        </Space>
        <Table
          rowKey="id"
          size="small"
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 220 },
            { title: '类型', dataIndex: 'type', width: 120, render: (value) => <Tag>{value}</Tag> },
            { title: '摘要', dataIndex: 'summary', width: 260 },
            {
              title: 'payload',
              render: (_, log) => (
                <pre className="json-panel" style={{ maxWidth: 420, margin: 0 }}>
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              )
            }
          ]}
          dataSource={filteredLogs}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: '暂无日志' }}
        />
      </Card>
    </Space>
  );
}

function LocalDataPage(props: {
  testCases: TestCase[];
  prompts: PromptVersion[];
  evaluations: EvaluationRun[];
}) {
  const testCaseColumns: ColumnsType<TestCase> = [
    { title: '类别', dataIndex: 'category', width: 140 },
    { title: '测试输入', dataIndex: 'inputText', ellipsis: true },
    { title: '期望意图', dataIndex: 'expectedIntent', width: 180, render: (value) => value || '无设备动作' },
    { title: '风险', dataIndex: 'riskLevel', width: 100 },
    { title: '备注', dataIndex: 'notes', ellipsis: true }
  ];

  const promptColumns: ColumnsType<PromptVersion> = [
    { title: '名称', dataIndex: 'name', width: 240 },
    { title: '版本', dataIndex: 'version', width: 90, render: (value) => `v${value}` },
    { title: '状态', dataIndex: 'status', width: 110, render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 220 }
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="JSON 文件存储"
        title="本地数据"
        description="这里展示当前项目 data 目录中的测试集、Prompt 版本和评测记录，修改文件后点击顶部刷新即可重新载入。"
      />
      <Tabs
        items={[
          {
            key: 'test-cases',
            label: `测试集（${props.testCases.length}）`,
            children: (
              <Card size="small" title="意图测试语料">
                <Table rowKey="id" columns={testCaseColumns} dataSource={props.testCases} pagination={{ pageSize: 10 }} />
              </Card>
            )
          },
          {
            key: 'prompts',
            label: `Prompt（${props.prompts.length}）`,
            children: (
              <Space orientation="vertical" size={12} className="full-width">
                <Card size="small" title="Prompt 版本">
                  <Table rowKey="id" columns={promptColumns} dataSource={props.prompts} pagination={false} />
                </Card>
                {props.prompts.map((prompt) => (
                  <Card key={prompt.id} size="small" title={`${prompt.name} v${prompt.version}`}>
                    <pre className="prompt-panel">{prompt.systemPrompt}</pre>
                  </Card>
                ))}
              </Space>
            )
          },
          {
            key: 'evaluations',
            label: `评测记录（${props.evaluations.length}）`,
            children: <EvaluationHistory evaluations={props.evaluations} />
          }
        ]}
      />
    </Space>
  );
}

function PageIntro(props: {
  eyebrow: string;
  title: string;
  description: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <Text className="page-eyebrow">{props.eyebrow}</Text>
        <Title level={3}>{props.title}</Title>
        <Text type="secondary">{props.description}</Text>
      </div>
      {props.extra}
    </div>
  );
}

function ChatLab(props: {
  messages: ChatMessage[];
  senderValue: string;
  isSending: boolean;
  lastChatResult: ChatTestResponse | null;
  onSenderChange: (value: string) => void;
  onSend: (value: string) => Promise<void>;
}) {
  const bubbleItems = useMemo(
    () =>
      props.messages.map((item) => ({
        key: item.id,
        role: item.role === 'user' ? 'user' : 'ai',
        content: item.content
      })),
    [props.messages]
  );

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={15}>
        <Card className="lab-card" title="对话式单句测试">
          <div className="bubble-panel">
            <Bubble.List
              items={bubbleItems}
              role={{
                ai: {
                  placement: 'start',
                  avatar: <ApiOutlined />
                },
                user: {
                  placement: 'end'
                }
              }}
            />
          </div>
          <Sender
            value={props.senderValue}
            onChange={props.onSenderChange}
            onSubmit={(value) => void props.onSend(value)}
            loading={props.isSending}
            placeholder="输入测试语句，例如：浴室空气不好"
          />
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <ResultPanel result={props.lastChatResult} />
      </Col>
    </Row>
  );
}

function ResultPanel(props: { result: ChatTestResponse | null }) {
  const result = props.result;

  return (
    <Card className="lab-card" title="结构化结果">
      {result ? (
        <Space orientation="vertical" size={12} className="full-width">
          <MetricRow label="模型意图" value={result.aiResult.intent || result.aiResult.resultType} />
          <MetricRow label="置信度" value={`${Math.round(result.aiResult.confidence * 100)}%`} />
          <MetricRow label="安全决策" value={result.safetyResult.decision} />
          <MetricRow label="响应延迟" value={`${result.latencyMs}ms`} />
          <Alert type="info" title={result.safetyResult.reason} showIcon />
          <pre className="json-panel">{JSON.stringify(result.aiResult, null, 2)}</pre>
        </Space>
      ) : (
        <Text type="secondary">运行一次单句测试后显示模型 JSON 和规则结果。</Text>
      )}
    </Card>
  );
}

function EvaluationLab(props: {
  testCases: TestCase[];
  latestEvaluation?: EvaluationRun;
  isEvaluating: boolean;
  onRunEvaluation: () => Promise<void>;
}) {
  const passRate = props.latestEvaluation?.summary.total
    ? Math.round((props.latestEvaluation.summary.passed / props.latestEvaluation.summary.total) * 100)
    : 0;

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="测试语料" value={props.testCases.length} prefix={<ExperimentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="最近通过率" value={passRate} suffix="%" prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title="平均延迟" value={props.latestEvaluation?.summary.averageLatencyMs || 0} suffix="ms" />
          </Card>
        </Col>
      </Row>
      <Card
        title="批量评测"
        extra={
          <Button type="primary" icon={<ThunderboltOutlined />} loading={props.isEvaluating} onClick={() => void props.onRunEvaluation()}>
            运行当前模型
          </Button>
        }
      >
        {props.latestEvaluation ? (
          <Space orientation="vertical" size={16} className="full-width">
            <Progress percent={passRate} status={passRate >= 95 ? 'success' : 'active'} />
            <EvaluationItemsTable run={props.latestEvaluation} />
          </Space>
        ) : (
          <Alert type="info" showIcon title="还没有评测记录，先运行一次当前模型。" />
        )}
      </Card>
    </Space>
  );
}

function EvaluationItemsTable(props: { run: EvaluationRun }) {
  const columns: ColumnsType<EvaluationRun['items'][number]> = [
    { title: '输入', dataIndex: 'inputText', ellipsis: true },
    { title: '期望', dataIndex: 'expectedIntent', width: 150 },
    {
      title: '模型输出',
      width: 150,
      render: (_, item) => item.aiResult?.intent || item.aiResult?.resultType || '-'
    },
    {
      title: '规则',
      width: 150,
      render: (_, item) => item.safetyResult?.decision || '-'
    },
    {
      title: '结果',
      width: 96,
      render: (_, item) => <Tag color={item.isMatch ? 'green' : 'red'}>{item.isMatch ? '通过' : '失败'}</Tag>
    }
  ];

  return <Table rowKey={(item) => `${item.providerId}-${item.testCaseId}`} columns={columns} dataSource={props.run.items} pagination={{ pageSize: 6 }} />;
}

function ProviderTable(props: { providers: ModelProvider[] }) {
  const columns: ColumnsType<ModelProvider> = [
    { title: '供应商', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', width: 170 },
    {
      title: '状态',
      width: 100,
      render: (_, provider) => <Tag color={provider.enabled ? 'green' : 'orange'}>{provider.enabled ? '启用' : '待配置'}</Tag>
    },
    { title: '模型', dataIndex: 'model' },
    { title: 'Key 环境变量', dataIndex: 'apiKeyEnv', width: 160, render: (value) => value || '-' },
    { title: '说明', dataIndex: 'notes', ellipsis: true }
  ];

  return (
    <Card title="模型供应商配置">
      <Alert
        type="warning"
        showIcon
        title="真实 API Key 只放在 apps/api/.env；页面只展示环境变量名，不展示密钥。"
      />
      <Table className="spaced-table" rowKey="id" columns={columns} dataSource={props.providers} pagination={false} />
    </Card>
  );
}

function EvaluationHistory(props: { evaluations: EvaluationRun[] }) {
  const columns: ColumnsType<EvaluationRun> = [
    { title: '完成时间', dataIndex: 'completedAt', width: 230 },
    { title: 'Prompt', dataIndex: 'promptId', width: 220 },
    { title: '模型', dataIndex: 'providerIds', width: 180, render: (value: string[]) => value.join(', ') },
    {
      title: '结果',
      width: 120,
      render: (_, run) => (
        <Tag color={run.summary.failed === 0 ? 'green' : 'red'}>
          {run.summary.passed}/{run.summary.total}
        </Tag>
      )
    },
    { title: '平均延迟', width: 110, render: (_, run) => `${run.summary.averageLatencyMs}ms` }
  ];

  return (
    <Card title="最近评测记录">
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={props.evaluations}
        pagination={{ pageSize: 8 }}
        locale={{ emptyText: '暂无评测记录' }}
        scroll={{ x: 760 }}
      />
    </Card>
  );
}

function MetricRow(props: { label: string; value: React.ReactNode }) {
  return (
    <Flex justify="space-between" gap={12}>
      <Text type="secondary">{props.label}</Text>
      <Text strong>{props.value}</Text>
    </Flex>
  );
}

export default App;
