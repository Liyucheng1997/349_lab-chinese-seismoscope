import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as TX from './textures.js';
import { buildSeismoscope, createMaterials, DIM, jawFromLift, bodyR, TOAD_REST } from './seismoscope.js';
import { QuakeSim, DIR_NAMES, TIMING, azVec, nearestDir, N_CH } from './simulation.js';
import { createWaves } from './waves.js';
import { drawTopView, drawTrace } from './charts.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const nextFrame = () => new Promise((r) => setTimeout(r, 16));
const setLoad = (t) => { $('#loadText').textContent = t; };

const state = {
  mode: 'appearance',
  cut: false,
  xray: false,
  explode: 0,
  explodeTarget: 0,
  labels: true,
  dims: false,
  waves: true,
  follow: true,
  epiAz: 1.5 * Math.PI,
  intensity: 1,
  timeScale: 0.4,
  viewStage: 0,
  resultShown: false,
};

/* ------------------------------------------------------------------ */
/* 渲染器与场景                                                        */
/* ------------------------------------------------------------------ */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const labelRenderer = new CSS2DRenderer({ element: $('#labels') });
labelRenderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const BG = 0x0d0b09;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 16, 58);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(3.4, 2.35, 4.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.15, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.9;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.6;

// 灯光
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x1c140c, 0.35);
scene.add(hemi);
const key = new THREE.SpotLight(0xffe2bc, 300, 0, 0.42, 0.65, 2);
key.position.set(3.6, 7.2, 4.8);
key.target.position.set(0, 1.0, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.camera.near = 4;
key.shadow.camera.far = 16;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9cc3ff, 1.4);
rim.position.set(-5, 4.5, -5.5);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffd7a8, 0.45);
fill.position.set(-4, 2, 4);
scene.add(fill);
const inner = new THREE.PointLight(0xffd29a, 0, 3.2, 1.6);
inner.position.set(0, 1.25, 0);

/* ------------------------------------------------------------------ */
/* 构建                                                                */
/* ------------------------------------------------------------------ */
const sim = new QuakeSim();
const sound = new Sound();
const clipPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e5), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e5)];
let inst, M, waves;
const labels = { outer: [], inner: [], channel: [] };
let labelChannel = -1;
let dimGroup;
const compassLabels = [];

async function build() {
  setLoad('生成器身纹饰（篆文、山、龟、鸟、兽）……');
  await nextFrame();
  const body = TX.makeBodyDecor();
  setLoad('生成器盖纹饰……');
  await nextFrame();
  const lid = TX.makeLidDecor();
  setLoad('调配青铜锈色……');
  await nextFrame();
  const tex = {
    body, lid,
    bronze: TX.makeBronze(5, 512, 0),
    bronzeDark: TX.makeBronze(15, 256, 0.15),
    bronzeBright: TX.makeBronze(25, 256, -0.35),
    bronzeGreen: TX.makeBronze(35, 512, 0.08),
    scales: TX.makeScales(),
    warts: TX.makeWarts(),
  };
  for (const k of ['bronze', 'bronzeDark', 'bronzeBright', 'bronzeGreen']) {
    for (const t of [tex[k].map, tex[k].orm, tex[k].bump]) t.repeat.set(2, 2);
  }
  setLoad('凿刻台座……');
  await nextFrame();
  tex.stone = TX.makeStone(false);
  tex.stoneBand = TX.makeStone(true);
  tex.stoneBand.map.repeat.set(3, 1);
  tex.stoneBand.bump.repeat.set(3, 1);
  tex.plinthTop = TX.makePlinthTop(DIR_NAMES);
  const floorTex = TX.makeFloor();
  for (const t of [floorTex.map, floorTex.rough]) t.repeat.set(15, 15);

  setLoad('铸造八龙、蟾蜍与机关……');
  await nextFrame();
  M = createMaterials(tex, clipPlanes);
  inst = buildSeismoscope(M);
  scene.add(inst.root);
  inst.root.add(inner);
  inst.root.traverse((o) => {
    if (o.isMesh && o.castShadow === false && o.material !== M.cap) o.castShadow = true;
    if (o.isMesh) o.receiveShadow = true;
  });
  for (const c of inst.caps) { c.castShadow = false; c.receiveShadow = false; }

  // 地面
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(70, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: floorTex.map, roughnessMap: floorTex.rough, roughness: 1, metalness: 0, envMapIntensity: 0.4 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);

  waves = createWaves();
  scene.add(waves.mesh, waves.marker);
  const epiLabel = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'epi-label', textContent: '震中' }));
  epiLabel.position.set(0, 6.4, 0);
  waves.marker.add(epiLabel);
  waves.setEpicenter(state.epiAz, 30);
  waves.marker.visible = false;

  buildCompassLabels();
  buildLabels();
  buildDims();
}

/* ------------------------------------------------------------------ */
/* 标注                                                                */
/* ------------------------------------------------------------------ */
function makeTag(text, sub, innerTag = false) {
  const el = document.createElement('div');
  el.className = 'tag' + (innerTag ? ' inner' : '');
  el.innerHTML = `<i></i><b></b><span>${text}${sub ? `<small>${sub}</small>` : ''}</span>`;
  const o = new CSS2DObject(el);
  o.center.set(0, 1);
  return o;
}

function buildCompassLabels() {
  for (let k = 0; k < 8; k++) {
    const el = document.createElement('div');
    el.className = 'compass-label' + (k % 2 === 0 ? ' main' : '');
    el.textContent = DIR_NAMES[k];
    const o = new CSS2DObject(el);
    const e = azVec((k * Math.PI) / 4);
    const r = k % 2 === 0 ? 2.25 : 2.1;
    o.position.set(e.x * r, 0.02, e.z * r);
    scene.add(o);
    compassLabels.push(el);
  }
}

function buildLabels() {
  const add = (parent, pos, text, sub, isInner, list) => {
    const t = makeTag(text, sub, isInner);
    t.position.copy(pos);
    parent.add(t);
    list.push(t);
    return t;
  };
  add(inst.lid, new THREE.Vector3(0, 2.47, 0), '合盖', '隆起如尊盖', false, labels.outer);
  add(inst.pendulum, new THREE.Vector3(0, -0.5, 0), '都柱', '悬垂的重摆', true, labels.inner);
  add(inst.pendulum, new THREE.Vector3(0, 0.0, 0), '悬挂点', '十字梁', true, labels.inner);
  add(inst.funnel, new THREE.Vector3(0, 0.05, 0), '关', '锁定机构', true, labels.inner);
  // 随视角切换到最近一条通道的标注
  const spec = [
    ['head', new THREE.Vector3(0.03, 0.09, 0), '龙首', '八龙之一', false],
    ['ball', new THREE.Vector3(0, 0.02, 0), '铜丸', null, false],
    ['toad', new THREE.Vector3(0.1, 0.05, 0), '蟾蜍', '张口承丸', false],
    ['group', null, '篆文山龟鸟兽纹', null, false],
    ['group2', new THREE.Vector3(0.5, DIM.discTop + 0.02, 0.06), '八道', '八方滑道', true],
    ['slider', new THREE.Vector3(0.3, DIM.sliderY0 + 0.03, 0), '滑杆', null, true],
    ['rod', new THREE.Vector3(DIM.rodX, 1.06, 0), '顶杆', null, true],
    ['jaw', new THREE.Vector3(-0.12, -0.03, 0), '牙机', '龙颌杠杆', true],
  ];
  for (const [slot, pos, text, sub, isInner] of spec) {
    const t = makeTag(text, sub, isInner);
    t.userData.slot = slot;
    if (slot === 'group') {
      const d = 0.39, y = 0.68, r = bodyR(y) + 0.005;
      t.position.set(r * Math.cos(d), y, r * Math.sin(d));
    } else t.position.copy(pos);
    labels.channel.push(t);
    (isInner ? labels.inner : labels.outer).push(t);
  }
}

function attachChannelLabels(k) {
  if (k === labelChannel) return;
  labelChannel = k;
  const ch = inst.channels[k];
  for (const t of labels.channel) {
    const slot = t.userData.slot;
    const parent = slot === 'group' || slot === 'group2' ? ch.group : ch[slot];
    parent.add(t);
  }
}

function updateLabelVisibility() {
  const showInner = state.labels && state.mode !== 'appearance';
  for (const t of labels.outer) t.visible = state.labels;
  for (const t of labels.inner) t.visible = showInner;
}

function buildDims() {
  dimGroup = new THREE.Group();
  const mat = new THREE.LineDashedMaterial({ color: 0x8fcaff, dashSize: 0.04, gapSize: 0.025, transparent: true, opacity: 0.9, depthTest: false });
  const solid = new THREE.LineBasicMaterial({ color: 0x8fcaff, transparent: true, opacity: 0.95, depthTest: false });
  const line = (pts, m) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const l = new THREE.Line(g, m);
    l.computeLineDistances();
    l.renderOrder = 10;
    dimGroup.add(l);
  };
  const R = inst.dims.diameter / 2, top = inst.dims.top, yD = 2.7;
  line([[-R, yD, 0], [R, yD, 0]], solid);
  line([[-R, yD + 0.05, 0], [-R, 1.1, 0]], mat);
  line([[R, yD + 0.05, 0], [R, 1.1, 0]], mat);
  for (const s of [-1, 1]) line([[s * R - 0.03 * s, yD + 0.03, 0], [s * R + 0.03 * s, yD - 0.03, 0]], solid);
  const xH = 1.95;
  line([[xH, DIM.baseTop, 0], [xH, top, 0]], solid);
  line([[0.1, top, 0], [xH + 0.05, top, 0]], mat);
  line([[0.75, DIM.baseTop, 0], [xH + 0.05, DIM.baseTop, 0]], mat);
  for (const y of [DIM.baseTop, top]) line([[xH - 0.03, y - 0.03, 0], [xH + 0.03, y + 0.03, 0]], solid);
  const lab = (text, x, y) => {
    const el = document.createElement('div');
    el.className = 'dim-label';
    el.innerHTML = text;
    const o = new CSS2DObject(el);
    o.position.set(x, y, 0);
    dimGroup.add(o);
  };
  lab(`直径 ${inst.dims.diameter.toFixed(2)} m（汉制“员径八尺”）`, 0, yD + 0.1);
  lab(`通高 ${(top - DIM.baseTop).toFixed(2)} m`, xH, (top + DIM.baseTop) / 2);
  $('#hText').textContent = `≈ ${(top - DIM.baseTop).toFixed(2)} m（不含台座）`;
  dimGroup.visible = false;
  inst.root.add(dimGroup);
}

/* ------------------------------------------------------------------ */
/* 视图模式                                                            */
/* ------------------------------------------------------------------ */
function setMode(m) {
  state.mode = m;
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  state.cut = m === 'cut' || m === 'explode';
  state.xray = m === 'xray';
  state.explodeTarget = m === 'explode' ? 1 : 0;
  for (const mat of [M.shellOuter, M.lidOuter, M.shellInner]) {
    mat.transparent = state.xray;
    mat.opacity = state.xray ? 0.14 : 1;
    mat.depthWrite = !state.xray;
    mat.needsUpdate = true;
  }
  for (const c of inst.caps) c.visible = !state.xray;
  for (const s of inst.shell) s.castShadow = !state.xray && !state.cut;
  inner.intensity = m === 'appearance' ? 0 : 1.6;
  updateLabelVisibility();
}

function updateClip() {
  if (!state.cut) {
    clipPlanes[0].set(new THREE.Vector3(1, 0, 0), 1e5);
    clipPlanes[1].set(new THREE.Vector3(-1, 0, 0), 1e5);
    return;
  }
  const o = inst.root.getWorldPosition(new THREE.Vector3());
  const ca = camAzimuth();
  const hw = THREE.MathUtils.degToRad(52);
  const t = (a) => new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  clipPlanes[0].setFromNormalAndCoplanarPoint(t(ca - hw).negate(), o);
  clipPlanes[1].setFromNormalAndCoplanarPoint(t(ca + hw), o);
}

function camAzimuth() {
  const dx = camera.position.x - controls.target.x, dz = camera.position.z - controls.target.z;
  return Math.atan2(dx, -dz);
}

/* ------------------------------------------------------------------ */
/* 相机动画                                                            */
/* ------------------------------------------------------------------ */
let camTween = null;
function flyTo({ az, polar, dist, target, dur = 1.6 }) {
  const off = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  let theta1 = Math.PI - az;
  let d = theta1 - sph.theta;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camTween = {
    t: 0, dur,
    from: { theta: sph.theta, phi: sph.phi, r: sph.radius, target: controls.target.clone() },
    to: { theta: sph.theta + d, phi: polar ?? sph.phi, r: dist ?? sph.radius, target: target ? target.clone() : controls.target.clone() },
  };
}
function updateCamTween(dt) {
  if (!camTween) return;
  camTween.t += dt / camTween.dur;
  const k = Math.min(1, camTween.t);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const { from, to } = camTween;
  const sph = new THREE.Spherical(
    THREE.MathUtils.lerp(from.r, to.r, e),
    THREE.MathUtils.lerp(from.phi, to.phi, e),
    THREE.MathUtils.lerp(from.theta, to.theta, e),
  );
  controls.target.lerpVectors(from.target, to.target, e);
  camera.position.setFromSpherical(sph).add(controls.target);
  if (k >= 1) camTween = null;
}

function camPreset(name) {
  const near = nearestDir(camAzimuth());
  if (name === 'front') flyTo({ az: Math.PI * 0.82, polar: 1.25, dist: 5.6, target: new THREE.Vector3(0, 1.15, 0) });
  if (name === 'dragon') flyTo({ az: (near * Math.PI) / 4 + 0.5, polar: 1.32, dist: 2.0, target: new THREE.Vector3(...dragonFocus(near)) });
  if (name === 'inside') {
    if (state.mode === 'appearance' || state.mode === 'explode') setMode('cut');
    flyTo({ az: camAzimuth(), polar: 1.05, dist: 3.2, target: new THREE.Vector3(0, 1.0, 0) });
  }
  if (name === 'aerial') flyTo({ az: state.epiAz + Math.PI * 0.85, polar: 0.82, dist: 34, target: new THREE.Vector3(...azArr(state.epiAz, 9)) });
}
function azArr(a, r) { const e = azVec(a); return [e.x * r, 0, e.z * r]; }
function dragonFocus(k) {
  const e = azVec((k * Math.PI) / 4);
  return [e.x * 1.05, 0.8, e.z * 1.05];
}

/* ------------------------------------------------------------------ */
/* 地震流程                                                            */
/* ------------------------------------------------------------------ */
function resetQuake() {
  sim.reset();
  sim.epiAz = state.epiAz;
  state.viewStage = 0;
  state.resultShown = false;
  for (const ch of inst.channels) {
    ch.jaw.add(ch.ball);
    ch.ball.position.copy(ch.ballHome);
    ch.ball.rotation.set(0, 0, 0);
    ch.ballState.phase = 'held';
    ch.ballState.bounced = false;
  }
  inst.root.position.set(0, 0, 0);
  waves.update(-1, 0);
  waves.marker.visible = false;
  $('#result').classList.add('hidden');
  compassLabels.forEach((el) => el.classList.remove('hot'));
  applySim();
  sound.setRumble(0);
}

function startQuake() {
  sound.ensure();
  if (state.mode === 'explode') setMode('cut');
  resetQuake();
  sim.epiAz = state.epiAz;
  sim.intensity = state.intensity;
  sim.start();
  waves.setEpicenter(state.epiAz, 30);
  waves.marker.visible = state.waves;
}

function onTrigger(k) {
  sound.click();
  compassLabels[k].classList.add('hot');
  if (state.follow) {
    flyTo({ az: (k * Math.PI) / 4 + 0.55, polar: 1.28, dist: 3.4, target: new THREE.Vector3(...dragonFocus(k)), dur: 1.8 });
  }
}

function showResult() {
  if (state.resultShown) return;
  state.resultShown = true;
  const el = $('#result');
  const epiDir = nearestDir(state.epiAz);
  const deg = Math.round(THREE.MathUtils.radToDeg(state.epiAz) + 360) % 360;
  if (sim.triggered < 0) {
    el.innerHTML = `<div class="big">八龙皆未发机</div><div class="sub">震动过弱，都柱的相对位移未能越过间隙。可调高“地震强度”再试。</div>`;
  } else {
    const k = sim.triggered;
    const ok = k === epiDir;
    el.innerHTML = `<div class="big">${DIR_NAMES[k]}方龙首吐丸 → 震在${DIR_NAMES[k]}方</div>
      <div class="sub">实际震中：${DIR_NAMES[epiDir]}（${deg}°）·
      ${ok ? '<span class="ok">“寻其方面，乃知震之所在”——判断正确</span>'
        : '<span class="bad">方向有偏差：P 波太弱，由后续的晃动触发（可提高强度再试）</span>'}</div>`;
  }
  el.classList.remove('hidden');
}

// 把模拟状态映射到模型
function applySim() {
  const vis = 1.0;
  inst.root.position.set(sim.G.x * vis, 0, sim.G.z * vis);
  // 都柱
  const L = inst.pendLength;
  const dir = new THREE.Vector3(sim.u.x, -L, sim.u.z).normalize();
  inst.pendulum.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  // 关
  const e = sim.lock * sim.lock * (3 - 2 * sim.lock);
  inst.funnel.position.y = THREE.MathUtils.lerp(inst.lockY0, inst.lockY1, e);
  // 八道
  for (const ch of inst.channels) {
    const s = sim.s[ch.k];
    ch.slider.position.x = s;
    const lift = DIM.wedgeSlope * s;
    ch.rod.position.y = lift;
    const a = jawFromLift(lift);
    ch.jaw.rotation.z = -(DIM.jawBase + a);
    ch.openAngle = a;
  }
}

const _w = new THREE.Vector3();
function updateBalls(dt) {
  const g = 9.81;
  for (const ch of inst.channels) {
    const b = ch.ballState;
    if (b.phase === 'held' && ch.openAngle > inst.ballLaunch.releaseAngle) {
      ch.ball.getWorldPosition(_w);
      ch.group.attach(ch.ball);
      b.x = ch.ball.position.x; b.y = ch.ball.position.y;
      b.vx = inst.ballLaunch.vx; b.vy = inst.ballLaunch.vy;
      b.phase = 'fall';
      b.y0 = b.y;
      state.viewStage = Math.max(state.viewStage, 6);
    }
    if (b.phase === 'fall') {
      const rest = ch.rest;
      const n = Math.max(1, Math.ceil(dt / 0.002));
      for (let i = 0; i < n && b.phase === 'fall'; i++) {
        const h = dt / n;
        b.vy -= g * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        const prog = THREE.MathUtils.clamp((b.y0 - b.y) / (b.y0 - rest.y), 0, 1);
        b.x += (rest.x - b.x) * Math.min(1, h * 10) * prog;
        if (b.y <= rest.y && b.vy < 0) {
          b.y = rest.y;
          if (!b.bounced && Math.abs(b.vy) > 0.6) {
            b.vy = -b.vy * 0.2;
            b.vx *= 0.2;
            b.bounced = true;
            sound.clang(1);
          } else {
            b.phase = 'rest';
            b.x = rest.x;
          }
        }
      }
      ch.ball.position.set(b.x, b.y, 0);
      ch.ball.rotation.z -= b.vx * dt * 30;
    }
  }
}

// 当前步骤对应部件发光
const glow = new THREE.Color(0xff6a2a);
function setGlow(mat, on, t) {
  if (!mat) return;
  if (on) {
    mat.emissive.copy(glow);
    mat.emissiveIntensity = 0.35 + 0.3 * Math.sin(t * 8);
  } else mat.emissiveIntensity = 0;
}
function updateHighlights(stage, t) {
  const k = sim.triggered;
  setGlow(inst.pendMat, stage === 3 || stage === 4, t);
  setGlow(inst.lockMat, stage === 7 && sim.lock < 1, t);
  for (const ch of inst.channels) {
    const active = ch.k === k;
    setGlow(ch.sliderMat, active && (stage === 4 || stage === 5), t);
    setGlow(ch.rodMat, active && stage === 5, t);
    setGlow(ch.tailMat, active && stage === 5, t);
  }
}

function updateSteps(stage) {
  $$('#steps li').forEach((li, i) => {
    const n = i + 1;
    li.classList.toggle('done', n < stage || (sim.finished && n <= stage));
    li.classList.toggle('active', n === stage && !sim.finished);
  });
}

/* ------------------------------------------------------------------ */
/* 界面                                                                */
/* ------------------------------------------------------------------ */
function buildCompass() {
  const svg = $('#compass');
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  };
  el('circle', { r: 92, fill: 'rgba(0,0,0,.35)', stroke: 'rgba(217,168,88,.45)', 'stroke-width': 1.5 });
  el('circle', { r: 62, fill: 'none', stroke: 'rgba(217,168,88,.2)' });
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = Math.sin(a), y = -Math.cos(a);
    el('line', { x1: x * 30, y1: y * 30, x2: x * 62, y2: y * 62, stroke: 'rgba(217,168,88,.35)', 'stroke-width': 1 });
    const t = el('text', { x: x * 77, y: y * 77 + 5, 'text-anchor': 'middle', fill: 'rgba(233,220,192,.8)', 'font-size': k % 2 ? 11 : 15, 'font-family': 'serif' });
    t.textContent = DIR_NAMES[k];
  }
  // 中心小地动仪
  el('circle', { r: 18, fill: '#3a2c1c', stroke: '#d9a858', 'stroke-width': 1.5 });
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    el('circle', { cx: Math.sin(a) * 22, cy: -Math.cos(a) * 22, r: 3, fill: '#d9a858' });
  }
  const arrow = el('g', {});
  el('line', { x1: 0, y1: -26, x2: 0, y2: -58, stroke: '#e2553d', 'stroke-width': 3, 'stroke-dasharray': '4 3' }, arrow);
  el('circle', { cx: 0, cy: -64, r: 7, fill: '#e2553d' }, arrow);
  el('circle', { cx: 0, cy: -64, r: 12, fill: 'none', stroke: '#e2553d', 'stroke-width': 1.5, opacity: 0.6 }, arrow);
  const draw = () => {
    arrow.setAttribute('transform', `rotate(${THREE.MathUtils.radToDeg(state.epiAz)})`);
    const deg = Math.round(THREE.MathUtils.radToDeg(state.epiAz) + 360) % 360;
    $('#epiText').textContent = `${DIR_NAMES[nearestDir(state.epiAz)]} · ${deg}°`;
  };
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += Math.PI * 2;
    const snap = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(a - snap) < THREE.MathUtils.degToRad(7)) a = snap % (Math.PI * 2);
    setEpi(a);
  };
  let drag = false;
  svg.addEventListener('pointerdown', (e) => { drag = true; svg.setPointerCapture(e.pointerId); pick(e); });
  svg.addEventListener('pointermove', (e) => drag && pick(e));
  svg.addEventListener('pointerup', () => { drag = false; });
  draw();
  return draw;
}
let drawCompass;
function setEpi(a) {
  state.epiAz = a;
  drawCompass();
  if (!sim.running) {
    sim.epiAz = a;
    waves.setEpicenter(a, 30);
  }
}

function bindUI() {
  drawCompass = buildCompass();
  $$('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-cam]').forEach((b) => b.addEventListener('click', () => camPreset(b.dataset.cam)));
  $('#quake').addEventListener('click', startQuake);
  $('#reset').addEventListener('click', () => { resetQuake(); });
  $('#preset138').addEventListener('click', () => { setEpi(THREE.MathUtils.degToRad(280)); setIntensity(1.1); startQuake(); });
  $('#presetRandom').addEventListener('click', () => setEpi(Math.random() * Math.PI * 2));
  const setIntensity = (v) => {
    state.intensity = v;
    $('#intensity').value = v;
    $('#intVal').textContent = Number(v).toFixed(2);
  };
  $('#intensity').addEventListener('input', (e) => setIntensity(parseFloat(e.target.value)));
  $('#timescale').addEventListener('input', (e) => {
    state.timeScale = parseFloat(e.target.value);
    $('#tsVal').textContent = `×${state.timeScale.toFixed(2)}`;
  });
  $('#optLabels').addEventListener('change', (e) => { state.labels = e.target.checked; updateLabelVisibility(); });
  $('#optDims').addEventListener('change', (e) => { state.dims = e.target.checked; dimGroup.visible = state.dims; });
  $('#optWaves').addEventListener('change', (e) => {
    state.waves = e.target.checked;
    waves.mat.uniforms.uOn.value = state.waves ? 1 : 0;
    waves.marker.visible = state.waves && sim.started;
  });
  $('#optFollow').addEventListener('change', (e) => { state.follow = e.target.checked; });
  $('#optSound').addEventListener('change', (e) => { sound.enabled = e.target.checked; if (!sound.enabled) sound.setRumble(0); });
  $('#optRotate').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
  $$('.collapse').forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.target).classList.toggle('collapsed')));
  if (window.innerWidth < 1100) { $('#right').classList.add('collapsed'); }
  if (window.innerWidth < 760) { $('#left').classList.add('collapsed'); }

  const modal = $('#modal');
  $('#openInfo').addEventListener('click', (e) => { e.preventDefault(); modal.classList.remove('hidden'); });
  $('#closeInfo').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('on', t.id === b.dataset.tab));
  }));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); startQuake(); }
    if (e.key === 'r' || e.key === 'R') resetQuake();
    const modes = ['appearance', 'cut', 'xray', 'explode'];
    if (['1', '2', '3', '4'].includes(e.key)) setMode(modes[Number(e.key) - 1]);
    if (e.key === 'Escape') modal.classList.add('hidden');
  });
  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let chartAcc = 0;
let elapsed = 0;
function loop() {
  requestAnimationFrame(loop);
  frame(Math.min(clock.getDelta(), 0.05));
}

function frame(dt) {
  elapsed += dt;
  const time = elapsed;
  const sdt = dt * state.timeScale;

  if (sim.running) {
    sim.step(sdt);
    for (const ev of sim.events.splice(0)) {
      if (ev.type === 'trigger') onTrigger(ev.k);
      if (ev.type === 'end') showResult();
    }
    sound.setRumble(Math.min(1, sim.accel / 40) * Math.min(1, state.timeScale * 2.5));
  }
  applySim();
  updateBalls(sdt);
  if (sim.started && !state.resultShown && sim.triggered >= 0) {
    const ch = inst.channels[sim.triggered];
    if (ch.ballState.phase === 'rest' && sim.lock >= 1) showResult();
  }

  // 分解
  state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 3.5);
  const ex = state.explode;
  inst.lid.position.y = 0.95 * ex;
  inst.suspension.position.y = 0.5 * ex;
  for (const ch of inst.channels) {
    ch.dragon.position.x = 0.22 * ex;
    ch.toad.position.x = ch.toadHome.x + 0.38 * ex;
    if (ch.ballState.phase !== 'held') ch.ball.position.x = ch.ballState.x + 0.38 * ex;
  }

  updateCamTween(dt);
  controls.update();
  updateClip();
  // 标注挂在与视线斜交的通道上，避免沿视线堆叠
  attachChannelLabels(sim.triggered >= 0 ? sim.triggered : nearestDir(camAzimuth() + 0.8));
  if (dimGroup.visible) dimGroup.rotation.y = camAzimuth() - Math.PI;

  const stage = Math.max(sim.stage, sim.started ? state.viewStage : 0);
  const effStage = sim.lock > 0.05 ? 7 : stage;
  updateSteps(effStage);
  updateHighlights(effStage, time);
  waves.update(sim.started ? sim.t : -1, time);

  chartAcc += dt;
  if (chartAcc > 1 / 30) {
    chartAcc = 0;
    drawTopView($('#topview'), sim);
    drawTrace($('#trace'), sim);
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
(async function main() {
  try {
    await build();
    bindUI();
    setMode('appearance');
    applySim();
    setLoad('铸造完成');
    $('#loading').classList.add('done');
    const enter = $('#enter');
    enter.disabled = false;
    enter.addEventListener('click', () => {
      sound.ensure();
      $('#intro').classList.add('gone');
    });
    loop();
    window.__app = { THREE, scene, camera, controls, inst, sim, state, setMode, startQuake, resetQuake, flyTo, renderer, frame };
  } catch (err) {
    console.error(err);
    setLoad('加载失败：' + err.message);
  }
})();
