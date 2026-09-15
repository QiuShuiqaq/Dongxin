import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
await mkdir(".artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: edgePath });
const failures = [];
const developmentSections = [
  ["overview", "研发总览"],
  ["topology", "系统拓扑"],
  ["pins", "引脚与 IO"],
  ["firmware", "固件执行链"],
  ["testing", "实板联调"],
  ["voice", "AI 与语音"],
  ["delivery", "版本交付"],
];
const operationsSections = [
  ["overview", "运营总览"],
  ["devices", "设备中心"],
  ["bindings", "激活与绑定"],
  ["alerts", "告警与售后"],
  ["releases", "版本发布"],
  ["ai", "AI 运营"],
  ["audit", "审计安全"],
  ["system", "基础设施"],
];

try {
  await verifyDevelopmentDesktop();
  await verifyOperationsDesktop();
  await verifyMobileConsole({
    baseUrl: "http://127.0.0.1:3010",
    sections: developmentSections,
    navSelector: ".nav-group button",
    label: "研发中心移动端",
    captureSection: "pins",
    screenshot: ".artifacts/development-pins-mobile.png",
  });
  await verifyMobileConsole({
    baseUrl: "http://127.0.0.1:3020",
    sections: operationsSections,
    navSelector: ".ops-nav-group button",
    label: "运营平台移动端",
    captureSection: "overview",
    screenshot: ".artifacts/operations-overview-mobile.png",
  });
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("[console-smoke] development and operations consoles passed");

async function verifyDevelopmentDesktop() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, "研发中心");
  await page.goto("http://127.0.0.1:3010/#overview", { waitUntil: "networkidle" });
  for (const [section, title] of developmentSections) {
    if (section !== "overview") {
      await page.locator(".nav-group button", { hasText: title }).click();
    }
    await page.getByRole("heading", { name: title, exact: true }).first().waitFor();
    await assertNoPageOverflow(page, `研发中心/${section}`);
  }

  await page.locator(".nav-group button", { hasText: "引脚与 IO" }).click();
  const boardContext = page.locator(".context-item").filter({ hasText: "板卡" });
  await boardContext.locator(".ant-select").click();
  await page.getByText("DX-AI-01 Mainboard · Rev.A 规划稿", { exact: true }).click();
  await page.getByText("PCF8574", { exact: true }).click();
  await page.locator(".port-row").first().waitFor();
  const portCount = await page.locator(".port-row").count();
  if (portCount !== 24) failures.push(`研发中心/IO矩阵：期望24路，实际${portCount}路`);

  await boardContext.locator(".ant-select").click();
  await page.getByText("ESP32-C3 SuperMini HW-466AB · 开发验证板", { exact: true }).click();
  await page.locator(".nav-group button", { hasText: "实板联调" }).click();
  const turnOn = page.locator(".command-group button").first();
  const virtualMode = await page.locator(".ant-alert", { hasText: "LOCAL_VIRTUAL" }).isVisible();
  if (virtualMode && await turnOn.isEnabled()) {
    await turnOn.click();
    await page.getByText("开启照明已执行", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "整机待机" }).click();
    await page.getByText("整机待机已执行", { exact: true }).waitFor({ timeout: 10000 });
  }
  await page.locator(".nav-group button", { hasText: "固件执行链" }).click();
  await page.locator(".ant-message-notice").last().waitFor({ state: "hidden", timeout: 6000 });
  await page.screenshot({ path: ".artifacts/development-trace-desktop.png" });
  await boardContext.locator(".ant-select").click();
  await page.getByText("DX-AI-01 Mainboard · Rev.A 规划稿", { exact: true }).click();
  await page.locator(".nav-group button", { hasText: "系统拓扑" }).click();
  await page.keyboard.press("Escape");
  await page.locator(".ant-select-dropdown").last().waitFor({ state: "hidden", timeout: 3000 });
  await page.screenshot({ path: ".artifacts/development-topology-desktop.png" });
  await context.close();
}

async function verifyOperationsDesktop() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, "运营平台");
  await page.goto("http://127.0.0.1:3020/#overview", { waitUntil: "networkidle" });
  for (const [section, title] of operationsSections) {
    if (section !== "overview") {
      await page.locator(".ops-nav-group button", { hasText: title }).click();
    }
    await page.getByRole("heading", { name: title, exact: true }).first().waitFor();
    await assertNoPageOverflow(page, `运营平台/${section}`);
  }
  await page.locator(".ops-nav-group button", { hasText: "设备中心" }).click();
  const operationDeviceIds = await page.locator(".device-name code").allTextContents();
  if (operationDeviceIds.some((id) => id.includes("SIMULATOR"))) {
    failures.push("运营平台/设备中心：出现研发模拟器设备");
  }
  await page.locator(".ops-nav-group button", { hasText: "运营总览" }).click();
  await page.screenshot({ path: ".artifacts/operations-overview-desktop.png" });
  await context.close();
}

async function verifyMobileConsole({ baseUrl, sections, navSelector, label, captureSection, screenshot }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", isMobile: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, label);
  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  for (const [section, title] of sections) {
    if (section !== "overview") await page.locator(navSelector, { hasText: title }).click();
    await page.getByRole("heading", { name: title, exact: true }).first().waitFor();
    await assertNoPageOverflow(page, `${label}/${section}`);
  }
  const visibleIcons = await page.locator("aside nav svg:visible").count();
  if (visibleIcons < 6) failures.push(`${label}：侧栏导航图标未正确显示`);
  const captureTitle = sections.find(([section]) => section === captureSection)?.[1];
  if (captureTitle) {
    await page.locator(navSelector, { hasText: captureTitle }).click();
    await page.getByRole("heading", { name: captureTitle, exact: true }).first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshot });
  }
  await context.close();
}

function monitor(page, label) {
  page.on("pageerror", (error) => failures.push(`${label}页面异常：${error.message}`));
  page.on("console", (entry) => {
    if (entry.type() === "error") failures.push(`${label}控制台错误：${entry.text()}`);
  });
  page.on("requestfailed", (request) =>
    failures.push(`${label}请求失败：${request.url()} ${request.failure()?.errorText || ""}`),
  );
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 3).map((name) => `.${name}`).join("")}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.left < viewport && item.right > viewport + 1)
      .sort((a, b) => Math.abs(a.right - document.documentElement.scrollWidth) - Math.abs(b.right - document.documentElement.scrollWidth))
      .slice(0, 12);
    return { viewport, scroll: document.documentElement.scrollWidth, offenders };
  });
  if (overflow.scroll > overflow.viewport + 1) {
    failures.push(`${label}：页面横向溢出 ${overflow.scroll - overflow.viewport}px；超宽元素 ${JSON.stringify(overflow.offenders)}`);
  }
}
