import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  DeviceIntentSchema, ResultTypeSchema, SafetyDecisionSchema,
} from "@dongxin/shared";
import type { CreateTestCaseRequest, TestCase, TestSet, TestSetSummary } from "@dongxin/shared";
import { App, Button, Drawer, Empty, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip } from "antd";
import { useEffect, useState } from "react";
import {
  addLabTestCase, createLabTestSet, deleteLabTestCase, deleteLabTestSet,
  getLabTestSet, listLabTestSets, updateLabTestCase, updateLabTestSet,
} from "./labApi";

type CaseForm = {
  category: string;
  inputText: string;
  expectedIntent: TestCase["expectedIntent"];
  expectedResultType: TestCase["expectedResultType"];
  expectedSafetyDecision: TestCase["expectedSafetyDecision"];
  temperature: number | null;
  durationMinutes: number | null;
  requiredKeywords: string;
  forbiddenKeywords: string;
  allowDeviceAction: boolean | null;
  riskLevel: TestCase["riskLevel"];
  notes: string;
};

const emptyCase: CaseForm = {
  category: "通用问答", inputText: "", expectedIntent: null, expectedResultType: null,
  expectedSafetyDecision: null, temperature: null, durationMinutes: null,
  requiredKeywords: "", forbiddenKeywords: "", allowDeviceAction: null,
  riskLevel: "LOW", notes: "",
};
const withNone = (values: readonly string[]) => [{ value: "", label: "不指定" }, ...values.map((value) => ({ value, label: value }))];
const splitKeywords = (text: string) => text.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);

export default function LabTestSets() {
  const { message } = App.useApp();
  const [sets, setSets] = useState<TestSetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<TestSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [caseOpen, setCaseOpen] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [caseForm, setCaseForm] = useState<CaseForm>(emptyCase);

  async function refresh(preferredId?: string) {
    setLoading(true);
    try {
      const next = await listLabTestSets();
      setSets(next);
      setSelectedId((current) => preferredId || (next.some((item) => item.id === current) ? current : next[0]?.id || ""));
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let active = true;
    void getLabTestSet(selectedId).then((next) => { if (active) setSelected(next); })
      .catch((error) => { if (active) message.error(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [selectedId]);

  function openSetDialog(kind: "create" | "edit") {
    setName(kind === "edit" ? selected?.name || "" : "");
    setDescription(kind === "edit" ? selected?.description || "" : "");
    setDialog(kind);
  }
  async function saveSet() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const next = dialog === "edit" && selected
        ? await updateLabTestSet(selected.id, { name: name.trim(), description: description.trim() })
        : await createLabTestSet({ name: name.trim(), description: description.trim(), kind: "CUSTOM" });
      setSelected(next);
      setDialog(null);
      await refresh(next.id);
      message.success(dialog === "edit" ? "测试集已更新" : "测试集已创建");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function removeSet() {
    if (!selected || selected.isReadOnly) return;
    setBusy(true);
    try {
      await deleteLabTestSet(selected.id);
      setSelected(null);
      setSelectedId("");
      await refresh();
      message.success("测试集已删除");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function openCase(item?: TestCase) {
    setEditingCaseId(item?.id || null);
    setCaseForm(item ? {
      category: item.category, inputText: item.inputText,
      expectedIntent: item.expectedIntent, expectedResultType: item.expectedResultType,
      expectedSafetyDecision: item.expectedSafetyDecision,
      temperature: item.expectedSlots.temperature ?? null,
      durationMinutes: item.expectedSlots.durationMinutes ?? null,
      requiredKeywords: item.requiredKeywords.join("，"), forbiddenKeywords: item.forbiddenKeywords.join("，"),
      allowDeviceAction: item.allowDeviceAction, riskLevel: item.riskLevel, notes: item.notes || "",
    } : { ...emptyCase });
    setCaseOpen(true);
  }

  async function saveCase() {
    if (!selected || !caseForm.category.trim() || !caseForm.inputText.trim()) return;
    const payload: CreateTestCaseRequest = {
      category: caseForm.category.trim(), inputText: caseForm.inputText.trim(),
      expectedIntent: caseForm.expectedIntent, expectedResultType: caseForm.expectedResultType,
      expectedSafetyDecision: caseForm.expectedSafetyDecision,
      expectedSlots: {
        ...(caseForm.temperature === null ? {} : { temperature: caseForm.temperature }),
        ...(caseForm.durationMinutes === null ? {} : { durationMinutes: caseForm.durationMinutes }),
      },
      requiredKeywords: splitKeywords(caseForm.requiredKeywords), forbiddenKeywords: splitKeywords(caseForm.forbiddenKeywords),
      allowDeviceAction: caseForm.allowDeviceAction, riskLevel: caseForm.riskLevel, notes: caseForm.notes.trim(),
    };
    setBusy(true);
    try {
      const next = editingCaseId
        ? await updateLabTestCase(selected.id, editingCaseId, payload)
        : await addLabTestCase(selected.id, payload);
      setSelected(next);
      setCaseOpen(false);
      await refresh(next.id);
      message.success(editingCaseId ? "语料已更新" : "语料已加入测试集");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function removeCase(caseId: string) {
    if (!selected || selected.isReadOnly) return;
    setBusy(true);
    try {
      const next = await deleteLabTestCase(selected.id, caseId);
      setSelected(next);
      await refresh(next.id);
      message.success("语料已删除");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <div className="lab-workspace">
    <div className="lab-toolbar"><span>共 {sets.length} 个测试集</span><Space><Tooltip title="刷新测试集"><Button aria-label="刷新测试集" icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading} /></Tooltip><Button type="primary" icon={<PlusOutlined />} onClick={() => openSetDialog("create")}>新建测试集</Button></Space></div>
    <div className="lab-testset-layout">
      <section className="lab-section lab-testset-list" aria-label="测试集列表">
        {sets.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => { setSelected(null); setSelectedId(item.id); }}><strong>{item.name}</strong><span>{item.caseCount} 条语料 · {item.isReadOnly ? "系统只读" : "可编辑"}</span></button>)}
        {!sets.length && !loading ? <Empty description="暂无测试集" /> : null}
      </section>
      <section className="lab-section lab-testset-detail">
        {selected ? <>
          <div className="lab-section-heading"><div><h2>{selected.name}</h2><span>{selected.description || "无描述"}</span></div><Space wrap>{selected.isReadOnly ? <Tag>系统只读</Tag> : <><Tooltip title="编辑测试集"><Button icon={<EditOutlined />} aria-label="编辑测试集" onClick={() => openSetDialog("edit")} /></Tooltip><Popconfirm title="删除整个测试集？" description="该测试集内的语料会一同删除，历史批测记录不受影响。" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => void removeSet()}><Tooltip title="删除测试集"><Button danger icon={<DeleteOutlined />} aria-label="删除测试集" disabled={busy} /></Tooltip></Popconfirm></>}<Button type="primary" icon={<PlusOutlined />} disabled={selected.isReadOnly} onClick={() => openCase()}>添加语料</Button></Space></div>
          <Table<TestCase> rowKey="id" size="small" scroll={{ x: 850 }} pagination={{ pageSize: 20 }} dataSource={selected.cases} locale={{ emptyText: "该测试集暂无语料" }} columns={[
            { title: "分类", dataIndex: "category", width: 130 },
            { title: "输入语料", dataIndex: "inputText", ellipsis: true },
            { title: "预期意图", dataIndex: "expectedIntent", width: 130, render: (value: string | null) => value || "不限" },
            { title: "风险", dataIndex: "riskLevel", width: 85, render: (value: string) => <Tag color={value === "HIGH" ? "red" : value === "MEDIUM" ? "orange" : undefined}>{value}</Tag> },
            { title: "操作", width: 110, render: (_, row) => selected.isReadOnly ? "只读" : <Space><Tooltip title="编辑语料"><Button size="small" type="text" icon={<EditOutlined />} aria-label={`编辑语料 ${row.id}`} onClick={() => openCase(row)} /></Tooltip><Popconfirm title="删除该条语料？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => void removeCase(row.id)}><Tooltip title="删除语料"><Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`删除语料 ${row.id}`} /></Tooltip></Popconfirm></Space> },
          ]} />
        </> : <Empty description="选择一个测试集" />}
      </section>
    </div>
    <Modal title={dialog === "edit" ? "编辑测试集" : "新建测试集"} open={dialog !== null} onCancel={() => setDialog(null)} onOk={() => void saveSet()} okText="保存" okButtonProps={{ disabled: !name.trim(), loading: busy }} destroyOnHidden>
      <label className="lab-form-label">名称<Input aria-label="测试集名称" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
      <label className="lab-form-label">描述<Input.TextArea aria-label="测试集描述" value={description} maxLength={500} rows={3} onChange={(event) => setDescription(event.target.value)} /></label>
    </Modal>
    <Drawer title={editingCaseId ? "编辑语料" : "添加语料"} open={caseOpen} onClose={() => setCaseOpen(false)} size="min(560px, 100vw)" extra={<Button type="primary" loading={busy} disabled={!caseForm.category.trim() || !caseForm.inputText.trim()} onClick={() => void saveCase()}>保存</Button>}>
      <div className="lab-case-form">
        <label className="lab-form-label">分类<Input aria-label="语料分类" value={caseForm.category} onChange={(event) => setCaseForm((current) => ({ ...current, category: event.target.value }))} /></label>
        <label className="lab-form-label">输入语料<Input.TextArea aria-label="语料内容" value={caseForm.inputText} rows={3} onChange={(event) => setCaseForm((current) => ({ ...current, inputText: event.target.value }))} /></label>
        <div className="lab-case-grid">
          <label className="lab-form-label">预期意图<Select aria-label="预期意图" value={caseForm.expectedIntent || ""} options={withNone(DeviceIntentSchema.options)} onChange={(value) => setCaseForm((current) => ({ ...current, expectedIntent: value ? value as TestCase["expectedIntent"] : null }))} showSearch /></label>
          <label className="lab-form-label">结果类型<Select aria-label="预期结果类型" value={caseForm.expectedResultType || ""} options={withNone(ResultTypeSchema.options)} onChange={(value) => setCaseForm((current) => ({ ...current, expectedResultType: value ? value as TestCase["expectedResultType"] : null }))} /></label>
          <label className="lab-form-label">安全判定<Select aria-label="预期安全判定" value={caseForm.expectedSafetyDecision || ""} options={withNone(SafetyDecisionSchema.options)} onChange={(value) => setCaseForm((current) => ({ ...current, expectedSafetyDecision: value ? value as TestCase["expectedSafetyDecision"] : null }))} /></label>
          <label className="lab-form-label">风险等级<Select aria-label="风险等级" value={caseForm.riskLevel} options={[{ value: "LOW", label: "低" }, { value: "MEDIUM", label: "中" }, { value: "HIGH", label: "高" }]} onChange={(value) => setCaseForm((current) => ({ ...current, riskLevel: value }))} /></label>
          <label className="lab-form-label">预期温度<InputNumber aria-label="预期温度" style={{ width: "100%" }} value={caseForm.temperature} onChange={(value) => setCaseForm((current) => ({ ...current, temperature: value }))} /></label>
          <label className="lab-form-label">预期定时分钟<InputNumber aria-label="预期定时分钟" style={{ width: "100%" }} min={1} value={caseForm.durationMinutes} onChange={(value) => setCaseForm((current) => ({ ...current, durationMinutes: value }))} /></label>
          <label className="lab-form-label">预期设备动作<Select aria-label="预期设备动作" value={caseForm.allowDeviceAction === null ? "" : String(caseForm.allowDeviceAction)} options={[{ value: "", label: "不指定" }, { value: "true", label: "允许" }, { value: "false", label: "不允许" }]} onChange={(value) => setCaseForm((current) => ({ ...current, allowDeviceAction: value === "" ? null : value === "true" }))} /></label>
        </div>
        <label className="lab-form-label">必须包含的词<Input aria-label="必须包含的词" value={caseForm.requiredKeywords} placeholder="多个词用逗号分隔" onChange={(event) => setCaseForm((current) => ({ ...current, requiredKeywords: event.target.value }))} /></label>
        <label className="lab-form-label">不得包含的词<Input aria-label="不得包含的词" value={caseForm.forbiddenKeywords} placeholder="多个词用逗号分隔" onChange={(event) => setCaseForm((current) => ({ ...current, forbiddenKeywords: event.target.value }))} /></label>
        <label className="lab-form-label">备注<Input.TextArea aria-label="语料备注" value={caseForm.notes} rows={2} onChange={(event) => setCaseForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      </div>
    </Drawer>
  </div>;
}
