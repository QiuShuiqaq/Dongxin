import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ModelProvider } from '@dongxin/shared';
import { App, Badge, Button, Input, Select, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { addCatalogModel, diagnoseAiProvider, getAiServiceConfiguration, getCatalogModels, getCatalogVendors, saveCatalogApiKey, setDefaultAiProvider, useCatalogModel } from './api';
import type { AiServiceConfiguration, CatalogModels, CatalogVendor, CatalogVendorId, ProviderDiagnosticResult } from './api';
import { ModelPricingPanel, PricingEditor, priceSummary, referenceSummary } from './ModelPricing';

const serviceLabels = { ASR: '语音识别', LLM: '对话模型', TTS: '语音合成' } as const;
type ServiceType = keyof typeof serviceLabels;
const vendorKeys = { aliyun: 'DASHSCOPE_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
const pricingUrls = { aliyun: 'https://help.aliyun.com/zh/model-studio/model-pricing', deepseek: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' };
function vendorOf(provider?: ModelProvider): CatalogVendorId | undefined {
  return provider?.apiKeyEnv === vendorKeys.aliyun ? 'aliyun' : provider?.apiKeyEnv === vendorKeys.deepseek ? 'deepseek' : undefined;
}

export default function AiServicesPage() {
  const { message } = App.useApp();
  const [configuration, setConfiguration] = useState<AiServiceConfiguration | null>(null);
  const [vendors, setVendors] = useState<CatalogVendor[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<CatalogVendorId, string>>>({});
  const [catalogs, setCatalogs] = useState<Partial<Record<CatalogVendorId, CatalogModels>>>({});
  const [selected, setSelected] = useState<Partial<Record<CatalogVendorId, string>>>({});
  const [defaultVendors, setDefaultVendors] = useState<Partial<Record<ServiceType, CatalogVendorId>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState<Partial<Record<CatalogVendorId, boolean>>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, ProviderDiagnosticResult>>({});
  const [editingPrice, setEditingPrice] = useState<ModelProvider | null>(null);

  async function refresh() {
    const [nextConfiguration, nextVendors] = await Promise.all([getAiServiceConfiguration(), getCatalogVendors()]);
    setConfiguration(nextConfiguration);
    setVendors(nextVendors);
  }
  useEffect(() => { void refresh().catch((error: unknown) => message.error(errorMessage(error))); }, []);

  const configuredIds = vendors.filter((vendor) => vendor.configured).map((vendor) => vendor.id).join(',');
  useEffect(() => {
    for (const id of configuredIds.split(',').filter(Boolean) as CatalogVendorId[]) {
      if (!catalogs[id]) void pullModels(id);
    }
  }, [configuredIds]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try { await action(); }
    catch (error) { message.error(errorMessage(error)); }
    finally { setBusy(null); }
  }
  async function saveKey(vendor: CatalogVendorId) {
    const key = drafts[vendor]?.trim();
    if (!key) return;
    await run(`${vendor}-key`, async () => {
      await saveCatalogApiKey(vendor, key);
      setDrafts((current) => ({ ...current, [vendor]: '' }));
      setDiagnostics({});
      setCatalogs((current) => ({ ...current, [vendor]: undefined }));
      setSelected((current) => ({ ...current, [vendor]: undefined }));
      await pullModels(vendor);
      await refresh();
      message.success('API Key 已保存');
    });
  }
  async function pullModels(vendor: CatalogVendorId) {
    setPulling((current) => ({ ...current, [vendor]: true }));
    try {
      const result = await getCatalogModels(vendor);
      setCatalogs((current) => ({ ...current, [vendor]: result }));
      const defaultModel = configuration?.providers.find((item) => item.id === configuration.defaults.LLM && item.apiKeyEnv === vendorKeys[vendor])?.model;
      setSelected((current) => ({ ...current, [vendor]: result.models.includes(current[vendor] || '') ? current[vendor] : defaultModel && result.models.includes(defaultModel) ? defaultModel : result.details.find((item) => item.referencePricing && isConversationModel(vendor, item.id))?.id || result.models.find((id) => isConversationModel(vendor, id)) || result.models[0] }));
    } catch (error) { message.error(`${vendor === 'aliyun' ? '阿里百炼' : 'DeepSeek'}：${errorMessage(error)}`); }
    finally { setPulling((current) => ({ ...current, [vendor]: false })); }
  }
  async function chooseModel(vendor: CatalogVendorId, modelId: string, makeDefault: boolean) {
    await run(`${vendor}-select`, async () => {
      if (makeDefault) {
        await useCatalogModel(vendor, modelId);
        setDefaultVendors((current) => ({ ...current, LLM: vendor }));
      } else await addCatalogModel(vendor, modelId);
      await refresh();
      message.success(makeDefault ? '已设为默认对话模型' : '已加入测试模型');
    });
  }
  async function changeDefault(type: ServiceType, providerId: string) {
    await run(`default-${type}`, async () => {
      await setDefaultAiProvider(type, providerId);
      await refresh();
      message.success(`${serviceLabels[type]}默认模型已更新`);
    });
  }
  async function editPrice(vendor: CatalogVendorId, modelId: string, provider?: ModelProvider | null) {
    if (provider) { setEditingPrice(provider); return; }
    await run(`${vendor}-price`, async () => { setEditingPrice(await addCatalogModel(vendor, modelId)); await refresh(); });
  }
  async function diagnose(providerId: string) {
    await run(`diagnose-${providerId}`, async () => {
      const result = await diagnoseAiProvider(providerId);
      setDiagnostics((current) => ({ ...current, [providerId]: result }));
      if (result.status === 'PASSED') message.success('连通测试通过');
      else message.error(result.error || '连通测试失败');
    });
  }
  function availableProviders(type: ServiceType, vendor: CatalogVendorId) {
    return configuration?.providers.filter((item) => item.serviceType === type && item.enabled && item.apiKeyEnv === vendorKeys[vendor] && configuration.secrets.some((secret) => secret.providerId === item.id && secret.isConfigured)) || [];
  }

  return <div className="page-stack ai-settings">
    <section className="workspace-section">
      <h2>服务商</h2>
      <div className="vendor-list">{vendors.map((vendor) => {
        const catalog = catalogs[vendor.id];
        const detail = catalog?.details.find((item) => item.id === selected[vendor.id]);
        const provider = configuration?.providers.find((item) => item.apiKeyEnv === vendorKeys[vendor.id] && item.model === detail?.id) || detail?.provider;
        const supported = isConversationModel(vendor.id, selected[vendor.id]);
        return <div className="vendor-row" key={vendor.id}>
          <div className="vendor-heading"><strong>{vendor.label}</strong><Badge status={vendor.configured ? 'success' : 'default'} text={vendor.configured ? 'Key 已配置' : '未配置'} /></div>
          <div className="vendor-controls">
            <Input.Password value={drafts[vendor.id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [vendor.id]: event.target.value }))} placeholder={vendor.configured ? '输入新 Key 可替换' : '输入 API Key'} autoComplete="new-password" aria-label={`${vendor.label} API Key`} />
            <Button loading={busy === `${vendor.id}-key`} disabled={Boolean(busy) || pulling[vendor.id] || !drafts[vendor.id]?.trim()} onClick={() => void saveKey(vendor.id)}>保存 Key</Button>
            <Button icon={<ReloadOutlined />} loading={pulling[vendor.id]} disabled={Boolean(busy) || !vendor.configured} onClick={() => void pullModels(vendor.id)}>拉取模型</Button>
          </div>
          {catalog ? <>
            <div className="catalog-controls">
              <Select showSearch value={selected[vendor.id]} onChange={(value) => setSelected((current) => ({ ...current, [vendor.id]: value }))} options={catalog.models.map((model) => ({ label: model, value: model, description: referenceSummary(catalog.details.find((item) => item.id === model)?.referencePricing) }))} optionRender={(option) => <div className="catalog-option"><strong>{option.data.label}</strong><small>{option.data.description}</small></div>} optionFilterProp="label" aria-label={`${vendor.label}模型`} />
              <Button disabled={Boolean(busy) || !supported} onClick={() => void chooseModel(vendor.id, selected[vendor.id]!, false)}>加入测试</Button>
              <Button type="primary" disabled={Boolean(busy) || !supported} onClick={() => void chooseModel(vendor.id, selected[vendor.id]!, true)}>设为默认</Button>
              <span className="muted">{catalog.models.length} 个</span>
            </div>
            {detail ? <ModelPricingPanel provider={provider} reference={detail.referencePricing} pricingUrl={catalog.pricingUrl} onEdit={() => { if (supported || provider) void editPrice(vendor.id, detail.id, provider); else message.info('该模型尚未适配测试链路'); }} /> : null}
            {!supported ? <p className="catalog-model-note">此型号暂未适配对话测试；ASR / TTS 请在下方选择已适配模型。</p> : null}
          </> : null}
        </div>;
      })}</div>
      <p className="catalog-note">模型来自官方接口；可查询不代表已开通调用权限。参考价按型号核对，实际费用以服务商账单为准。</p>
    </section>
    <section className="workspace-section">
      <h2>默认模型</h2>
      <div className="service-defaults">{(['ASR', 'LLM', 'TTS'] as const).map((type) => {
        const current = configuration?.providers.find((item) => item.id === configuration.defaults[type]);
        const eligibleVendors = vendors.filter((vendor) => vendor.configured && (type === 'LLM' || availableProviders(type, vendor.id).length > 0));
        const preferredVendor = defaultVendors[type] || vendorOf(current);
        const vendor = eligibleVendors.find((item) => item.id === preferredVendor)?.id || eligibleVendors[0]?.id;
        const providers = vendor ? availableProviders(type, vendor) : [];
        const selectedProvider = providers.find((item) => item.id === current?.id);
        const result = selectedProvider ? diagnostics[selectedProvider.id] : undefined;
        const models = type === 'LLM' && vendor ? [...new Set([...providers.map((item) => item.model), ...(catalogs[vendor]?.models || []).filter((model) => isConversationModel(vendor, model))])] : [];
        return <div className="service-default-row" key={type}>
          <div><strong>{type}</strong><span>{serviceLabels[type]}</span></div>
          <div className="default-model-selectors">
            <Select aria-label={`${type} 服务商`} placeholder="先配置服务商" value={vendor} disabled={Boolean(busy) || eligibleVendors.length === 0} options={eligibleVendors.map((item) => ({ label: item.label, value: item.id }))} onChange={(value) => setDefaultVendors((state) => ({ ...state, [type]: value }))} />
            <Select showSearch optionFilterProp="label" aria-label={`${type} 默认模型`} value={type === 'LLM' ? selectedProvider?.model : selectedProvider?.id} placeholder={vendor ? '选择模型并设为默认' : '暂无可用模型'} disabled={Boolean(busy) || !vendor} loading={type === 'LLM' && vendor ? pulling[vendor] : false} options={type === 'LLM' ? models.map((model) => ({ value: model, label: model })) : providers.map((item) => ({ value: item.id, label: item.model }))} onChange={(value) => { if (type === 'LLM' && vendor) void chooseModel(vendor, value, true); else void changeDefault(type, value); }} />
          </div>
          <Button icon={<ApiOutlined />} title={type === 'TTS' ? '只生成音频，不播放' : undefined} disabled={Boolean(busy) || !selectedProvider} loading={busy === `diagnose-${selectedProvider?.id}`} onClick={() => selectedProvider && void diagnose(selectedProvider.id)}>连通测试</Button>
          {result ? <Tag color={result.status === 'PASSED' ? 'green' : 'red'}>{result.status === 'PASSED' ? '通过' : '失败'}</Tag> : <Tag>未测试</Tag>}
          {selectedProvider && vendor ? <div className="default-pricing"><details><summary>{priceSummary(selectedProvider)} · 计费详情</summary><ModelPricingPanel provider={selectedProvider} reference={configuration?.referencePricing[selectedProvider.id]} pricingUrl={pricingUrls[vendor]} onEdit={() => setEditingPrice(selectedProvider)} /></details></div> : <small className="default-pricing muted">{vendor ? '选择模型后用于后续测试；ASR / TTS 仅列出已适配型号。' : '请先配置支持此服务的 API Key。'}</small>}
          {result?.error ? <small className="default-error">{result.error}</small> : null}
        </div>;
      })}</div>
    </section>
    {editingPrice ? <PricingEditor key={editingPrice.id} provider={editingPrice} onClose={() => setEditingPrice(null)} onSaved={refresh} /> : null}
  </div>;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isConversationModel(vendor: CatalogVendorId, modelId: string | undefined) {
  return Boolean(modelId) && (vendor !== 'aliyun' || !/(?:^|[-_./])(asr|tts|audio|speech|s2s|realtime|livetranslate|cosyvoice|paraformer|embedding|rerank|omni|image|vl|ocr|mt)(?:$|[-_./])/i.test(modelId!));
}
