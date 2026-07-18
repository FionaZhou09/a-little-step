/**
 * character.ts — Q 版小动物角色拼装与程序化动画。
 * 所有角色共用一套身体（大头小身胶囊四肢），
 * 动物差异只体现在头部配件和配色上。
 */
import * as THREE from "three";
import type { SupportedAnimal } from "./lesson";

export interface CharacterRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** 走路相位累计值，由 animateCharacter 推进 */
  walkT: number;
}

/** 9 种动物：dog 是玩家，其余 8 种是可选村民 */
export type AnimalKind = "dog" | SupportedAnimal;

export interface Palette {
  /** 主毛色 */
  fur: number;
  /** 浅毛色（肚皮/口鼻/内耳） */
  furLight: number;
  /** 衣服色（身体） */
  outfit: number;
  /** 点缀色（小领巾） */
  accent: number;
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

function ball(r: number, color: number, w = 8, h = 6): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat(color));
}

/** 拼一只约 1.5 单位高的小动物，Group 原点在两腿之间（脚底 y=0） */
export function buildCharacter(kind: AnimalKind, p: Palette): CharacterRig {
  const group = new THREE.Group();

  // ---- 腿：髋关节 Group 挂在 y=0.4，mesh 下移，旋转 Group 即摆腿 ----
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.18, 3, 6);
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  const legMeshL = new THREE.Mesh(legGeo, mat(p.fur));
  const legMeshR = new THREE.Mesh(legGeo, mat(p.fur));
  legMeshL.position.y = -0.15;
  legMeshR.position.y = -0.15;
  // 小脚丫
  const footGeo = new THREE.SphereGeometry(0.1, 6, 5);
  const footL = new THREE.Mesh(footGeo, mat(p.furLight));
  footL.scale.set(1, 0.55, 1.35);
  footL.position.set(0, -0.3, 0.05);
  const footR = footL.clone();
  legL.add(legMeshL, footL);
  legR.add(legMeshR, footR);
  legL.position.set(-0.15, 0.4, 0);
  legR.position.set(0.15, 0.4, 0);
  group.add(legL, legR);

  // ---- 身体：微压扁的球（衣服色）+ 浅肚皮 ----
  const body = ball(0.42, p.outfit, 9, 7);
  body.scale.set(1, 0.95, 0.88);
  body.position.y = 0.76;
  group.add(body);
  const belly = ball(0.29, p.furLight, 7, 6);
  belly.scale.set(0.85, 0.95, 0.55);
  belly.position.set(0, 0.72, 0.25);
  group.add(belly);

  // ---- 手臂：肩关节 Group 挂在 y=1.02 ----
  const armGeo = new THREE.CapsuleGeometry(0.08, 0.2, 3, 6);
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const armMeshL = new THREE.Mesh(armGeo, mat(p.outfit));
  const armMeshR = new THREE.Mesh(armGeo, mat(p.outfit));
  armMeshL.position.y = -0.14;
  armMeshR.position.y = -0.14;
  const pawGeo = new THREE.SphereGeometry(0.085, 6, 5);
  const pawL = new THREE.Mesh(pawGeo, mat(p.fur));
  pawL.position.y = -0.3;
  const pawR = pawL.clone();
  armL.add(armMeshL, pawL);
  armR.add(armMeshR, pawR);
  armL.position.set(-0.42, 1.02, 0);
  armR.position.set(0.42, 1.02, 0);
  armL.rotation.z = 0.3;
  armR.rotation.z = -0.3;
  group.add(armL, armR);

  // ---- 头 ----
  const head = new THREE.Group();
  head.position.y = 1.32;
  const skull = ball(0.46, p.fur, 10, 8);
  head.add(skull);

  // 口鼻 + 鼻子
  const muzzle = ball(0.19, p.furLight, 7, 6);
  muzzle.scale.set(1.3, 0.85, 1);
  muzzle.position.set(0, -0.14, 0.37);
  head.add(muzzle);
  const nose = ball(0.065, 0x3a2a22, 6, 5);
  nose.position.set(0, -0.06, 0.54);
  head.add(nose);

  // 眼睛：深色球 + 白色高光点（Basic 材质不受光）
  const eyeGeo = new THREE.SphereGeometry(0.058, 7, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2b1d16, roughness: 0.35 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.18, 0.06, 0.4);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.18;
  const sparkGeo = new THREE.SphereGeometry(0.02, 4, 4);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sparkL = new THREE.Mesh(sparkGeo, sparkMat);
  sparkL.position.set(-0.163, 0.085, 0.447);
  const sparkR = sparkL.clone();
  sparkR.position.x = 0.197;
  head.add(eyeL, eyeR, sparkL, sparkR);

  // 腮红（小朋友的 Q 版感）
  const blushGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const blushMat = new THREE.MeshStandardMaterial({ color: 0xf2a0a0, roughness: 1 });
  const blushL = new THREE.Mesh(blushGeo, blushMat);
  blushL.scale.set(1, 0.6, 0.5);
  blushL.position.set(-0.3, -0.08, 0.33);
  const blushR = blushL.clone();
  blushR.position.x = 0.3;
  head.add(blushL, blushR);

  // ---- 动物差异：只看头部配件（狐狸/猪多一条尾巴） ----
  if (kind === "bear") {
    // 圆耳 + 浅内耳
    const earGeo = new THREE.SphereGeometry(0.15, 7, 6);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.3, 0.36, 0);
    const earR = earL.clone();
    earR.position.x = 0.3;
    const innerGeo = new THREE.SphereGeometry(0.075, 5, 4);
    const innerL = new THREE.Mesh(innerGeo, mat(p.furLight));
    innerL.position.set(-0.3, 0.36, 0.09);
    const innerR = innerL.clone();
    innerR.position.x = 0.3;
    head.add(earL, earR, innerL, innerR);
  } else if (kind === "cat") {
    // 三角锥耳 + 胡须
    const earGeo = new THREE.ConeGeometry(0.14, 0.26, 4);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.27, 0.44, 0);
    earL.rotation.z = 0.22;
    const earR = earL.clone();
    earR.position.x = 0.27;
    earR.rotation.z = -0.22;
    head.add(earL, earR);
    const whiskerGeo = new THREE.BoxGeometry(0.16, 0.012, 0.012);
    const whiskerMat = mat(0xf7f2e4);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const w = new THREE.Mesh(whiskerGeo, whiskerMat);
        w.position.set(side * 0.38, -0.1 + i * 0.05, 0.32);
        w.rotation.z = side * (0.15 - i * 0.2);
        head.add(w);
      }
    }
  } else if (kind === "rabbit") {
    // 长胶囊耳朵竖起来，一只微微弯
    const earGeo = new THREE.CapsuleGeometry(0.09, 0.34, 3, 6);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.17, 0.66, 0);
    earL.rotation.z = 0.12;
    const earR = new THREE.Mesh(earGeo, mat(p.fur));
    earR.position.set(0.19, 0.64, 0);
    earR.rotation.z = -0.3;
    const innerGeo = new THREE.CapsuleGeometry(0.04, 0.22, 3, 5);
    const innerMat = mat(0xf5b8c4);
    const innerL = new THREE.Mesh(innerGeo, innerMat);
    innerL.position.set(-0.16, 0.64, 0.07);
    innerL.rotation.z = 0.12;
    const innerR = new THREE.Mesh(innerGeo, innerMat);
    innerR.position.set(0.18, 0.62, 0.07);
    innerR.rotation.z = -0.3;
    head.add(earL, earR, innerL, innerR);
  } else if (kind === "fox") {
    // 大尖锥耳 + 尖口鼻 + 大锥尾
    const earGeo = new THREE.ConeGeometry(0.16, 0.36, 4);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.28, 0.5, 0);
    earL.rotation.z = 0.18;
    const earR = earL.clone();
    earR.position.x = 0.28;
    earR.rotation.z = -0.18;
    head.add(earL, earR);
    // 尖口鼻：把通用口鼻拉长，鼻子前移
    muzzle.scale.set(1.1, 0.8, 1.5);
    nose.position.z = 0.64;
    // 大尾巴：主锥 + 浅色尾尖，翘在身体后上方
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 7), mat(p.fur));
    tail.position.set(0, 0.62, -0.52);
    tail.rotation.x = -Math.PI / 2.6;
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 6), mat(p.furLight));
    tailTip.position.set(0, 0.98, -0.82);
    tailTip.rotation.x = -Math.PI / 2.6;
    group.add(tail, tailTip);
  } else if (kind === "panda") {
    // 黑圆耳 + 黑眼圈（压扁深色球垫在眼睛后面）
    const dark = mat(0x3a3230);
    const earGeo = new THREE.SphereGeometry(0.14, 7, 6);
    const earL = new THREE.Mesh(earGeo, dark);
    earL.position.set(-0.3, 0.36, 0);
    const earR = earL.clone();
    earR.position.x = 0.3;
    head.add(earL, earR);
    const patchGeo = new THREE.SphereGeometry(0.11, 7, 6);
    const patchL = new THREE.Mesh(patchGeo, dark);
    patchL.scale.set(1, 1.4, 0.5);
    patchL.position.set(-0.18, 0.06, 0.375);
    patchL.rotation.z = 0.3;
    const patchR = patchL.clone();
    patchR.position.x = 0.18;
    patchR.rotation.z = -0.3;
    head.add(patchL, patchR);
  } else if (kind === "duck") {
    // 扁嘴（压扁盒子，换掉通用口鼻）+ 头顶小卷毛
    muzzle.visible = false;
    nose.visible = false;
    const beakMat = mat(0xf29c3a);
    const beakTop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.2), beakMat);
    beakTop.position.set(0, -0.08, 0.48);
    const beakBottom = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.16), beakMat);
    beakBottom.position.set(0, -0.15, 0.46);
    head.add(beakTop, beakBottom);
    const curl = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 5, 8, Math.PI * 1.5), mat(p.fur));
    curl.position.set(0, 0.46, 0.05);
    curl.rotation.x = -0.6;
    head.add(curl);
  } else if (kind === "pig") {
    // 圆鼻盘 + 两鼻孔点 + 卷尾巴（小环面）
    nose.visible = false;
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10), mat(0xe08a98));
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.08, 0.52);
    head.add(snout);
    const nostrilGeo = new THREE.SphereGeometry(0.02, 5, 4);
    const nostrilMat = mat(0x8a4a55);
    const noL = new THREE.Mesh(nostrilGeo, nostrilMat);
    noL.position.set(-0.04, -0.08, 0.555);
    const noR = noL.clone();
    noR.position.x = 0.04;
    head.add(noL, noR);
    // 小圆耳
    const earGeo = new THREE.SphereGeometry(0.11, 6, 5);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.scale.set(1, 1.2, 0.7);
    earL.position.set(-0.28, 0.38, 0);
    const earR = earL.clone();
    earR.position.x = 0.28;
    head.add(earL, earR);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 5, 10, Math.PI * 1.6), mat(p.fur));
    tail.position.set(0, 0.62, -0.44);
    tail.rotation.y = Math.PI / 2;
    group.add(tail);
  } else if (kind === "owl") {
    // 加大眼睛 + 浅脸盘 + 连心眉 + 两撮耳羽
    eyeL.scale.setScalar(1.45);
    eyeR.scale.setScalar(1.45);
    sparkL.position.set(-0.16, 0.1, 0.49);
    sparkR.position.set(0.19, 0.1, 0.49);
    const diskGeo = new THREE.SphereGeometry(0.14, 7, 6);
    const diskL = new THREE.Mesh(diskGeo, mat(p.furLight));
    diskL.scale.set(1, 1.1, 0.45);
    diskL.position.set(-0.18, 0.07, 0.36);
    const diskR = diskL.clone();
    diskR.position.x = 0.18;
    head.add(diskL, diskR);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.03), mat(p.furLight));
    brow.position.set(0, 0.22, 0.42);
    head.add(brow);
    const tuftGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
    const tuftL = new THREE.Mesh(tuftGeo, mat(p.fur));
    tuftL.position.set(-0.26, 0.46, 0);
    tuftL.rotation.z = 0.5;
    const tuftR = tuftL.clone();
    tuftR.position.x = 0.26;
    tuftR.rotation.z = -0.5;
    head.add(tuftL, tuftR);
  } else {
    // dog：垂耳胶囊 + 头顶一撮绒毛
    const earGeo = new THREE.CapsuleGeometry(0.1, 0.24, 3, 6);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.36, 0.22, 0.02);
    earL.rotation.z = 0.85;
    const earR = earL.clone();
    earR.position.x = 0.36;
    earR.rotation.z = -0.85;
    head.add(earL, earR);
    const tuft = ball(0.14, p.furLight, 6, 5);
    tuft.scale.set(1.3, 0.7, 1.1);
    tuft.position.set(0, 0.44, 0.06);
    head.add(tuft);
  }
  group.add(head);

  // ---- 小领巾（点缀色） ----
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 12), mat(p.accent));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.08;
  group.add(collar);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  return { group, body, head, armL, armR, legL, legR, walkT: 0 };
}

/**
 * 程序化动画：无关键帧。
 * speed 为归一化速度（0=待机，1=全速走），t 为全局秒数。
 */
export function animateCharacter(rig: CharacterRig, dt: number, speed: number, t: number): void {
  const walking = speed > 0.03;
  if (walking) rig.walkT += dt * (6 + speed * 6);
  const s = Math.sin(rig.walkT);
  // 四肢反相摆动，幅度随速度
  const amp = walking ? 0.55 * Math.min(1, speed) : 0;
  rig.legL.rotation.x = s * amp;
  rig.legR.rotation.x = -s * amp;
  rig.armL.rotation.x = -s * amp * 0.8;
  rig.armR.rotation.x = s * amp * 0.8;
  // 走路上下颠 / 待机低频呼吸
  const bob = walking ? Math.abs(s) * 0.06 : Math.sin(t * 2.1) * 0.012;
  rig.body.position.y = 0.76 + bob;
  rig.head.position.y = 1.32 + bob * 1.1 + (walking ? 0 : Math.sin(t * 1.5) * 0.008);
  // 待机时头部缓慢扫视，走路时看正前方
  rig.head.rotation.y = walking ? 0 : Math.sin(t * 0.6) * 0.14;
}
