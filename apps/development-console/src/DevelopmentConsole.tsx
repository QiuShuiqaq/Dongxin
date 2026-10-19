import {
  AudioOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BlockOutlined,
  BuildOutlined,
  BugOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CodeOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  ExportOutlined,
  FileDoneOutlined,
  FireOutlined,
  GatewayOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  LoadingOutlined,
  KeyOutlined,
  PauseCircleFilled,
  PoweroffOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SoundOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UsbOutlined,
  UploadOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import type {
  BatchTestRun,
  BoardPin,
  BoardProfile,
  DeviceExecutionTrace,
  DeviceProfile,
  DeviceState,
  ExecutionTraceStage,
  HardwareDefinitionStatus,
  IoExpanderPort,
  ProductProfile,
  VoiceProfile,
  VoicePipelineStage,
  VoiceTestSession,
} from "@dongxin/shared";
import {
  Alert,
  App,
  Badge,
  Button,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAsrDatasetAudio,
  batchExportUrl,
  cancelBatchTest,
  createAsrDataset,
  deleteAsrDataset,
  deleteBatchTestRun,
  diagnoseAiProvider,
  getDevelopmentConsole,
  getAiServiceConfiguration,
  getAsrDatasets,
  getBatchTestRun,
  getBatchTestRuns,
  getBoardLabDeviceState,
  getBoardLabRequest,
  getDeviceAudioTest,
  getCurrentLocalAgentJob,
  getDeviceCommands,
  getDeviceState,
  getLocalAgentHealth,
  getLocalSerialPorts,
  getTestSetSummaries,
  getVoiceTest,
  getVoiceTests,
  retryFailedBatchTest,
  saveAiProviders,
  saveProviderApiKey,
  sendDeviceCommand,
  setDefaultAiProvider,
  startBoardLabAction,
  startBatchTest,
  runLlmModuleTest,
  runTtsModuleTest,
  startLocalAgentJob,
  startVoiceTest,
  stopLocalAgentJob,
  stopDeviceAudioTest,
  stopVoiceTest,
} from "./api";
import type {
  AiServiceConfiguration,
  AsrDataset,
  BoardLabDeviceState,
  BoardLabRequestRecord,
  BoardLabSnapshot,
  DevelopmentConsoleData,
  DeviceAudioTestResult,
  DevelopmentGate,
  LocalAgentHealth,
  LocalAgentJob,
  LocalAgentJobAction,
  LocalSerialPort,
  LlmModuleTestResult,
  ModelProvider,
  ProviderDiagnosticResult,
  TestSetSummary,
} from "./api";

type Section =
  "overview" | "flashing" | "testing" | "aiServices" | "voice" | "batchTesting";

const sectionMeta: Record<Section, { label: string; eyebrow: string }> = {
  overview: { label: "研发总览", eyebrow: "PROGRAM STATUS" },
  flashing: { label: "固件与烧录", eyebrow: "LOCAL DEVICE TOOLS" },
  testing: { label: "样机联调", eyebrow: "HARDWARE-IN-LOOP" },
  aiServices: { label: "AI 服务配置", eyebrow: "MODEL SERVICES" },
  voice: { label: "在线语音", eyebrow: "VOICE PIPELINE" },
  batchTesting: { label: "批量测试与报告", eyebrow: "TEST EVIDENCE" },
};

const intentLabels: Record<string, string> = {
  LIGHT_ON: "开启照明",
  LIGHT_OFF: "关闭照明",
  FAN_ON: "开启吹风",
  FAN_OFF: "关闭吹风",
  VENTILATION_ON: "开启换气",
  VENTILATION_OFF: "关闭换气",
  HEAT_WEAK_ON: "开启弱暖",
  HEAT_STRONG_ON: "开启强暖",
  HEAT_WEAK_OFF: "关闭取暖",
  HEAT_STRONG_OFF: "关闭取暖",
  SWING_ON: "开启摆风",
  SWING_OFF: "关闭摆风",
  CONSTANT_TEMP_ON: "开启恒温",
  STANDBY: "整机待机",
};

export default function DevelopmentConsole() {
  const { message } = App.useApp();
  const [data, setData] = useState<DevelopmentConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>(() => readSectionHash());
  const [boardId, setBoardId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sendingIntent, setSendingIntent] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await getDevelopmentConsole();
      setData(next);
      const voiceBoard = next.boards.find(
        (item) => item.id === "esp32-c3-lichuang-audio",
      );
      const nextBoardId = next.boards.some((item) => item.id === boardId)
        ? boardId
        : voiceBoard?.id || next.boards[0]?.id || "";
      const audioDevice = next.devices.find((item) =>
        item.model.includes("LICHUANG-AUDIO"),
      );
      const nextDeviceId = next.devices.some((item) => item.id === deviceId)
        ? deviceId
        : audioDevice?.id || next.devices[0]?.id || "";
      setBoardId(nextBoardId);
      setDeviceId(nextDeviceId);
      if (nextDeviceId) setDeviceState(await getDeviceState(nextDeviceId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, boardId, deviceId]);

  function navigate(next: Section) {
    if ((next === "voice" || next === "testing") && data) {
      const audioDevice = data.devices.find((item) =>
        item.model.includes("LICHUANG-AUDIO"),
      );
      const audioBoard = data.boards.find(
        (item) => item.id === "esp32-c3-lichuang-audio",
      );
      if (audioDevice) setDeviceId(audioDevice.id);
      if (audioBoard) setBoardId(audioBoard.id);
    }
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  async function handleCommand(intent: string) {
    if (!deviceId) return;
    setSendingIntent(intent);
    try {
      const queued = await sendDeviceCommand(deviceId, intent);
      let status = queued.command.status;
      for (let attempt = 0; status === "QUEUED" && attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const commands = await getDeviceCommands(deviceId);
        status =
          commands.find((item) => item.id === queued.command.id)?.status ||
          status;
      }
      await refresh(true);
      if (status === "APPLIED")
        message.success(`${intentLabels[intent] || intent}已执行`);
      else if (status === "REJECTED")
        message.warning("命令已被C3本地安全规则拒绝");
      else message.error(`命令结果：${status}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSendingIntent(null);
    }
  }

  const board = data?.boards.find((item) => item.id === boardId) ?? null;
  const device = data?.devices.find((item) => item.id === deviceId) ?? null;
  const product = data?.products.find(
    (item) => item.id === board?.productProfileId,
  );
  const meta = sectionMeta[section];

  return (
    <div className="dev-shell">
      <aside className="dev-sidebar">
        <div className="dev-brand">
          <div className="dev-brand-mark">DX</div>
          <div>
            <strong>东信产品研发中心</strong>
            <span>Device Engineering</span>
          </div>
        </div>
        <nav className="dev-nav" aria-label="研发中心导航">
          <NavGroup label="当前研发">
            <NavItem
              active={section === "overview"}
              icon={<AppstoreOutlined />}
              label="研发总览"
              onClick={() => navigate("overview")}
            />
            <NavItem
              active={section === "testing"}
              icon={<ExperimentOutlined />}
              label="样机联调"
              onClick={() => navigate("testing")}
            />
            <NavItem
              active={section === "flashing"}
              icon={<BuildOutlined />}
              label="固件与烧录"
              onClick={() => navigate("flashing")}
            />
          </NavGroup>
          <NavGroup label="在线语音验证">
            <NavItem
              active={section === "aiServices"}
              icon={<ApiOutlined />}
              label="AI 服务配置"
              onClick={() => navigate("aiServices")}
            />
            <NavItem
              active={section === "voice"}
              icon={<SoundOutlined />}
              label="在线语音"
              onClick={() => navigate("voice")}
            />
            <NavItem
              active={section === "batchTesting"}
              icon={<DatabaseOutlined />}
              label="批量测试与报告"
              onClick={() => navigate("batchTesting")}
            />
          </NavGroup>
        </nav>
        <div className="sidebar-status">
          <span>
            <Badge status={data?.mqtt.connected ? "success" : "error"} />
            MQTT {data?.mqtt.connected ? "已连接" : "断开"}
          </span>
          <small>{data?.mqtt.brokerUrl || "等待API"}</small>
        </div>
      </aside>

      <main className="dev-main">
        <header className="dev-header">
          <div>
            <span className="eyebrow">{meta.eyebrow}</span>
            <h1>{meta.label}</h1>
          </div>
          <Space size="middle">
            <span className="refresh-control">
              <Switch
                size="small"
                checked={autoRefresh}
                onChange={setAutoRefresh}
              />{" "}
              自动刷新
            </span>
            <Tooltip title="刷新全部研发数据">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void refresh()}
                loading={loading}
                aria-label="刷新"
              />
            </Tooltip>
          </Space>
        </header>
        <ContextBar
          data={data}
          board={board}
          device={device}
          boardId={boardId}
          deviceId={deviceId}
          onBoardChange={setBoardId}
          onDeviceChange={(value) => {
            setDeviceId(value);
            void getDeviceState(value).then(setDeviceState);
          }}
        />

        <div className="dev-content">
          {loading && !data ? (
            <Skeleton active paragraph={{ rows: 12 }} />
          ) : null}
          {data && section === "overview" ? (
            <OverviewPage data={data} board={board} device={device} />
          ) : null}
          {data && section === "flashing" ? <FlashingPage /> : null}
          {data && board && section === "testing" ? (
            <TestingPage
              board={board}
              device={device}
              state={deviceState}
              traces={data.traces.filter(
                (trace) => trace.deviceId === deviceId,
              )}
              sendingIntent={sendingIntent}
              onCommand={handleCommand}
            />
          ) : null}
          {data && section === "aiServices" ? <AiServicesPage /> : null}
          {data && section === "voice" ? (
            <VoicePage
              voices={data.voiceProfiles}
              product={product}
              device={device}
            />
          ) : null}
          {data && section === "batchTesting" ? (
            <BatchTestingPage device={device} />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function ContextBar(props: {
  data: DevelopmentConsoleData | null;
  board: BoardProfile | null;
  device: DeviceProfile | null;
  boardId: string;
  deviceId: string;
  onBoardChange: (value: string) => void;
  onDeviceChange: (value: string) => void;
}) {
  return (
    <div className="context-strip">
      <ContextItem label="环境">
        <Tag color="gold">本地研发</Tag>
      </ContextItem>
      <ContextItem label="产品">
        {props.data?.products[0]?.model || "-"}
      </ContextItem>
      <ContextItem label="板卡">
        <Select
          size="small"
          value={props.boardId}
          onChange={props.onBoardChange}
          options={props.data?.boards.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.revision}`,
          }))}
        />
      </ContextItem>
      <ContextItem label="设备">
        <Select
          size="small"
          value={props.deviceId}
          onChange={props.onDeviceChange}
          options={props.data?.devices.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
      </ContextItem>
      <ContextItem label="固件">
        {props.device?.firmwareVersion || "未上报"}
      </ContextItem>
      <ContextItem label="执行路径">
        <ExecutionModeTag board={props.board} />
      </ContextItem>
    </div>
  );
}

function OverviewPage(props: {
  data: DevelopmentConsoleData;
  board: BoardProfile | null;
  device: DeviceProfile | null;
}) {
  const passed = props.data.gates.filter(
    (item) => item.status === "PASSED",
  ).length;
  const realTraces = props.data.traces.filter(
    (item) => item.deviceId === props.device?.id,
  );
  const applied = realTraces.filter((item) => item.status === "APPLIED").length;
  return (
    <div className="page-stack">
      <section className="metric-grid" aria-label="研发状态">
        <Metric
          label="当前阶段"
          value="P2"
          detail="STM32只读接入"
          tone="green"
        />
        <Metric
          label="Gate进度"
          value={`${passed}/${props.data.gates.length}`}
          detail="按真实验证结果统计"
        />
        <Metric label="当前链路" value="GPIO19 RX" detail="115200 8N1 已收帧" />
        <Metric
          label="C3记录"
          value={`${applied}`}
          detail="不代表样机真实执行"
        />
      </section>
      <section className="workspace-section">
        <SectionTitle
          title="研发 Gate"
          aside={<span className="muted">按硬件可验证条件推进</span>}
        />
        <div className="gate-rail">
          {props.data.gates.map((gate, index) => (
            <GateItem
              key={gate.id}
              gate={gate}
              last={index === props.data.gates.length - 1}
            />
          ))}
        </div>
      </section>
      <div className="two-column-layout">
        <section className="workspace-section">
          <SectionTitle title="当前基线" />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="设备主控">
              现有 STM32 样机
            </Descriptions.Item>
            <Descriptions.Item label="联网语音">
              ESP32-C3 · Wi-Fi / MQTT / 在线AI
            </Descriptions.Item>
            <Descriptions.Item label="离线语音">
              CI1302 · 后续接入，不阻塞当前开发
            </Descriptions.Item>
            <Descriptions.Item label="当前串口">
              STM32 TX → C3 GPIO19 · 只读监听
            </Descriptions.Item>
            <Descriptions.Item label="发送状态">
              <Tag color="orange">GPIO18 禁止发送</Tag>
            </Descriptions.Item>
          </Descriptions>
        </section>
        <section className="workspace-section">
          <SectionTitle
            title="最近C3/MQTT记录"
            aside={<Tag>非样机验收结果</Tag>}
          />
          <TraceTable traces={realTraces.slice(0, 5)} compact />
        </section>
      </div>
      <Alert
        type="warning"
        showIcon
        title="下一阶段：STM32双向协议适配"
        description="在控制协议、帧方向和安全边界确认前，研发中心不会向样机发送数据。当前收到的32字节状态帧只作为串口接收链路已打通的证据。"
      />
    </div>
  );
}

function TopologyPage({
  board,
  product,
}: {
  board: BoardProfile;
  product?: ProductProfile;
}) {
  return (
    <div className="page-stack">
      <section className="workspace-section topology-section">
        <SectionTitle
          title="端到端系统拓扑"
          aside={<ExecutionModeTag board={board} />}
        />
        <div className="topology-canvas">
          <TopologyNode
            icon={<SoundOutlined />}
            title="CI1302"
            subtitle="唤醒 / 离线命令 / PCM"
            status="规划"
          />
          <TopologyLink top="UART 115200" bottom="I²S PCM" />
          <TopologyNode
            primary
            icon={<BlockOutlined />}
            title="ESP32-C3"
            subtitle="唯一业务主控 / 安全裁决"
            status={board.role === "DEVELOPMENT" ? "实板在线" : "候选"}
          />
          <TopologyLink top="WiFi / MQTT" bottom="设备影子 / 回执" />
          <TopologyNode
            icon={<CloudServerOutlined />}
            title="AI Gateway"
            subtitle="规则 / 知识库 / LLM / TTS"
            status="本地"
          />
          <div className="topology-branch topology-branch-left">
            <TopologyNode
              icon={<GatewayOutlined />}
              title="3 × PCF8574"
              subtitle="0x20 / 0x21 / 0x22"
              status={board.ioPorts.length ? "已分配" : "未接入"}
            />
          </div>
          <div className="topology-branch topology-branch-center">
            <TopologyNode
              icon={<LineChartOutlined />}
              title="NTC / 雷达"
              subtitle="ADC / 数字输入"
              status="待样板"
            />
          </div>
          <div className="topology-branch topology-branch-right">
            <TopologyNode
              icon={<ControlOutlined />}
              title="本地控制"
              subtitle="墙面板 / 手持遥控器"
              status="BLE协议"
            />
          </div>
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle
          title="总线与接口"
          aside={
            <span className="muted">
              {board.name} · {board.revision}
            </span>
          }
        />
        <div className="bus-grid">
          {board.buses.map((bus) => (
            <article className="bus-item" key={bus.id}>
              <div className="bus-icon">
                {bus.bus === "I2C" ? (
                  <ApiOutlined />
                ) : bus.bus === "USB" ? (
                  <UsbOutlined />
                ) : bus.bus === "BLE" ? (
                  <WifiOutlined />
                ) : (
                  <GatewayOutlined />
                )}
              </div>
              <div>
                <div className="bus-title">
                  <strong>{bus.name}</strong>
                  <StatusTag status={bus.status} />
                </div>
                <p>{bus.endpoint}</p>
                <small>{bus.parameters}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle title="职责边界" />
        <div className="boundary-grid">
          <Boundary
            title="C3负责"
            items={[
              "命令汇聚与去重",
              "安全状态机与互锁",
              "设备状态与MQTT",
              "PCF/GPIO/ADC硬件抽象",
            ]}
          />
          <Boundary
            title="CI1302负责"
            items={[
              "小东小东唤醒",
              "固定命令离线识别",
              "麦克风与提示音",
              "在线语音PCM前端",
            ]}
          />
          <Boundary
            title="东信硬件负责"
            items={[
              "低压电源与隔离",
              "电机/继电器/可控硅驱动",
              "硬件温断与保险丝",
              "220V安全、EMC与认证",
            ]}
          />
          <Boundary
            title="云平台负责"
            items={[
              "ASR与低成本规则路由",
              "知识库/LLM/TTS",
              "设备管理与告警",
              "发布、审计和费用",
            ]}
          />
        </div>
        {product ? (
          <p className="section-footnote">
            产品基线：{product.name} ·{" "}
            {
              product.capabilities.filter((item) => item.support === "ENABLED")
                .length
            }
            项已启用能力
          </p>
        ) : null}
      </section>
    </div>
  );
}

function PinsPage({
  board,
  boards,
  onBoardChange,
}: {
  board: BoardProfile;
  boards: BoardProfile[];
  onBoardChange: (id: string) => void;
}) {
  const [view, setView] = useState<string>("芯片引脚");
  const left = board.pins.filter((pin) => pin.side === "LEFT");
  const right = board.pins.filter((pin) => pin.side === "RIGHT");
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Segmented
          value={view}
          onChange={(value) => setView(String(value))}
          options={["芯片引脚", "PCF8574", "接口总线"]}
        />
        <Select
          value={board.id}
          onChange={onBoardChange}
          options={boards.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.revision}`,
          }))}
        />
      </div>
      {view === "芯片引脚" ? (
        <>
          <Alert
            type={board.lifecycle === "DRAFT" ? "warning" : "info"}
            showIcon
            title={board.summary}
          />
          <section className="workspace-section">
            <SectionTitle title="芯片引脚图" />
            <div className="chip-pinout">
              <div className="pin-column left-pins">
                {left.map((pin) => (
                  <PinBadge key={pin.id} pin={pin} />
                ))}
              </div>
              <div className="chip-body">
                <span>ESPRESSIF</span>
                <strong>ESP32-C3</strong>
                <small>{board.revision}</small>
                <div className="chip-notch" />
              </div>
              <div className="pin-column right-pins">
                {right.map((pin) => (
                  <PinBadge key={pin.id} pin={pin} right />
                ))}
              </div>
            </div>
          </section>
          <PinTable pins={board.pins} />
        </>
      ) : null}
      {view === "PCF8574" ? <IoMatrix ports={board.ioPorts} /> : null}
      {view === "接口总线" ? (
        <section className="workspace-section">
          <SectionTitle title="接口总线定义" />
          <Table
            rowKey="id"
            pagination={false}
            dataSource={board.buses}
            columns={[
              {
                title: "总线",
                dataIndex: "bus",
                width: 90,
                render: (value: string) => <Tag>{value}</Tag>,
              },
              { title: "名称", dataIndex: "name", width: 180 },
              { title: "端点", dataIndex: "endpoint" },
              { title: "参数", dataIndex: "parameters" },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (value: HardwareDefinitionStatus) => (
                  <StatusTag status={value} />
                ),
              },
            ]}
          />
        </section>
      ) : null}
      <section className="constraint-band">
        <strong>
          <SafetyCertificateOutlined /> 板级约束
        </strong>
        {board.knownConstraints.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </section>
    </div>
  );
}

function FirmwarePage({ traces }: { traces: DeviceExecutionTrace[] }) {
  const [selectedId, setSelectedId] = useState(traces[0]?.traceId || "");
  useEffect(() => {
    if (!traces.some((item) => item.traceId === selectedId))
      setSelectedId(traces[0]?.traceId || "");
  }, [traces, selectedId]);
  const selected =
    traces.find((item) => item.traceId === selectedId) ?? traces[0];
  return (
    <div className="trace-layout">
      <section className="trace-list-panel">
        <SectionTitle title="命令轨迹" aside={<Tag>{traces.length}</Tag>} />
        <div className="trace-list">
          {traces.map((trace) => (
            <button
              key={trace.traceId}
              className={`trace-list-item ${selected?.traceId === trace.traceId ? "selected" : ""}`}
              onClick={() => setSelectedId(trace.traceId)}
            >
              <span>
                <strong>{intentLabels[trace.intent] || trace.intent}</strong>
                <small>{formatTime(trace.startedAt)}</small>
              </span>
              <CommandStatus status={trace.status} />
            </button>
          ))}
        </div>
      </section>
      <section className="workspace-section trace-detail">
        {selected ? (
          <>
            <SectionTitle
              title={intentLabels[selected.intent] || selected.intent}
              aside={
                <Space>
                  <ExecutionPathTag path={selected.executionPath} />
                  <CommandStatus status={selected.status} />
                </Space>
              }
            />
            <Alert
              className="trace-notice"
              type="info"
              showIcon
              title="控制结果来自C3真实回执；中间阶段当前由命令生命周期重建，阶段级耗时将在固件Trace事件接入后显示。"
            />
            <div className="trace-meta">
              <span>
                Trace <code>{selected.traceId}</code>
              </span>
              <span>
                Command <code>{selected.commandId}</code>
              </span>
              <span>{formatTime(selected.startedAt)}</span>
            </div>
            <div className="stage-flow">
              {selected.stages.map((stage, index) => (
                <TraceStage
                  key={stage.key}
                  stage={stage}
                  last={index === selected.stages.length - 1}
                />
              ))}
            </div>
            <div className="trace-result-grid">
              <div>
                <span>错误码</span>
                <strong>{selected.errorCode || "无"}</strong>
              </div>
              <div>
                <span>执行说明</span>
                <strong>{selected.message || "设备已完成回执"}</strong>
              </div>
              <div>
                <span>耗时</span>
                <strong>
                  {durationText(selected.startedAt, selected.completedAt)}
                </strong>
              </div>
            </div>
          </>
        ) : (
          <Empty description="当前设备暂无执行轨迹" />
        )}
      </section>
    </div>
  );
}

function FlashingPage() {
  const { message, modal } = App.useApp();
  const [health, setHealth] = useState<LocalAgentHealth | null>(null);
  const [ports, setPorts] = useState<LocalSerialPort[]>([]);
  const [job, setJob] = useState<LocalAgentJob | null>(null);
  const [boardId, setBoardId] =
    useState<LocalAgentJob["boardId"]>("lichuang-c3-audio");
  const [port, setPort] = useState("COM5");
  const [loading, setLoading] = useState(true);
  const running = job?.status === "RUNNING";

  async function refreshLocal(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [nextHealth, nextPorts, nextJob] = await Promise.all([
        getLocalAgentHealth(),
        getLocalSerialPorts(),
        getCurrentLocalAgentJob(),
      ]);
      setHealth(nextHealth);
      setPorts(nextPorts);
      setJob(nextJob);
      if (!nextPorts.some((item) => item.path === port)) {
        const preferred =
          nextPorts.find((item) => item.path === "COM5") ?? nextPorts[0];
        if (preferred) setPort(preferred.path);
      }
    } catch (error) {
      setHealth(null);
      setPorts([]);
      if (!silent)
        message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshLocal();
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void getCurrentLocalAgentJob()
        .then(setJob)
        .catch(() => setHealth(null));
    }, 500);
    return () => window.clearInterval(timer);
  }, [running, job?.id]);

  async function launch(action: LocalAgentJobAction) {
    if (action !== "BUILD" && !port) {
      message.warning("请先选择串口");
      return;
    }
    try {
      setJob(
        await startLocalAgentJob({
          action,
          boardId,
          port: action === "BUILD" ? undefined : port,
        }),
      );
      message.success(
        action === "MONITOR" ? "串口监视已启动" : "本机任务已启动",
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function confirmFlash(action: "FLASH" | "BUILD_FLASH") {
    modal.confirm({
      title: action === "FLASH" ? "烧录当前固件" : "构建并烧录固件",
      content: `将写入 ${port} 上连接的 ${boardId === "lichuang-c3-audio" ? "立创 ESP32-C3 音频板" : "ESP32-C3 SuperMini"}。请确认板卡型号和串口无误。`,
      okText: "确认烧录",
      cancelText: "取消",
      onOk: () => launch(action),
    });
  }

  async function stopJob() {
    if (!job) return;
    try {
      setJob(await stopLocalAgentJob(job.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const portOptions = ports.map((item) => ({
    value: item.path,
    label: `${item.path}${item.manufacturer ? ` · ${item.manufacturer}` : ""}`,
  }));

  return (
    <div className="page-stack">
      <Alert
        type={health ? "success" : "warning"}
        showIcon
        title={
          health
            ? `本机烧录助手已连接 · v${health.version}`
            : "本机烧录助手未连接"
        }
        description={
          health
            ? "烧录动作只在当前电脑执行，服务器不直接访问本机 COM 口。"
            : "启动项目服务后再检测。云端部署时需要在插有开发板的电脑上运行东信烧录助手。"
        }
      />
      <div className="flash-layout">
        <section className="workspace-section flash-control-panel">
          <SectionTitle
            title="开发板连接"
            aside={
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void refreshLocal()}
              >
                重新检测
              </Button>
            }
          />
          <div className="flash-form">
            <label>
              <span>板型</span>
              <Select
                value={boardId}
                onChange={setBoardId}
                options={[
                  { value: "lichuang-c3-audio", label: "立创 ESP32-C3 音频板" },
                  {
                    value: "esp32-c3-supermini",
                    label: "ESP32-C3 SuperMini HW-466AB",
                  },
                ]}
              />
            </label>
            <label>
              <span>串口</span>
              <Select
                value={port || undefined}
                onChange={setPort}
                placeholder="未检测到串口"
                options={portOptions}
              />
            </label>
          </div>
          <div className="flash-port-detail">
            <UsbOutlined />
            <div>
              <strong>{port || "未连接"}</strong>
              <span>
                {ports.find((item) => item.path === port)?.manufacturer ||
                  "等待开发板"}
              </span>
            </div>
            <Badge
              status={
                ports.some((item) => item.path === port) ? "success" : "default"
              }
              text={
                ports.some((item) => item.path === port) ? "可用" : "不可用"
              }
            />
          </div>
          <div className="flash-actions">
            <Button
              icon={<CodeOutlined />}
              disabled={!health || running}
              onClick={() => void launch("BUILD")}
            >
              仅构建
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              disabled={!health || !port || running}
              onClick={() => confirmFlash("FLASH")}
            >
              烧录已有固件
            </Button>
            <Button
              type="primary"
              icon={<BuildOutlined />}
              disabled={!health || !port || running}
              onClick={() => confirmFlash("BUILD_FLASH")}
            >
              构建并烧录
            </Button>
            <Button
              icon={<UsbOutlined />}
              disabled={!health || !port || running}
              onClick={() => void launch("MONITOR")}
            >
              串口监视
            </Button>
            <Button
              danger
              icon={<StopOutlined />}
              disabled={!running}
              onClick={() => void stopJob()}
            >
              停止任务
            </Button>
          </div>
          <Alert
            type="info"
            showIcon
            title="音频安全"
            description="烧录和串口监视不会主动播放音乐或测试音。语音播放测试必须在单独确认音量后启动。"
          />
        </section>
        <section className="workspace-section flash-job-panel">
          <SectionTitle
            title="任务状态"
            aside={
              job ? <FlashJobStatus status={job.status} /> : <Tag>等待任务</Tag>
            }
          />
          {job ? (
            <div className="flash-job-meta">
              <span>
                动作<strong>{flashActionLabel(job.action)}</strong>
              </span>
              <span>
                板型<strong>{job.boardId}</strong>
              </span>
              <span>
                串口<strong>{job.port || "-"}</strong>
              </span>
              <span>
                开始<strong>{formatTime(job.startedAt)}</strong>
              </span>
            </div>
          ) : null}
          <div className="flash-log" role="log" aria-label="烧录任务日志">
            {job?.logs.length ? (
              job.logs.map((item, index) => (
                <div
                  className={`log-${item.stream.toLowerCase()}`}
                  key={`${item.at}-${index}`}
                >
                  <time>
                    {new Date(item.at).toLocaleTimeString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                  <span>{item.text}</span>
                </div>
              ))
            ) : (
              <span className="flash-log-empty">
                构建、烧录和串口输出将在这里显示
              </span>
            )}
          </div>
        </section>
      </div>
      <section className="workspace-section">
        <SectionTitle title="研发烧录流程" />
        <div className="manufacturing-flow">
          <FlowNode title="检测板卡" note="确认板型与 COM" />
          <FlowArrow />
          <FlowNode title="构建固件" note="固定配置、可复现产物" />
          <FlowArrow />
          <FlowNode title="烧录" note="写入当前样板" />
          <FlowArrow />
          <FlowNode title="串口检查" note="启动、联网、自动注册" />
          <FlowArrow />
          <FlowNode title="功能测试" note="转到实板联调与语音" />
        </div>
      </section>
    </div>
  );
}

function FlashJobStatus({ status }: { status: LocalAgentJob["status"] }) {
  const map = {
    RUNNING: ["processing", "执行中"],
    SUCCEEDED: ["success", "已完成"],
    FAILED: ["error", "失败"],
    CANCELLED: ["warning", "已停止"],
  } as const;
  const [badgeStatus, label] = map[status];
  return <Badge status={badgeStatus} text={label} />;
}

function flashActionLabel(action: LocalAgentJobAction): string {
  return (
    {
      BUILD: "仅构建",
      FLASH: "烧录已有固件",
      BUILD_FLASH: "构建并烧录",
      MONITOR: "串口监视",
    } as const
  )[action];
}

function TestingPage(props: {
  board: BoardProfile;
  device: DeviceProfile | null;
  state: DeviceState | null;
  traces: DeviceExecutionTrace[];
  sendingIntent: string | null;
  onCommand: (intent: string) => void;
}) {
  const virtual = props.board.executionMode === "LOCAL_VIRTUAL";
  const readOnlyMonitor = props.board.executionMode === "STM32_UART_MONITOR";
  const outputList = [
    ["照明", "LIGHT_ON"],
    ["吹风", "FAN_ON"],
    ["换气", "VENTILATION_ON"],
    ["弱暖", "HEAT_WEAK_ON"],
    ["强暖", "HEAT_STRONG_ON"],
    ["摆风", "SWING_ON"],
  ];
  return (
    <div className="page-stack">
      <Alert
        type={readOnlyMonitor ? "info" : virtual ? "info" : "warning"}
        showIcon
        title={
          readOnlyMonitor
            ? "当前为STM32串口只读监听：GPIO19接收已验证，GPIO18发送保持禁用"
            : virtual
              ? "当前为LOCAL_VIRTUAL：只验证C3内部逻辑，不驱动物理负载"
              : "当前为物理HAL：操作前必须确认低压台架和安全隔离"
        }
        description={
          readOnlyMonitor
            ? "控制按钮将在完成STM32双向协议适配和安全检查后开放。下方C3设备影子不是STM32样机的真实执行状态。"
            : undefined
        }
      />
      <div className="test-grid">
        <section className="workspace-section command-console">
          <SectionTitle
            title="样机控制"
            aside={
              readOnlyMonitor ? (
                <Tag color="orange">只读，发送已锁定</Tag>
              ) : (
                <Badge
                  status={
                    props.device?.status === "ONLINE" ? "success" : "default"
                  }
                  text={
                    props.device?.status === "ONLINE" ? "设备在线" : "设备离线"
                  }
                />
              )
            }
          />
          <div className="command-groups">
            <CommandGroup title="照明">
              <CommandButton
                label="开启"
                intent="LIGHT_ON"
                icon={<ThunderboltOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="关闭"
                intent="LIGHT_OFF"
                icon={<PoweroffOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
            </CommandGroup>
            <CommandGroup title="风路">
              <CommandButton
                label="吹风"
                intent="FAN_ON"
                icon={<GatewayOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="关风"
                intent="FAN_OFF"
                icon={<PoweroffOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="换气"
                intent="VENTILATION_ON"
                icon={<GatewayOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="关换气"
                intent="VENTILATION_OFF"
                icon={<PoweroffOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
            </CommandGroup>
            <CommandGroup title="取暖">
              <CommandButton
                label="弱暖"
                intent="HEAT_WEAK_ON"
                icon={<FireOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="强暖"
                intent="HEAT_STRONG_ON"
                icon={<FireOutlined />}
                controlsDisabled={readOnlyMonitor}
                danger
                {...props}
              />
              <CommandButton
                label="关取暖"
                intent="HEAT_STRONG_OFF"
                icon={<PoweroffOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
            </CommandGroup>
            <CommandGroup title="安全验证">
              <CommandButton
                label="开启恒温"
                intent="CONSTANT_TEMP_ON"
                icon={<SafetyCertificateOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
              <CommandButton
                label="整机待机"
                intent="STANDBY"
                icon={<PoweroffOutlined />}
                controlsDisabled={readOnlyMonitor}
                {...props}
              />
            </CommandGroup>
          </div>
        </section>
        <section className="workspace-section state-console">
          <SectionTitle
            title={
              readOnlyMonitor ? "C3研发状态（非STM32实机状态）" : "设备影子"
            }
            aside={
              <span className="muted">
                {props.state?.updatedAt
                  ? formatTime(props.state.updatedAt)
                  : "等待上报"}
              </span>
            }
          />
          <div className="state-power">
            <span>POWER</span>
            <strong>{props.state?.activeModes.length ? "ON" : "OFF"}</strong>
          </div>
          <div className="output-grid">
            {outputList.map(([label, intent]) => {
              const active =
                props.state?.activeModes.includes(intent as never) ||
                (intent === "HEAT_WEAK_ON" &&
                  props.state?.activeModes.includes("HEAT_STRONG_ON"));
              return (
                <div
                  className={`output-cell ${active ? "active" : ""}`}
                  key={intent}
                >
                  <span className="output-led" />
                  <span>{label}</span>
                  <strong>{active ? "ON" : "OFF"}</strong>
                </div>
              );
            })}
          </div>
          <div className="sensor-strip">
            <span>
              目标温度<strong>{props.state?.targetTemperature ?? "-"}℃</strong>
            </span>
            <span>
              环境温度
              <strong>{props.state?.ambientTemperature || "未接入"}</strong>
            </span>
            <span>
              故障<strong>{props.state?.faultCode || "无"}</strong>
            </span>
          </div>
        </section>
      </div>
      <section className="workspace-section">
        <SectionTitle
          title="C3命令与联调记录"
          aside={readOnlyMonitor ? <Tag>不得作为样机动作证明</Tag> : undefined}
        />
        <TraceTable traces={props.traces.slice(0, 10)} />
      </section>
    </div>
  );
}

function BoardLabPage({
  device,
  onOpenAudio,
}: {
  device: DeviceProfile | null;
  onOpenAudio: () => void;
}) {
  const { message } = App.useApp();
  const [labState, setLabState] = useState<BoardLabDeviceState | null>(null);
  const [snapshot, setSnapshot] = useState<BoardLabSnapshot | null>(null);
  const [activeRequest, setActiveRequest] =
    useState<BoardLabRequestRecord | null>(null);
  const [brightness, setBrightness] = useState(20);
  const [continuousSampling, setContinuousSampling] = useState(false);
  const busyRef = useRef(false);

  async function refreshLabState() {
    if (!device) return;
    try {
      const next = await getBoardLabDeviceState(device.id);
      setLabState(next);
      setActiveRequest(next.latest);
      if (next.latest?.result) {
        setSnapshot(next.latest.result);
        setBrightness(
          Math.max(5, next.latest.result.display.brightnessPercent || 20),
        );
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function performAction(
    action: BoardLabRequestRecord["action"],
    params: Record<string, unknown> = {},
    silent = false,
  ): Promise<void> {
    if (!device || busyRef.current) return;
    busyRef.current = true;
    try {
      let request = await startBoardLabAction(device.id, action, params);
      setActiveRequest(request);
      for (
        let attempt = 0;
        request.status === "PENDING" && attempt < 60;
        attempt += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        request = await getBoardLabRequest(request.requestId);
        setActiveRequest(request);
      }
      if (request.status === "COMPLETED") {
        if (request.result) setSnapshot(request.result);
        if (!silent) message.success(request.message || "开发板执行完成");
      } else if (!silent) {
        message.error(request.message || "开发板执行失败");
      }
    } catch (error) {
      if (!silent)
        message.error(error instanceof Error ? error.message : String(error));
      setContinuousSampling(false);
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    setLabState(null);
    setSnapshot(null);
    setActiveRequest(null);
    setContinuousSampling(false);
    void refreshLabState();
  }, [device?.id]);

  useEffect(() => {
    if (!continuousSampling) return;
    const timer = window.setInterval(() => {
      void performAction("snapshot", {}, true);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [continuousSampling, device?.id]);

  const ready = Boolean(labState?.online && labState.supported);
  const pending = activeRequest?.status === "PENDING";
  const display = snapshot?.display;
  const componentsPresent =
    snapshot?.components.filter((item) => item.present).length ?? 0;
  const patterns = [
    ["COLOR_BARS", "彩条", "bars"],
    ["CHECKERBOARD", "棋盘格", "checker"],
    ["RED", "红色", "red"],
    ["GREEN", "绿色", "green"],
    ["BLUE", "蓝色", "blue"],
    ["WHITE", "白色", "white"],
    ["BLACK", "黑色", "black"],
  ] as const;

  return (
    <div className="page-stack board-lab-page">
      <Alert
        type={ready ? "info" : "warning"}
        showIcon
        title={
          ready
            ? "板卡实验功能按需执行，屏幕和功放不会自动开启"
            : "请选择在线的立创实战派 ESP32-C3 音频板，并烧录支持 Board Lab 的固件"
        }
        description="读取传感器不会产生声光输出；屏幕测试仅在点击对应控件后执行。音频测试仍需进入 AI 与语音页面手动确认。"
      />

      <div className="page-toolbar board-lab-toolbar">
        <Space wrap>
          <Badge
            status={labState?.online ? "success" : "default"}
            text={labState?.online ? "设备在线" : "设备离线"}
          />
          <Tag color={labState?.supported ? "green" : "default"}>
            {labState?.supported ? "Board Lab 已启用" : "固件未启用"}
          </Tag>
          {activeRequest ? (
            <Tag
              color={
                activeRequest.status === "COMPLETED"
                  ? "green"
                  : activeRequest.status === "FAILED"
                    ? "red"
                    : "blue"
              }
            >
              {boardLabStatusLabel(activeRequest.status)}
            </Tag>
          ) : null}
        </Space>
        <Space wrap>
          <span className="refresh-control">
            <Switch
              size="small"
              checked={continuousSampling}
              disabled={!ready}
              onChange={setContinuousSampling}
            />{" "}
            连续采样
          </span>
          <Button
            icon={<ReloadOutlined />}
            disabled={!ready}
            loading={pending}
            onClick={() => void performAction("snapshot")}
          >
            读取实板
          </Button>
        </Space>
      </div>

      <section className="metric-grid" aria-label="开发板运行状态">
        <Metric
          label="固件版本"
          value={
            snapshot?.system.firmwareVersion || device?.firmwareVersion || "-"
          }
          detail={device?.id || "未选择设备"}
          tone="green"
        />
        <Metric
          label="网络"
          value={snapshot?.network.ip || "-"}
          detail={
            snapshot?.network.rssi === undefined
              ? "等待读取"
              : `RSSI ${snapshot.network.rssi} dBm`
          }
        />
        <Metric
          label="运行时间"
          value={snapshot ? formatUptime(snapshot.system.uptimeMs) : "-"}
          detail="本次上电"
        />
        <Metric
          label="空闲堆内存"
          value={
            snapshot
              ? `${Math.round(snapshot.system.freeHeapBytes / 1024)} KB`
              : "-"
          }
          detail={
            snapshot
              ? `最低 ${Math.round(snapshot.system.minimumFreeHeapBytes / 1024)} KB`
              : "等待读取"
          }
        />
      </section>

      <section className="workspace-section">
        <SectionTitle
          title="板载 I²C 设备"
          aside={
            <span className="muted">
              {snapshot
                ? `${componentsPresent}/${snapshot.components.length} 已响应`
                : "等待读取"}
            </span>
          }
        />
        <div className="board-component-grid">
          {(
            snapshot?.components ?? [
              {
                id: "es8311",
                name: "ES8311 音频 Codec",
                address: "0x18",
                present: false,
              },
              {
                id: "ft6336",
                name: "FT6336 触摸",
                address: "0x38",
                present: false,
              },
              {
                id: "qmi8658c",
                name: "QMI8658C 六轴",
                address: "0x6A",
                present: false,
              },
              {
                id: "qmc5883l",
                name: "QMC5883L 罗盘",
                address: "0x0D",
                present: false,
              },
              {
                id: "gxhtc3",
                name: "GXHTC3 温湿度",
                address: "0x70",
                present: false,
              },
            ]
          ).map((component) => (
            <div
              className={`board-component ${component.present ? "present" : ""}`}
              key={component.id}
            >
              <span className="board-component-led" />
              <div>
                <strong>{component.name}</strong>
                <code>{component.address}</code>
              </div>
              <Tag
                color={
                  snapshot ? (component.present ? "green" : "red") : "default"
                }
              >
                {snapshot ? (component.present ? "正常" : "未响应") : "待检测"}
              </Tag>
            </div>
          ))}
        </div>
      </section>

      <div className="board-sensor-grid">
        <section className="workspace-section board-sensor-panel">
          <SectionTitle
            title="温湿度"
            aside={<StatusDot available={snapshot?.environment.available} />}
          />
          <div className="board-reading-primary">
            {formatLabNumber(snapshot?.environment.temperatureC, 1)}
            <small>℃</small>
          </div>
          <div className="board-reading-row">
            <span>相对湿度</span>
            <strong>
              {formatLabNumber(snapshot?.environment.humidityPercent, 1)}%
            </strong>
          </div>
        </section>
        <section className="workspace-section board-sensor-panel">
          <SectionTitle
            title="六轴姿态"
            aside={<StatusDot available={snapshot?.motion.available} />}
          />
          <div className="board-axis-grid">
            <Axis label="Roll" value={snapshot?.motion.roll} unit="°" />
            <Axis label="Pitch" value={snapshot?.motion.pitch} unit="°" />
            <Axis label="AX" value={snapshot?.motion.accelX} />
            <Axis label="AY" value={snapshot?.motion.accelY} />
            <Axis label="AZ" value={snapshot?.motion.accelZ} />
            <Axis label="GZ" value={snapshot?.motion.gyroZ} />
          </div>
        </section>
        <section className="workspace-section board-sensor-panel">
          <SectionTitle
            title="电子罗盘"
            aside={<StatusDot available={snapshot?.compass.available} />}
          />
          <div className="board-reading-primary">
            {formatLabNumber(snapshot?.compass.heading, 1)}
            <small>°</small>
          </div>
          <div className="board-axis-grid compact">
            <Axis label="X" value={snapshot?.compass.x} />
            <Axis label="Y" value={snapshot?.compass.y} />
            <Axis label="Z" value={snapshot?.compass.z} />
          </div>
        </section>
        <section className="workspace-section board-sensor-panel">
          <SectionTitle
            title="触摸与按键"
            aside={<StatusDot available={snapshot?.touch.available} />}
          />
          <div className="board-input-state">
            <span>屏幕触摸</span>
            <strong>{snapshot?.touch.pressed ? "按下" : "释放"}</strong>
            <code>
              {snapshot?.touch.pressed
                ? `原始 X ${snapshot.touch.x ?? "-"} / Y ${snapshot.touch.y ?? "-"}`
                : "原始坐标 -"}
            </code>
          </div>
          <div className="board-input-state">
            <span>语音录制按键 GPIO9</span>
            <strong>{snapshot?.button.pressed ? "按下" : "释放"}</strong>
            <code>低电平有效；按下会启动真实语音链路</code>
          </div>
        </section>
      </div>

      <section className="workspace-section board-display-console">
        <SectionTitle
          title="LCD 屏幕实验"
          aside={
            <Badge
              status={display?.on ? "success" : "default"}
              text={display?.on ? "已开启" : "已关闭"}
            />
          }
        />
        <div className="board-display-layout">
          <div className="board-display-controls">
            <label>
              <span>屏幕电源</span>
              <Switch
                checked={Boolean(display?.on)}
                disabled={!ready || pending}
                onChange={(enabled) =>
                  void performAction("display_power", {
                    enabled,
                    brightnessPercent: brightness,
                  })
                }
              />
            </label>
            <label className="board-brightness">
              <span>背光亮度</span>
              <Slider
                min={5}
                max={80}
                value={brightness}
                onChange={setBrightness}
                marks={{ 5: "5%", 20: "20%", 50: "50%", 80: "80%" }}
              />
              <InputNumber
                min={5}
                max={80}
                value={brightness}
                formatter={(value) => `${value}%`}
                parser={(value) => Number(value?.replace("%", ""))}
                onChange={(value) => value !== null && setBrightness(value)}
              />
            </label>
          </div>
          <div className="board-pattern-grid">
            {patterns.map(([pattern, label, swatch]) => (
              <Button
                key={pattern}
                disabled={!ready || pending}
                onClick={() =>
                  void performAction("display_pattern", {
                    pattern,
                    brightnessPercent: brightness,
                  })
                }
              >
                <span className={`pattern-swatch swatch-${swatch}`} />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="workspace-section">
        <SectionTitle title="其他板载能力" />
        <div className="board-capability-list">
          <div>
            <WifiOutlined />
            <span>
              <strong>Wi-Fi / MQTT</strong>
              <small>当前设备联网、遥测与命令通道</small>
            </span>
            <Tag color={labState?.online ? "green" : "default"}>
              {labState?.online ? "可验证" : "离线"}
            </Tag>
          </div>
          <div>
            <SoundOutlined />
            <span>
              <strong>麦克风 / 扬声器</strong>
              <small>录音、ASR、TTS 与受控音量测试</small>
            </span>
            <Button
              size="small"
              disabled={!labState?.capabilities.audioPlayback}
              onClick={onOpenAudio}
            >
              进入音频测试
            </Button>
          </div>
          <div>
            <ControlOutlined />
            <span>
              <strong>BLE 5.0</strong>
              <small>芯片支持；扫描会影响 Wi-Fi 联调，当前固件未启用</small>
            </span>
            <Tag>暂不开放</Tag>
          </div>
          <div>
            <SafetyCertificateOutlined />
            <span>
              <strong>Flash / eFuse</strong>
              <small>可查询构建信息；擦除和永久熔丝操作不在网页开放</small>
            </span>
            <Tag color="orange">受保护</Tag>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusDot({ available }: { available?: boolean }) {
  return (
    <Badge
      status={available ? "success" : "default"}
      text={available ? "已采样" : "等待采样"}
    />
  );
}

function Axis({
  label,
  value,
  unit = "",
}: {
  label: string;
  value?: number;
  unit?: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {formatLabNumber(value, 1)}
        {value === undefined ? "" : unit}
      </strong>
    </div>
  );
}

function formatLabNumber(value: number | undefined, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "-";
}

function formatUptime(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function boardLabStatusLabel(status: BoardLabRequestRecord["status"]): string {
  return (
    {
      PENDING: "等待实板回执",
      COMPLETED: "执行完成",
      FAILED: "执行失败",
    } as const
  )[status];
}

function AiServicesPage() {
  const { message } = App.useApp();
  const [configuration, setConfiguration] =
    useState<AiServiceConfiguration | null>(null);
  const [serviceType, setServiceType] = useState<"ASR" | "LLM" | "TTS">("ASR");
  const [diagnostics, setDiagnostics] = useState<
    Record<string, ProviderDiagnosticResult>
  >({});
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function refreshConfiguration() {
    try {
      setConfiguration(await getAiServiceConfiguration());
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void refreshConfiguration();
  }, []);

  const providers =
    configuration?.providers.filter(
      (item) => item.serviceType === serviceType,
    ) ?? [];
  const defaultId = configuration?.defaults[serviceType] ?? null;

  async function changeDefault(providerId: string) {
    try {
      const defaults = await setDefaultAiProvider(serviceType, providerId);
      setConfiguration((current) =>
        current ? { ...current, defaults } : current,
      );
      message.success(`${serviceType} 默认服务已更新`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveKey(provider: ModelProvider) {
    const apiKey = keyDrafts[provider.id]?.trim();
    if (!apiKey) return;
    try {
      const status = await saveProviderApiKey(provider.id, apiKey);
      setConfiguration((current) =>
        current
          ? {
              ...current,
              secrets: current.secrets.map((item) =>
                item.providerId === provider.id ? status : item,
              ),
            }
          : current,
      );
      setKeyDrafts((current) => ({ ...current, [provider.id]: "" }));
      message.success("API Key 已写入服务端，页面不会回显原文");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function runDiagnostic(providerId: string) {
    setDiagnosing(providerId);
    try {
      const result = await diagnoseAiProvider(providerId);
      setDiagnostics((current) => ({ ...current, [providerId]: result }));
      if (result.status === "PASSED") message.success("真实连通测试通过");
      else message.error(result.error || "连通测试失败");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnosing(null);
    }
  }

  function patchProvider(providerId: string, patch: Partial<ModelProvider>) {
    setConfiguration((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((item) =>
              item.id === providerId ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  async function persistProviders() {
    if (!configuration) return;
    setSaving(true);
    try {
      const next = await saveAiProviders(configuration.providers);
      setConfiguration({ ...configuration, providers: next });
      message.success("模型参数已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        title="这里的默认配置会直接用于语音链路和批量测试"
        description={configuration?.storage.detail || "正在读取服务配置"}
      />
      <section className="workspace-section ai-service-overview">
        <SectionTitle
          title="默认 AI 服务"
          aside={
            <Segmented
              value={serviceType}
              onChange={(value) => setServiceType(value as typeof serviceType)}
              options={["ASR", "LLM", "TTS"]}
            />
          }
        />
        <div className="service-summary-grid">
          {(["ASR", "LLM", "TTS"] as const).map((type) => {
            const provider = configuration?.providers.find(
              (item) => item.id === configuration.defaults[type],
            );
            const secret = configuration?.secrets.find(
              (item) => item.providerId === provider?.id,
            );
            return (
              <article
                className={serviceType === type ? "active" : ""}
                key={type}
                onClick={() => setServiceType(type)}
              >
                <span>{type}</span>
                <strong>{provider?.name || "未选择"}</strong>
                <small>{provider?.model || "-"}</small>
                <Badge
                  status={
                    secret?.isConfigured || !provider?.apiKeyEnv
                      ? "success"
                      : "error"
                  }
                  text={
                    secret?.isConfigured || !provider?.apiKeyEnv
                      ? "凭证已配置"
                      : "缺少 API Key"
                  }
                />
              </article>
            );
          })}
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle
          title={`${serviceType} 服务参数`}
          aside={
            <Space>
              <Select
                value={defaultId ?? undefined}
                placeholder="选择默认服务"
                onChange={(value) => void changeDefault(value)}
                options={providers.map((item) => ({
                  value: item.id,
                  label: item.name,
                  disabled: !item.enabled,
                }))}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void refreshConfiguration()}
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<FileDoneOutlined />}
                loading={saving}
                onClick={() => void persistProviders()}
              >
                保存参数
              </Button>
            </Space>
          }
        />
        <div className="provider-editor-list">
          {providers.map((provider) => {
            const secret = configuration?.secrets.find(
              (item) => item.providerId === provider.id,
            );
            const diagnostic = diagnostics[provider.id];
            return (
              <article
                className={`provider-editor ${provider.id === defaultId ? "default" : ""}`}
                key={provider.id}
              >
                <div className="provider-editor-head">
                  <div>
                    <strong>{provider.name}</strong>
                    <code>{provider.id}</code>
                  </div>
                  <Space>
                    <Tag
                      color={provider.id === defaultId ? "green" : "default"}
                    >
                      {provider.id === defaultId ? "默认" : "候选"}
                    </Tag>
                    <Switch
                      checked={provider.enabled}
                      onChange={(enabled) =>
                        patchProvider(provider.id, { enabled })
                      }
                    />
                  </Space>
                </div>
                <div className="provider-form-grid">
                  <label>
                    <span>模型 ID</span>
                    <Input
                      value={provider.model}
                      onChange={(event) =>
                        patchProvider(provider.id, {
                          model: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>服务地址</span>
                    <Input
                      value={provider.baseUrl || ""}
                      onChange={(event) =>
                        patchProvider(provider.id, {
                          baseUrl: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>超时（ms）</span>
                    <InputNumber
                      min={1000}
                      max={120000}
                      value={provider.timeoutMs}
                      onChange={(value) =>
                        value &&
                        patchProvider(provider.id, { timeoutMs: value })
                      }
                    />
                  </label>
                  {serviceType === "TTS" ? (
                    <label>
                      <span>音色</span>
                      <Input
                        value={provider.voice || ""}
                        onChange={(event) =>
                          patchProvider(provider.id, {
                            voice: event.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
                <div className="provider-secret-row">
                  <Input.Password
                    prefix={<KeyOutlined />}
                    value={keyDrafts[provider.id] || ""}
                    placeholder={
                      secret?.isConfigured
                        ? `${provider.apiKeyEnv} 已配置，输入新值可覆盖`
                        : `配置 ${provider.apiKeyEnv || "API Key"}`
                    }
                    onChange={(event) =>
                      setKeyDrafts((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    disabled={!keyDrafts[provider.id]?.trim()}
                    onClick={() => void saveKey(provider)}
                  >
                    保存 Key
                  </Button>
                  <Button
                    icon={<ApiOutlined />}
                    loading={diagnosing === provider.id}
                    onClick={() => void runDiagnostic(provider.id)}
                  >
                    真实连通测试
                  </Button>
                </div>
                {diagnostic ? (
                  <div
                    className={`diagnostic-result ${diagnostic.status.toLowerCase()}`}
                  >
                    <Badge
                      status={
                        diagnostic.status === "PASSED" ? "success" : "error"
                      }
                      text={diagnostic.status === "PASSED" ? "连通" : "失败"}
                    />
                    <span>{diagnostic.result}</span>
                    <code>{diagnostic.latencyMs} ms</code>
                    {diagnostic.error ? <p>{diagnostic.error}</p> : null}
                  </div>
                ) : null}
                <p className="provider-note">{provider.notes}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function BatchTestingPage({ device }: { device: DeviceProfile | null }) {
  const { message, modal } = App.useApp();
  const [configuration, setConfiguration] =
    useState<AiServiceConfiguration | null>(null);
  const [testSets, setTestSets] = useState<TestSetSummary[]>([]);
  const [datasets, setDatasets] = useState<AsrDataset[]>([]);
  const [runs, setRuns] = useState<BatchTestRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<BatchTestRun | null>(null);
  const [kind, setKind] = useState<"ASR" | "LLM" | "TTS">("LLM");
  const [providerSelections, setProviderSelections] = useState<
    Partial<Record<"ASR" | "LLM" | "TTS", string>>
  >({});
  const [testSetId, setTestSetId] = useState("standard-test-set");
  const [datasetId, setDatasetId] = useState("");
  const [maxCases, setMaxCases] = useState(30);
  const [repeatCount, setRepeatCount] = useState(1);
  const [starting, setStarting] = useState(false);
  const [datasetName, setDatasetName] = useState("ASR 实板录音测试集");
  const [expectedText, setExpectedText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function refreshBatchData() {
    try {
      const [nextConfiguration, nextTestSets, nextDatasets, nextRuns] =
        await Promise.all([
          getAiServiceConfiguration(),
          getTestSetSummaries(),
          getAsrDatasets(),
          getBatchTestRuns(),
        ]);
      setConfiguration(nextConfiguration);
      setTestSets(nextTestSets);
      setDatasets(nextDatasets);
      setRuns(nextRuns);
      setProviderSelections((current) => ({
        ASR: current.ASR || nextConfiguration.defaults.ASR || undefined,
        LLM: current.LLM || nextConfiguration.defaults.LLM || undefined,
        TTS: current.TTS || nextConfiguration.defaults.TTS || undefined,
      }));
      if (!datasetId && nextDatasets[0]) setDatasetId(nextDatasets[0].id);
      if (selectedRun)
        setSelectedRun(
          nextRuns.find((item) => item.id === selectedRun.id) || selectedRun,
        );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void refreshBatchData();
  }, []);
  const running = runs.some((item) =>
    ["QUEUED", "RUNNING"].includes(item.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refreshBatchData(), 1000);
    return () => window.clearInterval(timer);
  }, [running, selectedRun?.id]);

  const providers =
    configuration?.providers.filter(
      (item) => item.serviceType === kind && item.enabled,
    ) ?? [];
  const selectedProviderId = providerSelections[kind];
  const defaultProviderId = configuration?.defaults[kind];
  const providerId =
    (selectedProviderId &&
    providers.some((item) => item.id === selectedProviderId)
      ? selectedProviderId
      : defaultProviderId &&
          providers.some((item) => item.id === defaultProviderId)
        ? defaultProviderId
        : providers[0]?.id) || "";

  async function launchBatch() {
    if (!providerId) return message.warning("请先在 AI 服务配置中选择默认服务");
    setStarting(true);
    try {
      const run = await startBatchTest({
        name: `${kind} 批量测试 ${new Date().toLocaleString("zh-CN")}`,
        kind,
        providerId,
        deviceId: device?.id,
        testSetId: kind === "ASR" ? undefined : testSetId,
        asrDatasetId: kind === "ASR" ? datasetId : undefined,
        repeatCount,
        maxCases,
      });
      setRuns((current) => [run, ...current]);
      setSelectedRun(run);
      message.success("批量任务已启动");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  async function createDataset() {
    try {
      const dataset = await createAsrDataset({
        name: datasetName,
        description: "研发阶段原始录音，仅用于 ASR 准确率复查",
      });
      setDatasets((current) => [dataset, ...current]);
      setDatasetId(dataset.id);
      message.success("ASR 音频测试集已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function uploadAudio() {
    if (!datasetId || !audioFile || !expectedText.trim()) return;
    setUploading(true);
    try {
      const dataset = await addAsrDatasetAudio(datasetId, {
        fileName: audioFile.name,
        expectedText: expectedText.trim(),
        mimeType: audioFile.type || "application/octet-stream",
        audioBase64: await fileToBase64(audioFile),
      });
      setDatasets((current) =>
        current.map((item) => (item.id === dataset.id ? dataset : item)),
      );
      setAudioFile(null);
      setExpectedText("");
      message.success("录音及期望文本已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }

  function confirmDeleteDataset() {
    if (!selectedDataset) return;
    modal.confirm({
      title: `删除测试集“${selectedDataset.name}”？`,
      content: `将同时删除其中 ${selectedDataset.items.length} 条录音及原始音频文件，此操作不可撤销。历史批测报告仍会保留。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        try {
          await deleteAsrDataset(selectedDataset.id);
          const nextDatasets = datasets.filter(
            (item) => item.id !== selectedDataset.id,
          );
          setDatasets(nextDatasets);
          setDatasetId(nextDatasets[0]?.id || "");
          message.success("ASR 测试集及录音文件已删除");
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
  }

  function confirmDeleteRun(run: BatchTestRun) {
    modal.confirm({
      title: `删除任务“${run.name}”？`,
      content:
        "任务记录、逐条结果及该任务生成的 TTS 音频产物将被永久删除。建议先导出需要留档的报告。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        try {
          await deleteBatchTestRun(run.id);
          setRuns((current) => current.filter((item) => item.id !== run.id));
          setSelectedRun((current) =>
            current?.id === run.id ? null : current,
          );
          message.success("批量任务及关联产物已删除");
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
  }

  async function selectRun(run: BatchTestRun) {
    try {
      setSelectedRun(await getBatchTestRun(run.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const selectedDataset = datasets.find((item) => item.id === datasetId);
  return (
    <div className="page-stack">
      <Alert
        type="warning"
        showIcon
        title="批量 TTS 只生成音频文件，不会自动播放"
        description="所有运行记录、逐条结果和音频产物都会保留用于复查和交付；当前使用本地研发文件存储。"
      />
      <div className="batch-workbench">
        <section className="workspace-section batch-launch-panel">
          <SectionTitle
            title="新建批量任务"
            aside={
              <Segmented
                value={kind}
                onChange={(value) => setKind(value as typeof kind)}
                options={["ASR", "LLM", "TTS"]}
              />
            }
          />
          <div className="batch-form-grid">
            <label>
              <span>本次使用服务</span>
              <Select
                value={providerId || undefined}
                onChange={(value) =>
                  setProviderSelections((current) => ({
                    ...current,
                    [kind]: value,
                  }))
                }
                options={providers.map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.id === configuration?.defaults[kind] ? "（默认）" : ""}`,
                }))}
              />
            </label>
            {kind === "ASR" ? (
              <label>
                <span>音频测试集</span>
                <Select
                  value={datasetId || undefined}
                  placeholder="先创建音频测试集"
                  onChange={setDatasetId}
                  options={datasets.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.items.length}条`,
                  }))}
                />
              </label>
            ) : (
              <label>
                <span>文本测试集</span>
                <Select
                  value={testSetId}
                  onChange={setTestSetId}
                  options={testSets.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.caseCount}条`,
                  }))}
                />
              </label>
            )}
            <label>
              <span>本次条数</span>
              <InputNumber
                min={1}
                max={200}
                value={maxCases}
                onChange={(value) => setMaxCases(value || 1)}
              />
            </label>
            <label>
              <span>重复次数</span>
              <InputNumber
                min={1}
                max={3}
                value={repeatCount}
                onChange={(value) => setRepeatCount(value || 1)}
              />
            </label>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            loading={starting}
            disabled={
              !providerId ||
              (kind === "ASR" ? !selectedDataset?.items.length : !testSetId)
            }
            onClick={() => void launchBatch()}
          >
            开始批量测试
          </Button>
        </section>
        <section className="workspace-section asr-dataset-panel">
          <SectionTitle
            title="ASR 录音数据"
            aside={
              <Space>
                <Tag>{selectedDataset?.items.length || 0} 条</Tag>
                <Tooltip title="删除当前测试集及录音">
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    disabled={!selectedDataset}
                    aria-label="删除当前 ASR 测试集"
                    onClick={confirmDeleteDataset}
                  />
                </Tooltip>
              </Space>
            }
          />
          <div className="dataset-create-row">
            <Input
              value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)}
            />
            <Button
              icon={<PlusOutlined />}
              disabled={!datasetName.trim()}
              onClick={() => void createDataset()}
            >
              创建测试集
            </Button>
          </div>
          <Select
            value={datasetId || undefined}
            placeholder="选择测试集"
            onChange={setDatasetId}
            options={datasets.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Input
            value={expectedText}
            onChange={(event) => setExpectedText(event.target.value)}
            placeholder="这段录音应该识别成什么文字"
            maxLength={500}
          />
          <label className="audio-file-picker">
            <UploadOutlined />
            <span>{audioFile?.name || "选择 WAV / MP3 / M4A / WebM 录音"}</span>
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.pcm"
              onChange={(event) =>
                setAudioFile(event.target.files?.[0] || null)
              }
            />
          </label>
          <Button
            icon={<UploadOutlined />}
            loading={uploading}
            disabled={!datasetId || !audioFile || !expectedText.trim()}
            onClick={() => void uploadAudio()}
          >
            保存录音样本
          </Button>
        </section>
      </div>
      <section className="workspace-section">
        <SectionTitle
          title="批量任务记录"
          aside={
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void refreshBatchData()}
            >
              刷新
            </Button>
          }
        />
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 8 }}
          dataSource={runs}
          onRow={(run) => ({ onClick: () => void selectRun(run) })}
          rowClassName={(run) =>
            run.id === selectedRun?.id ? "selected-run-row" : ""
          }
          columns={[
            { title: "任务", dataIndex: "name", ellipsis: true },
            {
              title: "类型",
              dataIndex: "kind",
              width: 70,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 95,
              render: batchStatusTag,
            },
            {
              title: "进度",
              width: 170,
              render: (_: unknown, run: BatchTestRun) => (
                <Progress
                  percent={
                    run.summary.total
                      ? Math.round(
                          (run.summary.completed / run.summary.total) * 100,
                        )
                      : 0
                  }
                  size="small"
                />
              ),
            },
            {
              title: "通过率",
              width: 90,
              render: (_: unknown, run: BatchTestRun) =>
                `${(run.summary.passRate * 100).toFixed(1)}%`,
            },
            {
              title: "费用",
              width: 100,
              render: (_: unknown, run: BatchTestRun) =>
                `¥${run.summary.totalCostCny.toFixed(6)}`,
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 105,
              render: formatTime,
            },
          ]}
        />
      </section>
      <BatchRunDetail
        run={selectedRun}
        onChanged={(run) => {
          setSelectedRun(run);
          void refreshBatchData();
        }}
        onDelete={confirmDeleteRun}
      />
    </div>
  );
}

function BatchRunDetail({
  run,
  onChanged,
  onDelete,
}: {
  run: BatchTestRun | null;
  onChanged: (run: BatchTestRun) => void;
  onDelete: (run: BatchTestRun) => void;
}) {
  const { message } = App.useApp();
  if (!run)
    return (
      <section className="workspace-section">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择一条批量任务查看逐条结果和导出文件"
        />
      </section>
    );
  const currentRun = run;
  const active = ["QUEUED", "RUNNING"].includes(currentRun.status);
  async function cancel() {
    try {
      onChanged(await cancelBatchTest(currentRun.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }
  async function retry() {
    try {
      onChanged(await retryFailedBatchTest(currentRun.id));
      message.success("失败项重试任务已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="workspace-section batch-detail-panel">
      <SectionTitle
        title="任务结果"
        aside={
          <Space>
            <Button
              danger
              icon={<StopOutlined />}
              disabled={!active}
              onClick={() => void cancel()}
            >
              停止
            </Button>
            <Button
              icon={<ReloadOutlined />}
              disabled={active || !run.summary.failed}
              onClick={() => void retry()}
            >
              重试失败项
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={() =>
                window.open(batchExportUrl(run.id, "csv"), "_blank")
              }
            >
              CSV
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={() =>
                window.open(batchExportUrl(run.id, "json"), "_blank")
              }
            >
              JSON
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={() =>
                window.open(batchExportUrl(run.id, "html"), "_blank")
              }
            >
              正式报告
            </Button>
            <Tooltip title={active ? "请先停止任务" : "删除任务及关联产物"}>
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={active}
                aria-label="删除批量任务"
                onClick={() => onDelete(run)}
              />
            </Tooltip>
          </Space>
        }
      />
      <div className="batch-metrics">
        <Metric
          label="完成"
          value={`${run.summary.completed}/${run.summary.total}`}
          detail={run.status}
        />
        <Metric
          label="通过率"
          value={`${(run.summary.passRate * 100).toFixed(1)}%`}
          detail={`${run.summary.failed} 条失败`}
          tone="green"
        />
        <Metric
          label="平均耗时"
          value={`${run.summary.averageLatencyMs} ms`}
          detail={`P95 ${run.summary.p95LatencyMs} ms`}
        />
        <Metric
          label="总费用"
          value={`¥${run.summary.totalCostCny.toFixed(6)}`}
          detail={run.providerName}
        />
      </div>
      {run.kind === "ASR" ? (
        <div className="asr-quality-strip">
          <span>
            平均字符错误率
            <strong>
              {run.summary.averageCharacterErrorRate === null
                ? "-"
                : `${(run.summary.averageCharacterErrorRate * 100).toFixed(1)}%`}
            </strong>
          </span>
          <span>
            唤醒词命中率
            <strong>
              {run.summary.wakeWordAccuracy === null
                ? "-"
                : `${(run.summary.wakeWordAccuracy * 100).toFixed(1)}%`}
            </strong>
          </span>
        </div>
      ) : null}
      <Table
        rowKey="id"
        size="small"
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 20 }}
        dataSource={run.items}
        columns={[
          { title: "#", dataIndex: "sequence", width: 55 },
          {
            title: "输入/文件",
            dataIndex: "inputText",
            width: 220,
            ellipsis: true,
          },
          {
            title: "期望",
            width: 180,
            render: (_: unknown, item: BatchTestRun["items"][number]) =>
              item.expectedText || item.expectedIntent || "-",
          },
          {
            title: "实际",
            width: 260,
            render: (_: unknown, item: BatchTestRun["items"][number]) =>
              item.actualText || item.actualIntent || "-",
          },
          {
            title: "结果",
            dataIndex: "passed",
            width: 80,
            render: (value: boolean) => (
              <Tag color={value ? "green" : "red"}>
                {value ? "通过" : "失败"}
              </Tag>
            ),
          },
          {
            title: "CER",
            dataIndex: "characterErrorRate",
            width: 80,
            render: (value: number | null) =>
              value === null ? "-" : `${(value * 100).toFixed(1)}%`,
          },
          {
            title: "耗时",
            dataIndex: "latencyMs",
            width: 90,
            render: (value: number) => `${value} ms`,
          },
          {
            title: "费用",
            dataIndex: "costCny",
            width: 100,
            render: (value: number) => `¥${value.toFixed(6)}`,
          },
          {
            title: "错误",
            dataIndex: "error",
            width: 250,
            ellipsis: true,
            render: (value: string | null) => value || "-",
          },
        ]}
      />
    </section>
  );
}

function batchStatusTag(status: BatchTestRun["status"]) {
  const colors = {
    QUEUED: "blue",
    RUNNING: "processing",
    COMPLETED: "green",
    CANCELLED: "orange",
    FAILED: "red",
  } as const;
  const labels = {
    QUEUED: "等待",
    RUNNING: "运行中",
    COMPLETED: "已完成",
    CANCELLED: "已停止",
    FAILED: "失败",
  } as const;
  return <Tag color={colors[status]}>{labels[status]}</Tag>;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function VoicePage({
  voices,
  product,
  device,
}: {
  voices: VoiceProfile[];
  product?: ProductProfile;
  device: DeviceProfile | null;
}) {
  const voice = voices.find((item) => item.status === "RELEASED") ?? voices[0];
  const { message, modal } = App.useApp();
  const [session, setSession] = useState<VoiceTestSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [llmText, setLlmText] = useState(
    "浴室里有点冷，但是我不想太热，应该怎么设置？",
  );
  const [llmResult, setLlmResult] = useState<LlmModuleTestResult | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [ttsText, setTtsText] = useState("我在");
  const [deviceVolume, setDeviceVolume] = useState(20);
  const [ttsLoading, setTtsLoading] = useState<"BROWSER" | "DEVICE" | null>(
    null,
  );
  const [browserTtsStatus, setBrowserTtsStatus] = useState<
    "IDLE" | "PLAYING" | "COMPLETED" | "STOPPED" | "FAILED"
  >("IDLE");
  const [browserTtsDetail, setBrowserTtsDetail] = useState("尚未试听");
  const browserAudioRef = useRef<HTMLAudioElement | null>(null);
  const [audioTest, setAudioTest] = useState<DeviceAudioTestResult | null>(
    null,
  );
  const voiceTestSupported = device?.capabilities?.voiceTestControl === true;
  const audioPlaybackSupported = device?.capabilities?.audioPlayback === true;
  const online = device?.status === "ONLINE";
  const active = Boolean(
    session && !["COMPLETED", "CANCELLED", "FAILED"].includes(session.status),
  );
  const deviceAudioActive = Boolean(
    audioTest &&
    ["GENERATING", "COMMAND_SENT", "PLAYING"].includes(audioTest.status),
  );
  const canStop = Boolean(
    session &&
    ["CREATED", "COMMAND_SENT", "RECORDING", "UPLOADING"].includes(
      session.status,
    ),
  );

  useEffect(() => {
    setSession(null);
    if (!device?.id) return;
    void getVoiceTests(device.id)
      .then((sessions) => setSession(sessions[0] ?? null))
      .catch((error) =>
        message.error(error instanceof Error ? error.message : String(error)),
      );
  }, [device?.id]);

  useEffect(() => {
    if (!session) return;
    const commandPending = session.result?.commandRecord?.status === "QUEUED";
    if (!active && !commandPending) return;
    const timer = window.setInterval(() => {
      void getVoiceTest(session.id)
        .then(setSession)
        .catch((error) =>
          message.error(error instanceof Error ? error.message : String(error)),
        );
    }, 600);
    return () => window.clearInterval(timer);
  }, [
    session?.id,
    session?.status,
    session?.result?.commandRecord?.status,
    active,
  ]);

  useEffect(() => {
    if (
      !audioTest ||
      ["COMPLETED", "CANCELLED", "FAILED"].includes(audioTest.status)
    )
      return;
    const timer = window.setInterval(() => {
      void getDeviceAudioTest(audioTest.id)
        .then(setAudioTest)
        .catch((error) =>
          message.error(error instanceof Error ? error.message : String(error)),
        );
    }, 500);
    return () => window.clearInterval(timer);
  }, [audioTest?.id, audioTest?.status]);

  useEffect(
    () => () => {
      const audio = browserAudioRef.current;
      if (!audio) return;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      browserAudioRef.current = null;
    },
    [],
  );

  async function handleStart(
    mode: "FULL_PIPELINE" | "ASR_ONLY" = "FULL_PIPELINE",
  ) {
    if (!device) return;
    stopBrowserPlayback(false);
    setStarting(true);
    try {
      const next = await startVoiceTest(device.id, mode);
      setSession(next);
      message.success(
        mode === "ASR_ONLY" ? "ASR 录音命令已发送" : "整链路测试命令已发送",
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  async function handleLlmTest() {
    if (!device || !llmText.trim()) return;
    setLlmLoading(true);
    try {
      setLlmResult(
        await runLlmModuleTest({ deviceId: device.id, text: llmText.trim() }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLlmLoading(false);
    }
  }

  async function handleBrowserTts() {
    if (!ttsText.trim()) return;
    stopBrowserPlayback(false);
    setTtsLoading("BROWSER");
    setBrowserTtsStatus("IDLE");
    setBrowserTtsDetail("正在生成语音...");
    try {
      const result = await runTtsModuleTest({
        text: ttsText.trim(),
        target: "BROWSER",
      });
      const audio = new Audio(
        `data:${result.audioMimeType};base64,${result.audioBase64}`,
      );
      browserAudioRef.current = audio;
      audio.volume = 0.25;
      audio.onended = () => {
        if (browserAudioRef.current === audio) browserAudioRef.current = null;
        setBrowserTtsStatus("COMPLETED");
        setBrowserTtsDetail(
          `${result.providerName || result.providerId || "TTS"} · ${result.latencyMs} ms`,
        );
      };
      audio.onerror = () => {
        if (browserAudioRef.current === audio) browserAudioRef.current = null;
        setBrowserTtsStatus("FAILED");
        setBrowserTtsDetail("浏览器无法播放返回的音频");
      };
      await audio.play();
      setBrowserTtsStatus("PLAYING");
      setBrowserTtsDetail(
        `${result.providerName || result.providerId || "TTS"} · ${result.latencyMs} ms`,
      );
      message.success(
        `浏览器试听已开始 · ${result.providerName || result.providerId || "TTS"}`,
      );
    } catch (error) {
      browserAudioRef.current = null;
      setBrowserTtsStatus("FAILED");
      setBrowserTtsDetail(
        error instanceof Error ? error.message : String(error),
      );
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTtsLoading(null);
    }
  }

  function stopBrowserPlayback(showMessage = true) {
    const audio = browserAudioRef.current;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.currentTime = 0;
    browserAudioRef.current = null;
    setBrowserTtsStatus("STOPPED");
    setBrowserTtsDetail("浏览器试听已停止");
    if (showMessage) message.info("浏览器试听已停止");
  }

  function confirmDeviceTts() {
    if (!device || !ttsText.trim()) return;
    modal.confirm({
      title: "播放到立创开发板",
      content: `扬声器将以 ${deviceVolume}% 音量播报：“${ttsText.trim()}”。请先让开发板远离耳朵。`,
      okText: "确认播放",
      cancelText: "取消",
      onOk: async () => {
        stopBrowserPlayback(false);
        setTtsLoading("DEVICE");
        try {
          setAudioTest(
            await runTtsModuleTest({
              deviceId: device.id,
              text: ttsText.trim(),
              target: "DEVICE",
              volumePercent: deviceVolume,
            }),
          );
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        } finally {
          setTtsLoading(null);
        }
      },
    });
  }

  async function stopAudioPlayback() {
    if (!audioTest) return;
    try {
      setAudioTest(await stopDeviceAudioTest(audioTest.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleStop() {
    if (!session) return;
    setStopping(true);
    try {
      setSession(await stopVoiceTest(session.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric
          label="当前输入"
          value="立创C3按键录音"
          detail="替代量产唤醒入口"
        />
        <Metric
          label="测试唤醒词"
          value={voice?.wakeWord || "小东小东"}
          detail="识别后回复“我在”"
          tone="green"
        />
        <Metric
          label="在线链路"
          value="ASR / LLM / TTS"
          detail="可分模块和整链路验证"
        />
        <Metric
          label="后续离线模块"
          value={product?.voiceProcessor || "CI1302"}
          detail="当前不阻塞在线研发"
        />
      </section>
      <section className="workspace-section module-test-section">
        <SectionTitle
          title="分模块测试"
          aside={<Tag color="blue">ASR / LLM / TTS</Tag>}
        />
        <div className="module-test-grid">
          <div className="module-test-cell">
            <div className="module-test-heading">
              <span>01</span>
              <div>
                <strong>ASR 识别</strong>
                <small>实板麦克风 · 仅语音转文字</small>
              </div>
            </div>
            <Button
              type="primary"
              icon={<AudioOutlined />}
              disabled={
                !voiceTestSupported || !online || active || deviceAudioActive
              }
              loading={starting && session?.mode === "ASR_ONLY"}
              onClick={() => void handleStart("ASR_ONLY")}
            >
              开始 ASR 测试
            </Button>
            <div className="module-result">
              <span>识别文本</span>
              <strong>
                {session?.mode === "ASR_ONLY"
                  ? session.result?.transcript ||
                    voiceTestStatusLabel(session.status)
                  : "等待测试"}
              </strong>
            </div>
          </div>
          <div className="module-test-cell">
            <div className="module-test-heading">
              <span>02</span>
              <div>
                <strong>LLM 判断</strong>
                <small>跳过规则与知识库 · 不控制设备</small>
              </div>
            </div>
            <Input.TextArea
              value={llmText}
              onChange={(event) => setLlmText(event.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={500}
            />
            <Button
              type="primary"
              icon={<CloudServerOutlined />}
              disabled={!device || !llmText.trim()}
              loading={llmLoading}
              onClick={() => void handleLlmTest()}
            >
              运行 LLM 测试
            </Button>
            <div className="module-result">
              <span>结构化输出</span>
              <strong>
                {llmResult
                  ? `${llmResult.aiResult.resultType} · ${llmResult.aiResult.intent || "无设备意图"} · ${llmResult.latencyMs} ms`
                  : "等待测试"}
              </strong>
              {llmResult ? <p>{llmResult.aiResult.speak}</p> : null}
            </div>
          </div>
          <div className="module-test-cell">
            <div className="module-test-heading">
              <span>03</span>
              <div>
                <strong>TTS 播放</strong>
                <small>浏览器试听 / 实板低音量播放</small>
              </div>
            </div>
            <div className="tts-presets">
              {["我在", "已打开照明", "网络未连接，请检查网络"].map((text) => (
                <Button
                  size="small"
                  key={text}
                  onClick={() => setTtsText(text)}
                >
                  {text}
                </Button>
              ))}
            </div>
            <Input
              value={ttsText}
              onChange={(event) => setTtsText(event.target.value)}
              maxLength={100}
            />
            <div className="tts-volume-control">
              <span>
                <SoundOutlined /> 实板音量
              </span>
              <Slider
                min={5}
                max={80}
                step={5}
                value={deviceVolume}
                marks={{ 20: "20", 50: "50", 80: "80" }}
                onChange={setDeviceVolume}
              />
              <InputNumber
                min={5}
                max={80}
                step={5}
                value={deviceVolume}
                formatter={(value) => `${value}%`}
                parser={(value) => Number(value?.replace("%", ""))}
                onChange={(value) => setDeviceVolume(value ?? 20)}
              />
            </div>
            <div className="tts-actions">
              <Button
                icon={<SoundOutlined />}
                disabled={!ttsText.trim() || active}
                loading={ttsLoading === "BROWSER"}
                onClick={() => void handleBrowserTts()}
              >
                浏览器试听
              </Button>
              <Button
                icon={<StopOutlined />}
                disabled={browserTtsStatus !== "PLAYING"}
                onClick={() => stopBrowserPlayback()}
              >
                停止浏览器
              </Button>
              <Tooltip
                title={
                  audioPlaybackSupported
                    ? "向实板发送一次受限低音量播放任务"
                    : "当前固件未上报 audioPlayback 能力，请先烧录播放版固件"
                }
              >
                <span>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    disabled={
                      !audioPlaybackSupported ||
                      !online ||
                      !ttsText.trim() ||
                      active ||
                      deviceAudioActive
                    }
                    loading={ttsLoading === "DEVICE"}
                    onClick={confirmDeviceTts}
                  >
                    播放到开发板
                  </Button>
                </span>
              </Tooltip>
              <Button
                danger
                icon={<StopOutlined />}
                disabled={
                  !audioTest ||
                  !["COMMAND_SENT", "PLAYING"].includes(audioTest.status)
                }
                onClick={() => void stopAudioPlayback()}
              >
                停止开发板
              </Button>
            </div>
            <div className="module-result">
              <span>浏览器试听</span>
              <strong>{browserTtsStatusLabel(browserTtsStatus)}</strong>
              <p>{browserTtsDetail}</p>
            </div>
            <div className="module-result">
              <span>设备播放状态</span>
              <strong>
                {audioTest
                  ? `${audioTestStatusLabel(audioTest.status)} · ${audioTest.durationMs} ms · 音量 ${audioTest.volumePercent}%`
                  : "等待测试"}
              </strong>
              {audioTest ? <p>{audioTest.message}</p> : null}
            </div>
          </div>
        </div>
      </section>
      <section className="workspace-section voice-test-panel">
        <SectionTitle
          title="实板语音测试"
          aside={
            <Space>
              <Badge
                status={online ? "success" : "default"}
                text={online ? "设备在线" : "设备离线"}
              />
              <Tag color="green">唤醒回复受限低音量</Tag>
            </Space>
          }
        />
        <Alert
          type="info"
          showIcon
          title="立创板当前用于验证云端唤醒和对话链路"
          description="点击开始后打开 6 秒录音窗口；只说“小东小东”并识别成功时，开发板会低音量回复“我在”。量产机的常驻离线唤醒由 CI1302 完成。"
        />
        <div className="voice-test-layout">
          <div className="voice-test-controls">
            <div className="voice-device-line">
              <span>测试设备</span>
              <strong>{device?.name || "未选择设备"}</strong>
              <code>{device?.id || "-"}</code>
            </div>
            {!voiceTestSupported ? (
              <Alert
                type="warning"
                showIcon
                title="当前设备固件未上报 voiceTestControl 能力"
              />
            ) : null}
            <div className="voice-test-actions">
              <Button
                type="primary"
                size="large"
                icon={<AudioOutlined />}
                disabled={
                  !voiceTestSupported || !online || active || deviceAudioActive
                }
                loading={starting && session?.mode !== "ASR_ONLY"}
                onClick={() => void handleStart()}
              >
                开始整链路测试
              </Button>
              <Tooltip
                title={
                  session?.status === "PROCESSING"
                    ? "音频已进入服务器处理，不能再取消录音"
                    : "取消当前录音窗口"
                }
              >
                <Button
                  danger
                  size="large"
                  icon={<StopOutlined />}
                  disabled={!canStop}
                  loading={stopping}
                  onClick={() => void handleStop()}
                >
                  停止测试
                </Button>
              </Tooltip>
            </div>
            <div
              className={`voice-live-state status-${(session?.status || "idle").toLowerCase()}`}
            >
              <span className="voice-state-dot" />
              <div>
                <strong>{voiceTestStatusLabel(session?.status)}</strong>
                <small>
                  {session?.message || "点击开始后，设备会打开 6 秒录音窗口"}
                </small>
              </div>
            </div>
            {session?.status === "RECORDING" ? (
              <Alert
                type="success"
                showIcon
                title={`请现在说：“${voice?.wakeWord || "小东小东"} + 你的指令或问题”`}
                description={`${session.recordSeconds} 秒后自动结束录音并上传。`}
              />
            ) : null}
          </div>
          <VoiceTestProgress session={session} online={online} />
        </div>
      </section>
      <VoiceTestResult session={session} />
      <section className="workspace-section">
        <SectionTitle title="当前在线语音链路" />
        <div className="voice-flow">
          <FlowNode title="按键开始录音" note="立创C3麦克风" />
          <FlowArrow />
          <FlowNode title="ASR识别" note="语音转文本" />
          <FlowArrow />
          <FlowNode title="规则 / 知识库 / LLM" note="意图与回复" />
          <FlowArrow />
          <FlowNode title="安全结果" note="结构化输出" />
          <FlowArrow />
          <FlowNode title="TTS返回" note="手动确认播放" />
        </div>
        <Alert
          type="info"
          showIcon
          title="CI1302在后续样板阶段接入"
          description="届时由CI1302负责“小东小东”常驻唤醒和断网固定命令，再统一进入C3；当前在线链路和测试数据不需要推倒重做。"
        />
      </section>
    </div>
  );
}

function VoiceTestProgress({
  session,
  online,
}: {
  session: VoiceTestSession | null;
  online: boolean;
}) {
  const steps = [
    {
      key: "ONLINE",
      label: "设备连接",
      detail: online ? "MQTT 在线" : "等待设备",
    },
    { key: "COMMAND_SENT", label: "测试下发", detail: "MQTT 研发控制" },
    { key: "RECORDING", label: "麦克风采集", detail: "16kHz / 16bit / 单声道" },
    { key: "UPLOADING", label: "PCM 上传", detail: "本地 API" },
    { key: "PROCESSING", label: "云端处理", detail: "ASR / 路由 / 安全" },
    { key: "COMPLETED", label: "结果完成", detail: "命令与回执" },
  ];
  const order = [
    "CREATED",
    "COMMAND_SENT",
    "RECORDING",
    "UPLOADING",
    "PROCESSING",
    "COMPLETED",
  ];
  const currentIndex = session ? order.indexOf(session.status) : -1;
  return (
    <div className="voice-test-progress">
      {steps.map((step, index) => {
        const stepIndex = step.key === "ONLINE" ? -1 : order.indexOf(step.key);
        const failed =
          index === steps.length - 1 &&
          session &&
          ["FAILED", "CANCELLED"].includes(session.status);
        const complete =
          step.key === "ONLINE"
            ? online
            : currentIndex > stepIndex || session?.status === "COMPLETED";
        const current = step.key !== "ONLINE" && session?.status === step.key;
        return (
          <div
            className={`voice-progress-step ${complete ? "complete" : ""} ${current ? "current" : ""} ${failed ? "failed" : ""}`}
            key={step.key}
          >
            <span>
              {complete ? (
                <CheckCircleFilled />
              ) : current ? (
                <LoadingOutlined />
              ) : failed ? (
                <StopOutlined />
              ) : (
                index + 1
              )}
            </span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VoiceTestResult({ session }: { session: VoiceTestSession | null }) {
  const result = session?.result;
  return (
    <section className="workspace-section voice-result-section">
      <SectionTitle
        title="本次测试结果"
        aside={
          session ? (
            <span className="muted">
              {formatTime(session.requestedAt)} · {session.id.slice(0, 8)}
            </span>
          ) : undefined
        }
      />
      {!result ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            session?.status === "FAILED"
              ? session.message
              : "完成一次实板测试后显示识别与执行结果"
          }
        />
      ) : (
        <>
          <div className="voice-result-grid">
            <ResultField
              label="ASR 识别文本"
              value={result.transcript || "未识别到文本"}
              wide
            />
            <ResultField
              label="处理路由"
              value={voiceRouteLabel(result.route)}
            />
            <ResultField label="结果类型" value={result.aiResult.resultType} />
            <ResultField
              label="设备意图"
              value={result.aiResult.intent || "无设备指令"}
            />
            <ResultField
              label="安全裁决"
              value={result.safetyResult.decision}
            />
            <ResultField
              label="设备回执"
              value={
                result.commandRecord
                  ? commandStatusLabel(result.commandRecord.status)
                  : "未下发设备命令"
              }
            />
            <ResultField label="总耗时" value={`${result.totalLatencyMs} ms`} />
            <ResultField
              label="本次估算成本"
              value={`¥${result.cost.totalCny.toFixed(6)}`}
            />
            <ResultField
              label="文本回复（未播放）"
              value={result.replyText || "-"}
              wide
            />
          </div>
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            scroll={{ x: 820 }}
            dataSource={result.stages}
            columns={voiceStageColumns}
          />
        </>
      )}
    </section>
  );
}

const voiceStageColumns = [
  { title: "阶段", dataIndex: "label", width: 130 },
  {
    title: "状态",
    dataIndex: "status",
    width: 115,
    render: (value: VoicePipelineStage["status"]) => (
      <Tag
        color={
          value === "FAILED"
            ? "red"
            : value === "SKIPPED" || value === "NOT_CONFIGURED"
              ? "default"
              : "green"
        }
      >
        {value}
      </Tag>
    ),
  },
  {
    title: "来源",
    dataIndex: "source",
    width: 150,
    render: (value: string | null) => value || "-",
  },
  { title: "结果", dataIndex: "result", ellipsis: true },
  {
    title: "耗时",
    dataIndex: "latencyMs",
    width: 90,
    render: (value: number) => `${value} ms`,
  },
  {
    title: "成本",
    dataIndex: "costCny",
    width: 100,
    render: (value: number) => `¥${value.toFixed(6)}`,
  },
];

function ResultField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "wide" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function voiceTestStatusLabel(status?: VoiceTestSession["status"]): string {
  const labels: Record<VoiceTestSession["status"], string> = {
    CREATED: "会话已创建",
    COMMAND_SENT: "等待设备响应",
    RECORDING: "正在录音",
    UPLOADING: "正在上传",
    PROCESSING: "正在识别与处理",
    STOPPING: "正在停止",
    COMPLETED: "测试完成",
    CANCELLED: "测试已停止",
    FAILED: "测试失败",
  };
  return status ? labels[status] : "等待开始";
}

function voiceRouteLabel(route: string): string {
  return (
    (
      {
        OFFLINE: "离线规则",
        ONLINE_RULE: "在线规则",
        KNOWLEDGE: "知识库",
        LLM: "大模型",
        UNRESOLVED: "未解析",
      } as Record<string, string>
    )[route] || route
  );
}

function commandStatusLabel(status: string): string {
  return (
    (
      {
        QUEUED: "已下发，等待回执",
        APPLIED: "C3 已执行",
        REJECTED: "C3 安全拒绝",
        NEEDS_CONFIRMATION: "需要确认",
        FAILED: "执行失败",
      } as Record<string, string>
    )[status] || status
  );
}

function audioTestStatusLabel(status: DeviceAudioTestResult["status"]): string {
  return (
    {
      GENERATING: "生成中",
      COMMAND_SENT: "等待开发板",
      PLAYING: "正在播放",
      COMPLETED: "播放完成",
      CANCELLED: "已停止",
      FAILED: "播放失败",
    } as const
  )[status];
}

function browserTtsStatusLabel(
  status: "IDLE" | "PLAYING" | "COMPLETED" | "STOPPED" | "FAILED",
): string {
  return (
    {
      IDLE: "等待测试",
      PLAYING: "正在播放",
      COMPLETED: "播放完成",
      STOPPED: "已停止",
      FAILED: "播放失败",
    } as const
  )[status];
}

function DeliveryPage({
  gates,
  board,
  product,
  voices,
}: {
  gates: DevelopmentGate[];
  board: BoardProfile | null;
  product?: ProductProfile;
  voices: VoiceProfile[];
}) {
  const passed = gates.filter((gate) => gate.status === "PASSED").length;
  return (
    <div className="page-stack">
      <section className="release-header">
        <div>
          <span className="eyebrow">RELEASE CANDIDATE</span>
          <h2>{product?.model || "DX-AI-01"}</h2>
          <p>
            {board?.name} · {board?.revision}
          </p>
        </div>
        <Progress
          type="circle"
          percent={Math.round((passed / gates.length) * 100)}
          size={92}
          strokeColor="#176b55"
        />
      </section>
      <section className="workspace-section">
        <SectionTitle title="交付门禁" />
        <div className="delivery-list">
          {gates.map((gate) => (
            <div className="delivery-row" key={gate.id}>
              <span className={`gate-icon ${gate.status.toLowerCase()}`}>
                {gate.status === "PASSED" ? (
                  <CheckCircleFilled />
                ) : (
                  <PauseCircleFilled />
                )}
              </span>
              <code>{gate.id}</code>
              <div>
                <strong>{gate.label}</strong>
                <span>{gate.detail}</span>
              </div>
              <Tag color={gate.status === "PASSED" ? "green" : "orange"}>
                {gate.status === "PASSED" ? "已通过" : "受阻"}
              </Tag>
            </div>
          ))}
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle title="版本构成" />
        <div className="release-artifacts">
          <Artifact
            label="产品定义"
            value={product?.name || "-"}
            status="已建立"
          />
          <Artifact
            label="板卡定义"
            value={`${board?.name || "-"} / ${board?.revision || "-"}`}
            status={board?.lifecycle === "DRAFT" ? "草稿" : "有效"}
          />
          <Artifact
            label="固件"
            value="0.4.0-direct-control"
            status="实板验证"
          />
          <Artifact
            label="CI语音包"
            value={voices[0]?.version || "未生成"}
            status={voices[0]?.status || "缺失"}
          />
          <Artifact label="MQTT协议" value="V1.0" status="已验证" />
          <Artifact
            label="验收报告"
            value="等待低压IO与语音样板"
            status="未完成"
          />
        </div>
      </section>
    </div>
  );
}

function PinTable({ pins }: { pins: BoardPin[] }) {
  return (
    <section className="workspace-section">
      <SectionTitle title="引脚明细" />
      <Table
        rowKey="id"
        scroll={{ x: 1200 }}
        pagination={false}
        dataSource={pins}
        columns={[
          { title: "管脚", dataIndex: "label", width: 120, fixed: "left" },
          {
            title: "GPIO",
            dataIndex: "gpio",
            width: 80,
            render: (value: number | null) =>
              value === null ? "-" : `GPIO${value}`,
          },
          {
            title: "网络名",
            dataIndex: "signal",
            width: 190,
            render: (value: string) => <code>{value}</code>,
          },
          { title: "方向", dataIndex: "direction", width: 110 },
          { title: "电气", dataIndex: "electrical", width: 170 },
          { title: "连接目标", dataIndex: "target", width: 220 },
          { title: "默认", dataIndex: "defaultLevel", width: 90 },
          { title: "启动/安全约束", dataIndex: "bootConstraint", width: 260 },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            fixed: "right",
            render: (value: HardwareDefinitionStatus) => (
              <StatusTag status={value} />
            ),
          },
        ]}
      />
    </section>
  );
}

function IoMatrix({ ports }: { ports: IoExpanderPort[] }) {
  if (!ports.length)
    return (
      <section className="workspace-section">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前开发板未连接PCF8574；切换到DX-AI-01量产候选板查看24路规划"
        />
      </section>
    );
  return (
    <div className="io-bank-grid">
      {(["U1", "U2", "U3"] as const).map((bank) => {
        const bankPorts = ports.filter((item) => item.device === bank);
        return (
          <section className="workspace-section io-bank" key={bank}>
            <SectionTitle
              title={`${bank} · 0x${bankPorts[0]?.address.toString(16).toUpperCase()}`}
              aside={
                <Tag>
                  {
                    bankPorts.filter((item) => item.status === "RESERVED")
                      .length
                  }
                  路预留
                </Tag>
              }
            />
            <div className="port-list">
              {bankPorts.map((port) => (
                <div
                  className={`port-row safety-${port.safetyClass.toLowerCase()}`}
                  key={port.id}
                >
                  <code>P{port.port}</code>
                  <span>
                    <strong>{port.signal}</strong>
                    <small>{port.target}</small>
                  </span>
                  <span className="port-electrical">
                    {port.direction}
                    <small>
                      {port.activeLevel === "N/A"
                        ? "-"
                        : `${port.activeLevel}有效`}
                    </small>
                  </span>
                  <StatusTag status={port.status} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TraceTable({
  traces,
  compact = false,
}: {
  traces: DeviceExecutionTrace[];
  compact?: boolean;
}) {
  return (
    <Table
      size="small"
      rowKey="traceId"
      pagination={false}
      locale={{ emptyText: "暂无命令轨迹" }}
      dataSource={traces}
      columns={[
        {
          title: "时间",
          dataIndex: "startedAt",
          width: 95,
          render: formatTime,
        },
        {
          title: "意图",
          dataIndex: "intent",
          ellipsis: true,
          render: (value: string) => intentLabels[value] || value,
        },
        ...(!compact
          ? [
              {
                title: "执行路径",
                dataIndex: "executionPath",
                width: 140,
                render: (value: string | null) => (
                  <ExecutionPathTag path={value} />
                ),
              },
            ]
          : []),
        {
          title: "结果",
          dataIndex: "status",
          width: 100,
          render: (value: DeviceExecutionTrace["status"]) => (
            <CommandStatus status={value} />
          ),
        },
      ]}
    />
  );
}

function TraceStage({
  stage,
  last,
}: {
  stage: ExecutionTraceStage;
  last: boolean;
}) {
  return (
    <div className={`stage-item stage-${stage.status.toLowerCase()}`}>
      <div className="stage-marker">
        {stage.status === "COMPLETED" ? (
          <CheckCircleFilled />
        ) : stage.status === "PENDING" ? (
          <LoadingOutlined />
        ) : stage.status === "SKIPPED" ? (
          <PauseCircleFilled />
        ) : (
          <BugOutlined />
        )}
      </div>
      {!last ? <div className="stage-line" /> : null}
      <div className="stage-copy">
        <span>{stage.label}</span>
        <strong>{stage.detail}</strong>
        <code>{stage.module}</code>
      </div>
    </div>
  );
}

function GateItem({ gate, last }: { gate: DevelopmentGate; last: boolean }) {
  return (
    <div className={`gate-item ${gate.status.toLowerCase()}`}>
      <div className="gate-head">
        <span>
          {gate.status === "PASSED" ? (
            <CheckCircleFilled />
          ) : (
            <PauseCircleFilled />
          )}
        </span>
        {!last ? <i /> : null}
      </div>
      <code>{gate.id}</code>
      <strong>{gate.label}</strong>
      <small>{gate.detail}</small>
    </div>
  );
}

function CommandButton(props: {
  label: string;
  intent: string;
  icon: ReactNode;
  danger?: boolean;
  controlsDisabled?: boolean;
  sendingIntent: string | null;
  onCommand: (intent: string) => void;
  device?: DeviceProfile | null;
}) {
  return (
    <Button
      icon={props.icon}
      danger={props.danger}
      disabled={
        props.controlsDisabled ||
        props.device?.status !== "ONLINE" ||
        Boolean(props.sendingIntent)
      }
      loading={props.sendingIntent === props.intent}
      onClick={() => props.onCommand(props.intent)}
    >
      {props.label}
    </Button>
  );
}

function CommandGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="command-group">
      <span>{title}</span>
      <div>{children}</div>
    </div>
  );
}
function FlowNode({ title, note }: { title: string; note: string }) {
  return (
    <div className="flow-node">
      <strong>{title}</strong>
      <span>{note}</span>
    </div>
  );
}
function FlowArrow() {
  return <span className="flow-arrow">→</span>;
}
function Artifact({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <Tag>{status}</Tag>
    </article>
  );
}
function Boundary({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="boundary-item">
      <strong>{title}</strong>
      {items.map((item) => (
        <span key={item}>· {item}</span>
      ))}
    </div>
  );
}
function PinBadge({ pin, right = false }: { pin: BoardPin; right?: boolean }) {
  return (
    <Tooltip
      title={`${pin.signal} · ${pin.target}`}
      placement={right ? "right" : "left"}
    >
      <div className={`pin-badge status-${pin.status.toLowerCase()}`}>
        <span className="pin-number">{pin.label}</span>
        <span className="pin-signal">{pin.signal}</span>
      </div>
    </Tooltip>
  );
}
function TopologyNode({
  icon,
  title,
  subtitle,
  status,
  primary = false,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: string;
  primary?: boolean;
}) {
  return (
    <div className={`topology-node ${primary ? "primary" : ""}`}>
      <span className="topology-icon">{icon}</span>
      <strong>{title}</strong>
      <small>{subtitle}</small>
      <Tag>{status}</Tag>
    </div>
  );
}
function TopologyLink({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="topology-link">
      <span>{top}</span>
      <i />
      <small>{bottom}</small>
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "green";
}) {
  return (
    <article className={`metric ${tone ? `metric-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function SectionTitle({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
function ContextItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="context-item">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}
function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nav-group">
      <span>{label}</span>
      {children}
    </div>
  );
}
function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatusTag({ status }: { status: HardwareDefinitionStatus }) {
  const map: Record<
    HardwareDefinitionStatus,
    { color: string; label: string }
  > = {
    PLANNED: { color: "orange", label: "规划" },
    ASSIGNED: { color: "blue", label: "已分配" },
    VERIFIED: { color: "green", label: "已验证" },
    FROZEN: { color: "cyan", label: "已冻结" },
    RESERVED: { color: "default", label: "预留" },
  };
  return <Tag color={map[status].color}>{map[status].label}</Tag>;
}
function CommandStatus({ status }: { status: DeviceExecutionTrace["status"] }) {
  const color =
    status === "APPLIED"
      ? "green"
      : status === "QUEUED"
        ? "blue"
        : status === "REJECTED"
          ? "orange"
          : "red";
  const labels: Record<string, string> = {
    APPLIED: "成功",
    QUEUED: "等待",
    REJECTED: "拒绝",
    FAILED: "失败",
    NEEDS_CONFIRMATION: "待确认",
  };
  return <Tag color={color}>{labels[status] || status}</Tag>;
}
function ExecutionModeTag({ board }: { board: BoardProfile | null }) {
  const monitor = board?.executionMode === "STM32_UART_MONITOR";
  return (
    <Tag
      color={
        monitor
          ? "orange"
          : board?.executionMode === "LOCAL_PHYSICAL"
            ? "volcano"
            : "geekblue"
      }
    >
      {monitor ? "STM32串口只读" : board?.executionMode || "-"}
    </Tag>
  );
}
function ExecutionPathTag({ path }: { path: string | null }) {
  return (
    <Tag
      color={
        path === "LOCAL_PCF8574"
          ? "volcano"
          : path === "LOCAL_VIRTUAL"
            ? "geekblue"
            : "default"
      }
    >
      {path || "旧回执"}
    </Tag>
  );
}
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
function durationText(start: string, end: string | null) {
  if (!end || end.startsWith("device-")) return "未同步";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? `${ms} ms` : "未同步";
}
function readSectionHash(): Section {
  const value = window.location.hash.replace("#", "") as Section;
  return value in sectionMeta ? value : "overview";
}
