import type { ModelProvider } from '@dongxin/shared';
import { App, InputNumber, Modal, Select } from 'antd';
import { useState } from 'react';
import { saveModelPricing } from './api';
import type { ReferencePricing } from './api';

export function priceSummary(provider?: ModelProvider | null): string {
  if (!provider) return '估算价未配置';
  if (provider.serviceType === 'LLM') {
    if (provider.inputPricePerMTokens == null || provider.outputPricePerMTokens == null) return '估算价未配置';
    return `输入 ¥${provider.inputPricePerMTokens} / 输出 ¥${provider.outputPricePerMTokens} · 百万 Token`;
  }
  if (provider.serviceType === 'ASR') {
    if (provider.billingMode === 'PER_HOUR' && provider.pricePerHourCny != null) return `¥${provider.pricePerHourCny} / 小时`;
    if (provider.billingMode === 'PER_MINUTE' && provider.pricePerMinuteCny != null) return `¥${provider.pricePerMinuteCny} / 分钟`;
    if (provider.billingMode === 'PER_REQUEST' && provider.pricePerRequestCny != null) return `¥${provider.pricePerRequestCny} / 次`;
  }
  if (provider.serviceType === 'TTS') {
    if (provider.pricePer10KCharsCny != null) return `¥${provider.pricePer10KCharsCny} / 万字符`;
    if (provider.packageCalls && provider.packagePriceCny != null) return `¥${provider.packagePriceCny} / ${provider.packageCalls} 次`;
  }
  return '估算价未配置';
}

export function referenceSummary(reference?: ReferencePricing | null): string {
  if (!reference) return '官方价格待确认';
  const rate = reference.rates[0];
  const suffix = reference.rates.length > 1 ? `（${rate.label}）` : '';
  return rate.input != null ? `输入 ${rate.input} / 输出 ${rate.output} ${rate.unit}${suffix}` : `${rate.price} ${rate.unit}`;
}

export function ModelPricingPanel({ provider, reference, pricingUrl, onEdit }: {
  provider?: ModelProvider | null;
  reference?: ReferencePricing | null;
  pricingUrl: string;
  onEdit: () => void;
}) {
  return <div className="model-pricing">
    <div className="price-estimate"><span>测试估算价</span><strong>{priceSummary(provider)}</strong><button type="button" onClick={onEdit}>修改估算价</button></div>
    <small>{provider?.pricingUpdatedAt ? `手动维护于 ${new Date(provider.pricingUpdatedAt).toLocaleDateString('zh-CN')}` : provider ? '已有配置，尚未核对官方现价' : '配置后用于测试成本估算'}</small>
    <details className="price-reference">
      <summary>官方参考价：{referenceSummary(reference)}</summary>
      {reference ? <>
        <div className="reference-rates">{reference.rates.map((rate) => <div key={rate.label}><span>{rate.label}</span><strong>{rate.input != null ? `输入 ${rate.input} / 输出 ${rate.output}` : rate.price} {rate.unit}</strong></div>)}</div>
        <p>{reference.note}</p><p>核对日期：{reference.checkedAt}。参考价快照与测试估算价分别维护。</p>
      </> : <p>官方模型列表不包含价格；请查官方计费页后填写测试估算价。</p>}
      <a href={reference?.sourceUrl || pricingUrl} target="_blank" rel="noreferrer">查看官方计费说明 ↗</a>
    </details>
  </div>;
}

export function PricingEditor({ provider, onClose, onSaved }: {
  provider: ModelProvider;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [input, setInput] = useState<number | null>(provider.inputPricePerMTokens ?? null);
  const [output, setOutput] = useState<number | null>(provider.outputPricePerMTokens ?? null);
  const [mode, setMode] = useState<'PER_HOUR' | 'PER_MINUTE' | 'PER_REQUEST'>(provider.billingMode === 'PER_MINUTE' || provider.billingMode === 'PER_REQUEST' ? provider.billingMode : 'PER_HOUR');
  const [amount, setAmount] = useState<number | null>(provider.serviceType === 'TTS' ? provider.pricePer10KCharsCny ?? null : provider.billingMode === 'PER_MINUTE' ? provider.pricePerMinuteCny ?? null : provider.billingMode === 'PER_REQUEST' ? provider.pricePerRequestCny ?? null : provider.pricePerHourCny ?? null);
  const [busy, setBusy] = useState(false);
  const complete = provider.serviceType === 'LLM' ? input != null && output != null : amount != null;
  async function save() {
    if (!complete) return;
    setBusy(true);
    try {
      const pricing: Partial<ModelProvider> = provider.serviceType === 'LLM'
        ? { serviceType: 'LLM', inputPricePerMTokens: input, outputPricePerMTokens: output }
        : provider.serviceType === 'TTS' ? { serviceType: 'TTS', pricePer10KCharsCny: amount! }
        : { serviceType: 'ASR', billingMode: mode, [mode === 'PER_HOUR' ? 'pricePerHourCny' : mode === 'PER_MINUTE' ? 'pricePerMinuteCny' : 'pricePerRequestCny']: amount };
      await saveModelPricing(provider.id, pricing);
      await onSaved();
      message.success('测试估算价已保存，后续测试使用新单价');
      onClose();
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <Modal open title="修改测试估算价" okText="保存" cancelText="取消" onCancel={onClose} onOk={() => void save()} confirmLoading={busy} okButtonProps={{ disabled: !complete }}>
    <p className="pricing-model-id">{provider.model}</p>
    <p className="muted">人民币计价，仅用于后续测试的成本估算；不修改服务商账单或历史测试记录。</p>
    <div className="pricing-form">
      {provider.serviceType === 'LLM' ? <>
        <label>输入（元 / 百万 Token）<InputNumber min={0} value={input} onChange={setInput} /></label>
        <label>输出（元 / 百万 Token）<InputNumber min={0} value={output} onChange={setOutput} /></label>
      </> : <>
        {provider.serviceType === 'ASR' ? <label>计费单位<Select value={mode} onChange={(value) => { setMode(value); setAmount(null); }} options={[{ value: 'PER_HOUR', label: '元 / 小时' }, { value: 'PER_MINUTE', label: '元 / 分钟' }, { value: 'PER_REQUEST', label: '元 / 次' }]} /></label> : <span>单价（元 / 万字符）</span>}
        <InputNumber aria-label="估算单价" min={0} value={amount} onChange={setAmount} />
      </>}
    </div>
  </Modal>;
}
