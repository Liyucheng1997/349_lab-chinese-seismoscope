// 二维图表：俯视图（都柱相对位移轨迹）与地震记录
import { DIR_NAMES, TIMING, azVec } from './simulation.js';

function setup(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const C = {
  ink: '#e9dcc0',
  dim: 'rgba(233,220,192,0.35)',
  faint: 'rgba(233,220,192,0.12)',
  gold: '#d9a858',
  red: '#e2553d',
  blue: '#5cb8ff',
  orange: '#ff8a3d',
};

export function drawTopView(canvas, sim) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 22;
  const gapR = R * 0.42;               // 间隙圆半径（像素）
  const S = gapR / sim.gap;            // 米 → 像素（放大显示）

  // 外圈
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  // 八道
  for (let k = 0; k < 8; k++) {
    const e = azVec((k * Math.PI) / 4);
    const trig = sim.triggered === k;
    const s = sim.s[k] * S;
    const x0 = cx + e.x * (gapR + s), y0 = cy + e.z * (gapR + s);
    const len = R * 0.42;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(Math.atan2(e.z, e.x));
    ctx.fillStyle = trig ? C.red : 'rgba(217,168,88,0.55)';
    ctx.fillRect(0, -4, len, 8);
    ctx.restore();
    ctx.fillStyle = trig ? C.red : C.dim;
    ctx.font = '11px "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(DIR_NAMES[k], cx + e.x * (R + 11), cy + e.z * (R + 11));
  }

  // 间隙圆（触发阈值）
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = C.dim;
  ctx.beginPath(); ctx.arc(cx, cy, gapR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // 震中方向箭头
  const ep = azVec(sim.epiAz);
  ctx.strokeStyle = C.red;
  ctx.fillStyle = C.red;
  ctx.lineWidth = 1.5;
  const ax = cx + ep.x * (R - 4), ay = cy + ep.z * (R - 4);
  ctx.beginPath();
  ctx.moveTo(cx + ep.x * (R * 0.25), cy + ep.z * (R * 0.25));
  ctx.lineTo(ax, ay);
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 轨迹
  const hist = sim.history;
  const n = hist.length;
  const from = Math.max(0, n - 240);
  for (let i = from + 1; i < n; i++) {
    const a = hist[i - 1], b = hist[i];
    const age = (n - i) / 240;
    ctx.strokeStyle = `rgba(92,184,255,${0.9 * (1 - age)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + a.ux * S, cy + a.uz * S);
    ctx.lineTo(cx + b.ux * S, cy + b.uz * S);
    ctx.stroke();
  }
  // 都柱当前位置
  const bx = cx + sim.u.x * S, by = cy + sim.u.z * S;
  ctx.fillStyle = 'rgba(217,168,88,0.25)';
  ctx.beginPath(); ctx.arc(bx, by, gapR * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.gold;
  ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
  if (sim.lock > 0) {
    ctx.strokeStyle = `rgba(226,85,61,${sim.lock})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = C.dim;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('上北 · 位移放大显示', 6, h - 8);
}

export function drawTrace(canvas, sim) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const T = TIMING.tEnd;
  const pad = 6;
  const X = (t) => pad + (t / T) * (w - pad * 2);
  const mid1 = h * 0.3, mid2 = h * 0.72;
  const amp = h * 0.2 / 0.07;
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1;
  for (const m of [mid1, mid2]) { ctx.beginPath(); ctx.moveTo(pad, m); ctx.lineTo(w - pad, m); ctx.stroke(); }

  // P / S 到达
  for (const [t, col, lab] of [[TIMING.tP, C.blue, 'P波'], [TIMING.tS, C.orange, 'S波']]) {
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(t), 4); ctx.lineTo(X(t), h - 4); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.font = '10px sans-serif';
    ctx.fillText(lab, X(t) + 3, 12);
  }
  ctx.fillStyle = C.dim;
  ctx.font = '10px sans-serif';
  ctx.fillText('纵向（震中方向）', pad + 2, mid1 - h * 0.2 + 4);
  ctx.fillText('横向', pad + 2, mid2 - h * 0.2 + 6);

  const hist = sim.history;
  for (const [key, mid, col] of [['L', mid1, C.blue], ['T', mid2, C.orange]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const p = hist[i];
      const x = X(p.t), y = mid - p[key] * amp;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  if (sim.triggered >= 0) {
    const x = X(sim.triggerT);
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h - 4); ctx.stroke();
    ctx.fillStyle = C.red;
    ctx.fillText('龙吐丸', x + 3, h - 6);
  }
  if (sim.started) {
    ctx.strokeStyle = C.ink;
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(X(Math.min(sim.t, T)), 4); ctx.lineTo(X(Math.min(sim.t, T)), h - 4); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
