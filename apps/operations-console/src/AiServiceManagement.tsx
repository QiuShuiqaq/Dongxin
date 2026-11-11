import { ApiOutlined, InfoCircleOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiServiceDefaults, ModelProvider, ProviderDiagnosticResult, ProviderSecretStatus } from '@dongxin/shared';
import { App, Badge, Button, Input, Popconfirm, Popover, Select, Skeleton, Tag } from 'antd';
import { useEffect, useState } from 'react';
import {
  bootstrapOperationsSpeechModels,
  diagnoseOperationsAiProvider,
  getOperationsAiServices,
  getOperationsCatalogModels,
  getOperationsCatalogVendors,
  getOperationsTtsVoices,
  previewOperationsAsr,
  previewOperationsTts,
  saveOperationsCatalogApiKey,
  saveOperationsTtsVoice,
  setOperationsDefaultAiProvider,
  useOperationsCatalogModel,
} from './api';
import type { OperationsAiServiceConfiguration, OperationsAsrPreview, OperationsCatalogModels, OperationsCatalogVendor, OperationsCatalogVendorId, OperationsReferencePricing, OperationsTtsPreview } from './api';

type ServiceType = 'ASR' | 'LLM' | 'TTS';
const serviceTypes: ServiceType[] = ['ASR', 'LLM', 'TTS'];
const serviceLabels: Record<ServiceType, string> = { ASR: '语音识别', LLM: '对话模型', TTS: '语音合成' };
const vendorKeys = { aliyun: 'DASHSCOPE_API_KEY', deepseek: 'DEEPSEEK_API_KEY' } as const;
const vendorOf = (provider?: ModelProvider): OperationsCatalogVendorId | undefined =>
  provider?.apiKeyEnv === vendorKeys.aliyun ? 'aliyun' : provider?.apiKeyEnv === vendorKeys.deepseek ? 'deepseek' : undefined;
const isConversationModel = (vendor: OperationsCatalogVendorId, model: string) =>
  vendor !== 'aliyun' || !/(?:^|[-_./])(asr|tts|audio|speech|s2s|realtime|livetranslate|cosyvoice|paraformer|embedding|rerank|omni|image|vl|ocr|mt)(?:$|[-_./])/i.test(model);
const maxAsrAudioBytes = 2 * 1024 * 1024;
const audioMimeByExtension: Record<string, string> = {
  wav: 'audio/wav', webm: 'audio/webm', mp3: 'audio/mpeg', mp4: 'audio/mp4',
  m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
};

export default function AiServiceManagement({ canManage }: { canManage: boolean }) {
  const { message } = App.useApp();
  const [config, setConfig] = useState<OperationsAiServiceConfiguration | null>(null);
  const [vendors, setVendors] = useState<OperationsCatalogVendor[]>([]);
  const [catalogs, setCatalogs] = useState<Partial<Record<OperationsCatalogVendorId, OperationsCatalogModels>>>({});
  const [keys, setKeys] = useState<Partial<Record<OperationsCatalogVendorId, string>>>({});
  const [selectedVendors, setSelectedVendors] = useState<Partial<Record<ServiceType, OperationsCatalogVendorId>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<Record<string, ProviderDiagnosticResult>>({});
  const [voices, setVoices] = useState<{ value: string; label: string }[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [previewText, setPreviewText] = useState('你好，我是小东。');
  const [preview, setPreview] = useState<OperationsTtsPreview | null>(null);
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrPreview, setAsrPreview] = useState<OperationsAsrPreview | null>(null);

  async function refresh() {
    const [nextConfig, nextVendors] = await Promise.all([getOperationsAiServices(), getOperationsCatalogVendors()]);
    setConfig(nextConfig);
    setVendors(nextVendors);
  }

  useEffect(() => {
    let active = true;
    Promise.all([getOperationsAiServices(), getOperationsCatalogVendors()])
      .then(([nextConfig, nextVendors]) => { if (active) { setConfig(nextConfig); setVendors(nextVendors); } })
      .catch((error: unknown) => { if (active) message.error(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const ttsProvider = config?.providers.find((provider) => provider.id === config.defaults.TTS);
  const asrProvider = config?.providers.find((provider) => provider.id === config.defaults.ASR);
  useEffect(() => {
    let active = true;
    setVoices([]);
    setPreview(null);
    if (!ttsProvider) return;
    setVoiceLoading(true);
    void getOperationsTtsVoices(ttsProvider.id)
      .then((result) => { if (active) setVoices(result.voices); })
      .catch((error: unknown) => { if (active) message.error(errorMessage(error)); })
      .finally(() => { if (active) setVoiceLoading(false); });
    return () => { active = false; };
  }, [ttsProvider?.id]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try { await action(); }
    catch (error) { message.error(errorMessage(error)); }
    finally { setBusy(null); }
  }

  async function saveKey(vendor: OperationsCatalogVendorId) {
    const value = keys[vendor]?.trim();
    if (!value) return;
    await run(`key-${vendor}`, async () => {
      await saveOperationsCatalogApiKey(vendor, value);
      setKeys((current) => ({ ...current, [vendor]: '' }));
      setCatalogs((current) => ({ ...current, [vendor]: undefined }));
      await refresh();
      message.success('服务商凭据已保存');
    });
  }

  async function pullModels(vendor: OperationsCatalogVendorId) {
    await run(`catalog-${vendor}`, async () => {
      const result = await getOperationsCatalogModels(vendor);
      setCatalogs((current) => ({ ...current, [vendor]: result }));
      message.success(`已获取 ${result.models.length} 个模型`);
    });
  }

  async function changeDefault(type: ServiceType, providerId: string) {
    await run(`default-${type}`, async () => {
      await setOperationsDefaultAiProvider(type, providerId);
      await refresh();
      message.success(`${serviceLabels[type]}默认模型已更新`);
    });
  }

  async function chooseCatalogModel(vendor: OperationsCatalogVendorId, modelId: string) {
    await run('default-LLM', async () => {
      await useOperationsCatalogModel(vendor, modelId);
      await refresh();
      message.success('默认对话模型已更新');
    });
  }

  async function diagnose(providerId: string) {
    await run(`diagnose-${providerId}`, async () => {
      const result = await diagnoseOperationsAiProvider(providerId);
      setDiagnostics((current) => ({ ...current, [providerId]: result }));
      if (result.status === 'PASSED') message.success('连通测试通过');
      else message.error(result.error || '连通测试失败');
    });
  }

  async function changeVoice(voice: string) {
    if (!ttsProvider) return;
    await run('voice', async () => {
      await saveOperationsTtsVoice(ttsProvider.id, voice || null);
      setPreview(null);
      await refresh();
      message.success('线上默认音色已更新');
    });
  }

  async function synthesizePreview() {
    if (!ttsProvider) return;
    await run('preview', async () => {
      setPreview(null);
      const result = await previewOperationsTts({ providerId: ttsProvider.id, text: previewText.trim() });
      setPreview(result);
      message.success('试听音频已生成，请在下方播放');
    });
  }

  function selectAsrFile(file: File | undefined) {
    setAsrPreview(null);
    if (!file) { setAsrFile(null); return; }
    if (file.size > maxAsrAudioBytes) {
      setAsrFile(null);
      message.warning('测试音频不能超过 2 MiB');
      return;
    }
    if (!audioMimeType(file)) {
      setAsrFile(null);
      message.warning('请选择 WAV、WebM、MP3、MP4、Ogg、AAC 或 FLAC 音频');
      return;
    }
    setAsrFile(file);
  }

  async function recognizePreview() {
    if (!asrProvider || !asrFile) return;
    await run('asr-preview', async () => {
      setAsrPreview(null);
      const result = await previewOperationsAsr({
        providerId: asrProvider.id,
        audioBase64: await fileToBase64(asrFile),
        audioMimeType: audioMimeType(asrFile)!,
      });
      setAsrPreview(result);
    });
  }

  if (loading && !config) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!config) return <div className="ops-panel">AI 服务配置暂不可用</div>;
  const noSpeechModels = !config.providers.some((item) => item.serviceType === 'ASR') || !config.providers.some((item) => item.serviceType === 'TTS');

  return <div className="ops-ai-services ops-stack">
    <section className="ops-panel">
      <div className="panel-title"><h2>服务商凭据</h2><span className="ops-ai-service-caption">密钥保存后不会再次显示</span></div>
      <div className="ops-ai-vendors">{vendors.map((vendor) => <div className="ops-ai-vendor" key={vendor.id}>
        <div className="ops-ai-vendor-name"><strong>{vendor.label}</strong><Badge status={vendor.configured ? 'success' : 'default'} text={vendor.configured ? '已配置' : '未配置'} /></div>
        {canManage ? <div className="ops-ai-vendor-actions">
          <Input.Password aria-label={`${vendor.label} API Key`} autoComplete="new-password" placeholder={vendor.configured ? '输入新密钥可替换' : '输入 API Key'} value={keys[vendor.id] || ''} onChange={(event) => setKeys((current) => ({ ...current, [vendor.id]: event.target.value }))} />
          <Button loading={busy === `key-${vendor.id}`} disabled={Boolean(busy) || !keys[vendor.id]?.trim()} onClick={() => void saveKey(vendor.id)}>保存</Button>
          <Button icon={<ReloadOutlined />} loading={busy === `catalog-${vendor.id}`} disabled={Boolean(busy) || !vendor.configured} onClick={() => void pullModels(vendor.id)}>拉取模型</Button>
        </div> : null}
        {catalogs[vendor.id] ? <span className="ops-ai-service-caption">已获取 {catalogs[vendor.id]!.models.length} 个模型</span> : null}
      </div>)}</div>
    </section>

    <section className="ops-panel">
      <div className="panel-title"><h2>线上默认模型</h2>{canManage && noSpeechModels ? <Button type="primary" loading={busy === 'bootstrap'} disabled={Boolean(busy)} onClick={() => void run('bootstrap', async () => { await bootstrapOperationsSpeechModels(); await refresh(); message.success('语音模型已初始化'); })}>初始化语音模型</Button> : null}</div>
      <div className="ops-ai-defaults">{serviceTypes.map((type) => {
        const current = config.providers.find((item) => item.id === config.defaults[type]);
        const eligibleVendors = vendors.filter((vendor) => vendor.configured && (type === 'LLM' || config.providers.some((item) => item.serviceType === type && item.apiKeyEnv === vendorKeys[vendor.id])));
        const preferred = selectedVendors[type] || vendorOf(current);
        const vendor = eligibleVendors.find((item) => item.id === preferred)?.id || eligibleVendors[0]?.id;
        const configuredProviders = vendor ? config.providers.filter((item) => item.serviceType === type && item.enabled && item.apiKeyEnv === vendorKeys[vendor] && configured(config.secrets, item)) : [];
        const models = type === 'LLM' && vendor ? [...new Set([...configuredProviders.map((item) => item.model), ...(catalogs[vendor]?.models || []).filter((model) => isConversationModel(vendor, model))])] : [];
        const selected = current && vendorOf(current) === vendor ? current : undefined;
        const diagnostic = current && diagnostics[current.id];
        const pricing = current ? config.referencePricing[current.id] : null;
        const estimatedRate = current && configuredRate(current);
        return <div className="ops-ai-default-row" key={type}>
          <div className="ops-ai-default-title"><Tag>{type}</Tag><strong>{serviceLabels[type]}</strong><span>{current ? `当前：${current.model}` : '尚未设置'}</span></div>
          <div className="ops-ai-default-controls">
            <Select aria-label={`${type} 服务商`} placeholder="选择服务商" value={vendor} disabled={!canManage || Boolean(busy) || !eligibleVendors.length} options={eligibleVendors.map((item) => ({ label: item.label, value: item.id }))} onChange={(value) => setSelectedVendors((state) => ({ ...state, [type]: value }))} />
            <Select showSearch optionFilterProp="label" aria-label={`${type} 默认模型`} placeholder={type === 'LLM' && vendor && !catalogs[vendor] ? '拉取模型或选择已配置模型' : '选择默认模型'} value={selected ? type === 'LLM' ? selected.model : selected.id : undefined} disabled={!canManage || Boolean(busy) || !vendor} options={type === 'LLM' ? models.map((model) => ({ label: model, value: model })) : configuredProviders.map((item) => ({ label: item.model, value: item.id }))} onChange={(value) => { if (type === 'LLM' && vendor) void chooseCatalogModel(vendor, value); else void changeDefault(type, value); }} />
            <Button icon={<ApiOutlined />} loading={busy === `diagnose-${current?.id}`} disabled={!canManage || Boolean(busy) || !current} onClick={() => { if (current) void diagnose(current.id); }}>连通测试</Button>
            {diagnostic ? <Tag color={diagnostic.status === 'PASSED' ? 'green' : 'red'}>{diagnostic.status === 'PASSED' ? '通过' : '失败'}</Tag> : null}
          </div>
          {current ? <div className="ops-ai-pricing">
            {estimatedRate ? <span>系统估算：{estimatedRate}</span> : null}
            {pricing ? <span className="ops-ai-reference-price">
              官网参考（{pricing.checkedAt}）：{formatReferenceRate(pricing.rates[0])}
              {pricing.rates.length > 1 ? `，另 ${pricing.rates.length - 1} 档` : ''}
              <Popover trigger="click" title="公开参考价" content={<div className="ops-ai-price-detail">
                {pricing.rates.map((rate, index) => <div key={index}>{formatReferenceRate(rate)}</div>)}
                <p>{pricing.note}</p>
                <a href={pricing.sourceUrl} target="_blank" rel="noopener noreferrer">查看官方来源</a>
              </div>}>
                <Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label={`${type} 参考计费说明`} />
              </Popover>
            </span> : <span>未收录该模型公开参考价，以服务商账单为准</span>}
          </div> : null}
          {diagnostic?.error ? <small className="ops-ai-error">{diagnostic.error}</small> : null}
        </div>;
      })}</div>
      <p className="ops-ai-service-caption">模型与连通测试会调用服务商，可能产生费用；默认设置用于后续在线语音请求。</p>
    </section>

    <section className="ops-panel">
      <div className="panel-title"><h2>语音识别测试</h2><span className="ops-ai-service-caption">只返回识别文字，不控制设备</span></div>
      <div className="ops-ai-asr-controls">
        <input aria-label="选择 ASR 测试音频" type="file" accept="audio/wav,audio/webm,audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/flac,.wav,.webm,.mp3,.mp4,.m4a,.ogg,.aac,.flac" disabled={!canManage || Boolean(busy)} onChange={(event) => { selectAsrFile(event.target.files?.[0]); if (event.target.files?.[0] && event.target.files[0].size > maxAsrAudioBytes) event.target.value = ''; }} />
        <Popconfirm title="上传音频并调用 ASR？" description="最多 2 MiB；会产生服务商费用，不会保存音频或控制设备。" okText="开始识别" cancelText="取消" onConfirm={() => void recognizePreview()} disabled={!canManage || !asrProvider || !asrFile || Boolean(busy)}>
          <Button icon={<ApiOutlined />} loading={busy === 'asr-preview'} disabled={!canManage || !asrProvider || !asrFile || Boolean(busy)}>识别音频</Button>
        </Popconfirm>
      </div>
      {asrPreview ? <div className="ops-ai-asr-result"><p>{asrPreview.transcript || '未识别到文字'}</p><span>{asrPreview.latencyMs} ms · {asrPreview.isEstimated ? '费用估算' : '本次费用'} ¥{asrPreview.costCny.toFixed(4)}</span></div> : null}
    </section>

    <section className="ops-panel">
      <div className="panel-title"><h2>默认播报音色</h2><span className="ops-ai-service-caption">仅浏览器试听，不向设备发送音频</span></div>
      <div className="ops-ai-voice-controls">
        <Select aria-label="线上默认 TTS 音色" loading={voiceLoading} disabled={!canManage || Boolean(busy) || !ttsProvider || voices.length === 0} value={ttsProvider?.voice || ''} options={[{ value: '', label: '模型默认音色' }, ...voices, ...(ttsProvider?.voice && !voices.some((item) => item.value === ttsProvider.voice) ? [{ value: ttsProvider.voice, label: `已配置：${ttsProvider.voice}` }] : [])]} onChange={(value) => void changeVoice(value)} />
        <span className="ops-ai-service-caption">{ttsProvider ? voices.length ? ttsProvider.voice ? `当前 ${ttsProvider.voice}` : '使用模型默认音色' : '当前型号无可选音色' : '先设置 TTS 默认模型'}</span>
      </div>
      <div className="ops-ai-preview-controls">
        <Input aria-label="试听文本" value={previewText} maxLength={80} disabled={!canManage || Boolean(busy)} onChange={(event) => setPreviewText(event.target.value)} />
        <Popconfirm title="生成浏览器试听音频？" description="将调用云端 TTS，可能产生费用；不会向设备发送音频。" okText="生成" cancelText="取消" onConfirm={() => void synthesizePreview()} disabled={!canManage || !ttsProvider || !previewText.trim() || Boolean(busy)}>
          <Button icon={<PlayCircleOutlined />} loading={busy === 'preview'} disabled={!canManage || !ttsProvider || !previewText.trim() || Boolean(busy)}>生成试听</Button>
        </Popconfirm>
      </div>
      {preview ? <div className="ops-ai-preview-result"><audio controls preload="none" aria-label="TTS 浏览器试听" src={`data:${preview.audioMimeType};base64,${preview.audioBase64}`} /><span>{preview.latencyMs} ms · 约 ¥{preview.costCny.toFixed(4)}</span></div> : null}
    </section>
  </div>;
}

function configured(secrets: ProviderSecretStatus[], provider: ModelProvider) {
  return !provider.apiKeyEnv || secrets.some((item) => item.providerId === provider.id && item.isConfigured);
}

function configuredRate(provider: ModelProvider): string | null {
  if (provider.serviceType === 'LLM' && provider.inputPricePerMTokens != null && provider.outputPricePerMTokens != null) {
    return `输入 ¥${provider.inputPricePerMTokens}、输出 ¥${provider.outputPricePerMTokens} / 百万 Token`;
  }
  if (provider.serviceType === 'TTS' && provider.pricePer10KCharsCny != null) return `¥${provider.pricePer10KCharsCny} / 万字符`;
  if (provider.serviceType === 'ASR') {
    if (provider.billingMode === 'PER_HOUR' && provider.pricePerHourCny != null) return `¥${provider.pricePerHourCny} / 小时`;
    if (provider.billingMode === 'PER_MINUTE' && provider.pricePerMinuteCny != null) return `¥${provider.pricePerMinuteCny} / 分钟`;
    if (provider.billingMode === 'PER_REQUEST' && provider.pricePerRequestCny != null) return `¥${provider.pricePerRequestCny} / 次`;
  }
  return null;
}

function formatReferenceRate(rate: OperationsReferencePricing['rates'][number]): string {
  const unit = rate.unit.replace(/^元\s*\/\s*/, '');
  if (rate.price != null) return `${rate.label} ¥${rate.price} / ${unit}`;
  return `${rate.label} 输入 ¥${rate.input ?? '-'}、输出 ¥${rate.output ?? '-'} / ${unit}`;
}

function audioMimeType(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return audioMimeByExtension[extension] || (Object.values(audioMimeByExtension).includes(file.type) ? file.type : null);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error || new Error('无法读取音频文件'));
    reader.readAsDataURL(file);
  });
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
