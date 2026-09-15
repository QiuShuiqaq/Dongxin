import {
  AlertOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  FileProtectOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningFilled,
} from "@ant-design/icons";
import type { DeviceCommandRecord, DeviceEvent, DeviceProfile, ProductProfile, SystemLog } from "@dongxin/shared";
import { Alert, App, Badge, Button, Descriptions, Empty, Progress, Select, Skeleton, Space, Table, Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { getOperationsConsole } from "./api";
import type { OperationsConsoleData } from "./api";

type Section = "overview" | "devices" | "bindings" | "alerts" | "releases" | "ai" | "audit" | "system";

const sectionMeta: Record<Section, { label: string; description: string }> = {
  overview: { label: "运营总览", description: "生产设备、服务健康和待处理事项" },
  devices: { label: "设备中心", description: "设备档案、在线状态、固件与通信质量" },
  bindings: { label: "激活与绑定", description: "设备激活、二维码和用户归属管理" },
  alerts: { label: "告警与售后", description: "故障告警、处理记录和售后诊断" },
  releases: { label: "版本发布", description: "审批后的产品版本、灰度和回滚" },
  ai: { label: "AI 运营", description: "生产模型、语音资源、知识库和服务成本" },
  audit: { label: "审计安全", description: "账号、角色和高风险操作记录" },
  system: { label: "基础设施", description: "IoT、数据库、缓存和网关运行状态" },
};

export default function OperationsConsole() {
  const { message } = App.useApp();
  const [data, setData] = useState<OperationsConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>(() => readHash());
  const [deviceFilter, setDeviceFilter] = useState("ALL");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try { setData(await getOperationsConsole()); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(true), 10000); return () => window.clearInterval(timer); }, []);
  function navigate(next: Section) { setSection(next); window.history.replaceState(null, "", `#${next}`); }
  const meta = sectionMeta[section];

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand"><div className="ops-mark">DX</div><div><strong>东信设备运营平台</strong><span>Operations Console</span></div></div>
        <nav>
          <NavGroup label="运营"><Nav active={section === "overview"} icon={<AppstoreOutlined />} label="运营总览" onClick={() => navigate("overview")} /><Nav active={section === "devices"} icon={<DesktopOutlined />} label="设备中心" onClick={() => navigate("devices")} /><Nav active={section === "bindings"} icon={<TeamOutlined />} label="激活与绑定" onClick={() => navigate("bindings")} /></NavGroup>
          <NavGroup label="服务"><Nav active={section === "alerts"} icon={<AlertOutlined />} label="告警与售后" badge={data?.metrics.openAlerts} onClick={() => navigate("alerts")} /><Nav active={section === "releases"} icon={<RocketOutlined />} label="版本发布" onClick={() => navigate("releases")} /><Nav active={section === "ai"} icon={<CloudServerOutlined />} label="AI 运营" onClick={() => navigate("ai")} /></NavGroup>
          <NavGroup label="管理"><Nav active={section === "audit"} icon={<AuditOutlined />} label="审计安全" onClick={() => navigate("audit")} /><Nav active={section === "system"} icon={<SettingOutlined />} label="基础设施" onClick={() => navigate("system")} /></NavGroup>
        </nav>
        <div className="ops-user"><div className="avatar">管</div><div><strong>平台管理员</strong><span>东信内部账号</span></div></div>
      </aside>
      <main className="ops-main">
        <header className="ops-header"><div><h1>{meta.label}</h1><p>{meta.description}</p></div><Space><Tag color="orange">预生产环境</Tag><Badge status={data?.mqtt.connected ? "success" : "error"} text={data?.mqtt.connected ? "服务正常" : "服务异常"} /><Tooltip title="刷新运营数据"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()} aria-label="刷新" /></Tooltip></Space></header>
        <div className="ops-content">
          {loading && !data ? <Skeleton active paragraph={{ rows: 12 }} /> : null}
          {data && section === "overview" ? <Overview data={data} onNavigate={navigate} /> : null}
          {data && section === "devices" ? <Devices data={data} filter={deviceFilter} onFilter={setDeviceFilter} /> : null}
          {data && section === "bindings" ? <Bindings data={data} /> : null}
          {data && section === "alerts" ? <Alerts alerts={data.alerts} /> : null}
          {data && section === "releases" ? <Releases products={data.products} /> : null}
          {data && section === "ai" ? <AiOperations data={data} /> : null}
          {data && section === "audit" ? <Audit logs={data.auditLogs} commands={data.recentCommands} /> : null}
          {data && section === "system" ? <SystemPage data={data} /> : null}
        </div>
      </main>
    </div>
  );
}

function Overview({ data, onNavigate }: { data: OperationsConsoleData; onNavigate: (section: Section) => void }) {
  const onlineRate = data.metrics.totalDevices ? Math.round(data.metrics.onlineDevices / data.metrics.totalDevices * 100) : 0;
  const realDevices = data.devices.filter((item) => item.protocol !== "SIMULATOR");
  return <div className="ops-stack">
    <section className="ops-metrics"><Metric label="设备总数" value={String(data.metrics.totalDevices)} detail={`${realDevices.length}台真实接入`} /><Metric label="在线率" value={`${onlineRate}%`} detail={`${data.metrics.onlineDevices}台在线`} tone="good" /><Metric label="开放告警" value={String(data.metrics.openAlerts)} detail="需运维确认" tone={data.metrics.openAlerts ? "warn" : "good"} /><Metric label="命令成功率" value={`${data.metrics.commandSuccessRate}%`} detail="历史终态命令" /></section>
    <Alert type="warning" showIcon title="当前是预生产数据" description="平台仍使用本地JSON与本地MQTT，尚未启用生产账号、阿里云IoT、RDS及Redis，不可承载真实消费者设备。" />
    <div className="ops-two-columns">
      <section className="ops-panel"><PanelTitle title="设备健康" action={<Button type="link" onClick={() => onNavigate("devices")}>全部设备</Button>} /><div className="health-list">{data.devices.map((device) => <DeviceHealth key={device.id} device={device} events={data.recentEvents} />)}</div></section>
      <section className="ops-panel"><PanelTitle title="待处理事项" /><div className="todo-list"><Todo icon={<DatabaseOutlined />} title="迁移生产数据层" detail="RDS PostgreSQL / Redis 尚未配置" level="阻塞上线" /><Todo icon={<SafetyCertificateOutlined />} title="配置内部员工认证" detail="账号密码 + 可选微信扫码" level="阻塞上线" /><Todo icon={<DeploymentUnitOutlined />} title="接入阿里云IoT" detail="独立deviceSecret与设备生命周期" level="计划中" /><Todo icon={<FileProtectOutlined />} title="建立发布审批" detail="仅允许发布已验收研发包" level="计划中" /></div></section>
    </div>
    <section className="ops-panel"><PanelTitle title="最近设备命令" /><CommandTable commands={data.recentCommands.slice(0, 8)} /></section>
  </div>;
}

function Devices({ data, filter, onFilter }: { data: OperationsConsoleData; filter: string; onFilter: (value: string) => void }) {
  const rows = useMemo(() => data.devices.filter((device) => filter === "ALL" || device.status === filter), [data.devices, filter]);
  return <div className="ops-stack"><div className="list-toolbar"><div><strong>{rows.length}</strong><span>台设备</span></div><Select value={filter} onChange={onFilter} options={[{ value: "ALL", label: "全部状态" }, { value: "ONLINE", label: "在线" }, { value: "OFFLINE", label: "离线" }, { value: "FAULT", label: "故障" }]} /></div><section className="ops-panel"><Table rowKey="id" scroll={{ x: 980 }} dataSource={rows} pagination={false} columns={[
    { title: "设备", dataIndex: "name", render: (_: string, row: DeviceProfile) => <div className="device-name"><span className={`device-dot ${row.status.toLowerCase()}`} /><div><strong>{row.name}</strong><code>{row.id}</code></div></div> },
    { title: "产品型号", dataIndex: "model", width: 230 },
    { title: "固件版本", dataIndex: "firmwareVersion", width: 180, render: (value: string | null) => value || "未上报" },
    { title: "协议", dataIndex: "protocol", width: 100, render: (value: string) => <Tag>{value}</Tag> },
    { title: "状态", dataIndex: "status", width: 100, render: (value: string) => <DeviceStatus status={value} /> },
    { title: "最近更新", dataIndex: "updatedAt", width: 180, render: formatDate },
  ]} /></section></div>;
}

function Bindings({ data }: { data: OperationsConsoleData }) {
  return <div className="ops-stack"><Alert type="info" showIcon title="第一版归属策略：一台设备仅归属一个微信用户，不做家庭与多人共享" /><section className="ops-panel"><PanelTitle title="激活流程" /><div className="activation-flow"><FlowStep number="01" title="设备上电" note="使用出厂deviceSecret连接IoT" /><FlowLine /><FlowStep number="02" title="自动注册" note="平台核验产品与凭证" /><FlowLine /><FlowStep number="03" title="用户扫码" note="微信登录并扫描机身二维码" /><FlowLine /><FlowStep number="04" title="完成绑定" note="建立单设备归属" /></div></section><section className="ops-panel"><PanelTitle title="当前设备归属" action={<Button disabled>批量导入</Button>} /><Table rowKey="id" scroll={{ x: 860 }} dataSource={data.devices} pagination={false} columns={[
    { title: "设备序列号", dataIndex: "id" }, { title: "产品型号", dataIndex: "model" }, { title: "激活状态", render: () => <Tag color="orange">研发样机</Tag> }, { title: "用户归属", render: () => <span className="muted">未绑定消费者</span> }, { title: "操作", render: () => <Button type="link" disabled>生成二维码</Button> }
  ]} /></section></div>;
}

function Alerts({ alerts }: { alerts: DeviceEvent[] }) {
  return <div className="ops-stack"><section className="alert-summary"><div><WarningFilled /><span><strong>{alerts.length}</strong>开放告警</span></div><p>告警需要确认、指派和关闭，所有操作进入审计记录。</p></section><section className="ops-panel"><PanelTitle title="告警队列" />{alerts.length ? <Table rowKey="id" scroll={{ x: 900 }} dataSource={alerts} pagination={false} columns={[{ title: "发生时间", dataIndex: "createdAt", width: 190, render: formatDate }, { title: "设备", dataIndex: "deviceId" }, { title: "类型", dataIndex: "type", width: 120, render: (value: string) => <Tag color="red">{value}</Tag> }, { title: "详情", dataIndex: "payload", render: (value: Record<string, unknown>) => compactJson(value) }, { title: "状态", render: () => <Tag color="orange">待确认</Tag> }]} /> : <Empty description="当前没有开放告警" />}</section></div>;
}

function Releases({ products }: { products: ProductProfile[] }) {
  return <div className="ops-stack"><Alert type="warning" showIcon title="运营平台只能发布研发中心已审批且完成验收的版本" description="当前DX-AI-01尚未通过低压IO、CI1302语音和真实负载Gate，发布操作保持禁用。" /><section className="ops-panel"><PanelTitle title="产品发布通道" /><div className="release-table">{products.map((product) => <article key={product.id}><div><span className="product-code">{product.model}</span><strong>{product.name}</strong><small>{product.controller} · {product.voiceProcessor} · {product.ioExpander}</small></div><div><span>当前阶段</span><Tag color="orange">研发验证</Tag></div><div><span>固件</span><strong>0.4.0-direct-control</strong></div><div><span>发布范围</span><strong>0台生产设备</strong></div><Button disabled>创建发布</Button></article>)}</div></section><section className="ops-panel"><PanelTitle title="发布策略" /><Descriptions bordered size="small" column={2}><Descriptions.Item label="灰度顺序">内部样机 → 1% → 10% → 全量</Descriptions.Item><Descriptions.Item label="失败阈值">命令失败率超过1%自动暂停</Descriptions.Item><Descriptions.Item label="回滚">保留上一稳定固件与语音资源包</Descriptions.Item><Descriptions.Item label="审批">研发负责人 + 运维负责人</Descriptions.Item></Descriptions></section></div>;
}

function AiOperations({ data }: { data: OperationsConsoleData }) {
  const product = data.products[0];
  return <div className="ops-stack"><section className="ops-metrics"><Metric label="生产模型" value="未发布" detail="研发模型不自动进入生产" /><Metric label="离线优先" value="启用" detail="CI1302固定命令" tone="good" /><Metric label="文本留存" value="90天" detail="不保存原始音频" /><Metric label="已启用能力" value={String(product?.capabilities.filter((item) => item.support === "ENABLED").length || 0)} detail="产品能力矩阵" /></section><section className="ops-panel"><PanelTitle title="生产AI链路" /><div className="ai-route"><RouteNode title="离线固定命令" detail="CI1302 → C3" status="零云调用" /><RouteNode title="在线简单规则" detail="ASR → 规则引擎" status="低成本" /><RouteNode title="售后问答" detail="ASR → 知识库" status="按需TTS" /><RouteNode title="复杂对话" detail="ASR → LLM → TTS" status="受预算控制" /></div></section><section className="ops-panel"><PanelTitle title="生产保护策略" /><div className="policy-grid"><Policy icon={<ThunderboltOutlined />} title="成本路由" detail="固定命令离线执行，简单语义优先规则匹配" /><Policy icon={<SafetyCertificateOutlined />} title="安全裁决" detail="云端只做预检，C3状态机拥有最终执行权" /><Policy icon={<HistoryOutlined />} title="数据留存" detail="只保存文本、意图、回执和费用，默认90天" /><Policy icon={<CustomerServiceOutlined />} title="降级处理" detail="模型不可用时保留离线命令与设备本地控制" /></div></section></div>;
}

function Audit({ logs, commands }: { logs: SystemLog[]; commands: DeviceCommandRecord[] }) {
  const entries = [...logs.map((log) => ({ id: log.id, time: log.createdAt, type: log.type, actor: "system", target: log.summary, result: "RECORDED" })), ...commands.slice(0, 30).map((command) => ({ id: command.id, time: command.createdAt, type: "COMMAND", actor: "platform", target: `${command.deviceId} / ${command.intent}`, result: command.status }))].sort((a, b) => b.time.localeCompare(a.time));
  return <div className="ops-stack"><section className="ops-panel"><PanelTitle title="操作审计" action={<Tag>只读</Tag>} /><Table rowKey="id" scroll={{ x: 850 }} dataSource={entries} pagination={{ pageSize: 15, showSizeChanger: false }} columns={[{ title: "时间", dataIndex: "time", width: 190, render: formatDate }, { title: "类型", dataIndex: "type", width: 120, render: (value: string) => <Tag>{value}</Tag> }, { title: "操作者", dataIndex: "actor", width: 130 }, { title: "对象/操作", dataIndex: "target" }, { title: "结果", dataIndex: "result", width: 130 }]} /></section></div>;
}

function SystemPage({ data }: { data: OperationsConsoleData }) {
  const readiness = data.productionReadiness;
  return <div className="ops-stack"><section className="ops-panel"><PanelTitle title="服务依赖" /><div className="infra-grid"><Infra title="API Gateway" value="ONLINE" good detail="Fastify本地开发服务" /><Infra title="MQTT Gateway" value={data.mqtt.connected ? "CONNECTED" : "DISCONNECTED"} good={data.mqtt.connected} detail={data.mqtt.brokerUrl} /><Infra title="设备IoT" value={readiness.mqtt} detail="计划迁移阿里云IoT" /><Infra title="业务数据库" value={readiness.database} detail="计划迁移RDS PostgreSQL" /><Infra title="缓存" value="NOT_CONFIGURED" detail="计划使用阿里云Redis" /><Infra title="员工认证" value={readiness.authentication} detail="账号密码 + 可选微信扫码" /></div></section><Alert type="error" showIcon title="生产上线门禁未满足" description="身份认证、设备密钥生命周期、RDS、Redis、阿里云IoT、告警通知、备份恢复和可观测性尚未完成。此页面如实展示当前状态，不将本地开发服务标记为生产可用。" /></div>;
}

function DeviceHealth({ device, events }: { device: DeviceProfile; events: DeviceEvent[] }) { const last = events.find((event) => event.deviceId === device.id); const network = last?.payload.network as Record<string, unknown> | undefined; return <div className="health-row"><span className={`device-dot ${device.status.toLowerCase()}`} /><div><strong>{device.name}</strong><code>{device.id}</code></div><span>{device.firmwareVersion || "固件未上报"}</span><span>{network?.rssi ? `${network.rssi} dBm` : device.protocol}</span><DeviceStatus status={device.status} /></div>; }
function Todo({ icon, title, detail, level }: { icon: ReactNode; title: string; detail: string; level: string }) { return <div className="todo-row"><span className="todo-icon">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><Tag color={level === "阻塞上线" ? "red" : "orange"}>{level}</Tag></div>; }
function CommandTable({ commands }: { commands: DeviceCommandRecord[] }) { return <Table rowKey="id" size="small" scroll={{ x: 680 }} pagination={false} dataSource={commands} columns={[{ title: "时间", dataIndex: "createdAt", width: 180, render: formatDate }, { title: "设备", dataIndex: "deviceId", ellipsis: true }, { title: "意图", dataIndex: "intent", width: 180 }, { title: "结果", dataIndex: "status", width: 110, render: (value: string) => <ResultTag value={value} /> }]} />; }
function FlowStep({ number, title, note }: { number: string; title: string; note: string }) { return <div className="flow-step"><code>{number}</code><strong>{title}</strong><span>{note}</span></div>; }
function FlowLine() { return <span className="flow-line" />; }
function RouteNode({ title, detail, status }: { title: string; detail: string; status: string }) { return <article><span className="route-dot" /><strong>{title}</strong><p>{detail}</p><Tag>{status}</Tag></article>; }
function Policy({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <article><span>{icon}</span><div><strong>{title}</strong><p>{detail}</p></div></article>; }
function Infra({ title, value, detail, good = false }: { title: string; value: string; detail: string; good?: boolean }) { return <article><span>{title}</span><strong className={good ? "good" : "pending"}>{value}</strong><p>{detail}</p></article>; }
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "good" | "warn" }) { return <article className={`ops-metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PanelTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="panel-title"><h2>{title}</h2>{action}</div>; }
function NavGroup({ label, children }: { label: string; children: ReactNode }) { return <div className="ops-nav-group"><span>{label}</span>{children}</div>; }
function Nav({ active, icon, label, badge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>; }
function DeviceStatus({ status }: { status: string }) { const map: Record<string, ["success" | "error" | "default", string]> = { ONLINE: ["success", "在线"], OFFLINE: ["default", "离线"], FAULT: ["error", "故障"] }; const item = map[status] || ["default", status]; return <Badge status={item[0]} text={item[1]} />; }
function ResultTag({ value }: { value: string }) { const color = value === "APPLIED" ? "green" : value === "QUEUED" ? "blue" : value === "REJECTED" ? "orange" : "red"; return <Tag color={color}>{value}</Tag>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
function compactJson(value: Record<string, unknown>) { const text = JSON.stringify(value); return text.length > 90 ? `${text.slice(0, 90)}…` : text; }
function readHash(): Section { const value = window.location.hash.replace("#", "") as Section; return value in sectionMeta ? value : "overview"; }
