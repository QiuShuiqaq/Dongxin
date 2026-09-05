import {
  ApiOutlined,
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  CalculatorOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  LinkOutlined,
  KeyOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Bubble, Sender, XProvider } from "@ant-design/x";
import type {
  AiResult,
  DeviceAction,
  DeviceAccessEventType,
  DeviceCloudState,
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
  AsrOfflinePlan,
  ProductionCostSettings,
  ProviderSecretStatus,
  SystemLog,
  TestCase,
  TestSetSummary,
} from "@dongxin/shared";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
  Slider,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import {
  clearProviderApiKey,
  createKnowledgeDocument,
  getBootstrap,
  getDevices,
  getDeviceAccessConfig,
  getKnowledgeDocuments,
  getLogs,
  getProviderSecretStatuses,
  getProactiveSettings,
  heartbeatDeviceAccess,
  pollDeviceAccessCommands,
  queryKnowledge,
  patchDeviceState,
  recordDeviceEvent,
  recordDeviceAccessEvent,
  registerDeviceAccess,
  reportDeviceAccessCommandResult,
  reportDeviceAccessState,
  runProactiveEvent,
  runChatTest,
  runDeviceAccessVoiceTurn,
  runEvaluation,
  sendDeviceCommand,
  updateProactiveSettings,
  saveProviderApiKey,
  updateProductionCostSettings,
  updateProviders,
} from "./api";
import type {
  BootstrapData,
  ChatTestResponse,
  DeviceAccessPollCommand,
  DeviceAccessVoiceTurnResponse,
} from "./api";
import { VoicePipelinePage } from "./VoicePipelinePage";

const { Header, Content, Sider } = Layout;
const { Text, Title } = Typography;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type AppSection =
  | "dashboard"
  | "intent"
  | "safety"
  | "providers"
  | "devices"
  | "access"
  | "knowledge"
  | "proactive"
  | "costs"
  | "estimates"
  | "logs";

const sectionMeta: Record<AppSection, { title: string; description: string }> =
  {
    dashboard: {
      title: "工作台",
      description: "查看 AI 接入、模型评测、设备联调和生产运维的关键状态。",
    },
    intent: {
      title: "意图测试",
      description:
        "用于研发阶段验证自然语言理解、批量评测、测试成本和模型表现。",
    },
    providers: {
      title: "模型供应商",
      description: "管理国内模型供应商、模型 ID、API Key、价格和启用状态。",
    },
    access: {
      title: "设备接入",
      description:
        "对接 WiFi 模块和样机，验证状态上报、语音请求和控制指令链路。",
    },
    devices: {
      title: "设备管理",
      description: "维护样机和设备状态，执行控制命令并查看设备事件。",
    },
    knowledge: {
      title: "知识库",
      description: "维护产品资料、售后 FAQ、故障排查和知识问答内容。",
    },
    proactive: {
      title: "主动沟通",
      description: "配置人感、温湿度等触发场景下的主动提醒策略。",
    },
    safety: {
      title: "安全规则",
      description: "统一校验模型输出，确保设备控制经过规则引擎后再执行。",
    },
    costs: {
      title: "费用中心",
      description: "查看研发预算、生产费用、ASR 方案和参数配置。",
    },
    estimates: {
      title: "费用估算",
      description: "按设备规模、使用频次和服务年限快速生成甲方汇报口径。",
    },
    logs: {
      title: "日志",
      description: "集中查看 AI、设备、知识库、主动沟通和错误日志。",
    },
  };

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState(
    "bath-heater-intent-v1",
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    "demo-bath-heater-001",
  );
  const [senderValue, setSenderValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [lastChatResult, setLastChatResult] = useState<ChatTestResponse | null>(
    null,
  );
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "输入浴霸语音测试句，例如：有点冷、浴室空气不好、温度调到 42 度。",
    },
  ]);
  const [apiMessage, messageHolder] = message.useMessage();

  useEffect(() => {
    void refresh();
  }, []);

  const providers = bootstrap?.providers ?? [];
  const prompts = bootstrap?.prompts ?? [];
  const testCases = bootstrap?.testCases ?? [];
  const testSets = bootstrap?.testSets ?? [];
  const evaluations = bootstrap?.evaluations ?? [];
  const deviceState = bootstrap?.deviceState;
  const latestEvaluation = evaluations[0];
  const activeMeta = sectionMeta[activeSection];

  const llmProviders = providers.filter(
    (provider) => provider.serviceType === "LLM",
  );
  const promptOptions = prompts.map((prompt) => ({
    label: `${prompt.name} v${prompt.version}`,
    value: prompt.id,
  }));

  async function refresh() {
    try {
      const data = await getBootstrap();
      setBootstrap(data);
      const preferredProviderId =
        data.providers.find(
          (provider) =>
            provider.enabled &&
            provider.serviceType === "LLM" &&
            provider.type === "OPENAI_COMPATIBLE",
        )?.id ||
        data.providers.find((provider) => provider.serviceType === "LLM")?.id ||
        "";
      if (
        !data.providers.some(
          (provider) =>
            provider.serviceType === "LLM" &&
            provider.id === selectedProviderId,
        )
      ) {
        setSelectedProviderId(preferredProviderId);
      }
      if (!data.prompts.some((prompt) => prompt.id === selectedPromptId)) {
        setSelectedPromptId(data.prompts[0]?.id || "");
      }
      if (!data.devices.some((device) => device.id === selectedDeviceId)) {
        setSelectedDeviceId(data.devices[0]?.id || "");
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

    setSenderValue("");
    setIsSending(true);
    setChatMessages((messages) => [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: inputText },
    ]);

    try {
      const result = await runChatTest({
        providerId: selectedProviderId,
        promptId: selectedPromptId,
        inputText,
        applyToDevice: true,
      });
      setLastChatResult(result);
      setBootstrap((current) =>
        current ? { ...current, deviceState: result.deviceState } : current,
      );
      setChatMessages((messages) => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${result.safetyResult.speak}\n\n意图：${result.aiResult.intent || result.aiResult.resultType}；规则：${result.safetyResult.decision}；延迟：${result.latencyMs}ms`,
        },
      ]);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  }

  async function handleRunEvaluation(input?: {
    providerIds?: string[];
    testSetId?: string;
    promptId?: string;
    testCaseIds?: string[];
  }): Promise<EvaluationRun> {
    setIsEvaluating(true);
    try {
      const run = await runEvaluation({
        providerIds: input?.providerIds?.length
          ? input.providerIds
          : [selectedProviderId],
        testSetId: input?.testSetId,
        promptId: input?.promptId || selectedPromptId,
        testCaseIds: input?.testCaseIds,
      });
      apiMessage.success(
        `评测完成：${run.summary.passed}/${run.summary.total}`,
      );
      await refresh();
      return run;
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsEvaluating(false);
    }
  }

  async function updateDeviceState(patch: Partial<DeviceState>) {
    try {
      const nextState = await patchDeviceState(patch);
      setBootstrap((current) =>
        current ? { ...current, deviceState: nextState } : current,
      );
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleProvidersChange(nextProviders: ModelProvider[]) {
    try {
      const savedProviders = await updateProviders(nextProviders);
      setBootstrap((current) =>
        current ? { ...current, providers: savedProviders } : current,
      );
      apiMessage.success("模型供应商配置已保存");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSendDeviceCommand(
    deviceId: string,
    input: { intent: string; slots?: Record<string, unknown> },
  ) {
    try {
      const result = await sendDeviceCommand(deviceId, input);
      setBootstrap((current) =>
        current ? { ...current, deviceState: result.state } : current,
      );
      await refresh();
      apiMessage.success("设备指令已执行");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRecordDeviceEvent(
    deviceId: string,
    input: { type: string; payload?: Record<string, unknown> },
  ) {
    try {
      await recordDeviceEvent(deviceId, input);
      await refresh();
      apiMessage.success("设备事件已上报");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateKnowledgeDocument(input: {
    title: string;
    category: string;
    content: string;
    tags: string[];
    status?: "DRAFT" | "PUBLISHED";
  }) {
    try {
      await createKnowledgeDocument(input);
      await refresh();
      apiMessage.success("知识库资料已保存");
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

  async function handleUpdateProactiveSettings(
    input: Partial<NonNullable<BootstrapData["proactiveSettings"]>>,
  ) {
    try {
      const settings = await updateProactiveSettings(input);
      setBootstrap((current) =>
        current ? { ...current, proactiveSettings: settings } : current,
      );
      await refresh();
      apiMessage.success("主动沟通设置已更新");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTriggerProactiveEvent(input: {
    deviceId?: string;
    eventType:
      | "OCCUPANCY_ENTER"
      | "OCCUPANCY_LEAVE"
      | "LOW_TEMPERATURE"
      | "HIGH_HUMIDITY"
      | "LONG_RUNNING";
    ambientTemperature?: number | null;
    humidity?: number | null;
    hasOccupancy?: boolean | null;
    occurredAt?: string;
  }) {
    try {
      const decision = await runProactiveEvent(input);
      await refresh();
      apiMessage.success("主动沟通事件已触发");
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
          colorPrimary: "#1677ff",
          colorSuccess: "#2f9e44",
          colorWarning: "#d48806",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
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
                  AI 生产运维系统
                </Text>
              </div>
            </div>
            <div className="nav-stack">
              <NavGroup label="总览">
                <NavItem
                  icon={<AppstoreOutlined />}
                  label="工作台"
                  active={activeSection === "dashboard"}
                  onClick={() => setActiveSection("dashboard")}
                />
              </NavGroup>
              <NavGroup label="AI研发">
                <NavItem
                  icon={<ExperimentOutlined />}
                  label="意图测试"
                  active={activeSection === "intent"}
                  onClick={() => setActiveSection("intent")}
                />
                <NavItem
                  icon={<CloudServerOutlined />}
                  label="模型供应商"
                  active={activeSection === "providers"}
                  onClick={() => setActiveSection("providers")}
                />
                <NavItem
                  icon={<BookOutlined />}
                  label="知识库"
                  active={activeSection === "knowledge"}
                  onClick={() => setActiveSection("knowledge")}
                />
                <NavItem
                  icon={<BellOutlined />}
                  label="主动沟通"
                  active={activeSection === "proactive"}
                  onClick={() => setActiveSection("proactive")}
                />
                <NavItem
                  icon={<SafetyCertificateOutlined />}
                  label="安全规则"
                  active={activeSection === "safety"}
                  onClick={() => setActiveSection("safety")}
                />
              </NavGroup>
              <NavGroup label="设备联调">
                <NavItem
                  icon={<ApiOutlined />}
                  label="设备接入"
                  active={activeSection === "access"}
                  onClick={() => setActiveSection("access")}
                />
                <NavItem
                  icon={<DatabaseOutlined />}
                  label="设备管理"
                  active={activeSection === "devices"}
                  onClick={() => setActiveSection("devices")}
                />
              </NavGroup>
              <NavGroup label="生产运维">
                <NavItem
                  icon={<CalculatorOutlined />}
                  label="费用估算"
                  active={activeSection === "estimates"}
                  onClick={() => setActiveSection("estimates")}
                />
                <NavItem
                  icon={<ThunderboltOutlined />}
                  label="费用中心"
                  active={activeSection === "costs"}
                  onClick={() => setActiveSection("costs")}
                />
                <NavItem
                  icon={<HistoryOutlined />}
                  label="日志"
                  active={activeSection === "logs"}
                  onClick={() => setActiveSection("logs")}
                />
              </NavGroup>
            </div>
          </Sider>
          <Layout>
            <Header className="app-header">
              <div>
                <Text className="page-eyebrow">东信智能浴霸 AI</Text>
                <Title level={4}>{activeMeta.title}</Title>
                <Text type="secondary">{activeMeta.description}</Text>
              </div>
              <Space>
                <Badge
                  status={deviceState?.isOnline ? "success" : "default"}
                  text={deviceState?.isOnline ? "设备在线" : "设备离线"}
                />
                <Tag>
                  {providers.filter((provider) => provider.enabled).length}{" "}
                  个模型启用
                </Tag>
                <Button onClick={() => void refresh()}>刷新</Button>
              </Space>
            </Header>
            <Content className="app-content">
              {activeSection === "dashboard" && (
                <DashboardPage
                  providers={providers}
                  prompts={prompts}
                  testSets={testSets}
                  evaluations={evaluations}
                  logs={bootstrap?.logs ?? []}
                  devices={bootstrap?.devices ?? []}
                  deviceState={deviceState}
                  onNavigate={setActiveSection}
                />
              )}
              {activeSection === "intent" && (
                <IntentWorkspace
                  providers={providers}
                  llmProviders={llmProviders}
                  prompts={prompts}
                  testCases={testCases}
                  testSets={testSets}
                  evaluations={evaluations}
                  devices={bootstrap?.devices ?? []}
                  providerOptions={llmProviders.map((provider) => ({
                    label: provider.name,
                    value: provider.id,
                  }))}
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
                  onRefresh={refresh}
                />
              )}
              {activeSection === "safety" && (
                <SafetyRulesPage deviceState={deviceState} />
              )}
              {activeSection === "providers" && (
                <ProvidersPage
                  providers={providers}
                  onProvidersChange={handleProvidersChange}
                />
              )}
              {activeSection === "devices" && (
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
              {activeSection === "access" && (
                <DeviceAccessPage
                  selectedDeviceId={selectedDeviceId}
                  onSelectedDeviceIdChange={setSelectedDeviceId}
                  onRefresh={refresh}
                />
              )}
              {activeSection === "knowledge" && (
                <KnowledgePage
                  documents={bootstrap?.knowledgeDocuments ?? []}
                  onCreateDocument={handleCreateKnowledgeDocument}
                  onQueryKnowledge={handleQueryKnowledge}
                />
              )}
              {activeSection === "proactive" && (
                <ProactivePage
                  settings={bootstrap?.proactiveSettings}
                  logs={bootstrap?.logs ?? []}
                  onUpdateSettings={handleUpdateProactiveSettings}
                  onTriggerEvent={handleTriggerProactiveEvent}
                />
              )}
              {activeSection === "costs" && bootstrap && (
                <CostCenterPage
                  logs={bootstrap.logs}
                  providers={providers}
                  settings={bootstrap.productionCostSettings}
                  onSave={async (settings) => {
                    await updateProductionCostSettings(settings);
                    await refresh();
                    apiMessage.success("费用参数已保存");
                  }}
                  onRefresh={refresh}
                />
              )}
              {activeSection === "estimates" && bootstrap && (
                <CostEstimatePage settings={bootstrap.productionCostSettings} />
              )}
              {activeSection === "logs" && (
                <LogsPage logs={bootstrap?.logs ?? []} onRefresh={refresh} />
              )}
            </Content>
          </Layout>
        </Layout>
      </XProvider>
    </ConfigProvider>
  );
}

function NavItem(props: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.active ? "nav-item nav-item-active" : "nav-item"}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function NavGroup(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="nav-section">
      <div className="nav-section-label">{props.label}</div>
      <div className="nav-group">{props.children}</div>
    </div>
  );
}

function DashboardPage(props: {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  testSets: TestSetSummary[];
  evaluations: EvaluationRun[];
  devices: DeviceProfile[];
  logs: SystemLog[];
  deviceState?: DeviceState;
  onNavigate: (section: AppSection) => void;
}) {
  const latestEvaluation = props.evaluations[0];
  const enabledProviders = props.providers.filter(
    (provider) => provider.enabled,
  );
  const runtimeLogs = props.logs.filter(
    (log) => readString(log.payload.billingSource) === "RUNTIME",
  );
  const evaluationCalls = props.evaluations.reduce(
    (sum, run) => sum + run.summary.total,
    0,
  );
  const evaluationCost = props.evaluations.reduce(
    (sum, run) => sum + run.summary.costCny,
    0,
  );
  const runtimeLlmCalls = runtimeLogs.filter(
    (log) => readString(log.payload.requestType) === "LLM",
  ).length;
  const errorLogs = props.logs.filter((log) => log.type === "ERROR");
  const activePrompt = props.prompts.find(
    (prompt) => prompt.status === "ACTIVE",
  );

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="启用模型"
            value={enabledProviders.length}
            suffix={` / ${props.providers.length}`}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="测试调用" value={evaluationCalls} suffix="次" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="测试费用" value={`￥${evaluationCost.toFixed(4)}`} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="生产 LLM" value={runtimeLlmCalls} suffix="次" />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card size="small" title="常用入口">
            <div className="dashboard-actions">
              <button
                type="button"
                className="dashboard-action"
                onClick={() => props.onNavigate("intent")}
              >
                <ExperimentOutlined />
                <span>
                  <strong>意图测试</strong>
                  <Text type="secondary">
                    测试集、批量评测、结果对比、测试费用
                  </Text>
                </span>
              </button>
              <button
                type="button"
                className="dashboard-action"
                onClick={() => props.onNavigate("providers")}
              >
                <CloudServerOutlined />
                <span>
                  <strong>模型供应商</strong>
                  <Text type="secondary">API Key、模型价格和启用状态</Text>
                </span>
              </button>
              <button
                type="button"
                className="dashboard-action"
                onClick={() => props.onNavigate("access")}
              >
                <ApiOutlined />
                <span>
                  <strong>设备接入</strong>
                  <Text type="secondary">WiFi 模块、语音链路和指令联调</Text>
                </span>
              </button>
              <button
                type="button"
                className="dashboard-action"
                onClick={() => props.onNavigate("costs")}
              >
                <ThunderboltOutlined />
                <span>
                  <strong>费用中心</strong>
                  <Text type="secondary">研发预算、生产费用和成本测算</Text>
                </span>
              </button>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title="当前状态">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="设备">
                {props.deviceState?.isOnline ? "在线" : "离线"}
              </Descriptions.Item>
              <Descriptions.Item label="目标温度">
                {props.deviceState
                  ? `${props.deviceState.targetTemperature}℃`
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="活跃 Prompt">
                {activePrompt?.name || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="测试集">
                {props.testSets.length}
              </Descriptions.Item>
              <Descriptions.Item label="异常日志">
                {errorLogs.length}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="最近评测">
            {latestEvaluation ? (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="测试集">
                  {latestEvaluation.testSetName}
                </Descriptions.Item>
                <Descriptions.Item label="准确率">
                  {renderRate(
                    latestEvaluation.summary.passed,
                    latestEvaluation.summary.total,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="调用量">
                  {latestEvaluation.summary.total}
                </Descriptions.Item>
                <Descriptions.Item label="费用">
                  {formatCny(latestEvaluation.summary.costCny)}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Text type="secondary">暂无评测记录。</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="最近日志">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={props.logs.slice(0, 5)}
              columns={[
                {
                  title: "类型",
                  dataIndex: "type",
                  width: 110,
                  render: (value) => <Tag>{value}</Tag>,
                },
                { title: "摘要", dataIndex: "summary", ellipsis: true },
                { title: "时间", dataIndex: "createdAt", width: 180 },
              ]}
              locale={{ emptyText: "暂无日志" }}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function KpiCard(props: {
  title: string;
  value: React.ReactNode;
  suffix?: string;
}) {
  return (
    <Card size="small" className="kpi-card">
      <Text type="secondary">{props.title}</Text>
      <div className="kpi-value">
        {props.value}
        {props.suffix ? <span>{props.suffix}</span> : null}
      </div>
    </Card>
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
  const activeProvider = props.providers.find(
    (provider) => provider.id === props.selectedProviderId,
  );
  const activePrompt = props.prompts.find(
    (prompt) => prompt.id === props.selectedPromptId,
  );

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
            <Select
              value={props.selectedPromptId}
              options={props.promptOptions}
              onChange={props.onPromptChange}
            />
          </Form.Item>
        </Form>
        <Space wrap>
          <Tag color={activeProvider?.enabled ? "green" : "orange"}>
            {activeProvider?.enabled ? "已启用" : "未启用"}
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
                onChange={(hasOccupancy) =>
                  void props.onDevicePatch({ hasOccupancy })
                }
              />
            </Flex>
            <Flex justify="space-between" align="center">
              <Text>语音播报</Text>
              <Switch
                checked={props.deviceState.voiceBroadcastEnabled}
                onChange={(voiceBroadcastEnabled) =>
                  void props.onDevicePatch({ voiceBroadcastEnabled })
                }
              />
            </Flex>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="目标温度">
                {props.deviceState.targetTemperature}℃
              </Descriptions.Item>
              <Descriptions.Item label="环境温度">
                {props.deviceState.ambientTemperature}℃
              </Descriptions.Item>
              <Descriptions.Item label="故障码">
                {props.deviceState.faultCode || "无"}
              </Descriptions.Item>
            </Descriptions>
            <Divider className="compact-divider" />
            <Text type="secondary">当前模式</Text>
            <Space wrap>
              {props.deviceState.activeModes.length ? (
                props.deviceState.activeModes.map((mode) => (
                  <Tag key={mode}>{mode}</Tag>
                ))
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
  llmProviders: ModelProvider[];
  prompts: PromptVersion[];
  testCases: TestCase[];
  testSets: TestSetSummary[];
  evaluations: EvaluationRun[];
  devices: DeviceProfile[];
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
  onRunEvaluation: (input?: {
    providerIds?: string[];
    testSetId?: string;
    promptId?: string;
    testCaseIds?: string[];
  }) => Promise<EvaluationRun>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Space orientation="vertical" size={16} className="full-width">
      <IntentContextBar
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
      <VoicePipelinePage
        providers={props.providers}
        llmProviders={props.llmProviders}
        prompts={props.prompts}
        devices={props.devices}
        testSets={props.testSets}
        selectedDeviceId={props.devices[0]?.id || "demo-bath-heater-001"}
        selectedProviderId={props.selectedProviderId}
        selectedPromptId={props.selectedPromptId}
        onRefresh={props.onRefresh}
      />
    </Space>
  );
}

function IntentContextBar(props: {
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
  const activeProvider = props.providers.find(
    (provider) => provider.id === props.selectedProviderId,
  );
  const activePrompt = props.prompts.find(
    (prompt) => prompt.id === props.selectedPromptId,
  );

  return (
    <div className="context-bar">
      <div className="context-field context-field-wide">
        <Text type="secondary">模型</Text>
        <Select
          value={props.selectedProviderId}
          options={props.providerOptions}
          onChange={props.onProviderChange}
          className="full-width"
        />
      </div>
      <div className="context-field context-field-wide">
        <Text type="secondary">Prompt</Text>
        <Select
          value={props.selectedPromptId}
          options={props.promptOptions}
          onChange={props.onPromptChange}
          className="full-width"
        />
      </div>
      <div className="context-status">
        <Tag color={activeProvider?.enabled ? "green" : "orange"}>
          {activeProvider?.enabled ? "已启用" : "未启用"}
        </Tag>
        <Tag>{activeProvider?.type}</Tag>
        <Tag color="blue">{activePrompt?.status}</Tag>
      </div>
      <div className="context-device">
        <Space size={12} wrap>
          <Badge
            status={props.deviceState?.isOnline ? "success" : "default"}
            text="样机"
          />
          <Text type="secondary">
            {props.deviceState
              ? `${props.deviceState.ambientTemperature}℃`
              : "-"}
          </Text>
          <Switch
            size="small"
            checked={Boolean(props.deviceState?.hasOccupancy)}
            disabled={!props.deviceState}
            onChange={(hasOccupancy) =>
              void props.onDevicePatch({ hasOccupancy })
            }
          />
          <Text type="secondary">人感</Text>
        </Space>
      </div>
    </div>
  );
}

function SafetyRulesPage(props: { deviceState?: DeviceState }) {
  const [checked, setChecked] = useState(false);
  const state = props.deviceState;
  const rules = [
    {
      name: "设备离线禁止控制",
      level: "阻断",
      color: "red",
      detail: "设备不在线时，所有模型控制结果都不能下发。",
    },
    {
      name: "故障状态禁止取暖",
      level: "阻断",
      color: "red",
      detail: "检测到设备故障码时，禁止弱暖、强暖和恒温动作。",
    },
    {
      name: "强暖低置信度确认",
      level: "确认",
      color: "orange",
      detail: "强暖意图置信度低于 85% 时，转为二次确认，不直接执行。",
    },
    {
      name: "温度范围校验",
      level: "校验",
      color: "blue",
      detail: "目标温度必须限制在 30℃ 到 45℃。",
    },
    {
      name: "模式互斥",
      level: "约束",
      color: "green",
      detail: "取暖、沐浴、干燥、除雾和恒温等模式不能同时生效。",
    },
  ];
  const ruleStats = [
    {
      title: "阻断规则",
      value: rules.filter((rule) => rule.level === "阻断").length,
    },
    {
      title: "确认规则",
      value: rules.filter((rule) => rule.level === "确认").length,
    },
    {
      title: "校验规则",
      value: rules.filter((rule) => rule.level === "校验").length,
    },
    {
      title: "运行约束",
      value: rules.filter((rule) => rule.level === "约束").length,
    },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="控制边界"
        title="规则引擎"
        description="模型输出先经过规则校验，再进入设备状态机。"
        extra={
          <Button type="primary" onClick={() => setChecked(true)}>
            检查当前设备
          </Button>
        }
      />
      <Row gutter={[16, 16]}>
        {ruleStats.map((item) => (
          <Col key={item.title} xs={24} md={12} xl={6}>
            <KpiCard title={item.title} value={item.value} />
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="已启用规则" size="small">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={rules}
              columns={[
                { title: "规则", dataIndex: "name", width: 190 },
                {
                  title: "等级",
                  dataIndex: "level",
                  width: 90,
                  render: (value, rule) => (
                    <Tag color={rule.color}>{value}</Tag>
                  ),
                },
                { title: "说明", dataIndex: "detail" },
                {
                  title: "状态",
                  width: 80,
                  render: () => <Tag color="green">启用</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="当前检查结果" size="small">
            {checked ? (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert
                  type={
                    state?.isOnline && !state.faultCode ? "success" : "error"
                  }
                  showIcon
                  title={
                    state?.isOnline && !state.faultCode
                      ? "当前设备可接受控制"
                      : "当前设备存在控制阻断"
                  }
                />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="在线状态">
                    {state?.isOnline ? "在线" : "离线"}
                  </Descriptions.Item>
                  <Descriptions.Item label="故障码">
                    {state?.faultCode || "无"}
                  </Descriptions.Item>
                  <Descriptions.Item label="有人感应">
                    {state?.hasOccupancy ? "是" : "否"}
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            ) : (
              <Text type="secondary">
                点击“检查当前设备”运行一次设备前置条件检查。
              </Text>
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
  const [secretStatuses, setSecretStatuses] = useState<ProviderSecretStatus[]>(
    [],
  );
  const [secretStatusLoading, setSecretStatusLoading] = useState(false);
  const [secretSavingId, setSecretSavingId] = useState<string | null>(null);
  const [secretClearingId, setSecretClearingId] = useState<string | null>(null);
  const [secretModalProvider, setSecretModalProvider] =
    useState<ModelProvider | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ModelProvider | null>(
    null,
  );
  const [providerEditingId, setProviderEditingId] = useState<string | null>(
    null,
  );
  const [providerRequestBodyText, setProviderRequestBodyText] = useState("{}");
  const [providerSaving, setProviderSaving] = useState(false);
  const [secretMessage, secretMessageHolder] = message.useMessage();
  const statusByProviderId = useMemo(
    () => new Map(secretStatuses.map((status) => [status.providerId, status])),
    [secretStatuses],
  );
  const enabledProviders = props.providers.filter(
    (provider) => provider.enabled,
  );
  const configuredKeyCount = props.providers.filter((provider) => {
    if (!provider.apiKeyEnv) {
      return false;
    }
    return Boolean(statusByProviderId.get(provider.id)?.isConfigured);
  }).length;
  const keyRequiredCount = props.providers.filter((provider) =>
    Boolean(provider.apiKeyEnv),
  ).length;
  const lowCostProviders = props.providers.filter((provider) => {
    const inputPrice =
      provider.inputPricePerMTokens ?? Number.POSITIVE_INFINITY;
    const outputPrice =
      provider.outputPricePerMTokens ?? Number.POSITIVE_INFINITY;
    return inputPrice <= 1 && outputPrice <= 2;
  }).length;

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
      secretMessage.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSecretStatusLoading(false);
    }
  }

  async function handleEnabledChange(
    provider: ModelProvider,
    enabled: boolean,
  ) {
    setSavingId(provider.id);
    try {
      await props.onProvidersChange(
        props.providers.map((item) =>
          item.id === provider.id ? { ...item, enabled } : item,
        ),
      );
      if (
        enabled &&
        provider.apiKeyEnv &&
        !statusByProviderId.get(provider.id)?.isConfigured
      ) {
        secretMessage.warning(
          "已启用供应商，但 API Key 未配置，真实调用会失败。",
        );
      }
    } finally {
      setSavingId(null);
    }
  }

  function openSecretModal(provider: ModelProvider) {
    setSecretModalProvider(provider);
    setApiKeyInput("");
  }

  function closeSecretModal() {
    setSecretModalProvider(null);
    setApiKeyInput("");
  }

  async function handleSaveApiKey() {
    const provider = secretModalProvider;
    const apiKey = apiKeyInput.trim();
    if (!provider) {
      return;
    }

    if (!apiKey) {
      secretMessage.warning("请先填写 API Key。");
      return;
    }

    setSecretSavingId(provider.id);
    try {
      const status = await saveProviderApiKey(provider.id, apiKey);
      setSecretStatuses((current) =>
        upsertProviderSecretStatus(current, status),
      );
      closeSecretModal();
      secretMessage.success("API Key 已保存到 apps/api/.env");
    } catch (error) {
      secretMessage.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSecretSavingId(null);
    }
  }

  async function handleClearApiKey(provider: ModelProvider) {
    setSecretClearingId(provider.id);
    try {
      const status = await clearProviderApiKey(provider.id);
      setSecretStatuses((current) =>
        upsertProviderSecretStatus(current, status),
      );
      secretMessage.success(`${provider.apiKeyEnv} 已从 apps/api/.env 清除`);
    } catch (error) {
      secretMessage.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSecretClearingId(null);
    }
  }

  function openProviderEditor(
    provider?: ModelProvider,
    serviceType: ModelProvider["serviceType"] = "LLM",
  ) {
    const draft = provider ? { ...provider } : createProviderDraft(serviceType);
    setProviderDraft(draft);
    setProviderEditingId(provider?.id ?? null);
    setProviderRequestBodyText(
      JSON.stringify(draft.requestBody ?? {}, null, 2),
    );
    setProviderModalOpen(true);
  }

  function closeProviderEditor() {
    setProviderModalOpen(false);
    setProviderDraft(null);
    setProviderEditingId(null);
    setProviderRequestBodyText("{}");
  }

  function patchProviderDraft(patch: Partial<ModelProvider>) {
    setProviderDraft((current) =>
      current ? { ...current, ...patch } : current,
    );
  }

  async function handleSaveProvider() {
    if (!providerDraft) {
      return;
    }
    const id = providerDraft.id.trim();
    const name = providerDraft.name.trim();
    const model = providerDraft.model.trim();
    if (!id || !name || !model) {
      secretMessage.warning("配置 ID、名称和模型名称不能为空。");
      return;
    }

    let requestBody: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(providerRequestBodyText || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("请求体必须是 JSON 对象");
      }
      requestBody = parsed as Record<string, unknown>;
    } catch (error) {
      secretMessage.error(
        error instanceof Error ? error.message : "请求体 JSON 格式不正确",
      );
      return;
    }

    const duplicate = props.providers.some(
      (provider) => provider.id === id && provider.id !== providerEditingId,
    );
    if (duplicate) {
      secretMessage.error(`配置 ID 已存在：${id}`);
      return;
    }

    const normalized: ModelProvider = {
      ...providerDraft,
      id,
      name,
      model,
      baseUrl: providerDraft.baseUrl?.trim() || null,
      apiKeyEnv: providerDraft.apiKeyEnv?.trim() || null,
      apiKeyUrl: providerDraft.apiKeyUrl?.trim() || null,
      requestBody,
      notes: providerDraft.notes?.trim() || "",
    };

    setProviderSaving(true);
    try {
      const exists = props.providers.some(
        (provider) => provider.id === providerEditingId,
      );
      const nextProviders = exists
        ? props.providers.map((provider) =>
            provider.id === providerEditingId ? normalized : provider,
          )
        : [...props.providers, normalized];
      await props.onProvidersChange(nextProviders);
      closeProviderEditor();
      secretMessage.success(exists ? "供应商配置已更新" : "供应商配置已新增");
    } catch (error) {
      secretMessage.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setProviderSaving(false);
    }
  }

  return (
    <Space orientation="vertical" size={16} className="full-width">
      {secretMessageHolder}
      <PageIntro
        eyebrow="模型接入"
        title="供应商清单"
        description="统一维护 LLM、ASR、TTS 的供应商、模型、接口、密钥和计费参数。"
        extra={
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() => openProviderEditor(undefined, "ASR")}
            >
              新增 ASR / TTS / LLM
            </Button>
          </Space>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="配置总数" value={props.providers.length} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="已启用" value={enabledProviders.length} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="Key 已配置"
            value={configuredKeyCount}
            suffix={` / ${keyRequiredCount}`}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="低价候选" value={lowCostProviders} />
        </Col>
      </Row>
      <Card size="small" title="供应商清单">
        <Table
          rowKey="id"
          size="small"
          dataSource={props.providers}
          pagination={false}
          loading={secretStatusLoading}
          scroll={{ x: 1620 }}
          columns={[
            { title: "供应商", dataIndex: "name", width: 210 },
            {
              title: "服务",
              dataIndex: "serviceType",
              width: 100,
              render: (value: ModelProvider["serviceType"]) => (
                <Tag color={providerServiceColor(value)}>
                  {providerServiceLabel(value)}
                </Tag>
              ),
            },
            { title: "协议", dataIndex: "protocol", width: 150 },
            { title: "模型", dataIndex: "model", width: 240 },
            {
              title: "Key 环境变量",
              dataIndex: "apiKeyEnv",
              width: 180,
              render: (value) => value || "无需 Key",
            },
            {
              title: "Key 入口",
              width: 110,
              render: (_, provider) =>
                provider.apiKeyUrl ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<LinkOutlined />}
                    href={provider.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开
                  </Button>
                ) : (
                  "-"
                ),
            },
            {
              title: "输入价",
              dataIndex: "inputPricePerMTokens",
              width: 130,
              render: (value, provider) =>
                provider.serviceType === "LLM"
                  ? formatPricePerMTokens(value)
                  : provider.serviceType === "ASR"
                    ? `${provider.billingMode || "NONE"}`
                    : typeof provider.pricePer10KCharsCny === "number"
                      ? `￥${provider.pricePer10KCharsCny.toFixed(4)}/万字`
                      : `${provider.packageCalls ?? "-"} 次`,
            },
            {
              title: "输出价",
              dataIndex: "outputPricePerMTokens",
              width: 130,
              render: (value, provider) =>
                provider.serviceType === "LLM"
                  ? formatPricePerMTokens(value)
                  : provider.serviceType === "ASR"
                    ? `￥${(provider.pricePerRequestCny ?? 0).toFixed(6)}/次`
                    : `约￥${estimateTtsProviderCost(provider).toFixed(6)}/次`,
            },
            {
              title: "API Key 状态",
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
              },
            },
            {
              title: "启用评测",
              width: 120,
              render: (_, provider) => (
                <Switch
                  checked={provider.enabled}
                  loading={savingId === provider.id}
                  onChange={(enabled) =>
                    void handleEnabledChange(provider, enabled)
                  }
                />
              ),
            },
            { title: "备注", dataIndex: "notes", ellipsis: true },
            {
              title: "操作",
              width: 190,
              render: (_, provider) => {
                const isConfigured = Boolean(
                  statusByProviderId.get(provider.id)?.isConfigured,
                );
                const canConfigure = Boolean(provider.apiKeyEnv);

                return (
                  <Space size={8}>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openProviderEditor(provider)}
                    >
                      编辑
                    </Button>
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
              },
            },
          ]}
        />
      </Card>
      <div className="inline-note">
        <Badge status="processing" />
        <Text type="secondary">
          新增或编辑后保存到本地 data/model-providers.json；API Key 仍只保存到
          apps/api/.env，不写入前端和配置文件。
        </Text>
      </div>
      <Modal
        title={
          secretModalProvider
            ? `配置 ${secretModalProvider.name} API Key`
            : "配置 API Key"
        }
        open={Boolean(secretModalProvider)}
        okText="保存到本地 .env"
        cancelText="取消"
        confirmLoading={Boolean(
          secretModalProvider && secretSavingId === secretModalProvider.id,
        )}
        onOk={() => void handleSaveApiKey()}
        onCancel={closeSecretModal}
      >
        <Space orientation="vertical" size={12} className="full-width">
          <Alert
            type="warning"
            showIcon
            title="页面不会回显已保存的密钥"
            description={`保存后会写入 apps/api/.env 的 ${secretModalProvider?.apiKeyEnv || "-"}，并立即更新当前本地 API 进程。`}
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
      <Modal
        title={
          providerDraft
            ? `${props.providers.some((provider) => provider.id === providerDraft.id) ? "编辑" : "新增"}供应商配置`
            : "供应商配置"
        }
        open={providerModalOpen}
        width={820}
        okText="保存配置"
        cancelText="取消"
        confirmLoading={providerSaving}
        onOk={() => void handleSaveProvider()}
        onCancel={closeProviderEditor}
        destroyOnHidden
      >
        {providerDraft ? (
          <Form layout="vertical">
            <Row gutter={[12, 0]}>
              <Col xs={24} md={8}>
                <Form.Item label="服务类型" required>
                  <Select
                    value={providerDraft.serviceType}
                    options={[
                      { label: "LLM 大模型", value: "LLM" },
                      { label: "ASR 语音识别", value: "ASR" },
                      { label: "TTS 语音合成", value: "TTS" },
                    ]}
                    onChange={(value) => {
                      const nextType = value as ModelProvider["serviceType"];
                      patchProviderDraft({
                        serviceType: nextType,
                        protocol:
                          nextType === "LLM"
                            ? "OPENAI_COMPATIBLE"
                            : "HTTP_JSON",
                        type:
                          nextType === "LLM"
                            ? providerDraft.type
                            : "OPENAI_COMPATIBLE",
                      });
                    }}
                    className="full-width"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="配置 ID" required>
                  <Input
                    value={providerDraft.id}
                    disabled={props.providers.some(
                      (provider) => provider.id === providerDraft.id,
                    )}
                    onChange={(event) =>
                      patchProviderDraft({ id: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="显示名称" required>
                  <Input
                    value={providerDraft.name}
                    onChange={(event) =>
                      patchProviderDraft({ name: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="模型名称" required>
                  <Input
                    value={providerDraft.model}
                    onChange={(event) =>
                      patchProviderDraft({ model: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="协议">
                  <Select
                    value={providerDraft.protocol}
                    options={[
                      { label: "OpenAI 兼容", value: "OPENAI_COMPATIBLE" },
                      { label: "HTTP JSON", value: "HTTP_JSON" },
                    ]}
                    onChange={(value) =>
                      patchProviderDraft({
                        protocol: value as ModelProvider["protocol"],
                      })
                    }
                    className="full-width"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="接口类型">
                  <Select
                    value={providerDraft.type}
                    disabled={providerDraft.serviceType !== "LLM"}
                    options={[
                      { label: "OpenAI 兼容接口", value: "OPENAI_COMPATIBLE" },
                      { label: "本地模拟", value: "MOCK" },
                    ]}
                    onChange={(value) =>
                      patchProviderDraft({
                        type: value as ModelProvider["type"],
                      })
                    }
                    className="full-width"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Base URL">
                  <Input
                    value={providerDraft.baseUrl ?? ""}
                    placeholder="例如 https://api.example.com/v1"
                    onChange={(event) =>
                      patchProviderDraft({ baseUrl: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="API Key 环境变量">
                  <Input
                    value={providerDraft.apiKeyEnv ?? ""}
                    placeholder="例如 ASR_API_KEY"
                    onChange={(event) =>
                      patchProviderDraft({
                        apiKeyEnv: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="超时（毫秒）">
                  <InputNumber
                    min={500}
                    value={providerDraft.timeoutMs}
                    onChange={(value) =>
                      patchProviderDraft({ timeoutMs: Number(value ?? 8000) })
                    }
                    className="full-width"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="API Key 获取地址">
                  <Input
                    value={providerDraft.apiKeyUrl ?? ""}
                    placeholder="填写后可从供应商列表直接打开"
                    onChange={(event) =>
                      patchProviderDraft({ apiKeyUrl: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="最大输出 Token">
                  <InputNumber
                    min={1}
                    max={8192}
                    value={providerDraft.maxOutputTokens}
                    onChange={(value) =>
                      patchProviderDraft({
                        maxOutputTokens: Number(value ?? 128),
                      })
                    }
                    className="full-width"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="启用">
                  <div style={{ paddingTop: 6 }}>
                    <Switch
                      checked={providerDraft.enabled}
                      onChange={(enabled) => patchProviderDraft({ enabled })}
                    />
                  </div>
                </Form.Item>
              </Col>
            </Row>

            {providerDraft.serviceType === "LLM" ? (
              <Card
                size="small"
                title="LLM 计费参数"
                style={{ marginBottom: 12 }}
              >
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={12}>
                    <Form.Item label="输入价格（元 / 百万 Token）">
                      <InputNumber
                        min={0}
                        precision={6}
                        value={providerDraft.inputPricePerMTokens ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            inputPricePerMTokens: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="输出价格（元 / 百万 Token）">
                      <InputNumber
                        min={0}
                        precision={6}
                        value={providerDraft.outputPricePerMTokens ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            outputPricePerMTokens: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ) : null}

            {providerDraft.serviceType === "ASR" ? (
              <Card
                size="small"
                title="ASR 计费参数"
                style={{ marginBottom: 12 }}
              >
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={8}>
                    <Form.Item label="计费方式">
                      <Select
                        value={providerDraft.billingMode ?? "PER_REQUEST"}
                        options={[
                          { label: "按次", value: "PER_REQUEST" },
                          { label: "按分钟", value: "PER_MINUTE" },
                          { label: "按小时", value: "PER_HOUR" },
                          { label: "免费 / 本地", value: "NONE" },
                        ]}
                        onChange={(value) =>
                          patchProviderDraft({
                            billingMode: value as ModelProvider["billingMode"],
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="单次价格（元）">
                      <InputNumber
                        min={0}
                        precision={8}
                        value={providerDraft.pricePerRequestCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            pricePerRequestCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="平均时长（秒）">
                      <InputNumber
                        min={0.1}
                        precision={2}
                        value={providerDraft.averageSecondsPerRequest ?? 3}
                        onChange={(value) =>
                          patchProviderDraft({
                            averageSecondsPerRequest: Number(value ?? 3),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="每分钟价格（元）">
                      <InputNumber
                        min={0}
                        precision={8}
                        value={providerDraft.pricePerMinuteCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            pricePerMinuteCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="每小时价格（元）">
                      <InputNumber
                        min={0}
                        precision={8}
                        value={providerDraft.pricePerHourCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            pricePerHourCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ) : null}

            {providerDraft.serviceType === "TTS" ? (
              <Card
                size="small"
                title="TTS 计费参数"
                style={{ marginBottom: 12 }}
              >
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={8}>
                    <Form.Item label="音色">
                      <Input
                        value={providerDraft.voice ?? ""}
                        onChange={(event) =>
                          patchProviderDraft({ voice: event.target.value })
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="音频格式">
                      <Input
                        value={providerDraft.audioFormat ?? "mp3"}
                        onChange={(event) =>
                          patchProviderDraft({
                            audioFormat: event.target.value,
                          })
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label="单次价格（元）">
                      <InputNumber
                        min={0}
                        precision={8}
                        value={providerDraft.pricePerRequestCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            pricePerRequestCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="套餐次数">
                      <InputNumber
                        min={1}
                        value={providerDraft.packageCalls ?? 1}
                        onChange={(value) =>
                          patchProviderDraft({
                            packageCalls: Number(value ?? 1),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="套餐价格（元）">
                      <InputNumber
                        min={0}
                        precision={4}
                        value={providerDraft.packagePriceCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            packagePriceCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="价格（元 / 万字符）">
                      <InputNumber
                        min={0}
                        precision={6}
                        value={providerDraft.pricePer10KCharsCny ?? 0}
                        onChange={(value) =>
                          patchProviderDraft({
                            pricePer10KCharsCny: Number(value ?? 0),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="平均播报字符数">
                      <InputNumber
                        min={1}
                        precision={0}
                        value={providerDraft.averageCharsPerRequest ?? 50}
                        onChange={(value) =>
                          patchProviderDraft({
                            averageCharsPerRequest: Number(value ?? 50),
                          })
                        }
                        className="full-width"
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ) : null}

            <Row gutter={[12, 0]}>
              <Col xs={24} md={12}>
                <Form.Item label="请求体附加 JSON">
                  <Input.TextArea
                    value={providerRequestBodyText}
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    placeholder='例如：{"enable_thinking":false}'
                    onChange={(event) =>
                      setProviderRequestBodyText(event.target.value)
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="响应字段路径">
                  <Space orientation="vertical" size={8} className="full-width">
                    <Input
                      value={providerDraft.responseTextPath ?? ""}
                      placeholder="ASR 文本，例如 data.text"
                      onChange={(event) =>
                        patchProviderDraft({
                          responseTextPath: event.target.value || undefined,
                        })
                      }
                    />
                    <Input
                      value={providerDraft.responseAudioPath ?? ""}
                      placeholder="TTS 音频，例如 data.audioBase64"
                      onChange={(event) =>
                        patchProviderDraft({
                          responseAudioPath: event.target.value || undefined,
                        })
                      }
                    />
                    <Input
                      value={providerDraft.responseMimeTypePath ?? ""}
                      placeholder="TTS MIME，例如 data.mimeType"
                      onChange={(event) =>
                        patchProviderDraft({
                          responseMimeTypePath: event.target.value || undefined,
                        })
                      }
                    />
                  </Space>
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label="备注">
                  <Input.TextArea
                    value={providerDraft.notes ?? ""}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onChange={(event) =>
                      patchProviderDraft({ notes: event.target.value })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        ) : null}
      </Modal>
    </Space>
  );
}

function upsertProviderSecretStatus(
  statuses: ProviderSecretStatus[],
  nextStatus: ProviderSecretStatus,
): ProviderSecretStatus[] {
  const nextStatuses = statuses.filter(
    (status) => status.providerId !== nextStatus.providerId,
  );
  return [...nextStatuses, nextStatus];
}

function createProviderDraft(
  serviceType: ModelProvider["serviceType"],
): ModelProvider {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    id: `custom-${serviceType.toLowerCase()}-${suffix}`,
    name: `自定义 ${providerServiceLabel(serviceType)}`,
    type: serviceType === "LLM" ? "OPENAI_COMPATIBLE" : "OPENAI_COMPATIBLE",
    serviceType,
    protocol: serviceType === "LLM" ? "OPENAI_COMPATIBLE" : "HTTP_JSON",
    enabled: false,
    model: "",
    baseUrl: null,
    apiKeyEnv: null,
    apiKeyUrl: null,
    timeoutMs: 8000,
    maxOutputTokens: 128,
    inputPricePerMTokens: serviceType === "LLM" ? 0 : null,
    outputPricePerMTokens: serviceType === "LLM" ? 0 : null,
    pricePer10KCharsCny: serviceType === "TTS" ? 0 : undefined,
    averageCharsPerRequest: serviceType === "TTS" ? 50 : undefined,
    requestBody: {},
    notes: "",
  };
}

function providerServiceLabel(
  serviceType: ModelProvider["serviceType"],
): string {
  switch (serviceType) {
    case "ASR":
      return "ASR 语音识别";
    case "TTS":
      return "TTS 语音合成";
    case "LLM":
    default:
      return "LLM 大模型";
  }
}

function providerServiceColor(
  serviceType: ModelProvider["serviceType"],
): string {
  switch (serviceType) {
    case "ASR":
      return "cyan";
    case "TTS":
      return "purple";
    case "LLM":
    default:
      return "blue";
  }
}

const knowledgeCategoryOptions = [
  { label: "产品", value: "PRODUCT" },
  { label: "安装", value: "INSTALL" },
  { label: "使用", value: "USAGE" },
  { label: "故障", value: "TROUBLESHOOTING" },
  { label: "售后", value: "AFTER_SALES" },
  { label: "保养", value: "MAINTENANCE" },
  { label: "其他", value: "OTHER" },
];

const deviceCommandOptions: Array<{
  label: string;
  intent: DeviceIntent;
  slots?: Record<string, unknown>;
}> = [
  { label: "开灯", intent: "LIGHT_ON" },
  { label: "关灯", intent: "LIGHT_OFF" },
  { label: "弱暖", intent: "HEAT_WEAK_ON" },
  { label: "强暖", intent: "HEAT_STRONG_ON" },
  { label: "换气", intent: "VENTILATION_ON" },
  { label: "摆风", intent: "SWING_ON" },
  { label: "待机", intent: "STANDBY" },
  { label: "42 度", intent: "SET_TEMP", slots: { temperature: 42 } },
];

const onOffOptions = [
  { label: "on", value: "on" },
  { label: "off", value: "off" },
];

const heaterOptions = [
  { label: "off", value: "off" },
  { label: "weak", value: "weak" },
  { label: "strong", value: "strong" },
];

const accessEventOptions: Array<{
  label: string;
  value: DeviceAccessEventType;
}> = [
  { label: "有人进入", value: "OCCUPANCY_ENTER" },
  { label: "有人离开", value: "OCCUPANCY_LEAVE" },
  { label: "持续有人", value: "OCCUPANCY_STAY" },
  { label: "温度偏低", value: "LOW_TEMPERATURE" },
  { label: "湿度偏高", value: "HIGH_HUMIDITY" },
  { label: "运行过久", value: "LONG_RUNNING" },
  { label: "故障", value: "FAULT" },
];

const proactiveModeLabels: Record<string, string> = {
  PRACTICAL: "实用提醒",
  RELAXED: "轻松模式",
  QUIET: "安静模式",
};

function buildCloudState(values: Record<string, unknown>): DeviceCloudState {
  return {
    isOnline: Boolean(values.isOnline),
    power: readEnum(values.power, ["on", "off"]),
    light: readEnum(values.light, ["on", "off"]),
    heater: readEnum(values.heater, ["off", "weak", "strong"]),
    ventilation: readEnum(values.ventilation, ["on", "off"]),
    fan: readEnum(values.fan, ["on", "off"]),
    swing: readEnum(values.swing, ["on", "off"]),
    dry: readEnum(values.dry, ["on", "off"]),
    targetTemperature: toNullableNumber(values.targetTemperature),
    ambientTemperature: toNullableNumber(values.ambientTemperature),
    humidity: toNullableNumber(values.humidity),
    hasOccupancy:
      typeof values.hasOccupancy === "boolean" ? values.hasOccupancy : null,
    faultCode: values.faultCode ? String(values.faultCode) : null,
    runningMinutes: toNullableNumber(values.runningMinutes),
  };
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function actionToPollCommand(
  action: DeviceAction,
  replyText: string,
): DeviceAccessPollCommand {
  return {
    commandId: action.commandId || `${action.code}_${Date.now()}`,
    source: "voice-turn",
    expireAt: new Date(Date.now() + 60_000).toISOString(),
    replyText,
    actions: [action],
  };
}

function formatCny(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `￥${value.toFixed(6)}`;
}

function renderRate(passed: number, total: number): string {
  if (!total) {
    return "0%";
  }
  return `${Math.round((passed / total) * 100)}%`;
}

function formatPricePerMTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `￥${value.toFixed(2)}/百万`;
}

function estimateTtsProviderCost(provider: ModelProvider): number {
  if (typeof provider.pricePer10KCharsCny === "number") {
    return (
      ((provider.averageCharsPerRequest ?? 50) / 10_000) *
      provider.pricePer10KCharsCny
    );
  }
  if (provider.packageCalls && typeof provider.packagePriceCny === "number") {
    return provider.packagePriceCny / provider.packageCalls;
  }
  return provider.pricePerRequestCny ?? 0;
}

function DevicesPage(props: {
  devices: DeviceProfile[];
  deviceState?: DeviceState;
  selectedDeviceId: string;
  onSelectedDeviceIdChange: (id: string) => void;
  onRefresh: () => Promise<void>;
  onPatchDeviceState: (patch: Partial<DeviceState>) => Promise<void>;
  onSendCommand: (
    deviceId: string,
    input: { intent: string; slots?: Record<string, unknown> },
  ) => Promise<void>;
  onRecordEvent: (
    deviceId: string,
    input: { type: string; payload?: Record<string, unknown> },
  ) => Promise<void>;
}) {
  const selectedDevice =
    props.devices.find((device) => device.id === props.selectedDeviceId) ??
    props.devices[0];
  const deviceState = props.deviceState;
  const statusColumns: ColumnsType<DeviceProfile> = [
    { title: "设备名", dataIndex: "name", width: 160 },
    { title: "型号", dataIndex: "model", width: 140 },
    { title: "协议", dataIndex: "protocol", width: 110 },
    {
      title: "状态",
      width: 110,
      render: (_, device) => (
        <Tag
          color={
            device.status === "ONLINE"
              ? "green"
              : device.status === "FAULT"
                ? "red"
                : "default"
          }
        >
          {device.status}
        </Tag>
      ),
    },
    { title: "备注", dataIndex: "notes", ellipsis: true },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="设备联调"
        title="样机状态"
        description="维护样机档案、当前状态、控制命令和设备事件。"
        extra={<Button onClick={() => void props.onRefresh()}>刷新</Button>}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="设备数量" value={props.devices.length} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="当前样机" value={selectedDevice?.name || "-"} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="在线状态"
            value={deviceState?.isOnline ? "在线" : "离线"}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="目标温度"
            value={deviceState ? `${deviceState.targetTemperature}℃` : "-"}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="设备清单">
            <Table
              rowKey="id"
              rowSelection={{
                type: "radio",
                selectedRowKeys: selectedDevice ? [selectedDevice.id] : [],
                onChange: (keys) =>
                  props.onSelectedDeviceIdChange(String(keys[0] ?? "")),
              }}
              columns={statusColumns}
              dataSource={props.devices}
              pagination={false}
              locale={{ emptyText: "暂无设备" }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title={selectedDevice ? `${selectedDevice.name} 状态` : "设备状态"}
          >
            {deviceState ? (
              <Space orientation="vertical" size={14} className="full-width">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="设备编号">
                    {selectedDevice?.id || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="协议">
                    {selectedDevice?.protocol || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="在线状态">
                    {deviceState.isOnline ? "在线" : "离线"}
                  </Descriptions.Item>
                  <Descriptions.Item label="目标温度">
                    {deviceState.targetTemperature}℃
                  </Descriptions.Item>
                  <Descriptions.Item label="环境温度">
                    {deviceState.ambientTemperature}℃
                  </Descriptions.Item>
                  <Descriptions.Item label="环境湿度">
                    {deviceState.humidity ?? "-"}%
                  </Descriptions.Item>
                  <Descriptions.Item label="故障码">
                    {deviceState.faultCode || "无"}
                  </Descriptions.Item>
                </Descriptions>
                <Space wrap>
                  <Button
                    type={deviceState.isOnline ? "primary" : "default"}
                    onClick={() =>
                      void props.onPatchDeviceState({
                        isOnline: !deviceState.isOnline,
                      })
                    }
                  >
                    {deviceState.isOnline ? "设为离线" : "设为在线"}
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onPatchDeviceState({
                        hasOccupancy: !deviceState.hasOccupancy,
                      })
                    }
                  >
                    {deviceState.hasOccupancy ? "清除有人" : "有人进入"}
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onPatchDeviceState({
                        voiceBroadcastEnabled:
                          !deviceState.voiceBroadcastEnabled,
                      })
                    }
                  >
                    {deviceState.voiceBroadcastEnabled
                      ? "关闭播报"
                      : "开启播报"}
                  </Button>
                </Space>
                <Space wrap>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "LIGHT_ON",
                      })
                    }
                  >
                    开灯
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "HEAT_WEAK_ON",
                      })
                    }
                  >
                    弱暖
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "HEAT_STRONG_ON",
                      })
                    }
                  >
                    强暖
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "VENTILATION_ON",
                      })
                    }
                  >
                    换气
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "STANDBY",
                      })
                    }
                  >
                    待机
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onSendCommand(selectedDevice?.id || "", {
                        intent: "SET_TEMP",
                        slots: { temperature: 42 },
                      })
                    }
                  >
                    42 度
                  </Button>
                </Space>
                <Divider className="compact-divider" />
                <Space wrap>
                  <Button
                    onClick={() =>
                      void props.onRecordEvent(selectedDevice?.id || "", {
                        type: "OCCUPANCY",
                        payload: { hasOccupancy: true },
                      })
                    }
                  >
                    上报有人
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onRecordEvent(selectedDevice?.id || "", {
                        type: "OCCUPANCY",
                        payload: { hasOccupancy: false },
                      })
                    }
                  >
                    上报无人
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onRecordEvent(selectedDevice?.id || "", {
                        type: "RADAR",
                        payload: { hasOccupancy: true, distance: 1.2 },
                      })
                    }
                  >
                    雷达触发
                  </Button>
                  <Button
                    onClick={() =>
                      void props.onRecordEvent(selectedDevice?.id || "", {
                        type: "FAULT",
                        payload: { faultCode: "E01" },
                      })
                    }
                  >
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

function DeviceAccessPage(props: {
  selectedDeviceId: string;
  onSelectedDeviceIdChange: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [messageApi, messageHolder] = message.useMessage();
  const [connectForm] = Form.useForm();
  const [stateForm] = Form.useForm();
  const [voiceForm] = Form.useForm();
  const [eventForm] = Form.useForm();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [voiceResult, setVoiceResult] =
    useState<DeviceAccessVoiceTurnResponse | null>(null);
  const [commands, setCommands] = useState<DeviceAccessPollCommand[]>([]);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    connectForm.setFieldsValue({
      deviceId: props.selectedDeviceId || "demo-bath-heater-001",
    });
  }, [connectForm, props.selectedDeviceId]);

  async function runOperation<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<T | null> {
    setBusyKey(key);
    try {
      const result = await task();
      setLastResponse({
        operation: key,
        response: result,
      });
      messageApi.success(`${key}完成`);
      await props.onRefresh();
      return result;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  function readDeviceId() {
    const value = connectForm.getFieldValue("deviceId");
    return String(value || props.selectedDeviceId || "demo-bath-heater-001");
  }

  async function handleRegister() {
    const values = await connectForm.validateFields();
    const deviceId = String(values.deviceId || "").trim();
    props.onSelectedDeviceIdChange(deviceId);
    await runOperation("设备注册", () =>
      registerDeviceAccess({
        deviceId,
        model: String(values.model || "DX-AI-Bath-Heater"),
        firmwareVersion: values.firmwareVersion
          ? String(values.firmwareVersion)
          : null,
        protocolVersion: String(values.protocolVersion || "0.1"),
        capabilities: {
          light: true,
          heater: true,
          ventilation: true,
          fan: true,
          swing: true,
          temperature: true,
          radar: true,
        },
      }),
    );
  }

  async function handleHeartbeat() {
    const values = connectForm.getFieldsValue();
    await runOperation("心跳上报", () =>
      heartbeatDeviceAccess({
        deviceId: readDeviceId(),
        firmwareVersion: values.firmwareVersion
          ? String(values.firmwareVersion)
          : null,
        network: {
          rssi: toNullableNumber(values.rssi),
          ip: values.ip ? String(values.ip) : null,
        },
      }),
    );
  }

  async function handleGetConfig() {
    await runOperation("获取配置", () => getDeviceAccessConfig(readDeviceId()));
  }

  async function handleStateReport() {
    const values = stateForm.getFieldsValue();
    await runOperation("状态上报", () =>
      reportDeviceAccessState({
        deviceId: readDeviceId(),
        reportedAt: new Date().toISOString(),
        state: buildCloudState(values),
      }),
    );
  }

  async function handleVoiceTurn() {
    const values = await voiceForm.validateFields();
    const result = await runOperation("语音回合", () =>
      runDeviceAccessVoiceTurn({
        deviceId: readDeviceId(),
        text: String(values.text || ""),
        asrConfidence: Number(values.asrConfidence ?? 0.95),
        reportedState: buildCloudState(stateForm.getFieldsValue()),
      }),
    );
    if (result) {
      setVoiceResult(result);
      setCommands(
        result.actions.map((action) =>
          actionToPollCommand(action, result.replyText),
        ),
      );
      setSelectedCommandId(result.actions[0]?.commandId ?? null);
    }
  }

  async function handleConfirmVoiceTurn() {
    const confirmToken = voiceResult?.confirmToken;
    if (!confirmToken) {
      messageApi.info("当前没有待确认的语音动作");
      return;
    }
    const result = await runOperation("确认执行", () =>
      runDeviceAccessVoiceTurn({
        deviceId: readDeviceId(),
        sessionId: voiceResult.sessionId,
        text: "确认执行",
        confirmToken,
        reportedState: buildCloudState(stateForm.getFieldsValue()),
      }),
    );
    if (result) {
      setVoiceResult(result);
      setCommands(
        result.actions.map((action) =>
          actionToPollCommand(action, result.replyText),
        ),
      );
      setSelectedCommandId(result.actions[0]?.commandId ?? null);
    }
  }

  async function handlePollCommands() {
    const result = await runOperation("命令轮询", () =>
      pollDeviceAccessCommands(readDeviceId(), 10),
    );
    if (result) {
      setCommands(result.commands);
      setSelectedCommandId(result.commands[0]?.commandId ?? null);
    }
  }

  async function handleReportCommandResult() {
    const commandId = selectedCommandId || commands[0]?.commandId;
    if (!commandId) {
      messageApi.info("当前没有可回执的命令");
      return;
    }
    await runOperation("执行回执", () =>
      reportDeviceAccessCommandResult({
        deviceId: readDeviceId(),
        commandId,
        status: "success",
        executedAt: new Date().toISOString(),
        state: buildCloudState(stateForm.getFieldsValue()),
      }),
    );
    setCommands((items) =>
      items.filter((item) => item.commandId !== commandId),
    );
    setSelectedCommandId(null);
  }

  async function handleAccessEvent() {
    const values = eventForm.getFieldsValue();
    const eventType = String(
      values.eventType || "OCCUPANCY_ENTER",
    ) as DeviceAccessEventType;
    await runOperation("事件上报", () =>
      recordDeviceAccessEvent({
        deviceId: readDeviceId(),
        eventType,
        occurredAt: new Date().toISOString(),
        payload: {
          ambientTemperature: toNullableNumber(values.ambientTemperature),
          humidity: toNullableNumber(values.humidity),
          hasOccupancy: eventType !== "OCCUPANCY_LEAVE",
        },
      }),
    );
  }

  const actionColumns: ColumnsType<DeviceAction> = [
    { title: "commandId", dataIndex: "commandId", width: 220 },
    { title: "code", dataIndex: "code", width: 120 },
    { title: "value", dataIndex: "value", width: 120 },
    {
      title: "温度",
      dataIndex: "targetTemperature",
      width: 90,
      render: (value) => value ?? "-",
    },
    {
      title: "时长",
      dataIndex: "durationMinutes",
      width: 90,
      render: (value) => value ?? "-",
    },
  ];

  const commandColumns: ColumnsType<DeviceAccessPollCommand> = [
    { title: "commandId", dataIndex: "commandId", width: 220 },
    { title: "回复文本", dataIndex: "replyText", width: 180, ellipsis: true },
    {
      title: "动作",
      render: (_, command) => (
        <Space wrap>
          {command.actions.map((action, index) => (
            <Tag
              key={`${command.commandId}-${action.code}-${index}`}
            >{`${action.code}:${action.value}`}</Tag>
          ))}
        </Space>
      ),
    },
    { title: "过期时间", dataIndex: "expireAt", width: 220 },
    {
      title: "操作",
      width: 110,
      render: (_, command) => (
        <Button
          size="small"
          type={selectedCommandId === command.commandId ? "primary" : "default"}
          onClick={() => setSelectedCommandId(command.commandId)}
        >
          选中
        </Button>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      {messageHolder}
      <PageIntro
        eyebrow="样机联调"
        title="联调流程 V0.1"
        description="验证 WiFi 模组到 AI Gateway 的注册、状态、语音和命令闭环。"
        extra={<Button onClick={() => void props.onRefresh()}>刷新</Button>}
      />
      <div className="flow-strip">
        <div className="flow-node">
          <Text strong>注册</Text>
          <Text type="secondary">设备建档</Text>
        </div>
        <div className="flow-node">
          <Text strong>状态</Text>
          <Text type="secondary">MCU 数据上报</Text>
        </div>
        <div className="flow-node">
          <Text strong>语音</Text>
          <Text type="secondary">文本进 AI Gateway</Text>
        </div>
        <div className="flow-node">
          <Text strong>命令</Text>
          <Text type="secondary">轮询与回执</Text>
        </div>
        <div className="flow-node">
          <Text strong>事件</Text>
          <Text type="secondary">雷达主动触发</Text>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="连接配置">
            <Form
              form={connectForm}
              layout="vertical"
              initialValues={{
                deviceId: props.selectedDeviceId || "demo-bath-heater-001",
                model: "DX-AI-Bath-Heater",
                protocolVersion: "0.1",
                firmwareVersion: "dev-0.1",
                rssi: -48,
                ip: "192.168.1.120",
              }}
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="设备编号"
                    name="deviceId"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="型号" name="model">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="协议版本" name="protocolVersion">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="固件版本" name="firmwareVersion">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="RSSI" name="rssi">
                    <InputNumber className="full-width" />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item label="IP" name="ip">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Space wrap>
                <Button
                  type="primary"
                  loading={busyKey === "设备注册"}
                  onClick={() => void handleRegister()}
                >
                  注册
                </Button>
                <Button
                  loading={busyKey === "心跳上报"}
                  onClick={() => void handleHeartbeat()}
                >
                  心跳
                </Button>
                <Button
                  loading={busyKey === "获取配置"}
                  onClick={() => void handleGetConfig()}
                >
                  获取配置
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="状态上报">
            <Form
              form={stateForm}
              layout="vertical"
              initialValues={{
                isOnline: true,
                power: "on",
                light: "off",
                heater: "off",
                ventilation: "off",
                fan: "off",
                swing: "off",
                dry: "off",
                targetTemperature: 38,
                ambientTemperature: 24,
                humidity: 72,
                hasOccupancy: false,
                runningMinutes: 0,
              }}
            >
              <Row gutter={12}>
                <Col xs={12} md={8}>
                  <Form.Item
                    label="在线"
                    name="isOnline"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item
                    label="有人"
                    name="hasOccupancy"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="电源" name="power">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="照明" name="light">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="暖风" name="heater">
                    <Select options={heaterOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="换气" name="ventilation">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="吹风" name="fan">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="摆风" name="swing">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="干燥" name="dry">
                    <Select options={onOffOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="目标温度" name="targetTemperature">
                    <InputNumber min={30} max={45} className="full-width" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="环境温度" name="ambientTemperature">
                    <InputNumber className="full-width" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="湿度" name="humidity">
                    <InputNumber min={0} max={100} className="full-width" />
                  </Form.Item>
                </Col>
              </Row>
              <Button
                type="primary"
                loading={busyKey === "状态上报"}
                onClick={() => void handleStateReport()}
              >
                上报状态
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="语音回合">
            <Form
              form={voiceForm}
              layout="vertical"
              initialValues={{
                text: "打开灯",
                asrConfidence: 0.95,
              }}
            >
              <Form.Item
                label="ASR文本"
                name="text"
                rules={[{ required: true }]}
              >
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
              <Form.Item label="ASR置信度" name="asrConfidence">
                <InputNumber
                  min={0}
                  max={1}
                  step={0.01}
                  className="full-width"
                />
              </Form.Item>
              <Space wrap>
                <Button
                  type="primary"
                  loading={busyKey === "语音回合"}
                  onClick={() => void handleVoiceTurn()}
                >
                  执行语音回合
                </Button>
                <Button
                  loading={busyKey === "确认执行"}
                  onClick={() => void handleConfirmVoiceTurn()}
                >
                  确认执行
                </Button>
              </Space>
            </Form>
            {voiceResult && (
              <>
                <Divider className="compact-divider" />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="来源">
                    {voiceResult.source}
                  </Descriptions.Item>
                  <Descriptions.Item label="回复">
                    {voiceResult.replyText}
                  </Descriptions.Item>
                  <Descriptions.Item label="确认">
                    {voiceResult.needConfirm
                      ? voiceResult.confirmToken
                      : "不需要"}
                  </Descriptions.Item>
                  <Descriptions.Item label="LLM费用">
                    {voiceResult.usage.usedLlm
                      ? formatCny(voiceResult.usage.costCny)
                      : "未调用 LLM"}
                  </Descriptions.Item>
                </Descriptions>
                <Table
                  rowKey={(record) =>
                    record.commandId ||
                    `${record.code}-${record.value}-${record.targetTemperature ?? ""}-${record.durationMinutes ?? ""}`
                  }
                  size="small"
                  columns={actionColumns}
                  dataSource={voiceResult.actions}
                  pagination={false}
                />
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="命令轮询与回执">
            <Space wrap style={{ marginBottom: 12 }}>
              <Button
                type="primary"
                loading={busyKey === "命令轮询"}
                onClick={() => void handlePollCommands()}
              >
                轮询命令
              </Button>
              <Button
                loading={busyKey === "执行回执"}
                onClick={() => void handleReportCommandResult()}
              >
                上报执行成功
              </Button>
              {selectedCommandId && <Tag color="blue">{selectedCommandId}</Tag>}
            </Space>
            <Table
              rowKey="commandId"
              size="small"
              columns={commandColumns}
              dataSource={commands}
              pagination={false}
              locale={{ emptyText: "暂无待执行命令" }}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="事件上报">
            <Form
              form={eventForm}
              layout="vertical"
              initialValues={{
                eventType: "OCCUPANCY_ENTER",
                ambientTemperature: 23,
                humidity: 78,
              }}
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item label="事件类型" name="eventType">
                    <Select options={accessEventOptions} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item label="温度" name="ambientTemperature">
                    <InputNumber className="full-width" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item label="湿度" name="humidity">
                    <InputNumber min={0} max={100} className="full-width" />
                  </Form.Item>
                </Col>
              </Row>
              <Button
                type="primary"
                loading={busyKey === "事件上报"}
                onClick={() => void handleAccessEvent()}
              >
                上报事件
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="最近响应">
            <pre className="json-panel">
              {JSON.stringify(lastResponse, null, 2)}
            </pre>
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
    status?: "DRAFT" | "PUBLISHED";
  }) => Promise<void>;
  onQueryKnowledge: (input: {
    question: string;
    category?: string;
    limit?: number;
  }) => Promise<KnowledgeQueryResponse>;
}) {
  const [docForm] = Form.useForm();
  const [queryForm] = Form.useForm();
  const [queryResult, setQueryResult] = useState<KnowledgeQueryResponse | null>(
    null,
  );
  const [querying, setQuerying] = useState(false);
  const [saving, setSaving] = useState(false);
  const publishedCount = props.documents.filter(
    (document) => document.status === "PUBLISHED",
  ).length;
  const categoryCount = new Set(
    props.documents.map((document) => document.category),
  ).size;

  async function handleCreate(values: Record<string, unknown>) {
    setSaving(true);
    try {
      await props.onCreateDocument({
        title: String(values.title || ""),
        category: String(values.category || "OTHER"),
        content: String(values.content || ""),
        tags: String(values.tags || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        status: (values.status as "DRAFT" | "PUBLISHED") || "PUBLISHED",
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
        question: String(values.question || ""),
        category: values.category ? String(values.category) : undefined,
        limit: values.limit ? Number(values.limit) : 3,
      });
      setQueryResult(result);
    } finally {
      setQuerying(false);
    }
  }

  const documentColumns: ColumnsType<KnowledgeDocument> = [
    { title: "标题", dataIndex: "title", width: 220 },
    { title: "分类", dataIndex: "category", width: 150 },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value) => (
        <Tag color={value === "PUBLISHED" ? "green" : "default"}>{value}</Tag>
      ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      render: (value: string[]) => value.join(", ") || "-",
    },
    { title: "更新时间", dataIndex: "updatedAt", width: 220 },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="售后资料"
        title="资料维护"
        description="管理产品资料、售后 FAQ、故障排查和问答验证。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="资料总数" value={props.documents.length} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="已发布" value={publishedCount} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="分类数量" value={categoryCount} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="检索状态" value={queryResult ? "已验证" : "待验证"} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="资料清单">
            <Table
              rowKey="id"
              size="small"
              columns={documentColumns}
              dataSource={props.documents}
              pagination={{ pageSize: 8 }}
              locale={{ emptyText: "暂无资料" }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Space orientation="vertical" size={16} className="full-width">
            <Card size="small" title="新增资料">
              <Form
                form={docForm}
                layout="vertical"
                onFinish={(values) => void handleCreate(values)}
              >
                <Form.Item
                  name="title"
                  label="标题"
                  rules={[{ required: true }]}
                >
                  <Input placeholder="例如：常见故障排查" />
                </Form.Item>
                <Form.Item
                  name="category"
                  label="分类"
                  initialValue="OTHER"
                  rules={[{ required: true }]}
                >
                  <Select options={knowledgeCategoryOptions} />
                </Form.Item>
                <Form.Item name="tags" label="标签">
                  <Input placeholder="多个标签用英文逗号分隔" />
                </Form.Item>
                <Form.Item
                  name="content"
                  label="内容"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea rows={5} />
                </Form.Item>
                <Form.Item name="status" label="状态" initialValue="PUBLISHED">
                  <Select
                    options={[
                      { label: "发布", value: "PUBLISHED" },
                      { label: "草稿", value: "DRAFT" },
                    ]}
                  />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={saving}>
                  保存资料
                </Button>
              </Form>
            </Card>
            <Card size="small" title="知识问答">
              <Form
                form={queryForm}
                layout="vertical"
                onFinish={(values) => void handleQuery(values)}
              >
                <Form.Item
                  name="question"
                  label="问题"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea
                    rows={3}
                    placeholder="例如：浴霸有故障码怎么处理"
                  />
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
                  <Alert
                    type={queryResult.usedFallback ? "warning" : "success"}
                    showIcon
                    title={queryResult.answer}
                  />
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
    eventType:
      | "OCCUPANCY_ENTER"
      | "OCCUPANCY_LEAVE"
      | "LOW_TEMPERATURE"
      | "HIGH_HUMIDITY"
      | "LONG_RUNNING";
    ambientTemperature?: number | null;
    humidity?: number | null;
    hasOccupancy?: boolean | null;
    occurredAt?: string;
  }) => Promise<ProactiveDecision>;
}) {
  const [form] = Form.useForm();
  const [triggering, setTriggering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastDecision, setLastDecision] = useState<ProactiveDecision | null>(
    null,
  );

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

  async function handleTrigger(
    eventType:
      | "OCCUPANCY_ENTER"
      | "OCCUPANCY_LEAVE"
      | "LOW_TEMPERATURE"
      | "HIGH_HUMIDITY"
      | "LONG_RUNNING",
  ) {
    setTriggering(true);
    try {
      const decision = await props.onTriggerEvent({
        eventType,
        deviceId: "demo-bath-heater-001",
        ambientTemperature: 24,
        humidity: 68,
        hasOccupancy: eventType !== "OCCUPANCY_LEAVE",
        occurredAt: new Date().toISOString(),
      });
      setLastDecision(decision);
    } finally {
      setTriggering(false);
    }
  }

  const proactiveLogs = props.logs.filter((log) => log.type === "PROACTIVE");
  const quietHours = props.settings?.quietHours;

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="主动交互"
        title="策略配置"
        description="维护主动沟通开关、话术模式、频率和安静时段。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="启用状态"
            value={props.settings?.enabled ? "启用" : "停用"}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="话术模式"
            value={
              props.settings?.mode
                ? proactiveModeLabels[props.settings.mode] ||
                  props.settings.mode
                : "-"
            }
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="最小间隔"
            value={props.settings?.minIntervalMinutes ?? "-"}
            suffix="分钟"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard
            title="安静时段"
            value={
              quietHours?.enabled
                ? `${quietHours.start}-${quietHours.end}`
                : "关闭"
            }
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="设置">
            <Form
              form={form}
              layout="vertical"
              onFinish={(values) => void handleSave(values)}
            >
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="mode" label="模式" initialValue="PRACTICAL">
                <Select
                  options={[
                    { label: "实用提醒", value: "PRACTICAL" },
                    { label: "轻松模式", value: "RELAXED" },
                    { label: "安静模式", value: "QUIET" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="minIntervalMinutes"
                label="最小间隔"
                initialValue={10}
              >
                <InputNumber min={1} max={120} />
              </Form.Item>
              <Form.Item label="安静时段">
                <Space.Compact block>
                  <Form.Item
                    name={["quietHours", "enabled"]}
                    valuePropName="checked"
                    noStyle
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name={["quietHours", "start"]}
                    noStyle
                    initialValue="22:00"
                  >
                    <Input style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item
                    name={["quietHours", "end"]}
                    noStyle
                    initialValue="07:00"
                  >
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
              <Button
                loading={triggering}
                onClick={() => void handleTrigger("OCCUPANCY_ENTER")}
              >
                人感进入
              </Button>
              <Button
                loading={triggering}
                onClick={() => void handleTrigger("LOW_TEMPERATURE")}
              >
                温度偏低
              </Button>
              <Button
                loading={triggering}
                onClick={() => void handleTrigger("HIGH_HUMIDITY")}
              >
                湿度偏高
              </Button>
              <Button
                loading={triggering}
                onClick={() => void handleTrigger("LONG_RUNNING")}
              >
                长时间运行
              </Button>
            </Space>
            <Divider className="compact-divider" />
            {lastDecision ? (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert
                  type={lastDecision.shouldSpeak ? "success" : "info"}
                  showIcon
                  title={lastDecision.reason}
                />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="播报">
                    {lastDecision.shouldSpeak ? lastDecision.speak : "无"}
                  </Descriptions.Item>
                  <Descriptions.Item label="建议动作">
                    {lastDecision.suggestedIntent || "无"}
                  </Descriptions.Item>
                  <Descriptions.Item label="需确认">
                    {lastDecision.requiresConfirm ? "是" : "否"}
                  </Descriptions.Item>
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
            { title: "时间", dataIndex: "createdAt", width: 220 },
            { title: "摘要", dataIndex: "summary" },
            {
              title: "内容",
              width: 180,
              render: (_, log) => log.payload?.eventType || "-",
            },
          ]}
        />
      </Card>
    </Space>
  );
}

interface BillingUsageRow {
  id: string;
  createdAt: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  costCny: number | null;
  latencyMs: number;
  isEstimated: boolean;
}

interface ProviderCostRow {
  providerId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  averageLatencyMs: number;
}

interface ProductionCostScenario {
  key: string;
  deviceCount: number;
  turnsPerDeviceDay: number;
  totalTurns: number;
  onlineTurns: number;
  offlineAsrCalls: number;
  asrCalls: number;
  asrSeconds: number;
  offlinePlan: AsrOfflinePlan | null;
  offlineHardwareCost: number;
  offlineServiceCost: number;
  ruleTurns: number;
  knowledgeTurns: number;
  llmCalls: number;
  ttsResponseCalls: number;
  ttsCacheHits: number;
  ttsStaticCalls: number;
  ttsDynamicCalls: number;
  ttsCalls: number;
  ttsPackages: number;
  asrCost: number;
  ttsUnitCost: number;
  ttsVariableCost: number;
  variableAiServiceCost: number;
  voiceChainUnitCost: number;
  asrFirstYearCost: number;
  llmCost: number;
  ttsCost: number;
  aiServiceCost: number;
  fixedCost: number;
  totalCost: number;
  firstYearTotalCost: number;
  threeYearTotalCost: number;
}

type CostTrendAxis = "devices" | "turns";

interface ProductionCostTrendPoint {
  x: number;
  scenario: ProductionCostScenario;
}

interface AsrRangeCostPoint {
  key: string;
  turnsPerDeviceDay: number;
  scenario: ProductionCostScenario;
  annualRunningCost: number;
  firstYearCost: number;
  threeYearCost: number;
}

interface AsrRangeCostSeries {
  key: string;
  name: string;
  color: string;
  plan: AsrOfflinePlan;
  points: AsrRangeCostPoint[];
}

interface AsrYearCostPoint {
  key: string;
  years: number;
  scenario: ProductionCostScenario;
  annualRunningCost: number;
  cumulativeCost: number;
}

interface AsrYearCostSeries {
  key: string;
  name: string;
  color: string;
  plan: AsrOfflinePlan;
  points: AsrYearCostPoint[];
}

interface WarrantyCostRow {
  years: 3 | 5;
  label: string;
  asrCost: number;
  llmCost: number;
  ttsCost: number;
  aiServiceCost: number;
  fixedCost: number;
  offlineHardwareCost: number;
  offlineServiceCost: number;
  totalCost: number;
  unitDeviceCost: number;
  annualUnitDeviceCost: number;
  unitAiServiceCost: number;
}

interface SimpleCostEstimate {
  deviceCount: number;
  turnsPerDeviceDay: number;
  years: number;
  totalTurns: number;
  asrUnitCost: number;
  llmUnitCost: number;
  ttsUnitCost: number;
  voiceUnitCost: number;
  asrCost: number;
  llmCost: number;
  ttsCost: number;
  fullChainCost: number;
  otherAnnualCost: number;
  otherCost: number;
  totalCost: number;
  singleDeviceVoiceCost: number;
}

interface SimpleCostEstimateOptions {
  ttsOptimizationEnabled: boolean;
  ttsOptimizationRatePercent: number;
  asrDurationOptimizationEnabled: boolean;
  optimizedAsrSeconds: number;
}

const costTrendSeries = [
  { key: "asrCost", label: "ASR", color: "#1677ff" },
  { key: "llmCost", label: "LLM", color: "#722ed1" },
  { key: "ttsVariableCost", label: "TTS（折算）", color: "#fa8c16" },
  { key: "variableAiServiceCost", label: "完整链路合计", color: "#f5222d" },
] as const;

const asrRangeColors = ["#1677ff", "#fa8c16", "#52c41a", "#722ed1", "#13c2c2"];
const ASR_RANGE_DEVICE_COUNT = 100000;
const ASR_YEAR_MAX = 10;

function CostStatsPage(props: {
  logs: SystemLog[];
  providers: ModelProvider[];
  settings: ProductionCostSettings;
  onSave: (settings: ProductionCostSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProductionCostSettings>(props.settings);
  const [selectedDeviceCount, setSelectedDeviceCount] = useState(100000);
  const [selectedTurnsPerDeviceDay, setSelectedTurnsPerDeviceDay] = useState(1);
  const [trendAxis, setTrendAxis] = useState<CostTrendAxis>("devices");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  const runtimeLogs = useMemo(
    () =>
      props.logs.filter(
        (log) => readString(log.payload.billingSource) === "RUNTIME",
      ),
    [props.logs],
  );
  const voiceLogs = useMemo(
    () => runtimeLogs.filter((log) => log.type === "VOICE"),
    [runtimeLogs],
  );
  const aiUsageRows = useMemo(
    () =>
      runtimeLogs
        .filter((log) => log.type === "AI")
        .map(parseBillingUsage)
        .filter((row): row is BillingUsageRow => Boolean(row)),
    [runtimeLogs],
  );
  const voiceUsageRows = useMemo(
    () =>
      voiceLogs
        .filter((log) => readString(log.payload.source) === "llm")
        .map(parseBillingUsage)
        .filter((row): row is BillingUsageRow => Boolean(row)),
    [voiceLogs],
  );
  const billingRows = aiUsageRows.length ? aiUsageRows : voiceUsageRows;
  const knownCostRows = billingRows.filter(
    (row) => typeof row.costCny === "number",
  );
  const totalCost = knownCostRows.reduce(
    (sum, row) => sum + (row.costCny ?? 0),
    0,
  );
  const totalInputTokens = billingRows.reduce(
    (sum, row) => sum + row.inputTokens,
    0,
  );
  const totalOutputTokens = billingRows.reduce(
    (sum, row) => sum + row.outputTokens,
    0,
  );
  const averageCostPerCall = knownCostRows.length
    ? totalCost / knownCostRows.length
    : 0;
  const averageLatencyMs = billingRows.length
    ? Math.round(
        billingRows.reduce((sum, row) => sum + row.latencyMs, 0) /
          billingRows.length,
      )
    : 0;
  const ruleTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "rule",
  ).length;
  const knowledgeTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "knowledge",
  ).length;
  const llmTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "llm",
  ).length;
  const measuredVoiceTurns = ruleTurns + knowledgeTurns + llmTurns;
  const measuredLocalRate = measuredVoiceTurns
    ? Math.round(((ruleTurns + knowledgeTurns) / measuredVoiceTurns) * 100)
    : 0;
  const scenarios = useMemo(
    () =>
      [1000, 10000, 100000].flatMap((deviceCount) =>
        [1, 10, 100].map((turnsPerDeviceDay) =>
          buildProductionCostScenario(draft, deviceCount, turnsPerDeviceDay),
        ),
      ),
    [draft],
  );
  const selectedScenario = useMemo(
    () =>
      buildProductionCostScenario(
        draft,
        selectedDeviceCount,
        selectedTurnsPerDeviceDay,
      ),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const baselineScenario = useMemo(
    () =>
      buildProductionCostScenario(
        buildCompressionBaselineSettings(draft),
        selectedDeviceCount,
        selectedTurnsPerDeviceDay,
      ),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const typicalScenario = useMemo(
    () => buildProductionCostScenario(draft, 100000, 1),
    [draft],
  );
  const typicalBaselineScenario = useMemo(
    () =>
      buildProductionCostScenario(
        buildCompressionBaselineSettings(draft),
        100000,
        1,
      ),
    [draft],
  );
  const asrPlanRows = useMemo(
    () =>
      draft.asr.offlinePlans.map((plan) => {
        const planSettings: ProductionCostSettings = {
          ...draft,
          asr: {
            ...draft.asr,
            activeOfflinePlanId: plan.id,
          },
        };
        const scenario = buildProductionCostScenario(
          planSettings,
          selectedDeviceCount,
          selectedTurnsPerDeviceDay,
        );
        return {
          key: plan.id,
          plan,
          scenario,
          asrAnnualRunningCost: scenario.asrCost + scenario.offlineServiceCost,
          asrFirstYearCost: scenario.asrFirstYearCost,
          asrThreeYearCost: calculateAsrCumulativeCost(scenario, 3),
        };
      }),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const asrBaselineRow = asrPlanRows.find(
    (row) => row.plan.architecture === "HYBRID_CLOUD_ASR",
  );
  const asrPlanRowsWithPayback = asrPlanRows.map((row) => {
    if (!asrBaselineRow || row.key === asrBaselineRow.key) {
      return { ...row, paybackYears: null as number | null };
    }
    const annualSaving =
      asrBaselineRow.asrAnnualRunningCost - row.asrAnnualRunningCost;
    return {
      ...row,
      paybackYears:
        annualSaving > 0 && row.scenario.offlineHardwareCost > 0
          ? row.scenario.offlineHardwareCost / annualSaving
          : null,
    };
  });
  const fixedAnnualCost = sumFixedAnnualCost(draft);
  const developmentTotal = sumDevelopmentCost(draft);
  const developmentRows: Array<{
    key: keyof ProductionCostSettings["development"];
    label: string;
    value: number;
  }> = [
    { key: "llmCny", label: "LLM 测试及联调", value: draft.development.llmCny },
    { key: "asrCny", label: "ASR 测试及联调", value: draft.development.asrCny },
    { key: "ttsCny", label: "TTS 测试及联调", value: draft.development.ttsCny },
    {
      key: "serverCny",
      label: "服务器、域名、数据库",
      value: draft.development.serverCny,
    },
    {
      key: "miniProgramCny",
      label: "微信小程序认证及平台",
      value: draft.development.miniProgramCny,
    },
    {
      key: "hardwareCny",
      label: "WiFi、离线语音及测试硬件",
      value: draft.development.hardwareCny,
    },
    {
      key: "otherCny",
      label: "其他云服务及测试费用",
      value: draft.development.otherCny,
    },
  ];
  const llmUnitCost =
    (draft.llm.averageInputTokens * draft.llm.inputPricePerMTokens +
      draft.llm.averageOutputTokens * draft.llm.outputPricePerMTokens) /
    1_000_000;
  const ttsUnitCost = draft.tts.packagePriceCny / draft.tts.packageCalls;

  async function saveSettings() {
    setSaving(true);
    try {
      await props.onSave({
        ...draft,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  function updateRouting(
    key: keyof ProductionCostSettings["routing"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      routing: {
        ...current.routing,
        [key]: value,
      },
    }));
  }

  function updateDevelopment(
    key: keyof ProductionCostSettings["development"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      development: {
        ...current.development,
        [key]: value,
      },
    }));
  }

  function updateFixedAnnual(
    key: keyof ProductionCostSettings["fixedAnnual"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      fixedAnnual: {
        ...current.fixedAnnual,
        [key]: value,
      },
    }));
  }

  const providerRows = useMemo(() => {
    const groups = new Map<
      string,
      ProviderCostRow & { latencyTotal: number }
    >();
    for (const row of billingRows) {
      const current = groups.get(row.providerId) ?? {
        providerId: row.providerId,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costCny: 0,
        averageLatencyMs: 0,
        latencyTotal: 0,
      };
      current.calls += 1;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.costCny += row.costCny ?? 0;
      current.latencyTotal += row.latencyMs;
      current.averageLatencyMs = Math.round(
        current.latencyTotal / current.calls,
      );
      groups.set(row.providerId, current);
    }
    return Array.from(groups.values()).map(
      ({ latencyTotal: _latencyTotal, ...row }) => row,
    );
  }, [billingRows]);

  const providerColumns: ColumnsType<ProviderCostRow> = [
    { title: "供应商", dataIndex: "providerId", width: 180 },
    { title: "调用次数", dataIndex: "calls", width: 110 },
    { title: "输入 tokens", dataIndex: "inputTokens", width: 140 },
    { title: "输出 tokens", dataIndex: "outputTokens", width: 140 },
    {
      title: "费用",
      dataIndex: "costCny",
      width: 120,
      render: (value) => formatCny(value),
    },
    {
      title: "平均延迟",
      dataIndex: "averageLatencyMs",
      width: 120,
      render: (value) => `${value}ms`,
    },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="生产运维"
        title="生产费用"
        description="按离线、规则、ASR、LLM、TTS的真实链路估算年度运行成本。"
        extra={
          <Space>
            <Button onClick={() => void props.onRefresh()}>刷新日志</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void saveSettings()}
            >
              保存费用参数
            </Button>
          </Space>
        }
      />
      {!billingRows.length && (
        <div className="inline-note">
          <Badge status="default" />
          <Text type="secondary">
            暂无生产 LLM 调用；实际日志和预算模型分开统计。
          </Text>
        </div>
      )}
      <Alert
        type="info"
        showIcon
        title="费用计算链路"
        description={
          <Space orientation="vertical" size={4}>
            <span>
              离线固定命令由离线模块直接控制 MCU，不计入服务器 ASR、LLM、TTS
              费用。
            </span>
            <span>
              每个进入服务器的在线语音请求计 1 次 ASR；简单规则命中不计
              LLM，复杂请求计 1 次 LLM。
            </span>
            <span>
              只有需要语音播报且未命中 TTS 缓存时，才计 1 次 TTS
              服务调用；设备静默执行或命中缓存不产生新的 TTS 调用。
            </span>
          </Space>
        }
      />
      <Card size="small" title="研发阶段费用（可编辑）">
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={developmentRows}
          columns={[
            { title: "费用项目", dataIndex: "label" },
            {
              title: "预算金额（元）",
              width: 220,
              render: (_, row: (typeof developmentRows)[number]) => (
                <InputNumber
                  min={0}
                  precision={2}
                  value={row.value}
                  onChange={(value) =>
                    updateDevelopment(row.key, Number(value ?? 0))
                  }
                />
              ),
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <strong>研发阶段预计合计</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <strong>{formatCnyShort(developmentTotal)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Card>
      <Card size="small" title="链路比例参数（可编辑）">
        <Row gutter={[16, 12]}>
          <Col xs={24} sm={12} xl={6}>
            <Text type="secondary">离线固定命令比例（%）</Text>
            <InputNumber
              min={0}
              max={100}
              value={draft.routing.offlineRatePercent}
              onChange={(value) =>
                updateRouting("offlineRatePercent", Number(value ?? 0))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Text type="secondary">在线规则命中比例（%）</Text>
            <InputNumber
              min={0}
              max={100}
              value={draft.routing.ruleMatchRatePercent}
              onChange={(value) =>
                updateRouting("ruleMatchRatePercent", Number(value ?? 0))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Text type="secondary">在线请求需要播报比例（%）</Text>
            <InputNumber
              min={0}
              max={100}
              value={draft.routing.ttsResponseRatePercent}
              onChange={(value) =>
                updateRouting("ttsResponseRatePercent", Number(value ?? 0))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Text type="secondary">TTS缓存命中比例（%）</Text>
            <InputNumber
              min={0}
              max={100}
              value={draft.routing.ttsCacheHitRatePercent}
              onChange={(value) =>
                updateRouting("ttsCacheHitRatePercent", Number(value ?? 0))
              }
              className="full-width"
            />
          </Col>
        </Row>
        <div className="inline-note" style={{ marginTop: 12 }}>
          <Text type="secondary">
            当前参数代表：80%语音由离线模块处理；在线请求中75%由规则处理，剩余请求先经过知识库，最后才进入
            LLM；固定话术缓存命中率为95%。
          </Text>
        </div>
      </Card>
      <Card size="small" title="生产阶段费用参数（可编辑）">
        <Row gutter={[16, 12]}>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR服务商</Text>
            <Input
              value={draft.asr.providerName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  asr: { ...current.asr, providerName: event.target.value },
                }))
              }
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR单次成本（元）</Text>
            <InputNumber
              min={0}
              precision={6}
              value={draft.asr.pricePerRequestCny}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: {
                    ...current.asr,
                    pricePerRequestCny: Number(value ?? 0),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR平均时长（参考秒）</Text>
            <InputNumber
              min={0.1}
              precision={1}
              value={draft.asr.averageSecondsPerRequest}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: {
                    ...current.asr,
                    averageSecondsPerRequest: Number(value ?? 1),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR计费方式</Text>
            <Select
              value={draft.asr.billingMode}
              options={[
                { label: "按次", value: "PER_REQUEST" },
                { label: "按分钟", value: "PER_MINUTE" },
                { label: "按小时", value: "PER_HOUR" },
                { label: "无持续服务费", value: "NONE" },
              ]}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: { ...current.asr, billingMode: value },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR单价（元/分钟）</Text>
            <InputNumber
              min={0}
              precision={6}
              value={draft.asr.pricePerMinuteCny}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: {
                    ...current.asr,
                    pricePerMinuteCny: Number(value ?? 0),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">ASR单价（元/小时）</Text>
            <InputNumber
              min={0}
              precision={6}
              value={draft.asr.pricePerHourCny}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: { ...current.asr, pricePerHourCny: Number(value ?? 0) },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">离线方案</Text>
            <Select
              value={draft.asr.activeOfflinePlanId}
              options={draft.asr.offlinePlans.map((plan) => ({
                label: plan.name,
                value: plan.id,
              }))}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  asr: { ...current.asr, activeOfflinePlanId: value },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">LLM模型</Text>
            <Select
              value={draft.llm.providerId}
              options={props.providers.map((provider) => ({
                label: provider.name,
                value: provider.id,
              }))}
              onChange={(value) => {
                const provider = props.providers.find(
                  (item) => item.id === value,
                );
                setDraft((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    providerId: value,
                    modelName: provider?.model ?? current.llm.modelName,
                    inputPricePerMTokens:
                      provider?.inputPricePerMTokens ??
                      current.llm.inputPricePerMTokens,
                    outputPricePerMTokens:
                      provider?.outputPricePerMTokens ??
                      current.llm.outputPricePerMTokens,
                  },
                }));
              }}
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">LLM输入价格（元/百万Token）</Text>
            <InputNumber
              min={0}
              precision={4}
              value={draft.llm.inputPricePerMTokens}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    inputPricePerMTokens: Number(value ?? 0),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">LLM输出价格（元/百万Token）</Text>
            <InputNumber
              min={0}
              precision={4}
              value={draft.llm.outputPricePerMTokens}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    outputPricePerMTokens: Number(value ?? 0),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">LLM平均输入Token</Text>
            <InputNumber
              min={0}
              value={draft.llm.averageInputTokens}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    averageInputTokens: Math.round(Number(value ?? 0)),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">LLM平均输出Token</Text>
            <InputNumber
              min={0}
              value={draft.llm.averageOutputTokens}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  llm: {
                    ...current.llm,
                    averageOutputTokens: Math.round(Number(value ?? 0)),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">TTS服务商</Text>
            <Input
              value={draft.tts.providerName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  tts: { ...current.tts, providerName: event.target.value },
                }))
              }
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">TTS套餐次数</Text>
            <InputNumber
              min={1}
              value={draft.tts.packageCalls}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  tts: {
                    ...current.tts,
                    packageCalls: Math.round(Number(value ?? 1)),
                  },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">TTS套餐价格（元）</Text>
            <InputNumber
              min={0}
              precision={2}
              value={draft.tts.packagePriceCny}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  tts: { ...current.tts, packagePriceCny: Number(value ?? 0) },
                }))
              }
              className="full-width"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary">年度固定资源费用</Text>
            <Statistic value={formatCnyShort(fixedAnnualCost)} />
          </Col>
        </Row>
      </Card>
      <Card size="small" title="年度固定资源费用（可编辑）">
        <Row gutter={[16, 12]}>
          {[
            ["serverCny", "服务器", draft.fixedAnnual.serverCny],
            ["domainSslCny", "域名及SSL", draft.fixedAnnual.domainSslCny],
            ["databaseCny", "数据库", draft.fixedAnnual.databaseCny],
            ["miniProgramCny", "微信小程序", draft.fixedAnnual.miniProgramCny],
            ["storageCny", "存储、备份和监控", draft.fixedAnnual.storageCny],
          ].map(([key, label, value]) => (
            <Col xs={24} sm={12} xl={4} key={String(key)}>
              <Text type="secondary">{String(label)}（元/年）</Text>
              <InputNumber
                min={0}
                precision={2}
                value={Number(value)}
                onChange={(nextValue) =>
                  updateFixedAnnual(
                    key as keyof ProductionCostSettings["fixedAnnual"],
                    Number(nextValue ?? 0),
                  )
                }
                className="full-width"
              />
            </Col>
          ))}
        </Row>
      </Card>
      <Card
        size="small"
        title="ASR方案对比"
        extra={
          <Text type="secondary">
            在线：{draft.asr.providerName}；当前规模：
            {selectedDeviceCount.toLocaleString()}台 / 每台每天
            {selectedTurnsPerDeviceDay}次
          </Text>
        }
      >
        <Alert
          type="info"
          showIcon
          title="当前推荐口径：ESP32-C3只做唤醒词和固定指令，完整自然语言交给在线ASR。"
          description="ESP32-S3 + PSRAM属于本地通用语音验证方案，表中单台硬件增量是当前估算值，最终以东信样机BOM和采购报价为准。"
          style={{ marginBottom: 12 }}
        />
        <Table
          size="small"
          scroll={{ x: 1050 }}
          pagination={false}
          rowKey="key"
          dataSource={asrPlanRowsWithPayback}
          columns={[
            {
              title: "实现方式",
              dataIndex: ["plan", "name"],
              width: 230,
              render: (value: string, row: (typeof asrPlanRows)[number]) => (
                <Space orientation="vertical" size={0}>
                  <span>
                    {value}{" "}
                    {row.plan.id === draft.asr.activeOfflinePlanId ? (
                      <Tag color="blue">当前</Tag>
                    ) : null}
                  </span>
                  <Text type="secondary">{row.plan.chipName}</Text>
                </Space>
              ),
            },
            {
              title: "离线能力",
              width: 180,
              render: (_, row: (typeof asrPlanRows)[number]) =>
                row.plan.supportsFreeSpeech
                  ? "支持本地通用语音（待验证）"
                  : "仅固定关键词/指令",
            },
            {
              title: "单台硬件增量",
              width: 130,
              render: (_, row: (typeof asrPlanRows)[number]) =>
                formatCnyShort(row.plan.unitHardwareDeltaCny),
            },
            {
              title: "ASR年运行费",
              width: 130,
              render: (_, row: (typeof asrPlanRows)[number]) =>
                formatCnyShort(row.asrAnnualRunningCost),
            },
            {
              title: "ASR首年费用",
              width: 130,
              render: (_, row: (typeof asrPlanRows)[number]) =>
                formatCnyShort(row.asrFirstYearCost),
            },
            {
              title: "ASR三年累计",
              width: 130,
              render: (_, row: (typeof asrPlanRows)[number]) =>
                formatCnyShort(row.asrThreeYearCost),
            },
            {
              title: "硬件投入回收",
              width: 130,
              render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                row.paybackYears === null
                  ? "-"
                  : `${row.paybackYears.toFixed(1)} 年`,
            },
            {
              title: "验证状态",
              width: 100,
              render: (_, row: (typeof asrPlanRows)[number]) => {
                const labels = {
                  MATURE: "成熟",
                  VALIDATING: "待验证",
                  HIGH_RISK: "风险较高",
                } as const;
                const colors = {
                  MATURE: "green",
                  VALIDATING: "gold",
                  HIGH_RISK: "red",
                } as const;
                return (
                  <Tag color={colors[row.plan.maturity]}>
                    {labels[row.plan.maturity]}
                  </Tag>
                );
              },
            },
          ]}
        />
        <div className="inline-note" style={{ marginTop: 12 }}>
          <Text type="secondary">
            对比表只替换ASR识别路径，不改变后续LLM和TTS口径；硬件投入回收期按替代云端ASR后每年节省的费用估算。
          </Text>
        </div>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card size="small">
            <Statistic
              title="LLM 调用"
              value={billingRows.length}
              suffix="次"
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small">
            <Statistic
              title="实测 LLM 费用"
              value={totalCost}
              precision={6}
              prefix="￥"
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small">
            <Statistic
              title="单次均价"
              value={averageCostPerCall}
              precision={6}
              prefix="￥"
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small">
            <Statistic title="平均延迟" value={averageLatencyMs} suffix="ms" />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card size="small" title="真实链路统计">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="规则命中" value={ruleTurns} />
              </Col>
              <Col span={8}>
                <Statistic title="进入 LLM" value={llmTurns} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="本地命中率"
                  value={measuredLocalRate}
                  suffix="%"
                />
              </Col>
            </Row>
            <Progress
              percent={measuredLocalRate}
              size="small"
              style={{ marginTop: 12 }}
            />
            <Text type="secondary">
              真实日志本地命中率：{measuredLocalRate}%；预算模型规则命中率：
              {draft.routing.ruleMatchRatePercent}%。
            </Text>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card size="small" title="当前场景费用">
            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Text type="secondary">设备数量</Text>
                <Flex gap={8} align="center">
                  <Slider
                    min={1000}
                    max={100000}
                    step={1000}
                    value={selectedDeviceCount}
                    onChange={setSelectedDeviceCount}
                    className="full-width"
                  />
                  <Flex gap={4} align="center">
                    <InputNumber
                      min={1000}
                      max={100000}
                      step={1000}
                      value={selectedDeviceCount}
                      onChange={(value) =>
                        setSelectedDeviceCount(Number(value ?? 1000))
                      }
                      style={{ width: 150 }}
                    />
                    <Text type="secondary">台</Text>
                  </Flex>
                </Flex>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">用户语音次数/台/天</Text>
                <Flex gap={8} align="center">
                  <Slider
                    min={1}
                    max={100}
                    value={selectedTurnsPerDeviceDay}
                    onChange={setSelectedTurnsPerDeviceDay}
                    className="full-width"
                  />
                  <Flex gap={4} align="center">
                    <InputNumber
                      min={1}
                      max={100}
                      value={selectedTurnsPerDeviceDay}
                      onChange={(value) =>
                        setSelectedTurnsPerDeviceDay(Number(value ?? 1))
                      }
                      style={{ width: 120 }}
                    />
                    <Text type="secondary">次</Text>
                  </Flex>
                </Flex>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">预计LLM单次成本</Text>
                <Statistic value={formatCnyShort(llmUnitCost)} />
              </Col>
            </Row>
            <Divider className="compact-divider" />
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Statistic
                  title="年 ASR / LLM / TTS"
                  value={`${formatCount(selectedScenario.asrCalls)} / ${formatCount(selectedScenario.llmCalls)} / ${formatCount(selectedScenario.ttsCalls)}`}
                />
              </Col>
              <Col xs={24} md={6}>
                <Statistic
                  title="ASR-LLM-TTS合计"
                  value={selectedScenario.aiServiceCost}
                  precision={2}
                  prefix="￥"
                />
              </Col>
              <Col xs={24} md={6}>
                <Statistic
                  title="年度固定资源"
                  value={selectedScenario.fixedCost}
                  precision={2}
                  prefix="￥"
                />
              </Col>
              <Col xs={24} md={6}>
                <Statistic
                  title="年度运行费用"
                  value={selectedScenario.totalCost}
                  precision={2}
                  prefix="￥"
                />
              </Col>
            </Row>
            <Descriptions
              size="small"
              column={{ xs: 1, md: 3 }}
              style={{ marginTop: 12 }}
            >
              <Descriptions.Item label="单台年度费用">
                {formatCnyShort(
                  selectedScenario.totalCost / selectedScenario.deviceCount,
                )}
              </Descriptions.Item>
              <Descriptions.Item label="ASR累计时长">
                {formatCount(selectedScenario.asrSeconds)} 秒
              </Descriptions.Item>
              <Descriptions.Item label="离线ASR处理">
                {formatCount(selectedScenario.offlineAsrCalls)} 次
              </Descriptions.Item>
              <Descriptions.Item label="TTS购买套餐数">
                {selectedScenario.ttsPackages} 个
              </Descriptions.Item>
              <Descriptions.Item label="ASR方案">
                {selectedScenario.offlinePlan?.name ?? "未配置"}
              </Descriptions.Item>
              <Descriptions.Item label="首年总费用">
                {formatCnyShort(selectedScenario.firstYearTotalCost)}
              </Descriptions.Item>
              <Descriptions.Item label="三年累计费用">
                {formatCnyShort(selectedScenario.threeYearTotalCost)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
      <Card
        size="small"
        title="年度费用变化趋势"
        extra={
          <Tabs
            size="small"
            activeKey={trendAxis}
            onChange={(key) => setTrendAxis(key as CostTrendAxis)}
            items={[
              { key: "devices", label: "按设备数量" },
              { key: "turns", label: "按每天请求次数" },
            ]}
          />
        }
      >
        <CostTrendChart
          settings={draft}
          axis={trendAxis}
          selectedDeviceCount={selectedDeviceCount}
          selectedTurnsPerDeviceDay={selectedTurnsPerDeviceDay}
        />
      </Card>
      <Card size="small" title="规模与频次年度费用矩阵">
        <Table
          size="small"
          scroll={{ x: 1250 }}
          pagination={false}
          rowKey="key"
          dataSource={scenarios}
          columns={[
            {
              title: "设备数量",
              dataIndex: "deviceCount",
              render: (value) => `${value.toLocaleString()} 台`,
              fixed: "left",
            },
            {
              title: "用户语音/台/天",
              dataIndex: "turnsPerDeviceDay",
              render: (value) => `${value} 次`,
            },
            {
              title: "年在线请求",
              dataIndex: "onlineTurns",
              render: formatCount,
            },
            { title: "ASR调用", dataIndex: "asrCalls", render: formatCount },
            { title: "LLM调用", dataIndex: "llmCalls", render: formatCount },
            {
              title: "TTS计费调用",
              dataIndex: "ttsCalls",
              render: formatCount,
            },
            { title: "ASR费用", dataIndex: "asrCost", render: formatCnyShort },
            { title: "LLM费用", dataIndex: "llmCost", render: formatCnyShort },
            { title: "TTS费用", dataIndex: "ttsCost", render: formatCnyShort },
            {
              title: "ASR-LLM-TTS合计",
              dataIndex: "aiServiceCost",
              render: formatCnyShort,
            },
            {
              title: "固定资源",
              dataIndex: "fixedCost",
              render: formatCnyShort,
            },
            {
              title: "年度合计",
              dataIndex: "totalCost",
              render: (value) => <strong>{formatCnyShort(value)}</strong>,
            },
          ]}
        />
      </Card>
      <Card size="small" title="10万台设备典型场景">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="计算口径">
            每台每天 1 次用户语音
          </Descriptions.Item>
          <Descriptions.Item label="离线处理比例">
            {draft.routing.offlineRatePercent}%
          </Descriptions.Item>
          <Descriptions.Item label="在线规则命中比例">
            {draft.routing.ruleMatchRatePercent}%
          </Descriptions.Item>
          <Descriptions.Item label="年度 ASR 费用">
            {formatCnyShort(typicalScenario.asrCost)}
          </Descriptions.Item>
          <Descriptions.Item label="年度 LLM 费用">
            {formatCnyShort(typicalScenario.llmCost)}
          </Descriptions.Item>
          <Descriptions.Item label="年度 TTS 费用">
            {formatCnyShort(typicalScenario.ttsCost)}
          </Descriptions.Item>
          <Descriptions.Item label="年度 ASR-LLM-TTS合计">
            {formatCnyShort(typicalScenario.aiServiceCost)}
          </Descriptions.Item>
          <Descriptions.Item label="年度固定资源">
            {formatCnyShort(fixedAnnualCost)}
          </Descriptions.Item>
          <Descriptions.Item label="年度预计总费用">
            <strong>{formatCnyShort(typicalScenario.totalCost)}</strong>
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card size="small" title="供应商统计">
        <Table
          rowKey="providerId"
          size="small"
          columns={providerColumns}
          dataSource={providerRows}
          pagination={false}
          locale={{ emptyText: "暂无供应商调用数据" }}
        />
      </Card>
      <Card size="small" title="Token 汇总">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="输入 tokens">
            {totalInputTokens}
          </Descriptions.Item>
          <Descriptions.Item label="输出 tokens">
            {totalOutputTokens}
          </Descriptions.Item>
          <Descriptions.Item label="费用样本">
            {knownCostRows.length}
          </Descriptions.Item>
          <Descriptions.Item label="TTS单次参考">
            {formatCnyShort(ttsUnitCost)}
          </Descriptions.Item>
          <Descriptions.Item label="ASR平均时长">
            {draft.asr.averageSecondsPerRequest}秒
          </Descriptions.Item>
          <Descriptions.Item label="配置更新时间">
            {draft.updatedAt}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

function CostTrendChart(props: {
  settings: ProductionCostSettings;
  axis: CostTrendAxis;
  selectedDeviceCount: number;
  selectedTurnsPerDeviceDay: number;
}) {
  const points = useMemo<ProductionCostTrendPoint[]>(() => {
    const values =
      props.axis === "devices"
        ? Array.from({ length: 20 }, (_, index) =>
            Math.round(1000 + (index * 99000) / 19),
          )
        : Array.from({ length: 20 }, (_, index) =>
            Math.round(1 + (index * 99) / 19),
          );
    return values.map((value) => ({
      x: value,
      scenario: buildProductionCostScenario(
        props.settings,
        props.axis === "devices" ? value : props.selectedDeviceCount,
        props.axis === "turns" ? value : props.selectedTurnsPerDeviceDay,
      ),
    }));
  }, [props]);

  const width = 760;
  const height = 300;
  const padding = { top: 18, right: 18, bottom: 42, left: 76 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue =
    Math.max(
      ...points.flatMap(({ scenario }) =>
        costTrendSeries.map(({ key }) => scenario[key]),
      ),
    ) || 1;
  const yMax = maxValue * 1.08;
  const xMin = points[0]?.x ?? 0;
  const xMax = points[points.length - 1]?.x ?? 1;
  const xPosition = (value: number) =>
    padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * chartWidth;
  const yPosition = (value: number) =>
    padding.top + chartHeight - (value / yMax) * chartHeight;
  const selectedX =
    props.axis === "devices"
      ? props.selectedDeviceCount
      : props.selectedTurnsPerDeviceDay;
  const selectedIndex = points.reduce(
    (closest, point, index) =>
      Math.abs(point.x - selectedX) < Math.abs(points[closest]?.x - selectedX)
        ? index
        : closest,
    0,
  );
  const selectedPoint = points[selectedIndex];

  return (
    <div>
      <div className="cost-chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="语音链路基础成本趋势图"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + chartHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#edf0f5"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#8c8c8c"
                  fontSize="11"
                >
                  {formatCnyShort(yMax * ratio)}
                </text>
              </g>
            );
          })}
          <line
            x1={xPosition(selectedX)}
            x2={xPosition(selectedX)}
            y1={padding.top}
            y2={padding.top + chartHeight}
            stroke="#595959"
            strokeDasharray="4 4"
          />
          {costTrendSeries.map((series) => {
            const pointsValue = points
              .map(
                ({ x, scenario }) =>
                  `${xPosition(x)},${yPosition(scenario[series.key])}`,
              )
              .join(" ");
            return (
              <polyline
                key={series.key}
                points={pointsValue}
                fill="none"
                stroke={series.color}
                strokeWidth={series.key === "variableAiServiceCost" ? 2.5 : 1.8}
              />
            );
          })}
          {selectedPoint ? (
            <circle
              cx={xPosition(selectedPoint.x)}
              cy={yPosition(selectedPoint.scenario.variableAiServiceCost)}
              r="4"
              fill="#f5222d"
              stroke="#fff"
              strokeWidth="2"
            />
          ) : null}
          <text x={padding.left} y={height - 12} fill="#8c8c8c" fontSize="11">
            {props.axis === "devices"
              ? `${xMin.toLocaleString()}台`
              : `${xMin}次/台/天`}
          </text>
          <text
            x={width - padding.right}
            y={height - 12}
            textAnchor="end"
            fill="#8c8c8c"
            fontSize="11"
          >
            {props.axis === "devices"
              ? `${xMax.toLocaleString()}台`
              : `${xMax}次/台/天`}
          </text>
        </svg>
      </div>
      <Space wrap size={[16, 8]}>
        {costTrendSeries.map((series) => (
          <Space key={series.key} size={6}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: series.color,
                display: "inline-block",
              }}
            />
            <Text type="secondary">{series.label}</Text>
          </Space>
        ))}
      </Space>
    </div>
  );
}

function CostEstimatePage(props: { settings: ProductionCostSettings }) {
  const [deviceCount, setDeviceCount] = useState(100000);
  const [turnsPerDeviceDay, setTurnsPerDeviceDay] = useState(10);
  const [serviceYears, setServiceYears] = useState(3);
  const [ttsOptimizationEnabled, setTtsOptimizationEnabled] = useState(false);
  const [ttsOptimizationRatePercent, setTtsOptimizationRatePercent] =
    useState(70);
  const [asrDurationOptimizationEnabled, setAsrDurationOptimizationEnabled] =
    useState(false);
  const [optimizedAsrSeconds, setOptimizedAsrSeconds] = useState(
    Math.min(props.settings.asr.averageSecondsPerRequest, 2),
  );
  const estimateOptions: SimpleCostEstimateOptions = {
    ttsOptimizationEnabled,
    ttsOptimizationRatePercent,
    asrDurationOptimizationEnabled,
    optimizedAsrSeconds,
  };
  const estimate = useMemo(
    () =>
      buildSimpleCostEstimate(
        props.settings,
        deviceCount,
        turnsPerDeviceDay,
        serviceYears,
        estimateOptions,
      ),
    [
      props.settings,
      deviceCount,
      turnsPerDeviceDay,
      serviceYears,
      ttsOptimizationEnabled,
      ttsOptimizationRatePercent,
      asrDurationOptimizationEnabled,
      optimizedAsrSeconds,
    ],
  );
  const serviceYearRows = useMemo(
    () =>
      [1, 2, 3, 5, 10].map((years) => {
        const row = buildSimpleCostEstimate(
          props.settings,
          deviceCount,
          turnsPerDeviceDay,
          years,
          estimateOptions,
        );
        return {
          key: years,
          years,
          asrCost: row.asrCost,
          llmCost: row.llmCost,
          ttsCost: row.ttsCost,
          fullChainCost: row.fullChainCost,
          otherCost: row.otherCost,
          totalCost: row.totalCost,
          singleDeviceVoiceCost: row.singleDeviceVoiceCost,
        };
      }),
    [
      props.settings,
      deviceCount,
      turnsPerDeviceDay,
      ttsOptimizationEnabled,
      ttsOptimizationRatePercent,
      asrDurationOptimizationEnabled,
      optimizedAsrSeconds,
    ],
  );
  const frequencyRows = useMemo(
    () =>
      [1, 3, 5, 10, 20, 50, 100].map((turns) => {
        const rowEstimate = buildSimpleCostEstimate(
          props.settings,
          deviceCount,
          turns,
          serviceYears,
          estimateOptions,
        );
        return {
          key: turns,
          turns,
          singleDeviceVoiceCost: rowEstimate.singleDeviceVoiceCost,
          fullChainCost: rowEstimate.fullChainCost,
        };
      }),
    [
      props.settings,
      deviceCount,
      serviceYears,
      ttsOptimizationEnabled,
      ttsOptimizationRatePercent,
      asrDurationOptimizationEnabled,
      optimizedAsrSeconds,
    ],
  );

  return (
    <Space
      orientation="vertical"
      size={16}
      className="full-width cost-estimate-page"
    >
      <PageIntro
        eyebrow="甲方汇报"
        title="在线语音费用估算"
        description="按一次完整语音闭环计算 ASR、LLM、TTS 单次费用；服务器、域名、数据库等费用按年度单独列出。"
      />
      <Card size="small" title="测算条件">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} xl={8}>
            <Text type="secondary">设备规模</Text>
            <Flex gap={12} align="center">
              <Slider
                min={1}
                max={100000}
                step={1}
                value={deviceCount}
                onChange={(value) => setDeviceCount(Number(value))}
                className="full-width"
              />
              <InputNumber
                min={1}
                max={100000}
                step={1}
                value={deviceCount}
                onChange={(value) => setDeviceCount(Number(value ?? 1))}
                style={{ width: 140 }}
              />
            </Flex>
          </Col>
          <Col xs={24} xl={8}>
            <Text type="secondary">每台每天语音次数</Text>
            <Flex gap={12} align="center">
              <Slider
                min={1}
                max={100}
                value={turnsPerDeviceDay}
                onChange={(value) => setTurnsPerDeviceDay(Number(value))}
                className="full-width"
              />
              <InputNumber
                min={1}
                max={100}
                value={turnsPerDeviceDay}
                onChange={(value) => setTurnsPerDeviceDay(Number(value ?? 1))}
                style={{ width: 120 }}
              />
            </Flex>
          </Col>
          <Col xs={24} xl={8}>
            <Text type="secondary">在线服务年限</Text>
            <Flex gap={12} align="center">
              <Slider
                min={1}
                max={10}
                value={serviceYears}
                onChange={(value) => setServiceYears(Number(value))}
                className="full-width"
              />
              <InputNumber
                min={1}
                max={10}
                value={serviceYears}
                onChange={(value) => setServiceYears(Number(value ?? 1))}
                style={{ width: 100 }}
              />
              <Text type="secondary">年</Text>
            </Flex>
          </Col>
          <Col xs={24} xl={12}>
            <Flex align="center" gap={10}>
              <Checkbox
                checked={ttsOptimizationEnabled}
                onChange={(event) =>
                  setTtsOptimizationEnabled(event.target.checked)
                }
              >
                TTS 优化
              </Checkbox>
              <Tag color={ttsOptimizationEnabled ? "green" : "default"}>
                {ttsOptimizationEnabled
                  ? `减少 ${ttsOptimizationRatePercent}% TTS 调用`
                  : "未启用，按每次调用计算"}
              </Tag>
            </Flex>
            <Flex gap={12} align="center">
              <Slider
                min={0}
                max={100}
                value={ttsOptimizationRatePercent}
                disabled={!ttsOptimizationEnabled}
                onChange={(value) =>
                  setTtsOptimizationRatePercent(Number(value))
                }
                className="full-width"
              />
              <InputNumber
                min={0}
                max={100}
                value={ttsOptimizationRatePercent}
                disabled={!ttsOptimizationEnabled}
                onChange={(value) =>
                  setTtsOptimizationRatePercent(Number(value ?? 0))
                }
                addonAfter="%"
                style={{ width: 130 }}
              />
            </Flex>
            <Text type="secondary">
              固定话术使用本地音频或缓存音频，只有未命中的动态回复调用 TTS。
            </Text>
          </Col>
          <Col xs={24} xl={12}>
            <Flex align="center" gap={10}>
              <Checkbox
                checked={asrDurationOptimizationEnabled}
                onChange={(event) =>
                  setAsrDurationOptimizationEnabled(event.target.checked)
                }
              >
                ASR 有效时长优化
              </Checkbox>
              <Tag color={asrDurationOptimizationEnabled ? "green" : "default"}>
                {asrDurationOptimizationEnabled
                  ? `按 ${optimizedAsrSeconds.toFixed(1)} 秒计算`
                  : `基准 ${props.settings.asr.averageSecondsPerRequest.toFixed(1)} 秒`}
              </Tag>
            </Flex>
            <Flex gap={12} align="center">
              <Slider
                min={0.5}
                max={Math.max(0.5, props.settings.asr.averageSecondsPerRequest)}
                step={0.1}
                value={Math.min(
                  optimizedAsrSeconds,
                  props.settings.asr.averageSecondsPerRequest,
                )}
                disabled={!asrDurationOptimizationEnabled}
                onChange={(value) => setOptimizedAsrSeconds(Number(value))}
                className="full-width"
              />
              <InputNumber
                min={0.5}
                max={Math.max(0.5, props.settings.asr.averageSecondsPerRequest)}
                step={0.1}
                precision={1}
                value={optimizedAsrSeconds}
                disabled={!asrDurationOptimizationEnabled}
                onChange={(value) =>
                  setOptimizedAsrSeconds(Number(value ?? 0.5))
                }
                addonAfter="秒"
                style={{ width: 130 }}
              />
            </Flex>
            <Text type="secondary">
              通过 VAD 和说完即停减少上传的静音、等待和无效音频。
            </Text>
          </Col>
        </Row>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={6}>
          <Card size="small">
            <Statistic
              title="ASR 费用 / 次"
              value={estimate.asrUnitCost}
              precision={6}
              prefix="￥"
            />
            <Text type="secondary">{props.settings.asr.providerName}</Text>
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small">
            <Statistic
              title="LLM 费用 / 次"
              value={estimate.llmUnitCost}
              precision={6}
              prefix="￥"
            />
            <Text type="secondary">{props.settings.llm.modelName}</Text>
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small">
            <Statistic
              title="TTS 费用 / 次"
              value={estimate.ttsUnitCost}
              precision={6}
              prefix="￥"
            />
            <Text type="secondary">
              {props.settings.tts.providerName}，按套餐折算
            </Text>
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small" className="estimate-hero-card">
            <Statistic
              title="ASR + LLM + TTS / 次"
              value={estimate.voiceUnitCost}
              precision={6}
              prefix="￥"
            />
            <Text type="secondary">一次完整在线语音闭环</Text>
          </Card>
        </Col>
      </Row>
      <Card
        size="small"
        title={`${deviceCount.toLocaleString()} 台设备，${serviceYears} 年服务期费用`}
      >
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={[
            {
              key: "asr",
              name: "ASR",
              unitCost: estimate.asrUnitCost,
              periodCost: estimate.asrCost,
              note: "语音输入转文字",
            },
            {
              key: "llm",
              name: "LLM",
              unitCost: estimate.llmUnitCost,
              periodCost: estimate.llmCost,
              note: "自然语言理解与回复",
            },
            {
              key: "tts",
              name: "TTS",
              unitCost: estimate.ttsUnitCost,
              periodCost: estimate.ttsCost,
              note: "文字转语音播报",
            },
            {
              key: "full-chain",
              name: "ASR + LLM + TTS",
              unitCost: estimate.voiceUnitCost,
              periodCost: estimate.fullChainCost,
              note: "一次完整在线语音闭环",
            },
            {
              key: "other",
              name: "其他费用",
              unitCost: null,
              periodCost: estimate.otherCost,
              note: `服务器、域名、数据库等，${formatCnyEstimate(estimate.otherAnnualCost)} / 年`,
            },
            {
              key: "total",
              name: "服务期合计",
              unitCost: null,
              periodCost: estimate.totalCost,
              note: "完整链路费用 + 其他年度费用",
            },
          ]}
          columns={[
            { title: "费用项目", dataIndex: "name", width: 180 },
            {
              title: "单次费用",
              dataIndex: "unitCost",
              width: 150,
              render: (value: number | null) =>
                value === null ? "-" : formatCnyEstimate(value),
            },
            {
              title: "服务期累计费用",
              dataIndex: "periodCost",
              width: 180,
              render: formatCnyEstimate,
            },
            { title: "说明", dataIndex: "note" },
          ]}
        />
        <Divider className="compact-divider" />
        <Descriptions size="small" column={{ xs: 1, md: 4 }}>
          <Descriptions.Item label="服务期总语音次数">
            {formatCount(estimate.totalTurns)}
          </Descriptions.Item>
          <Descriptions.Item label="单台服务期完整链路">
            {formatCnyEstimate(estimate.singleDeviceVoiceCost)}
          </Descriptions.Item>
          <Descriptions.Item label="其他费用 / 年">
            {formatCnyEstimate(estimate.otherAnnualCost)}
          </Descriptions.Item>
          <Descriptions.Item label="其他费用 / 服务期">
            {formatCnyEstimate(estimate.otherCost)}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="服务年限对比">
            <Table
              size="small"
              pagination={false}
              rowKey="years"
              dataSource={serviceYearRows}
              columns={[
                {
                  title: "服务年限",
                  dataIndex: "years",
                  render: (value) => `${value} 年`,
                },
                {
                  title: "单台完整链路",
                  dataIndex: "singleDeviceVoiceCost",
                  render: formatCnyEstimate,
                },
                {
                  title: "全部设备完整链路",
                  dataIndex: "fullChainCost",
                  render: formatCnyEstimate,
                },
                {
                  title: "其他费用",
                  dataIndex: "otherCost",
                  render: formatCnyEstimate,
                },
                {
                  title: "服务期合计",
                  dataIndex: "totalCost",
                  render: formatCnyEstimate,
                },
              ]}
              scroll={{ x: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={`每天语音次数对比（${serviceYears} 年）`}>
            <Table
              size="small"
              pagination={false}
              rowKey="turns"
              dataSource={frequencyRows}
              columns={[
                {
                  title: "每天/台",
                  dataIndex: "turns",
                  render: (value) => `${value} 次`,
                },
                {
                  title: "单台完整链路",
                  dataIndex: "singleDeviceVoiceCost",
                  render: formatCnyEstimate,
                },
                {
                  title: "全部设备完整链路",
                  dataIndex: "fullChainCost",
                  render: formatCnyEstimate,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Alert
        type="info"
        showIcon
        title="汇报建议"
        description={`当前按 ${deviceCount.toLocaleString()} 台、每台每天 ${turnsPerDeviceDay} 次、在线服务 ${serviceYears} 年计算。完整 ASR + LLM + TTS 链路为 ${formatCnyEstimate(estimate.voiceUnitCost)} / 次；服务器、域名、数据库等其他费用为 ${formatCnyEstimate(estimate.otherAnnualCost)} / 年，不摊入单台设备。`}
      />
    </Space>
  );
}

function AsrRangeCostChart(props: {
  series: AsrRangeCostSeries[];
  maxTurns: number;
}) {
  const width = 760;
  const height = 300;
  const padding = { top: 18, right: 28, bottom: 42, left: 82 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const allPoints = props.series.flatMap((series) => series.points);
  const maxValue = Math.max(
    ...allPoints.map((point) => point.threeYearCost),
    1,
  );
  const yMax = maxValue * 1.08;
  const xMin = 1;
  const xMax = Math.max(1, props.maxTurns);
  const xPosition = (value: number) =>
    padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * chartWidth;
  const yPosition = (value: number) =>
    padding.top + chartHeight - (value / yMax) * chartHeight;
  const xTicks = Array.from(
    new Set([1, Math.max(1, Math.round(props.maxTurns / 2)), props.maxTurns]),
  );

  return (
    <div>
      <div className="cost-chart-wrap asr-range-chart">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="10万台ASR三年累计费用对比图"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + chartHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#edf0f5"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#8c8c8c"
                  fontSize="11"
                >
                  {formatCnyShort(yMax * ratio)}
                </text>
              </g>
            );
          })}
          {xTicks.map((value) => (
            <text
              key={value}
              x={xPosition(value)}
              y={height - 12}
              textAnchor="middle"
              fill="#8c8c8c"
              fontSize="11"
            >
              {value}次
            </text>
          ))}
          {props.series.map((series) => {
            const pointsValue = series.points
              .map(
                (point) =>
                  `${xPosition(point.turnsPerDeviceDay)},${yPosition(point.threeYearCost)}`,
              )
              .join(" ");
            const lastPoint = series.points[series.points.length - 1];
            return (
              <g key={series.key}>
                <polyline
                  points={pointsValue}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2.4"
                />
                {lastPoint ? (
                  <>
                    <circle
                      cx={xPosition(lastPoint.turnsPerDeviceDay)}
                      cy={yPosition(lastPoint.threeYearCost)}
                      r="4"
                      fill={series.color}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text
                      x={xPosition(lastPoint.turnsPerDeviceDay) - 6}
                      y={yPosition(lastPoint.threeYearCost) - 8}
                      textAnchor="end"
                      fill={series.color}
                      fontSize="11"
                      fontWeight="600"
                    >
                      {formatCnyShort(lastPoint.threeYearCost)}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <Space wrap size={[16, 8]}>
        {props.series.map((series) => (
          <Space key={series.key} size={6}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: series.color,
                display: "inline-block",
              }}
            />
            <Text type="secondary">{series.name}</Text>
          </Space>
        ))}
      </Space>
    </div>
  );
}

function AsrYearCostChart(props: { series: AsrYearCostSeries[] }) {
  const width = 760;
  const height = 300;
  const padding = { top: 18, right: 28, bottom: 42, left: 82 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const allPoints = props.series.flatMap((series) => series.points);
  const maxValue = Math.max(
    ...allPoints.map((point) => point.cumulativeCost),
    1,
  );
  const yMax = maxValue * 1.08;
  const xMin = 1;
  const xMax = ASR_YEAR_MAX;
  const xPosition = (value: number) =>
    padding.left + ((value - xMin) / Math.max(1, xMax - xMin)) * chartWidth;
  const yPosition = (value: number) =>
    padding.top + chartHeight - (value / yMax) * chartHeight;
  const xTicks = [1, 3, 5, 10];

  return (
    <div>
      <div className="cost-chart-wrap asr-range-chart">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="10万台ASR一到十年累计费用对比图"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + chartHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#edf0f5"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#8c8c8c"
                  fontSize="11"
                >
                  {formatCnyShort(yMax * ratio)}
                </text>
              </g>
            );
          })}
          {xTicks.map((value) => (
            <text
              key={value}
              x={xPosition(value)}
              y={height - 12}
              textAnchor="middle"
              fill="#8c8c8c"
              fontSize="11"
            >
              {value}年
            </text>
          ))}
          {props.series.map((series) => {
            const pointsValue = series.points
              .map(
                (point) =>
                  `${xPosition(point.years)},${yPosition(point.cumulativeCost)}`,
              )
              .join(" ");
            const lastPoint = series.points[series.points.length - 1];
            return (
              <g key={series.key}>
                <polyline
                  points={pointsValue}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2.4"
                />
                {lastPoint ? (
                  <>
                    <circle
                      cx={xPosition(lastPoint.years)}
                      cy={yPosition(lastPoint.cumulativeCost)}
                      r="4"
                      fill={series.color}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text
                      x={xPosition(lastPoint.years) - 6}
                      y={yPosition(lastPoint.cumulativeCost) - 8}
                      textAnchor="end"
                      fill={series.color}
                      fontSize="11"
                      fontWeight="600"
                    >
                      {formatCnyShort(lastPoint.cumulativeCost)}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <Space wrap size={[16, 8]}>
        {props.series.map((series) => (
          <Space key={series.key} size={6}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: series.color,
                display: "inline-block",
              }}
            />
            <Text type="secondary">{series.name}</Text>
          </Space>
        ))}
      </Space>
    </div>
  );
}

function buildProductionCostScenario(
  settings: ProductionCostSettings,
  deviceCount: number,
  turnsPerDeviceDay: number,
): ProductionCostScenario {
  const totalTurns = deviceCount * turnsPerDeviceDay * settings.yearDays;
  const onlineTurns =
    totalTurns * (1 - settings.routing.offlineRatePercent / 100);
  const offlinePlan = getActiveOfflineAsrPlan(settings);
  const offlineAsrRatePercent =
    offlinePlan?.expectedOfflineRatePercent ??
    settings.routing.offlineRatePercent;
  const asrCalls = totalTurns * (1 - offlineAsrRatePercent / 100);
  const offlineAsrCalls = totalTurns - asrCalls;
  const asrSeconds = asrCalls * settings.asr.averageSecondsPerRequest;
  const offlineHardwareCost =
    deviceCount * (offlinePlan?.unitHardwareDeltaCny ?? 0);
  const offlineServiceCost =
    deviceCount * (offlinePlan?.annualServiceCnyPerDevice ?? 0);
  const ruleTurns = onlineTurns * (settings.routing.ruleMatchRatePercent / 100);
  const nonRuleOnlineTurns = onlineTurns - ruleTurns;
  const knowledgeTurns =
    nonRuleOnlineTurns * (settings.routing.knowledgeHitRatePercent / 100);
  const llmCalls = nonRuleOnlineTurns - knowledgeTurns;
  const ttsResponseCalls =
    onlineTurns * (settings.routing.ttsResponseRatePercent / 100);
  const responseCoverage = onlineTurns > 0 ? ttsResponseCalls / onlineTurns : 0;
  const ttsStaticCalls = (ruleTurns + knowledgeTurns) * responseCoverage;
  const ttsDynamicCalls =
    llmCalls *
    responseCoverage *
    (settings.routing.llmTtsResponseRatePercent / 100);
  const ttsCacheHits =
    ttsStaticCalls * (settings.routing.ttsCacheHitRatePercent / 100);
  const ttsCalls = ttsStaticCalls - ttsCacheHits + ttsDynamicCalls;
  const ttsPackages =
    ttsCalls > 0 ? Math.ceil(ttsCalls / settings.tts.packageCalls) : 0;
  const asrCost = calculateAsrServiceCost(settings, asrCalls, asrSeconds);
  const asrFirstYearCost = asrCost + offlineHardwareCost + offlineServiceCost;
  const llmUnitCost =
    (settings.llm.averageInputTokens * settings.llm.inputPricePerMTokens +
      settings.llm.averageOutputTokens * settings.llm.outputPricePerMTokens) /
    1_000_000;
  const llmCost = llmCalls * llmUnitCost;
  const ttsUnitCost = settings.tts.packagePriceCny / settings.tts.packageCalls;
  const ttsVariableCost = ttsCalls * ttsUnitCost;
  const variableAiServiceCost = asrCost + llmCost + ttsVariableCost;
  const voiceChainUnitCost =
    totalTurns > 0 ? variableAiServiceCost / totalTurns : 0;
  const ttsCost = ttsPackages * settings.tts.packagePriceCny;
  const aiServiceCost = asrCost + llmCost + ttsCost;
  const fixedCost = sumFixedAnnualCost(settings);
  const firstYearTotalCost =
    aiServiceCost + fixedCost + offlineHardwareCost + offlineServiceCost;
  const threeYearTotalCost =
    aiServiceCost * 3 +
    fixedCost * 3 +
    offlineHardwareCost +
    offlineServiceCost * 3;

  return {
    key: `${deviceCount}-${turnsPerDeviceDay}`,
    deviceCount,
    turnsPerDeviceDay,
    totalTurns,
    onlineTurns,
    offlineAsrCalls,
    asrCalls,
    asrSeconds,
    offlinePlan,
    offlineHardwareCost,
    offlineServiceCost,
    ruleTurns,
    knowledgeTurns,
    llmCalls,
    ttsResponseCalls,
    ttsCacheHits,
    ttsStaticCalls,
    ttsDynamicCalls,
    ttsCalls,
    ttsPackages,
    asrCost,
    ttsUnitCost,
    ttsVariableCost,
    variableAiServiceCost,
    voiceChainUnitCost,
    asrFirstYearCost,
    llmCost,
    ttsCost,
    aiServiceCost,
    fixedCost,
    totalCost: aiServiceCost + fixedCost,
    firstYearTotalCost,
    threeYearTotalCost,
  };
}

function buildSimpleCostEstimate(
  settings: ProductionCostSettings,
  deviceCount: number,
  turnsPerDeviceDay: number,
  years: number,
  options: SimpleCostEstimateOptions = {
    ttsOptimizationEnabled: false,
    ttsOptimizationRatePercent: 0,
    asrDurationOptimizationEnabled: false,
    optimizedAsrSeconds: settings.asr.averageSecondsPerRequest,
  },
): SimpleCostEstimate {
  const normalizedDeviceCount = Math.max(1, Math.round(deviceCount));
  const normalizedTurnsPerDeviceDay = Math.max(
    1,
    Math.round(turnsPerDeviceDay),
  );
  const normalizedYears = Math.max(1, Math.round(years));
  const totalTurns =
    normalizedDeviceCount *
    normalizedTurnsPerDeviceDay *
    settings.yearDays *
    normalizedYears;
  const asrSecondsPerRequest = options.asrDurationOptimizationEnabled
    ? Math.min(
        settings.asr.averageSecondsPerRequest,
        Math.max(0.5, options.optimizedAsrSeconds),
      )
    : settings.asr.averageSecondsPerRequest;
  const asrUnitCost = calculateAsrServiceCost(
    settings,
    1,
    asrSecondsPerRequest,
  );
  const llmUnitCost =
    (settings.llm.averageInputTokens * settings.llm.inputPricePerMTokens +
      settings.llm.averageOutputTokens * settings.llm.outputPricePerMTokens) /
    1_000_000;
  const baseTtsUnitCost =
    settings.tts.packageCalls > 0
      ? settings.tts.packagePriceCny / settings.tts.packageCalls
      : 0;
  const ttsOptimizationRate = options.ttsOptimizationEnabled
    ? Math.min(100, Math.max(0, options.ttsOptimizationRatePercent)) / 100
    : 0;
  const ttsUnitCost = baseTtsUnitCost * (1 - ttsOptimizationRate);
  const voiceUnitCost = asrUnitCost + llmUnitCost + ttsUnitCost;
  const asrCost = asrUnitCost * totalTurns;
  const llmCost = llmUnitCost * totalTurns;
  const ttsCost = ttsUnitCost * totalTurns;
  const fullChainCost = voiceUnitCost * totalTurns;
  const otherAnnualCost = sumFixedAnnualCost(settings);
  const otherCost = otherAnnualCost * normalizedYears;

  return {
    deviceCount: normalizedDeviceCount,
    turnsPerDeviceDay: normalizedTurnsPerDeviceDay,
    years: normalizedYears,
    totalTurns,
    asrUnitCost,
    llmUnitCost,
    ttsUnitCost,
    voiceUnitCost,
    asrCost,
    llmCost,
    ttsCost,
    fullChainCost,
    otherAnnualCost,
    otherCost,
    totalCost: fullChainCost + otherCost,
    singleDeviceVoiceCost: fullChainCost / normalizedDeviceCount,
  };
}

function calculateCompleteOnlineUnitCost(
  settings: ProductionCostSettings,
): number {
  const asrCost = calculateAsrServiceCost(
    settings,
    1,
    settings.asr.averageSecondsPerRequest,
  );
  const llmCost =
    (settings.llm.averageInputTokens * settings.llm.inputPricePerMTokens +
      settings.llm.averageOutputTokens * settings.llm.outputPricePerMTokens) /
    1_000_000;
  const ttsCost = settings.tts.packagePriceCny / settings.tts.packageCalls;
  return asrCost + llmCost + ttsCost;
}

function buildCompressionBaselineSettings(
  settings: ProductionCostSettings,
): ProductionCostSettings {
  return {
    ...settings,
    routing: {
      ...settings.routing,
      offlineRatePercent: 0,
      ruleMatchRatePercent: 0,
      knowledgeHitRatePercent: 0,
      ttsResponseRatePercent: 100,
      llmTtsResponseRatePercent: 100,
      ttsCacheHitRatePercent: 0,
    },
  };
}

function getActiveOfflineAsrPlan(
  settings: ProductionCostSettings,
): AsrOfflinePlan | null {
  return (
    settings.asr.offlinePlans.find(
      (plan) => plan.id === settings.asr.activeOfflinePlanId,
    ) ??
    settings.asr.offlinePlans[0] ??
    null
  );
}

function calculateAsrServiceCost(
  settings: ProductionCostSettings,
  asrCalls: number,
  asrSeconds: number,
): number {
  switch (settings.asr.billingMode) {
    case "PER_MINUTE":
      return (asrSeconds / 60) * settings.asr.pricePerMinuteCny;
    case "PER_HOUR":
      return (asrSeconds / 3600) * settings.asr.pricePerHourCny;
    case "NONE":
      return 0;
    case "PER_REQUEST":
    default:
      return asrCalls * settings.asr.pricePerRequestCny;
  }
}

function calculateAsrCumulativeCost(
  scenario: ProductionCostScenario,
  years: number,
): number {
  const annualRunningCost = scenario.asrCost + scenario.offlineServiceCost;
  return scenario.offlineHardwareCost + annualRunningCost * years;
}

function calculateScenarioCumulativeCost(
  scenario: ProductionCostScenario,
  years: number,
): number {
  return (
    scenario.offlineHardwareCost +
    (scenario.aiServiceCost +
      scenario.fixedCost +
      scenario.offlineServiceCost) *
      years
  );
}

function sumDevelopmentCost(settings: ProductionCostSettings): number {
  return Object.values(settings.development).reduce(
    (sum, value) => sum + value,
    0,
  );
}

function sumFixedAnnualCost(settings: ProductionCostSettings): number {
  return Object.values(settings.fixedAnnual).reduce(
    (sum, value) => sum + value,
    0,
  );
}

function formatCnyShort(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (value > 0 && value < 1) {
    return `￥${value.toFixed(6)}`;
  }
  if (value >= 10000) {
    return `￥${(value / 10000).toFixed(2)}万`;
  }
  if (value >= 1000) {
    return `￥${(value / 1000).toFixed(2)}k`;
  }
  return `￥${value.toFixed(2)}`;
}

function formatCnyEstimate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (value > 0 && value < 1) {
    return `￥${value.toFixed(6)}`;
  }
  if (value >= 10000) {
    return `￥${(value / 10000).toFixed(2)}万`;
  }
  return `￥${value.toLocaleString("zh-CN", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })}`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Math.round(value).toLocaleString();
}

function parseBillingUsage(log: SystemLog): BillingUsageRow | null {
  const usage = readRecord(log.payload.usage);
  if (!usage) {
    return null;
  }
  return {
    id: log.id,
    createdAt: log.createdAt,
    providerId:
      readString(log.payload.providerId) ||
      readString(usage.providerId) ||
      "unknown",
    inputTokens: readNumberValue(usage.inputTokens) ?? 0,
    outputTokens: readNumberValue(usage.outputTokens) ?? 0,
    costCny: readNumberValue(usage.costCny),
    latencyMs:
      readNumberValue(log.payload.latencyMs) ??
      readNumberValue(usage.latencyMs) ??
      0,
    isEstimated: Boolean(usage.isEstimated),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function LogsPage(props: {
  logs: SystemLog[];
  onRefresh: () => Promise<void>;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const filteredLogs =
    typeFilter === "ALL"
      ? props.logs
      : props.logs.filter((log) => log.type === typeFilter);
  const errorCount = props.logs.filter((log) => log.type === "ERROR").length;
  const voiceCount = props.logs.filter((log) => log.type === "VOICE").length;
  const runtimeCount = props.logs.filter(
    (log) => readString(log.payload.billingSource) === "RUNTIME",
  ).length;

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="运行痕迹"
        title="运行日志"
        description="集中查看 AI、设备、知识库、主动沟通和错误记录。"
        extra={<Button onClick={() => void props.onRefresh()}>刷新</Button>}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="日志总数" value={props.logs.length} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="语音记录" value={voiceCount} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="生产链路" value={runtimeCount} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <KpiCard title="错误记录" value={errorCount} />
        </Col>
      </Row>
      <Card size="small" title="日志列表">
        <Space style={{ marginBottom: 12 }}>
          <Select
            value={typeFilter}
            style={{ width: 180 }}
            onChange={setTypeFilter}
            options={[
              { label: "全部", value: "ALL" },
              { label: "语音", value: "VOICE" },
              { label: "AI", value: "AI" },
              { label: "设备", value: "DEVICE" },
              { label: "命令", value: "COMMAND" },
              { label: "知识库", value: "KNOWLEDGE" },
              { label: "主动沟通", value: "PROACTIVE" },
              { label: "错误", value: "ERROR" },
            ]}
          />
        </Space>
        <Table
          rowKey="id"
          size="small"
          columns={[
            { title: "时间", dataIndex: "createdAt", width: 220 },
            {
              title: "类型",
              dataIndex: "type",
              width: 120,
              render: (value) => <Tag>{value}</Tag>,
            },
            { title: "摘要", dataIndex: "summary", width: 260 },
            {
              title: "payload",
              render: (_, log) => (
                <pre
                  className="json-panel"
                  style={{ maxWidth: 420, margin: 0 }}
                >
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              ),
            },
          ]}
          dataSource={filteredLogs}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: "暂无日志" }}
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
    { title: "类别", dataIndex: "category", width: 140 },
    { title: "测试输入", dataIndex: "inputText", ellipsis: true },
    {
      title: "期望意图",
      dataIndex: "expectedIntent",
      width: 180,
      render: (value) => value || "无设备动作",
    },
    { title: "风险", dataIndex: "riskLevel", width: 100 },
    { title: "备注", dataIndex: "notes", ellipsis: true },
  ];

  const promptColumns: ColumnsType<PromptVersion> = [
    { title: "名称", dataIndex: "name", width: 240 },
    {
      title: "版本",
      dataIndex: "version",
      width: 90,
      render: (value) => `v${value}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value) => (
        <Tag color={value === "ACTIVE" ? "green" : "default"}>{value}</Tag>
      ),
    },
    { title: "创建时间", dataIndex: "createdAt", width: 220 },
  ];

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <PageIntro
        eyebrow="JSON 文件存储"
        title="测试数据归档"
        description="旧版数据查看组件已不作为主入口，测试集和评测记录统一在“意图测试”中操作。"
      />
      <Tabs
        items={[
          {
            key: "test-cases",
            label: `测试集（${props.testCases.length}）`,
            children: (
              <Card size="small" title="意图测试语料">
                <Table
                  rowKey="id"
                  columns={testCaseColumns}
                  dataSource={props.testCases}
                  pagination={{ pageSize: 10 }}
                />
              </Card>
            ),
          },
          {
            key: "prompts",
            label: `Prompt（${props.prompts.length}）`,
            children: (
              <Space orientation="vertical" size={12} className="full-width">
                <Card size="small" title="Prompt 版本">
                  <Table
                    rowKey="id"
                    columns={promptColumns}
                    dataSource={props.prompts}
                    pagination={false}
                  />
                </Card>
                {props.prompts.map((prompt) => (
                  <Card
                    key={prompt.id}
                    size="small"
                    title={`${prompt.name} v${prompt.version}`}
                  >
                    <pre className="prompt-panel">{prompt.systemPrompt}</pre>
                  </Card>
                ))}
              </Space>
            ),
          },
          {
            key: "evaluations",
            label: `评测记录（${props.evaluations.length}）`,
            children: <EvaluationHistory evaluations={props.evaluations} />,
          },
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
        role: item.role === "user" ? "user" : "ai",
        content: item.content,
      })),
    [props.messages],
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
                  placement: "start",
                  avatar: <ApiOutlined />,
                },
                user: {
                  placement: "end",
                },
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
          <MetricRow
            label="模型意图"
            value={result.aiResult.intent || result.aiResult.resultType}
          />
          <MetricRow
            label="置信度"
            value={`${Math.round(result.aiResult.confidence * 100)}%`}
          />
          <MetricRow label="安全决策" value={result.safetyResult.decision} />
          <MetricRow label="响应延迟" value={`${result.latencyMs}ms`} />
          <Alert type="info" title={result.safetyResult.reason} showIcon />
          <pre className="json-panel">
            {JSON.stringify(result.aiResult, null, 2)}
          </pre>
        </Space>
      ) : (
        <Text type="secondary">
          运行一次单句测试后显示模型 JSON 和规则结果。
        </Text>
      )}
    </Card>
  );
}

function EvaluationLab(props: {
  testCases: TestCase[];
  latestEvaluation?: EvaluationRun;
  isEvaluating: boolean;
  onRunEvaluation: (input?: {
    providerIds?: string[];
    testSetId?: string;
    promptId?: string;
    testCaseIds?: string[];
  }) => Promise<EvaluationRun>;
}) {
  const passRate = props.latestEvaluation?.summary.total
    ? Math.round(
        (props.latestEvaluation.summary.passed /
          props.latestEvaluation.summary.total) *
          100,
      )
    : 0;

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic
              title="测试语料"
              value={props.testCases.length}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic
              title="最近通过率"
              value={passRate}
              suffix="%"
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic
              title="平均延迟"
              value={props.latestEvaluation?.summary.averageLatencyMs || 0}
              suffix="ms"
            />
          </Card>
        </Col>
      </Row>
      <Card
        title="批量评测"
        extra={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={props.isEvaluating}
            onClick={() => void props.onRunEvaluation()}
          >
            运行当前模型
          </Button>
        }
      >
        {props.latestEvaluation ? (
          <Space orientation="vertical" size={16} className="full-width">
            <Progress
              percent={passRate}
              status={passRate >= 95 ? "success" : "active"}
            />
            <EvaluationItemsTable run={props.latestEvaluation} />
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            title="还没有评测记录，先运行一次当前模型。"
          />
        )}
      </Card>
    </Space>
  );
}

function EvaluationItemsTable(props: { run: EvaluationRun }) {
  const columns: ColumnsType<EvaluationRun["items"][number]> = [
    { title: "输入", dataIndex: "inputText", ellipsis: true },
    { title: "期望", dataIndex: "expectedIntent", width: 150 },
    {
      title: "模型输出",
      width: 150,
      render: (_, item) =>
        item.aiResult?.intent || item.aiResult?.resultType || "-",
    },
    {
      title: "规则",
      width: 150,
      render: (_, item) => item.safetyResult?.decision || "-",
    },
    {
      title: "结果",
      width: 96,
      render: (_, item) => (
        <Tag color={item.isMatch ? "green" : "red"}>
          {item.isMatch ? "通过" : "失败"}
        </Tag>
      ),
    },
  ];

  return (
    <Table
      rowKey={(item) => `${item.providerId}-${item.testCaseId}`}
      columns={columns}
      dataSource={props.run.items}
      pagination={{ pageSize: 6 }}
    />
  );
}

function ProviderTable(props: { providers: ModelProvider[] }) {
  const columns: ColumnsType<ModelProvider> = [
    { title: "供应商", dataIndex: "name" },
    { title: "类型", dataIndex: "type", width: 170 },
    {
      title: "状态",
      width: 100,
      render: (_, provider) => (
        <Tag color={provider.enabled ? "green" : "orange"}>
          {provider.enabled ? "启用" : "待配置"}
        </Tag>
      ),
    },
    { title: "模型", dataIndex: "model" },
    {
      title: "Key 环境变量",
      dataIndex: "apiKeyEnv",
      width: 160,
      render: (value) => value || "-",
    },
    {
      title: "Key 入口",
      width: 110,
      render: (_, provider) =>
        provider.apiKeyUrl ? (
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开
          </Button>
        ) : (
          "-"
        ),
    },
    { title: "说明", dataIndex: "notes", ellipsis: true },
  ];

  return (
    <Card title="模型供应商配置">
      <Alert
        type="warning"
        showIcon
        title="真实 API Key 只放在 apps/api/.env；页面只展示环境变量名，不展示密钥。"
      />
      <Table
        className="spaced-table"
        rowKey="id"
        columns={columns}
        dataSource={props.providers}
        pagination={false}
      />
    </Card>
  );
}

function EvaluationHistory(props: { evaluations: EvaluationRun[] }) {
  const columns: ColumnsType<EvaluationRun> = [
    { title: "完成时间", dataIndex: "completedAt", width: 230 },
    { title: "Prompt", dataIndex: "promptId", width: 220 },
    {
      title: "模型",
      dataIndex: "providerIds",
      width: 180,
      render: (value: string[]) => value.join(", "),
    },
    {
      title: "结果",
      width: 120,
      render: (_, run) => (
        <Tag color={run.summary.failed === 0 ? "green" : "red"}>
          {run.summary.passed}/{run.summary.total}
        </Tag>
      ),
    },
    {
      title: "平均延迟",
      width: 110,
      render: (_, run) => `${run.summary.averageLatencyMs}ms`,
    },
  ];

  return (
    <Card title="最近评测记录">
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={props.evaluations}
        pagination={{ pageSize: 8 }}
        locale={{ emptyText: "暂无评测记录" }}
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

function CostCenterPage(props: {
  logs: SystemLog[];
  providers: ModelProvider[];
  settings: ProductionCostSettings;
  onSave: (settings: ProductionCostSettings) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProductionCostSettings>(props.settings);
  const [selectedDeviceCount, setSelectedDeviceCount] = useState(100000);
  const [selectedTurnsPerDeviceDay, setSelectedTurnsPerDeviceDay] = useState(1);
  const [asrRangeMaxTurns, setAsrRangeMaxTurns] = useState(30);
  const [asrYearTurnsPerDeviceDay, setAsrYearTurnsPerDeviceDay] = useState(1);
  const [trendAxis, setTrendAxis] = useState<CostTrendAxis>("devices");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  const runtimeLogs = useMemo(
    () =>
      props.logs.filter(
        (log) => readString(log.payload.billingSource) === "RUNTIME",
      ),
    [props.logs],
  );
  const voiceLogs = useMemo(
    () => runtimeLogs.filter((log) => log.type === "VOICE"),
    [runtimeLogs],
  );
  const aiUsageRows = useMemo(
    () =>
      runtimeLogs
        .filter((log) => log.type === "AI")
        .map(parseBillingUsage)
        .filter((row): row is BillingUsageRow => Boolean(row)),
    [runtimeLogs],
  );
  const voiceUsageRows = useMemo(
    () =>
      voiceLogs
        .filter((log) => readString(log.payload.source) === "llm")
        .map(parseBillingUsage)
        .filter((row): row is BillingUsageRow => Boolean(row)),
    [voiceLogs],
  );
  const billingRows = aiUsageRows.length ? aiUsageRows : voiceUsageRows;
  const knownCostRows = billingRows.filter(
    (row) => typeof row.costCny === "number",
  );
  const totalMeasuredCost = knownCostRows.reduce(
    (sum, row) => sum + (row.costCny ?? 0),
    0,
  );
  const totalInputTokens = billingRows.reduce(
    (sum, row) => sum + row.inputTokens,
    0,
  );
  const totalOutputTokens = billingRows.reduce(
    (sum, row) => sum + row.outputTokens,
    0,
  );
  const averageCostPerCall = knownCostRows.length
    ? totalMeasuredCost / knownCostRows.length
    : 0;
  const averageLatencyMs = billingRows.length
    ? Math.round(
        billingRows.reduce((sum, row) => sum + row.latencyMs, 0) /
          billingRows.length,
      )
    : 0;
  const ruleTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "rule",
  ).length;
  const knowledgeTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "knowledge",
  ).length;
  const llmTurns = voiceLogs.filter(
    (log) => readString(log.payload.source) === "llm",
  ).length;
  const measuredVoiceTurns = ruleTurns + knowledgeTurns + llmTurns;
  const measuredLocalRate = measuredVoiceTurns
    ? Math.round(((ruleTurns + knowledgeTurns) / measuredVoiceTurns) * 100)
    : 0;

  const scenarios = useMemo(
    () =>
      [1000, 10000, 100000].flatMap((deviceCount) =>
        [1, 10, 100].map((turnsPerDeviceDay) =>
          buildProductionCostScenario(draft, deviceCount, turnsPerDeviceDay),
        ),
      ),
    [draft],
  );
  const selectedScenario = useMemo(
    () =>
      buildProductionCostScenario(
        draft,
        selectedDeviceCount,
        selectedTurnsPerDeviceDay,
      ),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const warrantyCostRows = useMemo<WarrantyCostRow[]>(
    () =>
      [3, 5].map((years) => {
        const asrCost = selectedScenario.asrCost * years;
        const llmCost = selectedScenario.llmCost * years;
        const ttsCost = selectedScenario.ttsCost * years;
        const aiServiceCost = asrCost + llmCost + ttsCost;
        const fixedCost = selectedScenario.fixedCost * years;
        const offlineHardwareCost = selectedScenario.offlineHardwareCost;
        const offlineServiceCost = selectedScenario.offlineServiceCost * years;
        const totalCost =
          aiServiceCost + fixedCost + offlineHardwareCost + offlineServiceCost;
        const unitDeviceCost =
          (aiServiceCost + offlineHardwareCost + offlineServiceCost) /
          selectedScenario.deviceCount;
        return {
          years: years as 3 | 5,
          label: `${years} 年质保`,
          asrCost,
          llmCost,
          ttsCost,
          aiServiceCost,
          fixedCost,
          offlineHardwareCost,
          offlineServiceCost,
          totalCost,
          unitDeviceCost,
          annualUnitDeviceCost: unitDeviceCost / years,
          unitAiServiceCost: aiServiceCost / selectedScenario.deviceCount,
        };
      }),
    [selectedScenario],
  );
  const baselineScenario = useMemo(
    () =>
      buildProductionCostScenario(
        buildCompressionBaselineSettings(draft),
        selectedDeviceCount,
        selectedTurnsPerDeviceDay,
      ),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const typicalScenario = useMemo(
    () => buildProductionCostScenario(draft, 100000, 1),
    [draft],
  );
  const typicalBaselineScenario = useMemo(
    () =>
      buildProductionCostScenario(
        buildCompressionBaselineSettings(draft),
        100000,
        1,
      ),
    [draft],
  );

  const asrPlanRows = useMemo(
    () =>
      draft.asr.offlinePlans.map((plan) => {
        const planSettings: ProductionCostSettings = {
          ...draft,
          asr: {
            ...draft.asr,
            activeOfflinePlanId: plan.id,
          },
        };
        const scenario = buildProductionCostScenario(
          planSettings,
          selectedDeviceCount,
          selectedTurnsPerDeviceDay,
        );
        return {
          key: plan.id,
          plan,
          scenario,
          asrAnnualRunningCost: scenario.asrCost + scenario.offlineServiceCost,
          asrFirstYearCost: scenario.asrFirstYearCost,
          asrThreeYearCost:
            scenario.asrCost * 3 +
            scenario.offlineHardwareCost +
            scenario.offlineServiceCost * 3,
        };
      }),
    [draft, selectedDeviceCount, selectedTurnsPerDeviceDay],
  );
  const asrBaselineRow = asrPlanRows.find(
    (row) => row.plan.architecture === "HYBRID_CLOUD_ASR",
  );
  const asrPlanRowsWithPayback = asrPlanRows.map((row) => {
    if (!asrBaselineRow || row.key === asrBaselineRow.key) {
      return { ...row, paybackYears: null as number | null };
    }
    const annualSaving =
      asrBaselineRow.asrAnnualRunningCost - row.asrAnnualRunningCost;
    return {
      ...row,
      paybackYears:
        annualSaving > 0 && row.scenario.offlineHardwareCost > 0
          ? row.scenario.offlineHardwareCost / annualSaving
          : null,
    };
  });
  const asrRangeSeries = useMemo<AsrRangeCostSeries[]>(
    () =>
      draft.asr.offlinePlans.map((plan, index) => {
        const planSettings: ProductionCostSettings = {
          ...draft,
          asr: {
            ...draft.asr,
            activeOfflinePlanId: plan.id,
          },
        };
        const points = Array.from(
          { length: asrRangeMaxTurns },
          (_, turnIndex) => {
            const turnsPerDeviceDay = turnIndex + 1;
            const scenario = buildProductionCostScenario(
              planSettings,
              ASR_RANGE_DEVICE_COUNT,
              turnsPerDeviceDay,
            );
            return {
              key: `${plan.id}-${turnsPerDeviceDay}`,
              turnsPerDeviceDay,
              scenario,
              annualRunningCost: scenario.asrCost + scenario.offlineServiceCost,
              firstYearCost: scenario.asrFirstYearCost,
              threeYearCost: calculateAsrCumulativeCost(scenario, 3),
            };
          },
        );

        return {
          key: plan.id,
          name: plan.name,
          color: asrRangeColors[index % asrRangeColors.length],
          plan,
          points,
        };
      }),
    [draft, asrRangeMaxTurns],
  );
  const asrRangeSummaryRows = useMemo(() => {
    const milestoneSet = new Set(
      [1, 5, 10, 20, asrRangeMaxTurns].filter(
        (value) => value <= asrRangeMaxTurns,
      ),
    );
    const milestones = Array.from(milestoneSet).sort((a, b) => a - b);
    const baselineSeries =
      asrRangeSeries.find(
        (series) => series.plan.architecture === "HYBRID_CLOUD_ASR",
      ) ?? asrRangeSeries[0];

    return milestones.flatMap((turnsPerDeviceDay) =>
      asrRangeSeries.map((series) => {
        const point = series.points.find(
          (item) => item.turnsPerDeviceDay === turnsPerDeviceDay,
        );
        const baselinePoint = baselineSeries?.points.find(
          (item) => item.turnsPerDeviceDay === turnsPerDeviceDay,
        );
        const annualSaving =
          (baselinePoint?.annualRunningCost ?? 0) -
          (point?.annualRunningCost ?? 0);
        return {
          key: `${series.key}-${turnsPerDeviceDay}`,
          turnsPerDeviceDay,
          planName: series.name,
          color: series.color,
          annualRunningCost: point?.annualRunningCost ?? 0,
          firstYearCost: point?.firstYearCost ?? 0,
          threeYearCost: point?.threeYearCost ?? 0,
          paybackYears:
            annualSaving > 0 && (point?.scenario.offlineHardwareCost ?? 0) > 0
              ? (point?.scenario.offlineHardwareCost ?? 0) / annualSaving
              : null,
        };
      }),
    );
  }, [asrRangeMaxTurns, asrRangeSeries]);
  const asrYearSeries = useMemo<AsrYearCostSeries[]>(
    () =>
      draft.asr.offlinePlans.map((plan, index) => {
        const planSettings: ProductionCostSettings = {
          ...draft,
          asr: {
            ...draft.asr,
            activeOfflinePlanId: plan.id,
          },
        };
        const scenario = buildProductionCostScenario(
          planSettings,
          ASR_RANGE_DEVICE_COUNT,
          asrYearTurnsPerDeviceDay,
        );
        const annualRunningCost =
          scenario.asrCost + scenario.offlineServiceCost;
        const points = Array.from({ length: ASR_YEAR_MAX }, (_, yearIndex) => {
          const years = yearIndex + 1;
          return {
            key: `${plan.id}-${years}`,
            years,
            scenario,
            annualRunningCost,
            cumulativeCost: calculateAsrCumulativeCost(scenario, years),
          };
        });

        return {
          key: plan.id,
          name: plan.name,
          color: asrRangeColors[index % asrRangeColors.length],
          plan,
          points,
        };
      }),
    [draft, asrYearTurnsPerDeviceDay],
  );
  const asrYearSummaryRows = useMemo(() => {
    const milestones = [1, 3, 5, 10];
    const baselineSeries =
      asrYearSeries.find(
        (series) => series.plan.architecture === "HYBRID_CLOUD_ASR",
      ) ?? asrYearSeries[0];

    return milestones.flatMap((years) =>
      asrYearSeries.map((series) => {
        const point = series.points.find((item) => item.years === years);
        const baselinePoint = baselineSeries?.points.find(
          (item) => item.years === years,
        );
        return {
          key: `${series.key}-${years}`,
          years,
          planName: series.name,
          color: series.color,
          annualRunningCost: point?.annualRunningCost ?? 0,
          cumulativeCost: point?.cumulativeCost ?? 0,
          baselineDiff:
            (point?.cumulativeCost ?? 0) - (baselinePoint?.cumulativeCost ?? 0),
        };
      }),
    );
  }, [asrYearSeries]);

  const developmentRows: Array<{
    key: keyof ProductionCostSettings["development"];
    label: string;
    value: number;
  }> = [
    { key: "llmCny", label: "LLM 联调与测试", value: draft.development.llmCny },
    { key: "asrCny", label: "ASR 联调与测试", value: draft.development.asrCny },
    { key: "ttsCny", label: "TTS 联调与测试", value: draft.development.ttsCny },
    {
      key: "serverCny",
      label: "服务器、域名、数据库",
      value: draft.development.serverCny,
    },
    {
      key: "miniProgramCny",
      label: "微信小程序认证与接入",
      value: draft.development.miniProgramCny,
    },
    {
      key: "hardwareCny",
      label: "开发板、样机联调耗材",
      value: draft.development.hardwareCny,
    },
    {
      key: "otherCny",
      label: "其他测试支出",
      value: draft.development.otherCny,
    },
  ];
  const fixedAnnualRows: Array<{
    key: keyof ProductionCostSettings["fixedAnnual"];
    label: string;
    value: number;
  }> = [
    { key: "serverCny", label: "服务器", value: draft.fixedAnnual.serverCny },
    {
      key: "databaseCny",
      label: "数据库",
      value: draft.fixedAnnual.databaseCny,
    },
    {
      key: "domainSslCny",
      label: "域名及 SSL",
      value: draft.fixedAnnual.domainSslCny,
    },
    {
      key: "miniProgramCny",
      label: "微信小程序",
      value: draft.fixedAnnual.miniProgramCny,
    },
    {
      key: "storageCny",
      label: "存储、备份和监控",
      value: draft.fixedAnnual.storageCny,
    },
  ];
  const developmentTotal = sumDevelopmentCost(draft);
  const fixedAnnualCost = sumFixedAnnualCost(draft);
  const llmUnitCost =
    (draft.llm.averageInputTokens * draft.llm.inputPricePerMTokens +
      draft.llm.averageOutputTokens * draft.llm.outputPricePerMTokens) /
    1_000_000;
  const ttsUnitCost = draft.tts.packagePriceCny / draft.tts.packageCalls;
  const selectedOptimizationSavings =
    baselineScenario.totalCost - selectedScenario.totalCost;
  const selectedThreeYearSavings =
    baselineScenario.threeYearTotalCost - selectedScenario.threeYearTotalCost;
  const selectedOptimizationRate =
    baselineScenario.totalCost > 0
      ? selectedOptimizationSavings / baselineScenario.totalCost
      : 0;
  const providerRows = useMemo(() => {
    const groups = new Map<
      string,
      ProviderCostRow & { latencyTotal: number }
    >();
    for (const row of billingRows) {
      const current = groups.get(row.providerId) ?? {
        providerId: row.providerId,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costCny: 0,
        averageLatencyMs: 0,
        latencyTotal: 0,
      };
      current.calls += 1;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.costCny += row.costCny ?? 0;
      current.latencyTotal += row.latencyMs;
      current.averageLatencyMs = Math.round(
        current.latencyTotal / current.calls,
      );
      groups.set(row.providerId, current);
    }
    return Array.from(groups.values()).map(
      ({ latencyTotal: _latencyTotal, ...row }) => row,
    );
  }, [billingRows]);

  const providerColumns: ColumnsType<ProviderCostRow> = [
    { title: "供应商", dataIndex: "providerId", width: 180 },
    { title: "调用次数", dataIndex: "calls", width: 110 },
    {
      title: "输入 tokens",
      dataIndex: "inputTokens",
      width: 140,
      render: formatCount,
    },
    {
      title: "输出 tokens",
      dataIndex: "outputTokens",
      width: 140,
      render: formatCount,
    },
    { title: "费用", dataIndex: "costCny", width: 120, render: formatCny },
    {
      title: "平均延迟",
      dataIndex: "averageLatencyMs",
      width: 120,
      render: (value) => `${value}ms`,
    },
  ];

  const scenarioColumns: ColumnsType<ProductionCostScenario> = [
    {
      title: "设备数量",
      dataIndex: "deviceCount",
      width: 120,
      fixed: "left",
      render: (value) => `${Number(value).toLocaleString()} 台`,
    },
    {
      title: "每日次数/台",
      dataIndex: "turnsPerDeviceDay",
      width: 110,
      render: (value) => `${value} 次`,
    },
    {
      title: "年在线请求",
      dataIndex: "onlineTurns",
      width: 130,
      render: formatCount,
    },
    {
      title: "ASR 调用",
      dataIndex: "asrCalls",
      width: 130,
      render: formatCount,
    },
    {
      title: "规则命中",
      dataIndex: "ruleTurns",
      width: 130,
      render: formatCount,
    },
    {
      title: "知识库命中",
      dataIndex: "knowledgeTurns",
      width: 130,
      render: formatCount,
    },
    {
      title: "LLM 调用",
      dataIndex: "llmCalls",
      width: 130,
      render: formatCount,
    },
    {
      title: "TTS 静态",
      dataIndex: "ttsStaticCalls",
      width: 130,
      render: formatCount,
    },
    {
      title: "TTS 动态",
      dataIndex: "ttsDynamicCalls",
      width: 130,
      render: formatCount,
    },
    {
      title: "TTS 调用",
      dataIndex: "ttsCalls",
      width: 130,
      render: formatCount,
    },
    {
      title: "ASR 费用",
      dataIndex: "asrCost",
      width: 120,
      render: formatCnyShort,
    },
    {
      title: "LLM 费用",
      dataIndex: "llmCost",
      width: 120,
      render: formatCnyShort,
    },
    {
      title: "TTS 费用",
      dataIndex: "ttsCost",
      width: 120,
      render: formatCnyShort,
    },
    {
      title: "AI 服务合计",
      dataIndex: "aiServiceCost",
      width: 130,
      render: formatCnyShort,
    },
    {
      title: "固定资源",
      dataIndex: "fixedCost",
      width: 120,
      render: formatCnyShort,
    },
    {
      title: "年度合计",
      dataIndex: "totalCost",
      width: 130,
      render: (value) => <strong>{formatCnyShort(value)}</strong>,
    },
  ];

  async function saveSettings() {
    setSaving(true);
    try {
      await props.onSave({
        ...draft,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  function updateRouting(
    key: keyof ProductionCostSettings["routing"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      routing: {
        ...current.routing,
        [key]: value,
      },
    }));
  }

  function updateDevelopment(
    key: keyof ProductionCostSettings["development"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      development: {
        ...current.development,
        [key]: value,
      },
    }));
  }

  function updateFixedAnnual(
    key: keyof ProductionCostSettings["fixedAnnual"],
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      fixedAnnual: {
        ...current.fixedAnnual,
        [key]: value,
      },
    }));
  }

  function renderOverview() {
    return (
      <Space direction="vertical" size={16} className="full-width">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="研发阶段预算"
              value={formatCnyShort(developmentTotal)}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="当前年度合计"
              value={formatCnyShort(selectedScenario.totalCost)}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="压缩前年度合计"
              value={formatCnyShort(baselineScenario.totalCost)}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="当前年度节省"
              value={formatCnyShort(selectedOptimizationSavings)}
            />
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <KpiCard
              title="年度压缩比例"
              value={`${Math.round(selectedOptimizationRate * 100)}%`}
            />
          </Col>
          <Col xs={24} md={8}>
            <KpiCard
              title="三年节省"
              value={formatCnyShort(selectedThreeYearSavings)}
            />
          </Col>
          <Col xs={24} md={8}>
            <KpiCard
              title="首年预计投入"
              value={formatCnyShort(selectedScenario.firstYearTotalCost)}
            />
          </Col>
        </Row>
        <Card size="small" title="测算条件">
          <Row gutter={[16, 12]} align="middle">
            <Col xs={24} lg={10}>
              <Text type="secondary">设备规模</Text>
              <Flex gap={12} align="center">
                <Slider
                  min={1}
                  max={100000}
                  step={1}
                  value={selectedDeviceCount}
                  onChange={(value) => setSelectedDeviceCount(Number(value))}
                  className="full-width"
                />
                <InputNumber
                  min={1}
                  max={100000}
                  step={1}
                  value={selectedDeviceCount}
                  onChange={(value) =>
                    setSelectedDeviceCount(Number(value ?? 1))
                  }
                  style={{ width: 140 }}
                />
              </Flex>
            </Col>
            <Col xs={24} lg={10}>
              <Text type="secondary">每台每天语音次数</Text>
              <Flex gap={12} align="center">
                <Slider
                  min={1}
                  max={100}
                  value={selectedTurnsPerDeviceDay}
                  onChange={(value) =>
                    setSelectedTurnsPerDeviceDay(Number(value))
                  }
                  className="full-width"
                />
                <InputNumber
                  min={1}
                  max={100}
                  value={selectedTurnsPerDeviceDay}
                  onChange={(value) =>
                    setSelectedTurnsPerDeviceDay(Number(value ?? 1))
                  }
                  style={{ width: 120 }}
                />
              </Flex>
            </Col>
            <Col xs={24} lg={4}>
              <Statistic
                title="LLM 单次估算"
                value={formatCnyShort(llmUnitCost)}
              />
            </Col>
          </Row>
        </Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={15}>
            <Card
              size="small"
              title="完整语音链路成本趋势"
              extra={
                <Tabs
                  size="small"
                  activeKey={trendAxis}
                  onChange={(key) => setTrendAxis(key as CostTrendAxis)}
                  items={[
                    { key: "devices", label: "按设备规模" },
                    { key: "turns", label: "按每日次数" },
                  ]}
                />
              }
            >
              <CostTrendChart
                settings={draft}
                axis={trendAxis}
                selectedDeviceCount={selectedDeviceCount}
                selectedTurnsPerDeviceDay={selectedTurnsPerDeviceDay}
              />
            </Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card size="small" title="当前场景">
              <Space direction="vertical" size={12} className="full-width">
                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Statistic
                      title="年度总语音"
                      value={formatCount(selectedScenario.totalTurns)}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="在线请求"
                      value={formatCount(selectedScenario.onlineTurns)}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="年度链路合计"
                      value={formatCnyShort(
                        selectedScenario.variableAiServiceCost,
                      )}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="单次完整语音链路成本"
                      value={formatCnyShort(
                        selectedScenario.voiceChainUnitCost,
                      )}
                    />
                  </Col>
                </Row>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="ASR / LLM / TTS（折算）">
                    {formatCnyShort(selectedScenario.asrCost)} /{" "}
                    {formatCnyShort(selectedScenario.llmCost)} /{" "}
                    {formatCnyShort(selectedScenario.ttsVariableCost)}
                  </Descriptions.Item>
                  <Descriptions.Item label="规则 / 知识库">
                    {formatCount(selectedScenario.ruleTurns)} /{" "}
                    {formatCount(selectedScenario.knowledgeTurns)}
                  </Descriptions.Item>
                  <Descriptions.Item label="TTS 静态 / 动态">
                    {formatCount(selectedScenario.ttsStaticCalls)} /{" "}
                    {formatCount(selectedScenario.ttsDynamicCalls)}
                  </Descriptions.Item>
                  <Descriptions.Item label="单台年链路成本">
                    {formatCnyShort(
                      selectedScenario.variableAiServiceCost /
                        selectedScenario.deviceCount,
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="ASR 方案">
                    {selectedScenario.offlinePlan?.name ?? "-"}
                  </Descriptions.Item>
                </Descriptions>
                <Alert
                  type="info"
                  showIcon
                  message="这里只看语音链路边际成本，不含服务器、数据库、域名、小程序等固定项；在线请求先做 ASR，再按规则、知识库、LLM 依次处理。"
                />
              </Space>
            </Card>
          </Col>
        </Row>
        <Card size="small" title="10 万台典型场景">
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="使用频率">
              每台每天 1 次
            </Descriptions.Item>
            <Descriptions.Item label="离线固定命令">
              {draft.routing.offlineRatePercent}%
            </Descriptions.Item>
            <Descriptions.Item label="在线规则命中">
              {draft.routing.ruleMatchRatePercent}%
            </Descriptions.Item>
            <Descriptions.Item label="LLM占全部语音">
              {typicalScenario.totalTurns > 0
                ? `${((typicalScenario.llmCalls / typicalScenario.totalTurns) * 100).toFixed(2)}%`
                : "0%"}
            </Descriptions.Item>
            <Descriptions.Item label="年度 ASR（全部设备）">
              {formatCnyShort(typicalScenario.asrCost)}
            </Descriptions.Item>
            <Descriptions.Item label="年度 LLM（全部设备）">
              {formatCnyShort(typicalScenario.llmCost)}
            </Descriptions.Item>
            <Descriptions.Item label="年度 TTS（折算）">
              {formatCnyShort(typicalScenario.ttsVariableCost)}
            </Descriptions.Item>
            <Descriptions.Item label="年度链路合计（全部设备）">
              {formatCnyShort(typicalScenario.variableAiServiceCost)}
            </Descriptions.Item>
            <Descriptions.Item label="单次完整语音链路成本">
              {formatCnyShort(typicalScenario.voiceChainUnitCost)}
            </Descriptions.Item>
            <Descriptions.Item label="单台年链路成本">
              {formatCnyShort(
                typicalScenario.variableAiServiceCost /
                  typicalScenario.deviceCount,
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card
          size="small"
          title="质保期费用摘要"
          extra={
            <Text type="secondary">
              固定平台费用按年度单独计算，不分摊到单台设备
            </Text>
          }
        >
          <Table
            size="small"
            pagination={false}
            rowKey="years"
            dataSource={warrantyCostRows}
            columns={[
              { title: "质保档位", dataIndex: "label", width: 140 },
              {
                title: "ASR+LLM+TTS",
                dataIndex: "aiServiceCost",
                render: formatCnyShort,
              },
              {
                title: "固定平台成本",
                dataIndex: "fixedCost",
                render: formatCnyShort,
              },
              {
                title: "项目总费用",
                dataIndex: "totalCost",
                render: formatCnyShort,
              },
              {
                title: "单台设备相关费用",
                dataIndex: "unitDeviceCost",
                render: formatCnyShort,
              },
              {
                title: "其中单台 AI 服务费",
                dataIndex: "unitAiServiceCost",
                render: formatCnyShort,
              },
            ]}
            scroll={{ x: 900 }}
          />
        </Card>
      </Space>
    );
  }

  function renderDetails() {
    return (
      <Space direction="vertical" size={16} className="full-width">
        <Card size="small" title="压缩效果">
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="当前年度合计">
              {formatCnyShort(selectedScenario.totalCost)}
            </Descriptions.Item>
            <Descriptions.Item label="压缩前年度合计">
              {formatCnyShort(baselineScenario.totalCost)}
            </Descriptions.Item>
            <Descriptions.Item label="年度节省">
              {formatCnyShort(selectedOptimizationSavings)}
            </Descriptions.Item>
            <Descriptions.Item label="当前三年合计">
              {formatCnyShort(selectedScenario.threeYearTotalCost)}
            </Descriptions.Item>
            <Descriptions.Item label="压缩前三年合计">
              {formatCnyShort(baselineScenario.threeYearTotalCost)}
            </Descriptions.Item>
            <Descriptions.Item label="三年节省">
              {formatCnyShort(selectedThreeYearSavings)}
            </Descriptions.Item>
            <Descriptions.Item label="规则命中">
              {formatCount(selectedScenario.ruleTurns)}
            </Descriptions.Item>
            <Descriptions.Item label="知识库命中">
              {formatCount(selectedScenario.knowledgeTurns)}
            </Descriptions.Item>
            <Descriptions.Item label="LLM 调用">
              {formatCount(selectedScenario.llmCalls)}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title="质保期成本明细">
          <Alert
            type="info"
            showIcon
            message="ASR、LLM、TTS按设备使用量计算；服务器、域名、数据库、小程序和存储属于年度固定成本，不计入单台设备费用。质保期结束后停止在线语音服务。"
          />
          <Table
            size="small"
            pagination={false}
            rowKey="years"
            dataSource={warrantyCostRows}
            columns={[
              { title: "质保期", dataIndex: "label", width: 140 },
              {
                title: "ASR累计",
                dataIndex: "asrCost",
                render: formatCnyShort,
              },
              {
                title: "LLM累计",
                dataIndex: "llmCost",
                render: formatCnyShort,
              },
              {
                title: "TTS累计",
                dataIndex: "ttsCost",
                render: formatCnyShort,
              },
              {
                title: "AI服务合计",
                dataIndex: "aiServiceCost",
                render: formatCnyShort,
              },
              {
                title: "固定平台成本",
                dataIndex: "fixedCost",
                render: formatCnyShort,
              },
              {
                title: "项目总费用",
                dataIndex: "totalCost",
                render: formatCnyShort,
              },
              {
                title: "单台设备相关费用",
                dataIndex: "unitDeviceCost",
                render: formatCnyShort,
              },
              {
                title: "单台每年",
                dataIndex: "annualUnitDeviceCost",
                render: formatCnyShort,
              },
              {
                title: "费用停止时间",
                render: (_, row: WarrantyCostRow) =>
                  `${row.years} 年期满后停止在线服务`,
              },
            ]}
            scroll={{ x: 1200 }}
            style={{ marginTop: 12 }}
          />
        </Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="研发阶段费用">
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={developmentRows}
                columns={[
                  { title: "费用项目", dataIndex: "label" },
                  {
                    title: "金额",
                    dataIndex: "value",
                    width: 160,
                    render: formatCnyShort,
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <strong>合计</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1}>
                      <strong>{formatCnyShort(developmentTotal)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="生产阶段固定资源">
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={fixedAnnualRows}
                columns={[
                  { title: "费用项目", dataIndex: "label" },
                  {
                    title: "年度金额",
                    dataIndex: "value",
                    width: 160,
                    render: formatCnyShort,
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <strong>年度合计</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1}>
                      <strong>{formatCnyShort(fixedAnnualCost)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="LLM 调用样本"
              value={billingRows.length}
              suffix="次"
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard
              title="实测 LLM 费用"
              value={formatCny(totalMeasuredCost)}
            />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard title="单次均价" value={formatCny(averageCostPerCall)} />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <KpiCard title="平均延迟" value={averageLatencyMs} suffix="ms" />
          </Col>
        </Row>
        <Card size="small" title="真实调用统计">
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="输入 tokens">
              {formatCount(totalInputTokens)}
            </Descriptions.Item>
            <Descriptions.Item label="输出 tokens">
              {formatCount(totalOutputTokens)}
            </Descriptions.Item>
            <Descriptions.Item label="费用样本">
              {knownCostRows.length}
            </Descriptions.Item>
            <Descriptions.Item label="规则命中">
              {ruleTurns} 次
            </Descriptions.Item>
            <Descriptions.Item label="知识库命中">
              {knowledgeTurns} 次
            </Descriptions.Item>
            <Descriptions.Item label="进入 LLM">
              {llmTurns} 次
            </Descriptions.Item>
            <Descriptions.Item label="实测本地命中率">
              {measuredLocalRate}%
            </Descriptions.Item>
          </Descriptions>
          <Table
            rowKey="providerId"
            size="small"
            columns={providerColumns}
            dataSource={providerRows}
            pagination={false}
            locale={{ emptyText: "暂无供应商调用数据" }}
            scroll={{ x: 780 }}
            style={{ marginTop: 12 }}
          />
        </Card>
        <Card size="small" title="规模与频率费用矩阵">
          <Table
            size="small"
            scroll={{ x: 1380 }}
            pagination={false}
            rowKey="key"
            dataSource={scenarios}
            columns={scenarioColumns}
          />
        </Card>
      </Space>
    );
  }

  function renderAsrComparison() {
    return (
      <Space direction="vertical" size={16} className="full-width">
        <Alert
          type="info"
          showIcon
          message="ASR 方案只替换语音识别路径，不会取消 LLM、TTS、知识库、服务器和设备管理费用。"
          description="当前建议先用 ESP32-C3 做固定指令兜底，复杂语音走云端 ASR；ESP32-S3 + PSRAM 作为本地通用 ASR 验证方案，等浴室噪声、内存和量产成本确认后再定。"
        />
        <Card
          size="small"
          title="10万台 ASR 1-10年累计对比"
          extra={
            <Text type="secondary">
              固定 {ASR_RANGE_DEVICE_COUNT.toLocaleString()} 台 / 每台每天{" "}
              {asrYearTurnsPerDeviceDay} 次
            </Text>
          }
        >
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} xl={16}>
              <AsrYearCostChart series={asrYearSeries} />
            </Col>
            <Col xs={24} xl={8}>
              <Space direction="vertical" size={12} className="full-width">
                <div>
                  <Text type="secondary">每台每天语音次数</Text>
                  <Flex gap={12} align="center">
                    <Slider
                      min={1}
                      max={30}
                      value={asrYearTurnsPerDeviceDay}
                      onChange={(value) =>
                        setAsrYearTurnsPerDeviceDay(Number(value))
                      }
                      className="full-width"
                    />
                    <InputNumber
                      min={1}
                      max={30}
                      value={asrYearTurnsPerDeviceDay}
                      onChange={(value) =>
                        setAsrYearTurnsPerDeviceDay(Number(value ?? 1))
                      }
                      style={{ width: 96 }}
                    />
                  </Flex>
                </div>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="计算口径">
                    只看 ASR 路径，硬件增量只计一次，ASR 服务费按年累计
                  </Descriptions.Item>
                  <Descriptions.Item label="适用判断">
                    观察长期销售后，云端 ASR 年费是否明显超过本地 ASR 硬件增量
                  </Descriptions.Item>
                  <Descriptions.Item label="当前重点">
                    1 到 10 年累计成本和不同方案交叉点
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            </Col>
          </Row>
          <Table
            className="spaced-table"
            size="small"
            scroll={{ x: 980 }}
            pagination={false}
            rowKey="key"
            dataSource={asrYearSummaryRows}
            columns={[
              {
                title: "累计年限",
                dataIndex: "years",
                width: 100,
                render: (value) => `${value} 年`,
              },
              {
                title: "方案",
                dataIndex: "planName",
                width: 260,
                render: (value, row) => (
                  <Space size={6}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: row.color,
                        display: "inline-block",
                      }}
                    />
                    <span>{value}</span>
                  </Space>
                ),
              },
              {
                title: "ASR 年运行费",
                dataIndex: "annualRunningCost",
                width: 140,
                render: formatCnyShort,
              },
              {
                title: "累计 ASR 成本",
                dataIndex: "cumulativeCost",
                width: 150,
                render: formatCnyShort,
              },
              {
                title: "相对云端ASR",
                dataIndex: "baselineDiff",
                width: 140,
                render: (value: number) =>
                  value === 0 ? (
                    "-"
                  ) : (
                    <Text type={value > 0 ? "danger" : "success"}>
                      {formatCnyShort(value)}
                    </Text>
                  ),
              },
            ]}
          />
        </Card>
        <Card
          size="small"
          title="10万台 ASR 区间动态对比"
          extra={
            <Text type="secondary">
              固定 {ASR_RANGE_DEVICE_COUNT.toLocaleString()} 台 / 每台每天 1-
              {asrRangeMaxTurns} 次
            </Text>
          }
        >
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} xl={16}>
              <AsrRangeCostChart
                series={asrRangeSeries}
                maxTurns={asrRangeMaxTurns}
              />
            </Col>
            <Col xs={24} xl={8}>
              <Space direction="vertical" size={12} className="full-width">
                <div>
                  <Text type="secondary">每日次数上限</Text>
                  <Flex gap={12} align="center">
                    <Slider
                      min={1}
                      max={30}
                      value={asrRangeMaxTurns}
                      onChange={(value) => setAsrRangeMaxTurns(Number(value))}
                      className="full-width"
                    />
                    <InputNumber
                      min={1}
                      max={30}
                      value={asrRangeMaxTurns}
                      onChange={(value) =>
                        setAsrRangeMaxTurns(Number(value ?? 30))
                      }
                      style={{ width: 96 }}
                    />
                  </Flex>
                </div>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="对比口径">
                    只看 ASR 识别路径，不叠加 LLM、TTS 和服务器费用
                  </Descriptions.Item>
                  <Descriptions.Item label="三年累计">
                    3 年云端 ASR 费用 + 本地 ASR 硬件增量
                  </Descriptions.Item>
                  <Descriptions.Item label="当前重点">
                    每天 1 次到 30 次的增长趋势
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            </Col>
          </Row>
          <Table
            className="spaced-table"
            size="small"
            scroll={{ x: 980 }}
            pagination={false}
            rowKey="key"
            dataSource={asrRangeSummaryRows}
            columns={[
              {
                title: "每日次数/台",
                dataIndex: "turnsPerDeviceDay",
                width: 110,
                render: (value) => `${value} 次`,
              },
              {
                title: "方案",
                dataIndex: "planName",
                width: 260,
                render: (value, row) => (
                  <Space size={6}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: row.color,
                        display: "inline-block",
                      }}
                    />
                    <span>{value}</span>
                  </Space>
                ),
              },
              {
                title: "ASR 年运行费",
                dataIndex: "annualRunningCost",
                width: 140,
                render: formatCnyShort,
              },
              {
                title: "ASR 首年费用",
                dataIndex: "firstYearCost",
                width: 140,
                render: formatCnyShort,
              },
              {
                title: "ASR 三年累计",
                dataIndex: "threeYearCost",
                width: 140,
                render: formatCnyShort,
              },
              {
                title: "硬件回收期",
                dataIndex: "paybackYears",
                width: 130,
                render: (value: number | null) =>
                  value === null ? "-" : `${value.toFixed(1)} 年`,
              },
            ]}
          />
        </Card>
        <Card
          size="small"
          title="ASR 方案对比"
          extra={
            <Text type="secondary">
              {selectedDeviceCount.toLocaleString()} 台 / 每台每天{" "}
              {selectedTurnsPerDeviceDay} 次
            </Text>
          }
        >
          <Table
            size="small"
            scroll={{ x: 1120 }}
            pagination={false}
            rowKey="key"
            dataSource={asrPlanRowsWithPayback}
            columns={[
              {
                title: "实现方式",
                dataIndex: ["plan", "name"],
                width: 240,
                render: (
                  value: string,
                  row: (typeof asrPlanRowsWithPayback)[number],
                ) => (
                  <Space direction="vertical" size={0}>
                    <span>
                      {value}{" "}
                      {row.plan.id === draft.asr.activeOfflinePlanId ? (
                        <Tag color="blue">当前</Tag>
                      ) : null}
                    </span>
                    <Text type="secondary">{row.plan.chipName}</Text>
                  </Space>
                ),
              },
              {
                title: "离线能力",
                width: 190,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  row.plan.supportsFreeSpeech
                    ? "本地通用语音，待验证"
                    : "固定唤醒词和指令词",
              },
              {
                title: "单台硬件增量",
                width: 130,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  formatCnyShort(row.plan.unitHardwareDeltaCny),
              },
              {
                title: "ASR 年运行费",
                width: 130,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  formatCnyShort(row.asrAnnualRunningCost),
              },
              {
                title: "ASR 首年费用",
                width: 130,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  formatCnyShort(row.asrFirstYearCost),
              },
              {
                title: "ASR 三年累计",
                width: 130,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  formatCnyShort(row.asrThreeYearCost),
              },
              {
                title: "硬件回收期",
                width: 120,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) =>
                  row.paybackYears === null
                    ? "-"
                    : `${row.paybackYears.toFixed(1)} 年`,
              },
              {
                title: "状态",
                width: 110,
                render: (_, row: (typeof asrPlanRowsWithPayback)[number]) => {
                  const labels = {
                    MATURE: "成熟",
                    VALIDATING: "待验证",
                    HIGH_RISK: "风险较高",
                  } as const;
                  const colors = {
                    MATURE: "green",
                    VALIDATING: "gold",
                    HIGH_RISK: "red",
                  } as const;
                  return (
                    <Tag color={colors[row.plan.maturity]}>
                      {labels[row.plan.maturity]}
                    </Tag>
                  );
                },
              },
            ]}
          />
        </Card>
        <Card size="small" title="当前 ASR 口径">
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="在线 ASR">
              {draft.asr.providerName}
            </Descriptions.Item>
            <Descriptions.Item label="计费方式">
              {draft.asr.billingMode}
            </Descriptions.Item>
            <Descriptions.Item label="平均语音时长">
              {draft.asr.averageSecondsPerRequest} 秒
            </Descriptions.Item>
            <Descriptions.Item label="年 ASR 调用">
              {formatCount(selectedScenario.asrCalls)}
            </Descriptions.Item>
            <Descriptions.Item label="年离线处理">
              {formatCount(selectedScenario.offlineAsrCalls)}
            </Descriptions.Item>
            <Descriptions.Item label="年 ASR 费用">
              {formatCnyShort(selectedScenario.asrCost)}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>
    );
  }

  function renderSettings() {
    return (
      <Space direction="vertical" size={16} className="full-width">
        <Card size="small" title="链路比例参数">
          <Row gutter={[16, 12]}>
            {[
              [
                "offlineRatePercent",
                "离线固定命令比例",
                draft.routing.offlineRatePercent,
              ],
              [
                "ruleMatchRatePercent",
                "在线规则命中比例",
                draft.routing.ruleMatchRatePercent,
              ],
              [
                "knowledgeHitRatePercent",
                "知识库命中比例",
                draft.routing.knowledgeHitRatePercent,
              ],
              [
                "ttsResponseRatePercent",
                "需要播报比例",
                draft.routing.ttsResponseRatePercent,
              ],
              [
                "llmTtsResponseRatePercent",
                "LLM 播报比例",
                draft.routing.llmTtsResponseRatePercent,
              ],
              [
                "ttsCacheHitRatePercent",
                "TTS 缓存命中比例",
                draft.routing.ttsCacheHitRatePercent,
              ],
            ].map(([key, label, value]) => (
              <Col xs={24} md={12} xl={6} key={String(key)}>
                <Text type="secondary">{String(label)}（%）</Text>
                <Flex gap={10} align="center">
                  <Slider
                    min={0}
                    max={100}
                    value={Number(value)}
                    onChange={(nextValue) =>
                      updateRouting(
                        key as keyof ProductionCostSettings["routing"],
                        Number(nextValue),
                      )
                    }
                    className="full-width"
                  />
                  <InputNumber
                    min={0}
                    max={100}
                    value={Number(value)}
                    onChange={(nextValue) =>
                      updateRouting(
                        key as keyof ProductionCostSettings["routing"],
                        Number(nextValue ?? 0),
                      )
                    }
                    style={{ width: 88 }}
                  />
                </Flex>
              </Col>
            ))}
          </Row>
        </Card>
        <Card size="small" title="ASR 参数">
          <Row gutter={[16, 12]}>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">服务商</Text>
              <Input
                value={draft.asr.providerName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    asr: { ...current.asr, providerName: event.target.value },
                  }))
                }
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">模型名称</Text>
              <Input
                value={draft.asr.modelName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    asr: { ...current.asr, modelName: event.target.value },
                  }))
                }
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">计费方式</Text>
              <Select
                value={draft.asr.billingMode}
                options={[
                  { label: "按次", value: "PER_REQUEST" },
                  { label: "按分钟", value: "PER_MINUTE" },
                  { label: "按小时", value: "PER_HOUR" },
                  { label: "无持续服务费", value: "NONE" },
                ]}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      billingMode:
                        value as ProductionCostSettings["asr"]["billingMode"],
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">离线方案</Text>
              <Select
                value={draft.asr.activeOfflinePlanId}
                options={draft.asr.offlinePlans.map((plan) => ({
                  label: plan.name,
                  value: plan.id,
                }))}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: { ...current.asr, activeOfflinePlanId: value },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">单次价格（元）</Text>
              <InputNumber
                min={0}
                precision={6}
                value={draft.asr.pricePerRequestCny}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      pricePerRequestCny: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">分钟价格（元）</Text>
              <InputNumber
                min={0}
                precision={6}
                value={draft.asr.pricePerMinuteCny}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      pricePerMinuteCny: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">小时价格（元）</Text>
              <InputNumber
                min={0}
                precision={6}
                value={draft.asr.pricePerHourCny}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      pricePerHourCny: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">平均语音时长（秒）</Text>
              <InputNumber
                min={0.1}
                precision={1}
                value={draft.asr.averageSecondsPerRequest}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      averageSecondsPerRequest: Number(value ?? 1),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24}>
              <Text type="secondary">价格来源链接</Text>
              <Input
                value={draft.asr.sourceUrl ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    asr: {
                      ...current.asr,
                      sourceUrl: event.target.value || null,
                    },
                  }))
                }
              />
            </Col>
          </Row>
        </Card>
        <Card size="small" title="LLM 与 TTS 参数">
          <Row gutter={[16, 12]}>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">LLM 模型</Text>
              <Select
                value={draft.llm.providerId}
                options={props.providers.map((provider) => ({
                  label: provider.name,
                  value: provider.id,
                }))}
                onChange={(value) => {
                  const provider = props.providers.find(
                    (item) => item.id === value,
                  );
                  setDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      providerId: value,
                      modelName: provider?.model ?? current.llm.modelName,
                      inputPricePerMTokens:
                        provider?.inputPricePerMTokens ??
                        current.llm.inputPricePerMTokens,
                      outputPricePerMTokens:
                        provider?.outputPricePerMTokens ??
                        current.llm.outputPricePerMTokens,
                    },
                  }));
                }}
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">LLM 输入价格（元/百万 Token）</Text>
              <InputNumber
                min={0}
                precision={4}
                value={draft.llm.inputPricePerMTokens}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      inputPricePerMTokens: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">LLM 输出价格（元/百万 Token）</Text>
              <InputNumber
                min={0}
                precision={4}
                value={draft.llm.outputPricePerMTokens}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      outputPricePerMTokens: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">LLM 单次估算</Text>
              <Statistic value={formatCnyShort(llmUnitCost)} />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">平均输入 Token</Text>
              <InputNumber
                min={0}
                value={draft.llm.averageInputTokens}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      averageInputTokens: Math.round(Number(value ?? 0)),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">平均输出 Token</Text>
              <InputNumber
                min={0}
                value={draft.llm.averageOutputTokens}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      averageOutputTokens: Math.round(Number(value ?? 0)),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">TTS 服务商</Text>
              <Input
                value={draft.tts.providerName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    tts: { ...current.tts, providerName: event.target.value },
                  }))
                }
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">TTS 单次参考</Text>
              <Statistic value={formatCnyShort(ttsUnitCost)} />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">TTS 套餐次数</Text>
              <InputNumber
                min={1}
                value={draft.tts.packageCalls}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      packageCalls: Math.round(Number(value ?? 1)),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Text type="secondary">TTS 套餐价格（元）</Text>
              <InputNumber
                min={0}
                precision={2}
                value={draft.tts.packagePriceCny}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      packagePriceCny: Number(value ?? 0),
                    },
                  }))
                }
                className="full-width"
              />
            </Col>
          </Row>
        </Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="研发阶段费用参数">
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={developmentRows}
                columns={[
                  { title: "费用项目", dataIndex: "label" },
                  {
                    title: "金额（元）",
                    width: 180,
                    render: (_, row: (typeof developmentRows)[number]) => (
                      <InputNumber
                        min={0}
                        precision={2}
                        value={row.value}
                        onChange={(value) =>
                          updateDevelopment(row.key, Number(value ?? 0))
                        }
                        className="full-width"
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="生产固定资源参数">
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={fixedAnnualRows}
                columns={[
                  { title: "费用项目", dataIndex: "label" },
                  {
                    title: "年度金额（元）",
                    width: 180,
                    render: (_, row: (typeof fixedAnnualRows)[number]) => (
                      <InputNumber
                        min={0}
                        precision={2}
                        value={row.value}
                        onChange={(value) =>
                          updateFixedAnnual(row.key, Number(value ?? 0))
                        }
                        className="full-width"
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    );
  }

  return (
    <Space
      direction="vertical"
      size={16}
      className="full-width cost-center-page"
    >
      <PageIntro
        eyebrow="生产与成本"
        title="成本测算"
        description="研发阶段费用单独看，生产阶段费用按 ASR、LLM、TTS 和固定资源拆开测算。"
        extra={
          <Space wrap>
            <Button onClick={() => void props.onRefresh()}>刷新日志</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void saveSettings()}
            >
              保存费用参数
            </Button>
          </Space>
        }
      />
      {!billingRows.length && (
        <div className="inline-note">
          <Badge status="default" />
          <Text type="secondary">
            暂无生产 LLM 调用记录，当前显示预算模型估算。
          </Text>
        </div>
      )}
      <Tabs
        className="workspace-tabs cost-center-tabs"
        items={[
          { key: "overview", label: "汇报总览", children: renderOverview() },
          { key: "details", label: "费用明细", children: renderDetails() },
          { key: "asr", label: "ASR方案对比", children: renderAsrComparison() },
          { key: "settings", label: "参数设置", children: renderSettings() },
        ]}
      />
    </Space>
  );
}

export default App;
