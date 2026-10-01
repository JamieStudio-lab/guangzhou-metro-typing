/* ride.js — RIDE: the pixel ride screen's facade for js/game.js (carved from mockups/pixel-ride/main.js, v3 as approved:
   2× pixels, k 0.4, MIX zoom with "Ride close" short hops, rain now and then). game.js stays the only source of truth for typing
   and train physics: RIDE only maps its numbers onto the map and draws them, on game.js's own rAF tick. No loop, no keys here.
   Canvas: one art canvas (PX.W × PX.H art px) blitted unsmoothed at an integer K = round(scale × dpr) device px per art px into
   #pxCv (backing store = its exact device-pixel content box, ResizeObserver), mounted inside #mapWrap, aria-hidden.
   Camera (SPEC.md §8 + review rounds 1–2; fast hops: stage 1 r5–r6): the hop the TRAIN is on sets the level; MIX = at an arrival
   the whole next hop (overview), ~1.1 s after the departure one glide into a 3.2–4 m/px street follow with look-ahead that holds
   through the arrival; a hop the typist will finish before that glide fits rides close (a street-tier ≤ 5 m/px overview framing
   the whole hop, else the street follow from the departure) — unless it has ≥ LONG = 5 km of track: that one stays on its overview,
   framing the whole trip (arriving before the zoom out ends, the camera keeps the hop framed as far as it got; never ridden close).
   By track length, never the window; decided once per hop, never mid-hop (mixPhase); the plan per hop goes to WORLD.setPlan
   (planList), each zoom's target to WORLD.hint; zooms glide by residual scale with tier-boundary dithers (or dissolve); the focus
   target's motion is fed forward, only its jumps are eased (an overview keeps the next stop's sign in view before the train's
   margins); integer focus rounding never steps back. No speed-linked zoom.
   Reduced motion: fit-hop camera with cuts (no glides), weather clear, no traffic, steady lamps, paged marquee, no shake, the recap at once.
   Data: PX.D for the ride, in RIDE ORDER (track oriented first → last ridden station, stations[].d increasing):
     {lineId, rev, track, trackLen, trackClose?, stations:[{zh, py (toned), en, x, y, d, transfers}], landmarks, otherLines, riverLanes,
      outer:[x0, y0, x1, y1], src:'tiles'|'object'} — from MAPLINES / MAP (js/map/), or RIDE.source (below) which also hands the
     map layers over as arrays (L3 shape: water green landuse bridges waterways roads rail buildings chains) on the same object.
   API
   RIDE.prepare(L, rev, onPct, S?, sz?) → Promise   fonts, map index + first-frame tiles (MAP.loadFor), PX.D, module init (kept when the
                                           same line is replayed), the first view + (before an overview) the close view and its glide (≤ 2 s) baked in slices; onPct(0..1).
                                           S = the game's state (a mid-run takeover: planned round the train; default the start); sz = {w, h}
                                           CSS px of the canvas-to-be when #mapWrap does not have it yet (takeover from the Classic layout),
                                           or a function returning it. A RIDE.set layout change meanwhile (the soft keyboard) re-aims it.
                                           Rejects when a ridden station is missing from the map data (cross-check) or superseded.
   RIDE.prefetch(L, rev, {w, h}) → Promise  the menu's card: only that first frame's tiles (P0) at a w × h CSS px canvas, 4 at a time;
                                           a newer prefetch / prepare / start drops the rest · RIDE.plan(L, rev, {w, h}?) → Promise of those
                                           MAP.loadFor options {dir, near, views} (tools / tests: the ride's real P0)
   RIDE.start(L, S)        mount #pxCv in #mapWrap and draw the first frame (S = game.js's state object)
   RIDE.frame(dt, S)       one frame from the game's numbers (game km → track metres per hop: s = Sᵢ + ΔS·(pos − cumᵢ)/segsᵢ)
   RIDE.key(n, miss)       n correct letters / a wrong key (flash + shake) · RIDE.done(i) station i's name typed (burst)
   RIDE.finish() → ms      the run is over: the glide out to the city view round the terminus (FIN, FIN_GLIDE s), then the recap — a
                           DISS s Bayer dissolve (art px (x, y) turns once t / DISS > PX.bayer(x, y); no alpha) to OVM.drawWhole's
                           picture over the whole canvas: the ridden line lit over the dimmed network, its terminus marked, at the
                           finest step ≥ RECAP_MIN (48 m/px, so short lines like APM read) that fits the free area clear of the cluster / chips / attribution
                           (recapBoxes); the chrome keeps drawing on top; held until game.js moves on. Reduced motion: the picture
                           at once. Its tiles bake on OVM's idle time during the ride (OVM.prepWhole, from 3 s, re-asked each second
                           for a new layout), so composing it is a blit; the dissolve waits for them ≤ FIN_GLIDE + DISS s → recapMs()
   RIDE.recapMs()          ms game.js waits from RIDE.finish (call it after) to its results: RECAP_MS 3000 with the recap (reduced
                           motion too), FIN_MS 1200 without (no OVM / MAPOV / the line, drawWhole threw, not running: the Stage 1
                           finish) · RIDE.skip() → bool  the final picture from the next frame on (no drawing here: game.js shows
                           its results at once) · RIDE.theme() night/day from html[data-theme]
   RIDE.set({scale 2|3, weather 'auto'|'clear'|'rain', kb, top (CSS px: bottom of #fchips over the canvas), right (CSS px: #fchips'
            left edge from the canvas' right edge), lab {time dist wpm acc combo score}: cluster labels (game.js t())}) — also before
            prepare / prefetch (stored while not running; during a prepare, a layout change re-aims its first frame)
   RIDE.stop()             unmount, drop a prepare in flight and the recap, pause the ride's background work (MAP.cancelPlan + MAP.cancel('ride'): the
                           wants of ride.js and PX.src, WORLD / TRAIN.suspend;
                           resumed by the next prepare / start); keeps the baked world for a replay · RIDE.stats() / audit() / probe() (tests)
   RIDE.giveUp             true once the frame governor gave up (game.js rides Classic from the next ride)
   RIDE.source             TEST HOOK (null in production): fn(L) → a whole-line data object (either direction; track | line3, trackLen |
                           line3Len, stations {zh, d, x?, y?, en?}, layers as above) or null for the tile source.
   Governor (rolling p95 frame time, drawn frames only): > 24 ms → WEATHER.wetFx = false + TRAFFIC.density = .5; > 33 ms → no weather,
   no traffic, dissolve zooms; still > 33 ms → RIDE.giveUp. Needs every js/px module (WEATHER optional; ovmap.js + js/map/ov.js for the recap) and, for tiles, js/map/. */
(function(){
const RIDE = {source: null, giveUp: false};
const CHASE = .17, ARRIVE_V = .3, EASE = .7;                              // = js/game.js feel knobs
const LV0 = [2, 2.5, 3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 24, 48];
const LEVELS = () => WORLD.LEVELS || LV0;
const levelFor = mpp => WORLD.levelFor ? WORLD.levelFor(mpp) : LEVELS().reduce((a, l) => l <= mpp + 1e-9 ? l : a, LEVELS()[0]);
const smooth = x => x * x * (3 - 2 * x), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const RED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lodOf = l => l <= 5 ? 0 : l <= 16 ? 1 : 2;
let cv = null, dg = null, ro = null, art = null, g = null, aux = null;
let devW = 0, devH = 0, K = 2, W = 0, H = 0, scale = 2, lay = null, topCss = 0, rightCss = 0, kb = false, lab = null, chips = {x: 0, y: 0, w: 0, h: 0}, tbCss = '';
let kf = .4, zoomMode = 'mix', weather = 'auto', trans = 'scale', clock = 0, seq = 0, last = null, red = false;
let L = null, G = null, D = null, ST = [], KEYS = [], LAST = 0, rideKey = '', worldKey = '', running = false, fin = false, prepSeq = 0, t0ride = 0, prAt = -1e9, layGen = 0;
const R = {cur: 0, idx: 0, stop: 0, typed: 0, pos: 0, t: 0, lastT: -9, done: false, taps: []};   // the game's state, in ride terms

/* ---------- the game → the track ---------- */
const typing = () => !R.done && R.idx <= R.stop;
function trackS(p){                                                      // game km → metres along the ride's track (monotone)
  const c = G.cum, n = ST.length; let i = clamp(G.arrivedI || 0, 0, n - 2);
  while (i < n - 2 && p > c[i + 1] + 1e-9) i++;
  while (i > 0 && p < c[i] - 1e-9) i--;
  const sg = G.segs[i], f = sg > 0 ? clamp((p - c[i]) / sg, 0, 1) : 0;
  return ST[i].d + (ST[i + 1].d - ST[i].d) * f;
}
function sync(){
  const n = ST.length, now = performance.now();
  R.stop = n - 1; R.done = !!G.done; R.idx = G.done ? n : G.idx; R.typed = G.typed || 0; R.cur = clamp(G.arrivedI || 0, 0, n - 1);
  R.pos = trackS(G.pos); R.t = now / 1000; R.taps.length = 0; for (const x of G.taps) R.taps.push(x / 1000);
  R.lastT = Math.max(t0ride, R.taps.length ? R.taps[R.taps.length - 1] : -9);                // idle counts from the ride's first frame
}

/* ---------- canvas ---------- */
const safeOf = () => { if (!cv || !cv.isConnected) return {t: 0, r: 0, b: 0, l: 0}; const s = getComputedStyle(cv), dpr = devicePixelRatio || 1, q = n => Math.ceil((parseFloat(s.getPropertyValue(n)) || 0) * dpr / K);
  return {t: q('--sat'), r: q('--sar'), b: q('--sab'), l: q('--sal')}; };
function measure(){ const m = document.getElementById('mapWrap'), r = m ? m.getBoundingClientRect() : {width: innerWidth, height: innerHeight}, dpr = devicePixelRatio || 1;
  devW = Math.max(1, Math.round(r.width * dpr)); devH = Math.max(1, Math.round(r.height * dpr)); }
function resize(){
  const dpr = devicePixelRatio || 1; K = Math.max(1, Math.round(scale * dpr));
  if (!devW) measure();
  W = Math.max(64, Math.floor(devW / K)); H = Math.max(64, Math.floor(devH / K));
  if (art.c.width !== W || art.c.height !== H){ art.c.width = W; art.c.height = H; }
  if (cv.width !== devW || cv.height !== devH){ cv.width = devW; cv.height = devH; }
  PX.W = W; PX.H = H; PX.scale = scale; g.imageSmoothingEnabled = false; dg.imageSmoothingEnabled = false;
  const top = topCss ? Math.ceil(topCss * dpr / K) + 2 : 0, right = rightCss ? Math.ceil(rightCss * dpr / K) + 2 : 0;
  lay = UI.layout(W, H, {top, right, kb, safe: safeOf()}); chips = {x: W - right, y: 0, w: top && right ? right : 0, h: top && right ? top : 0, over: true};   // (the page's chips over the canvas)
  hopCache.clear(); zoomMode = zmOf();
  const m = cv.parentNode, v = lay.view, css = n => Math.round(n * K / dpr) + 'px';
  const bt = lay.attribution.h && lay.attribution.y < lay.board.y ? lay.attribution.y : lay.board.y;
  tbCss = v ? css(H - v.y - v.h + 2) : Math.round((H - bt) * K / dpr + 8) + 'px'; TD.k = '';
  if (m){ m.style.setProperty('--pxbb', tbCss); m.classList.toggle('pxTight', !!v);   // the toast sits above the LED board (and the attribution over it)
    for (const [k, x] of [['--pxtl', v && v.x + v.w / 2], ['--pxtw', v && v.w]]) x ? m.style.setProperty(k, css(x)) : m.style.removeProperty(k); }   // (…or in the map column)
}
/* the toast (DOM over the canvas: the start / keyboard notes) never covers the next-stop sign or its edge pointer: on a clash it moves
   just above the sign, else just below it, inside the free map area and off the cluster / chips; decided once per toast text */
const TD = {el: null, k: '', moved: false};
function toastDodge(ss){
  const t = TD.el || (TD.el = document.getElementById('toast')), m = cv.parentNode; if (!t || !m) return;
  if (!t.classList.contains('on')){ if (TD.moved){ TD.moved = false; m.style.setProperty('--pxbb', tbCss); } TD.k = ''; return; }
  const k = t.textContent + '|' + W + 'x' + H; if (TD.k === k) return; TD.k = k; if (TD.moved){ TD.moved = false; m.style.setProperty('--pxbb', tbCss); }
  const Ll = LABELS.last || {}, sg = (Ll.labels || []).find(l => l.i === ss.highlight) || (Ll.pointer && Ll.pointer.a > 0 ? Ll.pointer : null); if (!sg) return;
  const s = K / (devicePixelRatio || 1), mr = m.getBoundingClientRect(), tr = t.getBoundingClientRect(), b0 = parseFloat(tbCss) || 0;   // CSS px (s per art px)
  const at = b => ({x: tr.left - mr.left, y: mr.height - b - tr.height, w: tr.width, h: tr.height, b});
  const hit = (a, r) => r.w > 0 && r.h > 0 && a.x < (r.x + r.w + 3) * s && (r.x - 3) * s < a.x + a.w && a.y < (r.y + r.h + 3) * s && (r.y - 3) * s < a.y + a.h;
  if (!hit(at(b0), sg)) return;
  const ok = c => c.y >= (free().y + 2) * s && c.b >= b0 && ![sg, lay.cluster, chips].some(r => hit(c, r));
  const c = [at(mr.height - (sg.y - 3) * s), at(mr.height - (sg.y + sg.h + 3) * s - tr.height)].find(ok); if (!c) return;
  m.style.setProperty('--pxbb', Math.round(c.b) + 'px'); TD.moved = true;
}
const zmOf = () => red || (lay && lay.view) ? 'auto' : 'mix';            // reduced motion / the tight map column: fit-hop zoom
function blit(){
  dg.imageSmoothingEnabled = false; dg.fillStyle = PX.col('land.d1');
  if (devW > W * K) dg.fillRect(W * K, 0, devW - W * K, devH); if (devH > H * K) dg.fillRect(0, H * K, devW, devH - H * K);
  dg.drawImage(art.c, 0, 0, W * K, H * K);
}
function ensureCanvas(){
  if (cv) return;
  cv = document.createElement('canvas'); cv.id = 'pxCv'; cv.setAttribute('aria-hidden', 'true'); dg = cv.getContext('2d');
  if (!dg) throw new Error('RIDE: no 2D canvas');
  art = PX.makeCanvas(64, 64); g = art.g; aux = PX.makeCanvas(64, 64);
}

/* ---------- camera + adaptive zoom (mockup main.js, unchanged but for the ride data) ---------- */
const free = () => { if (lay.view) return lay.view; const top = lay.portrait ? lay.cluster.y + lay.cluster.h : 0, bot = lay.portrait ? Math.min(lay.board.y, lay.attribution.y - 1) : lay.board.y;
  return {x: 0, y: top, w: W, h: bot - top}; };
const anchor = () => { const f = free(); return {ax: f.x + (f.w >> 1), ay: Math.round(f.y + f.h / 2)}; };
const seg = () => { const a = Math.min(R.cur, R.stop - 1); return [a, a + 1]; };        // the hop the TRAIN is on
const P = s => TRAIN.along(s);
const hopCache = new Map(), boxCache = new Map();
const hopBox = a => { let c = boxCache.get(a); if (c) return c; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let s = ST[a].d; ; s = Math.min(ST[a + 1].d, s + 20)){ const p = P(s); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); if (s >= ST[a + 1].d) break; }
  boxCache.set(a, c = [(x0 + x1) / 2, (y0 + y1) / 2]); return c; };
const FILL = 1.5, AUTO_MIN = 2.5, CLOSE_MIN = 3.2, CLOSE_MAX = 4, FIN = 24;
function hopLevel(a, mode = zoomMode){
  const close = mode === 'close', k = a + '|' + mode + '|' + W + 'x' + H; if (hopCache.has(k)) return hopCache.get(k);
  const f = free(), Ls = LEVELS(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let s = ST[a].d; ; s = Math.min(ST[a + 1].d, s + 20)){ const p = P(s); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); if (s >= ST[a + 1].d) break; }
  const bw = x1 - x0 + 80, bh = y1 - y0 + 80; let lvl = Ls[Ls.length - 1];
  if (close){ const need = Math.max(bw / f.w, bh / f.h) / FILL; lvl = Ls[0];
    for (const l of Ls) if (Math.abs(Math.log(l / need)) < Math.abs(Math.log(lvl / need))) lvl = l;
    lvl = Math.max(AUTO_MIN, lvl); }
  else { for (const l of Ls){ const ex = TRAIN.span(l) / l + 20; if (bw / l + ex <= f.w && bh / l + ex <= f.h){ lvl = l; break; } }
    if (mode !== 'over' && lvl > 16) lvl = Math.max(16, hopLevel(a, 'close')); }
  hopCache.set(k, lvl); return lvl;
}
const closeLevel = a => clamp(hopLevel(a, 'close'), CLOSE_MIN, CLOSE_MAX);
const overLevel = a => Math.max(hopLevel(a, 'over'), closeLevel(a));
const wantLevel = () => { if (fin) return FIN; const a = seg()[0]; if (red) return overLevel(a); return zoomMode === 'mix' ? (MX.phase === 'over' ? overLevel(a) : closeLevel(a)) : hopLevel(a); };
const MX = {seg: -1, phase: 'over', dep: -1, rest: 0, tc: 0, dur: .6, stay: false, keep: -1, kc: -1, pre: false};
const GLIDE = .6, TIER_PAUSE = .2, BQ = 1.22, FIN_GLIDE = 1;
const MIX_OUT = .5, GLIDE_MIN = .3, OVER_MIN = .85, OVER_REST = 1, OVER_DEP = 1.1, CLOSE_ARR = .35, READ = .3, OVER_PLAN = .45, PLAN_M = .15;
/* s an overview needs before its glide close (from level `from` at the arrival): out to it, rest, plan, glide, arrive */
const needOf = (from, over, cl) => (from !== over ? MIX_OUT : 0) + OVER_REST + (over !== cl ? OVER_PLAN : 0) + CLOSE_ARR + PLAN_M;
const TB = [[5, 6.3], [16, 24]];
const cross = (a, b) => trans !== 'scale' || a === b ? [] : TB.filter(([lo, hi]) => Math.min(a, b) <= lo && Math.max(a, b) >= hi).map(([lo, hi]) => ({lo, hi, band: Math.max(a, b) >= hi * BQ - 1e-9}));
const glideTime = (a, b, dur = GLIDE) => a === b ? 0 : dur + TIER_PAUSE * cross(a, b).filter(c => !c.band).length;
/* letters/s of the current burst (window back to the first letter after the last ≥ 1.2 s gap, 0.6–3 s) · the fast-side rate */
function cpsOf(){
  const T = R.taps; let i = T.length - 1; if (i < 0) return 0;
  while (i > 0 && T[i - 1] > R.t - 3 && T[i] - T[i - 1] <= 1.2) i--;
  const win = clamp(R.t - Math.max(T[i], R.t - 3), .6, 3); let n = 0; for (const t of T) if (t > R.t - win - 1e-9) n++; return n / win;
}
function rateOf(){
  const T = R.taps, n = T.length; let r5 = 0;
  if (n >= 6 && T[n - 1] - T[n - 6] < 3 && R.t - T[n - 1] < 1) r5 = 5 / Math.max(.25, T[n - 1] - T[n - 6]);
  return Math.max(4, 1.1 * cpsOf(), 1.1 * r5);
}
/* letters still to type before platform b can be reached (the origin's own name first, as game.js plays it) */
const lettersTo = b => { if (!typing() || R.idx > b) return 0; let n = -R.typed; for (let k = R.idx; k <= b; k++) n += KEYS[k].length; return n; };
/* s until the train stands at platform b: letters left at the typist's rate (+ a reading gap) + the chase; 9 while paused mid-name */
function etaOf(b, fast = true){
  if (R.cur >= b) return 0;
  const left = lettersTo(b);
  if (!left){ const vmax = L.cap / G.kms, lead = Math.max(0, G.cum[b] - G.pos); return Math.max(0, CHASE * Math.log(1 + lead / (ARRIVE_V * vmax * CHASE))); }
  if (R.typed > 0 && R.t - R.lastT > 1) return 9;
  return (R.typed ? 0 : READ) + left / (fast ? rateOf() : Math.max(3, cpsOf())) + .25;
}
/* decided once per hop, at its departure (the arrival before it): an overview, then the glide close (MIX) — or, when the typist will be
   there before that fits (the ETA at the arrival), "ride close": a street-tier overview (≤ 5 m/px) is ridden framing the whole hop, a
   district / city one rides the 3.2–4 m/px follow from the departure; except a long hop (≥ LONG m of track, owner: Line 18's 5–12 km
   stretches), which stays on its overview framing the whole trip (stay) — even when the train gets there before the zoom out ends (the
   camera keeps the hop framed as far as it got; a long hop never rides close). By track length, never by the window (a phone's
   overviews are all district tier). Never re-decided mid-hop (a re-aim keeps it: MX.keep / MX.kc); a long one decided with the pace
   unknown (the ride's start, a re-aim at a platform: MX.pre) is taken again once, at the departure or at its glide if that comes
   first, still at the overview */
const LONG = 5000, longHop = a => ST[a + 1].d - ST[a].d >= LONG;
function mixPhase(dt){
  if (fin) return;
  const [a, b] = seg(), dA = ST[a].d, Lh = ST[b].d - dA, p = (R.pos - dA) / Lh;
  if (cam.snap || MX.seg !== a){
    const fresh = !cam.snap && MX.seg >= 0; MX.seg = a; MX.dep = -1; MX.rest = 0; MX.tc = 0; MX.dur = GLIDE; MX.stay = false;
    const over = overLevel(a), cl = closeLevel(a), lg = longHop(a);
    if (!fresh){ MX.phase = MX.keep === a || !(MX.kc === a || cam.snap && p > .02) ? 'over' : 'close';
      MX.stay = MX.keep === a || (MX.phase === 'over' && over > cl * 1.001 && (lg || over <= 5 + 1e-9) && etaOf(b, false) < needOf(over, over, cl)); MX.pre = lg && MX.phase === 'over' && !MX.stay; }
    else { const from = Z.pend !== null ? Z.pend : Z.to, eta = etaOf(b, false), fast = over > cl * 1.001 && eta < needOf(from, over, cl);
      MX.pre = false; MX.stay = fast && (lg || over <= 5 + 1e-9); MX.phase = fast && !MX.stay ? 'close' : 'over'; MX.kc = fast && !MX.stay ? a : -1; }
    MX.keep = MX.stay ? a : -1; planPush(true);
  }
  if (zoomMode !== 'mix') return;
  if (!cam.snap){ if (MX.phase === 'over' && !MX.stay && !MX.pre) prefetchMix(a, 'in'); prefetchMix(a + 1, 'out'); const pn = planOf(a + 1); if (!pn.stay || pn.stay === pn.close) prefetchMix(a + 1, 'in'); }   // (a one-level hop still glides its focus in)
  if (MX.phase === 'close'){ MX.tc += dt; return; }
  const over = overLevel(a), cl = closeLevel(a), atOver = Z.u >= 1 && Z.pend === null && Z.to === over;
  const late = () => { MX.pre = false; if (atOver && longHop(a) && over > cl * 1.001 && etaOf(b, false) < needOf(over, over, cl)){ MX.stay = true; MX.keep = a; } planPush(true); return MX.stay; };
  if (R.pos > dA + .05){ MX.dep = MX.dep < 0 ? 0 : MX.dep + dt; if (MX.pre) late(); }
  if (atOver) MX.rest += dt;
  else if (!MX.stay && Z.to !== over && Z.u >= 1 && Z.xa < 0 && p > .1){ MX.phase = 'close'; MX.tc = 0; return; }
  if (!atOver || p >= .97 || MX.stay) return;
  const eta = etaOf(b), full = glideTime(over, cl, GLIDE), urgent = eta <= full + CLOSE_ARR + .05;
  const pre = cross(over, cl).some(c => !c.band) ? TIER_PAUSE : 0;
  if (MX.rest + pre < OVER_MIN || (!urgent && MX.dep < OVER_DEP) || (MX.pre && late())) return;
  MX.dur = urgent ? clamp(eta - CLOSE_ARR - (full - GLIDE), GLIDE_MIN, GLIDE) : GLIDE;
  MX.phase = 'close'; MX.tc = 0;
}
/* the camera's plan per hop from the train's on, for WORLD.setPlan (world.js bakes ahead exactly the levels it will visit): {i, close,
   over, stay: the one level the hop is ridden at, else null (overview → glide close)}. The current hop as decided; the ones ahead
   predicted at the typist's pace with the whole next name still to type (≥ the ETA its arrival will see: at an unchanged pace a
   predicted stay comes true). Pushed at each decision and, when a prediction flips (the pace changed), within 0.5 s */
let PL = [], plT = -9, plSig = '', plOn = false;                        // plOn: a ride is prepared / running (not the menu's RIDE.plan)
function planList(){
  const a0 = seg()[0], out = [], r = Math.max(3, cpsOf()); let from = null;
  for (let i = a0; i < LAST; i++){
    const cl = closeLevel(i), ov = overLevel(i);
    const stay = red || zoomMode !== 'mix' ? (red ? ov : hopLevel(i)) : ov <= cl * 1.001 ? cl : i === a0 && MX.seg === a0 && !MX.pre ? (MX.stay ? ov : MX.kc === a0 ? cl : null)
      : (e => e < needOf(from, ov, cl) ? (longHop(i) || ov <= 5 + 1e-9 ? ov : cl) : null)(READ + KEYS[i + 1].length / r + .25);
    out.push({i, close: cl, over: ov, stay}); from = stay || cl;
  }
  return out;
}
const planOf = i => PL.find(p => p.i === i) || {i, stay: null};
function planPush(force){
  if (fin || !ST.length || (!force && clock - plT < .5)) return; plT = clock; PL = planList(); if (!plOn) return;
  const sig = PL.map(p => p.i + ':' + p.close + ':' + p.over + ':' + p.stay).join(' '); if (sig === plSig) return; plSig = sig;
  if (typeof WORLD !== 'undefined' && typeof WORLD.setPlan === 'function') WORLD.setPlan(PL.map(p => Object.assign({}, p)));
}
const Z = {from: 3.2, to: 3.2, u: 1, pend: null, pendT: 0, xa: -1, pd: false, dur: .6, stall: 0, restT: 9, e0: null};
const crossings = () => cross(Z.from, Z.to);
const mppAt = u => u >= 1 ? Z.to : Math.exp(Math.log(Z.from) + (Math.log(Z.to) - Math.log(Z.from)) * smooth(u));
const cam = {fx: 0, fy: 0, vx: 0, vy: 0, ix: 0, iy: 0, il: 0, px: 0, py: 0, bx: 0, by: 0, snap: true, pos: 0, settle: 0, seg: -1, aim: 0};
const mppNow = () => mppAt(Z.u);
function snap(){ cam.snap = true; MX.seg = -1; mixPhase(0); const l = wantLevel(); Z.from = Z.to = l; Z.u = 1; Z.pend = null; Z.xa = -1; }
const LM = {cantonTower: [110, 600], ifc: [70, 440], ctf: [75, 530]};
function mixW(mpp){
  if (zoomMode !== 'mix' || MX.phase !== 'close' || fin) return 0;
  const a = seg()[0], o = overLevel(a), c = closeLevel(a);
  return o > c * 1.001 ? clamp(Math.log(o / mpp) / Math.log(o / c), 0, 1) : smooth(clamp(MX.tc / MX.dur, 0, 1));
}
/* the focus target at mpp for the head at arc sh: ¼ toward the next platform, then the constraints (next platform + sign in the free
   area < the whole train < landmarks / platforms / the train off the cluster < the train again (an overview: < the sign again < the
   train with slim margins) < the bounds) → [fx, fy, bx, by] */
function focusTarget(mpp, sh, w = mixW(mpp), sg = null){
  const [a, b] = sg || seg(), H0 = P(sh), A = P(ST[a].d), Bp = P(ST[b].d), f = free(), c = lay.kb && !lay.view ? chips : lay.cluster, {ax, ay} = anchor(), E = 14;   // (keyboard up: no cluster, the page's chips)
  let fx = H0.x + .25 * (Bp.x - H0.x), fy = H0.y + .25 * (Bp.y - H0.y);
  const scr = p => [ax + (p.x - fx) / mpp, ay - (p.y - fy) / mpp];
  if (fin && !sg){ const T = P(ST[LAST].d); fx = T.x; fy = T.y; return [fx, fy, ...scr(T)]; }   // the run is over: the terminus, centred
  if (zoomMode === 'mix' && w < 1){ const cc = hopBox(a); fx = cc[0] + (fx - cc[0]) * w; fy = cc[1] + (fy - cc[1]) * w; }
  const keepIn = (p, m, bx = [0, 0, 0, 0]) => { const [sx, sy] = scr(p), l = sx + bx[0], t = sy + bx[1], r = sx + bx[2], bt = sy + bx[3], [mx, my] = typeof m === 'number' ? [m, m] : m;
    if (l < f.x + mx) fx -= (f.x + mx - l) * mpp; else if (r > f.x + f.w - mx) fx += (r - (f.x + f.w - mx)) * mpp;
    if (t < f.y + my) fy += (f.y + my - t) * mpp; else if (bt > f.y + f.h - my) fy -= (bt - (f.y + f.h - my)) * mpp; };
  const bd = WORLD.bounds ? WORLD.bounds() : null, inB = () => { if (bd){ fx = clamp(fx, bd.x0 + ax * mpp, Math.max(bd.x0 + ax * mpp, bd.x1 - (W - ax) * mpp)); fy = clamp(fy, bd.y0 + (H - ay) * mpp, Math.max(bd.y0 + (H - ay) * mpp, bd.y1 - ay * mpp)); } };
  const sBox = i => { const Lb = LABELS.placement && !sg ? LABELS.placement(Z.to, kf, b)[i] : null, m = [-7, -7, 7, 7];
    return Lb && Lb.show ? [Math.min(m[0], Lb.dx), Math.min(m[1], Lb.dy), Math.max(m[2], Lb.dx + Lb.w + 1), Math.max(m[3], Lb.dy + Lb.h + 1)] : m; };
  if (red && !sg){ const cc = hopBox(a); fx = cc[0]; fy = cc[1]; keepIn(A, 8); keepIn(Bp, 4, sBox(b)); inB(); return [fx, fy, ...scr(Bp)]; }   // reduced motion: the hop holds still
  const across = Math.abs(Bp.y - A.y) >= Math.abs(Bp.x - A.x);
  const offCluster = (p, bx, wt = 1) => { if ((lay.portrait && c !== chips) || !c.w || wt <= 0) return; const [sx, sy] = scr(p), m = 6;   // (portrait: only the chips, keyboard up)
    const pl = sx + bx[2] - (c.x - m), pr = c.x + c.w + m - (sx + bx[0]), pt = sy + bx[3] - (c.y - m), pb = c.y + c.h + m - (sy + bx[1]);
    if (pl <= 0 || pr <= 0 || pt <= 0 || pb <= 0) return;
    if (c === chips){ if (pl <= pb) fx += pl * mpp * wt; else fy += pb * mpp * wt; }   // (the chips hug the top-right corner: out left or down)
    else if (across) fx += Math.min(pl, pt, pb) * mpp * wt; else fy += Math.min(pb, pl, pr) * mpp * wt; };
  const tail = P(sh - TRAIN.span(levelFor(mpp)));
  const sC = zoomMode === 'mix' && w < 1 ? ST[a].d + (sh - ST[a].d) * w : sh, HC = sC === sh ? H0 : P(sC), tailC = sC === sh ? tail : P(sC - TRAIN.span(levelFor(mpp)));
  const Q = P(Math.min(ST[b].d, sh + .5 * Math.max(f.w, f.h) * mpp)), qx = (Q.x - H0.x) / mpp, qy = (H0.y - Q.y) / mpp, ql = Math.hypot(qx, qy);
  const u = ql > 2 ? [qx / ql, qy / ql] : [0, 0], LA = .3;
  const mT = [0, 1].map(k => E + 6 + w * Math.abs(u[k]) * Math.max(0, LA * (k ? f.h : f.w) - E - 6));
  const keepHead = p => { const [sx, sy] = scr(p), m = E + 6;
    const [l, r] = u[0] >= 0 ? [mT[0], m] : [m, mT[0]], [t, bt] = u[1] >= 0 ? [mT[1], m] : [m, mT[1]];
    if (sx < f.x + l) fx -= (f.x + l - sx) * mpp; else if (sx > f.x + f.w - r) fx += (sx - (f.x + f.w - r)) * mpp;
    if (sy < f.y + t) fy += (f.y + t - sy) * mpp; else if (sy > f.y + f.h - bt) fy -= (sy - (f.y + f.h - bt)) * mpp; };
  keepIn(Bp, 4, sBox(b)); keepIn(tailC, E); keepHead(HC);
  const ext = Math.abs(u[0]) * f.w + Math.abs(u[1]) * f.h || Math.min(f.w, f.h), togo = ST[b].d - sh;
  const wA = w * Math.max(clamp((.9 * ext - togo / mpp) / (.3 * ext), 0, 1), clamp((.22 - togo / (ST[b].d - ST[a].d)) / .1, 0, 1));
  if (wA > 0){ const x0 = fx, y0 = fy; keepIn(Bp, 12, sBox(b)); fx = x0 + (fx - x0) * wA; fy = y0 + (fy - y0) * wA; }
  for (const l of (WORLD.landmarkSites ? WORLD.landmarkSites() : D.landmarks) || []){ const t = LM[l.id]; if (!t) continue;
    if (Math.min(Math.hypot(l.x - A.x, l.y - A.y), Math.hypot(l.x - Bp.x, l.y - Bp.y)) > 900) continue;
    const hw = t[0] / 2 / mpp; offCluster(l, [-hw, -((l.h || t[1]) * kf + t[0] / 2) / mpp, hw, t[0] / 2 / mpp]); }
  offCluster(A, sBox(a), Math.max(1 - w, clamp(1 - (sh - ST[a].d - 30) / 90, 0, 1)));
  offCluster(Bp, sBox(b));
  for (const q of [tailC, P(sC - TRAIN.span(levelFor(mpp)) / 2), HC]) offCluster(q, [-9, -9, 9, 9]);
  keepIn(tail, E); keepIn(H0, E + 6);
  if (zoomMode === 'mix' && w < 1){ const x0 = fx, y0 = fy; keepIn(Bp, 4, sBox(b)); keepIn(tail, 2); keepIn(H0, 4); fx = x0 + (fx - x0) * (1 - w); fy = y0 + (fy - y0) * (1 - w); }   // (an overview: the next stop's whole sign before the train's margins, never the train)
  inB();
  return [fx, fy, ...scr(Bp)];
}
function framingOff(mpp){
  if (MX.phase !== 'close' || fin) return false;
  const [a, b] = seg(), f = free(), {ax, ay} = anchor(), s = R.pos, B = P(ST[b].d), H0 = P(s), togo = ST[b].d - s;
  const scr = p => [ax + (p.x - cam.fx) / mpp, ay - (p.y - cam.fy) / mpp], [bx, by] = scr(B);
  if ((bx < f.x + 4 || by < f.y + 4 || bx >= f.x + f.w - 4 || by >= f.y + f.h - 4) && (togo < .2 * (ST[b].d - ST[a].d) || togo / mpp < .85 * Math.max(f.w, f.h))) return true;
  const Q = P(Math.min(ST[b].d, s + .5 * Math.max(f.w, f.h) * mpp)), qx = (Q.x - H0.x) / mpp, qy = (H0.y - Q.y) / mpp, ql = Math.hypot(qx, qy); if (ql < 2) return false;
  const [hx, hy] = scr(H0), ux = qx / ql, uy = qy / ql;
  const lead = Math.min(ux > .3 ? f.x + f.w - hx : 1e9, ux < -.3 ? hx - f.x : 1e9, uy > .3 ? f.y + f.h - hy : 1e9, uy < -.3 ? hy - f.y : 1e9);
  return lead < .2 * (Math.abs(ux) > Math.abs(uy) ? f.w : f.h);
}
const intFocus = lvl => lvl === cam.il ? [cam.ix, cam.iy] : [Math.round(cam.fx / lvl), Math.round(-cam.fy / lvl)];
const uiRects = () => ({cluster: lay.cluster, board: {...lay.board, h: H - lay.board.y}, attribution: lay.attribution, free: free()});
function viewAt(lvl, mpp = lvl, lvlTo = lvl, mix = null, dt = 0){
  const {ax, ay} = anchor(), rest = Math.abs(mpp - lvl) < 1e-9, [ix, iy] = rest ? intFocus(lvl) : [0, 0];
  return GEOM.view({lvl, mpp, lvlTo, k: kf, cx: rest ? ix * lvl : cam.fx, cy: rest ? -iy * lvl : cam.fy, ax, ay, W, H, t: clock, dt, theme: PX.theme, mix, seq, ui: uiRects()});
}
const pfDone = new Set();
const pfKey = () => '|' + kf + '|' + PX.theme + '|' + W + 'x' + H;
function prefetchHop(a){
  if (!WORLD.prefetch || a < 1 || a >= R.stop) return;
  const Ls = LEVELS(), l0 = hopLevel(a - 1), l1 = hopLevel(a), A = P(ST[a].d), B = P(ST[a + 1].d), hi = Math.max(l0, l1);
  const fx = A.x + .25 * (B.x - A.x), fy = A.y + .25 * (B.y - A.y);
  for (const l of Ls.filter(l => l >= Math.min(l0, l1) && l <= hi)){
    const k = a + '|' + l + pfKey(); if (pfDone.has(k)) continue; pfDone.add(k);
    const c = l < hi ? minZs(l, l0, l1) : l, hw = (W / 2 + 32) * c, hh = (H / 2 + 32) * c;   // (as zoomViews draws it: the top level only at rest)
    WORLD.prefetch(l, {x0: fx - hw, y0: fy - hh, x1: fx + hw, y1: fy + hh}, kf);
  }
}
function glideS(a, dm = 0){
  const b = a + 1, n = KEYS[b].length, typedNow = R.idx === b ? R.typed : R.idx > b ? n : 0, r = rateOf();
  const full = glideTime(overLevel(a), closeLevel(a), GLIDE), m = clamp(Math.min(n - Math.ceil(r * (full + CLOSE_ARR)), Math.round(r * OVER_DEP)) + dm, typedNow, n - 1);
  const A = ST[a].d, B = ST[b].d, p = m / n; return Math.max(A + (B - A) * (p + (smooth(p) - p) * EASE), a === seg()[0] ? R.pos : A);
}
function glideViews(a, o = overLevel(a), c = closeLevel(a)){
  const sc = glideS(a), {ax, ay} = anchor();
  return LEVELS().filter(l => l >= c && l < o).map(l => { const w = o > c ? clamp(Math.log(o / l) / Math.log(o / c), 0, 1) : 1, f = focusTarget(l, sc, w);
    return GEOM.view({lvl: l, mpp: minZs(l, c, o), lvlTo: c, k: kf, cx: f[0], cy: f[1], ax, ay, W, H, t: clock, dt: 0, theme: PX.theme, mix: null, seq, ui: uiRects()}); });
}
const minZs = (l, a, b) => { const Ls = LEVELS(), nx = Ls[Ls.indexOf(l) + 1] - 1e-6, X = cross(a, b).find(x => x.band && x.lo === l); return X ? X.hi * BQ : nx; };
function prefetchMix(a, dir){
  if (!WORLD.prefetch || a < 0 || a >= LAST) return;
  const Ls = LEVELS(), o = overLevel(a), [s0, s1] = [ST[a].d, ST[a + 1].d], cur = seg()[0] === a, sg = cur ? null : [a, a + 1];
  const box = (l, pts, rest, c0 = l, c1 = l) => { const m = rest ? l : minZs(l, c0, c1), hw = (W / 2 + 24) * m, hh = (H / 2 + 24) * m;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    WORLD.prefetch(l, {x0: Math.min(...xs) - hw, y0: Math.min(...ys) - hh, x1: Math.max(...xs) + hw, y1: Math.max(...ys) + hh}, kf, true); };
  const pa = cur ? null : planOf(a), rc = !!pa && pa.stay != null && pa.stay === pa.close && o > pa.close * 1.001;   // (hop a predicted to ride close: no overview, no glide)
  if (dir === 'in'){
    const c = closeLevel(a), sc = glideS(a), q = Math.floor((sc - s0) / (s1 - s0) * 10);
    const k = 'in|' + a + '|' + q + (rc ? 'c' : '') + pfKey(); if (pfDone.has(k)) return; pfDone.add(k);
    if (!rc) for (const dm of [0, 1, -1]){ const s = dm ? glideS(a, dm) : sc;
      for (const l of Ls.filter(l => l >= c && l < o).reverse()){
        const w = o > c ? clamp(Math.log(o / l) / Math.log(o / c), 0, 1) : 1, f = focusTarget(l, s, w, sg); box(l, [[f[0], f[1]]], false, c, o); } }
    const f = focusTarget(c, Math.min(s1, sc + (s1 - s0) * .25), 1, sg); box(c, [[f[0], f[1]]], true);
    if (traffic() && TRAFFIC.prefetch){ const hw = (W / 2 + 24) * c, hh = (H / 2 + 24) * c; TRAFFIC.prefetch({x0: f[0] - hw, y0: f[1] - hh, x1: f[0] + hw, y1: f[1] + hh}); }
  } else {                                                               // (from the level hop a − 1 ends at: close, or its overview when stayed,
    const pp = planOf(a - 1), st = a > 0 && (a - 1 === seg()[0] ? MX.stay : !!pp.stay && pp.stay !== pp.close), c = a > 0 ? (st ? overLevel(a - 1) : closeLevel(a - 1)) : o;
    const t = rc ? pa.close : o, k = 'out|' + a + '|' + c + '|' + t + pfKey(); if (pfDone.has(k)) return; pfDone.add(k);   // to hop a's overview, or its close follow)
    const fc = a > 0 ? focusTarget(c, s0, st ? 0 : 1, [a - 1, a]) : null, ft = focusTarget(t, s0, rc ? 1 : 0, [a, a + 1]);
    for (const l of Ls.filter(l => l >= Math.min(c, t) && l <= t || l > t && l < c)) box(l, l === t ? [ft] : fc ? [fc, ft] : [ft], l === t, c, t);   // (in from a coarser c: c only rests, on screen)
  }
}
function prefetchCorridor(a, l){
  const k = 'c' + a + '|' + l + pfKey(); if (!WORLD.prefetch || pfDone.has(k)) return; pfDone.add(k);
  const hw = (W / 2 + 24) * l, hh = (H / 2 + 24) * l;
  for (let s = ST[a].d; ; s = Math.min(ST[a + 1].d, s + Math.max(hw, hh))){ const p = P(s); WORLD.prefetch(l, {x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh}, kf); if (s >= ST[a + 1].d) break; }
}
function zoomViews(from, to){
  const Ls = LEVELS(), lo = Math.min(from, to), hi = Math.max(from, to);
  if (trans === 'dissolve') return [viewAt(from, from, to, {v: viewAt(to), a: .5})];
  return Ls.filter(l => l >= lo && l <= hi).map(l => l < hi ? viewAt(l, minZs(l, from, to), to) : viewAt(l));
}
const rectOf = (v, m) => ({x0: (v.ox - m) * v.lvl, x1: (v.ox + v.W / v.zs + m) * v.lvl, y0: -(v.oy + v.H / v.zs + m) * v.lvl, y1: -(v.oy - m) * v.lvl});
/* a zoom / glide starts: its target level and view rect (world metres, at the target's focus) to WORLD.hint (world.js readies that level) */
const hint = l => { if (typeof WORLD.hint !== 'function') return; const f = focusTarget(l, R.pos), {ax, ay} = anchor();
  WORLD.hint(l, {x0: f[0] - ax * l, y0: f[1] - (H - ay) * l, x1: f[0] + (W - ax) * l, y1: f[1] + ay * l}, kf); };
function updateCamera(dt){
  if (red && !fin && cam.seg >= 0 && seg()[0] !== cam.seg) snap();      // reduced motion: a cut at every new hop
  mixPhase(dt);
  const want = wantLevel(), S = R;
  if (cam.snap || red){ Z.from = Z.to = want; Z.u = 1; Z.pend = null; Z.xa = -1; }
  if (Z.pend !== null && want !== Z.pend){ Z.pend = want === Z.to ? null : want; Z.pendT = 0; if (Z.pend !== null) hint(want); }
  const hold = zoomMode === 'mix' && !cam.snap && !fin && want > Z.to && MX.phase === 'over' && Z.restT < .2;
  if (Z.u >= 1 && Z.xa < 0 && Z.pend === null && want !== Z.to && !hold){ Z.pend = want; Z.pendT = 0; hint(want);
    if (WORLD.prefetch) for (const v of zoomViews(Z.to, Z.pend)){ WORLD.prefetch(v.lvl, rectOf(v, 24), kf, true); if (v.mix) WORLD.prefetch(v.mix.v.lvl, rectOf(v.mix.v, 24), kf, true); } }
  if (Z.pend !== null){
    Z.pendT += dt;
    const mix = zoomMode === 'mix', vs = zoomViews(Z.to, Z.pend), ord = Z.pend > Z.to ? vs : vs.slice().reverse();
    const ok = !WORLD.ready || vs.every(v => WORLD.ready(v)) || (mix && WORLD.bakeSome && WORLD.bakeSome(ord.slice(0, 2), 5) && Z.pendT >= .05);
    if (ok || Z.pendT >= (mix ? .12 : .25)){ Z.from = Z.to; Z.to = Z.pend; Z.pend = null; Z.u = Z.from === Z.to ? 1 : 0; Z.xa = -1; Z.pd = false; Z.stall = 0; Z.restT = 0; Z.e0 = null;
      Z.dur = fin ? FIN_GLIDE : !mix ? GLIDE : Z.to > Z.from ? MIX_OUT : MX.dur; }
  }
  if (Z.u < 1 || Z.xa >= 0){
    const pc = crossings().find(x => !x.band), out = Z.to > Z.from; let rest = dt;
    while (rest > 1e-9 && (Z.u < 1 || Z.xa >= 0)){
      if (Z.xa >= 0){ const d = Math.min(rest, (1 - Z.xa) * TIER_PAUSE); Z.xa += d / TIER_PAUSE; rest -= d; if (Z.xa >= 1 - 1e-9){ Z.xa = -1; Z.pd = true; } continue; }
      if (pc && !Z.pd && !out && Z.u <= 0){ Z.xa = 0; continue; }
      const un = Math.min(1, Z.u + rest / Z.dur);
      if (WORLD.bakeSome){ const vs = glideWorld(mppAt(un), 0); if (Z.u > 0) vs.push(viewAt(Z.to));
        if (!vs.every(v => WORLD.ready(v))){ const done = WORLD.bakeSome(vs, Z.u <= 0 && Z.stall < .35 ? 5 : 4); if (!done && Z.u <= 0 && Z.stall < .35){ Z.stall += rest; break; } } }
      rest -= (un - Z.u) * Z.dur; Z.u = un;
      if (Z.u >= 1 && pc && !Z.pd && out) Z.xa = 0;
    }
  }
  Z.restT = Z.u >= 1 && Z.xa < 0 ? Z.restT + dt : 0;
  if (Z.restT > 0) Z.e0 = null;
  const mpp = mppNow(), still = Z.u >= 1 && Z.xa < 0 && Z.pend === null, [a] = seg(), H0 = P(S.pos);
  const [tx, ty, bx, by] = focusTarget(mpp, S.pos);
  const lt = Z.pend !== null ? Z.pend : Z.to, hb = Math.abs(lt - mpp) < 1e-9 ? [bx, by] : focusTarget(lt, S.pos).slice(2);
  cam.bx = hb[0]; cam.by = hb[1];
  if (a !== cam.seg){ cam.seg = a; cam.aim = 0; } cam.aim += dt;
  const run = S.pos > cam.pos + 1e-4, ck = a + '|' + mpp;
  if (cam.snap){ cam.fx = tx; cam.fy = ty; cam.vx = cam.vy = 0; }
  else if (dt){
    const P0 = P(cam.pos), dTx = H0.x - P0.x, dTy = H0.y - P0.y, dT = Math.hypot(dTx, dTy), x0 = cam.fx, y0 = cam.fy;
    const dmx = tx - cam.tx, dmy = ty - cam.ty, dm = Math.hypot(dmx, dmy), jump = dm > dT + 3 * mpp, same = cam.ck === ck;
    const sff = !same ? 0 : jump ? dT / dm : 1, ex = cam.fx + dmx * sff - tx, ey = cam.fy + dmy * sff - ty, w = 1 / .15;
    cam.vx += (-w * w * ex - 2 * w * cam.vx) * dt; cam.vy += (-w * w * ey - 2 * w * cam.vy) * dt;
    cam.fx = tx + ex + cam.vx * dt; cam.fy = ty + ey + cam.vy * dt;
    if (zoomMode === 'mix' && (Z.u < 1 || Z.xa >= 0)){
      if (!Z.e0) Z.e0 = [x0 - tx, y0 - ty];
      const pr = Z.u >= 1 ? 1 : smooth(clamp(Z.u, 0, 1)); cam.fx = tx + Z.e0[0] * (1 - pr); cam.fy = ty + Z.e0[1] * (1 - pr); cam.vx = cam.vy = 0; }
    const mixFree = zoomMode === 'mix' && (!still || MX.phase === 'over' || mixW(mpp) < 1 || fin);
    if (run && dT > 1e-6 && !mixFree){ const ux = dTx / dT, uy = dTy / dT, al = (cam.fx - x0) * ux + (cam.fy - y0) * uy;
      const cap = dT * (zoomMode === 'mix' && framingOff(mpp) ? 1.6 : 1);
      const cut = al > cap ? al - cap : still && cam.aim > 1 && al < 0 ? al : 0;
      if (cut){ cam.fx -= cut * ux; cam.fy -= cut * uy; const bv = cut / dt; cam.vx -= bv * ux; cam.vy -= bv * uy; } }
    if (!fin){ const f = free(), {ax, ay} = anchor(), sx = ax + (H0.x - cam.fx) / mpp, sy = ay - (H0.y - cam.fy) / mpp, m = 8;
      if (sx < f.x + m) cam.fx -= (f.x + m - sx) * mpp; else if (sx > f.x + f.w - m) cam.fx += (sx - f.x - f.w + m) * mpp;
      if (sy < f.y + m) cam.fy += (f.y + m - sy) * mpp; else if (sy > f.y + f.h - m) cam.fy -= (sy - f.y - f.h + m) * mpp; }
  }
  const Lv = Z.to, fx = cam.fx / Lv, fy = -cam.fy / Lv;
  if (cam.snap || cam.il !== Lv || !still){
    const dir = (f, d) => d > 1e-3 ? Math.ceil(f - .05) : d < -1e-3 ? Math.floor(f + .05) : Math.round(f);
    cam.il = Lv; cam.ix = dir(fx, fx - cam.px); cam.iy = dir(fy, fy - cam.py); cam.hs = null; cam.hr = [H0.x / Lv - fx, -H0.y / Lv - fy]; }
  else {
    const h = TRAIN.headPx(S.pos, Lv), hf = [H0.x / Lv, -H0.y / Lv];
    if (!cam.hd) cam.hd = [0, 0];
    if (!cam.hs && cam.hr && run && last && last.ss.cars && last.ss.cars[0]){ const {ax, ay} = anchor(); cam.hs = [last.ss.cars[0].x - ax, last.ss.cars[0].y - ay]; }
    const one = (f, pf, i, k) => {
      const d = f - pf, r = Math.round(f), rel = hf[k] - f, dr = cam.hs ? rel - cam.hr[k] : 0;
      if (run && Math.abs(dr) > 1e-4) cam.hd[k] = Math.sign(dr);
      if (!run && Math.abs(d) < .02){
        if (Math.abs(f - i) < .8) return i;
        return Math.abs(f - i) >= 1.5 || Math.sign(i - r) * cam.hd[k] >= 0 ? r : i; }
      let lo = -1e9, hi = 1e9;
      if (d > 1e-4) lo = i; else if (d < -1e-4) hi = i;
      if (run && cam.hs){ if (dr > 1e-4) hi = Math.min(hi, h[k] - cam.hs[k]); else if (dr < -1e-4) lo = Math.max(lo, h[k] - cam.hs[k]); }
      let n = r, best = 1e9;
      for (const c of [r - 1, r, r + 1, h[k] - Math.round(rel)]){
        if (c < lo || c > hi) continue; const e = Math.abs(c - f) + Math.abs(h[k] - c - rel) + .6 * Math.abs(c - i - d); if (e < best - 1e-9){ best = e; n = c; } }
      if (Math.abs(n - f) > 1.2) n = r; return n;
    };
    cam.ix = one(fx, cam.px, cam.ix, 0); cam.iy = one(fy, cam.py, cam.iy, 1);
    cam.hs = [h[0] - cam.ix, h[1] - cam.iy]; cam.hr = [hf[0] - fx, hf[1] - fy];
  }
  cam.snap = false; cam.pos = S.pos; cam.px = fx; cam.py = fy; cam.tx = tx; cam.ty = ty; cam.ck = ck;
  cam.settle = still ? cam.settle + dt : 0;
  if (still && cam.settle >= .3 && !fin){
    if (zoomMode === 'mix') prefetchCorridor(seg()[0], Z.to);
    else { prefetchHop(seg()[0] + 1); prefetchCorridor(seg()[0], Z.to); } }
}
function glideAt(mpp, dt){
  for (const X of crossings()) if (!X.band && Z.pd && Z.to < Z.from && mpp >= X.hi - 1e-9){ const v = viewAt(X.lo, X.hi, Z.to, null, dt); return {w: v, d: v}; }
  for (const X of crossings()) if (X.band && mpp > X.hi + 1e-9 && mpp < X.hi * BQ - 1e-9){
    const F = viewAt(X.lo, mpp, Z.to, null, dt), C = viewAt(X.hi, mpp, Z.to, null, dt), c = Math.log(mpp / X.hi) / Math.log(BQ), d = c >= .5 ? C : F;
    return {w: d, d, x: {F, C, c}}; }
  const Ls = LEVELS(); let l = levelFor(mpp);
  if (Z.u > 0 && Z.u < 1){ if (mpp < l && Ls.indexOf(l) > 0) l = Ls[Ls.indexOf(l) - 1]; else if (Math.abs(mpp - l) < 1e-7) mpp = l * (1 + 1e-6); }
  const v = viewAt(l, mpp, Z.to, null, dt); return {w: v, d: v};
}
const glideWorld = (mpp, dt) => { const V = glideAt(mpp, dt); return V.x ? [V.x.F, V.x.C] : [V.w]; };
function views(dt){
  const mpp = mppNow();
  if ((Z.u >= 1 && Z.xa < 0) || Z.from === Z.to){ const v = viewAt(Z.to, Z.to, Z.to, null, dt); return {w: v, d: v}; }
  if (trans === 'dissolve'){
    const a = Z.u, vf = viewAt(Z.from, Z.from, Z.to, null, dt), vt = viewAt(Z.to, Z.to, Z.to, null, dt);
    return {w: viewAt(Z.from, Z.from, Z.to, {v: vt, a}, dt), d: a < .5 ? vf : vt};
  }
  if (Z.xa >= 0){ const X = crossings().find(x => !x.band), out = Z.to > Z.from, F = viewAt(X.lo, X.hi, Z.to, null, dt), C = viewAt(X.hi, X.hi, Z.to, null, dt), c = out ? Z.xa : 1 - Z.xa;
    const d = c >= .5 ? C : F; return {w: d, d, x: {F, C, c}}; }
  return glideAt(mpp, dt);
}

/* ---------- weather + traffic (optional modules; a throwing WEATHER is switched off, the ride goes on) ---------- */
let wxDead = false, gov = 0;
const hasWX = () => !wxDead && gov < 2 && !red && typeof WEATHER !== 'undefined' && WEATHER && typeof WEATHER.update === 'function';
const wx = (name, ...a) => { if (!hasWX() || typeof WEATHER[name] !== 'function') return; try { WEATHER[name](...a); } catch (e) { console.error('WEATHER.' + name, e); wxDead = true; } };
const traffic = () => gov < 2 && !red && typeof TRAFFIC !== 'undefined';

/* ---------- frame ---------- */
function stationsState(){
  const next = !typing() && R.cur >= R.stop ? -1 : Math.min(LAST, R.cur + 1);
  return {status: ST.map((s, i) => i <= R.cur ? 'done' : i === next ? 'next' : 'todo'), next, highlight: next >= 0 ? next : R.cur, trainS: R.pos, cur: R.cur, landmarks: [], cars: [],
    hold: Z.pend !== null || Z.u < 1 || Z.xa >= 0, hiAt: {x: cam.bx, y: cam.by}};
}
/* the tier dither's mask: PX.bayer repeats every 4 px, so one 4 × 4 tile per step q (opaque where bayer ≥ q / 16) as a canvas pattern */
const masks = [];
function bayerMask(q){
  if (aux.c.width !== W || aux.c.height !== H){ aux.c.width = W; aux.c.height = H; aux.g.imageSmoothingEnabled = false; }
  let m = masks[q]; if (m) return m;
  const t = PX.makeCanvas(4, 4), img = t.g.createImageData(4, 4), d = img.data;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (PX.bayer(x, y) >= q / 16) d[(y * 4 + x) * 4 + 3] = 255;
  t.g.putImageData(img, 0, 0); return masks[q] = aux.g.createPattern(t.c, 'repeat');
}
let wrong = 0;
function uiState(){
  const n = ST.length, i = Math.min(R.idx, R.stop), tg = ST[i], nx = ST[i + 1], all = !typing(), now = G.endT || performance.now();
  const next = all && R.cur >= R.stop ? -1 : Math.min(LAST, R.cur + 1);
  let wpm = 0; if (G.t0 !== null && G.t0 !== undefined){ const win = Math.min(10, Math.max((now - G.t0) / 1000, 1.5)), cut = now - win * 1000; let c = 0; for (const x of G.taps) if (x >= cut) c++; wpm = Math.round(c / 5 * 60 / win); }
  const tot = G.correct + G.errors;
  return {lab, head: R.idx === 0 ? {zh: '始发站', en: 'ORIGIN'} : all ? (R.cur >= R.stop ? {zh: '终点站', en: 'TERMINUS'} : {zh: '即将到达', en: 'ARRIVING'}) : null,
    station: {zh: tg.zh, py: tg.py, typed: all ? KEYS[i].length : R.typed, wrongFlash: wrong, transfers: tg.transfers || []}, terminus: {zh: ST[LAST].zh, py: ST[LAST].py, en: ST[LAST].en},
    next: nx ? {zh: nx.zh, py: nx.py, end: i + 1 === LAST} : null, idx: i + 1, total: n, kmToNext: next >= 0 ? Math.max(0, G.cum[next] - G.pos) : 0,
    speedKmh: Math.min(L.cap, Math.round(G.dispV)), maxKmh: L.cap, wpm, acc: tot ? Math.round(100 * G.correct / tot) : 100, combo: G.combo, comboTier: G.hot ? G.fireT : 0,
    score: G.score, time: G.t0 !== null && G.t0 !== undefined ? (now - G.t0) / 1000 : 0, dist: G.dist, t: clock,
    route: {cur: R.cur, next, total: n, p: next > R.cur ? clamp((G.pos - G.cum[R.cur]) / G.segs[R.cur], 0, 1) : 0}, idle: Math.max(0, R.t - R.lastT), cps: cpsOf()};
}
/* a typed station's burst: a hud.good ring opening round its platform (a still ring under reduced motion) */
const bursts = [];
function drawBursts(v, dt){
  for (let k = bursts.length - 1; k >= 0; k--){ const b = bursts[k]; b.t += dt; if (b.t >= .6 || b.i >= ST.length){ bursts.splice(k, 1); continue; }
    const p = LABELS.anchor(b.i, v); if (!v.onScreen(p.x, p.y, 24)) continue;
    const u = red ? .5 : b.t / .6, r = Math.round(6 + 10 * u), q = 1 - u;
    for (let a = 0; a < 64; a++){ const th = a / 64 * Math.PI * 2, x = Math.round(p.x + Math.cos(th) * r), y = Math.round(p.y + Math.sin(th) * r);
      if (PX.bayer(x, y) < q + .2) PX.px(g, x, y, (a & 1) ? 'hud.good' : 'stn.fill'); } }
}
/* frame governor: rolling p95 of the last 180 drawn frames (ms; not the first 2 s of a ride, when the first bakes land), checked every
   60 frames; a level needs two checks in a row over its limit (~3 s), giving up needs four more at level 2; four checks in a row under
   16 ms step it back down (a burst of first-visit bakes does not cost the whole session its rain and traffic) */
const FT = []; let govN = 0, govHi = 0, govUp = 0, govLo = 0, perf = 0;
function governor(ms){
  if (clock < 2) return;
  FT.push(ms); if (FT.length > 180) FT.shift(); if (++govN % 60 || FT.length < 180) return;
  const p95 = FT.slice().sort((a, b) => a - b)[Math.floor(FT.length * .95)]; perf = p95;
  const lvl = p95 > 33 ? 2 : p95 > 24 ? 1 : 0;
  if (lvl > gov){ if (++govUp >= 2){ gov = gov < 1 && lvl > 1 ? 1 : lvl; govUp = 0; govHi = 0; setGov(); } }
  else { govUp = 0; if (gov >= 2 && lvl >= 2){ if (++govHi >= 4) RIDE.giveUp = true; } else govHi = 0; }
  if (gov > 0 && p95 < 16){ if (++govLo >= 4){ gov--; govLo = 0; setGov(); } } else govLo = 0;
}
function setGov(){
  if (typeof WEATHER !== 'undefined' && WEATHER) WEATHER.wetFx = gov < 1;
  if (typeof TRAFFIC !== 'undefined') TRAFFIC.density = gov < 1 ? 1 : .5;
  trans = gov >= 2 ? 'dissolve' : 'scale'; FT.length = 0; govN = 0;
}
/* ---------- the end-of-ride recap: after the glide out (FIN_GLIDE), a DISS s Bayer dissolve (art px (x, y) turns once t / DISS >
   PX.bayer(x, y)) to OVM.drawWhole's whole-line picture over the whole canvas, the line fitted into the free area clear of the cluster /
   chips / attribution; then it holds (the chrome on top) until game.js moves on (RIDE.recapMs). Reduced motion / RIDE.skip: the picture
   at once. Its tiles are queued for OVM's idle bakes during the ride (OVM.prepWhole, from idle callbacks), so composing it is a blit;
   no OVM / MAPOV / line, or a throwing drawWhole: the Stage 1 finish (FIN_MS) */
const DISS = .4, RECAP_MS = 3000, FIN_MS = 1200, RECAP_MIN = 48;
const RC = {t0: 0, tD: -1, u: -1, pic: null, key: '', pk: '', pT: -9, idle: 0, dead: false, skip: false};
const hasRIC = typeof requestIdleCallback === 'function';
const recapOk = () => running && !!D && !RC.dead && typeof OVM !== 'undefined' && typeof OVM.drawWhole === 'function' && typeof MAPOV !== 'undefined' && !!(MAPOV.lines && MAPOV.lines[L.id]);
function recapBoxes(){                                                     // the free area, minus each overlay covering it (≥ 48 px pieces)
  const F = free(), ob = [lay.cluster, chips, lay.attribution].filter(r => r && r.w > 0 && r.h > 0), out = [];
  const cut = (b, i) => { for (; i < ob.length; i++){ const o = ob[i], x0 = o.x - 3, y0 = o.y - 3, x1 = o.x + o.w + 3, y1 = o.y + o.h + 3;
      if (o.x >= b[0] + b[2] || o.x + o.w <= b[0] || o.y >= b[1] + b[3] || o.y + o.h <= b[1]) continue;
      for (const c of [[b[0], b[1], x0 - b[0], b[3]], [x1, b[1], b[0] + b[2] - x1, b[3]], [b[0], b[1], b[2], y0 - b[1]], [b[0], y1, b[2], b[1] + b[3] - y1]]) if (c[2] >= 48 && c[3] >= 48) cut(c, i + 1);
      return; }
    out.push(b); };
  cut([F.x, F.y, F.w, F.h], 0); return out.length ? out : [[F.x, F.y, F.w, F.h]];
}
const recapArgs = () => { const box = recapBoxes(); return {key: [L.id, D.rev ? 1 : 0, W, H, PX.theme, box.join(';')].join('|'), o: {rev: !!D.rev, theme: PX.theme, min: RECAP_MIN, box}}; };
function recapPrep(){
  if (RC.idle || !recapOk() || recapArgs().key === RC.pk) return;
  const f = () => { RC.idle = 0; if (!recapOk()) return; const a = recapArgs();   // (idle: OVM's first data build is no frame's cost)
    try { OVM.prepWhole(L.id, W, H, a.o); RC.pk = a.key; } catch (e){ console.error('OVM.prepWhole', e); RC.dead = true; } };
  RC.idle = hasRIC ? requestIdleCallback(f, {timeout: 2000}) : setTimeout(f, 50);
}
const recapReady = () => { try { return OVM.prepWhole(L.id, W, H, recapArgs().o); } catch (e){ return true; } };   // (a throw: drawWhole reports it)
function recapPic(){
  const a = recapArgs(); if (RC.pic && RC.key === a.key) return RC.pic;
  try { const c = OVM.drawWhole(L.id, W, H, a.o); if (RC.pic) RC.pic.width = 0; RC.pic = c; RC.key = a.key; return c; }
  catch (e){ console.error('OVM.drawWhole', e); RC.dead = true; return null; }
}
function recapU(){                                                         // → the dissolve's progress 0..1, −1 = the ride's own picture
  if (!fin || !recapOk()) return -1;
  const now = performance.now(), el = now - RC.t0, landed = Z.u >= 1 && Z.xa < 0 && Z.pend === null && Z.to === FIN;
  if (RC.tD < 0){                                                          // (after the glide, till its tiles are baked, ≤ FIN_GLIDE + DISS s)
    if (!red && !RC.skip && (el < FIN_GLIDE * 1e3 || (el < (FIN_GLIDE + DISS) * 1e3 && !(landed && recapReady())))) return -1;
    if (!recapPic()) return -1; RC.tD = now; }
  else if (!recapPic()) return -1;
  return red || RC.skip ? 1 : clamp((now - RC.tD) / (DISS * 1e3), 0, 1);
}
function recapReset(){ if (RC.idle) (hasRIC ? cancelIdleCallback : clearTimeout)(RC.idle); if (RC.pic) RC.pic.width = 0;
  Object.assign(RC, {tD: -1, u: -1, pic: null, key: '', pk: '', pT: -9, idle: 0, dead: false, skip: false}); }
function dissolve(pic, u){                                                 // pic over g where PX.bayer < q / 16 (bayerMask: opaque where ≥)
  const q = clamp(Math.ceil(u * 16 - .5), 0, 16); if (!q) return; if (q >= 16){ g.drawImage(pic, 0, 0); return; }
  const mk = bayerMask(q), a = aux.g; a.clearRect(0, 0, W, H); a.drawImage(pic, 0, 0);
  a.save(); a.globalCompositeOperation = 'destination-out'; a.fillStyle = mk; a.fillRect(0, 0, W, H); a.restore(); g.drawImage(aux.c, 0, 0);
}
function frame(dt){
  const t0 = performance.now(); seq++;
  const ru = RC.u = recapU();
  if (ru >= 1){ g.drawImage(RC.pic, 0, 0); UI.reduced = red; UI.draw(g, uiState(), lay); blit(); return performance.now() - t0; }   // the hold: the picture + the chrome
  updateCamera(dt);
  const V = views(dt), ss = stationsState();
  WORLD.lazy = true;
  if (WORLD.bakeSome){ const need = V.x ? [V.x.F, V.x.C] : [V.w]; if (!need.every(v => WORLD.ready(v))) WORLD.bakeSome(need, 4); }
  const tr = traffic(); if (tr) TRAFFIC.update(dt, V.d); wx('update', dt, V.d, weather);
  if (Z.pend !== null || Z.u < 1 || Z.xa >= 0) wx('warm', viewAt(Z.pend !== null ? Z.pend : Z.to), 1.5);
  const map = (c, w, d) => { WORLD.drawGround(c, w); wx('drawGround', c, d); if (tr) TRAFFIC.draw(c, d); ss.landmarks = WORLD.drawStructures(c, w) || []; wx('drawSky', c, d);
    TRAIN.drawLine(c, d, ss.trainS, ss.next); LABELS.drawMarkers(c, d, ss); const cars = TRAIN.draw(c, d, ss.trainS); wx('drawOver', c, d); return cars; };
  if (V.x){
    const q = Math.round(V.x.c * 16), mk = bayerMask(q), cf = map(aux.g, V.x.F, V.x.F), cc = map(g, V.x.C, V.x.C);
    aux.g.save(); aux.g.globalCompositeOperation = 'destination-in'; aux.g.fillStyle = mk; aux.g.fillRect(0, 0, W, H); aux.g.restore();
    g.drawImage(aux.c, 0, 0); ss.cars = V.x.c >= .5 ? cc : cf;
  } else ss.cars = map(g, V.w, V.d);
  LABELS.draw(g, V.d, ss, [lay.cluster, lay.board, lay.attribution, chips].filter(r => r.w > 0 && r.h > 0));
  drawBursts(V.d, dt); toastDodge(ss);
  if (ru > 0) dissolve(RC.pic, ru);
  UI.reduced = red; UI.draw(g, uiState(), lay);
  WORLD.lazy = false;
  blit();
  last = {v: V.d, w: V.w, ss};
  const ms = performance.now() - t0; if (dt > 0 && !document.hidden) governor(ms);
  return ms;
}

/* ---------- data: the ride's PX.D ---------- */
const trOf = (id, zh) => (typeof LINES !== 'undefined' ? LINES : []).filter(o => o.id !== id && (o.stations || o.st || []).some(s => (s.zh || s[0]) === zh)).map(o => o.id);
const enOf = zh => { if (typeof GEO === 'undefined') return null; for (const gl of GEO.lines) for (const s of gl.stations) if (s.zh === zh) return s.en; return null; };
const flip = pts => pts.slice().reverse();
/* a station further than XDIST from where js/geo.js (OSM) puts it means the map index does not match js/data.js */
const XDIST = 500;
const geoXY = zh => { if (typeof GEO === 'undefined' || typeof MAPLINES === 'undefined') return null; const o = MAPLINES.origin;
  for (const gl of GEO.lines) for (const s of gl.stations) if (s.zh === zh) return [(s.lon - o.lon) * MAPLINES.mPerDegLon, (s.lat - o.lat) * MAPLINES.mPerDegLat]; return null; };
function fromTiles(Ln, rev){
  const M = MAP.line(Ln.id), n = Ln.stations.length;
  if (!M || !M.st || M.st.length !== n) throw Object.assign(new Error('RIDE: map index has ' + (M && M.st ? M.st.length : 0) + ' stations for ' + Ln.id + ', data.js ' + n), {code: 'xcheck'});
  for (let i = 1; i < n; i++) if (!(M.st[i] > M.st[i - 1])) throw Object.assign(new Error('RIDE: stations out of order on ' + Ln.id), {code: 'xcheck'});
  const order = rev ? Ln.stations.map((s, i) => n - 1 - i) : Ln.stations.map((s, i) => i);
  const stations = order.map(i => { const s = Ln.stations[i], d = rev ? M.len - M.st[i] : M.st[i], p = MAP.at(Ln.id, M.st[i]), q = geoXY(s.zh);
    if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) > XDIST) throw Object.assign(new Error('RIDE: ' + s.zh + ' is ' + Math.round(Math.hypot(q[0] - p[0], q[1] - p[1])) + ' m off the map index'), {code: 'xcheck'});
    return {zh: s.zh, py: s.py, en: enOf(s.zh), x: p[0], y: p[1], d, transfers: trOf(Ln.id, s.zh)}; });
  const pad = 9000, bb = M.bb;
  return {lineId: Ln.id, rev, src: 'tiles', track: rev ? flip(M.pts) : M.pts, trackLen: M.len, trackClose: M.close ? (rev ? flip(M.close) : M.close) : null, stations,
    landmarks: MAP.landmarks || [], otherLines: MAP.others(Ln.id) || [], riverLanes: MAP.lanes() || [], outer: [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad], bb};
}
function fromObject(Ln, rev, o){
  const T = o.track || o.line3, len = o.trackLen || o.line3Len, byZh = new Map((o.stations || []).map(s => [s.zh, s])), seq = rev ? Ln.stations.slice().reverse() : Ln.stations;
  const miss = seq.filter(s => !byZh.has(s.zh)).map(s => s.zh);
  if (miss.length) throw Object.assign(new Error('RIDE: source lacks ' + miss.join(' ')), {code: 'xcheck'});
  const fl = byZh.get(seq[0].zh).d > byZh.get(seq[seq.length - 1].zh).d;
  const stations = seq.map(s => { const q = byZh.get(s.zh), d = fl ? len - q.d : q.d; return {zh: s.zh, py: s.py, en: q.en || enOf(s.zh), x: q.x, y: q.y, d, transfers: trOf(Ln.id, s.zh)}; });
  for (let i = 1; i < stations.length; i++) if (!(stations[i].d > stations[i - 1].d)) throw Object.assign(new Error('RIDE: source stations out of order'), {code: 'xcheck'});
  const tc = o.trackClose || null;
  return Object.assign({}, o, {lineId: Ln.id, rev, src: 'object', track: fl ? flip(T) : T, trackLen: len, trackClose: tc ? (fl ? flip(tc) : tc) : null, stations,
    landmarks: o.landmarks || [], otherLines: o.otherLines || [], riverLanes: o.riverLanes || [], outer: o.outer || [-3e4, -5e4, 5e4, 5e4]});
}

/* ---------- API ---------- */
/* a hidden tab gets no animation frames: the prepare's slices then run on (throttled) timers, and its clocks (vnow) skip hidden time */
const nextFrame = () => new Promise(r => document.hidden ? setTimeout(r, 16) : requestAnimationFrame(() => r()));
let hidMs = 0, hidAt = document.hidden ? performance.now() : null;
document.addEventListener('visibilitychange', () => { const n = performance.now(); if (document.hidden){ if (hidAt === null) hidAt = n; } else if (hidAt !== null){ hidMs += n - hidAt; hidAt = null; } });
const vnow = () => { const n = performance.now(); return n - hidMs - (hidAt !== null ? n - hidAt : 0); };
/* the ride's background work (MAP's plan stream, WORLD's idle bakes, TRAIN's prebuild) pauses while no ride is up (optional APIs) */
const bgWork = on => { for (const [o, k] of [[typeof WORLD !== 'undefined' && WORLD, on ? 'resume' : 'suspend'], [typeof TRAIN !== 'undefined' && TRAIN, on ? 'resume' : 'suspend']]) if (o && typeof o[k] === 'function') o[k]();
  if (!on && typeof MAP !== 'undefined' && typeof MAP.cancelPlan === 'function') MAP.cancelPlan(); };
const themeName = () => document.documentElement.dataset.theme === 'light' ? 'day' : 'night';
function setTheme(){ const t = themeName(); if (PX.theme !== t || !PX.pal) PX.setTheme(t); if (cv) cv.style.background = PX.col('land.d1'); }
/* the ride's data + modules for (Ln, rev) (kept when the same line is replayed), then the camera on the game state g (S; default: the
   start) at the #mapWrap size, or sz {w, h} (CSS px: the menu's prefetch plans the canvas before it exists) → true for the tile source */
function setup(Ln, rev, g, sz){
  const src = RIDE.source ? RIDE.source(Ln) : null, tiles = !src;
  if (tiles && (typeof MAP === 'undefined' || typeof MAPLINES === 'undefined')) throw new Error('RIDE: no map data');
  const key = Ln.id + '|' + (rev ? 1 : 0) + '|' + (src ? 'o' : 't');
  if (key !== rideKey || !D){
    const d = tiles ? fromTiles(Ln, rev) : fromObject(Ln, rev, src);
    L = Ln; D = d; PX.use(D, Ln.id); ST = D.stations; LAST = ST.length - 1;
    KEYS = ST.map(s => typeof normPy === 'function' ? normPy(s.py) : s.py.toLowerCase().replace(/[^a-z]/g, ''));
    TRAIN.init(D); LABELS.init(D); boxCache.clear(); hopCache.clear(); pfDone.clear();
    const wk = Ln.id + '|' + (src ? 'o' : 't');
    if (wk !== worldKey){ WORLD.init(D); if (typeof TRAFFIC !== 'undefined') TRAFFIC.init(D); worldKey = wk; }
    if (typeof WEATHER !== 'undefined' && WEATHER && WEATHER.init) try { WEATHER.init(D, 20260927); } catch (e) { console.error('WEATHER.init', e); wxDead = true; }
    if (typeof WEATHER !== 'undefined' && WEATHER && WEATHER.dirty && WORLD.onRebake) WORLD.onRebake(WEATHER.dirty);   // (a set: once; also when world.js loaded late)
    rideKey = key;
  } else { L = Ln; PX.use(D, Ln.id); }
  if (TRAIN.resetHeadings) TRAIN.resetHeadings();
  G = g || {cum: [0], segs: rev ? Ln.segKm.slice().reverse() : Ln.segKm, arrivedI: 0, idx: 0, typed: 0, pos: 0, taps: [], done: false, t0: null, kms: 90};
  if (!g) for (const k of G.segs) G.cum.push(G.cum[G.cum.length - 1] + k);
  red = RED(); fin = false; MX.keep = MX.kc = -1; PL = []; plSig = ''; fit(sz); aim(); return tiles;
}
const fit = sz => { if (!sz) return measure(); const dpr = devicePixelRatio || 1; devW = Math.max(1, Math.round(sz.w * dpr)); devH = Math.max(1, Math.round(sz.h * dpr)); };
function aim(){ resize(); sync(); snap(); cam.seg = -1; updateCamera(0); snap(); cam.seg = -1; }   // the camera on the game's state, first frame
/* P0 = the first view's tiles at its own LOD (an overview: LOD1 / LOD2 only) + LOD0 only round the train: the close view there, ≤ ±1 km
   (≤ 3 × 3 street tiles; not the middle of a long first hop — l22 desktop was 158 KB); MAP.loadFor streams the rest. A phone-sized canvas
   (shorter side < P0_PHONE art px) whose first view is a city overview (LOD2, 16 km tiles) waits only for the LOD2 tiles within P0_CLIP m
   of the train: the rest of that overview streams in after the veil (world.js asks for a resting view's tiles first) — tools/lib/osm-geom.js
   rideViews replays this */
const P0_PHONE = 240, P0_CLIP = 6000;
function p0Views(){
  const V = views(0).w, rv = rectOf(V, 16), c = closeLevel(seg()[0]), p = P(R.pos), hw = Math.min(1000, (W / 2 + 16) * c) - .5, hh = Math.min(1000, (H / 2 + 16) * c) - .5, lod = lodOf(V.lvl);
  let b = [rv.x0, rv.y0, rv.x1, rv.y1];
  if (lod === 2 && Math.min(W, H) < P0_PHONE) b = [Math.max(b[0], p.x - P0_CLIP), Math.max(b[1], p.y - P0_CLIP), Math.min(b[2], p.x + P0_CLIP), Math.min(b[3], p.y + P0_CLIP)];
  return [{lod, bbox: b}, {lod: 0, bbox: [p.x - hw, p.y - hh, p.x + hw, p.y + hh]}];
}
const mapCancel = tag => { if (typeof MAP !== 'undefined' && typeof MAP.cancel === 'function') MAP.cancel(tag); };
const wantViews = vs => { if (typeof MAP !== 'undefined' && MAP.want) for (const v of vs) MAP.want(v.bbox, v.lod, {tag: 'ride'}); };   // ('ride': RIDE.stop drops them)
const SOFT = 2000;
/* sz: {w, h} CSS px, or a function returning it (a takeover's canvas-to-be follows the soft keyboard). A layout change meanwhile
   (RIDE.set: keyboard, chips, scale — layGen) re-aims: its first view's tiles are asked for first and it is pre-baked instead, briefly
   (bakes read what is in; late tiles rebake on idle time, never in a frame) */
RIDE.prepare = async (Ln, rev, onPct, g, sz) => {
  const my = ++prepSeq, tP = vnow(), pct = f => { if (onPct) try { onPct(clamp(f, 0, 1)); } catch (e) {} }, alive = () => { if (my !== prepSeq) throw Object.assign(new Error('RIDE: superseded'), {code: 'superseded'}); };
  const szOf = () => typeof sz === 'function' ? sz() : sz;
  pfTok++; mapCancel('menu'); ensureCanvas(); setTheme(); pct(0); bgWork(true); plOn = true;
  await FONTS.ready; alive();
  let gen = layGen;
  const tiles = setup(Ln, rev, g, szOf());                                // (g = the live S: a mid-run takeover plans round the train, not station 0)
  if (tiles){
    const s0 = P(R.pos), lr = await MAP.loadFor(Ln.id, {dir: rev ? -1 : 1, near: [s0.x, s0.y], views: p0Views(), onProgress: f => pct(f * .6)});
    alive(); if (lr && lr.superseded) throw Object.assign(new Error('RIDE: superseded'), {code: 'superseded'});   // (another line's MAP.loadFor)
    fit(szOf()); aim();                                                   // the train may have moved (takeover), the keyboard come up
    if (gen !== layGen){ gen = layGen; wantViews(p0Views()); }
    const p = P(R.pos); MAP.prioritise(p.x, p.y);
  }
  pct(.6);
  /* pre-bake, in slices (≤ 12 ms a frame): the first view and, before an overview, the close follow it glides into, then the glide's
     levels between — those only until SOFT ms after the start (they finish on idle time before the glide, prefetchMix; a missing
     one meanwhile borrows from its baked neighbours), so a slow first load does not keep the veil up for the whole glide. A long first
     hop still to be decided at the pace (MX.pre: it may stay on its overview): the overview, then only the close view, within SOFT */
  const plan = () => { const a = seg()[0], must = [views(0).w], vs = must.slice();
    if (zoomMode === 'mix' && MX.phase === 'over' && !MX.stay){ const c = closeLevel(a), f = focusTarget(c, glideS(a), 1), {ax, ay} = anchor();
      const cv = GEOM.view({lvl: c, k: kf, cx: f[0], cy: f[1], ax, ay, W, H, t: 0, dt: 0, theme: PX.theme, ui: uiRects()});
      if (MX.pre) vs.push(cv); else { must.push(cv); vs.push(cv, ...glideViews(a)); } }
    return [must, vs]; };
  let [must, vs] = plan(), t0 = vnow(), tRe = 0;
  for (;;){
    if (gen !== layGen){ gen = layGen; fit(szOf()); aim(); [must, vs] = plan(); tRe = vnow(); if (tiles) wantViews(p0Views()); }
    if (!WORLD.bakeSome || WORLD.bakeSome(vs, 12)) break;
    pct(.6 + .4 * vs.filter(v => WORLD.ready(v)).length / vs.length);
    const now = vnow();
    if (now - tP > SOFT && must.every(v => WORLD.ready(v))) break;
    if (tRe && now - tRe > RE_MAX && WORLD.ready(must[0])) break;       // a late re-aim: the new first view, not its whole glide
    await nextFrame(); alive(); if (vnow() - t0 > 8000) break;
  }
  alive(); pct(1);
};
const RE_MAX = 600;
/* the first frame's MAP.loadFor options {dir, near, views} for (Ln, rev) at a w × h CSS px canvas (or #mapWrap's), null for the object
   source — what prepare asks MAP for first (also for tools replaying the real P0) */
RIDE.plan = async (Ln, rev, sz) => {
  if (running) return null; ensureCanvas(); setTheme(); await FONTS.ready; if (running || !setup(Ln, rev, null, sz)) return null;
  const p = P(R.pos); return {dir: rev ? -1 : 1, near: [p.x, p.y], views: p0Views()};
};
/* the menu's prefetch (an open line card): the P0 tiles of (Ln, rev) only, at a full-window canvas sz {w, h} (CSS px), four at a time
   through MAP.want tagged 'menu' — never the whole ride; a newer call (another card, the Reverse button, RIDE.prefetch(null) when the card
   closes, a prepare) drops what is not asked yet and MAP.cancel('menu')s what is still queued, so a ride's P0 never waits behind it
   → Promise of the number of tiles it asks for */
let pfTok = 0;
RIDE.prefetch = async (Ln, rev, sz) => {
  const my = ++pfTok; mapCancel('menu'); if (!Ln || running || typeof MAP === 'undefined' || !MAP.want) return 0;
  const pl = await RIDE.plan(Ln, rev, sz); if (my !== pfTok || running || !pl) return 0;
  const todo = MAP.plan(Ln.id, pl).P0.filter(e => !MAP.status(e.lod, e.key)), asked = [], n = todo.length;
  const feed = () => { if (my !== pfTok) return;
    let busy = asked.filter(e => /queued|loading/.test(MAP.status(e.lod, e.key) || '')).length;
    while (busy < 4 && todo.length){ const e = todo.shift(), [tx, ty] = e.key.split('_').map(Number), S = MAP.LODS[e.lod].S;
      MAP.want([tx * S + 1, ty * S + 1, tx * S + S - 1, ty * S + S - 1], e.lod, {tag: 'menu'}); asked.push(e); busy++; }
    if (todo.length || busy) setTimeout(feed, 100); };
  feed(); return n;
};
RIDE.start = (Ln, S) => {
  ensureCanvas(); L = Ln; G = S; running = true; fin = false; recapReset(); wrong = 0; bursts.length = 0; clock = 0; red = RED(); zoomMode = zmOf(); setGov(); pfTok++;
  t0ride = performance.now() / 1000; prAt = -1e9; pfDone.clear();
  const m = document.getElementById('mapWrap'); if (cv.parentNode !== m) m.insertBefore(cv, m.firstChild);
  setTheme(); PX.use(D, Ln.id);
  if (!ro && window.ResizeObserver){
    ro = new ResizeObserver(es => { const e = es[0], dpr = devicePixelRatio || 1, w = e.contentRect.width * dpr, h = e.contentRect.height * dpr;
      let bx = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
      if (bx && (Math.abs(bx.inlineSize - w) > 2 || Math.abs(bx.blockSize - h) > 2)) bx = null;
      const nw = bx ? bx.inlineSize : Math.round(w), nh = bx ? bx.blockSize : Math.round(h); if (!nw || !nh || (nw === devW && nh === devH)) return;
      devW = nw; devH = nh; if (running){ resize(); snap(); frame(0); } });
    try { ro.observe(cv, {box: 'device-pixel-content-box'}); } catch (e) { ro.observe(cv); }
  }
  bgWork(true); plOn = true; plSig = ''; measure(); resize(); sync(); snap(); cam.seg = -1; frame(0);
  if (SPR.prebake) SPR.prebake({levels: LEVELS(), k: kf});
};
RIDE.frame = (dt, S) => {
  if (!running) return;
  G = S; red = RED(); zoomMode = zmOf();
  sync(); clock += dt; wrong = Math.max(0, wrong - dt / .45); planPush(false);
  if (D.src === 'tiles' && typeof MAP !== 'undefined' && MAP.prioritise && Math.abs(R.pos - prAt) > 250){ prAt = R.pos; const p = P(R.pos); MAP.prioritise(p.x, p.y); }
  if (!fin && clock > 3 && clock - RC.pT >= 1){ RC.pT = clock; recapPrep(); }   // (the recap's tiles, once a second: a layout change re-queues)
  return frame(dt);
};
RIDE.key = (n, miss) => { if (miss) wrong = 1; };
RIDE.done = i => { bursts.push({i, t: 0}); };
RIDE.finish = () => {
  if (!running) return FIN_MS; fin = true; if (red) snap();            // reduced motion: a cut to the city view (and at once to the recap)
  if (typeof MAP !== 'undefined' && D.src === 'tiles' && MAP.want){ const T = P(ST[LAST].d), hw = (W / 2 + 32) * FIN, hh = (H / 2 + 32) * FIN; MAP.want([T.x - hw, T.y - hh, T.x + hw, T.y + hh], 2, {tag: 'ride'}); }
  RC.t0 = performance.now(); RC.tD = -1; RC.skip = false;
  if (recapOk()) try { if (OVM.prepWhole(L.id, W, H, recapArgs().o)) recapPic(); } catch (e){ console.error('OVM.prepWhole', e); RC.dead = true; }
  return RIDE.recapMs();
};
RIDE.recapMs = () => recapOk() ? RECAP_MS : FIN_MS;
RIDE.skip = () => { if (!fin || !recapOk()) return false; RC.skip = true; return true; };
RIDE.theme = () => { if (!PX.pal && typeof PAL === 'undefined') return; setTheme(); if (running){ if (SPR.prebake) SPR.prebake({levels: LEVELS(), k: kf}); frame(0); } };
RIDE.set = (o = {}) => {
  let re = false;
  if (o.scale != null){ const s = +o.scale === 3 ? 3 : 2; if (s !== scale){ scale = s; re = true; } }
  if (o.weather) weather = ['auto', 'clear', 'rain'].includes(o.weather) ? o.weather : 'auto';
  if (o.kb != null && !!o.kb !== kb){ kb = !!o.kb; re = true; }
  if (o.top != null && Math.abs(o.top - topCss) > .5){ topCss = +o.top || 0; re = true; }
  if (o.right != null && Math.abs(o.right - rightCss) > .5){ rightCss = +o.right || 0; re = true; }
  if (o.lab) lab = o.lab;
  if (re && running){ resize(); snap(); frame(0); }                   // (live: lazy bakes, never a whole-tile bake in the frame)
  else if (re) layGen++;                                                // (a prepare in flight re-aims)
};
RIDE.stop = () => { prepSeq++; running = false; fin = false; recapReset(); if (cv && cv.parentNode) cv.parentNode.removeChild(cv); bgWork(false); mapCancel('ride'); plOn = false; };
RIDE.stats = () => ({W, H, K, scale, running, frames: seq, lvl: last && last.v.lvl, lvlTo: Z.to, mpp: mppNow(), zs: last && last.v.zs, s: R.pos, cur: R.cur, idx: R.idx, phase: MX.phase, fin,
  recap: {u: RC.u, pic: RC.pic ? [RC.pic.width, RC.pic.height] : null, key: RC.key, prepped: RC.pk, dead: RC.dead, skip: RC.skip, ms: RIDE.recapMs()},
  gov, p95: perf, ft: FT.slice(), giveUp: RIDE.giveUp, trans, zoomMode, weather, kb, layout: lay && {portrait: lay.portrait, kb: lay.kb, tight: lay.tight, view: lay.view, cluster: lay.cluster, board: lay.board, attribution: lay.attribution},
  world: typeof WORLD !== 'undefined' ? WORLD.stats : null, map: typeof MAP !== 'undefined' && MAP.stats ? MAP.stats() : null, src: D && D.src, rain: hasWX() ? +WEATHER.rain || 0 : 0});
RIDE.audit = () => PX.audit(g, W, H);
RIDE.probe = () => ({s: R.pos, cur: R.cur, lvl: last && last.v.lvl, cars: last && last.ss.cars ? last.ss.cars.map(c => [c.x, c.y]) : []});
window.RIDE = RIDE;
})();
