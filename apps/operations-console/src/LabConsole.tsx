import {
  AudioOutlined,
  DesktopOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Input, Skeleton, Space, Tag, Tooltip } from "antd";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { AuthenticationRequiredError, getOperationsSession, loginOperations, logoutOperations } from "./api";
import type { OperationsUser } from "./api";
import { evaluateLabScenario, getLabScenarios } from "./labApi";
import type { LabScenario, LabScenarioResult } from "./labApi";
import LabAiValidation from "./LabAiValidation";
import LabSpeechValidation from "./LabSpeechValidation";
import LabTestSets from "./LabTestSets";

type Section = "scenarios" | "ai" | "speech" | "sets";
const sections: Record<Section, { label: string; icon: ReactNode }> = {
  scenarios: { label: "场景模拟", icon: <ExperimentOutlined /> },
  ai: { label: "对话验证", icon: <PlayCircleOutlined /> },
  speech: { label: "语音模块", icon: <AudioOutlined /> },
  sets: { label: "测试集", icon: <FileTextOutlined /> },
};

function initialSection(): Section {
  const value = window.location.hash.slice(1) as Section;
  return value in sections ? value : "scenarios";
}

export default function LabConsole() {
  const { message } = App.useApp();
  const [user, setUser] = useState<OperationsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [section, setSection] = useState<Section>(initialSection);

  useEffect(() => {
    let active = true;
    void getOperationsSession().then((session) => {
      if (active) setUser(session.user);
    }).catch((error) => {
      if (!active) return;
      if (error instanceof AuthenticationRequiredError) setLoginRequired(true);
      else message.error(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function navigate(next: Section) {
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  if (loginRequired) return <LabLogin onAuthenticated={(next) => { setUser(next); setLoginRequired(false); }} />;
  if (loading) return <div className="lab-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (!user) return <main className="lab-error"><Alert type="error" title="无法获取登录状态" action={<Button onClick={() => window.location.reload()}>重试</Button>} /></main>;
  if (user.role !== "ADMIN") return <main className="lab-error"><Alert type="warning" title="仅管理员可进入研发工作台" action={<Button href="/">返回运营平台</Button>} /></main>;

  return <div className="lab-shell">
    <aside className="lab-sidebar">
      <div className="lab-brand"><span className="lab-brand-mark">DX</span><div><strong>东信产品研发中心</strong><small>Cloud Lab</small></div></div>
      <nav aria-label="研发工作台导航">
        <span className="lab-nav-heading">研发验证</span>
        {(Object.entries(sections) as Array<[Section, typeof sections[Section]]>).map(([key, item]) =>
          <button key={key} type="button" title={item.label} className={section === key ? "active" : ""} onClick={() => navigate(key)}>
            {item.icon}<span>{item.label}</span>
          </button>)}
      </nav>
      <div className="lab-sidebar-footer">
        <a href="/" title="设备运营平台"><DesktopOutlined /><span>设备运营平台</span></a>
        <div><span>{user.displayName}</span><Tooltip title="退出登录"><Button size="small" type="text" icon={<LogoutOutlined />} aria-label="退出登录" onClick={() => { logoutOperations(); setUser(null); setLoginRequired(true); }} /></Tooltip></div>
      </div>
    </aside>
    <main className="lab-main">
      <header className="lab-header"><div><h1>{sections[section].label}</h1><span>云端研发工作台</span></div><Tag color="cyan">管理员</Tag></header>
      <div className="lab-content">
        {section === "scenarios" ? <ScenarioLab /> : null}
        {section === "ai" ? <LabAiValidation /> : null}
        {section === "speech" ? <LabSpeechValidation /> : null}
        {section === "sets" ? <LabTestSets /> : null}
      </div>
    </main>
  </div>;
}

function LabLogin({ onAuthenticated }: { onAuthenticated: (user: OperationsUser) => void }) {
  const { message } = App.useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try { onAuthenticated((await loginOperations(username, password)).user); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <main className="ops-login-shell"><section className="ops-login-panel" aria-labelledby="lab-login-title">
    <div className="ops-login-brand"><div className="ops-mark">DX</div><div><h1 id="lab-login-title">东信产品研发中心</h1><span>内部管理员登录</span></div></div>
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="lab-username">账号</label><Input id="lab-username" autoComplete="username" prefix={<UserOutlined />} value={username} onChange={(event) => setUsername(event.target.value)} size="large" />
      <label htmlFor="lab-password">密码</label><Input.Password id="lab-password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} size="large" />
      <Button type="primary" htmlType="submit" size="large" block loading={busy} disabled={!username.trim() || !password}>登录</Button>
    </form>
  </section></main>;
}

function ScenarioLab() {
  const { message } = App.useApp();
  const [scenarios, setScenarios] = useState<LabScenario[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<LabScenarioResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  async function load() {
    setLoading(true);
    try {
      const next = await getLabScenarios();
      setScenarios(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || "");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function run() {
    if (!selectedId) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await evaluateLabScenario(selectedId));
      if (window.innerWidth <= 720) window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setRunning(false); }
  }

  return <div className="lab-workspace">
    <div className="lab-toolbar"><Space wrap><Tag color="green">纯模拟</Tag><span>虚拟设备 DX-SIM-001</span></Space><Tooltip title="刷新场景列表"><Button icon={<ReloadOutlined />} aria-label="刷新场景" onClick={() => void load()} loading={loading} /></Tooltip></div>
    <div className="lab-scenario-grid">
      <section className="lab-scenario-list" aria-label="模拟场景">
        {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : scenarios.map((scenario) =>
          <button type="button" key={scenario.id} className={selectedId === scenario.id ? "active" : ""} onClick={() => { setSelectedId(scenario.id); setResult(null); }}>
            <span className="lab-scenario-category">{scenario.category}</span><strong>{scenario.title}</strong><small>{scenario.summary}</small>
          </button>)}
      </section>
      <section className="lab-scenario-result" aria-live="polite" ref={resultRef}>
        <div className="lab-panel-heading"><div><h2>{scenarios.find((item) => item.id === selectedId)?.title || "场景推演"}</h2><span>逻辑推演</span></div><Button type="primary" icon={<PlayCircleOutlined />} disabled={!selectedId} loading={running} onClick={() => void run()}>运行模拟</Button></div>
        {result ? <>
          <ol className="lab-steps">{result.steps.map((step, index) => <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol>
          <div className="lab-outcome"><strong>预期结果</strong><p>{result.expected}</p></div>
          <Space wrap><Tag>未执行控制</Tag><Tag>未播放音频</Tag><Tag>未发送 MQTT</Tag></Space>
        </> : <div className="lab-empty">选择场景后运行模拟</div>}
      </section>
    </div>
  </div>;
}
