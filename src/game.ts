/**
 * game.ts — 游戏主控：渲染循环、输入（键盘/鼠标/触屏/点地移动）、
 * 相机跟随、交互调度（村民聊天/摇树/进屋/屋内惊喜）、头顶名牌、
 * 苹果收集、篝火庆典、家长导入面板。
 */
import * as THREE from "three";
import {
  loadLessonPack,
  parseLessonPack,
  saveLessonPack,
  resetLessonPack,
  resolveRoster,
  type SupportedAnimal,
} from "./lesson";
import { buildCharacter, animateCharacter, type CharacterRig } from "./character";
import { buildWorld, type World, type ShakeTree } from "./world";
import { createVillagers, updateVillagers, dampAngle, KIND_DEFAULTS, type Villager } from "./villagers";
import { buildInteriors, type Room } from "./interiors";
import { buildBoat, updateBoatVisual, showSplash, type Boat } from "./boat";
import { LearningSession } from "./learning";
import { sfx, speak, stopSpeak } from "./audio";
import lessonPrompt from "./prompt-template.txt?raw";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`找不到页面元素 #${id}`);
  return e as T;
}

const PLAYER_SPEED = 4.5;
const BOAT_SPEED = 6;
const CONFETTI_COLORS = ["#f2718c", "#f2b04e", "#7ec96a", "#5ba8e8", "#c79bf2", "#ff9f43"];

/** 渔获权重表（加起来 100） */
const CATCH_TABLE = [
  { emoji: "🐟", en: "bass", zh: "鲈鱼", w: 35 },
  { emoji: "🐠", en: "carp", zh: "鲤鱼", w: 25 },
  { emoji: "🎏", en: "koi", zh: "锦鲤", w: 15 },
  { emoji: "🐡", en: "pufferfish", zh: "河豚", w: 10 },
  { emoji: "🦐", en: "shrimp", zh: "小虾", w: 10 },
  { emoji: "🥾", en: "old boot", zh: "旧靴子", w: 5 },
];

/** 每帧的交互候选，取距离最近的一个 */
interface InteractCandidate {
  kind: "villager" | "tree" | "house" | "exit" | "surprise" | "board" | "land";
  dist: number;
  label: string;
  villager?: Villager;
  tree?: ShakeTree;
  room?: Room;
  landing?: { x: number; z: number };
}

/** 从树上掉下来、正被玩家收集的苹果 */
interface FallingApple {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  bounces: number;
  magnet: boolean;
  speed: number;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private world!: World;
  private player!: CharacterRig;
  private playerYaw = Math.PI;
  private villagers: Villager[] = [];
  private rooms: Room[] = [];
  private session!: LearningSession;
  private readonly clock = new THREE.Clock();

  // 相机：yaw/pitch/dist 三参数；dist 平滑逼近 camDistBase（进屋拉近、滚轮改基准值）
  private camYaw = 0;
  private camPitch = 0.5;
  private camDist = 8;
  private camDistBase = 8;
  private camDistOutside = 8;
  private readonly camPos = new THREE.Vector3();

  // 输入状态
  private readonly keys = new Set<string>();
  private joyVec = { x: 0, y: 0 };
  private joyPointerId: number | null = null;
  private readonly joyCenter = { x: 0, y: 0 };
  private camPointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private dragDist = 0;
  private pointerDownAt = 0;
  private moveTarget: { x: number; z: number } | null = null;
  private stuckAcc = 0;

  // 交互 / 庆典状态
  private interactCandidate: InteractCandidate | null = null;
  private celebrating = false; // 已全部 starred，引导孩子去广场
  private celebrated = false; // 篝火已点燃
  private stepAcc = 0;
  private panelOpen = false;
  private fading = false; // 进出屋黑屏过渡中，屏蔽输入

  // 屋内 / 苹果
  private indoors: Room | null = null;
  private apples = 0;
  private readonly fallingApples: FallingApple[] = [];

  // 小船 / 钓鱼
  private boat!: Boat;
  private sailing = false;
  private boatSpeed = 0;
  private lastBoatYaw = 0;
  private isTouch = false;
  private fishPhase: "idle" | "casting" | "waiting" | "bite" = "idle";
  private castT = 0;
  private readonly castFrom = new THREE.Vector3();
  private readonly castTo = new THREE.Vector3();
  private readonly fishFrom = new THREE.Vector3();
  private waitDur = 0;
  private waitUntilT = 0;
  private biteUntilT = 0;
  private fishes = 0;
  private catchOpen = false; // 渔获卡打开中（暂停船操作）
  private biteMark!: HTMLElement;

  // HUD
  private nameplateBox!: HTMLElement;
  private readonly nameplates = new Map<string, { root: HTMLElement; quiz: HTMLElement }>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    const pack = await loadLessonPack();
    const roster = resolveRoster(pack);

    // ---------- 渲染器 / 场景 / 雾 / 光照 ----------
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa8ddf0);
    this.scene.fog = new THREE.Fog(0xa8ddf0, 50, 130);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);

    const hemi = new THREE.HemisphereLight(0xdff4ff, 0x8fc46a, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.8);
    sun.position.set(30, 45, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -32;
    sun.shadow.camera.right = 32;
    sun.shadow.camera.top = 32;
    sun.shadow.camera.bottom = -32;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    // ---------- 世界 / 角色 / 房间 ----------
    this.world = buildWorld(this.scene);

    this.player = buildCharacter("dog", {
      fur: 0xd9a05b, // 黄棕小狗
      furLight: 0xf7e3c2,
      outfit: 0x5b7ec9,
      accent: 0xe0432f,
    });
    this.player.group.position.set(0, 0, 14);
    this.player.group.rotation.y = this.playerYaw;
    this.scene.add(this.player.group);

    this.villagers = createVillagers(this.scene, this.world, roster);
    this.rooms = buildInteriors(this.scene, roster, this.world.houses);
    // 小船挂 world.group 下：进屋时随世界一起隐藏
    this.boat = buildBoat(this.world.group, 1.9, -25.3);

    this.session = new LearningSession(pack, {
      onAllStarred: () => this.onAllStarred(),
      onBusyChange: (busy, name) => this.onBusyChange(busy, name),
      toast: (msg) => this.toast(msg),
    });

    // ---------- HUD 初始化 ----------
    el("lesson-title").textContent = pack.title;
    this.nameplateBox = document.createElement("div");
    this.nameplateBox.id = "hint-3d";
    el("hud").appendChild(this.nameplateBox);
    for (const v of this.villagers) {
      // 常驻名牌：动物 emoji + 名字；复习阶段右上角加 ❓ 角标
      const plate = document.createElement("div");
      plate.className = "nameplate";
      plate.style.display = "none";
      const label = document.createElement("span");
      label.textContent = `${KIND_DEFAULTS[v.kind as SupportedAnimal]?.emoji ?? "🐾"} ${v.name}`;
      const quiz = document.createElement("span");
      quiz.className = "np-quiz hidden";
      quiz.textContent = "❓";
      plate.append(label, quiz);
      this.nameplateBox.appendChild(plate);
      this.nameplates.set(v.name, { root: plate, quiz });
    }
    // 咬钩的 ❗ 提示（DOM 投影到浮漂位置）
    this.biteMark = document.createElement("div");
    this.biteMark.className = "bite-mark hidden";
    this.biteMark.textContent = "❗";
    this.nameplateBox.appendChild(this.biteMark);
    // 触屏设备显示 💬 大按钮
    this.isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (this.isTouch) {
      el("btn-interact").classList.remove("hidden");
    }
    el("catch-ok").addEventListener("click", () => this.closeCatchCard());
    el("btn-fish").addEventListener("click", () => this.fishOrReel());

    this.bindInput();
    this.bindParentPanel();
    window.addEventListener("resize", () => this.onResize());

    // 相机初始就位（避免第一帧猛拉）
    this.updateCamera(10);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---------- 输入 ----------

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      // 在家长面板输入框里打字时不触发游戏按键
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "KeyE") this.tryInteract();
      if (e.code === "KeyF") {
        // 船上 F = 钓鱼/收竿，岛上 F = 吃苹果
        if (this.sailing) this.fishOrReel();
        else this.eatApple();
      }
      if (e.code === "Escape") this.closePanel();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.panelOpen) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.dragDist = 0;
      this.pointerDownAt = performance.now();
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "touch" && e.clientX < window.innerWidth / 2) {
        // 左半屏：虚拟摇杆
        this.joyPointerId = e.pointerId;
        this.joyCenter.x = e.clientX;
        this.joyCenter.y = e.clientY;
        const joy = el("joystick");
        joy.style.left = `${e.clientX - 55}px`;
        joy.style.top = `${e.clientY - 55}px`;
        joy.classList.remove("hidden");
      } else {
        this.camPointerId = e.pointerId;
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.joyPointerId) {
        let dx = e.clientX - this.joyCenter.x;
        let dy = e.clientY - this.joyCenter.y;
        const len = Math.hypot(dx, dy);
        const max = 42;
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        el("joystick-knob").style.transform = `translate(${dx}px, ${dy}px)`;
        this.joyVec = { x: dx / max, y: dy / max };
        if (Math.hypot(this.joyVec.x, this.joyVec.y) > 0.2) this.moveTarget = null;
      } else if (e.pointerId === this.camPointerId) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        this.camYaw -= dx * 0.0055;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.15, 1.15);
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    const endPointer = (e: PointerEvent) => {
      if (e.pointerId === this.joyPointerId) {
        this.joyPointerId = null;
        this.joyVec = { x: 0, y: 0 };
        el("joystick").classList.add("hidden");
        el("joystick-knob").style.transform = "";
      } else if (e.pointerId === this.camPointerId) {
        this.camPointerId = null;
        // 轻点（没怎么拖、时间短）= 点地移动
        if (this.dragDist < 8 && performance.now() - this.pointerDownAt < 500) {
          this.clickToMove(e.clientX, e.clientY);
        }
      }
    };
    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.camDistBase = THREE.MathUtils.clamp(this.camDistBase * (1 + e.deltaY * 0.001), 4.5, 14);
      },
      { passive: false }
    );

    el("btn-interact").addEventListener("click", () => this.tryInteract());
    el("apples-pill").addEventListener("click", () => this.eatApple());
  }

  /** 可行走判断：屋外用世界碰撞，屋内用房间局部坐标 */
  private canWalk(x: number, z: number): boolean {
    if (this.indoors) {
      const rp = this.indoors.group.position;
      return this.indoors.walkable(x - rp.x, z - rp.z);
    }
    return this.world.isWalkable(x, z);
  }

  /** 点地移动：raycast 到地面平面，能走就设为目标点（划船时禁用） */
  private clickToMove(clientX: number, clientY: number): void {
    if (this.session.isBusy() || this.fading || this.sailing) return;
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
      if (this.canWalk(hit.x, hit.z)) {
        this.moveTarget = { x: hit.x, z: hit.z };
        this.stuckAcc = 0;
      }
    }
  }

  /** E / 💬：会话中推进优先；否则执行最近的交互候选 */
  private tryInteract(): void {
    if (this.panelOpen || this.fading) return;
    if (this.catchOpen) {
      this.closeCatchCard();
      return;
    }
    if (this.session.isBusy()) {
      this.session.advance();
      return;
    }
    const c = this.interactCandidate;
    if (!c) return;
    if (c.kind === "villager" && c.villager) {
      const v = c.villager;
      this.moveTarget = null;
      // 玩家转身面向村民（村民转身由 onBusyChange 处理）
      const p = this.player.group.position;
      this.playerYaw = Math.atan2(v.rig.group.position.x - p.x, v.rig.group.position.z - p.z);
      sfx.pop();
      this.session.startDialog(v.name);
    } else if (c.kind === "tree" && c.tree) {
      const dropped = this.world.shakeTree(c.tree);
      if (dropped) {
        sfx.rustle();
        for (const mesh of dropped) this.spawnFallingApple(mesh);
      }
    } else if (c.kind === "house" && c.room) {
      this.enterRoom(c.room);
    } else if (c.kind === "exit") {
      this.exitRoom();
    } else if (c.kind === "surprise" && c.room) {
      c.room.triggerSurprise();
    } else if (c.kind === "board") {
      this.boardBoat();
    } else if (c.kind === "land" && c.landing) {
      this.leaveBoat(c.landing);
    }
  }

  private onBusyChange(busy: boolean, name: string | null): void {
    for (const v of this.villagers) {
      if (busy && v.name === name) {
        v.chatting = true;
        // 村民转身面向玩家
        const p = this.player.group.position;
        v.rig.group.rotation.y = Math.atan2(p.x - v.rig.group.position.x, p.z - v.rig.group.position.z);
      } else if (!busy && !this.celebrated) {
        v.chatting = false;
      }
    }
  }

  // ---------- 主循环 ----------

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.updatePlayer(dt, t);
    if (!this.indoors) updateVillagers(this.villagers, this.world, dt, t);
    this.world.tick(dt, t, this.indoors ? undefined : this.player.group.position);
    if (this.indoors) this.indoors.tick(dt, t);
    this.updateBoat(dt, t);
    this.updateFishing(dt, t);
    this.updateFallingApples(dt);
    this.updateCamera(dt);
    this.updateInteract();
    this.updateNameplates();
    this.checkCelebration();
    this.settleVillagers();
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayer(dt: number, t: number): void {
    const pos = this.player.group.position;
    const busy = this.session.isBusy() || this.panelOpen || this.fading || this.catchOpen;

    // 键盘 / 摇杆输入向量
    let ix = 0;
    let iz = 0;
    if (!busy) {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ix -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ix += 1;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) iz += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) iz -= 1;
      ix += this.joyVec.x;
      iz += -this.joyVec.y; // 摇杆上推 = 前进
    }

    // 划船模式：输入驱动船，玩家本身不走
    if (this.sailing) {
      if (!busy) this.driveBoat(dt, ix, iz);
      else this.boatSpeed = THREE.MathUtils.damp(this.boatSpeed, 0, 2, dt);
      return;
    }

    const hasManual = Math.hypot(ix, iz) > 0.15;
    if (hasManual) this.moveTarget = null; // 任何手动输入取消点地目标

    const dir = new THREE.Vector3();
    if (hasManual) {
      // 相机系方向 → 世界方向
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      right.y = 0;
      right.normalize();
      dir.addScaledVector(fwd, iz).addScaledVector(right, ix);
      if (dir.lengthSq() > 1) dir.normalize();
    } else if (!busy && this.moveTarget) {
      const dx = this.moveTarget.x - pos.x;
      const dz = this.moveTarget.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        this.moveTarget = null; // 到点停止
      } else {
        dir.set(dx / d, 0, dz / d);
      }
    }

    const moving = dir.lengthSq() > 0.001;
    if (moving) {
      const prevX = pos.x;
      const prevZ = pos.z;
      // x/z 分轴尝试 → 贴着障碍滑动而不是卡死
      const nx = pos.x + dir.x * PLAYER_SPEED * dt;
      if (this.canWalk(nx, pos.z)) pos.x = nx;
      const nz = pos.z + dir.z * PLAYER_SPEED * dt;
      if (this.canWalk(pos.x, nz)) pos.z = nz;
      this.playerYaw = dampAngle(this.playerYaw, Math.atan2(dir.x, dir.z), 12, dt);
      // 脚步声按步伐节奏
      this.stepAcc += dt;
      if (this.stepAcc > 0.34) {
        this.stepAcc = 0;
        sfx.step();
      }
      // 点地移动卡住（被障碍挡住）时自动放弃目标
      if (this.moveTarget) {
        const moved = Math.hypot(pos.x - prevX, pos.z - prevZ);
        this.stuckAcc = moved < PLAYER_SPEED * dt * 0.2 ? this.stuckAcc + dt : 0;
        if (this.stuckAcc > 0.8) this.moveTarget = null;
      }
    } else {
      this.stepAcc = 0.2; // 下次起步立刻有声
    }

    pos.y = this.indoors ? 0 : this.world.groundY(pos.x, pos.z);
    this.player.group.rotation.y = this.playerYaw;
    animateCharacter(this.player, dt, moving ? 0.85 : 0, t);
  }

  private updateCamera(dt: number): void {
    this.camDist = THREE.MathUtils.damp(this.camDist, this.camDistBase, 4, dt);
    const p = this.player.group.position;
    const head = new THREE.Vector3(p.x, p.y + 1.7, p.z);
    const cp = Math.cos(this.camPitch);
    const desired = new THREE.Vector3(
      head.x + Math.sin(this.camYaw) * cp * this.camDist,
      head.y + Math.sin(this.camPitch) * this.camDist,
      head.z + Math.cos(this.camYaw) * cp * this.camDist
    );
    this.camPos.x = THREE.MathUtils.damp(this.camPos.x, desired.x, 5, dt);
    this.camPos.y = THREE.MathUtils.damp(this.camPos.y, desired.y, 5, dt);
    this.camPos.z = THREE.MathUtils.damp(this.camPos.z, desired.z, 5, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(head);
  }

  /** 每帧收集交互候选（村民 2.6 / 摇树 2.2 / 进屋 1.8 / 屋内门口 1.5 / 惊喜 1.5），取最近 */
  private updateInteract(): void {
    const p = this.player.group.position;
    let best: InteractCandidate | null = null;
    const consider = (c: InteractCandidate) => {
      if (!best || c.dist < best.dist) best = c;
    };
    if (this.sailing) {
      // 划船时只有「下船」一个候选：朝岛方向 2.5 内有可站立点
      const landing = this.findLanding();
      if (landing) best = { kind: "land", dist: 0, label: "下船", landing };
    } else if (this.indoors) {
      const rp = this.indoors.group.position;
      const lx = p.x - rp.x;
      const lz = p.z - rp.z;
      const dDoor = Math.hypot(this.indoors.doorLocal.x - lx, this.indoors.doorLocal.z - lz);
      if (dDoor < 1.5) consider({ kind: "exit", dist: dDoor, label: "回小岛上去" });
      const s = this.indoors.surprise;
      const dS = Math.hypot(s.x - lx, s.z - lz);
      if (dS < 1.5) consider({ kind: "surprise", dist: dS, label: s.label, room: this.indoors });
    } else {
      for (const v of this.villagers) {
        const d = Math.hypot(v.rig.group.position.x - p.x, v.rig.group.position.z - p.z);
        if (d < 2.6) consider({ kind: "villager", dist: d, label: `和 ${v.name} 聊聊`, villager: v });
      }
      for (const tree of this.world.shakeTrees) {
        const d = Math.hypot(tree.x - p.x, tree.z - p.z);
        if (d < 2.2 && this.world.canShake(tree)) {
          consider({ kind: "tree", dist: d, label: "摇一摇苹果树", tree });
        }
      }
      for (const room of this.rooms) {
        const d = Math.hypot(room.houseDoor.x - p.x, room.houseDoor.z - p.z);
        if (d < 1.8) consider({ kind: "house", dist: d, label: `进 ${room.ownerName} 的家`, room });
      }
      const bd = Math.hypot(this.boat.group.position.x - p.x, this.boat.group.position.z - p.z);
      if (bd < 2.5) consider({ kind: "board", dist: bd, label: "坐上小船" });
    }
    this.interactCandidate = best;
    const prompt = el("interact-prompt");
    if (best && !this.session.isBusy() && !this.panelOpen) {
      el("interact-text").textContent = (best as InteractCandidate).label;
      prompt.classList.remove("hidden");
    } else {
      prompt.classList.add("hidden");
    }
  }

  /** 头顶名牌：常驻显示；复习阶段加 ❓ 角标；对话中/相机背后/屋内隐藏 */
  private updateNameplates(): void {
    const quizMode = this.session.allPreviewed() && !this.session.allStarred();
    const tmp = new THREE.Vector3();
    for (const v of this.villagers) {
      const plate = this.nameplates.get(v.name);
      if (!plate) continue;
      plate.quiz.classList.toggle("hidden", !quizMode);
      if (this.indoors || v.chatting) {
        plate.root.style.display = "none";
        continue;
      }
      tmp.copy(v.rig.group.position);
      tmp.y += 2.2;
      tmp.project(this.camera);
      if (tmp.z > 1) {
        plate.root.style.display = "none"; // 在相机背后
        continue;
      }
      plate.root.style.display = "flex";
      plate.root.style.left = `${(tmp.x * 0.5 + 0.5) * window.innerWidth}px`;
      plate.root.style.top = `${(-tmp.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  // ---------- 苹果：摇树掉落 → 抛物线 → 弹跳 → 磁吸 ----------

  private spawnFallingApple(mesh: THREE.Mesh): void {
    const a = Math.random() * Math.PI * 2;
    this.fallingApples.push({
      mesh,
      vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random()), 2.5 + Math.random() * 1.5, Math.sin(a) * (1 + Math.random())),
      bounces: 0,
      magnet: false,
      speed: 5,
    });
  }

  private updateFallingApples(dt: number): void {
    if (this.fallingApples.length === 0) return;
    const p = this.player.group.position;
    for (let i = this.fallingApples.length - 1; i >= 0; i--) {
      const a = this.fallingApples[i];
      // 树冷却结束把苹果收回去了，从列表移除
      if (!a.mesh.userData.dropped) {
        this.fallingApples.splice(i, 1);
        continue;
      }
      const m = a.mesh;
      if (a.magnet) {
        const dx = p.x - m.position.x;
        const dy = p.y + 0.9 - m.position.y;
        const dz = p.z - m.position.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.7 || this.indoors) {
          // 吸到玩家身上：苹果 +1
          m.visible = false;
          this.fallingApples.splice(i, 1);
          this.apples++;
          el("apples-count").textContent = String(this.apples);
          sfx.pop();
        } else {
          a.speed += 26 * dt;
          const step = Math.min(a.speed * dt, dist);
          m.position.x += (dx / dist) * step;
          m.position.y += (dy / dist) * step;
          m.position.z += (dz / dist) * step;
        }
      } else {
        // 抛物线 + 落地弹跳，弹两下后开始磁吸
        a.vel.y -= 16 * dt;
        m.position.addScaledVector(a.vel, dt);
        const ground = this.world.groundY(m.position.x, m.position.z) + 0.11;
        if (m.position.y < ground) {
          m.position.y = ground;
          a.vel.y = Math.abs(a.vel.y) * 0.45;
          a.vel.x *= 0.6;
          a.vel.z *= 0.6;
          a.bounces++;
          if (a.bounces >= 2 || a.vel.y < 1.2) a.magnet = true;
        }
      }
    }
  }

  /** 吃苹果：按 F 或点顶栏 🍎 胶囊（纯好玩） */
  private eatApple(): void {
    if (this.panelOpen || this.apples <= 0) return;
    this.apples--;
    el("apples-count").textContent = String(this.apples);
    sfx.munch();
    speak("Yummy!");
  }

  // ---------- 进出小屋 ----------

  private enterRoom(room: Room): void {
    if (this.fading) return;
    this.fading = true;
    this.moveTarget = null;
    const fade = el("fade");
    fade.classList.add("on");
    window.setTimeout(() => {
      this.world.group.visible = false;
      room.group.visible = true;
      this.indoors = room;
      const rp = room.group.position;
      this.player.group.position.set(rp.x + room.doorLocal.x, 0, rp.z + room.doorLocal.z);
      this.playerYaw = Math.PI; // 面向屋内（-z）
      this.camDistOutside = this.camDistBase;
      this.camDistBase = 5; // 屋内相机拉近
      fade.classList.remove("on");
      this.fading = false;
      sfx.pop();
    }, 320);
  }

  private exitRoom(): void {
    if (this.fading || !this.indoors) return;
    const room = this.indoors;
    this.fading = true;
    const fade = el("fade");
    fade.classList.add("on");
    window.setTimeout(() => {
      this.world.group.visible = true;
      room.group.visible = false;
      this.indoors = null;
      this.player.group.position.set(room.houseDoor.x, 0, room.houseDoor.z);
      // 面朝远离房子的方向
      this.playerYaw = Math.atan2(
        room.houseDoor.x - room.group.position.x,
        room.houseDoor.z - room.group.position.z
      );
      this.camDistBase = this.camDistOutside;
      fade.classList.remove("on");
      this.fading = false;
      sfx.pop();
    }, 320);
  }

  // ---------- 划船 ----------

  /** 上船：玩家随船移动，相机拉远，触屏显示 🎣 */
  private boardBoat(): void {
    this.sailing = true;
    this.moveTarget = null;
    this.boatSpeed = 0;
    this.boat.yaw = Math.PI; // 船头朝南出海
    this.camDistOutside = this.camDistBase;
    this.camDistBase = 9;
    if (this.isTouch) el("btn-fish").classList.remove("hidden");
    sfx.pop();
    this.toast("划到水面上，按 F 钓鱼！🎣");
  }

  /** 下船：把玩家放到朝岛方向的可站立点 */
  private leaveBoat(landing: { x: number; z: number }): void {
    this.sailing = false;
    this.endFishing();
    this.boatSpeed = 0;
    this.camDistBase = this.camDistOutside;
    el("btn-fish").classList.add("hidden");
    this.player.group.position.set(landing.x, this.world.groundY(landing.x, landing.z), landing.z);
    this.playerYaw = Math.atan2(-landing.x, -landing.z); // 面朝岛心
    sfx.pop();
  }

  /** 船朝岛方向 2.5 内的可行走点（多扫几个角度） */
  private findLanding(): { x: number; z: number } | null {
    const bp = this.boat.group.position;
    const toCenter = Math.atan2(-bp.x, -bp.z);
    for (const d of [1.8, 2.2, 2.5]) {
      for (const off of [0, 0.5, -0.5, 1, -1]) {
        const a = toCenter + off;
        const x = bp.x + Math.sin(a) * d;
        const z = bp.z + Math.cos(a) * d;
        if (this.world.isWalkable(x, z)) return { x, z };
      }
    }
    return null;
  }

  /** 划船：输入方向 → 船头平滑转向，对齐程度决定速度，沿岸分轴滑动 */
  private driveBoat(dt: number, ix: number, iz: number): void {
    const mag = Math.hypot(ix, iz);
    if (mag > 0.15) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      right.y = 0;
      right.normalize();
      const dir = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
      if (dir.lengthSq() > 1) dir.normalize();
      const desiredYaw = Math.atan2(dir.x, dir.z);
      this.boat.yaw = dampAngle(this.boat.yaw, desiredYaw, 3, dt);
      // 船不能横着走：船头与目标方向越对齐越快
      let diff = desiredYaw - this.boat.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const align = Math.max(0.25, Math.cos(diff));
      this.boatSpeed = THREE.MathUtils.damp(this.boatSpeed, BOAT_SPEED * Math.min(1, mag) * align, 3, dt);
    } else {
      this.boatSpeed = THREE.MathUtils.damp(this.boatSpeed, 0, 2, dt);
    }
    const bp = this.boat.group.position;
    const step = this.boatSpeed * dt;
    const nx = bp.x + Math.sin(this.boat.yaw) * step;
    if (this.world.isSailable(nx, bp.z)) bp.x = nx;
    const nz = bp.z + Math.cos(this.boat.yaw) * step;
    if (this.world.isSailable(bp.x, nz)) bp.z = nz;
  }

  /** 每帧更新船的视觉与船上玩家（玩家坐标 = 船坐标 + 甲板高度） */
  private updateBoat(dt: number, t: number): void {
    const bp = this.boat.group.position;
    const turnRate = (this.boat.yaw - this.lastBoatYaw) / Math.max(dt, 1e-4);
    this.lastBoatYaw = this.boat.yaw;
    updateBoatVisual(this.boat, dt, t, this.sailing ? this.boatSpeed : 0, this.sailing ? turnRate : 0, this.world.waterY(bp.x, bp.z));
    if (this.sailing) {
      this.playerYaw = dampAngle(this.playerYaw, this.boat.yaw, 6, dt);
      this.player.group.position.set(bp.x, bp.y + 0.45, bp.z);
      this.player.group.rotation.y = this.playerYaw;
      animateCharacter(this.player, dt, this.boatSpeed > 1 ? 0.12 : 0, t);
    }
  }

  // ---------- 钓鱼 ----------

  /** F / 🎣：idle 抛竿 → waiting 提前收竿 → bite 收竿 */
  private fishOrReel(): void {
    if (!this.sailing || this.fading || this.panelOpen || this.catchOpen) return;
    if (this.fishPhase === "idle") {
      // 落点取船头前方最近的水面
      const bp = this.boat.group.position;
      let dist = 3.4;
      let tx = bp.x + Math.sin(this.boat.yaw) * dist;
      let tz = bp.z + Math.cos(this.boat.yaw) * dist;
      while (dist > 1.4 && !this.world.isSailable(tx, tz)) {
        dist -= 0.4;
        tx = bp.x + Math.sin(this.boat.yaw) * dist;
        tz = bp.z + Math.cos(this.boat.yaw) * dist;
      }
      if (!this.world.isSailable(tx, tz)) return; // 贴岸实在没水
      this.castFrom.set(bp.x, bp.y + 0.9, bp.z);
      this.castTo.set(tx, this.world.waterY(tx, tz) + 0.05, tz);
      this.castT = 0;
      this.fishPhase = "casting";
      this.boat.bobber.visible = true;
      this.boat.bobber.position.copy(this.castFrom);
      sfx.pop();
    } else if (this.fishPhase === "waiting") {
      this.endFishing(); // 提前收竿，无收获
    } else if (this.fishPhase === "bite") {
      this.reelIn();
    }
  }

  private updateFishing(dt: number, t: number): void {
    const boat = this.boat;
    if (this.fishPhase === "casting") {
      // 浮漂抛物线 0.5s 落水
      this.castT += dt / 0.5;
      const u = Math.min(1, this.castT);
      boat.bobber.position.lerpVectors(this.castFrom, this.castTo, u);
      boat.bobber.position.y += Math.sin(u * Math.PI) * 1.2;
      if (u >= 1) {
        this.fishPhase = "waiting";
        this.waitDur = 2 + Math.random() * 3;
        this.waitUntilT = t + this.waitDur;
        boat.bobber.position.copy(this.castTo);
        sfx.splash();
        showSplash(boat, this.castTo.x, this.castTo.y + 0.05, this.castTo.z);
        // 鱼影从随机方向出现
        const a = Math.random() * Math.PI * 2;
        this.fishFrom.set(this.castTo.x + Math.cos(a) * 5, this.castTo.y - 0.28, this.castTo.z + Math.sin(a) * 5);
        boat.fishShadow.position.copy(this.fishFrom);
        boat.fishShadow.visible = true;
      }
    } else if (this.fishPhase === "waiting") {
      // 鱼影匀速游向浮漂
      const u = THREE.MathUtils.clamp(1 - (this.waitUntilT - t) / this.waitDur, 0, 1);
      boat.fishShadow.position.lerpVectors(this.fishFrom, this.castTo, u);
      boat.fishShadow.position.y = this.castTo.y - 0.28;
      boat.fishShadow.rotation.y = Math.atan2(this.castTo.x - this.fishFrom.x, this.castTo.z - this.fishFrom.z);
      // 浮漂轻轻起伏
      boat.bobber.position.y = this.castTo.y + Math.sin(t * 2.5) * 0.03;
      if (t >= this.waitUntilT) {
        // 咬钩：浮漂下沉 + 水花 + ❗，1.2s 窗口
        this.fishPhase = "bite";
        this.biteUntilT = t + 1.2;
        sfx.bite();
        showSplash(boat, this.castTo.x, this.castTo.y + 0.05, this.castTo.z);
        this.biteMark.classList.remove("hidden");
      }
    } else if (this.fishPhase === "bite") {
      boat.bobber.position.y = this.castTo.y - 0.1 + Math.sin(t * 18) * 0.04;
      // ❗ 投影到浮漂位置
      const tmp = boat.bobber.position.clone();
      tmp.y += 0.7;
      tmp.project(this.camera);
      if (tmp.z < 1) {
        this.biteMark.style.left = `${(tmp.x * 0.5 + 0.5) * window.innerWidth}px`;
        this.biteMark.style.top = `${(-tmp.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
      if (t > this.biteUntilT) {
        this.endFishing();
        this.toast("鱼跑掉了…再试一次！");
      }
    }
  }

  /** 咬钩窗口内收竿：按权重表出货 */
  private reelIn(): void {
    let r = Math.random() * 100;
    let c = CATCH_TABLE[0];
    for (const entry of CATCH_TABLE) {
      r -= entry.w;
      if (r < 0) {
        c = entry;
        break;
      }
    }
    this.endFishing();
    sfx.reel();
    this.fishes++;
    el("fish-count").textContent = String(this.fishes);
    // 渔获卡
    el("catch-emoji").textContent = c.emoji;
    el("catch-name").textContent = c.en;
    el("catch-zh").textContent = c.zh;
    const line = c.en === "old boot" ? "Oh... an old boot!" : `You caught a ${c.en}!`;
    el("catch-line").textContent = line;
    el("catch-card").classList.remove("hidden");
    this.catchOpen = true;
    speak(line);
  }

  private closeCatchCard(): void {
    if (!this.catchOpen) return;
    this.catchOpen = false;
    el("catch-card").classList.add("hidden");
    sfx.pop();
  }

  /** 结束本次钓鱼：藏起浮漂/鱼影/❗ */
  private endFishing(): void {
    this.fishPhase = "idle";
    this.boat.bobber.visible = false;
    this.boat.fishShadow.visible = false;
    this.biteMark.classList.add("hidden");
  }

  // ---------- 庆典 ----------

  private onAllStarred(): void {
    this.celebrating = true;
    this.showBanner("全部单词学会啦！去广场参加庆典！🎉");
    this.toast("去中间的广场看看！");
  }

  private checkCelebration(): void {
    if (!this.celebrating || this.celebrated || this.indoors) return;
    const p = this.player.group.position;
    const c = this.world.plazaCenter;
    if (Math.hypot(p.x - c.x, p.z - c.z) > this.world.plazaRadius - 0.3) return;
    this.celebrated = true;
    this.world.igniteBonfire();
    sfx.fanfare();
    this.showBanner("🎉 今天全学会啦！你真棒！");
    speak("Hooray! You learned all the words! Great job!");
    this.dropConfetti(90);
    // 村民围拢到篝火边（先走过去，到了再停下）
    const n = this.villagers.length;
    this.villagers.forEach((v, i) => {
      const a = (i / n) * Math.PI * 2 + 0.7;
      const x = c.x + Math.cos(a) * 2.9;
      const z = c.z + Math.sin(a) * 2.9;
      v.home = { x, z, r: 0.8 };
      v.target = { x, z };
      v.chatting = false;
    });
  }

  /** 村民走到广场位置后停下，面向篝火待机 */
  private settleVillagers(): void {
    if (!this.celebrated) return;
    const c = this.world.plazaCenter;
    for (const v of this.villagers) {
      if (v.chatting) continue;
      const pos = v.rig.group.position;
      if (Math.hypot(v.target.x - pos.x, v.target.z - pos.z) < 0.5) {
        v.chatting = true;
        v.rig.group.rotation.y = Math.atan2(c.x - pos.x, c.z - pos.z);
      }
    }
  }

  private dropConfetti(n: number): void {
    const hud = el("hud");
    for (let i = 0; i < n; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      c.style.animationDuration = `${2.6 + Math.random() * 2}s`;
      c.style.animationDelay = `${Math.random() * 0.9}s`;
      hud.appendChild(c);
      window.setTimeout(() => c.remove(), 6000);
    }
  }

  // ---------- HUD 小件 ----------

  private showBanner(text: string): void {
    const b = el("banner");
    b.textContent = text;
    b.classList.remove("hidden");
  }

  private toast(msg: string): void {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    el("toasts").appendChild(t);
    window.setTimeout(() => t.classList.add("out"), 2600);
    window.setTimeout(() => t.remove(), 3000);
  }

  // ---------- 家长面板 ----------

  private bindParentPanel(): void {
    el("btn-parent").addEventListener("click", () => this.openPanel());
    el("btn-close-parent").addEventListener("click", () => this.closePanel());
    el("btn-copy-prompt").addEventListener("click", () => void this.copyPrompt());
    // 手动复制兜底框预先填好提示词（失败时才显示，见 copyPrompt）
    el<HTMLTextAreaElement>("prompt-manual").value = lessonPrompt;
    el("prompt-manual").addEventListener("click", () => {
      el<HTMLTextAreaElement>("prompt-manual").select();
    });
    el("btn-import-text").addEventListener("click", () => {
      this.importFromText(el<HTMLTextAreaElement>("import-text").value);
    });
    el("btn-import-file").addEventListener("click", () => el<HTMLInputElement>("import-file").click());
    el<HTMLInputElement>("import-file").addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void file.text().then((text) => this.importFromText(text));
    });
    el("btn-reset-lesson").addEventListener("click", () => {
      resetLessonPack();
      location.reload();
    });
  }

  private openPanel(): void {
    this.panelOpen = true;
    stopSpeak(); // 打开面板时暂停说话
    el("import-error").textContent = "";
    el("parent-panel").classList.remove("hidden");
  }

  private closePanel(): void {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    el("parent-panel").classList.add("hidden");
  }

  /** 「📋 复制提示词」三级兜底：clipboard API → execCommand → 显示出来手动复制。失败绝不谎称成功 */
  private async copyPrompt(): Promise<void> {
    // 1) 现代剪贴板 API（https / localhost 可用）
    try {
      await navigator.clipboard.writeText(lessonPrompt);
      this.toast("提示词已复制！去发给 AI 吧 📋");
      el("prompt-fallback").classList.add("hidden");
      return;
    } catch {
      /* 继续兜底 */
    }
    // 2) 老式 execCommand（http 或权限被拒时；iOS 需要 focus + setSelectionRange）
    const ta = document.createElement("textarea");
    ta.value = lessonPrompt;
    ta.readOnly = true;
    // 不能 opacity:0（部分浏览器会跳过复制），做成 2px 几乎不可见
    ta.style.cssText = "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;opacity:0.01;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      /* 继续兜底 */
    }
    ta.remove();
    if (ok) {
      this.toast("提示词已复制！去发给 AI 吧 📋");
      el("prompt-fallback").classList.add("hidden");
      return;
    }
    // 3) 都失败：把提示词显示出来，家长手动全选复制
    el("prompt-fallback").classList.remove("hidden");
    const manual = el<HTMLTextAreaElement>("prompt-manual");
    manual.focus();
    manual.select();
    this.toast("自动复制失败，请在框里手动全选复制 🙏");
  }

  /** 粘贴文本 / 选择文件都走这里：解析 → 保存 → 刷新应用新课程 */
  private importFromText(text: string): void {
    const errEl = el("import-error");
    try {
      const pack = parseLessonPack(text);
      saveLessonPack(pack);
      errEl.textContent = "";
      this.toast("导入成功！马上开始新课程 🎈");
      window.setTimeout(() => location.reload(), 700);
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : "导入失败，请再试一次";
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
