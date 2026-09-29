/* world.js — WORLD (v2): the baked pixel city in the OBLIQUE 3/4 projection (viewed from the south), on a ladder of
   zoom levels. Lazy 256² tiles per theme|level|k, two layers each: GROUND (opaque: terrain, water + shore / quay walls,
   roads, rail, bridge decks with their fascia + piers, other metro lines, cast shadows of buildings and trees, lamp pools)
   and STRUCTURE (alpha: every building extruded — roof lifted h·k/lvl, south facades with floors of windows — plus
   procedural lots, 3/4 trees and the landmarks, painted north → south). The living bits (ripples, light reflections,
   lamp / window flicker, the Canton Tower beacon) are drawn per frame from view.t. While zooming (view.zs < 1) each layer
   is composed at its baked level into a level-frame buffer and nearest-neighbour resampled into the art canvas (never a
   new colour); at rest tiles are drawn 1:1. Needs pixel.js, palette.js, sprites.js, geom.js, src.js. Global WORLD.
   Map data: PX.src (src.js) per render tile — the object source (the mockup's l3.js) or the tile source (MAP, LOD by level). Features
   are keyed by stable ids (raster cache, junctions — split roads by sid), their look by PX.src.seed (object: index = the mockup; tiles:
   the (source's) bbox centre); when PX.src.anchored, road patterns (dashes, lamps, street trees, sleepers) and lot grids are anchored to
   the world, not to each way's arc, so tile-split pieces join seamlessly. A map tile arriving over a baked
   render tile marks it stale: still drawn, rebaked (urgent) as soon as it is used again. Other metro lines: PX.src.others() — with the
   tile source every track is baked dim, so render tiles serve any ride (TRAIN draws the ridden line on top). Memory: render tiles
   ≤ 150 MB (40 MB when pointer:coarse or deviceMemory ≤ 4), building rasters ≤ 40 / 12 MB, NN stand-ins ≤ 25 / 6 MB (+ their pixel
   copies ≤ 8 / 2 MB); evicted canvases get width 0.
   API (SPEC.md "v2 architecture" §5):
   WORLD.LEVELS · WORLD.tier(lvl) · WORLD.level(lvl) · WORLD.levelFor(mpp) · WORLD.init(d = PX.D, src = PX.srcFor(d)) · WORLD.project(xm, ym, hm, lvl, k)
   WORLD.bounds() · WORLD.landmarkSites() · WORLD.bake(view) · WORLD.prefetch(lvl, rect, k) · WORLD.ready(view) · WORLD.drawGround(g, view)
   WORLD.drawStructures(g, view) → [{id, x, y, w, h}] · WORLD.heightAt(xm, ym) · WORLD.coveredAt(sx, sy, view)
   v3 review round 2: WORLD.lazy (main.js sets it for live frames): a missing tile is drawn from the nearest baked level (NN) instead
   of a synchronous whole-tile bake · WORLD.bakeSome(views, ms) · WORLD.stats.fallbacks / sync / fbMs
   stage 1 r3: live frames on the tile source NEVER bake a whole tile — the nearest baked level (also a partly baked one, the rest flat),
   else a flat stand-in (land / built / green / water + the main roads from the coarse map already decoded, PX.src.peek), else plain land; ≤ 4 ms
   of stand-in work per frame, the real tile queued urgently (the idle queue: most recently wanted first). Bakes yield on a deadline
   inside every loop (building rasters too), so an idle / bakeSome slice keeps its budget — only one map query or one lot angle is atomic
   · WORLD.stats.flats / plains / partial / fbFrames / fbDrawn / syncMax / byLvl {lvl: [bakes, ms]} / atom {q, qs, lot, oth: the slowest
   atomic piece of each kind, ms}
   stage 1 r4: the idle queue bakes AHEAD of the train on the tile source (look-ahead, below: needs TRAIN.head) + an in-frame feed while
   frames are cheap · WORLD.stats.fbF / flatF (animation frames with a stand-in / a tile without its buildings), flatRun / flatLong (the
   longest a street tile under the train stayed flat, ms / runs > 0.5 s) · WORLD.deckIn(sx0, sy0, sx1, sy1, view) → false when no
   baked tile there has a bridge deck (TRAFFIC's mask)
   stage 1 r5: WORLD.setPlan([{i, close, over, stay}] | null) — the camera's plan per hop i (ride.js): the look-ahead sweeps each hop at
   the level it is ridden at, stay (a level; true: over), else its close level (without a plan: closeOf, a copy of ride.js closeLevel)
   · WORLD.suspend() / resume(): the idle queue (and the warm-up) pause / go on (a stopped ride; half-done bakes are let go); explicit
   bakes (bake, bakeSome) still run
   stage 1 r6: WORLD.hint(lvl, rect, k?) — a zoom / glide to level lvl over rect (metres {x0, y0, x1, y1}) starts (ride.js): tile source
   only — the map tiles over rect first (PX.src.want), what flat stand-ins read there decoded (PX.src.prep: LOD2 over rect, LOD1 only over
   the boxes of the ≤ 16 m/px levels drawn on the way — rect when lvl ≤ 16, zooming out the levels passed), the target's tiles queued
   (urgent), and the stand-ins of its tiles (then, zooming out, of the levels on the way) built ahead on idle time / cheap rest frames ·
   WORLD.stats.hint {n, dec, pre, ms} · a zoom frame (tile source) is composed at the level that has most of it at hand (subst, below);
   stand-ins may take 6 ms of a zoom frame (4 at rest) · WORLD.stats.plainF / plain10 / plain30 / plainMax (fbNote) · tiles arriving
   while suspended are warmed after resume · WORLD.stats.warmWP
   WORLD.groundAt(sx, sy, view) → WORLD.G.LAND|ROAD|WATER|DECK · WORLD.roadWidth(cls, lvl) · WORLD.roadPath(road, lvl) · WORLD.stats
   WORLD.onRebake(fn) → off: fn(lvl, k, X0, Y0, size) when a stale render tile was replaced (level px; weather.js drops caches there) · WORLD.mem */
(function(){
const LEVELS = [2, 2.5, 3.2, 4, 5, 6.3, 8, 10, 12.5, 16, 24, 48], G = {LAND: 0, ROAD: 1, WATER: 2, DECK: 3};
const WORLD = {LEVELS, G, TILE: 256, stats: {bakes: 0, bakeMs: 0, lastBake: 0, maxBake: 0, tiles: 0, bytes: 0}};
const {hash, bbox, simplify, snap} = GEOM;
const SMALL = (() => { try { return matchMedia('(pointer:coarse)').matches || (navigator.deviceMemory || 8) <= 4; } catch (e){ return false; } })();
const TS = 256, PAD = 16, BW = TS + PAD * 2, NB = BW * BW, MAXB = SMALL ? 40e6 : 150e6, MAXBLD = SMALL ? 12e6 : 40e6, LI = new Map(LEVELS.map((l, i) => [l, i]));
WORLD.mem = {tiles: MAXB, bld: MAXBLD};
let D = null, SRC = null, TSRC = false, ANCH = false, offSrc = null;
const md = (v, P) => ANCH ? ((v % P) + P) % P : v % P;
const tiles = new Map(), bcache = new Map(); let bytesB = 0;
const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const SHARED = new Set();                                                             // canvases shared by stand-ins (never freed)
const freeT = t => { for (const c of [t.gc, t.sc]) if (c && !SHARED.has(c)){ PXC.delete(c); c.width = 0; } };   // (iOS frees a canvas at width 0)
/* sliced bakes: the running slice's deadline (bakeStep; ∞ = synchronous) — every loop of bakeGen yields once it is past */
let DL = Infinity;
const late = () => performance.now() > DL;
const atom = (k, t0) => { const d = performance.now() - t0, A = WORLD.stats.atom || (WORLD.stats.atom = {}); if (!(A[k] >= d)) A[k] = d; };

/* palette keys → small ints (0 = transparent): layers are composed in Uint16 key buffers, coloured once at the end */
const KEYS = [''], KID = new Map([['', 0]]);
const K = key => { let i = KID.get(key); if (i === undefined){ i = KEYS.length; KEYS.push(key); KID.set(key, i); } return i; };

/* ---------- levels & level of detail ---------- */
const tier = WORLD.tier = lvl => lvl <= 5 ? 'street' : lvl <= 16 ? 'district' : 'city';
WORLD.level = lvl => { const i = LI.get(lvl); if (i === undefined) throw new Error('WORLD.level: ' + lvl + ' is not a baked level');
  return {lvl, i, tier: tier(lvl), finer: i ? LEVELS[i - 1] : null, coarser: i < LEVELS.length - 1 ? LEVELS[i + 1] : null}; };
WORLD.levelFor = mpp => { let r = LEVELS[0]; for (const l of LEVELS) if (l <= mpp + 1e-9) r = l; return r; };
const RANK = {path: 1, service: 2, residential: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 8};
const RW = {                  //  2 2.5 3.2  4   5 6.3  8  10 12.5 16  24  48   road band width (px) per level
  motorway:    [11, 9, 7, 6, 5, 4, 3, 3, 3, 2, 1, 1], trunk:    [8, 7, 5, 5, 4, 3, 2, 2, 2, 2, 1, 1],
  primary:     [ 8, 6, 5, 4, 4, 3, 2, 2, 2, 1, 1, 1], secondary: [6, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 0],
  tertiary:    [ 5, 4, 3, 3, 2, 2, 1, 1, 1, 1, 0, 0], residential: [3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0],
  service:     [ 3, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0], path:     [2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]};
const lvlIdx = lvl => LI.has(lvl) ? LI.get(lvl) : LI.get(WORLD.levelFor(lvl));
WORLD.roadWidth = (cls, lvl) => (RW[cls] || [])[lvlIdx(lvl)] || 0;
const TOL = lvl => lvl <= 5 ? .35 : lvl <= 16 ? .5 : .6;
/* the snapped centreline WORLD rasterises for a road at a level (level px) — TRAFFIC puts cars on exactly this */
WORLD.roadPath = (f, lvl) => {
  if (!f || f.t) return null; lvl = LEVELS[lvlIdx(lvl)];
  const c = f._rp || (f._rp = {}); if (c[lvl] !== undefined) return c[lvl];
  const w0 = WORLD.roadWidth(f.c, lvl); if (!w0) return c[lvl] = null;
  const w = f.link ? Math.max(1, Math.round(w0 * .6)) : w0, P = snap(simplify(f.pts.map(p => [p[0] / lvl, -p[1] / lvl]), TOL(lvl)), w);
  if (P.length < 2) return c[lvl] = null;
  const cu = [0]; for (let i = 1; i < P.length; i++) cu.push(cu[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return c[lvl] = {P, c: cu, len: cu[cu.length - 1], w};
};
const LU = ['', 'residential', 'commercial', 'industrial', 'construction', 'education', 'civic', 'farm', 'aquaculture', 'railway', 'plaza'];
const GR = ['', 'park', 'grass', 'forest', 'golf', 'pitch', 'wetland', 'cemetery'];
const BUILT = new Set([1, 2, 3, 5, 6]), BU = new Uint8Array(16).map((_, c) => BUILT.has(c) ? 1 : 0), LOTFAM = {1: 'res', 2: 'com', 3: 'ind', 5: 'civ', 6: 'civ'};
/* a bound on how far a landmark's art reaches from its anchor (level px) — SPR.landmark's box is ≤ (w + 20) / lvl + 12 wide and
   ((h·k + w + 20) / lvl + 14) tall */
const lmR = (l, lvl, kv) => { const M = SPR.LANDMARK_M && SPR.LANDMARK_M[l.def.spr] || {w: 300}; return (2 * M.w + 40 + (l.h || 600) * kv) / lvl + 40; };
/* landmarks: the same projection + scale as every building (SPR.landmark), painted into the structure layer through
   paint(ctx), ctx = {put(X, Y, key), X, Y (level px of the base centre), lvl, k, night, tier}; podium = a low extrusion
   of the OSM footprint under the art (CTF) */
const LANDMARK = {
  cantonTower: {h: 600, spr: 'cantonTower', tiers: ['street', 'district', 'city']},
  ifc:         {h: 440, spr: 'ifc', tiers: ['street', 'district']},
  ctf:         {h: 530, spr: 'ctf', tiers: ['street', 'district'], podium: 28},
  operaHouse:  {h: 43, spr: 'opera', tiers: ['street', 'district']},
  haixinsha:   {h: 24, spr: 'haixinsha', tiers: ['street', 'district']},
};
for (const id in LANDMARK) LANDMARK[id].paint = LANDMARK[id].paint || (ctx => {
  const s = SPR.landmark(LANDMARK[id].spr, ctx.lvl, ctx.k, ctx.night), x0 = Math.round(ctx.X) - s.ax, y0 = Math.round(ctx.Y) - s.ay;
  for (let i = 0; i < s.keys.length; i++) if (s.keys[i]) ctx.put(x0 + i % s.w, y0 + ((i / s.w) | 0), s.keys[i]);
  return s;
});

/* ---------- rasterisers (level px; a buffer's origin only indexes, so both sides of a seam compute identical pixels) ---------- */
let OX = 0, OY = 0;
const ROWS = [];
/* even-odd scanline fill of rings already in level px, pixel-centre sampling: buf[(Y-y0)*w + X-x0] = val */
function fillPoly(R, x0, y0, w, h, buf, val){
  while (ROWS.length < h) ROWS.push([]);
  let r0 = h, r1 = -1;
  for (const ring of R){
    const L = ring.length; if (L < 3) continue;
    let px = ring[L - 1][0], py = ring[L - 1][1];
    for (let a = 0; a < L; a++){
      const qx = ring[a][0], qy = ring[a][1];
      if (py !== qy){
        const ra = Math.max(y0, Math.ceil(Math.min(py, qy) - .5)), rb = Math.min(y0 + h - 1, Math.ceil(Math.max(py, qy) - .5) - 1), k = (qx - px) / (qy - py);
        for (let r = ra; r <= rb; r++) ROWS[r - y0].push(px + (r + .5 - py) * k);
        if (ra - y0 < r0) r0 = ra - y0; if (rb - y0 > r1) r1 = rb - y0;
      }
      px = qx; py = qy;
    }
  }
  for (let r = Math.max(0, r0); r <= r1; r++){
    const xs = ROWS[r]; if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2){
      const a = Math.max(0, Math.ceil(xs[j] - .5) - x0), b = Math.min(w - 1, Math.ceil(xs[j + 1] - .5) - 1 - x0);
      for (let x = a, i = r * w + a; x <= b; x++, i++) buf[i] = val;
    }
    xs.length = 0;
  }
}
const scanFill = (rings, m, buf, val, dx = 0, dy = 0) => fillPoly(rings.map(r => r.map(p => [p[0] / m + dx, -p[1] / m + dy])), OX, OY, BW, BW, buf, val);
/* thick stroke by true distance to the centreline: fn(i, d, lat, s, a) (lat = signed side offset, s = px along, a = the pixel's world
   coordinate along the segment's main axis: the world-anchored stand-in for s when ANCH, so tile-split pieces join without a phase jump) */
function strokeD(P, r, fn){
  let s0 = 0;
  for (let a = 1; a < P.length; a++){
    const x0 = P[a - 1][0], y0 = P[a - 1][1], dx = P[a][0] - x0, dy = P[a][1] - y0, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const xa = Math.max(OX, Math.floor(Math.min(x0, x0 + dx) - r)), xb = Math.min(OX + BW - 1, Math.ceil(Math.max(x0, x0 + dx) + r));
    const ya = Math.max(OY, Math.floor(Math.min(y0, y0 + dy) - r)), yb = Math.min(OY + BW - 1, Math.ceil(Math.max(y0, y0 + dy) + r));
    if (xa <= xb && ya <= yb) for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++){
      const px = x + .5 - x0, py = y + .5 - y0, t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0, ex = px - t * dx, ey = py - t * dy, d2 = ex * ex + ey * ey;
      if (d2 < r * r) fn((y - OY) * BW + x - OX, Math.sqrt(d2), L ? (px * dy - py * dx) / L : 0, s0 + t * L, Math.abs(dy) > Math.abs(dx) ? y : x);
    }
    s0 += L;
  }
}
/* 1px Bresenham through integer pixels: fn(i, n, a) (a as in strokeD) */
function bres(P, fn){
  let n = 0;
  for (let a = 1; a < P.length; a++){
    let x0 = Math.floor(P[a - 1][0]), y0 = Math.floor(P[a - 1][1]); const x1 = Math.floor(P[a][0]), y1 = Math.floor(P[a][1]);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, ay = -dy > dx; let err = dx + dy;
    if (Math.max(x0, x1) < OX || Math.min(x0, x1) >= OX + BW || Math.max(y0, y1) < OY || Math.min(y0, y1) >= OY + BW){ n += Math.max(dx, -dy); continue; }
    for (;;){
      if (x0 >= OX && y0 >= OY && x0 < OX + BW && y0 < OY + BW) fn((y0 - OY) * BW + x0 - OX, n, ay ? y0 : x0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy){ err += dy; x0 += sx; } if (e2 <= dx){ err += dx; y0 += sy; } n++;
    }
  }
}
/* spatial lookups (metres, through PX.src): street direction for procedural lots, land use under a point, the seeds of a feature */
let RG = null, HMAX = 0, LMS = [];
const HCAP = 450, SEGC = new Map();                                                   // tile source: the lift budget (tallest non-landmark, m)
const cell = (x, y, c) => Math.floor(x / c) + ',' + Math.floor(y / c);
const ctr = f => f.sc || [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2];         // split pieces: their source's centre
const seedOf = f => SRC.seed(f);                                                      // the look of a feature (src.js: tile-split pieces keep their source's)
/* road segments (rank ≥ 3) of the 250 m cell (gx, gy): by midpoint (the mockup's rule) or, ANCH, every cell a segment's box touches
   (a tile-split segment then still meets the same cells) — null while the map tile holding the cell is still to come */
const segAdd = (G, P, R) => { for (let a = 1; a < P.length; a++){ const q = [P[a - 1][0], P[a - 1][1], P[a][0], P[a][1]];
  if (!ANCH){ const mx = (q[0] + q[2]) / 2, my = (q[1] + q[3]) / 2; if (R && (mx < R[0] || mx >= R[2] || my < R[1] || my >= R[3])) continue; const k = cell(mx, my, 250); let l = G.get(k); if (!l) G.set(k, l = []); l.push(q); continue; }
  for (let gy = Math.floor(Math.max(Math.min(q[1], q[3]), R ? R[1] : -1e9) / 250); gy <= Math.floor(Math.min(Math.max(q[1], q[3]), R ? R[3] - 1 : 1e9) / 250); gy++)
    for (let gx = Math.floor(Math.max(Math.min(q[0], q[2]), R ? R[0] : -1e9) / 250); gx <= Math.floor(Math.min(Math.max(q[0], q[2]), R ? R[2] - 1 : 1e9) / 250); gx++){ const k = gx + ',' + gy; let l = G.get(k); if (!l) G.set(k, l = []); l.push(q); } } };
function segCell(lod, gx, gy){
  if (!TSRC){ if (!RG){ RG = new Map(); SRC.each('roads', r => { if ((RANK[r.c] || 0) >= 3) segAdd(RG, r.pts, null); }); } return RG.get(gx + ',' + gy) || []; }
  const key = SRC.cellKey(lod, (gx + .5) * 250, (gy + .5) * 250), st = SRC.cell(lod, key); if (st !== 'ok') return st === 'wait' ? null : [];
  const ck = lod + '/' + key; let G = SEGC.get(ck);
  if (!G){ G = new Map(); const R = SRC.cellRect(lod, key);
    for (const r of SRC.query(R, lod, 'roads')) if ((RANK[r.c] || 0) >= 3) segAdd(G, r.pts, R);
    SEGC.set(ck, G); if (SEGC.size > 48) SEGC.delete(SEGC.keys().next().value); }
  else { SEGC.delete(ck); SEGC.set(ck, G); }
  return G.get(gx + ',' + gy) || [];
}
const nang = a => { a = (a + Math.PI * 2.25) % (Math.PI / 2) - Math.PI / 4; return Math.abs(a) < .07 ? 0 : a; };
/* GEN: map tiles arrived · ACC: the running lot pass's marks of provisional angles (per bake job: b its pass number, R the area, m the
   LOD mask — a sliced bake restores its own when it resumes) */
let GEN = 0, BAKEN = 0; const NOACC = {b: 0, R: null, m: 0}; let ACC = NOACC;
const angMark = f => { const A = ACC; if (f.angB === A.b) return; f.angB = A.b; const [cx, cy] = ctr(f), r = [cx - 750, cy - 750, cx + 750, cy + 750], R = A.R;
  A.R = R ? [Math.min(R[0], r[0]), Math.min(R[1], r[1]), Math.max(R[2], r[2]), Math.max(R[3], r[3])] : r; A.m |= 1 << (f.lod | 0); };
function lotAngle(f){                                   // (a provisional angle — roads still to come — is kept until the next map tile arrives)
  if (f.ang != null && (!f.angP || f.angG === GEN)){ if (f.angP) angMark(f); return f.ang; }
  const [cx, cy] = ctr(f), gx = Math.floor(cx / 250), gy = Math.floor(cy / 250), lod = f.lod | 0, t0 = performance.now();
  let best = 1e18, ang = 0, done = true;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++){ const l = segCell(lod, gx + i, gy + j); if (!l){ done = false; continue; }
    for (const q of l){
      const dx = q[2] - q[0], dy = q[3] - q[1], t = Math.max(0, Math.min(1, ((cx - q[0]) * dx + (cy - q[1]) * dy) / (dx * dx + dy * dy || 1))), ex = q[0] + t * dx - cx, ey = q[1] + t * dy - cy, e2 = ex * ex + ey * ey;
      if (ANCH ? e2 < best - 1e-6 || (e2 <= best + 1e-6 && nang(Math.atan2(-dy, dx)) < nang(ang)) : e2 < best){ best = e2; ang = Math.atan2(-dy, dx); }   // (ANCH: a tie by angle, not order)
    } }
  ang = nang(ang); if (ANCH) ang = Math.round(ang * 90 / Math.PI) * Math.PI / 90;   // (ANCH: 2° steps, so a 2 m generalisation of the street keeps the grid)
  f.ang = ang; f.angP = !done; f.angG = GEN; if (!done) angMark(f);
  atom('lot', t0); return ang;
}
const pip = (rings, x, y) => { let c = false; for (const r of rings) for (let a = 0, j = r.length - 1; a < r.length; j = a++){ const xa = r[a][0], ya = r[a][1], xb = r[j][0], yb = r[j][1]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c; } return c; };
const LUP = {commercial: 1, industrial: 2, education: 3, civic: 4, residential: 5};
function luAt(xm, ym){                                  // the land use under a point (the first by id; ANCH: by class, not order); null: tile to come
  let c = '', cp = 99;
  for (const f of SRC.query([xm, ym, xm, ym], 0, 'landuse')) if (pip(f.p, xm, ym)){ if (!ANCH) return f.c; const p = LUP[f.c] || 9; if (p < cp){ cp = p; c = f.c; } }
  return c ? c : TSRC && SRC.cell(0, SRC.cellKey(0, xm, ym)) === 'wait' ? null : '';
}
const famOf = f => { if (f.fam) return f.fam; const [x, y] = ctr(f), c = luAt(x, y);
  const fam = c === 'commercial' || (f.h >= 80 && c !== 'residential') ? 'com' : c === 'industrial' ? 'ind' : c === 'education' || c === 'civic' ? 'civ' : 'res';
  return c === null ? fam : (f.fam = fam); };
/* stamp a PX sprite def at (bx, by) (anchor) into a padded key buffer; only the pixels whose key passes sel(key) and ok(i) */
function stamp(KB, spr, bx, by, sel, ok, map){
  const x0 = bx - (spr.ax || 0), y0 = by - (spr.ay || 0);
  for (let r = 0; r < spr.h; r++){
    const yy = y0 + r; if (yy < 0 || yy >= BW) continue; const row = spr.rows[r];
    for (let c = 0; c < spr.w; c++){
      const ch = row[c]; if (ch === '.' || ch === ' ') continue; const xx = x0 + c; if (xx < 0 || xx >= BW) continue;
      const key = spr.key[ch], i = yy * BW + xx; if (!sel(key) || (ok && !ok(i))) continue; KB[i] = map ? map(i, key) : K(key);
    }
  }
}

/* ---------- init & projection ---------- */
WORLD.init = (d = PX.D, src) => {
  const s = src || PX.srcFor(d); D = d;
  if (s !== SRC){                                                   // a new source: nothing baked is valid (same source: render tiles are kept)
    for (const t of tiles.values()) freeT(t); tiles.clear(); bcache.clear(); bytesB = 0; idleQ.length = 0; qset.clear(); jobs.clear(); BAD.clear();
    for (const f of fbs.values()) freeT(f); fbs.clear(); RG = null; SEGC.clear(); HQ.length = 0; LVW = null; WP.clear();
    if (offSrc) offSrc(); SRC = s; TSRC = s.kind === 'tiles'; ANCH = !!s.anchored; offSrc = s.onChange(onData);
  }
  HMAX = 0; const lmFoot = {}; AH = null; AHG++; RST.clear(); SLT = -1e9;
  SRC.each('buildings', f => {
    if (f.h == null) f.h = Math.round(Math.min(35, 9 + Math.sqrt((f.bb[2] - f.bb[0]) * (f.bb[3] - f.bb[1])) * .4));   // fallback estimate (data v2 has h everywhere)
    if (f.lm){ (lmFoot[f.lm] = lmFoot[f.lm] || []).push(f); if (!LANDMARK[f.lm] || !LANDMARK[f.lm].podium) return; }
    HMAX = Math.max(HMAX, f.lm ? LANDMARK[f.lm].podium : f.h);
  });
  if (TSRC) HMAX = HCAP;
  LMS = SRC.landmarks().filter(l => LANDMARK[l.id]).map(l => {    // art sits on the landmark's own footprint(s) when OSM has them
    const o = {id: l.id, x0: l.x, y0: l.y, x: l.x, y: l.y, h: l.h || LANDMARK[l.id].h, def: LANDMARK[l.id], foot: []};
    lmFoot[l.id] ? lmSet(o, lmFoot[l.id]) : TSRC && lmFind(o); return o;
  });
  warm();
  return WORLD;
};
const lmSet = (l, F) => { const b = bbox(F.flatMap(f => f.p[0])), x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2, ch = x !== l.x || y !== l.y || F.length !== l.foot.length;
  l.x = x; l.y = y; l.foot = F; return ch; };
const lmFind = l => { const F = SRC.query([l.x0 - 400, l.y0 - 400, l.x0 + 400, l.y0 + 400], 0, 'buildings').filter(f => f.lm === l.id); return F.length ? lmSet(l, F) : false; };
/* idle warm-up of the per-feature lookups the bakes need (land use of every building, street angle of every built lot area) — object
   source: all of them, nearest the ridden track first; tile source: those of every map tile as it arrives — so no tile pays mid-ride */
const warmQ = []; let warmOn = false, SUSP = false;
function warmRun(){
  if (warmOn || SUSP || !warmQ.length) return; warmOn = true;
  const src = SRC, idle = window.requestIdleCallback || (f => setTimeout(() => f({timeRemaining: () => 8}), 20));
  const run = dl => { if (SRC !== src){ warmQ.length = 0; warmOn = false; return; } if (SUSP){ warmOn = false; return; } const t0 = performance.now();
    while (warmQ.length && performance.now() - t0 < Math.max(3, Math.min(10, dl.timeRemaining()))) warmQ.shift()();
    if (warmQ.length) idle(run); else warmOn = false; };
  idle(run);
}
function warm(){
  if (TSRC) return;
  const L = D && D.track || [[0, 0]], near = f => { const cx = (f.bb[0] + f.bb[2]) / 2, cy = (f.bb[1] + f.bb[3]) / 2; let d = 1e18; for (let i = 0; i < L.length; i += 4) d = Math.min(d, Math.abs(L[i][0] - cx) + Math.abs(L[i][1] - cy)); return d; };
  const J = []; SRC.each('buildings', f => J.push([near(f), () => famOf(f)])); SRC.each('landuse', f => { if (BUILT.has(LU.indexOf(f.c))) J.push([near(f), () => lotAngle(f)]); });
  J.sort((a, b) => a[0] - b[0]); warmQ.length = 0; for (const j of J) warmQ.push(j[1]); warmRun();
}
let VIEWC = null;                                                                      // the last drawn view's centre (metres)
/* a map tile arrived (tile source): landmarks that just found their footprint move, render tiles that read that area turn stale
   (tile(): still drawn, rebaked urgently when used), in-flight bakes over it restart, the NN stand-ins go; then warm its features
   when it is near the view (decoding every arriving tile's features would fight MAP's memory budget) — one arriving while suspended
   (WP) waits for the first view after WORLD.resume (warmWP: drawGround / bakeSome) */
const WP = new Map(); let WPF = false;
function warmTile(ev, c){ const b = ev.bbox;
  if (ev.lod > 1 || !c || Math.hypot(Math.max(b[0] - c[0], 0, c[0] - b[2]), Math.max(b[1] - c[1], 0, c[1] - b[3])) >= 3000) return false;   // (near the view only)
  if (!ev.lod) for (const f of SRC.query(b, 0, 'buildings')) warmQ.push(() => famOf(f));
  for (const f of SRC.query(b, ev.lod, 'landuse')) if (BUILT.has(LU.indexOf(f.c))) warmQ.push(() => lotAngle(f));
  return true; }
const warmWP = c => { WPF = false; let n = 0; for (const ev of WP.values()) if (warmTile(ev, c)) n++; WP.clear(); WORLD.stats.warmWP = (WORLD.stats.warmWP || 0) + n; if (n) warmRun(); };
function onData(ev){
  const b = ev.bbox; GEN++;
  if (ev.lod === 0) for (const l of LMS){ const x = l.x, y = l.y;
    if (hit([l.x0 - 400, l.y0 - 400, l.x0 + 400, l.y0 + 400], b) && lmFind(l)) stale([Math.min(x, l.x) - 400, Math.min(y, l.y) - 400, Math.max(x, l.x) + 400, Math.max(y, l.y) + l.h * .6 + 400], -1); }
  stale(b, 1 << ev.lod);
  if (ev.lod < 2){ if (SUSP){ WP.set(ev.lod + '/' + ev.key, ev); if (WP.size > 256) WP.delete(WP.keys().next().value); } else if (warmTile(ev, VIEWC)) warmRun(); }
  pump();                                                                             // (tiles waiting for this data may go now)
}
function stale(b, bit){
  let n = 0;
  for (const t of tiles.values()){ const d = t.dep; if (!d || t.stale) continue;
    if ((bit < 0 || d.mask & bit) && hit(d.R, b) || (d.am & bit && hit(d.A, b))){ t.stale = true; n++; } }
  for (const [k, j] of jobs) if (hit(j.R, b)){ jobs.delete(k); n++; }
  for (const [k, f] of fbs) if (hit(readR(f.lvl, f.k, f.tx, f.ty), b)){ freeT(f); fbs.delete(k); }   // (only the stand-ins over the area)
  WORLD.stats.stale = (WORLD.stats.stale || 0) + n;
}
const RB = new Set();
WORLD.onRebake = fn => { RB.add(fn); return () => RB.delete(fn); };
WORLD.project = (xm, ym, hm = 0, lvl, k = .4) => ({X: xm / lvl, Y: (-ym - hm * k) / lvl});
WORLD.landmarkSites = () => LMS.map(({id, x, y, h}) => ({id, x, y, h}));        // where the landmark art stands (metres; main keeps it off the HUD)
WORLD.bounds = () => { const o = D && D.outer || SRC.bounds(); return {x0: o[0], y0: o[1], x1: o[2], y1: o[3]}; };
WORLD.heightAt = (xm, ym) => {
  let h = 0;
  for (const f of SRC.structs([xm, ym, xm, ym])) if ((!f.lm || LANDMARK[f.lm] && LANDMARK[f.lm].podium) && pip(f.p, xm, ym)) h = Math.max(h, f.lm ? LANDMARK[f.lm].podium : f.h);
  for (const l of LMS) for (const f of l.foot) if (xm >= f.bb[0] && xm <= f.bb[2] && ym >= f.bb[1] && ym <= f.bb[3] && pip(f.p, xm, ym)) h = Math.max(h, l.h);
  return h;
};

/* =====================================================================================
   ONE BUILDING in the oblique view, rasterised once per level|k|theme in its own small key buffer (world level px, so
   every tile that shows a piece of it gets identical pixels): south-facing walls (outward normal pointing down-screen)
   between the footprint and the roof, north walls first; then the roof (footprint lifted L = h·k/lvl px).
   Street tier: 1px outline r0, lit top-left rim, shaded bottom-right rim, parapet + rooftop kit (plant rooms extruded,
   water tanks, solar strips, roof gardens), facades with a lit left corner and SPR.facade window rows (≥ 3 px tall);
   night: ~15% of buildings dark, a few neon roof edges. District tier: no outlines, small extrusion, roof lights when the
   facade is too short for windows. Holes (courtyards) show their own south-facing inner walls.
   ===================================================================================== */
const Z2L = {res: .06, com: .3, ind: .03, civ: .06};
const BOXK = {7: 'block.hi', 8: 'lm.g1', 9: 'win.cool', 10: 'green.d2', 11: 'green.d3'};
function* bldRaster(f, lvl, kv, night){                                                 // gi: the seed (per source; = f.id unless split) · yield*: sliced
  const ck = f.id + '|' + lvl + '|' + kv + '|' + (night ? 1 : 0), gi = seedOf(f); let out = bcache.get(ck); if (out) return out;
  const ST = lvl <= 5, h = f.lm ? LANDMARK[f.lm].podium : f.h, L = h * kv / lvl, fam = famOf(f);
  const R = f.p.map(r => r.map(p => [p[0] / lvl, -p[1] / lvl]));
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const r of R) for (const p of r){ if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
  const X0 = Math.floor(a) - 1, Y0 = Math.floor(b - L) - 1, w = Math.ceil(c) - X0 + 2, hh = Math.ceil(d) - Y0 + 2, N = w * hh;
  const code = new Uint8Array(N), row = new Int16Array(N), rowB = new Int16Array(N), tone = new Uint8Array(N), steep = new Uint8Array(N);
  if (L > 0){
    const walls = [];
    for (const r of R) for (let i = 0; i < r.length; i++){ const p = r[i], q = r[(i + 1) % r.length]; if (q[0] - p[0] > 1e-9) walls.push([p, q, p[1] + q[1]]); }
    walls.sort((u, v) => u[2] - v[2]);                                                // north walls first, nearer walls overwrite
    for (const [p, q] of walls){ if (late()) yield;
      const dx = q[0] - p[0], dy = q[1] - p[1], nx = -dy / Math.hypot(dx, dy), tn = nx < -.35 ? 2 : nx > .35 ? 0 : 1;
      for (let X = Math.ceil(p[0] - .5); X <= Math.ceil(q[0] - .5) - 1; X++){
        const Yg = p[1] + (X + .5 - p[0]) / dx * dy, top = Yg - L;
        for (let Y = Math.ceil(top - .5); Y <= Math.ceil(Yg - .5) - 1; Y++){
          const i = (Y - Y0) * w + X - X0; code[i] = 2; row[i] = Math.floor(Y + .5 - top); rowB[i] = Math.floor(Yg - Y - .5); tone[i] = tn; steep[i] = Math.abs(dy) > .58 * dx ? 1 : 0; }
      }
    }
  }
  const rf = new Uint8Array(N); fillPoly(R.map(r => r.map(p => [p[0], p[1] - L])), X0, Y0, w, hh, rf, 1);
  for (let i = 0; i < N; i++) if (rf[i]) code[i] = 1;
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= hh ? 0 : code[y * w + x];
  const B = 'bld.' + fam + '.', area = (c - a) * (d - b), res = fam === 'res';
  const terra = area < 250 * 9 / (lvl * lvl) && hash(gi, 0, 41) < (res ? .3 : .12);
  const [kHi, kFill, kLo] = terra ? ['roofV.d3', 'roofV.d2', 'roofV.d1'] : [B + 'hi', B + 'r3', B + 'r2'];
  /* night lighting (review 1): commercial facades ~30–45 % lit (was 55–85 %), and their extra panes lean warm-white / cool, so
     the CBD is not a wall of orange dashes around Line 3's own orange — the line stays the brightest orange on the map */
  const dark = night && hash(gi, 2, 43) < .15, lit = dark ? 0 : fam === 'com' ? .3 + .15 * hash(gi, 1, 42) : .25 + .2 * hash(gi, 1, 42);
  const boost = fam === 'com' ? .08 + .1 * hash(gi, 5, 46) : fam === 'res' ? .12 + .12 * hash(gi, 5, 46) : .06;
  const neon = night && fam === 'com' && hash(gi, 3, 44) < .08 ? (hash(gi, 4, 45) < .5 ? 'tower.d4' : 'win.cool') : null, wins = L >= 3;
  const key = new Uint16Array(N);
  /* roof */
  const E = new Uint8Array(N);
  for (let y = 0; y < hh; y++){ if (!(y & 31) && late()) yield; for (let x = 0; x < w; x++){ const i = y * w + x; if (code[i] === 1 && (at(x - 1, y) !== 1 || at(x + 1, y) !== 1 || at(x, y - 1) !== 1 || at(x, y + 1) !== 1)) E[i] = 1; } }
  let rx0 = w, ry0 = hh, rx1 = -1, ry1 = -1; for (let i = 0; i < N; i++) if (code[i] === 1){ const x = i % w, y = (i / w) | 0; if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; }
  const box = new Uint8Array(N), rw = rx1 - rx0, rh = ry1 - ry0;
  if (ST && rw >= 14 && rh >= 12 && !f.lm){                                           // rooftop kit (roof-local, hashed per building)
    const ra = rw * rh, want = ra > 2400 ? 3 : ra > 900 ? 2 : 1, kit = ra > 600 ? 3 + (ra > 1500 ? 2 : 0) : 0, bl = kv ? Math.max(1, Math.round(4 * kv / lvl)) : 0, boxes = [];
    const inRoof = (x, y) => at(x, y) === 1 && !E[y * w + x];
    for (let tries = 0, got = 0; tries < 24 && got < want + kit; tries++){
      const kind = got < want ? 1 : [4, 5, 6][(hash(gi, tries, 35) * 3) | 0];
      const bw = kind === 4 ? 2 : kind === 5 ? 4 : kind === 6 ? 5 + ((hash(gi, tries, 36) * 4) | 0) : Math.max(3, Math.round(Math.min(rw, 40) * (.18 + hash(gi, tries, 31) * .14)));
      const bh = kind === 4 ? 2 : kind === 5 ? 1 : kind === 6 ? 3 + ((hash(gi, tries, 37) * 3) | 0) : Math.max(3, Math.round(Math.min(rh, 34) * (.18 + hash(gi, tries, 32) * .14)));
      const x0 = rx0 + 4 + Math.floor(hash(gi, tries, 33) * (rw - bw - 8)), y0 = ry0 + 4 + Math.floor(hash(gi, tries, 34) * (rh - bh - 8)), up = kind === 1 ? bl : 0;
      let ok = true;
      for (let y = y0 - 3 - up; y <= y0 + bh + 3 && ok; y++) for (let x = x0 - 3; x <= x0 + bw + 3; x++) if (!inRoof(x, y)){ ok = false; break; }
      for (const q of boxes) if (x0 < q[0] + q[2] + 3 && x0 + bw + 3 > q[0] && y0 - up < q[1] + q[3] + 3 && y0 + bh + 3 > q[1] - q[4]) ok = false;
      if (!ok) continue; got++; boxes.push([x0, y0, bw, bh, up]);
      for (let y = y0 - up; y <= y0 + bh; y++) for (let x = x0; x <= x0 + bw; x++){
        const i = y * w + x, top = y <= y0 + bh - up, yt = y + up;                     // plant room: top face lifted `up`, front face below
        const ex = x === x0 + bw, ey = yt === y0 + bh, sx = x === x0, sy = yt === y0;
        box[i] = kind === 1 ? (!top ? 12 : ey || ex ? 2 : sy || sx ? 3 : 1) : kind === 4 ? (ex || ey ? 2 : 7) : kind === 5 ? (ey ? 2 : (x - x0) % 2 ? 8 : 9) : (ex || ey ? 2 : hash(X0 + x, Y0 + y, 38) < .3 ? 11 : 10);
      }
    }
  }
  const inner = j => !E[j] && !E[j - w] && !E[j + w] && !E[j - 1] && !E[j + 1] && !E[j - 2 * w] && !E[j + 2 * w] && !box[j] && !box[j - w - 1];
  const ring2 = j => !E[j] && !E[j - 1] && !E[j + 1] && !E[j - w] && !E[j + w] && (E[j - 2] || E[j + 2] || E[j - 2 * w] || E[j + 2 * w]);
  for (let y = 0; y < hh; y++){ if (!(y & 15) && late()) yield; for (let x = 0; x < w; x++){
    const i = y * w + x; if (code[i] !== 1) continue; const X = X0 + x, Y = Y0 + y; let k2;
    if (!ST){                                                                         // district: no outline, rim light + roof lights
      /* night (review 2): the rim one ramp step down (r3, not the bright violet hi) and fewer residential roof lights, so the
         district view is not an even violet carpet — the line, the main roads and the lit commercial towers lead the eye */
      k2 = at(x, y - 1) !== 1 || at(x - 1, y) !== 1 ? (night && !terra ? B + 'r3' : kHi) : at(x, y + 1) !== 1 || at(x + 1, y) !== 1 ? B + 'r1' : terra ? kFill : B + 'r2';
      if (night && !wins && k2 !== kHi && k2 !== B + 'r3' && !((X - X0) & 1) && !((Y - Y0) & 1) && hash(X, Y, 61) < (dark ? 0 : Z2L[fam])){ const h2 = hash(X, Y, 62); k2 = h2 < .05 ? 'win.hot' : h2 < .6 ? 'win.orange' : 'win.amber'; }
      key[i] = K(k2); continue;
    }
    if (E[i]) k2 = neon && at(x, y - 1) !== 1 ? neon : B + 'r0';
    else if (E[i - w] || E[i - 1]) k2 = kHi;
    else if (E[i + w] || E[i + 1]) k2 = kLo;
    else if (box[i]) k2 = box[i] === 12 ? B + 'f1' : box[i] === 3 ? kHi : box[i] === 2 ? B + 'r1' : box[i] === 1 ? kFill : BOXK[box[i]];
    else if (box[i - w - 1] || box[i - 1]) k2 = B + 'r1';                             // kit shadow on the roof
    else if (area > 600 * 9 / (lvl * lvl) && ring2(i)) k2 = kLo;                      // parapet ring
    else {
      k2 = kFill;
      const px = x - rx0 - 2, py = y - ry0 - 2;                                        // low roofs by night: lit skylight pairs
      if (night && !wins && lit && px >= 0 && py >= 0 && py % 3 === 0 && px % 3 < 2){
        const i0 = i - px % 3, sx = X0 + rx0 + 2 + Math.floor(px / 3) * 3;
        if (code[i0] === 1 && code[i0 + 1] === 1 && inner(i0) && inner(i0 + 1) && hash(sx, Y, 51) < lit * .8){ const w2 = hash(sx, Y, 52); k2 = w2 < .45 ? 'win.orange' : w2 < .75 ? 'win.amber' : w2 < .88 ? 'win.hot' : w2 < .96 ? 'win.warm' : 'win.cool'; }
      }
    }
    key[i] = K(k2);
  } }
  /* facades */
  for (let y = 0; y < hh; y++){ if (!(y & 15) && late()) yield; for (let x = 0; x < w; x++){
    const i = y * w + x; if (code[i] !== 2) continue; const tn = tone[i], base = B + 'f' + tn; let k2;
    if (ST && (!at(x - 1, y) || !at(x + 1, y) || rowB[i] === 0)) k2 = B + 'r0';
    else if (ST && !at(x - 2, y) && tn < 2) k2 = B + 'f2';                              // lit left corner
    else if (wins && steep[i]){                                                       // a facade > 30° off the horizontal (rotated towers,
      k2 = base;                                                                        // review 2): its window rows would step into chevron
      if (night && !dark && row[i] > 1 && !(row[i] & 1) && !((X0 + x) & 1) && hash(X0 + x, Y0 + y, gi + 59) < lit * .45)   // speckle — flat ramp,
        k2 = hash(X0 + x, Y0 + y, 60) < .8 ? 'wnd.lit1' : 'wnd.cool'; }                // a few single lit panes
    else if (wins){ k2 = SPR.facade(fam, tn, row[i], X0 + x, night, gi & 1023);
      if (k2 === 'wnd.off' && !dark && hash((X0 + x + (gi & 7)) >> 1, Y0 + y, gi + 57) < boost){ const w2 = hash(X0 + x >> 2, Y0 + y, 58);
        k2 = fam === 'com' ? (w2 < .45 ? 'win.hot' : w2 < .8 ? 'wnd.cool' : 'wnd.lit2') : w2 < .7 ? 'wnd.lit1' : 'wnd.lit2'; }
      else if (dark && k2 !== base && k2[0] === 'w' && k2 !== 'wnd.glass1' && k2 !== 'wnd.glass2') k2 = 'wnd.off'; }
    else k2 = base;
    key[i] = K(k2);
  } }
  out = {X0, Y0, w, h: hh, key, sy: Math.ceil(d), sx: a};
  if ((bytesB += N * 2) > MAXBLD){ bcache.clear(); bytesB = N * 2; }                // building rasters ≤ ~40 MB (12 MB on small devices)
  bcache.set(ck, out); return out;
}

/* =====================================================================================
   TILE BAKE — one 256² tile of one level: a padded key buffer (pad 16) for the ground, a second one for the structures,
   coloured once at the end; plus 1-byte maps (ground class, structure coverage) and the per-tile animation lists.
   ===================================================================================== */
/* per-bake work buffers (~5 MB a set), pooled: a finished bake hands its set back zeroed (stage 1 r3: ~1.5 GB of fresh typed arrays a ride
   made 10 ms GC pauses land inside bake slices) */
const WSP = [], WSN = SMALL ? 1 : 2, WSK = {u8: 'lu gr wa br rd rdX rdB wk rdW wkR lmp rl wd jd bd deck fas sh nl', i32: 'rdF bid lot luF cov', f32: 'rdS rdL wkS', u16: 'KB lk SK', i8: 'lev'};
const WSC = {u8: Uint8Array, i32: Int32Array, f32: Float32Array, u16: Uint16Array, i8: Int8Array};
const wsGet = () => { const w = WSP.pop(); if (w) return w; const o = {}; for (const t in WSK) for (const n of WSK[t].split(' ')) o[n] = new WSC[t](NB); return o; };
const wsPut = w => { if (WSP.length >= WSN) return; for (const n in w) w[n].fill(0); WSP.push(w); };
function* bakeGen(lvl, kv, tx, ty){
  const night = PX.theme === 'night', m = lvl, ST = lvl <= 5, DT = !ST && lvl <= 16, CT = lvl > 16, sc = 3 / lvl;
  const ox = OX = tx * TS - PAD, oy = OY = ty * TS - PAD, ac = {b: 0, R: null, m: 0}, back = () => { OX = ox; OY = oy; ACC = ac; };   // back(): after a yield
  const mx0 = ox * m, mx1 = (ox + BW) * m, my0 = -(oy + BW) * m, my1 = -oy * m, mg = 12 * m;
  const vis = f => f.bb[2] >= mx0 - mg && f.bb[0] <= mx1 + mg && f.bb[3] >= my0 - mg && f.bb[1] <= my1 + mg;
  const lift = HMAX * kv / lvl, QR = [mx0 - mg, Math.min(my0 - mg, -(oy + BW + lift + 2) * m), mx1 + mg, my1 + mg], tq = performance.now(), Q = SRC.level(QR, lvl), dep = {mask: Q.dep.mask, R: QR, am: 0, A: null};
  atom('q', tq); if (late()){ yield; back(); }
  const proj = pts => pts.map(p => [p[0] / m, -p[1] / m]);
  const wx = i => ox + i % BW, wy = i => oy + ((i / BW) | 0);
  const WB = wsGet(), {KB, lu, gr, wa, br, rd, rdF, rdS, rdL, rdX, rdB, wk, rdW, wkR, lmp, rl, bid, lot, luF, wkS} = WB;
  const dyn = {ripple: [], lamps: [], refl: [], wins: [], beacons: [], mir: []};

  /* 1. areas: landuse, green, water (+ canals / streams), bridge decks */
  const LUL = [];                                                                        // built land use in this tile (luF = index + 1)
  if (ANCH) for (const [a, T] of [[Q.landuse, LU], [Q.green, GR]]) a.sort((p, q) => T.indexOf(p.c) - T.indexOf(q.c) || seedOf(p) - seedOf(q));   // overlaps: by class + seed, not id
  for (const f of Q.landuse){ if (late()){ yield; back(); } if (!vis(f)) continue; const c = LU.indexOf(f.c); if (c > 0){ scanFill(f.p, m, lu, c); if (!CT && BUILT.has(c)){ LUL.push(f); scanFill(f.p, m, luF, LUL.length); } } }
  for (const f of Q.green){ if (late()){ yield; back(); } if (vis(f)){ const c = GR.indexOf(f.c); if (c > 0) scanFill(f.p, m, gr, c); } }
  for (const f of Q.water){ if (late()){ yield; back(); } if (vis(f)) scanFill(f.p, m, wa, 1); }
  for (const f of Q.waterways){ if (late()){ yield; back(); } if (!vis(f) || f.t || f.c === 'river') continue;
    const w = ST ? (f.c === 'canal' ? Math.max(2, Math.round(12 / lvl)) : Math.max(1, Math.round(6 / lvl))) : DT && f.c === 'canal' && lvl <= 10 ? 1 : 0; if (!w) continue;
    const P = snap(simplify(proj(f.pts), TOL(lvl)), w);
    if (w === 1) bres(P, i => { wa[i] = 1; }); else strokeD(P, w / 2, i => { wa[i] = 1; });
  }
  if (!CT) for (const f of Q.bridges){ if (late()){ yield; back(); } if (vis(f)) scanFill(f.p, m, br, 1); }
  /* 2. water distance field (chamfer 2/3, capped at the pad) → shore bands */
  const wd = WB.wd;
  for (let i = 0; i < NB; i++) wd[i] = wa[i] ? 32 : 0;
  for (let y = 0; y < BW; y++){ if ((y & 31) === 31 && late()){ yield; back(); } for (let x = 0; x < BW; x++){ const i = y * BW + x; if (!wd[i]) continue; let v = wd[i];
    if (x > 0) v = Math.min(v, wd[i - 1] + 2); if (y > 0){ v = Math.min(v, wd[i - BW] + 2); if (x > 0) v = Math.min(v, wd[i - BW - 1] + 3); if (x < BW - 1) v = Math.min(v, wd[i - BW + 1] + 3); } wd[i] = v; } }
  for (let y = BW - 1; y >= 0; y--){ if ((y & 31) === 0 && late()){ yield; back(); } for (let x = BW - 1; x >= 0; x--){ const i = y * BW + x; if (!wd[i]) continue; let v = wd[i];
    if (x < BW - 1) v = Math.min(v, wd[i + 1] + 2); if (y < BW - 1){ v = Math.min(v, wd[i + BW] + 2); if (x < BW - 1) v = Math.min(v, wd[i + BW + 1] + 3); if (x > 0) v = Math.min(v, wd[i + BW - 1] + 3); } wd[i] = v; } }
  /* 3. rail (street: ballast bed, sleepers, two steel rails; district 1px; city none) */
  if (!CT) for (const f of Q.rail){ if (late()){ yield; back(); } if (!vis(f) || f.t) continue;
    const main = f.c === 'rail', w = ST ? (main ? (lvl <= 2.5 ? 7 : lvl <= 3.2 ? 5 : 3) : lvl <= 3.2 ? 3 : 1) : 1, P = snap(simplify(proj(f.pts), TOL(lvl)), w);
    if (w === 1){ bres(P, i => { rl[i] = 3; }); continue; }
    const gauge = w >= 7 ? 1.5 : .5;
    strokeD(P, w / 2, (i, d, lat, s, a) => {
      const code = main ? (Math.abs(lat) >= gauge && Math.abs(lat) < gauge + 1 ? (lat < 0 ? 4 : 3) : (((ANCH ? a : s) | 0) % 2 === 0 ? 2 : 1)) : (d < .5 ? 3 : 1);
      if (code > rl[i]) rl[i] = code;
      if (f.b && wa[i]) br[i] = br[i] || 3;
    });
  }
  /* 4. roads (WORLD.roadPath): highest class wins a pixel; lat / s kept for lane marks; street-tier sidewalks */
  const FID = new Map(), lampCand = [], dashP = Math.max(4, Math.round(18 / lvl));   // junction keys: one per source road (split pieces share it)
  for (const f of Q.roads){ if (late()){ yield; back(); }
    if (f.t || !vis(f)) continue; const rp = WORLD.roadPath(f, lvl); if (!rp) continue;
    const w = rp.w, P = rp.P, rank = RANK[f.c], fk = f.sid != null ? -1 - f.sid : f.id; let fid = FID.get(fk); if (!fid) FID.set(fk, fid = FID.size + 1);
    if (w === 1){ bres(P, (i, n, a) => { if (rank > rd[i]){ rd[i] = rank; rdF[i] = fid; rdB[i] = f.b ? 1 : 0; rdL[i] = 0; rdS[i] = ANCH ? a : n; rdW[i] = 1; } }); continue; }
    const r = w / 2, ext = ST && (f.b || (lvl <= 4 ? rank >= 3 : rank >= 5)) ? r + 1 : r;
    strokeD(P, ext, (i, d, lat, s, a) => {
      if (ANCH) s = a;                                                                  // (world-anchored dashes / lamps / street trees)
      if (d >= r){ if (!wk[i]){ wk[i] = f.b ? 2 : 1; wkS[i] = s; wkR[i] = rank; } return; }
      if (rd[i] && rdF[i] !== fid && rd[i] >= 3 && rank >= 3) rdX[i] = Math.max(rdX[i], Math.min(rd[i], rank));   // junction: the lesser rank
      if (rank > rd[i] || (rank === rd[i] && d < Math.abs(rdL[i]))){ rd[i] = rank; rdF[i] = fid; rdL[i] = lat; rdS[i] = s; rdB[i] = f.b ? 1 : 0; rdW[i] = w; }
    });
    if (ST && lvl <= 4 && night && rank >= 4 && !f.b) lampCand.push([P, r + 1, f.id, rank >= 6]);
  }
  const jd = WB.jd, zebra = ST && lvl <= 3.2;                                     // distance to a junction of rank ≥ 4 roads → zebras
  if (zebra){ jd.fill(9);
    for (let i = 0; i < NB; i++) if (rdX[i] >= 4) jd[i] = 0;
    for (let i = BW + 1; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); } if (rd[i] && jd[i]) jd[i] = Math.min(jd[i], jd[i - 1] + 1, jd[i - BW] + 1); }
    for (let i = NB - BW - 2; i >= 0; i--){ if (!(i & 16383) && late()){ yield; back(); } if (rd[i] && jd[i]) jd[i] = Math.min(jd[i], jd[i + 1] + 1, jd[i + BW] + 1); }
  }
  const zj = Math.round(3 / sc) + 1;
  /* 5. real footprints (ground marks) + procedural lots where built-up land has none */
  const blds = [], lots = [];
  if (!CT){
    for (const f of Q.buildings){ if (late()){ yield; back(); } if (vis(f)){ blds.push({f, open: f.lm && !(LANDMARK[f.lm] || {}).podium}); scanFill(f.p, m, bid, blds.length); } }   // open: landmark art covers only part of it
    const bd = WB.bd, BD = Math.max(8, Math.round(60 / lvl));         // chamfer distance to real footprints (2/px)
    for (let i = 0; i < NB; i++) bd[i] = bid[i] ? 0 : 40;
    if (blds.length){ let v;
      for (let i = BW + 1; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); } let d = bd[i]; if ((v = bd[i - 1] + 2) < d) d = v; if ((v = bd[i - BW] + 2) < d) d = v; if ((v = bd[i - BW - 1] + 3) < d) d = v; if ((v = bd[i - BW + 1] + 3) < d) d = v; bd[i] = d; }
      for (let i = NB - BW - 2; i >= 0; i--){ if (!(i & 16383) && late()){ yield; back(); } let d = bd[i]; if ((v = bd[i + 1] + 2) < d) d = v; if ((v = bd[i + BW] + 2) < d) d = v; if ((v = bd[i + BW + 1] + 3) < d) d = v; if ((v = bd[i + BW - 1] + 3) < d) d = v; bd[i] = d; } }
    const idx = new Map(), BX = Math.max(3, Math.round(66 / lvl)), BY = Math.max(3, Math.round(54 / lvl)), SL = ST ? Math.max(1, Math.round(6 / lvl)) : 1, big0 = ST && lvl <= 4;
    ac.b = ++BAKEN; ACC = ac;                                                         // (lot angles still missing roads: rebake when they come)
    const LC = [];                                                                    // per land-use area: [fi, cos, sin, seed·7919, grid origin x, y]
    for (let i = 0; i < NB; i++){ if (!(i & 255) && late()){ yield; back(); }
      const c = lu[i]; if (!BU[c] || !luF[i] || bid[i] || wa[i] || gr[i] || rd[i] || wk[i] || rl[i] || br[i] || bd[i] < BD) continue;
      let A = LC[luF[i]]; if (!A){ const F = LUL[luF[i] - 1], sf = seedOf(F), an = lotAngle(F), o = ANCH ? ctr(F) : null; A = LC[luF[i]] = [sf < 131071 ? sf : sf % 131071, Math.cos(an), Math.sin(an), sf * 7919, o && Math.round(o[0]) / 3, o && Math.round(o[1]) / 3]; }
      const fi = A[0], ca = A[1], sa = A[2], sd = A[3];
      let X = (wx(i) + .5) * lvl / 3, Y = (wy(i) + .5) * lvl / 3; if (ANCH){ X -= A[4]; Y += A[5]; }   // (ANCH: the lot grid turns about its area's centre)
      const U = (X * ca + Y * sa) * 3 / lvl, V = (Y * ca - X * sa) * 3 / lvl, bx = Math.floor(U / BX), by = Math.floor(V / BY);
      const mh = hash(sd + (bx & ~1), by, 12) < .3, mv = !mh && !(hash(sd + (bx & ~1), by ^ 1, 12) < .3) && hash(sd + bx, by & ~1, 13) < .2;
      const gx = mh ? bx & ~1 : bx, gy = mv ? by & ~1 : by, lx = Math.floor(U - gx * BX) - SL, ly = Math.floor(V - gy * BY) - SL;
      if (lx < 0 || ly < 0) continue;
      const h = hash(sd + gx, gy, 7), iw = (mh ? 2 : 1) * BX - SL, ih = (mv ? 2 : 1) * BY - SL;
      const court = big0 && c === 1 && !mh && !mv && hash(sd + gx, gy, 14) < .15 ? (hash(sd + gx, gy, 15) < .5 ? 1 : 2) : 0;
      const bg = c === 3 || c === 5 || c === 6 || mh || mv || court, sx = bg || h < .2 ? 0 : Math.round(iw * (.35 + hash(sd + gx, gy, 8) * .3)), sy = bg || h > .7 ? 0 : Math.round(ih * (.4 + hash(sd + gx, gy, 9) * .2));
      const qx = sx && lx >= sx ? 1 : 0, qy = sy && ly >= sy ? 1 : 0, x0 = qx ? sx : 0, x1 = qx || !sx ? iw : sx, y0 = qy ? sy : 0, y1 = qy || !sy ? ih : sy;
      if (big0 ? (lx < x0 + 1 || lx >= x1 - 1 || ly < y0 + 1 || ly >= y1 - 1) : (lx >= x1 - (qx || !sx ? 0 : 1) || ly >= y1 - (qy || !sy ? 0 : 1))) continue;
      if (court === 1 && lx >= iw * .32 && lx < iw * .68 && ly >= ih * .45) continue;
      if (court === 2 && lx >= iw * .5 && ly < ih * .5) continue;
      if (hash(sd + gx * 2 + qx, gy * 2 + qy, 11) < (ST ? .1 : .15)) continue;
      const key = ((fi * 65536 + gx + 32768) * 65536 + gy + 32768) * 4 + qx * 2 + qy;
      let id = idx.get(key);
      if (!id){ const hv = hash(sd + gx * 2 + qx, gy * 2 + qy, 16), hm2 = c === 1 ? 15 + 18 * hv : c === 2 ? 16 + 26 * hv : c === 3 ? 7 + 8 * hv : 9 + 12 * hv;
        lots.push({c, fam: LOTFAM[c], g: (key % 1e6) | 0, v: c === 3 ? 1 : 0, L: Math.min(PAD - 2, Math.round(hm2 * kv / lvl))}); id = lots.length; idx.set(key, id); }
      lot[i] = id;
    }
    if (ac.m){ dep.am = ac.m; dep.A = ac.R; }
  }
  /* ---- 6. compose ground ---- */
  const k = K, kLand = k('land.d1'), kBuilt = k('land.d2');
  const shK = i => wa[i] ? k('water.deep') : !night && gr[i] ? k('green.d1') : k('shadow');
  const Z1D = {1: .12, 2: .26, 3: .03, 5: .08, 6: .08}, cityBuilt = (X, Y, c) => {        // city tier: scattered lights / roofs
    const p = (Z1D[c] || 0) * (.25 + 1.5 * hash(X >> 2, Y >> 2, 4)) * (lvl < 48 ? .75 : 1), h = hash(X, Y, 5);
    if (h >= p) return kBuilt;
    const v = hash(X, Y, 6);
    if (!night) return k(c === 3 ? 'roofV.d1' : 'block.d1');
    return k(c === 2 ? (v < .05 ? 'win.hot' : v < .6 ? 'win.orange' : 'win.amber') : c === 1 ? (v < .6 ? 'win.dim' : 'win.warm') : 'win.dim');
  };
  for (let i = 0; i < NB; i++){ if (!(i & 8191) && late()){ yield; back(); }
    const X = wx(i), Y = wy(i); let key = kLand;
    const c = lu[i];
    if (c){
      if (BUILT.has(c) || c === 9) key = CT ? (c === 9 ? kBuilt : cityBuilt(X, Y, c)) : c === 9 ? kLand : kBuilt;
      else if (c === 4) key = !CT && (lu[i - 1] !== 4 || lu[i + 1] !== 4 || lu[i - BW] !== 4 || lu[i + BW] !== 4) ? k('sand.d2') : k('sand.d1');
      else if (c === 7){ const fh = hash(X >> 3, (Y / 6) | 0, 9); key = fh < .45 ? (Y % 3 === 0 ? k('green.d2') : k('green.d1')) : fh < .75 ? k('green.d1') : k('green.d2'); }
      else if (c === 8) key = k('water.d1');
      else if (c === 10) key = ST && (X % Math.round(24 / lvl) === 0 || Y % Math.round(24 / lvl) === 0) && PX.bayer(X, Y) < .5 ? k('sand.d2') : k('sand.d1');
    }
    const gc = gr[i];
    if (gc){
      const edge = !CT && ((i % BW) === 0 || gr[i - 1] !== gc || gr[i + 1] !== gc || gr[i - BW] !== gc || gr[i + BW] !== gc);
      if (gc === 5) key = ST && edge ? k('road.mark') : ST && (X >> 2) & 1 ? k('green.d4') : k('green.d3');
      else if (gc === 4) key = ((X + Y) >> 2) & 1 ? k('green.d3') : k('green.d4');
      else if (gc === 3) key = edge ? k('green.d0') : k('green.d1');
      else if (edge) key = k('green.d1');
      else if (gc === 6) key = ((X ^ Y) & 3) === 0 ? k('water.shallow') : k('green.d1');
      else if (gc === 7) key = X % 4 === 0 && Y % 3 === 0 ? k('sand.d2') : k('green.d1');
      else key = CT ? (((X + Y * 2) % 5) === 0 ? k('green.d3') : k('green.d2'))
        : (((X + (Y % 6 < 3 ? 0 : 2)) & 3) === 0 && Y % 3 === 0 && hash(X, Y, 3) > .35) ? k('green.d3') : k('green.d2');
    }
    if (wa[i]){
      const d = wd[i];
      if (CT) key = night ? (d <= 2 ? k('water.mid') : k('water.d1'))
        : d <= 2 ? k('water.shore') : d > 6 && PX.bayer(X, Y) < Math.floor(Math.min(1, (d - 6) / 12) * 4) / 4 ? k('water.d1') : k('water.mid');
      else if (d <= 2) key = k('water.shore');
      else if (d <= 4) key = k('water.shallow');
      else if (d <= 7) key = PX.bayer(X, Y) < .5 ? k('water.shallow') : k('water.mid');
      else { const t = Math.floor(Math.min(1, (d - (night ? 8 : 10)) / (night ? 10 : 20)) * 4) / 4; key = t > 0 && PX.bayer(X, Y) < t ? k('water.d1') : k('water.mid'); }
    } else if (ST && (wa[i - 1] || wa[i + 1] || wa[i - BW] || wa[i + BW]) && !gr[i]) key = k('road.walk');   // quay edge
    if (br[i] === 1 && wa[i]) key = (!br[i - 1] || !br[i + 1] || !br[i - BW] || !br[i + BW]) ? k('block.d0') : k('road.walk');
    if (rl[i]) key = k(['', 'rail.bed', 'rail.tie', 'rail.steel', 'rail.steelHi'][rl[i]]);
    if (wk[i] && !rd[i]) key = wk[i] === 2 ? k('block.d4') : k('road.walk');
    const r = rd[i];
    if (r){
      key = r === 1 ? (gr[i] ? k('sand.d2') : k('road.walk')) : r >= 6 || (!ST && r >= 5) ? k('road.major') : k('road.surf');
      const cl = rdW[i] & 1 ? Math.abs(rdL[i]) < .5 : rdL[i] >= -1 && rdL[i] < 0;      // centre pixel row (even widths: the one left of centre)
      if (ST && !rdX[i]){
        if (r >= 5 && rdW[i] >= 3 && cl && md(rdS[i], dashP) < dashP / 2) key = k('road.mark');   // lane dashes
        if (zebra && r >= 5 && jd[i] >= 2 && jd[i] <= zj && (Math.floor(rdL[i] + 16) & 1) && Math.abs(rdL[i]) < rdW[i] / 2 - .5) key = k('road.mark');
      }
      if (DT && night && r >= 5 && cl && rdW[i] >= 2) key = r >= 6 ? k(md(rdS[i], 3) < 1 ? 'win.warm' : 'win.dim') : md(rdS[i], 3) < 1 ? k('win.dim') : key;
      else if (DT && night && r >= 6 && rdW[i] === 1) key = md(rdS[i], 4) < 1 ? k('win.dim') : key;
      else if (DT && r === 8 && Math.abs(rdL[i]) < .5 && md(rdS[i], 4) < 2) key = k('road.mark');
      if (CT && night) key = r >= 7 ? k('win.warm') : r === 6 ? k('win.dim') : k('road.major');
    }
    if (lot[i] || (bid[i] && !blds[bid[i] - 1].open)) key = kBuilt;                  // under a roof (never seen)
    KB[i] = key;
  }
  /* bridges with depth (street tier, k > 0): the deck's south fascia, piers into the water, then its cast shadow */
  const deck = WB.deck;
  let nDeck = 0; if (!CT) for (let i = 0; i < NB; i++) if (rdB[i] || wk[i] === 2 || (br[i] === 1 && wa[i])){ deck[i] = 1; nDeck++; }
  const fh = ST && kv ? Math.max(1, Math.round(10 * kv / lvl)) : 0, fas = WB.fas, PP = Math.max(6, Math.round(40 / lvl));
  if (fh && nDeck) for (let i = BW; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); }
    if (deck[i]) continue;
    for (let r = 1; r <= fh; r++){ const j = i - r * BW; if (j >= 0 && deck[j]){ fas[i] = r; break; } }
    if (fas[i]){ KB[i] = k(fas[i] === fh || (i + BW < NB && !deck[i + BW] && fas[i] === 1 && fh === 1) ? 'block.d0' : 'block.d1'); continue; }
    const X = wx(i); if (wa[i] && X % PP === 0) for (let r = fh + 1; r <= fh + 3; r++){ const j = i - r * BW; if (j >= 0 && deck[j]){ KB[i] = k('block.d0'); fas[i] = 9; break; } }
  }
  if (!CT && nDeck) for (let i = BW * (fh + 2) + 2; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); }
    if (deck[i] || fas[i] || wk[i] || (rd[i] && !kv)) continue;
    const j = i - (fh + 1) * BW - 1, j2 = j - BW - 1;
    if (deck[j] || deck[j2] || (fh && fas[j] && fas[j] < 9)) KB[i] = shK(i);
  }
  /* quay walls (street tier, k > 0): the embankment's south face, seen across the water below the north bank */
  if (ST && kv){ const qh = Math.max(1, Math.round(4 * kv / lvl));
    for (let i = BW * qh; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); } if (!wa[i] || deck[i] || fas[i]) continue;
      for (let r = 1; r <= qh; r++){ const j = i - r * BW; if (!wa[j] && !deck[j] && !gr[j] && !fas[j]){ KB[i] = k(r === 1 ? 'land.d0' : 'block.d1'); fas[i] = 8; break; } if (!wa[j]) break; } } }
  /* building & lot shadows cast bottom-right on the ground (length grows with height·k; k = 0 → v1's 1px) */
  if (!CT){
    const sh = WB.sh, cap = night ? 2 : ST ? 10 : 4;
    for (const {f} of blds){ if (late()){ yield; back(); } const hh = f.lm ? LANDMARK[f.lm] && LANDMARK[f.lm].h || f.h : f.h; if (!hh) continue;
      const n = kv ? Math.max(1, Math.min(cap, Math.round(hh * kv / lvl * .3))) : 1;
      for (let s = 1; s <= n; s++) scanFill(f.p, m, sh, 1, s, kv ? Math.max(1, Math.round(s * .4)) : 1); }
    for (let i = 0; i < NB; i++){ if (!(i & 16383) && late()){ yield; back(); } const b = lot[i]; if (!b) continue; const n = Math.max(1, Math.min(cap, Math.round(lots[b - 1].L * .3)));
      for (let s = 1; s <= n; s++){ const j = i + s + (kv ? Math.max(1, Math.round(s * .4)) : 1) * BW; if (j < NB) sh[j] = 1; } }
    for (let i = 0; i < NB; i++) if (sh[i] && !bid[i] && !lot[i] && !deck[i] && !fas[i]) KB[i] = shK(i);
  }
  /* 7. night street lamps along major roads (street tier ≤ 4 m/px): an oval pool stretched along the road, the ground under
        it lifted one ramp step (Bayer-thinned at the rim), warm lamp.glow keys in the inner 2 px */
  if (lampCand.length){
    const LIFT = {'road.surf': 'road.major', 'road.major': 'road.lit', 'road.walk': 'road.lit', 'road.mark': 'road.mark', 'land.d1': 'land.d2', 'land.d2': 'land.d3',
      'green.d1': 'green.d2', 'green.d2': 'green.d3', 'green.d3': 'green.d4', 'sand.d1': 'sand.d2', 'sand.d2': 'sand.d3', 'shadow': 'land.d1'};
    const LK = new Map(Object.entries(LIFT).map(([a, b]) => [K(a), K(b)])), kG3 = k('lamp.glow3'), kG2 = k('lamp.glow2'), pa = 6.5 * sc, pb = 4.2 * sc, pr = Math.ceil(pa);
    for (const [P, off, id, both] of lampCand){ if (late()){ yield; back(); }
      const SP = Math.round((both ? 36 : 57) / lvl); let acc = hash(id, 1, 5) * SP;
      for (let a = 1; a < P.length; a++){
        const [x0, y0] = P[a - 1], dx = P[a][0] - x0, dy = P[a][1] - y0, L = Math.hypot(dx, dy); if (!L) continue;
        const ux = dx / L, uy = dy / L, at = [];
        if (ANCH){ const ay = Math.abs(dy) > Math.abs(dx), c0 = ay ? y0 : x0, c1 = c0 + (ay ? dy : dx), lo = Math.min(c0, c1), hi = Math.max(c0, c1);   // world-anchored:
          for (let q = Math.ceil(lo / SP); q * SP < hi; q++) for (const side of both ? [1, -1] : [q & 1 ? 1 : -1]) at.push((q * SP - c0) / (c1 - c0) * L, side); }   // a lamp where the main axis crosses k·SP
        else { for (; acc < L; acc += SP) for (const side of both ? [1, -1] : [((acc / SP + a) | 0) & 1 ? 1 : -1]) at.push(acc, side); acc -= L; }
        for (let n = 0; n < at.length; n += 2){ const s = at[n], side = at[n + 1];
          const x = Math.floor(x0 + dx * s / L - uy * off * side) - ox, y = Math.floor(y0 + dy * s / L + ux * off * side) - oy;
          if (x < 0 || y < 0 || x >= BW || y >= BW) continue; const i = y * BW + x;
          if (!wk[i] || rd[i] || bid[i] || lot[i]) continue;
          for (let q = -pr; q <= pr; q++) for (let p = -pr; p <= pr; p++){
            const xx = x + p, yy = y + q; if (xx < 0 || yy < 0 || xx >= BW || yy >= BW) continue;
            const j = yy * BW + xx; if (wa[j] || rl[j] || bid[j] || lot[j] || fas[j]) continue;
            const u = p * ux + q * uy, v = -p * uy + q * ux, dd = Math.hypot(u / pa, v / pb); if (dd > 1) continue;
            if (Math.abs(p) + Math.abs(q) <= 1 || (Math.abs(p) <= 1 && Math.abs(q) <= 1 && PX.bayer(xx, yy) < .5)){ KB[j] = Math.abs(p) + Math.abs(q) <= 1 ? kG3 : kG2; continue; }
            if (dd < .6 || PX.bayer(wx(j), wy(j)) < (1 - dd) / .4){ const lf = LK.get(KB[j]); if (lf != null) KB[j] = lf; }
          }
          KB[i] = k('lamp.head'); lmp[i] = 1;
          if (x >= PAD && y >= PAD && x < PAD + TS && y < PAD + TS) dyn.lamps.push(ox + x, oy + y);
        }
      }
    }
  }
  /* 8. trees: parks, forests, plazas, street trees — 3/4 canopies (flat v1 sprites at k = 0); their ground shadows go
        into this layer now, the canopies into the structure layer (painter's order) below */
  const trees = [];
  if (!CT && lvl <= 12.5){
    const T = kv ? SPR.trees34 : SPR.trees, Bu = kv ? SPR.bushes34 : SPR.bushes;
    const big = lvl <= 2.5 ? T[2] : lvl <= 4 ? T[1] : T[0], med = lvl <= 4 ? T[1] : T[0];
    const free = (x, y, r) => { for (let j = -r; j <= r; j++) for (let q = -r; q <= r; q++){ const xx = x + q, yy = y + j; if (xx < 0 || yy < 0 || xx >= BW || yy >= BW) return false; const i = yy * BW + xx; if (wa[i] || rd[i] || wk[i] || bid[i] || lot[i] || rl[i] || br[i] || fas[i]) return false; } return true; };
    const CELL = ST ? Math.max(5, Math.round(18 / lvl)) : 4;
    for (let cy = Math.floor(oy / CELL); cy <= Math.floor((oy + BW) / CELL); cy++){ if (late()){ yield; back(); } for (let cx = Math.floor(ox / CELL); cx <= Math.floor((ox + BW) / CELL); cx++){
      const h = hash(cx, cy, 21), X = cx * CELL + Math.floor(hash(cx, cy, 22) * (CELL - 1)), Y = cy * CELL + Math.floor(hash(cx, cy, 23) * (CELL - 1)), x = X - ox, y = Y - oy;
      if (x < 2 || y < 2 || x >= BW - 2 || y >= BW - 2) continue;
      const i = y * BW + x, gc = gr[i], c = lu[i];
      let t = null;
      if (ST){
        if (gc === 1 && h < .5 && free(x, y, 2)) t = h < .12 ? big : h < .36 ? med : T[0];
        else if (gc === 3 && h < .85 && free(x, y, 1)) t = h < .4 ? big : h < .7 ? med : T[0];
        else if ((gc === 2 || gc === 7) && h < .1 && free(x, y, 2)) t = h < .05 ? Bu[1] : T[0];
        else if (gc === 6 && h < .15 && free(x, y, 1)) t = Bu[0];
        else if (!gc && c === 10 && h < .09 && free(x, y, 3)) t = T[3];
      } else if ((gc === 1 && h < .55 || gc === 3 && h < .9) && free(x, y, 1)) t = lvl <= 8 ? (h < .15 ? Bu[1] : T[0]) : Bu[0];
      if (t) trees.push([Y, X, t]);
    } }
    if (ST && lvl <= 4){ const SP = Math.max(5, Math.round(21 / lvl)), st = kv ? SPR.streetTree34 : SPR.streetTree, cl = Math.ceil(SP * .6), placed = [];
      for (let i = 4 * BW; i < NB - 4 * BW; i++){ if (!(i & 8191) && late()){ yield; back(); }
        if (wk[i] !== 1 || rd[i] || bid[i] || lot[i] || wkR[i] < 4 || wkR[i] > 6 || md(wkS[i] | 0, SP)) continue;
        const x = i % BW, y = (i / BW) | 0; if (x < 4 || x >= BW - 4 || hash(wx(i), wy(i), 24) > .8) continue;
        let ok = true;
        for (let q = -4; q <= 4 && ok; q++) for (let p = -4; p <= 4; p++){ const j = i + q * BW + p; if (rdX[j] || lmp[j] || rl[j] || wa[j] || fas[j]){ ok = false; break; } }
        for (const j of placed) if (Math.abs(j % BW - x) < cl && Math.abs(((j / BW) | 0) - y) < cl){ ok = false; break; }
        if (ok){ placed.push(i); trees.push([wy(i), wx(i), st]); }
      }
    }
    const okS = i => !bid[i] && !lot[i] && !wa[i] && !rl[i] && !lmp[i] && !deck[i] && !fas[i];
    for (const [Y, X, t] of trees) stamp(KB, t, X - ox, Y - oy, q => q === 'shadow', okS, i => shK(i));
  }
  /* 9. other metro lines: quiet context in their dim shade (city 1px, district 2px solid, street 4-on / 3-off dashes) */
  const lk = WB.lk;
  for (const f of SRC.others()){ if (late()){ yield; back(); } if (!vis(f)) continue;
    const key = K('lineDim.' + f.key), dash = ST || f.branch, c = f._op || (f._op = {}), sp = w => { let P = c[lvl + '|' + w]; if (!P){ const t0 = performance.now(); P = c[lvl + '|' + w] = snap(simplify(proj(f.pts), .5), w); atom('oth', t0); } return P; };   // (whole-line paths per level: cached)
    if (DT && !dash && lvl <= 10){ strokeD(sp(2), 1, i => { lk[i] = key; }); continue; }
    const P = sp(1); let n0 = 0;
    for (let a = 1; a < P.length; a++){
      const seg = [P[a - 1], P[a]], ddx = Math.floor(P[a][0]) - Math.floor(P[a - 1][0]), ddy = Math.floor(P[a][1]) - Math.floor(P[a - 1][1]);
      const off = Math.abs(ddx) >= Math.abs(ddy) ? [0, 1] : [1, 0], put = (i, n) => { if (!dash || (n0 + n) % 7 < 4) lk[i] = key; };
      bres(seg, put); if (!CT && (ST || lvl <= 10)) bres(seg.map(q => [q[0] + off[0], q[1] + off[1]]), put);
      n0 += Math.max(Math.abs(ddx), Math.abs(ddy));
    }
  }
  for (let i = 0; i < NB; i++) if (lk[i]) KB[i] = lk[i];
  /* 10. ground animation lists: ripple dashes (3 frames; denser near the banks; tinted by the Canton Tower at night, ~10%
         sun glints by day) and night light reflections (bridge parapet lamps, quay lamps on both banks) */
  if (!CT){
    const GX = ST ? 9 : 12, GY = ST ? 5 : 7, tw = LMS.find(l => l.id === 'cantonTower'), TX = tw ? tw.x / lvl : 1e9, TY = tw ? -tw.y / lvl : 1e9, TR = 180 / lvl;
    for (let Yg = Math.ceil((oy + PAD) / GY) * GY; Yg < oy + PAD + TS; Yg += GY){ if (late()){ yield; back(); }
      const sh = (Yg / GY) & 1 ? GX >> 1 : 0;
      for (let Xg = Math.ceil((ox + PAD - sh) / GX) * GX + sh; Xg < ox + PAD + TS; Xg += GX){
        const X = Xg + Math.round((hash(Xg, Yg, 73) - .5) * 6), Y = Yg + ((hash(Xg, Yg, 74) * 3) | 0) - 1, x = X - ox, y = Y - oy;
        if (x < PAD || y < PAD || x >= PAD + TS || y >= PAD + TS) continue;
        const i = y * BW + x, h = hash(Xg, Yg, 71); if (h > (wd[i] < 24 ? .8 : .3)) continue;
        const len = 1 + ((hash(Xg, Yg, 75) * 4) | 0); let ok = true;
        for (let q = -1; q <= len; q++){ const j = i + q; if (x + q >= BW || wd[j] < 8 || br[j] || rdB[j] || fas[j]){ ok = false; break; } }
        if (!ok) continue;
        const nearT = night && ST && Math.hypot(X - TX, Y - TY) < TR, glint = !night && hash(Xg, Yg, 76) < .1;
        dyn.ripple.push(X, Y, glint ? Math.min(len, 2) : len, (hash(Xg, Yg, 72) * 3) | 0, K(nearT ? (hash(Xg, Yg, 77) < .5 ? 'tower.d2' : 'tower.d3') : glint ? 'water.foam' : 'water.shallow'));
      }
    }
    if (ST && night){
      const kHead = K('lamp.head'), core = i => i % BW >= PAD && i % BW < PAD + TS && ((i / BW) | 0) >= PAD && ((i / BW) | 0) < PAD + TS, QS = Math.max(6, Math.round(33 / lvl));
      const streak = (i, X, Y, n, u = 1) => { const S = u * BW, okW = j => j >= 0 && j < NB && wa[j] && !br[j] && !rdB[j] && !wk[j] && !fas[j];
        let y = 1; while (y < 4 + fh && !okW(i + y * S)) y++; const j = i + y * S; if (y >= 4 + fh) return;
        let len = 0; while (len < n && okW(j + len * S)) len++; if (len >= 3) dyn.refl.push(X, Y + y * u, len * u); };
      for (let i = 12 * BW; i < NB - 12 * BW; i++){ if (!(i & 8191) && late()){ yield; back(); }
        if (!core(i)) continue;
        const X = wx(i), Y = wy(i), n = Math.round((3 + ((hash(X, Y, 96) * 6) | 0)) * Math.min(1.5, sc));
        const open = j => wa[j] && !rd[j] && !wk[j] && !br[j];
        if (wk[i] === 2 && !rd[i] && wa[i] && md(wkS[i], 6) < 1 && (open(i - 1) || open(i + 1) || open(i - BW) || open(i + BW))){ KB[i] = kHead; streak(i, X, Y, n); }
        else if (!wa[i] && !gr[i] && !rd[i] && !wk[i] && !bid[i] && !lot[i] && !rl[i] && !fas[i] && X % QS === 0 && wa[i + BW] !== wa[i - BW]){ KB[i] = kHead; streak(i, X, Y, wa[i + BW] ? n : 3 + (n & 1), wa[i + BW] ? 1 : -1); }
      }
    }
  }
  /* 11. ground class map (core): LAND / ROAD / WATER / DECK (bridge decks, their fascia and piers) */
  const gm = new Uint8Array(TS * TS); let hd = false;                                  // hd: any DECK (WORLD.deckIn)
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++){ const i = (y + PAD) * BW + x + PAD;
    if ((gm[y * TS + x] = deck[i] || (fas[i] && fas[i] !== 8) ? G.DECK : rd[i] ? G.ROAD : wa[i] && fas[i] !== 8 ? G.WATER : G.LAND) === G.DECK) hd = true; }
  if (late()){ yield; back(); }
  /* =============== STRUCTURE LAYER =============== */
  const SK = WB.SK;
  /* a. procedural lots: extruded by a column scan (lift ≤ pad), one ramp step darker than real buildings */
  if (lots.length){
    let maxL = 0; for (const q of lots) maxL = Math.max(maxL, q.L);
    const cov = WB.cov, lev = WB.lev, nl = WB.nl;
    for (let i = NB - 1; i >= 0; i--) nl[i] = lot[i] ? 0 : i + BW < NB ? Math.min(255, nl[i + BW] + 1) : 255;
    for (let i = 0; i < NB; i++){ if (!(i & 4095) && late()){ yield; back(); } if (nl[i] > maxL) continue; for (let s = maxL; s >= 0; s--){
      const j = i + s * BW; if (j >= NB) continue; const b = lot[j];
      if (b && s <= lots[b - 1].L){ cov[i] = b; lev[i] = s === lots[b - 1].L ? -1 : s; break; }
    } }
    const roofOf = j => lev[j] < 0 ? cov[j] : 0;
    for (let i = BW; i < NB - BW; i++){ if (!(i & 8191) && late()){ yield; back(); }
      const b = cov[i]; if (!b) continue;
      const q = lots[b - 1], B = 'bld.' + q.fam + '.', X = wx(i), Y = wy(i), [hi, fill, lo] = q.v ? ['roofV.d3', 'roofV.d2', 'roofV.d1'] : [B + 'r3', B + 'r2', B + 'r1'];
      let key;
      if (lev[i] >= 0){
        const s = lev[i], rowQ = q.L - 1 - s, edge = cov[i - 1] !== b || cov[i + 1] !== b;
        if (ST && (edge || s === 0)) key = B + 'r0';
        else if (q.L >= 3 && !edge){ key = SPR.facade(q.fam, 1, rowQ, X, night, q.g & 1023); if (night && hash(q.g, 2, 43) < .15 && key[0] === 'w' && key.indexOf('glass') < 0) key = 'wnd.off'; }
        else key = B + 'f1';
      } else {
        const E = j => roofOf(j) !== b, e = E(i - 1) || E(i + 1) || E(i - BW) || E(i + BW), eg = j => !E(j) && (E(j - 1) || E(j + 1) || E(j - BW) || E(j + BW));
        if (ST) key = e ? B + 'r0' : eg(i - BW) || eg(i - 1) ? hi : eg(i + BW) || eg(i + 1) ? lo : fill;
        else key = E(i - BW) || E(i - 1) ? hi : E(i + BW) || E(i + 1) ? lo : fill;
        if (night && q.L < 3 && key !== hi && key !== B + 'r0' && !(X & 1) && !(Y & 1) && hash(X, Y, 63) < (q.c === 2 ? .2 : q.c === 1 ? .08 : .03)) key = hash(X, Y, 64) < .6 ? 'win.orange' : 'win.amber';
      }
      SK[i] = K(key);
    }
  }
  /* b. real buildings, trees and landmarks, painted north → south (base Y), the tallest reaching in from far south */
  const items = [];
  if (!CT){
    if (late()){ yield; back(); }
    const tq = performance.now(), SR = [ox * m - 2 * m, -(oy + BW + lift + 2) * m, (ox + BW + 2) * m, -(oy - 2) * m];   // (tiles: the bake's own query holds them, in id order)
    const bl = (TSRC ? Q.buildings.filter(f => hit(f.bb, SR)) : SRC.structs(SR)).filter(f => (!f.lm || LANDMARK[f.lm] && LANDMARK[f.lm].podium) && f.h > 0);
    atom('qs', tq);
    for (let n = 0; n < bl.length; n++){
      if (late()){ yield; back(); }
      const f = bl[n], r = yield* bldRaster(f, lvl, kv, night); back(); if (r.X0 >= ox + BW || r.X0 + r.w <= ox || r.Y0 >= oy + BW || r.Y0 + r.h <= oy) continue;
      items.push([r.sy, r.sx, 0, r]); }
    for (const [Y, X, t] of trees) items.push([Y, X, 1, t, X, Y]);
  }
  for (const l of LMS){
    if (!l.def.tiers.includes(tier(lvl))) continue;
    const X = l.x / lvl, Y = -l.y / lvl, rr = lmR(l, lvl, kv); if (X + rr < ox || X - rr > ox + BW || Y + rr < oy || Y - rr > oy + BW) continue;   // (far: not rasterised)
    const s = SPR.landmark(l.def.spr, lvl, kv, night);
    const x0 = Math.round(X) - s.ax, y0 = Math.round(Y) - s.ay;
    if (x0 >= ox + BW || x0 + s.w <= ox || y0 >= oy + BW || y0 + s.h <= oy) continue;
    const base = l.def.podium && l.foot.length ? Math.max(...l.foot.map(f => Math.ceil(-f.bb[1] / lvl))) + .5 : Y + SPR.LANDMARK_M[l.def.spr].w * .3 / lvl;
    items.push([base, X, 2, l]);
  }
  items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const put = (X, Y, key) => { const x = X - ox, y = Y - oy; if (x >= 0 && y >= 0 && x < BW && y < BW) SK[y * BW + x] = K(key); };
  for (const [, , kind, o, TX, TY] of items){ if (late()){ yield; back(); }
    if (kind === 0){ const {X0, Y0, w, h, key} = o;
      for (let y = Math.max(0, oy - Y0); y < Math.min(h, oy + BW - Y0); y++){ const r = (Y0 + y - oy) * BW - ox + X0;
        for (let x = Math.max(0, ox - X0); x < Math.min(w, ox + BW - X0); x++){ const q = key[y * w + x]; if (q) SK[r + x] = q; } } }
    else if (kind === 1) stamp(SK, o, TX - ox, TY - oy, q => q !== 'shadow');
    else { const s = o.def.paint({put, X: o.x / lvl, Y: -o.y / lvl, lvl, k: kv, night, tier: tier(lvl)});
      if (s && s.beacon){ const bx = Math.round(o.x / lvl) + s.beacon[0], by = Math.round(-o.y / lvl) + s.beacon[1];
        if (bx >= ox + PAD && by >= oy + PAD && bx < ox + PAD + TS && by < oy + PAD + TS) dyn.beacons.push(bx, by); } }
  }
  /* night reflections (review 2): lit windows / neon / the tower lights of the structures just north of a shore mirror onto the
     water south of it (the oblique view looks north, so a bank's skyline reflects toward the viewer): broken 1 px dashes, thinned
     with distance, stepped with the ripple frames in drawGround (dyn.mir: X, Y, key, frame) */
  if (night && !CT){
    const LITK = new Set(['wnd.lit1', 'wnd.lit2', 'wnd.cool', 'win.cool', 'win.orange', 'win.amber', 'win.hot', 'tower.d3', 'tower.d4', 'tower.hi', 'lm.crown', 'car.glassHi'].map(K));
    const RH = ST ? 60 : 40;
    for (let x = PAD; x < PAD + TS; x++){ if (!(x & 31) && late()){ yield; back(); } for (let y = 1; y < BW; y++){ const i = y * BW + x;
      if (!wa[i] || wa[i - BW] || deck[i]) continue;                                    // a north shore pixel (water, land above)
      for (let n = 1; n <= RH && y - n >= 0; n++){ const q = SK[i - n * BW]; if (!LITK.has(q)) continue;
        const Y = y + n - 1, j = Y * BW + x; if (Y >= BW || Y >= PAD + TS || Y < PAD || !wa[j] || deck[j] || br[j]) continue;
        if (hash(ox + x, oy + Y, 97) > 1 - n / (RH * 1.1)) continue;                      // thinner further out
        dyn.mir.push(ox + x, oy + Y, q, (hash(ox + x, oy + Y, 98) * 3) | 0); } } } }
  /* c. flickering facade windows (a few lit panes per tile toggle off now and then) */
  const litK = new Set(['wnd.lit1', 'wnd.lit2', 'wnd.cool'].map(K)), offK = K('wnd.off');
  if (night) for (let y = PAD; y < PAD + TS; y++) for (let x = PAD; x < PAD + TS; x++){ const i = y * BW + x;
    if (litK.has(SK[i]) && hash(ox + x, oy + y, 93) < .02) dyn.wins.push(ox + x, oy + y, offK); }
  if (late()){ yield; back(); }
  /* colour both layers (crop the pad) */
  const rgb = new Uint32Array(KEYS.length); for (let q = 1; q < KEYS.length; q++) rgb[q] = u32(KEYS[q]);
  const paint = buf => {
    const {c, g} = PX.makeCanvas(TS, TS), img = g.createImageData(TS, TS), dd = new Uint32Array(img.data.buffer);
    for (let y = 0, j = 0; y < TS; y++) for (let x = 0, r = (y + PAD) * BW + PAD; x < TS; x++, j++, r++){ const q = buf[r]; if (q) dd[j] = rgb[q]; }
    g.putImageData(img, 0, 0); return c; };
  const cm = new Uint8Array(TS * TS); for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) cm[y * TS + x] = SK[(y + PAD) * BW + x + PAD] ? 1 : 0;
  const gc = paint(KB); if (late()){ yield; back(); }
  const sc2 = paint(SK); wsPut(WB);
  return {lvl, k: kv, tx, ty, gc, sc: sc2, gm, cm, hd, dyn, ms: 0, dep: dep.mask ? dep : null};
}

/* ---------- tile cache (LRU, ≈ 150 MB / 40 MB) & prefetch ---------- */
const TBYTES = TS * TS * 10;
const kk = kv => Math.round((kv || 0) * 100) / 100;
const tkey = (lvl, kv, tx, ty, th = PX.theme) => th + '|' + lvl + '|' + kk(kv) + '|' + tx + '|' + ty;
function tile(lvl, kv, tx, ty, make = true){
  const key = tkey(lvl, kv, tx, ty); let t = tiles.get(key);
  if (t){ tiles.delete(key); tiles.set(key, t); if (t.stale && make){ enqueue(lvl, kv, tx, ty, true, VIS); pump(); } return t; }   // stale: drawn while rebaked
  if (make && WORLD.lazy){ const f = TSRC ? standIn(key, lvl, kv, tx, ty) : fbs.get(key) || fbPut(key, fallback(lvl, kv, tx, ty, true)); if (f){ enqueue(lvl, kv, tx, ty, true, VIS); pump(); return f; } }
  if (make) WORLD.stats.sync = (WORLD.stats.sync || 0) + 1;                            // (a synchronous whole-tile bake)
  return make ? bakeStep(key, lvl, kv, tx, ty, Infinity) : null;
}
/* stage 1 r3 — WORLD.lazy on the tile source never bakes: the nearest baked level (fallback, below), else a flat stand-in, else plain land.
   Stand-in work is ≤ 4 ms per animation frame (6 in a zoom frame, r6; document.timeline: one time per frame); past that a plain one is drawn and upgraded on a
   later frame. (The object source — the mockup's parity path — keeps round 2's rule: a level with the whole area baked, else a bake.) */
let fbF = -1, fbMs = 0, VIS = false, ZF = false;                                      // VIS: the layer being drawn is at rest or a zoom's target level · ZF: a zoom frame
const FBR = 4, FBZ = 6;                                                               // stand-in ms per frame: at rest / zooming
const frameId = () => document.timeline && document.timeline.currentTime != null ? document.timeline.currentTime : Math.floor(performance.now() / 16);   // (one value per animation frame)
function standIn(key, lvl, kv, tx, ty){
  const f = fbs.get(key), fr = frameId(); if (fr !== fbF){ fbF = fr; fbMs = 0; }
  if (f && (!f.plain || f.fr === fr)){ fbs.delete(key); fbs.set(key, f);           // (a plain one is retried once per frame; LRU: one in use stays)
    if (!f.flat || f.plain || f.tb === WORLD.stats.bakes || !(fbMs < (ZF ? FBZ : FBR))) return f;
    f.tb = WORLD.stats.bakes; const t0 = performance.now(), g = fallback(lvl, kv, tx, ty, false, VIS ? UPMAX : 0, true); fbMs += performance.now() - t0;   // (r6: new bakes → a whole one?)
    return g ? fbPut(key, g) : f; }
  if (fbMs < (ZF ? FBZ : FBR)){ const t0 = performance.now(), g = fallback(lvl, kv, tx, ty, false, VIS ? UPMAX : 0) || flat(lvl, kv, tx, ty), d = performance.now() - t0; fbMs += d;
    WORLD.stats.fbMs = Math.max(WORLD.stats.fbMs || 0, d); if (g) return fbPut(key, g); }
  const p = f || fbPut(key, plain(lvl, kv, tx, ty)); p.fr = fr; return p;
}
const FBN = SMALL ? 12 : 48;
const fbPut = (key, f) => { if (!f) return f; const o = fbs.get(key); if (o && o !== f){ fbs.delete(key); freeT(o); }
  if (fbs.size > FBN){ const k0 = fbs.keys().next().value; freeT(fbs.get(k0)); fbs.delete(k0); }   // (stand-ins ≤ 3 / 12 MB)
  fbs.set(key, f); return f; };
/* plain land (a canvas per theme, shared) · flat: the map tiles that are in (PX.src.peek: LOD1, else LOD2; r6: the few layers it reads are
   decoded first, PX.src.prep) as flat land / built / green / water + the main roads (tertiary+ on the street tier — every car's road, r6 —,
   primary+ above: TRAFFIC's dots) — no structures (a shared empty layer) */
const SHC = {};
const shared = (name, key) => { const n = PX.theme + name; let c = SHC[n]; if (c) return c;
  const o = PX.makeCanvas(TS, TS); if (key){ o.g.fillStyle = PX.col(key); o.g.fillRect(0, 0, TS, TS); } SHARED.add(o.c); return SHC[n] = o.c; };
const plain = (lvl, kv, tx, ty) => { WORLD.stats.plains = (WORLD.stats.plains || 0) + 1; return {lvl, k: kv, tx, ty, fb: true, plain: true, flat: true, dyn: NODYN, gc: shared('land', 'land.d1'), sc: shared('none')}; };
const u32 = key => { const c = PX.rgb(PX.col(key)); return (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0; };
/* ≤ 16 m/px: LOD1, and LOD2 in the 4 km cells with no LOD1 tile (outside the corridor band: the bake reads LOD2 there too) */
function flatPix(lvl, tx, ty){                                                        // (runs between bake slices: they restore OX / OY)
  const m = lvl, x0 = tx * TS, y0 = ty * TS, bb = [x0 * m, -(y0 + TS) * m, (x0 + TS) * m, -y0 * m], pk = lod => SRC.peek(bb, lod) || (SRC.prep(bb, lod) ? SRC.peek(bb, lod) : null), Q = lvl <= 16 && pk(1);
  let S = 0, I = null, J = null, no = null;
  if (Q && TSRC){ S = SRC.cellRect(1, '0_0')[2]; I = new Int32Array(TS); J = new Int32Array(TS); no = new Set();
    for (let q = 0; q < TS; q++){ I[q] = Math.floor((x0 + q + .5) * m / S); J[q] = Math.floor(-(y0 + q + .5) * m / S); }
    for (let j = J[TS - 1]; j <= J[0]; j++) for (let i = I[0]; i <= I[TS - 1]; i++) if (SRC.cell(1, i + '_' + j) === 'none') no.add(i * 4096 + j); }
  const Q2 = (!Q || (no && no.size)) && pk(2); if (!Q && !Q2) return null;
  const cl = new Uint8Array(NB), R0 = lvl <= 5 ? 4 : 6; let rt = 0; OX = x0 - PAD; OY = y0 - PAD;
  const draw = Q => {
    for (const f of Q.landuse) if (BUILT.has(LU.indexOf(f.c))) scanFill(f.p, m, cl, 1);
    for (const f of Q.green) if (GR.indexOf(f.c) > 0) scanFill(f.p, m, cl, 2);
    for (const f of Q.water) scanFill(f.p, m, cl, 3);
    const t0 = performance.now() - rt;                                                // the main roads, major first (≤ 1.5 ms in all: a stand-in)
    for (const f of Q.roads.filter(f => !f.t && (RANK[f.c] || 0) >= R0).sort((a, b) => RANK[b.c] - RANK[a.c])){ if (performance.now() - t0 > 1.5) break;
      const rp = WORLD.roadPath(f, lvl), v = RANK[f.c] >= 6 || lvl > 5 ? 4 : 5; if (!rp) continue;
      if (rp.w === 1) bres(rp.P, i => { cl[i] = v; }); else strokeD(rp.P, rp.w / 2, i => { cl[i] = v; }); }
    rt = performance.now() - t0; };
  if (Q2){ draw(Q2); if (Q) for (let y = 0; y < TS; y++) for (let x = 0, r = (y + PAD) * BW + PAD; x < TS; x++) if (!no.has(I[x] * 4096 + J[y])) cl[r + x] = 0; }   // (LOD2 only where LOD1 has no tile)
  if (Q) draw(Q);
  const C = ['land.d1', 'land.d2', 'green.d2', 'water.mid', 'road.major', 'road.surf'].map(u32), o = new Uint32Array(TS * TS);
  for (let y = 0; y < TS; y++) for (let x = 0, j = (y + PAD) * BW + PAD; x < TS; x++, j++) o[y * TS + x] = C[cl[j]];
  return o;
}
const landPix = () => new Uint32Array(TS * TS).fill(u32('land.d1'));
function flat(lvl, kv, tx, ty){
  const o = flatPix(lvl, tx, ty); if (!o) return null;
  const {c, g} = PX.makeCanvas(TS, TS), img = g.createImageData(TS, TS); new Uint32Array(img.data.buffer).set(o);
  g.putImageData(img, 0, 0); WORLD.stats.flats = (WORLD.stats.flats || 0) + 1;
  return {lvl, k: kv, tx, ty, fb: true, flat: true, dyn: NODYN, gc: c, sc: shared('none')};
}
/* review round 2 — never a whole-tile bake inside a zoom frame: while WORLD.lazy (main.js sets it for glide frames of live play), a
   tile that is not baked yet is drawn from a baked NEIGHBOUR level (the nearest in the ladder that has the area, finer first on a tie) by
   nearest-neighbour — the oblique projection scales uniformly with the level (X = x / lvl, Y = (−y − h·k) / lvl), so ground AND
   structures line up; NN copies palette colours only (audit 0). The real tile is queued urgently and replaces it as soon as it is
   baked (the fallback is dropped then). No dynamics (ripples, flicker) on a stand-in, no coveredAt / groundAt data. */
const fbs = new Map();
const PXC = new Map(), PXN = SMALL ? 8 : 32;                                          // pixel copies of stand-in sources: LRU, ≤ 2 / 8 MB
const pixOf = (t, k) => { const c = t[k]; let a = PXC.get(c); if (a){ PXC.delete(c); PXC.set(c, a); return a; }
  a = new Uint32Array(c.getContext('2d').getImageData(0, 0, TS, TS).data.buffer); PXC.set(c, a); if (PXC.size > PXN) PXC.delete(PXC.keys().next().value); return a; };
const NODYN = {ripple: [], mir: [], refl: [], lamps: [], wins: [], beacons: []};
/* stage 1 r3 (tile source): a level that has only part of the area baked still serves (the most of it, then the nearest level; not one
   more than 2× finer); the rest of the tile is the flat stand-in's ground (or plain land) with no structures. full: round 2's rule */
const covered = (lvl, kv, tx, ty) => { const i = lvlIdx(lvl);                           // (look-ahead: a pass-through tile with a full NN stand-in)
  for (let j = 0; j < LEVELS.length; j++){ const L = LEVELS[j], s = lvl / L; if (j === i || s > 2) continue; let all = true;
    for (let u = Math.floor((ty * TS + .5) * s / TS); all && u <= Math.floor((ty * TS + TS - .5) * s / TS); u++) for (let w = Math.floor((tx * TS + .5) * s / TS); w <= Math.floor((tx * TS + TS - .5) * s / TS); w++) if (!tiles.has(tkey(L, kv, w, u))){ all = false; break; }
    if (all) return true; }
  return false; };
/* up: at rest / a zoom's target level (VIS), never from > UPMAX× coarser — a fast close follow drew street tiles from the city view as
   staircases of 12 art px blocks along the roads (l18 / l22 at 4 m/px); the flat stand-in draws those roads at the tile's own scale */
const UPMAX = 4;
function fallback(lvl, kv, tx, ty, full, up = 0, whole = false){                      // (whole: only one with every source tile baked)
  const i = lvlIdx(lvl), cand = LEVELS.map((l, j) => j).filter(j => j !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b);   // nearest first (finer on a tie)
  let best = null;
  for (const j of cand){
    const L = LEVELS[j], s = lvl / L; if (!full && (s > 2 || (up && s * up < 1 - 1e-9))) continue;   // (tiles: never from > 2× finer — up to 16 source tiles)
    const a0 = Math.floor((tx * TS + .5) * s / TS), a1 = Math.floor((tx * TS + TS - .5) * s / TS), b0 = Math.floor((ty * TS + .5) * s / TS), b1 = Math.floor((ty * TS + TS - .5) * s / TS);
    let n = 0; for (let u = b0; u <= b1; u++) for (let w = a0; w <= a1; w++) if (tiles.has(tkey(L, kv, w, u))) n++;
    const f = n / ((a1 - a0 + 1) * (b1 - b0 + 1)); if ((!full || f === 1) && f > (best ? best.f + 1e-9 : 0)){ best = {j, f}; if (f === 1) break; }
  }
  if (!best || (whole && best.f < 1)) return null;
  const L = LEVELS[best.j], s = lvl / L, cx = new Int32Array(TS), cy = new Int32Array(TS);
  for (let q = 0; q < TS; q++){ cx[q] = Math.floor((tx * TS + q + .5) * s); cy[q] = Math.floor((ty * TS + q + .5) * s); }
  const ax = Math.floor(cx[0] / TS), bx = Math.floor(cx[TS - 1] / TS), ay = Math.floor(cy[0] / TS), by = Math.floor(cy[TS - 1] / TS);
  const out = {lvl, k: kv, tx, ty, fb: true, flat: best.f < 1, dyn: NODYN}; let bg = null;
  if (best.f < 1){ bg = flatPix(lvl, tx, ty); if (!bg){ bg = landPix(); out.lp = true; } }   // (lp: plain land in it — WORLD.hint builds it again)
  const nw = bx - ax + 1, col = new Int32Array(TS), cw = new Int32Array(TS);
  for (let x = 0; x < TS; x++){ const w = Math.floor(cx[x] / TS); cw[x] = w - ax; col[x] = cx[x] - w * TS; }
  for (const k of ['gc', 'sc']){
    const S = []; for (let u = ay; u <= by; u++) for (let w = ax; w <= bx; w++){ const t = tiles.get(tkey(L, kv, w, u)); S.push(t ? pixOf(t, k) : null); }
    const {c, g} = PX.makeCanvas(TS, TS), img = g.createImageData(TS, TS), o = new Uint32Array(img.data.buffer);
    for (let y = 0; y < TS; y++){ const Y = cy[y], v = Math.floor(Y / TS), ly = (Y - v * TS) * TS, rb = (v - ay) * nw, q = y * TS;
      for (let x = 0; x < TS; x++){ const P = S[rb + cw[x]]; o[q + x] = P ? P[ly + col[x]] : k === 'gc' ? bg[q + x] : 0; } }
    g.putImageData(img, 0, 0); out[k] = c; }
  WORLD.stats.fallbacks = (WORLD.stats.fallbacks || 0) + 1; if (best.f < 1) WORLD.stats.partial = (WORLD.stats.partial || 0) + 1; return out;
}
/* a tile bake is a generator (bakeGen) that yields once past the slice's deadline (DL), so idle time bakes it in slices of ≤ 8 ms (review 1:
   90–150 ms idle bakes blocked the frame loop); a synchronous need finishes the same job. → the tile, or null while unfinished.
   ≤ JMAX under way (~5 MB each): a new one past that ends the least urgent, then least advanced (stage 1 r4; r3 ended the least advanced) */
const jobs = new Map(), JMAX = SMALL ? 4 : 8;
const readR = (lvl, kv, tx, ty) => { const lift = (TSRC ? HCAP : HMAX) * kk(kv) + 12 * lvl;           // the metres a tile bake reads
  return [(tx * TS - PAD) * lvl - 12 * lvl, -(ty * TS + TS + PAD) * lvl - lift, (tx * TS + TS + PAD) * lvl + 12 * lvl, -(ty * TS - PAD) * lvl + 12 * lvl]; };
function bakeStep(key, lvl, kv, tx, ty, until){
  let j = jobs.get(key);
  if (j && j.theme !== PX.theme){ jobs.delete(key); j = null; }
  if (!j){ if (jobs.size >= JMAX){ let o = null, os = 0; const now = performance.now();
      for (const [k, x] of jobs){ const q = qset.get(k), sc = !q ? Infinity : LA() ? score(q, now) : 0; if (!o || sc > os + 1e-9 || (Math.abs(sc - os) <= 1e-9 && x.ms < o[1].ms)){ o = [k, x]; os = sc; } }
      jobs.delete(o[0]); const S = WORLD.stats; S.dropped = (S.dropped || 0) + 1; S.droppedMs = (S.droppedMs || 0) + o[1].ms; }
    jobs.set(key, j = {g: bakeGen(lvl, kk(kv), tx, ty), ms: 0, theme: PX.theme, n: 0, t: 0, R: readR(lvl, kv, tx, ty)}); ENQ++; }   // R: what the bake reads (an arrival over it restarts it)
  const t0 = j.t = performance.now(); let r; DL = until;
  try { do r = j.g.next(); while (!r.done && performance.now() < until); } catch (e){ jobs.delete(key); BAD.add(key); throw e; } finally { DL = Infinity; ACC = NOACC; }
  const d = performance.now() - t0; j.ms += d; j.n++;
  const S = WORLD.stats; if (until === Infinity) S.syncMax = Math.max(S.syncMax || 0, d); else S.maxSlice = Math.max(S.maxSlice || 0, d);
  if (!r.done) return null;
  jobs.delete(key); const t = r.value; t.ms = j.ms; S.bakes++; S.bakeMs += j.ms; S.lastBake = j.ms; S.maxBake = Math.max(S.maxBake, j.ms);
  const L = S.byLvl || (S.byLvl = {}), e = L[lvl] || (L[lvl] = [0, 0]); e[0]++; e[1] += j.ms;
  const old = tiles.get(key); if (old){ tiles.delete(key); freeT(old); S.rebakes = (S.rebakes || 0) + 1; }
  const f = fbs.get(key); if (f){ freeT(f); fbs.delete(key); }
  tiles.set(key, t); LKV = null;
  while (tiles.size * TBYTES > MAXB){ const k0 = tiles.keys().next().value; freeT(tiles.get(k0)); tiles.delete(k0); }
  if (old) for (const fn of RB) fn(lvl, t.k, tx * TS, ty * TS, TS);
  S.tiles = tiles.size; S.bytes = tiles.size * TBYTES;
  return t;
}
const tilesIn = (X0, Y0, w, h) => { const out = [];
  for (let ty = Math.floor(Y0 / TS); ty <= Math.floor((Y0 + h - 1) / TS); ty++) for (let tx = Math.floor(X0 / TS); tx <= Math.floor((X0 + w - 1) / TS); tx++) out.push([tx, ty]);
  return out; };
const frameOf = v => v.rest ? {x0: v.ox, y0: v.oy, w: v.W, h: v.H} : {x0: Math.floor(v.ox), y0: Math.floor(v.oy), w: Math.ceil(v.W / v.zs) + 2, h: Math.ceil(v.H / v.zs) + 2};
/* the idle queue: q = [lvl, k, tx, ty, theme, key, last wanted, last wanted urgently, sN, its AHG, last drawn as a stand-in at a rest
   level, GEN / map data in for it, only a zoom's pass-through view wants it] (ms). Object source (round 3, the parity path): the most
   recently wanted tile — urgent ones (drawn as a stand-in, a zoom's views: for 1.5 s after the request) first, a job already under way
   first among near-equals; a request not renewed for 20 s is dropped.
   stage 1 r4 — LOOK-AHEAD (tile source, once the train is drawn: TRAIN.head.s): by WHERE the ride needs each tile. sN = the first arc
   position of the train (from 300 m behind to 8 km ahead) at which a view of the tile's level round the train shows it (the sweep and the
   arrival views below give it directly); the score is sN − the train's s (m). First the stand-ins on screen at a rest level or a zoom's
   target (the train's own tiles first), then a bake under way (+1.5–2.5 km: finish before starting), then by score; +1.5 km for a level
   the camera has not rested at / zoomed to in the last 10 s, +5 km for a zoom's pass-through view (a prefetch rect larger than a rest
   view); off the track window: last, by recency; only behind the train and not wanted for 1 s: dropped. A street tile whose map data is
   still to come waits (its bake would be stale on arrival) unless on screen. A rest-size prefetch holding one of the next two stations
   is wanted at that arrival (the next hop's overview). drawGround sweeps the level of each hop ahead (hopLvl) 3 km on; the ring
   round the view is object-source only. Idle slices: the idle deadline − 1.5 ms, ≤ 12 ms; + the in-frame feed (below) */
const idleQ = [], qset = new Map(), BAD = new Set(); let idleOn = false;                // BAD: bakes that threw (not queued again)
const baked = key => { const t = tiles.get(key); return !!t && !t.stale; };
let AH = null, AHG = 0, AHS = 0, SLT = -1e9; const RST = new Map();                  // RST: level → last rest / zoom target there · SLT: last close rest
const LA = () => TSRC && !!AH;
const RD = () => PX.D || D;                                                           // the ride (a reversed ride of the same line keeps WORLD's D)
function aheadUpd(v){
  const h = window.TRAIN && TRAIN.head, now = performance.now();
  if (!TSRC || !h || !(h.s > -1e9) || !TRAIN.along){ AH = null; return; }
  if (v.rest){ RST.set(v.lvl, now); if (v.lvl <= 4) SLT = now; } else if (v.lvlTo) RST.set(v.lvlTo, now);
  const f = v.ui && v.ui.free && v.ui.free.w > 0 ? v.ui.free : {w: v.W, h: v.H};
  const d = RD(); if (AH && Math.abs(h.s - AH.s) < 30 && AH.W === v.W && AH.H === v.H && AH.fw === f.w && AH.fh === f.h && AH.d === d) return;
  const P = [], end = TRAIN.lineLength; for (let s = Math.max(0, h.s - 8000); ; s = Math.min(end, s + 40)){ const p = TRAIN.along(s); P.push(p.x, p.y, s); if (s >= end || s > h.s + 8000) break; }
  if (!AH || AH.W !== v.W || AH.H !== v.H || AH.d !== d){ AHG++; HOPL.clear(); } if (AH && (AH.fw !== f.w || AH.fh !== f.h)) HOPL.clear();
  const p0 = TRAIN.along(h.s); AH = {s: h.s, x: p0.x, y: p0.y, W: v.W, H: v.H, fw: f.w, fh: f.h, P, d};
}
/* sN: the first sample ≥ 300 m behind the train in the window (8 km behind to 8 km ahead) whose point is inside the tile grown by half a
   view (+ 32 px) — −∞: only behind that, ∞: nowhere near the track */
const sNof = (lvl, tx, ty) => { const ex = (AH.W / 2 + 32) * lvl, ey = (AH.H / 2 + 32) * lvl, x0 = tx * TS * lvl - ex, x1 = (tx + 1) * TS * lvl + ex, y0 = -(ty + 1) * TS * lvl - ey, y1 = -ty * TS * lvl + ey, P = AH.P;
  let back = false; for (let i = 0; i < P.length; i += 3) if (P[i] >= x0 && P[i] <= x1 && P[i + 1] >= y0 && P[i + 1] <= y1){ if (P[i + 2] >= AH.s - 300) return P[i + 2]; back = true; }
  return back ? -Infinity : Infinity; };
function score(q, now){                                                               // (look-ahead) lower = sooner; Infinity = drop
  const j = jobs.get(q[5]), go = j ? 1500 + 1000 * Math.min(1, j.ms / 25) : 0;           // (a bake under way first: fewer half-done bakes, less memory)
  if (now - q[10] < 300) return -1e9 + Math.hypot((q[2] + .5) * TS * q[0] - AH.x, -(q[3] + .5) * TS * q[0] - AH.y) / q[0] - go;   // (on screen: the train's own tiles first)
  if (q[9] !== AHG){ q[8] = sNof(q[0], q[2], q[3]); q[9] = AHG; }
  if (q[8] === Infinity) return 1e8 + (now - q[6]);
  const d = q[8] - AH.s; if (d < -300) return now - q[6] > 1000 ? Infinity : 1e7;
  return Math.max(0, d) + (q[13] ? 5000 : now - (RST.get(q[0]) || -1e9) < 1e4 ? 0 : 1500) - go;
}
/* the level the camera rides hop a at — WORLD.setPlan's (stay, else close), else closeOf: a copy of
   js/px/ride.js closeLevel (the hop's track box + 80 m filling the free map area 1.5×, the nearest level, 3.2–4 m/px) — what
   drawGround's look-ahead sweeps */
const HOPL = new Map(); let PLAN = null;
WORLD.setPlan = list => { PLAN = null; if (!Array.isArray(list)) return;                // (for the ride of the moment: PX.D)
  for (const e of list) if (e && e.i >= 0){ const l = +(typeof e.stay === 'number' && e.stay > 0 ? e.stay : e.stay === true ? e.over : e.close); if (l > 0) (PLAN || (PLAN = new Map())).set(e.i, LEVELS[lvlIdx(l)]); }
  if (PLAN) PLAN.d = RD(); };
const planOn = () => !!PLAN && PLAN.d === RD(), hopLvl = a => planOn() && PLAN.get(a) || closeOf(a);
function closeOf(a){
  let l = HOPL.get(a); if (l) return l; const st = RD().stations; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let s = st[a].d; ; s = Math.min(st[a + 1].d, s + 20)){ const p = TRAIN.along(s); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); if (s >= st[a + 1].d) break; }
  const need = Math.max((x1 - x0 + 80) / AH.fw, (y1 - y0 + 80) / AH.fh) / 1.5; l = LEVELS[0];
  for (const q of LEVELS) if (Math.abs(Math.log(q / need)) < Math.abs(Math.log(l / need))) l = q;
  HOPL.set(a, l = Math.min(4, Math.max(3.2, l))); return l;
}
const dataIn = q => { if (q[0] > 5 || !TSRC) return true; if (q[11] !== GEN){ q[11] = GEN; q[12] = SRC.complete(readR(q[0], q[1], q[2], q[3]), 0); } return q[12]; };
function enqueue(lvl, kv, tx, ty, urgent, vis, sN, pt){ const key = tkey(lvl, kv, tx, ty); if (baked(key) || BAD.has(key)) return;
  let q = qset.get(key); const now = performance.now();
  if (!q){ qset.set(key, q = [lvl, kv, tx, ty, PX.theme, key, now, 0, Infinity, -1, -1e9, -1, true, !!pt]); idleQ.push(q); ENQ++; } else { q[6] = now; if (!pt) q[13] = false; }
  if (urgent) q[7] = now; if (vis){ q[10] = now; ENQ++; }
  if (sN !== undefined && (q[9] !== AHG || sN < q[8])){ q[8] = sN; q[9] = AHG; } }
function pick(){
  const now = performance.now(), la = LA(); let b = null, bs = la ? Infinity : -Infinity;
  for (let i = idleQ.length - 1; i >= 0; i--){ const q = idleQ[i];
    let s = q[4] !== PX.theme || baked(q[5]) || now - q[6] > 2e4 ? null : la ? score(q, now) : q[6] + (now - q[7] < 1500 ? 1e7 : 0) + (jobs.has(q[5]) ? 500 : 0);
    if (s === null || s === Infinity){ idleQ.splice(i, 1); qset.delete(q[5]); if (!baked(q[5])) jobs.delete(q[5]); continue; }
    if (la){ if (s < bs && (s < -1e8 || jobs.has(q[5]) || dataIn(q))){ bs = s; b = q; } } else if (s > bs){ bs = s; b = q; } }
  if (la && b && !jobs.has(b[5]) && jobs.size >= JMAX && bs > -1e8){ let c = null, cs = Infinity;   // (at the limit: finish one under way unless on screen)
    for (const k of jobs.keys()){ const q = qset.get(k); if (!q) continue; const t = score(q, now); if (t < cs){ cs = t; c = q; } } if (c) b = c; }
  return b;
}
/* in-frame feed (look-ahead, at rest): the frames' own cost c (script time from the frame's start to its end — a MessageChannel message
   posted in the frame — minus the bakes in it), p50 of the last 30; a frame whose c is cheap bakes the queue for B = min(10, 14 − p50) ms
   (less what WORLD.bakeSome baked in it), before its ground is drawn, never past ~15 ms into the frame (the p50 tail after drawGround) */
let FF = -1, FDF = -1, FR = null, mc = null; const FCO = [], FTL = [], FRS = new Map();   // FR: this frame {s: start, g: first WORLD call, b: baked ms}
const p50 = a => a.length < 8 ? 8 : a.slice().sort((x, y) => x - y)[a.length >> 1];
function frameMark(){
  const fr = frameId(); if (fr === FF) return; FF = fr;
  FR = {s: document.timeline && document.timeline.currentTime != null ? document.timeline.currentTime : performance.now(), g: performance.now(), b: 0};
  if (!mc){ if (!window.MessageChannel) return; mc = new MessageChannel(); mc.port1.onmessage = e => { const r = FRS.get(e.data), t = performance.now(); if (!r) return; FRS.delete(e.data);
    FCO.push(t - r.s - r.b); FTL.push(t - r.g); if (FCO.length > 30){ FCO.shift(); FTL.shift(); } }; }
  FRS.set(fr, FR); if (FRS.size > 8) FRS.delete(FRS.keys().next().value); mc.port2.postMessage(fr);
}
function feed(){
  if (SUSP || (dry() && !HQ.length)) return; const t0 = performance.now(), until = Math.min(t0 + Math.min(10, 14 - p50(FCO)) - FR.b, FR.s + 15 - p50(FTL));
  if (HQ.length) hintRun(until);
  for (let q, n = 0; performance.now() < until && (q = pick()); n++){ if (!jobs.has(q[5]) && until - performance.now() < 3) break;
    let t; try { t = bakeStep(q[5], q[0], q[1], q[2], q[3], until); } catch (e){ t = 1; console.error('WORLD bake ' + q[5], e); }
    if (t){ const i = idleQ.indexOf(q); if (i >= 0) idleQ.splice(i, 1); qset.delete(q[5]); } }
  FR.b += performance.now() - t0;
}
/* dry: the look-ahead found nothing it may bake (every tile left waits for map data) — no idle callbacks until map data arrives or a
   tile is queued / wanted on screen / started (ENQ) · SUSP: WORLD.suspend() */
let ENQ = 0, dryG = -1, dryN = -1;
const dry = () => LA() && dryG === GEN && dryN === ENQ;
function pump(){
  if (idleOn || SUSP || (!HQ.length && (!idleQ.length || dry()))) return; idleOn = true;
  const run = dl => { if (SUSP){ idleOn = false; return; }
    const t0 = performance.now(), left = dl && dl.timeRemaining ? dl.timeRemaining() : 8, until = t0 + Math.max(2, TSRC ? Math.min(12, left - 1.5) : Math.min(8, left));
    if (HQ.length) hintRun(until);
    let q;
    for (let n = 0; performance.now() < until && (q = pick()); n++){ if (n && !jobs.has(q[5]) && until - performance.now() < 3) break;   // (a new bake opens with an atomic map query)
      let t; try { t = bakeStep(q[5], q[0], q[1], q[2], q[3], until); } catch (e){ t = 1; console.error('WORLD bake ' + q[5], e); }
      if (t){ idleQ.splice(idleQ.indexOf(q), 1); qset.delete(q[5]); } }
    if (q === null && LA()){ dryG = GEN; dryN = ENQ; }
    if (HQ.length || (idleQ.length && !dry())) sched(); else idleOn = false; };
  const sched = () => window.requestIdleCallback ? requestIdleCallback(run, {timeout: 500}) : setTimeout(run, 30);
  sched();
}
WORLD.suspend = () => { SUSP = true; jobs.clear(); HQ.length = 0; };                     // (half-done bakes let go: ~5 MB each)
WORLD.resume = () => { SUSP = false; WPF = WP.size > 0; pump(); warmRun(); };
/* WORLD.hint (header): HQ = the stand-ins to build ahead [lvl, k, tx, ty, pass-through] after the map cells to decode ['d', lod, bb]
   (≤ 2 ms of it at once, the rest on idle time), ≤ FBN / 2 stand-ins (those on screen stay in the LRU) · LVW: the last drawn view */
const HQ = []; let LVW = null;
WORLD.hint = (lvl, r, kv) => {
  if (!TSRC || !r || SUSP) return 0;
  lvl = LEVELS[lvlIdx(lvl)]; kv = kk(kv != null ? kv : LVW ? LVW.k : .4);
  const R = Array.isArray(r) ? r : [Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.max(r.x0, r.x1), Math.max(r.y0, r.y1)], now = performance.now();
  const from = LVW ? LVW.lvl : lvl, cx = (R[0] + R[2]) / 2, cy = (R[1] + R[3]) / 2, S = WORLD.stats, H = S.hint || (S.hint = {n: 0, dec: 0, pre: 0, ms: 0}), DC = new Map(), J = [];
  H.n++; SRC.want(R, lvl <= 5 ? 0 : lvl <= 16 ? 1 : 2);
  const cells = (lod, B) => { const c = SRC.cellRect(lod, '0_0')[2];                   // the map cells over B (one entry a cell: the union of its parts)
    for (let j = Math.floor(B[1] / c); j <= Math.floor(B[3] / c); j++) for (let i = Math.floor(B[0] / c); i <= Math.floor(B[2] / c); i++){
      const k = lod + ':' + i + '_' + j, b = [Math.max(B[0], i * c), Math.max(B[1], j * c), Math.min(B[2], i * c + c), Math.min(B[3], j * c + c)], o = DC.get(k);
      if (o) o[3] = [Math.min(o[3][0], b[0]), Math.min(o[3][1], b[1]), Math.max(o[3][2], b[2]), Math.max(o[3][3], b[3])];
      else DC.set(k, [Math.hypot((i + .5) * c - cx, (j + .5) * c - cy), 'd', lod, b]); } };
  const add = (L, x0, y0, x1, y1, pt) => { const X0 = Math.floor(x0 / L), Y0 = Math.floor(-y1 / L);
    for (const [tx, ty] of tilesIn(X0, Y0, Math.ceil(x1 / L) - X0 + 1, Math.ceil(-y0 / L) - Y0 + 1)){ const key = tkey(L, kv, tx, ty); if (tiles.has(key)) continue;
      if (!pt) enqueue(L, kv, tx, ty, true, false);
      J.push([Math.hypot((tx + .5) * TS * L - cx, -(ty + .5) * TS * L - cy) + (pt ? 1e9 : 0), L, kv, tx, ty, pt]); } };
  add(lvl, ...R, false); if (lvl <= 16) cells(1, R);                                      // (LOD1 only where a ≤ 16 m/px stand-in reads it: a phone has 24 MB of map)
  if (LVW && from < lvl) for (const L of LEVELS) if (L >= from && L < lvl){                // zooming out: the levels on the way, as far as each is drawn
    const m = Math.min(lvl, LEVELS[lvlIdx(L) + 1] * 1.22), hw = LVW.W / 2 * m, hh = LVW.H / 2 * m;
    const B = [Math.min(LVW.cx, cx) - hw, Math.min(LVW.cy, cy) - hh, Math.max(LVW.cx, cx) + hw, Math.max(LVW.cy, cy) + hh]; add(L, ...B, true); if (L <= 16) cells(1, B); }
  cells(2, R);
  const dc = [...DC.values()].sort((a, b) => a[0] - b[0]); J.sort((a, b) => a[0] - b[0]); HQ.length = 0;
  for (const d of dc) HQ.push(d.slice(1)); for (const j of J.slice(0, FBN >> 1)) HQ.push(j.slice(1));
  RST.set(lvl, now); ENQ++; hintRun(performance.now() + 2); pump(); return J.length;   // (≤ 2 ms now: the map cells nearest the centre)
};
function hintRun(until){
  const H = WORLD.stats.hint || (WORLD.stats.hint = {n: 0, dec: 0, pre: 0, ms: 0}), t0 = performance.now();
  while (HQ.length && performance.now() < until){ const h = HQ.shift();
    try { if (h[0] === 'd'){ H.dec += SRC.prep(h[2], h[1]); continue; }
      const [L, kv, tx, ty, pt] = h, key = tkey(L, kv, tx, ty), f = fbs.get(key); if (tiles.has(key) || (f && !f.plain && !f.lp)) continue;
      const g = fallback(L, kv, tx, ty, false, pt ? 0 : UPMAX) || flat(L, kv, tx, ty); if (g){ fbPut(key, g); H.pre++; } }
    catch (e){ console.error('WORLD hint', e); } }
  H.ms += performance.now() - t0;
}
WORLD.prefetch = (lvl, rect, kv = .4, urgent = false) => {
  lvl = LEVELS[lvlIdx(lvl)];
  let sN, pt = false;                                                                  // (a view the size of a rest view: the camera goes there — at the
  if (AH && !(pt = Math.abs(rect.x1 - rect.x0) > (AH.W + 50) * lvl)){                // arrival at one of the next two stations it holds)
    const st = RD().stations, ins = p => p.x >= Math.min(rect.x0, rect.x1) && p.x <= Math.max(rect.x0, rect.x1) && p.y >= Math.min(rect.y0, rect.y1) && p.y <= Math.max(rect.y0, rect.y1);
    for (let i = 0, n = 0; i < st.length && n < 2; i++) if (st[i].d > AH.s + 30){ n++; if (ins(TRAIN.along(st[i].d))){ sN = st[i].d; break; } } }
  const x0 = Math.floor(Math.min(rect.x0, rect.x1) / lvl), x1 = Math.ceil(Math.max(rect.x0, rect.x1) / lvl), y0 = Math.floor(-Math.max(rect.y0, rect.y1) / lvl), y1 = Math.ceil(-Math.min(rect.y0, rect.y1) / lvl);
  for (const [tx, ty] of tilesIn(x0, y0, x1 - x0 + 1, y1 - y0 + 1)) enqueue(lvl, kv, tx, ty, urgent, false, sN, pt);
  pump();
};
const viewNeeds = v => { const f = frameOf(v), out = tilesIn(f.x0, f.y0, f.w, f.h).map(([tx, ty]) => [v.lvl, v.k, tx, ty]);
  if (v.mix) for (const [tx, ty] of tilesIn(v.mix.v.ox, v.mix.v.oy, v.mix.v.W, v.mix.v.H)) out.push([v.mix.v.lvl, v.mix.v.k, tx, ty]);
  return out; };
WORLD.ready = v => viewNeeds(v).every(([l, kv, tx, ty]) => tiles.has(tkey(l, kv, tx, ty)));
/* v3 fix: bake what these views need for at most `ms` (sliced generator jobs, shared with the idle queue) → true when all are baked.
   main.js runs it in-frame while a MIX zoom is pending / gliding, so a zoom never waits long on first visits nor bakes a whole tile at once.
   stage 1 r4 (look-ahead): a zoom's pass-through level (not at rest, not its target) only where no baked level covers the tile (else its
   NN stand-in serves the few frames it is on screen), after the others */
const passThru = v => !v.rest && Math.abs(v.lvl - v.lvlTo) > 1e-9;                     // (a zoom frame's level on the way)
WORLD.bakeSome = (vs, ms = 4) => {
  const t0 = performance.now(), until = t0 + ms, need = [], la = LA(); if (la) frameMark();
  if (WPF && !SUSP && vs.length) warmWP([vs[0].cx, vs[0].cy]);
  try { return bakeSome(vs, ms, until, need, la); } finally { if (la && FR) FR.b += performance.now() - t0; }
};
function bakeSome(vs, ms, until, need, la){
  for (const v of vs){ const pt = la && passThru(v);                                  // (pt: a zoom frame's level on the way — only where no level covers it)
    for (const [l, kv, tx, ty] of viewNeeds(v)){ const key = tkey(l, kv, tx, ty); if (tiles.has(key) || (pt && covered(l, kv, tx, ty))) continue;
    need.push([(pt ? 2 : 0) + (jobs.has(key) ? 0 : 1), key, l, kk(kv), tx, ty]); } }
  need.sort((a, b) => a[0] - b[0]);                                                   // (the jobs under way first: fewer half-done bakes)
  for (const [c, key, l, kv, tx, ty] of need) enqueue(l, kv, tx, ty, true, la && c < 2);   // (idle time goes on with them too: the veil's pre-bake)
  pump();
  for (const [, key, l, kv, tx, ty] of need){ const left = until - performance.now(); if (left <= 0 || (!jobs.has(key) && left < ms / 2)) return false;   // (no new bake on a last sliver)
    if (!bakeStep(key, l, kv, tx, ty, until)) return false; }
  return true;
}
WORLD.bake = v => {
  const t0 = performance.now(); let n = 0;
  for (const [l, kv, tx, ty] of viewNeeds(v)){ const key = tkey(l, kv, tx, ty); if (baked(key)) continue;
    bakeStep(key, l, kk(kv), tx, ty, Infinity); n++; }                                  // (always baked: captures, WT.go)
  return {tiles: n, ms: performance.now() - t0};
};

/* =====================================================================================
   DRAW — each layer is composed at its baked level into a target (the art canvas at rest, or a level-frame buffer
   while zooming, then NN-resampled; a second buffer for the 'dissolve' level), dynamics driven by view.t.
   ===================================================================================== */
const bufs = {};
const buf = (name, w, h) => { let b = bufs[name]; if (!b || b.c.width !== w || b.c.height !== h){ b = bufs[name] = PX.makeCanvas(w, h); } return b; };
function composeGround(ctx, lvl, kv, X0, Y0, w, h, t, night){
  const inV = (x, y, r = 0) => x >= X0 - r && y >= Y0 - r && x < X0 + w + r && y < Y0 + h + r, fr = Math.floor(t * 1.6) % 3, TL = [];
  let nf = 0; for (const [tx, ty] of tilesIn(X0, Y0, w, h)){ const tl = tile(lvl, kv, tx, ty); TL.push(tl); if (tl.fb) nf++; ctx.drawImage(tl.gc, tx * TS - X0, ty * TS - Y0); }
  if (nf){ const S = WORLD.stats; S.fbDrawn = (S.fbDrawn || 0) + nf; S.fbFrames = (S.fbFrames || 0) + 1; }
  fbNote(TL, lvl);
  for (const {dyn: d} of TL){
    const R = d.ripple;
    for (let j = 0; j < R.length; j += 5) if (R[j + 3] === fr && inV(R[j], R[j + 1])){ ctx.fillStyle = PX.col(KEYS[R[j + 4]]); ctx.fillRect(R[j] - X0, R[j + 1] - Y0, R[j + 2], 1); }
    if (!night) continue;
    const Mi = d.mir || [];
    for (let j = 0; j < Mi.length; j += 4) if (Mi[j + 3] !== fr && inV(Mi[j], Mi[j + 1])){ ctx.fillStyle = PX.col(KEYS[Mi[j + 2]]); ctx.fillRect(Mi[j] - X0, Mi[j + 1] - Y0, 1, 1); }
    const F = d.refl;
    for (let j = 0; j < F.length; j += 3){ const n = Math.abs(F[j + 2]), u = Math.sign(F[j + 2]);
      if (inV(F[j], F[j + 1], 24)) for (let q = (F[j] + fr) & 1; q < n; q += 2) PX.px(ctx, F[j] - X0, F[j + 1] + q * u - Y0, q < n * .5 ? 'win.orange' : 'win.dim'); }
    const Lm = d.lamps;
    for (let j = 0; j < Lm.length; j += 2){ const hh = hash(Lm[j], Lm[j + 1], 91); if (hh < .12 && ((t * 5 + hh * 97) | 0) % 9 === 0 && inV(Lm[j], Lm[j + 1])) PX.px(ctx, Lm[j] - X0, Lm[j + 1] - Y0, 'win.dim'); }
  }
}
/* stats: fbF / flatF = animation frames showing a stand-in / a tile without its buildings (flat, plain, partial); flatRun = the longest
   a street tile under the train (±64 px of TRAIN.head) stayed without them (ms), flatLong = such runs > 0.5 s · plainF / plain10 /
   plain30 = frames drawing plain land for want of map data (a plain stand-in; half for a partial one with plain land in it) / over 10 % /
   over 30 % of their tiles, plainMax = the largest such share */
let nfF = -1, flF = -1, plF = -1, plV = 0; const FLR = new Map();
function fbNote(TL, lvl){
  const S = WORLD.stats, fr = frameId(), now = performance.now(), hd = window.TRAIN && TRAIN.head, near = hd && hd.lvl === lvl && lvl <= 5;
  let fb = false, fl = false, np = 0;
  for (const t of TL){ if (!t.fb) continue; fb = true; if (t.plain) np++; else if (t.lp) np += .5; if (!t.flat) continue; fl = true;
    if (near && hd.X + 64 > t.tx * TS && hd.X - 64 < t.tx * TS + TS && hd.Y + 64 > t.ty * TS && hd.Y - 64 < t.ty * TS + TS){ const k = lvl + '|' + t.tx + '|' + t.ty, r = FLR.get(k);
      if (r){ r.l = now; S.flatRun = Math.max(S.flatRun || 0, now - r.t); } else FLR.set(k, {t: now, l: now}); } }
  if (fb && fr !== nfF){ nfF = fr; S.fbF = (S.fbF || 0) + 1; } if (fl && fr !== flF){ flF = fr; S.flatF = (S.flatF || 0) + 1; }
  if (np){ const p = np / TL.length; if (fr !== plF){ plF = fr; plV = 0; S.plainF = (S.plainF || 0) + 1; }
    if (p > plV){ if (p > .1 && plV <= .1) S.plain10 = (S.plain10 || 0) + 1; if (p > .3 && plV <= .3) S.plain30 = (S.plain30 || 0) + 1; plV = p; S.plainMax = Math.max(S.plainMax || 0, p); } }
  for (const [k, r] of FLR) if (now - r.l > 100){ if (r.l - r.t > 500) S.flatLong = (S.flatLong || 0) + 1; FLR.delete(k); }
}
function composeStruct(ctx, lvl, kv, X0, Y0, w, h, t, night){
  const inV = (x, y) => x >= X0 && y >= Y0 && x < X0 + w && y < Y0 + h, TL = [];
  for (const [tx, ty] of tilesIn(X0, Y0, w, h)){ const tl = tile(lvl, kv, tx, ty); TL.push(tl); ctx.drawImage(tl.sc, tx * TS - X0, ty * TS - Y0); }
  for (const {dyn: d} of TL){
    const Wn = d.wins;
    for (let j = 0; j < Wn.length; j += 3){ const hh = hash(Wn[j], Wn[j + 1], 92); if (((t * .5 + hh * 13) | 0) % 3 === 0 && inV(Wn[j], Wn[j + 1])) PX.px(ctx, Wn[j] - X0, Wn[j + 1] - Y0, KEYS[Wn[j + 2]]); }
    const Bc = d.beacons;
    for (let j = 0; j < Bc.length; j += 2) if ((t * 2 | 0) & 1 && inV(Bc[j], Bc[j + 1])) PX.px(ctx, Bc[j] - X0, Bc[j + 1] - Y0, 'tower.top');   // aircraft beacon, 1 Hz
  }
}
/* NN resample of a level-frame buffer into g: screen px (sx, sy) ← buffer px (floor(ox + (sx+.5)/zs) - fx0, …); over = skip alpha 0 */
let outImg = null;
function resample(g, v, b, f, over){
  const W = v.W, H = v.H, src = new Uint32Array(b.g.getImageData(0, 0, f.w, f.h).data.buffer);
  const out = over ? g.getImageData(0, 0, W, H) : (outImg && outImg.width === W && outImg.height === H ? outImg : (outImg = g.createImageData(W, H))), o = new Uint32Array(out.data.buffer);
  const col = new Int32Array(W); for (let sx = 0; sx < W; sx++) col[sx] = Math.max(0, Math.min(f.w - 1, Math.floor(v.ox + (sx + .5) / v.zs) - f.x0));
  for (let sy = 0; sy < H; sy++){ const r = Math.max(0, Math.min(f.h - 1, Math.floor(v.oy + (sy + .5) / v.zs) - f.y0)) * f.w, q = sy * W;
    if (over){ for (let sx = 0; sx < W; sx++){ const p = src[r + col[sx]]; if (p >>> 24) o[q + sx] = p; } }
    else for (let sx = 0; sx < W; sx++) o[q + sx] = src[r + col[sx]]; }
  g.putImageData(out, 0, 0);
}
/* 'dissolve': the mix level (rest view) replaces g's pixels where PX.bayer(sx, sy) < a (structures: only its opaque ones) */
function dissolve(g, v, b, over){
  const W = v.W, H = v.H, a = v.mix.a, src = new Uint32Array(b.g.getImageData(0, 0, W, H).data.buffer), out = g.getImageData(0, 0, W, H), o = new Uint32Array(out.data.buffer);
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++){ if (PX.bayer(sx, sy) >= a) continue; const i = sy * W + sx, p = src[i];
    if (!over || p >>> 24) o[i] = p; }
  g.putImageData(out, 0, 0);
}
/* in 'dissolve', the structure pixels of the FROM level must vanish where the TO level takes over: drawStructures draws
   the from-level structures only where bayer ≥ a (a masked copy), then the to-level ones where bayer < a */
/* stage 1 r6 — a zoom frame on the tile source whose own level is not all at hand (baked, or a stand-in built) is composed at a level
   that has clearly more of it at hand (one level finer, ≤ 4× coarser: what the NN stand-ins would copy, without building them): the glide
   through 4 → 48 m/px no longer asks for a whole frame of new stand-ins at every level. The same view scaled: ox·lvl / L, zs = L / mpp */
let SV = null, SS = null;
const avail = u => { const f = frameOf(u), T = tilesIn(f.x0, f.y0, f.w, f.h); let n = 0;
  for (const [tx, ty] of T){ const key = tkey(u.lvl, u.k, tx, ty), s = tiles.get(key) || fbs.get(key); if (s && !s.plain && !s.lp) n += s.flat ? .5 : 1; }
  return n / T.length; };
function subst(v){
  if (SV === v) return SS; SV = v; SS = v; let bs = avail(v);
  if (bs < 1) for (const L of LEVELS){ const r = L / v.lvl; if (r < .66 || r > 4 || L === v.lvl) continue;
    const u = Object.assign({}, v, {lvl: L, zs: L / v.mpp, ox: v.ox * v.lvl / L, oy: v.oy * v.lvl / L}), a = avail(u);
    if (a > bs + .15 || (a >= bs - 1e-9 && SS !== v && Math.abs(Math.log(r)) < Math.abs(Math.log(SS.lvl / v.lvl)))){ SS = u; bs = a; } }
  return SS; }
function layer(g, v, which){
  if (TSRC && !v.rest && !v.mix) v = subst(v);
  const comp = which === 'g' ? composeGround : composeStruct, over = which === 's'; VIS = !passThru(v); ZF = !v.rest;
  if (v.rest && !(over && v.mix)) comp(g, v.lvl, v.k, v.ox, v.oy, v.W, v.H, v.t, v.night);
  else if (v.rest){                                                                   // dissolve, structures: from-level masked
    const b = buf(which + 'r', v.W, v.H); b.g.clearRect(0, 0, v.W, v.H); comp(b.g, v.lvl, v.k, v.ox, v.oy, v.W, v.H, v.t, v.night);
    const src = new Uint32Array(b.g.getImageData(0, 0, v.W, v.H).data.buffer), out = g.getImageData(0, 0, v.W, v.H), o = new Uint32Array(out.data.buffer);
    for (let sy = 0; sy < v.H; sy++) for (let sx = 0; sx < v.W; sx++){ const i = sy * v.W + sx, p = src[i]; if (p >>> 24 && PX.bayer(sx, sy) >= v.mix.a) o[i] = p; }
    g.putImageData(out, 0, 0);
  } else { const f = frameOf(v), b = buf(which + 'f', f.w, f.h); if (over) b.g.clearRect(0, 0, f.w, f.h);
    comp(b.g, v.lvl, v.k, f.x0, f.y0, f.w, f.h, v.t, v.night); resample(g, v, b, f, over); }
  if (v.mix){ const mv = v.mix.v, b = buf(which + 'm', mv.W, mv.H); if (over) b.g.clearRect(0, 0, mv.W, mv.H); VIS = true;
    comp(b.g, mv.lvl, mv.k, mv.ox, mv.oy, mv.W, mv.H, v.t, v.night); dissolve(g, v, b, over); }
}
let wantT = 0;
WORLD.drawGround = (g, v) => {
  if (LA()){ frameMark(); if (FDF !== FF && v.rest && !v.mix && FR){ FDF = FF; feed(); } }
  layer(g, v, 'g'); VIEWC = [v.cx, v.cy]; if (WPF && !SUSP) warmWP(VIEWC);
  const lw = LVW || (LVW = {}); lw.lvl = v.lvl; lw.k = v.k; lw.W = v.W; lw.H = v.H; lw.cx = v.cx; lw.cy = v.cy;
  if (TSRC && v.rest && performance.now() - wantT > 500){ wantT = performance.now();     // tile source: the map tiles this view shows come first
    const a = v.toGround(0, 0), b = v.toGround(v.W, v.H), up = v.lvl <= 5 ? HCAP * v.k : 0;   // (+ the towers standing south of the view that reach into it)
    SRC.want([Math.min(a.x, b.x), Math.min(a.y, b.y) - up, Math.max(a.x, b.x), Math.max(a.y, b.y)], v.lvl <= 5 ? 0 : v.lvl <= 16 ? 1 : 2); }
  aheadUpd(v); const now = performance.now();
  if (LA()){ const st = RD() && RD().stations, n = st ? st.length : 0;                  // look-ahead: each hop's level, 3 km on
    if (now - AHS > 100 && (planOn() || now - SLT < 3e4) && n > 1){ AHS = now; let a = 0; while (a < n - 2 && st[a + 1].d <= AH.s) a++;
      for (let s = AH.s + Math.min(v.W, v.H) * .25 * hopLvl(a); s < AH.s + 3000 && s <= TRAIN.lineLength; ){ while (a < n - 2 && st[a + 1].d <= s) a++;
        const L = hopLvl(a); RST.set(L, now); const hw = (v.W / 2 + 32) * L, hh = (v.H / 2 + 32) * L, p = TRAIN.along(s);
        const x0 = Math.floor((p.x - hw) / L), x1 = Math.ceil((p.x + hw) / L), y0 = Math.floor(-(p.y + hh) / L), y1 = Math.ceil(-(p.y - hh) / L);
        for (const [tx, ty] of tilesIn(x0, y0, x1 - x0 + 1, y1 - y0 + 1)) enqueue(L, v.k, tx, ty, false, false, s);
        s += Math.min(v.W, v.H) * .4 * L; } } }
  else { const f = frameOf(v), M = 128;                                               // idle-prefetch a ring around the view
    if (v.rest && !v.mix) for (const [tx, ty] of tilesIn(f.x0 - M, f.y0 - M, f.w + 2 * M, f.h + 2 * M)) enqueue(v.lvl, v.k, tx, ty); }   // not mid-zoom (integrator)
  pump();
};
WORLD.drawStructures = (g, v) => {
  layer(g, v, 's');
  const out = [], T = tier(v.lvl);
  for (const l of LMS){ if (!l.def.tiers.includes(T)) continue;
    const X = Math.round(l.x / v.lvl), Y = Math.round(-l.y / v.lvl), rr = lmR(l, v.lvl, v.k) * v.zs, cx = v.sx(X), cy = v.sy(Y);
    if (cx + rr < 0 || cx - rr > v.W || cy + rr < 0 || cy - rr > v.H) continue;          // (off screen by more than its art: not rasterised)
    const s = SPR.landmark(l.def.spr, v.lvl, v.k, v.night);
    const x = v.sx(X - s.ax), y = v.sy(Y - s.ay), w = Math.max(1, Math.round(s.w * v.zs)), h = Math.max(1, Math.round(s.h * v.zs));
    if (x < v.W && y < v.H && x + w > 0 && y + h > 0) out.push({id: l.id, x, y, w, h}); }
  return out;
};
/* per-pixel lookups from the baked 1-byte maps (no baking; unknown → false / LAND) */
let LKV = null, LKX = 0, LKY = 0, LKT = null;                                         // the last lookup's tile (a view is one frame's)
const lookup = (sx, sy, v, map) => {
  const X = v.rest ? v.ox + sx : Math.floor(v.ox + (sx + .5) / v.zs), Y = v.rest ? v.oy + sy : Math.floor(v.oy + (sy + .5) / v.zs), tx = Math.floor(X / TS), ty = Math.floor(Y / TS);
  if (LKV !== v || LKX !== tx || LKY !== ty){ LKV = v; LKX = tx; LKY = ty; LKT = tiles.get(tkey(v.lvl, v.k, tx, ty)) || null; }
  const t = LKT; return t ? t[map][(Y - ty * TS) * TS + X - tx * TS] : -1;
};
WORLD.coveredAt = (sx, sy, v) => lookup(sx, sy, v, 'cm') === 1;
WORLD.groundAt = (sx, sy, v) => Math.max(0, lookup(sx, sy, v, 'gm'));
/* stage 1 r4: false when no baked tile under the screen rect has a DECK pixel (groundAt is then never DECK there: TRAFFIC skips its
   per-pixel deck mask) */
WORLD.deckIn = (sx0, sy0, sx1, sy1, v) => {
  const P = (sx, sy) => [v.rest ? v.ox + sx : Math.floor(v.ox + (sx + .5) / v.zs), v.rest ? v.oy + sy : Math.floor(v.oy + (sy + .5) / v.zs)], a = P(sx0, sy0), b = P(sx1, sy1);
  for (let ty = Math.floor(a[1] / TS); ty <= Math.floor(b[1] / TS); ty++) for (let tx = Math.floor(a[0] / TS); tx <= Math.floor(b[0] / TS); tx++){ const t = tiles.get(tkey(v.lvl, v.k, tx, ty)); if (t && t.hd !== false) return true; }
  return false;
};

window.WORLD = WORLD;
})();
