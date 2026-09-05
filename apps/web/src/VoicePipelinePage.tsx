import {
  AudioOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  StopOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type {
  DeviceIntent,
  DeviceProfile,
  ModelProvider,
  PromptVersion,
  TestCase,
  TestSet,
  TestSetKind,
  TestSetSummary,
  VoicePipelineBatchItem,
  VoicePipelineBatchRun,
  VoicePipelineResponse,
  VoicePipelineStage,
  VoicePipelineStageKey,
  VoicePipelineStageStatus,
} from "@dongxin/shared";
import { DEVICE_INTENTS } from "@dongxin/shared";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addTestCase,
  createTestSet,
  deleteTestCase,
  deleteTestSet,
  getTestSet,
  importTestSetMarkdown,
  runVoicePipeline,
  runVoicePipelineBatch,
  updateTestCase,
} from "./api";

const { Text, Title } = Typography;

type TestMode = "SINGLE" | "DATASET" | "AUDIO";
type PipelineInputSource = "TEXT_SIMULATION" | "BROWSER_AUDIO";
type VisualNodeKey =
  VoicePipelineStageKey | "OFFLINE_DEVICE" | "RULE_CLASSIFY" | "LLM_CLASSIFY";

interface VoicePipelinePageProps {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  devices: DeviceProfile[];
  llmProviders: ModelProvider[];
  testSets: TestSetSummary[];
  selectedDeviceId: string;
  selectedProviderId: string;
  selectedPromptId: string;
  onRefresh: () => Promise<void>;
}

interface TestSetDraft {
  name: string;
  description?: string;
  kind: TestSetKind;
}

interface ImportDraft {
  name: string;
  description?: string;
  kind: TestSetKind;
  markdown: string;
}

interface TestCaseDraft {
  category: string;
  inputText: string;
  expectedIntent?: DeviceIntent | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  notes?: string;
}

interface VisualNode {
  key: VisualNodeKey;
  title: string;
  description: string;
  branchLabel?: string;
  status: VoicePipelineStageStatus | "IDLE";
  stage?: VoicePipelineStage;
  result: string;
  detail: Record<string, unknown>;
  gridArea: string;
}

const testSetKindLabels: Record<TestSetKind, string> = {
  STANDARD: "标准",
  SIMPLE: "简单",
  COMPLEX: "复杂",
  CUSTOM: "自定义",
};

const testSetKindOptions = [
  { label: "自定义", value: "CUSTOM" },
  { label: "简单", value: "SIMPLE" },
  { label: "复杂", value: "COMPLEX" },
];

const riskLevelOptions = [
  { label: "低", value: "LOW" },
  { label: "中", value: "MEDIUM" },
  { label: "高", value: "HIGH" },
];

const intentOptions = DEVICE_INTENTS.map((intent) => ({
  label: intent,
  value: intent,
}));

export function VoicePipelinePage(props: VoicePipelinePageProps) {
  const [apiMessage, messageHolder] = message.useMessage();
  const [mode, setMode] = useState<TestMode>("SINGLE");
  const [text, setText] = useState("空气有点闷，开启换气");
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    props.selectedDeviceId,
  );
  const [selectedProviderId, setSelectedProviderId] = useState(
    props.selectedProviderId,
  );
  const [selectedAsrProviderId, setSelectedAsrProviderId] = useState("");
  const [selectedTtsProviderId, setSelectedTtsProviderId] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState(
    props.selectedPromptId,
  );
  const [applyToDevice, setApplyToDevice] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState<
    "AUTO" | "HIT" | "MISS"
  >("AUTO");
  const [singleResult, setSingleResult] =
    useState<VoicePipelineResponse | null>(null);
  const [batchRun, setBatchRun] = useState<VoicePipelineBatchRun | null>(null);
  const [selectedBatchItemId, setSelectedBatchItemId] = useState<string | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [activeTestSetId, setActiveTestSetId] = useState(
    props.testSets[0]?.id ?? "",
  );
  const [testSetDetail, setTestSetDetail] = useState<TestSet | null>(null);
  const [testSetLoading, setTestSetLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [testSetModalOpen, setTestSetModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedNodeKey, setSelectedNodeKey] =
    useState<VisualNodeKey>("INPUT");
  const [testSetForm] = Form.useForm<TestSetDraft>();
  const [importForm] = Form.useForm<ImportDraft>();
  const [caseForm] = Form.useForm<TestCaseDraft>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  const asrProviders = useMemo(
    () => props.providers.filter((provider) => provider.serviceType === "ASR"),
    [props.providers],
  );
  const ttsProviders = useMemo(
    () => props.providers.filter((provider) => provider.serviceType === "TTS"),
    [props.providers],
  );
  const selectedBatchItem = useMemo(
    () =>
      batchRun?.items.find((item) => item.id === selectedBatchItemId) ??
      batchRun?.items[0] ??
      null,
    [batchRun, selectedBatchItemId],
  );
  const activeResult = selectedBatchItem?.response ?? singleResult;
  const activeTestSetSummary = props.testSets.find(
    (testSet) => testSet.id === activeTestSetId,
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          (testSetDetail?.cases ?? []).map((testCase) => testCase.category),
        ),
      ).sort(),
    [testSetDetail],
  );
  const visibleCases = useMemo(() => {
    const cases = testSetDetail?.cases ?? [];
    return categoryFilter === "ALL"
      ? cases
      : cases.filter((testCase) => testCase.category === categoryFilter);
  }, [categoryFilter, testSetDetail]);

  useEffect(() => {
    setSelectedDeviceId(props.selectedDeviceId);
  }, [props.selectedDeviceId]);

  useEffect(() => {
    setSelectedProviderId(props.selectedProviderId);
  }, [props.selectedProviderId]);

  useEffect(() => {
    setSelectedPromptId(props.selectedPromptId);
  }, [props.selectedPromptId]);

  useEffect(() => {
    if (
      !props.llmProviders.some((provider) => provider.id === selectedProviderId)
    ) {
      setSelectedProviderId(
        props.llmProviders.find((provider) => provider.enabled)?.id ||
          props.llmProviders[0]?.id ||
          "",
      );
    }
  }, [props.llmProviders, selectedProviderId]);

  useEffect(() => {
    if (
      !asrProviders.some((provider) => provider.id === selectedAsrProviderId)
    ) {
      setSelectedAsrProviderId(
        asrProviders.find((provider) => provider.enabled)?.id ||
          asrProviders[0]?.id ||
          "",
      );
    }
  }, [asrProviders, selectedAsrProviderId]);

  useEffect(() => {
    if (
      !ttsProviders.some((provider) => provider.id === selectedTtsProviderId)
    ) {
      setSelectedTtsProviderId(
        ttsProviders.find((provider) => provider.enabled)?.id ||
          ttsProviders[0]?.id ||
          "",
      );
    }
  }, [ttsProviders, selectedTtsProviderId]);

  useEffect(() => {
    if (!props.testSets.length) {
      setActiveTestSetId("");
      setTestSetDetail(null);
      return;
    }
    if (!props.testSets.some((testSet) => testSet.id === activeTestSetId)) {
      setActiveTestSetId(props.testSets[0].id);
    }
  }, [props.testSets, activeTestSetId]);

  useEffect(() => {
    if (!activeTestSetId) {
      setTestSetDetail(null);
      return;
    }

    let cancelled = false;
    setTestSetLoading(true);
    void getTestSet(activeTestSetId)
      .then((detail) => {
        if (!cancelled) {
          setTestSetDetail(detail);
          setCategoryFilter("ALL");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          apiMessage.error(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTestSetLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTestSetId, apiMessage]);

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  async function executePipeline(input: {
    inputSource: PipelineInputSource;
    text?: string;
    audioBase64?: string;
    mimeType?: string;
  }) {
    setRunning(true);
    setBatchRun(null);
    setSelectedBatchItemId(null);
    try {
      const nextResult = await runVoicePipeline({
        deviceId: selectedDeviceId,
        providerId: selectedProviderId || undefined,
        asrProviderId: selectedAsrProviderId || undefined,
        ttsProviderId: selectedTtsProviderId || undefined,
        promptId: selectedPromptId || undefined,
        applyToDevice,
        simulateOffline,
        ...input,
      });
      setSingleResult(nextResult);
      setSelectedNodeKey("INPUT");
      apiMessage.success(`链路完成：${routeLabel(nextResult.route)}`);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  async function runSingleText() {
    if (!text.trim()) {
      apiMessage.warning("请输入测试内容");
      return;
    }
    await executePipeline({
      inputSource: "TEXT_SIMULATION",
      text: text.trim(),
    });
  }

  async function runRecordedAudio() {
    if (!recordedBlob) {
      apiMessage.warning("请先录制语音");
      return;
    }
    await executePipeline({
      inputSource: "BROWSER_AUDIO",
      audioBase64: await blobToBase64(recordedBlob),
      mimeType: recordedBlob.type || "audio/webm",
    });
  }

  async function runDataset(testCaseIds?: string[]) {
    if (!activeTestSetId) {
      apiMessage.warning("请先选择测试集");
      return;
    }

    setRunning(true);
    try {
      const nextRun = await runVoicePipelineBatch({
        testSetId: activeTestSetId,
        testCaseIds,
        deviceId: selectedDeviceId,
        providerId: selectedProviderId || undefined,
        asrProviderId: selectedAsrProviderId || undefined,
        ttsProviderId: selectedTtsProviderId || undefined,
        promptId: selectedPromptId || undefined,
        applyToDevice,
        simulateOffline,
      });
      setBatchRun(nextRun);
      setSingleResult(null);
      setSelectedNodeKey("INPUT");
      setSelectedBatchItemId(
        nextRun.items.find((item) => !item.isMatch)?.id ||
          nextRun.items[0]?.id ||
          null,
      );
      apiMessage.success(
        `批测完成：${nextRun.summary.passed}/${nextRun.summary.total}`,
      );
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  async function startRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      apiMessage.error("当前浏览器不支持麦克风录音");
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
        const blob = new Blob(mediaChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
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

  function handlePickMarkdownFile(file: File) {
    void file.text().then((markdown) => {
      importForm.setFieldsValue({
        name: file.name.replace(/\.md$/i, ""),
        description: "",
        kind: "CUSTOM",
        markdown,
      });
      setImportModalOpen(true);
    });
  }

  async function handleCreateTestSet(values: TestSetDraft) {
    setSaving(true);
    try {
      const created = await createTestSet({
        name: values.name.trim(),
        description: values.description?.trim() || "",
        kind: values.kind || "CUSTOM",
      });
      setTestSetModalOpen(false);
      testSetForm.resetFields();
      await props.onRefresh();
      setActiveTestSetId(created.id);
      setTestSetDetail(created);
      apiMessage.success("测试集已创建");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleImportMarkdown(values: ImportDraft) {
    setSaving(true);
    try {
      const imported = await importTestSetMarkdown({
        name: values.name.trim(),
        description: values.description?.trim() || "",
        kind: values.kind || "CUSTOM",
        markdown: values.markdown,
      });
      setImportModalOpen(false);
      importForm.resetFields();
      await props.onRefresh();
      setActiveTestSetId(imported.id);
      setTestSetDetail(imported);
      apiMessage.success("Markdown 已导入");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteActiveSet() {
    if (!activeTestSetId || activeTestSetSummary?.isReadOnly) {
      return;
    }

    setSaving(true);
    try {
      await deleteTestSet(activeTestSetId);
      setBatchRun(null);
      setSingleResult(null);
      await props.onRefresh();
      apiMessage.success("测试集已删除");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function openCaseEditor(testCase?: TestCase) {
    setEditingCase(testCase ?? null);
    caseForm.setFieldsValue({
      category: testCase?.category || "",
      inputText: testCase?.inputText || "",
      expectedIntent: testCase?.expectedIntent ?? null,
      riskLevel: testCase?.riskLevel || "LOW",
      notes: testCase?.notes || "",
    });
    setCaseModalOpen(true);
  }

  async function handleSaveCase(values: TestCaseDraft) {
    if (!activeTestSetId || activeTestSetSummary?.isReadOnly) {
      apiMessage.warning("标准测试集只读，请新建或导入测试集后编辑。");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        category: values.category.trim(),
        inputText: values.inputText.trim(),
        expectedIntent: values.expectedIntent ?? null,
        riskLevel: values.riskLevel || "LOW",
        notes: values.notes?.trim() || undefined,
      };
      const updated = editingCase
        ? await updateTestCase(activeTestSetId, editingCase.id, payload)
        : await addTestCase(activeTestSetId, payload);
      setTestSetDetail(updated);
      setCaseModalOpen(false);
      setEditingCase(null);
      caseForm.resetFields();
      await props.onRefresh();
      apiMessage.success(editingCase ? "语料已更新" : "语料已新增");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCase(testCase: TestCase) {
    if (!activeTestSetId || activeTestSetSummary?.isReadOnly) {
      return;
    }

    setSaving(true);
    try {
      const updated = await deleteTestCase(activeTestSetId, testCase.id);
      setTestSetDetail(updated);
      await props.onRefresh();
      apiMessage.success("语料已删除");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const datasetColumns: ColumnsType<TestCase> = [
    {
      title: "语料",
      dataIndex: "inputText",
      render: (value, record) => {
        const item = batchRun?.items.find(
          (resultItem) => resultItem.testCaseId === record.id,
        );
        return (
          <Space orientation="vertical" size={2} className="full-width">
            <Text strong ellipsis title={String(value)}>
              {value}
            </Text>
            <Space size={6} wrap>
              <Tag>{record.category}</Tag>
              {record.expectedIntent ? (
                <Tag color="blue">{record.expectedIntent}</Tag>
              ) : (
                <Tag>对话/问答</Tag>
              )}
              {item ? (
                <Tag color={item.isMatch ? "green" : "red"}>
                  {item.isMatch ? "通过" : "未通过"}
                </Tag>
              ) : null}
              {item ? <Tag color="purple">{routeLabel(item.route)}</Tag> : null}
            </Space>
          </Space>
        );
      },
    },
    {
      title: "操作",
      width: 142,
      render: (_, record) => (
        <Space size={6}>
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            loading={running}
            onClick={(event) => {
              event.stopPropagation();
              void runDataset([record.id]);
            }}
          />
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={activeTestSetSummary?.isReadOnly}
            onClick={(event) => {
              event.stopPropagation();
              openCaseEditor(record);
            }}
          />
          <Popconfirm
            title="删除语料"
            description="删除后不可恢复"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={activeTestSetSummary?.isReadOnly}
            onConfirm={() => void handleDeleteCase(record)}
          >
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              disabled={activeTestSetSummary?.isReadOnly}
              onClick={(event) => event.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space
      orientation="vertical"
      size={14}
      className="full-width voice-pipeline-page"
    >
      {messageHolder}
      <Card size="small" className="test-workbench-toolbar">
        <Row gutter={[12, 12]} align="bottom">
          <Col xs={24} md={12} xl={5}>
            <Text type="secondary">测试模式</Text>
            <Segmented
              block
              value={mode}
              onChange={(value) => setMode(value as TestMode)}
              options={[
                { label: "单条测试", value: "SINGLE" },
                { label: "数据集测试", value: "DATASET" },
                { label: "真实语音", value: "AUDIO" },
              ]}
            />
          </Col>
          <Col xs={24} md={12} xl={4}>
            <Text type="secondary">测试设备</Text>
            <Select
              className="full-width"
              value={selectedDeviceId}
              onChange={setSelectedDeviceId}
              options={props.devices.map((device) => ({
                label: `${device.name} (${device.id})`,
                value: device.id,
              }))}
            />
          </Col>
          <Col xs={24} md={12} xl={5}>
            <Text type="secondary">复杂问题 LLM</Text>
            <Select
              value={selectedProviderId}
              onChange={setSelectedProviderId}
              className="full-width"
              options={props.llmProviders.map((provider) => ({
                label: `${provider.name} · ${provider.model}`,
                value: provider.id,
              }))}
            />
          </Col>
          <Col xs={24} md={12} xl={4}>
            <Text type="secondary">在线 ASR</Text>
            <Select
              allowClear
              value={selectedAsrProviderId || undefined}
              onChange={(value) => setSelectedAsrProviderId(value || "")}
              className="full-width"
              options={asrProviders.map((provider) => ({
                label: `${provider.name} · ${provider.model}`,
                value: provider.id,
              }))}
            />
          </Col>
          <Col xs={24} md={12} xl={4}>
            <Text type="secondary">云端 TTS</Text>
            <Select
              allowClear
              value={selectedTtsProviderId || undefined}
              onChange={(value) => setSelectedTtsProviderId(value || "")}
              className="full-width"
              options={ttsProviders.map((provider) => ({
                label: `${provider.name} · ${provider.model}`,
                value: provider.id,
              }))}
            />
          </Col>
          <Col xs={12} md={6} xl={1}>
            <Text type="secondary">下发</Text>
            <div>
              <Switch checked={applyToDevice} onChange={setApplyToDevice} />
            </div>
          </Col>
          <Col xs={12} md={6} xl={1}>
            <Text type="secondary">离线</Text>
            <Select
              value={simulateOffline}
              onChange={setSimulateOffline}
              className="full-width"
              options={[
                { label: "自动", value: "AUTO" },
                { label: "命中", value: "HIT" },
                { label: "未中", value: "MISS" },
              ]}
            />
          </Col>
        </Row>
      </Card>

      <div className="ai-link-workbench">
        <Card size="small" title="测试输入" className="test-control-panel">
          {mode === "SINGLE" ? (
            <SingleTestPanel
              text={text}
              running={running}
              onTextChange={setText}
              onRun={() => void runSingleText()}
            />
          ) : null}
          {mode === "DATASET" ? (
            <Space orientation="vertical" size={12} className="full-width">
              <Space.Compact block>
                <Select
                  value={activeTestSetId || undefined}
                  onChange={setActiveTestSetId}
                  placeholder="选择测试集"
                  options={props.testSets.map((testSet) => ({
                    label: `${testSet.name}（${testSet.caseCount}）`,
                    value: testSet.id,
                  }))}
                />
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => setTestSetModalOpen(true)}
                />
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => fileInputRef.current?.click()}
                />
                <Popconfirm
                  title="删除测试集"
                  description={
                    activeTestSetSummary?.isReadOnly
                      ? "标准测试集不能删除"
                      : "删除后不可恢复"
                  }
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={activeTestSetSummary?.isReadOnly}
                  onConfirm={() => void handleDeleteActiveSet()}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={activeTestSetSummary?.isReadOnly}
                  />
                </Popconfirm>
              </Space.Compact>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,text/markdown"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handlePickMarkdownFile(file);
                  }
                  event.target.value = "";
                }}
              />
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="类型">
                  {activeTestSetSummary ? (
                    <Tag color={kindColor(activeTestSetSummary.kind)}>
                      {testSetKindLabels[activeTestSetSummary.kind]}
                    </Tag>
                  ) : (
                    "-"
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="数量">
                  {testSetDetail?.caseCount ?? 0}
                </Descriptions.Item>
              </Descriptions>
              <Space wrap>
                <Select
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  style={{ width: 180 }}
                  options={[
                    { label: "全部类别", value: "ALL" },
                    ...categories.map((category) => ({
                      label: category,
                      value: category,
                    })),
                  ]}
                />
                <Button
                  icon={<PlusOutlined />}
                  disabled={activeTestSetSummary?.isReadOnly}
                  onClick={() => openCaseEditor()}
                >
                  新增语料
                </Button>
                <Button
                  type="primary"
                  icon={<ExperimentOutlined />}
                  loading={running}
                  disabled={!visibleCases.length}
                  onClick={() =>
                    void runDataset(visibleCases.map((testCase) => testCase.id))
                  }
                >
                  运行筛选
                </Button>
              </Space>
              <Table
                rowKey="id"
                size="small"
                loading={testSetLoading}
                columns={datasetColumns}
                dataSource={visibleCases}
                pagination={{ pageSize: 8, size: "small" }}
                rowClassName={(record) => {
                  const item = batchRun?.items.find(
                    (resultItem) => resultItem.testCaseId === record.id,
                  );
                  return item?.id === selectedBatchItem?.id
                    ? "row-selected"
                    : "";
                }}
                onRow={(record) => ({
                  onClick: () => {
                    const item = batchRun?.items.find(
                      (resultItem) => resultItem.testCaseId === record.id,
                    );
                    if (item) {
                      setSelectedBatchItemId(item.id);
                    } else {
                      setText(record.inputText);
                    }
                  },
                })}
              />
            </Space>
          ) : null}
          {mode === "AUDIO" ? (
            <AudioTestPanel
              running={running}
              recording={recording}
              recordedUrl={recordedUrl}
              recordedBlob={recordedBlob}
              onStart={() => void startRecording()}
              onStop={stopRecording}
              onRun={() => void runRecordedAudio()}
            />
          ) : null}
        </Card>

        <PipelineBoard
          result={activeResult}
          batchRun={batchRun}
          selectedBatchItem={selectedBatchItem}
          selectedNodeKey={selectedNodeKey}
          onSelectNode={setSelectedNodeKey}
        />
      </div>

      <Modal
        title="新建测试集"
        open={testSetModalOpen}
        confirmLoading={saving}
        okText="创建"
        cancelText="取消"
        onOk={() => void testSetForm.submit()}
        onCancel={() => setTestSetModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={testSetForm}
          layout="vertical"
          onFinish={(values) => void handleCreateTestSet(values)}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="例如：现场联调测试集" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="kind" label="类型" initialValue="CUSTOM">
            <Select options={testSetKindOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入 Markdown 测试集"
        open={importModalOpen}
        width={860}
        confirmLoading={saving}
        okText="导入"
        cancelText="取消"
        onOk={() => void importForm.submit()}
        onCancel={() => setImportModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={importForm}
          layout="vertical"
          onFinish={(values) => void handleImportMarkdown(values)}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="kind" label="类型" initialValue="CUSTOM">
            <Select options={testSetKindOptions} />
          </Form.Item>
          <Form.Item
            name="markdown"
            label="Markdown 内容"
            rules={[{ required: true, message: "请粘贴 Markdown 内容" }]}
          >
            <Input.TextArea
              rows={14}
              placeholder="支持 markdown 表格：类别 | 测试语句 | 期望意图 | 风险 | 备注"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingCase ? "编辑语料" : "新增语料"}
        open={caseModalOpen}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        onOk={() => void caseForm.submit()}
        onCancel={() => {
          setCaseModalOpen(false);
          setEditingCase(null);
        }}
        destroyOnHidden
      >
        <Form
          form={caseForm}
          layout="vertical"
          onFinish={(values) => void handleSaveCase(values)}
        >
          <Form.Item
            name="category"
            label="类别"
            rules={[{ required: true, message: "请输入类别" }]}
          >
            <Input placeholder="例如：设备控制 / 售后问答 / 普通对话" />
          </Form.Item>
          <Form.Item
            name="inputText"
            label="测试语句"
            rules={[{ required: true, message: "请输入测试语句" }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="expectedIntent" label="期望意图">
            <Select
              allowClear
              showSearch
              options={intentOptions}
              placeholder="对话或售后问答可留空"
            />
          </Form.Item>
          <Form.Item name="riskLevel" label="风险等级" initialValue="LOW">
            <Select options={riskLevelOptions} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function SingleTestPanel(props: {
  text: string;
  running: boolean;
  onTextChange: (value: string) => void;
  onRun: () => void;
}) {
  const samples = [
    "小东小东",
    "空气有点闷，开启换气",
    "我发现开启换气功能好像出了问题",
    "你的回答我很满意，再见",
    "洗澡前帮我调到 38 度，风不要太大",
  ];

  return (
    <Space orientation="vertical" size={12} className="full-width">
      <Input.TextArea
        value={props.text}
        onChange={(event) => props.onTextChange(event.target.value)}
        autoSize={{ minRows: 7, maxRows: 12 }}
        placeholder="输入用户一句话，点击测试后右侧查看完整分支链路。"
      />
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={props.running}
        onClick={props.onRun}
        block
      >
        运行单条测试
      </Button>
      <Divider className="compact-divider" />
      <Space wrap>
        {samples.map((sample) => (
          <Button
            key={sample}
            size="small"
            onClick={() => props.onTextChange(sample)}
          >
            {sample}
          </Button>
        ))}
      </Space>
    </Space>
  );
}

function AudioTestPanel(props: {
  running: boolean;
  recording: boolean;
  recordedUrl: string | null;
  recordedBlob: Blob | null;
  onStart: () => void;
  onStop: () => void;
  onRun: () => void;
}) {
  return (
    <Space orientation="vertical" size={12} className="full-width">
      <Alert
        type={props.recording ? "warning" : "info"}
        showIcon
        title={props.recording ? "正在录音" : "真实语音测试从 ASR 节点开始"}
        description="浏览器录音会上传后端 ASR，再进入在线规则、LLM、安全校验、设备下发和 TTS 播报。"
      />
      {props.recording ? (
        <Button danger icon={<StopOutlined />} onClick={props.onStop} block>
          停止录音
        </Button>
      ) : (
        <Button
          type="primary"
          icon={<AudioOutlined />}
          onClick={props.onStart}
          block
        >
          开始录音
        </Button>
      )}
      {props.recordedUrl ? (
        <audio controls src={props.recordedUrl} className="full-width" />
      ) : null}
      {props.recordedBlob ? (
        <Button
          icon={<CloudUploadOutlined />}
          loading={props.running}
          disabled={props.recording}
          onClick={props.onRun}
          block
        >
          上传录音并测试
        </Button>
      ) : null}
      <Divider className="compact-divider" />
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="设备音频入口">
          <Text code>POST /api/device/v1/voice-audio</Text>
        </Descriptions.Item>
        <Descriptions.Item label="请求字段">
          <Text type="secondary">
            deviceId、audioBase64、mimeType、asrProviderId、providerId、ttsProviderId
          </Text>
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

function PipelineBoard(props: {
  result: VoicePipelineResponse | null;
  batchRun: VoicePipelineBatchRun | null;
  selectedBatchItem: VoicePipelineBatchItem | null;
  selectedNodeKey: VisualNodeKey;
  onSelectNode: (key: VisualNodeKey) => void;
}) {
  return (
    <Space orientation="vertical" size={12} className="pipeline-board">
      <ResultSummary
        result={props.result}
        selectedBatchItem={props.selectedBatchItem}
      />
      {props.batchRun ? <BatchSummary run={props.batchRun} /> : null}
      <Card size="small" title="分支流程">
        <BranchFlow
          result={props.result}
          selectedNodeKey={props.selectedNodeKey}
          onSelectNode={props.onSelectNode}
        />
      </Card>
      <NodeDetail
        result={props.result}
        selectedNodeKey={props.selectedNodeKey}
      />
    </Space>
  );
}

function ResultSummary(props: {
  result: VoicePipelineResponse | null;
  selectedBatchItem: VoicePipelineBatchItem | null;
}) {
  if (!props.result) {
    return (
      <Card size="small" title="本次结果">
        <Alert
          type="info"
          showIcon
          title="运行单条、数据集或真实语音测试后，这里显示链路结果。"
        />
      </Card>
    );
  }

  const { result } = props;
  return (
    <Card size="small" title="本次结果">
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Statistic title="线路" value={routeLabel(result.route)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title="耗时" value={result.totalLatencyMs} suffix="ms" />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="成本"
            value={result.cost.totalCny}
            precision={6}
            prefix="￥"
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title="Token" value={result.cost.totalTokens} />
        </Col>
      </Row>
      <Divider className="compact-divider" />
      <Descriptions size="small" column={{ xs: 1, xl: 2 }}>
        <Descriptions.Item label="输入文本">
          {result.transcript || "未获得文本"}
        </Descriptions.Item>
        <Descriptions.Item label="最终回复">
          {result.replyText || "无播报文本"}
        </Descriptions.Item>
        <Descriptions.Item label="识别结果">
          {result.aiResult.intent || result.aiResult.resultType}
          {props.selectedBatchItem ? (
            <Tag
              color={props.selectedBatchItem.isMatch ? "green" : "red"}
              style={{ marginLeft: 8 }}
            >
              {props.selectedBatchItem.isMatch ? "通过" : "未通过"}
            </Tag>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label="安全结果">
          {result.safetyResult.decision}
        </Descriptions.Item>
      </Descriptions>
      <Descriptions size="small" column={{ xs: 1, md: 4 }}>
        <Descriptions.Item label="ASR">
          ￥{result.cost.asrCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="LLM">
          ￥{result.cost.llmCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="TTS">
          ￥{result.cost.ttsCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="费用口径">
          {result.cost.isEstimated ? "估算" : "供应商返回"}
        </Descriptions.Item>
      </Descriptions>
      {result.ttsAudioBase64 && result.ttsAudioMimeType ? (
        <>
          <Divider className="compact-divider" />
          <audio
            controls
            className="full-width"
            src={`data:${result.ttsAudioMimeType};base64,${result.ttsAudioBase64}`}
          />
        </>
      ) : null}
    </Card>
  );
}

function BatchSummary(props: { run: VoicePipelineBatchRun }) {
  const { summary } = props.run;
  const routeRows = Object.entries(summary.routeBreakdown);

  return (
    <Card size="small" title="数据集分析">
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Statistic
            title="通过率"
            value={summary.passRate * 100}
            precision={1}
            suffix="%"
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="通过/总数"
            value={`${summary.passed}/${summary.total}`}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="平均耗时"
            value={summary.averageLatencyMs}
            suffix="ms"
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="总成本"
            value={summary.totalCostCny}
            precision={6}
            prefix="￥"
          />
        </Col>
      </Row>
      <Divider className="compact-divider" />
      <div className="batch-route-grid">
        {routeRows.map(([route, count]) => (
          <div key={route} className="batch-route-row">
            <div className="batch-route-head">
              <Text>{routeLabel(route as VoicePipelineResponse["route"])}</Text>
              <Text type="secondary">{count} 条</Text>
            </div>
            <Progress
              percent={
                summary.total ? Math.round((count / summary.total) * 100) : 0
              }
              size="small"
              showInfo={false}
            />
          </div>
        ))}
      </div>
      <Divider className="compact-divider" />
      <Descriptions size="small" column={{ xs: 1, md: 4 }}>
        <Descriptions.Item label="ASR 成本">
          ￥{summary.asrCostCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="LLM 成本">
          ￥{summary.llmCostCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="TTS 成本">
          ￥{summary.ttsCostCny.toFixed(6)}
        </Descriptions.Item>
        <Descriptions.Item label="LLM 调用率">
          {formatPercent(summary.llmCallRate)}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function BranchFlow(props: {
  result: VoicePipelineResponse | null;
  selectedNodeKey: VisualNodeKey;
  onSelectNode: (key: VisualNodeKey) => void;
}) {
  const nodes = buildVisualNodes(props.result);

  return (
    <div className="branch-flow-wrap">
      <div className="branch-flow-canvas">
        {nodes.map((node) => (
          <button
            key={node.key}
            type="button"
            className={`branch-node branch-node-${statusClass(node.status)}${
              props.selectedNodeKey === node.key ? " branch-node-selected" : ""
            }`}
            style={{ gridArea: node.gridArea }}
            onClick={() => props.onSelectNode(node.key)}
          >
            <span className="branch-node-title">{node.title}</span>
            <span className="branch-node-desc">{node.description}</span>
            {node.branchLabel ? (
              <span className="branch-node-branch">{node.branchLabel}</span>
            ) : null}
            <Tag color={statusColor(node.status)}>
              {statusLabel(node.status)}
            </Tag>
            <span className="branch-node-result">
              {node.result || "等待执行"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeDetail(props: {
  result: VoicePipelineResponse | null;
  selectedNodeKey: VisualNodeKey;
}) {
  const node = buildVisualNodes(props.result).find(
    (item) => item.key === props.selectedNodeKey,
  );

  return (
    <Card size="small" title="节点输出">
      {!node ? (
        <Alert type="info" showIcon title="请选择流程图中的节点。" />
      ) : (
        <Space orientation="vertical" size={10} className="full-width">
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="节点">{node.title}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor(node.status)}>
                {statusLabel(node.status)}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="来源">
              {node.stage?.source || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="耗时">
              {node.stage ? `${node.stage.latencyMs} ms` : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="费用">
              {node.stage ? `￥${node.stage.costCny.toFixed(6)}` : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="结果">
              {node.result || "-"}
            </Descriptions.Item>
          </Descriptions>
          {node.stage?.error ? (
            <Alert type="error" showIcon title={node.stage.error} />
          ) : null}
          <pre className="json-panel">{stringifyPretty(node.detail)}</pre>
        </Space>
      )}
    </Card>
  );
}

function buildVisualNodes(result: VoicePipelineResponse | null): VisualNode[] {
  const stageMap = new Map<VoicePipelineStageKey, VoicePipelineStage>();
  for (const stage of result?.stages ?? []) {
    stageMap.set(stage.key, stage);
  }
  const stage = (key: VoicePipelineStageKey) => stageMap.get(key);
  const idle = (
    key: VisualNodeKey,
  ): Pick<VisualNode, "status" | "result" | "detail"> => ({
    status: "IDLE",
    result: "",
    detail: { node: key },
  });
  const fromStage = (
    key: VoicePipelineStageKey,
  ): Pick<VisualNode, "status" | "stage" | "result" | "detail"> => {
    const found = stage(key);
    if (!found) {
      return idle(key);
    }
    return {
      status: found.status,
      stage: found,
      result: found.result || found.error || "",
      detail: found.detail,
    };
  };
  const route = result?.route;
  const ruleStage = stage("ONLINE_RULE");
  const llmStage = stage(route === "KNOWLEDGE" ? "KNOWLEDGE" : "LLM");

  return [
    {
      key: "INPUT",
      title: "用户一句话",
      description: "文本模拟或语音输入",
      gridArea: "input",
      ...fromStage("INPUT"),
    },
    {
      key: "OFFLINE_INTENT",
      title: "是否离线固定命令",
      description: "唤醒词、固定指令、固定回复",
      branchLabel: route === "OFFLINE" ? "命中离线" : "未命中进入在线",
      gridArea: "offline",
      ...fromStage("OFFLINE_INTENT"),
    },
    {
      key: "OFFLINE_DEVICE",
      title: "离线直接控制 MCU",
      description: "离线模块完成控制或回复",
      branchLabel: "离线路径",
      status: result ? (route === "OFFLINE" ? "MATCHED" : "SKIPPED") : "IDLE",
      stage: route === "OFFLINE" ? stage("DEVICE") : undefined,
      result: route === "OFFLINE" ? "离线模块处理完成" : "未走离线路径",
      detail: {
        route,
        deviceStage: route === "OFFLINE" ? (stage("DEVICE") ?? null) : null,
      },
      gridArea: "offlineDevice",
    },
    {
      key: "ASR",
      title: "在线识别文本",
      description: "语音转文字，文本测试跳过",
      branchLabel: "在线路径",
      gridArea: "asr",
      ...fromStage("ASR"),
    },
    {
      key: "ONLINE_RULE",
      title: "是否简单规则匹配",
      description: "低成本规则判断",
      branchLabel: route === "ONLINE_RULE" ? "命中规则" : "未命中复杂处理",
      gridArea: "rule",
      ...fromStage("ONLINE_RULE"),
    },
    {
      key: "RULE_CLASSIFY",
      title: "判断指令还是对话",
      description: "规则输出结构化结果",
      branchLabel: "规则路径",
      status: result
        ? route === "ONLINE_RULE"
          ? "MATCHED"
          : "SKIPPED"
        : "IDLE",
      stage: route === "ONLINE_RULE" ? ruleStage : undefined,
      result:
        route === "ONLINE_RULE"
          ? `${result?.aiResult.resultType || "-"} / ${result?.aiResult.intent || "无设备意图"}`
          : "未走规则输出",
      detail: {
        route,
        aiResult: route === "ONLINE_RULE" ? (result?.aiResult ?? null) : null,
      },
      gridArea: "ruleClassify",
    },
    {
      key: "LLM",
      title: route === "KNOWLEDGE" ? "企业知识库" : "调用 LLM",
      description:
        route === "KNOWLEDGE" ? "售后资料检索回复" : "复杂问题进入大模型",
      branchLabel:
        route === "LLM" || route === "KNOWLEDGE" ? "复杂路径" : "未调用",
      stage: llmStage,
      status: result ? (llmStage?.status ?? "SKIPPED") : "IDLE",
      result: llmStage?.result || (result ? "本次未调用" : ""),
      detail: llmStage?.detail ?? { route },
      gridArea: "llm",
    },
    {
      key: "LLM_CLASSIFY",
      title: "判断指令 / 问答 / 对话",
      description: "统一输出结构化结果",
      branchLabel: "复杂路径",
      status: result
        ? route === "LLM" || route === "KNOWLEDGE"
          ? "COMPLETED"
          : "SKIPPED"
        : "IDLE",
      stage: route === "LLM" || route === "KNOWLEDGE" ? llmStage : undefined,
      result:
        route === "LLM" || route === "KNOWLEDGE"
          ? `${result?.aiResult.resultType || "-"} / ${result?.aiResult.intent || "无设备意图"}`
          : "未走复杂输出",
      detail: {
        route,
        aiResult:
          route === "LLM" || route === "KNOWLEDGE"
            ? (result?.aiResult ?? null)
            : null,
      },
      gridArea: "llmClassify",
    },
    {
      key: "SAFETY",
      title: "安全规则校验",
      description: "所有控制意图必须经过校验",
      gridArea: "safety",
      ...fromStage("SAFETY"),
    },
    {
      key: "DEVICE",
      title: "下发控制",
      description: "下发 MCU 或仅预览命令",
      gridArea: "device",
      ...fromStage("DEVICE"),
    },
    {
      key: "TTS",
      title: "返回播报",
      description: "云端 TTS 或离线固定音频",
      gridArea: "tts",
      ...fromStage("TTS"),
    },
  ];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function statusClass(status: VisualNode["status"]): string {
  return status.toLowerCase().replace(/_/g, "-");
}

function statusLabel(status: VisualNode["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "完成";
    case "MATCHED":
      return "命中";
    case "SKIPPED":
      return "跳过";
    case "NOT_CONFIGURED":
      return "未配置";
    case "FAILED":
      return "失败";
    case "IDLE":
    default:
      return "待执行";
  }
}

function statusColor(status: VisualNode["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "green";
    case "MATCHED":
      return "blue";
    case "FAILED":
      return "red";
    case "NOT_CONFIGURED":
      return "orange";
    case "SKIPPED":
      return "default";
    case "IDLE":
    default:
      return "default";
  }
}

function routeLabel(route: VoicePipelineResponse["route"]): string;
function routeLabel(route: string): string;
function routeLabel(route: string): string {
  switch (route) {
    case "OFFLINE":
      return "离线";
    case "ONLINE_RULE":
      return "在线规则";
    case "KNOWLEDGE":
      return "知识库";
    case "LLM":
      return "LLM";
    case "UNRESOLVED":
      return "未完成";
    default:
      return route || "-";
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function kindColor(kind: TestSetKind): string {
  switch (kind) {
    case "STANDARD":
      return "blue";
    case "SIMPLE":
      return "green";
    case "COMPLEX":
      return "orange";
    case "CUSTOM":
    default:
      return "default";
  }
}

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
