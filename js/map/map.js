/* map.js — MAP: the tiled OpenStreetMap data of the pixel ride. tools/pack-map.js writes js/map/lines.js (MAPLINES, always loaded)
   and the tiles js/map/t<lod>/<tx>_<ty>.js; this classic script decodes them and streams tiles in by <script> injection, so it
   works from file:// and http alike. No dependencies. Globals MAP, MAPT. Map data © OpenStreetMap contributors, ODbL 1.0.

   GRID  integer metres, x east / y NORTH of the origin (广州塔 station, MAPLINES.origin). Tile "tx_ty" of LOD l covers
   [tx·S, ty·S]–[(tx+1)·S, (ty+1)·S]; coordinates are stored in quanta q:
     LOD0 street    S 1 km   q 1 m   renderer levels 2–5 m/px    tiles within 2 km of a line track
     LOD1 district  S 4 km   q 4 m   6.3–16 m/px                 tiles within 4 km
     LOD2 city      S 16 km  q 16 m  24–48 m/px                  tiles over the stations' bbox + 8 km (a line uses those within 8 km)
   TILE FILE  t<lod>/<tx>_<ty>.js = MAPT(lod,"tx_ty",{i:<id of the first feature>[,e:"<c45>"],<layer key>:"<c45>",…}), empty layers left
              out; e = how far the tile's features overhang its square (m: west, south, east, north ≥ 0; only buildings and chains
              can), left out when none do — the extent without decoding anything.
   Layers (key · MAP.query name · kind · class codes in order):
     w water     area   river lake sea (sea = natural=coastline assembled, land on the left)
     g green     area   park grass forest golf pitch wetland cemetery
     u landuse   area   residential commercial industrial construction education civic farm aquaculture railway plaza
     k bridges   area   (no class)
     v waterways line   river canal stream
     r roads     line   motorway trunk primary secondary tertiary residential service path
     l rail      line   rail siding tram
     b buildings bld    LOD0 only
     c chains    chain  motorway trunk primary secondary tertiary · LOD1 only, and in 1 m quanta (not 4 m: cars ride street-level roads)
   Content: LOD0 every layer but c — areas simplified 1.5 m / ≥ 40 m², buildings .5 m / ≥ 8 m², lines 2 m with every flag. LOD1 areas
   6 m / ≥ 1000 m² (bridges 4 m / ≥ 400 m²), lines 3 m: roads residential and up, waterways river + canal, rail; chains; no buildings.
   LOD2 water ≥ 0.5 ha at 12 m, green + landuse ≥ 2 ha at 16 m, roads motorway…secondary (no links) at 12 m, no rail (the city tier
   draws none; a district view reading LOD2 outside the LOD1 band goes without). LOD1/LOD2 lines leave out tunnels (never drawn) and
   o / n (drawn alike; merged again without them). Areas and lines are clipped exactly to the
   tile (outer rings CCW, holes CW, y north); a building is whole in the tile holding its bbox centre and may overhang it (clipped only
   when > 400 m and that tile is not in the set); a chain is whole in the tile holding its arc midpoint (chains > 4 km are split at
   vertices first).
   c45  a string over the 90 chars ASCII 35…125 minus the backslash (char → digit = its index). Each integer is zigzagged
   (v ≥ 0 → 2v, v < 0 → −2v − 1) and written base 45 little-endian: digits 45…89 carry 0…44 and continue, a digit 0…44 ends it.
   A layer = n, nRings, nPoints, then per feature
     area   H = cls·4 + x·2 + multi [, rings when multi] [, sid, scx, scy when x], then per ring: count, count × (dx, dy)
     bld    H = ((h·8 + lm)·2 + x)·2 + multi [, rings] [, sid, scx, scy], then the rings   lm 0 none · 1 cantonTower · 2 ifc · 3 ctf · 4 operaHouse · 5 haixinsha
     line   H = cls + C·(x | b<<1 | t<<2 | link<<3 | o<<4 | n<<6) [, sid], count, points   C = class count; o 0 two-way · 1 one-way along · 2 against
     chain  H = cls + 5·(o + 2·n), len, nt, nt × (s0 − previous s1, s1 − s0), count, points
   dx, dy: quanta from the previous point of the LAYER (the first from the tile corner): x = tx·S + q·Σdx. x = a piece of a feature split
   by the tile grid, set on LOD0 roads residential and up, LOD0/LOD1 landuse and buildings: sid = its source number (the same in every
   tile of that LOD; a namespace of its own, not an id), sc = the source's bbox centre (tile-local quanta) — key junctions / seed and
   orient lots per source (f.sid, f.sc) so nothing changes at a tile edge.
   Feature id = i + index of the feature in its tile over the layers in the order w g u k v r l b c: unique over a tile set, < 2^31.
   LINES  MAPLINES = {v, source, osm, origin, mPerDegLat, mPerDegLon, lod:[{S, q, band|pad}], have:[3 × c45: the tiles that exist per LOD,
   n then n × (dtx, dty), sorted by ty then tx], lines:{<id>:{len, src:"osm"|"curve", st, pts, loop?:1, close?}}, extra:[{key, branch?, pts}],
   lanes:[{zh, len, width, w, pts}], landmarks:[{id, zh, en, x, y, h?}]}. Polylines (pts, close, extra/lanes pts) are c45: n, then n × (dx, dy)
   metres from the previous point (the first from the origin); lanes w = n widths as running deltas. A track runs in js/data.js station
   order: st[i] = metres along pts of station i (strictly increasing, every station ≤ 60 m off); it ends 300 m past the end stations when
   OSM has it. A loop (Line 11): st[0] = 0 at data.js station 0, pts ends at the last station, close = the closing arc back to station 0.

   API
   MAP.LODS · MAP.BAND        [{S, q}] per LOD · the corridor band per LOD (m; LOD2: the pad a line uses)
   MAP.base                   folder of the tile set ('…/js/map/', from this script's src); set it before loading to read another set
   MAP.ver                    a string (e.g. the app version): tile URLs get ?v=<ver> over http(s), so a regenerated set is not mixed
                              with cached tiles (never from file://)
   MAP.loadFor(id, {order:'ride'|'near', near:[x, y], dir:+1|-1, views, onProgress(frac, done, total)}) → Promise {tiles, missing, ms}: resolves
                              when P0 is in, then keeps loading P1 (LOD0 + LOD1 up to 2 hops / 6 km ahead, LOD2 for hops > 8 km) and P2 (the
                              rest of the ride, then LOD2 from the terminus out). P0 = the tiles over views: [{lod, bbox:[x0, y0, x1, y1]} |
                              {lod, near:[x, y], r}] (the first frame's exact views, from the camera); default: LOD1 over the first hop's box
                              + max(1 km, ¼ of its size) and LOD0 within 1.5 km of the start (the budget, 160 KB gz, is checked on the views
                              js/px/ride.js asks for: tools/check-map.js).
                              A newer loadFor settles a pending one at once with {superseded: true}
   MAP.cancelPlan() → n       drop the still-queued tiles of the current loadFor (not those in flight, nor wants of another tag); a
                              pending promise settles at once with {superseded: true, cancelled: true}
   MAP.prioritise(x, y, ahead = 6000)  steer the queue by the train position (metres); queued tiles > 2 km behind are dropped (the
                              first frame's never: they keep their place)
   MAP.want(bbox, lod, {tag}?) · MAP.want(lod, key, {tag}?)  queue the tiles over a box / one tile before everything else (e.g. a recap
                              view) → number queued. Tagged (the menu's prefetch: 'menu'): after a ride's P0, before its P1; a loadFor
                              also moves every want queued before it behind its P0 (and takes over those of its own plan)
   MAP.cancel(tag) → n        drop the still-queued wants of that tag (not those in flight, nor tiles a plan or an untagged want asked for)
   MAP.has(lod, key) · MAP.status(lod, key) → 'queued'|'loading'|'ok'|'missing'|undefined — 4 script loads at a time, a failed tile is never retried
   MAP.query(bbox, lod, layer?) → {water, green, landuse, bridges, waterways, roads, rail, buildings, chains}: loaded features whose bbox meets
                              bbox ([x0, y0, x1, y1] or {x0, y0, x1, y1}, metres; layer: fill (and decode) only that list — a tile decodes
                              layer by layer, as queries ask); lod 0 also returns the LOD1 chains. Shapes as the mockup's data/l3.js
                              (areas {c, p}, bridges {p}, lines {c, pts, b?, t?, link?, o?, n?}, buildings {h, lm?, p}, chains {c, o, n?, len, tunnel, pts})
                              plus id and bb on every feature, sid (+ sc [x, y] on landuse / buildings) on tile-split pieces (see x above);
                              objects are cached per tile (identical until the tile is evicted)
   MAP.onLoad(fn) → off()     fn({lod, key, bbox}) for every tile that arrives (bbox = the tile's extent, overhanging features included)
   MAP.tiles(id, all) → [LOD0, LOD1, LOD2] lists of {key, tx, ty, s, d} (s = arc of the nearest track point, d = its distance to the tile centre);
                              all = also the planned tiles that hold no data
   MAP.plan(id, o) → {P0, P1, P2} lists of {lod, key}   MAP.line(id) → {id, pts, cum, len, st, src, loop, close, bb}   MAP.at(id, s) → [x, y]
   MAP.locate(id, x, y) → {s, d}   MAP.lanes() → [{zh, len, width, w, pts}]   MAP.others(exceptId) → [{key, pts, branch?}] (tracks + extra)
   MAP.decoded(lod, key, layers?) → the tile {lod, key, ext, …} when it is in and the layers asked for (names; default all) are decoded,
                              else null — never decodes (e.g. flat stand-ins drawn only from what is at hand)
   MAP.decode(lod, key, layers?) → the same tile once those layers are decoded (decoding them now; no feature objects), null when not in
   MAP.landmarks   MAP.c45.dec(str) → ints   MAP.stats()   MAP.clear()   MAP.tile(lod, key, full?) (the tile record, as it is; full: every
   layer decoded first) / MAP.bench() (tests)
   Memory: decoded layers and their feature objects (counted 176 B + 40 B a point) live in an LRU (per tile) of MAP.budget bytes (96 MB;
   24 MB when pointer:coarse or deviceMemory ≤ 4); the tiles farthest behind the train (MAP.prioritise) go first. Raw strings stay, so an
   evicted tile decodes again on its next query. */
(function(root){
'use strict';
const AL = []; for (let c = 35; c <= 125; c++) if (c !== 92) AL.push(c);
const DEC = new Uint8Array(128); AL.forEach((c, i) => { DEC[c] = i; });
const LODS = [{S: 1000, q: 1}, {S: 4000, q: 4}, {S: 16000, q: 16}], BAND = [2000, 4000, 8000], P0R = 1500;
const AREA = 0, BLD = 1, LINE = 2, CHAIN = 3;
const LAY = [['w', 'water', AREA, 'river lake sea'], ['g', 'green', AREA, 'park grass forest golf pitch wetland cemetery'],
  ['u', 'landuse', AREA, 'residential commercial industrial construction education civic farm aquaculture railway plaza'], ['k', 'bridges', AREA, ''],
  ['v', 'waterways', LINE, 'river canal stream'], ['r', 'roads', LINE, 'motorway trunk primary secondary tertiary residential service path'],
  ['l', 'rail', LINE, 'rail siding tram'], ['b', 'buildings', BLD, ''], ['c', 'chains', CHAIN, 'motorway trunk primary secondary tertiary']]
  .map(([k, name, kind, cls]) => ({k, name, kind, cls: cls ? cls.split(' ') : null}));
const LI = {}; LAY.forEach((l, i) => { LI[l.k] = i; });
const LM = ['', 'cantonTower', 'ifc', 'ctf', 'operaHouse', 'haixinsha'], CI = LI.c;
const qOf = (lod, li) => li === CI ? 1 : LODS[lod].q;

/* ---------- c45 ---------- */
function reader(s){
  let p = 0;
  const rd = () => { let c = DEC[s.charCodeAt(p++)], v = 0, m = 1; while (c >= 45){ v += (c - 45) * m; m *= 45; c = DEC[s.charCodeAt(p++)]; } v += c * m; return v % 2 ? -(v + 1) / 2 : v / 2; };
  rd.end = () => p >= s.length; rd.pos = () => p;
  return rd;
}
const decInts = s => { const rd = reader(s), o = []; while (!rd.end()) o.push(rd()); return o; };
const decPts = s => { if (!s) return null; const rd = reader(s), n = rd(), o = new Array(n); let x = 0, y = 0; for (let i = 0; i < n; i++){ x += rd(); y += rd(); o[i] = [x, y]; } return o; };
function encInts(a){ let o = ''; for (const v of a){ let z = v >= 0 ? v * 2 : -v * 2 - 1; while (z >= 45){ o += String.fromCharCode(AL[45 + z % 45]); z = Math.floor(z / 45); } o += String.fromCharCode(AL[z]); } return o; }
function decLayer(s, kind, ox, oy, q, C){
  const rd = reader(s), n = rd(), nr = rd(), np = rd(), ch = kind === CHAIN;
  const H = new Int32Array(n), FR = new Int32Array(n + 1), RP = new Int32Array(nr + 1), XY = new Int32Array(np * 2), BB = new Int32Array(n * 4);
  const LEN = ch ? new Int32Array(n) : null, TO = ch ? new Int32Array(n + 1) : null, TU = ch ? [] : null, SID = new Int32Array(n).fill(-1), SC = kind <= BLD ? new Int32Array(2 * n) : null;
  let x = 0, y = 0, r = 0, k = 0;
  for (let f = 0; f < n; f++){
    const h = H[f] = rd(); let rings = 1;
    if (kind <= BLD){ if (h % 2) rings = rd(); if (h >> 1 & 1){ SID[f] = rd(); SC[2 * f] = ox + rd() * q; SC[2 * f + 1] = oy + rd() * q; } }
    else if (kind === LINE && (h / C) % 2 >= 1) SID[f] = rd();
    if (ch){ LEN[f] = rd(); const nt = rd(); TO[f] = TU.length; let e = 0; for (let t = 0; t < nt; t++){ const a = e + rd(); e = a + rd(); TU.push(a, e); } }
    FR[f] = r; let x0 = 2e9, y0 = 2e9, x1 = -2e9, y1 = -2e9;
    for (let j = 0; j < rings; j++){
      const c = rd(); RP[r++] = k;
      for (let i = 0; i < c; i++){ x += rd(); y += rd(); const X = ox + x * q, Y = oy + y * q; XY[2 * k] = X; XY[2 * k + 1] = Y; k++;
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    }
    BB[4 * f] = x0; BB[4 * f + 1] = y0; BB[4 * f + 2] = x1; BB[4 * f + 3] = y1;
  }
  FR[n] = r; RP[nr] = k; if (ch) TO[n] = TU.length;
  if (r !== nr || k !== np || rd.pos() !== s.length) throw new Error('MAP: corrupt layer (' + [n, nr, np, r, k, rd.pos(), s.length] + ')');
  return {n, H, FR, RP, XY, BB, LEN, TO, TU: ch ? Int32Array.from(TU) : null, SID, SC};
}

/* ---------- tiles ---------- */
const MAP = {base: 'js/map/', budget: 96 << 20, LODS, BAND, LAYERS: LAY.map(l => ({key: l.k, name: l.name, kind: ['area', 'bld', 'line', 'chain'][l.kind], cls: l.cls})),
  LM, c45: {dec: decInts, enc: encInts, pts: decPts}};
try { const cs = root.document && root.document.currentScript; if (cs && cs.src) MAP.base = cs.src.replace(/[^/]*$/, ''); } catch (e){}
try { const coarse = typeof root.matchMedia === 'function' && root.matchMedia('(pointer:coarse)').matches, dm = root.navigator && root.navigator.deviceMemory;
  if (coarse || (dm && dm <= 4)) MAP.budget = 24 << 20; } catch (e){}
const TL = [new Map(), new Map(), new Map()], ST = new Map(), subs = new Set();
const ST_ = {mem: 0, decMs: 0, decodes: 0, evictions: 0, loads: 0, missing: 0};
let clock = 0, POS = null;
const tid = (lod, key) => lod + '/' + key;
const rectOf = (lod, tx, ty) => { const S = LODS[lod].S; return [tx * S, ty * S, tx * S + S, ty * S + S]; };
const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const firstInt = s => reader(s)();
root.MAPT = (lod, key, o) => {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key); if (!m || !LODS[lod]) return;
  const T = {lod, key, tx: +m[1], ty: +m[2], raw: o, base: o.i | 0, off: [], dec: null, objs: null, ext: null, bytes: 0, t: 0};
  let c = 0; for (let li = 0; li < LAY.length; li++){ T.off.push(c); if (o[LAY[li].k]) c += firstInt(o[LAY[li].k]); }
  const R = T.rect = rectOf(lod, T.tx, T.ty), e = o.e ? decInts(o.e) : null;
  T.n = c; T.ext = e ? [R[0] - e[0], R[1] - e[1], R[2] + e[2], R[3] + e[3]] : R.slice();
  const old = TL[lod].get(key); if (old && old.dec) ST_.mem -= old.bytes;
  TL[lod].set(key, T); ST.set(tid(lod, key), 'ok'); ST_.loads++;
  const ev = {lod, key, bbox: T.ext.slice()};
  for (const fn of subs) try { fn(ev); } catch (e){ if (root.console) console.error(e); }
};
const isDec = (T, li) => !T.raw[LAY[li].k] || !!T.dec && T.dec[li] !== undefined;
function layer(T, li, bb){                                                // layer li of T, decoded on first use (null: none; bb: a query's box)
  if (T.dec && T.dec[li] !== undefined) return T.dec[li];
  if (!T.dec){ T.dec = new Array(LAY.length); T.objs = new Array(LAY.length); T.bytes = 256; ST_.mem += 256; }
  const s = T.raw[LAY[li].k]; let L = null;
  if (s){ const t0 = now();
    try { L = decLayer(s, LAY[li].kind, T.rect[0], T.rect[1], qOf(T.lod, li), LAY[li].cls ? LAY[li].cls.length : 1); }
    catch (e){ if (root.console) console.error('MAP ' + tid(T.lod, T.key) + ' ' + LAY[li].k, e); }                // (a corrupt layer reads as empty)
    if (L){ const b = L.H.byteLength * 3 + (L.SC ? L.SC.byteLength : 0) + L.RP.byteLength + L.XY.byteLength + L.BB.byteLength + (L.TU ? L.TU.byteLength + L.LEN.byteLength * 2 : 0);
      T.bytes += b; ST_.mem += b; }
    ST_.decMs += now() - t0; ST_.decodes++; }
  T.dec[li] = L; T.objs[li] = L ? new Array(L.n) : null;
  if (s && ST_.mem > MAP.budget) evict(T, bb);                            // (its query's tiles stay)
  return L;
}
function full(T){ for (let li = 0; li < LAY.length; li++) layer(T, li); return T; }
function mat(T, li, f){
  const o = T.objs[li]; if (o[f]) return o[f];
  const L = T.dec[li], d = LAY[li], h = L.H[f], P = [];
  for (let r = L.FR[f]; r < L.FR[f + 1]; r++){ const a = L.RP[r], e = L.RP[r + 1], ring = new Array(e - a); for (let k = a; k < e; k++) ring[k - a] = [L.XY[2 * k], L.XY[2 * k + 1]]; P.push(ring); }
  let F;
  if (d.kind === AREA) F = d.cls ? {c: d.cls[h >> 2], p: P} : {p: P};
  else if (d.kind === BLD){ const t = h >> 2; F = {h: t >> 3}; if (t & 7) F.lm = LM[t & 7]; F.p = P; }
  else if (d.kind === LINE){ const C = d.cls.length, fl = Math.floor(h / C), oc = fl >> 4 & 3; F = {c: d.cls[h % C]};
    if (fl & 2) F.b = 1; if (fl & 4) F.t = 1; if (fl & 8) F.link = 1; if (oc) F.o = oc === 1 ? 1 : -1; if (fl >> 6) F.n = fl >> 6; F.pts = P[0]; }
  else { const t = Math.floor(h / 5), tn = []; F = {c: d.cls[h % 5], o: t & 1}; if (t >> 1) F.n = t >> 1; F.len = L.LEN[f];
    for (let i = L.TO[f]; i < L.TO[f + 1]; i += 2) tn.push([L.TU[i], L.TU[i + 1]]); F.tunnel = tn; F.pts = P[0]; }
  F.id = T.base + T.off[li] + f; F.bb = [L.BB[4 * f], L.BB[4 * f + 1], L.BB[4 * f + 2], L.BB[4 * f + 3]];
  if (L.SID[f] >= 0){ F.sid = L.SID[f]; if (L.SC) F.sc = [L.SC[2 * f], L.SC[2 * f + 1]]; }
  const B = 176 + (L.RP[L.FR[f + 1]] - L.RP[L.FR[f]]) * 40; T.bytes += B; ST_.mem += B;              // (Chrome heap per object, measured: ≥ real)
  return o[f] = F;
}
function evict(keep, bb){                                               // keep: the tile being decoded; bb: the box just queried
  const dir = PL ? PL.dir : 1, s = PL ? PL.s : 0, c = [];
  for (const M of TL) for (const T of M.values()) if (T.dec && T !== keep && !(bb && hit(T.ext, bb))){
    const R = T.rect, cx = (R[0] + R[2]) / 2, cy = (R[1] + R[3]) / 2, d = POS ? Math.hypot(cx - POS[0], cy - POS[1]) : 0;
    const e = PL && PL.at.get(tid(T.lod, T.key)), a = e ? (e.s - s) * dir : 0;
    if (POS && d < LODS[T.lod].S * .75 + 2500) continue;                 // around the train: in (or next to) the view
    c.push([(e && a < -1000 ? 1e9 - a : 0) + d + (clock - T.t) * 50, T]);
  }
  c.sort((a, b) => b[0] - a[0]);
  for (const [, T] of c){ if (ST_.mem <= MAP.budget * .85) break; ST_.mem -= T.bytes; T.dec = T.objs = null; T.bytes = 0; ST_.evictions++; }
}
const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

MAP.query = (bb, lod, ly) => {
  if (!Array.isArray(bb)) bb = [bb.x0, bb.y0, bb.x1, bb.y1];
  const out = {}, one = ly ? LAY.findIndex(l => l.name === ly) : -1; for (const l of LAY) out[l.name] = [];
  const scan = (T, only) => {
    if (!hit(T.ext, bb)) return; T.t = ++clock; const inR = hit(T.rect, bb);
    for (let li = 0; li < LAY.length; li++){
      if ((only >= 0 && li !== only) || !T.raw[LAY[li].k] || (!inR && LAY[li].kind !== BLD && li !== CI)) continue;   // (only buildings / chains overhang)
      const L = layer(T, li, bb); if (!L) continue;
      const B = L.BB, arr = out[LAY[li].name];
      for (let f = 0; f < L.n; f++) if (B[4 * f] <= bb[2] && B[4 * f + 2] >= bb[0] && B[4 * f + 1] <= bb[3] && B[4 * f + 3] >= bb[1]) arr.push(mat(T, li, f));
    }
  };
  for (const T of TL[lod].values()) scan(T, one);
  if (lod === 0 && (one < 0 || one === CI)) for (const T of TL[1].values()) scan(T, CI);
  if (ST_.mem > MAP.budget) evict(null, bb);
  return out;
};
MAP.has = (lod, key) => TL[lod].has(key);
MAP.status = (lod, key) => ST.get(tid(lod, key));
MAP.decoded = (lod, key, layers) => {
  const T = TL[lod] && TL[lod].get(key); if (!T) return null;
  const ls = layers == null ? LAY.map((l, i) => i) : [].concat(layers).map(n => LAY.findIndex(l => l.name === n || l.k === n));
  for (const li of ls) if (li >= 0 && !isDec(T, li)) return null;
  return T;
};
MAP.decode = (lod, key, layers) => {
  const T = TL[lod] && TL[lod].get(key); if (!T) return null; T.t = ++clock;
  for (const li of layers == null ? LAY.map((l, i) => i) : [].concat(layers).map(n => LAY.findIndex(l => l.name === n || l.k === n))) if (li >= 0 && !isDec(T, li)) layer(T, li, T.ext);
  return T;
};
MAP.onLoad = fn => { subs.add(fn); return () => subs.delete(fn); };
MAP.clear = () => { for (const M of TL) M.clear(); ST.clear(); Q.clear(); ST_.mem = 0; PL = null; POS = null; LN.clear(); TC.clear(); HV = null; waiters.length = 0; };
MAP.stats = () => { let dec = 0; for (const M of TL) for (const T of M.values()) if (T.dec) dec++;
  return Object.assign({tiles: TL.map(M => M.size), decoded: dec, budget: MAP.budget, queued: Q.size, loading: act}, ST_); };
MAP.tile = (lod, key, all) => { const T = TL[lod].get(key); return T && all ? full(T) : T; };      // debug / tests
MAP.bench = () => { let n = 0, mx = 0; const t0 = now();                  // re-decode every registered tile, all layers (timing)
  for (const M of TL) for (const T of M.values()){ const t = now(); if (T.dec) ST_.mem -= T.bytes; T.dec = T.objs = null; T.bytes = 0; full(T); n++; mx = Math.max(mx, now() - t); }
  return {tiles: n, ms: now() - t0, max: mx}; };

/* ---------- lines ---------- */
const ML = () => root.MAPLINES || null, LN = new Map(), TC = new Map(); let HV = null;
const cumOf = P => { const c = new Float64Array(P.length); for (let i = 1; i < P.length; i++) c[i] = c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return c; };
const bboxOf = P => { const b = [1e12, 1e12, -1e12, -1e12]; for (const p of P){ if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; } return b; };
MAP.line = id => {
  let L = LN.get(id); if (L) return L;
  const m = ML(), o = m && m.lines[id]; if (!o) throw new Error('MAP.line: no track for ' + id + (m ? '' : ' (js/map/lines.js not loaded)'));
  const pts = decPts(o.pts), close = decPts(o.close);
  L = {id, pts, cum: cumOf(pts), len: o.len, st: o.st.slice(), src: o.src, loop: !!o.loop, close, bb: bboxOf(close ? pts.concat(close) : pts)};
  LN.set(id, L); return L;
};
MAP.at = (id, s) => { const L = MAP.line(id), P = L.pts, C = L.cum; if (s <= 0) return P[0].slice(); if (s >= C[C.length - 1]) return P[P.length - 1].slice();
  let lo = 0, hi = C.length - 1; while (hi - lo > 1){ const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
  const t = (s - C[lo]) / (C[hi] - C[lo] || 1); return [P[lo][0] + t * (P[hi][0] - P[lo][0]), P[lo][1] + t * (P[hi][1] - P[lo][1])]; };
function segDist(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t]; }
MAP.locate = (id, x, y) => { const L = MAP.line(id), P = L.pts, C = L.cum; let bd = 1e18, bs = 0;
  for (let i = 1; i < P.length; i++){ const [d, t] = segDist([x, y], P[i - 1], P[i]); if (d < bd){ bd = d; bs = C[i - 1] + t * (C[i] - C[i - 1]); } } return {s: bs, d: bd}; };
const rectPtDist = (R, p) => Math.hypot(Math.max(R[0] - p[0], 0, p[0] - R[2]), Math.max(R[1] - p[1], 0, p[1] - R[3]));
function rectSegDist(R, a, b){                                           // 0 when segment ab meets rect R
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1]; let ok = true;
  for (const [p, q] of [[-dx, a[0] - R[0]], [dx, R[2] - a[0]], [-dy, a[1] - R[1]], [dy, R[3] - a[1]]]){
    if (p === 0){ if (q < 0){ ok = false; break; } continue; }
    const r = q / p; if (p < 0){ if (r > t1){ ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0){ ok = false; break; } if (r < t1) t1 = r; }
  }
  if (ok) return 0;
  return Math.min(rectPtDist(R, a), rectPtDist(R, b), segDist([R[0], R[1]], a, b)[0], segDist([R[2], R[1]], a, b)[0], segDist([R[0], R[3]], a, b)[0], segDist([R[2], R[3]], a, b)[0]);
}
function bandTiles(P, lod, band, s0, into){                              // tiles within band m of polyline P (arc s0 at P[0])
  const S = LODS[lod].S; let s = s0;
  for (let i = 1; i < P.length; i++){
    const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let tx = Math.floor((Math.min(a[0], b[0]) - band) / S); tx <= Math.floor((Math.max(a[0], b[0]) + band) / S); tx++)
      for (let ty = Math.floor((Math.min(a[1], b[1]) - band) / S); ty <= Math.floor((Math.max(a[1], b[1]) + band) / S); ty++){
        const R = [tx * S, ty * S, tx * S + S, ty * S + S]; if (rectSegDist(R, a, b) > band) continue;
        const k = tx + '_' + ty, [d, t] = segDist([tx * S + S / 2, ty * S + S / 2], a, b), e = into.get(k);
        if (!e) into.set(k, {key: k, tx, ty, s: s + t * l, d}); else if (d < e.d){ e.s = s + t * l; e.d = d; }
      }
    s += l;
  }
}
function have(lod){
  const m = ML(); if (!m || !m.have) return null;
  if (!HV) HV = m.have.map(h => { const a = decInts(h), o = new Set(); let x = 0, y = 0; for (let i = 1; i + 1 < a.length; i += 2){ x += a[i]; y += a[i + 1]; o.add(x + '_' + y); } return o; });
  return HV[lod];
}
MAP.tiles = (id, all) => {
  const ck = id + (all ? '*' : ''); let r = TC.get(ck); if (r) return r;
  const L = MAP.line(id), parts = [[L.pts, 0]].concat(L.close ? [[L.close, L.cum[L.cum.length - 1]]] : []);
  r = [0, 1, 2].map(lod => { const m = new Map(); for (const [P, s0] of parts) bandTiles(P, lod, BAND[lod], s0, m); return [...m.values()]; });
  for (const l of r) l.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  if (!all) r = r.map((l, lod) => { const h = have(lod); return h ? l.filter(t => h.has(t.key)) : l; });
  TC.set(ck, r); return r;
};
MAP.lanes = () => { const m = ML(); return m && m.lanes ? m.lanes.map(l => { const pts = decPts(l.pts), a = decInts(l.w), w = []; let v = 0; for (const d of a){ v += d; w.push(v); }
  return {zh: l.zh, len: l.len, width: l.width, w, pts}; }) : []; };
MAP.others = except => { const m = ML(), o = []; if (!m) return o;
  for (const id in m.lines) if (id !== except){ const L = MAP.line(id); o.push({key: id, pts: L.pts}); if (L.close) o.push({key: id, pts: L.close}); }
  for (const e of m.extra || []) o.push(Object.assign({key: e.key}, e.branch ? {branch: 1} : {}, {pts: decPts(e.pts)}));
  return o; };
Object.defineProperty(MAP, 'landmarks', {get: () => (ML() && ML().landmarks) || []});

/* ---------- loading: P0 (first frame) → P1 (ahead) → P2 (rest), 4 scripts at a time ---------- */
const Q = new Map(), waiters = [], TAGPR = 5000; let act = 0, PL = null, seq = 0;   // (TAGPR: after a P0 (< 100), before a P1 (≥ 8000))
function arcBox(L, a, b){ if (a > b){ const t = a; a = b; b = t; } const P = [MAP.at(L.id, a)]; for (let i = 0; i < L.pts.length; i++) if (L.cum[i] > a && L.cum[i] < b) P.push(L.pts[i]); P.push(MAP.at(L.id, b)); return bboxOf(P); }
MAP.plan = (id, o = {}) => {
  const L = MAP.line(id), T = MAP.tiles(id), dir = o.dir < 0 ? -1 : 1, st = L.st, n = st.length;
  const i0 = dir > 0 ? 0 : n - 1, i1 = Math.max(0, Math.min(n - 1, i0 + dir)), i2 = Math.max(0, Math.min(n - 1, i0 + 2 * dir));
  const p0 = o.near ? o.near.slice() : MAP.at(id, st[i0]), s0 = o.near ? MAP.locate(id, p0[0], p0[1]).s : st[i0];
  const hb = arcBox(L, s0, st[i1]), mg = Math.max(1000, .25 * Math.max(hb[2] - hb[0], hb[3] - hb[1]));
  const views = o.views || [{lod: 1, bbox: [hb[0] - mg, hb[1] - mg, hb[2] + mg, hb[3] + mg]}, {lod: 0, near: p0, r: P0R}];
  const inView = (lod, R) => views.some(v => v.lod === lod && (v.bbox ? hit(R, v.bbox) : rectPtDist(R, v.near) <= v.r));
  const term = MAP.at(id, st[dir > 0 ? n - 1 : 0]), long = [];
  for (let i = 0; i + 1 < n; i++) if (st[i + 1] - st[i] > 8000) long.push([st[i], st[i + 1]]);
  const pl = {id, dir, s: s0, ahead: Math.max(6000, Math.abs(st[i2] - s0)), p0, views, term, long, order: o.order === 'near' ? 'near' : 'ride', at: new Map()};
  const P0 = [], P1 = [], P2 = [], add = (lod, t) => {
    const R = rectOf(lod, t.tx, t.ty), e = {lod, key: t.key, s: t.s, c: [(R[0] + R[2]) / 2, (R[1] + R[3]) / 2]};
    e.p0 = inView(lod, R); e.pr = e.p0 ? Math.hypot(e.c[0] - p0[0], e.c[1] - p0[1]) / 1000 : rank(pl, e, s0);
    pl.at.set(tid(lod, t.key), e);
    if (e.pr !== null) (e.p0 ? P0 : e.pr < 1e6 ? P1 : P2).push({lod, key: t.key});
  };
  for (let lod = 0; lod < 3; lod++) for (const t of T[lod]) add(lod, t);
  for (const v of views) if (v.bbox){ const S = LODS[v.lod].S, h = have(v.lod);        // view tiles of other corridors
    for (let tx = Math.floor(v.bbox[0] / S); tx <= Math.floor(v.bbox[2] / S); tx++) for (let ty = Math.floor(v.bbox[1] / S); ty <= Math.floor(v.bbox[3] / S); ty++){
      const k = tx + '_' + ty; if (pl.at.has(tid(v.lod, k)) || (h && !h.has(k))) continue;
      add(v.lod, {key: k, tx, ty, s: MAP.locate(id, tx * S + S / 2, ty * S + S / 2).s}); } }
  pl.P0 = P0; pl.P1 = P1; pl.P2 = P2; return pl;
};
function rank(pl, e, s){                                                  // queue priority, lower first; null = drop (well behind)
  if (pl.order === 'near') return Math.hypot(e.c[0] - pl.p0[0], e.c[1] - pl.p0[1]);
  const a = (e.s - s) * pl.dir;
  if (a < -2000) return null;
  if (e.lod === 2) return a <= pl.ahead && pl.long.some(h => (e.s - h[0]) * (e.s - h[1]) <= 0) ? 1e4 + Math.max(0, a) : 2e6 + Math.hypot(e.c[0] - pl.term[0], e.c[1] - pl.term[1]);
  const b = e.lod === 1 ? 2000 : 0;
  return a <= pl.ahead ? 1e4 + Math.max(0, a) - b : 1e6 + a - b;
}
function pump(){
  while (act < 4 && Q.size){
    let best = null; for (const e of Q.values()) if (!best || e.pr < best.pr) best = e;
    Q.delete(best.id); inject(best);
  }
}
function inject(e){
  const doc = root.document; if (!doc){ ST.set(e.id, 'missing'); ST_.missing++; return; }
  act++; ST.set(e.id, 'loading');
  const s = doc.createElement('script'); s.async = true; s.src = MAP.base + 't' + e.lod + '/' + e.key + '.js' + verQ();
  const end = () => { s.onload = s.onerror = null; if (s.parentNode) s.parentNode.removeChild(s); act--;
    if (!TL[e.lod].has(e.key)){ ST.set(e.id, 'missing'); ST_.missing++; } check(); pump(); };
  s.onload = end; s.onerror = end; (doc.head || doc.documentElement).appendChild(s);
}
const verQ = () => { try { return MAP.ver != null && MAP.ver !== '' && /^https?:$/.test(root.location.protocol) ? '?v=' + encodeURIComponent(MAP.ver) : ''; } catch (e){ return ''; } };
function enqueue(lod, key, pr, plan, tag){ const id = tid(lod, key), st = ST.get(id); if (st === 'ok' || st === 'loading' || st === 'missing') return 0;
  const q = Q.get(id);
  if (q){ if (plan !== undefined && q.plan === undefined){ q.pr = pr; q.plan = plan; } else q.pr = Math.min(q.pr, pr);   // (a plan takes over a want)
    if (q.tag !== tag) q.tag = undefined; return 0; }
  Q.set(id, {id, lod, key, pr, plan, tag}); ST.set(id, 'queued'); return 1; }
function check(){
  for (let i = waiters.length - 1; i >= 0; i--){
    const w = waiters[i]; let done = 0, miss = 0;
    for (const id of w.ids){ const s = ST.get(id); if (s === 'ok') done++; else if (s === 'missing'){ done++; miss++; } }
    if (done !== w.last){ w.last = done; if (w.on) try { w.on(w.ids.length ? done / w.ids.length : 1, done, w.ids.length); } catch (e){} }
    if (done === w.ids.length){ waiters.splice(i, 1); w.res({tiles: done - miss, missing: miss, ms: Math.round(now() - w.t0)}); }
  }
}
MAP.loadFor = (id, o = {}) => new Promise((res, rej) => {
  let pl; try { pl = MAP.plan(id, o); } catch (e){ rej(e); return; }
  pl.seq = ++seq; PL = pl; POS = pl.p0;
  for (const [k, e] of Q) if (e.plan !== undefined){ Q.delete(k); ST.delete(k); } else e.pr = Math.max(e.pr, TAGPR);   // the previous ride's queue
  for (const w of waiters.splice(0)) w.res({tiles: 0, missing: 0, ms: Math.round(now() - w.t0), superseded: true});   // goes (its tiles may never
                                                                          // come: settle its promise); wants wait for this ride's P0
  for (const e of pl.at.values()) if (e.pr !== null) enqueue(e.lod, e.key, e.pr, pl.seq);
  waiters.push({ids: pl.P0.map(e => tid(e.lod, e.key)), res, on: o.onProgress, t0: now(), last: -1});
  pump(); check();
});
MAP.prioritise = (x, y, ahead = 6000) => {
  POS = [x, y]; if (!PL) return; const s = MAP.locate(PL.id, x, y).s; PL.s = s; PL.ahead = ahead;
  for (const [k, q] of Q){ if (q.plan !== PL.seq) continue; const e = PL.at.get(k); if (!e || e.p0) continue;   // (P0: a pending loadFor waits on it)
    const pr = rank(PL, e, s); if (pr === null){ Q.delete(k); ST.delete(k); } else q.pr = pr; }
  pump();
};
MAP.cancelPlan = () => { let n = 0; if (!PL) return 0;
  for (const [k, q] of Q) if (q.plan === PL.seq){ Q.delete(k); ST.delete(k); n++; }
  for (const w of waiters.splice(0)) w.res({tiles: 0, missing: 0, ms: Math.round(now() - w.t0), superseded: true, cancelled: true});
  return n; };
MAP.want = (bb, lod, o) => {
  let keys = [];
  if (typeof bb === 'number'){ keys = [lod]; lod = bb; if (!LODS[lod]) return 0; }   // (lod, key, o)
  else { if (!Array.isArray(bb)) bb = [bb.x0, bb.y0, bb.x1, bb.y1]; const S = LODS[lod].S;
    for (let tx = Math.floor(bb[0] / S); tx <= Math.floor(bb[2] / S); tx++) for (let ty = Math.floor(bb[1] / S); ty <= Math.floor(bb[3] / S); ty++) keys.push(tx + '_' + ty); }
  const h = have(lod), tag = o && o.tag != null ? String(o.tag) : undefined; let n = 0;
  for (const k of keys) if (!h || h.has(k)) n += enqueue(lod, k, tag ? TAGPR : -1, undefined, tag);
  pump(); return n;
};
MAP.cancel = tag => { let n = 0; if (tag == null) return 0; tag = String(tag);
  for (const [k, q] of Q) if (q.tag === tag){ Q.delete(k); ST.delete(k); n++; }
  return n; };
root.MAP = MAP;
})(typeof window !== 'undefined' ? window : globalThis);
