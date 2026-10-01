/* ovlife.js — OVM's life (the world-map menu, v0.7.0): small trains, progress badges, the START cursor, the gauntlet's marks and the
   stepped partial redraws that move them. Split from ovmap.js to keep the menu set (game.js PX_MENU) in its budget: ovmap.js keeps the
   API and the state (OVM.trains / progress / cursor / marks validate, store and return; stats() reports them) and injects this script
   itself (its own URL with ovmap.js → ovlife.js, same query; 3 tries) once a mounted map is ready (its first view shown) and one of them
   is on — a page that never calls them never loads it. Until it is in, the map paints and works without life (nothing of it drawn, hit
   or kept clear of); then the state so far applies at once. Global-free: it hands OVM._life a factory that gets ovmap.js's internals
   (X: getters for its canvas, view and life state, its helpers) and returns the hooks ovmap.js calls (draw, badges, obst, hit, set, on,
   off, free, inv, sync, stats, layerB); it never touches the tiles. Same rules as ovmap.js / pixel.js (palette roles, integer coordinates,
   Bayer never alpha; OVM.audit() 0 mid-tick too).
   OVM.trains(mode) → mode          'lively' | 'calm' | 'off' (no arg: the current mode). Small pixel trains on every line: lively 1 per
                                   12 km of track (1–4), calm about half, at a made-up steady pace (5 / 3.5 art px/s at the 384 step,
                                   × √(384 / m) finer; never linked to the player), ping-pong with a 1.2 / 1.8 s dwell at the termini (a
                                   loop line circulates, both ways). Pre-baked 8-heading sprites (no rotation at draw time): the line's
                                   display colour + its hi step, a 1 px ink outline, a stn.fill headlight; 6 × 4 at ≥ 384 m/px, 7 × 5
                                   with car.glass windows at 128–256, 10 × 6 (2 headlights) at ≤ 96. While a line is lit (hover / focus)
                                   its own trains wear the ride's car body (car.hi / car.mid, a stripe in the line colour, car.lamp) so
                                   they read on their track, and the other lines' trains are lineDim checker ghosts (a Bayer 50 % of the
                                   shape) passing under the lit line, hidden at ≥ 256. Trains pass in front of the focus labels, under
                                   marks / badges / tooltip / attribution / cursor. Stepped at ~12 fps: each tick redraws only the
                                   rectangles the trains (and the cursor, the marks) touched, from the layers cached by the last full
                                   frame (tiles · the lit line + its labels · badges, tooltip, attribution), and blits just those to the
                                   display canvas — no allocation per tick. Runs only while the canvas is on screen
                                   (IntersectionObserver), the page is visible and the view is ready; under prefers-reduced-motion (or
                                   OVM.reducedMotion(true)) it never runs: trains stay parked at fixed spots, the cursor holds frame 0.
   OVM.progress({id: stars} | null) a badge near each listed line's outer terminus (the one farther from the network centre), at every
                                   step: 1–3 accent stars in a small raised panel, or a flag for 0 (played, no stars); placed per step
                                   in level px (8 spots × 3 distances, outward first, avoiding other badges, tracks, the cursor and, at
                                   the settled view, the attribution and the pads' UI: a spot inside the free rect beats any other; the
                                   framed line's badge is placed first); drawn only wholly inside the free rect (none peeks from under a
                                   pad's UI); focus labels avoid them. null clears. A tap / hover on a badge hits its line.
   OVM.cursor(id | null, {rev, label = 'START', font = 'fp10'})  the departure station of the chosen direction (the first station, the
                                   last when rev) as the ride's big next-stop marker pulsing in 2 frames (SPR.stnNext 0 / 1), and a
                                   "START ▼" sign (ink on accentSign, FP10) above it bobbing 1 px toward it in the same 2 steps (420 ms
                                   each; below it with ▲ when the free rect's top is too close). Labels and badges keep clear of both;
                                   OVM.hit on either → {line: its id, cursor: true}.
   OVM.marks([zh…] | null) → n     rings (ink / badSign / stn.fill) on the named stations (the long-name gauntlet's), pulsing in the
                                   cursor's 2 frames (a second badSign ring); under badges, tooltip, attribution and cursor. null clears.
   Budgets: a tick ≤ 2 ms on desktop (stats().life: on, frames, lastMs, maxMs, p50Ms, p95Ms over the last 240, rects; .reset()), p95 ≤
   16.7 ms at 4× CPU throttle; a tick leaves the canvas pixel-identical to a full redraw at the same state; memory: the layers
   (2–3 × W × H × 4, art-sized; stats().layerBytes, in totalBytes) come on top of OVM's 16 / 8 MB like the display canvas, freed when
   life goes off. */
(function(){
'use strict';
if (typeof OVM === 'undefined' || typeof OVM._life !== 'function') return;
OVM._life(X => {
const {FR, AT, CR, STAND, data, line, pxl, nearest, radOf, kindOf, over, segHits, frame, attrBox, viewOf, hl, dirty, clamp, now} = X;
/* ovmap.js's canvas (re-read at every entry: a mount or a resize replaces it) and its life state (re-read after every OVM setter) */
let W = 64, H = 64, K = 2, g = null, dg = null, art = null, tMode = 'off', prog = null, progKey = '', cur = null, MK = null;
const pull = () => { W = X.W; H = X.H; K = X.K; g = X.g; dg = X.dg; art = X.art; };
const LIFE = {lively: {pxs: 5, dwell: 1.2}, calm: {pxs: 3.5, dwell: 1.8, half: true}}, TICK = 75, BLINK = 420, TREF = 384;
/* train shapes, E and SE (front = F, the lamp; w = a window), 6 × 4 (≥ 384 m/px), 7 × 5 (128–256), 10 × 6 (≤ 96); the other 6 headings by flips / transposes,
   then outline (a shape px touching the outside) = ink, the inner px touching the outline above or left = the line's hi, the rest disp;
   dim = the whole shape as a lineDim checker (a Bayer ghost) */
const TMASK = [{E: ['.####.', '#####F', '######', '.####.'], SE: ['.##....', '####...', '#####..', '.#####.', '..####F', '...###.', '....#..']},
  {E: ['.#####.', '######F', '#w#w#w#', '#######', '.#####.'], SE: ['.##.....', '####....', '#w###...', '.##w##..', '..##w##.', '...#####', '....###F', '.....##.']},
  {E: ['.########.', '##########', '#w#w#w#w#F', '#########F', '##########', '.########.'],
   SE: ['.#####.....', '##w####....', '.#######...', '..##w####..', '...#######.', '....##w###F', '.....####F.']}];
const tT = r => [...r[0]].map((_, x) => r.map(s => s[x]).join('')), tFX = r => r.map(s => [...s].reverse().join('')), tFY = r => [...r].reverse();
/* the stripe (s): the inner px farthest toward the car's floor (E: down, SE: down-left), windows kept; the flips carry it */
const tStripe = (r, fx) => { const at = (u, v) => r[v] && r[v][u] || '.', inn = (x, y) => at(x, y) !== '.' && at(x, y) !== 'F' && ![[-1, 0], [1, 0], [0, -1], [0, 1]].some(([a, b]) => at(x + a, y + b) === '.');
  let mx = -1e9; r.forEach((s, y) => { for (let x = 0; x < s.length; x++) if (inn(x, y)) mx = Math.max(mx, x * fx + y); });
  return r.map((s, y) => [...s].map((c, x) => c === '#' && inn(x, y) && x * fx + y === mx ? 's' : c).join('')); };
for (const m of TMASK){ m.E = tStripe(m.E, 0); m.SE = tStripe(m.SE, -1); }
/* v: 0 normal (line colours), 1 dim (a lineDim checker ghost), 2 lit (the ride's car body + a line-colour stripe, on its own lit track) */
function trainSpr(id, sz, o, vr){
  const m = TMASK[sz], r = [m.E, m.SE, tT(m.E), tFX(m.SE), tFX(m.E), tFX(tFY(m.SE)), tFY(tT(m.E)), tFY(m.SE)][o], h = r.length, w = r[0].length;
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? r[y][x] : '.';
  const edge = (x, y) => at(x, y) !== 'F' && (at(x - 1, y) === '.' || at(x + 1, y) === '.' || at(x, y - 1) === '.' || at(x, y + 1) === '.');
  const inner = (x, y) => { const c = at(x, y); return c !== '.' && c !== 'F' && !edge(x, y); };
  const rows = r.map((s, y) => [...s].map((c, x) => c === '.' ? '.' : vr === 1 ? ((x + y) & 1 ? '.' : 'd') : c === 'F' ? 'L' : edge(x, y) ? 'k' : c === 'w' ? 'g'
    : vr === 2 && c === 's' ? 'b' : !inner(x, y - 1) || !inner(x - 1, y) ? 'h' : vr === 2 ? 'm' : 'b').join(''));
  const key = vr === 2 ? {k: 'ink', h: 'car.hi', m: 'car.mid', b: PX.lk('disp', id), g: 'car.glass', L: 'car.lamp'}
    : {k: 'ink', h: PX.lk('hi', id), b: PX.lk('disp', id), g: 'car.glass', L: 'stn.fill', d: 'lineDim.' + id};
  const c = PX.bake({id: 'ovT' + id + '|' + sz + o + 'v' + vr, w, h, rows, key});
  c._ax = w >> 1; c._ay = h >> 1; return c;
}
const SPT = new Map(); let sptTh = '';
const sprTab = id => { if (sptTh !== PX.theme){ SPT.clear(); sptTh = PX.theme; } let t = SPT.get(id); if (!t){ t = new Array(72).fill(null); SPT.set(id, t); } return t; };
/* the track of a line at a step as one integer polyline (a loop: + its closing arc) with cumulative Chebyshev lengths (= Bresenham steps) */
const TG = new Map();
function trackGeo(id, s){
  const k = id + '|' + s; let G = TG.get(k); if (G) return G;
  const L = line(id), P0 = pxl('L' + id, L.pts, s), C = L.close ? pxl('C' + id, L.close, s) : null, P = C ? P0.concat(C.slice(1)) : P0, cum = new Float64Array(P.length);
  for (let i = 1; i < P.length; i++) cum[i] = cum[i - 1] + Math.max(Math.abs(P[i][0] - P[i - 1][0]), Math.abs(P[i][1] - P[i - 1][1]));
  G = {s, P, cum, len: Math.max(1, cum[P.length - 1]), loop: !!C}; TG.set(k, G); return G;
}
let TR = [], lvSt = STAND, lvSz = 0;
const mLen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
/* a train: c = cycle position (ping-pong: 0 → 1 forward, 1 → 2 back; a loop: 0 → 1 round, dir ±1), spread evenly; b* = the box drawn last,
   n* = the box to draw (w 0 = none) */
function trainsBuild(){
  TR = []; const P = LIFE[tMode]; if (!P) return;
  for (const id of data().order){ const L = line(id), len = mLen(L.pts) + (L.close ? mLen(L.close) : 0), loop = !!L.close;
    let n = clamp(Math.round(len / 12000), 1, 4); if (P.half) n = Math.max(1, Math.round(n / 2));
    for (let k = 0; k < n; k++) TR.push({id, loop, len, c: loop ? (k + .5) / n : (k + .25) * 2 / n, dir: loop && k & 1 ? -1 : 1, wait: 0, G: null, sp: null, spTh: '',
      dim: false, bx: 0, by: 0, bw: 0, bh: 0, bc: null, nx: 0, ny: 0, nw: 0, nh: 0, nc: null}); }
}
function advance(dt){
  const P = LIFE[tMode]; if (!P) return; const vw = P.pxs * Math.sqrt(TREF * X.cam.m);      // m/s: P.pxs art px/s at 384, × √(384 / m) finer
  for (let i = 0; i < TR.length; i++){ const T = TR[i]; if (T.wait > 0){ T.wait -= dt; continue; } const d = dt * vw / T.len;
    if (T.loop){ T.c += T.dir * d; T.c -= Math.floor(T.c); }
    else if (T.c < 1 && T.c + d >= 1){ T.c = 1; T.wait = P.dwell; } else if ((T.c += d) >= 2){ T.c = 0; T.wait = P.dwell; } }
}
let hx = 0, hy = 0;
function ptAt(G, a){                                                                     // arc (Bresenham steps) → hx, hy (level px)
  if (G.loop){ a %= G.len; if (a < 0) a += G.len; } else a = a < 0 ? 0 : a > G.len ? G.len : a;
  const cum = G.cum, P = G.P; let lo = 0, hi = P.length - 1;
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (cum[m] <= a) lo = m; else hi = m; }
  const A = P[lo], B = P[hi], n = cum[hi] - cum[lo], k = n ? Math.min(n, Math.round(a - cum[lo])) : 0;
  hx = A[0] + (n ? Math.round(k * (B[0] - A[0]) / n) : 0); hy = A[1] + (n ? Math.round(k * (B[1] - A[1]) / n) : 0);
}
/* the train's box and sprite at the view (n*); the heading = the octant of the track 3 steps behind → 3 ahead; hidden (nw 0) when
   another line is lit at ≥ 256 m/px or off screen */
function placeTrain(T, v, h){
  T.nw = 0; const dim = !!h && T.id !== h; if (dim && lvSt >= 256) return;
  const G = T.G, u = T.loop ? T.c : T.c <= 1 ? T.c : 2 - T.c, back = T.loop ? T.dir < 0 : T.c > 1, a = u * G.len;
  ptAt(G, a + 3); const x2 = hx, y2 = hy; ptAt(G, a - 3); const x1 = hx, y1 = hy; ptAt(G, a);
  const vr = dim ? 1 : h && T.id === h ? 2 : 0, o = (Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) + (back ? 12 : 8)) & 7, i = vr * 24 + lvSz * 8 + o;
  const c = T.sp[i] || (T.sp[i] = trainSpr(T.id, lvSz, o, vr)), x = v.sx(hx) - c._ax, y = v.sy(hy) - c._ay;
  if (x >= W || y >= H || x + c.width <= 0 || y + c.height <= 0) return;
  T.nx = x; T.ny = y; T.nw = c.width; T.nh = c.height; T.nc = c; T.dim = dim;
}
const commit = () => { for (let i = 0; i < TR.length; i++){ const T = TR[i]; T.bx = T.nx; T.by = T.ny; T.bw = T.nw; T.bh = T.nh; T.bc = T.nc; } };
/* a full frame: every train placed for the view, then drawn in two sets: the other lines' ghosts under the lit line, the rest over it */
function placeAll(v){
  lvSt = nearest(v.mpp); lvSz = lvSt >= 384 ? 0 : lvSt >= 128 ? 1 : 2; const h = hl();
  for (const T of TR){ if (!T.G || T.G.s !== v.lvl) T.G = trackGeo(T.id, v.lvl); if (T.spTh !== PX.theme){ T.sp = sprTab(T.id); T.spTh = PX.theme; } placeTrain(T, v, h); }
}
const drawSet = (tg, dim) => { for (let i = 0; i < TR.length; i++){ const T = TR[i]; if (T.nw && T.dim === dim) tg.drawImage(T.nc, T.nx, T.ny); } };
/* progress badges: per step, in level px, cached */
const BDG = new Map();
const STAR = {id: 'ovStar', w: 5, h: 5, rows: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '.a.a.'], key: {a: 'ui.accent'}};
const FLAG = {id: 'ovFlag', w: 5, h: 5, rows: ['kaaa.', 'kaaaa', 'kaaa.', 'k....', 'k....'], key: {k: 'ink', a: 'ui.accent'}};
/* the level px of the settled view's top-left at step s ([ox, oy]; null while the view goes elsewhere): the attribution sits on the
   screen, so badges placed for that view keep clear of its box */
const restOff = s => { const t = X.anim ? X.anim.to : X.cam; if (X.pinching || Math.abs(t.m - s) > 1e-9) return null; const v = viewOf(t, s); return [v.ox, v.oy]; };
function badgesAt(s, off){
  const fk = off && X.focusId, key = s + '|' + progKey + '|' + X.fontsOk + '|' + (cur ? cur.id + cur.rev + cur.label : '') + '|'
    + (off ? [off[0], off[1], AT.x, AT.b, AT.w, FR.l, FR.t, FR.r, FR.b, W, H, fk].join() : '');
  let B = BDG.get(key); if (B) return B; B = []; if (BDG.size > 48) BDG.clear();
  const D = data(), N = D.net, mx = (N[0] + N[2]) / 2, my = (N[1] + N[3]) / 2, r = radOf(kindOf(s), true) + 2, placed = [];
  if (cur){ const q = curStn(), A = curArt(), x = Math.round(q.x / s), y = Math.round(-q.y / s);
    placed.push({x: x - CR - 1, y: y - CR - 1, w: CR * 2 + 3, h: CR * 2 + 3}, {x: x - (A.pw >> 1) - 1, y: y - CR - A.ph - 7, w: A.pw + 3, h: A.ph + 6}); }
  if (off && X.fontsOk){ const a = attrBox(); placed.push({x: a.x + off[0] - 1, y: a.y + off[1] - 1, w: a.w + 2, h: a.h + 2}); }
  const tr = D.order.map(id => { const L = line(id), P = pxl('L' + id, L.pts, s); return L.close ? [P, pxl('C' + id, L.close, s)] : [P]; }).flat();
  const ids = D.order.filter(id => prog[id] != null); if (fk) ids.sort((p, q) => (q === fk) - (p === fk));   // (the framed line's badge first)
  for (const id of ids){
    const L = line(id), n = L.st.length, a = L.st[0], b = L.st[n - 1], far = q => Math.hypot(q.x - mx, q.y - my), t = far(a) >= far(b) ? a : b, nb = t === a ? L.st[1] || a : L.st[n - 2] || b;
    const tx = Math.round(t.x / s), ty = Math.round(-t.y / s), ul = Math.hypot(t.x - nb.x, t.y - nb.y) || 1, ux = (t.x - nb.x) / ul, uy = -(t.y - nb.y) / ul;
    const st = clamp(prog[id] | 0, 0, 3), w = st ? st * 6 + 3 : 9, h = 9; let best = null, bs = 1e9;
    for (const d of [r, r + 4, r + 9]) for (let o = 0; o < 8; o++){ const ca = Math.cos(o * Math.PI / 4), sa = Math.sin(o * Math.PI / 4);
      const x = Math.round(tx + ca * (d + w / 2) - w / 2), y = Math.round(ty + sa * (d + h / 2) - h / 2), R = {x: x - 1, y: y - 1, w: w + 3, h: h + 3};
      if (placed.some(q => over(R, q))) continue;
      let hits = 0; for (const P of tr) if (!(P.bb[2] < R.x || P.bb[0] > R.x + R.w || P.bb[3] < R.y || P.bb[1] > R.y + R.h)) hits += segHits(P, R);
      const sc = (1 - (ca * ux + sa * uy)) * 4 + hits * 6 + (d - r) * .5 + (off && !inFR(x - off[0], y - off[1], w, h) ? 100 : 0);   // (a spot under the UI: last resort)
      if (sc < bs){ bs = sc; best = {id, n: st, x, y, w, h}; } }
    if (!best) best = {id, n: st, x: tx + r, y: ty - (h >> 1), w, h};
    placed.push({x: best.x - 1, y: best.y - 1, w: best.w + 3, h: best.h + 3}); B.push(best); }
  BDG.set(key, B); return B;
}
const inFR = (x, y, w, h) => x >= FR.l && y >= FR.t && x + w + 1 <= W - FR.r && y + h + 1 <= H - FR.b;   // a badge wholly in the free rect (not peeking from under the UI)
function drawBadges(tg, v){
  for (const b of badgesAt(v.lvl, restOff(v.lvl))){ const x = v.sx(b.x), y = v.sy(b.y); if (!inFR(x, y, b.w, b.h)) continue;
    frame(tg, x, y, b.w, b.h); if (!b.n) PX.blit(tg, FLAG, x + 2, y + 2); for (let i = 0; i < b.n; i++) PX.blit(tg, STAR, x + 2 + i * 6, y + 2); }
}
/* the start cursor: art cached per theme / line / label / fonts; curPos → the station (csx, csy), the sign (cmx, cmy, flipped below with ▲
   when the free rect's top is too close), the sign's box (sbx …) and the whole box of both frames (cbx …), screen art px */
let CURC = null, cbx = 0, cby = 0, cbw = 0, cbh = 0, sbx = 0, sby = 0, sbw = 0, sbh = 0, csx = 0, csy = 0, cmx = 0, cmy = 0, cflip = false, blinkF = 0;
function curArt(){
  if (CURC && CURC.th === PX.theme && CURC.id === cur.id && CURC.label === cur.label && CURC.font === cur.font && CURC.fk === X.fontsOk) return CURC;
  const ring = [0, 1].map(f => { const d = SPR.stnNext(f, true, cur.id), c = PX.bake(d); c._ax = d.ax; c._ay = d.ay; return c; });
  const tb = PX.textBox(cur.label, cur.font), pw = PX.measure(cur.label, cur.font) + 5, ph = tb.h + 6, cx = pw >> 1;
  const mk = up => { const o = PX.makeCanvas(pw + 1, ph + 4), y0 = up ? 3 : 0, g2 = o.g, R = (x, y, w, h, k) => PX.rect(g2, x, y, w, h, k);
    R(1, y0 + ph, pw, 1, 'shadow'); R(pw, y0 + 1, 1, ph, 'shadow');                                           // (1 px drop shadow)
    R(1, y0, pw - 2, ph, 'ink'); R(0, y0 + 1, pw, ph - 2, 'ink'); R(1, y0 + 1, pw - 2, ph - 2, 'ui.accentSign');
    PX.text(g2, cur.label, 3, y0 + 3 - tb.top, {font: cur.font, color: 'ink'});
    const e = up ? y0 : y0 + ph - 1, s = up ? -1 : 1;                                                         // ▼ (▲) out of the edge row
    R(cx - 2, e, 5, 1, 'ui.accentSign'); R(cx - 2, e + s, 1, 1, 'ink'); R(cx - 1, e + s, 3, 1, 'ui.accentSign'); R(cx + 2, e + s, 1, 1, 'ink');
    R(cx - 1, e + 2 * s, 1, 1, 'ink'); R(cx, e + 2 * s, 1, 1, 'ui.accentSign'); R(cx + 1, e + 2 * s, 1, 1, 'ink'); R(cx, e + 3 * s, 1, 1, 'ink');
    return o.c; };
  return CURC = {th: PX.theme, id: cur.id, label: cur.label, font: cur.font, fk: X.fontsOk, ring, dn: mk(false), up: mk(true), pw, ph};
}
const curStn = () => { const L = line(cur.id); return L.st[cur.rev ? L.st.length - 1 : 0]; };
function curPos(v){
  const q = curStn(), s = v.lvl, A = curArt(), hh = A.ph + 4;
  csx = v.sx(Math.round(q.x / s)); csy = v.sy(Math.round(-q.y / s));
  cmx = csx - (A.pw >> 1); cmy = csy - CR - 1 - hh; cflip = cmy - 1 < FR.t + 1; if (cflip) cmy = csy + CR + 2;
  sbx = cmx; sby = cmy - 1; sbw = A.pw + 1; sbh = hh + 2;
  const x0 = Math.min(sbx, csx - 10), y0 = Math.min(sby, csy - 10), x1 = Math.max(sbx + sbw, csx + 11), y1 = Math.max(sby + sbh, csy + 11);
  cbx = x0; cby = y0; cbw = x1 - x0; cbh = y1 - y0;
  return !(x0 >= W || y0 >= H || x1 <= 0 || y1 <= 0);
}
function drawCursor(tg, v, f){
  if (!curPos(v)) return; const A = CURC, r = A.ring[f];
  tg.drawImage(r, csx - r._ax, csy - r._ay); tg.drawImage(cflip ? A.up : A.dn, cmx, cmy + (cflip ? -f : f));   // (bobs toward the station)
}
/* marks (OVM.marks): a bullseye (ink / badSign / stn.fill), frame 1 adds a badSign wave ring; MB = the on-screen boxes (frame 1's) */
const MKR = [4, 6].map((R, f) => { const rows = [];
  for (let y = -R; y <= R; y++){ let s = ''; for (let x = -R; x <= R; x++){ const q = Math.hypot(x, y);
    s += q > R + .5 ? '.' : q > 4.5 ? (q > 5.5 ? 'r' : '.') : q > 3.3 ? 'k' : q > 1.9 ? 'r' : q > 1.1 ? 'k' : 'f'; } rows.push(s); }
  return {id: 'ovMk' + f, w: R * 2 + 1, h: R * 2 + 1, a: R, rows, key: {k: 'ink', r: 'ui.badSign', f: 'stn.fill'}}; });
let nMB = 0; const MB = new Int32Array(4 * 64);
function markPos(v){
  nMB = 0; if (!MK) return 0; const s = v.lvl;
  for (const q of MK){ const x = v.sx(Math.round(q.x / s)) - 6, y = v.sy(Math.round(-q.y / s)) - 6; if (x >= W || y >= H || x + 13 <= 0 || y + 13 <= 0) continue;
    const j = nMB++ * 4; MB[j] = x; MB[j + 1] = y; MB[j + 2] = 13; MB[j + 3] = 13; }
  return nMB;
}
function drawMarks(tg, v, f, x0 = -1e9, y0 = -1e9, x1 = 1e9, y1 = 1e9){
  const S = MKR[f]; for (let i = 0; i < nMB; i++){ const j = i * 4; if (MB[j] >= x1 || MB[j + 1] >= y1 || MB[j] + 13 <= x0 || MB[j + 1] + 13 <= y0) continue;
    PX.blit(tg, S, MB[j] + 6 - S.a, MB[j + 1] + 6 - S.a); }
}
/* layers + the stepped loop, all from the last full frame at rest: BASE = the tiles, LIT (only while a line is lit) = that line + its focus
   labels, TOP = badges, tooltip, attribution (LIT, TOP transparent elsewhere); a tick repaints only the dirty rects (RB) as BASE → ghost
   trains → LIT → trains → TOP → cursor, then blits them */
let BASE = null, LIT = null, TOP = null, baseOK = false, lifeOn = false, lifeTm = 0, lifeRf = 0, lifeT = 0, ioVis = true, io = null, nR = 0;
const RB = new Int32Array(4 * 128), LS = {frames: 0, lastMs: 0, maxMs: 0, rects: 0, ring: new Float64Array(240), i: 0};
const liveOn = () => tMode !== 'off' || !!cur || !!MK;
const fit = o => o && o.c.width === W && o.c.height === H ? o : (o && (o.c.width = 0), PX.makeCanvas(W, H));
function layers(lit){ BASE = fit(BASE); TOP = fit(TOP); if (lit) LIT = fit(LIT); else if (LIT){ LIT.c.width = 0; LIT = null; } }
const freeLayers = () => { for (const o of [BASE, LIT, TOP]) if (o) o.c.width = 0; BASE = LIT = TOP = null; baseOK = false; };
const redNow = X.red;
function lifeSync(){
  const on = X.mounted && X.ready && liveOn() && !redNow() && !document.hidden && ioVis;
  if (on && !lifeOn){ lifeOn = true; lifeT = now(); lifeNext(); }
  else if (!on && lifeOn){ lifeOn = false; clearTimeout(lifeTm); lifeTm = 0; if (lifeRf) cancelAnimationFrame(lifeRf); lifeRf = 0; }
}
function lifeNext(){ if (!lifeOn || lifeTm || lifeRf) return; lifeTm = setTimeout(lifeKick, tMode !== 'off' ? TICK : BLINK - now() % BLINK + 1); }
function lifeKick(){ lifeTm = 0; if (lifeOn) lifeRf = requestAnimationFrame(lifeFrame); }
function lifeFrame(){
  lifeRf = 0; if (!lifeOn) return; const t = now(), dt = Math.min(.25, (t - lifeT) / 1000), f = Math.floor(t / BLINK) & 1; lifeT = t;
  advance(dt);
  if (X.anim || X.pinching){ blinkF = f; lifeNext(); return; }                              // (the glide's own frames draw them)
  if (!baseOK || X.raf || !X.last){ blinkF = f; dirty(); lifeNext(); return; }
  paintLife(f); lifeNext();
}
function addR(x, y, w, h){
  let x1 = x + w, y1 = y + h; if (x < 0) x = 0; if (y < 0) y = 0; if (x1 > W) x1 = W; if (y1 > H) y1 = H; if (x1 <= x || y1 <= y || nR < 0) return;
  if (nR >= 128){ nR = -1; return; } const j = nR++ * 4; RB[j] = x; RB[j + 1] = y; RB[j + 2] = x1 - x; RB[j + 3] = y1 - y;
}
function grow(j, x, y, w, h){                                                            // a box touching rect j but not inside: rect j takes it
  const rx = RB[j], ry = RB[j + 1], rx1 = rx + RB[j + 2], ry1 = ry + RB[j + 3], x1 = x + w, y1 = y + h;
  if (x >= rx1 || y >= ry1 || x1 <= rx || y1 <= ry || (x >= rx && y >= ry && x1 <= rx1 && y1 <= ry1)) return false;
  const a = Math.max(0, Math.min(rx, x)), b = Math.max(0, Math.min(ry, y)), c = Math.min(W, Math.max(rx1, x1)), d = Math.min(H, Math.max(ry1, y1));
  if (a === rx && b === ry && c === rx1 && d === ry1) return false;
  RB[j] = a; RB[j + 1] = b; RB[j + 2] = c - a; RB[j + 3] = d - b; return true;
}
function paintLife(f){
  pull(); const t0 = now(), v = X.last.v, h = hl(); nR = 0;
  for (let i = 0; i < TR.length; i++){ const T = TR[i]; placeTrain(T, v, h);
    if (T.nw === T.bw && T.nh === T.bh && T.nx === T.bx && T.ny === T.by && T.nc === T.bc) continue;
    if (!T.bw) addR(T.nx, T.ny, T.nw, T.nh); else if (!T.nw) addR(T.bx, T.by, T.bw, T.bh);
    else { const x = Math.min(T.bx, T.nx), y = Math.min(T.by, T.ny); addR(x, y, Math.max(T.bx + T.bw, T.nx + T.nw) - x, Math.max(T.by + T.bh, T.ny + T.nh) - y); } }
  const cu = !!cur && curPos(v); if (cu && f !== blinkF) addR(cbx, cby, cbw, cbh);
  const nm = markPos(v); if (nm && f !== blinkF) for (let i = 0; i < nm; i++) addR(MB[i * 4], MB[i * 4 + 1], 13, 13);
  blinkF = f;
  if (nR < 0){ dirty(); return; }
  for (let r = 0; r < nR; r++){ const j = r * 4; for (let n = 0, ch = true; ch && n < 6; n++){ ch = false;
    for (let i = 0; i < TR.length; i++){ const T = TR[i]; if (T.nw && grow(j, T.nx, T.ny, T.nw, T.nh)) ch = true; }
    if (cu && grow(j, cbx, cby, cbw, cbh)) ch = true;
    for (let i = 0; i < nm; i++) if (grow(j, MB[i * 4], MB[i * 4 + 1], 13, 13)) ch = true; } }
  let m = 0; for (let r = 0; r < nR; r++){ const j = r * 4, x = RB[j], y = RB[j + 1], x1 = x + RB[j + 2], y1 = y + RB[j + 3]; let inside = false;   // drop rects inside another
    for (let q = 0; q < nR && !inside; q++) if (q !== r && RB[q * 4 + 2] && x >= RB[q * 4] && y >= RB[q * 4 + 1] && x1 <= RB[q * 4] + RB[q * 4 + 2] && y1 <= RB[q * 4 + 1] + RB[q * 4 + 3]
      && (q < r || x !== RB[q * 4] || y !== RB[q * 4 + 1] || x1 !== RB[q * 4] + RB[q * 4 + 2] || y1 !== RB[q * 4 + 1] + RB[q * 4 + 3])) inside = true;
    if (inside) RB[j + 2] = 0; else m++; }
  for (let r = 0; r < nR; r++){ const j = r * 4, x = RB[j], y = RB[j + 1], w = RB[j + 2], hh = RB[j + 3]; if (!w) continue;
    g.drawImage(BASE.c, x, y, w, hh, x, y, w, hh);
    for (let p = 0; p < 2; p++){ if (p && LIT) g.drawImage(LIT.c, x, y, w, hh, x, y, w, hh);
      for (let i = 0; i < TR.length; i++){ const T = TR[i]; if (T.nw && T.dim === !p && T.nx < x + w && T.ny < y + hh && T.nx + T.nw > x && T.ny + T.nh > y) g.drawImage(T.nc, T.nx, T.ny); } }
    if (nm) drawMarks(g, v, f, x, y, x + w, y + hh);
    g.drawImage(TOP.c, x, y, w, hh, x, y, w, hh);
    if (cu && cbx < x + w && cby < y + hh && cbx + cbw > x && cby + cbh > y) drawCursor(g, v, f); }
  for (let r = 0; r < nR; r++){ const j = r * 4; if (RB[j + 2]) dg.drawImage(art.c, RB[j], RB[j + 1], RB[j + 2], RB[j + 3], RB[j] * K, RB[j + 1] * K, RB[j + 2] * K, RB[j + 3] * K); }
  commit();
  const ms = now() - t0; LS.frames++; LS.lastMs = ms; LS.maxMs = Math.max(LS.maxMs, ms); LS.rects = m; LS.ring[LS.i] = ms; LS.i = (LS.i + 1) % LS.ring.length;
}
const layerB = () => { let b = 0; for (const o of [BASE, LIT, TOP]) if (o && o.c) b += o.c.width * o.c.height * 4; return b; };
const pct = q => { const a = [...LS.ring.slice(0, Math.min(LS.frames, LS.ring.length))].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };

/* ---------- the hooks ovmap.js calls ---------- */
/* a frame, the map already on g: mid = the lit line + its focus labels, top = badges (below), tooltip, attribution */
function draw(v, id, moving, mid, top){
  pull(); const live = liveOn(), mf = redNow() ? 0 : blinkF; markPos(v);
  if (live && !moving){ layers(!!id); BASE.g.drawImage(art.c, 0, 0); if (LIT){ LIT.g.clearRect(0, 0, W, H); mid(LIT.g); } TOP.g.clearRect(0, 0, W, H); top(TOP.g);
    placeAll(v); drawSet(g, true); if (LIT) g.drawImage(LIT.c, 0, 0); drawSet(g, false); drawMarks(g, v, mf); g.drawImage(TOP.c, 0, 0); commit(); baseOK = true; }
  else if (live){ placeAll(v); drawSet(g, true); mid(g); drawSet(g, false); drawMarks(g, v, mf); top(g); commit(); baseOK = false; }
  else { mid(g); drawMarks(g, v, mf); top(g); baseOK = false; }
  if (cur) drawCursor(g, v, redNow() ? 0 : blinkF);
}
/* the focus labels keep clear of the badges and the START sign: [boxes in level px, the ringed station's index] */
function obst(v, s){ pull(); const ob = prog ? badgesAt(s, restOff(s)).map(b => ({x: b.x - 1, y: b.y - 1, w: b.w + 3, h: b.h + 3})) : [];
  let ri = -1; if (cur && cur.id === X.focusId && curPos(v)){ ob.push({x: sbx + v.ox, y: sby + v.oy, w: sbw, h: sbh}); ri = curStn().i; }
  return [ob, ri]; }
/* OVM.hit at art px (u, w) of the last frame: the START sign or ring → [its line, true], then a badge → [its line]; else null */
function hit(u, w, tol){ pull(); const v = X.last.v;
  if (cur && curPos(v)){ const e = tol > 4 ? 2 : 0;
    if ((u >= sbx - e && w >= sby - e && u < sbx + sbw + e && w < sby + sbh + e) || Math.hypot(u - csx - .5, w - csy - .5) <= CR + 1 + e) return [cur.id, true]; }
  if (prog && v.rest && !X.anim) for (const b of badgesAt(v.lvl, restOff(v.lvl))){ const x = v.sx(b.x), y = v.sy(b.y);
    if (inFR(x, y, b.w, b.h) && u >= x && w >= y && u < x + b.w + 1 && w < y + b.h + 1) return [b.id]; }
  return null; }
/* after an OVM setter (and at install): take its state */
function set(){ const s = X.st, t = s.tMode !== tMode || !TR.length, p = s.progKey !== progKey; ({tMode, prog, progKey, cur, MK} = s);
  if (t) trainsBuild(); if (p) BDG.clear(); baseOK = false; if (!liveOn()) freeLayers(); lifeSync(); }
/* mounted (or installed while mounted): run only while the canvas is on screen · unmounted: stop, free the layers */
function on(){ if (!io && window.IntersectionObserver){ io = new IntersectionObserver(es => { ioVis = es[es.length - 1].isIntersecting; lifeSync(); }); io.observe(X.cv); } lifeSync(); }
function off(){ lifeSync(); freeLayers(); if (io){ io.disconnect(); io = null; ioVis = true; } }
try { const q = matchMedia('(prefers-reduced-motion: reduce)'), f = () => { lifeSync(); dirty(); }; if (q.addEventListener) q.addEventListener('change', f); else q.addListener(f); } catch (e){}
document.addEventListener('visibilitychange', () => lifeSync());
return {draw, obst, hit, set, on, off, sync: lifeSync, inv: () => { baseOK = false; }, layerB,
  badges: (tg, v) => { if (prog){ pull(); drawBadges(tg, v); } },
  free: () => { TG.clear(); SPT.clear(); BDG.clear(); CURC = null; for (const T of TR){ T.G = null; T.spTh = ''; } freeLayers(); },
  stats: () => ({trains: TR.length, drawnTrains: TR.filter(T => T.bw).length,
    life: {on: lifeOn, frames: LS.frames, lastMs: LS.lastMs, maxMs: LS.maxMs, rects: LS.rects, p95Ms: pct(.95), p50Ms: pct(.5),
      reset: () => { LS.frames = 0; LS.maxMs = 0; LS.i = 0; LS.ring.fill(0); }}})};
});
})();
