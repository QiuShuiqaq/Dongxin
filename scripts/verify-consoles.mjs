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
  ["overview", "研发总览"],
  ["testing", "样机联调"],
  ["flashing", "固件与烧录"],
  ["aiServices", "AI 服务配置"],
  ["voice", "在线语音"],
  ["batchTesting", "批量测试与报告"],
];
const operationsSections = [
  ["overview", "运营总览"],
  ["devices", "设备管理"],
  ["records", "告警与日志"],
  ["knowledge", "知识库"],
  ["ai", "AI 运营"],
  ["system", "系统状态"],
];

try {
  await verifyDevelopmentDesktop();
  await verifyOperationsDesktop();
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
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("[console-smoke] development and operations consoles passed");

async function verifyDevelopmentDesktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  monitor(page, "研发中心");
  await page.goto("http://127.0.0.1:3010/#overview", {
    waitUntil: "networkidle",
  });
  for (const [section, title] of developmentSections) {
    if (section !== "overview") {
      await page.locator(".nav-group button", { hasText: title }).click();
    }
    await page
      .getByRole("heading", { name: title, exact: true })
      .first()
      .waitFor();
    await assertNoPageOverflow(page, `研发中心/${section}`);
  }

  await page.locator(".nav-group button", { hasText: "样机联调" }).click();
  await page.getByText("只读，发送已锁定", { exact: true }).waitFor();
  const enabledCommands = await page
    .locator(".command-group button:enabled")
    .count();
  if (enabledCommands !== 0) {
    failures.push(
      `研发中心/样机联调：只读模式仍有${enabledCommands}个控制按钮可用`,
    );
  }
  await page.screenshot({
    path: ".artifacts/development-sample-link-desktop.png",
    fullPage: true,
  });

  await page.locator(".nav-group button", { hasText: "在线语音" }).click();
  await page
    .getByRole("heading", { name: "实板语音测试", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".artifacts/development-voice-desktop.png",
    fullPage: true,
  });
  await page.locator(".nav-group button", { hasText: "AI 服务配置" }).click();
  await page
    .getByRole("heading", { name: "默认 AI 服务", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".artifacts/development-ai-services-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".nav-group button", { hasText: "批量测试与报告" })
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
  await page.locator(".ops-nav-group button", { hasText: "运营总览" }).click();
  await page.screenshot({
    path: ".artifacts/operations-overview-desktop.png",
    fullPage: true,
  });
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
  await page.goto(`${baseUrl}#overview`, { waitUntil: "networkidle" });
  for (const [section, title] of sections) {
    if (section !== "overview") {
      await page.locator(navSelector, { hasText: title }).click();
    }
    await page
      .getByRole("heading", { name: title, exact: true })
      .first()
      .waitFor();
    await assertNoPageOverflow(page, `${label}/${section}`);
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
