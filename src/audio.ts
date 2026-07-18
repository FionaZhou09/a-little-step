/**
 * audio.ts — 应用里所有声音的唯一出口。
 * 音效全部用 WebAudio 现场合成（无音频资源文件）；
 * 朗读走 speechSynthesis。将来要换 LLM TTS，只需改 speak() 一处。
 */

let ctx: AudioContext | null = null;

/** 懒创建 AudioContext；浏览器要求首次用户输入后才能出声 */
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// 首次点击/按键时顺手解锁音频（自动播放策略）
if (typeof window !== "undefined") {
  const unlock = () => ac();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  /** 延迟多少秒后开始（用于琶音排队） */
  when?: number;
  /** 结束时滑到的频率（上扬/下滑音） */
  slideTo?: number;
}

/** 合成一个带快速淡入、指数淡出的单音 */
export function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  const c = ac();
  const t0 = c.currentTime + (opts.when ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  const peak = opts.gain ?? 0.12;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

interface NoiseOpts {
  gain?: number;
  /** 带通滤波中心频率，决定噪声"音色" */
  freq?: number;
  when?: number;
}

/** 合成一段带通滤波的白噪声（脚步、水声、沙沙声） */
export function noise(dur: number, opts: NoiseOpts = {}): void {
  const c = ac();
  const t0 = c.currentTime + (opts.when ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = opts.freq ?? 1200;
  filter.Q.value = 0.9;
  const g = c.createGain();
  g.gain.value = opts.gain ?? 0.1;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}

/** 合成音效方法表 */
export const sfx = {
  /** 脚步声：短促低频噪声 */
  step(): void {
    noise(0.06, { gain: 0.025, freq: 420 });
  },
  /** 弹出/确认：轻快上扬小音 */
  pop(): void {
    tone(540, 0.1, { type: "sine", gain: 0.14, slideTo: 920 });
  },
  /** 答对：三音上行琶音 */
  correct(): void {
    tone(523, 0.14, { type: "triangle", gain: 0.13 });
    tone(659, 0.14, { type: "triangle", gain: 0.13, when: 0.1 });
    tone(784, 0.26, { type: "triangle", gain: 0.12, when: 0.2 });
  },
  /** 答错：温和下行双音（不吓到孩子） */
  wrong(): void {
    tone(392, 0.18, { type: "sine", gain: 0.1 });
    tone(330, 0.3, { type: "sine", gain: 0.09, when: 0.16 });
  },
  /** 得星星：清脆的高音闪烁 */
  star(): void {
    tone(1319, 0.16, { type: "triangle", gain: 0.1 });
    tone(1760, 0.3, { type: "triangle", gain: 0.08, when: 0.08 });
  },
  /** 庆典号角 */
  fanfare(): void {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.22, { type: "triangle", gain: 0.13, when: i * 0.13 }));
    tone(1319, 0.55, { type: "triangle", gain: 0.11, when: 0.56 });
    noise(0.5, { gain: 0.05, freq: 3200, when: 0.56 });
  },
  /** 树叶沙沙 */
  rustle(): void {
    noise(0.3, { gain: 0.14, freq: 2600 });
    noise(0.2, { gain: 0.09, freq: 1700, when: 0.08 });
  },
  /** 落水扑通 */
  splash(): void {
    noise(0.26, { gain: 0.16, freq: 900 });
    tone(280, 0.16, { type: "sine", gain: 0.08, slideTo: 130 });
  },
  /** 小鸟叽喳：两声快速下行哨音 */
  chirp(): void {
    tone(2350, 0.08, { type: "sine", gain: 0.09, slideTo: 1700 });
    tone(2500, 0.09, { type: "sine", gain: 0.08, when: 0.11, slideTo: 1800 });
  },
  /** 吃苹果：两声吧唧 */
  munch(): void {
    noise(0.07, { gain: 0.12, freq: 700 });
    tone(320, 0.08, { type: "sine", gain: 0.1, slideTo: 160 });
    noise(0.07, { gain: 0.12, freq: 600, when: 0.14 });
    tone(280, 0.09, { type: "sine", gain: 0.09, when: 0.14, slideTo: 140 });
  },
  /** 咬钩提示：短促双音（催孩子快收竿） */
  bite(): void {
    tone(880, 0.07, { type: "square", gain: 0.07 });
    tone(1175, 0.09, { type: "square", gain: 0.07, when: 0.09 });
  },
  /** 收竿：快速上滑的"嗖" */
  reel(): void {
    tone(520, 0.22, { type: "sawtooth", gain: 0.06, slideTo: 1300 });
    noise(0.15, { gain: 0.05, freq: 2000, when: 0.1 });
  },
};

/**
 * 朗读英文（全应用唯一发音出口）。
 * 先 cancel 再 speak，保证不会叠音；不支持 speechSynthesis 时静默跳过。
 */
export function speak(text: string, opts?: { rate?: number; pitch?: number }): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = opts?.rate ?? 0.85;
  u.pitch = opts?.pitch ?? 1.1;
  window.speechSynthesis.speak(u);
}

/** 停止当前朗读 */
export function stopSpeak(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}
