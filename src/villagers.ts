/**
 * villagers.ts — 动物村民由当日课程包的名单（roster）驱动生成。
 * 没事干时在各自活动半径内随机漫步，对话/quiz/庆典时停下待机。
 */
import * as THREE from "three";
import { buildCharacter, animateCharacter, type CharacterRig, type AnimalKind, type Palette } from "./character";
import type { VillagerSpec, SupportedAnimal } from "./lesson";
import type { World } from "./world";

export interface Villager {
  name: string;
  kind: AnimalKind;
  rig: CharacterRig;
  /** 当前漫游目标点 */
  target: { x: number; z: number };
  /** true 时停下待机（对话/quiz/庆典中） */
  chatting: boolean;
  /** 活动范围：圆心 + 半径 */
  home: { x: number; z: number; r: number };
}

/** 每种动物的默认配色和代表 emoji（名牌/对话框用） */
export const KIND_DEFAULTS: Record<SupportedAnimal, { palette: Palette; emoji: string }> = {
  bear: { emoji: "🐻", palette: { fur: 0x8a5a33, furLight: 0xd9b48a, outfit: 0xc96a5b, accent: 0x6fbf5a } },
  cat: { emoji: "🐱", palette: { fur: 0xe8913a, furLight: 0xf7e3c2, outfit: 0x7a9c59, accent: 0xf2b04e } },
  rabbit: { emoji: "🐰", palette: { fur: 0xf2ede4, furLight: 0xffffff, outfit: 0x9ec9e8, accent: 0xf29ec4 } },
  fox: { emoji: "🦊", palette: { fur: 0xe8763a, furLight: 0xf7e0c2, outfit: 0x6a8ec9, accent: 0xe8c14e } },
  panda: { emoji: "🐼", palette: { fur: 0xf0ece2, furLight: 0xffffff, outfit: 0x5b7ec9, accent: 0xe0432f } },
  duck: { emoji: "🦆", palette: { fur: 0xf2d84e, furLight: 0xf7ecc2, outfit: 0x7a9c59, accent: 0xf29ec4 } },
  pig: { emoji: "🐷", palette: { fur: 0xf2a8b8, furLight: 0xf7ccd4, outfit: 0x9ec9e8, accent: 0xf2b04e } },
  owl: { emoji: "🦉", palette: { fur: 0x9a7b5b, furLight: 0xe0cba8, outfit: 0x8a6ec9, accent: 0xf2b04e } },
};

/** 预设的 5 个活动点（roster 最多 5 人，按顺序分配） */
const HOME_SPOTS = [
  { x: -10, z: 11, r: 5 }, // 西果树旁
  { x: 10, z: 10, r: 5 }, // 东草地
  { x: 4, z: -13, r: 5 }, // 河对岸
  { x: -4, z: -2, r: 4 }, // 桥北
  { x: 6.5, z: 4, r: 4 }, // 广场边
];

/** 每个村民的"到点歇一会儿"计时（不放进接口，模块内部状态） */
const waitUntil = new WeakMap<Villager, number>();

/** 同种动物出现第二次时，衣服颜色微调区分 */
function tweakOutfit(palette: Palette): Palette {
  const c = new THREE.Color(palette.outfit);
  c.offsetHSL(0.09, 0, 0.07);
  return { ...palette, outfit: c.getHex() };
}

export function createVillagers(scene: THREE.Scene, world: World, roster: VillagerSpec[]): Villager[] {
  const seenKinds = new Set<AnimalKind>();
  return roster.map((spec, i) => {
    const defaults = KIND_DEFAULTS[spec.animal];
    let palette = defaults.palette;
    if (seenKinds.has(spec.animal)) palette = tweakOutfit(palette);
    seenKinds.add(spec.animal);
    const rig = buildCharacter(spec.animal, palette);
    scene.add(rig.group);
    const home = { ...HOME_SPOTS[i % HOME_SPOTS.length] };
    rig.group.position.set(home.x, world.groundY(home.x, home.z), home.z);
    const v: Villager = {
      name: spec.name,
      kind: spec.animal,
      rig,
      target: { x: home.x, z: home.z },
      chatting: false,
      home,
    };
    waitUntil.set(v, Math.random() * 3);
    pickTarget(v, world);
    return v;
  });
}

/** 在活动半径内随机挑一个可行走的目标点 */
function pickTarget(v: Villager, world: World): void {
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * v.home.r;
    const x = v.home.x + Math.cos(a) * d;
    const z = v.home.z + Math.sin(a) * d;
    if (world.isWalkable(x, z)) {
      v.target.x = x;
      v.target.z = z;
      return;
    }
  }
  // 实在挑不到就原地待命
  v.target.x = v.rig.group.position.x;
  v.target.z = v.rig.group.position.z;
}

const WALK_SPEED = 1.5;

export function updateVillagers(vs: Villager[], world: World, dt: number, t: number): void {
  for (const v of vs) {
    const rig = v.rig;
    const pos = rig.group.position;
    if (v.chatting) {
      // 待机：只做呼吸和头部扫视
      animateCharacter(rig, dt, 0, t + pos.x);
      continue;
    }
    const dx = v.target.x - pos.x;
    const dz = v.target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    let speed01 = 0;
    if (dist > 0.4) {
      speed01 = 0.4; // 村民悠闲慢走
      const nx = pos.x + (dx / dist) * WALK_SPEED * dt;
      const nz = pos.z + (dz / dist) * WALK_SPEED * dt;
      if (world.isWalkable(nx, nz)) {
        pos.x = nx;
        pos.z = nz;
      } else {
        pickTarget(v, world); // 被挡住就换个目标
      }
      const desired = Math.atan2(dx, dz);
      rig.group.rotation.y = dampAngle(rig.group.rotation.y, desired, 8, dt);
    } else if (t > (waitUntil.get(v) ?? 0)) {
      waitUntil.set(v, t + 2 + Math.random() * 5);
      pickTarget(v, world);
    }
    pos.y = world.groundY(pos.x, pos.z);
    animateCharacter(rig, dt, speed01, t + pos.x);
  }
}

/** 角度平滑逼近（处理 ±π 环绕） */
export function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
