/**
 * lesson.ts — 课程包（LessonPack）类型、校验与加载/导入。
 *
 * 课程包是应用与家长所用 AI（Kimi/ChatGPT）之间的唯一契约：
 * 家长把 prompt-template.md 的提示词 + 老师课表发给 AI，AI 返回符合
 * 本格式的 JSON，粘贴进应用即可生成当日的预习/复习内容。
 */

export interface LessonWord {
  /** 英文单词，如 "apple" */
  word: string;
  /** 配图 emoji，如 "🍎"（4-6 岁孩子主要靠图认词） */
  emoji: string;
  /** 中文释义 */
  zh: string;
  /** 一句简单例句（≤6 个词） */
  sentence: string;
  /** 例句中文 */
  sentenceZh: string;
}

export interface StoryLine {
  /** 说话村民的名字（必须与 villagers 名单里的 name 对应） */
  speaker: string;
  /** 英文台词（简单短句，可自然嵌入今日单词） */
  en: string;
  /** 中文翻译 */
  zh: string;
}

/** 村民名单里允许的动物种类（character.ts 里有对应的拼装分支） */
export const SUPPORTED_ANIMALS = ["bear", "cat", "rabbit", "fox", "panda", "duck", "pig", "owl"] as const;
export type SupportedAnimal = (typeof SUPPORTED_ANIMALS)[number];

export interface VillagerSpec {
  /** 村民英文名，如 "Kiki" */
  name: string;
  /** 动物种类 */
  animal: SupportedAnimal;
}

/** 课程包没写 villagers 时用的默认三人组 */
export const DEFAULT_VILLAGERS: VillagerSpec[] = [
  { name: "Bobo", animal: "bear" },
  { name: "Mimi", animal: "cat" },
  { name: "Lulu", animal: "rabbit" },
];

export interface LessonPack {
  /** 课程日期，如 "2026-07-18" */
  date: string;
  /** 课程标题，如 "Apples & Colors" */
  title: string;
  /** 4~8 个今日单词 */
  words: LessonWord[];
  /** 4~10 行小故事 */
  story: StoryLine[];
  /** 可选：今日出场的动物村民名单（2~5 个），缺省用 DEFAULT_VILLAGERS */
  villagers?: VillagerSpec[];
}

/** 取本课程包的村民名单（未提供时回退默认三人组） */
export function resolveRoster(pack: LessonPack): VillagerSpec[] {
  return pack.villagers && pack.villagers.length > 0 ? pack.villagers : DEFAULT_VILLAGERS;
}

const STORAGE_KEY = "a-little-step.lesson";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 校验未知输入是否为合法课程包。
 * 返回 null 表示合法；否则返回给家长看的中文错误信息。
 */
export function validateLessonPack(data: unknown): string | null {
  if (!isRecord(data)) return "课程包不是一个 JSON 对象";

  if (!isNonEmptyString(data.date)) return "缺少 date（课程日期，如 \"2026-07-18\"）";
  if (!isNonEmptyString(data.title)) return "缺少 title（课程标题）";

  if (!Array.isArray(data.words) || data.words.length === 0)
    return "words 必须是非空数组（建议 4~8 个单词）";
  if (data.words.length > 12) return "单词太多了（最多 12 个），孩子一次学不完";

  for (let i = 0; i < data.words.length; i++) {
    const w: unknown = data.words[i];
    const label = `第 ${i + 1} 个单词`;
    if (!isRecord(w)) return `${label} 不是对象`;
    if (!isNonEmptyString(w.word)) return `${label} 缺少 word（英文单词）`;
    if (!isNonEmptyString(w.emoji)) return `${label}（${w.word}）缺少 emoji（配图）`;
    if (!isNonEmptyString(w.zh)) return `${label}（${w.word}）缺少 zh（中文释义）`;
    if (!isNonEmptyString(w.sentence)) return `${label}（${w.word}）缺少 sentence（英文例句）`;
    if (!isNonEmptyString(w.sentenceZh)) return `${label}（${w.word}）缺少 sentenceZh（例句中文）`;
  }

  if (!Array.isArray(data.story) || data.story.length === 0)
    return "story 必须是非空数组（建议 4~10 行对话）";
  for (let i = 0; i < data.story.length; i++) {
    const s: unknown = data.story[i];
    const label = `故事第 ${i + 1} 行`;
    if (!isRecord(s)) return `${label} 不是对象`;
    if (!isNonEmptyString(s.speaker)) return `${label} 缺少 speaker（说话人）`;
    if (!isNonEmptyString(s.en)) return `${label} 缺少 en（英文台词）`;
    if (!isNonEmptyString(s.zh)) return `${label} 缺少 zh（中文翻译）`;
  }

  // villagers 可选；提供了就要合法，且 story 的 speaker 必须在名单里
  let rosterNames: string[] = DEFAULT_VILLAGERS.map((v) => v.name);
  if (data.villagers !== undefined) {
    if (!Array.isArray(data.villagers) || data.villagers.length < 2 || data.villagers.length > 5)
      return "villagers 需要 2~5 个村民";
    const seen = new Set<string>();
    for (let i = 0; i < data.villagers.length; i++) {
      const v: unknown = data.villagers[i];
      const label = `村民名单第 ${i + 1} 个`;
      if (!isRecord(v)) return `${label} 不是对象`;
      if (!isNonEmptyString(v.name)) return `${label} 缺少 name（村民英文名）`;
      if (seen.has(v.name)) return `村民名字重复：${v.name}`;
      seen.add(v.name);
      if (!isNonEmptyString(v.animal) || !(SUPPORTED_ANIMALS as readonly string[]).includes(v.animal))
        return `${label}（${v.name}）的 animal 不支持："${String(v.animal)}"（可选：${SUPPORTED_ANIMALS.join(" / ")}）`;
    }
    rosterNames = [...seen];
  }
  for (let i = 0; i < data.story.length; i++) {
    const s = data.story[i] as StoryLine;
    if (!rosterNames.includes(s.speaker))
      return `故事第 ${i + 1} 行的 speaker "${s.speaker}" 不在村民名单里（名单：${rosterNames.join("、")}）`;
  }

  return null;
}

/** 从 JSON 文本解析课程包；失败时抛出带中文信息的 Error。 */
export function parseLessonPack(text: string): LessonPack {
  let data: unknown;
  try {
    // AI 有时会用 ```json 代码块包裹输出，先剥掉
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("这不是合法的 JSON——请确认把 AI 返回的内容完整复制了");
  }
  const err = validateLessonPack(data);
  if (err) throw new Error(`课程包格式不对：${err}`);
  return data as LessonPack;
}

/** 加载当前课程包：优先 localStorage 里家长导入的，否则内置示例。 */
export async function loadLessonPack(): Promise<LessonPack> {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return parseLessonPack(saved);
    } catch {
      localStorage.removeItem(STORAGE_KEY); // 存了坏数据就丢弃
    }
  }
  const res = await fetch("lessons/sample.json");
  return (await res.json()) as LessonPack;
}

/** 保存家长导入的课程包（下次打开自动恢复）。 */
export function saveLessonPack(pack: LessonPack): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pack));
}

/** 清除导入的课程包，恢复内置示例。 */
export function resetLessonPack(): void {
  localStorage.removeItem(STORAGE_KEY);
}
