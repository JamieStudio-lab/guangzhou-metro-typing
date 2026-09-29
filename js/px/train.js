/* train.js — TRAIN (v2): the ridden line's SMOOTHED track, its overlay and the train. Needs pixel.js, palette.js,
   sprites.js (SPR.platform), geom.js; optional WORLD.coveredAt (night glow stays off roofs). Global TRAIN.
   Line-agnostic: colours come from PX.lk(role) (the current line PX.lineId); the track is ridden in its point order.
   API (SPEC.md "v2 architecture" §6.1)
   TRAIN.init(d = PX.D)           resample d.track every 1 m on its arc length (scaled to d.trackLen, the parameter of
                                  d.stations[].d), Gaussian-smooth it (σ 14 m, shrinking at the termini — stations move < 1 m),
                                  store x, y, heading per metre → along() is O(1). Clears the per-level line rasters.
                                  d.trackClose (optional, a loop line's closing arc last → first station): smoothed the same way
                                  and drawn in the travelled style, never ridden.
   TRAIN.lineLength · TRAIN.stationS(i)
   TRAIN.along(s)                 → {x, y (metres, y north), angle (screen rad, y down, 0 = east)}; extrapolates past the termini.
   TRAIN.tier(lvl)                'street' ≤ 5 · 'district' ≤ 16 · 'city' (SPEC §2)
   TRAIN.span(lvl)                metres from the head car's centre to the tail car's centre as drawn at lvl (0 = roundel).
   TRAIN.drawLine(g, view, sTrain, next?)   the overlay: 3 px core + 1 px casing + night glow (1 px solid ring, off roofs), the
                                  TRAVELLED part (s < sTrain) dimmed, the hop ahead (→ station `next`, default the first with
                                  d > sTrain + .5) with a bright centre rail and a running light pulse, platforms (street tier).
                                  Rasterised per level from the smoothed curve (lazy 128-px chunks, cached), mapped through
                                  view.sx/sy — so it stays continuous at zs < 1 and every car centre lies on the band.
   TRAIN.draw(g, view, sTrain)    the train: street 6 cars · district one continuous 3-car body taken from the line raster (fixed to the
                                  map: no boiling) · city a roundel (+ locator ring when far from the next platform). Top view + 1 px south face, 64 headings from the chord over the car
                                  (smoothed tangent) with hysteresis. → [{x, y, angle}] screen art px per car, head first.
   TRAIN.head                     {X, Y, lvl, s}: where the last TRAIN.draw put the head (level px, its level, arc) — WORLD's look-ahead
   TRAIN.suspend() · TRAIN.resume()  pause / go on with the idle prebuild of line chunks and car sprites (a stopped ride)
   TRAIN.headPx(s, lvl)           → [X, Y] level px where the head is drawn (street: carPx with the car's hysteresis slot; district:
                                  the rounded curve point) — main.js keeps its screen px monotone while rounding the camera. Cars sit rigidly along the
                                  track's major axis and on the rail across it (carPx). */
(function(){
const TRAIN = {lineLength: 0};
const TAU = Math.PI * 2, NH = 64, R = 5;
const CARS = {street: 6, district: 3, city: 1}, PITCH = {street: 18, district: 10, city: 0};
let D = null, T = null, TC = null, hyst = [], xh = [];
const tier = TRAIN.tier = lvl => lvl <= 5 ? 'street' : lvl <= 16 ? 'district' : 'city';
const wrap = a => a - TAU * Math.round(a / TAU);

TRAIN.init = (d = PX.D) => {
  D = d; TRAIN.lineLength = d.trackLen; hyst = []; xh = []; TRAIN.head = null; pb = {s: -1e9, lvl: 0, ext: 0, gen: 0}; pbQ = []; pbCars = ''; SEEN.clear();
  T = curve(d.track, d.trackLen); TC = d.trackClose && d.trackClose.length > 1 ? curve(d.trackClose) : null;
  return TRAIN;
};
/* a smoothed curve {N, SX, SY, SA, len, lines (per-level rasters)}: P resampled every metre of its arc length scaled to len */
function curve(P, len){
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  if (len == null) len = cum[cum.length - 1];
  const k = len / cum[cum.length - 1], N = Math.floor(len) + 2;
  const rx = new Float64Array(N), ry = new Float64Array(N);
  for (let i = 0, j = 1; i < N; i++){                                   // raw track every metre of the (scaled) arc length
    const s = Math.min(i, len) / k; while (j < P.length - 1 && cum[j] < s) j++;
    const f = Math.max(0, Math.min(1, (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)));
    rx[i] = P[j - 1][0] + (P[j][0] - P[j - 1][0]) * f; ry[i] = P[j - 1][1] + (P[j][1] - P[j - 1][1]) * f;
  }
  const SIG = 14, HW = 42, wt = new Float64Array(HW + 1);                // Gaussian σ 14 m, ±3σ; symmetric window → ends fixed
  for (let q = 0; q <= HW; q++) wt[q] = Math.exp(-q * q / (2 * SIG * SIG));
  const SX = new Float64Array(N), SY = new Float64Array(N), SA = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const h = Math.min(HW, i, N - 1 - i); let ax = 0, ay = 0, aw = 0;
    for (let q = -h; q <= h; q++){ const w = wt[Math.abs(q)]; ax += rx[i + q] * w; ay += ry[i + q] * w; aw += w; }
    SX[i] = ax / aw; SY[i] = ay / aw;
  }
  for (let i = 0; i < N; i++){ const a = Math.max(0, i - 4), b = Math.min(N - 1, i + 4); SA[i] = Math.atan2(-(SY[b] - SY[a]), SX[b] - SX[a]); }
  return {N, SX, SY, SA, len, lines: new Map()};
}
TRAIN.stationS = i => D.stations[i].d;
const at = (C, s) => {
  const {N, SX, SY, SA} = C, last = N - 1;
  if (s <= 0 || s >= last){                                             // extrapolate along the end tangent
    const i = s <= 0 ? 0 : last, a = SA[i], e = s - i;
    return {x: SX[i] + Math.cos(a) * e, y: SY[i] - Math.sin(a) * e, angle: a};
  }
  const i = Math.floor(s), f = s - i;
  return {x: SX[i] + (SX[i + 1] - SX[i]) * f, y: SY[i] + (SY[i + 1] - SY[i]) * f, angle: SA[i] + wrap(SA[i + 1] - SA[i]) * f};
};
TRAIN.along = s => at(T, s);
TRAIN.span = lvl => { const t = tier(lvl); return (CARS[t] - 1) * PITCH[t] * lvl; };
const nextAfter = s => D.stations.findIndex(st => st.d > s + .5);
const lp = (s, lvl, C = T) => { const p = at(C, s); return [Math.round(p.x / lvl), Math.round(-p.y / lvl)]; };   // level px (rounded)
/* where a car centre is drawn (level px): along the track's MAJOR axis rigidly relative to the head (head's rounded coordinate
   + the rounded metre offset — so on a straight the cars keep exact gaps and move as one), across it ON the rail (the curve's
   minor coordinate at that whole major coordinate). Car k (TRAIN.draw) keeps its cross-track pixel until the curve is ≥ .75 px
   away from it (hysteresis): where the track runs half a pixel off a row / column boundary the rounding no longer flips the
   car sideways every frame (the shake on a curve, review 1) — it stays on the 3 px core either way. */
function carPx(s, lvl, sHead, k){
  const h = TRAIN.along(sHead), p = s === sHead ? h : TRAIN.along(s), X = p.x / lvl, Y = -p.y / lvl, Xh = h.x / lvl, Yh = -h.y / lvl;
  const c = Math.cos(p.angle), n = Math.sin(p.angle), ax = Math.abs(c) >= Math.abs(n) ? 0 : 1;
  const maj = ax ? Math.round(Yh) + Math.round(Y - Yh) : Math.round(Xh) + Math.round(X - Xh), f = ax ? X + (maj - Y) * c / n : Y + (maj - X) * n / c;
  let cr = Math.round(f);
  if (k != null){ const q = xh[k]; if (q && q.lvl === lvl && q.ax === ax && Math.abs(f - q.v) < .75) cr = q.v; xh[k] = {lvl, ax, v: cr}; }
  return ax ? [cr, maj] : [maj, cr];
}
TRAIN.headPx = (s, lvl) => tier(lvl) === 'district' ? lp(s, lvl) : carPx(s, lvl, s, 0);   // the head's level px as TRAIN.draw puts it (same hysteresis slot)

/* ---------- the line raster per level and curve: lazy chunks of 128 px of arc ----------
   Each pixel within 4.5 px of the curve keeps its distance class (4 centre run · 3 core · 2 casing · 1 solid glow ·
   0 dither glow) and the arc length s of its nearest curve sample; a pixel belongs to the chunk owning that sample
   (samples sit on a global grid of ds = lvl/4 m, so neighbouring chunks agree and no pixel is drawn twice). */
function levelLine(lvl, C = T){
  let L = C.lines.get(lvl); if (L) return L;
  const len = C.len, CS = 128 * lvl, chunks = [];
  for (let s0 = 0; s0 < len; s0 += CS){
    const s1 = Math.min(len, s0 + CS); let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (let s = s0; ; s = Math.min(s1, s + lvl)){ const [X, Y] = lp(s, lvl, C); a = Math.min(a, X); b = Math.min(b, Y); c = Math.max(c, X); d = Math.max(d, Y); if (s >= s1) break; }
    chunks.push({s0, s1, last: s1 >= len, x0: a - R, y0: b - R, x1: c + R, y1: d + R, px: null});
  }
  C.lines.set(lvl, L = {lvl, chunks}); return L;
}
function buildChunk(ch, lvl, C = T){
  const ds = lvl / 4, pad = 2.5 * R * lvl, len = C.len, bw = ch.x1 - ch.x0 + 1, bh = ch.y1 - ch.y0 + 1;
  const dist = new Float32Array(bw * bh).fill(1e9), sAt = new Float32Array(bw * bh);
  for (let q = Math.ceil(Math.max(0, ch.s0 - pad) / ds), q1 = Math.floor(Math.min(len, ch.s1 + pad) / ds); q <= q1; q++){
    const s = q * ds, p = at(C, s), X = p.x / lvl, Y = -p.y / lvl, cx = Math.round(X), cy = Math.round(Y);
    for (let y = Math.max(ch.y0, cy - R); y <= Math.min(ch.y1, cy + R); y++) for (let x = Math.max(ch.x0, cx - R); x <= Math.min(ch.x1, cx + R); x++){
      const i = (y - ch.y0) * bw + x - ch.x0, dd = (x - X) * (x - X) + (y - Y) * (y - Y);
      if (dd < dist[i]){ dist[i] = dd; sAt[i] = s; }
    }
  }
  const run = [];                                                        // the 1 px centre run (8-connected, corners thinned)
  for (let q = Math.ceil(ch.s0 / ds); q * ds < ch.s1 || (ch.last && q * ds <= len); q++){
    const [X, Y] = lp(q * ds, lvl, C), l = run[run.length - 1];
    if (!l || l[0] !== X || l[1] !== Y){ run.push([X, Y]); const n = run.length;
      if (n >= 3 && Math.abs(run[n - 1][0] - run[n - 3][0]) <= 1 && Math.abs(run[n - 1][1] - run[n - 3][1]) <= 1) run.splice(n - 2, 1); }
  }
  const cen = new Set(run.map(([x, y]) => (y - ch.y0) * bw + x - ch.x0));
  let own = null;                                                        // a loop's closing arc: the ridden track's classes under it
  if (C === TC){ own = new Int8Array(bw * bh).fill(-1);
    for (const t of levelLine(lvl).chunks){ if (t.x1 < ch.x0 || t.y1 < ch.y0 || t.x0 > ch.x1 || t.y0 > ch.y1) continue;
      if (!t.px) buildChunk(t, lvl); const q = t.px;
      for (let j = 0; j < q.n; j++){ const x = q.X[j] - ch.x0, y = q.Y[j] - ch.y0; if (x >= 0 && y >= 0 && x < bw && y < bh) own[y * bw + x] = q.C[j]; } } }
  const X = [], Y = [], S = [], K = [];
  for (let i = 0; i < bw * bh; i++){                                     // row-major → sorted by (Y, X) for run merging
    const s = sAt[i]; if (dist[i] > 4.5 * 4.5 || s < ch.s0 || (s >= ch.s1 && !ch.last)) continue;
    const d = Math.sqrt(dist[i]), k = cen.has(i) && d < 1.5 ? 4 : d < 1.5 ? 3 : d < 2.5 ? 2 : d < 3.5 ? 1 : 0;
    if (own && own[i] >= k) continue;                                    // the seam: the nearer curve's class wins (a tie: the track)
    X.push(ch.x0 + i % bw); Y.push(ch.y0 + ((i / bw) | 0)); S.push(s); K.push(k);
  }
  ch.px = {n: X.length, X: Int32Array.from(X), Y: Int32Array.from(Y), S: Float32Array.from(S), C: Uint8Array.from(K)};
}

/* idle prebuild (stage 1 r4: a new level or a zoom-out built up to a dozen chunks in one frame, 19–27 ms): the chunks round the train —
   arc [s − ½ view, s + max(3 km, 1.2 views)] — at every level from 3.2 m/px up (+ any level drawn in the last 30 s), the level drawn
   last first, then by distance from the train; then the street car sprites. Idle slices of ≤ 4 ms. Chunks more than a view + 1 km
   behind the train are let go (built again if the camera ever comes back). TRAIN.suspend() / resume(): it pauses / goes on (stage 1 r5) */
const LV0 = [2, 2.5, 3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 24, 48], SEEN = new Map();
let pb = {s: -1e9, lvl: 0, ext: 0, gen: 0}, pbQ = [], pbOn = false, pbCars = '', pbOff = false;
TRAIN.suspend = () => { pbOff = true; };
TRAIN.resume = () => { pbOff = false; pbGo(); };
function prebuild(v, sT){
  const now = performance.now(), ext = Math.max(v.W, v.H) / v.zs; SEEN.set(v.lvl, now);
  if (Math.abs(sT - pb.s) < 250 && pb.lvl === v.lvl && Math.abs(ext - pb.ext) < 8) return;
  pb = {s: sT, lvl: v.lvl, ext, gen: pb.gen + 1}; pbQ = [];
  const Ls = (typeof WORLD !== 'undefined' && WORLD.LEVELS) || LV0;
  for (const l of Ls){ if (l < 3.2 && !(now - (SEEN.get(l) || -1e9) < 3e4)) continue;
    const L = levelLine(l), a = sT - ext * l * .5, b = sT + Math.max(3000, ext * l * 1.2), gone = sT - ext * l - 1000;
    for (const ch of L.chunks){ if (ch.s1 < gone){ ch.px = null; continue; }
      if (!ch.px && ch.s1 >= a && ch.s0 <= b) pbQ.push([l === v.lvl ? -1e9 : Math.abs((ch.s0 + ch.s1) / 2 - sT) + (ch.s1 < sT ? 2000 : 0), ch, l]); } }
  pbQ.sort((x, y) => x[0] - y[0]); pbGo();
}
function pbGo(){
  if (pbOn || pbOff || !D || !pbQ.length && pbCars === PX.theme + '|' + PX.lineId) return; pbOn = true;
  const idle = window.requestIdleCallback || (f => setTimeout(() => f({timeRemaining: () => 4}), 20)), me = D;
  const run = dl => { if (D !== me){ pbOn = false; pb.s = -1e9; return; }   // (a new line meanwhile: its next frame queues and schedules afresh)
    if (pbOff){ pbOn = false; return; }                                     // (suspended: TRAIN.resume goes on)
    const until = performance.now() + Math.max(1, Math.min(4, dl.timeRemaining() - 1));
    while (pbQ.length && performance.now() < until){ const [, ch, l] = pbQ.shift(); if (!ch.px) buildChunk(ch, l); }
    if (!pbQ.length && pbCars !== PX.theme + '|' + PX.lineId){ const ck = PX.theme + '|' + PX.lineId;
      for (let h = 0; h < NH && performance.now() < until; h++) for (const part of ['head', 'mid', 'tail']) car(h, part, false);
      if (performance.now() < until) pbCars = ck; }
    if (pbQ.length || pbCars !== PX.theme + '|' + PX.lineId) idle(run); else pbOn = false; };
  idle(run);
}
TRAIN.drawLine = (g, v, sT, next) => {
  const lvl = v.lvl, t = tier(lvl), zs = v.zs, night = v.night, st = D.stations;
  prebuild(v, sT);
  if (next == null || next < -1) next = nextAfter(sT);
  const sN = next >= 0 ? st[next].d : -1, hop = sN - sT > 30;
  const sp = hop ? sT + (sN - sT) * ((v.t % 1.8) / 1.8) : -1e9, pw = 2.6 * lvl;
  const cov = night && typeof WORLD !== 'undefined' && WORLD.coveredAt ? (x, y) => WORLD.coveredAt(x, y, v) : () => false;
  const vx0 = v.ox - 2, vy0 = v.oy - 2, vx1 = v.ox + v.W / zs + 2, vy1 = v.oy + v.H / zs + 2, cols = {};
  const LK = PX.lk('disp'), DIM = PX.lk('trav'), HI = PX.lk('hi'), CS = PX.lk('case'), GL = PX.lk('glow');
  let fill = null, rk = null, rx0 = 0, rx1 = 0, ry = 0;
  const flush = () => { if (!rk) return; const col = cols[rk] || (cols[rk] = PX.col(rk)); if (col !== fill) g.fillStyle = fill = col;
    const a = v.sx(rx0), b = v.sx(rx1); g.fillRect(a, v.sy(ry), b - a + 1, 1); rk = null; };
  const paint = (C, quiet) => { for (const ch of levelLine(lvl, C).chunks){        // quiet: a loop's closing arc, never ridden
    if (ch.x1 < vx0 || ch.y1 < vy0 || ch.x0 > vx1 || ch.y0 > vy1) continue;
    if (!ch.px) buildChunk(ch, lvl, C);
    const {n, X, Y, S, C: K} = ch.px;
    for (let i = 0; i < n; i++){
      const s = S[i], c = K[i], x = X[i], y = Y[i]; let k = null;
      if (quiet || s < sT) k = c >= 3 ? DIM : c === 2 ? CS : null;                // travelled: quiet, no glow
      else if (c === 4 && s <= sN) k = s > sp - pw && s <= sp + lvl * .5 ? 'stn.fill' : HI; // hop ahead: centre rail + pulse
      else if (c >= 3) k = LK;
      else if (c === 2) k = CS;
      else if (night && c === 1 && (t !== 'city' || PX.bayer(x, y) < .25)){   // solid glow ring only (review 2: the outer dither left 1 px whiskers)
         const sx = v.sx(x), sy = v.sy(y); if (!cov(sx, sy)) k = GL; }
      if (k !== rk || y !== ry || x !== rx1 + 1){ flush(); if (k){ rk = k; rx0 = rx1 = x; ry = y; } }
      else rx1 = x;
    }
    flush();
  } };
  paint(T, false);
  if (TC) paint(TC, true);                                               // after the ridden track: it yields only where that is as close (buildChunk)
  if (t !== 'street') return;
  for (const s of st){                                                   // platform slabs either side of the track (street tier)
    const p = TRAIN.along(s.d), [X, Y] = lp(s.d, lvl), x = v.sx(X), y = v.sy(Y);
    if (v.onScreen(x, y, 20)) SPR.put(g, SPR.platform(((Math.round(p.angle / TAU * 32) % 32) + 32) % 32), x, y);
  }
};

/* ---------- the metro car: v1's "sheared raster" top view (same palette, same light), at 64 headings, with the
   1 px oblique SOUTH face (side windows / cab end) + its outline instead of v1's drop shadow ---------- */
const LIGHT = (() => { const l = [-0.62, -0.72, 0.9], n = Math.hypot(...l); return l.map(x => x / n); })();
const memo = new Map();
function paint(id, S, K, a){
  const {c, g} = PX.makeCanvas(S, S), img = g.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++){ if (!K[i]) continue; const q = PX.rgb(PX.col(K[i])); d[i * 4] = q[0]; d[i * 4 + 1] = q[1]; d[i * 4 + 2] = q[2]; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); return {id, w: S, h: S, ax: a, ay: a, c};
}
function car(i, part, small){
  const LK = PX.lk('disp'), key = 'train|car|' + PX.theme + '|' + PX.lineId + '|' + i + '|' + part + '|' + (small ? 1 : 0); let spr = memo.get(key); if (spr) return spr;
  const S = small ? 15 : 25, c = S >> 1, th = i * TAU / NH, ca = Math.cos(th), sa = Math.sin(th), night = PX.theme === 'night';
  const shallow = Math.abs(ca) >= Math.abs(sa) - 1e-9, maj = shallow ? Math.abs(ca) : Math.abs(sa);
  const slope = shallow ? sa / ca : ca / sa, n = Math.round((small ? 5 : 7) / maj), w0 = -(n >> 1), Lh = small ? 4.5 : 8.5;
  const cab = part === 'head' ? 1 : part === 'tail' ? -1 : 0, K = new Array(S * S).fill(''), I = new Array(S * S).fill(null);
  const dot = -sa * LIGHT[0] + ca * LIGHT[1], vDir = shallow ? Math.sign(ca) : Math.sign(-sa);
  const litHigh = Math.abs(dot) < .15 ? false : (dot > 0) === (vDir > 0), nr = n - 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const A = shallow ? x : y, B = shallow ? y : x, w = B - (c + Math.round((A - c) * slope)) - w0, u = (x - c) * ca + (y - c) * sa;
    if (w < 0 || w >= n || Math.abs(u) > Lh) continue;
    const k = Math.floor((Lh - Math.abs(u)) / maj + 1e-6), side = w === 0 || w === n - 1, band = w === 1 || w === n - 2, front = cab && u * cab > 0;
    if (side && k === 0) continue;                                       // rounded corners
    if (front && band && k === 0) continue;                              // rounder cab nose
    const j = litHigh ? n - 3 - w : w - 2; let q;
    if (side || k === 0 || (front && band && k === 1)) q = 'car.d0';
    else if (band) q = LK;
    else if (k === 1) q = front && (w === 2 || w === n - 3) ? (cab > 0 ? 'car.lamp' : 'car.tail') : 'car.lo';
    else if (front && k <= (small ? 2 : 3)) q = k === 2 && j <= 1 ? 'car.glassHi' : 'car.glass';
    else if (!small && w === n >> 1 && Math.abs(u) > 2 && Math.abs(u) < 5.5) q = 'car.vent';
    else q = j === 0 ? 'car.top' : j === nr - 1 ? 'car.lo' : j === 1 ? 'car.hi' : 'car.mid';
    K[y * S + x] = q; I[y * S + x] = {w, u, k, side, front};
  }
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++){        // the stripe never touches the outside: ink it there
    const i = y * S + x; if (K[i] === LK && (!K[i - 1] || !K[i + 1] || !K[i - S] || !K[i + S])) K[i] = 'car.d0';
  }
  const F = new Uint8Array(S * S), win = night ? 'car.glassHi' : 'car.glass';
  for (let x = 0; x < S; x++){                                           // south face: 1 px under the lowest body pixel
    let yl = -1; for (let y = S - 1; y >= 0; y--) if (I[y * S + x]){ yl = y; break; }
    if (yl < 0 || yl + 1 >= S) continue;
    const p = I[yl * S + x], i = (yl + 1) * S + x;
    if (p.side && p.k >= 1) K[i] = p.k <= 1 ? 'car.lo' : (Math.round(p.u) + 30) % 3 === 0 ? 'car.lo' : win;   // side: windows + pillars
    else K[i] = p.front && (p.w === 2 || p.w === n - 3) && Math.abs(ca) < .7 ? (cab > 0 ? 'car.lamp' : 'car.tail') : 'car.lo';  // cab end
    F[i] = 1;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){               // 1 px outline round the face (sides + below)
    const i = y * S + x; if (K[i]) continue;
    if ((x > 0 && F[i - 1]) || (x < S - 1 && F[i + 1]) || (y > 0 && F[i - S])) K[i] = 'car.d0';
  }
  memo.set(key, spr = paint(key, S, K, c));
  const H = new Array(S * S).fill('');                                   // day: 1 px line-colour casing round the whole car
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){ const i = y * S + x; if (K[i]) continue;
    if ((x > 0 && K[i - 1]) || (x < S - 1 && K[i + 1]) || (y > 0 && K[i - S]) || (y < S - 1 && K[i + S])) H[i] = PX.lk('case'); }
  spr.halo = paint(key + '|halo', S, H, c);
  return spr;
}
TRAIN.carSprite = car;                                                   // (for the sprite preview in tools/motion-test.html)

/* ---------- district tier: ONE continuous body ON THE RAIL (review 2: the v2 snake was re-rasterised every frame from
   float screen positions, so its 1 px kinks boiled — the shake on curves). The body is the cached line raster itself
   (buildChunk: every pixel's distance class + the arc length of its nearest curve sample, on a GLOBAL grid): its pixels
   with s in [tail − 4.5 px, nose + 4.5 px] — so the body's shape is fixed to the map and only the nose, the tail and the
   two gangway gaps (at fixed offsets from the head) advance, pixel by pixel. Classes → car art: the centre run = the white
   roof ridge (windscreen + night head lamp at the nose), the core = the line-colour band (lit on the top-left side), the
   casing = the 1 px ink outline; the oblique south face under it; by day the line-colour casing like the street cars. ---------- */
const LX = -.62, LY = -.72;
function railBody(g, v, sT, nC, pitch, night){
  const LK = PX.lk('disp'), PRI = {'car.d0': 1, [LK]: 2, 'car.hi': 3, 'car.top': 4, 'car.glass': 5, 'stn.fill': 6}, lvl = v.lvl, L = levelLine(lvl), pp = pitch / lvl, uN = 4.5, uT = -(nC - 1) * pp - 4.5, s0 = sT + uT * lvl, s1 = sT + uN * lvl;
  const B = new Map(), ridge = new Set();
  let nose = null, nu = -1e9;
  const joint = u => { for (let k = 1; k < nC; k++) if (Math.abs(u + (k - .5) * pp) < .5) return true; return false; };
  for (const ch of L.chunks){
    if (ch.s1 < s0 - 3 * lvl || ch.s0 > s1 + 3 * lvl) continue;
    if (!ch.px) buildChunk(ch, lvl);
    const {n, X, Y, S, C} = ch.px;
    for (let i = 0; i < n; i++){
      const s = S[i], c = C[i]; if (c < 2 || s < s0 || s > s1) continue;
      const u = (s - sT) / lvl, x = X[i], y = Y[i]; let k;
      if (c === 2 || u > uN - .5 || u < uT + .5) k = 'car.d0';
      else if (joint(u)) k = 'car.d0';
      else if (c === 4){ k = u > uN - 1.9 ? 'car.glass' : 'car.top'; ridge.add(x + ',' + y); if (u > nu){ nu = u; nose = [x, y]; } }
      else { const p = TRAIN.along(s), ox = x - p.x / lvl, oy = y + p.y / lvl, m = Math.hypot(ox, oy) || 1; k = (ox * LX + oy * LY) / m > .35 ? 'car.hi' : LK; }
      B.set(x + ',' + y, k);
    }
  }
  for (const [q, k] of B) if (k === 'car.hi'){ const [x, y] = q.split(',').map(Number);          // the lit rim only beside the ridge
    if (!ridge.has((x - 1) + ',' + y) && !ridge.has((x + 1) + ',' + y) && !ridge.has(x + ',' + (y - 1)) && !ridge.has(x + ',' + (y + 1))) B.set(q, LK); }
  if (night && nose) B.set(nose[0] + ',' + nose[1], 'stn.fill');                                  // head lamp
  const O = new Map();                                                                             // → screen px (many-to-one while zooming)
  for (const [q, k] of B){ const [x, y] = q.split(',').map(Number), sx = v.sx(x), sy = v.sy(y), key = sx + ',' + sy, o = O.get(key);
    if (!o || PRI[k] > PRI[o]) O.set(key, k); }
  const bot = new Map();                                                                           // oblique south face: under each column's lowest pixel
  for (const [q, k] of O){ const [x, y] = q.split(',').map(Number), b = bot.get(x); if (b === undefined || y > b) bot.set(x, y); }
  for (const [x, y] of bot) if (O.get(x + ',' + y) === 'car.d0'){ O.set(x + ',' + (y + 1), 'car.lo'); O.set(x + ',' + (y + 2), 'car.d0'); }
  if (!night){ const H = [];                                                                       // day: the line-colour casing
    for (const q of O.keys()){ const [x, y] = q.split(',').map(Number);
      for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]){ const e = a + ',' + b; if (!O.has(e)) H.push(e); } }
    for (const e of H) O.set(e, PX.lk('case')); }
  const rows = [...O].map(([q, k]) => { const [x, y] = q.split(',').map(Number); return [y, x, k]; }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let fill = null, rk = null, rx = 0, rl = 0, ry = 0;
  const flush = () => { if (!rk) return; const col = PX.col(rk); if (col !== fill) g.fillStyle = fill = col; g.fillRect(rx, ry, rl, 1); rk = null; };
  for (const [y, x, k] of rows){ if (k !== rk || y !== ry || x !== rx + rl){ flush(); rk = k; rx = x; rl = 1; ry = y; } else rl++; }
  flush();
}

TRAIN.draw = (g, v, sT) => {
  const lvl = v.lvl, t = tier(lvl), nC = CARS[t], pitch = PITCH[t] * v.mpp, night = v.night, cars = [];
  for (let c = 0; c < nC; c++){
    const s = sT - c * pitch, [X, Y] = t === 'district' ? lp(s, lvl) : carPx(s, lvl, sT, v.rest ? c : null), a = TRAIN.along(s - pitch * .45), b = TRAIN.along(s + pitch * .45);
    const ang = t === 'city' ? TRAIN.along(s).angle : Math.atan2(-(b.y - a.y), b.x - a.x), qf = ang / TAU * NH;
    let h = hyst[c];                                                     // hysteresis: keep the heading until 0.6 step past it
    if (h == null || Math.abs(wrap((qf - h) / NH * TAU)) / TAU * NH > .6) h = hyst[c] = ((Math.round(qf) % NH) + NH) % NH;
    cars.push({x: v.sx(X), y: v.sy(Y), angle: h * TAU / NH, h}); if (!c) TRAIN.head = {X, Y, lvl, s: sT};
  }
  const nx = nextAfter(sT);
  if (t === 'street' && night){                                          // headlight cone ahead of the cab: white core, widening
    const {x: hx, y: hy, angle} = cars[0], ux = Math.cos(angle), uy = Math.sin(angle);
    for (let k = 1; k <= 5; k++){ const hw = k === 1 ? 0 : k === 2 ? 1 : 3;
      for (let l = -hw; l <= hw; l++){
        const px = Math.round(hx + ux * (8 + k) - uy * l), py = Math.round(hy + uy * (8 + k) + ux * l);
        if (k <= 2 || PX.bayer(px + v.ox, py + v.oy) < .75 - Math.abs(l) * .15 - (k - 3) * .1) PX.px(g, px, py, k === 1 ? 'stn.fill' : k === 2 ? 'car.glassHi' : k === 3 ? 'win.hot' : 'win.amber');
      }
    }
  }
  let far = !D.stations.some(st => Math.abs(st.d - sT) < 2);              // no ring while the train stands at a platform
  if (far && nx >= 0){ const [X, Y] = lp(D.stations[nx].d, lvl); far = Math.hypot(cars[0].x - v.sx(X), cars[0].y - v.sy(Y)) >= 16; }
  if (t === 'city' && far){                                              // city locator: a dotted ring round the head, breathing 10→11→12→11
    const r = 10 + [0, 1, 2, 1][Math.floor(v.t * 4) % 4], {x: hx, y: hy} = cars[0];
    for (let q = 0; q < 64; q += 2){ const a = q / 64 * TAU; PX.rect(g, Math.round(hx + Math.cos(a) * r) - 1, Math.round(hy + Math.sin(a) * r) - 1, 3, 3, 'ink'); }
    for (let q = 0; q < 64; q += 2){ const a = q / 64 * TAU; PX.px(g, Math.round(hx + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r), 'stn.fill'); }
  }
  if (t === 'city'){ const {x, y} = cars[0]; PX.disc(g, x, y, 2, 'ink'); PX.disc(g, x, y, 1, PX.lk('hi')); }
  else {
    const small = t === 'district', part = c => c === 0 ? 'head' : c === nC - 1 ? 'tail' : 'mid', on = p => v.onScreen(p.x, p.y, 16);
    if (small){ if (cars.some(on)) railBody(g, v, sT, nC, pitch, night); return cars.map(({x, y, angle}) => ({x, y, angle})); }
    if (!night) for (const p of cars) if (on(p)) SPR.put(g, car(p.h, 'mid', small).halo, p.x, p.y);
    for (let c = 1; c < nC; c++){ const a = cars[c - 1], b = cars[c]; if (on(a)) PX.rect(g, Math.round((a.x + b.x) / 2) - 1, Math.round((a.y + b.y) / 2) - 1, 3, 3, 'car.lo'); }   // gangways
    const order = cars.map((p, i) => i).sort((a, b) => cars[a].y - cars[b].y || a - b);    // north first (oblique painter's order)
    for (const c of order){ const p = cars[c]; if (on(p)) SPR.put(g, car(p.h, part(c), small), p.x, p.y); }
  }
  return cars.map(({x, y, angle}) => ({x, y, angle}));
};
TRAIN.resetHeadings = () => { hyst = []; xh = []; };                               // main.js calls it on a seek (no carry-over)

window.TRAIN = TRAIN;
})();
