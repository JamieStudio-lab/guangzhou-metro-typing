/* geom.js — GEOM: small pure helpers shared by world.js, train.js, traffic.js and labels.js.
   FROZEN during the Build phase (owner: architect): never edit it from a module; copy a helper locally if you
   need a variant. No state, no PX calls. Global GEOM.
   GEOM.hash(x, y, s)        deterministic integer hash → [0,1) (seed world-px or feature ids, so bakes join seamlessly)
   GEOM.bbox(pts)            [minX, minY, maxX, maxY] of [[x,y],…]
   GEOM.simplify(P, tol)     Douglas–Peucker on [x,y,…] points (extra fields kept)
   GEOM.snap(P, w)           snap a stroke's vertices so a band of width w sits on whole pixels (odd w: pixel centres)
   GEOM.lowerIdx(arr, v, get) first index whose get(arr[i]) ≥ v (binary search)
   GEOM.view(o)              THE view object every map module draws with (SPEC.md "v2 architecture" §3) — the one
                             implementation of the projection, so main.js and every test harness agree exactly. */
(function(){
const hash = (x, y, s = 0) => { let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const bbox = pts => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of pts){ if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
function simplify(P, tol){
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length), st = [[0, P.length - 1]]; keep[0] = keep[P.length - 1] = 1;
  while (st.length){
    const [a, b] = st.pop(), ax = P[a][0], ay = P[a][1], dx = P[b][0] - ax, dy = P[b][1] - ay, L = Math.hypot(dx, dy);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++){ const ex = P[i][0] - ax, ey = P[i][1] - ay, d = L < 1e-9 ? Math.hypot(ex, ey) : Math.abs(ex * dy - ey * dx) / L; if (d > md){ md = d; mi = i; } }
    if (md > tol){ keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
const snap = (P, w) => { const o = w & 1 ? .5 : 0, out = []; for (const p of P){ const x = (w & 1 ? Math.floor(p[0]) : Math.round(p[0])) + o, y = (w & 1 ? Math.floor(p[1]) : Math.round(p[1])) + o; const l = out[out.length - 1]; if (!l || l[0] !== x || l[1] !== y) out.push([x, y]); } return out; };
const lowerIdx = (arr, v, get) => { let lo = 0, hi = arr.length; while (lo < hi){ const mid = (lo + hi) >> 1; if (get(arr[mid]) < v) lo = mid + 1; else hi = mid; } return lo; };
/* o = {lvl, mpp = lvl, lvlTo = lvl, k = .4, cx, cy (focus, metres, y north), ax = W>>1, ay = H>>1 (screen art px where the
   focus appears), W, H, t, dt, theme, ui, mix, seq}. Level px: X = x/lvl, Y = (-y - h·k)/lvl. Screen: round((X - ox)·zs).
   zs = lvl/mpp (1 at rest). At rest ox/oy are integers (the camera moves in whole level px); while zooming they are floats. */
const view = o => {
  const lvl = o.lvl, zs0 = lvl / (o.mpp || lvl), rest = Math.abs(zs0 - 1) < 1e-9, zs = rest ? 1 : zs0, k = o.k == null ? .4 : o.k;
  const W = o.W, H = o.H, ax = o.ax == null ? W >> 1 : o.ax, ay = o.ay == null ? H >> 1 : o.ay, theme = o.theme || PX.theme;
  const ox = rest ? Math.round(o.cx / lvl) - ax : o.cx / lvl - ax / zs, oy = rest ? Math.round(-o.cy / lvl) - ay : -o.cy / lvl - ay / zs;
  const v = {lvl, mpp: lvl / zs, zs, rest, lvlTo: o.lvlTo || lvl, k, cx: o.cx, cy: o.cy, ox, oy, W, H, t: o.t || 0, dt: o.dt || 0,
    theme, night: theme === 'night', ui: o.ui || null, mix: o.mix || null, seq: o.seq || 0};
  v.sx = X => Math.round((X - ox) * zs); v.sy = Y => Math.round((Y - oy) * zs);         // level px → screen art px
  v.toLevel = (xm, ym, hm = 0) => ({X: xm / lvl, Y: (-ym - hm * k) / lvl});
  v.toScreen = (xm, ym, hm = 0) => ({x: v.sx(xm / lvl), y: v.sy((-ym - hm * k) / lvl)});
  v.toGround = (sx, sy) => ({x: (ox + (sx + .5) / zs) * lvl, y: -(oy + (sy + .5) / zs) * lvl});   // metres under a screen px (h = 0)
  v.onScreen = (sx, sy, r = 0) => sx >= -r && sy >= -r && sx < W + r && sy < H + r;
  return v;
};
window.GEOM = {hash, bbox, simplify, snap, lowerIdx, view};
})();
