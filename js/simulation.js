// 地震与都柱（悬垂摆）的物理模拟 —— 纯逻辑，不依赖 three.js
// 坐标约定：水平面 (x, z)，x 指向东，z 指向南；方位角 a 自北顺时针，方向向量 (sin a, -cos a)

export const DIR_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export const N_CH = 8;
export const azVec = (a) => ({ x: Math.sin(a), z: -Math.cos(a) });

export const TIMING = {
  tP: 1.2,   // P 波（纵波）到达时刻 / s
  tS: 2.8,   // S 波（横波）到达时刻 / s
  tEnd: 11,  // 模拟结束
};

export const STAGES = 7;

export class QuakeSim {
  constructor() {
    this.gap = 0.02;          // 都柱足盘与滑杆内端的间隙 / m
    this.sMax = 0.08;         // 滑杆最大行程 / m
    this.L = 0.9;             // 等效摆长 / m
    this.omega = Math.sqrt(9.81 / this.L);
    this.zeta = 0.03;         // 阻尼比
    this.epiAz = 1.5 * Math.PI; // 震中方位（默认：西）
    this.intensity = 1;
    this.chDir = Array.from({ length: N_CH }, (_, k) => azVec((k * Math.PI) / 4));
    this.reset();
  }

  reset() {
    this.t = 0;
    this.running = false;
    this.started = false;
    this.finished = false;
    this.X = { x: 0, z: 0 };   // 摆锤绝对位置（相对初始点）
    this.V = { x: 0, z: 0 };
    this.G = { x: 0, z: 0 };   // 地面（仪体）位移
    this.Gv = { x: 0, z: 0 };
    this.GL = 0; this.GT = 0;  // 地面位移的纵向 / 横向分量
    this.u = { x: 0, z: 0 };   // 都柱相对仪体的位移
    this.triggered = -1;
    this.triggerT = 0;
    this.s = new Float64Array(N_CH);   // 各道滑杆位移
    this.sv = new Float64Array(N_CH);
    this.lock = 0;            // 关（锁定）进度 0..1
    this.history = [];
    this._histAcc = 0;
    this.stage = 0;
    this.events = [];
    this.maxU = 0;
    this.accel = 0;
  }

  start() {
    this.reset();
    this.running = true;
    this.started = true;
  }

  // 地面位移：P 波沿“震中→仪器”方向先推（压缩初动），S 波以横向为主、振幅更大
  ground(t, out) {
    const n = azVec(this.epiAz);
    const nx = -n.x, nz = -n.z;     // 远离震中的方向
    const px = -nz, pz = nx;        // 横向
    const I = this.intensity;
    let L = 0, T = 0;
    const tp = t - TIMING.tP;
    if (tp > 0) {
      const Ap = 0.042 * I;
      const ramp = 1 - Math.exp(-tp / 0.03);
      L += Ap * ramp * Math.sin((2 * Math.PI * tp) / 0.62) * Math.exp(-tp / 0.5);
      T += Ap * 0.08 * ramp * Math.sin((2 * Math.PI * tp) / 0.37 + 0.7) * Math.exp(-tp / 0.4);
    }
    const ts = t - TIMING.tS;
    if (ts > 0) {
      const As = 0.065 * I;
      const env = (1 - Math.exp(-ts / 0.22)) * Math.exp(-ts / 2.4);
      T += As * env * (0.9 * Math.sin((2 * Math.PI * ts) / 0.82) + 0.35 * Math.sin((2 * Math.PI * ts) / 0.47 + 1.3));
      L += As * env * 0.35 * Math.sin((2 * Math.PI * ts) / 0.66 + 2.1);
    }
    out.x = nx * L + px * T;
    out.z = nz * L + pz * T;
    out.L = L;
    out.T = T;
    return out;
  }

  step(dt) {
    if (!this.running) return;
    const n = Math.max(1, Math.ceil(dt / 0.0005));
    const h = dt / n;
    const g = {};
    for (let i = 0; i < n && this.running; i++) this._sub(h, g);
  }

  _sub(h, g) {
    const t1 = this.t + h;
    this.ground(t1, g);
    const Gvx = (g.x - this.G.x) / h, Gvz = (g.z - this.G.z) / h;
    this.accel = Math.hypot(Gvx - this.Gv.x, Gvz - this.Gv.z) / h;
    this.G.x = g.x; this.G.z = g.z;
    this.Gv.x = Gvx; this.Gv.z = Gvz;
    this.GL = g.L; this.GT = g.T;

    // 摆的运动方程（绝对坐标）：X'' = -ω²(X-G) - 2ζω(X'-G')
    if (this.lock < 1) {
      const w = this.omega, c = 2 * this.zeta * w;
      const ux0 = this.X.x - g.x, uz0 = this.X.z - g.z;
      const ax = -w * w * ux0 - c * (this.V.x - Gvx);
      const az = -w * w * uz0 - c * (this.V.z - Gvz);
      this.V.x += ax * h; this.V.z += az * h;
      this.X.x += this.V.x * h; this.X.z += this.V.z * h;
    }

    let ux = this.X.x - g.x, uz = this.X.z - g.z;
    let vx = this.V.x - Gvx, vz = this.V.z - Gvz;

    // 都柱与八道滑杆的接触
    for (let k = 0; k < N_CH; k++) {
      const e = this.chDir[k];
      const p = ux * e.x + uz * e.z;
      if (this.triggered < 0 && p > this.gap) {
        this.triggered = k;
        this.triggerT = t1;
        this.sv[k] = Math.max(vx * e.x + vz * e.z, 0.6);
        this.events.push({ type: 'trigger', k, t: t1 });
      }
      if (this.triggered < 0) continue;
      let limit = this.gap;
      if (k === this.triggered) {
        if (p > this.gap) this.s[k] = Math.max(this.s[k], Math.min(p - this.gap, this.sMax));
        limit = this.gap + this.s[k];
      }
      // 其余七道已被“关”住，都柱被挡回
      if (p > limit) {
        ux -= e.x * (p - limit); uz -= e.z * (p - limit);
        const vp = vx * e.x + vz * e.z;
        if (vp > 0) { vx -= e.x * vp; vz -= e.z * vp; }
      }
    }

    // 被推出的滑杆凭惯性滑至行程末端并卡住
    const k = this.triggered;
    if (k >= 0 && this.s[k] < this.sMax) {
      this.s[k] = Math.min(this.sMax, this.s[k] + this.sv[k] * h);
    }

    // 施关：触发后约 0.6 s，锁定漏斗升起把都柱扶正并锁住
    if (k >= 0 && t1 > this.triggerT + 0.6) {
      this.lock = Math.min(1, this.lock + h / 0.8);
    }
    if (this.lock > 0) {
      const b = Math.min(1, h * 9 * this.lock);
      ux -= ux * b; uz -= uz * b;
      vx *= 1 - b; vz *= 1 - b;
      if (this.lock >= 1) { ux = uz = vx = vz = 0; }
    }

    this.X.x = g.x + ux; this.X.z = g.z + uz;
    this.V.x = Gvx + vx; this.V.z = Gvz + vz;
    this.u.x = ux; this.u.z = uz;
    this.t = t1;
    this.maxU = Math.max(this.maxU, Math.hypot(ux, uz));

    this._histAcc += h;
    if (this._histAcc >= 1 / 60) {
      this._histAcc = 0;
      this.history.push({ t: t1, L: g.L, T: g.T, ux, uz });
    }

    this.stage = Math.max(this.stage, this.computeStage());

    if (t1 >= TIMING.tEnd) {
      this.running = false;
      this.finished = true;
      this.events.push({ type: 'end', t: t1 });
    }
  }

  computeStage() {
    if (!this.started) return 0;
    if (this.t < TIMING.tP) return 1;
    const k = this.triggered;
    if (k < 0) return Math.hypot(this.u.x, this.u.z) < this.gap * 0.5 ? 2 : 3;
    if (this.lock > 0.05) return 7;
    if (this.s[k] < 0.4 * this.sMax) return 4;
    return 5;
  }

  // 滑杆行程比例 0..1（驱动顶杆与龙颌）
  openFrac(k) {
    return this.s[k] / this.sMax;
  }
}

export function nearestDir(az) {
  const a = ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(a / (Math.PI / 4)) % 8;
}
