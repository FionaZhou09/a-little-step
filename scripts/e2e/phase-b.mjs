/* Phase B：上船 → 开船 → 钓鱼(咬钩收竿) → 渔获卡 → 下船 → 模式互斥 */
import { launch, openGame, checkErrors, sleep } from "./lib.mjs";

export default async function phaseB() {
  const { browser, page, errors } = await launch();

  console.log("  1. 走到船边");
  await openGame(page, 4);
  await page.evaluate(() => {
    const g = window.game;
    const b = g.boat.group.position;
    g.player.group.position.set(b.x, 0, b.z + 1.5); // 栈道一侧
  });
  await sleep(300);
  const prompt = await page.evaluate(() => {
    const p = document.getElementById("interact-prompt");
    return p.classList.contains("hidden") ? null : p.textContent;
  });
  if (!prompt?.includes("船")) throw new Error("船边没有出现上船提示");

  console.log("  2. 上船 → 开船 3 秒");
  await page.evaluate(() => window.game.tryInteract());
  await sleep(300);
  if (!(await page.evaluate(() => window.game.sailing))) throw new Error("上船失败");
  const before = await page.evaluate(() => ({ ...window.game.boat.group.position }));
  await page.keyboard.down("KeyW");
  await sleep(3000);
  await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => ({ ...window.game.boat.group.position }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const sailable = await page.evaluate(() =>
    window.game.world.isSailable(window.game.boat.group.position.x, window.game.boat.group.position.z)
  );
  console.log(`     船移动 ${moved.toFixed(1)} 单位，水域合法: ${sailable}`);
  if (moved < 3) throw new Error("船没有移动");
  if (!sailable) throw new Error("船开出了可航行水域");

  console.log("  3. sailing 模式互斥（海中央无交互候选）");
  const promptAtSea = await page.evaluate(() => {
    const p = document.getElementById("interact-prompt");
    return p.classList.contains("hidden") ? "(隐藏)" : p.textContent;
  });
  console.log("     海中央提示:", promptAtSea);

  console.log("  4. 钓鱼：抛竿 → 咬钩 → 收竿 → 渔获卡");
  await page.evaluate(() => window.game.fishOrReel());
  await sleep(600);
  let phase = await page.evaluate(() => window.game.fishPhase);
  if (phase !== "waiting") throw new Error(`抛竿失败（phase=${phase}）`);
  let bit = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    phase = await page.evaluate(() => window.game.fishPhase);
    if (phase === "bite") {
      bit = true;
      break;
    }
  }
  if (!bit) throw new Error("等了 9 秒没有咬钩");
  await page.evaluate(() => window.game.fishOrReel());
  await sleep(600);
  const catchInfo = await page.evaluate(() => ({
    open: window.game.catchOpen,
    fishes: window.game.fishes,
    visible: !document.getElementById("catch-card").classList.contains("hidden"),
  }));
  if (!catchInfo.open || !catchInfo.visible || catchInfo.fishes !== 1) throw new Error("渔获卡未正确弹出");
  await page.evaluate(() => document.querySelector("#catch-card button")?.click());
  await sleep(300);
  if (!(await page.evaluate(() => document.getElementById("catch-card").classList.contains("hidden"))))
    throw new Error("渔获卡关不掉");

  console.log("  5. 回岸下船");
  await page.evaluate(() => {
    window.game.boat.group.position.set(1.9, 0, -25.5);
  });
  await sleep(300);
  const landPrompt = await page.evaluate(() => {
    const p = document.getElementById("interact-prompt");
    return p.classList.contains("hidden") ? null : p.textContent;
  });
  if (!landPrompt?.includes("下船")) throw new Error("没有出现下船提示");
  await page.evaluate(() => window.game.tryInteract());
  await sleep(300);
  const landed = await page.evaluate(() => {
    const g = window.game;
    const p = g.player.group.position;
    return { sailing: g.sailing, walkable: g.world.isWalkable(p.x, p.z) };
  });
  if (landed.sailing || !landed.walkable) throw new Error("下船落点不对");

  await browser.close();
  return checkErrors(errors);
}
