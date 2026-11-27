// Mini ARKit screen: settings → aim at corners and tap → tidy plan → copy.
import { lookDir, elevation, floorPoint, ceilingPoint, ceilingHeight, toRoom, tidyShape, cornerAngles, wallsOf, toOutline } from './geom.js';

const $ = (id) => document.getElementById(id);
const MAX_CORNERS = 12;

const state = {
  eye: 120,          // phone height above the floor, cm
  ceiling: null,     // ceiling height, cm (typed or measured)
  corners: [],       // { x, y, kind: 'floor' | 'ceiling' } in world cm, in tapping order
  recent: [],        // last look directions, averaged on a tap to calm the hand shake
  look: null,
  tidy: true,
  locked: new Set(), // wall indexes (of the result) that keep their measured direction
  sensors: false,
};

function show(view) {
  for (const id of ['setup', 'measure', 'result']) $(id).hidden = id !== view;
}

function readNumber(input) {
  const v = Number(String(input.value).trim());
  return input.value.trim() && Number.isFinite(v) && v > 0 ? v : null;
}

// ------------------------------------------------------------------------------------------- sensors

function onOrient(e) {
  if (e.alpha === null && e.beta === null) return;
  const f = lookDir(e.alpha, e.beta, e.gamma);
  state.look = f;
  state.recent.push(f);
  if (state.recent.length > 8) state.recent.shift();
  if (!state.sensors) { state.sensors = true; $('sensorNote').hidden = true; }
  updateReadout();
}

function steadyLook() {
  const list = state.recent.length ? state.recent : state.look ? [state.look] : [];
  if (!list.length) return null;
  const s = list.reduce((a, f) => ({ x: a.x + f.x, y: a.y + f.y, z: a.z + f.z }), { x: 0, y: 0, z: 0 });
  const len = Math.hypot(s.x, s.y, s.z) || 1;
  return { x: s.x / len, y: s.y / len, z: s.z / len };
}

async function startSensors() {
  const notes = [];
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') notes.push('向きと傾きのセンサーが許可されませんでした。');
    }
    window.addEventListener('deviceorientation', onOrient);
  } catch (e) { notes.push('向きと傾きのセンサーが使えません。'); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const v = $('video'); v.srcObject = stream; v.hidden = false;
    try { await v.play(); } catch (e) { /* muted autoplay */ }
  } catch (e) { notes.push('カメラが使えません（十字だけで測れます）。'); }
  if (state.sensors) notes.splice(0, notes.length, ...notes.filter((t) => !t.startsWith('向き')));
  $('sensorNote').textContent = notes.join(' ') || 'センサーを待っています。スマホを少し動かしてください。';
  $('sensorNote').hidden = state.sensors && !notes.length;
}

// ------------------------------------------------------------------------------------------- measuring

function cm(v) { return v >= 100 ? (v / 100).toFixed(2) + ' m' : Math.round(v) + ' cm'; }

function updateReadout() {
  const f = state.look;
  if (!f) return;
  const el = elevation(f);
  const fp = floorPoint(f, state.eye);
  const cp = state.ceiling ? ceilingPoint(f, state.eye, state.ceiling) : null;
  let text;
  if (fp) text = `床まで ${cm(Math.hypot(fp.x, fp.y))}（下向き ${Math.round(-el)}°）`;
  else if (cp) text = `天井の角まで ${cm(Math.hypot(cp.x, cp.y))}（上向き ${Math.round(el)}°）`;
  else text = el > 0 ? `上向き ${Math.round(el)}°` : `もっと下に向けてください（${Math.round(el)}°）`;
  $('readout').textContent = text;
  $('addFloor').disabled = !fp || state.corners.length >= MAX_CORNERS;
  $('addCeil').disabled = !cp || state.corners.length >= MAX_CORNERS;
  $('measureCeil').disabled = !lastFloor() || !(el > 2);
  drawMini();
}

function lastFloor() {
  for (let i = state.corners.length - 1; i >= 0; i--) if (state.corners[i].kind === 'floor') return state.corners[i];
  return null;
}

function addCorner(kind) {
  const f = steadyLook();
  if (!f) return;
  const p = kind === 'floor' ? floorPoint(f, state.eye) : ceilingPoint(f, state.eye, state.ceiling);
  if (!p) return;
  state.corners.push({ x: p.x, y: p.y, kind });
  buzz();
  updateCounts();
}

function measureCeiling() {
  const f = steadyLook(), c = lastFloor();
  if (!f || !c) return;
  const h = ceilingHeight(f, state.eye, Math.hypot(c.x, c.y));
  if (!h || h <= state.eye || h > 600) { $('ceilNote').textContent = 'うまく測れませんでした。直前の床の角の真上を狙ってください。'; return; }
  state.ceiling = Math.round(h);
  $('ceilingIn').value = String(state.ceiling);
  $('ceilNote').textContent = `天井の高さ：約 ${state.ceiling} cm`;
  buzz();
  updateReadout();
}

function buzz() { try { navigator.vibrate?.(30); } catch (e) { /* not on iPhone */ } }

function updateCounts() {
  const n = state.corners.length;
  $('count').textContent = `角 ${n} / ${MAX_CORNERS}`;
  $('undo').disabled = n === 0;
  $('finish').disabled = n < 3;
  updateReadout();
  drawMini();
}

// Small live plan: you in the middle, the corners so far, and where the crosshair points.
function drawMini() {
  const cv = $('mini'); const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const pts = state.corners.map((c) => ({ x: c.x, y: c.y }));
  let aim = null;
  if (state.look) aim = floorPoint(state.look, state.eye) || (state.ceiling && ceilingPoint(state.look, state.eye, state.ceiling));
  const all = [...pts, { x: 0, y: 0 }, ...(aim ? [aim] : [])];
  const r = Math.max(150, ...all.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const s = (Math.min(W, H) / 2 - 12) / r;
  const X = (p) => W / 2 + p.x * s, Y = (p) => H / 2 - p.y * s;
  const css = getComputedStyle(document.documentElement);
  ctx.lineWidth = 2;
  ctx.strokeStyle = css.getPropertyValue('--accent');
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
  ctx.stroke();
  ctx.fillStyle = css.getPropertyValue('--accent');
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(X(p), Y(p), 4, 0, 7); ctx.fill(); });
  ctx.fillStyle = css.getPropertyValue('--fg');
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 5, 0, 7); ctx.fill();
  if (aim) {
    ctx.strokeStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(X(aim), Y(aim), 6, 0, 7); ctx.stroke();
  }
}

// ------------------------------------------------------------------------------------------- result

function result() {
  const raw = toRoom(state.corners);
  if (!state.tidy) {
    const t = tidyShape(raw, { tol: 0 }); // same turn and centre, no tidying
    return { raw: t.points, shown: t.points, notes: [] };
  }
  const plain = tidyShape(raw, { tol: 0 });
  const t = tidyShape(raw, { locked: [...state.locked] });
  return { raw: plain.points, shown: t.points, notes: t.notes };
}

let lastResult = null;

function drawResult() {
  const r = lastResult = result();
  const cv = $('plan'); const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.clientWidth || 320;
  cv.width = cssW * dpr; cv.height = cssW * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssW;
  ctx.clearRect(0, 0, W, H);
  const all = [...r.raw, ...r.shown];
  const ext = Math.max(100, ...all.map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))));
  const s = (W / 2 - 40) / ext;
  const X = (p) => W / 2 + p.x * s, Y = (p) => H / 2 + p.z * s;
  r.view = { X, Y, s };
  const css = getComputedStyle(document.documentElement);
  const color = (n) => css.getPropertyValue(n).trim();

  const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.closePath(); };
  if (state.tidy) {
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = color('--muted');
    path(r.raw); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = color('--fill');
  path(r.shown); ctx.fill();
  const walls = wallsOf(r.shown);
  ctx.lineWidth = 3;
  walls.forEach((w) => {
    ctx.strokeStyle = state.locked.has(w.i) ? color('--warn') : color('--accent');
    ctx.setLineDash(state.locked.has(w.i) ? [8, 5] : []);
    ctx.beginPath(); ctx.moveTo(X(w.a), Y(w.a)); ctx.lineTo(X(w.b), Y(w.b)); ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // wall lengths (about), outside the room
  walls.forEach((w) => {
    const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
    const nx = -(w.b.z - w.a.z) / w.length, nz = (w.b.x - w.a.x) / w.length; // points into the room
    ctx.fillStyle = color('--fg');
    ctx.fillText('約' + cm(w.length), X({ x: mx, z: mz }) - nx * 16, Y({ x: mx, z: mz }) - nz * 16);
  });
  // corner angles, inside the room
  const angles = cornerAngles(r.shown);
  r.shown.forEach((p, i) => {
    const prev = r.shown[(i - 1 + r.shown.length) % r.shown.length], next = r.shown[(i + 1) % r.shown.length];
    const bx = (prev.x + next.x) / 2 - p.x, bz = (prev.z + next.z) / 2 - p.z; const bl = Math.hypot(bx, bz) || 1;
    const inward = angles[i] > 180 ? -1 : 1;
    ctx.fillStyle = color('--accent');
    ctx.fillText(Math.round(angles[i]) + '°', X(p) + inward * bx / bl * 22, Y(p) + inward * bz / bl * 22);
  });

  const notes = [];
  if (r.notes.includes('failed')) notes.push('形をそろえるとおかしな形になるので、測ったままの形にしています。');
  if (r.notes.includes('straight')) notes.push('ほぼまっすぐの壁をそろえました。');
  if (r.notes.includes('parallel')) notes.push('ほぼ平行の壁を平行にしました。');
  if (r.notes.includes('symmetric')) notes.push('左右対称の台形にしました。');
  if (state.locked.size) notes.push('赤い点線の壁は、そろえずに測ったままの向きです。');
  $('tidyNote').textContent = notes.join(' ') || (state.tidy ? 'そろえる所はありませんでした。' : '測ったままの形です（点線なし）。');

  const data = { app: '3D storage', kind: 'room-shape', outline: toOutline(r.shown), height: state.ceiling || null, eye: state.eye };
  $('json').value = JSON.stringify(data);
}

function pickWall(ev) {
  const r = lastResult; if (!r || !r.view || !state.tidy) return;
  const rect = $('plan').getBoundingClientRect();
  const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
  let best = null;
  wallsOf(r.shown).forEach((w) => {
    const ax = r.view.X(w.a), ay = r.view.Y(w.a), bx = r.view.X(w.b), by = r.view.Y(w.b);
    const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
    const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (d < 24 && (!best || d < best.d)) best = { d, i: w.i };
  });
  if (!best) return;
  if (state.locked.has(best.i)) state.locked.delete(best.i); else state.locked.add(best.i);
  drawResult();
}

// ------------------------------------------------------------------------------------------- wiring

$('start').addEventListener('click', () => {
  state.eye = readNumber($('eyeIn')) || 120;
  state.ceiling = readNumber($('ceilingIn'));
  if (state.ceiling && state.ceiling <= state.eye) state.ceiling = null;
  $('ceilNote').textContent = state.ceiling ? `天井の高さ：${state.ceiling} cm` : '天井の高さはまだです。';
  show('measure');
  startSensors(); // the motion permission must be asked straight from this tap
  updateCounts();
});
$('addFloor').addEventListener('click', () => addCorner('floor'));
$('addCeil').addEventListener('click', () => addCorner('ceiling'));
$('measureCeil').addEventListener('click', measureCeiling);
$('undo').addEventListener('click', () => { state.corners.pop(); updateCounts(); });
$('finish').addEventListener('click', () => { state.locked.clear(); show('result'); drawResult(); });
$('back').addEventListener('click', () => { show('measure'); updateCounts(); });
$('restart').addEventListener('click', () => { state.corners = []; state.locked.clear(); show('measure'); updateCounts(); });
$('tidyIn').addEventListener('change', () => { state.tidy = $('tidyIn').checked; drawResult(); });
$('heightOut').addEventListener('change', () => { state.ceiling = readNumber($('heightOut')); drawResult(); });
$('plan').addEventListener('click', pickWall);
$('copy').addEventListener('click', () => {
  const text = $('json').value;
  navigator.clipboard.writeText(text).then(
    () => { $('copy').textContent = 'コピーしました'; setTimeout(() => { $('copy').textContent = '結果をコピー'; }, 2000); },
    () => { $('json').select(); $('copy').textContent = '下の文字を長押ししてコピーしてください'; },
  );
});
new MutationObserver(() => { if (!$('result').hidden) $('heightOut').value = state.ceiling ? String(state.ceiling) : ''; })
  .observe($('result'), { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('resize', () => { if (!$('result').hidden) drawResult(); });

// For checking on a computer without sensors: ?demo exposes the state so a test can feed orientation events.
if (new URLSearchParams(location.search).has('demo')) {
  window.miniArkit = { state, onOrient, drawResult, show };
}
