import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// UI checks only. All writes are intercepted; no model inference, recording,
// playback, flashing or commands are sent to any device.
const api = 'http://127.0.0.1:3077';
const original = await (await fetch(`${api}/api/development/ai-services`)).json();
const consoleData = await (await fetch(`${api}/api/development/console`)).json();
assert.ok(original.referencePricing, 'API exposes official reference pricing');
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
await mkdir('.artifacts', { recursive: true });
const errors = [];
const unexpectedWrites = [];
let currentPage;

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'zh-CN' });
    const configuration = structuredClone(original);
    const fixtureConsole = structuredClone(consoleData);
    const audioDevice = fixtureConsole.devices.find((device) => device.model.includes('LICHUANG-AUDIO'));
    assert.ok(audioDevice, 'Audio development board is registered');
    Object.assign(audioDevice, { status: 'ONLINE', capabilities: { ...audioDevice.capabilities, voiceTestControl: true, audioPlayback: true } });
    const fixtureTime = new Date().toISOString();
    const fixtureSession = { id: '00000000-0000-4000-8000-000000000001', deviceId: audioDevice.id, mode: 'ASR_ONLY', status: 'COMPLETED', recordSeconds: 6, muted: true, message: 'ASR fixture complete', requestedAt: fixtureTime, updatedAt: fixtureTime, completedAt: fixtureTime, turns: [], result: { sessionId: '00000000-0000-4000-8000-000000000009', transcript: 'ASR 专项识别样例', replyText: '', route: 'UNRESOLVED', totalLatencyMs: 120, cost: { totalCny: 0 }, stages: [] } };
    let activeVoiceSession = null;
    const voiceStartRequests = [];
    let audioTask = null;
    const pipelineRequests = [];
    const llmRequests = [];
    const deviceTtsRequests = [];
    const volumeSaveRequests = [];
    let savedVolume = 20;
    const resetRequests = [];
    let nextTurn = 10;
    const pipelineConversationId = '00000000-0000-4000-8000-000000000002';
    const llmConversationId = '00000000-0000-4000-8000-000000000003';
    const deepseek = { ...configuration.providers.find((item) => item.serviceType === 'LLM'), id: 'fixture-deepseek', model: 'deepseek-flash', name: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY', enabled: true };
    configuration.providers.push(deepseek);
    configuration.secrets.push({ providerId: deepseek.id, apiKeyEnv: deepseek.apiKeyEnv, isConfigured: true });
    const catalogs = {
      aliyun: { vendor: 'aliyun', models: ['qwen-flash', 'qwen3.7-flash', 'model-price-unknown'], pricingUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing', details: ['qwen-flash', 'qwen3.7-flash', 'model-price-unknown'].map((id) => ({ id, provider: configuration.providers.find((item) => item.apiKeyEnv === 'DASHSCOPE_API_KEY' && item.model === id) || null, referencePricing: configuration.referencePricing[configuration.providers.find((item) => item.model === id)?.id] || null })) },
      deepseek: { vendor: 'deepseek', models: ['deepseek-flash'], pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', details: [{ id: 'deepseek-flash', provider: deepseek, referencePricing: null }] },
    };
    await context.route('**/api/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'GET' && path === '/api/development/ai-services') return route.fulfill({ json: configuration });
      if (req.method() === 'GET' && path === '/api/development/console') return route.fulfill({ json: fixtureConsole });
      if (req.method() === 'GET' && path === '/api/development/voice-history') return route.fulfill({ json: [] });
      if (req.method() === 'GET' && path === '/api/development/voice-tests') return route.fulfill({ json: [fixtureSession] });
      if (req.method() === 'POST' && path === '/api/development/voice-tests') {
        const input = req.postDataJSON();
        voiceStartRequests.push(input);
        activeVoiceSession = { ...fixtureSession, id: '00000000-0000-4000-8000-000000000004', mode: input.mode,
          continuous: input.continuous, settings: input.settings, recordSeconds: input.settings.maxUtteranceSeconds,
          status: 'COMMAND_SENT', result: null, turns: [], message: 'Waiting for board' };
        return route.fulfill({ json: activeVoiceSession });
      }
      if (req.method() === 'GET' && path === '/api/development/voice-tests/00000000-0000-4000-8000-000000000004') return route.fulfill({ json: activeVoiceSession });
      if (req.method() === 'POST' && path === '/api/development/voice-tests/00000000-0000-4000-8000-000000000004/stop') {
        activeVoiceSession = { ...activeVoiceSession, status: 'CANCELLED', message: 'Stopped' };
        return route.fulfill({ json: activeVoiceSession });
      }
      if (path === `/api/development/voice-volume/${encodeURIComponent(audioDevice.id)}`) {
        if (req.method() === 'PUT') {
          savedVolume = req.postDataJSON().volumePercent;
          volumeSaveRequests.push(savedVolume);
        }
        return route.fulfill({ json: { deviceId: audioDevice.id, volumePercent: savedVolume } });
      }
      if (req.method() === 'POST' && path === '/api/voice/conversations/reset') {
        resetRequests.push(req.postDataJSON());
        return route.fulfill({ json: { reset: true } });
      }
      if (req.method() === 'POST' && path === '/api/development/module-tests/llm') {
        const input = req.postDataJSON();
        llmRequests.push(input);
        const control = input.text === '打开照明';
        return route.fulfill({ json: { conversationId: llmConversationId, inputText: input.text, providerId: 'fixture', aiResult: { resultType: control ? 'DEVICE_CONTROL' : 'CHAT', intent: control ? 'LIGHT_ON' : null, confidence: 1, speak: control ? '已打开照明。' : '记住了，你是小林。' }, safetyResult: { decision: control ? 'APPROVED' : 'NO_ACTION', reason: 'fixture' }, latencyMs: 30, usage: { totalTokens: 15 }, error: null } });
      }
      if (req.method() === 'POST' && path === '/api/voice/pipeline/test') {
        const input = req.postDataJSON();
        pipelineRequests.push(input);
        assert.equal(input.applyToDevice, false);
        assert.equal(input.simulateOffline, 'MISS');
        const failed = input.text === '模拟服务失败';
        return route.fulfill({ json: {
          sessionId: `fixture-turn-${nextTurn++}`, conversationId: pipelineConversationId, inputSource: 'TEXT_SIMULATION', transcript: input.text,
          replyText: failed ? '服务暂不可用' : '这是测试回复。', route: input.text === '你好' ? 'ONLINE_RULE' : 'LLM',
          aiResult: { resultType: 'CHAT', intent: null, confidence: 1, speak: '这是测试回复。' }, safetyResult: { decision: 'NO_ACTION', reason: 'fixture', commands: [] }, commandRecord: null,
          stages: failed ? [{ key: 'LLM', label: 'LLM 大模型', status: 'FAILED', source: 'fixture', result: '', latencyMs: 0, costCny: 0, error: '测试错误：模型响应格式异常' }] : [], totalLatencyMs: 30,
          cost: { totalCny: 0.001 }, ttsAudioBase64: failed ? null : 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=', ttsAudioMimeType: 'audio/wav',
        } });
      }
      if (req.method() === 'POST' && path === '/api/development/module-tests/tts' && req.postDataJSON().target === 'DEVICE') {
        const input = req.postDataJSON();
        deviceTtsRequests.push(input);
        audioTask = { id: `fixture-audio-${deviceTtsRequests.length}`, deviceId: audioDevice.id, text: input.text, status: 'PLAYING', durationMs: 800, volumePercent: input.volumePercent, message: 'Mock playback status only' };
        return route.fulfill({ json: audioTask });
      }
      if (req.method() === 'GET' && path.startsWith('/api/development/audio-tests/fixture-audio-')) return route.fulfill({ json: audioTask });
      if (req.method() === 'POST' && /^\/api\/development\/audio-tests\/fixture-audio-\d+\/stop$/.test(path)) {
        audioTask.status = 'CANCELLED';
        return route.fulfill({ json: audioTask });
      }
      if (req.method() === 'GET' && path === '/api/providers/catalog/vendors') return route.fulfill({ json: [{ id: 'aliyun', label: '阿里百炼', configured: true }, { id: 'deepseek', label: 'DeepSeek', configured: true }] });
      const catalog = path.match(/^\/api\/providers\/catalog\/(aliyun|deepseek)\/models$/);
      if (req.method() === 'GET' && catalog) return route.fulfill({ json: catalogs[catalog[1]] });
      const defaultMatch = path.match(/^\/api\/providers\/catalog\/(aliyun|deepseek)\/default$/);
      if (req.method() === 'PUT' && defaultMatch) {
        const provider = configuration.providers.find((item) => item.model === req.postDataJSON().modelId && item.apiKeyEnv === (defaultMatch[1] === 'aliyun' ? 'DASHSCOPE_API_KEY' : 'DEEPSEEK_API_KEY'));
        assert.ok(provider);
        configuration.defaults.LLM = provider.id;
        return route.fulfill({ json: { provider, defaults: configuration.defaults } });
      }
      const priceMatch = path.match(/^\/api\/providers\/([^/]+)\/pricing$/);
      if (req.method() === 'PUT' && priceMatch) {
        const provider = configuration.providers.find((item) => item.id === priceMatch[1]);
        Object.assign(provider, req.postDataJSON(), { pricingUpdatedAt: new Date().toISOString() });
        return route.fulfill({ json: provider });
      }
      if (!['GET', 'OPTIONS'].includes(req.method())) {
        unexpectedWrites.push(`${req.method()} ${path}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    currentPage = page;
    await page.addInitScript(() => { window.__unexpectedPlayback = 0; HTMLMediaElement.prototype.play = function () { window.__unexpectedPlayback++; return Promise.reject(new Error('Playback is disabled in UI tests')); }; });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3010/#aiServices', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '默认模型', exact: true }).waitFor();
    await page.getByRole('combobox', { name: '阿里百炼模型', exact: true }).waitFor();
    await noOverflow(page, width, 'AI 设置');

    await page.getByRole('combobox', { name: 'LLM 服务商', exact: true }).click();
    await page.locator('.ant-select-dropdown:visible:not([class*="-leave"])').getByText('DeepSeek', { exact: true }).click();
    await page.getByRole('combobox', { name: 'LLM 默认模型', exact: true }).click();
    const dropdown = page.locator('.ant-select-dropdown:visible:not([class*="-leave"])');
    assert.ok((await dropdown.innerText()).includes('deepseek-flash'));
    assert.ok(!(await dropdown.innerText()).includes('qwen-flash'));
    await dropdown.locator('.ant-select-item-option').getByText('deepseek-flash', { exact: true }).click();
    await page.getByText('已设为默认对话模型', { exact: true }).waitFor();
    assert.equal(configuration.defaults.LLM, deepseek.id);

    const aliRow = page.locator('.vendor-row').filter({ hasText: '阿里百炼' });
    await aliRow.getByRole('combobox').last().click();
    await page.locator('.ant-select-dropdown:visible:not([class*="-leave"]) .ant-select-item-option').getByText('qwen-flash', { exact: true }).click();
    assert.ok((await aliRow.innerText()).includes('输入 ¥0.15'));
    await aliRow.locator('.price-reference summary').click();
    assert.ok((await aliRow.innerText()).includes('128K'));
    await aliRow.getByRole('button', { name: '修改估算价', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const inputs = dialog.getByRole('spinbutton');
    await inputs.nth(0).fill('0.3');
    await inputs.nth(1).fill('1.6');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await page.getByText('测试估算价已保存，后续测试使用新单价').waitFor();
    assert.equal(configuration.providers.find((item) => item.model === 'qwen-flash').inputPricePerMTokens, 0.3);
    await page.screenshot({ path: `.artifacts/ai-services-pricing-${width}.png`, fullPage: true, animations: 'disabled' });
    await noOverflow(page, width, 'AI 设置修改价格');

    await aliRow.getByRole('combobox').last().click();
    await page.locator('.ant-select-dropdown:visible:not([class*="-leave"]) .ant-select-item-option').getByText('model-price-unknown', { exact: true }).click();
    assert.ok((await aliRow.innerText()).includes('官方价格待确认'));
    assert.ok((await aliRow.innerText()).includes('估算价未配置'));

    await page.locator('.nav-group button').filter({ hasText: '语音验证' }).click();
    await page.getByRole('heading', { name: '当前会话', exact: true }).waitFor();
    await page.getByRole('button', { name: '开发板音量' }).click();
    await page.getByText('设备当前保存 20%', { exact: true }).waitFor();
    await page.getByRole('spinbutton', { name: '开发板播报音量百分比' }).fill('15');
    assert.equal(deviceTtsRequests.length, 0, 'Changing volume never starts playback');
    await page.getByRole('button', { name: '保存音量' }).click();
    await page.getByText('设备当前保存 15%', { exact: true }).waitFor();
    await page.getByRole('button', { name: '开发板音量' }).click();
    assert.deepEqual(volumeSaveRequests, [15]);
    assert.equal(await page.getByText('ASR 专项识别样例', { exact: true }).count(), 0, 'ASR results do not appear under full pipeline');
    assert.equal(await page.getByRole('button', { name: /发送问题/ }).count(), 0);
    assert.equal(await page.locator('.voice-analysis').count(), 0);
    assert.equal(await page.locator('.voice-dialogue-panel').count(), 1);
    assert.equal(await page.locator('.voice-test-progress').count(), 0);
    await noOverflow(page, width, '整链路');
    await page.screenshot({ path: `.artifacts/voice-pipeline-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByText('文字模拟', { exact: true }).click();
    const pipelineInput = page.getByRole('textbox', { name: '整链路文字内容' });
    await pipelineInput.fill('你好');
    await page.getByRole('button', { name: /发送文字/ }).click();
    await page.getByRole('log', { name: '本轮对话记录' }).locator('.voice-user-message').filter({ hasText: '你好' }).waitFor();
    const userBubble = await page.locator('.voice-dialogue-user').first().boundingBox();
    const assistantBubble = await page.locator('.voice-dialogue-assistant').first().boundingBox();
    assert.ok(userBubble.x > assistantBubble.x, 'User messages align right of assistant replies');
    assert.equal(pipelineRequests[0].conversationId, undefined);
    await pipelineInput.fill('接着讲个故事');
    await page.getByRole('button', { name: /发送文字/ }).click();
    await page.getByRole('log').locator('.voice-user-message').filter({ hasText: '接着讲个故事' }).waitFor();
    assert.equal(pipelineRequests[1].conversationId, pipelineConversationId);
    assert.equal(await page.locator('.voice-conversation-turn').count(), 2);
    assert.equal(await page.locator('audio[autoplay]').count(), 0);
    assert.equal(await page.locator('audio').getAttribute('preload'), 'none');
    assert.equal(await page.locator('audio').evaluate((audio) => audio.volume), 0.25);
    await noOverflow(page, width, '连续文字对话');
    await page.screenshot({ path: `.artifacts/voice-conversation-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '新建会话', exact: true }).click();
    assert.equal(await page.locator('.voice-dialogue-panel .voice-conversation-turn').count(), 0);
    assert.equal(resetRequests.at(-1).channel, 'pipeline');
    await pipelineInput.fill('模拟服务失败');
    await page.getByRole('button', { name: /发送文字/ }).click();
    await page.locator('.voice-dialogue-stages').getByText(/测试错误：模型响应格式异常/).waitFor();
    assert.equal(pipelineRequests[2].conversationId, undefined);

    for (const [label, heading] of [['ASR', '语音识别测试'], ['LLM', '对话模型测试'], ['TTS', '语音合成与播放']]) {
      await page.locator('.voice-workbench-toolbar .ant-segmented').getByText(label, { exact: true }).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      if (label === 'ASR') assert.equal(await page.getByText('ASR 专项识别样例', { exact: true }).count(), 2, 'ASR transcript appears in the summary and legacy turn log');
      if (label === 'LLM') {
        const llmInput = page.getByRole('textbox', { name: 'LLM 测试内容' });
        await llmInput.fill('我叫小林');
        await page.getByRole('button', { name: '发送问题' }).click();
        await page.getByRole('log').locator('.voice-user-message').filter({ hasText: '我叫小林' }).waitFor();
        await llmInput.fill('我叫什么');
        await page.getByRole('button', { name: '发送问题' }).click();
        await page.getByRole('log').locator('.voice-user-message').filter({ hasText: '我叫什么' }).waitFor();
        assert.equal(llmRequests[0].conversationId, undefined);
        assert.equal(llmRequests[1].conversationId, llmConversationId);
        assert.equal(deviceTtsRequests.length, 0, 'LLM replies do not play automatically');
        await page.screenshot({ path: `.artifacts/voice-llm-${width}.png`, fullPage: true, animations: 'disabled' });
        await noOverflow(page, width, 'LLM 对话与开发板播报');
        await page.getByRole('button', { name: '播报回答' }).click();
        const llmPlaybackDialog = page.getByRole('dialog');
        await llmPlaybackDialog.getByText(/记住了，你是小林。/).waitFor();
        assert.equal(deviceTtsRequests.length, 0, 'Playback requires explicit confirmation');
        await llmPlaybackDialog.getByRole('button', { name: '确认播报', exact: true }).click();
        await page.getByText('正在播放 · 音量 15%', { exact: true }).waitFor();
        assert.equal(deviceTtsRequests.length, 1);
        assert.equal(deviceTtsRequests[0].text, '记住了，你是小林。');
        await page.getByRole('button', { name: /停止播报/ }).click();
        await page.getByText('已停止 · 音量 15%', { exact: true }).waitFor();
        await page.getByRole('button', { name: '新建会话', exact: true }).click();
        await page.getByRole('log').waitFor({ state: 'detached' });
        assert.equal(resetRequests.at(-1).channel, 'llm-test');
        await llmInput.fill('打开照明');
        await page.getByRole('button', { name: '发送问题' }).click();
        await page.getByText(/本轮识别为设备控制意图，仅预览结果/).waitFor();
        assert.equal(await page.getByRole('button', { name: '播报回答' }).isDisabled(), true);
        assert.equal(deviceTtsRequests.length, 1, 'Control preview is not sent to the speaker');
      }
      if (label === 'TTS') {
        await page.getByRole('button', { name: '测试参数' }).click();
        await page.getByRole('dialog', { name: '测试参数' }).getByText('TTS 音色参数', { exact: true }).click();
        const modelSelect = page.getByRole('combobox', { name: 'TTS 测试模型' });
        const voiceSelect = page.getByRole('combobox', { name: 'TTS 音色' });
        const voiceField = page.locator('.voice-parameter-field').filter({ has: voiceSelect });
        assert.ok((await voiceField.innerText()).includes('使用模型默认音色'));
        await voiceSelect.click();
        await page.locator('.ant-select-dropdown:visible:not([class*="-leave"])').getByText('龙安朗 · 清爽男声').click();
        assert.ok((await voiceField.innerText()).includes('龙安朗'));
        await modelSelect.click();
        await page.locator('.ant-select-dropdown:visible:not([class*="-leave"])').getByText(/Qwen Audio 3.0 TTS Flash/).click();
        assert.ok((await voiceField.innerText()).includes('使用模型默认音色'), 'Switching models clears the previous voice');
        await voiceSelect.click();
        const qwenVoices = page.locator('.ant-select-dropdown:visible:not([class*="-leave"])');
        assert.ok((await qwenVoices.innerText()).includes('龙安风悦'));
        assert.ok(!(await qwenVoices.innerText()).includes('龙安朗'));
        await qwenVoices.getByText('龙安风悦 · 自然女声').click();
        assert.equal(deviceTtsRequests.length, 1, 'Selecting a voice does not start playback');
        await page.getByRole('dialog', { name: '测试参数' }).locator('button.ant-drawer-close').click();
        await page.getByRole('dialog', { name: '测试参数' }).waitFor({ state: 'hidden' });
      }
      assert.equal(await page.getByRole('button', { name: '开始测试', exact: true }).count(), 0);
      await noOverflow(page, width, label);
    }
    await page.getByText('开发板', { exact: true }).click();
    await page.getByRole('button', { name: '播放到开发板' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /浏览器试听/ }).count(), 0);
    await noOverflow(page, width, 'TTS 实板');
    await page.screenshot({ path: `.artifacts/voice-tts-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: /播放到开发板/ }).click();
    await page.getByRole('button', { name: '确认播放', exact: true }).click();
    await page.getByText('正在播放 · 800 ms · 音量 15%', { exact: true }).waitFor();
    assert.equal(deviceTtsRequests.at(-1).voice, 'longanfengyue');
    await page.getByText('整链路', { exact: true }).first().click();
    const runningTask = page.locator('.voice-running-task');
    await runningTask.getByRole('button', { name: '停止开发板', exact: true }).click();
    await runningTask.waitFor({ state: 'detached' });
    assert.equal(audioTask.status, 'CANCELLED', 'Stop remains available after switching tabs');
    await page.getByRole('button', { name: '测试参数' }).click();
    await page.getByRole('dialog', { name: '测试参数' }).getByText('采集与断句参数').click();
    await page.getByRole('spinbutton', { name: '单句尾部静音' }).fill('1200');
    await page.getByRole('spinbutton', { name: '会话无声结束' }).fill('45');
    await page.getByRole('dialog', { name: '测试参数' }).locator('button.ant-drawer-close').click();
    await page.getByRole('dialog', { name: '测试参数' }).waitFor({ state: 'hidden' });
    await page.locator('.voice-action-buttons button').filter({ hasText: '开始测试' }).click();
    assert.equal(voiceStartRequests.length, 1);
    assert.equal(voiceStartRequests[0].continuous, true);
    assert.equal(voiceStartRequests[0].settings.endpointSilenceMs, 1200);
    assert.equal(voiceStartRequests[0].settings.idleTimeoutMs, 45000);
    activeVoiceSession = { ...activeVoiceSession, status: 'WAITING', message: '请继续说话', turns: [{
      id: '00000000-0000-4000-8000-000000000015', at: fixtureTime, durationMs: 1800,
      result: { sessionId: '00000000-0000-4000-8000-000000000015', inputSource: 'DEVICE_AUDIO', transcript: '小东小东，天气怎么样', replyText: '今天适合出门。', route: 'LLM', stages: [], totalLatencyMs: 850, cost: { totalCny: 0.002 } },
    }] };
    await page.locator('.voice-dialogue-panel .voice-user-message').filter({ hasText: '小东小东，天气怎么样' }).waitFor();
    await page.locator('.voice-dialogue-panel .voice-assistant-message').filter({ hasText: '今天适合出门。' }).waitFor();
    assert.equal(await page.locator('.voice-dialogue-panel .voice-conversation-turn').count(), 1, 'Recorded turns are not duplicated by polling');
    await page.getByRole('button', { name: '导出本次实板测试记录' }).waitFor();
    await page.locator('.voice-action-buttons button').filter({ hasText: '停止' }).click();
    await page.getByText('测试已停止', { exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => window.__unexpectedPlayback), 0, 'No media playback was initiated');
    await context.close();
  }
  assert.deepEqual(unexpectedWrites, [], 'No hardware or inference requests');
  assert.deepEqual(errors, [], 'No browser errors');
  console.log('AI 配置、语音四项布局、连续会话、会话重置、错误提示与禁止自动播放检查通过（桌面 / 手机，所有写入均模拟）');
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error('UI state:', (await currentPage.locator('body').innerText()).slice(-7000));
    console.error('Browser errors:', errors);
    await currentPage.screenshot({ path: '.artifacts/ai-voice-ui-failure.png', fullPage: true });
  }
  throw error;
} finally { await browser.close(); }

async function noOverflow(page, width, label) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(size.scroll <= size.client + 1, `${width}px ${label} overflow: ${JSON.stringify(size)}`);
}
