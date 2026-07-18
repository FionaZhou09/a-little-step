/* 共用：无头 Chrome 启动、错误收集、等待 */
import puppeteer from "puppeteer-core";

export const URL = process.env.E2E_URL ?? "http://localhost:5173/";
export const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动浏览器并收集 console.error / pageerror（favicon 404 忽略） */
export async function launch() {
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  return { browser, page, errors };
}

/** 打开页面并等游戏就绪（默认 4 村民示例包；可用 n 指定数量） */
export async function openGame(page, villagerCount = 4) {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForFunction((n) => window.game?.villagers?.length === n, { timeout: 15000 }, villagerCount);
  await sleep(800);
}

/** 过滤后的真实页面错误；有则打印并返回 false */
export function checkErrors(errors) {
  const real = [...new Set(errors)].filter((e) => !e.includes("favicon"));
  if (real.length) {
    console.log(`发现 ${real.length} 个页面错误:`);
    for (const e of real) console.log("  " + e);
    return false;
  }
  return true;
}
