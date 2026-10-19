import {
  AlertOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  KnowledgeCategory,
  KnowledgeDocument,
  ProactiveMode,
  SystemLog,
} from "@dongxin/shared";
import {
  Alert,
  App,
  Badge,
  Button,
  Empty,
  Input,
  InputNumber,
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
  createKnowledgeDocument,
  getOperationsConsole,
  updateProactiveSettings,
} from "./api";
import type { OperationsConsoleData } from "./api";

type Section =
  "overview" | "devices" | "knowledge" | "ai" | "records" | "system";

const sectionMeta: Record<Section, { label: string; description: string }> = {
  overview: {
    label: "运营总览",
    description: "设备在线情况、服务状态和待处理问题",
  },
  devices: {
    label: "设备管理",
    description: "设备档案、在线状态、固件和最近通信",
  },
  knowledge: { label: "知识库", description: "维护产品、使用、故障和售后资料" },
  ai: { label: "AI 运营", description: "查看线上模型并管理主动沟通策略" },
  records: {
    label: "告警与日志",
    description: "查询设备故障、控制结果和系统记录",
  },
  system: { label: "系统状态", description: "检查平台部署依赖和上线门禁" },
};

const categoryOptions: Array<{ value: KnowledgeCategory; label: string }> = [
  { value: "PRODUCT", label: "产品资料" },
  { value: "INSTALL", label: "安装说明" },
  { value: "USAGE", label: "使用说明" },
  { value: "TROUBLESHOOTING", label: "故障处理" },
  { value: "AFTER_SALES", label: "售后规则" },
  { value: "MAINTENANCE", label: "保养清洁" },
];

export default function OperationsConsole() {
  const { message } = App.useApp();
  const [data, setData] = useState<OperationsConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>(() => readHash());
  const [deviceFilter, setDeviceFilter] = useState("ALL");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      setData(await getOperationsConsole());
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  function navigate(next: Section) {
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const meta = sectionMeta[section];
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <div className="ops-mark">DX</div>
          <div>
            <strong>东信设备运营平台</strong>
            <span>Operations Console</span>
          </div>
        </div>
        <nav aria-label="运营平台导航">
          <NavGroup label="日常运营">
            <Nav
              active={section === "overview"}
              icon={<AppstoreOutlined />}
              label="运营总览"
              onClick={() => navigate("overview")}
            />
            <Nav
              active={section === "devices"}
              icon={<DesktopOutlined />}
              label="设备管理"
              onClick={() => navigate("devices")}
            />
            <Nav
              active={section === "records"}
              icon={<AlertOutlined />}
              label="告警与日志"
              badge={data?.metrics.openAlerts}
              onClick={() => navigate("records")}
            />
          </NavGroup>
          <NavGroup label="内容与服务">
            <Nav
              active={section === "knowledge"}
              icon={<DatabaseOutlined />}
              label="知识库"
              onClick={() => navigate("knowledge")}
            />
            <Nav
              active={section === "ai"}
              icon={<CloudServerOutlined />}
              label="AI 运营"
              onClick={() => navigate("ai")}
            />
          </NavGroup>
          <NavGroup label="平台">
            <Nav
              active={section === "system"}
              icon={<SettingOutlined />}
              label="系统状态"
              onClick={() => navigate("system")}
            />
          </NavGroup>
        </nav>
        <div className="ops-user">
          <div className="avatar">管</div>
          <div>
            <strong>平台管理员</strong>
            <span>东信内部账号</span>
          </div>
        </div>
      </aside>

      <main className="ops-main">
        <header className="ops-header">
          <div>
            <h1>{meta.label}</h1>
            <p>{meta.description}</p>
          </div>
          <Space>
            <Tag color="orange">部署准备阶段</Tag>
            <Badge
              status={data?.mqtt.connected ? "success" : "error"}
              text={data?.mqtt.connected ? "服务正常" : "服务异常"}
            />
            <Tooltip title="刷新运营数据">
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void refresh()}
                aria-label="刷新"
              />
            </Tooltip>
          </Space>
        </header>
        <div className="ops-content">
          {loading && !data ? (
            <Skeleton active paragraph={{ rows: 12 }} />
          ) : null}
          {data && section === "overview" ? (
            <Overview data={data} onNavigate={navigate} />
          ) : null}
          {data && section === "devices" ? (
            <Devices
              data={data}
              filter={deviceFilter}
              onFilter={setDeviceFilter}
            />
          ) : null}
          {data && section === "knowledge" ? (
            <KnowledgeOperations
              documents={data.knowledgeDocuments}
              onChanged={() => refresh(true)}
            />
          ) : null}
          {data && section === "ai" ? (
            <AiOperations data={data} onChanged={() => refresh(true)} />
          ) : null}
          {data && section === "records" ? <Records data={data} /> : null}
          {data && section === "system" ? <SystemPage data={data} /> : null}
        </div>
      </main>
    </div>
  );
}

function Overview({
  data,
  onNavigate,
}: {
  data: OperationsConsoleData;
  onNavigate: (section: Section) => void;
}) {
  const onlineRate = data.metrics.totalDevices
    ? Math.round((data.metrics.onlineDevices / data.metrics.totalDevices) * 100)
    : 0;
  return (
    <div className="ops-stack">
      <section className="ops-metrics">
        <Metric
          label="设备总数"
          value={String(data.metrics.totalDevices)}
          detail={`${data.metrics.onlineDevices}台在线`}
        />
        <Metric
          label="在线率"
          value={`${onlineRate}%`}
          detail="按最近心跳计算"
          tone="good"
        />
        <Metric
          label="开放告警"
          value={String(data.metrics.openAlerts)}
          detail="需要运维确认"
          tone={data.metrics.openAlerts ? "warn" : "good"}
        />
        <Metric
          label="命令成功率"
          value={
            data.metrics.completedCommands
              ? `${data.metrics.commandSuccessRate}%`
              : "-"
          }
          detail={
            data.metrics.completedCommands ? "历史终态命令" : "暂无生产命令"
          }
        />
      </section>
      <Alert
        type="warning"
        showIcon
        title="当前仍是本地预生产环境"
        description="平台功能正在按服务器部署范围收口。正式上线前还需要员工登录、数据库迁移、设备独立密钥、HTTPS、备份和监控。"
      />
      <div className="ops-two-columns">
        <section className="ops-panel">
          <PanelTitle
            title="设备健康"
            action={
              <Button type="link" onClick={() => onNavigate("devices")}>
                查看全部
              </Button>
            }
          />
          <div className="health-list">
            {data.devices.length ? (
              data.devices
                .slice(0, 8)
                .map((device) => (
                  <DeviceHealth
                    key={device.id}
                    device={device}
                    events={data.recentEvents}
                  />
                ))
            ) : (
              <Empty description="暂无真实设备" />
            )}
          </div>
        </section>
        <section className="ops-panel">
          <PanelTitle title="内容与服务" />
          <div className="ops-summary-list">
            <SummaryRow
              label="知识文档"
              value={`${data.knowledgeDocuments.length} 条`}
              onClick={() => onNavigate("knowledge")}
            />
            <SummaryRow
              label="已启用AI服务"
              value={`${data.providers.filter((item) => item.enabled).length} 个`}
              onClick={() => onNavigate("ai")}
            />
            <SummaryRow
              label="主动沟通"
              value={data.proactiveSettings.enabled ? "已开启" : "已关闭"}
              onClick={() => onNavigate("ai")}
            />
            <SummaryRow
              label="系统日志"
              value={`${data.auditLogs.length} 条`}
              onClick={() => onNavigate("records")}
            />
          </div>
        </section>
      </div>
      <section className="ops-panel">
        <PanelTitle title="最近设备命令" />
        <CommandTable commands={data.recentCommands.slice(0, 8)} />
      </section>
    </div>
  );
}

function Devices({
  data,
  filter,
  onFilter,
}: {
  data: OperationsConsoleData;
  filter: string;
  onFilter: (value: string) => void;
}) {
  const rows = useMemo(
    () =>
      data.devices.filter(
        (device) => filter === "ALL" || device.status === filter,
      ),
    [data.devices, filter],
  );
  return (
    <div className="ops-stack">
      <div className="list-toolbar">
        <div>
          <strong>{rows.length}</strong>
          <span>台设备</span>
        </div>
        <Select
          value={filter}
          onChange={onFilter}
          options={[
            { value: "ALL", label: "全部状态" },
            { value: "ONLINE", label: "在线" },
            { value: "OFFLINE", label: "离线" },
            { value: "FAULT", label: "故障" },
          ]}
        />
      </div>
      <section className="ops-panel">
        <Table
          rowKey="id"
          scroll={{ x: 980 }}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "暂无已接入设备" }}
          columns={[
            {
              title: "设备",
              dataIndex: "name",
              render: (_: string, row: DeviceProfile) => (
                <div className="device-name">
                  <span className={`device-dot ${row.status.toLowerCase()}`} />
                  <div>
                    <strong>{row.name}</strong>
                    <code>{row.id}</code>
                  </div>
                </div>
              ),
            },
            { title: "产品型号", dataIndex: "model", width: 230 },
            {
              title: "固件版本",
              dataIndex: "firmwareVersion",
              width: 180,
              render: (value: string | null) => value || "未上报",
            },
            {
              title: "协议",
              dataIndex: "protocol",
              width: 100,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => <DeviceStatus status={value} />,
            },
            {
              title: "最近更新",
              dataIndex: "updatedAt",
              width: 180,
              render: formatDate,
            },
          ]}
        />
      </section>
    </div>
  );
}

function KnowledgeOperations({
  documents,
  onChanged,
}: {
  documents: KnowledgeDocument[];
  onChanged: () => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>("PRODUCT");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim() || !content.trim()) {
      message.warning("请填写资料名称和正文");
      return;
    }
    setSaving(true);
    try {
      await createKnowledgeDocument({
        title: title.trim(),
        category,
        content: content.trim(),
        tags: tags
          .split(/[，,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        status: "PUBLISHED",
      });
      setTitle("");
      setContent("");
      setTags("");
      await onChanged();
      message.success("知识资料已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-stack">
      <Alert
        type="info"
        showIcon
        title="只录入已确认的正式资料"
        description="产品说明、安装维护、故障码和售后规则应注明版本；资料没有明确答案时，系统统一引导联系官方售后。"
      />
      <div className="ops-two-columns knowledge-layout">
        <section className="ops-panel knowledge-editor">
          <PanelTitle title="新增资料" />
          <label>
            <span>资料名称</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：DX-AI-01使用说明"
            />
          </label>
          <label>
            <span>分类</span>
            <Select
              value={category}
              onChange={setCategory}
              options={categoryOptions}
            />
          </label>
          <label>
            <span>标签</span>
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="多个标签用逗号分隔"
            />
          </label>
          <label>
            <span>正文</span>
            <Input.TextArea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={10}
              placeholder="粘贴经确认的产品资料内容"
            />
          </label>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存并发布
          </Button>
        </section>
        <section className="ops-panel">
          <PanelTitle
            title="资料清单"
            action={<Tag>{documents.length} 条</Tag>}
          />
          <Table
            rowKey="id"
            size="small"
            dataSource={documents}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: "等待导入东信正式资料" }}
            columns={[
              { title: "名称", dataIndex: "title", ellipsis: true },
              {
                title: "分类",
                dataIndex: "category",
                width: 110,
                render: (value: KnowledgeCategory) =>
                  categoryOptions.find((item) => item.value === value)?.label ||
                  value,
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 90,
                render: (value: string) => (
                  <Tag color={value === "PUBLISHED" ? "green" : "default"}>
                    {value === "PUBLISHED" ? "已发布" : "草稿"}
                  </Tag>
                ),
              },
              {
                title: "更新",
                dataIndex: "updatedAt",
                width: 165,
                render: formatDate,
              },
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function AiOperations({
  data,
  onChanged,
}: {
  data: OperationsConsoleData;
  onChanged: () => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(data.proactiveSettings.enabled);
  const [mode, setMode] = useState<ProactiveMode>(data.proactiveSettings.mode);
  const [interval, setIntervalMinutes] = useState(
    data.proactiveSettings.minIntervalMinutes,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(data.proactiveSettings.enabled);
    setMode(data.proactiveSettings.mode);
    setIntervalMinutes(data.proactiveSettings.minIntervalMinutes);
  }, [data.proactiveSettings]);

  async function save() {
    setSaving(true);
    try {
      await updateProactiveSettings({
        enabled,
        mode,
        minIntervalMinutes: interval,
      });
      await onChanged();
      message.success("主动沟通设置已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-stack">
      <section className="ops-panel">
        <PanelTitle title="线上AI服务" />
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data.providers}
          columns={[
            {
              title: "类型",
              dataIndex: "serviceType",
              width: 90,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            { title: "服务", dataIndex: "name" },
            { title: "模型", dataIndex: "model", ellipsis: true },
            {
              title: "状态",
              dataIndex: "enabled",
              width: 100,
              render: (value: boolean) => (
                <Badge
                  status={value ? "success" : "default"}
                  text={value ? "启用" : "停用"}
                />
              ),
            },
          ]}
        />
      </section>
      <section className="ops-panel proactive-settings">
        <PanelTitle title="主动沟通" />
        <div className="setting-row">
          <div>
            <strong>启用主动沟通</strong>
            <span>关闭后仍记录设备事件，但不生成主动播报</span>
          </div>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>
        <div className="setting-row">
          <div>
            <strong>话术模式</strong>
            <span>第一版仅影响提醒措辞和安静策略</span>
          </div>
          <Select
            value={mode}
            onChange={setMode}
            options={[
              { value: "PRACTICAL", label: "实用提醒" },
              { value: "RELAXED", label: "轻松模式" },
              { value: "QUIET", label: "安静模式" },
            ]}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>最小提醒间隔</strong>
            <span>限制重复播报，单位为分钟</span>
          </div>
          <InputNumber
            min={1}
            max={1440}
            value={interval}
            onChange={(value) => setIntervalMinutes(value || 1)}
          />
        </div>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存设置
        </Button>
      </section>
      <Alert
        type="info"
        showIcon
        title="AI服务的密钥和模型参数由研发人员维护"
        description="运营平台只展示已批准的线上服务并管理业务策略，避免日常运维误改底层模型配置。"
      />
    </div>
  );
}

function Records({ data }: { data: OperationsConsoleData }) {
  const entries = buildAuditEntries(data.auditLogs, data.recentCommands);
  return (
    <div className="ops-stack">
      <section className="ops-panel">
        <PanelTitle
          title="设备告警"
          action={
            <Tag color={data.alerts.length ? "red" : "green"}>
              {data.alerts.length} 条
            </Tag>
          }
        />
        {data.alerts.length ? (
          <Table
            rowKey="id"
            scroll={{ x: 860 }}
            dataSource={data.alerts}
            pagination={false}
            columns={[
              {
                title: "发生时间",
                dataIndex: "createdAt",
                width: 190,
                render: formatDate,
              },
              { title: "设备", dataIndex: "deviceId" },
              {
                title: "类型",
                dataIndex: "type",
                width: 120,
                render: (value: string) => <Tag color="red">{value}</Tag>,
              },
              {
                title: "详情",
                dataIndex: "payload",
                render: (value: Record<string, unknown>) => compactJson(value),
              },
            ]}
          />
        ) : (
          <Empty description="当前没有设备告警" />
        )}
      </section>
      <section className="ops-panel">
        <PanelTitle title="操作与系统日志" action={<Tag>只读</Tag>} />
        <Table
          rowKey="id"
          scroll={{ x: 850 }}
          dataSource={entries}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          columns={[
            {
              title: "时间",
              dataIndex: "time",
              width: 190,
              render: formatDate,
            },
            {
              title: "类型",
              dataIndex: "type",
              width: 120,
              render: (value: string) => <Tag>{value}</Tag>,
            },
            { title: "来源", dataIndex: "actor", width: 130 },
            { title: "对象/操作", dataIndex: "target" },
            { title: "结果", dataIndex: "result", width: 130 },
          ]}
        />
      </section>
    </div>
  );
}

function SystemPage({ data }: { data: OperationsConsoleData }) {
  const readiness = data.productionReadiness;
  return (
    <div className="ops-stack">
      <section className="ops-panel">
        <PanelTitle title="运行依赖" />
        <div className="infra-grid">
          <Infra title="API服务" value="ONLINE" good detail="Fastify服务正常" />
          <Infra
            title="MQTT"
            value={data.mqtt.connected ? "CONNECTED" : "DISCONNECTED"}
            good={data.mqtt.connected}
            detail={data.mqtt.brokerUrl}
          />
          <Infra
            title="数据存储"
            value={readiness.database}
            detail="正式部署前迁移数据库"
          />
          <Infra
            title="员工认证"
            value={readiness.authentication}
            detail="正式部署前启用账号密码"
          />
        </div>
      </section>
      <Alert
        type="error"
        showIcon
        title="生产上线门禁尚未满足"
        description="当前平台可用于本地联调。购买云服务器后，需要依次完成HTTPS、员工认证、数据库、设备独立身份、备份、监控和文本日志清理。"
      />
    </div>
  );
}

function buildAuditEntries(logs: SystemLog[], commands: DeviceCommandRecord[]) {
  return [
    ...logs.map((log) => ({
      id: log.id,
      time: log.createdAt,
      type: log.type,
      actor: "system",
      target: log.summary,
      result: "RECORDED",
    })),
    ...commands.slice(0, 30).map((command) => ({
      id: command.id,
      time: command.createdAt,
      type: "COMMAND",
      actor: "platform",
      target: `${command.deviceId} / ${command.intent}`,
      result: command.status,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));
}

function DeviceHealth({
  device,
  events,
}: {
  device: DeviceProfile;
  events: DeviceEvent[];
}) {
  const last = events.find((event) => event.deviceId === device.id);
  const network = last?.payload.network as Record<string, unknown> | undefined;
  return (
    <div className="health-row">
      <span className={`device-dot ${device.status.toLowerCase()}`} />
      <div>
        <strong>{device.name}</strong>
        <code>{device.id}</code>
      </div>
      <span>{device.firmwareVersion || "固件未上报"}</span>
      <span>{network?.rssi ? `${network.rssi} dBm` : device.protocol}</span>
      <DeviceStatus status={device.status} />
    </div>
  );
}
function CommandTable({ commands }: { commands: DeviceCommandRecord[] }) {
  return (
    <Table
      rowKey="id"
      size="small"
      scroll={{ x: 680 }}
      pagination={false}
      locale={{ emptyText: "暂无设备命令" }}
      dataSource={commands}
      columns={[
        {
          title: "时间",
          dataIndex: "createdAt",
          width: 180,
          render: formatDate,
        },
        { title: "设备", dataIndex: "deviceId", ellipsis: true },
        { title: "意图", dataIndex: "intent", width: 180 },
        {
          title: "结果",
          dataIndex: "status",
          width: 110,
          render: (value: string) => <ResultTag value={value} />,
        },
      ]}
    />
  );
}
function SummaryRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}
function Infra({
  title,
  value,
  detail,
  good = false,
}: {
  title: string;
  value: string;
  detail: string;
  good?: boolean;
}) {
  return (
    <article>
      <span>{title}</span>
      <strong className={good ? "good" : "pending"}>{value}</strong>
      <p>{detail}</p>
    </article>
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
  tone?: "good" | "warn";
}) {
  return (
    <article className={`ops-metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function PanelTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ops-nav-group">
      <span>{label}</span>
      {children}
    </div>
  );
}
function Nav({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {badge ? <i>{badge}</i> : null}
    </button>
  );
}
function DeviceStatus({ status }: { status: string }) {
  const map: Record<string, ["success" | "error" | "default", string]> = {
    ONLINE: ["success", "在线"],
    OFFLINE: ["default", "离线"],
    FAULT: ["error", "故障"],
  };
  const item = map[status] || ["default", status];
  return <Badge status={item[0]} text={item[1]} />;
}
function ResultTag({ value }: { value: string }) {
  const color =
    value === "APPLIED"
      ? "green"
      : value === "QUEUED"
        ? "blue"
        : value === "REJECTED"
          ? "orange"
          : "red";
  return <Tag color={color}>{value}</Tag>;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}
function compactJson(value: Record<string, unknown>) {
  const content = JSON.stringify(value);
  return content.length > 110 ? `${content.slice(0, 110)}...` : content;
}
function readHash(): Section {
  const value = window.location.hash.replace("#", "") as Section;
  return value in sectionMeta ? value : "overview";
}
