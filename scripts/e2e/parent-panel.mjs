/* 家长面板：复制提示词（正常路径 + 全失败兜底路径）、坏 JSON 校验 */
import { launch, openGame, checkErrors, sleep, URL as BASE_URL } from "./lib.mjs";

export default async function parentPanel() {
  const { browser, page, errors } = await launch();

  console.log("  1. 复制提示词：正常路径写入剪贴板");
  await openGame(page, 4);
  await page.evaluate(() => document.getElementById("btn-parent").click());
  await page
    .browser()
    .defaultBrowserContext()
    .overridePermissions(new URL(BASE_URL).origin, [
      "clipboard-read",
      "clipboard-write",
      "clipboard-sanitized-write",
    ]);
  await page.evaluate(() => document.getElementById("btn-copy-prompt").click());
  await sleep(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  if (!clip.startsWith("你是一位")) throw new Error("剪贴板没拿到提示词");
  console.log("     剪贴板前 12 字:", JSON.stringify(clip.slice(0, 12)));

  console.log("  2. 全失败路径：必须显示手动复制框，且不得谎报成功");
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    document.execCommand = () => false;
  });
  await page.evaluate(() => document.getElementById("btn-copy-prompt").click());
  await sleep(500);
  const s2 = await page.evaluate(() => ({
    fallbackShown: !document.getElementById("prompt-fallback").classList.contains("hidden"),
    manualText: document.getElementById("prompt-manual").value.slice(0, 12),
    lastToast: [...document.querySelectorAll(".toast")].pop()?.textContent ?? "",
  }));
  if (!s2.fallbackShown || !s2.manualText.startsWith("你是一位")) throw new Error("手动复制框没出来");
  if (s2.lastToast.includes("已复制")) throw new Error("失败时谎报成功");
  console.log("     手动复制框已显示，toast:", s2.lastToast);

  console.log("  3. 坏 JSON 导入给出中文报错");
  await page.type("#import-text", "{bad json", { delay: 5 });
  await page.evaluate(() => document.getElementById("btn-import-text").click());
  const errText = await page.$eval("#import-error", (e) => e.textContent);
  if (!errText?.includes("JSON")) throw new Error("导入校验未生效");

  await browser.close();
  return checkErrors(errors);
}
