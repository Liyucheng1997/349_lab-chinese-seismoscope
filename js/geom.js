// 几何工具：变径管、可变形椭球、带自定义 UV 的旋转体、合并
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();

// 统一属性后合并（position / normal / uv，全部带索引）
export function merge(list) {
  const prepared = list.map((g) => {
    let geo = g.index ? g : g.toNonIndexed();
    if (!geo.index) {
      const idx = Array.from({ length: geo.attributes.position.count }, (_, i) => i);
      geo.setIndex(idx);
    }
    for (const k of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    }
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    geo.morphAttributes = {};
    return geo;
  });
  return mergeGeometries(prepared, false);
}

// 平滑二维轮廓 [[r,y],...] → Vector2[]
export function smoothProfile(pts, samples) {
  const curve = new THREE.SplineCurve(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  return curve.getSpacedPoints(samples);
}

// 旋转体，并以 vFn(point, index, arcFrac) 重写 v 坐标
export function lathe(points, segments = 128, vFn = null, phiStart = 0, phiLength = Math.PI * 2) {
  const geo = new THREE.LatheGeometry(points, segments, phiStart, phiLength);
  if (vFn) {
    const n = points.length;
    const arc = [0];
    for (let j = 1; j < n; j++) arc.push(arc[j - 1] + points[j].distanceTo(points[j - 1]));
    const total = arc[n - 1] || 1;
    const vs = points.map((p, j) => vFn(p, j, arc[j] / total));
    const uv = geo.attributes.uv;
    for (let i = 0; i <= segments; i++) for (let j = 0; j < n; j++) uv.setY(i * n + j, vs[j]);
    uv.needsUpdate = true;
  }
  return geo;
}

// 二维轮廓沿法向偏移（用于由外壁生成内壁）
export function offsetProfile(points, d) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    // 外法向 (ty, -tx)/len ，向内偏移取负
    out.push(new THREE.Vector2(points[i].x - (ty / len) * d, points[i].y + (tx / len) * d));
  }
  return out;
}

// 变径管：radiusFn(t) 给出半径，可选 squash(t) 横截面压扁
export function taperTube(curve, tubular, radial, radiusFn, opts = {}) {
  const { uRepeat = 1, vRepeat = 1, capStart = true, capEnd = true } = opts;
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const n = frames.normals[i], b = frames.binormals[i];
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const s = Math.sin(v), c = -Math.cos(v);
      N.set(c * n.x + s * b.x, c * n.y + s * b.y, c * n.z + s * b.z).normalize();
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
      nor.push(N.x, N.y, N.z);
      uv.push(t * uRepeat, (j / radial) * vRepeat);
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const addCap = (i, sign) => {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const T = frames.tangents[i];
    const center = pos.length / 3;
    pos.push(P.x, P.y, P.z);
    nor.push(T.x * sign, T.y * sign, T.z * sign);
    uv.push(t * uRepeat, 0.5);
    const ring = (radial + 1) * i;
    for (let j = 0; j < radial; j++) {
      if (sign < 0) idx.push(center, ring + j + 1, ring + j);
      else idx.push(center, ring + j, ring + j + 1);
    }
  };
  if (capStart) addCap(0, -1);
  if (capEnd) addCap(tubular, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// 曲线（由点列）
export function curveOf(points, tension = 0.5) {
  return new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'catmullrom', tension);
}

// 可变形椭球：deform(x,y,z) 在单位球坐标上返回 [x,y,z]
export function blob(rx, ry, rz, deform = null, ws = 32, hs = 24) {
  let geo = new THREE.SphereGeometry(1, ws, hs);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (deform) [x, y, z] = deform(x, y, z);
    p.setXYZ(i, x * rx, y * ry, z * rz);
  }
  geo.deleteAttribute('normal');
  const uvOld = geo.attributes.uv;
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-6);
  geo.computeVertexNormals();
  // 重建 uv（球面投影）
  const pp = geo.attributes.position;
  const uv = new Float32Array(pp.count * 2);
  for (let i = 0; i < pp.count; i++) {
    uv[i * 2] = Math.atan2(pp.getZ(i) / rz, pp.getX(i) / rx) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = pp.getY(i) / ry * 0.5 + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  void uvOld;
  return geo;
}

// 以 Y 轴为“上”，将几何体对齐到给定方向并平移
export function orient(geo, pos, dirY, dirZhint = null) {
  const y = _v.copy(dirY).normalize().clone();
  let zh = dirZhint ? dirZhint.clone() : new THREE.Vector3(0, 0, 1);
  if (Math.abs(zh.dot(y)) > 0.98) zh = new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(y, zh).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos);
  geo.applyMatrix4(m);
  return geo;
}

export function rodBetween(a, b, r, radial = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, radial, 1);
  geo.translate(0, len / 2, 0);
  return orient(geo, a, dir);
}

export function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
