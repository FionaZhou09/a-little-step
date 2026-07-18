/**
 * learning.ts — 教学流状态机：预习（故事台词 → 单词卡）→ 复习（听音选词 quiz）。
 * 持有并操作 index.html 里的 DOM：#dialog / #wordcard / #quiz / #task-list / #stars-count。
 *
 * 状态机：
 *   idle → dialog（播台词）→ wordcard（逐张认词）→ idle
 *   全部 previewed 后：idle → quiz（逐题直到全 starred）→ idle → onAllStarred
 */
import { resolveRoster, type LessonPack, type LessonWord, type StoryLine } from "./lesson";
import { KIND_DEFAULTS } from "./villagers";
import { speak, stopSpeak, sfx } from "./audio";

export type WordState = "new" | "previewed" | "starred";
type Phase = "idle" | "dialog" | "wordcard" | "quiz";

export interface LearningHooks {
  /** 全部单词 starred 时触发（game 用来进入庆典流程） */
  onAllStarred(): void;
  /** 对话/quiz 开始或结束（game 用来让村民停下/恢复漫游） */
  onBusyChange?(busy: boolean, villagerName: string | null): void;
  toast?(msg: string): void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`找不到页面元素 #${id}`);
  return e as T;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class LearningSession {
  readonly wordState = new Map<string, WordState>();

  private readonly pack: LessonPack;
  private readonly hooks: LearningHooks;
  /** 单词轮转表：word[i] → 村民名字[i % n]，来自课程包名单 */
  private readonly rotation: string[];
  /** 村民名字 → 动物 emoji（对话框名字前缀用） */
  private readonly emojiByName = new Map<string, string>();

  private phase: Phase = "idle";
  private villager: string | null = null;
  /** 当前对话队列与已播过台词的村民 */
  private dialogQueue: StoryLine[] = [];
  private readonly linesDone = new Set<string>();
  /** 待认的单词卡队列与当前卡 */
  private cardQueue: LessonWord[] = [];
  private currentCard: LessonWord | null = null;
  /** quiz 当前题与选项，locked 表示正在等奖答反馈动画 */
  private quizWord: LessonWord | null = null;
  private quizOptions: LessonWord[] = [];
  private quizLocked = false;

  // DOM 引用
  private readonly dialogEl = el("dialog");
  private readonly dialogName = el("dialog-name");
  private readonly dialogEn = el("dialog-en");
  private readonly dialogZh = el("dialog-zh");
  private readonly wordcardEl = el("wordcard");
  private readonly cardEmoji = el("wordcard-emoji");
  private readonly cardWord = el("wordcard-word");
  private readonly cardZh = el("wordcard-zh");
  private readonly cardSentence = el("wordcard-sentence");
  private readonly quizEl = el("quiz");
  private readonly quizOptionsEl = el("quiz-options");
  private readonly taskList = el("task-list");
  private readonly starsCount = el("stars-count");

  constructor(pack: LessonPack, hooks: LearningHooks) {
    this.pack = pack;
    this.hooks = hooks;
    const roster = resolveRoster(pack);
    this.rotation = roster.map((v) => v.name);
    for (const v of roster) this.emojiByName.set(v.name, KIND_DEFAULTS[v.animal].emoji);
    for (const w of pack.words) this.wordState.set(w.word, "new");

    // 点对话框 = 按 E，推进
    this.dialogEl.addEventListener("click", () => this.advance());
    el("wordcard-listen").addEventListener("click", () => {
      if (this.currentCard) this.speakCard(this.currentCard);
    });
    el("wordcard-ok").addEventListener("click", () => this.confirmCard());
    el("quiz-listen").addEventListener("click", () => {
      if (this.quizWord) speak(this.quizWord.word);
    });

    this.renderTasks();
  }

  get stars(): number {
    let n = 0;
    for (const s of this.wordState.values()) if (s === "starred") n++;
    return n;
  }

  isBusy(): boolean {
    return this.phase !== "idle";
  }

  allPreviewed(): boolean {
    for (const s of this.wordState.values()) if (s === "new") return false;
    return true;
  }

  allStarred(): boolean {
    for (const s of this.wordState.values()) if (s !== "starred") return false;
    return true;
  }

  /** 分配给某个村民的单词（按名单顺序轮转） */
  wordsFor(villagerName: string): LessonWord[] {
    return this.pack.words.filter((_, i) => this.rotation[i % this.rotation.length] === villagerName);
  }

  /** 某个村民在故事里的台词 */
  linesFor(villagerName: string): StoryLine[] {
    return this.pack.story.filter((s) => s.speaker === villagerName);
  }

  /** 靠近村民按 E：根据进度进入预习对话或 quiz */
  startDialog(villagerName: string): void {
    if (this.phase !== "idle") return;
    this.villager = villagerName;
    this.setBusy(true);

    if (this.allStarred()) {
      // 庆典后再聊天：一句夸奖
      this.phase = "dialog";
      this.dialogQueue = [{ speaker: villagerName, en: "You are a super star!", zh: "你是超级小明星！" }];
      this.showNextLine();
      return;
    }
    if (this.allPreviewed()) {
      this.startQuiz();
      return;
    }
    const lines = this.linesDone.has(villagerName) ? [] : this.linesFor(villagerName);
    const newWords = this.wordsFor(villagerName).filter((w) => this.wordState.get(w.word) === "new");
    if (lines.length > 0) {
      this.phase = "dialog";
      this.linesDone.add(villagerName);
      this.dialogQueue = [...lines];
      this.cardQueue = newWords; // 台词播完接着认词
      this.showNextLine();
    } else if (newWords.length > 0) {
      this.cardQueue = newWords;
      this.showNextCard();
    } else {
      // 这个村民的词都学完了，引导孩子找别人
      this.phase = "dialog";
      this.dialogQueue = [{ speaker: villagerName, en: "Go find my friends!", zh: "去找我的小伙伴们聊聊吧！" }];
      this.showNextLine();
    }
  }

  /** E / 点击：推进对话、认完当前单词卡、或重听 quiz 题目 */
  advance(): void {
    if (this.phase === "dialog") {
      if (this.dialogQueue.length > 0) {
        this.showNextLine();
      } else if (this.cardQueue.length > 0) {
        this.showNextCard();
      } else {
        this.close();
      }
    } else if (this.phase === "wordcard") {
      this.confirmCard();
    } else if (this.phase === "quiz" && this.quizWord) {
      speak(this.quizWord.word); // quiz 里 E = 再听一遍
    }
  }

  // ---------- 对话 ----------

  private showNextLine(): void {
    const line = this.dialogQueue.shift();
    if (!line) {
      this.advance();
      return;
    }
    this.hideAll();
    this.dialogName.textContent = `${this.emojiByName.get(line.speaker) ?? "🐾"} ${line.speaker}`;
    this.dialogEn.textContent = line.en;
    this.dialogZh.textContent = line.zh;
    this.dialogEl.classList.remove("hidden");
    speak(line.en);
  }

  // ---------- 单词卡 ----------

  private showNextCard(): void {
    const w = this.cardQueue.shift();
    if (!w) {
      this.close();
      return;
    }
    this.phase = "wordcard";
    this.currentCard = w;
    this.hideAll();
    this.cardEmoji.textContent = w.emoji;
    this.cardWord.textContent = w.word;
    this.cardZh.textContent = w.zh;
    this.cardSentence.textContent = `${w.sentence} ${w.sentenceZh}`;
    this.wordcardEl.classList.remove("hidden");
    this.speakCard(w);
  }

  private speakCard(w: LessonWord): void {
    speak(`${w.word}. ${w.sentence}`);
  }

  /** 「我学会啦 ✓」：标记 previewed，接着下一张 */
  private confirmCard(): void {
    if (!this.currentCard) return;
    this.wordState.set(this.currentCard.word, "previewed");
    this.currentCard = null;
    sfx.pop();
    this.renderTasks();
    this.showNextCard();
  }

  // ---------- quiz：听音选词 ----------

  private startQuiz(): void {
    this.phase = "quiz";
    this.quizLocked = false;
    this.nextQuestion();
  }

  private nextQuestion(): void {
    const candidates = this.pack.words.filter((w) => this.wordState.get(w.word) === "previewed");
    if (candidates.length === 0) {
      this.finishQuiz();
      return;
    }
    this.quizWord = candidates[Math.floor(Math.random() * candidates.length)];
    // 1 正确 + 2 干扰项（从全部单词里抽），洗牌
    const distractors = shuffle(this.pack.words.filter((w) => w.word !== this.quizWord!.word)).slice(0, 2);
    this.quizOptions = shuffle([this.quizWord, ...distractors]);
    this.quizLocked = false;
    this.renderQuizOptions();
    this.hideAll();
    this.quizEl.classList.remove("hidden");
    speak(this.quizWord.word);
  }

  private renderQuizOptions(): void {
    this.quizOptionsEl.replaceChildren();
    for (const w of this.quizOptions) {
      const btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.textContent = w.emoji;
      btn.addEventListener("click", () => this.pickOption(w, btn));
      this.quizOptionsEl.appendChild(btn);
    }
  }

  private pickOption(w: LessonWord, btn: HTMLButtonElement): void {
    if (this.quizLocked || !this.quizWord) return;
    if (w.word === this.quizWord.word) {
      // 答对：星星 +1，标 starred，稍等片刻出下一题
      this.quizLocked = true;
      btn.classList.add("correct");
      sfx.correct();
      sfx.star();
      this.wordState.set(w.word, "starred");
      this.renderTasks();
      this.hooks.toast?.(`⭐ ${w.word} 学会啦！`);
      window.setTimeout(() => {
        if (this.allStarred()) {
          this.finishQuiz();
        } else {
          this.nextQuestion();
        }
      }, 900);
    } else {
      // 答错：温和音效 + 鼓励，重排顺序再来
      btn.classList.add("wrong");
      sfx.wrong();
      this.hooks.toast?.("再想一想，你可以的！💪");
      window.setTimeout(() => {
        this.quizOptions = shuffle(this.quizOptions);
        this.renderQuizOptions();
        if (this.quizWord) speak(this.quizWord.word);
      }, 700);
    }
  }

  private finishQuiz(): void {
    this.quizWord = null;
    this.close();
    this.hooks.onAllStarred();
    speak("Hooray! You learned all the words!");
  }

  // ---------- 通用 ----------

  private close(): void {
    this.hideAll();
    this.phase = "idle";
    this.villager = null;
    stopSpeak();
    this.setBusy(false);
  }

  private hideAll(): void {
    this.dialogEl.classList.add("hidden");
    this.wordcardEl.classList.add("hidden");
    this.quizEl.classList.add("hidden");
  }

  private setBusy(busy: boolean): void {
    this.hooks.onBusyChange?.(busy, this.villager);
  }

  /** 重建任务卡列表：⬜ 未学 → 👂 已预习 → ⭐ 已掌握，并刷新星星数 */
  private renderTasks(): void {
    this.taskList.replaceChildren();
    for (const w of this.pack.words) {
      const li = document.createElement("li");
      const emoji = document.createElement("span");
      emoji.className = "task-emoji";
      emoji.textContent = w.emoji;
      const word = document.createElement("span");
      word.className = "task-word";
      word.textContent = w.word;
      const state = document.createElement("span");
      state.className = "task-state";
      const s = this.wordState.get(w.word) ?? "new";
      state.textContent = s === "starred" ? "⭐" : s === "previewed" ? "👂" : "⬜";
      li.append(emoji, word, state);
      this.taskList.appendChild(li);
    }
    this.starsCount.textContent = String(this.stars);
  }
}
