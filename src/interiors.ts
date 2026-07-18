/**
 * interiors.ts — 村民小屋内部：三间房子对应名单前 3 个村民的家。
 * 每间房：地板/三面墙/地毯/床/小桌/台灯 + 一个按主人动物主题的惊喜互动。
 * 进屋时 game 隐藏 world.group、显示房间 group，玩家用房间局部坐标走动。
 */
import * as THREE from "three";
import type { VillagerSpec, SupportedAnimal } from "./lesson";
import type { HouseInfo } from "./world";
import { speak, sfx, tone } from "./audio";

export interface Room {
  ownerName: string;
  animal: SupportedAnimal;
  group: THREE.Group;
  /** 门前站位点（世界坐标，进屋/出屋定位用） */
  houseDoor: { x: number; z: number };
  /** 门口地毯（房间局部坐标），站近按 E 退出 */
  doorLocal: { x: number; z: number };
  /** 惊喜互动点（房间局部坐标）与提示文案 */
  surprise: { x: number; z: number; label: string };
  /** 屋内可行走判断（局部坐标）：矩形边界 + 家具圆形障碍 */
  walkable(x: number, z: number): boolean;
  /** 触发惊喜：动画 + 音效 + 一句英语 */
  triggerSurprise(): void;
  tick(dt: number, t: number): void;
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...opts });
}

/** 惊喜主题：动画方式 + 提示文案 + 触发时的音效和英语 */
interface Theme {
  label: string;
  line: string;
  kind: "shake" | "roll" | "bounce" | "spin";
  build(): THREE.Group;
  onTrigger(): void;
}

function themeFor(animal: SupportedAnimal): Theme {
  if (animal === "bear") {
    return {
      label: "摇一摇蜂蜜罐",
      line: "Yummy, honey!",
      kind: "shake",
      build: () => {
        const g = new THREE.Group();
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 9), mat(0xd98f2e));
        pot.position.y = 0.17;
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.1, 8), mat(0xb06e1e));
        lid.position.y = 0.38;
        const dipper = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), mat(0x8a5a33));
        dipper.position.set(0.16, 0.42, 0);
        dipper.rotation.z = 0.5;
        g.add(pot, lid, dipper);
        return g;
      },
      onTrigger: () => sfx.munch(),
    };
  }
  if (animal === "cat") {
    return {
      label: "玩一玩毛线球",
      line: "Let's play!",
      kind: "roll",
      build: () => {
        const g = new THREE.Group();
        const yarn = mat(0xe86a8a);
        const ballM = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), yarn);
        ballM.position.y = 0.22;
        const wrap1 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 5, 12), mat(0xf29ec4));
        wrap1.position.y = 0.22;
        const wrap2 = wrap1.clone();
        wrap2.rotation.y = Math.PI / 2;
        g.add(ballM, wrap1, wrap2);
        return g;
      },
      onTrigger: () => sfx.pop(),
    };
  }
  if (animal === "rabbit") {
    return {
      label: "抱一抱胡萝卜",
      line: "Crunch, crunch!",
      kind: "bounce",
      build: () => {
        const g = new THREE.Group();
        const carrot = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 7), mat(0xf2793a));
        carrot.position.y = 0.32;
        carrot.rotation.z = Math.PI; // 尖朝下，像抱枕一样立着
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 5), mat(0x6fbf5a));
        top.position.y = 0.68;
        g.add(carrot, top);
        return g;
      },
      onTrigger: () => sfx.munch(),
    };
  }
  // 其他动物：八音盒
  return {
    label: "打开八音盒",
    line: "What a nice song!",
    kind: "spin",
    build: () => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.28), mat(0x8a5a33));
      box.position.y = 0.1;
      const lidM = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.3), mat(0xb06e1e));
      lidM.position.y = 0.22;
      const dancer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.16, 7), mat(0xe8c14e));
      dancer.position.y = 0.32;
      g.add(box, lidM, dancer);
      return g;
    },
    onTrigger: () => {
      // 一小段琶音旋律
      [523, 659, 784, 1047, 784, 659].forEach((f, i) =>
        tone(f, 0.18, { type: "triangle", gain: 0.1, when: i * 0.14 })
      );
    },
  };
}

/** 房间尺寸（局部坐标）：x ∈ [-3, 3]，z ∈ [-2.5, 2.5]，前面（+z）留空给相机 */
const ROOM = { hw: 3, hd: 2.5 };
const WALL_COLORS = [0xf7e3c2, 0xe8f0d8, 0xf2d8d8];

export function buildInteriors(scene: THREE.Scene, roster: VillagerSpec[], houses: HouseInfo[]): Room[] {
  return roster.slice(0, 3).map((spec, i) => {
    const house = houses[i];
    const group = new THREE.Group();
    group.position.set(house.x, 0, house.z);
    group.visible = false; // 进屋时才显示

    const obstacles: { x: number; z: number; r: number }[] = [];
    const add = (...objs: THREE.Object3D[]) => group.add(...objs);
    const wallColor = WALL_COLORS[i % WALL_COLORS.length];

    // 地板 + 三面墙（无屋顶，相机从上方看进去）
    const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.hw * 2, 0.1, ROOM.hd * 2), mat(0xd9b48a));
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    add(floor);
    const wallMat = mat(wallColor);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.hw * 2, 2.2, 0.15), wallMat);
    backWall.position.set(0, 1.1, -ROOM.hd);
    const sideGeo = new THREE.BoxGeometry(0.15, 2.2, ROOM.hd * 2);
    const leftWall = new THREE.Mesh(sideGeo, wallMat);
    leftWall.position.set(-ROOM.hw, 1.1, 0);
    const rightWall = new THREE.Mesh(sideGeo, wallMat);
    rightWall.position.set(ROOM.hw, 1.1, 0);
    add(backWall, leftWall, rightWall);
    // 后墙挂一幅小画
    const picture = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.05), mat(0x9ec9e8));
    picture.position.set(-0.6, 1.4, -ROOM.hd + 0.1);
    add(picture);

    // 地毯（门口一块 + 中央一块）
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 18), mat(0xe88a7a));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.01, 0.4);
    add(rug);
    const doorMat = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), mat(0x7a9c59));
    doorMat.rotation.x = -Math.PI / 2;
    doorMat.position.set(0, 0.012, 2.05);
    add(doorMat);

    // 床：床架 + 床单 + 枕头
    const bed = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 1.1), mat(0x8a5a33));
    frame.position.y = 0.15;
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1), mat(0xc96a5b));
    blanket.position.y = 0.34;
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.7), mat(0xffffff));
    pillow.position.set(-0.5, 0.42, 0);
    bed.add(frame, blanket, pillow);
    bed.position.set(-1.75, 0, -1.5);
    add(bed);
    obstacles.push({ x: -1.75, z: -1.5, r: 1.05 });

    // 小桌 + 台灯
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.07, 10), mat(0xb06e1e));
    top.position.y = 0.55;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.55, 7), mat(0x8a5a33));
    leg.position.y = 0.27;
    table.add(top, leg);
    table.position.set(1.8, 0, -1.6);
    add(table);
    obstacles.push({ x: 1.8, z: -1.6, r: 0.6 });

    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 6), mat(0x8a5a33));
    pole.position.y = 0.45;
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.25, 8),
      mat(0xffe08a, { emissive: 0xffcc44, emissiveIntensity: 0.5 })
    );
    shade.position.y = 0.98;
    lamp.add(pole, shade);
    lamp.position.set(2.55, 0, -2.05);
    add(lamp);
    obstacles.push({ x: 2.55, z: -2.05, r: 0.28 });

    // 主题惊喜：放在中央地毯边上
    const theme = themeFor(spec.animal);
    const item = theme.build();
    const itemHome = new THREE.Vector3(1.1, 0, 0.9);
    item.position.copy(itemHome);
    group.add(item);
    let animT = -1; // <0 表示没在播动画
    const triggerSurprise = () => {
      if (animT >= 0) return; // 上一次还没播完
      animT = 0;
      theme.onTrigger();
      speak(theme.line);
    };
    const tick = (dt: number) => {
      if (animT < 0) return;
      animT += dt;
      const k = Math.max(0, 1 - animT / 1.8); // 动画衰减系数
      if (animT > 1.8) {
        // 复位
        animT = -1;
        item.position.copy(itemHome);
        item.rotation.set(0, 0, 0);
        return;
      }
      if (theme.kind === "shake") {
        item.rotation.z = Math.sin(animT * 22) * 0.25 * k;
      } else if (theme.kind === "roll") {
        item.position.x = itemHome.x + Math.sin(animT * 6) * 0.5 * k;
        item.position.z = itemHome.z + Math.cos(animT * 6) * 0.2 * k;
        item.rotation.z = -animT * 6;
      } else if (theme.kind === "bounce") {
        item.position.y = itemHome.y + Math.abs(Math.sin(animT * 10)) * 0.35 * k;
      } else {
        item.rotation.y = animT * 8;
      }
    };

    const walkable = (x: number, z: number): boolean => {
      if (Math.abs(x) > ROOM.hw - 0.45 || z < -ROOM.hd + 0.45 || z > ROOM.hd - 0.3) return false;
      for (const o of obstacles) {
        if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
      }
      return true;
    };

    scene.add(group);
    return {
      ownerName: spec.name,
      animal: spec.animal,
      group,
      houseDoor: house.door,
      doorLocal: { x: 0, z: 2.05 },
      surprise: { x: itemHome.x, z: itemHome.z, label: theme.label },
      walkable,
      triggerSurprise,
      tick: (dt: number, _t: number) => tick(dt),
    };
  });
}
