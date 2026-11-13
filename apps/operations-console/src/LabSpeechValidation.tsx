import { AudioOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ModelProvider } from "@dongxin/shared";
import { Alert, App, Button, Input, Select, Skeleton, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import { getOperationsAiServices, previewOperationsAsr, previewOperationsTts } from "./api";
import type { OperationsAsrPreview, OperationsTtsPreview } from "./api";

const mimeByExtension: Record<string, string> = {
  wav: "audio/wav", webm: "audio/webm", mp3: "audio/mpeg", mp4: "audio/mp4",
  m4a: "audio/mp4", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};

export default function LabSpeechValidation() {
  const { message, modal } = App.useApp();
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [defaults, setDefaults] = useState<{ ASR: string | null; TTS: string | null }>({ ASR: null, TTS: null });
  const [asrId, setAsrId] = useState("");
  const [ttsId, setTtsId] = useState("");
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrResult, setAsrResult] = useState<OperationsAsrPreview | null>(null);
  const [ttsText, setTtsText] = useState("你好，我是小东。");
  const [ttsResult, setTtsResult] = useState<OperationsTtsPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"ASR" | "TTS" | null>(null);
  const asrProviders = providers.filter((item) => item.enabled && item.serviceType === "ASR");
  const ttsProviders = providers.filter((item) => item.enabled && item.serviceType === "TTS");
  const currentTts = ttsProviders.find((item) => item.id === ttsId);

  async function refresh() {
    setLoading(true);
    try {
      const config = await getOperationsAiServices();
      setProviders(config.providers);
      setDefaults({ ASR: config.defaults.ASR, TTS: config.defaults.TTS });
      setAsrId((current) => current || config.defaults.ASR || config.providers.find((item) => item.enabled && item.serviceType === "ASR")?.id || "");
      setTtsId((current) => current || config.defaults.TTS || config.providers.find((item) => item.enabled && item.serviceType === "TTS")?.id || "");
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  function confirmAsr() {
    if (!asrId || !asrFile) return;
    const extension = asrFile.name.split(".").pop()?.toLowerCase() || "";
    const mime = mimeByExtension[extension];
    if (!mime || asrFile.size > 2 * 1024 * 1024 || asrFile.size === 0) {
      message.error("请选择不超过 2 MB 的有效音频文件");
      return;
    }
    modal.confirm({
      title: "运行 ASR 识别？", content: "这会向当前语音服务商发送音频，可能产生费用。不会操作设备。", okText: "开始识别",
      onOk: async () => {
        setBusy("ASR"); setAsrResult(null);
        try {
          const audioBase64 = await readFileBase64(asrFile);
          setAsrResult(await previewOperationsAsr({ providerId: asrId, audioBase64, audioMimeType: mime }));
        } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(null); }
      },
    });
  }

  function confirmTts() {
    if (!ttsId || !ttsText.trim()) return;
    modal.confirm({
      title: "生成 TTS 试听？", content: "这会调用当前语音服务商并可能产生费用。音频只在浏览器内手动播放，不发送到样机。", okText: "生成音频",
      onOk: async () => {
        setBusy("TTS"); setTtsResult(null);
        try { setTtsResult(await previewOperationsTts({ providerId: ttsId, text: ttsText.trim() })); }
        catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(null); }
      },
    });
  }

  if (loading && !providers.length) return <Skeleton active paragraph={{ rows: 8 }} />;
  return <div className="lab-workspace">
    <div className="lab-toolbar"><Space wrap><Tag color="green">仅云端服务</Tag><span>试听音频只在浏览器播放</span></Space><Button icon={<ReloadOutlined />} aria-label="刷新模型" onClick={() => void refresh()} loading={loading} /></div>
    <div className="lab-speech-grid">
      <section className="lab-section">
        <div className="lab-section-heading"><h2>ASR 语音识别</h2><Tag color="blue">上传音频</Tag></div>
        <label className="lab-form-label">识别模型<Select aria-label="ASR 识别模型" value={asrId || undefined} onChange={(value) => { setAsrId(value); setAsrResult(null); }} options={asrProviders.map((item) => ({ value: item.id, label: `${item.name}${item.id === defaults.ASR ? " · 默认" : ""}` }))} placeholder="选择模型" /></label>
        <label className="lab-form-label">测试音频<input aria-label="ASR 测试音频" type="file" accept=".wav,.webm,.mp3,.mp4,.m4a,.ogg,.aac,.flac" onChange={(event) => { setAsrFile(event.target.files?.[0] || null); setAsrResult(null); }} /></label>
        <Button type="primary" icon={<PlayCircleOutlined />} disabled={!asrId || !asrFile} loading={busy === "ASR"} onClick={confirmAsr}>开始识别</Button>
        {asrResult ? <div className="lab-module-result"><strong>识别文本</strong><p>{asrResult.transcript}</p><span>耗时 {asrResult.latencyMs} ms · 费用估算 ¥{asrResult.costCny.toFixed(4)}</span></div> : null}
      </section>
      <section className="lab-section">
        <div className="lab-section-heading"><h2>TTS 语音合成</h2><Tag color="gold">浏览器试听</Tag></div>
        <label className="lab-form-label">合成模型<Select aria-label="TTS 合成模型" value={ttsId || undefined} onChange={(value) => { setTtsId(value); setTtsResult(null); }} options={ttsProviders.map((item) => ({ value: item.id, label: `${item.name}${item.id === defaults.TTS ? " · 默认" : ""}` }))} placeholder="选择模型" /></label>
        <div className="lab-meta"><span>当前音色：{currentTts?.voice || "模型默认"}</span></div>
        <label className="lab-form-label">合成文本<Input.TextArea aria-label="TTS 合成文本" maxLength={100} showCount rows={3} value={ttsText} onChange={(event) => { setTtsText(event.target.value); setTtsResult(null); }} /></label>
        <Button type="primary" icon={<AudioOutlined />} disabled={!ttsId || !ttsText.trim()} loading={busy === "TTS"} onClick={confirmTts}>生成试听</Button>
        {ttsResult ? <div className="lab-module-result"><strong>合成结果</strong><audio aria-label="TTS 浏览器试听" controls preload="none" src={`data:${ttsResult.audioMimeType};base64,${ttsResult.audioBase64}`} /><span>耗时 {ttsResult.latencyMs} ms · 费用估算 ¥{ttsResult.costCny.toFixed(4)}</span></div> : null}
      </section>
    </div>
    {!asrProviders.length || !ttsProviders.length ? <Alert type="warning" showIcon title="语音模型未配置完整" action={<Button href="/">前往运营平台配置</Button>} /> : null}
  </div>;
}

async function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("音频读取失败"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}
