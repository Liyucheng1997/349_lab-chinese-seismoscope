// 声音：铜丸落入蟾口的“振声激扬”，以及地震的低沉轰鸣（WebAudio 合成）
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // 轰鸣：低通噪声
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = last * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    src.connect(lp).connect(this.rumble).connect(this.master);
    src.start();
  }
  setRumble(level) {
    if (!this.ctx) return;
    const v = this.enabled ? Math.min(1, level) * 0.9 : 0;
    this.rumble.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  clang(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const f0 = 620;
    // 青铜的非谐泛音
    const partials = [[1, 1, 2.2], [2.76, 0.5, 1.4], [5.4, 0.25, 0.8], [8.93, 0.12, 0.5], [0.5, 0.3, 2.8]];
    for (const [r, a, dec] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * r;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25 * a * strength, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dec + 0.05);
    }
    // 撞击噪声
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / 300);
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const ng = ctx.createGain();
    ng.gain.value = 0.3 * strength;
    ns.connect(hp).connect(ng).connect(this.master);
    ns.start(t0);
  }
  click() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.08);
  }
}
