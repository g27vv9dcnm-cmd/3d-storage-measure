import test from 'node:test';
import assert from 'node:assert/strict';
import { lookDir, floorPoint, ceilingPoint, ceilingHeight, toRoom, tidyShape, cornerAngles, wallsOf, signedArea, toOutline } from '../js/geom.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const DEG = Math.PI / 180;

// The look direction that points at world point (x, y, z) from the eye: build alpha/beta for an upright phone.
function aimAt(x, y, z, eye) {
  const heading = Math.atan2(x, y) / DEG;               // from north (+y) toward east (+x)
  const elev = Math.atan2(z - eye, Math.hypot(x, y)) / DEG;
  return { alpha: -heading, beta: 90 + elev, gamma: 0 };
}
const dirTo = (x, y, z, eye) => { const o = aimAt(x, y, z, eye); return lookDir(o.alpha, o.beta, o.gamma); };

test('upright phone looks level and north; flat phone looks down', () => {
  const f = lookDir(0, 90, 0); near(f.x, 0); near(f.y, 1); near(f.z, 0);
  const d = lookDir(0, 0, 0); near(d.z, -1);
});

test('floor point recovers the aimed corner', () => {
  for (const [x, y] of [[200, 150], [-180, 220], [-150, -260], [300, -100]]) {
    const p = floorPoint(dirTo(x, y, 0, 120), 120);
    near(p.x, x, 1e-6); near(p.y, y, 1e-6);
  }
  assert.equal(floorPoint(lookDir(0, 90, 0), 120), null);
});

test('ceiling point and ceiling height', () => {
  const f = dirTo(150, 200, 240, 120);
  const p = ceilingPoint(f, 120, 240); near(p.x, 150); near(p.y, 200);
  near(ceilingHeight(f, 120, Math.hypot(150, 200)), 240);
  assert.equal(ceilingPoint(f, 120, 100), null);
});

test('toRoom is clockwise for the app (signed area > 0)', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.ok(signedArea(toRoom(sq)) > 0);
  assert.ok(signedArea(toRoom([...sq].reverse())) > 0);
});

const jitter = (pts, e) => pts.map((p, i) => ({ x: p.x + e * Math.sin(i * 7.1), y: p.y + e * Math.cos(i * 3.3) }));
const rot = (pts, deg) => pts.map((p) => ({ x: p.x * Math.cos(deg * DEG) - p.y * Math.sin(deg * DEG), y: p.x * Math.sin(deg * DEG) + p.y * Math.cos(deg * DEG) }));

test('a slightly crooked, turned rectangle becomes a rectangle', () => {
  const rect = [{ x: -200, y: -150 }, { x: 200, y: -150 }, { x: 200, y: 150 }, { x: -200, y: 150 }];
  const { points, notes } = tidyShape(toRoom(jitter(rot(rect, 23), 8)));
  assert.ok(!notes.includes('failed'));
  for (const a of cornerAngles(points)) near(a, 90, 1e-6);
});

test('an isosceles trapezoid stays a symmetric trapezoid', () => {
  // long side 400, short side 240, depth 300 → legs at about 75°/105°
  const trap = [{ x: -200, y: 0 }, { x: 200, y: 0 }, { x: 120, y: 300 }, { x: -120, y: 300 }];
  const { points, notes } = tidyShape(toRoom(jitter(rot(trap, -12), 6)));
  assert.ok(!notes.includes('failed'));
  const a = cornerAngles(points).map((v) => Math.round(v * 1000) / 1000);
  // two equal angles and two equal angles, summing to 180 pairwise; none forced to 90
  const sorted = [...a].sort((p, q) => p - q);
  near(sorted[0], sorted[1], 1e-6); near(sorted[2], sorted[3], 1e-6); near(sorted[0] + sorted[2], 180, 1e-6);
  assert.ok(Math.abs(sorted[0] - 90) > 10);
  const w = wallsOf(points).map((x) => x.length).sort((p, q) => p - q);
  near(w[1], w[2], 1e-6); // the two legs (between the short and long side) are the same length
});

test('an L-shaped room keeps six right angles (one of them 270°)', () => {
  const L = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 350 }, { x: 0, y: 350 }];
  const { points } = tidyShape(toRoom(jitter(rot(L, 40), 7)));
  const a = cornerAngles(points).map((v) => Math.round(v));
  assert.deepEqual([...a].sort((p, q) => p - q), [90, 90, 90, 90, 90, 270]);
});

test('a locked wall keeps its measured direction', () => {
  const rect = [{ x: -200, y: -150 }, { x: 200, y: -150 }, { x: 200, y: 150 }, { x: -200, y: 150 }];
  const room = toRoom(jitter(rect, 10));
  const free = tidyShape(room).points, kept = tidyShape(room, { locked: [1] }).points;
  assert.notDeepEqual(cornerAngles(free).map(Math.round), cornerAngles(kept).map(Math.round));
});

test('toOutline gives ids and whole cm', () => {
  const o = toOutline([{ x: 1.4, z: -0.2 }, { x: 100.6, z: 0 }, { x: 50, z: 80.5 }]);
  assert.deepEqual(o.map((p) => p.id), ['a', 'b', 'c']);
  assert.ok(o.every((p) => Number.isInteger(p.x) && Number.isInteger(p.z)));
  assert.ok(!Object.is(o[0].z, -0));
});
