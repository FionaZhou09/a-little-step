/* Phase A：村民名单 → 摇树 → 进出小屋+惊喜 → 预习→quiz→庆典 → 吃苹果 → 自定义名单 */
import { launch, openGame, checkErrors, sleep } from "./lib.mjs";

export default async function phaseA() {
  const { browser, page, errors } = await launch();

  console.log("  1. 加载：4 村民（含 Kiki fox）");
  await openGame(page, 4);
  const roster = await page.evaluate(() => window.game.villagers.map((v) => `${v.name}:${v.kind}`));
  console.log("     村民:", roster.join(", "));
  if (!roster.includes("Kiki:fox")) throw new Error("Kiki fox 未生成");

  console.log("  2. 摇苹果树");
  const appleBefore = await page.evaluate(() => window.game.apples);
  // 换角度直到锁定"树"候选（村民可能正好在树下闲逛）
  let treeLocked = false;
  for (let i = 0; i < 8 && !treeLocked; i++) {
    const angle = (i / 8) * Math.PI * 2;
    treeLocked = await page.evaluate(
      (a) => {
        const g = window.game;
        const t = g.world.shakeTrees[0];
        g.player.group.position.set(t.x + Math.cos(a) * 1.3, 0, t.z + Math.sin(a) * 1.3);
        return new Promise((resolve) => setTimeout(() => resolve(g.interactCandidate?.kind === "tree"), 280));
      },
      angle
    );
  }
  if (!treeLocked) throw new Error("锁定摇树候选失败");
  await page.evaluate(() => window.game.tryInteract());
  await sleep(2500);
  const appleAfter = await page.evaluate(() => window.game.apples);
  console.log(`     苹果: ${appleBefore} → ${appleAfter}`);
  if (appleAfter <= appleBefore) throw new Error("摇树没有收到苹果");

  console.log("  3. 进出小屋 + 主题惊喜");
  await page.evaluate(() => {
    const g = window.game;
    const h = g.world.houses[0];
    g.player.group.position.set(h.door.x, 0, h.door.z);
  });
  await sleep(200);
  await page.evaluate(() => window.game.tryInteract());
  await sleep(800);
  if (!(await page.evaluate(() => !!window.game.indoors))) throw new Error("没有进入房间");
  await page.evaluate(() => {
    const g = window.game;
    const r = g.indoors;
    const rp = r.group.position;
    g.player.group.position.set(rp.x + r.surprise.x + 0.5, 0, rp.z + r.surprise.z + 0.5);
  });
  await sleep(200);
  await page.evaluate(() => window.game.tryInteract());
  await sleep(600);
  await page.evaluate(() => {
    const g = window.game;
    const r = g.indoors;
    const rp = r.group.position;
    g.player.group.position.set(rp.x + r.doorLocal.x, 0, rp.z + r.doorLocal.z);
  });
  await sleep(200);
  await page.evaluate(() => window.game.tryInteract());
  await sleep(800);
  if (await page.evaluate(() => !!window.game.indoors)) throw new Error("没有退出房间");

  console.log("  4. 学习流程回归（4 村民预习 → quiz → 庆典）");
  async function talkToVillager(i) {
    const name = await page.evaluate((idx) => window.game.villagers[idx].name, i);
    // 村民会漫游：传送到 TA 身边并确认锁定的是本人，最多重试 5 次
    let locked = false;
    for (let tries = 0; tries < 5 && !locked; tries++) {
      await page.evaluate((idx) => {
        const g = window.game;
        const v = g.villagers[idx];
        const p = v.rig.group.position;
        g.player.group.position.set(p.x + 1.0, 0, p.z + 1.0);
      }, i);
      await sleep(250);
      locked = await page.evaluate(
        (n) => {
          const c = window.game.interactCandidate;
          return c?.kind === "villager" && c.villager?.name === n;
        },
        name
      );
    }
    if (!locked) throw new Error(`靠近村民 ${name} 失败`);
    await page.evaluate(() => window.game.tryInteract());
    await sleep(300);
    for (let s = 0; s < 50; s++) {
      if (!(await page.evaluate(() => window.game.session.isBusy()))) break;
      await page.evaluate(() => window.game.session.advance());
      await sleep(150);
    }
  }
  for (let i = 0; i < 4; i++) await talkToVillager(i);
  if (!(await page.evaluate(() => window.game.session.allPreviewed()))) throw new Error("预习未完成");
  // quiz
  {
    let locked = false;
    for (let tries = 0; tries < 5 && !locked; tries++) {
      await page.evaluate(() => {
        const g = window.game;
        const p = g.villagers[0].rig.group.position;
        g.player.group.position.set(p.x + 1.0, 0, p.z + 1.0);
      });
      await sleep(250);
      locked = await page.evaluate(() => window.game.interactCandidate?.kind === "villager");
    }
  }
  await page.evaluate(() => window.game.tryInteract());
  await sleep(400);
  for (let q = 0; q < 25; q++) {
    if (await page.evaluate(() => !window.game.session.isBusy() || window.game.session.allStarred())) break;
    await page.evaluate(() => {
      const s = window.game.session;
      const btn = [...document.querySelectorAll("#quiz-options button")].find(
        (b) => b.textContent === s.quizWord?.emoji
      );
      btn?.click();
    });
    await sleep(1050);
  }
  if (!(await page.evaluate(() => window.game.session.allStarred()))) throw new Error("quiz 未完成");
  await page.evaluate(() => {
    const g = window.game;
    const c = g.world.plazaCenter;
    g.player.group.position.set(c.x + 1, 0, c.z + 1);
  });
  await sleep(1000);
  if (!(await page.evaluate(() => window.game.celebrated))) throw new Error("庆典未触发");
  console.log("     预习/复习/庆典全部完成");

  console.log("  5. 吃苹果（F 键）");
  const beforeEat = await page.evaluate(() => window.game.apples);
  if (beforeEat > 0) {
    await page.keyboard.press("KeyF");
    await sleep(400);
    const afterEat = await page.evaluate(() => window.game.apples);
    if (afterEat !== beforeEat - 1) throw new Error("吃苹果计数不对");
  }

  console.log("  6. 自定义名单（duck + panda）导入后 reload");
  await page.evaluate(() => {
    const pack = {
      date: "2026-07-19",
      title: "On the Farm",
      villagers: [
        { name: "Dodo", animal: "duck" },
        { name: "Pang", animal: "panda" },
      ],
      words: [
        { word: "cow", emoji: "🐄", zh: "奶牛", sentence: "The cow says moo.", sentenceZh: "奶牛哞哞叫。" },
        { word: "pig", emoji: "🐷", zh: "猪", sentence: "The pig is pink.", sentenceZh: "猪是粉色的。" },
        { word: "duck", emoji: "🦆", zh: "鸭子", sentence: "The duck can swim.", sentenceZh: "鸭子会游泳。" },
        { word: "sheep", emoji: "🐑", zh: "羊", sentence: "The sheep is white.", sentenceZh: "羊是白色的。" },
      ],
      story: [
        { speaker: "Dodo", en: "Quack! Welcome to the farm!", zh: "嘎！欢迎来到农场！" },
        { speaker: "Pang", en: "Look at the big cow!", zh: "看那头大奶牛！" },
        { speaker: "Dodo", en: "The duck swims in the pond.", zh: "鸭子在池塘里游泳。" },
        { speaker: "Pang", en: "The sheep is soft and white.", zh: "绵羊又软又白。" },
      ],
    };
    localStorage.setItem("a-little-step.lesson", JSON.stringify(pack));
  });
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.game?.villagers?.length === 2, { timeout: 15000 });
  const roster2 = await page.evaluate(() => window.game.villagers.map((v) => `${v.name}:${v.kind}`));
  console.log("     新村民:", roster2.join(", "));
  if (!roster2.includes("Dodo:duck") || !roster2.includes("Pang:panda")) throw new Error("自定义名单未生效");
  await page.evaluate(() => localStorage.removeItem("a-little-step.lesson"));

  await browser.close();
  return checkErrors(errors);
}
