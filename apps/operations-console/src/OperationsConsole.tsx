import {
  AlertOutlined,
  AppstoreOutlined,
  BellOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  ProactiveMode,
  SystemLog,
} from "@dongxin/shared";
import {
  Alert,
  App,
  Badge,
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import KnowledgeWorkbench from './KnowledgeWorkbench';
import AiServiceManagement from './AiServiceManagement';
import OperationsVoiceHistory from './OperationsVoiceHistory';
import RuntimeStatusPanel from './RuntimeStatusPanel';
import {
  AuthenticationRequiredError,
  getOperationsSession,
  getOperationsConsole,
  getOperationsDeviceDetail,
  getOperationsDevicePage,
  loginOperations,
  logoutOperations,
  updateProactiveSettings,
  updateOperationsDeviceProfile,
} from "./api";
import type {
  OperationsConsoleData,
  OperationsDeviceDetail,
  OperationsUser,
} from "./api";

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

type NoticeTier = 'Tier-C' | 'Tier-H' | 'Tier-M' | 'Tier-L';
type NoticeSeverity = 'error' | 'warning' | 'success' | 'info';
interface OperationalNotice {
  id: string;
  tier: NoticeTier;
  severity: NoticeSeverity;
  title: string;
  detail: string;
  target: Section;
}

function operationalNotices(data: OperationsConsoleData): OperationalNotice[] {
  const notices: OperationalNotice[] = [];
  if (data.metrics.faultDevices > 0) notices.push({ id: 'fault-devices', tier: 'Tier-H', severity: 'error',
    title: `${data.metrics.faultDevices} 台设备处于故障状态`, detail: '查看设备状态并核对故障记录', target: 'devices' });
  if (data.mqtt.enabled && !data.mqtt.connected) notices.push({ id: 'mqtt-disconnected', tier: 'Tier-H', severity: 'error',
    title: 'MQTT 网关未连接', detail: '设备消息可能无法正常到达', target: 'system' });
  if (data.knowledgeStats.review > 0) notices.push({ id: 'knowledge-review', tier: 'Tier-M', severity: 'info',
    title: `${data.knowledgeStats.review} 条知识待审核`, detail: '审核后才会进入线上问答', target: 'knowledge' });
  if (data.environment === 'BOUNDED_HARDWARE_PILOT' && data.productionReadiness.database === 'LOCAL_JSON_NOT_PRODUCTION') {
    notices.push({ id: 'storage-limit', tier: 'Tier-H', severity: 'warning', title: '当前仅限少量样机试点',
      detail: '正式接入消费者前需完成数据库迁移', target: 'system' });
  }
  return notices;
}

export default function OperationsConsole() {
  const { message } = App.useApp();
  const [data, setData] = useState<OperationsConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authUser, setAuthUser] = useState<OperationsUser | null>(null);
  const [section, setSection] = useState<Section>(() => readHash());
  const [knowledgeRefresh, setKnowledgeRefresh] = useState(0);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const refreshId = useRef(0);

  async function refresh(silent = false) {
    const id = ++refreshId.current;
    if (!silent) setLoading(true);
    try {
      const result = await getOperationsConsole(section);
      if (id === refreshId.current) setData(result);
    } catch (error) {
      if (id !== refreshId.current) return;
      if (error instanceof AuthenticationRequiredError) {
        setAuthRequired(true);
        setData(null);
      } else {
        message.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void getOperationsSession()
      .then((session) => {
        setAuthUser(session.user);
        setAuthRequired(false);
      })
      .catch((error) => {
        setLoading(false);
        if (error instanceof AuthenticationRequiredError) {
          setAuthRequired(true);
          return;
        }
        message.error(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    if (authRequired || !authUser) return;
    void refresh();
    if (section === 'knowledge' || section === 'ai') return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [authRequired, authUser, section]);

  if (authRequired) {
    return (
      <OperationsLogin
        onAuthenticated={(user) => {
          setAuthUser(user);
          setAuthRequired(false);
        }}
      />
    );
  }

  function navigate(next: Section) {
    if (section !== next) { refreshId.current++; setData(null); }
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const meta = sectionMeta[section];
  const notices = data ? operationalNotices(data) : [];
  const urgentCount = notices.filter((item) => item.tier === 'Tier-C' || item.tier === 'Tier-H').length;
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
            {authUser?.role === 'ADMIN' ? <Nav
              active={false}
              icon={<ExperimentOutlined />}
              label="研发工作台"
              onClick={() => { window.location.assign('/lab.html'); }}
            /> : null}
          </NavGroup>
        </nav>
        <div className="ops-user">
          <div className="avatar">管</div>
          <div>
            <strong>{authUser?.displayName || "平台管理员"}</strong>
            <span>{authUser?.username || "东信内部账号"}</span>
          </div>
          {authUser?.username !== "local-development" ? (
            <Tooltip title="退出登录">
              <button
                className="ops-logout"
                type="button"
                aria-label="退出登录"
                onClick={() => {
                  logoutOperations();
                  setData(null);
                  setAuthUser(null);
                  setAuthRequired(true);
                }}
              >
                <LogoutOutlined />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </aside>

      <main className="ops-main">
        <header className="ops-header">
          <div>
            <h1>{meta.label}</h1>
          </div>
          <Space className="ops-header-actions">
            <Badge
              status={data?.mqtt.connected ? "success" : "error"}
              text={data?.mqtt.connected ? "MQTT 已连接" : "MQTT 未连接"}
            />
            <Tooltip title="待处理事项"><Badge count={urgentCount} size="small" offset={[-2, 2]}><Button icon={<BellOutlined />} aria-label="待处理事项" onClick={() => setNoticesOpen(true)} /></Badge></Tooltip>
            <Tooltip title="刷新运营数据">
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => { setKnowledgeRefresh((value) => value + 1); void refresh(); }}
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
            <Devices refreshKey={knowledgeRefresh} canManage={authUser?.role === 'ADMIN'} />
          ) : null}
          {data && section === "knowledge" ? (
            <KnowledgeWorkbench user={authUser} refreshKey={knowledgeRefresh} />
          ) : null}
          {data && section === "ai" ? (
            <AiOperations data={data} canManage={authUser?.role === 'ADMIN'} onChanged={() => refresh(true)} />
          ) : null}
          {data && section === "records" ? <Records data={data} /> : null}
          {data && section === "system" ? <SystemPage data={data} /> : null}
        </div>
      </main>
      <Drawer title="待处理事项" open={noticesOpen} onClose={() => setNoticesOpen(false)} size="min(460px, 100vw)">
        {notices.length ? <div className="ops-notice-list">{notices.map((item) => <button className={`ops-notice severity-${item.severity}`} key={item.id} onClick={() => { setNoticesOpen(false); navigate(item.target); }}>
          <span className="ops-notice-meta"><b>{item.tier}</b><span>{item.severity.toUpperCase()}</span></span>
          <strong>{item.title}</strong><small>{item.detail}</small>
        </button>)}</div> : <Empty description="当前没有待处理事项" />}
      </Drawer>
    </div>
  );
}

function OperationsLogin({
  onAuthenticated,
}: {
  onAuthenticated: (user: OperationsUser) => void;
}) {
  const { message } = App.useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const session = await loginOperations(username, password);
      onAuthenticated(session.user);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="ops-login-shell">
      <section className="ops-login-panel" aria-labelledby="login-title">
        <div className="ops-login-brand">
          <div className="ops-mark">DX</div>
          <div>
            <h1 id="login-title">东信设备运营平台</h1>
            <span>内部员工登录</span>
          </div>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="ops-username">账号</label>
          <Input
            id="ops-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            prefix={<UserOutlined />}
            size="large"
          />
          <label htmlFor="ops-password">密码</label>
          <Input.Password
            id="ops-password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            size="large"
          />
          <Button
            htmlType="submit"
            type="primary"
            size="large"
            block
            loading={submitting}
            disabled={!username.trim() || !password}
          >
            登录
          </Button>
        </form>
      </section>
    </main>
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
  const notices = operationalNotices(data);
  return (
    <div className="ops-stack">
      <div className="ops-workbar" aria-label="运营常用操作">
        <Button type="primary" icon={<DesktopOutlined />} onClick={() => onNavigate('devices')}>查设备</Button>
        <Button icon={<DatabaseOutlined />} onClick={() => onNavigate('knowledge')}>审核知识</Button>
        <Button icon={<AlertOutlined />} onClick={() => onNavigate('records')}>告警与记录</Button>
      </div>
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
          label="故障设备"
          value={String(data.metrics.faultDevices)}
          detail="当前设备状态"
          tone={data.metrics.faultDevices ? "warn" : "good"}
        />
      </section>
      <div className="ops-two-columns">
        <section className="ops-panel">
          <PanelTitle title="待处理" action={<span className="ops-section-count">{notices.length}</span>} />
          {notices.length ? <div className="ops-notice-list">{notices.map((item) => <button key={item.id} className={`ops-notice severity-${item.severity}`} onClick={() => onNavigate(item.target)}>
            <span className="ops-notice-meta"><b>{item.tier}</b><span>{item.severity.toUpperCase()}</span></span>
            <strong>{item.title}</strong><small>{item.detail}</small>
          </button>)}</div> : <p className="ops-empty-line">当前没有待处理事项</p>}
        </section>
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
              <p className="ops-empty-line">暂无已接入设备</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Devices({ refreshKey, canManage }: { refreshKey: number; canManage: boolean }) {
  const { message } = App.useApp();
  const [filter, setFilter] = useState<string>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OperationsDeviceDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{ items: DeviceProfile[]; total: number }>({ items: [], total: 0 });
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const value = await getOperationsDevicePage({ page: String(page), pageSize: '20', search, ...(filter ? { status: filter } : {}) });
        if (active) {
          setResult(value);
          setSelectedId((previous) => value.items.some((item) => item.id === previous) ? previous : value.items[0]?.id ?? null);
        }
      }
      catch (error) { if (active) message.error(error instanceof Error ? error.message : String(error)); }
      finally { if (active) setLoading(false); }
    };
    const debounce = window.setTimeout(() => void load(), 180);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { active = false; window.clearTimeout(debounce); window.clearInterval(timer); };
  }, [page, filter, search, refreshKey, reloadToken]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setDetail((current) => current?.device.id === selectedId ? current : null);
    const load = async () => {
      setDetailLoading(true);
      try { const value = await getOperationsDeviceDetail(selectedId); if (active) setDetail(value); }
      catch (error) { if (active) message.error(error instanceof Error ? error.message : String(error)); }
      finally { if (active) setDetailLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId, refreshKey, reloadToken]);

  async function saveProfile() {
    if (!detail || !draftName.trim()) return;
    setSaving(true);
    try {
      const updated = await updateOperationsDeviceProfile(detail.device.id, { name: draftName.trim(), notes: draftNotes.trim() });
      setDetail(updated);
      setEditing(false);
      setPage(1);
      setReloadToken((value) => value + 1);
      message.success('设备档案已保存');
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  return (
    <div className="ops-stack">
      <div className="list-toolbar">
        <div>
          <strong>{result.total}</strong>
          <span>台设备</span>
        </div>
        <Input.Search aria-label="搜索设备" placeholder="搜索设备编号、名称、型号或固件" allowClear style={{ maxWidth: 420 }} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select
          value={filter}
          placeholder="全部状态"
          allowClear
          style={{ minWidth: 130 }}
          onChange={(value) => { setFilter(value); setPage(1); }}
          options={[
            { value: "ONLINE", label: "在线" },
            { value: "OFFLINE", label: "离线" },
            { value: "UNKNOWN", label: "待确认" },
            { value: "FAULT", label: "故障" },
          ]}
        />
      </div>
      <div className="ops-device-layout">
      <section className="ops-panel ops-device-list">
        <Table
          rowKey="id"
          scroll={{ x: 560 }}
          dataSource={result.items}
          loading={loading}
          pagination={{ current: page, pageSize: 20, total: result.total, showSizeChanger: false, onChange: setPage }}
          locale={{ emptyText: "暂无已接入设备" }}
          rowClassName={(row) => row.id === selectedId ? 'ops-device-selected' : ''}
          columns={[
            {
              title: "设备",
              dataIndex: "name",
              render: (_: string, row: DeviceProfile) => (
                <div className="device-name">
                  <span className={`device-dot ${row.status.toLowerCase()}`} />
                  <div>
                    <Button type="link" className="ops-device-name-button" onClick={() => { setSelectedId(row.id); setEditing(false); }}>{row.name}</Button>
                    <code>{row.id}</code>
                  </div>
                </div>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => <DeviceStatus status={value} />,
            },
            { title: "型号", dataIndex: "model", width: 180, ellipsis: true },
          ]}
        />
      </section>
      <section className="ops-panel ops-device-detail" aria-label="设备详情">
        {!selectedId ? <Empty description="选择设备查看详情" /> : detailLoading && !detail ? <Skeleton active paragraph={{ rows: 7 }} /> : detail ? <>
          <div className="panel-title">
            <h2>{detail.device.name}</h2>
            {canManage && !editing ? <Button size="small" onClick={() => {
              setDraftName(detail.device.name); setDraftNotes(detail.device.notes ?? ''); setEditing(true);
            }}>编辑档案</Button> : null}
          </div>
          <div className="ops-device-status-line"><DeviceStatus status={detail.device.status} /><span>连接状态以当前服务端收到的有效上报为准</span></div>
          {editing ? <div className="ops-device-edit">
            <label htmlFor="ops-device-name">设备名称</label>
            <Input id="ops-device-name" value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} />
            <label htmlFor="ops-device-notes">备注</label>
            <Input.TextArea id="ops-device-notes" value={draftNotes} maxLength={500} showCount rows={3} onChange={(event) => setDraftNotes(event.target.value)} />
            <Space><Button type="primary" loading={saving} disabled={!draftName.trim()} onClick={() => void saveProfile()}>保存</Button>
              <Button disabled={saving} onClick={() => setEditing(false)}>取消</Button></Space>
          </div> : <dl className="ops-device-facts">
            <div><dt>设备编号</dt><dd><code>{detail.device.id}</code></dd></div>
            <div><dt>产品型号</dt><dd>{detail.device.model}</dd></div>
            <div><dt>固件版本</dt><dd>{detail.device.firmwareVersion || '未上报'}</dd></div>
            <div><dt>通信协议</dt><dd>{detail.device.protocol}</dd></div>
            <div><dt>最近记录更新</dt><dd>{formatDate(detail.device.updatedAt)}</dd></div>
            <div><dt>备注</dt><dd>{detail.device.notes || '无'}</dd></div>
          </dl>}
          <div className="ops-device-block">
            <h3>最近状态记录</h3>
            {detail.lastReport ? <><time>{formatDate(detail.lastReport.createdAt)}</time>
              <details><summary>查看记录内容</summary><pre>{JSON.stringify(detail.lastReport.payload, null, 2)}</pre></details></> : <p>暂无状态记录</p>}
          </div>
          <div className="ops-device-block">
            <h3>最近事件</h3>
            {detail.recentEvents.length ? <ul className="ops-device-timeline">{detail.recentEvents.slice(0, 8).map((event) =>
              <li key={event.id}><span>{event.type}</span><time>{formatDate(event.createdAt)}</time></li>)}</ul> : <p>暂无事件</p>}
          </div>
          <div className="ops-device-block">
            <h3>最近命令</h3>
            {detail.recentCommands.length ? <ul className="ops-device-timeline">{detail.recentCommands.slice(0, 8).map((command) =>
              <li key={command.id}><span>{command.intent}</span><ResultTag value={command.status} /><time>{formatDate(command.createdAt)}</time></li>)}</ul> : <p>暂无命令</p>}
          </div>
        </> : <Empty description="设备详情暂不可用" />}
      </section>
      </div>
    </div>
  );
}


function AiOperations({
  data,
  canManage,
  onChanged,
}: {
  data: OperationsConsoleData;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(data.proactiveSettings.enabled);
  const [mode, setMode] = useState<ProactiveMode>(data.proactiveSettings.mode);
  const [interval, setIntervalMinutes] = useState(
    data.proactiveSettings.minIntervalMinutes,
  );
  const [quietEnabled, setQuietEnabled] = useState(data.proactiveSettings.quietHours.enabled);
  const [quietStart, setQuietStart] = useState(data.proactiveSettings.quietHours.start);
  const [quietEnd, setQuietEnd] = useState(data.proactiveSettings.quietHours.end);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'services' | 'policy'>('services');

  useEffect(() => {
    setEnabled(data.proactiveSettings.enabled);
    setMode(data.proactiveSettings.mode);
    setIntervalMinutes(data.proactiveSettings.minIntervalMinutes);
    setQuietEnabled(data.proactiveSettings.quietHours.enabled);
    setQuietStart(data.proactiveSettings.quietHours.start);
    setQuietEnd(data.proactiveSettings.quietHours.end);
  }, [data.proactiveSettings]);

  async function save() {
    setSaving(true);
    try {
      await updateProactiveSettings({
        enabled,
        mode,
        minIntervalMinutes: interval,
        quietHours: { enabled: quietEnabled, start: quietStart, end: quietEnd },
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
      <div className="ops-workbar"><Segmented aria-label="AI 运营视图" value={view} onChange={(value) => setView(value as 'services' | 'policy')} options={[{ label: '服务配置', value: 'services' }, { label: '运行策略', value: 'policy' }]} /></div>
      {view === 'services' ? <AiServiceManagement canManage={canManage} /> : <>
      <section className="ops-panel proactive-settings">
        <PanelTitle title="主动沟通" action={<Button type="primary" loading={saving} disabled={!canManage} onClick={() => void save()}>保存设置</Button>} />
        <div className="setting-row">
          <div>
            <strong>启用主动沟通</strong>
          </div>
          <Switch checked={enabled} onChange={setEnabled} disabled={!canManage} />
        </div>
        <div className="setting-row">
          <div>
            <strong>话术模式</strong>
          </div>
          <Select
            disabled={!canManage}
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
          </div>
          <InputNumber
            disabled={!canManage}
            min={1}
            max={1440}
            value={interval}
            onChange={(value) => setIntervalMinutes(value || 1)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>安静时段</strong>
          </div>
          <Switch checked={quietEnabled} onChange={setQuietEnabled} disabled={!canManage} />
        </div>
        {quietEnabled && <div className="setting-row">
          <div><strong>起止时间</strong></div>
          <div className="quiet-hours-inputs">
            <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} disabled={!canManage} aria-label="安静时段开始" />
            <span>至</span>
            <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} disabled={!canManage} aria-label="安静时段结束" />
          </div>
        </div>}
      </section>
      </>}
    </div>
  );
}

function Records({ data }: { data: OperationsConsoleData }) {
  const [view, setView] = useState<'alerts' | 'voice' | 'audit' | 'commands'>('alerts');
  const entries = buildAuditEntries(data.auditLogs);
  return (
    <div className="ops-stack">
      <div className="ops-workbar"><Segmented aria-label="记录类型" value={view} onChange={setView} options={[{ label: `设备告警 ${data.alerts.length}`, value: 'alerts' }, { label: '语音记录', value: 'voice' }, { label: '操作记录', value: 'audit' }, { label: '设备命令', value: 'commands' }]} /></div>
      {view === 'voice' ? <OperationsVoiceHistory /> : null}
      {view === 'alerts' ? <section className="ops-panel">
        <PanelTitle
          title="近期故障事件"
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
      </section> : null}
      {view === 'audit' ? <section className="ops-panel">
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
      </section> : null}
      {view === 'commands' ? <section className="ops-panel"><PanelTitle title="设备命令" /><CommandTable commands={data.recentCommands} /></section> : null}
    </div>
  );
}

function SystemPage({ data }: { data: OperationsConsoleData }) {
  const readiness = data.productionReadiness;
  return (
    <div className="ops-stack">
      {data.runtime && <RuntimeStatusPanel status={data.runtime} mqtt={data.mqtt} />}
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
            detail={readiness.deployment === "BOUNDED_PILOT_ONLY"
              ? `样机试点 ${readiness.pilotDeviceCount}/${readiness.pilotDeviceLimit} 台；正式部署前须迁移数据库`
              : "当前仍是 JSON；正式部署前必须迁移数据库"}
          />
          <Infra
            title="员工认证"
            value={readiness.authentication}
            good={readiness.authentication === "ENABLED"}
            detail={
              readiness.authentication === "ENABLED"
                ? "员工登录门禁已启用"
                : readiness.authentication === "MISCONFIGURED"
                  ? "认证配置不完整，服务应拒绝启动"
                  : "本地研发免登录模式"
            }
          />
        </div>
      </section>
      <Alert
        type="error"
        showIcon
        title="生产上线门禁尚未满足"
        description="当前只支持本地研发或显式授权的少量样机试点。正式上线前必须完成 HTTPS、员工认证、生产数据库、设备独立身份及云端部署验证。当前调度与数据清理结果不能替代生产容量测试。"
      />
    </div>
  );
}

function buildAuditEntries(logs: SystemLog[]) {
  return logs.map((log) => ({
      id: log.id,
      time: log.createdAt,
      type: log.type,
      actor: typeof log.payload.actor === 'string' ? log.payload.actor : "system",
      target: log.summary,
      result: "RECORDED",
    })).sort((a, b) => b.time.localeCompare(a.time));
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
    <button className={active ? "active" : ""} onClick={onClick} title={label}>
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
    UNKNOWN: ["default", "待确认"],
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
