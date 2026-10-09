// 程序化纹理：青铜锈色、篆文山龟鸟兽浮雕、龙鳞、蟾蜍疣粒、石材
import * as THREE from 'three';

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// 可平铺的分形值噪声场
export class NoiseField {
  constructor(w, h, seed = 1, base = 4, oct = 5) {
    this.w = w; this.h = h;
    const data = new Float32Array(w * h);
    const rnd = makeRng(seed);
    let ampSum = 0, amp = 1;
    for (let o = 0; o < oct; o++) {
      const px = base << o;
      const py = Math.max(1, Math.round((px * h) / w));
      const lat = new Float32Array(px * py);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < h; y++) {
        const fy = (y / h) * py;
        const y0 = Math.floor(fy), ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const r0 = (y0 % py) * px, r1 = ((y0 + 1) % py) * px;
        for (let x = 0; x < w; x++) {
          const fx = (x / w) * px;
          const x0 = Math.floor(fx), tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const c0 = x0 % px, c1 = (x0 + 1) % px;
          const a = lat[r0 + c0], b = lat[r0 + c1], c = lat[r1 + c0], d = lat[r1 + c1];
          data[y * w + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
        }
      }
      ampSum += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < data.length; i++) data[i] /= ampSum;
    // 拉伸对比度
    let mn = 1, mx = 0;
    for (const v of data) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < data.length; i++) data[i] = (data[i] - mn) / (mx - mn);
    this.data = data;
  }
  sample(u, v) {
    const { w, h, data } = this;
    let fx = (u - Math.floor(u)) * w, fy = (v - Math.floor(v)) * h;
    const x0 = Math.floor(fx) % w, y0 = Math.floor(fy) % h;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
    const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(c, { srgb = false, wrapT = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// 青铜着色：raise=浮雕凸起程度(0..1)，n1..n3 为噪声
const COL = {
  base: [104, 74, 40],
  hi: [206, 160, 92],
  pat: [70, 104, 86],
  patL: [124, 152, 128],
};
function bronzeShade(raise, n1, n2, n3, out, patBias = 0) {
  let pat = smooth(0.55, 0.85, n1) * 0.62 + Math.max(0, 0.5 - raise) * 0.55 + patBias;
  pat *= 1 - Math.max(0, raise - 0.68) * 2.6;
  pat = clamp(pat, 0, 0.9);
  const m = clamp(0.2 + raise * 0.6 + (n2 - 0.5) * 0.55, 0, 1);
  const dirt = 0.8 + 0.32 * n2;
  for (let i = 0; i < 3; i++) {
    const metal = mix(COL.base[i], COL.hi[i], m);
    const pc = mix(COL.pat[i], COL.patL[i], n3);
    out[i] = clamp(mix(metal, pc, pat) * dirt, 0, 255);
  }
  out[3] = clamp(0.3 + pat * 0.5 + (n3 - 0.5) * 0.14 - raise * 0.08, 0.12, 1); // 粗糙度
  out[4] = clamp(1 - pat * 0.85, 0, 1); // 金属度
  return out;
}

// 由高度图生成 颜色 / ORM（G=粗糙度，B=金属度）
function shadeFromHeight(hc, seed, patBias = 0) {
  const w = hc.width, h = hc.height;
  const hd = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const n1 = new NoiseField(256, 128, seed, 4, 5);
  const n2 = new NoiseField(256, 128, seed + 7, 16, 4);
  const n3 = new NoiseField(256, 128, seed + 13, 8, 4);
  const cc = canvas(w, h), oc = canvas(w, h);
  const cd = cc.getContext('2d').createImageData(w, h);
  const od = oc.getContext('2d').createImageData(w, h);
  const o = [0, 0, 0, 0, 0];
  const base = 105 / 255;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hv = hd[i] / 255;
      const raise = clamp((hv - base) / (1 - base), 0, 1) * 0.9 + (hv < base ? (hv - base) : 0);
      const u = x / w;
      bronzeShade(clamp(raise + 0.28, 0, 1), n1.sample(u, v), n2.sample(u * 2, v * 2), n3.sample(u, v), o, patBias);
      cd.data[i] = o[0]; cd.data[i + 1] = o[1]; cd.data[i + 2] = o[2]; cd.data[i + 3] = 255;
      od.data[i] = 255; od.data[i + 1] = o[3] * 255; od.data[i + 2] = o[4] * 255; od.data[i + 3] = 255;
    }
  }
  cc.getContext('2d').putImageData(cd, 0, 0);
  oc.getContext('2d').putImageData(od, 0, 0);
  return { cc, oc };
}

function blurred(src, px) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${px}px)`;
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  return c;
}

const gray = (v) => `rgb(${v},${v},${v})`;

/* ------------------------------------------------------------------ */
/*  纹样绘制                                                            */
/* ------------------------------------------------------------------ */

// 云雷纹（方形回旋）
function squareSpiral(ctx, x, y, s, flip) {
  ctx.save();
  ctx.translate(x + (flip ? s : 0), y);
  ctx.scale(flip ? -1 : 1, 1);
  const m = s * 0.1, st = s * 0.17;
  const L = m, T = m, R = s - m, B = s - m;
  ctx.beginPath();
  ctx.moveTo(L, B);
  ctx.lineTo(L, T);
  ctx.lineTo(R, T);
  ctx.lineTo(R, B);
  ctx.lineTo(L + st, B);
  ctx.lineTo(L + st, T + st);
  ctx.lineTo(R - st, T + st);
  ctx.lineTo(R - st, B - st);
  ctx.lineTo(L + 2 * st, B - st);
  ctx.lineTo(L + 2 * st, T + 2 * st);
  ctx.lineTo(R - 2 * st, T + 2 * st);
  ctx.stroke();
  ctx.restore();
}

function leiwenBand(ctx, x0, y0, w, h) {
  ctx.save();
  ctx.strokeStyle = gray(235);
  ctx.lineWidth = Math.max(2, h * 0.08);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'square';
  const n = Math.round(w / h);
  const s = w / n;
  for (let i = 0; i < n; i++) squareSpiral(ctx, x0 + i * s, y0 + (h - s) / 2, s, i % 2 === 1);
  ctx.restore();
}

function borderLine(ctx, x0, y, w, lw = 4, v = 240) {
  ctx.fillStyle = gray(v);
  ctx.fillRect(x0, y - lw / 2, w, lw);
}

function beadBand(ctx, x0, y0, w, h) {
  const r = h * 0.32;
  const step = h * 0.95;
  for (let x = x0 + step / 2; x < x0 + w; x += step) {
    const g = ctx.createRadialGradient(x - r * 0.3, y0 + h / 2 - r * 0.3, r * 0.1, x, y0 + h / 2, r);
    g.addColorStop(0, gray(255));
    g.addColorStop(1, gray(175));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y0 + h / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 云纹（卷云）
function cloudScroll(ctx, x, y, s, dir = 1) {
  ctx.beginPath();
  let r = s, a = dir > 0 ? 0 : Math.PI;
  ctx.moveTo(x - dir * s * 2.2, y + s * 0.9);
  ctx.quadraticCurveTo(x - dir * s * 1.2, y + s * 1.4, x + Math.cos(a) * r, y + Math.sin(a) * r);
  for (let i = 0; i < 48; i++) {
    a += 0.24 * dir;
    r *= 0.968;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
}

// 伪篆文：由若干“部件”按左右 / 上下结构组合，笔画圆转、粗细均匀
const sealParts = {
  kou(ctx, x, y, w, h) { // 口
    rr(ctx, x + w * 0.12, y + h * 0.18, w * 0.76, h * 0.64, Math.min(w, h) * 0.2);
  },
  ri(ctx, x, y, w, h) { // 日
    rr(ctx, x + w * 0.15, y + h * 0.08, w * 0.7, h * 0.84, Math.min(w, h) * 0.18);
    line(ctx, x + w * 0.15, y + h * 0.5, x + w * 0.85, y + h * 0.5);
  },
  tian(ctx, x, y, w, h) { // 田
    rr(ctx, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8, Math.min(w, h) * 0.18);
    line(ctx, x + w * 0.1, y + h * 0.5, x + w * 0.9, y + h * 0.5);
    line(ctx, x + w * 0.5, y + h * 0.1, x + w * 0.5, y + h * 0.9);
  },
  mu(ctx, x, y, w, h) { // 木
    line(ctx, x + w * 0.5, y + h * 0.05, x + w * 0.5, y + h * 0.95);
    ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + h * 0.15); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.55, x + w * 0.9, y + h * 0.15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + h * 0.9); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.3, x + w * 0.9, y + h * 0.9); ctx.stroke();
  },
  shan(ctx, x, y, w, h) { // 山
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h * 0.3);
    ctx.lineTo(x + w * 0.1, y + h * 0.75);
    ctx.quadraticCurveTo(x + w * 0.1, y + h * 0.9, x + w * 0.3, y + h * 0.9);
    ctx.lineTo(x + w * 0.7, y + h * 0.9);
    ctx.quadraticCurveTo(x + w * 0.9, y + h * 0.9, x + w * 0.9, y + h * 0.75);
    ctx.lineTo(x + w * 0.9, y + h * 0.3);
    ctx.stroke();
    line(ctx, x + w * 0.5, y + h * 0.1, x + w * 0.5, y + h * 0.9);
  },
  san(ctx, x, y, w, h) { // 三 / 王
    for (const t of [0.15, 0.5, 0.85]) line(ctx, x + w * 0.12, y + h * t, x + w * 0.88, y + h * t);
    if (w > h * 0.6) line(ctx, x + w * 0.5, y + h * 0.15, x + w * 0.5, y + h * 0.85);
  },
  jiong(ctx, x, y, w, h, rnd) { // 冂 内含部件
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h * 0.95);
    ctx.lineTo(x + w * 0.1, y + h * 0.2);
    ctx.quadraticCurveTo(x + w * 0.1, y + h * 0.08, x + w * 0.25, y + h * 0.08);
    ctx.lineTo(x + w * 0.75, y + h * 0.08);
    ctx.quadraticCurveTo(x + w * 0.9, y + h * 0.08, x + w * 0.9, y + h * 0.2);
    ctx.lineTo(x + w * 0.9, y + h * 0.95);
    ctx.stroke();
    const inner = ['kou', 'ren', 'san', 'gou'][Math.floor(rnd() * 4)];
    sealParts[inner](ctx, x + w * 0.24, y + h * 0.26, w * 0.52, h * 0.6, rnd);
  },
  ren(ctx, x, y, w, h) { // 人
    ctx.beginPath(); ctx.moveTo(x + w * 0.55, y + h * 0.05); ctx.bezierCurveTo(x + w * 0.35, y + h * 0.35, x + w * 0.1, y + h * 0.6, x + w * 0.15, y + h * 0.95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h * 0.35); ctx.bezierCurveTo(x + w * 0.75, y + h * 0.5, x + w * 0.88, y + h * 0.7, x + w * 0.85, y + h * 0.95); ctx.stroke();
  },
  gou(ctx, x, y, w, h) { // 卷钩
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h * 0.05);
    ctx.lineTo(x + w * 0.5, y + h * 0.6);
    ctx.arc(x + w * 0.32, y + h * 0.6, w * 0.18, 0, Math.PI * 0.95);
    ctx.stroke();
    line(ctx, x + w * 0.15, y + h * 0.2, x + w * 0.85, y + h * 0.2);
  },
  shui(ctx, x, y, w, h) { // 水
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h * 0.05);
    ctx.bezierCurveTo(x + w * 0.65, y + h * 0.3, x + w * 0.35, y + h * 0.6, x + w * 0.5, y + h * 0.95); ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + w * (0.5 + 0.38 * s), y + h * 0.15);
      ctx.bezierCurveTo(x + w * (0.5 + 0.2 * s), y + h * 0.35, x + w * (0.5 + 0.4 * s), y + h * 0.6, x + w * (0.5 + 0.22 * s), y + h * 0.9); ctx.stroke();
    }
  },
  yun(ctx, x, y, w, h) { // 云形回旋
    line(ctx, x + w * 0.12, y + h * 0.12, x + w * 0.88, y + h * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + h * 0.35);
    ctx.lineTo(x + w * 0.8, y + h * 0.35);
    ctx.bezierCurveTo(x + w * 0.2, y + h * 0.5, x + w * 0.15, y + h * 0.95, x + w * 0.55, y + h * 0.9);
    ctx.arc(x + w * 0.55, y + h * 0.75, h * 0.15, Math.PI * 0.5, -Math.PI * 0.6, true);
    ctx.stroke();
  },
};
const sealKeys = Object.keys(sealParts);
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
}
function line(ctx, a, b, c, d) {
  ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
}
function sealGlyph(ctx, x, y, w, h, rnd) {
  ctx.save();
  ctx.lineWidth = w * 0.085;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = gray(245);
  const pick = () => sealKeys[Math.floor(rnd() * sealKeys.length)];
  const r = rnd();
  if (r < 0.3) {
    sealParts[pick()](ctx, x, y, w, h, rnd);
  } else if (r < 0.65) {
    const s = 0.38 + rnd() * 0.14;
    sealParts[pick()](ctx, x, y, w * s, h, rnd);
    sealParts[pick()](ctx, x + w * s, y, w * (1 - s), h, rnd);
  } else {
    const s = 0.36 + rnd() * 0.2;
    sealParts[pick()](ctx, x, y, w, h * s, rnd);
    sealParts[pick()](ctx, x, y + h * s, w, h * (1 - s), rnd);
  }
  ctx.restore();
}

function mountains(ctx, x0, yBase, w, hMax, rnd) {
  const peaks = 3;
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < peaks + layer; i++) {
      const px = x0 + (w * (i + 0.5 - layer * 0.5 + (rnd() - 0.5) * 0.25)) / peaks;
      const ph = hMax * (0.6 + rnd() * 0.4) * (layer ? 0.7 : 1);
      const pw = (w / peaks) * (layer ? 0.55 : 0.68);
      const peak = (sc) => {
        ctx.beginPath();
        ctx.moveTo(px - pw * sc, yBase);
        ctx.bezierCurveTo(px - pw * sc * 0.45, yBase - ph * sc * 0.35, px - pw * sc * 0.15, yBase - ph * sc * 0.95, px, yBase - ph * sc);
        ctx.bezierCurveTo(px + pw * sc * 0.15, yBase - ph * sc * 0.95, px + pw * sc * 0.45, yBase - ph * sc * 0.35, px + pw * sc, yBase);
      };
      peak(1);
      ctx.fillStyle = gray(layer ? 190 : 205);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = gray(248);
      ctx.stroke();
      ctx.strokeStyle = gray(150);
      ctx.lineWidth = 2;
      for (const sc of [0.72, 0.46]) { peak(sc); ctx.stroke(); }
    }
  }
}

// 在单位方框内绘制动物剪影
function inBox(ctx, x, y, w, h, flip, fn) {
  ctx.save();
  ctx.translate(x + (flip ? w : 0), y);
  ctx.scale(flip ? -w : w, h);
  fn();
  ctx.restore();
}

function turtle(ctx, x, y, w, h, flip) {
  inBox(ctx, x, y, w, h, flip, () => {
    ctx.fillStyle = gray(205);
    ctx.strokeStyle = gray(248);
    ctx.lineWidth = 0.02;
    // 四足
    for (const [lx, ly, rot] of [[0.33, 0.33, -0.7], [0.67, 0.33, 0.7], [0.33, 0.7, 0.7], [0.67, 0.7, -0.7]]) {
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot);
      ctx.beginPath(); ctx.ellipse(0, 0, 0.13, 0.06, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // 头颈
    ctx.beginPath(); ctx.ellipse(0.86, 0.5, 0.09, 0.07, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.18, 0.5); ctx.lineTo(0.05, 0.56); ctx.lineTo(0.2, 0.58); ctx.fill();
    // 甲壳
    ctx.beginPath(); ctx.ellipse(0.5, 0.52, 0.3, 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = gray(225); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = gray(150);
    ctx.lineWidth = 0.018;
    const r = 0.085;
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const cx = 0.5 + i * r * 1.75 + (j % 2 ? r * 0.875 : 0), cy = 0.52 + j * r * 1.5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.fillStyle = gray(120);
    ctx.beginPath(); ctx.arc(0.9, 0.47, 0.015, 0, Math.PI * 2); ctx.fill();
  });
}

function bird(ctx, x, y, w, h, flip) {
  inBox(ctx, x, y, w, h, flip, () => {
    ctx.fillStyle = gray(212);
    ctx.strokeStyle = gray(248);
    ctx.lineWidth = 0.02;
    ctx.lineCap = 'round';
    // 尾羽
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0.38, 0.58);
      ctx.bezierCurveTo(0.2, 0.62 + i * 0.05, 0.12, 0.85 - i * 0.12, 0.02 + i * 0.03, 0.62 + i * 0.1);
      ctx.lineWidth = 0.045 - i * 0.008;
      ctx.strokeStyle = gray(225);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0.02 + i * 0.03, 0.62 + i * 0.1, 0.03, 0, Math.PI * 2);
      ctx.fillStyle = gray(230); ctx.fill();
    }
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = gray(248);
    ctx.fillStyle = gray(212);
    // 腿
    ctx.beginPath(); ctx.moveTo(0.52, 0.62); ctx.lineTo(0.5, 0.9); ctx.moveTo(0.58, 0.62); ctx.lineTo(0.62, 0.9);
    ctx.lineWidth = 0.025; ctx.stroke(); ctx.lineWidth = 0.02;
    // 身体
    ctx.beginPath(); ctx.ellipse(0.52, 0.55, 0.17, 0.1, -0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 颈与头
    ctx.beginPath();
    ctx.moveTo(0.6, 0.5); ctx.quadraticCurveTo(0.74, 0.42, 0.72, 0.26);
    ctx.lineWidth = 0.07; ctx.strokeStyle = gray(212); ctx.stroke();
    ctx.lineWidth = 0.02; ctx.strokeStyle = gray(248);
    ctx.beginPath(); ctx.ellipse(0.74, 0.24, 0.06, 0.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.79, 0.22); ctx.lineTo(0.9, 0.25); ctx.lineTo(0.79, 0.27); ctx.fill();
    // 冠
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(0.72, 0.2); ctx.quadraticCurveTo(0.66 - i * 0.03, 0.08, 0.6 - i * 0.06, 0.1 + i * 0.03);
      ctx.stroke();
    }
    // 翅
    ctx.beginPath();
    ctx.moveTo(0.42, 0.52);
    ctx.bezierCurveTo(0.3, 0.3, 0.3, 0.12, 0.42, 0.06);
    ctx.bezierCurveTo(0.45, 0.25, 0.55, 0.38, 0.6, 0.48);
    ctx.closePath();
    ctx.fillStyle = gray(228); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = gray(150);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0.44 + i * 0.03, 0.45); ctx.lineTo(0.37 + i * 0.03, 0.15 + i * 0.05); ctx.stroke();
    }
    ctx.fillStyle = gray(110);
    ctx.beginPath(); ctx.arc(0.755, 0.23, 0.012, 0, Math.PI * 2); ctx.fill();
  });
}

function beast(ctx, x, y, w, h, flip) {
  inBox(ctx, x, y, w, h, flip, () => {
    ctx.fillStyle = gray(210);
    ctx.strokeStyle = gray(248);
    ctx.lineCap = 'round';
    // 尾
    ctx.beginPath(); ctx.moveTo(0.26, 0.48); ctx.bezierCurveTo(0.1, 0.5, 0.18, 0.2, 0.04, 0.18);
    ctx.lineWidth = 0.04; ctx.strokeStyle = gray(215); ctx.stroke();
    // 四肢（奔跑）
    ctx.lineWidth = 0.06;
    for (const [a, b, c, d] of [[0.68, 0.55, 0.9, 0.7], [0.64, 0.56, 0.7, 0.82], [0.32, 0.55, 0.14, 0.74], [0.37, 0.57, 0.42, 0.84]]) {
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    ctx.strokeStyle = gray(248);
    ctx.lineWidth = 0.02;
    // 躯干
    ctx.beginPath(); ctx.ellipse(0.5, 0.5, 0.25, 0.1, -0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 头
    ctx.beginPath(); ctx.ellipse(0.8, 0.4, 0.09, 0.075, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.75, 0.33); ctx.lineTo(0.74, 0.24); ctx.lineTo(0.8, 0.32); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.86, 0.43); ctx.lineTo(0.96, 0.4); ctx.lineTo(0.86, 0.47); ctx.fill();
    // 斑纹
    ctx.strokeStyle = gray(150);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.arc(0.33 + i * 0.075, 0.5, 0.06, -1.9, -1.1); ctx.stroke();
    }
    ctx.fillStyle = gray(110);
    ctx.beginPath(); ctx.arc(0.82, 0.37, 0.012, 0, Math.PI * 2); ctx.fill();
  });
}

function leafBand(ctx, x0, y0, w, h) {
  const n = Math.round(w / (h * 0.55));
  const s = w / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * s + s / 2;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.46, y0 + h);
    ctx.quadraticCurveTo(cx - s * 0.3, y0 + h * 0.3, cx, y0);
    ctx.quadraticCurveTo(cx + s * 0.3, y0 + h * 0.3, cx + s * 0.46, y0 + h);
    ctx.closePath();
    ctx.fillStyle = gray(195); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = gray(245); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, y0 + h * 0.12); ctx.lineTo(cx, y0 + h);
    ctx.lineWidth = 2; ctx.strokeStyle = gray(140); ctx.stroke();
    for (let k = 1; k < 4; k++) {
      const yy = y0 + h * (0.25 + k * 0.18);
      ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - s * 0.12 * k, yy - h * 0.12);
      ctx.moveTo(cx, yy); ctx.lineTo(cx + s * 0.12 * k, yy - h * 0.12); ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  导出纹理                                                            */
/* ------------------------------------------------------------------ */

// 器身外壁纹饰：canvas 自上而下对应 y=Y_TOP..Y_BOT
export const BODY_DECOR = { yTop: 1.6, yBot: 0.36 };

export function makeBodyDecor() {
  const W = 2048, H = 1024;
  const hc = canvas(W, H);
  const ctx = hc.getContext('2d');
  const Y = (y) => ((BODY_DECOR.yTop - y) / (BODY_DECOR.yTop - BODY_DECOR.yBot)) * H;
  ctx.fillStyle = gray(105);
  ctx.fillRect(0, 0, W, H);
  const rnd = makeRng(1323);

  // 顶部云雷纹带
  borderLine(ctx, 0, Y(1.592), W, 5);
  leiwenBand(ctx, 0, Y(1.585), W, Y(1.538) - Y(1.585));
  borderLine(ctx, 0, Y(1.532), W, 5);
  // 连珠纹
  beadBand(ctx, 0, Y(1.525), W, Y(1.48) - Y(1.525));
  borderLine(ctx, 0, Y(1.474), W, 4);

  // 龙区：浅浮雕卷云
  ctx.strokeStyle = gray(150);
  ctx.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = mix(Y(1.44), Y(1.02), rnd());
    cloudScroll(ctx, x, y, 8 + rnd() * 10, rnd() < 0.5 ? 1 : -1);
  }

  // 篆文带
  borderLine(ctx, 0, Y(0.998), W, 5);
  borderLine(ctx, 0, Y(0.988), W, 2, 200);
  const gh = Y(0.865) - Y(0.975);
  const gw = gh * 0.72;
  const nG = Math.floor(W / (gw * 1.3));
  const gs = W / nG;
  for (let i = 0; i < nG; i++) {
    sealGlyph(ctx, i * gs + (gs - gw) / 2, Y(0.975), gw, gh, rnd);
    if (i % 4 === 3) {
      ctx.fillStyle = gray(225);
      ctx.fillRect((i + 1) * gs - 2, Y(0.98), 4, gh + 8);
    }
  }
  borderLine(ctx, 0, Y(0.855), W, 2, 200);
  borderLine(ctx, 0, Y(0.845), W, 5);

  // 山、龟、鸟、兽 画像带（每一方位一格）
  const kinds = ['turtle', 'bird', 'beast', 'bird', 'turtle', 'beast', 'bird', 'beast'];
  const pw = W / 8;
  const top = Y(0.825), bot = Y(0.5);
  for (let k = 0; k < 8; k++) {
    // 纹带的 u=0 对应方位“南”(lathe phi=0 → +z)，每格中心正对一条龙
    const cx = k * pw;
    for (const off of [-W, 0, W]) {
      const x0 = cx - pw / 2 + off;
      if (x0 > W || x0 + pw < 0) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0 + 4, top, pw - 8, bot - top); ctx.clip();
      mountains(ctx, x0, bot, pw, (bot - top) * 0.42, makeRng(77 + k));
      const ah = (bot - top) * 0.55, aw = ah * 1.25;
      const ax = x0 + (pw - aw) / 2, ay = top + (bot - top) * 0.04;
      const flip = k % 2 === 1;
      if (kinds[k] === 'turtle') turtle(ctx, ax, ay + ah * 0.1, aw, ah * 0.85, flip);
      if (kinds[k] === 'bird') bird(ctx, ax, ay, aw, ah, flip);
      if (kinds[k] === 'beast') beast(ctx, ax, ay, aw, ah, flip);
      ctx.strokeStyle = gray(150); ctx.lineWidth = 2;
      cloudScroll(ctx, x0 + pw * 0.16, top + 26, 9, 1);
      cloudScroll(ctx, x0 + pw * 0.86, top + 34, 8, -1);
      ctx.restore();
      ctx.fillStyle = gray(232);
      ctx.fillRect(x0 - 2, top, 4, bot - top);
    }
  }
  borderLine(ctx, 0, Y(0.495), W, 5);

  // 垂叶纹（蕉叶）
  leafBand(ctx, 0, Y(0.48), W, Y(0.39) - Y(0.48));
  borderLine(ctx, 0, Y(0.385), W, 5);

  const hb = blurred(hc, 1.2);
  const { cc, oc } = shadeFromHeight(hb, 11);
  return { map: toTex(cc, { srgb: true, wrapT: false }), bump: toTex(hb, { wrapT: false }), orm: toTex(oc, { wrapT: false }) };
}

// 盖顶纹饰：v=0 为盖沿，v=1 为盖顶
export function makeLidDecor() {
  const W = 2048, H = 768;
  const hc = canvas(W, H);
  const ctx = hc.getContext('2d');
  const V = (v) => (1 - v) * H;
  ctx.fillStyle = gray(105);
  ctx.fillRect(0, 0, W, H);
  // 盖沿云雷纹
  borderLine(ctx, 0, V(0.012), W, 5);
  leiwenBand(ctx, 0, V(0.085), W, V(0.02) - V(0.085));
  borderLine(ctx, 0, V(0.092), W, 5);
  beadBand(ctx, 0, V(0.145), W, V(0.1) - V(0.145));
  borderLine(ctx, 0, V(0.152), W, 3);
  // 博山式群峰：八方各一组，间以云气
  const pw = W / 8;
  for (let k = 0; k < 8; k++) {
    for (const off of [-W, 0, W]) {
      const x0 = k * pw - pw / 2 + off;
      if (x0 > W || x0 + pw < 0) continue;
      mountains(ctx, x0 + pw * 0.05, V(0.17), pw * 0.9, V(0.17) - V(0.5), makeRng(300 + k));
      ctx.strokeStyle = gray(155); ctx.lineWidth = 3;
      cloudScroll(ctx, x0 + pw * 0.5, V(0.56), 14, k % 2 ? 1 : -1);
    }
  }
  // 莲瓣
  const n = 16, s = W / n;
  for (let i = 0; i < n; i++) {
    const cx = i * s + s / 2, y0 = V(0.92), y1 = V(0.66);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.45, y0);
    ctx.bezierCurveTo(cx - s * 0.55, y0 + (y1 - y0) * 0.6, cx - s * 0.1, y1, cx, y1);
    ctx.bezierCurveTo(cx + s * 0.1, y1, cx + s * 0.55, y0 + (y1 - y0) * 0.6, cx + s * 0.45, y0);
    ctx.closePath();
    ctx.fillStyle = gray(200); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = gray(245); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, y0 + 6); ctx.lineTo(cx, y1 - 10);
    ctx.lineWidth = 2; ctx.strokeStyle = gray(150); ctx.stroke();
  }
  borderLine(ctx, 0, V(0.94), W, 6);
  const hb = blurred(hc, 1.2);
  const { cc, oc } = shadeFromHeight(hb, 23);
  return { map: toTex(cc, { srgb: true, wrapT: false }), bump: toTex(hb, { wrapT: false }), orm: toTex(oc, { wrapT: false }) };
}

// 通用青铜（可平铺）
export function makeBronze(seed = 5, size = 512, patBias = 0) {
  const n1 = new NoiseField(size, size, seed, 4, 6);
  const n2 = new NoiseField(size, size, seed + 3, 16, 4);
  const n3 = new NoiseField(size, size, seed + 9, 8, 4);
  const cc = canvas(size, size), oc = canvas(size, size), hc = canvas(size, size);
  const cd = cc.getContext('2d').createImageData(size, size);
  const od = oc.getContext('2d').createImageData(size, size);
  const hd = hc.getContext('2d').createImageData(size, size);
  const o = [0, 0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) {
    const a = n1.data[i], b = n2.data[i], c = n3.data[i];
    bronzeShade(0.55 + (b - 0.5) * 0.3, a, b, c, o, patBias);
    const p = i * 4;
    cd.data[p] = o[0]; cd.data[p + 1] = o[1]; cd.data[p + 2] = o[2]; cd.data[p + 3] = 255;
    od.data[p] = 255; od.data[p + 1] = o[3] * 255; od.data[p + 2] = o[4] * 255; od.data[p + 3] = 255;
    const hv = (b * 0.6 + c * 0.4) * 255;
    hd.data[p] = hd.data[p + 1] = hd.data[p + 2] = hv; hd.data[p + 3] = 255;
  }
  cc.getContext('2d').putImageData(cd, 0, 0);
  oc.getContext('2d').putImageData(od, 0, 0);
  hc.getContext('2d').putImageData(hd, 0, 0);
  return { map: toTex(cc, { srgb: true }), orm: toTex(oc), bump: toTex(hc) };
}

// 龙鳞（高度图，可平铺）
export function makeScales() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = gray(60);
  ctx.fillRect(0, 0, S, S);
  const r = 16;
  for (let row = -1; row < S / (r * 0.9) + 2; row++) {
    const y = row * r * 0.9;
    const off = row % 2 ? r : 0;
    for (let col = -1; col < S / (r * 2) + 2; col++) {
      for (const ox of [0, S]) {
        for (const oy of [0, S]) {
          const x = col * r * 2 + off + ox - S;
          const yy = y + oy - S;
          const g = ctx.createRadialGradient(x, yy - r * 0.2, r * 0.1, x, yy, r * 1.05);
          g.addColorStop(0, gray(250));
          g.addColorStop(0.75, gray(170));
          g.addColorStop(1, gray(70));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, yy, r, 0, Math.PI);
          ctx.lineTo(x - r, yy - r * 0.2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }
  return toTex(c);
}

// 蟾蜍疣粒
export function makeWarts() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = gray(90);
  ctx.fillRect(0, 0, S, S);
  const rnd = makeRng(99);
  for (let i = 0; i < 160; i++) {
    const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 9;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + ox - r * 0.3, y + oy - r * 0.3, 0, x + ox, y + oy, r);
      g.addColorStop(0, gray(250));
      g.addColorStop(1, gray(90));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  return toTex(c);
}

// 展厅地面：深色石板
export function makeFloor() {
  const S = 1024;
  const n = new NoiseField(256, 256, 41, 8, 5);
  const n2 = new NoiseField(256, 256, 43, 32, 3);
  const c = canvas(S, S), r = canvas(S, S);
  const cd = c.getContext('2d').createImageData(S, S);
  const rd = r.getContext('2d').createImageData(S, S);
  const tiles = 4, ts = S / tiles;
  const rnd = makeRng(8);
  const tone = Array.from({ length: tiles * tiles }, () => 0.85 + rnd() * 0.3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const tx = Math.floor(x / ts), ty = Math.floor(y / ts);
    const lx = x % ts, ly = y % ts;
    const joint = lx < 3 || ly < 3;
    const v = n.sample(x / S, y / S), v2 = n2.sample(x / S, y / S);
    const k = tone[ty * tiles + tx] * (0.8 + 0.4 * v) * (0.92 + 0.16 * v2);
    const i = (y * S + x) * 4;
    const base = joint ? [18, 17, 16] : [52 * k, 49 * k, 45 * k];
    cd.data[i] = base[0]; cd.data[i + 1] = base[1]; cd.data[i + 2] = base[2]; cd.data[i + 3] = 255;
    const rough = joint ? 0.95 : 0.28 + v2 * 0.25;
    rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rough * 255; rd.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(cd, 0, 0);
  r.getContext('2d').putImageData(rd, 0, 0);
  return { map: toTex(c, { srgb: true }), rough: toTex(r) };
}

// 台座石材（侧面带水波纹）
export function makeStone(withWaves = false) {
  const W = withWaves ? 2048 : 512, H = withWaves ? 128 : 512;
  const n = new NoiseField(256, withWaves ? 32 : 256, 61, 8, 5);
  const c = canvas(W, H), b = canvas(W, H);
  const bctx = b.getContext('2d');
  bctx.fillStyle = gray(110);
  bctx.fillRect(0, 0, W, H);
  if (withWaves) {
    bctx.strokeStyle = gray(230);
    bctx.lineWidth = 5;
    for (let row = 0; row < 3; row++) {
      const yb = H * (0.35 + row * 0.22);
      for (let x = -40; x < W + 40; x += 64) {
        bctx.beginPath();
        bctx.arc(x + (row % 2) * 32, yb, 26, Math.PI, 0);
        bctx.stroke();
        bctx.beginPath();
        bctx.arc(x + (row % 2) * 32, yb, 14, Math.PI, 0);
        bctx.stroke();
      }
    }
    bctx.fillStyle = gray(220);
    bctx.fillRect(0, 4, W, 6);
    bctx.fillRect(0, H - 10, W, 6);
  }
  const hb = blurred(b, 1);
  const hd = hb.getContext('2d').getImageData(0, 0, W, H).data;
  const cd = c.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = n.sample(x / W, y / H);
    const k = (0.7 + 0.5 * v) * (0.85 + (hd[i] / 255) * 0.3);
    cd.data[i] = 70 * k; cd.data[i + 1] = 72 * k; cd.data[i + 2] = 66 * k; cd.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(cd, 0, 0);
  return { map: toTex(c, { srgb: true }), bump: toTex(hb) };
}

// 台座顶面：八方铭文
export function makePlinthTop(names) {
  const S = 2048;
  const n = new NoiseField(256, 256, 71, 8, 5);
  const c = canvas(S, S), b = canvas(S, S);
  const bctx = b.getContext('2d');
  bctx.fillStyle = gray(150);
  bctx.fillRect(0, 0, S, S);
  const cx = S / 2;
  const R = S / 2;
  const rad = (m) => (m / 1.52) * R;
  bctx.strokeStyle = gray(60);
  for (const [r, lw] of [[1.5, 6], [1.46, 3], [1.25, 3]]) {
    bctx.lineWidth = lw;
    bctx.beginPath(); bctx.arc(cx, cx, rad(r), 0, Math.PI * 2); bctx.stroke();
  }
  // 方位字
  bctx.fillStyle = gray(55);
  bctx.font = `bold ${Math.round(rad(0.07))}px "STKaiti","KaiTi","Noto Serif SC","SimSun",serif`;
  bctx.textAlign = 'center';
  bctx.textBaseline = 'middle';
  for (let k = 0; k < 8; k++) {
    for (const da of [-0.17, 0.17]) {
      const a = (k * Math.PI) / 4 + da;
      bctx.save();
      bctx.translate(cx + Math.sin(a) * rad(1.48), cx - Math.cos(a) * rad(1.48));
      bctx.rotate(a);
      bctx.fillText(names[k], 0, 0);
      bctx.restore();
    }
    // 方位刻线
    const a = (k * Math.PI) / 4;
    bctx.lineWidth = 3;
    bctx.beginPath();
    bctx.moveTo(cx + Math.sin(a) * rad(1.44), cx - Math.cos(a) * rad(1.44));
    bctx.lineTo(cx + Math.sin(a) * rad(1.5), cx - Math.cos(a) * rad(1.5));
    bctx.stroke();
  }
  const hb = blurred(b, 1.5);
  const hd = hb.getContext('2d').getImageData(0, 0, S, S).data;
  const cd = c.getContext('2d').createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const v = n.sample(x / S, y / S);
    const e = hd[i] / 255;
    const k = (0.68 + 0.45 * v) * (0.55 + e * 0.5);
    cd.data[i] = 74 * k; cd.data[i + 1] = 75 * k; cd.data[i + 2] = 69 * k; cd.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(cd, 0, 0);
  return { map: toTex(c, { srgb: true }), bump: toTex(hb) };
}
