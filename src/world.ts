/**
 * world.ts — 程序化生成的小岛世界：草地小岛 + 海洋 + 河 + 拱桥 + 篝火广场。
 * 同时负责碰撞（isWalkable）、地面高度（groundY）和环境小动画（tick）。
 */
import * as THREE from "three";
import { sfx } from "./audio";

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** 可摇的苹果树 */
export interface ShakeTree {
  x: number;
  z: number;
  /** 树冠（含苹果），摇动时绕树干顶端振荡 */
  crown: THREE.Group;
  apples: THREE.Mesh[];
  /** 冷却结束时刻（world 内部时钟） */
  cooldownUntil: number;
  /** >0 表示正在摇动 */
  shakeT: number;
}

/** 小岛上的房子（门口位置已按朝向换算成世界坐标） */
export interface HouseInfo {
  x: number;
  z: number;
  rot: number;
  /** 门前站位点（进屋交互距离判定用） */
  door: { x: number; z: number };
}

export interface World {
  group: THREE.Group;
  obstacles: Circle[];
  shakeTrees: ShakeTree[];
  houses: HouseInfo[];
  isWalkable(x: number, z: number): boolean;
  groundY(x: number, z: number): number;
  /** 小船可航行区域：海洋环带（岛缘外到半径 55）∪ 河流水面（桥区可过） */
  isSailable(x: number, z: number): boolean;
  /** 水面高度（河面高于海面），小船浮动/浮漂用 */
  waterY(x: number, z: number): number;
  plazaCenter: { x: number; z: number };
  plazaRadius: number;
  /** 点燃篝火（庆典时调用，只生效一次） */
  igniteBonfire(): void;
  /** 树是否可以摇（不在冷却中且还有苹果） */
  canShake(tree: ShakeTree): boolean;
  /** 摇树：返回掉落的苹果（已转成世界坐标，挂在 world.group 下）；不可摇返回 null */
  shakeTree(tree: ShakeTree): THREE.Mesh[] | null;
  tick(dt: number, t: number, playerPos?: { x: number; z: number }): void;
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...opts });
}

/** 固定种子的伪随机数，保证每次进游戏小岛长一个样 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 小岛几何常量（比参考项目小一圈，孩子走起来不累）
export const ISLAND_R = 24;
const RIVER = { zMin: -7.5, zMax: -4.5, halfWidth: 23 };
const BRIDGE = { x: 0, halfW: 1.6, zMin: -8.6, zMax: -3.4, peak: 0.85 };
const PLAZA = { x: 0, z: 7, r: 4.5 };
/** 岛南登船小栈道（伸进海面，板上可行走） */
const PIER = { halfW: 1.0, zStart: -21.5, zEnd: -26.2, y: 0.12 };
/** 小船可航行的最大半径 */
const SAIL_R = 55;

export function buildWorld(scene: THREE.Scene): World {
  const rand = mulberry32(20260718);
  const group = new THREE.Group();
  const obstacles: Circle[] = [];
  const animated: ((dt: number, t: number, playerPos?: { x: number; z: number }) => void)[] = [];
  /** world 内部时钟（每次 tick 更新），摇树冷却用 */
  let now = 0;
  const add = (o: THREE.Object3D) => group.add(o);
  const shadow = (o: THREE.Object3D) =>
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

  // ---------- 海洋 ----------
  const ocean = new THREE.Mesh(
    new THREE.CircleGeometry(300, 48),
    mat(0x3aa7dd, { roughness: 0.55, flatShading: false })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.9;
  add(ocean);
  const oceanDeep = new THREE.Mesh(
    new THREE.CircleGeometry(650, 32),
    mat(0x2b8cc4, { roughness: 0.7, flatShading: false })
  );
  oceanDeep.rotation.x = -Math.PI / 2;
  oceanDeep.position.y = -1.1;
  add(oceanDeep);
  // 海面轻轻起伏
  animated.push((_dt, t) => {
    ocean.position.y = -0.9 + Math.sin(t * 0.8) * 0.04;
  });

  // ---------- 小岛：沙滩裙边 + 草地两层圆柱 ----------
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(26.5, 28.5, 1.4, 48), mat(0xeed9a4));
  beach.position.y = -0.85; // 顶面 -0.15，露一圈沙滩
  beach.receiveShadow = true;
  add(beach);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, 26, 1.5, 48), mat(0x82c95b));
  grass.position.y = -0.75; // 顶面 0
  grass.receiveShadow = true;
  add(grass);

  // 草地点缀色块
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    const d = 4 + rand() * 16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (z > RIVER.zMin - 1.5 && z < RIVER.zMax + 1.5) continue; // 别贴河面
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(2.5 + rand() * 3.5, 16),
      mat(rand() > 0.5 ? 0x8ad163 : 0x79bd52)
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.012 + i * 0.0005, z);
    patch.receiveShadow = true;
    add(patch);
  }

  // ---------- 河流：下沉河床 + 水面 + 两岸沙 ----------
  const riverBed = new THREE.Mesh(
    new THREE.BoxGeometry(RIVER.halfWidth * 2 + 8, 0.4, RIVER.zMax - RIVER.zMin + 2),
    mat(0xe0cd94)
  );
  riverBed.position.set(0, -0.3, (RIVER.zMin + RIVER.zMax) / 2);
  add(riverBed);
  const river = new THREE.Mesh(
    new THREE.BoxGeometry(RIVER.halfWidth * 2 + 8, 0.2, RIVER.zMax - RIVER.zMin),
    mat(0x4cc3ec, { roughness: 0.3, flatShading: false })
  );
  river.position.set(0, -0.1, (RIVER.zMin + RIVER.zMax) / 2);
  river.receiveShadow = true;
  add(river);
  animated.push((_dt, t) => {
    river.position.y = -0.1 + Math.sin(t * 1.4) * 0.02;
  });
  for (const zEdge of [RIVER.zMin - 0.6, RIVER.zMax + 0.6]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(RIVER.halfWidth * 2 + 6, 0.12, 1.4), mat(0xf0dcaa));
    bank.position.set(0, 0.03, zEdge);
    bank.receiveShadow = true;
    add(bank);
  }

  // ---------- 拱桥：sin 拱形木板 ----------
  const bridge = new THREE.Group();
  const plankMat = mat(0xc08a4e);
  const railMat = mat(0x9a6733);
  const span = BRIDGE.zMax - BRIDGE.zMin;
  const archY = (z: number) => {
    const u = (z - BRIDGE.zMin) / span;
    return BRIDGE.peak * Math.sin(Math.PI * u) + 0.12;
  };
  const nPlanks = 12;
  for (let i = 0; i < nPlanks; i++) {
    const z0 = BRIDGE.zMin + (i / nPlanks) * span;
    const z1 = BRIDGE.zMin + ((i + 1) / nPlanks) * span;
    const zm = (z0 + z1) / 2;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.halfW * 2, 0.08, (z1 - z0) * 0.94), plankMat);
    plank.position.set(BRIDGE.x, archY(zm), zm);
    plank.rotation.x = -Math.atan2(archY(z1) - archY(z0), z1 - z0);
    bridge.add(plank);
    // 两侧栏杆柱
    if (i % 2 === 0) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 5), railMat);
        post.position.set(BRIDGE.x + side * (BRIDGE.halfW - 0.08), archY(z0) + 0.25, z0);
        bridge.add(post);
      }
    }
  }
  // 分段扶手贴着拱走
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z0 = BRIDGE.zMin + (i / 6) * span;
      const z1 = BRIDGE.zMin + ((i + 1) / 6) * span;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, Math.hypot(z1 - z0, archY(z1) - archY(z0))), railMat);
      rail.position.set(BRIDGE.x + side * (BRIDGE.halfW - 0.08), (archY(z0) + archY(z1)) / 2 + 0.5, (z0 + z1) / 2);
      rail.rotation.x = -Math.atan2(archY(z1) - archY(z0), z1 - z0);
      bridge.add(rail);
    }
  }
  shadow(bridge);
  add(bridge);

  // ---------- 主路：广场 ↔ 桥 ↔ 南岸 ----------
  const pathMat = mat(0xecdcb0);
  const pathBox = (x1: number, z1: number, x2: number, z2: number, w: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, len + w * 0.4), pathMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = -Math.atan2(dx, dz);
    p.position.set((x1 + x2) / 2, 0.018, (z1 + z2) / 2);
    p.receiveShadow = true;
    add(p);
  };
  pathBox(0, PLAZA.z - PLAZA.r + 0.5, 0, BRIDGE.zMax, 2.8); // 广场 → 桥北
  pathBox(0, BRIDGE.zMin, 0, -15, 2.6); // 桥南 → 南岸
  pathBox(0, -15, 0, PIER.zStart, 2.4); // 南岸 → 登船栈道

  // ---------- 登船栈道：主路尽头伸进海面的一小段木板 ----------
  const pier = new THREE.Group();
  const pierMat = mat(0xb98a52);
  for (let z = PIER.zStart - 0.3; z > PIER.zEnd; z -= 0.55) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(PIER.halfW * 2, 0.08, 0.5), pierMat);
    plank.position.set(0, PIER.y - 0.04, z);
    pier.add(plank);
  }
  // 两侧支柱插进水里
  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.2, 5);
  for (let z = PIER.zStart - 0.5; z > PIER.zEnd; z -= 1.6) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, mat(0x8a5a33));
      post.position.set(side * (PIER.halfW - 0.12), PIER.y - 0.55, z);
      pier.add(post);
    }
  }
  shadow(pier);
  add(pier);

  // ---------- 中央广场 + 未点燃的篝火 ----------
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA.r, 32), mat(0xf0e2b8));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PLAZA.x, 0.02, PLAZA.z);
  plaza.receiveShadow = true;
  add(plaza);
  // 广场边缘一圈小石板
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.1, 7), mat(0xcfc5ae));
    stone.position.set(PLAZA.x + Math.cos(a) * (PLAZA.r - 0.2), 0.05, PLAZA.z + Math.sin(a) * (PLAZA.r - 0.2));
    stone.receiveShadow = true;
    add(stone);
  }

  // 篝火：石圈 + 木柴，点燃后才有火焰/光/烟
  const fire = new THREE.Group();
  fire.position.set(PLAZA.x, 0, PLAZA.z);
  const ringGeo = new THREE.DodecahedronGeometry(0.24, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(ringGeo, mat(0xb8bfc6));
    s.position.set(Math.cos(a) * 0.95, 0.1, Math.sin(a) * 0.95);
    s.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    fire.add(s);
  }
  const logGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.95, 6);
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(logGeo, mat(0x7d5028));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 3) * Math.PI;
    log.position.y = 0.12;
    fire.add(log);
  }
  const flameOut = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.85, 7),
    mat(0xff9a3c, { emissive: 0xff771e, emissiveIntensity: 1 })
  );
  flameOut.position.y = 0.6;
  const flameIn = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.5, 6),
    mat(0xffe08a, { emissive: 0xffcc44, emissiveIntensity: 1.3 })
  );
  flameIn.position.y = 0.55;
  const fireLight = new THREE.PointLight(0xffa54d, 0, 14, 1.6);
  fireLight.position.set(0, 1.2, 0);
  fire.add(flameOut, flameIn, fireLight);
  // 烟：几个半透明小球循环上升，未点燃时隐藏
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, transparent: true, opacity: 0.5, roughness: 1 });
  const smokes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), smokeMat.clone());
    s.visible = false;
    fire.add(s);
    smokes.push(s);
  }
  flameOut.visible = false;
  flameIn.visible = false;
  shadow(fire);
  add(fire);
  obstacles.push({ x: PLAZA.x, z: PLAZA.z, r: 1.35 });

  let fireLit = false;
  let fireLevel = 0;
  const igniteBonfire = () => {
    fireLit = true;
    flameOut.visible = true;
    flameIn.visible = true;
    for (const s of smokes) s.visible = true;
  };
  animated.push((dt, t) => {
    // 火焰有个"长大"过程，点燃后渐入
    fireLevel = THREE.MathUtils.damp(fireLevel, fireLit ? 1 : 0, 3, dt);
    if (fireLevel < 0.02) {
      fireLight.intensity = 0;
      return;
    }
    const f = 1 + Math.sin(t * 9) * 0.13 + Math.sin(t * 23.7) * 0.06;
    flameOut.scale.set(f * fireLevel, fireLevel * (1 + Math.sin(t * 13) * 0.16), f * fireLevel);
    flameIn.scale.set(f * fireLevel, fireLevel * (1 + Math.cos(t * 17) * 0.13), f * fireLevel);
    fireLight.intensity = fireLevel * (9 + Math.sin(t * 11) * 2.2);
    smokes.forEach((s, i) => {
      const u = (t * 0.4 + i / smokes.length) % 1; // 0→1 循环上升
      s.position.set(Math.sin(t * 1.5 + i) * 0.15, 0.9 + u * 2.2, Math.cos(t * 1.2 + i) * 0.15);
      s.scale.setScalar(0.5 + u * 1.4);
      (s.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - u) * fireLevel;
    });
  });

  // ---------- 装饰物布点 ----------
  // 主路/广场/河流/桥都排除，避免挡路
  const isClear = (x: number, z: number) => {
    if (Math.hypot(x, z) > ISLAND_R - 3) return false;
    if (z > RIVER.zMin - 1.6 && z < RIVER.zMax + 1.6) return false;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 2) return false;
    if (Math.abs(x) < 2.6 && z > -16 && z < 3.5) return false; // 主路
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 1.2) return false;
    return true;
  };

  // 苹果树：锥干 + 3 球冠 + 红果子；树冠整体挂在 crown Group 上，摇动时绕它振荡
  const shakeTrees: ShakeTree[] = [];
  const makeAppleTree = (x: number, z: number) => {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.5, 6), mat(0x8a5a33));
    trunk.position.y = 0.75;
    tree.add(trunk);
    const crown = new THREE.Group();
    crown.position.y = 1.35; // 振荡支点在树干顶端
    const leafMat = mat(0x5da845);
    const crowns: [number, number, number, number][] = [
      [0, 0.55, 0, 0.95],
      [-0.55, 0.2, 0.2, 0.65],
      [0.55, 0.25, -0.15, 0.7],
    ];
    for (const [cx, cy, cz, cr] of crowns) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(cr, 8, 6), leafMat);
      c.position.set(cx, cy, cz);
      crown.add(c);
    }
    const apples: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat(0xe0432f));
      apple.position.set(Math.cos(a) * 0.8, 0.15 + rand() * 0.6, Math.sin(a) * 0.8);
      // home 记住在树冠里的位置，掉落后长回来用；dropped 标记是否已掉下
      apple.userData.home = apple.position.clone();
      apple.userData.dropped = false;
      crown.add(apple);
      apples.push(apple);
    }
    tree.add(crown);
    tree.position.set(x, 0, z);
    tree.rotation.y = rand() * Math.PI * 2;
    shadow(tree);
    add(tree);
    obstacles.push({ x, z, r: 0.6 });
    shakeTrees.push({ x, z, crown, apples, cooldownUntil: 0, shakeT: 0 });
  };
  // 小树屋：方身 + 四棱锥顶 + 门；记录门口站位点供进屋交互用
  const houses: HouseInfo[] = [];
  const makeHouse = (x: number, z: number, rot: number, wallColor: number, roofColor: number) => {
    const h = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 2.2), mat(wallColor));
    wall.position.y = 0.85;
    h.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.2, 4), mat(roofColor));
    roof.position.y = 2.3;
    roof.rotation.y = Math.PI / 4;
    h.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.08), mat(0x7d5028));
    door.position.set(0, 0.5, 1.12);
    h.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), mat(0xfff3c8));
    win.position.set(0.7, 1.05, 1.12);
    h.add(win);
    h.position.set(x, 0, z);
    h.rotation.y = rot;
    shadow(h);
    add(h);
    obstacles.push({ x, z, r: 2.1 });
    // 门在局部 +z 面，按朝向转到世界坐标，往前多站 1 米
    houses.push({ x, z, rot, door: { x: x + Math.sin(rot) * 2.6, z: z + Math.cos(rot) * 2.6 } });
  };

  makeAppleTree(-11, 12);
  makeAppleTree(12, 11);
  makeAppleTree(-7.5, -14);
  makeAppleTree(11, -11);
  makeHouse(-15.5, 4, 0.5, 0xf7e3c2, 0xe88a3c);
  makeHouse(15.5, 3, -0.5, 0xe8f0d8, 0x7a9c59);
  makeHouse(-13, -11.5, 0.9, 0xf2d8d8, 0xc96a5b);

  // 花 / 蘑菇 / 草丛 / 石头
  const flowerColors = [0xf2718c, 0xf2b04e, 0x9ec9e8, 0xc79bf2, 0xf2794e];
  const flowerSpots: { x: number; z: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = 3 + rand() * 17;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!isClear(x, z)) continue;
    const f = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat(0x5da845));
    stem.position.y = 0.15;
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat(flowerColors[Math.floor(rand() * flowerColors.length)]));
    headM.position.y = 0.33;
    f.add(stem, headM);
    f.position.set(x, 0, z);
    add(f);
    flowerSpots.push({ x, z });
  }
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    const d = 4 + rand() * 16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!isClear(x, z)) continue;
    const m = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6), mat(0xf7f2e4));
    stem.position.y = 0.08;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 7), mat(0xe0432f));
    cap.position.y = 0.22;
    m.add(stem, cap);
    m.position.set(x, 0, z);
    shadow(m);
    add(m);
  }
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const d = 2 + rand() * 19;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!isClear(x, z)) continue;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), mat(0x6fb54a));
    tuft.position.set(x, 0.14, z);
    tuft.rotation.y = rand() * Math.PI;
    add(tuft);
  }
  for (let i = 0; i < 8; i++) {
    const a = rand() * Math.PI * 2;
    const d = 5 + rand() * 15;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!isClear(x, z)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rand() * 0.2, 0), mat(0xb8bfc6));
    rock.position.set(x, 0.12, z);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = true;
    add(rock);
  }

  // 河边几丛芦苇（纯装饰，不占碰撞）
  for (const [rx, rz] of [[-9, -4.0], [-3.5, -8.1], [6, -3.9], [11, -8.2], [-14, -8.1]] as const) {
    const clump = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const h = 0.6 + rand() * 0.5;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 4), mat(0x7a9c59));
      reed.position.set((rand() - 0.5) * 0.4, h / 2, (rand() - 0.5) * 0.4);
      clump.add(reed);
      if (rand() > 0.5) {
        const cattail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 5), mat(0x8a5a33));
        cattail.position.set(reed.position.x, h + 0.05, reed.position.z);
        clump.add(cattail);
      }
    }
    clump.position.set(rx, 0, rz);
    group.add(clump);
  }

  // 荷叶：河面几片 + 岛南近岸几片，随水波起伏
  const lilies: { m: THREE.Mesh; baseY: number; ph: number }[] = [];
  const addLily = (x: number, z: number, y: number, r: number) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), mat(0x4e9e4a));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    group.add(m);
    lilies.push({ m, baseY: y, ph: rand() * 6 });
  };
  addLily(-6, -5.5, 0.03, 0.42);
  addLily(3.5, -6.6, 0.03, 0.35);
  addLily(12, -5.2, 0.03, 0.5);
  addLily(4.5, -25.5, -0.82, 0.55);
  addLily(-8, -24.8, -0.82, 0.45);
  animated.push((_dt, t) => {
    for (const l of lilies) l.m.position.y = l.baseY + Math.sin(t * 1.3 + l.ph) * 0.025;
  });

  // ---------- 环境小动画：云 / 鸟 / 蝴蝶 ----------
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const cloud = new THREE.Group();
    const cm = mat(0xffffff, { roughness: 1 });
    for (let j = 0; j < 3; j++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1 + rand() * 0.8, 7, 6), cm);
      b.scale.y = 0.55;
      b.position.set(j * 1.4 - 1.4, rand() * 0.4, rand() * 0.6);
      cloud.add(b);
    }
    cloud.position.set(-40 + rand() * 80, 13 + rand() * 4, -25 + rand() * 50);
    group.add(cloud);
    clouds.push(cloud);
  }
  animated.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * 0.6;
      if (c.position.x > 45) c.position.x = -45;
    }
  });

  const birds: { g: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh; r: number; h: number; sp: number; ph: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const bm = mat(0x5b6b8c);
    const bodyB = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), bm);
    bodyB.scale.set(1, 0.8, 1.4);
    const wingGeo = new THREE.BoxGeometry(0.5, 0.03, 0.22);
    const wl = new THREE.Mesh(wingGeo, bm);
    wl.position.x = -0.3;
    const wr = new THREE.Mesh(wingGeo, bm);
    wr.position.x = 0.3;
    g.add(bodyB, wl, wr);
    group.add(g);
    birds.push({ g, wl, wr, r: 13 + i * 3.5, h: 9 + i * 1.2, sp: 0.22 + i * 0.04, ph: i * 2.1 });
  }
  animated.push((_dt, t) => {
    for (const b of birds) {
      const a = t * b.sp + b.ph;
      b.g.position.set(Math.cos(a) * b.r, b.h + Math.sin(t * 0.9 + b.ph) * 0.5, Math.sin(a) * b.r);
      b.g.rotation.y = -a; // 机头朝切线方向
      const flap = Math.sin(t * 10 + b.ph) * 0.5;
      b.wl.rotation.z = 0.25 + flap;
      b.wr.rotation.z = -0.25 - flap;
    }
  });

  // 海鸥：更大更白，绕岛飞大圈
  const gulls: { g: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh; r: number; h: number; sp: number; ph: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const gm = mat(0xf2f0e8);
    const bodyG = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 6), gm);
    bodyG.scale.set(1, 0.8, 1.5);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat(0xf2b04e));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.02, 0.42);
    const wingGeo = new THREE.BoxGeometry(0.95, 0.04, 0.32);
    const wl = new THREE.Mesh(wingGeo, gm);
    wl.position.x = -0.55;
    const wr = new THREE.Mesh(wingGeo, gm);
    wr.position.x = 0.55;
    g.add(bodyG, beak, wl, wr);
    group.add(g);
    gulls.push({ g, wl, wr, r: 32 + i * 7, h: 13 + i * 2, sp: 0.14 + i * 0.03, ph: i * 2.6 });
  }
  animated.push((_dt, t) => {
    for (const b of gulls) {
      const a = t * b.sp + b.ph;
      b.g.position.set(Math.cos(a) * b.r, b.h + Math.sin(t * 0.7 + b.ph) * 0.8, Math.sin(a) * b.r);
      b.g.rotation.y = -a;
      const flap = Math.sin(t * 7 + b.ph) * 0.45;
      b.wl.rotation.z = 0.2 + flap;
      b.wr.rotation.z = -0.2 - flap;
    }
  });

  // 河面每 6~12s 一条小鱼跃出：抛物线 + 入水水花
  const jumpFish = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat(0x5ba8e8));
  jumpFish.scale.set(1, 0.7, 1.5);
  jumpFish.visible = false;
  group.add(jumpFish);
  const fishSplashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const fishSplash = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.3, 12), fishSplashMat);
  fishSplash.rotation.x = -Math.PI / 2;
  group.add(fishSplash);
  let fishJumpAt = 6;
  let fishJumpT0 = -1;
  let fishX = 0;
  let fishDir = 1;
  animated.push((dt, t) => {
    if (fishJumpT0 < 0 && t > fishJumpAt) {
      // 起跳
      fishJumpT0 = t;
      fishJumpAt = t + 6 + rand() * 6;
      fishX = (rand() * 2 - 1) * 16;
      fishDir = rand() > 0.5 ? 1 : -1;
      jumpFish.visible = true;
    }
    if (fishJumpT0 >= 0) {
      const u = (t - fishJumpT0) / 1.1;
      if (u >= 1) {
        // 入水：藏鱼 + 水花扩散 + 轻声水花
        fishJumpT0 = -1;
        jumpFish.visible = false;
        fishSplash.position.set(fishX + fishDir * 1.2, 0.02, (RIVER.zMin + RIVER.zMax) / 2);
        fishSplash.scale.setScalar(1);
        fishSplashMat.opacity = 0.7;
        sfx.splash();
      } else {
        jumpFish.position.set(fishX + fishDir * u * 1.2, Math.sin(u * Math.PI) * 1.1 + 0.05, (RIVER.zMin + RIVER.zMax) / 2);
        jumpFish.rotation.z = fishDir * (u * 2 - 1) * 1.2;
      }
    }
    if (fishSplashMat.opacity > 0) {
      fishSplashMat.opacity = Math.max(0, fishSplashMat.opacity - dt * 1.5);
      fishSplash.scale.setScalar(fishSplash.scale.x + dt * 1.2);
    }
  });

  const butterflies: { g: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh; cx: number; cz: number; ph: number }[] = [];
  const spotA = flowerSpots[0] ?? { x: 6, z: 12 };
  const spotB = flowerSpots[1] ?? { x: -8, z: 2 };
  [spotA, spotB].forEach((spot, i) => {
    const g = new THREE.Group();
    const wm = mat(i === 0 ? 0xf2b04e : 0xc79bf2, { side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.18, 0.14);
    const wl = new THREE.Mesh(wingGeo, wm);
    wl.position.x = -0.09;
    const wr = new THREE.Mesh(wingGeo, wm);
    wr.position.x = 0.09;
    g.add(wl, wr);
    group.add(g);
    butterflies.push({ g, wl, wr, cx: spot.x, cz: spot.z, ph: i * 3 });
  });
  animated.push((_dt, t) => {
    for (const b of butterflies) {
      b.g.position.set(
        b.cx + Math.cos(t * 0.9 + b.ph) * 1.2,
        0.9 + Math.sin(t * 2.3 + b.ph) * 0.25,
        b.cz + Math.sin(t * 0.7 + b.ph) * 1.2
      );
      b.g.rotation.y = t * 0.9 + b.ph;
      const flap = Math.sin(t * 18 + b.ph) * 0.6;
      b.wl.rotation.y = flap;
      b.wr.rotation.y = -flap;
    }
  });

  // ---------- 栖息在苹果树上的小鸟：玩家靠近会惊飞 ----------
  interface PerchedBird {
    g: THREE.Group;
    wl: THREE.Mesh;
    wr: THREE.Mesh;
    tree: ShakeTree;
    home: THREE.Vector3;
    state: "perch" | "startled";
    t0: number;
  }
  const perched: PerchedBird[] = [];
  for (const tree of shakeTrees.slice(0, 3)) {
    const g = new THREE.Group();
    const bm = mat(0xe8734a);
    const bodyB = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), bm);
    bodyB.scale.set(1, 0.85, 1.3);
    const wingGeo = new THREE.BoxGeometry(0.36, 0.03, 0.18);
    const wl = new THREE.Mesh(wingGeo, bm);
    wl.position.x = -0.22;
    const wr = new THREE.Mesh(wingGeo, bm);
    wr.position.x = 0.22;
    g.add(bodyB, wl, wr);
    const home = new THREE.Vector3(tree.x + 0.25, 2.75, tree.z + 0.15);
    g.position.copy(home);
    wl.rotation.z = 1.05; // 收翅蹲着
    wr.rotation.z = -1.05;
    group.add(g);
    perched.push({ g, wl, wr, tree, home, state: "perch", t0: 0 });
  }
  animated.push((_dt, t, playerPos) => {
    for (const b of perched) {
      if (b.state === "perch") {
        // 蹲着偶尔东张西望；玩家靠近 3.5 内惊飞
        b.g.rotation.y = Math.sin(t * 0.8 + b.home.x) * 0.7;
        if (playerPos && Math.hypot(playerPos.x - b.tree.x, playerPos.z - b.tree.z) < 3.5) {
          b.state = "startled";
          b.t0 = t;
          sfx.chirp();
        }
        continue;
      }
      const el = t - b.t0;
      if (el < 4) {
        // 绕树盘旋两圈，边飞边升
        const a = el * Math.PI + b.home.x;
        b.g.position.set(b.tree.x + Math.cos(a) * 2.6, 2.8 + el * 0.7, b.tree.z + Math.sin(a) * 2.6);
        b.g.rotation.y = -a;
        const flap = Math.sin(t * 22) * 0.7;
        b.wl.rotation.z = 0.3 + flap;
        b.wr.rotation.z = -0.3 - flap;
      } else if (el < 15) {
        b.g.visible = false; // 飞远躲一会儿
      } else {
        // 落回老位置，重新收翅
        b.state = "perch";
        b.g.visible = true;
        b.g.position.copy(b.home);
        b.wl.rotation.z = 1.05;
        b.wr.rotation.z = -1.05;
      }
    }
  });

  // ---------- 摇树：树冠阻尼振荡；冷却结束苹果重新长回 ----------
  animated.push((dt, t) => {
    for (const tree of shakeTrees) {
      if (tree.shakeT > 0) {
        tree.shakeT = Math.max(0, tree.shakeT - dt);
        const k = tree.shakeT;
        tree.crown.rotation.z = Math.sin(t * 26) * 0.16 * k;
        tree.crown.rotation.x = Math.cos(t * 21) * 0.1 * k;
        if (tree.shakeT === 0) tree.crown.rotation.set(0, 0, 0);
      }
      if (t >= tree.cooldownUntil) {
        for (const a of tree.apples) {
          if (a.userData.dropped) {
            // 长回来：挂回树冠原位，scale 从 0 弹回
            a.userData.dropped = false;
            a.visible = true;
            tree.crown.add(a);
            a.position.copy(a.userData.home as THREE.Vector3);
            a.scale.setScalar(0.05);
          } else if (a.scale.x < 1) {
            a.scale.setScalar(Math.min(1, a.scale.x + dt * 2.5));
          }
        }
      }
    }
  });

  // ---------- 碰撞与高度 ----------
  const onBridge = (x: number, z: number) =>
    Math.abs(x - BRIDGE.x) < BRIDGE.halfW && z > BRIDGE.zMin && z < BRIDGE.zMax;
  const onPier = (x: number, z: number) =>
    Math.abs(x) < PIER.halfW && z < PIER.zStart && z > PIER.zEnd;

  const isWalkable = (x: number, z: number): boolean => {
    if (onPier(x, z)) return true; // 栈道伸进海面也能走
    if (Math.hypot(x, z) > ISLAND_R - 1.2) return false; // 岛缘
    if (z > RIVER.zMin && z < RIVER.zMax && Math.abs(x) < RIVER.halfWidth && !onBridge(x, z)) return false; // 河
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
    }
    return true;
  };

  const groundY = (x: number, z: number): number => {
    if (onPier(x, z)) return PIER.y;
    if (onBridge(x, z)) return archY(z) + 0.05;
    return 0;
  };

  const isSailable = (x: number, z: number): boolean => {
    const d = Math.hypot(x, z);
    if (d > SAIL_R) return false; // 别划出天边
    if (d > ISLAND_R - 1) return true; // 海洋环带
    // 河面（桥区拱高够，可以划船穿过）
    if (z > RIVER.zMin + 0.4 && z < RIVER.zMax - 0.4 && Math.abs(x) < RIVER.halfWidth - 1) return true;
    return false;
  };

  const waterY = (x: number, z: number): number => {
    // 河面水位约 0，海面约 -0.9；小船吃水后的浮动高度
    if (z > RIVER.zMin - 1 && z < RIVER.zMax + 1 && Math.hypot(x, z) <= ISLAND_R - 1) return 0.1;
    return -0.55;
  };

  // ---------- 摇树入口 ----------
  const canShake = (tree: ShakeTree): boolean =>
    now >= tree.cooldownUntil && tree.apples.some((a) => !a.userData.dropped);

  const shakeTree = (tree: ShakeTree): THREE.Mesh[] | null => {
    if (!canShake(tree)) return null;
    tree.shakeT = 0.9;
    tree.cooldownUntil = now + 20;
    const dropped: THREE.Mesh[] = [];
    for (const a of tree.apples) {
      if (a.userData.dropped) continue;
      a.userData.dropped = true;
      // 挂到 world.group 下并转成世界坐标，抛物线/磁吸由 game 接管
      group.attach(a);
      dropped.push(a);
    }
    return dropped;
  };

  scene.add(group);

  return {
    group,
    obstacles,
    shakeTrees,
    houses,
    isWalkable,
    groundY,
    isSailable,
    waterY,
    plazaCenter: { x: PLAZA.x, z: PLAZA.z },
    plazaRadius: PLAZA.r,
    igniteBonfire,
    canShake,
    shakeTree,
    tick: (dt, t, playerPos) => {
      now = t;
      for (const fn of animated) fn(dt, t, playerPos);
    },
  };
}
