import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
await mkdir(".artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: edgePath,
});
const failures = [];
const developmentSections = [
  ["voice", "语音验证"],
  ["testing", "样机联调"],
  ["batchTesting", "批量测试"],
  ["flashing", "固件烧录"],
  ["aiServices", "AI 服务"],
];
const operationsSections = [
  ["overview", "运营总览"],
  ["devices", "设备管理"],
  ["records", "告警与日志"],
  ["knowledge", "知识库"],
  ["ai", "AI 运营"],
  ["system", "系统状态"],
];
const labSections = [
  ["scenarios", "场景模拟"],
  ["ai", "对话验证"],
  ["speech", "语音模块"],
  ["sets", "测试集"],
];

try {
  await verifyDevelopmentDesktop();
  await verifyOperationsDesktop();
  await verifyLabDesktop();
  await verifyMobileConsole({
    baseUrl: "http://127.0.0.1:3010/",
    sections: developmentSections,
    navSelector: ".nav-group button",
    label: "研发中心移动端",
    captureSection: "voice",
    screenshot: ".artifacts/development-voice-mobile.png",
  });
  await verifyMobileConsole({
    baseUrl: "http://127.0.0.1:3020/",
    sections: operationsSections,
    navSelector: ".ops-nav-group button",
    label: "运营平台移动端",
    captureSection: "overview",
    screenshot: ".artifacts/operations-overview-mobile.png",
  });
  await verifyMobileConsole({
    baseUrl: "http://127.0.0.1:3020/lab.html",
    sections: labSections,
    navSelector: ".lab-sidebar nav button",
    label: "云端研发工作台移动端",
    captureSection: "scenarios",
    screenshot: ".artifacts/lab-scenarios-mobile.png",
  });
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("[console-smoke] development, operations and cloud lab consoles passed");

async function verifyDevelopmentDesktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, "研发中心");
  await page.goto("http://127.0.0.1:3010/#voice", {
    waitUntil: "networkidle",
  });
  for (const [section, title] of developmentSections) {
    if (section !== "voice") {
      await page.locator(".nav-group button", { hasText: title }).click();
    }
    await page
      .getByRole("heading", { name: title, exact: true })
      .first()
      .waitFor();
    await assertNoPageOverflow(page, `研发中心/${section}`);
  }

  await page.locator(".nav-group button", { hasText: "样机联调" }).click();
  await page
    .getByRole("heading", { name: "STM32 实时协议监听", exact: true })
    .waitFor();
  const consoleResponse = await page.request.get(
    "http://127.0.0.1:3077/api/development/console",
  );
  const consoleData = await consoleResponse.json();
  const sampleDevice = consoleData.devices.find((device) =>
    device.model.includes("LICHUANG-AUDIO"),
  );
  const capabilities = sampleDevice?.capabilities || {};
  const sampleOnline = sampleDevice?.status === "ONLINE";
  const enabledCommands = await page
    .locator(".command-group button:enabled")
    .count();
  if (!capabilities.stm32UartControl && enabledCommands !== 0) {
    failures.push(
      `研发中心/样机联调：只读固件仍有${enabledCommands}个控制按钮可用`,
    );
  }
  await assertCommandGate(page, "照明", sampleOnline && capabilities.stm32LightControl);
  await assertCommandGate(page, "风路", sampleOnline && capabilities.stm32AirControl);
  await assertDangerousCommandGate(
    page,
    ["弱暖", "强暖"],
    sampleOnline && capabilities.stm32HeaterControl,
  );
  const constantTemperatureEnabled = await page
    .locator(".command-group button", { hasText: "恒温（待协议支持）" })
    .isEnabled();
  if (constantTemperatureEnabled) {
    failures.push("研发中心/样机联调：样机协议不支持恒温，但按钮处于可用状态");
  }
  if (sampleOnline && capabilities.stm32HeaterControl && await page.locator(".command-group button", { hasText: "弱暖" }).isEnabled()) {
    const commandsBefore = await page.request.get(
      `http://127.0.0.1:3077/api/devices/${sampleDevice.id}/commands`,
    );
    const commandCountBefore = (await commandsBefore.json()).length;
    await page
      .locator(".command-group button", { hasText: "弱暖" })
      .click();
    await page
      .locator(".ant-modal-confirm-title", { hasText: "确认执行“弱暖”" })
      .waitFor();
    await page.locator(".ant-modal-confirm-btns .ant-btn-default").click();
    const commandsAfter = await page.request.get(
      `http://127.0.0.1:3077/api/devices/${sampleDevice.id}/commands`,
    );
    const commandCountAfter = (await commandsAfter.json()).length;
    if (commandCountAfter !== commandCountBefore) {
      failures.push("研发中心/样机联调：取消取暖确认后仍产生了设备命令");
    }
  }
  await page.screenshot({
    path: ".artifacts/development-sample-link-desktop.png",
    fullPage: true,
  });

  await page.locator(".nav-group button", { hasText: "语音验证" }).click();
  await page
    .getByRole("heading", { name: "当前会话", exact: true })
    .waitFor();
  await page.getByRole('button', { name: '测试参数' }).click();
  await page.getByRole('dialog', { name: '测试参数' }).getByText('采集与断句参数').waitFor();
  await page.getByRole('dialog', { name: '测试参数' }).locator('button.ant-drawer-close').click();
  await page.getByRole('dialog', { name: '测试参数' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '场景模拟' }).click();
  await page.getByRole('dialog', { name: '场景模拟' }).getByText('断网 · 固定词').waitFor();
  const proactivePanel = page.getByRole('dialog', { name: '场景模拟' });
  await proactivePanel.getByRole('heading', { name: '主动沟通 · 硬件模拟' }).waitFor();
  await proactivePanel.getByRole('combobox', { name: '主动沟通模拟事件' }).waitFor();
  await proactivePanel.getByRole('button', { name: '预览判断' }).waitFor();
  await proactivePanel.getByRole('button', { name: '播报并收听回答' }).waitFor();
  await page.getByRole('dialog', { name: '场景模拟' }).locator('button.ant-drawer-close').click();
  await page.getByRole('dialog', { name: '场景模拟' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '历史记录' }).click();
  await page.getByRole('dialog', { name: '历史记录' }).waitFor();
  await page.getByRole('dialog', { name: '历史记录' }).locator('button.ant-drawer-close').click();
  await page.getByRole('dialog', { name: '历史记录' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".artifacts/development-voice-desktop.png",
    fullPage: true,
  });
  await page.locator(".nav-group button", { hasText: "AI 服务" }).click();
  await page
    .getByRole("heading", { name: "默认模型", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".artifacts/development-ai-services-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".nav-group button", { hasText: "批量测试" })
    .click();
  await page
    .getByRole("heading", { name: "批量任务记录", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".artifacts/development-batch-testing-desktop.png",
    fullPage: true,
  });
  await context.close();
}

async function assertCommandGate(page, groupName, expectedEnabled) {
  const group = page.locator(".command-group", {
    has: page.locator(":scope > span", { hasText: groupName }),
  });
  const enabled = await group.locator("button:enabled").count();
  const total = await group.locator("button").count();
  if ((expectedEnabled && enabled !== total) || (!expectedEnabled && enabled !== 0)) {
    failures.push(
      `研发中心/样机联调：${groupName}门禁不符合设备能力（${enabled}/${total}可用）`,
    );
  }
}

async function assertDangerousCommandGate(page, labels, expectedEnabled) {
  for (const label of labels) {
    const enabled = await page
      .locator(".command-group button", { hasText: label })
      .isEnabled();
    if (enabled !== Boolean(expectedEnabled)) {
      failures.push(
        `研发中心/样机联调：危险动作“${label}”门禁与设备能力不一致`,
      );
    }
  }
}

async function verifyOperationsDesktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, "运营平台");
  await page.goto("http://127.0.0.1:3020/#overview", {
    waitUntil: "networkidle",
  });
  for (const [section, title] of operationsSections) {
    if (section !== "overview") {
      await page.locator(".ops-nav-group button", { hasText: title }).click();
    }
    await page
      .getByRole("heading", { name: title, exact: true })
      .first()
      .waitFor();
    await assertNoPageOverflow(page, `运营平台/${section}`);
  }
  await page.locator(".ops-nav-group button", { hasText: "设备管理" }).click();
  const operationDeviceIds = await page
    .locator(".device-name code")
    .allTextContents();
  if (operationDeviceIds.some((id) => id.includes("SIMULATOR"))) {
    failures.push("运营平台/设备管理：出现研发模拟器设备");
  }
  if (operationDeviceIds.some((id) => /SUPERMINI|LICHUANG|DEVKIT/i.test(id))) {
    failures.push("运营平台/设备管理：出现研发开发板设备");
  }
  await page.locator(".ops-nav-group button", { hasText: "AI 运营" }).click();
  await page.getByRole('heading', { name: '线上默认模型' }).waitFor();
  await page.getByRole('heading', { name: '语音识别测试' }).waitFor();
  await page.getByLabel('选择 ASR 测试音频').waitFor();
  await assertNoPageOverflow(page, '运营平台/服务配置');
  await page.screenshot({ path: '.artifacts/operations-ai-services-desktop.png', fullPage: true });
  await page.locator('.ant-segmented-item', { hasText: '运行策略' }).click();
  await page.getByText("安静时段", { exact: true }).first().waitFor();
  await page.getByLabel("安静时段开始").waitFor();
  await page.locator('.ant-segmented-item', { hasText: '运行策略' }).click();
  await assertNoPageOverflow(page, "运营平台/主动沟通设置");
  await page.screenshot({ path: ".artifacts/operations-ai-desktop.png", fullPage: true });
  await page.locator('.ops-nav-group button', { hasText: '告警与日志' }).click();
  await page.locator('.ant-segmented-item', { hasText: '语音记录' }).click();
  await page.getByRole('heading', { name: '线上语音记录' }).waitFor();
  await assertNoPageOverflow(page, '运营平台/语音记录');
  await page.screenshot({ path: '.artifacts/operations-voice-history-desktop.png', fullPage: true });
  await page.locator(".ops-nav-group button", { hasText: "运营总览" }).click();
  await page.getByRole('button', { name: '待处理事项' }).click();
  await page.getByRole('dialog', { name: '待处理事项' }).waitFor();
  await page.getByRole('dialog', { name: '待处理事项' }).locator('button.ant-drawer-close').click();
  await page.getByRole('dialog', { name: '待处理事项' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".artifacts/operations-overview-desktop.png",
    fullPage: true,
  });
  await context.close();
}

async function verifyLabDesktop() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, '云端研发工作台');
  await page.goto('http://127.0.0.1:3020/lab.html#scenarios', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '场景模拟', exact: true }).waitFor();
  await page.getByRole('heading', { name: '断网 · 固定命令' }).waitFor();
  await page.getByRole('button', { name: '运行模拟' }).click();
  await page.getByText('未发送 MQTT').waitFor();
  await assertNoPageOverflow(page, '云端研发工作台/场景模拟');
  await page.screenshot({ path: '.artifacts/lab-scenarios-desktop.png', fullPage: true });
  await page.locator('.lab-sidebar nav button', { hasText: '对话验证' }).click();
  await page.getByLabel('单条测试语料').waitFor();
  if (await page.getByRole('button', { name: '运行验证' }).isEnabled()) {
    failures.push('云端研发工作台/对话验证：空语料时仍能发起付费模型调用');
  }
  await assertNoPageOverflow(page, '云端研发工作台/对话验证');
  await page.locator('.lab-sidebar nav button', { hasText: '语音模块' }).click();
  await page.getByLabel('ASR 测试音频').waitFor();
  await page.getByLabel('TTS 合成文本').waitFor();
  await assertNoPageOverflow(page, '云端研发工作台/语音模块');
  await page.locator('.lab-sidebar nav button', { hasText: '测试集' }).click();
  await page.getByRole('button', { name: '新建测试集' }).waitFor();
  await assertNoPageOverflow(page, '云端研发工作台/测试集');
  await context.close();
}

async function verifyMobileConsole({
  baseUrl,
  sections,
  navSelector,
  label,
  captureSection,
  screenshot,
}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    isMobile: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, label);
  await page.goto(`${baseUrl}#${sections[0][0]}`, { waitUntil: "networkidle" });
  for (const [section, title] of sections) {
    if (section !== sections[0][0]) {
      await page.locator(navSelector, { hasText: title }).click();
    }
    await page
      .getByRole("heading", { name: title, exact: true })
      .first()
      .waitFor();
    await assertNoPageOverflow(page, `${label}/${section}`);
    if (label === '运营平台移动端' && section === 'records') {
      await page.locator('.ant-segmented-item', { hasText: '语音记录' }).click();
      await page.getByRole('heading', { name: '线上语音记录' }).waitFor();
      await assertNoPageOverflow(page, `${label}/语音记录`);
      await page.screenshot({ path: '.artifacts/operations-voice-history-mobile.png', fullPage: true });
    }
    if (label === '运营平台移动端' && section === 'ai') {
      await page.getByRole('heading', { name: '线上默认模型' }).waitFor();
      await assertNoPageOverflow(page, `${label}/服务配置`);
      await page.screenshot({ path: '.artifacts/operations-ai-services-mobile.png', fullPage: true });
    }
  }
  const visibleIcons = await page.locator("aside nav svg:visible").count();
  if (visibleIcons < sections.length)
    failures.push(`${label}：侧栏导航图标未正确显示`);
  const captureTitle = sections.find(
    ([section]) => section === captureSection,
  )?.[1];
  if (captureTitle) {
    await page.locator(navSelector, { hasText: captureTitle }).click();
    await page
      .getByRole("heading", { name: captureTitle, exact: true })
      .first()
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshot, fullPage: true });
  }
  await context.close();
}

function monitor(page, label) {
  page.on("pageerror", (error) =>
    failures.push(`${label}页面异常：${error.message}`),
  );
  page.on("console", (entry) => {
    if (entry.type() === "error")
      failures.push(`${label}控制台错误：${entry.text()}`);
  });
  page.on("requestfailed", (request) =>
    failures.push(
      `${label}请求失败：${request.url()} ${request.failure()?.errorText || ""}`,
    ),
  );
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[
            ...element.classList,
          ]
            .slice(0, 3)
            .map((name) => `.${name}`)
            .join("")}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.left < viewport && item.right > viewport + 1)
      .sort(
        (a, b) =>
          Math.abs(a.right - document.documentElement.scrollWidth) -
          Math.abs(b.right - document.documentElement.scrollWidth),
      )
      .slice(0, 12);
    return {
      viewport,
      scroll: document.documentElement.scrollWidth,
      offenders,
    };
  });
  if (overflow.scroll > overflow.viewport + 1) {
    failures.push(
      `${label}：页面横向溢出 ${overflow.scroll - overflow.viewport}px；超宽元素 ${JSON.stringify(overflow.offenders)}`,
    );
  }
}
