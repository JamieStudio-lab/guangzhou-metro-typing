/* ovmap.js — OVM: the menu's pixel overview map (Stage 2) and the end-of-ride whole-line picture. North-up, its own canvas,
   no WORLD / TRAIN / LABELS / TRAFFIC / WEATHER / RIDE (it never touches the ride's singletons, PX.D or PX.lineId). Same rules as
   pixel.js: integer K device px per art px, integer coordinates at rest, palette roles only (OVM.audit() must be 0, mid-glide too),
   pixel fonts at native sizes, Bayer patterns never alpha. Needs pixel.js, palette.js, geom.js, sprites.js, js/map/ov.js (MAPOV);
   fonts.js for text (labels, tooltip, attribution appear once FONTS.ready); js/data.js LINES for station names (optional);
   js/boundaries.js BOUNDARIES for the city (solid) / district (dashed) outlines (optional). Global OVM.
   Map: metres from MAPOV (x east, y north), drawn at one of the zoom STEPS (m per art px). Each step is baked lazily into 256² art px
   tiles, two variants per theme: 'lit' (every track in its display colour, casing + core) and 'dim' (every track 1 px lineDim.<id>,
   used while a line is hovered / focused: that line is then drawn live on top). A tile = land, built-up (urban), park / forest,
   water + river lanes (shore / depth by distance), motorway + trunk, boundaries, tracks, station markers. Bakes run in idle slices
   (requestIdleCallback, timer fallback; ≤ 12 ms, a tile's steps ≤ 64 rows), the 384 step first: it stands in (nearest-neighbour) for any
   tile not baked yet. Memory: everything OVM owns — the tile LRU (tiles, stand-ins, ground buffers) plus its scratch canvases (the art
   canvas, the zoom level frame, the stand-in / ground scratch; the life layers aside, see ovlife.js) — stays ≤ 16 MB (8 MB when pointer:coarse
   or deviceMemory ≤ 4): the LRU
   evicts (canvases get width 0) to leave room for the scratch, and the level frame + stand-in scratch are freed when a glide or pinch
   lands. The display canvas #ovCv (devW × devH × 4 bytes, screen-sized like the ride's) comes on top; OVM.stats() reports bytes (OVM's
   own), displayBytes and totalBytes. Frames are drawn only when something changed (a glide runs rAF until it lands); a zoom frame is
   composed at the nearest baked step and NN-resampled (never a new colour); focus labels are laid out in an idle step after a glide
   lands and appear on the next frame.
   Markers by step: ≤ 96 SPR.stn.normal / .inter · 128–192 a 5 px dot / SPR.stn.normal · ≥ 256 none / the 5 px dot; the 'lit'
   tiles carry every station ≤ 96, interchanges only at 128–192, none coarser (the live line always shows its own).
   API
   OVM.STEPS                       [512, 384, 256, 192, 128, 96, 64, 48]
   OVM.mount(host, {scale, onView, lazy, onReady}) create #ovCv (aria-hidden, 100 % of host) in host; K = round(scale × dpr)
                                   (= game.js --pxk); ResizeObserver. The first view is baked synchronously (stats().restBakeMs), or
                                   with lazy in idle slices while the canvas stays visibility:hidden (the page shows its SVG map);
                                   onReady() once it is shown (stats().readyMs; at once when not lazy). onView(state) after every
                                   settled view change: {m, rest, zoomed, focus}. Mount again to change scale.
   OVM.unmount()                   remove the canvas, stop idle work (caches kept) · OVM.free() drop every cache (canvases width 0)
   OVM.theme()                     re-read html[data-theme] (light = day, else night) → PX.setTheme when it differs, redraw
   OVM.rest() → m                  the finest step at which the whole network fits the canvas (the resting view; with a pad, its free rect)
   OVM.focus(id | null, {animate, pad}) frame the line (finest step fitting its bbox + 10 %, centred, clamped) with its track lit and
                                   level-only station labels (FP12, FP10 when that drops fewer; termini > interchanges > others,
                                   8 spots each, a colliding one is dropped); null = back to the rest view. Glide ≈ 420 ms.
   OVM.hover(id | null)            light one line over the dimmed network (programmatic: the legend); null = back to the focus
   OVM.zoomAt(dir, sx, sy) → bool  one step in (+1) / out (−1) keeping the point under (sx, sy) (CSS px in the canvas; default the
                                   centre) · OVM.panBy(dx, dy) → bool move the map content by whole art px (clamped to the network
                                   + 5 %) · OVM.reset() back to the focus view (or the rest view) · OVM.go({m, x, y}, {animate, dur})
                                   any view (glide dur ms, default 180)
   OVM.hit(sx, sy, tol = 4) → {line, station, d, cursor?}  the line (id) / drawn station under CSS px (sx, sy) in the canvas: ground
                                   point via GEOM.view.toGround, distance to the tracks ≤ tol art px; station = {id, i, zh, py, lines};
                                   the cursor's sign or ring (OVM.cursor) first: {line: its id, cursor: true}; then a badge → its line
   OVM.project(x, y) → [sx, sy]     metres → CSS px in the canvas (the view as shown)
   OVM.input(el = canvas, {onPick(id | null, hit), onHover(id | null), dbl = true}) → off()   wheel = one step per notch (trackpad
                                   deltas add up), pinch = NN scale then a snap to the nearest step, drag pans only while zoomed in
                                   (touch-action pan-x pan-y at rest: the page scrolls), double tap / click = reset only (a tap's pick
                                   waits out the 320 ms double-tap window; dbl: false = no double-tap reset, the pick fires at once),
                                   tap a line → onPick(id, hit) (a station of the focused line shows its tooltip at once instead; the
                                   cursor's sign / ring never), blank → onPick(null), mouse hover →
                                   the line lit + onHover(id) + a station tooltip (zh FP12, toned pinyin FP10, line chips);
                                   keys on el (tabindex 0): + = zoom in, − zoom out, arrows pan, 0 reset
   OVM.drawWhole(id, W, H, {rev, theme, min = 48, box, labels}) → canvas   an offscreen W × H art px picture of the whole line: the
                                   finest step (not finer than min) at which its bbox × 1.1 + 16 px fits box ([x, y, w, h] art px in
                                   the picture, or a list of them: the one fitting the finest step, then the roomiest; default the
                                   whole picture), centred on that box; that line lit over the dimmed network, its stations as done
                                   markers, the terminus (rev: the first station) as the big next-stop marker; labels: focus labels
                                   too. Synchronous (bakes what it lacks); theme ≠ the active one switches PX's theme for the call.
                                   ride.js's end-of-ride view · OVM.prepWhole(same args) → bool   true when every tile that picture
                                   needs is baked, else queues them for idle bakes (active theme only; works unmounted)
   OVM.redraw() → ms · OVM.idle() → Promise (bake queue empty, labels laid out, frame drawn) · OVM.stats() · OVM.audit() → PX.audit of the visible canvas
   (device px) {stray, colours} — must be 0. Map data © OpenStreetMap contributors (FP8 attribution on the canvas).
   LIFE (the world-map menu; all off by default, so a page that never calls these draws exactly as before): OVM.trains(mode) → mode
   ('lively' | 'calm' | 'off'; no arg: the current one) · OVM.progress({id: stars} | null) → the map kept · OVM.cursor(id | null, {rev,
   label = 'START', font = 'fp10'}) → {id, rev, label, font} | null · OVM.marks([zh…] | null) → n. Their state lives here (validated,
   returned, in stats()); what they draw — trains, badges, the START sign, marks, the stepped partial redraws — is js/px/ovlife.js
   (docs in its header), which this script injects itself (its own URL, ovmap.js → ovlife.js, the same query; 3 tries) once a mounted
   map is ready (its first view shown) and one of them is on. Until it is in, the map paints and works without life (nothing of it
   drawn, hit or kept clear of). OVM.idle() waits for it while it loads; stats().lifeJs = 'no' | 'loading' | 'in' | 'failed'.
   Pads (the UI over the canvas): OVM.focus(id, {animate, pad}) · OVM.rest({pad, animate}) (with an object: glide to the rest view;
                                   always → the rest step) · OVM.setPad(pad, {animate, reframe = true}) the default pad of later calls
                                   (and reframes the current view). pad = {top, right, bottom, left} in CSS px of the canvas box (not art
                                   px), each ≥ 0; missing = the default (none). The line / network is fitted and centred in the free
                                   rect, the rest step is the finest one the network fits there (the zoom-out limit), pans clamp the
                                   free rect to the network, and the labels, tooltip and attribution stay inside it. pad.attr = {left,
                                   bottom} (CSS px from the canvas's edges) moves the attribution to that corner instead (a sheet that
                                   leaves the canvas's bottom-left corner uncovered); the labels avoid its box either way.
   OVM.island(v) → bool            true: the world ends at the network + 5 % (data().R): its last 12 art px dissolve (Bayer) into a
                                   void (night ink, day bg) with no terrain or boundaries beyond, so the data's own edge never shows
                                   (baked into the tiles: set it before mount; a change drops the tile cache). Off by default.
   OVM.reducedMotion(v) → bool     true / false overrides prefers-reduced-motion for this map (a page's own setting or a simulation),
                                   null = back to the media query; no arg: the current answer. Reduced = no glide, no life ticks. */
(function(){
'use strict';
const OVM = {};
const STEPS = OVM.STEPS = [512, 384, 256, 192, 128, 96, 64, 48], FINEST = 48, STAND = 384, TS = 256, PAD = 14, BW = TS + PAD * 2, TB = TS * TS * 4;
const SMALL = (() => { try { return matchMedia('(pointer:coarse)').matches || (navigator.deviceMemory || 8) <= 4; } catch (e){ return false; } })();
const MAXB = SMALL ? 8e6 : 16e6, GLIDE = {focus: 420, step: 180};
let rmForce = null;                                                                      // OVM.reducedMotion(): a page's own override
const RED = () => { if (rmForce != null) return rmForce; try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e){ return false; } };
const ATTR = '© OpenStreetMap contributors';
const LSRC = (() => { try { const u = document.currentScript.src; return /ovmap\.js(?=$|[?#])/.test(u) ? u.replace(/ovmap\.js(?=$|[?#])/, 'ovlife.js') : ''; } catch (e){ return ''; } })();   // (ovlife.js: LIFE)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), now = () => performance.now(), ease = t => 1 - Math.pow(1 - t, 3);
const nearest = m => STEPS.reduce((a, s) => Math.abs(Math.log(s / m)) < Math.abs(Math.log(a / m)) ? s : a, STEPS[0]);
/* roles this map uses that differ by theme (keys only: every pixel stays a palette colour) */
const ROLE = {night: {bCity: 'road.mark', bDist: 'block.d3', mway: 'win.dim', trunk: 'road.major', frame: 'ui.panel', lite: ['win.dim', 'win.dim', 'win.warm'], void: 'ink'},
  day: {bCity: 'ui.edge', bDist: 'stn.doneLo', mway: 'road.major', trunk: 'road.surf', frame: 'ui.panel2', lite: ['block.d1', 'roofV.d1', 'block.d1'], void: 'bg'}};
let island = false;                                                                      // OVM.island(): the world ends at data().R
const rk = k => ROLE[PX.theme === 'day' ? 'day' : 'night'][k];
const coreW = s => s >= 96 ? 2 : 3;
const kindOf = s => s <= 96 ? 'full' : s <= 192 ? 'small' : 'dot';
/* a local 5 px marker (same keys as SPR.stn); 'dot' steps (≥ 256) mark only termini + interchanges (a bead per stop dashed the line) */
const S5 = {id: 'ovS5', w: 5, h: 5, ax: 2, ay: 2, rows: ['.kkk.', 'kfffk', 'kffLk', 'kfLLk', '.kkk.'], key: {k: 'stn.ring', f: 'stn.fill', L: 'stn.lo'}};
const S5D = {...S5, id: 'ovS5d', key: {k: 'stn.doneRing', f: 'stn.done', L: 'stn.doneLo'}};
const mk = (kind, big, done) => kind === 'full' ? (done ? (big ? SPR.stn.doneInter : SPR.stn.done) : big ? SPR.stn.inter : SPR.stn.normal)
  : kind === 'small' ? (big ? (done ? SPR.stn.done : SPR.stn.normal) : done ? S5D : S5) : big ? (done ? S5D : S5) : null;
const drawn = (kind, q) => kind !== 'dot' || q.inter || q.term;
const radOf = (kind, big) => kind === 'full' ? (big ? 5 : 3) : kind === 'small' ? (big ? 3 : 2) : big ? 2 : 1;

/* ---------- data: lines (MAPOV tracks + js/data.js names), unique stations, boundaries ---------- */
let DATA = null;
function data(){
  if (DATA) return DATA;
  if (typeof MAPOV === 'undefined') throw new Error('OVM: no overview data (js/map/ov.js)');
  const M = MAPOV, defs = typeof LINES !== 'undefined' && Array.isArray(LINES) ? LINES : [], byId = new Map(defs.map(L => [L.id, L]));
  const order = [...defs.map(L => L.id).filter(id => M.lines[id]), ...Object.keys(M.lines).filter(id => !byId.has(id))];
  const serve = new Map(), uniq = new Map(), lines = new Map();
  for (const id of order) for (const t of (byId.get(id) || {}).st || []){ const a = serve.get(t[0]) || []; if (!a.includes(id)) a.push(id); serve.set(t[0], a); }
  for (const id of order){
    const T = M.lines[id], tup = (byId.get(id) || {}).st || [], n = T.st.length;
    const st = T.st.map((vi, i) => { const t = tup[i] || [], zh = t[0] || '', ls = (serve.get(zh) || [id]).slice();
      for (const x of t[5] || []){ const k = 'l' + String(x).toLowerCase(); if (byId.has(k) && !ls.includes(k)) ls.push(k); }
      ls.sort((a, b) => (a !== id) - (b !== id));
      const o = {id, i, zh, py: t[1] || '', lines: ls, x: T.pts[vi][0], y: T.pts[vi][1], inter: ls.length > 1, term: i === 0 || i === n - 1};
      if (zh && !uniq.has(zh)) uniq.set(zh, o); return o; });
    lines.set(id, {id, pts: T.pts, close: T.close, bb: T.bb, st});
  }
  const B = typeof BOUNDARIES !== 'undefined' ? BOUNDARIES : null, P = ([la, lo]) => [(lo - M.origin.lon) * M.mPerDegLon, (la - M.origin.lat) * M.mPerDegLat];
  const bnd = []; if (B) for (const [set, c] of [[B.districts, 1], [B.cities, 2]]) for (const f of set || []) for (const r of f.rings || []){ const pts = r.map(P); pts.push(pts[0]); bnd.push({c, pts, bb: GEOM.bbox(pts)}); }
  const net = M.net, mx = (net[2] - net[0]) * .05, my = (net[3] - net[1]) * .05;
  return DATA = {M, order, lines, stations: [...uniq.values()], bnd, net, R: [net[0] - mx, net[1] - my, net[2] + mx, net[3] + my],
    park: M.green.filter(f => f.c === 'park'), forest: M.green.filter(f => f.c !== 'park')};
}
const line = id => data().lines.get(id) || null;
/* integer level-px polylines per step (simplified 0.5 px, duplicates dropped): cached */
const PC = new Map();
function pxl(k, pts, s, tol = .5){
  const key = k + '|' + s; let P = PC.get(key); if (P) return P;
  P = []; for (const p of GEOM.simplify(pts.map(q => [q[0] / s, -q[1] / s]), tol)){ const x = Math.round(p[0]), y = Math.round(p[1]), l = P[P.length - 1]; if (!l || l[0] !== x || l[1] !== y) P.push([x, y]); }
  if (P.length === 1) P.push(P[0].slice());
  P.bb = GEOM.bbox(P); PC.set(key, P); return P;
}
/* Bresenham over an integer polyline: fn(x, y, n) with n = steps along it (dashes); segments outside [x0, y0, x1, y1] skipped */
function bres(P, fn, x0c, y0c, x1c, y1c){
  let n = 0;
  for (let i = 1; i < P.length; i++){
    let x = P[i - 1][0], y = P[i - 1][1]; const X = P[i][0], Y = P[i][1], dx = Math.abs(X - x), dy = -Math.abs(Y - y);
    if (Math.max(x, X) < x0c || Math.min(x, X) > x1c || Math.max(y, Y) < y0c || Math.min(y, Y) > y1c){ n += Math.max(dx, -dy); continue; }
    const sx = x < X ? 1 : -1, sy = y < Y ? 1 : -1; let e = dx + dy;
    for (;;){ fn(x, y, n); if (x === X && y === Y) break; const e2 = 2 * e; if (e2 >= dy){ e += dy; x += sx; } if (e2 <= dx){ e += dx; y += sy; } n++; }
  }
}

/* ---------- cache: one LRU (bytes) for tiles, stand-ins and ground buffers ---------- */
const lru = {m: new Map(), bytes: 0,
  get(k){ const e = this.m.get(k); if (!e) return null; this.m.delete(k); this.m.set(k, e); return e.v; },
  has(k){ return this.m.has(k); },
  set(k, v, b){ this.del(k, v); this.m.set(k, {v, b}); this.bytes += b; this.trim(); return v; },
  trim(){ const cap = MAXB - scratchB(); while (this.bytes > cap && this.m.size > 1) this.del(this.m.keys().next().value); },
  del(k, keep){ const e = this.m.get(k); if (!e) return; this.m.delete(k); this.bytes -= e.b; if (e.v && e.v.getContext && e.v !== keep) e.v.width = 0; },
  clear(){ for (const k of [...this.m.keys()]) this.del(k); }};
const tkey = (s, v, tx, ty, th = PX.theme) => th + '|' + s + '|' + v + '|' + tx + '|' + ty;
const U32 = new Map();
const u32 = key => { const k = PX.theme + key; let v = U32.get(k); if (v === undefined){ const c = PX.rgb(PX.col(key)); v = (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0; U32.set(k, v); } return v; };

/* ---------- tile bake (a generator: yields between phases; the idle pump keeps its deadline) ---------- */
let SG = null;
function* ground(T){
  const {s, tx, ty} = T, D = data(), M = D.M, X0 = tx * TS - PAD, Y0 = ty * TS - PAD, bb = [X0 * s, -(Y0 + BW) * s, (X0 + BW) * s, -Y0 * s];
  const hitB = (b, e = 0) => b[0] - e <= bb[2] && b[2] + e >= bb[0] && b[1] - e <= bb[3] && b[3] + e >= bb[1];
  const cls = new Uint8Array(BW * BW), sc = SG || (SG = PX.makeCanvas(BW, BW)), g = sc.g, thin = [];
  const layer = (fs, val, extra) => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, BW, BW); g.setTransform(1 / s, 0, 0, -1 / s, -X0, -Y0); g.fillStyle = g.strokeStyle = '#fff';
    let n = 0; g.beginPath();
    for (const f of fs){ if (!hitB(f.bb)) continue; n++; for (const r of f.p){ g.moveTo(r[0][0], r[0][1]); for (let i = 1; i < r.length; i++) g.lineTo(r[i][0], r[i][1]); g.closePath(); } }
    if (n) g.fill(); if (extra) n += extra();
    if (!n) return;
    const d = g.getImageData(0, 0, BW, BW).data; for (let i = 0, j = 3; i < cls.length; i++, j += 4) if (d[j] >= 128) cls[i] = val;
  };
  layer(M.urban, 1); yield;
  layer(D.park, 2); layer(D.forest, 3); yield;
  layer(M.water, 4, () => { let n = 0; g.lineCap = g.lineJoin = 'round';                  // river lanes: ≥ 1.5 px wide stroked, thinner 1 px (below)
    for (let li = 0; li < M.lanes.length; li++){ const l = M.lanes[li]; if (!hitB(l.bb, 2000)) continue;
      for (let i = 1; i < l.pts.length; i++){ const w = (l.w[i - 1] + l.w[i]) / 2;
        if (w / s < 1.5){ thin.push(li); continue; }
        g.lineWidth = w; g.beginPath(); g.moveTo(l.pts[i - 1][0], l.pts[i - 1][1]); g.lineTo(l.pts[i][0], l.pts[i][1]); g.stroke(); n++; } }
    return n; });
  for (const li of new Set(thin)) bres(pxl('W' + li, M.lanes[li].pts, s), (x, y) => { x -= X0; y -= Y0; if (x >= 0 && y >= 0 && x < BW && y < BW) cls[y * BW + x] = 4; }, X0 - 1, Y0 - 1, X0 + BW, Y0 + BW);
  yield;
  const dist = new Uint8Array(BW * BW);                                                // water: Chebyshev distance to land (≤ 15, exact to PAD; beyond the buffer = water)
  for (let i = 0; i < dist.length; i++) dist[i] = cls[i] === 4 ? 15 : 0;
  for (let y = 0; y < BW; y++) for (let x = 0; x < BW; x++){ const i = y * BW + x; if (!dist[i]) continue; let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + 1); if (y > 0){ d = Math.min(d, dist[i - BW] + 1); if (x > 0) d = Math.min(d, dist[i - BW - 1] + 1); if (x < BW - 1) d = Math.min(d, dist[i - BW + 1] + 1); } dist[i] = d; }
  yield;
  for (let y = BW - 1; y >= 0; y--) for (let x = BW - 1; x >= 0; x--){ const i = y * BW + x; if (!dist[i]) continue; let d = dist[i];
    if (x < BW - 1) d = Math.min(d, dist[i + 1] + 1); if (y < BW - 1){ d = Math.min(d, dist[i + BW] + 1); if (x < BW - 1) d = Math.min(d, dist[i + BW + 1] + 1); if (x > 0) d = Math.min(d, dist[i + BW - 1] + 1); } dist[i] = d; }
  yield;
  const ov = new Uint8Array(TS * TS), ox = tx * TS, oy = ty * TS;                       // 1 district · 2 city · 3 trunk · 4 motorway
  const put = c => (x, y, n) => { if (c === 1 && n % 6 >= 3) return; x -= ox; y -= oy; if (x >= 0 && y >= 0 && x < TS && y < TS){ const i = y * TS + x; if (ov[i] < c) ov[i] = c; } };
  D.bnd.forEach((b, i) => { if (hitB(b.bb, s * 2)) bres(pxl('B' + i, b.pts, s, .6), put(b.c === 2 ? 2 : 1), ox - 1, oy - 1, ox + TS, oy + TS); });
  const rOK = c => c === 'motorway' ? s <= 256 : s <= 128;
  M.roads.forEach((r, i) => { if (rOK(r.c) && hitB(r.bb, s)) bres(pxl('R' + i, r.pts, s, .6), put(r.c === 'motorway' ? 4 : 3), ox - 1, oy - 1, ox + TS, oy + TS); });
  yield;
  const night = PX.theme !== 'day', L = rk('lite'), out = new Uint32Array(TS * TS);
  const K = {land: u32('land.d1'), built: u32('land.d2'), p2: u32('green.d2'), p3: u32('green.d3'), f1: u32('green.d1'), mway: u32(rk('mway')), trunk: u32(rk('trunk')),
    city: u32(rk('bCity')), dist: u32(rk('bDist')), wSh: u32(night ? 'water.shallow' : 'water.shore'), wMid: u32('water.mid'), wD1: u32('water.d1'), l0: u32(L[0]), l1: u32(L[1]), l2: u32(L[2]),
    vd: u32(rk('void'))};
  const I = island ? D.R : null, VB = 12, isl = (X, Y) => { const x = (X + .5) * s, y = -(Y + .5) * s, e = Math.min(x - I[0], I[2] - x, y - I[1], I[3] - y) / s;   // level px inside
    return e <= 0 || (e < VB && PX.bayer(X, Y) >= e / VB); };                          // the island's edge: void beyond, a 12 px Bayer shore
  const E = D.M.ext, N = D.net, fade = (X, Y) => { const x = (X + .5) * s, y = -(Y + .5) * s, e = Math.min(x - E[0], E[2] - x, y - E[1], E[3] - y);
    if (e <= 0) return true;                                                           // terrain: a vignette round the network (2 km, then an 8 km
    const d = Math.hypot(Math.max(N[0] - 2000 - x, 0, x - N[2] - 2000), Math.max(N[1] - 2000 - y, 0, y - N[3] - 2000)), t = Math.min(1 - d / 8000, e / 2000);   // Bayer fade), plain land beyond
    return t < 1 && PX.bayer(X, Y) >= t; };
  const hash = GEOM.hash, thick = i => { for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++){ const j = i + v * BW + u; if (j >= 0 && j < dist.length && dist[j] >= 3) return true; } return false; };
  for (let y = 0; y < TS; y++){ if (y && !(y & 63)) yield; for (let x = 0; x < TS; x++){
    const i = (y + PAD) * BW + x + PAD, X = ox + x, Y = oy + y;
    if (I && isl(X, Y)){ out[y * TS + x] = K.vd; continue; }
    const cut = fade(X, Y), c = cut ? 0 : cls[i], o = cut && ov[y * TS + x] >= 3 ? 0 : ov[y * TS + x]; let k;
    if (o >= 3) k = o === 4 ? K.mway : K.trunk;
    else if (c === 4){ const d = dist[i];
      if (night) k = d <= 1 ? K.wSh : d <= 3 ? K.wMid : K.wD1;
      else k = d <= 1 && thick(i) ? K.wSh : d > 5 && PX.bayer(X, Y) < Math.min(1, (d - 5) / 8) ? K.wD1 : K.wMid; }
    else if (o) k = o === 2 ? K.city : K.dist;
    else if (c === 1){ const p = (night ? .045 : .07) * (.3 + 1.4 * hash(X >> 2, Y >> 2, 4));
      if (hash(X, Y, 5) >= p) k = K.built; else { const q = hash(X, Y, 6); k = q < .1 ? K.l2 : q < .55 ? K.l1 : K.l0; } }
    else if (c === 2) k = ((X + Y * 2) % 5) === 0 ? K.p3 : K.p2;
    else if (c === 3) k = hash(X, Y, 3) < .2 ? K.p2 : K.f1;
    else k = K.land;
    out[y * TS + x] = k;
  } }
  return out;
}
/* tracks (+ station markers on 'lit') into a canvas whose (0, 0) is level px (ox, oy), w × h */
function tracksInto(g, s, lit, ox, oy, w, h){
  const D = data(), in_ = P => !(P.bb[2] < ox - 3 || P.bb[0] > ox + w + 3 || P.bb[3] < oy - 3 || P.bb[1] > oy + h + 3);
  const seg = (P, key, th) => { const m = th + 1; for (let i = 1; i < P.length; i++){ const a = P[i - 1], b = P[i];
    if (Math.max(a[0], b[0]) < ox - m || Math.min(a[0], b[0]) > ox + w + m || Math.max(a[1], b[1]) < oy - m || Math.min(a[1], b[1]) > oy + h + m) continue;
    PX.line(g, a[0] - ox, a[1] - oy, b[0] - ox, b[1] - oy, key, th); } };
  for (const [i, e] of D.M.extra.entries()){ const P = pxl('X' + i, e.pts, s); if (!in_(P)) continue; g.fillStyle = PX.col('lineDim.' + e.key);
    bres(P, (x, y, n) => { if (n % 7 < 4) g.fillRect(x - ox, y - oy, 1, 1); }, ox - 1, oy - 1, ox + w, oy + h); }
  const tr = D.order.map(id => { const L = D.lines.get(id); return [id, pxl('L' + id, L.pts, s), L.close ? pxl('C' + id, L.close, s) : null]; });
  if (!lit){ for (const [id, P, C] of tr) for (const Q of [P, C]) if (Q && in_(Q)) seg(Q, 'lineDim.' + id, 1); return; }
  const cw = coreW(s);
  for (const [id, P, C] of tr) for (const Q of [P, C]) if (Q && in_(Q)) seg(Q, PX.lk('case', id), cw + 2);
  for (const [id, P, C] of tr) for (const Q of [P, C]) if (Q && in_(Q)) seg(Q, PX.lk('disp', id), cw);
  if (s >= 256) return;
  const kind = kindOf(s);
  for (const st of D.stations){ const big = st.inter || st.term; if (s > 96 && !st.inter) continue;
    const X = Math.round(st.x / s) - ox, Y = Math.round(-st.y / s) - oy; if (X < -8 || Y < -8 || X > w + 8 || Y > h + 8) continue;
    SPR.put(g, mk(kind, big), X, Y); }
}
const GK = [];
function* bakeGen(T){
  const gk = 'g|' + T.th + '|' + T.s + '|' + T.tx + '|' + T.ty; let px = lru.get(gk);
  if (!px){ px = yield* ground(T); lru.set(gk, px, TB); GK.push(gk); while (GK.length > 4) lru.del(GK.shift()); }
  const {c, g} = PX.makeCanvas(TS, TS), img = g.createImageData(TS, TS); new Uint32Array(img.data.buffer).set(px); g.putImageData(img, 0, 0);
  yield;
  tracksInto(g, T.s, T.v === 'lit', T.tx * TS, T.ty * TS, TS, TS);
  return c;
}
const ST = {bakes: 0, bakeMs: 0, maxBake: 0, maxStep: 0, stand: 0, frames: 0, frameMs: 0, maxFrame: 0, mountMs: 0, restBakeMs: 0, readyMs: 0, lblMs: 0, syncBakes: 0};
function bakeNow(T){ const t0 = now(), it = bakeGen(T); let r; do r = it.next(); while (!r.done); const ms = now() - t0; ST.bakes++; ST.syncBakes++; ST.bakeMs += ms; ST.maxBake = Math.max(ST.maxBake, ms); return putTile(T, r.value); }
let standGen = 0;
function putTile(T, c){ const k = tkey(T.s, T.v, T.tx, T.ty, T.th); lru.set(k, c, TB); lru.del('f|' + k); if (T.s === STAND) standGen++; return c; }

/* ---------- idle bake queue: pri 0 = on screen now, 1 = the other variant / neighbours, 2 = the stand-in step ---------- */
const Q = new Map(); let job = null, idleH = 0, qseq = 0;
function want(s, v, tx, ty, pri, vis){
  const T = {s, v, tx, ty, th: PX.theme}, k = tkey(s, v, tx, ty); if (lru.has(k) || (job && job.k === k)) return;
  const q = Q.get(k); if (!q || q.pri > pri) Q.set(k, {T, k, pri, vis, at: qseq++}); kick();
}
const hasRIC = typeof requestIdleCallback === 'function';
function kick(){ if (idleH || !(Q.size || job)) return; idleH = hasRIC ? requestIdleCallback(pump, {timeout: 120}) : setTimeout(() => pump(null), 24); }
function pump(dl){
  idleH = 0; const end = now() + (dl && dl.timeRemaining ? Math.max(4, Math.min(12, dl.timeRemaining())) : 10); let hit = false;   // (short slices: no long tasks)
  while (now() < end){
    if (!job){ let best = null; for (const q of Q.values()) if (!best || q.pri < best.pri || (q.pri === best.pri && q.at > best.at)) best = q;
      if (!best) break; Q.delete(best.k); if (best.T.th !== PX.theme || lru.has(best.k)) continue; job = {...best, it: bakeGen(best.T), ms: 0}; }
    if (job.T.th !== PX.theme){ job = null; continue; }
    const t0 = now(), r = job.it.next(), d = now() - t0; job.ms += d; if (d > ST.maxStep) ST.maxStep = d;
    if (r.done){ putTile(job.T, r.value); ST.bakes++; ST.bakeMs += job.ms; ST.maxBake = Math.max(ST.maxBake, job.ms); ST.lastBake = job.ms; if (onScreen(job.T)) hit = true; job = null; }
  }
  if (hit) dirty();
  if (job || Q.size) kick(); else if (idleW.length){ const fire = () => { for (const f of idleW.splice(0)) f(); }; if (raf) requestAnimationFrame(fire); else fire(); }   // (after the frame it dirtied)
}
const idleW = [];

/* ---------- stand-ins: a tile not baked yet, from the 384 step (NN), else plain land ---------- */
let TMP = null;
const plainC = () => { const k = 'p|' + PX.theme; let c = lru.get(k); if (c) return c; const o = PX.makeCanvas(TS, TS); o.g.fillStyle = PX.col('land.d1'); o.g.fillRect(0, 0, TS, TS); return lru.set(k, o.c, TB); };
function standIn(s, v, tx, ty){
  if (s === STAND) return plainC();
  const k = 'f|' + tkey(s, v, tx, ty); let c = lru.get(k); if (c && c._gen === standGen) return c;
  const f = s / STAND, x0 = tx * TS * f, y0 = ty * TS * f, x1 = x0 + TS * f, y1 = y0 + TS * f, ix = Math.floor(x0), iy = Math.floor(y0), iw = Math.ceil(x1) - ix + 1, ih = Math.ceil(y1) - iy + 1;
  if (!TMP || TMP.c.width < iw || TMP.c.height < ih){ const o = TMP; TMP = PX.makeCanvas(Math.max(iw, o ? o.c.width : 0), Math.max(ih, o ? o.c.height : 0)); if (o) o.c.width = 0; lru.trim(); }
  const tg = TMP.g; tg.fillStyle = PX.col('land.d1'); tg.fillRect(0, 0, iw, ih); let any = false;
  for (let u = Math.floor(iy / TS); u <= Math.floor((iy + ih - 1) / TS); u++) for (let w = Math.floor(ix / TS); w <= Math.floor((ix + iw - 1) / TS); w++){
    const t = lru.get(tkey(STAND, v, w, u)) || lru.get(tkey(STAND, v === 'lit' ? 'dim' : 'lit', w, u)); if (t){ tg.drawImage(t, w * TS - ix, u * TS - iy); any = true; } }
  if (!any) return plainC();
  const o = c && c.width ? {c, g: c.getContext('2d')} : PX.makeCanvas(TS, TS); o.g.imageSmoothingEnabled = false;
  o.g.drawImage(TMP.c, x0 - ix, y0 - iy, x1 - x0, y1 - y0, 0, 0, TS, TS); o.c._gen = standGen; ST.stand++;
  return lru.set(k, o.c, TB);
}
const other = v => v === 'lit' ? 'dim' : 'lit';
function tileAt(s, v, tx, ty){
  const c = lru.get(tkey(s, v, tx, ty)); if (c) return c;
  return lru.get(tkey(s, other(v), tx, ty)) || standIn(s, v, tx, ty);
}

/* ---------- canvas host (the ride.js pattern: K = round(scale × dpr), exact device-pixel box, unsmoothed integer blit) ---------- */
let cv = null, dg = null, art = null, g = null, ro = null, host = null, mounted = false, devW = 0, devH = 0, K = 2, W = 64, H = 64, scale = 2, onView = null, raf = 0, fontsOk = false;
let cam = {m: 384, cx: 0, cy: 0}, anim = null, restS = 384, focusId = null, hoverId = null, tip = null, lblInfo = null, lblJob = null, last = null;
let lazy = false, ready = true, onReady = null, mountT = 0;
/* bytes of OVM's scratch canvases (counted with the LRU against MAXB) · freed when a glide / pinch lands; the life layers (ovlife.js:
   art-sized, like the display canvas) come on top of the budget, or a big screen's layers would starve the tiles into a re-bake loop */
function scratchB(){ let b = 0; for (const o of [art, LF, TMP, SG]) if (o && o.c) b += o.c.width * o.c.height * 4; return b; }
function freeScratch(){ if (LF){ LF.c.width = 0; LF = null; } if (TMP){ TMP.c.width = 0; TMP = null; } }
const idleCall = (f, ms) => hasRIC ? requestIdleCallback(f, {timeout: ms}) : setTimeout(f, 16), idleStop = h => (hasRIC ? cancelIdleCallback : clearTimeout)(h);
const binds = new Set();
function ensureCanvas(){
  if (cv) return;
  cv = document.createElement('canvas'); cv.id = 'ovCv'; cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges';
  dg = cv.getContext('2d'); if (!dg) throw new Error('OVM: no 2D canvas');
  art = PX.makeCanvas(64, 64); g = art.g;
}
function measure(){ const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; devW = Math.max(1, Math.round(r.width * dpr)); devH = Math.max(1, Math.round(r.height * dpr)); }
function resize(){
  const dpr = devicePixelRatio || 1; K = Math.max(1, Math.round(scale * dpr));
  W = Math.max(32, Math.floor(devW / K)); H = Math.max(32, Math.floor(devH / K));
  if (art.c.width !== W || art.c.height !== H){ art.c.width = W; art.c.height = H; }
  if (cv.width !== devW || cv.height !== devH){ cv.width = devW; cv.height = devH; }
  g.imageSmoothingEnabled = false; dg.imageSmoothingEnabled = false;
  const zoomed = cam.m < restS - 1e-9; restS = fitRest(); anim = null; dropLabels(); lv('inv');
  cam = focusId ? focusCam(focusId) : zoomed ? clampCam({...cam, m: Math.min(nearest(cam.m), restS)}) : restCam();
}
function blit(){
  dg.imageSmoothingEnabled = false; dg.fillStyle = PX.col('land.d1');
  if (devW > W * K) dg.fillRect(W * K, 0, devW - W * K, devH); if (devH > H * K) dg.fillRect(0, H * K, devW, devH - H * K);
  dg.drawImage(art.c, 0, 0, W * K, H * K);
}
const themeName = () => document.documentElement.dataset.theme === 'light' ? 'day' : 'night';
const setTheme = () => { const t = themeName(); if (PX.theme !== t || !PX.pal){ PX.setTheme(t); return true; } return false; };

/* ---------- camera: {m (m per art px), cx, cy (metres at the canvas centre)}; at rest m is a step and the centre on its grid ---------- */
const fitStep = (bb, w, h, mult, px, min = FINEST) => { for (let i = STEPS.length - 1; i >= 0; i--){ const s = STEPS[i]; if (s < min) continue;
  if ((bb[2] - bb[0]) * mult / s + px <= w && (bb[3] - bb[1]) * mult / s + px <= h) return s; } return STEPS[0]; };
/* pads: the UI over the canvas (CSS px) → FR, the covered margins in art px (the free rect keeps ≥ 32 art px each way); the camera centre
   sits (l − r) / 2, (t − b) / 2 art px off the free rect's centre */
let padDef = null, padNow = null;
const FR = {l: 0, t: 0, r: 0, b: 0}, AT = {x: 0, b: 0, w: 0};                            // AT: the attribution's left, bottom, room (art px)
function padArt(){
  const p = padNow || {}, f = (devicePixelRatio || 1) / K, q = x => Math.max(0, Math.round((+x || 0) * f)); let l = q(p.left), r = q(p.right), t = q(p.top), b = q(p.bottom);
  if (W - l - r < 32){ const k = Math.max(0, W - 32) / (l + r); l = Math.floor(l * k); r = Math.floor(r * k); }
  if (H - t - b < 32){ const k = Math.max(0, H - 32) / (t + b); t = Math.floor(t * k); b = Math.floor(b * k); }
  FR.l = l; FR.r = r; FR.t = t; FR.b = b;
  const a = p.attr && typeof p.attr === 'object' ? p.attr : null;
  if (a){ AT.x = Math.min(q(a.left), W - 32); AT.b = Math.max(32, H - q(a.bottom)); AT.w = W - AT.x; } else { AT.x = l; AT.b = H - b; AT.w = W - l - r; }
}
const fitRest = () => { padArt(); return fitStep(data().net, W - FR.l - FR.r, H - FR.t - FR.b, 1, 4); };
const offX = () => Math.round((FR.l - FR.r) / 2), offY = () => Math.round((FR.t - FR.b) / 2);
function clampCam(c, round = true){
  padArt(); const R = data().R, ox = offX() * c.m, oy = offY() * c.m, hw = (W - FR.l - FR.r) / 2 * c.m, hh = (H - FR.t - FR.b) / 2 * c.m;
  let fx = c.cx + ox, fy = c.cy - oy;                                                  // the free rect's centre
  fx = R[2] - R[0] <= 2 * hw ? (R[0] + R[2]) / 2 : clamp(fx, R[0] + hw, R[2] - hw);
  fy = R[3] - R[1] <= 2 * hh ? (R[1] + R[3]) / 2 : clamp(fy, R[1] + hh, R[3] - hh);
  const o = {m: c.m, cx: fx - ox, cy: fy + oy};
  if (round){ o.cx = Math.round(o.cx / o.m) * o.m; o.cy = Math.round(o.cy / o.m) * o.m; }
  return o;
}
const centred = (x, y, m) => { padArt(); return clampCam({m, cx: x - offX() * m, cy: y + offY() * m}); };
const restCam = () => { const n = data().net; return centred((n[0] + n[2]) / 2, (n[1] + n[3]) / 2, restS); };
const lineBB = id => { const L = line(id), b = L.bb.slice(); if (L.close) for (const p of L.close){ b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } return b; };
function focusCam(id){ padArt(); const b = lineBB(id), s = Math.min(restS, fitStep(b, W - FR.l - FR.r, H - FR.t - FR.b, 1.1, 16)); return centred((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, s); }
const viewOf = (c, s) => GEOM.view({lvl: s, mpp: c.m, cx: c.cx, cy: c.cy, W, H, k: 0, theme: PX.theme});
const shown = () => anim ? interp(anim, ease(clamp((now() - anim.t0) / anim.dur, 0, 1))) : cam;
function interp(a, e){
  const m = Math.exp(Math.log(a.from.m) + (Math.log(a.to.m) - Math.log(a.from.m)) * e);
  if (!a.fix) return {m, cx: a.from.cx + (a.to.cx - a.from.cx) * e, cy: a.from.cy + (a.to.cy - a.from.cy) * e};
  const f = a.fix, fx = mm => f.gx - f.u * mm, fy = mm => f.gy + f.w * mm;                // the ground point under (u, w) stays put
  return {m, cx: fx(m) + (a.to.cx - fx(a.to.m)) * e, cy: fy(m) + (a.to.cy - fy(a.to.m)) * e};
}
function go(to, dur, fix){
  const from = shown(); tip = null;
  if (!mounted || RED() || !dur || (Math.abs(from.m - to.m) < 1e-9 && Math.abs(from.cx - to.cx) < 1e-6 && Math.abs(from.cy - to.cy) < 1e-6)){ anim = null; cam = to; settle(); }
  else { anim = {from, to, t0: now(), dur, fix}; cam = from; }
  dirty(); return true;
}
function settle(){
  if (!anim && !pinching) freeScratch();
  const st = OVM.state(); for (const b of binds) b.sync();
  if (onView) try { onView(st); } catch (e){ console.error(e); }
}
OVM.state = () => { const t = anim ? anim.to : cam; return {m: t.m, rest: restS, zoomed: t.m < restS - 1e-9, focus: focusId, hover: hoverId}; };

/* ---------- frame ---------- */
const hl = () => hoverId || focusId;
function range(v, s, w = W, h = H){ const zs = s / v.mpp, lw = w / zs, lh = h / zs; return [Math.floor(v.ox / TS), Math.floor(v.oy / TS), Math.floor((v.ox + lw - 1e-6) / TS), Math.floor((v.oy + lh - 1e-6) / TS)]; }
function allIn(s, variant, c){ const [a, b, e, f] = range(viewOf(c, s), s); for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) if (!lru.has(tkey(s, variant, tx, ty))) return false; return true; }
const onScreen = T => { if (!mounted || T.th !== PX.theme) return false; if (anim || pinching || T.s === STAND) return true;
  const s = nearest(cam.m); if (T.s !== s) return false; const [a, b, e, f] = range(viewOf({...cam, m: s}, s), s); return T.tx >= a && T.tx <= e && T.ty >= b && T.ty <= f; };
let LF = null;
function drawMap(tg, c, variant){
  let s = c.m, v;
  if (STEPS.includes(c.m)) v = GEOM.view({lvl: s, cx: c.cx, cy: c.cy, W, H, k: 0});
  else { const cand = STEPS.filter(x => x >= c.m / 2 && x <= c.m * 2).sort((a, b) => Math.abs(Math.log(a / c.m)) - Math.abs(Math.log(b / c.m)));
    s = cand.find(x => allIn(x, variant, c)) || cand[0] || nearest(c.m); v = GEOM.view({lvl: s, mpp: c.m, cx: c.cx, cy: c.cy, W, H, k: 0}); }
  const [a, b, e, f] = range(v, s);
  if (v.rest){ for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) tg.drawImage(tileAt(s, variant, tx, ty), tx * TS - v.ox, ty * TS - v.oy); return v; }
  const zs = v.zs, bw = (e - a + 1) * TS, bh = (f - b + 1) * TS;                 // the level frame: tiles at the source step, then NN to the canvas
  if (!LF || LF.c.width < bw || LF.c.height < bh){ const o = LF; LF = PX.makeCanvas(Math.max(bw, o ? o.c.width : 0), Math.max(bh, o ? o.c.height : 0)); if (o) o.c.width = 0; lru.trim(); }
  for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) LF.g.drawImage(tileAt(s, variant, tx, ty), (tx - a) * TS, (ty - b) * TS);
  tg.imageSmoothingEnabled = false; tg.drawImage(LF.c, v.ox - a * TS, v.oy - b * TS, W / zs, H / zs, 0, 0, W, H);
  return v;
}
/* one line lit over whatever is drawn: casing + core in its display colours, then its station markers */
function drawLit(tg, id, v, o = {}){
  const L = line(id); if (!L) return;
  const s = v.lvl, st = nearest(v.mpp), cw = coreW(st), map = P => P.map(p => [v.sx(p[0]), v.sy(p[1])]);
  const P = map(pxl('L' + id, L.pts, s)), C = L.close ? map(pxl('C' + id, L.close, s)) : null, ck = PX.lk('case', id), dk = PX.lk('disp', id);
  for (const k of [[ck, cw + 2], [dk, cw]]){ PX.polyline(tg, P, k[0], k[1]); if (C) PX.polyline(tg, C, k[0], k[1]); }
  const kind = kindOf(st);
  L.st.forEach((q, i) => { const x = v.sx(Math.round(q.x / s)), y = v.sy(Math.round(-q.y / s));
    const sp = o.end === i ? SPR.stnNext(0, true, id) : mk(kind, q.inter || q.term, !!o.done); if (sp) SPR.put(tg, sp, x, y); });
}
/* ---------- focus labels: level only, greedy over 8 spots per station, in level px of the step (camera-independent) ---------- */
const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function segHits(P, r){ let n = 0; const x0 = r.x - 1, y0 = r.y - 1, x1 = r.x + r.w + 1, y1 = r.y + r.h + 1;
  for (let i = 1; i < P.length; i++){ const [ax, ay] = P[i - 1], [bx, by] = P[i]; let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay; let ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]){ if (p === 0){ if (q < 0){ ok = false; break; } continue; } const t = q / p; if (p < 0){ if (t > t1){ ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0){ ok = false; break; } if (t < t1) t1 = t; } }
    if (ok) n++; }
  return n; }
function* labelsGen(id, s, box, obst, ringI = -1){
  const L = line(id), kind = kindOf(s), A = L.st.map(q => [Math.round(q.x / s), Math.round(-q.y / s)]), n = A.length;
  const Pt = pxl('L' + id, L.pts, s), Pc = L.close ? pxl('C' + id, L.close, s) : null, cw = (coreW(s) >> 1) + 1;
  const rad = i => i === ringI ? CR - 1 : radOf(kind, L.st[i].inter || L.st[i].term), pri = i => L.st[i].term ? 2 : L.st[i].inter ? 1 : 0;
  const order = [...Array(n).keys()].sort((a, b) => pri(b) - pri(a) || Math.min(a, n - 1 - a) - Math.min(b, n - 1 - b) || a - b);
  const inBox = r => !box || (r.x >= box[0] && r.y >= box[1] && r.x + r.w <= box[2] && r.y + r.h <= box[3]);
  const run = font => {
    const fi = typeof FONTS !== 'undefined' && FONTS.info && FONTS.info[font.toUpperCase()], ht = fi ? fi.hanTop : 2, hh = fi ? fi.hanH : font === 'fp12' ? 11 : 9;
    const marks = A.map((a, i) => ({x: a[0] - rad(i) - 1, y: a[1] - rad(i) - 1, w: rad(i) * 2 + 3, h: rad(i) * 2 + 3}));
    const placed = obst ? obst.slice() : [], out = []; let drop = 0;
    for (const i of order){
      if (!L.st[i].zh || !drawn(kind, L.st[i])) continue;
      const w = PX.measure(L.st[i].zh, font), r = rad(i) + 2, [ax, ay] = A[i], vis = !box || (ax >= box[0] && ay >= box[1] && ax < box[2] && ay < box[3]);
      const C = [[r, -(hh >> 1)], [-r - w, -(hh >> 1)], [r - 1, -r - hh + 1], [r - 1, r - 1], [-r - w + 1, -r - hh + 1], [-r - w + 1, r - 1], [-(w >> 1), -r - hh - 1], [-(w >> 1), r + 1]];
      let best = null, bs = 1e9;
      C.forEach(([dx, dy], ci) => { const b = {x: ax + dx - 1, y: ay + dy - 1, w: w + 2, h: hh + 2};
        if (vis && !inBox(b)) return; if (placed.some(q => over(b, q))) return; if (marks.some((q, j) => j !== i && over(b, q))) return;
        const t = {x: b.x - cw, y: b.y - cw, w: b.w + cw * 2, h: b.h + cw * 2}, sc = ci + (segHits(Pt, t) + (Pc ? segHits(Pc, t) : 0)) * 20;
        if (sc < bs){ bs = sc; best = [dx, dy]; } });
      if (!best){ drop++; continue; }
      placed.push({x: ax + best[0] - 1, y: ay + best[1] - 1, w: w + 2, h: hh + 2}); out.push({i, zh: L.st[i].zh, x: ax + best[0], y: ay + best[1] - ht, font});
    }
    return {out, drop, font};
  };
  const a = run('fp12'); if (!a.drop) return a;
  yield; const b = run('fp10');
  return b.drop < a.drop ? b : a;
}
const labels = (id, s, box) => { const it = labelsGen(id, s, box); let r; do r = it.next(); while (!r.done); return r.value; };
/* the focused line's labels: laid out in idle steps (one font per step) after the view lands, drawn from the next frame on; when only
   the cursor or the badges moved (same line, step, size and pads) the layout reruns at once, so the labels never blink out */
function drawLabels(tg, v){
  const s = v.lvl, base = focusId + '|' + s + '|' + W + 'x' + H + '|' + FR.l + ',' + FR.t + ',' + FR.r + ',' + FR.b + ',' + AT.x + ',' + AT.b + ',' + AT.w;
  const key = base + '|' + (LV ? progKey + '|' + (cur ? cur.id + cur.rev + cur.label : '') : '-'), put = () => { for (const l of lblInfo.out) PX.text(tg, l.zh, l.x - v.ox, l.y - v.oy, {font: l.font, color: 'text', outline: 'textOutline'}); };
  if (lblInfo && lblInfo.key === key){ put(); return; }
  if (lblJob && lblJob.key === key) return;
  if (lblJob){ idleStop(lblJob.h); lblJob = null; }
  const [ob, ri] = LV ? LV.obst(v, s) : [[], -1];
  const ab = attrBox(); ob.push({x: ab.x + v.ox, y: ab.y + v.oy, w: ab.w, h: ab.h});
  const it = labelsGen(focusId, s, [v.ox + FR.l + 2, v.oy + FR.t + 2, v.ox + W - FR.r - 2, v.oy + H - FR.b - 2], ob, ri);
  if (lblInfo && lblInfo.base === base){ const t0 = now(); let r; do r = it.next(); while (!r.done); ST.lblMs = Math.max(ST.lblMs || 0, now() - t0); lblInfo = {key, base, ...r.value}; put(); return; }
  const J = lblJob = {key, it};
  const step = () => { if (lblJob !== J) return; const t0 = now(), r = J.it.next(); ST.lblMs = Math.max(ST.lblMs || 0, now() - t0);
    if (!r.done){ J.h = idleCall(step, 200); return; } lblJob = null; lblInfo = {key, base, ...r.value}; dirty(); };
  J.h = idleCall(step, 200);
}
const dropLabels = () => { lblInfo = null; if (lblJob){ idleStop(lblJob.h); lblJob = null; } };
/* raised pixel panel (ui.js frame recipe: edge, lit top-left bevel, shaded bottom-right, 1 px drop shadow) */
function frame(tg, x, y, w, h){ const R = PX.rect;
  PX.panel(tg, x, y, w, h, {fill: rk('frame')});
  R(tg, x + 1, y + 1, 1, h - 3, 'ui.hi'); R(tg, x + w - 2, y + 2, 1, h - 3, 'ui.lo');
  R(tg, x + w, y + 2, 1, h - 2, 'shadow'); R(tg, x + 2, y + h, w - 2, 1, 'shadow'); R(tg, x + w - 1, y + h - 1, 1, 1, 'shadow'); }
function drawTip(tg, v, q){
  const s = v.lvl, x = v.sx(Math.round(q.x / s)), y = v.sy(Math.round(-q.y / s)); if (x < -4 || y < -4 || x > W + 4 || y > H + 4) return;
  const wz = PX.measure(q.zh, 'fp12'), wp = q.py ? PX.measure(q.py, 'fp10') : 0, nc = q.lines.length, cs = 7, wc = nc ? nc * cs + 3 : 0;
  const w = Math.max(wz + wc, wp) + 8, h = q.py ? 30 : 17, r = radOf(kindOf(nearest(v.mpp)), true) + 3;
  let bx = x + r, by = y - r - h; if (bx + w + 2 > W - FR.r) bx = x - r - w - 1; if (by < FR.t + 1) by = y + r;
  bx = clamp(bx, FR.l + 1, W - FR.r - w - 2); by = clamp(by, FR.t + 1, H - FR.b - h - 2);
  frame(tg, bx, by, w, h);
  PX.text(tg, q.zh, bx + 4, by + 2, {font: 'fp12', color: 'text'});
  q.lines.forEach((id, j) => { const X = bx + 4 + wz + 3 + j * cs; PX.rect(tg, X, by + 5, cs - 1, cs - 1, 'ink'); PX.rect(tg, X + 1, by + 6, cs - 3, cs - 3, 'line.' + id); });
  if (q.py) PX.text(tg, q.py, bx + 4, by + 16, {font: 'fp10', color: 'textDim'});
}
const attrLines = w => PX.measure(ATTR, 'fp8') + 6 <= w ? [ATTR] : ['© OpenStreetMap', 'contributors'];
function attribution(tg, w, h, x0 = 0){
  const L = attrLines(w);
  L.forEach((t, i) => PX.text(tg, t, x0 + 3, h - 3 - (L.length - i) * 9 + 1, {font: 'fp8', color: 'textDim', outline: 'textOutline'}));
}
const attrBox = () => { const L = attrLines(AT.w); return {x: AT.x + 1, y: AT.b - 4 - L.length * 9, w: Math.max(...L.map(t => PX.measure(t, 'fp8'))) + 5, h: L.length * 9 + 3}; };
/* ---------- life: the state of OVM.trains / progress / cursor / marks lives here, their drawing in js/px/ovlife.js (LV: its hooks once
   it is in · lvS: 0 not asked, 1 loading, 2 in, 3 failed) ---------- */
let tMode = 'off', prog = null, progKey = '', cur = null, MK = null, mkKey = '', LV = null, lvS = 0;
const CR = 8;                                                                            // the START ring's radius (SPR.stnNext big, frame 1)
const lv = (k, a) => LV ? LV[k](a) : undefined;
/* injected once a mounted map is ready (its first view shown) and life is on: a page that never asks never loads it */
function need(){
  if (lvS || !LSRC || !mounted || !ready || (tMode === 'off' && !prog && !cur && !MK)) return; lvS = 1;
  const put = n => { const s = document.createElement('script'); s.src = n ? LSRC + (LSRC.includes('?') ? '&' : '?') + 'lr=' + n : LSRC;
    s.onload = () => { if (!LV) lvS = 3; }; s.onerror = () => { s.remove(); if (n < 2) setTimeout(() => put(n + 1), 600 * (2 * n + 1)); else lvS = 3; };
    document.head.appendChild(s); };
  put(0);
}
function draw(){
  raf = 0; if (!mounted) return 0;
  const t0 = now(); let c = cam, moving = false;
  if (anim){ const f = clamp((t0 - anim.t0) / anim.dur, 0, 1); c = interp(anim, ease(f)); if (f >= 1){ cam = anim.to; anim = null; c = cam; settle(); } else moving = true; }
  else if (pinching) moving = true;
  const id = hl(), variant = id ? 'dim' : 'lit'; padArt();
  g.fillStyle = PX.col('land.d1'); g.fillRect(0, 0, W, H);
  const v = drawMap(g, c, variant);
  const mid = tg => {                                                                    // the lit line + its focus labels
    if (id) drawLit(tg, id, v);
    if (!moving && fontsOk && focusId && id === focusId) drawLabels(tg, v); };
  const top = tg => {                                                                    // badges, tooltip, attribution
    if (LV) LV.badges(tg, v);
    if (!moving && fontsOk && tip) drawTip(tg, v, tip);
    if (fontsOk) attribution(tg, AT.w, AT.b, AT.x); };
  if (LV) LV.draw(v, id, moving, mid, top); else { mid(g); top(g); }                   // (ovlife.js: trains, marks, the START sign)
  if (!ready && !moving && allIn(v.lvl, variant, c)){ ready = true; cv.style.visibility = ''; ST.readyMs = now() - mountT; if (onReady) try { onReady(); } catch (e){ console.error(e); } lv('sync'); need(); }
  blit();
  wantView(anim ? anim.to : c, variant);
  const ms = now() - t0; ST.frames++; ST.frameMs = ms; ST.maxFrame = Math.max(ST.maxFrame, ms); last = {v, c};
  if (moving && anim) raf = requestAnimationFrame(draw);
  return ms;
}
function wantView(c, variant){
  const CAP = Math.floor((MAXB - scratchB()) / TB * .75);                              // background wants stay under ¾ of the LRU's room (no thrash)
  for (const q of Q.values()) if (q.vis && q.pri < 3) q.pri = 3;
  const s = nearest(c.m), v = viewOf({...c, m: s}, s), [a, b, e, f] = range(v, s), n = (e - a + 1) * (f - b + 1);
  for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) want(s, variant, tx, ty, 0, true);
  if (2 * n + 12 <= CAP) for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) want(s, other(variant), tx, ty, 1, true);
  if (!anim && s < restS && 2 * n + 2 * (e - a + f - b + 6) + 12 <= CAP){ const R = data().R, ra = Math.floor(R[0] / s / TS), re = Math.floor(R[2] / s / TS), rb = Math.floor(-R[3] / s / TS), rf = Math.floor(-R[1] / s / TS);
    for (let ty = Math.max(b - 1, rb); ty <= Math.min(f + 1, rf); ty++) for (let tx = Math.max(a - 1, ra); tx <= Math.min(e + 1, re); tx++) if (tx < a || tx > e || ty < b || ty > f) want(s, variant, tx, ty, 2, true); }
  let old = 0; for (const [k, q] of Q) if (q.pri >= 3 && ++old > 48) Q.delete(k);
}
function wantStand(){ const R = data().R, s = STAND, a = Math.floor(R[0] / s / TS), e = Math.floor(R[2] / s / TS), b = Math.floor(-R[3] / s / TS), f = Math.floor(-R[1] / s / TS);
  for (const v of ['lit', 'dim']) for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) want(s, v, tx, ty, 2, false); }
function syncBake(c, variant){ const s = nearest(c.m), [a, b, e, f] = range(viewOf({...c, m: s}, s), s);
  for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) if (!lru.has(tkey(s, variant, tx, ty))) bakeNow({s, v: variant, tx, ty, th: PX.theme}); }
const dirty = () => { if (!raf && mounted) raf = requestAnimationFrame(draw); };

/* ---------- API ---------- */
OVM.mount = (h, o = {}) => {
  const t0 = now(); data(); ensureCanvas(); setTheme();
  if (o.scale) scale = +o.scale || 2; if (o.onView !== undefined) onView = o.onView;
  if (cv.parentNode !== h) h.appendChild(cv); host = h; mounted = true;
  if (!ro && window.ResizeObserver){
    ro = new ResizeObserver(es => { const e = es[0], dpr = devicePixelRatio || 1, w = e.contentRect.width * dpr, hh = e.contentRect.height * dpr;
      let bx = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
      if (bx && (Math.abs(bx.inlineSize - w) > 2 || Math.abs(bx.blockSize - hh) > 2)) bx = null;
      const nw = bx ? bx.inlineSize : Math.round(w), nh = bx ? bx.blockSize : Math.round(hh); if (!nw || !nh || (nw === devW && nh === devH && K === Math.max(1, Math.round(scale * dpr)))) return;
      devW = nw; devH = nh; if (mounted){ resize(); if (!lazy) syncBake(cam, hl() ? 'dim' : 'lit'); draw(); settle(); } });
    try { ro.observe(cv, {box: 'device-pixel-content-box'}); } catch (e){ ro.observe(cv); }
  }
  measure(); resize();
  lazy = !!o.lazy; onReady = o.onReady || null; mountT = now();
  const s = nearest(cam.m), variant = hl() ? 'dim' : 'lit';
  if (lazy && !allIn(s, variant, cam)){ ready = false; cv.style.visibility = 'hidden'; ST.restBakeMs = 0; }
  else { syncBake(cam, variant); ST.restBakeMs = ST.readyMs = now() - mountT; ready = true; cv.style.visibility = ''; }
  draw(); wantStand(); settle(); lv('on'); need();
  ST.mountMs = now() - t0; if (ready && onReady) try { onReady(); } catch (e){ console.error(e); }
  if (!fontsOk && typeof FONTS !== 'undefined' && FONTS.ready) FONTS.ready.then(() => { fontsOk = true; dropLabels(); dirty(); }, () => {});
  return cv;
};
OVM.unmount = () => { mounted = false; anim = null; if (raf) cancelAnimationFrame(raf); raf = 0; if (idleH){ idleStop(idleH); idleH = 0; } dropLabels(); freeScratch(); lv('off');
  if (ro){ ro.disconnect(); ro = null; } if (cv && cv.parentNode) cv.parentNode.removeChild(cv); host = null; };
OVM.free = () => { Q.clear(); job = null; lru.clear(); PC.clear(); U32.clear(); dropLabels(); freeScratch(); if (SG){ SG.c.width = 0; SG = null; } lv('free'); dirty(); };
OVM.theme = () => { if (typeof PAL === 'undefined') return; if (setTheme() && mounted){ dropLabels(); syncBake(cam, hl() ? 'dim' : 'lit'); draw(); wantStand(); } else dirty(); };
const padOf = o => o && typeof o === 'object' && 'pad' in o ? o.pad || null : padDef;
OVM.rest = o => { if (o && typeof o === 'object'){ padNow = padOf(o); focusId = null; dropLabels();
  if (mounted){ restS = fitRest(); go(restCam(), o.animate === false ? 0 : GLIDE.focus); } } return restS; };
OVM.focus = (id, o = {}) => { if (id && !line(id)) id = null; focusId = id || null; padNow = padOf(o); dropLabels(); if (!mounted) return false;
  restS = fitRest(); return go(focusId ? focusCam(focusId) : restCam(), o.animate === false ? 0 : GLIDE.focus); };
OVM.setPad = (p, o = {}) => { padDef = padNow = p || null; dropLabels(); if (!mounted) return false; restS = fitRest();
  return o.reframe === false ? (cam = clampCam(cam), dirty(), true) : go(focusId ? focusCam(focusId) : restCam(), o.animate ? GLIDE.focus : 0); };
const lset = () => { lv('set'); dirty(); need(); };                                      // (a life setter ran: ovlife.js takes the state)
OVM.trains = m => { if (m === undefined) return tMode; m = m === 'lively' || m === 'calm' ? m : 'off'; if (m !== tMode){ tMode = m; lset(); } return tMode; };
OVM.progress = p => { const q = {}; if (p) for (const k in p) if (line(k) && p[k] != null) q[k] = clamp(+p[k] | 0, 0, 3);
  prog = Object.keys(q).length ? q : null; progKey = prog ? JSON.stringify(prog) : ''; lset(); return prog; };
OVM.cursor = (id, o = {}) => { cur = id && line(id) ? {id, rev: !!o.rev, label: o.label || 'START', font: o.font || 'fp10'} : null; lset(); return cur ? {...cur} : null; };
OVM.marks = list => { const by = new Map(data().stations.map(q => [q.zh, q])), a = []; if (list) for (const k of list){ const q = by.get(k); if (q && a.length < 64) a.push(q); }
  const k = a.map(q => q.zh).join(','); if (k === mkKey) return a.length; MK = a.length ? a : null; mkKey = k; lset(); return a.length; };
OVM.island = v => { if (v !== undefined && !!v !== island){ island = !!v; Q.clear(); job = null; lru.clear(); lv('inv'); dropLabels();
  if (mounted){ syncBake(cam, hl() ? 'dim' : 'lit'); wantStand(); } dirty(); } return island; };
OVM.reducedMotion = v => { if (v !== undefined){ rmForce = v == null ? null : !!v; if (rmForce && anim){ cam = anim.to; anim = null; settle(); } lv('sync'); dirty(); } return RED(); };
OVM.hover = id => { id = id && line(id) ? id : null; if (id === hoverId) return; hoverId = id; tip = null; dirty(); };
OVM.reset = (o = {}) => mounted && go(focusId ? focusCam(focusId) : restCam(), o.animate === false ? 0 : GLIDE.focus);
OVM.go = (c, o = {}) => mounted && go(clampCam({m: clamp(nearest(c.m || restS), FINEST, restS), cx: c.x != null ? c.x : cam.cx, cy: c.y != null ? c.y : cam.cy}), o.animate ? o.dur || GLIDE.step : 0);
const toArt = (x, y) => { const f = (devicePixelRatio || 1) / K; return [x * f, y * f]; };
OVM.zoomAt = (dir, sx, sy) => {
  if (!mounted) return false;
  const base = anim ? anim.to : cam, i = STEPS.indexOf(nearest(base.m)), j = clamp(i + (dir > 0 ? 1 : -1), STEPS.indexOf(restS), STEPS.length - 1); if (j === i) return false;
  const c = shown(), [u, w] = sx == null ? [W >> 1, H >> 1] : toArt(sx, sy), fix = {u: u - (W >> 1), w: w - (H >> 1)}; fix.gx = c.cx + fix.u * c.m; fix.gy = c.cy - fix.w * c.m;
  const s = STEPS[j]; return go(clampCam({m: s, cx: fix.gx - fix.u * s, cy: fix.gy + fix.w * s}), GLIDE.step, fix);
};
OVM.panBy = (dx, dy) => {
  if (!mounted) return false; if (anim){ cam = anim.to; anim = null; settle(); }
  dx = Math.round(dx); dy = Math.round(dy); if (!dx && !dy) return false;
  const c = clampCam({m: cam.m, cx: cam.cx - dx * cam.m, cy: cam.cy + dy * cam.m}); if (c.cx === cam.cx && c.cy === cam.cy) return false;
  cam = c; tip = null; dirty(); return true;
};
/* pinch: a continuous NN scale about the fingers' midpoint (u, w art px), then a snap to the nearest step */
let pinching = null;
const pinchStart = (u, w) => { const c = shown(); anim = null; cam = c; pinching = {m: c.m, gx: c.cx + (u - (W >> 1)) * c.m, gy: c.cy - (w - (H >> 1)) * c.m}; };
const pinchMove = (f, u, w) => { if (!pinching) return; const m = clamp(pinching.m / f, FINEST * .8, restS * 1.05), fu = u - (W >> 1), fw = w - (H >> 1);
  cam = clampCam({m, cx: pinching.gx - fu * m, cy: pinching.gy + fw * m}, false); tip = null; dirty(); };
const pinchEnd = (u, w) => { if (!pinching) return; pinching = null; const c = cam, s = clamp(nearest(c.m), FINEST, restS), fix = {u: u - (W >> 1), w: w - (H >> 1)}; fix.gx = c.cx + fix.u * c.m; fix.gy = c.cy - fix.w * c.m;
  go(clampCam({m: s, cx: fix.gx - fix.u * s, cy: fix.gy + fix.w * s}), GLIDE.step, fix); };
OVM.hit = (sx, sy, tol = 4) => {
  const out = {line: null, station: null, d: Infinity}; if (!mounted) return out;
  const c = shown(), [u, w] = toArt(sx, sy), gx = c.cx + (u - (W >> 1)) * c.m, gy = c.cy - (w - (H >> 1)) * c.m, m = c.m, D = data(), id0 = hl(), st = nearest(m), kind = kindOf(st);
  const lh = LV && last ? LV.hit(u, w, tol) : null;                                       // the START sign / ring, then a badge → its line
  if (lh){ out.line = lh[0]; out.d = 0; if (lh[1]) out.cursor = true; return out; }
  const cand = id0 ? line(id0).st.filter(q => drawn(kind, q)) : st >= 256 ? [] : D.stations.filter(q => st <= 96 || q.inter);
  for (const q of cand){ const d = Math.hypot(q.x - gx, q.y - gy) / m, r = radOf(kind, q.inter || q.term) + 2; if (d <= r && (!out.station || d < out.sd)){ out.station = q; out.sd = d; } }
  const ds = (P, x, y) => { let b = Infinity; for (let i = 1; i < P.length; i++){ const [ax, ay] = P[i - 1], [bx, by] = P[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? clamp(((x - ax) * dx + (y - ay) * dy) / l, 0, 1) : 0; b = Math.min(b, Math.hypot(ax + dx * t - x, ay + dy * t - y)); } return b; };
  for (const id of D.order){ const L = D.lines.get(id); let d = Math.min(ds(L.pts, gx, gy), L.close ? ds(L.close, gx, gy) : Infinity) / m; if (id === id0) d -= 1.5; if (d < out.d){ out.d = d; out.line = id; } }
  if (out.d > tol) out.line = null;
  if (out.station && !out.line) out.line = out.station.id;
  if (out.station){ const q = out.station; out.station = {id: q.id, i: q.i, zh: q.zh, py: q.py, lines: q.lines.slice(), x: q.x, y: q.y}; out.line = id0 && q.lines.includes(id0) ? id0 : out.line; }
  delete out.sd; return out;
};
OVM.input = (el, o = {}) => {
  el = el || cv; if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  const pts = new Map(), DBL = 320, dbl = o.dbl !== false; let down = null, drag = false, pin = null, pinched = false, lastTap = null, pend = 0, acc = 0, lock = 0, rem = [0, 0];
  const rel = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const zoomed = () => OVM.state().zoomed;
  const b = {sync(){ el.style.touchAction = zoomed() ? 'none' : 'pan-x pan-y'; }}; binds.add(b); b.sync();
  const setHover = (id, q) => { const ch = id !== hoverId; OVM.hover(id); const t = q || null; if ((t && t.zh) !== (tip && tip.zh)){ tip = t; dirty(); } if (ch && o.onHover) o.onHover(id); };
  const onWheel = e => { const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), dir = d < 0 ? 1 : -1; if (!d) return;
    const s = nearest((anim ? anim.to : cam).m); if (dir > 0 ? s <= FINEST : s >= restS){ acc = 0; return; }
    e.preventDefault(); const t = now(); if (t < lock) return; acc += d;
    if (Math.abs(acc) >= (e.ctrlKey ? 8 : 40)){ acc = 0; lock = t + 140; const [x, y] = rel(e); OVM.zoomAt(dir, x, y); } };
  const onDown = e => { const [x, y] = rel(e); pts.set(e.pointerId, [x, y]);
    if (pts.size === 1){ down = {x, y, t: now(), type: e.pointerType}; drag = false; pinched = false; rem = [0, 0]; }
    else if (pts.size === 2){ const a = [...pts.values()], [u, w] = toArt((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2); pin = {d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1])}; pinched = true; pinchStart(u, w);
      try { el.setPointerCapture(e.pointerId); } catch (_){} } };
  const onMove = e => { const [x, y] = rel(e);
    if (!pts.has(e.pointerId)){ if (e.pointerType === 'mouse' && !e.buttons){ const h = OVM.hit(x, y, 4); setHover(h.line, h.station); } return; }
    const p = pts.get(e.pointerId), dx = x - p[0], dy = y - p[1]; pts.set(e.pointerId, [x, y]);
    if (pin && pts.size >= 2){ const a = [...pts.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), [u, w] = toArt((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2); if (pin.d > 0) pinchMove(d / pin.d, u, w); pin.u = u; pin.w = w; return; }
    if (!down || pinched || !zoomed()) return;
    if (!drag && Math.hypot(x - down.x, y - down.y) > 5){ drag = true; try { el.setPointerCapture(e.pointerId); } catch (_){} }
    if (drag){ const [u, w] = toArt(dx, dy); rem[0] += u; rem[1] += w; const ix = Math.trunc(rem[0]), iy = Math.trunc(rem[1]); rem[0] -= ix; rem[1] -= iy; OVM.panBy(ix, iy); } };
  const onUp = e => { if (!pts.has(e.pointerId)) return; const [x, y] = pts.get(e.pointerId); pts.delete(e.pointerId);
    if (pin && pts.size < 2){ pinchEnd(pin.u != null ? pin.u : W >> 1, pin.w != null ? pin.w : H >> 1); pin = null; }
    if (pts.size || !down) return;
    const tap = e.type === 'pointerup' && !drag && !pinched && Math.hypot(x - down.x, y - down.y) <= 6 && (down.type === 'mouse' || now() - down.t < 500), t = now(); down = null;
    if (!tap) return;
    if (dbl && lastTap && t - lastTap.t < DBL && Math.hypot(x - lastTap.x, y - lastTap.y) < 24){ lastTap = null; clearTimeout(pend); pend = 0; OVM.reset(); return; }
    lastTap = {t, x, y};
    const h = OVM.hit(x, y, e.pointerType === 'mouse' ? 4 : 8), pick = () => { if (o.onPick && mounted) o.onPick(h.line || null, h); };
    if (h.station && focusId && h.station.lines.includes(focusId)){ tip = h.station; dirty(); return; }
    clearTimeout(pend); pend = 0; if (!dbl){ pick(); return; }
    pend = setTimeout(() => { pend = 0; pick(); }, DBL); };
  const onLeave = e => { if (e.pointerType === 'mouse' && !pts.size){ const ch = hoverId !== null; tip = null; OVM.hover(null); if (ch && o.onHover) o.onHover(null); } };
  const onKey = e => { if (e.altKey || e.ctrlKey || e.metaKey) return; let ok = false; const P = 32;
    if (e.key === '+' || e.key === '=') ok = OVM.zoomAt(1); else if (e.key === '-' || e.key === '_') ok = OVM.zoomAt(-1); else if (e.key === '0') ok = OVM.reset();
    else if (e.key === 'ArrowLeft') ok = OVM.panBy(P, 0); else if (e.key === 'ArrowRight') ok = OVM.panBy(-P, 0); else if (e.key === 'ArrowUp') ok = OVM.panBy(0, P); else if (e.key === 'ArrowDown') ok = OVM.panBy(0, -P);
    if (ok) e.preventDefault(); };
  const L = [['wheel', onWheel, {passive: false}], ['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['pointerleave', onLeave], ['keydown', onKey]];
  for (const [n, f, op] of L) el.addEventListener(n, f, op);
  return () => { clearTimeout(pend); for (const [n, f, op] of L) el.removeEventListener(n, f, op); binds.delete(b); };
};
/* the whole-line picture's step and view: the finest step (≥ min) at which the line's bbox × 1.1 + 16 px fits a box (the one of o.box
   that fits the finest step, then the roomiest), centred on that box */
function whole(id, w, h, o){
  const L = line(id); if (!L) throw new Error('OVM.drawWhole: no line ' + id);
  const bb = lineBB(id), min = o.min || FINEST, bw = bb[2] - bb[0], bh = bb[3] - bb[1], bs = (o.box ? (Array.isArray(o.box[0]) ? o.box : [o.box]) : []).filter(b => b[2] > 0 && b[3] > 0);
  let best = null;
  for (const b of bs.length ? bs : [[0, 0, w, h]]){ const s = Math.max(fitStep(bb, b[2], b[3], 1.1, 16), min), room = Math.min(b[2] - bw * 1.1 / s, b[3] - bh * 1.1 / s);
    if (!best || s < best.s || (s === best.s && room > best.room)) best = {s, b, room}; }
  const s = best.s, b = best.b, v = GEOM.view({lvl: s, cx: Math.round((bb[0] + bb[2]) / 2 / s) * s, cy: Math.round((bb[1] + bb[3]) / 2 / s) * s, W: w, H: h, k: 0, ax: b[0] + (b[2] >> 1), ay: b[1] + (b[3] >> 1)});
  return {L, s, v, r: range(v, s, w, h)};
}
OVM.prepWhole = (id, w, h, o = {}) => {
  if (!PX.pal || (o.theme && o.theme !== PX.theme)) return false;
  const {s, r: [a, b, e, f]} = whole(id, w, h, o); let n = 0;
  for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++) if (!lru.has(tkey(s, 'dim', tx, ty))){ n++; want(s, 'dim', tx, ty, 1, false); }
  return !n;
};
OVM.drawWhole = (id, w, h, o = {}) => {
  if (!line(id)) throw new Error('OVM.drawWhole: no line ' + id);
  const th0 = PX.pal ? PX.theme : null, th = o.theme || th0 || themeName(); if (th !== PX.theme || !PX.pal) PX.setTheme(th);
  try {
    const {L, s, v, r: [a, b, e, f]} = whole(id, w, h, o), out = PX.makeCanvas(w, h), og = out.g;
    og.fillStyle = PX.col('land.d1'); og.fillRect(0, 0, w, h);
    for (let ty = b; ty <= f; ty++) for (let tx = a; tx <= e; tx++){ const T = {s, v: 'dim', tx, ty, th: PX.theme}; og.drawImage(lru.get(tkey(s, 'dim', tx, ty)) || bakeNow(T), tx * TS - v.ox, ty * TS - v.oy); }
    drawLit(og, id, v, {done: true, end: o.rev ? 0 : L.st.length - 1});
    if (o.labels) for (const l of labels(id, s, [v.ox + 2, v.oy + 2, v.ox + w - 2, v.oy + h - 2]).out) PX.text(og, l.zh, l.x - v.ox, l.y - v.oy, {font: l.font, color: 'text', outline: 'textOutline'});
    return out.c;
  } finally { if (th0 && PX.theme !== th0) PX.setTheme(th0); }
};
OVM.project = (xm, ym) => { const c = shown(), f = K / (devicePixelRatio || 1); return [((W >> 1) + (xm - c.cx) / c.m) * f, ((H >> 1) - (ym - c.cy) / c.m) * f]; };
OVM.redraw = () => { if (raf){ cancelAnimationFrame(raf); raf = 0; } return draw(); };
OVM.idle = () => new Promise(r => { const chk = () => { if (Q.size || job){ idleW.push(chk); kick(); } else if (lblJob || raf || lvS === 1) setTimeout(chk, 16); else r(); }; chk(); });
OVM.stats = () => { const lb = lv('layerB') || 0; return {W, H, K, scale, m: shown().m, lvl: last && last.v.lvl, rest: restS, focus: focusId, hover: hoverId, zoomed: OVM.state().zoomed, anim: !!anim,
  tiles: [...lru.m.keys()].filter(k => !/^[gfp]\|/.test(k)).length, entries: lru.m.size, bytes: lru.bytes + scratchB(), lruBytes: lru.bytes, scratchBytes: scratchB(), maxBytes: MAXB,
  displayBytes: cv ? cv.width * cv.height * 4 : 0, layerBytes: lb, totalBytes: lru.bytes + scratchB() + lb + (cv ? cv.width * cv.height * 4 : 0), ready, queue: Q.size + (job ? 1 : 0), small: SMALL,
  labels: lblInfo ? {placed: lblInfo.out.length, dropped: lblInfo.drop, font: lblInfo.font} : null, ...ST,
  trainMode: tMode, pad: {...FR}, progress: prog ? {...prog} : null, cursor: cur ? {...cur} : null, marks: MK ? MK.length : 0, island, lifeJs: ['no', 'loading', 'in', 'failed'][lvS],
  ...(LV ? LV.stats() : {trains: 0, drawnTrains: 0, life: {on: false, frames: 0, lastMs: 0, maxMs: 0, rects: 0, p95Ms: 0, p50Ms: 0, reset(){}}})}; };
OVM.audit = () => { if (!cv || !devW) return {stray: 0, colours: []}; const o = PX.makeCanvas(devW, devH); o.g.drawImage(cv, 0, 0); const r = PX.audit(o.g, devW, devH); o.c.width = 0; return r; };
/* ovlife.js's view of this map (getters: these change) · OVM._life(f): its install, once (f(X) → its hooks) */
const X = {FR, AT, CR, STAND, data, line, pxl, nearest, radOf, kindOf, over, segHits, frame, attrBox, viewOf, hl, dirty, clamp, now, red: RED,
  get W(){ return W; }, get H(){ return H; }, get K(){ return K; }, get g(){ return g; }, get dg(){ return dg; }, get art(){ return art; }, get cv(){ return cv; },
  get cam(){ return cam; }, get anim(){ return anim; }, get pinching(){ return pinching; }, get raf(){ return raf; }, get last(){ return last; }, get mounted(){ return mounted; },
  get ready(){ return ready; }, get fontsOk(){ return fontsOk; }, get focusId(){ return focusId; }, get st(){ return {tMode, prog, progKey, cur, MK}; }};
OVM._life = f => { if (LV) return; LV = f(X); lvS = 2; lv('set'); if (mounted) lv('on'); dirty(); };
window.OVM = OVM;
})();
