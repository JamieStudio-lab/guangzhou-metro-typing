/* traffic.js — TRAFFIC (v2): cars, taxis, vans, trucks and buses on the road chains, boats on the river lanes (owner #4, #5).
   Needs pixel.js, palette.js, sprites.js (SPR.veh / boat / wake / fade, top view with a 1 px south face), geom.js, src.js (PX.src:
   chains by stable id — the tile source adds them as their LOD1 tiles arrive —, river lanes, bridge ways; vehicles and boats spawn only
   where street / district data is in); uses WORLD.LEVELS / roadWidth / groundAt / G when present (SPEC "v2 architecture" §4–§6.2),
   falls back to local tables otherwise. Global TRAFFIC.

   TRAFFIC.init(d = PX.D, src = PX.srcFor(d))  index the chains / river lanes (each is prepared lazily the first time it is in view;
                             the same source again keeps what is prepared)
   TRAFFIC.update(dt, view)  prepares what the view needs (positions are a pure function of view.t: dt = 0 → frozen)
   TRAFFIC.draw(g, view)     layer 2: wakes, boats, district dots, cars — sprites 1:1 at view.toScreen positions
   TRAFFIC.prefetch(rect)    optional, idle time: prepare the chains / lanes in rect (metres {x0, y0, x1, y1}) ahead of need
   TRAFFIC.speed             time multiplier (1 = the speeds below)
   TRAFFIC.density           share of the vehicles / boats drawn (1; the ride's frame governor sets .5), thinned by a fixed hash per vehicle
   TRAFFIC.last              debug: what the last draw put on screen [{id, kind, dir, o, s, x, y, hd, a, type, mx, my, cx, cy}]
   TRAFFIC.stats             {chains, lanes, prepMs, prepMax, prepFrame (ms prepared inside TRAFFIC.update), drawn, ms}

   THE MODEL — stateless streams (deterministic: the same t gives the same frame, captures are reproducible).
   Every chain direction / lane is a STREAM with its own speed field v(s) (class speed × gentle noise × slow-down
   in curves, all smooth). Vehicle j of a stream enters the stream at τ_j = j·P + hash(j)·(P − minH) and is at
   s = T⁻¹(t − τ_j), T(s) = ∫ ds / v. All vehicles of a stream follow the same field, so they can never catch up
   with each other (car following by construction: time headway ≥ minH ⇒ gap ≥ minH · v ≥ the longest sprite at
   the coarsest level they are drawn at). Variety comes from per-stream speeds (slow right lane with trucks and
   buses, faster left lane with cars only) and the speed field itself. Lanes: right-hand traffic — offset to the
   right of travel (−ty, tx)·lane px: two-way chains one stream per direction at max(2.5, w/4) px from the
   centreline; one-way chains follow their point order, with a second (overtaking) lane where the band is ≥ 7 px (±2 px).
   Fades (never a pop, ordered dither via SPR.fade): 0.7 s at stream ends and tunnel portals; zoom-dependent
   density / tier visibility is binary per REST level and blended by the zoom's position between the two bracketing
   levels, so nothing is left half-dithered at rest. v3: a vehicle first met starting or (within 40 s) ending INSIDE the view is kept
   off-stage for its life (offstage(), below; review round 2: re-checked every frame until it is first on screen, against the view
   grown by a quarter screen) — fewer cars appearing / vanishing mid-screen. Occlusion: cars skip WORLD DECK pixels unless their chain runs
   on a bridge way there (d.roads b:1); boats and wakes draw only on WATER. */
(function(){
const TRAFFIC = {speed: 1, density: 1, last: [], stats: {chains: 0, lanes: 0, prepMs: 0, drawn: 0, ms: 0}};
const {hash} = GEOM;
const TAU = Math.PI * 2, CS = 4, BS = 8, FADE = .7, BLK = 32;       // chain / river sample spacing (m), fade (s), block size (samples)
const LEVELS0 = [2, 2.5, 3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 24, 48];
const hasW = f => typeof WORLD !== 'undefined' && WORLD[f];
const LEVELS = () => hasW('LEVELS') || LEVELS0;
/* road classes: v = cruise speed (m/s of mockup time, ~2.5× real), P = mean headway / minH, wm = band width (m) for the
   fallback road width, dot = drawn as a light dot at the district tier, mix = vehicle types */
const CL = {
  motorway:  {v: 36, P: 1.4, wm: 21, dot: 1, mix: {sedan: .52, taxi: .08, van: .12, truck: .24, bus: .04}},
  trunk:     {v: 30, P: 1.5, wm: 15, dot: 1, mix: {sedan: .45, taxi: .2, van: .1, truck: .12, bus: .13}},
  primary:   {v: 24, P: 1.6, wm: 15, dot: 1, mix: {sedan: .45, taxi: .22, van: .1, truck: .06, bus: .17}},
  secondary: {v: 20, P: 1.9, wm: 12, dot: 0, mix: {sedan: .5, taxi: .24, van: .1, truck: .04, bus: .12}},
  tertiary:  {v: 15, P: 2.6, wm: 9, dot: 0, mix: {sedan: .56, taxi: .26, van: .13, truck: .05}},
};
const CAR_DENS = {motorway: [1, 1, 1, .85, .65], trunk: [1, 1, 1, .85, .65], primary: [1, 1, 1, .85, .65], secondary: [1, 1, 1, .7, .5], tertiary: [1, 1, .7, .4, 0]};   // (SPEC §6.2: no tertiary cars at 5 m/px)
const DOT_DENS = [0, 0, 0, 0, 0, 1, .8, .6, .45, .3, 0, 0];         // per LEVELS index, classes with dot:1
const BOAT_DENS = [1, 1, 1, 1, .8, .35, .25, 0, 0, 0, 0, 0], BDOT_DENS = [0, 0, 0, 0, 0, .8, .8, 1, .8, .6, 0, 0];   // district: few hulls, the rest as wake dots
const COLW = [.3, .25, .2, .08, .09, .08];                          // white silver black red blue champagne (sedan / van / truck cab)
const rwF = (c, L) => Math.max(c === 'tertiary' ? 1 : 2, Math.round(CL[c].wm / L));
const roadW = (c, L) => { const w = hasW('roadWidth') ? WORLD.roadWidth(c, L) : 0; return w > 0 ? w : rwF(c, L); };
const pickW = (tbl, u) => { let a = 0; const ks = Object.keys(tbl), tot = ks.reduce((s, k) => s + tbl[k], 0); for (const k of ks){ a += tbl[k] / tot; if (u < a) return k; } return ks[ks.length - 1]; };
const pickI = (w, u) => { let a = 0; for (let i = 0; i < w.length; i++){ a += w[i]; if (u < a) return i; } return w.length - 1; };
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const noise = (s, seed, kn) => { const x = s / kn, i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, seed, 11) * (1 - u) + hash(i + 1, seed, 11) * u; };

let SRC = null, offSrc = null, CH = [], RV = [], USE = 0, prepN = 0;
/* prepared chains are kept up to MAXS samples (≈ 56 B each: ~17 / 45 MB; unbounded they reached 39 MB after 3 lines), the least
   recently drawn dropped first (prepared again when needed — a pure function of the chain, so nothing changes on screen) */
const MAXS = (() => { try { return matchMedia('(pointer:coarse)').matches || (navigator.deviceMemory || 8) <= 4 ? 3e5 : 8e5; } catch (e){ return 8e5; } })();
const CHI = new Map(), BRG = new Map(), hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
TRAFFIC.init = (d = PX.D, src) => {
  const s = src || PX.srcFor(d);
  if (s !== SRC){
    if (offSrc) offSrc(); SRC = s; CH = []; prepN = 0; CHI.clear(); BRG.clear(); SK.clear(); chainKey = ''; if (SRC.kind !== 'tiles') addChains(SRC.chains());
    RV = SRC.lanes().filter(r => r.pts && r.pts.length > 1).map((r, i) => ({i, g: SRC.anchored ? Math.floor(hash(Math.round(r.pts[0][0]), Math.round(r.pts[0][1]), 979) * 16384) : i, src: r, bb: GEOM.bbox(r.pts), P: null}));
    offSrc = SRC.onChange(onData);
  }
  TRAFFIC.stats = {chains: 0, lanes: 0, prepMs: 0, drawn: 0, ms: 0}; TRAFFIC.last = [];
  return TRAFFIC;
};
/* chains by stable id (C.i) — the tile source's are picked up around the view / prefetch rect (a 2 km grid step) and from LOD1 tiles
   arriving there, never the whole network at once. The tile source splits chains into ≤ 4 km pieces: a piece is joined with the pieces
   it runs into (same class / o / n, end = start, not prepared yet) when it is first prepared, so streams do not end — and cars fade —
   at every piece seam (stitch()). Stream seeds C.g: PX.src.seed (object source: the index, the mockup's traffic; tiles: from the
   geometry, so a re-pack that renumbers features moves no car — stage 1 r4), a stitched chain the smallest of its pieces'; river lanes
   R.g likewise (tiles: from the lane's first point) */
let chainKey = '';
const SK = new Map(), jk = (p, c) => p[0] + ',' + p[1] + '|' + c.c + '|' + (c.o | 0) + '|' + (c.n | 0);
function addChains(list){ for (const c of list) if (CL[c.c] && c.pts && c.pts.length > 1 && !CHI.has(c.id)){ const C = {i: c.id, g: SRC.seed(c) & 0x7ffffff, src: c, bb: GEOM.bbox(c.pts), P: null}; CHI.set(c.id, C); CH.push(C);
  if (SRC.kind === 'tiles'){ const k = jk(c.pts[0], c), l = SK.get(k); if (l) l.push(C); else SK.set(k, [C]); } } }
const plen = P => { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return l; };
function stitch(C){
  C.m = 1; const at = p => addChains(SRC.chains([p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1])), free = D => D && !D.P && !D.m && !D.dead;
  const lt = (D, b) => !b || D.g < b.g || (D.g === b.g && D.i < b.i);
  const next = p => { at(p); let b = null; for (const D of SK.get(jk(p, C.src)) || []) if (free(D) && lt(D, b)) b = D; return b; };
  const prev = p => { at(p); let b = null; for (const D of CH) if (free(D) && jk(D.src.pts[D.src.pts.length - 1], D.src) === jk(p, C.src) && lt(D, b)) b = D; return b; };
  const seq = [C]; let len = plen(C.src.pts), D;
  while (len < 40000 && seq.length < 48 && (D = next(seq[seq.length - 1].src.pts[seq[seq.length - 1].src.pts.length - 1]))){ D.m = 1; seq.push(D); len += plen(D.src.pts); }
  while (len < 40000 && seq.length < 48 && (D = prev(seq[0].src.pts[0]))){ D.m = 1; seq.unshift(D); len += plen(D.src.pts); }
  if (seq.length < 2) return;
  const pts = [], tunnel = []; let s0 = 0, id = C.i, g = C.g;
  for (const E of seq){ const c = E.src; for (let i = pts.length ? 1 : 0; i < c.pts.length; i++) pts.push(c.pts[i]); for (const [a, b] of c.tunnel || []) tunnel.push([a + s0, b + s0]);
    s0 += plen(c.pts); id = Math.min(id, E.i); g = Math.min(g, E.g); if (E !== C){ E.dead = 1; CHI.set(E.i, C); } }
  C.src = Object.assign({}, C.src, {pts, tunnel, len: Math.round(s0), id}); C.i = id; C.g = g; C.bb = GEOM.bbox(pts); C.pieces = seq.length;
}
function chainsNear(R){                                              // tile source: R [x0, y0, x1, y1] grown to 2 km steps
  if (SRC.kind !== 'tiles') return; const G = 2000, r = [Math.floor(R[0] / G) * G - G, Math.floor(R[1] / G) * G - G, Math.ceil(R[2] / G) * G + G, Math.ceil(R[3] / G) * G + G], k = r.join();
  if (k !== chainKey){ chainKey = k; addChains(SRC.chains(r)); }
}
function onData(ev){
  if (ev.lod !== 1) return; const b = ev.bbox;
  if (chainKey){ const r = chainKey.split(',').map(Number); if (b[0] <= r[2] && b[2] >= r[0] && b[1] <= r[3] && b[3] >= r[1]) addChains(SRC.chains(b)); }
  for (const k of [...BRG.keys()]){ const R = SRC.cellRect(1, k); if (hit([R[0] - 128, R[1] - 128, R[2] + 128, R[3] + 128], b)) BRG.delete(k); }
  for (const C of CH) if (C.P && C.P.brWait && hit(C.bb, b)) brFlags(C.P);
}

/* ---------- path preparation: resample every `st` m, Gaussian-smooth, headings, blocks ---------- */
function resample(pts, st, ws){
  const X = [], Y = [], Wd = []; let acc = 0;
  X.push(pts[0][0]); Y.push(pts[0][1]); if (ws) Wd.push(ws[0]);
  for (let a = 1; a < pts.length; a++){
    const p = pts[a - 1], q = pts[a], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-9) continue;
    let d = st - acc;
    while (d <= L){ const u = d / L; X.push(p[0] + (q[0] - p[0]) * u); Y.push(p[1] + (q[1] - p[1]) * u); if (ws) Wd.push(ws[a - 1] + (ws[a] - ws[a - 1]) * u); d += st; }
    acc = L - (d - st);
  }
  const l = pts.length - 1; if (acc > st * .25){ X.push(pts[l][0]); Y.push(pts[l][1]); if (ws) Wd.push(ws[l]); }
  return {X: Float64Array.from(X), Y: Float64Array.from(Y), Wd: ws ? Float64Array.from(Wd) : null, N: X.length};
}
function gauss(A, N, sg){                                            // centred Gaussian, window shrinks at the ends (ends stay put)
  const R = Math.ceil(sg * 2.5), k = []; for (let d = 0; d <= R; d++) k.push(Math.exp(-d * d / (2 * sg * sg)));
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++){ const r = Math.min(R, i, N - 1 - i); let s = A[i], w = 1; for (let d = 1; d <= r; d++){ s += (A[i - d] + A[i + d]) * k[d]; w += 2 * k[d]; } out[i] = s / w; }
  return out;
}
function shape(o, st, sg){
  const N = o.N; o.X = gauss(o.X, N, sg); o.Y = gauss(o.Y, N, sg); if (o.Wd) o.Wd = gauss(o.Wd, N, sg * 2);
  const A = new Float64Array(N);                                     // screen heading (y down) of the forward direction
  for (let i = 0; i < N; i++){ const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2); A[i] = Math.atan2(-(o.Y[b] - o.Y[a]), o.X[b] - o.X[a]); }
  o.A = A; o.st = st; o.len = (N - 1) * st;
  o.blk = [];                                                        // bboxes of BLK-sample blocks (metres) for the view query
  for (let b = 0; b < N - 1; b += BLK){ const e = Math.min(N - 1, b + BLK); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = b; i <= e; i++){ if (o.X[i] < x0) x0 = o.X[i]; if (o.X[i] > x1) x1 = o.X[i]; if (o.Y[i] < y0) y0 = o.Y[i]; if (o.Y[i] > y1) y1 = o.Y[i]; }
    o.blk.push([b, e, x0, y0, x1, y1]); }
  return o;
}
/* a stream = one direction of travel on one lane. v = speed per sample (sample order); builds T (travel order),
   quantised headings with hysteresis (travel order) and the headway constants */
function stream(P, dir, v, sid, o){
  const N = P.N, T = new Float64Array(N), hd = new Uint8Array(N), tv = i => v[dir > 0 ? i : N - 1 - i];
  let vmin = 1e9; for (let i = 0; i < N; i++) vmin = Math.min(vmin, v[i]);
  for (let m = 1; m < N; m++) T[m] = T[m - 1] + P.st * 2 / (tv(m - 1) + tv(m));
  const step = TAU / 64; let cur = -1;
  for (let m = 0; m < N; m++){                                        // hysteresis: keep the heading until 0.75 step off its centre
    const i = dir > 0 ? m : N - 1 - m, a = P.A[i] + (dir > 0 ? 0 : Math.PI);
    if (cur < 0 || Math.abs(wrap(a - cur * step)) > step * .75) cur = ((Math.round(a / step) % 64) + 64) % 64;
    hd[m] = cur;
  }
  const minH = o.gap / vmin;
  return {...o, dir, T, Ttot: T[N - 1], hd, sid, minH, P: minH * o.P, vmin};
}
const trav = (S, m) => S.dir > 0 ? m : S.P0.N - 1 - m;

/* bridge ways (roads b:1, tertiary+), in a 64 m grid of segments, to know where a chain runs ON a deck — one grid per LOD1 map cell
   (its roads + 128 m around; object source: one grid for all); null while that cell's tile is still to come (brWait: redone then) */
let brMiss = false;
function bridges(x, y){
  const key = SRC.cellKey(1, x, y); let g = BRG.get(key); if (g) return g;
  if (SRC.cell(1, key) === 'wait'){ brMiss = true; return null; }
  const G = new Map(), cell = 64, R = SRC.cellRect(1, key);
  for (const r of SRC.query([R[0] - 128, R[1] - 128, R[2] + 128, R[3] + 128], 1, 'roads')){ if (!r.b || !(CL[r.c] || /link/.test(r.c || ''))) continue;
    for (let a = 1; a < r.pts.length; a++){ const p = r.pts[a - 1], q = r.pts[a];
      for (let cx = Math.floor(Math.min(p[0], q[0]) / cell) - 1; cx <= Math.floor(Math.max(p[0], q[0]) / cell) + 1; cx++)
        for (let cy = Math.floor(Math.min(p[1], q[1]) / cell) - 1; cy <= Math.floor(Math.max(p[1], q[1]) / cell) + 1; cy++){
          const k = cx + ',' + cy; let l = G.get(k); if (!l) G.set(k, l = []); l.push(p, q); } } }
  BRG.set(key, g = {G, cell}); return g;
}
function brFlags(P){ brMiss = false; for (let i = 0; i < P.N; i++) P.br[i] = onBridge(P.X[i], P.Y[i], P.A[i]); P.brWait = brMiss; }
function onBridge(x, y, a){
  const g = bridges(x, y); if (!g) return 0;
  const {G, cell} = g, l = G.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)); if (!l) return 0;
  const ux = Math.cos(a), uy = -Math.sin(a);
  for (let j = 0; j < l.length; j += 2){ const p = l[j], q = l[j + 1], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy; if (!L2) continue;
    const u = clamp01(((x - p[0]) * dx + (y - p[1]) * dy) / L2), ex = p[0] + dx * u - x, ey = p[1] + dy * u - y;
    if (ex * ex + ey * ey < 36 && Math.abs(ux * dx + uy * dy) / Math.sqrt(L2) > .8) return 1; }
  return 0;
}

let inFrame = false;
function prepChain(C){
  if (C.P){ C.u = USE; return C.P; }
  if (SRC.kind === 'tiles' && !C.m) stitch(C);
  const t0 = performance.now(), c = C.src, K = CL[c.c], P = shape(resample(c.pts, CS), CS, 1.6), N = P.N, gi = C.g;
  const curv = new Float64Array(N);                                   // slow-down in curves: 1 straight … .7 tight, anticipated ±32 m, eased
  for (let i = 0; i < N; i++){ const a = Math.max(0, i - 3), b = Math.min(N - 1, i + 3); curv[i] = Math.max(.7, 1 / (1 + Math.abs(wrap(P.A[b] - P.A[a])) / ((b - a || 1) * CS) * 25)); }
  const mn = new Float64Array(N); for (let i = 0; i < N; i++){ let m = 1; for (let d = -8; d <= 8; d++){ const j = i + d; if (j >= 0 && j < N && curv[j] < m) m = curv[j]; } mn[i] = m; }
  const cf = gauss(mn, N, 3);
  P.tun = new Float64Array(N).fill(1e9);                              // metres to the nearest tunnel (0 inside)
  for (const [a, b] of c.tunnel || []) for (let i = 0; i < N; i++){ const s = i * CS, d = s < a ? a - s : s > b ? s - b : 0; if (d < P.tun[i]) P.tun[i] = d; }
  P.br = new Uint8Array(N); brFlags(P);
  const two = !c.o, lanes = two ? 1 : ((c.n || (c.c === 'motorway' || c.c === 'trunk' ? 3 : 2)) >= 3 ? 2 : 1);
  const mixSlow = K.mix, mixFast = Object.fromEntries(Object.entries(K.mix).filter(([k]) => k !== 'truck' && k !== 'bus'));
  const gapOf = mix => Math.max(...Object.keys(mix).map(k => SPR.VEH_LEN[k] || 11)) * 5 + 6;   // centre gap ≥ longest sprite at lvl 5
  P.S = [];
  const mk = (dir, lane, nl) => {                                    // lane 0 = right / slow, 1 = left / fast (one-way, 2 lanes)
    const sid = gi * 8 + P.S.length, fast = lane === 1, mix = fast ? mixFast : mixSlow, base = K.v * (nl > 1 ? (fast ? 1.08 : .88) : 1) * (.92 + .16 * hash(gi, sid, 5));
    const v = new Float64Array(N); for (let i = 0; i < N; i++) v[i] = base * (.85 + .15 * noise(i * CS, sid, 400)) * cf[i];
    const S = stream(P, dir, v, sid, {P: K.P * (fast ? 1.3 : 1), gap: gapOf(mix), mix, lane, nl, two, cls: c.c, base});
    S.P0 = P; P.S.push(S);
  };
  if (two){ mk(1, 0, 1); mk(-1, 0, 1); } else for (let l = 0; l < lanes; l++) mk(1, l, lanes);
  const dp = performance.now() - t0, st = TRAFFIC.stats; st.chains++; st.prepMs += dp; st.prepMax = Math.max(st.prepMax || 0, dp); if (inFrame) st.prepFrame = (st.prepFrame || 0) + dp; C.u = USE; prepN += N;
  if (prepN > MAXS){ const old = CH.filter(D => D.P && D.u < USE && D !== C).sort((a, b) => a.u - b.u);   // (never one drawn this frame)
    for (const D of old){ if (prepN <= MAXS * .8) break; prepN -= D.P.N; D.P = null; } }
  return (C.P = P);
}
function prepRiver(R){
  if (R.P) return R.P;
  const t0 = performance.now(), r = R.src, P = shape(resample(r.pts, BS, r.w || r.pts.map(() => r.width || 200)), BS, 3), N = P.N, gi = R.g;
  P.tun = null; P.br = null; P.S = [];
  const wide = (r.width || 0) >= 200, main = wide && /珠江/.test(r.zh || '') && (r.width || 0) >= 300;
  const subs = wide ? [{fast: 0, off: .27, base: 13, P: 3.4, mix: main ? {cruise: .55, barge: .2, ferry: .25} : {barge: .7, ferry: .3}},   // lanes .17 w apart
                      {fast: 1, off: .1, base: 21, P: 4, mix: main ? {launch: .45, ferry: .55} : {launch: .7, ferry: .3}}]      // (hulls never touch)
                    : [{fast: 1, off: .15, base: 17, P: 6, mix: {launch: 1}}];
  for (const dir of [1, -1]) for (const o of subs){
    const sid = 100000 + gi * 8 + P.S.length, base = o.base * (.92 + .16 * hash(gi, sid, 5)), v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = base * (.88 + .12 * noise(i * BS, sid, 900));
    const gap = Math.max(...Object.keys(o.mix).map(k => SPR.BOAT_LEN[k] || 16)) * 8 + 30;   // ≥ the longest hull at lvl 8
    const S = stream(P, dir, v, sid, {P: o.P, gap, mix: o.mix, offF: o.off, lane: o.fast, nl: 1, two: 1, cls: 'river', base});
    S.P0 = P; P.S.push(S);
  }
  TRAFFIC.stats.lanes++; TRAFFIC.stats.prepMs += performance.now() - t0;
  return (R.P = P);
}

/* ---------- zoom visibility: binary per rest level, blended between the two levels bracketing view.mpp ---------- */
function bracket(mpp){
  const L = LEVELS(); if (mpp <= L[0]) return [0, 0, 0]; if (mpp >= L[L.length - 1]) return [L.length - 1, L.length - 1, 0];
  let a = 0; while (a < L.length - 2 && L[a + 1] <= mpp) a++;
  const f = Math.abs(mpp - L[a]) < 1e-9 ? 0 : Math.log(mpp / L[a]) / Math.log(L[a + 1] / L[a]);
  return [a, a + 1, f];
}
function visCar(S, r, li){                                           // 1 | 0 at rest level index li: a car SPRITE of this stream
  const L = LEVELS()[li]; if (li > 4 || L > 5.01) return 0;
  if (S.lane === 1 && roadW(S.cls, L) < 7) return 0;
  return r < CAR_DENS[S.cls][Math.min(4, li)] ? 1 : 0;
}
const visDot = (S, r, li) => CL[S.cls].dot && S.lane === 0 && r < DOT_DENS[li] ? 1 : 0;
const visBoat = (r, li) => r < BOAT_DENS[li] ? 1 : 0, visBDot = (r, li) => r >= BOAT_DENS[li] && r < BDOT_DENS[li] ? 1 : 0;

/* ---------- the view query: visible s-intervals (travel index) per stream, then the vehicles on them ---------- */
function viewRect(v, padPx){
  const a = v.toGround(-padPx, -padPx), b = v.toGround(v.W + padPx, v.H + padPx);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}
function intervals(P, R){
  const out = []; let cur = null;
  for (const [b, e, x0, y0, x1, y1] of P.blk){
    if (x1 < R[0] || x0 > R[2] || y1 < R[1] || y0 > R[3]){ cur = null; continue; }
    if (cur && cur[1] === b) cur[1] = e; else out.push(cur = [b, e]);
  }
  return out;
}
function sinv(T, u){                                                  // travel index (float) at stream time u
  let lo = 0, hi = T.length - 1; if (u <= 0) return 0; if (u >= T[hi]) return hi;
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (T[m] <= u) lo = m; else hi = m; }
  return lo + (u - T[lo]) / ((T[lo + 1] - T[lo]) || 1);
}
/* every vehicle of stream S on the travel-index interval [m0, m1] at time t → cb(j, f (travel idx), u) */
function each(S, m0, m1, t, cb){
  const T0 = S.T[m0], T1 = S.T[m1], jit = S.P - S.minH;
  for (let j = Math.floor((t - T1 - jit) / S.P), j1 = Math.floor((t - T0) / S.P); j <= j1; j++){
    const u = t - (j * S.P + hash(j, S.sid, 1) * jit); if (u < T0 || u > T1 || u < 0 || u > S.Ttot) continue;
    cb(j, sinv(S.T, u), u);
  }
}
/* position (metres) of a stream point: smoothed centre + lateral offset `off` metres to the RIGHT of travel */
function place(S, f, off){
  const P = S.P0, N = P.N, m = Math.min(N - 1, Math.max(0, f)), m0 = Math.floor(m), fr = m - m0, i0 = trav(S, m0), i1 = trav(S, Math.min(N - 1, m0 + 1));
  const x = P.X[i0] + (P.X[i1] - P.X[i0]) * fr, y = P.Y[i0] + (P.Y[i1] - P.Y[i0]) * fr;
  const a = P.A[fr < .5 ? i0 : i1] + (S.dir > 0 ? 0 : Math.PI), w = P.Wd ? P.Wd[fr < .5 ? i0 : i1] : 0;
  const o = typeof off === 'function' ? off(w) : off;
  const tun = P.tun ? P.tun[i0] + (P.tun[i1] - P.tun[i0]) * fr : 1e9, vl = P.st / ((S.T[Math.min(N - 1, m0 + 1)] - S.T[m0]) || 1e9);   // tunnel distance, local speed
  return {cx: x, cy: y, x: x - Math.sin(a) * o, y: y - Math.cos(a) * o, hd: S.hd[Math.min(N - 1, Math.round(m))], i: fr < .5 ? i0 : i1, a, tun, vl};
}

TRAFFIC.update = (dt, v) => { inFrame = true; try { collect(v); } finally { inFrame = false; } };
/* stage 1 r4 (tile source): ≤ 3 ms of chain preparation inside a frame (a zoom-out met a dozen new chains at once: 12–30 ms); the rest
   waits for the idle queue — its cars appear a few frames later, from the edge of the collect ring (object source: all at once) */
let pfF = -1, pfMs = 0;
function prepSome(C){
  if (SRC.kind !== 'tiles' || !inFrame) return prepChain(C);
  const fr = frameId(); if (fr !== pfF){ pfF = fr; pfMs = 0; }
  if (pfMs >= 3){ if (!C.q){ C.q = 1; idleQ([() => { C.q = 0; if (!C.dead && !C.P) prepChain(C); }]); } return null; }
  const t0 = performance.now(), P = prepChain(C); pfMs += performance.now() - t0; return P;
}
/* idle-time preparation of every chain / river lane crossing rect (metres {x0, y0, x1, y1}), ≤ 6 ms per slice, so a zoom-out or
   a new hop never pays the (≈ 1 ms per chain) preparation in a frame. Sprites: call SPR.prebake({night, levels}) as well. */
const queue = []; let busy = false;
function idleQ(jobs){
  queue.push(...jobs); if (busy || !queue.length) return; busy = true;
  const ric = window.requestIdleCallback || (f => setTimeout(f, 16)), slice = () => { const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) queue.shift()();
    if (queue.length) ric(slice); else busy = false; };
  ric(slice);
}
TRAFFIC.prefetch = r => {
  chainsNear([r.x0, r.y0, r.x1, r.y1]);
  const hit = b => !(b[2] < r.x0 || b[0] > r.x1 || b[3] < r.y0 || b[1] > r.y1), J = [];
  for (const C of CH) if (!C.P && !C.dead && hit(C.bb)) J.push(() => { if (!C.dead) prepChain(C); });
  for (const R of RV) if (!R.P && hit(R.bb)) J.push(() => prepRiver(R));
  idleQ(J);
};
let lastKey = '', lastList = null;
function collect(v){
  const key = [v.seq, v.t, v.mpp, v.ox, v.oy, v.W, v.H, v.lvl, v.theme, TRAFFIC.density].join('|'); if (key === lastKey) return lastList;
  const t = v.t * TRAFFIC.speed, [la, lb, fz] = bracket(v.mpp), lvl = v.lvl, list = []; USE++;
  chainsNear(viewRect(v, 24));
  const blend = fn => (1 - fz) * fn(la) + fz * fn(lb);
  const anyCars = la <= 4, anyDots = lb >= 5 && la <= 9, anyBoats = la <= 9;
  if (anyCars || anyDots){
    const R = viewRect(v, 24);
    for (const C of CH){
      const b = C.bb; if (C.dead || b[2] < R[0] || b[0] > R[2] || b[3] < R[1] || b[1] > R[3]) continue;
      if (!anyCars && !CL[C.src.c].dot) continue;
      const P = C.P || prepSome(C); if (!P) continue; const iv = intervals(P, R); if (!iv.length) continue;
      for (const S of P.S){
        const rw = roadW(S.cls, lvl), q = Math.max(S.two ? 2.5 : 2, rw / 4),   // two-way: centres ≥ 5 px apart, so passing cars never merge (review 2)
           offPx = S.two ? q : S.nl > 1 ? (S.lane ? -q : q) : 0;
        for (const [a, e] of iv){
          const m0 = Math.min(trav(S, a), trav(S, e)), m1 = Math.max(trav(S, a), trav(S, e));
          each(S, m0, m1, t, (j, f, u) => {
            const r = hash(j, S.sid, 2); if (TRAFFIC.density < 1 && hash(j, S.sid, 8) >= TRAFFIC.density) return;
            const aC = anyCars ? blend(li => visCar(S, r, li)) : 0, aD = anyDots ? blend(li => visDot(S, r, li)) : 0; if (aC <= 0 && aD <= 0) return;
            const p = place(S, f, offPx * lvl), aT = clamp01(p.tun / (Math.max(p.vl, 1) * FADE)), aE = clamp01(Math.min(u, S.Ttot - u) / FADE), a0 = aT * aE; if (a0 <= 0 || !SRC.ready(p.x, p.y)) return;
            const s = v.toScreen(p.x, p.y), type = pickW(S.mix, hash(j, S.sid, 3)), ci = type === 'bus' ? Math.floor(hash(j, S.sid, 4) * 3) : pickI(COLW, hash(j, S.sid, 4));
            const base = {id: 'c' + C.i + ':' + S.sid + ':' + j, dir: S.dir, o: S.two ? 0 : 1, lane: S.lane, chain: C.i, s: f * P.st, x: s.x, y: s.y, hd: p.hd, type, ci, br: P.br[p.i], mx: p.x, my: p.y, cx: p.cx, cy: p.cy, ang: p.a,
              u, [ST]: {S, off: offPx * lvl}};
            if (aC > 0) list.push({...base, kind: 'car', a: aC * a0});
            if (aD > 0) list.push({...base, kind: 'dot', a: aD * a0});
          });
        }
      }
    }
  }
  if (anyBoats){
    const R = viewRect(v, 60);
    for (const Rv of RV){
      const b = Rv.bb; if (b[2] < R[0] || b[0] > R[2] || b[3] < R[1] || b[1] > R[3]) continue;
      const P = prepRiver(Rv), iv = intervals(P, R); if (!iv.length) continue;
      for (const S of P.S) for (const [a, e] of iv){
        const m0 = Math.min(trav(S, a), trav(S, e)), m1 = Math.max(trav(S, a), trav(S, e));
        each(S, m0, m1, t, (j, f, u) => {
          if (TRAFFIC.density < 1 && hash(j, S.sid, 8) >= TRAFFIC.density) return;
          const r = hash(j, S.sid, 2), aB = blend(li => visBoat(r, li)), aD = blend(li => visBDot(r, li)); if (aB <= 0 && aD <= 0) return;
          const p = place(S, f, w => w * S.offF), aE = clamp01(Math.min(u, S.Ttot - u) / FADE); if (aE <= 0 || !SRC.ready(p.x, p.y)) return;
          const s = v.toScreen(p.x, p.y), type = pickW(S.mix, hash(j, S.sid, 3));
          const base = {id: 'b' + Rv.i + ':' + S.sid + ':' + j, dir: S.dir, o: 0, lane: S.lane, river: Rv.i, s: f * P.st, x: s.x, y: s.y, hd: p.hd, type, mx: p.x, my: p.y, cx: p.cx, cy: p.cy, ang: p.a, ph: hash(j, S.sid, 6),
            u, [ST]: {S, off: w => w * S.offF}};
          if (aB > 0) list.push({...base, kind: 'boat', a: aB * aE});
          if (aD > 0) list.push({...base, kind: 'bdot', a: aD * aE});
        });
      }
    }
  }
  lastKey = key; lastList = offstage(list, v); return lastList;
}
/* v3 (owner leftover c): fewer vehicles starting / ending in mid-screen. The streams stay stateless; what is ADDED is a memory of
   which vehicles this ride has already seen. A vehicle met for the first time that is fading in at its stream's start INSIDE the
   view (or a quarter screen around it), or whose stream ends inside the view within 40 s, is kept off-stage for its whole life (never drawn: nothing pops — it was
   not on screen before). Vehicles first met outside the view (the collect ring is 24 px / 60 px wider than it) and those already
   on screen are untouched; tunnel portals still fade (a car really does vanish there). Deterministic for a given sequence of
   views (captures: MOCK.set + MOCK.step). */
const SEEN = new Map(), ST = Symbol('stream'); let seenT = -1e9;   // ST: the entry's stream (symbol key: not in JSON / TRAFFIC.last dumps)
function offstage(list, v){
  const t = v.t * TRAFFIC.speed, M = 12, inV = (x, y) => x > M && y > M && x < v.W - M && y < v.H - M, out = [];
  /* review round 2: the end check is repeated every frame while the vehicle has not been on screen yet (the follow camera scrolls onto
     stream ends it did not see at first sight), against the view grown by a quarter screen (where the camera will be in a moment) */
  const HZ = 40, GX = v.W * .25, GY = v.H * .25, near = (x, y) => x > -GX && y > -GY && x < v.W + GX && y < v.H + GY;
  const onScr = e => e.x > -4 && e.y > -4 && e.x < v.W + 4 && e.y < v.H + 4;
  const endsNear = (e, grow) => { const {S, off} = e[ST]; if (S.Ttot - e.u >= HZ) return false; const q = place(S, S.P0.N - 1, off), sc = v.toScreen(q.x, q.y); return grow ? near(sc.x, sc.y) : inV(sc.x, sc.y); };
  if (t < seenT - 1 || SEEN.size > 6000) SEEN.clear();                                       // time went back (a new ride) / housekeeping
  if (t - seenT > 2 || t < seenT) for (const [k, e] of SEEN) if (e.t < t - 3) SEEN.delete(k);
  seenT = Math.max(seenT, t);
  for (const e of list){
    const k = e.kind + e.id; let m = SEEN.get(k);
    if (!m){ let sup = false;
      if (e.u < FADE && (inV(e.x, e.y) || near(e.x, e.y))) sup = true;                           // born in (or just outside) the view
      else if (endsNear(e, !onScr(e))) sup = true;                                              // dies in (or near, if not yet on screen) the view soon
      SEEN.set(k, m = {sup, t, shown: false}); }
    else if (!m.sup && !m.shown && endsNear(e, true)) m.sup = true;                             // not on screen yet: its end came near
    m.t = t; if (!m.sup){ out.push(e); if (onScr(e)) m.shown = true; }
  }
  return out;
}

/* ---------- drawing ---------- */
/* blit a baked sprite at alpha a (SPR.fade, 8 ordered-dither steps); ok(sx, sy) masks pixels (occlusion). A fade step not baked yet costs
   ≤ 2 ms of SPR.fade per frame (stage 1 r3: a zoom blends every car at once — 15 ms of new fade canvases in one frame); past that the same
   pixels (the sprite's own Bayer cells < step / 8) are drawn one by one */
let fdF = -1, fdMs = 0;
const frameId = () => document.timeline && document.timeline.currentTime != null ? document.timeline.currentTime : Math.floor(performance.now() / 16);
function blit(g, spr, x, y, a, ok, W, H){
  if (!spr) return 0;
  const q = a >= 1 ? 8 : Math.max(0, Math.min(8, Math.round(a * 8))); let s = spr;
  if (q < 8){ s = spr.fades && spr.fades[q];
    if (!s){ const fr = frameId(); if (fr !== fdF){ fdF = fr; fdMs = 0; }
      if (fdMs < 2){ const t0 = performance.now(); s = SPR.fade(spr, a); fdMs += performance.now() - t0; } } }
  const S = s || spr, x0 = x - S.ax, y0 = y - S.ay, th = q / 8, kept = i => s || PX.bayer(i % S.w, (i / S.w) | 0) < th;
  if (x0 >= W || y0 >= H || x0 + S.w <= 0 || y0 + S.h <= 0) return 0;
  let all = !!s;
  if (ok && s) for (let i = 0; i < S.keys.length && all; i++) if (S.keys[i]){ const px = x0 + i % S.w, py = y0 + ((i / S.w) | 0); if (px >= 0 && py >= 0 && px < W && py < H && !ok(px, py)) all = false; }
  if (!all){ for (let i = 0; i < S.keys.length; i++){ const k = S.keys[i]; if (!k || !kept(i)) continue; const px = x0 + i % S.w, py = y0 + ((i / S.w) | 0);
      if (px < 0 || py < 0 || px >= W || py >= H || (ok && !ok(px, py))) continue; g.fillStyle = PX.col(k); g.fillRect(px, py, 1, 1); }
    return 1; }
  g.drawImage(S.c, x0, y0); return 1;
}
/* vehicle / boat / wake sprites are baked on first use (SPR.prebake bakes the rest in idle time): on the tile source a frame bakes ≤ 2 ms of
   new ones; past that a heading not baked yet borrows the nearest baked one (± 8 / 64), else the vehicle waits a frame */
const BKD = new Set(); let spF = -1, spMs = 0;                       // BKD: sprites this module has had baked
function sprite(make, id, hd){
  const k = h => id + '|' + h + '|' + PX.theme;
  if (SRC.kind !== 'tiles' || BKD.has(k(hd))){ BKD.add(k(hd)); return make(hd); }
  const fr = frameId(); if (fr !== spF){ spF = fr; spMs = 0; }
  if (spMs < 2){ const t0 = performance.now(), s = make(hd); spMs += performance.now() - t0; BKD.add(k(hd)); return s; }
  for (let d = 1; d <= 8; d++) for (const h of [(hd + d) & 63, (hd - d) & 63]) if (BKD.has(k(h))) return make(h);
  return null;
}
const DIR8 = hd => { const a = hd * TAU / 64; return [Math.round(Math.cos(a)), Math.round(Math.sin(a))]; };
function dot(g, x, y, keys, a, ok, W, H){                              // keys [[dx, dy, key]] — a Bayer-faded pixel cluster
  for (const [dx, dy, k] of keys){ const px = x + dx, py = y + dy; if (px < 0 || py < 0 || px >= W || py >= H) continue;
    if (a < 1 && PX.bayer(px, py) >= a) continue; if (ok && !ok(px, py)) continue; g.fillStyle = PX.col(k); g.fillRect(px, py, 1, 1); }
}
TRAFFIC.draw = (g, v) => {
  const t0 = performance.now(), list = collect(v), W = v.W, H = v.H, night = v.night, GA = hasW('groundAt') && hasW('G') ? WORLD.G : null;
  const water = GA ? (x, y) => WORLD.groundAt(x, y, v) === GA.WATER : null;
  const under = GA ? (x, y) => WORLD.groundAt(x, y, v) !== GA.DECK : null;
  list.sort((p, q) => p.y - q.y || (p.id < q.id ? -1 : 1));         // painter's order: north first (south faces overlap correctly)
  const drawn = [], fr = e => Math.floor(v.t * 5 + e.ph * 3) % 3;
  for (const e of list) if (e.kind === 'boat' && blit(g, sprite(h => SPR.wake(e.type, h, fr(e)), 'w' + e.type + fr(e), e.hd), e.x, e.y, e.a, water, W, H)) {}
  for (const e of list) if (e.kind === 'boat' && blit(g, sprite(h => SPR.boat(e.type, h, night), 'b' + e.type + night, e.hd), e.x, e.y, e.a, water, W, H)) drawn.push(e);
  for (const e of list) if (e.kind === 'bdot'){ const [dx, dy] = DIR8(e.hd); dot(g, e.x, e.y, [[0, 0, 'boat.w.hi'], [-dx, -dy, 'water.foam']], e.a, water, W, H); if (v.onScreen(e.x, e.y)) drawn.push(e); }
  const dk = under && hasW('deckIn') ? (x, y, r) => WORLD.deckIn(x - r, y - r, x + r, y + r, v) : () => true;   // (no deck near: no per-pixel mask)
  for (const e of list) if (e.kind === 'dot'){ const [dx, dy] = DIR8(e.hd), c = ['veh.c0', 'veh.c1', 'veh.c2', 'veh.c3', 'veh.c4', 'veh.c5'][e.ci % 6];
    dot(g, e.x, e.y, night ? [[dx, dy, 'veh.head'], [0, 0, 'veh.tail']] : [[dx, dy, c + '.mid'], [0, 0, c + '.lo']], e.a, e.br || !dk(e.x, e.y, 2) ? null : under, W, H); if (v.onScreen(e.x, e.y)) drawn.push(e); }
  for (const e of list) if (e.kind === 'car' && blit(g, sprite(h => SPR.veh(e.type, e.ci, h, night), 'v' + e.type + e.ci + night, e.hd), e.x, e.y, e.a, e.br || !dk(e.x, e.y, 24) ? null : under, W, H)) drawn.push(e);
  TRAFFIC.last = drawn; TRAFFIC.stats.drawn = drawn.length; TRAFFIC.stats.ms = performance.now() - t0;
};

window.TRAFFIC = TRAFFIC;
})();
