/* src.js — PX.src: where the pixel renderer (world.js, traffic.js) reads its map from. Two sources, one API. Needs pixel.js, geom.js;
   load it before world.js / traffic.js (and js/map/lines.js + map.js before the first PX.srcFor, for the tile source).
   PX.SRC.object(d, o)    a whole L3-style object (the mockup's data/l3.js: water, green, landuse, bridges, waterways, roads, rail,
                          buildings, chains, riverLanes, otherLines, landmarks, outer) in a 500 m grid index; every level reads all of it
   PX.SRC.tiles(M = MAP)  the tiled network (js/map/map.js + js/map/lines.js) through MAP.query, LOD chosen by render level:
                          ≤ 5 m/px (street) LOD0 — a 1 km cell whose LOD0 tile is not in reads LOD1, else LOD2, clipped to the cell;
                          6.3–16 (district) LOD1 ground (else LOD2, clipped) + the LOD0 buildings that are in (procedural lots elsewhere);
                          24–48 (city) LOD2 — a 16 km cell not in reads the LOD1 tiles that are. Nothing is ever left out for want of a tile.
   PX.srcFor(d)           the object source of d when d carries map layers (d.roads), else PX.src (made over MAP on first use; an
                          empty object source, not kept, while MAP / MAPLINES are not loaded)
   PX.src                 the current source (the facade may set it)
   Features keep data/l3.js's shapes (areas {c, p}, bridges {p}, lines {c, pts, b?, t?, link?, o?, n?}, buildings {h, lm?, p}, chains
   {c, o, n?, len, tunnel, pts}) plus a stable id (object: index in its layer; tiles: MAP's id), bb [x0, y0, x1, y1], lod (tiles) and on
   tile-split pieces sid (+ sc [x, y], the source's bbox centre). Every list comes sorted by id.
   s.kind                  'object' | 'tiles'
   s.seed(f)               the look seed of a feature (buildings, lots): object: its index (the mockup's look; o.seeds 'geo' → as tiles);
                           tiles: from its (source's) bbox centre — the same across tile-split pieces, LODs and data regenerations
   s.anchored              true (tiles, object with o.seeds 'geo'): world.js anchors road patterns (dashes, lamps, street trees, sleepers)
                           to the world grid instead of each way's own arc, and picks land use by class — so split pieces join seamlessly
   s.query(bb, lod, layer?) → {water, green, landuse, bridges, waterways, roads, rail, buildings, chains} meeting bb [x0, y0, x1, y1] (or one layer)
   s.level(bb, lvl)        the layers composed for render level lvl, + dep {mask}: bit l set = a LOD l tile arriving over bb changes the result
   s.structs(bb)           buildings meeting bb in the order the structure pass reads them (object: the mockup's 200 m cell order)
   s.each(layer, fn)       object: every feature (init-time scans) · tiles: no-op
   s.chains(bb?) · s.lanes() · s.others() (other tracks, bb set) · s.landmarks() · s.bounds() → [x0, y0, x1, y1]
   s.cellKey(lod, x, y) · s.cellRect(lod, key) · s.cell(lod, key) → 'ok' | 'wait' (exists, not in yet) | 'none'   (object: one cell 'all', 'ok')
   s.ready(x, y)           street / district data under (x, y) is in (a LOD0 or LOD1 tile) — traffic spawns only there
   s.complete(bb, lod)     no LOD tile over bb still to come
   s.want(bb, lod)         queue the tiles over bb first (MAP.want, tagged 'ride': RIDE.stop drops what is still queued) → count
   s.peek(bb, lod)         {water, green, landuse, roads} meeting bb from what is decoded already (world.js's flat stand-ins: never decodes a
                           tile; asks MAP.decoded(lod, key, those layers), else MAP.tile(lod, key).dec; an overhanging neighbour's extent from MAP.tile, else
                           its rect) — null while a LOD tile over bb is still to come or would need decoding (object: always the areas)
   s.prep(bb, lod)         decode (MAP.decode, no feature objects) what s.peek(bb, lod) reads of the tiles that are in → tiles decoded (world.js:
                           a flat stand-in whose peek failed, WORLD.hint over a zoom's target; object: 0)
   s.onChange(fn) → off    fn({lod, key, bbox}) after a tile arrived (the source's own caches are updated first) */
(function(){
const NAMES = ['water', 'green', 'landuse', 'bridges', 'waterways', 'roads', 'rail', 'buildings', 'chains'], AREAS = ['water', 'green', 'landuse', 'bridges', 'buildings'], PEEK = ['water', 'green', 'landuse', 'roads'];
const bboxOf = P => { let a = 1e12, b = 1e12, c = -1e12, d = -1e12; for (const p of P){ if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const byId = (a, b) => a.id - b.id;
const geoSeed = f => { const c = f.sc || [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2]; return Math.floor(GEOM.hash(Math.round(c[0]), Math.round(c[1]), 977) * 0x40000000); };   // (pack-map rounds sc the same way)
const NOOP = () => {}, RT = {tag: 'ride'};                                           // (MAP.want: RIDE.stop's MAP.cancel('ride') drops them)

/* ---------- object source ---------- */
function object(d, o = {}){
  const C = 500, IDX = {}, ck = (x, y) => (x + 32768) * 65536 + y + 32768;
  for (const n of NAMES){
    const A = d[n]; if (!A) continue;
    A.forEach((f, i) => { f.id = i; f.bb = AREAS.includes(n) ? bboxOf(f.p[0]) : bboxOf(f.pts); });
    const G = IDX[n] = {cells: new Map(), big: [], mark: new Uint32Array(A.length), st: 0, e: [1e9, 1e9, -1e9, -1e9]};
    A.forEach((f, i) => { const b = f.bb, x0 = Math.floor(b[0] / C), x1 = Math.floor(b[2] / C), y0 = Math.floor(b[1] / C), y1 = Math.floor(b[3] / C);
      if (x1 - x0 > 32 || y1 - y0 > 32){ G.big.push(i); return; }
      const e = G.e; if (x0 < e[0]) e[0] = x0; if (y0 < e[1]) e[1] = y0; if (x1 > e[2]) e[2] = x1; if (y1 > e[3]) e[3] = y1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){ const k = ck(x, y); let l = G.cells.get(k); if (!l) G.cells.set(k, l = []); l.push(i); } });
  }
  (d.otherLines || []).forEach((f, i) => { f.id = i; f.bb = bboxOf(f.pts); });
  const get = (n, bb) => {
    const G = IDX[n]; if (!G) return [];
    const A = d[n], st = ++G.st, out = [], add = i => { if (G.mark[i] === st) return; G.mark[i] = st; if (hit(A[i].bb, bb)) out.push(i); };
    const e = G.e, X1 = Math.min(e[2], Math.floor(bb[2] / C)), Y1 = Math.min(e[3], Math.floor(bb[3] / C));
    for (let y = Math.max(e[1], Math.floor(bb[1] / C)); y <= Y1; y++) for (let x = Math.max(e[0], Math.floor(bb[0] / C)); x <= X1; x++){ const l = G.cells.get(ck(x, y)); if (l) for (const i of l) add(i); }
    for (const i of G.big) add(i);
    out.sort((a, b) => a - b); return out.map(i => A[i]);
  };
  let BG = null;
  const s = {kind: 'object', d, seed: o.seeds === 'geo' ? geoSeed : f => f.id, anchored: o.seeds === 'geo',
    query: (bb, lod, layer) => { if (layer) return get(layer, bb); const o = {}; for (const n of NAMES) o[n] = get(n, bb); return o; },
    level: (bb, lvl) => { const o = {dep: {mask: 0}}; for (const n of NAMES) o[n] = n === 'chains' || (n === 'buildings' && lvl > 16) ? [] : get(n, bb); return o; },
    structs: bb => {                                           // the mockup's bldQuery order: 200 m cells row by row, each once
      const B = d.buildings || [], out = [], seen = new Set();
      if (!BG){ BG = new Map(); B.forEach((f, i) => { for (let gx = Math.floor(f.bb[0] / 200); gx <= Math.floor(f.bb[2] / 200); gx++) for (let gy = Math.floor(f.bb[1] / 200); gy <= Math.floor(f.bb[3] / 200); gy++){
        const k = gx + ',' + gy; let l = BG.get(k); if (!l) BG.set(k, l = []); l.push(i); } }); }
      for (let gy = Math.floor(bb[1] / 200); gy <= Math.floor(bb[3] / 200); gy++) for (let gx = Math.floor(bb[0] / 200); gx <= Math.floor(bb[2] / 200); gx++)
        for (const i of BG.get(gx + ',' + gy) || []){ if (seen.has(i)) continue; seen.add(i); if (hit(B[i].bb, bb)) out.push(B[i]); }
      return out; },
    each: (n, fn) => (d[n] || []).forEach(fn),
    chains: () => d.chains || [], lanes: () => d.riverLanes || [], others: () => d.otherLines || [], landmarks: () => d.landmarks || [],
    bounds: () => d.outer ? d.outer.slice() : [-5e4, -5e4, 5e4, 5e4],
    cellKey: () => 'all', cellRect: () => [-1e9, -1e9, 1e9, 1e9], cell: () => 'ok', ready: () => true, complete: () => true, want: () => 0,
    peek: bb => ({water: get('water', bb), green: get('green', bb), landuse: get('landuse', bb), roads: get('roads', bb)}), prep: () => 0,
    onChange: () => NOOP};
  return s;
}

/* ---------- geometry: clip to a rect (areas: Sutherland–Hodgman per ring; lines: Liang–Barsky, split into pieces) ---------- */
function clipRing(P, R){
  for (let e = 0; e < 4 && P.length; e++){
    const ins = p => e === 0 ? p[0] >= R[0] : e === 1 ? p[0] <= R[2] : e === 2 ? p[1] >= R[1] : p[1] <= R[3];
    const cut = (a, b) => { if (e < 2){ const x = R[e ? 2 : 0], t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + t * (b[1] - a[1])]; }
      const y = R[e === 2 ? 1 : 3], t = (y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y]; };
    const out = []; let s = P[P.length - 1];
    for (const p of P){ const pi = ins(p), si = ins(s); if (pi){ if (!si) out.push(cut(s, p)); out.push(p); } else if (si) out.push(cut(s, p)); s = p; }
    P = out;
  }
  return P;
}
function clipLine(P, R){
  const out = []; let cur = null;
  for (let i = 1; i < P.length; i++){
    const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1]; let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0] - R[0]], [dx, R[2] - a[0]], [-dy, a[1] - R[1]], [dy, R[3] - a[1]]]){
      if (p === 0){ if (q < 0){ ok = false; break; } continue; }
      const r = q / p; if (p < 0){ if (r > t1){ ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0){ ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok){ cur = null; continue; }
    if (!cur || t0 > 0){ cur = [t0 > 0 ? [a[0] + t0 * dx, a[1] + t0 * dy] : a]; out.push(cur); }
    cur.push(t1 < 1 ? [a[0] + t1 * dx, a[1] + t1 * dy] : b); if (t1 < 1) cur = null;
  }
  return out;
}

/* ---------- tile source ---------- */
function tiles(M){
  M = M || window.MAP; const ML = window.MAPLINES || {}, LODS = M.LODS;
  const have = (ML.have || []).map(h => { const a = M.c45.dec(h), o = new Set(); let x = 0, y = 0; for (let i = 1; i + 1 < a.length; i += 2){ x += a[i]; y += a[i + 1]; o.add(x + '_' + y); } return o; });
  const keyOf = (lod, x, y) => Math.floor(x / LODS[lod].S) + '_' + Math.floor(y / LODS[lod].S);
  const rectOf = (lod, key) => { const [tx, ty] = key.split('_').map(Number), S = LODS[lod].S; return [tx * S, ty * S, tx * S + S, ty * S + S]; };
  const cell = (lod, key) => { const st = M.status(lod, key); return st === 'ok' ? 'ok' : st === 'missing' || (have[lod] && !have[lod].has(key)) ? 'none' : 'wait'; };
  const CLIP = new Map(), RDY = new Map(); let BND = null, OTH = null, LANES = null;
  const query = (bb, lod, layer) => {
    const q = M.query(bb, lod, layer);                                  // (layer: MAP materialises only that list)
    for (const n of NAMES){ const a = q[n]; for (const f of a) if (f.lod === undefined) f.lod = n === 'chains' ? 1 : lod; if (a.length > 1) a.sort(byId); }
    return layer ? q[layer] : q;
  };
  /* LOD f features of tile pk clipped to the LOD P cell (tx, ty), cached per cell (sid / sc / id kept: seeds and lot angles follow the source) */
  const clipped = (f, pk, P, tx, ty) => {
    const ck = f + '/' + pk + '>' + P + '/' + tx + '_' + ty; let o = CLIP.get(ck); if (o){ CLIP.delete(ck); CLIP.set(ck, o); return o; }
    const S = LODS[P].S, R = [tx * S, ty * S, tx * S + S, ty * S + S], q = query(R, f); o = {};
    for (const n of NAMES){
      const out = o[n] = []; if (n === 'buildings' || n === 'chains') continue;
      for (const F of q[n]){
        if (F.p){ const p = []; for (const r of F.p){ const c = clipRing(r, R); if (c.length >= 3) p.push(c); } if (!p.length) continue;
          const g = Object.assign({}, F, {p, bb: bboxOf(p.flat()), lod: f}); if (!g.sc) g.sc = [(F.bb[0] + F.bb[2]) / 2, (F.bb[1] + F.bb[3]) / 2]; out.push(g); }
        else for (const pts of clipLine(F.pts, R)){ const g = Object.assign({}, F, {pts, bb: bboxOf(pts), lod: f}); delete g._rp; out.push(g); }
      }
    }
    CLIP.set(ck, o); if (CLIP.size > 160) CLIP.delete(CLIP.keys().next().value);
    return o;
  };
  const s = {kind: 'tiles', M, seed: geoSeed, anchored: true,
    query,
    level: (bb, lvl) => {
      const P = lvl <= 5 ? 0 : lvl <= 16 ? 1 : 2, q = query(bb, P), S = LODS[P].S, extra = []; let mask = 1 << P;
      if (P === 1){ q.buildings = query(bb, 0, 'buildings'); mask |= 1; }
      q.chains = [];
      for (let ty = Math.floor(bb[1] / S); ty <= Math.floor(bb[3] / S); ty++) for (let tx = Math.floor(bb[0] / S); tx <= Math.floor(bb[2] / S); tx++){
        if (cell(P, tx + '_' + ty) === 'ok') continue;
        if (P < 2){ for (let f = P + 1; f <= 2; f++){ mask |= 1 << f; const k = Math.floor(tx * S / LODS[f].S) + '_' + Math.floor(ty * S / LODS[f].S), c = cell(f, k);
          if (c === 'ok'){ extra.push(clipped(f, k, P, tx, ty)); break; }
          if (c === 'wait') M.want([(tx + .5) * S, (ty + .5) * S, (tx + .5) * S, (ty + .5) * S], f, RT); } }   // (a stand-in nobody asked for would never come)
        else { mask |= 2; const R = [tx * S, ty * S, tx * S + S, ty * S + S], q1 = query(R, 1), o = {};     // finer: the LOD1 tiles inside the cell
          for (const n of NAMES) o[n] = q1[n].filter(F => { const cx = (F.bb[0] + F.bb[2]) / 2, cy = (F.bb[1] + F.bb[3]) / 2; return cx >= R[0] && cx < R[2] && cy >= R[1] && cy < R[3]; });
          extra.push(o); }
      }
      if (extra.length) for (const n of NAMES){ if (n === 'chains') continue; let a = q[n], add = false;
        for (const o of extra) for (const F of o[n]) if (hit(F.bb, bb)){ a.push(F); add = true; }
        if (add) a.sort(byId); }
      q.dep = {mask}; return q;
    },
    structs: bb => query(bb, 0, 'buildings'),
    each: NOOP,
    chains: bb => query(bb || s.bounds(), 1, 'chains'),
    lanes: () => LANES || (LANES = M.lanes()),
    others: () => OTH || (OTH = M.others().map((f, i) => Object.assign(f, {id: i, bb: bboxOf(f.pts)}))),
    landmarks: () => M.landmarks,
    bounds: () => {
      if (BND) return BND.slice(); const h = have[2], S = LODS[2].S; let b = [1e12, 1e12, -1e12, -1e12];
      if (h && h.size) for (const k of h){ const [tx, ty] = k.split('_').map(Number); b = [Math.min(b[0], tx * S), Math.min(b[1], ty * S), Math.max(b[2], tx * S + S), Math.max(b[3], ty * S + S)]; }
      else for (const id in ML.lines || {}){ const l = M.line(id).bb; b = [Math.min(b[0], l[0] - 8000), Math.min(b[1], l[1] - 8000), Math.max(b[2], l[2] + 8000), Math.max(b[3], l[3] + 8000)]; }
      BND = b[0] < b[2] ? b : [-5e4, -5e4, 5e4, 5e4]; return BND.slice(); },
    cellKey: keyOf, cellRect: rectOf, cell,
    ready: (x, y) => { const k0 = keyOf(0, x, y); let r = RDY.get(k0); if (r === undefined){ r = cell(0, k0) === 'ok' || cell(1, keyOf(1, x, y)) === 'ok'; RDY.set(k0, r); } return r; },
    complete: (bb, lod) => { const S = LODS[lod].S;
      for (let ty = Math.floor(bb[1] / S); ty <= Math.floor(bb[3] / S); ty++) for (let tx = Math.floor(bb[0] / S); tx <= Math.floor(bb[2] / S); tx++) if (cell(lod, tx + '_' + ty) === 'wait') return false;
      return true; },
    want: (bb, lod) => M.want(bb, lod, RT),
    peek: (bb, lod) => { const dq = typeof M.decoded === 'function', tq = typeof M.tile === 'function'; if (!dq && !tq) return null;
      const S = LODS[lod].S, tx0 = Math.floor(bb[0] / S), tx1 = Math.floor(bb[2] / S), ty0 = Math.floor(bb[1] / S), ty1 = Math.floor(bb[3] / S);
      for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) for (let tx = tx0 - 1; tx <= tx1 + 1; tx++){ const k = tx + '_' + ty, core = ty >= ty0 && ty <= ty1 && tx >= tx0 && tx <= tx1;   // (± 1: overhanging features)
        if (M.status(lod, k) === 'ok'){ const t = tq ? M.tile(lod, k) : null; if (dq ? M.decoded(lod, k, PEEK) : t && t.dec) continue;
          if (core || hit(t && t.ext || rectOf(lod, k), bb)) return null; }
        else if (core && cell(lod, k) === 'wait') return null; }
      return {water: query(bb, lod, 'water'), green: query(bb, lod, 'green'), landuse: query(bb, lod, 'landuse'), roads: query(bb, lod, 'roads')}; },
    prep: (bb, lod) => { if (typeof M.decode !== 'function') return 0;
      const S = LODS[lod].S; let n = 0;
      for (let ty = Math.floor(bb[1] / S) - 1; ty <= Math.floor(bb[3] / S) + 1; ty++) for (let tx = Math.floor(bb[0] / S) - 1; tx <= Math.floor(bb[2] / S) + 1; tx++){ const k = tx + '_' + ty;
        if (M.status(lod, k) !== 'ok' || M.decoded(lod, k, PEEK)) continue; const t = M.tile(lod, k);
        if (hit(t && t.ext || rectOf(lod, k), bb)){ M.decode(lod, k, PEEK); n++; } }
      return n; },
    onChange: fn => M.onLoad(ev => fn(ev))};
  M.onLoad(ev => {                                              // (registered first: our caches are fresh before anyone rebakes)
    RDY.clear();
    if (ev.lod < 2) for (const k of [...CLIP.keys()]) if (k.slice(k.indexOf('>') + 1) === ev.lod + '/' + ev.key) CLIP.delete(k);
  });
  return s;
}

const objs = new WeakMap();
PX.SRC = {object, tiles, clipRing, clipLine};
PX.src = PX.src || null;
PX.srcFor = d => {
  if (d && d.roads){ let s = objs.get(d); if (!s) objs.set(d, s = object(d, {seeds: PX.srcSeeds})); return s; }
  return PX.src || (window.MAP && window.MAPLINES ? (PX.src = tiles(window.MAP)) : object(d || {}));
};
})();
