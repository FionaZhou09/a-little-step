/* e2e 总入口：自动起 dev server → 依次跑全部套件 → 关 server */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5173;
const URL = `http://localhost:${PORT}/`;

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  throw new Error("dev server 启动超时");
}

const server = spawn("npm", ["run", "dev", "--", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
});
process.on("exit", () => server.kill());

let failed = 0;
try {
  await waitForServer();
  const suites = [
    ["Phase A（村民/摇树/小屋/学习流程）", (await import("./phase-a.mjs")).default],
    ["Phase B（小船出海/钓鱼）", (await import("./phase-b.mjs")).default],
    ["家长面板（复制提示词/导入校验）", (await import("./parent-panel.mjs")).default],
  ];
  for (const [name, fn] of suites) {
    console.log(`\n===== ${name} =====`);
    try {
      const ok = await fn();
      if (ok === false) failed++;
    } catch (err) {
      console.error("❌", err.message ?? err);
      failed++;
    }
  }
} finally {
  server.kill();
}

console.log(failed === 0 ? "\n✅ 全部 e2e 套件通过" : `\n❌ ${failed} 个套件失败`);
process.exit(failed === 0 ? 0 : 1);
