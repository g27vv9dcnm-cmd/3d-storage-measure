// Mini ARKit geometry: phone orientation → where the screen centre points, and the room corners that follow.
// Pure functions, no DOM. Units: cm and degrees in, cm out.
//
// World frame (as the W3C deviceorientation frame): x east-ish, y north-ish, z up. On iPhone alpha is relative to
// where the page started, which is fine: only the angles between taps matter.
// Room frame (as the app's js/roomshape.js outline): x to the right, z toward the front (= −y), corners clockwise
// seen from above (signed area > 0 in x/z), wall k runs from corner k to corner k + 1.

const RAD = Math.PI / 180;

// The back camera's direction for alpha/beta/gamma (R = Rz(α)·Rx(β)·Ry(γ); the camera looks along the device's −z).
export function lookDir(alpha, beta, gamma) {
  const a = (alpha || 0) * RAD, b = (beta || 0) * RAD, g = (gamma || 0) * RAD;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return { x: -ca * sg - sa * sb * cg, y: -sa * sg + ca * sb * cg, z: -cb * cg };
}

// Up (+) or down (−) from level, in degrees.
export function elevation(f) {
  return Math.atan2(f.z, Math.hypot(f.x, f.y)) / RAD;
}

const MIN_TILT = 0.03; // about 2°: closer to level than this, the floor or ceiling point is too far to trust

// Where the look line meets the floor, the eye being `eye` cm above it. null when not looking down enough.
export function floorPoint(f, eye) {
  if (!(eye > 0) || f.z > -MIN_TILT) return null;
  const t = eye / -f.z;
  return { x: t * f.x, y: t * f.y };
}

// Where the look line meets a flat ceiling `ceiling` cm above the floor. null when not looking up enough.
export function ceilingPoint(f, eye, ceiling) {
  if (!(eye > 0) || !(ceiling > eye) || f.z < MIN_TILT) return null;
  const t = (ceiling - eye) / f.z;
  return { x: t * f.x, y: t * f.y };
}

// The ceiling height above a floor corner `dist` cm away (horizontally), looking up at the ceiling corner over it.
export function ceilingHeight(f, eye, dist) {
  const r = Math.hypot(f.x, f.y);
  if (!(dist > 0) || f.z < MIN_TILT || r < 1e-6) return null;
  return eye + dist * (f.z / r);
}

// ------------------------------------------------------------------------------------------- shape tidy

const norm180 = (deg) => ((deg % 180) + 180) % 180;
// Smallest difference of two directions that ignore which way a wall runs (0…90).
const lineDiff = (a, b) => { const d = Math.abs(norm180(a) - norm180(b)); return Math.min(d, 180 - d); };

export function signedArea(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

// World points (x, y) → room points (x, z), clockwise as the app wants (copies).
export function toRoom(points) {
  const list = points.map((p) => ({ x: p.x, z: -p.y }));
  return signedArea(list) < 0 ? list.reverse() : list;
}

export function wallsOf(pts) {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return { i, a, b, length: Math.hypot(b.x - a.x, b.z - a.z), angle: Math.atan2(b.z - a.z, b.x - a.x) / RAD };
  });
}

// The inside angle at each corner (90 in a rectangle, 270 at the notch of an L) for clockwise room points.
export function cornerAngles(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const a1 = Math.atan2(prev.z - p.z, prev.x - p.x), a2 = Math.atan2(next.z - p.z, next.x - p.x);
    let d = (a1 - a2) / RAD;
    d = ((d % 360) + 360) % 360;
    return d;
  });
}

function rotate(p, deg) {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}

function intersect(p, a1, q, a2) {
  const d1 = { x: Math.cos(a1 * RAD), z: Math.sin(a1 * RAD) }, d2 = { x: Math.cos(a2 * RAD), z: Math.sin(a2 * RAD) };
  const den = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(den) < 0.05) return null; // nearly parallel
  const t = ((q.x - p.x) * d2.z - (q.z - p.z) * d2.x) / den;
  return { x: p.x + t * d1.x, z: p.z + t * d1.z };
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function selfCrossing(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

export const TIDY = Object.freeze({ tol: 7, wallMin: 30 });

// Tidy clockwise room points: turn the room so its longest wall is straight, then walls within `tol` of straight
// (0°/90°) become straight, walls within `tol` of each other become parallel, and a four-sided room whose two
// slanted sides mirror each other becomes symmetric. Walls whose index is in `locked` keep their measured direction.
// Returns { points, turned, notes } — points centred on the room's middle; the measured points if tidying fails.
export function tidyShape(raw, { tol = TIDY.tol, locked = [] } = {}) {
  const n = raw.length;
  if (n < 3) return { points: raw.map((p) => ({ ...p })), turned: 0, notes: [] };
  const lockedSet = new Set(locked);
  const walls0 = wallsOf(raw);
  const longest = walls0.reduce((m, w) => (w.length > m.length ? w : m), walls0[0]);
  const m90 = ((longest.angle % 90) + 90) % 90;
  const turn = m90 > 45 ? 90 - m90 : -m90;
  const pts = raw.map((p) => rotate(p, turn));
  const walls = wallsOf(pts);
  const angle = walls.map((w) => w.angle);
  const notes = [];

  // 1. straight walls
  const straight = new Set();
  walls.forEach((w, i) => {
    if (lockedSet.has(i)) return;
    for (const target of [0, 90]) {
      if (lineDiff(w.angle, target) <= tol) {
        // keep the wall's running direction, only correct its slant
        const base = Math.round(w.angle / 90) * 90;
        angle[i] = base; straight.add(i); return;
      }
    }
  });
  // 2. parallel slanted walls: average each group
  const free = walls.map((w, i) => i).filter((i) => !lockedSet.has(i) && !straight.has(i));
  const done = new Set();
  for (const i of free) {
    if (done.has(i)) continue;
    const group = free.filter((j) => !done.has(j) && lineDiff(angle[i], angle[j]) <= tol);
    if (group.length < 2) continue;
    const ref = norm180(angle[i]);
    let sum = 0;
    for (const j of group) { let a = norm180(angle[j]); if (a - ref > 90) a -= 180; if (ref - a > 90) a += 180; sum += a; }
    const mean = sum / group.length;
    for (const j of group) {
      angle[j] = Math.cos((angle[j] - mean) * RAD) < 0 ? mean + 180 : mean; // keep the wall's running direction
      done.add(j);
    }
    notes.push('parallel');
  }
  // 3. symmetric four-sided room (等脚台形): sides 1,3 mirror across the normal of parallel sides 0,2 (or 0,2 across 1,3)
  if (n === 4) {
    for (const [p, q, s1, s2] of [[0, 2, 1, 3], [1, 3, 0, 2]]) {
      if (lineDiff(angle[p], angle[q]) > 1e-6 || lineDiff(angle[s1], angle[s2]) <= tol) continue;
      if (lockedSet.has(s1) || lockedSet.has(s2)) continue;
      const base = angle[p];
      const d1 = norm180(angle[s1] - base), d2 = norm180(angle[s2] - base);
      if (Math.abs(d1 - (180 - d2)) > tol) continue;
      const m = (d1 + (180 - d2)) / 2;
      const set = (i, d) => { const cand = base + d; angle[i] = Math.cos((cand - angle[i]) * RAD) < 0 ? cand + 180 : cand; };
      set(s1, m); set(s2, 180 - m);
      notes.push('symmetric');
      break;
    }
  }
  if (straight.size) notes.push('straight');

  // Rebuild corners: each wall keeps its middle and takes its new direction; corner k = wall k−1 × wall k.
  const mids = walls.map((w) => ({ x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 }));
  const out = pts.map((p, k) => {
    const prev = (k - 1 + n) % n;
    return intersect(mids[prev], angle[prev], mids[k], angle[k]) || { ...p };
  });
  const bad = selfCrossing(out) || wallsOf(out).some((w) => w.length < TIDY.wallMin) || signedArea(out) <= 0;
  const final = bad ? pts : out;
  return { points: centre(final), turned: turn, notes: bad ? ['failed'] : notes };
}

export function centre(pts) {
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return pts.map((p) => ({ x: p.x - cx, z: p.z - cz }));
}

// The app's outline: corners { id, x, z } in whole cm.
export function toOutline(pts) {
  const ids = 'abcdefghijkl';
  return pts.map((p, i) => ({ id: ids[i] || 'c' + i, x: Math.round(p.x) + 0, z: Math.round(p.z) + 0 }));
}
