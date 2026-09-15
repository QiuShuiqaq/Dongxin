import {
  ApiOutlined,
  AppstoreOutlined,
  BlockOutlined,
  BugOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CodeOutlined,
  ControlOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  FireOutlined,
  GatewayOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  LoadingOutlined,
  PauseCircleFilled,
  PoweroffOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SoundOutlined,
  ThunderboltOutlined,
  UsbOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import type {
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
} from "@dongxin/shared";
import {
  Alert,
  App,
  Badge,
  Button,
  Descriptions,
  Empty,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getDevelopmentConsole,
  getDeviceCommands,
  getDeviceState,
  sendDeviceCommand,
} from "./api";
import type {
  DevelopmentConsoleData,
  DevelopmentGate,
} from "./api";

type Section =
  | "overview"
  | "topology"
  | "pins"
  | "firmware"
  | "testing"
  | "voice"
  | "delivery";

const sectionMeta: Record<Section, { label: string; eyebrow: string }> = {
  overview: { label: "研发总览", eyebrow: "PROGRAM STATUS" },
  topology: { label: "系统拓扑", eyebrow: "SYSTEM ARCHITECTURE" },
  pins: { label: "引脚与 IO", eyebrow: "BOARD DEFINITION" },
  firmware: { label: "固件执行链", eyebrow: "RUNTIME TRACE" },
  testing: { label: "实板联调", eyebrow: "HARDWARE-IN-LOOP" },
  voice: { label: "AI 与语音", eyebrow: "VOICE PIPELINE" },
  delivery: { label: "版本交付", eyebrow: "RELEASE GATES" },
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
      const nextBoardId = next.boards.some((item) => item.id === boardId)
        ? boardId
        : next.boards[0]?.id || "";
      const c3 = next.devices.find((item) => item.id.includes("SUPERMINI"));
      const nextDeviceId = next.devices.some((item) => item.id === deviceId)
        ? deviceId
        : c3?.id || next.devices[0]?.id || "";
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
          commands.find((item) => item.id === queued.command.id)?.status || status;
      }
      await refresh(true);
      if (status === "APPLIED") message.success(`${intentLabels[intent] || intent}已执行`);
      else if (status === "REJECTED") message.warning("命令已被C3本地安全规则拒绝");
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
          <div><strong>东信产品研发中心</strong><span>Device Engineering</span></div>
        </div>
        <nav className="dev-nav" aria-label="研发中心导航">
          <NavGroup label="研发管理">
            <NavItem active={section === "overview"} icon={<AppstoreOutlined />} label="研发总览" onClick={() => navigate("overview")} />
            <NavItem active={section === "topology"} icon={<DeploymentUnitOutlined />} label="系统拓扑" onClick={() => navigate("topology")} />
            <NavItem active={section === "pins"} icon={<GatewayOutlined />} label="引脚与 IO" onClick={() => navigate("pins")} />
          </NavGroup>
          <NavGroup label="固件与验证">
            <NavItem active={section === "firmware"} icon={<CodeOutlined />} label="固件执行链" onClick={() => navigate("firmware")} />
            <NavItem active={section === "testing"} icon={<ExperimentOutlined />} label="实板联调" onClick={() => navigate("testing")} />
            <NavItem active={section === "voice"} icon={<SoundOutlined />} label="AI 与语音" onClick={() => navigate("voice")} />
          </NavGroup>
          <NavGroup label="发布">
            <NavItem active={section === "delivery"} icon={<FileDoneOutlined />} label="版本交付" onClick={() => navigate("delivery")} />
          </NavGroup>
        </nav>
        <div className="sidebar-status">
          <span><Badge status={data?.mqtt.connected ? "success" : "error"} />MQTT {data?.mqtt.connected ? "已连接" : "断开"}</span>
          <small>{data?.mqtt.brokerUrl || "等待API"}</small>
        </div>
      </aside>

      <main className="dev-main">
        <header className="dev-header">
          <div><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.label}</h1></div>
          <Space size="middle">
            <span className="refresh-control"><Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} /> 自动刷新</span>
            <Tooltip title="刷新全部研发数据"><Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading} aria-label="刷新" /></Tooltip>
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
          {loading && !data ? <Skeleton active paragraph={{ rows: 12 }} /> : null}
          {data && section === "overview" ? <OverviewPage data={data} board={board} device={device} onTrace={() => navigate("firmware")} /> : null}
          {data && board && section === "topology" ? <TopologyPage board={board} product={product} /> : null}
          {data && board && section === "pins" ? <PinsPage board={board} boards={data.boards} onBoardChange={setBoardId} /> : null}
          {data && section === "firmware" ? <FirmwarePage traces={data.traces.filter((trace) => trace.deviceId === deviceId)} /> : null}
          {data && board && section === "testing" ? <TestingPage board={board} device={device} state={deviceState} traces={data.traces.filter((trace) => trace.deviceId === deviceId)} sendingIntent={sendingIntent} onCommand={handleCommand} /> : null}
          {data && section === "voice" ? <VoicePage voices={data.voiceProfiles} product={product} /> : null}
          {data && section === "delivery" ? <DeliveryPage gates={data.gates} board={board} product={product} voices={data.voiceProfiles} /> : null}
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
      <ContextItem label="环境"><Tag color="gold">本地研发</Tag></ContextItem>
      <ContextItem label="产品">{props.data?.products[0]?.model || "-"}</ContextItem>
      <ContextItem label="板卡">
        <Select size="small" value={props.boardId} onChange={props.onBoardChange} options={props.data?.boards.map((item) => ({ value: item.id, label: `${item.name} · ${item.revision}` }))} />
      </ContextItem>
      <ContextItem label="设备">
        <Select size="small" value={props.deviceId} onChange={props.onDeviceChange} options={props.data?.devices.map((item) => ({ value: item.id, label: item.name }))} />
      </ContextItem>
      <ContextItem label="固件">{props.device?.firmwareVersion || "未上报"}</ContextItem>
      <ContextItem label="执行路径"><ExecutionModeTag board={props.board} /></ContextItem>
    </div>
  );
}

function OverviewPage(props: { data: DevelopmentConsoleData; board: BoardProfile | null; device: DeviceProfile | null; onTrace: () => void }) {
  const passed = props.data.gates.filter((item) => item.status === "PASSED").length;
  const realTraces = props.data.traces.filter((item) => item.deviceId === props.device?.id);
  const applied = realTraces.filter((item) => item.status === "APPLIED").length;
  return (
    <div className="page-stack">
      <section className="metric-grid" aria-label="研发状态">
        <Metric label="当前阶段" value="G2" detail="低压IO联调准备" tone="green" />
        <Metric label="Gate进度" value={`${passed}/${props.data.gates.length}`} detail="软件闭环已完成" />
        <Metric label="板卡定义" value={`${props.data.boards.length}`} detail="开发板 + 量产候选" />
        <Metric label="实板命令" value={`${applied}`} detail="最近50条成功执行" />
      </section>
      <section className="workspace-section">
        <SectionTitle title="研发 Gate" aside={<span className="muted">按硬件可验证条件推进</span>} />
        <div className="gate-rail">
          {props.data.gates.map((gate, index) => <GateItem key={gate.id} gate={gate} last={index === props.data.gates.length - 1} />)}
        </div>
      </section>
      <div className="two-column-layout">
        <section className="workspace-section">
          <SectionTitle title="当前基线" />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="主控">ESP32-C3 单主控</Descriptions.Item>
            <Descriptions.Item label="语音前端">CI1302 · UART + I²S</Descriptions.Item>
            <Descriptions.Item label="IO扩展">3 × PCF8574 · 24路</Descriptions.Item>
            <Descriptions.Item label="当前开发板">{props.board?.name}</Descriptions.Item>
            <Descriptions.Item label="真实负载"><Tag>尚未接入</Tag></Descriptions.Item>
          </Descriptions>
        </section>
        <section className="workspace-section">
          <SectionTitle title="最近执行" aside={<Button type="link" onClick={props.onTrace}>查看执行链</Button>} />
          <TraceTable traces={realTraces.slice(0, 5)} compact />
        </section>
      </div>
      <Alert type="warning" showIcon title="量产样板阻塞项" description="DX-AI-01 Rev.A 的C3 GPIO、NTC参数、摆叶电机和危险负载驱动仍待东信原理图确认；当前软件结果不得作为220V负载验收结论。" />
    </div>
  );
}

function TopologyPage({ board, product }: { board: BoardProfile; product?: ProductProfile }) {
  return (
    <div className="page-stack">
      <section className="workspace-section topology-section">
        <SectionTitle title="端到端系统拓扑" aside={<ExecutionModeTag board={board} />} />
        <div className="topology-canvas">
          <TopologyNode icon={<SoundOutlined />} title="CI1302" subtitle="唤醒 / 离线命令 / PCM" status="规划" />
          <TopologyLink top="UART 115200" bottom="I²S PCM" />
          <TopologyNode primary icon={<BlockOutlined />} title="ESP32-C3" subtitle="唯一业务主控 / 安全裁决" status={board.role === "DEVELOPMENT" ? "实板在线" : "候选"} />
          <TopologyLink top="WiFi / MQTT" bottom="设备影子 / 回执" />
          <TopologyNode icon={<CloudServerOutlined />} title="AI Gateway" subtitle="规则 / 知识库 / LLM / TTS" status="本地" />
          <div className="topology-branch topology-branch-left"><TopologyNode icon={<GatewayOutlined />} title="3 × PCF8574" subtitle="0x20 / 0x21 / 0x22" status={board.ioPorts.length ? "已分配" : "未接入"} /></div>
          <div className="topology-branch topology-branch-center"><TopologyNode icon={<LineChartOutlined />} title="NTC / 雷达" subtitle="ADC / 数字输入" status="待样板" /></div>
          <div className="topology-branch topology-branch-right"><TopologyNode icon={<ControlOutlined />} title="本地控制" subtitle="墙面板 / 手持遥控器" status="BLE协议" /></div>
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle title="总线与接口" aside={<span className="muted">{board.name} · {board.revision}</span>} />
        <div className="bus-grid">
          {board.buses.map((bus) => (
            <article className="bus-item" key={bus.id}>
              <div className="bus-icon">{bus.bus === "I2C" ? <ApiOutlined /> : bus.bus === "USB" ? <UsbOutlined /> : bus.bus === "BLE" ? <WifiOutlined /> : <GatewayOutlined />}</div>
              <div><div className="bus-title"><strong>{bus.name}</strong><StatusTag status={bus.status} /></div><p>{bus.endpoint}</p><small>{bus.parameters}</small></div>
            </article>
          ))}
        </div>
      </section>
      <section className="workspace-section">
        <SectionTitle title="职责边界" />
        <div className="boundary-grid">
          <Boundary title="C3负责" items={["命令汇聚与去重", "安全状态机与互锁", "设备状态与MQTT", "PCF/GPIO/ADC硬件抽象"]} />
          <Boundary title="CI1302负责" items={["小东小东唤醒", "固定命令离线识别", "麦克风与提示音", "在线语音PCM前端"]} />
          <Boundary title="东信硬件负责" items={["低压电源与隔离", "电机/继电器/可控硅驱动", "硬件温断与保险丝", "220V安全、EMC与认证"]} />
          <Boundary title="云平台负责" items={["ASR与低成本规则路由", "知识库/LLM/TTS", "设备管理与告警", "发布、审计和费用"]} />
        </div>
        {product ? <p className="section-footnote">产品基线：{product.name} · {product.capabilities.filter((item) => item.support === "ENABLED").length}项已启用能力</p> : null}
      </section>
    </div>
  );
}

function PinsPage({ board, boards, onBoardChange }: { board: BoardProfile; boards: BoardProfile[]; onBoardChange: (id: string) => void }) {
  const [view, setView] = useState<string>("芯片引脚");
  const left = board.pins.filter((pin) => pin.side === "LEFT");
  const right = board.pins.filter((pin) => pin.side === "RIGHT");
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Segmented value={view} onChange={(value) => setView(String(value))} options={["芯片引脚", "PCF8574", "接口总线"]} />
        <Select value={board.id} onChange={onBoardChange} options={boards.map((item) => ({ value: item.id, label: `${item.name} · ${item.revision}` }))} />
      </div>
      {view === "芯片引脚" ? (
        <>
          <Alert type={board.lifecycle === "DRAFT" ? "warning" : "info"} showIcon title={board.summary} />
          <section className="workspace-section">
            <SectionTitle title="芯片引脚图" />
            <div className="chip-pinout">
              <div className="pin-column left-pins">{left.map((pin) => <PinBadge key={pin.id} pin={pin} />)}</div>
              <div className="chip-body"><span>ESPRESSIF</span><strong>ESP32-C3</strong><small>{board.revision}</small><div className="chip-notch" /></div>
              <div className="pin-column right-pins">{right.map((pin) => <PinBadge key={pin.id} pin={pin} right />)}</div>
            </div>
          </section>
          <PinTable pins={board.pins} />
        </>
      ) : null}
      {view === "PCF8574" ? <IoMatrix ports={board.ioPorts} /> : null}
      {view === "接口总线" ? (
        <section className="workspace-section"><SectionTitle title="接口总线定义" /><Table rowKey="id" pagination={false} dataSource={board.buses} columns={[
          { title: "总线", dataIndex: "bus", width: 90, render: (value: string) => <Tag>{value}</Tag> },
          { title: "名称", dataIndex: "name", width: 180 },
          { title: "端点", dataIndex: "endpoint" },
          { title: "参数", dataIndex: "parameters" },
          { title: "状态", dataIndex: "status", width: 110, render: (value: HardwareDefinitionStatus) => <StatusTag status={value} /> },
        ]} /></section>
      ) : null}
      <section className="constraint-band"><strong><SafetyCertificateOutlined /> 板级约束</strong>{board.knownConstraints.map((item) => <span key={item}>{item}</span>)}</section>
    </div>
  );
}

function FirmwarePage({ traces }: { traces: DeviceExecutionTrace[] }) {
  const [selectedId, setSelectedId] = useState(traces[0]?.traceId || "");
  useEffect(() => { if (!traces.some((item) => item.traceId === selectedId)) setSelectedId(traces[0]?.traceId || ""); }, [traces, selectedId]);
  const selected = traces.find((item) => item.traceId === selectedId) ?? traces[0];
  return (
    <div className="trace-layout">
      <section className="trace-list-panel">
        <SectionTitle title="命令轨迹" aside={<Tag>{traces.length}</Tag>} />
        <div className="trace-list">{traces.map((trace) => <button key={trace.traceId} className={`trace-list-item ${selected?.traceId === trace.traceId ? "selected" : ""}`} onClick={() => setSelectedId(trace.traceId)}><span><strong>{intentLabels[trace.intent] || trace.intent}</strong><small>{formatTime(trace.startedAt)}</small></span><CommandStatus status={trace.status} /></button>)}</div>
      </section>
      <section className="workspace-section trace-detail">
        {selected ? <>
          <SectionTitle title={intentLabels[selected.intent] || selected.intent} aside={<Space><ExecutionPathTag path={selected.executionPath} /><CommandStatus status={selected.status} /></Space>} />
          <Alert className="trace-notice" type="info" showIcon title="控制结果来自C3真实回执；中间阶段当前由命令生命周期重建，阶段级耗时将在固件Trace事件接入后显示。" />
          <div className="trace-meta"><span>Trace <code>{selected.traceId}</code></span><span>Command <code>{selected.commandId}</code></span><span>{formatTime(selected.startedAt)}</span></div>
          <div className="stage-flow">{selected.stages.map((stage, index) => <TraceStage key={stage.key} stage={stage} last={index === selected.stages.length - 1} />)}</div>
          <div className="trace-result-grid"><div><span>错误码</span><strong>{selected.errorCode || "无"}</strong></div><div><span>执行说明</span><strong>{selected.message || "设备已完成回执"}</strong></div><div><span>耗时</span><strong>{durationText(selected.startedAt, selected.completedAt)}</strong></div></div>
        </> : <Empty description="当前设备暂无执行轨迹" />}
      </section>
    </div>
  );
}

function TestingPage(props: { board: BoardProfile; device: DeviceProfile | null; state: DeviceState | null; traces: DeviceExecutionTrace[]; sendingIntent: string | null; onCommand: (intent: string) => void }) {
  const virtual = props.board.executionMode === "LOCAL_VIRTUAL";
  const outputList = [
    ["照明", "LIGHT_ON"], ["吹风", "FAN_ON"], ["换气", "VENTILATION_ON"],
    ["弱暖", "HEAT_WEAK_ON"], ["强暖", "HEAT_STRONG_ON"], ["摆风", "SWING_ON"],
  ];
  return (
    <div className="page-stack">
      <Alert type={virtual ? "info" : "warning"} showIcon title={virtual ? "当前为LOCAL_VIRTUAL：验证真实C3内部逻辑，不驱动任何物理负载" : "当前为物理HAL：操作前必须确认低压台架和安全隔离"} />
      <div className="test-grid">
        <section className="workspace-section command-console">
          <SectionTitle title="控制命令" aside={<Badge status={props.device?.status === "ONLINE" ? "success" : "default"} text={props.device?.status === "ONLINE" ? "设备在线" : "设备离线"} />} />
          <div className="command-groups">
            <CommandGroup title="照明"><CommandButton label="开启" intent="LIGHT_ON" icon={<ThunderboltOutlined />} {...props} /><CommandButton label="关闭" intent="LIGHT_OFF" icon={<PoweroffOutlined />} {...props} /></CommandGroup>
            <CommandGroup title="风路"><CommandButton label="吹风" intent="FAN_ON" icon={<GatewayOutlined />} {...props} /><CommandButton label="关风" intent="FAN_OFF" icon={<PoweroffOutlined />} {...props} /><CommandButton label="换气" intent="VENTILATION_ON" icon={<GatewayOutlined />} {...props} /><CommandButton label="关换气" intent="VENTILATION_OFF" icon={<PoweroffOutlined />} {...props} /></CommandGroup>
            <CommandGroup title="取暖"><CommandButton label="弱暖" intent="HEAT_WEAK_ON" icon={<FireOutlined />} {...props} /><CommandButton label="强暖" intent="HEAT_STRONG_ON" icon={<FireOutlined />} danger {...props} /><CommandButton label="关取暖" intent="HEAT_STRONG_OFF" icon={<PoweroffOutlined />} {...props} /></CommandGroup>
            <CommandGroup title="安全验证"><CommandButton label="开启恒温" intent="CONSTANT_TEMP_ON" icon={<SafetyCertificateOutlined />} {...props} /><CommandButton label="整机待机" intent="STANDBY" icon={<PoweroffOutlined />} {...props} /></CommandGroup>
          </div>
        </section>
        <section className="workspace-section state-console">
          <SectionTitle title="设备影子" aside={<span className="muted">{props.state?.updatedAt ? formatTime(props.state.updatedAt) : "等待上报"}</span>} />
          <div className="state-power"><span>POWER</span><strong>{props.state?.activeModes.length ? "ON" : "OFF"}</strong></div>
          <div className="output-grid">{outputList.map(([label, intent]) => { const active = props.state?.activeModes.includes(intent as never) || (intent === "HEAT_WEAK_ON" && props.state?.activeModes.includes("HEAT_STRONG_ON")); return <div className={`output-cell ${active ? "active" : ""}`} key={intent}><span className="output-led" /><span>{label}</span><strong>{active ? "ON" : "OFF"}</strong></div>; })}</div>
          <div className="sensor-strip"><span>目标温度<strong>{props.state?.targetTemperature ?? "-"}℃</strong></span><span>环境温度<strong>{props.state?.ambientTemperature || "未接入"}</strong></span><span>故障<strong>{props.state?.faultCode || "无"}</strong></span></div>
        </section>
      </div>
      <section className="workspace-section"><SectionTitle title="本次联调记录" /><TraceTable traces={props.traces.slice(0, 10)} /></section>
    </div>
  );
}

function VoicePage({ voices, product }: { voices: VoiceProfile[]; product?: ProductProfile }) {
  const voice = voices.find((item) => item.status === "RELEASED") ?? voices[0];
  return (
    <div className="page-stack">
      <section className="metric-grid"><Metric label="语音芯片" value={product?.voiceProcessor || "CI1302"} detail="离线优先" /><Metric label="唤醒词" value={voice?.wakeWord || "-"} detail="产品型号统一发布" tone="green" /><Metric label="离线命令" value={`${voice?.commands.filter((item) => item.enabled).length || 0}`} detail="固定命令不产生云成本" /><Metric label="资源状态" value={voice?.status || "未配置"} detail={voice?.version || "-"} /></section>
      <section className="workspace-section"><SectionTitle title="语音链路" /><div className="voice-flow"><FlowNode title="CI1302离线识别" note="唤醒 / 固定命令" /><FlowArrow /><FlowNode title="C3安全状态机" note="语义ID / 互锁" /><FlowArrow /><FlowNode title="在线ASR与规则" note="未命中时进入" /><FlowArrow /><FlowNode title="知识库 / LLM" note="复杂问题" /><FlowArrow /><FlowNode title="TTS返回" note="半双工播报" /></div></section>
      <section className="workspace-section"><SectionTitle title="离线命令表" /><Table rowKey="id" pagination={{ pageSize: 10, showSizeChanger: false }} dataSource={voice?.commands || []} columns={[
        { title: "语义ID", dataIndex: "semanticId", width: 100, render: (value: number) => <code>0x{value.toString(16).toUpperCase().padStart(4, "0")}</code> },
        { title: "命令词", dataIndex: "phrase" },
        { title: "别名", dataIndex: "aliases", render: (values: string[]) => values.join("、") || "-" },
        { title: "设备意图", dataIndex: "intent", render: (value: string) => <Tag>{value}</Tag> },
        { title: "反馈", dataIndex: "feedbackTone", width: 100 },
        { title: "状态", dataIndex: "enabled", width: 90, render: (value: boolean) => <Badge status={value ? "success" : "default"} text={value ? "启用" : "停用"} /> },
      ]} /></section>
    </div>
  );
}

function DeliveryPage({ gates, board, product, voices }: { gates: DevelopmentGate[]; board: BoardProfile | null; product?: ProductProfile; voices: VoiceProfile[] }) {
  const passed = gates.filter((gate) => gate.status === "PASSED").length;
  return (
    <div className="page-stack">
      <section className="release-header"><div><span className="eyebrow">RELEASE CANDIDATE</span><h2>{product?.model || "DX-AI-01"}</h2><p>{board?.name} · {board?.revision}</p></div><Progress type="circle" percent={Math.round((passed / gates.length) * 100)} size={92} strokeColor="#176b55" /></section>
      <section className="workspace-section"><SectionTitle title="交付门禁" /><div className="delivery-list">{gates.map((gate) => <div className="delivery-row" key={gate.id}><span className={`gate-icon ${gate.status.toLowerCase()}`}>{gate.status === "PASSED" ? <CheckCircleFilled /> : <PauseCircleFilled />}</span><code>{gate.id}</code><div><strong>{gate.label}</strong><span>{gate.detail}</span></div><Tag color={gate.status === "PASSED" ? "green" : "orange"}>{gate.status === "PASSED" ? "已通过" : "受阻"}</Tag></div>)}</div></section>
      <section className="workspace-section"><SectionTitle title="版本构成" /><div className="release-artifacts"><Artifact label="产品定义" value={product?.name || "-"} status="已建立" /><Artifact label="板卡定义" value={`${board?.name || "-"} / ${board?.revision || "-"}`} status={board?.lifecycle === "DRAFT" ? "草稿" : "有效"} /><Artifact label="固件" value="0.4.0-direct-control" status="实板验证" /><Artifact label="CI语音包" value={voices[0]?.version || "未生成"} status={voices[0]?.status || "缺失"} /><Artifact label="MQTT协议" value="V1.0" status="已验证" /><Artifact label="验收报告" value="等待低压IO与语音样板" status="未完成" /></div></section>
    </div>
  );
}

function PinTable({ pins }: { pins: BoardPin[] }) {
  return <section className="workspace-section"><SectionTitle title="引脚明细" /><Table rowKey="id" scroll={{ x: 1200 }} pagination={false} dataSource={pins} columns={[
    { title: "管脚", dataIndex: "label", width: 120, fixed: "left" },
    { title: "GPIO", dataIndex: "gpio", width: 80, render: (value: number | null) => value === null ? "-" : `GPIO${value}` },
    { title: "网络名", dataIndex: "signal", width: 190, render: (value: string) => <code>{value}</code> },
    { title: "方向", dataIndex: "direction", width: 110 },
    { title: "电气", dataIndex: "electrical", width: 170 },
    { title: "连接目标", dataIndex: "target", width: 220 },
    { title: "默认", dataIndex: "defaultLevel", width: 90 },
    { title: "启动/安全约束", dataIndex: "bootConstraint", width: 260 },
    { title: "状态", dataIndex: "status", width: 110, fixed: "right", render: (value: HardwareDefinitionStatus) => <StatusTag status={value} /> },
  ]} /></section>;
}

function IoMatrix({ ports }: { ports: IoExpanderPort[] }) {
  if (!ports.length) return <section className="workspace-section"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前开发板未连接PCF8574；切换到DX-AI-01量产候选板查看24路规划" /></section>;
  return <div className="io-bank-grid">{(["U1", "U2", "U3"] as const).map((bank) => { const bankPorts = ports.filter((item) => item.device === bank); return <section className="workspace-section io-bank" key={bank}><SectionTitle title={`${bank} · 0x${bankPorts[0]?.address.toString(16).toUpperCase()}`} aside={<Tag>{bankPorts.filter((item) => item.status === "RESERVED").length}路预留</Tag>} /><div className="port-list">{bankPorts.map((port) => <div className={`port-row safety-${port.safetyClass.toLowerCase()}`} key={port.id}><code>P{port.port}</code><span><strong>{port.signal}</strong><small>{port.target}</small></span><span className="port-electrical">{port.direction}<small>{port.activeLevel === "N/A" ? "-" : `${port.activeLevel}有效`}</small></span><StatusTag status={port.status} /></div>)}</div></section>; })}</div>;
}

function TraceTable({ traces, compact = false }: { traces: DeviceExecutionTrace[]; compact?: boolean }) {
  return <Table size="small" rowKey="traceId" pagination={false} locale={{ emptyText: "暂无命令轨迹" }} dataSource={traces} columns={[
    { title: "时间", dataIndex: "startedAt", width: 95, render: formatTime },
    { title: "意图", dataIndex: "intent", ellipsis: true, render: (value: string) => intentLabels[value] || value },
    ...(!compact ? [{ title: "执行路径", dataIndex: "executionPath", width: 140, render: (value: string | null) => <ExecutionPathTag path={value} /> }] : []),
    { title: "结果", dataIndex: "status", width: 100, render: (value: DeviceExecutionTrace["status"]) => <CommandStatus status={value} /> },
  ]} />;
}

function TraceStage({ stage, last }: { stage: ExecutionTraceStage; last: boolean }) {
  return <div className={`stage-item stage-${stage.status.toLowerCase()}`}><div className="stage-marker">{stage.status === "COMPLETED" ? <CheckCircleFilled /> : stage.status === "PENDING" ? <LoadingOutlined /> : stage.status === "SKIPPED" ? <PauseCircleFilled /> : <BugOutlined />}</div>{!last ? <div className="stage-line" /> : null}<div className="stage-copy"><span>{stage.label}</span><strong>{stage.detail}</strong><code>{stage.module}</code></div></div>;
}

function GateItem({ gate, last }: { gate: DevelopmentGate; last: boolean }) {
  return <div className={`gate-item ${gate.status.toLowerCase()}`}><div className="gate-head"><span>{gate.status === "PASSED" ? <CheckCircleFilled /> : <PauseCircleFilled />}</span>{!last ? <i /> : null}</div><code>{gate.id}</code><strong>{gate.label}</strong><small>{gate.detail}</small></div>;
}

function CommandButton(props: { label: string; intent: string; icon: ReactNode; danger?: boolean; sendingIntent: string | null; onCommand: (intent: string) => void; device?: DeviceProfile | null }) {
  return <Button icon={props.icon} danger={props.danger} disabled={props.device?.status !== "ONLINE" || Boolean(props.sendingIntent)} loading={props.sendingIntent === props.intent} onClick={() => props.onCommand(props.intent)}>{props.label}</Button>;
}

function CommandGroup({ title, children }: { title: string; children: ReactNode }) { return <div className="command-group"><span>{title}</span><div>{children}</div></div>; }
function FlowNode({ title, note }: { title: string; note: string }) { return <div className="flow-node"><strong>{title}</strong><span>{note}</span></div>; }
function FlowArrow() { return <span className="flow-arrow">→</span>; }
function Artifact({ label, value, status }: { label: string; value: string; status: string }) { return <article><span>{label}</span><strong>{value}</strong><Tag>{status}</Tag></article>; }
function Boundary({ title, items }: { title: string; items: string[] }) { return <div className="boundary-item"><strong>{title}</strong>{items.map((item) => <span key={item}>· {item}</span>)}</div>; }
function PinBadge({ pin, right = false }: { pin: BoardPin; right?: boolean }) { return <Tooltip title={`${pin.signal} · ${pin.target}`} placement={right ? "right" : "left"}><div className={`pin-badge status-${pin.status.toLowerCase()}`}><span className="pin-number">{pin.label}</span><span className="pin-signal">{pin.signal}</span></div></Tooltip>; }
function TopologyNode({ icon, title, subtitle, status, primary = false }: { icon: ReactNode; title: string; subtitle: string; status: string; primary?: boolean }) { return <div className={`topology-node ${primary ? "primary" : ""}`}><span className="topology-icon">{icon}</span><strong>{title}</strong><small>{subtitle}</small><Tag>{status}</Tag></div>; }
function TopologyLink({ top, bottom }: { top: string; bottom: string }) { return <div className="topology-link"><span>{top}</span><i /><small>{bottom}</small></div>; }
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "green" }) { return <article className={`metric ${tone ? `metric-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function SectionTitle({ title, aside }: { title: string; aside?: ReactNode }) { return <div className="section-title"><h2>{title}</h2>{aside}</div>; }
function ContextItem({ label, children }: { label: string; children: ReactNode }) { return <div className="context-item"><span>{label}</span><div>{children}</div></div>; }
function NavGroup({ label, children }: { label: string; children: ReactNode }) { return <div className="nav-group"><span>{label}</span>{children}</div>; }
function NavItem({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>; }

function StatusTag({ status }: { status: HardwareDefinitionStatus }) {
  const map: Record<HardwareDefinitionStatus, { color: string; label: string }> = { PLANNED: { color: "orange", label: "规划" }, ASSIGNED: { color: "blue", label: "已分配" }, VERIFIED: { color: "green", label: "已验证" }, FROZEN: { color: "cyan", label: "已冻结" }, RESERVED: { color: "default", label: "预留" } };
  return <Tag color={map[status].color}>{map[status].label}</Tag>;
}
function CommandStatus({ status }: { status: DeviceExecutionTrace["status"] }) {
  const color = status === "APPLIED" ? "green" : status === "QUEUED" ? "blue" : status === "REJECTED" ? "orange" : "red";
  const labels: Record<string, string> = { APPLIED: "成功", QUEUED: "等待", REJECTED: "拒绝", FAILED: "失败", NEEDS_CONFIRMATION: "待确认" };
  return <Tag color={color}>{labels[status] || status}</Tag>;
}
function ExecutionModeTag({ board }: { board: BoardProfile | null }) { return <Tag color={board?.executionMode === "LOCAL_PHYSICAL" ? "volcano" : "geekblue"}>{board?.executionMode || "-"}</Tag>; }
function ExecutionPathTag({ path }: { path: string | null }) { return <Tag color={path === "LOCAL_PCF8574" ? "volcano" : path === "LOCAL_VIRTUAL" ? "geekblue" : "default"}>{path || "旧回执"}</Tag>; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function durationText(start: string, end: string | null) { if (!end || end.startsWith("device-")) return "未同步"; const ms = new Date(end).getTime() - new Date(start).getTime(); return Number.isFinite(ms) && ms >= 0 ? `${ms} ms` : "未同步"; }
function readSectionHash(): Section { const value = window.location.hash.replace("#", "") as Section; return value in sectionMeta ? value : "overview"; }
