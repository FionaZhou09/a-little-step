/**
 * boat.ts — 小木船：船体拼装、浮动/侧倾/尾迹视觉效果，
 * 以及钓鱼用的浮漂 / 水下鱼影 / 水花（位置由 game 的钓鱼状态机驱动）。
 */
import * as THREE from "three";

export interface Boat {
  /** 外层：位置与船头朝向（rotation.y = yaw） */
  group: THREE.Group;
  /** 内层：转向侧倾 + 俯仰等纯视觉变换 */
  inner: THREE.Group;
  /** 浮漂（默认隐藏，抛竿时显示） */
  bobber: THREE.Group;
  /** 水下鱼影（默认隐藏，等鱼时显示） */
  fishShadow: THREE.Mesh;
  /** 船头朝向（弧度，与角色 yaw 同约定：forward = (sin, cos)） */
  yaw: number;
  /** 停泊点（回港提示等备用） */
  home: { x: number; z: number };
  wakeAcc: number;
  wake: { m: THREE.Mesh; age: number }[]; // age < 0 = 空闲
  splash: THREE.Mesh;
  splashAge: number; // >= 0 表示水花正在播放
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
}

/** 造一只低多边形小木船，加到 parent（通常是 world.group，进屋时自动隐藏） */
export function buildBoat(parent: THREE.Object3D, x: number, z: number): Boat {
  const group = new THREE.Group();
  group.position.set(x, -0.55, z);
  const inner = new THREE.Group();
  group.add(inner);

  const woodDark = mat(0x8a5a33);
  const wood = mat(0xb98a52);

  // 船底 + 两舷 + 翘船头 + 船尾板
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 2.3), woodDark);
  bottom.position.y = 0.12;
  inner.add(bottom);
  const sideGeo = new THREE.BoxGeometry(0.12, 0.42, 2.3);
  const sideL = new THREE.Mesh(sideGeo, wood);
  sideL.position.set(-0.5, 0.32, 0);
  sideL.rotation.z = 0.12;
  const sideR = sideL.clone();
  sideR.position.x = 0.5;
  sideR.rotation.z = -0.12;
  inner.add(sideL, sideR);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.5), wood);
  bow.position.set(0, 0.42, 1.3);
  bow.rotation.x = -0.35; // 船头微微翘起
  inner.add(bow);
  const stern = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.14), wood);
  stern.position.set(0, 0.34, -1.15);
  inner.add(stern);
  // 座位板
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.36), woodDark);
  bench.position.set(0, 0.42, -0.3);
  inner.add(bench);
  // 小桨横在船上
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), woodDark);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.03), wood);
  blade.position.y = -0.75;
  paddle.add(shaft, blade);
  paddle.position.set(0.15, 0.5, 0.45);
  paddle.rotation.set(0, 0.4, Math.PI / 2.2);
  inner.add(paddle);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  parent.add(group);

  // 浮漂：红身白顶小球 + 小天线
  const bobber = new THREE.Group();
  const bobBody = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), mat(0xe0432f));
  const bobTop = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat(0xffffff));
  bobTop.position.y = 0.08;
  const bobPin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), woodDark);
  bobPin.position.y = 0.16;
  bobber.add(bobBody, bobTop, bobPin);
  bobber.visible = false;
  parent.add(bobber);

  // 水下鱼影：深色扁椭球
  const fishShadow = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 7, 6),
    new THREE.MeshStandardMaterial({ color: 0x1e5a7a, transparent: true, opacity: 0.5, roughness: 1 })
  );
  fishShadow.scale.set(1, 0.3, 1.6);
  fishShadow.visible = false;
  parent.add(fishShadow);

  // 尾迹泡沫（对象池）+ 水花一现
  const wakeMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const wake: { m: THREE.Mesh; age: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 12), wakeMat());
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    parent.add(m);
    wake.push({ m, age: -1 });
  }
  const splash = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 12), wakeMat());
  splash.rotation.x = -Math.PI / 2;
  splash.visible = false;
  parent.add(splash);

  return { group, inner, bobber, fishShadow, yaw: 0, home: { x, z }, wakeAcc: 0, wake, splash, splashAge: -1 };
}

/**
 * 每帧更新船的视觉：浮动、转向侧倾、尾迹、水花。
 * speed 单位同游戏速度；turnRate 为转向角速度（侧倾用）。
 */
export function updateBoatVisual(
  boat: Boat,
  dt: number,
  t: number,
  speed: number,
  turnRate: number,
  waterY: number
): void {
  const g = boat.group;
  g.position.y = waterY + Math.sin(t * 1.6) * 0.05 + Math.sin(t * 2.7) * 0.02;
  g.rotation.y = boat.yaw;
  boat.inner.rotation.z = THREE.MathUtils.clamp(-turnRate * 0.08, -0.18, 0.18);
  boat.inner.rotation.x = Math.sin(t * 1.8) * 0.02;

  // 开得快时船尾吐泡沫圈
  boat.wakeAcc += dt;
  if (speed > 2 && boat.wakeAcc > 0.18) {
    boat.wakeAcc = 0;
    const ring = boat.wake.find((w) => w.age < 0);
    if (ring) {
      ring.age = 0.001;
      ring.m.position.set(g.position.x - Math.sin(boat.yaw) * 1.4, waterY + 0.03, g.position.z - Math.cos(boat.yaw) * 1.4);
      ring.m.scale.setScalar(0.3);
      (ring.m.material as THREE.MeshBasicMaterial).opacity = 0.55;
      ring.m.visible = true;
    }
  }
  for (const w of boat.wake) {
    if (w.age < 0) continue;
    w.age += dt;
    if (w.age > 0.9) {
      w.age = -1;
      w.m.visible = false;
      continue;
    }
    w.m.scale.setScalar(0.3 + w.age * 1.6);
    (w.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - w.age / 0.9);
  }

  // 水花扩散一现
  if (boat.splashAge >= 0) {
    boat.splashAge += dt;
    const u = boat.splashAge / 0.6;
    if (u >= 1) {
      boat.splashAge = -1;
      boat.splash.visible = false;
    } else {
      boat.splash.scale.setScalar(0.3 + u * 1.8);
      (boat.splash.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
    }
  }
}

/** 在指定位置播一次水花（浮漂落水 / 咬钩时用） */
export function showSplash(boat: Boat, x: number, y: number, z: number): void {
  boat.splash.position.set(x, y, z);
  boat.splash.scale.setScalar(0.3);
  (boat.splash.material as THREE.MeshBasicMaterial).opacity = 0.8;
  boat.splash.visible = true;
  boat.splashAge = 0.001;
}
