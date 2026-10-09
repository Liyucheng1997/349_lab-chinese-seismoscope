// 候风地动仪 1:1 模型（单位：米）
// 尺寸依据：《后汉书·张衡传》“员径八尺”，东汉一尺≈23.1 cm → 直径≈1.85 m
// 内部机构依据 2005 年“悬垂摆”复原方案（都柱为悬挂的重摆），细部为示意
import * as THREE from 'three';
import { merge, smoothProfile, lathe, offsetProfile, taperTube, curveOf, blob, orient, rodBetween, box } from './geom.js';
import { BODY_DECOR } from './textures.js';
import { N_CH } from './simulation.js';

export const DIM = {
  baseTop: 0.2,          // 台座顶面
  hinge: new THREE.Vector2(1.0, 1.21), // 龙首（下颌铰点）在通道坐标系中的位置
  headTilt: -0.45,       // 龙首俯角
  jawBase: 0.28,         // 衔丸时口部张角
  jawMax: 0.42,          // 发机后下颌附加张角
  tailLen: 0.18,         // 龙颌杠杆（牙机）内伸长度
  ballR: 0.028,
  discTop: 0.76,         // 八道盘顶面
  pivotY: 1.63,          // 都柱悬挂点
  rodX: 0.835,           // 顶杆位置
  wedgeEnd: 0.86,
  wedgeSlope: 0.74,
  sliderY0: 0.76,
  sliderH: 0.03,
  footR: 0.18,
};

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/* 材质                                                                */
/* ------------------------------------------------------------------ */
export function createMaterials(tex, clipPlanes) {
  const clip = { clippingPlanes: clipPlanes, clipIntersection: true, clipShadows: true };
  const m = {};
  m.shellOuter = new THREE.MeshStandardMaterial({
    map: tex.body.map, bumpMap: tex.body.bump, bumpScale: 3.2,
    roughnessMap: tex.body.orm, metalnessMap: tex.body.orm, metalness: 1, roughness: 1, ...clip,
  });
  m.lidOuter = new THREE.MeshStandardMaterial({
    map: tex.lid.map, bumpMap: tex.lid.bump, bumpScale: 3.2,
    roughnessMap: tex.lid.orm, metalnessMap: tex.lid.orm, metalness: 1, roughness: 1, ...clip,
  });
  m.shellInner = new THREE.MeshStandardMaterial({
    map: tex.bronzeDark.map, roughnessMap: tex.bronzeDark.orm, metalnessMap: tex.bronzeDark.orm,
    color: 0x9a8a78, metalness: 1, roughness: 1, ...clip,
  });
  m.cap = new THREE.MeshBasicMaterial({ color: 0xc08a48, side: THREE.BackSide, ...clip });
  m.dragonBody = new THREE.MeshStandardMaterial({
    map: tex.bronze.map, roughnessMap: tex.bronze.orm, metalnessMap: tex.bronze.orm,
    bumpMap: tex.scales, bumpScale: 1.3, metalness: 1, roughness: 1, ...clip,
  });
  m.dragonHead = new THREE.MeshStandardMaterial({
    map: tex.bronze.map, roughnessMap: tex.bronze.orm, metalnessMap: tex.bronze.orm,
    bumpMap: tex.bronze.bump, bumpScale: 1.2, metalness: 1, roughness: 1,
  });
  m.bronze = new THREE.MeshStandardMaterial({
    map: tex.bronze.map, roughnessMap: tex.bronze.orm, metalnessMap: tex.bronze.orm,
    metalness: 1, roughness: 1,
  });
  m.mech = new THREE.MeshStandardMaterial({
    map: tex.bronzeBright.map, roughnessMap: tex.bronzeBright.orm, metalnessMap: tex.bronzeBright.orm,
    metalness: 1, roughness: 0.9, side: THREE.DoubleSide,
  });
  m.gold = new THREE.MeshStandardMaterial({ color: 0xe8b866, metalness: 1, roughness: 0.16 });
  m.dark = new THREE.MeshStandardMaterial({ color: 0x150e09, metalness: 0.2, roughness: 0.85 });
  m.darkInside = new THREE.MeshStandardMaterial({ color: 0x2a1a10, metalness: 0.4, roughness: 0.7, side: THREE.BackSide });
  m.toad = new THREE.MeshStandardMaterial({
    map: tex.bronzeGreen.map, roughnessMap: tex.bronzeGreen.orm, metalnessMap: tex.bronzeGreen.orm,
    bumpMap: tex.warts, bumpScale: 2.5, metalness: 1, roughness: 1,
  });
  m.stone = new THREE.MeshStandardMaterial({ map: tex.stone.map, bumpMap: tex.stone.bump, bumpScale: 1, roughness: 0.75, metalness: 0 });
  m.stoneBand = new THREE.MeshStandardMaterial({ map: tex.stoneBand.map, bumpMap: tex.stoneBand.bump, bumpScale: 3, roughness: 0.7, metalness: 0 });
  m.stoneTop = new THREE.MeshStandardMaterial({ map: tex.plinthTop.map, bumpMap: tex.plinthTop.bump, bumpScale: 2, roughness: 0.6, metalness: 0 });
  return m;
}

/* ------------------------------------------------------------------ */
/* 轮廓                                                                */
/* ------------------------------------------------------------------ */
const footPts = [[0.655, 0.2], [0.7, 0.203], [0.716, 0.218], [0.716, 0.262], [0.7, 0.276]];
const bodyCtrl = [[0.688, 0.292], [0.7, 0.31], [0.74, 0.35], [0.79, 0.42], [0.835, 0.52], [0.872, 0.64], [0.9, 0.78],
  [0.917, 0.92], [0.924, 1.06], [0.924, 1.2], [0.919, 1.32], [0.909, 1.43], [0.895, 1.53], [0.884, 1.6]];
const rimPts = [[0.884, 1.625], [0.896, 1.64], [0.904, 1.66], [0.901, 1.684], [0.888, 1.7]];
const lidDomeCtrl = [[0.925, 1.755], [0.895, 1.8], [0.835, 1.88], [0.745, 1.97], [0.625, 2.05], [0.485, 2.12],
  [0.345, 2.17], [0.225, 2.2], [0.14, 2.215]];

const bodySmooth = smoothProfile(bodyCtrl, 110);

// 外壁半径 R(y)
export function bodyR(y) {
  const p = bodySmooth;
  if (y <= p[0].y) return p[0].x;
  if (y >= p[p.length - 1].y) return p[p.length - 1].x;
  for (let i = 1; i < p.length; i++) {
    if (p[i].y >= y) {
      const t = (y - p[i - 1].y) / (p[i].y - p[i - 1].y);
      return p[i - 1].x + (p[i].x - p[i - 1].x) * t;
    }
  }
  return 0.9;
}

// 通道坐标系（x 向外）中，贴附器壁的点
function wall(d, y, o) {
  const r = bodyR(y) + o;
  return V3(r * Math.cos(d), y, r * Math.sin(d));
}

/* ------------------------------------------------------------------ */
/* 器身、器盖、台座                                                    */
/* ------------------------------------------------------------------ */
function addCapped(parent, geo, mat, capMat, list) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (capMat) {
    const cap = new THREE.Mesh(geo, capMat);
    cap.renderOrder = -1;
    parent.add(cap);
    list.caps.push(cap);
  }
  return mesh;
}

function buildVessel(root, M, out) {
  const vessel = new THREE.Group();
  vessel.name = '器身';
  root.add(vessel);

  // 外壁（含纹饰）
  const outer = [...footPts.map((p) => new THREE.Vector2(p[0], p[1])), ...bodySmooth, ...rimPts.map((p) => new THREE.Vector2(p[0], p[1]))];
  const vOf = (p) => THREE.MathUtils.clamp((p.y - BODY_DECOR.yBot) / (BODY_DECOR.yTop - BODY_DECOR.yBot), 0.001, 0.999);
  const outerGeo = lathe(outer, 192, vOf);
  out.shell.push(addCapped(vessel, outerGeo, M.shellOuter, M.cap, out));

  // 口沿顶面
  const rimTop = lathe([new THREE.Vector2(0.888, 1.7), new THREE.Vector2(0.85, 1.7)], 192);
  out.shell.push(addCapped(vessel, rimTop, M.shellInner, null, out));

  // 内壁（自上而下 → 法线朝内）
  const innerBody = offsetProfile(bodySmooth.filter((p) => p.y > 0.34), 0.035);
  const inner = [new THREE.Vector2(0.85, 1.7), new THREE.Vector2(0.849, 1.64), ...innerBody.slice().reverse(), new THREE.Vector2(0.67, 0.3)];
  const innerGeo = lathe(inner, 192, (p) => p.y);
  out.shell.push(addCapped(vessel, innerGeo, M.shellInner, M.cap, out));

  // 器底（内）
  const floor = new THREE.CircleGeometry(0.69, 96);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, 0.3, 0);
  const fm = new THREE.Mesh(floor, M.shellInner.clone());
  fm.material.clippingPlanes = null;
  fm.material.color.set(0x5a4a3a);
  fm.material.envMapIntensity = 0.4;
  fm.receiveShadow = true;
  vessel.add(fm);
  return vessel;
}

function buildLid(root, M, out) {
  const lid = new THREE.Group();
  lid.name = '合盖';
  root.add(lid);
  const dome = smoothProfile(lidDomeCtrl, 90);
  const outerPts = [new THREE.Vector2(0.93, 1.665), new THREE.Vector2(0.936, 1.675), new THREE.Vector2(0.936, 1.735), ...dome];
  const outerGeo = lathe(outerPts, 192, (p, j, f) => f);
  out.shell.push(addCapped(lid, outerGeo, M.lidOuter, M.cap, out));

  const innerDome = offsetProfile(dome, 0.03);
  const innerPts = [...innerDome.slice().reverse(), new THREE.Vector2(0.908, 1.735), new THREE.Vector2(0.908, 1.665)];
  out.shell.push(addCapped(lid, lathe(innerPts, 192, (p) => p.y), M.shellInner, M.cap, out));
  out.shell.push(addCapped(lid, lathe([new THREE.Vector2(0.908, 1.665), new THREE.Vector2(0.93, 1.665)], 192), M.shellInner, null, out));

  // 盖钮：莲苞形
  const knobCtrl = [[0.15, 2.205], [0.152, 2.222], [0.13, 2.242], [0.095, 2.254], [0.068, 2.266], [0.062, 2.28], [0.086, 2.29],
    [0.088, 2.304], [0.07, 2.316], [0.082, 2.33], [0.1, 2.36], [0.098, 2.392], [0.078, 2.422], [0.048, 2.45], [0.018, 2.472], [0.0, 2.48]];
  const knob = lathe(smoothProfile(knobCtrl, 70), 64);
  const parts = [knob];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const petal = blob(0.032, 0.062, 0.012, (x, y, z) => [x * (1 - 0.35 * (y + 1) * 0.5), y, z]);
    petal.rotateZ(-0.35);
    petal.translate(0.088, 2.37, 0);
    petal.rotateY(a);
    parts.push(petal);
  }
  const knobMesh = new THREE.Mesh(merge(parts), M.bronze);
  knobMesh.castShadow = true;
  lid.add(knobMesh);
  return lid;
}

function buildPedestal(root, M) {
  const g = new THREE.Group();
  g.name = '台座';
  const prof = [[1.75, 0], [1.75, 0.044], [1.738, 0.05], [1.62, 0.05], [1.62, 0.094], [1.608, 0.1], [1.522, 0.1], [1.522, 0.19], [1.51, 0.2], [1.4, 0.2]]
    .map((p) => new THREE.Vector2(p[0], p[1]));
  const steps = new THREE.Mesh(lathe(prof, 160), M.stone);
  steps.receiveShadow = true;
  steps.castShadow = true;
  g.add(steps);
  const band = new THREE.CylinderGeometry(1.5235, 1.5235, 0.075, 160, 1, true);
  band.translate(0, 0.147, 0);
  g.add(Object.assign(new THREE.Mesh(band, M.stoneBand), { receiveShadow: true }));
  const top = new THREE.CircleGeometry(1.515, 160);
  top.rotateX(-Math.PI / 2);
  top.translate(0, 0.2, 0);
  const topMesh = new THREE.Mesh(top, M.stoneTop);
  topMesh.receiveShadow = true;
  g.add(topMesh);
  root.add(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 龙                                                                  */
/* ------------------------------------------------------------------ */
const spineDef = [
  [null, 0.975, 1.255, 0],
  [0.02, 1.33, 0.03], [0.1, 1.39, 0.03], [0.19, 1.43, 0.031], [0.235, 1.5, 0.031], [0.17, 1.55, 0.03],
  [0.05, 1.555, 0.029], [-0.07, 1.52, 0.026], [-0.16, 1.45, 0.022], [-0.2, 1.36, 0.018], [-0.17, 1.285, 0.014],
  [-0.11, 1.27, 0.011], [-0.093, 1.312, 0.009],
];
function spineRadius(t) {
  if (t < 0.08) return 0.037 + (t / 0.08) * 0.012;
  if (t < 0.45) return 0.049 + ((t - 0.08) / 0.37) * 0.004;
  const k = (t - 0.45) / 0.55;
  return 0.006 + 0.047 * Math.pow(1 - k, 1.25);
}

function buildDragonBody() {
  const pts = spineDef.map((d) => (d[0] === null ? V3(d[1], d[2], d[3]) : wall(d[0], d[1], d[2])));
  const curve = curveOf(pts, 0.5);
  const parts = [taperTube(curve, 200, 16, spineRadius, { uRepeat: 22, vRepeat: 3 })];
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  const radial = (p) => V3(p.x, 0, p.z).normalize();
  // 背鳍
  for (let t = 0.07; t < 0.93; t += 0.028) {
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    const rb = spineRadius(t);
    const D = radial(P);
    const dir = D.clone().addScaledVector(T, 0.45).normalize();
    const fin = new THREE.ConeGeometry(rb * 0.45, rb * 0.95 + 0.008, 4, 1);
    fin.translate(0, (rb * 0.95 + 0.008) / 2, 0);
    fin.scale(0.32, 1, 1.5);
    parts.push(orient(fin, P.clone().addScaledVector(D, rb * 0.78), dir, T));
  }
  // 四足
  for (const t of [0.17, 0.62]) {
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    const rb = spineRadius(t);
    const D = radial(P);
    const W = new THREE.Vector3().crossVectors(T, D).normalize();
    for (const s of [-1, 1]) {
      const hip = P.clone().addScaledVector(W, s * rb * 0.6);
      const knee = P.clone().addScaledVector(W, s * (rb + 0.05)).addScaledVector(D, 0.035).addScaledVector(T, -0.012);
      const foot = P.clone().addScaledVector(W, s * (rb + 0.085)).addScaledVector(T, 0.03);
      const fr = bodyR(foot.y) + 0.01;
      const fl = Math.hypot(foot.x, foot.z);
      foot.x *= fr / fl; foot.z *= fr / fl;
      parts.push(taperTube(curveOf([hip, knee, foot]), 24, 10, (u) => 0.021 - u * 0.009, { uRepeat: 3 }));
      parts.push(blob(0.016, 0.012, 0.016).translate(foot.x, foot.y, foot.z));
      const Df = radial(foot);
      for (const b of [-0.7, 0, 0.7]) {
        const dir = T.clone().multiplyScalar(Math.cos(b)).addScaledVector(W, s * Math.sin(b)).addScaledVector(Df, -0.35).normalize();
        const claw = new THREE.ConeGeometry(0.0055, 0.034, 6);
        claw.translate(0, 0.017, 0);
        parts.push(orient(claw, foot.clone().addScaledVector(dir, 0.012), dir));
      }
    }
  }
  return merge(parts);
}

function sym(fn) {
  return [fn(1), fn(-1)];
}

function buildDragonHead(M, matTail) {
  const head = new THREE.Group();
  const upper = [];
  const fixed = [];

  // 颅
  fixed.push(blob(0.068, 0.056, 0.056, (x, y, z) => [x, y + 0.12 * Math.max(0, x) * (y > 0 ? 1 : 0), z]).translate(-0.03, 0.03, 0));
  // 颊
  fixed.push(...sym((s) => blob(0.042, 0.032, 0.03).translate(0.0, 0.006, 0.04 * s)));
  // 眉
  fixed.push(...sym((s) => blob(0.042, 0.015, 0.02).rotateY(0.3 * s).translate(0.035, 0.07, 0.033 * s)));
  // 耳
  fixed.push(...sym((s) => {
    const c = new THREE.ConeGeometry(0.016, 0.055, 8);
    c.scale(1, 1, 0.45);
    c.translate(0, 0.027, 0);
    return orient(c, V3(-0.045, 0.07, 0.05 * s), V3(-1, 0.6, 0.8 * s));
  }));
  // 角（鹿角形，带一支杈）
  fixed.push(...sym((s) => taperTube(curveOf([[-0.035, 0.08, 0.022 * s], [-0.09, 0.13, 0.04 * s], [-0.17, 0.152, 0.055 * s], [-0.235, 0.12, 0.062 * s]]),
    30, 10, (t) => 0.012 - t * 0.0095)));
  fixed.push(...sym((s) => taperTube(curveOf([[-0.1, 0.136, 0.044 * s], [-0.118, 0.185, 0.066 * s], [-0.15, 0.205, 0.08 * s]]),
    16, 8, (t) => 0.007 - t * 0.005)));
  // 鬣毛（火焰状）
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      fixed.push(taperTube(curveOf([
        [-0.05, 0.058 - i * 0.017, (0.034 + i * 0.004) * s],
        [-0.12 - i * 0.004, 0.072 - i * 0.026, (0.058 + i * 0.002) * s],
        [-0.19 - i * 0.012, 0.105 - i * 0.04, (0.036 + i * 0.012) * s],
      ]), 20, 8, (t) => 0.016 * (1 - t) + 0.0015));
    }
  }
  fixed.push(taperTube(curveOf([[-0.06, 0.08, 0], [-0.14, 0.11, 0], [-0.22, 0.09, 0]]), 16, 8, (t) => 0.014 * (1 - t) + 0.0015));

  // 上颌（鼻吻、牙、须）——绕铰点上抬 jawBase
  upper.push(blob(0.088, 0.026, 0.036, (x, y, z) => {
    const tp = 1 - 0.24 * (x + 1) * 0.5;
    return [x, (y < 0 ? y * 0.45 : y) * tp, z * tp];
  }).translate(0.075, 0.012, 0));
  upper.push(blob(0.032, 0.027, 0.035).translate(0.152, 0.03, 0)); // 鼻
  upper.push(...sym((s) => new THREE.TorusGeometry(0.0085, 0.0032, 6, 14).rotateX(Math.PI / 2 - 0.4).translate(0.168, 0.05, 0.016 * s)));
  upper.push(new THREE.TorusGeometry(0.022, 0.006, 8, 20, Math.PI).rotateZ(-0.3).translate(0.16, 0.052, 0)); // 上卷唇
  for (let x = 0.04; x < 0.135; x += 0.022) {
    for (const s of [-1, 1]) {
      const c = new THREE.ConeGeometry(0.0052, 0.017, 6);
      c.rotateX(Math.PI);
      c.translate(x, -0.006, s * 0.03 * (1 - 0.22 * (x / 0.16)));
      upper.push(c);
    }
  }
  upper.push(...sym((s) => {
    const c = new THREE.ConeGeometry(0.007, 0.034, 8);
    c.rotateX(Math.PI);
    return c.translate(0.142, -0.014, 0.022 * s);
  }));
  upper.push(...sym((s) => taperTube(curveOf([[0.145, 0.025, 0.033 * s], [0.13, 0.02, 0.08 * s], [0.06, -0.02, 0.12 * s], [-0.04, -0.06, 0.135 * s], [-0.13, -0.035, 0.165 * s]]),
    40, 6, (t) => 0.0055 - t * 0.004)));
  const upperGeo = merge(upper);
  upperGeo.rotateZ(DIM.jawBase);
  fixed.push(upperGeo);

  const headMesh = new THREE.Mesh(merge(fixed), M.dragonHead);
  headMesh.castShadow = true;
  head.add(headMesh);

  // 眼
  const eyes = new THREE.Mesh(merge(sym((s) => blob(0.017, 0.017, 0.017).translate(0.046, 0.052, 0.047 * s))), M.gold);
  head.add(eyes);
  const pupils = new THREE.Mesh(merge(sym((s) => blob(0.004, 0.009, 0.004).translate(0.057, 0.054, 0.058 * s))), M.dark);
  head.add(pupils);

  // 下颌（可动），铰点在原点
  const jaw = new THREE.Group();
  jaw.rotation.z = -DIM.jawBase;
  const lower = [];
  lower.push(blob(0.082, 0.02, 0.032, (x, y, z) => {
    const tp = 1 - 0.25 * (x + 1) * 0.5;
    return [x, (y > 0 ? y * 0.35 : y) * tp, z * tp];
  }).translate(0.07, -0.012, 0));
  for (let x = 0.045; x < 0.135; x += 0.022) {
    for (const s of [-1, 1]) {
      lower.push(new THREE.ConeGeometry(0.005, 0.015, 6).translate(x, -0.0, s * 0.027 * (1 - 0.22 * (x / 0.16))));
    }
  }
  // 须髯
  for (const s of [-1, 0, 1]) {
    lower.push(taperTube(curveOf([[0.07, -0.026, 0.012 * s], [0.03, -0.07, 0.02 * s], [-0.03, -0.095, 0.03 * s], [-0.08, -0.085, 0.035 * s]]),
      20, 8, (t) => 0.012 * (1 - t) + 0.0015));
  }
  // 舌
  lower.push(taperTube(curveOf([[0.02, -0.004, 0], [0.07, -0.001, 0], [0.11, 0.004, 0], [0.125, 0.018, 0]]), 16, 8, (t) => 0.009 - t * 0.004));
  const jawMesh = new THREE.Mesh(merge(lower), M.dragonHead);
  jawMesh.castShadow = true;
  jaw.add(jawMesh);

  // 龙颌杠杆（牙机）内伸段：在下颌坐标中补偿 jawBase，使静止时水平向后
  const tailDir = new THREE.Vector2(-1, 0).rotateAround(new THREE.Vector2(), DIM.jawBase);
  const tailEnd = V3(tailDir.x * DIM.tailLen, tailDir.y * DIM.tailLen, 0);
  const tail = new THREE.Mesh(merge([rodBetween(V3(0, 0, 0), tailEnd, 0.0085), blob(0.013, 0.013, 0.013).translate(tailEnd.x, tailEnd.y, 0)]), matTail);
  tail.castShadow = true;
  jaw.add(tail);
  head.add(jaw);

  // 铜丸
  const ball = new THREE.Mesh(new THREE.SphereGeometry(DIM.ballR, 32, 20), M.gold);
  ball.castShadow = true;
  const ballHome = new THREE.Vector2(0.1, 0).rotateAround(new THREE.Vector2(), DIM.jawBase);
  ball.position.set(ballHome.x, ballHome.y + 0.0, 0);
  jaw.add(ball);

  head.position.set(DIM.hinge.x, DIM.hinge.y, 0);
  head.rotation.z = DIM.headTilt;
  return { head, jaw, ball, ballHome: ball.position.clone() };
}

// 杠杆末端（通道坐标）随下颌附加张角 a 的高度
export function tailPos(a) {
  const hx = -DIM.tailLen * Math.cos(a), hy = DIM.tailLen * Math.sin(a);
  const c = Math.cos(DIM.headTilt), s = Math.sin(DIM.headTilt);
  return { x: DIM.hinge.x + hx * c - hy * s, y: DIM.hinge.y + hx * s + hy * c };
}
const tail0 = tailPos(0);
// 由顶杆抬升量反求张角
export function jawFromLift(lift) {
  let lo = 0, hi = DIM.jawMax;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (tailPos(mid).y - tail0.y < lift) lo = mid; else hi = mid;
  }
  return lo;
}
// 铜丸（通道坐标），下颌附加张角 a
function ballPos(a, ballHome) {
  const r = Math.hypot(ballHome.x, ballHome.y);
  const ang = Math.atan2(ballHome.y, ballHome.x) - DIM.jawBase - a;
  const lx = r * Math.cos(ang), ly = r * Math.sin(ang);
  const c = Math.cos(DIM.headTilt), s = Math.sin(DIM.headTilt);
  return { x: DIM.hinge.x + lx * c - ly * s, y: DIM.hinge.y + lx * s + ly * c };
}

/* ------------------------------------------------------------------ */
/* 蟾蜍                                                                */
/* ------------------------------------------------------------------ */
export const TOAD_REST = new THREE.Vector2(-0.025, -0.02); // 铜丸在蟾口中的停留点（蟾蜍坐标）

function buildToad(M) {
  const g = new THREE.Group();
  const parts = [];
  // 身躯
  parts.push(blob(0.17, 0.115, 0.152, (x, y, z) => {
    const rear = 1 + 0.12 * Math.max(0, x);
    return [x, y < 0 ? y * 0.7 : y, z * rear];
  }).translate(0.13, -0.165, 0));
  // 下颌：开口的碗形，口缘一圈唇
  const MOUTH_Y = -0.004;
  parts.push(new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.1, 0.075, 0.118).translate(0.01, MOUTH_Y, 0));
  parts.push(new THREE.TorusGeometry(1, 0.1, 10, 48).rotateX(Math.PI / 2).scale(0.094, 0.9, 0.111).translate(0.01, MOUTH_Y, 0));
  // 上颌（向上大张）
  // 喉囊，使下颌与躯干圆顺过渡
  parts.push(blob(0.1, 0.07, 0.112).translate(0.05, -0.075, 0));
  parts.push(...sym((s) => blob(0.07, 0.05, 0.05).translate(0.04, -0.05, 0.075 * s)));
  const UJ = -1.1; // 上颌张角
  const up = blob(0.098, 0.05, 0.112, (x, y, z) => [x, y < 0 ? y * 0.15 : y, z * (1 - 0.15 * (1 - x) * 0.5)]);
  up.translate(-0.095, 0.0, 0);
  up.rotateZ(UJ);
  up.translate(0.1, 0.0, 0);
  parts.push(up);
  // 眼眶隆起（头顶两侧）
  parts.push(...sym((s) => blob(0.036, 0.03, 0.032).translate(0.075, 0.035, 0.083 * s)));
  // 耳后腺
  parts.push(...sym((s) => blob(0.055, 0.022, 0.026).rotateY(0.25 * s).translate(0.14, -0.04, 0.085 * s)));
  // 前肢
  for (const s of [-1, 1]) {
    parts.push(taperTube(curveOf([[0.05, -0.12, 0.1 * s], [0.0, -0.17, 0.155 * s], [-0.06, -0.232, 0.135 * s]]), 20, 12, (t) => 0.032 - t * 0.012));
    for (const b of [-0.9, -0.35, 0.2, 0.7]) {
      const dir = V3(-Math.cos(b), -0.05, Math.sin(b) * s).normalize();
      const p0 = V3(-0.06, -0.236, 0.135 * s);
      const p1 = p0.clone().addScaledVector(dir, 0.055);
      parts.push(taperTube(curveOf([p0, p0.clone().addScaledVector(dir, 0.03).add(V3(0, 0.006, 0)), p1]), 10, 8, (t) => 0.011 - t * 0.004));
      parts.push(blob(0.009, 0.007, 0.009).translate(p1.x, p1.y, p1.z));
    }
  }
  // 后肢
  for (const s of [-1, 1]) {
    parts.push(blob(0.095, 0.058, 0.055).rotateY(0.45 * s).translate(0.24, -0.18, 0.13 * s));
    parts.push(taperTube(curveOf([[0.29, -0.2, 0.16 * s], [0.25, -0.225, 0.2 * s], [0.16, -0.236, 0.205 * s]]), 16, 10, (t) => 0.028 - t * 0.01));
    for (const b of [-0.6, -0.2, 0.2, 0.55, 0.9]) {
      const dir = V3(-Math.cos(b), 0, Math.sin(b) * s).normalize();
      const p0 = V3(0.16, -0.238, 0.205 * s);
      const p1 = p0.clone().addScaledVector(dir, 0.07);
      parts.push(taperTube(curveOf([p0, p0.clone().addScaledVector(dir, 0.035).add(V3(0, 0.005, 0)), p1]), 10, 8, (t) => 0.01 - t * 0.004));
      parts.push(blob(0.008, 0.006, 0.008).translate(p1.x, p1.y, p1.z));
    }
  }
  // 疣粒
  const rnd = mulberry(17);
  for (let i = 0; i < 90; i++) {
    const th = rnd() * Math.PI * 0.42, ph = rnd() * Math.PI * 2;
    const rx = 0.17, ry = 0.115, rz = 0.152;
    const x = 0.13 + rx * Math.sin(th) * Math.cos(ph) * 0.98;
    const y = -0.165 + ry * Math.cos(th) * 0.98;
    const z = rz * Math.sin(th) * Math.sin(ph) * 0.98 * (1 + 0.12 * Math.max(0, Math.sin(th) * Math.cos(ph)));
    if (x < 0.03) continue;
    const r = 0.006 + rnd() * 0.009;
    parts.push(blob(r, r * 0.8, r, null, 10, 8).translate(x, y, z));
  }
  const body = new THREE.Mesh(merge(parts), M.toad);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // 口腔：内凹的深色口腔 + 上腭
  const mouthIn = new THREE.Mesh(
    new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.086, 0.05, 0.102).translate(0.01, MOUTH_Y, 0),
    M.darkInside,
  );
  g.add(mouthIn);
  const palate = blob(0.082, 0.003, 0.094).translate(-0.095, -0.009, 0);
  palate.rotateZ(-1.1);
  palate.translate(0.1, 0, 0);
  g.add(new THREE.Mesh(palate, M.dark));
  // 眼
  const eyes = sym((s) => blob(0.024, 0.024, 0.024).translate(0.066, 0.052, 0.088 * s));
  g.add(new THREE.Mesh(merge(eyes), M.gold));
  const pup = sym((s) => blob(0.004, 0.012, 0.006).rotateX(Math.PI / 2).translate(0.05, 0.062, 0.1 * s));
  g.add(new THREE.Mesh(merge(pup), M.dark));
  return g;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 内部机构                                                            */
/* ------------------------------------------------------------------ */
function buildSuspension(root, M, out) {
  const sus = new THREE.Group();
  sus.name = '悬挂';
  root.add(sus);
  // 十字梁
  const beam = merge([
    box(1.69, 0.04, 0.05, 0, 1.676, 0),
    box(0.05, 0.04, 1.69, 0, 1.676, 0),
    new THREE.CylinderGeometry(0.07, 0.075, 0.06, 32).translate(0, 1.676, 0),
    new THREE.TorusGeometry(0.02, 0.007, 10, 24).translate(0, 1.632 + 0.012, 0),
  ]);
  const beamMesh = new THREE.Mesh(beam, M.mech);
  beamMesh.castShadow = true;
  sus.add(beamMesh);

  // 都柱（悬垂摆）
  const pend = new THREE.Group();
  pend.position.y = DIM.pivotY;
  sus.add(pend);
  out.pendMat = M.mech.clone();
  const L = DIM.pivotY - 0.775; // 摆至足盘底
  const colTop = DIM.pivotY - 1.31;
  const prof = [[0, -colTop + 0.02], [0.04, -colTop + 0.015], [0.085, -colTop], [0.11, -colTop - 0.025], [0.114, -colTop - 0.04],
    [0.104, -colTop - 0.05], [0.104, -colTop - 0.06], [0.112, -colTop - 0.07], [0.108, -0.6], [0.106, -0.7], [0.11, -0.76],
    [0.118, -0.77], [0.106, -0.785], [0.112, -0.8], [0.15, -0.815], [0.18, -0.83], [0.18, -L + 0.004], [0.17, -L], [0.06, -L], [0.035, -L - 0.01], [0.0, -L - 0.035]];
  const col = lathe(prof.slice().reverse().map((p) => new THREE.Vector2(p[0], p[1])), 64);
  const rod = new THREE.CylinderGeometry(0.014, 0.014, colTop, 16).translate(0, -colTop / 2, 0);
  const knuckle = new THREE.SphereGeometry(0.02, 16, 12);
  const pendMesh = new THREE.Mesh(merge([col, rod, knuckle]), out.pendMat);
  pendMesh.castShadow = true;
  pend.add(pendMesh);
  out.pendLength = L;
  return { sus, pend };
}

function buildDisc(root, M, out) {
  const g = new THREE.Group();
  g.name = '八道';
  root.add(g);
  const y0 = DIM.discTop - 0.03;
  const parts = [];
  parts.push(new THREE.RingGeometry(0.11, 0.8, 96, 1).rotateX(-Math.PI / 2).translate(0, DIM.discTop, 0));
  parts.push(new THREE.RingGeometry(0.11, 0.8, 96, 1).rotateX(Math.PI / 2).translate(0, y0, 0));
  parts.push(new THREE.CylinderGeometry(0.8, 0.8, 0.03, 96, 1, true).translate(0, y0 + 0.015, 0));
  parts.push(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 48, 1, true).translate(0, y0 + 0.015, 0));
  // 支柱
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (Math.PI / 4);
    parts.push(new THREE.CylinderGeometry(0.02, 0.026, y0 - 0.3, 12).translate(Math.sin(a) * 0.55, 0.3 + (y0 - 0.3) / 2, -Math.cos(a) * 0.55));
  }
  // 中心套筒（锁定机构的升降座）
  parts.push(new THREE.CylinderGeometry(0.07, 0.085, y0 - 0.3, 32, 1, true).translate(0, 0.3 + (y0 - 0.3) / 2, 0));
  // 导轨
  for (let k = 0; k < N_CH; k++) {
    const a = (k * Math.PI) / 4;
    for (const s of [-1, 1]) {
      const rail = box(0.6, 0.016, 0.012, 0.5, DIM.discTop + 0.008, 0.032 * s);
      rail.rotateY(Math.PI / 2 - a);
      parts.push(rail);
    }
  }
  const mesh = new THREE.Mesh(merge(parts), M.mech);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);

  // 关：锁定漏斗
  out.lockMat = M.mech.clone();
  const funnelProf = [[0.025, 0], [0.04, 0.008], [0.085, 0.04], [0.09, 0.045], [0.082, 0.047], [0.035, 0.012], [0.0, 0.006]];
  const funnel = new THREE.Mesh(lathe(funnelProf.map((p) => new THREE.Vector2(p[0], p[1])), 48), out.lockMat);
  const lockRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 16).translate(0, -0.15, 0), out.lockMat);
  funnel.add(lockRod);
  out.lockY0 = 0.665;
  out.lockY1 = 0.725;
  funnel.position.y = out.lockY0;
  g.add(funnel);
  out.funnel = funnel;
  return g;
}

function buildChannelMech(cg, M, k) {
  const sliderMat = M.mech.clone();
  const rodMat = M.mech.clone();
  // 滑杆（含内端触头与外端斜面）
  const slider = new THREE.Group();
  const y = DIM.sliderY0, h = DIM.sliderH;
  const body = merge([
    box(0.55, h, 0.044, 0.475, y + h / 2, 0),
    new THREE.CylinderGeometry(0.024, 0.024, h, 20).translate(0.2, y + h / 2, 0),
  ]);
  slider.add(new THREE.Mesh(body, sliderMat));
  const shape = new THREE.Shape();
  const xe = DIM.wedgeEnd, xs = 0.75;
  shape.moveTo(xs, y);
  shape.lineTo(xe, y);
  shape.lineTo(xe, y + h);
  shape.lineTo(xs, y + h + DIM.wedgeSlope * (xe - xs));
  shape.closePath();
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: 0.044, bevelEnabled: false });
  wedge.translate(0, 0, -0.022);
  slider.add(new THREE.Mesh(wedge, sliderMat));
  slider.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  cg.add(slider);

  // 顶杆（下端滚轮，上端托板）
  const rod = new THREE.Group();
  const yb = y + h + DIM.wedgeSlope * (xe - DIM.rodX) + 0.016;
  const yt = tail0.y - 0.013 - 0.006;
  const rodGeo = merge([
    new THREE.CylinderGeometry(0.011, 0.011, yt - yb, 12).translate(DIM.rodX, (yt + yb) / 2, 0),
    new THREE.CylinderGeometry(0.016, 0.016, 0.026, 20).rotateX(Math.PI / 2).translate(DIM.rodX, yb, 0),
    box(0.05, 0.008, 0.032, DIM.rodX, yt + 0.002, 0),
  ]);
  rod.add(Object.assign(new THREE.Mesh(rodGeo, rodMat), { castShadow: true }));
  cg.add(rod);

  // 导向环（固定于器壁）
  const guides = [];
  for (const gy of [0.98, 1.17]) {
    guides.push(new THREE.TorusGeometry(0.018, 0.005, 8, 20).rotateX(Math.PI / 2).translate(DIM.rodX, gy, 0));
    const wr = bodyR(gy) - 0.035;
    guides.push(box(wr - DIM.rodX - 0.012, 0.01, 0.012, (wr + DIM.rodX + 0.018) / 2, gy, 0));
  }
  cg.add(new THREE.Mesh(merge(guides), M.mech));
  return { slider, rod, sliderMat, rodMat, rodYb: yb, rodYt: yt };
}

/* ------------------------------------------------------------------ */
/* 总装                                                                */
/* ------------------------------------------------------------------ */
export function buildSeismoscope(M) {
  const root = new THREE.Group();
  root.name = '候风地动仪';
  const out = { caps: [], shell: [] };

  out.pedestal = buildPedestal(root, M);
  out.vessel = buildVessel(root, M, out);
  out.lid = buildLid(root, M, out);
  const { sus, pend } = buildSuspension(root, M, out);
  out.suspension = sus;
  out.pendulum = pend;
  out.disc = buildDisc(root, M, out);

  const dragonBodyGeo = buildDragonBody();
  out.channels = [];
  for (let k = 0; k < N_CH; k++) {
    const a = (k * Math.PI) / 4;
    const cg = new THREE.Group();
    cg.rotation.y = Math.PI / 2 - a;
    root.add(cg);

    const dragon = new THREE.Group();
    cg.add(dragon);
    const bodyMesh = addCapped(dragon, dragonBodyGeo, M.dragonBody, M.cap, out);
    const tailMat = M.mech.clone();
    const { head, jaw, ball, ballHome } = buildDragonHead(M, tailMat);
    dragon.add(head);

    const mech = buildChannelMech(cg, M, k);

    // 蟾蜍位置：按铜丸的抛落轨迹求出落点，使蟾口恰好承接
    const rel = ballPos(0.12, new THREE.Vector2(ballHome.x, ballHome.y));
    const toadOriginY = DIM.baseTop + 0.245;
    const restY = toadOriginY + TOAD_REST.y;
    const vx = 0.12, vy = -0.15, gacc = 9.81;
    const dy = rel.y - restY;
    const tf = (vy + Math.sqrt(vy * vy + 2 * gacc * dy)) / gacc;
    const landX = rel.x + vx * tf;
    const toad = buildToad(M);
    toad.position.set(landX - TOAD_REST.x, toadOriginY, 0);
    cg.add(toad);

    out.channels.push({
      k, a, group: cg, dragon, bodyMesh, head, jaw, ball, ballHome, tailMat,
      toad, toadHome: toad.position.clone(), rest: new THREE.Vector2(landX, restY),
      ...mech,
      ballState: { phase: 'held', x: 0, y: 0, vx: 0, vy: 0, bounced: false },
    });
  }

  // 铜丸抛射参数（与蟾蜍布置一致）
  out.ballLaunch = { vx: 0.12, vy: -0.15, releaseAngle: 0.12 };
  out.dims = { diameter: 2 * 0.924, height: 2.48 - DIM.baseTop, top: 2.48 };
  out.root = root;
  return out;
}
