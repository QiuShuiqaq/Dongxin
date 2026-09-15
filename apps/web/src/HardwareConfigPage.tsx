import {
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { DEVICE_INTENTS } from "@dongxin/shared";
import type {
  BleControllerType,
  BleLocalControlSimulationResponse,
  Ci1302EventSimulationResponse,
  Ci1302EventType,
  DeviceIntent,
  OfflineVoiceCommand,
  ProductCapabilitySupport,
  ProductProfile,
  VoiceProfile,
  VoiceProfileStatus,
} from "@dongxin/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import {
  cloneVoiceProfile,
  simulateBleLocalControl,
  simulateCi1302Event,
  transitionVoiceProfile,
  updateProductProfile,
  updateVoiceProfile,
} from "./api";

const { Text } = Typography;

const SUPPORT_LABELS: Record<ProductCapabilitySupport, string> = {
  ENABLED: "已启用",
  OPTIONAL: "可选待确认",
  NOT_SUPPORTED: "不支持",
};

const STATUS_LABELS: Record<VoiceProfileStatus, string> = {
  DRAFT: "草稿",
  RESOURCE_GENERATING: "资源生成",
  SAMPLE_VALIDATION: "样机验证",
  APPROVED: "已审核",
  RELEASED: "已发布",
  ROLLED_BACK: "已回滚",
};

const STATUS_STEPS: VoiceProfileStatus[] = [
  "DRAFT",
  "RESOURCE_GENERATING",
  "SAMPLE_VALIDATION",
  "APPROVED",
  "RELEASED",
];

const NEXT_STATUS: Partial<Record<VoiceProfileStatus, VoiceProfileStatus>> = {
  DRAFT: "RESOURCE_GENERATING",
  RESOURCE_GENERATING: "SAMPLE_VALIDATION",
  SAMPLE_VALIDATION: "APPROVED",
  APPROVED: "RELEASED",
  RELEASED: "ROLLED_BACK",
  ROLLED_BACK: "DRAFT",
};

const PREVIOUS_STATUS: Partial<Record<VoiceProfileStatus, VoiceProfileStatus>> =
  {
    RESOURCE_GENERATING: "DRAFT",
    SAMPLE_VALIDATION: "DRAFT",
    APPROVED: "SAMPLE_VALIDATION",
  };

const CI_EVENT_OPTIONS: Array<{ label: string; value: Ci1302EventType }> = [
  { label: "启动完成", value: "BOOT" },
  { label: "唤醒", value: "WAKE" },
  { label: "开始说话", value: "VAD_START" },
  { label: "说话结束", value: "VAD_END" },
  { label: "离线命令命中", value: "OFFLINE_COMMAND" },
  { label: "离线命令未命中", value: "OFFLINE_MISS" },
  { label: "I²S PCM就绪", value: "PCM_READY" },
  { label: "播放完成", value: "PLAYBACK_FINISHED" },
  { label: "模块故障", value: "FAULT" },
];

export function HardwareConfigPage(props: {
  productProfiles: ProductProfile[];
  voiceProfiles: VoiceProfile[];
  selectedDeviceId: string;
  onRefresh: () => Promise<void>;
}) {
  const [apiMessage, messageHolder] = message.useMessage();
  const [selectedProductId, setSelectedProductId] = useState(
    props.productProfiles[0]?.id ?? "",
  );
  const [productDraft, setProductDraft] = useState<ProductProfile | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState(
    props.voiceProfiles[0]?.id ?? "",
  );
  const [voiceDraft, setVoiceDraft] = useState<VoiceProfile | null>(null);
  const [resourceFileName, setResourceFileName] = useState("");
  const [resourceSha256, setResourceSha256] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneVersion, setCloneVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [eventType, setEventType] =
    useState<Ci1302EventType>("OFFLINE_COMMAND");
  const [semanticId, setSemanticId] = useState<number | null>(1001);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [applyToDevice, setApplyToDevice] = useState(true);
  const [eventResult, setEventResult] =
    useState<Ci1302EventSimulationResponse | null>(null);
  const [bleControllerType, setBleControllerType] =
    useState<BleControllerType>("WALL_PANEL");
  const [bleControllerId, setBleControllerId] = useState("wall-panel-001");
  const [bleSequence, setBleSequence] = useState(1);
  const [bleBonded, setBleBonded] = useState(true);
  const [bleEncrypted, setBleEncrypted] = useState(true);
  const [bleIntent, setBleIntent] = useState<DeviceIntent>("LIGHT_ON");
  const [bleSlots, setBleSlots] = useState("{}");
  const [bleApplyToDevice, setBleApplyToDevice] = useState(true);
  const [bleResult, setBleResult] =
    useState<BleLocalControlSimulationResponse | null>(null);

  const sourceProduct = useMemo(
    () =>
      props.productProfiles.find(
        (profile) => profile.id === selectedProductId,
      ) ?? props.productProfiles[0],
    [props.productProfiles, selectedProductId],
  );
  const productVoiceProfiles = useMemo(
    () =>
      props.voiceProfiles.filter(
        (profile) => profile.productProfileId === sourceProduct?.id,
      ),
    [props.voiceProfiles, sourceProduct?.id],
  );
  const sourceVoice = useMemo(
    () =>
      productVoiceProfiles.find((profile) => profile.id === selectedVoiceId) ??
      productVoiceProfiles[0],
    [productVoiceProfiles, selectedVoiceId],
  );

  useEffect(() => {
    if (sourceProduct) {
      setProductDraft(structuredClone(sourceProduct));
    }
  }, [sourceProduct]);

  useEffect(() => {
    if (!sourceVoice) {
      setVoiceDraft(null);
      return;
    }
    setSelectedVoiceId(sourceVoice.id);
    setVoiceDraft(structuredClone(sourceVoice));
    setResourceFileName(sourceVoice.resource?.fileName ?? "");
    setResourceSha256(sourceVoice.resource?.sha256 ?? "");
  }, [sourceVoice]);

  const productColumns: ColumnsType<ProductProfile["capabilities"][number]> = [
    { title: "能力", dataIndex: "label", width: 150 },
    {
      title: "状态",
      dataIndex: "support",
      width: 150,
      render: (value: ProductCapabilitySupport, row) => (
        <Select
          value={value}
          style={{ width: 130 }}
          options={Object.entries(SUPPORT_LABELS).map(([key, label]) => ({
            value: key,
            label,
          }))}
          onChange={(support: ProductCapabilitySupport) =>
            patchCapability(row.key, { support })
          }
        />
      ),
    },
    {
      title: "接口",
      dataIndex: "interface",
      width: 220,
      render: (value: string, row) => (
        <Input
          value={value}
          onChange={(event) =>
            patchCapability(row.key, { interface: event.target.value })
          }
        />
      ),
    },
    {
      title: "约束/备注",
      dataIndex: "notes",
      render: (value: string, row) => (
        <Input
          value={value}
          onChange={(event) =>
            patchCapability(row.key, { notes: event.target.value })
          }
        />
      ),
    },
  ];

  const voiceColumns: ColumnsType<OfflineVoiceCommand> = [
    {
      title: "启用",
      dataIndex: "enabled",
      width: 70,
      fixed: "left",
      render: (value: boolean, row) => (
        <Switch
          size="small"
          checked={value}
          disabled={!isVoiceContentEditable(voiceDraft)}
          onChange={(enabled) => patchCommand(row.id, { enabled })}
        />
      ),
    },
    {
      title: "语义 ID",
      dataIndex: "semanticId",
      width: 110,
      render: (value: number, row) => (
        <InputNumber
          min={1}
          max={65535}
          value={value}
          disabled={!isVoiceContentEditable(voiceDraft)}
          onChange={(next) =>
            patchCommand(row.id, { semanticId: Number(next ?? value) })
          }
        />
      ),
    },
    {
      title: "标准说法",
      dataIndex: "phrase",
      width: 180,
      render: (value: string, row) => (
        <Input
          value={value}
          disabled={!isVoiceContentEditable(voiceDraft)}
          onChange={(event) =>
            patchCommand(row.id, { phrase: event.target.value })
          }
        />
      ),
    },
    {
      title: "同义说法",
      dataIndex: "aliases",
      width: 240,
      render: (value: string[], row) => (
        <Input
          value={value.join("、")}
          disabled={!isVoiceContentEditable(voiceDraft)}
          onChange={(event) =>
            patchCommand(row.id, {
              aliases: event.target.value
                .split(/[、,，]/)
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      ),
    },
    {
      title: "设备意图",
      dataIndex: "intent",
      width: 210,
      render: (value: DeviceIntent, row) => (
        <Select
          showSearch
          value={value}
          disabled={!isVoiceContentEditable(voiceDraft)}
          style={{ width: 190 }}
          options={DEVICE_INTENTS.map((intent) => ({
            value: intent,
            label: intent,
          }))}
          onChange={(intent: DeviceIntent) => patchCommand(row.id, { intent })}
        />
      ),
    },
    {
      title: "参数 JSON",
      dataIndex: "slots",
      width: 190,
      render: (value: Record<string, unknown>, row) => (
        <Input
          defaultValue={JSON.stringify(value)}
          disabled={!isVoiceContentEditable(voiceDraft)}
          onBlur={(event) => patchCommandSlots(row.id, event.target.value)}
        />
      ),
    },
    {
      title: "反馈",
      dataIndex: "feedbackTone",
      width: 120,
      render: (value: OfflineVoiceCommand["feedbackTone"], row) => (
        <Select
          value={value}
          disabled={!isVoiceContentEditable(voiceDraft)}
          style={{ width: 100 }}
          options={[
            { value: "CONFIRM", label: "确认音" },
            { value: "REJECT", label: "拒绝音" },
            { value: "NONE", label: "无" },
          ]}
          onChange={(feedbackTone) => patchCommand(row.id, { feedbackTone })}
        />
      ),
    },
    {
      title: "操作",
      width: 70,
      fixed: "right",
      render: (_, row) => (
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          title="删除命令"
          disabled={!isVoiceContentEditable(voiceDraft)}
          onClick={() =>
            setVoiceDraft((current) =>
              current
                ? {
                    ...current,
                    commands: current.commands.filter(
                      (item) => item.id !== row.id,
                    ),
                  }
                : current,
            )
          }
        />
      ),
    },
  ];

  function patchCapability(
    key: ProductProfile["capabilities"][number]["key"],
    patch: Partial<ProductProfile["capabilities"][number]>,
  ) {
    setProductDraft((current) =>
      current
        ? {
            ...current,
            capabilities: current.capabilities.map((item) =>
              item.key === key ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  function patchSafety(patch: Partial<ProductProfile["safetyDefaults"]>) {
    setProductDraft((current) =>
      current
        ? {
            ...current,
            safetyDefaults: { ...current.safetyDefaults, ...patch },
          }
        : current,
    );
  }

  function patchCommand(id: string, patch: Partial<OfflineVoiceCommand>) {
    setVoiceDraft((current) =>
      current
        ? {
            ...current,
            commands: current.commands.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  function patchCommandSlots(id: string, raw: string) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("参数必须是 JSON 对象");
      }
      patchCommand(id, { slots: parsed as Record<string, unknown> });
    } catch (error) {
      apiMessage.error(
        error instanceof Error ? error.message : "参数 JSON 无效",
      );
    }
  }

  async function saveProduct() {
    if (!productDraft) return;
    setBusy(true);
    try {
      await updateProductProfile(productDraft);
      await props.onRefresh();
      apiMessage.success("产品硬件配置已保存");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveVoice() {
    const payload = buildVoicePayload();
    if (!payload) return;
    setBusy(true);
    try {
      await updateVoiceProfile(payload);
      await props.onRefresh();
      apiMessage.success("语音配置已保存");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function moveVoiceStatus(nextStatus: VoiceProfileStatus) {
    if (!voiceDraft) return;
    setBusy(true);
    try {
      if (isVoiceEditable(voiceDraft)) {
        const payload = buildVoicePayload();
        if (!payload) return;
        await updateVoiceProfile(payload);
      }
      await transitionVoiceProfile(voiceDraft.id, nextStatus);
      await props.onRefresh();
      apiMessage.success(`版本状态已更新为${STATUS_LABELS[nextStatus]}`);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function buildVoicePayload(): VoiceProfile | null {
    if (!voiceDraft) return null;
    const hasResourceInput = Boolean(
      resourceFileName.trim() || resourceSha256.trim(),
    );
    if (
      hasResourceInput &&
      (!resourceFileName.trim() ||
        !/^[a-fA-F0-9]{64}$/.test(resourceSha256.trim()))
    ) {
      apiMessage.error("资源包需要文件名和 64 位 SHA-256");
      return null;
    }
    return {
      ...voiceDraft,
      resource: hasResourceInput
        ? {
            fileName: resourceFileName.trim(),
            sha256: resourceSha256.trim().toLowerCase(),
            generatedAt:
              voiceDraft.resource?.generatedAt ?? new Date().toISOString(),
          }
        : null,
    };
  }

  async function createClone() {
    if (!voiceDraft || !cloneVersion.trim()) return;
    setBusy(true);
    try {
      const cloned = await cloneVoiceProfile(
        voiceDraft.id,
        cloneVersion.trim(),
      );
      setCloneOpen(false);
      setCloneVersion("");
      await props.onRefresh();
      setSelectedVoiceId(cloned.id);
      apiMessage.success("已创建新草稿");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runCiEvent() {
    if (!productDraft || !voiceDraft) return;
    setBusy(true);
    try {
      const result = await simulateCi1302Event({
        deviceId: props.selectedDeviceId,
        productProfileId: productDraft.id,
        voiceProfileId: voiceDraft.id,
        eventType,
        semanticId: eventType === "OFFLINE_COMMAND" ? semanticId : null,
        networkOnline,
        applyToDevice,
      });
      setEventResult(result);
      await props.onRefresh();
      apiMessage.success("CI1302 事件已处理");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runBleCommand() {
    if (!productDraft) return;
    let slots: Record<string, unknown>;
    try {
      const parsed = JSON.parse(bleSlots) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("参数必须是 JSON 对象");
      }
      slots = parsed as Record<string, unknown>;
    } catch (error) {
      apiMessage.error(
        error instanceof Error ? error.message : "参数 JSON 无效",
      );
      return;
    }

    setBusy(true);
    try {
      const result = await simulateBleLocalControl({
        deviceId: props.selectedDeviceId,
        productProfileId: productDraft.id,
        controllerType: bleControllerType,
        controllerId: bleControllerId.trim(),
        sequence: bleSequence,
        bonded: bleBonded,
        encrypted: bleEncrypted,
        intent: bleIntent,
        slots,
        applyToDevice: bleApplyToDevice,
      });
      setBleResult(result);
      await props.onRefresh();
      apiMessage.success("BLE 本地命令已处理");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function addCommand() {
    if (!voiceDraft) return;
    const maxSemanticId = voiceDraft.commands.reduce(
      (max, command) => Math.max(max, command.semanticId),
      1000,
    );
    setVoiceDraft({
      ...voiceDraft,
      commands: [
        ...voiceDraft.commands,
        {
          id: crypto.randomUUID(),
          semanticId: Math.min(65535, maxSemanticId + 1),
          phrase: "新命令",
          aliases: [],
          intent: "LIGHT_ON",
          slots: {},
          feedbackTone: "CONFIRM",
          enabled: false,
        },
      ],
    });
  }

  if (!productDraft) {
    return <Alert type="warning" message="尚未配置产品型号" showIcon />;
  }

  const enabledCount = productDraft.capabilities.filter(
    (capability) => capability.support === "ENABLED",
  ).length;
  const currentStep = Math.max(
    0,
    STATUS_STEPS.indexOf(voiceDraft?.status ?? "DRAFT"),
  );

  return (
    <Space
      orientation="vertical"
      size={16}
      className="full-width hardware-config-page"
    >
      {messageHolder}
      <div className="context-bar">
        <div className="context-field">
          <Text type="secondary">产品型号</Text>
          <Select
            value={productDraft.id}
            options={props.productProfiles.map((profile) => ({
              value: profile.id,
              label: `${profile.name} (${profile.model})`,
            }))}
            onChange={setSelectedProductId}
          />
        </div>
        <div className="context-field">
          <Text type="secondary">语音版本</Text>
          <Select
            value={voiceDraft?.id}
            options={productVoiceProfiles.map((profile) => ({
              value: profile.id,
              label: `${profile.version} / ${STATUS_LABELS[profile.status]}`,
            }))}
            onChange={setSelectedVoiceId}
          />
        </div>
        <div className="context-status">
          <Tag color="blue">{productDraft.controller.replace("_", "-")}</Tag>
          <Tag color="cyan">{productDraft.voiceProcessor}</Tag>
        </div>
        <div className="context-status">
          <Tag color={productDraft.otaReserved ? "green" : "red"}>
            OTA {productDraft.otaReserved ? "已预留" : "未预留"}
          </Tag>
        </div>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="已启用能力"
              value={enabledCount}
              suffix={`/ ${productDraft.capabilities.length}`}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Flash"
              value={productDraft.flashSizeMB}
              suffix="MB"
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="离线命令"
              value={
                voiceDraft?.commands.filter((item) => item.enabled).length ?? 0
              }
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="唤醒词" value={voiceDraft?.wakeWord ?? "-"} />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: "product",
            label: "产品硬件能力",
            children: (
              <Space orientation="vertical" size={12} className="full-width">
                <Card
                  size="small"
                  title="主控与安全基线"
                  extra={
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      loading={busy}
                      onClick={() => void saveProduct()}
                    >
                      保存
                    </Button>
                  }
                >
                  <Row gutter={[16, 12]}>
                    <Col xs={24} lg={12}>
                      <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="主控">
                          {productDraft.controller}
                        </Descriptions.Item>
                        <Descriptions.Item label="语音芯片">
                          {productDraft.voiceProcessor}
                        </Descriptions.Item>
                        <Descriptions.Item label="IO 扩展器">
                          <Input
                            value={productDraft.ioExpander}
                            onChange={(event) =>
                              setProductDraft({
                                ...productDraft,
                                ioExpander: event.target.value,
                              })
                            }
                          />
                        </Descriptions.Item>
                        <Descriptions.Item label="遥控">
                          {productDraft.remoteTechnology}
                        </Descriptions.Item>
                        <Descriptions.Item label="上电全关">
                          <Switch
                            checked={
                              productDraft.safetyDefaults.powerOnAllLoadsOff
                            }
                            onChange={(value) =>
                              patchSafety({ powerOnAllLoadsOff: value })
                            }
                          />
                        </Descriptions.Item>
                        <Descriptions.Item label="取暖需风机">
                          <Switch
                            checked={
                              productDraft.safetyDefaults.heatRequiresFan
                            }
                            onChange={(value) =>
                              patchSafety({ heatRequiresFan: value })
                            }
                          />
                        </Descriptions.Item>
                        <Descriptions.Item label="硬件温断">
                          <Switch
                            checked={
                              productDraft.safetyDefaults
                                .hardwareThermalCutoffRequired
                            }
                            onChange={(value) =>
                              patchSafety({
                                hardwareThermalCutoffRequired: value,
                              })
                            }
                          />
                        </Descriptions.Item>
                        <Descriptions.Item label="语音半双工">
                          <Switch
                            checked={
                              productDraft.safetyDefaults.halfDuplexVoice
                            }
                            onChange={(value) =>
                              patchSafety({ halfDuplexVoice: value })
                            }
                          />
                        </Descriptions.Item>
                      </Descriptions>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical" className="hardware-safety-form">
                        <Row gutter={12}>
                          <Col span={8}>
                            <Form.Item label="最低目标温度">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults
                                    .targetTemperatureMinCelsius
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    targetTemperatureMinCelsius: Number(value),
                                  })
                                }
                                addonAfter="℃"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="默认目标温度">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults
                                    .targetTemperatureDefaultCelsius
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    targetTemperatureDefaultCelsius:
                                      Number(value),
                                  })
                                }
                                addonAfter="℃"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="最高目标温度">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults
                                    .targetTemperatureMaxCelsius
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    targetTemperatureMaxCelsius: Number(value),
                                  })
                                }
                                addonAfter="℃"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="散热延时">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults.fanCooldownSeconds
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    fanCooldownSeconds: Number(value),
                                  })
                                }
                                addonAfter="秒"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="取暖最长运行">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults
                                    .heaterMaxContinuousMinutes
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    heaterMaxContinuousMinutes: Number(value),
                                  })
                                }
                                addonAfter="分"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="干燥最长运行">
                              <InputNumber
                                value={
                                  productDraft.safetyDefaults.dryModeMaxMinutes
                                }
                                onChange={(value) =>
                                  patchSafety({
                                    dryModeMaxMinutes: Number(value),
                                  })
                                }
                                addonAfter="分"
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
                    </Col>
                    <Col xs={24}>
                      <Descriptions
                        size="small"
                        column={{ xs: 1, md: 2, xl: 4 }}
                        bordered
                      >
                        <Descriptions.Item label="I2C 扩展">
                          {productDraft.ioExpansion.deviceCount} ×{" "}
                          {productDraft.ioExpansion.type} /{" "}
                          {productDraft.ioExpansion.portCount} 路
                        </Descriptions.Item>
                        <Descriptions.Item label="I2C 地址">
                          {productDraft.ioExpansion.addresses
                            .map(
                              (address) =>
                                `0x${address.toString(16).padStart(2, "0")}`,
                            )
                            .join(" / ")}
                        </Descriptions.Item>
                        <Descriptions.Item label="输出保护">
                          低有效 / 独立负载总使能
                        </Descriptions.Item>
                        <Descriptions.Item label="总线速率">
                          {productDraft.ioExpansion.frequencyHz / 1000} kHz
                        </Descriptions.Item>
                        <Descriptions.Item label="CI 控制链路">
                          {productDraft.voiceHardwareLink.controlTransport} /{" "}
                          {productDraft.voiceHardwareLink.controlBaudRate} bps
                        </Descriptions.Item>
                        <Descriptions.Item label="CI 音频链路">
                          I²S / {productDraft.voiceHardwareLink.audioSampleRateHz}
                          Hz / {productDraft.voiceHardwareLink.audioBitsPerSample}
                          bit / 单声道
                        </Descriptions.Item>
                        <Descriptions.Item label="本地控制终端">
                          {productDraft.localControllers.wallPanelCount} 个墙面板 +{" "}
                          {productDraft.localControllers.handheldRemoteCount} 个遥控器
                        </Descriptions.Item>
                        <Descriptions.Item label="BLE 绑定上限">
                          {productDraft.localControllers.maximumBondedControllers} 个，
                          加密配对并要求命令回执
                        </Descriptions.Item>
                      </Descriptions>
                    </Col>
                  </Row>
                </Card>
                <Card size="small" title="能力矩阵">
                  <Table
                    rowKey="key"
                    size="small"
                    pagination={false}
                    columns={productColumns}
                    dataSource={productDraft.capabilities}
                    scroll={{ x: 900, y: 520 }}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: "voice",
            label: "CI1302 语音版本",
            children: voiceDraft ? (
              <Space orientation="vertical" size={12} className="full-width">
                <Card
                  size="small"
                  title={
                    <Space>
                      <span>版本 {voiceDraft.version}</span>
                      <Tag>{STATUS_LABELS[voiceDraft.status]}</Tag>
                    </Space>
                  }
                  extra={
                    <Space>
                      {voiceDraft.status !== "DRAFT" && (
                        <Button
                          icon={<CopyOutlined />}
                          onClick={() => setCloneOpen(true)}
                        >
                          复制草稿
                        </Button>
                      )}
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        disabled={!isVoiceEditable(voiceDraft)}
                        loading={busy}
                        onClick={() => void saveVoice()}
                      >
                        保存
                      </Button>
                    </Space>
                  }
                >
                  <Steps
                    size="small"
                    current={currentStep}
                    status={
                      voiceDraft.status === "ROLLED_BACK" ? "error" : "process"
                    }
                    items={STATUS_STEPS.map((status) => ({
                      title: STATUS_LABELS[status],
                    }))}
                  />
                  <div className="voice-version-actions">
                    <Space wrap>
                      {PREVIOUS_STATUS[voiceDraft.status] && (
                        <Button
                          onClick={() =>
                            void moveVoiceStatus(
                              PREVIOUS_STATUS[voiceDraft.status]!,
                            )
                          }
                        >
                          退回
                          {STATUS_LABELS[PREVIOUS_STATUS[voiceDraft.status]!]}
                        </Button>
                      )}
                      {NEXT_STATUS[voiceDraft.status] && (
                        <Button
                          type="primary"
                          icon={<ArrowRightOutlined />}
                          loading={busy}
                          onClick={() =>
                            void moveVoiceStatus(
                              NEXT_STATUS[voiceDraft.status]!,
                            )
                          }
                        >
                          {STATUS_LABELS[NEXT_STATUS[voiceDraft.status]!]}
                        </Button>
                      )}
                    </Space>
                  </div>
                  <Row gutter={12}>
                    <Col xs={24} md={8}>
                      <Form.Item label="唤醒词">
                        <Input
                          value={voiceDraft.wakeWord}
                          disabled={!isVoiceContentEditable(voiceDraft)}
                          onChange={(event) =>
                            setVoiceDraft({
                              ...voiceDraft,
                              wakeWord: event.target.value,
                            })
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="资源包文件">
                        <Input
                          value={resourceFileName}
                          disabled={!isVoiceEditable(voiceDraft)}
                          placeholder="等待 CI 工具生成"
                          onChange={(event) =>
                            setResourceFileName(event.target.value)
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="资源包 SHA-256">
                        <Input
                          value={resourceSha256}
                          disabled={!isVoiceEditable(voiceDraft)}
                          placeholder="64 位十六进制"
                          onChange={(event) =>
                            setResourceSha256(event.target.value)
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Space size={24} wrap>
                    <Text>
                      离线优先{" "}
                      <Switch
                        checked={voiceDraft.offlineFirst}
                        disabled={!isVoiceContentEditable(voiceDraft)}
                        onChange={(offlineFirst) =>
                          setVoiceDraft({ ...voiceDraft, offlineFirst })
                        }
                      />
                    </Text>
                    <Text>
                      连续/分句唤醒{" "}
                      <Switch
                        checked={voiceDraft.supportsSeparateAndContinuousSpeech}
                        disabled={!isVoiceContentEditable(voiceDraft)}
                        onChange={(supportsSeparateAndContinuousSpeech) =>
                          setVoiceDraft({
                            ...voiceDraft,
                            supportsSeparateAndContinuousSpeech,
                          })
                        }
                      />
                    </Text>
                    <Tag>个人唤醒词：设备旁自学习</Tag>
                  </Space>
                </Card>
                <Card
                  size="small"
                  title="离线命令与语义 ID"
                  extra={
                    <Button
                      icon={<PlusOutlined />}
                      disabled={!isVoiceContentEditable(voiceDraft)}
                      onClick={addCommand}
                    >
                      新增命令
                    </Button>
                  }
                >
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 12, showSizeChanger: false }}
                    columns={voiceColumns}
                    dataSource={voiceDraft.commands}
                    scroll={{ x: 1200 }}
                  />
                </Card>
              </Space>
            ) : (
              <Alert type="warning" message="该产品尚未配置语音版本" showIcon />
            ),
          },
          {
            key: "ble-test",
            label: "BLE 本地控制测试",
            children: (
              <Space orientation="vertical" size={12} className="full-width">
                <Alert
                  type="info"
                  showIcon
                  message="当前验证协议、授权、能力与幂等；真实GATT时延和射频稳定性需在样板上验收"
                />
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={10}>
                    <Card size="small" title="终端命令">
                      <Form layout="vertical">
                        <Row gutter={12}>
                          <Col xs={24} md={12}>
                            <Form.Item label="终端类型">
                              <Select
                                value={bleControllerType}
                                options={[
                                  { value: "WALL_PANEL", label: "墙面触控板" },
                                  {
                                    value: "HANDHELD_REMOTE",
                                    label: "手持遥控器",
                                  },
                                ]}
                                onChange={(value: BleControllerType) => {
                                  setBleControllerType(value);
                                  setBleControllerId(
                                    value === "WALL_PANEL"
                                      ? "wall-panel-001"
                                      : "remote-001",
                                  );
                                }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item label="命令序号">
                              <InputNumber
                                min={1}
                                max={65535}
                                value={bleSequence}
                                className="full-width"
                                onChange={(value) =>
                                  setBleSequence(Number(value ?? 1))
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item label="终端 ID">
                          <Input
                            value={bleControllerId}
                            onChange={(event) =>
                              setBleControllerId(event.target.value)
                            }
                          />
                        </Form.Item>
                        <Form.Item label="设备意图">
                          <Select
                            showSearch
                            value={bleIntent}
                            options={DEVICE_INTENTS.map((intent) => ({
                              value: intent,
                              label: intent,
                            }))}
                            onChange={(intent: DeviceIntent) =>
                              setBleIntent(intent)
                            }
                          />
                        </Form.Item>
                        <Form.Item label="参数 JSON">
                          <Input
                            value={bleSlots}
                            onChange={(event) => setBleSlots(event.target.value)}
                          />
                        </Form.Item>
                        <Space size={20} wrap>
                          <Text>
                            已绑定{" "}
                            <Switch
                              checked={bleBonded}
                              onChange={setBleBonded}
                            />
                          </Text>
                          <Text>
                            已加密{" "}
                            <Switch
                              checked={bleEncrypted}
                              onChange={setBleEncrypted}
                            />
                          </Text>
                          <Text>
                            应用到模拟设备{" "}
                            <Switch
                              checked={bleApplyToDevice}
                              onChange={setBleApplyToDevice}
                            />
                          </Text>
                        </Space>
                        <Button
                          className="ci-event-run"
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={busy}
                          disabled={!bleControllerId.trim()}
                          onClick={() => void runBleCommand()}
                        >
                          发送命令
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                  <Col xs={24} lg={14}>
                    <Card size="small" title="C3 协议处理结果">
                      {bleResult ? (
                        <Space
                          orientation="vertical"
                          size={12}
                          className="full-width"
                        >
                          <Descriptions bordered size="small" column={2}>
                            <Descriptions.Item label="接收">
                              {bleResult.accepted ? "成功" : "拒绝"}
                            </Descriptions.Item>
                            <Descriptions.Item label="结果">
                              <Tag
                                color={
                                  bleResult.outcome === "APPLIED"
                                    ? "green"
                                    : bleResult.outcome === "REJECTED"
                                      ? "red"
                                      : "blue"
                                }
                              >
                                {bleResult.outcome}
                              </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="路由">
                              {bleResult.route}
                            </Descriptions.Item>
                            <Descriptions.Item label="重复">
                              {bleResult.duplicate ? "是" : "否"}
                            </Descriptions.Item>
                            <Descriptions.Item label="处理原因" span={2}>
                              {bleResult.reason}
                            </Descriptions.Item>
                          </Descriptions>
                          <pre className="json-panel">
                            {JSON.stringify(bleResult, null, 2)}
                          </pre>
                        </Space>
                      ) : (
                        <Alert type="info" message="等待命令" showIcon />
                      )}
                    </Card>
                  </Col>
                </Row>
              </Space>
            ),
          },
          {
            key: "ci-test",
            label: "CI1302 事件测试",
            children: voiceDraft ? (
              <Row gutter={[12, 12]}>
                <Col xs={24} lg={10}>
                  <Card size="small" title="事件输入">
                    <Form layout="vertical">
                      <Form.Item label="事件">
                        <Select
                          value={eventType}
                          options={CI_EVENT_OPTIONS}
                          onChange={setEventType}
                        />
                      </Form.Item>
                      <Form.Item label="语义 ID">
                        <Select
                          showSearch
                          disabled={eventType !== "OFFLINE_COMMAND"}
                          value={semanticId}
                          options={voiceDraft.commands
                            .filter((command) => command.enabled)
                            .map((command) => ({
                              value: command.semanticId,
                              label: `${command.semanticId} / ${command.phrase}`,
                            }))}
                          onChange={setSemanticId}
                        />
                      </Form.Item>
                      <Space size={24} wrap>
                        <Text>
                          网络在线{" "}
                          <Switch
                            checked={networkOnline}
                            onChange={setNetworkOnline}
                          />
                        </Text>
                        <Text>
                          应用到模拟设备{" "}
                          <Switch
                            checked={applyToDevice}
                            onChange={setApplyToDevice}
                          />
                        </Text>
                      </Space>
                      <Button
                        className="ci-event-run"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        loading={busy}
                        onClick={() => void runCiEvent()}
                      >
                        发送事件
                      </Button>
                    </Form>
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  <Card size="small" title="C3 处理结果">
                    {eventResult ? (
                      <Space
                        orientation="vertical"
                        size={12}
                        className="full-width"
                      >
                        <Descriptions bordered size="small" column={2}>
                          <Descriptions.Item label="接收">
                            {eventResult.accepted ? "成功" : "拒绝"}
                          </Descriptions.Item>
                          <Descriptions.Item label="路由">
                            <Tag
                              color={
                                eventResult.route === "LOCAL_CONTROL"
                                  ? "green"
                                  : eventResult.route === "REJECTED"
                                    ? "red"
                                    : "blue"
                              }
                            >
                              {eventResult.route}
                            </Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="设备意图">
                            {eventResult.matchedCommand?.intent ?? "-"}
                          </Descriptions.Item>
                          <Descriptions.Item label="反馈">
                            {eventResult.feedback || "-"}
                          </Descriptions.Item>
                          <Descriptions.Item label="处理原因" span={2}>
                            {eventResult.reason}
                          </Descriptions.Item>
                        </Descriptions>
                        <pre className="json-panel">
                          {JSON.stringify(eventResult, null, 2)}
                        </pre>
                      </Space>
                    ) : (
                      <Alert type="info" message="等待事件" showIcon />
                    )}
                  </Card>
                </Col>
              </Row>
            ) : (
              <Alert type="warning" message="该产品尚未配置语音版本" showIcon />
            ),
          },
        ]}
      />

      <Modal
        title="复制为新语音草稿"
        open={cloneOpen}
        confirmLoading={busy}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !cloneVersion.trim() }}
        onOk={() => void createClone()}
        onCancel={() => setCloneOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="新版本号">
            <Input
              value={cloneVersion}
              placeholder="例如 1.0.1"
              onChange={(event) => setCloneVersion(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function isVoiceEditable(profile: VoiceProfile | null): boolean {
  return (
    profile?.status === "DRAFT" || profile?.status === "RESOURCE_GENERATING"
  );
}

function isVoiceContentEditable(profile: VoiceProfile | null): boolean {
  return profile?.status === "DRAFT";
}
