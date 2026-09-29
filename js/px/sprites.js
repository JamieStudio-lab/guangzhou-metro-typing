/* sprites.js — the art bible's sprites. Every sprite is a PX sprite def {id,w,h,rows,key,ax,ay}:
   rows are strings, key maps chars → PALETTE KEYS (never hexes), so one def serves both themes.
   Draw with SPR.put(g, spr, x, y) — it blits at the anchor (ax,ay): upright things anchor at their
   ground point, map symbols and vehicles at their centre.
   STYLE RULES (keep every new sprite on them):
   • Light comes from the TOP-LEFT of the screen, always (also for rotated cars: shading is screen-fixed).
   • 1px outline in the darkest step of the sprite's own ramp (ink for metal/UI, green.d0 for trees…).
   • 3–4 step ramps: hi on top/left faces, lo on bottom/right faces, never more than 5 steps.
   • Ground shadows fall to the bottom-right, 1px (flat/low things) or 2px (trees), in `shadow`.
   • Dither (Bayer, PX.bayer) only for glows and long gradients; no noise, no AA pixels.
   Procedural sprites are rasterised analytically per pixel (4×4 supersampled coverage → 50% threshold),
   so all 32 car headings come out clean. Exposes the global SPR.
   v2 (bottom of the file): the OBLIQUE 3/4 projection shared with world.js — top-view traffic & boats at 64 headings
   (SPR.veh / SPR.boat / SPR.wake), landmarks at any size (SPR.landmark), 3/4 trees (SPR.trees34), the reference rasteriser
   SPR.obl + SPR.facade, SPR.fade, SPR.prebake. (The v1 landmark art went in stage 1 r5: nothing called it.) */
(function(){
const SPR = {};
const TAU = Math.PI * 2, memo = new Map();
const cached = (k, f) => { let v = memo.get(k); if (!v){ v = f(); memo.set(k, v); } return v; };
const LIGHT = (() => { const l = [-0.62, -0.72, 0.9], n = Math.hypot(...l); return l.map(v => v / n); })();

/* key-grid: a w×h array of palette keys ('' = transparent) → PX sprite def */
const grid = (w, h) => ({w, h, a: new Array(w * h).fill(''),
  set(x, y, k){ if (x >= 0 && y >= 0 && x < w && y < h) this.a[y * w + x] = k; },
  get(x, y){ return x >= 0 && y >= 0 && x < w && y < h ? this.a[y * w + x] : ''; }});
const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@$%&*+=-~^';
function toSprite(id, g, ax = 0, ay = 0){
  const key = {}, ch = new Map(), rows = [];
  for (let y = 0; y < g.h; y++){
    let s = '';
    for (let x = 0; x < g.w; x++){
      const k = g.a[y * g.w + x]; if (!k){ s += '.'; continue; }
      let c = ch.get(k); if (!c){ c = CH[ch.size]; ch.set(k, c); key[c] = k; }
      s += c;
    }
    rows.push(s);
  }
  return {id, w: g.w, h: g.h, rows, key, ax, ay};
}
/* hand-authored def from strings */
const def = (id, rows, key, ax = 0, ay = 0) => ({id, w: rows[0].length, h: rows.length, rows, key, ax, ay});
/* supersampled coverage mask (inside(x,y) on continuous coords) */
function cover(w, h, inside, ss = 4){
  const m = new Uint8Array(w * h), half = ss * ss / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let n = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) if (inside(x + (i + .5) / ss, y + (j + .5) / ss)) n++;
    m[y * w + x] = n >= half ? 1 : 0;
  }
  return m;
}
/* drop shadow to the bottom-right: pixels outside m whose up-left neighbour is in m, or whose left AND top
   neighbours both are (so thin diagonals get a continuous 1px shadow, not dots); len 2 adds the (x-2,y-2) step */
function dropShadow(g, m, len = 1){
  const M = (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && m[y * g.w + x];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++){
    if (m[y * g.w + x] || g.get(x, y)) continue;
    if (M(x - 1, y - 1) || (M(x - 1, y) && M(x, y - 1)) || (len > 1 && M(x - 2, y - 2))) g.set(x, y, 'shadow');
  }
}
const shade = (nx, ny, nz) => { const n = Math.hypot(nx, ny, nz) || 1; return (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / n; };
const pick = (ramp, t) => ramp[Math.max(0, Math.min(ramp.length - 1, t | 0))];

SPR.put = (g, spr, x, y, opts) => spr.c ? g.drawImage(spr.c, Math.round(x) - spr.ax, Math.round(y) - spr.ay)   // v2 baked sprite
  : PX.blit(g, spr, Math.round(x) - (spr.ax || 0), Math.round(y) - (spr.ay || 0), opts);

/* =====================================================================================
   METRO CAR — SPR.car(i, lineKey = PX.lk(), part): heading i of 32 (0 = east, 8 = south, 16 = west,
   24 = north; clockwise on screen). part: 'head' (cab leading, headlights), 'mid', 'tail'
   (cab trailing, red tail lights). 17×7 art px when horizontal, in a 21×21 box, anchor = centre.
   Cars of one train sit 18 px apart (centre to centre) along the track.
   ===================================================================================== */
SPR.CAR_N = 32; SPR.CAR_LEN = 17; SPR.CAR_PITCH = 18;
SPR.carPitch = step => step === 3 ? 18 : 10;           // Z2 uses the small 9×5 car (same generator), 10 px apart
SPR.heading = (dx, dy) => ((Math.round(Math.atan2(dy, dx) / TAU * 32) % 32) + 32) % 32;
SPR.car = (i, lineKey = PX.lk(), part = 'mid', small = false) => cached(['car', i, lineKey, part, small].join('|'), () => {
  /* "sheared raster": along the major axis every column (or row) of the car is the same stack of n pixels,
     offset by the rounded centreline — so outline, stripe and roof bands are exact parallel pixel lines
     with one shared step pattern (how a pixel artist draws a rotated box). Ends are cut perpendicular. */
  const S = small ? 13 : 21, c = S >> 1, th = ((i % 32) + 32) % 32 * TAU / 32, ca = Math.cos(th), sa = Math.sin(th);
  const shallow = Math.abs(ca) >= Math.abs(sa) - 1e-9, maj = shallow ? Math.abs(ca) : Math.abs(sa);
  const slope = shallow ? sa / ca : ca / sa, n = Math.round((small ? 5 : 7) / maj), w0 = -(n >> 1), Lh = small ? 4.5 : 8.5;
  const cab = part === 'head' ? 1 : part === 'tail' ? -1 : 0, g = grid(S, S), M = new Uint8Array(S * S);
  /* screen-fixed roof ramp across the car's width: the lit long side (top-left light) gets car.top, then hi,
     mid, and the far side car.lo — the same 4 steps at every heading (ties go to the upper screen side) */
  const dot = -sa * LIGHT[0] + ca * LIGHT[1], vDir = shallow ? Math.sign(ca) : Math.sign(-sa);
  const litHigh = Math.abs(dot) < .15 ? false : (dot > 0) === (vDir > 0), nr = n - 4;
  const info = (x, y) => {
    const A = shallow ? x : y, B = shallow ? y : x, w = B - (c + Math.round((A - c) * slope)) - w0;
    const u = (x - c) * ca + (y - c) * sa;
    if (w < 0 || w >= n || Math.abs(u) > Lh) return null;
    return {w, u, k: Math.floor((Lh - Math.abs(u)) / maj + 1e-6)};       // k = pixel steps to the car's end
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const p = info(x, y); if (!p) continue;
    const {w, u, k} = p, side = w === 0 || w === n - 1, band = w === 1 || w === n - 2, front = cab && u * cab > 0;
    if (side && k === 0) continue;                                        // rounded corners
    if (front && band && k === 0) continue;                               // rounder cab nose
    M[y * S + x] = 1;
    const j = litHigh ? n - 3 - w : w - 2;                                // roof row, 0 = lit edge
    let key;
    if (side || k === 0 || (front && band && k === 1)) key = 'car.d0';
    else if (band) key = lineKey;
    else if (k === 1) key = front && (w === 2 || w === n - 3) ? (cab > 0 ? 'car.lamp' : 'car.tail') : 'car.lo';
    else if (front && k <= (small ? 2 : 3)) key = k === 2 && j <= 1 ? 'car.glassHi' : 'car.glass';  // windscreen
    else if (!small && w === n >> 1 && Math.abs(u) > 2 && Math.abs(u) < 5.5) key = 'car.vent';    // roof AC units
    else key = j === 0 ? 'car.top' : j === nr - 1 ? 'car.lo' : j === 1 ? 'car.hi' : 'car.mid';
    g.set(x, y, key);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)                  // the stripe never touches the outside: ink it there
    if (g.get(x, y) === lineKey && (!g.get(x - 1, y) || !g.get(x + 1, y) || !g.get(x, y - 1) || !g.get(x, y + 1))) g.set(x, y, 'car.d0');
  dropShadow(g, M, 1);
  return toSprite('car' + i + part + lineKey + (small ? 's' : ''), g, c, c);
});
/* the car's body silhouette grown by 1px, in the line's casing colour (drawn under the day train so the white cars
   never read as one more pale road) */
SPR.carHalo = (i, small = false, id = PX.lineId) => cached(['halo', i, small, id].join('|'), () => {
  const c = SPR.car(i, PX.lk('line', id), 'mid', small), m = new Uint8Array(c.w * c.h), g = grid(c.w, c.h);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++){ const ch = c.rows[y][x]; if (ch !== '.' && c.key[ch] !== 'shadow') m[y * c.w + x] = 1; }
  const gm = PX.maskGrow(m, c.w, c.h, 1);
  for (let k = 0; k < gm.length; k++) if (gm[k]) g.a[k] = PX.lk('case', id);
  return toSprite('halo' + i + (small ? 's' : '') + id, g, c.ax, c.ay);
});
/* platform slabs either side of the track at a station (Z3), same heading convention */
SPR.platform = i => cached('plat|' + i, () => {
  const S = 31, c = S / 2, th = i * TAU / 32, ca = Math.cos(th), sa = Math.sin(th);
  const loc = (x, y) => { const dx = x - c, dy = y - c; return [dx * ca + dy * sa, -dx * sa + dy * ca]; };
  const M = cover(S, S, (x, y) => { const [u, v] = loc(x, y); return Math.abs(u) < 13 && Math.abs(v) > 4.5 && Math.abs(v) < 8; });
  const E = PX.maskEdge(M, S, S), g = grid(S, S);
  for (let k = 0; k < M.length; k++) if (M[k]){
    const x = k % S, y = (k / S) | 0, [, v] = loc(x + .5, y + .5);
    g.set(x, y, E[k] ? 'ink' : shade(Math.sign(v) * -sa * .6, Math.sign(v) * ca * .6, 1) > .6 ? 'stn.plat' : 'stn.platLo');
  }
  dropShadow(g, M, 1);
  return toSprite('plat' + i, g, 15, 15);
});

/* =====================================================================================
   STATION MARKERS — metro-map symbols, anchor = centre.
   SPR.stn.normal / .inter / .done / .doneInter, SPR.stnNext(frame 0–3, big, line id = PX.lineId)
   ===================================================================================== */
const inDisc = (x, y, r) => x * x + y * y <= r * r + r * .8;     // same disc as PX.disc
function marker(id, r, paint, box){
  box = box || r * 2 + 3; const c = box >> 1, g = grid(box, box), m = new Uint8Array(box * box);
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) if (inDisc(x - c, y - c, r)) m[y * box + x] = 1;
  const e = PX.maskEdge(m, box, box);
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++){
    const k = y * box + x; if (!m[k]) continue;
    const dx = x - c, dy = y - c, lo = !e[k] && (!m[k + box + 1] || e[k + box + 1] || e[k + 1] && e[k + box]);
    g.set(x, y, paint(dx, dy, e[k], lo, Math.hypot(dx, dy)));
  }
  dropShadow(g, m, 1);
  return toSprite(id, g, c, c);
}
SPR.stn = {
  normal: marker('stnN', 3, (dx, dy, e, lo) => e ? 'stn.ring' : lo ? 'stn.lo' : 'stn.fill'),
  inter: marker('stnI', 5, (dx, dy, e, lo, d) => e || (d > 3.6 && d < 4.6) ? 'stn.ring' : d >= 4.6 ? 'stn.ring' : lo ? 'stn.lo' : 'stn.fill'),
  done: marker('stnD', 3, (dx, dy, e, lo) => e ? 'stn.doneRing' : ((dx === -1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 1 && dy === 0) || (dx === 2 && dy === -1)) ? 'stn.fill' : lo ? 'stn.doneLo' : 'stn.done'),
  doneInter: marker('stnDI', 5, (dx, dy, e, lo, d) => e || d > 3.6 ? 'stn.doneRing' : ((dx === -2 && dy === 0) || (dx === -1 && dy === 1) || (dx === 0 && dy === 0) || (dx === 1 && dy === -1) || (dx === 2 && dy === -2)) ? 'stn.fill' : lo ? 'stn.doneLo' : 'stn.done'),
};
/* next station: line-colour disc with white core + a pulse ring (frames 0–3 grow and dissolve) */
SPR.stnNext = (f = 0, big = false, id = PX.lineId) => cached(['next', f, big, id].join('|'), () => {
  const lineKey = PX.lk('disp', id), hiKey = PX.lk('hi', id), loKey = PX.lk('lo', id);
  const r = big ? 5 : 3, base = marker('tmp', r, (dx, dy, e, lo, d) => e ? 'stn.ring' : d < (big ? 2.3 : 1.5) ? 'stn.fill' : lo ? loKey : lineKey, 21);
  const g = grid(21, 21), c = 10;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++){ const ch = base.rows[y][x]; if (ch !== '.') g.set(x, y, base.key[ch]); }
  const R = r + 2 + f, dens = [1, 1, .5, .25][f & 3];
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++){
    const dx = x - c, dy = y - c; if (g.get(x, y) || !inDisc(dx, dy, R) || inDisc(dx, dy, R - 1)) continue;
    if (dens >= 1 || PX.bayer(x, y) < dens) g.set(x, y, f < 2 ? hiKey : lineKey);
  }
  return toSprite('stnNext' + f + id + big, g, c, c);
});

/* =====================================================================================
   TREES & BUSHES — top-down canopies built from lit spheres (clumps), crease lines between clumps,
   outline green.d0, ground shadow 2px (trees) / 1px (bushes). SPR.trees[0..3], SPR.bushes[0..1].
   ===================================================================================== */
function canopy(id, w, h, clumps, sh){
  const W = w + sh + 1, H = h + sh + 1, g = grid(W, H), m = new Uint8Array(W * H), owner = new Int8Array(W * H).fill(-1), z = new Float32Array(W * H).fill(-9);
  const ramp = ['green.d1', 'green.d2', 'green.d3', 'green.d4', 'green.hi'];
  clumps.forEach(([cx, cy, r, lift = 0], ci) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const dx = x + .5 - cx, dy = y + .5 - cy, d2 = dx * dx + dy * dy; if (d2 > r * r) continue;
      const nz = Math.sqrt(r * r - d2), k = y * W + x, zz = nz + lift;
      m[k] = 1; if (zz <= z[k]) continue; z[k] = zz; owner[k] = ci;
      const b = shade(dx, dy, nz);
      g.a[k] = pick(ramp, b < .05 ? 0 : b < .45 ? 1 : b < .75 ? 2 : b < .92 ? 3 : 4);
    }
  });
  const e = PX.maskEdge(m, W, H);
  for (let k = 0; k < m.length; k++){
    if (!m[k]) continue;
    if (e[k]){ g.a[k] = 'green.d0'; continue; }
    const x = k % W, y = (k / W) | 0;                  // crease: a lower clump meets a higher one to its top-left
    for (const [ox, oy] of [[-1, 0], [0, -1]]){ const j = (y + oy) * W + x + ox; if (owner[j] >= 0 && owner[j] !== owner[k] && z[j] > z[k] + .5){ g.a[k] = 'green.d1'; break; } }
  }
  dropShadow(g, m, sh);
  return toSprite(id, g, Math.round(w / 2), Math.round(h / 2));
}
function palm(){
  // top-down fan palm: 6 drooping fronds (2px at the base, tapering), lit by direction, midrib highlight
  const W = 12, H = 12, c = 5, g = grid(W, H), m = new Uint8Array(W * H);
  for (let f = 0; f < 6; f++){
    const a = f / 6 * TAU + .45, dx = Math.cos(a), dy = Math.sin(a), bend = .35;
    const fm = PX.mask(W, H, gg => { gg.beginPath(); gg.moveTo(c + .5, c + .5);
      gg.quadraticCurveTo(c + .5 + dx * 3 - dy * bend * 2, c + .5 + dy * 3 + dx * bend * 2, c + .5 + dx * 5.2 - dy * bend * 1.2, c + .5 + dy * 5.2 + dx * bend * 1.2);
      gg.lineWidth = 2.1; gg.lineCap = 'round'; gg.stroke(); });
    const b = shade(dx, dy, .9);
    for (let k = 0; k < fm.length; k++) if (fm[k] && !m[k]){
      const x = k % W, y = (k / W) | 0, d = Math.hypot(x - c, y - c);
      m[k] = 1; g.a[k] = b > .6 ? (d < 3 ? 'green.hi' : 'green.d4') : b > .2 ? (d < 3 ? 'green.d4' : 'green.d3') : (d < 3 ? 'green.d3' : 'green.d2');
    }
  }
  g.set(c, c, 'green.d1');
  const e = PX.maskEdge(m, W, H);
  for (let k = 0; k < m.length; k++) if (e[k]) g.a[k] = 'green.d0';
  dropShadow(g, m, 2);
  return toSprite('palm', g, c, c);
}
SPR.trees = [
  canopy('tree0', 5, 5, [[2.5, 2.5, 2.6]], 2),
  canopy('tree1', 7, 7, [[3.5, 3.5, 3.6]], 2),
  canopy('tree2', 9, 8, [[3.3, 4.4, 3.2], [5.9, 4.6, 3], [4.6, 2.9, 2.9, .6]], 2),
  palm(),
];
SPR.streetTree = canopy('streetTree', 4, 4, [[2, 2.1, 2.15]], 1);   // banyan-lined avenues: a small round canopy
SPR.bushes = [
  canopy('bush0', 4, 3, [[1.5, 1.6, 1.6], [2.7, 1.6, 1.5]], 1),
  canopy('bush1', 6, 4, [[1.6, 2.2, 1.7], [3.1, 1.8, 1.8, .3], [4.5, 2.3, 1.6]], 1),
];

/* =====================================================================================
   STREET FURNITURE — lamp (upright, anchor = foot), SPR.glow(r) dithered light pool (night only;
   empty in day), SPR.boat / cruise / liner(dir) 'e'|'s'|'w'|'n', SPR.veh(type, dir) type 'car'|'bus'.
   ===================================================================================== */
SPR.lamp = def('lamp', [
  '.ooo.',
  'oLLLo',
  '.oPo.',
  '..P..',
  '..P..',
  '..P..',
  '.oPs.',
  '..ss.',
], {o: 'ink', L: 'lamp.head', P: 'lamp.pole', s: 'shadow'}, 2, 6);
SPR.glow = (r = 7) => cached('glow|' + r + PX.theme, () => {
  // warm light pool: solid core → ordered-dither to the mid tone → dither out to transparent
  const S = r * 2 + 1, g = grid(S, S);
  if (PX.theme === 'night') for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const d = Math.hypot(x - r, (y - r) * 1.2) / (r + .5); if (d > 1) continue;
    const t = 1 - d, b = PX.bayer(x, y);
    if (t > .78) g.set(x, y, 'lamp.glow3');
    else if (t > .62) g.set(x, y, b < (t - .62) / .16 ? 'lamp.glow3' : 'lamp.glow2');
    else if (t > .4) g.set(x, y, b < (t - .4) / .22 ? 'lamp.glow2' : 'lamp.glow1');
    else if (b < t / .4) g.set(x, y, 'lamp.glow1');
  }
  return toSprite('glow' + r + PX.theme, g, r, r);
});
/* boat & vehicles are authored heading east WITHOUT a shadow; the other headings are exact transposes/flips of the
   silhouette, and the 1px shadow is added after orienting (same rule as dropShadow), so it always falls
   bottom-right whatever the heading — no redraw, no rotation artefacts */
function orient(id, spr, dir, shadow = true){
  const {w, h, rows} = spr; let out = rows;
  if (dir === 'w') out = rows.map(r => [...r].reverse().join(''));
  if (dir === 's' || dir === 'n'){
    out = []; for (let x = 0; x < w; x++){ let s = ''; for (let y = 0; y < h; y++) s += rows[y][x]; out.push(s); }
    if (dir === 'n') out.reverse();
  }
  const vert = dir === 's' || dir === 'n', W = vert ? h : w, H = vert ? w : h;
  const o = {id: id + dir, w: W, h: H, rows: out, key: spr.key, ax: vert ? spr.ay : dir === 'w' ? w - 1 - spr.ax : spr.ax, ay: vert ? (dir === 'n' ? w - 1 - spr.ax : spr.ax) : spr.ay};
  if (!shadow) return o;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && out[y][x] !== '.';
  o.rows = []; o.w = W + 1; o.h = H + 1; o.key = {...spr.key, '%': 'shadow'};
  for (let y = 0; y <= H; y++){ let s = ''; for (let x = 0; x <= W; x++) s += solid(x, y) ? out[y][x] : solid(x - 1, y - 1) || (solid(x - 1, y) && solid(x, y - 1)) ? '%' : '.'; o.rows.push(s); }
  return o;
}
const BOAT = def('boat', [
  '..ooooooooo....',
  '.oHHHHHHHHHoo..',
  'oHcCcCcCcCHHHo.',
  'oHCyCyCyCyCHDHo',
  'oLcCcCcCcCLLLo.',
  '.oLLLLLLLLLoo..',
  '..ooooooooo....',
], {o: 'ink', H: 'boat.hull', L: 'boat.hullLo', c: 'boat.cabin', C: 'boat.deck', y: 'boat.light', D: 'boat.deck'}, 7, 3);
SPR.boat = (dir = 'e') => cached('boat|' + dir, () => orient('boat', BOAT, dir));
const CRUISE = def('cruise', [
  '...oooooooooooooooooooo.....',
  '..oMmMmMmMmMmMmMmMmMmMmoo...',
  '.oHcCcCcCcCcCcCcCcCcCcHHHo..',
  'oHHCyCyCyCyCyCyCyCyCyCCHHHo.',
  'oLLcCcCcCcCcCcCcCcCcCcLLLLLo',
  '.oLLLLLLLLLLLLLLLLLLLLLLLLo.',
  '..oooooooooooooooooooooooo..'], {o: 'ink', H: 'boat.hull', L: 'boat.hullLo', c: 'boat.cabin', C: 'boat.deck', y: 'boat.light', M: 'tower.d4', m: 'tower.hi'}, 13, 3);
/* lit river cruise boat (28 px): amber deck windows, a magenta light string along the rail. 'e' | 'w' */
SPR.cruise = (dir = 'e') => cached('cruise|' + dir, () => orient('cruise', CRUISE, dir));
/* double-deck LED cruiser (40 px): two window decks, two light strings (M/m: remap them for the string colour) */
const LINER = def('liner', [
  '.......ooooooooooooooooooooooooo........',
  '......oMmMmMmMmMmMmMmMmMmMmMmMmMo.......',
  '......oCyCyCyCyCyCyCyCyCyCyCyCyCo.......',
  '...oooocccccccccccccccccccccccccoooo....',
  '..oMmMmMmMmMmMmMmMmMmMmMmMmMmMmMmMmMoo..',
  '.oHCyCyCyCyCyCyCyCyCyCyCyCyCyCyCyCyCHHo.',
  'oHHcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcHHHo',
  'oLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLo',
  '.oLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLo.',
  '..oooooooooooooooooooooooooooooooooooo..'], {o: 'ink', H: 'boat.hull', L: 'boat.hullLo', c: 'boat.cabin', C: 'boat.deck', y: 'boat.light', M: 'tower.d4', m: 'tower.hi'}, 19, 5);
SPR.liner = (dir = 'e') => cached('liner|' + dir, () => orient('liner', LINER, dir));
const VEH = {
  car: def('vcar', [
    '.oooooo.',
    'oAAgAAAo',
    'oaAgAAHo',
    '.oooooo.',
  ], {o: 'ink', A: 'veh.a', a: 'veh.aLo', g: 'veh.glass', H: 'veh.head'}, 4, 2),
  bus: def('vbus', [
    '.oooooooooooo.',
    'oTBBBBBBBBBBgo',
    'oBbBbBbBbBbBgH',
    'obbbbbbbbbbbgo',
    '.oooooooooooo.',
  ], {o: 'ink', B: 'veh.bus', b: 'veh.busLo', T: 'veh.tail', g: 'veh.glass', H: 'veh.head'}, 7, 2),
};
SPR.veh = (type = 'car', dir = 'e') => cached('veh|' + type + dir, () => orient(VEH[type].id, VEH[type], dir));
/* bridge deck tile (8×8, repeat along x; road with parapets) */
SPR.bridgeTile = def('bridge', [
  'oooooooo',
  'PPPPPPPP',
  'pppppppp',
  'rrrrrrrr',
  'rrmm.rrr'.replace('.', 'r'),
  'rrrrrrrr',
  'pppppppp',
  'oooooooo',
], {o: 'ink', P: 'block.d4', p: 'block.d2', r: 'road.major', m: 'road.mark'});

/* =====================================================================================
   UI ICONS (7–9 px, flat like the pixel font: main = text, d = textDim, a = ui.accent). SPR.icon.*
   ===================================================================================== */
const IK = {i: 'text', d: 'textDim', a: 'ui.accent', A: 'ui.accentLo'};
SPR.icon = {
  clock: def('icClock', [
    '..iiiii..',
    '.id...di.',
    'id..a..di',
    'i...a...i',
    'i...aaa.i',
    'i.......i',
    'id.....di',
    '.id...di.',
    '..iiiii..'], IK, 4, 4),
  distance: def('icDist', [
    '......aa.',
    '.....aaaa',
    '.....aiaa',
    '.....aaaa',
    '......aa.',
    '..d.d.a..',
    '.d.......',
    'ii.......',
    'ii.......'], IK, 4, 4),
  speed: def('icSpeed', [
    '..iiiii..',
    '.id...di.',
    'id.....ai',
    'i.....a.i',
    'i....a..i',
    'i...i...i',
    '.d.iii.d.'], IK, 4, 3),
  keyboard: def('icKey', [
    'ddddddddd',
    'didididid',
    'ddidididd',
    'didaaadid',
    'ddddddddd'], IK, 4, 2),
  flame: [
    def('icFire1', [
      '...b...',
      '..bb...',
      '..bab..',
      '.babb..',
      '.bacab.',
      '.bacab.',
      '..bbb..'], {a: 'fire.t1', b: 'fire.lo', c: 'fire.core'}, 3, 3),
    def('icFire2', [
      '...a...',
      '...aa..',
      '..aba..',
      '.abbaa.',
      '.abcba.',
      'aabcbaa',
      '.abcba.',
      '..aaa..'], {a: 'fire.t1', b: 'fire.t2', c: 'fire.core'}, 3, 4),
    def('icFire3', [
      '....a....',
      '...aa..a.',
      '..aba.aa.',
      '.abbaaba.',
      '.abcbbba.',
      'aabccbbaa',
      'abccccbba',
      '.abcccba.',
      '..aaaaa..'], {a: 'fire.t3', b: 'fire.t2', c: 'fire.core'}, 4, 4),
  ],
  heart: def('icHeart', [
    '.bb.bb.',
    'bhbbbbb',
    'bbbbbbb',
    '.bbbbb.',
    '..bbb..',
    '...b...'], {b: 'hud.bad', h: 'text'}, 3, 3),
  star: def('icStar', [
    '....a....',
    '...aaa...',
    'aaaaaaaAA',
    '.aaaaaAA.',
    '..aaaAA..',
    '..aaAAA..',
    '.aA...AA.'], {a: 'ui.accent', A: 'ui.accentLo'}, 4, 3),
  arrow: def('icArrow', [
    '...i...',
    '...ii..',
    'iiiiii.',
    'iiiiiii',
    'iiiiii.',
    '...ii..',
    '...i...'], IK, 3, 3),
};

/* 8-way pointer arrows (7×7, ink), index = heading octant clockwise from east: E SE S SW W NW N NE */
const ARR_E = def('arrE', [
  '...i...',
  '...ii..',
  'iiiiii.',
  'iiiiiii',
  'iiiiii.',
  '...ii..',
  '...i...'], {i: 'ink'}, 3, 3);
const ARR_NE = def('arrNE', [              // 4 px per row shaft (≈3 across, like ARR_E's 3 rows), 5-px legs
  '..iiiii',
  '...iiii',
  '..iiiii',
  '.iiii.i',
  'iiii..i',
  'iii....',
  'ii.....'], {i: 'ink'}, 3, 3);
const flipDef = (s, fx, fy, id) => ({...s, id, rows: (fy ? [...s.rows].reverse() : s.rows).map(r => fx ? [...r].reverse().join('') : r)});
SPR.arrow8 = [ARR_E, flipDef(ARR_NE, 0, 1, 'arrSE'), orient('arr', ARR_E, 's', false), flipDef(ARR_NE, 1, 1, 'arrSW'),
  flipDef(ARR_E, 1, 0, 'arrW'), flipDef(ARR_NE, 1, 0, 'arrNW'), orient('arr', ARR_E, 'n', false), ARR_NE];

/* =====================================================================================
   v2 — ONE PROJECTION FOR EVERYTHING: oblique 3/4 top-down, viewed from the south (Eastward-style).
   World metres x east, y north, z up → art px:  X = x/mpp,  Y = -y/mpp - z·k/mpp   (k = SPR.K, default 0.4).
   Depth toward the viewer = z - k·y (bigger = in front). Roofs are lifted by h·k/mpp, only south-facing walls
   show, SW faces lit (f2), S faces mid (f1), SE faces shaded (f0) — the same light as everything (top-left).
   New sprites are BAKED objects {id, w, h, ax, ay, keys, c}: keys = palette keys per pixel ('' = clear),
   c = a canvas in the ACTIVE theme (cached per theme). Draw with SPR.put(g, spr, x, y) (anchor-aligned) or
   g.drawImage(spr.c, x - spr.ax, y - spr.ay). SPR.fade(spr, a) = the same sprite Bayer-thinned to a∈[0,1]
   (8 steps) for gentle appear / disappear.
   ===================================================================================== */
SPR.K = 0.4;
SPR.heading64 = (dx, dy) => ((Math.round(Math.atan2(dy, dx) / TAU * 64) % 64) + 64) % 64;   // screen dx, dy (y down)
const ih = (a, b, s = 0) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function baked(id, W, H, keys, ax, ay){                         // crop to content, colour once for the active theme
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) if (keys[i]){ const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0){ x0 = y0 = x1 = y1 = 0; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, k2 = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) k2[y * w + x] = keys[(y + y0) * W + x + x0] || '';
  return paintBaked({id, w, h, ax: Math.round(ax) - x0, ay: Math.round(ay) - y0, keys: k2});
}
function paintBaked(o){
  const {c, g} = PX.makeCanvas(o.w, o.h), img = g.createImageData(o.w, o.h), d = img.data;
  for (let i = 0; i < o.keys.length; i++){ const k = o.keys[i]; if (!k) continue; const c3 = PX.rgb(PX.col(k)); d[i * 4] = c3[0]; d[i * 4 + 1] = c3[1]; d[i * 4 + 2] = c3[2]; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); o.c = c; return o;
}
SPR.fade = (spr, a) => {
  const q = Math.max(0, Math.min(8, Math.round(a * 8))); if (q >= 8) return spr;
  spr.fades = spr.fades || []; if (spr.fades[q]) return spr.fades[q];
  const keys = spr.keys.map((k, i) => k && PX.bayer(i % spr.w, (i / spr.w) | 0) < q / 8 ? k : '');
  return (spr.fades[q] = paintBaked({...spr, id: spr.id + '~' + q, keys, fades: null}));
};

/* ---------- top-view bodies (vehicles, boats): the train's "sheared raster" generalised ----------
   Along the major axis every column (row) is the same stack of n = W/maj pixels offset by the rounded centreline,
   so sides stay exact parallel pixel lines at all 64 headings. Per pixel the material fn gets
   p = {u (px along, + = front), v (px across), t (0 stern … 1 bow), kf / kr (pixel layers to the front / rear end),
   ks (layers to the nearer side), d (4-neighbour depth inside the silhouette, 0 = edge), lit (+1 top-left side,
   -1 the other, 0 centre), right (+1 on the vehicle's starboard side), up (p of the pixel above or null)}.
   Then: south face (fh px straight down under the silhouette, oblique side), 1px outer outline, night beam cone. */
function body(o){
  const th = o.hd * TAU / 64, ca = Math.cos(th), sa = Math.sin(th), shallow = Math.abs(ca) >= Math.abs(sa) - 1e-9;
  const maj = shallow ? Math.abs(ca) : Math.abs(sa), slope = shallow ? sa / ca : ca / sa, n = Math.max(1, Math.round(o.W / maj)), wc = (n - 1) / 2;
  const Lh = o.L / 2, R = Math.ceil(Lh + o.W / 2 + (o.cone || 0) + (o.fh || 1) + 3), S = R * 2 + 1, c = R;
  const P = new Array(S * S).fill(null), keys = new Array(S * S).fill('');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const A = shallow ? x : y, B = shallow ? y : x, w = B - (c + Math.round((A - c) * slope)) + (n >> 1);
    const u = (x - c) * ca + (y - c) * sa; if (w < 0 || w >= n || Math.abs(u) > Lh) continue;
    const v = (w - wc) * maj, t = (u + Lh) / (2 * Lh);
    if (o.prof && Math.abs(v) > o.prof(t) * wc * maj + .01) continue;
    P[y * S + x] = {u, v, t, w, n, kf: Math.floor((Lh - u) / maj + 1e-6), kr: Math.floor((Lh + u) / maj + 1e-6), ks: Math.min(w, n - 1 - w),
      lit: w < wc - .01 ? 1 : w > wc + .01 ? -1 : 0, right: Math.sign((w - wc) * (shallow ? ca : -sa)), d: 99};
  }
  const IN = (x, y) => x >= 0 && y >= 0 && x < S && y < S && P[y * S + x];
  for (let pass = 0; pass < 4; pass++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){   // depth from the edge
    const p = P[y * S + x]; if (!p || p.d < 99) continue;
    const nb = [IN(x - 1, y), IN(x + 1, y), IN(x, y - 1), IN(x, y + 1)];
    if (nb.some(q => !q || q.d === pass - 1)) p.d = pass; else if (pass === 3) p.d = 3;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){ const p = P[y * S + x]; if (p){ p.up = IN(x, y - 1) || null; p.dn = IN(x, y + 1) || null; } }
  o.hz = Math.abs(ca) > .7;                                                  // the south face is the long side
  for (let i = 0; i < S * S; i++) if (P[i]) keys[i] = o.mat(P[i], o) || '';
  const fh = o.fh || 1, face = new Uint8Array(S * S);
  for (let x = 0; x < S; x++){ let last = -99;                                // oblique south face: fh px under the silhouette
    for (let y = 0; y < S; y++){ const i = y * S + x;
      if (P[i]){ last = y; continue; }
      const r = y - last; if (r >= 1 && r <= fh){ const k = o.face(P[last * S + x], r, o); if (k){ keys[i] = k; face[i] = 1; } } } }
  const solid = keys.map(k => k ? 1 : 0), grown = PX.maskGrow(solid, S, S, 1);
  for (let i = 0; i < S * S; i++) if (grown[i] && !solid[i]) keys[i] = o.ol || 'ink';
  if (o.cone) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){       // dithered headlight cone ahead (night)
    const i = y * S + x; if (keys[i]) continue;
    const u = (x - c) * ca + (y - c) * sa - Lh - .5, v = Math.abs(-(x - c) * sa + (y - c) * ca), hw = wc * maj;
    if (u <= 0 || u > o.cone || v > hw + .4 + u * .45) continue;
    const tt = u / o.cone, b = PX.bayer(x, y), edge = v > hw + u * .3;
    if (b < (edge ? .12 : .3) - tt * .22) keys[i] = tt < .4 && !edge ? 'veh.beam1' : 'veh.beam2';   // sparse warm throw (≤ 1 px in 4), fading
  }
  return baked(o.id, S, S, keys, c, c);
}

/* =====================================================================================
   ROAD VEHICLES — SPR.veh(type, colourIdx, headingIdx64, night = theme is night) → baked, anchor = footprint centre.
   type 'sedan' | 'taxi' | 'van' | 'truck' | 'bus'. Heading 0 = east, 16 = south, 32 = west, 48 = north (screen,
   clockwise; SPR.heading64(dx, dy)). colourIdx: sedan / van 0–5 = white silver black red blue champagne,
   truck cab 0–5 (box stays pale), bus 0–2 = green blue red livery, taxi ignores it (Guangzhou 闪电橙).
   Night: warm headlights on the front corners, red tails, a short dithered beam cone; by day unlit lenses.
   Size (top silhouette + 1px outline, at 0°): sedan / taxi 10×5, van 11×5, truck 13×5, bus 17×6, +1px face.
   SPR.VEH_TYPES, SPR.VEH_LEN[type] (outline to outline, px) for spacing.  Old v1 call SPR.veh('car'|'bus', 'e') still works.
   ===================================================================================== */
const VCOL = ['veh.c0', 'veh.c1', 'veh.c2', 'veh.c3', 'veh.c4', 'veh.c5'], BUSCOL = ['veh.green', 'veh.c4', 'veh.c3'];
const lamp = (o, head) => head ? (o.night ? 'veh.head' : 'veh.lamp') : (o.night ? 'veh.tail' : 'veh.tailOff');
const side = (p, C) => p.lit > 0 ? C + '.hi' : p.lit < 0 ? C + '.lo' : C + '.mid';
function carFace(p, r, o){                                                    // the 1px oblique side of a car
  if (!o.hz && p.ks === 0 && (p.kf === 0 || p.kr === 0)) return lamp(o, p.kf === 0);
  if (o.hz && (p.kf === 1 || p.kr === 1 || (o.dual && p.kr === 2))) return 'ink';               // tyres
  return (o.faceC || o.C) + '.face';
}
const VT = {
  sedan: {L: 9, W: 3, face: carFace, mat(p, o){ const C = o.C;          // lamp · hood · windscreen · roof ×2 · rear glass · trunk · tail
    if (p.kf === 0) return p.ks === 0 ? lamp(o, 1) : C + '.mid';
    if (p.kr === 0) return p.ks === 0 ? lamp(o, 0) : C + '.lo';
    if (p.kf === 2) return p.lit > 0 && p.ks === 0 ? 'veh.glassHi' : 'veh.glass';
    if (p.kr === 2) return 'veh.glass';
    if (p.kf === 1 || p.kr === 1) return side(p, C);
    if (o.taxi && p.kr === 3 && p.ks >= 1) return o.night ? 'veh.sign' : 'veh.sign';            // roof light box
    return p.lit < 0 ? C + '.mid' : C + '.hi'; }},
  van: {L: 9, W: 3, face: carFace, mat(p, o){ const C = o.C;            // short nose, long roof with rails
    if (p.kf === 0) return p.ks === 0 ? lamp(o, 1) : C + '.mid';
    if (p.kr === 0) return p.ks === 0 ? lamp(o, 0) : C + '.lo';
    if (p.kf === 2) return p.lit > 0 && p.ks === 0 ? 'veh.glassHi' : 'veh.glass';
    if (p.kr === 1) return 'veh.glass';
    if (p.kf === 1) return side(p, C);
    return p.ks === 0 ? (p.lit > 0 ? C + '.mid' : C + '.lo') : C + '.hi'; }},
  truck: {L: 11, W: 3, dual: 1, face(p, r, o){ return carFace(p, r, {...o, faceC: p.kf <= 3 ? o.C : 'veh.roof'}); }, mat(p, o){
    const C = o.C, B = 'veh.roof';                                                 // cab-over · gap · box with ribs
    if (p.kf === 0) return p.ks === 0 ? lamp(o, 1) : C + '.mid';
    if (p.kf === 1) return p.lit > 0 && p.ks === 0 ? 'veh.glassHi' : 'veh.glass';
    if (p.kf <= 3) return p.lit < 0 ? C + '.mid' : C + '.hi';
    if (p.kf === 4) return 'ink';
    if (p.kr === 0) return p.ks === 0 ? lamp(o, 0) : B + '.lo';
    if (p.kr % 3 === 1) return B + '.mid';
    return side(p, B).replace('.mid', '.hi'); }},
  bus: {L: 15, W: 4, face(p, r, o){ const C = o.C;                                // side windows (lit at night) along the face
    if (!o.hz) return p.ks === 0 && (p.kf === 0 || p.kr === 0) ? lamp(o, p.kf === 0) : p.kf === 0 ? 'veh.glass' : C + '.face';
    if (p.kf === 0 || p.kr === 0) return C + '.face';
    return p.kf % 3 === 1 ? C + '.face' : o.night ? 'veh.busWin' : 'veh.glass'; }, mat(p, o){
    const C = o.C, Rf = 'veh.roof';
    if (p.kf === 0) return p.lit > 0 && p.ks === 0 ? 'veh.glassHi' : 'veh.glass';   // wrap-around windscreen
    if (p.kr === 0) return p.ks === 0 ? lamp(o, 0) : C + '.lo';
    if (p.ks === 0) return p.lit > 0 ? C + '.hi' : C + '.lo';                      // livery shows along the roof edge
    const len = Math.round((p.kf + p.kr) / 2), ac = p.kr >= len - 2 && p.kr <= len + 1;
    if (ac) return p.kr === len - 2 || p.kr === len + 1 ? Rf + '.lo' : p.lit >= 0 ? Rf + '.hi' : Rf + '.mid';   // roof AC pod
    if (p.kr === 2 || p.kf === 3) return Rf + '.lo';                                                            // hatches
    return p.lit > 0 ? Rf + '.hi' : Rf + '.mid'; }},
};
VT.taxi = VT.sedan;
SPR.VEH_TYPES = ['sedan', 'taxi', 'van', 'truck', 'bus'];
SPR.VEH_LEN = {sedan: 10, taxi: 10, van: 11, truck: 13, bus: 17};
const vehV1 = (type = 'car', dir = 'e') => cached('veh|' + type + dir, () => orient(VEH[type].id, VEH[type], dir));
SPR.veh = (type = 'sedan', ci = 0, hd = 0, night = PX.theme === 'night') => {
  if (typeof ci === 'string' || (ci === undefined && (type === 'car'))) return vehV1(type, ci);
  if (type === 'car') type = 'sedan';
  hd = ((hd | 0) % 64 + 64) % 64; ci = ci | 0; night = !!night;
  return cached(['veh2', type, ci, hd, night, PX.theme].join('|'), () => {
    const T = VT[type] || VT.sedan, C = type === 'taxi' ? 'veh.taxi' : type === 'bus' ? BUSCOL[ci % 3] : VCOL[ci % 6];
    return body({...T, id: 'veh' + type + ci + '_' + hd + (night ? 'n' : ''), hd, C, night, taxi: type === 'taxi', cone: night ? (type === 'bus' ? 5 : 4) : 0});
  });
};

/* =====================================================================================
   BOATS — SPR.boat(type, headingIdx64, night) → baked, anchor = hull centre; SPR.wake(type, headingIdx64, frame 0–2)
   → baked foam in the same frame of reference (draw the wake, then the boat, at the same point).
   type 'launch' (9 px speedboat) | 'ferry' (14 px 水上巴士, blue band) | 'cruise' (24 px Pearl River night cruise:
   LED rail, two lit window decks) | 'barge' (22 px sand barge, wheelhouse aft). Decks step up inside the hull, each
   tier showing its own 1px south face (window bands). SPR.BOAT_LEN[type]. v1 SPR.boat('e') still works.
   ===================================================================================== */
const hullP = (bow, stern = 0, tip = .2) => t => t > 1 - bow ? Math.max(tip, 1 - Math.pow((t - 1 + bow) / bow, 1.7) * (1 - tip)) : t < stern ? .75 + .25 * t / stern : 1;
const tier = (p, dMin) => p && p.d >= dMin;
const BT = {
  launch: {L: 9, W: 4.6, prof: hullP(.45, 0, .25), wake: 26, face: (p, r, o) => 'boat.w.face', mat(p, o){
    if (p.kr === 0) return 'boat.dk.mid';                                                     // outboard
    if (p.d === 0) return p.kf <= 1 && o.night ? (p.right > 0 ? 'boat.green' : p.right < 0 ? 'boat.red' : 'boat.w.hi') : p.lit > 0 ? 'boat.w.hi' : p.lit < 0 ? 'boat.w.lo' : 'boat.w.mid';
    if (p.kf === 3 || p.kf === 4) return p.kf === 3 ? (o.night ? 'boat.winHi' : 'veh.glassHi') : 'veh.glass';
    return p.kf > 4 && p.kr > 1 ? 'boat.wood.mid' : 'boat.w.mid'; }},
  ferry: {L: 14, W: 5, prof: hullP(.3, .12, .3), wake: 24, face: (p, r, o) => 'boat.stripe', mat(p, o){
    if (p.d === 0) return p.lit > 0 ? 'boat.w.mid' : 'boat.w.lo';
    if (!tier(p, 2) && tier(p.up, 2)) return o.night ? 'boat.win' : 'veh.glass';            // cabin windows (tier face)
    if (!tier(p, 2)) return p.kf <= 2 ? 'boat.w.mid' : 'boat.wood.lo';                      // walkway / foredeck
    if (p.ks === (p.n >> 1) && (p.kr === 4 || p.kr === 8)) return 'boat.w.lo';              // roof vents
    return p.lit > 0 ? 'boat.w.hi' : p.lit < 0 && p.d === 2 ? 'boat.w.lo' : 'boat.w.mid'; }},
  cruise: {L: 24, W: 7, fh: 2, prof: hullP(.22, .08, .15), wake: 28, face(p, r, o){
    if (r === 2) return o.night ? ['boat.led1', 'boat.led2', 'boat.led3'][((p.kr / 3) | 0) % 3] : 'boat.red';
    return o.night ? (p.kr % 2 ? 'boat.win' : 'boat.winHi') : p.kr % 2 ? 'veh.glass' : 'boat.w.face'; }, mat(p, o){
    if (p.d === 0) return o.night ? ['boat.led1', 'boat.led2', 'boat.led3'][((p.kr / 3) | 0) % 3] : p.lit > 0 ? 'boat.w.hi' : 'boat.w.lo';   // LED rail
    if (p.d === 1) return tier(p.up, 2) ? (o.night ? 'boat.win' : 'veh.glass') : p.kf < 4 ? 'boat.w.mid' : 'boat.wood.mid';
    if (p.kf >= 4 && p.kf <= 6) return p.kf === 4 ? (o.night ? 'boat.winHi' : 'veh.glassHi') : p.lit > 0 ? 'boat.w.hi' : 'boat.w.mid';   // wheelhouse
    if (p.d === 2) return tier(p.up, 3) ? (o.night ? 'boat.winHi' : 'veh.glass') : p.lit > 0 ? 'boat.w.hi' : 'boat.w.lo';
    if (p.kf < 6) return 'boat.w.mid';
    return o.night ? (p.kr % 3 === 0 && p.ks === 3 ? 'boat.led3' : 'boat.wood.lo') : p.kr % 2 ? 'boat.wood.mid' : 'boat.wood.hi'; }},   // open top deck
  barge: {L: 22, W: 5, prof: hullP(.1, 0, .6), wake: 16, face: (p, r, o) => p.kr % 5 === 2 ? 'boat.rust' : 'boat.dk.face', mat(p, o){
    const cab = q => q && q.kr >= 1 && q.kr <= 4 && q.d >= 1;
    if (p.d === 0) return p.lit > 0 ? 'boat.dk.hi' : 'boat.dk.lo';
    if (cab(p)) return p.kr === 3 && p.ks === 2 && o.night ? 'boat.winHi' : p.lit > 0 ? 'boat.w.hi' : 'boat.w.mid';   // wheelhouse + mast light
    if (cab(p.up)) return o.night ? 'boat.win' : 'veh.glass';
    if (p.kr <= 5 || p.kf <= 1) return 'boat.dk.mid';
    if (p.d === 1) return 'sand.d1';                                                          // hold edge, then the sand heap
    return p.lit > 0 ? 'sand.hi' : p.lit < 0 ? 'sand.d2' : 'sand.d3'; }},
};
SPR.BOAT_TYPES = ['launch', 'ferry', 'cruise', 'barge'];
SPR.BOAT_LEN = {launch: 11, ferry: 16, cruise: 26, barge: 24};
const boatV1 = (dir = 'e') => cached('boat|' + dir, () => orient('boat', BOAT, dir));
SPR.boat = (type = 'e', hd = 0, night = PX.theme === 'night') => {
  if (!BT[type]) return boatV1(type);
  hd = ((hd | 0) % 64 + 64) % 64; night = !!night;
  return cached(['boat2', type, hd, night, PX.theme].join('|'), () => body({...BT[type], id: 'boat' + type + hd + (night ? 'n' : ''), hd, night, ol: 'ink'}));
};
SPR.wake = (type = 'ferry', hd = 0, fr = 0) => {
  hd = ((hd | 0) % 64 + 64) % 64; fr = ((fr | 0) % 3 + 3) % 3;
  return cached(['wake', type, hd, fr, PX.theme].join('|'), () => {
    const B = BT[type] || BT.ferry, th = hd * TAU / 64, ca = Math.cos(th), sa = Math.sin(th), Lh = B.L / 2, len = B.wake;
    const R = Math.ceil(Lh + len + 3), S = R * 2 + 1, c = R, keys = new Array(S * S).fill(''), sp = 4, tk = Math.tan(19.5 * Math.PI / 180) * 1.25;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      const u = (x - c) * ca + (y - c) * sa, v = -(x - c) * sa + (y - c) * ca, b = -(u + Lh), av = Math.abs(v), bb = PX.bayer(x, y);
      if (b < 0){                                                               // bow wave: two short foam lips
        const e = Lh - u; if (e > 0 && e < B.L * .45 && Math.abs(av - (B.prof(1 - e / B.L) * B.W / 2 + .9)) < .5 && bb < .7 - e / B.L) keys[y * S + x] = 'water.foam';
        continue;
      }
      if (b > len) continue;
      const f = b / len, arm = Math.abs(av - (B.W / 2 - .3 + b * tk)) < .55, ph = ((b - fr * sp / 3) % sp + sp) % sp;
      if (arm && ph < sp * .6 && bb < 1.15 - f * 1.1) keys[y * S + x] = f < .35 ? 'water.foam' : 'water.shore';
      else if (av < B.W * .32 + b * .07 && b < len * .6 && ih(x - Math.round(fr * ca * 2), y - Math.round(fr * sa * 2), 7) < .55 * (1 - b / (len * .6)))
        keys[y * S + x] = b < len * .2 ? 'water.foam' : 'water.shallow';        // prop wash
    }
    return baked('wake' + type + hd + fr, S, S, keys, c, c);
  });
};

/* =====================================================================================
   OBLIQUE RASTERISER — SPR.obl(mpp, k, W, H, ox, oy): a W×H key buffer with a depth buffer, ground origin at
   (ox, oy). Exact per-pixel-centre inverse mapping, so every face is crisp at any scale:
     .wall(a, b, z0, z1, fn)   vertical wall over the plan edge a→b ([x,y] m; polygons CCW → drawn only when
                               south-facing, i.e. b.x > a.x). fn(q) → key, q = {t, z, X, Y, row (px below the wall's
                               top edge), rowB (px above its foot), col (X - wall's left X), nx (normal x: <0 = SW face),
                               tone (0 SE / 1 S / 2 SW)}
     .roof(poly, z, fn, tag)   horizontal polygon at height z; fn(q) q = {x, y, X, Y}
     .prism(poly, z0, z1, wallFn, roofFn, tag)
     .line(p0, p1, key|fn(f,X,Y), bias)   1px 3D segment;  .tri(a, b, c, key, tag)   3D triangle
     .fill(), .rims(tag, hiKey, loKey)  roof edge light (N/W edge hi, S/E edge lo), .seams(key) ink where a nearer
     object overlaps another, .outline(key)  1px outer outline, .bake(id)
   SPR.facade(fam, tone, row, col, night, seed) → the shared window pattern for facades (fam res|com|ind|civ). */
function obl(mpp, k, W, H, ox, oy){
  const keys = new Array(W * H).fill(''), zb = new Float64Array(W * H).fill(-1e9), tag = new Int16Array(W * H);
  const o = {mpp, k, W, H, ox, oy, keys, zb, tag};
  o.P = (x, y, z = 0) => [ox + x / mpp, oy - y / mpp - z * k / mpp];
  o.put = (X, Y, d, key, tg = 0) => { if (!key || X < 0 || Y < 0 || X >= W || Y >= H) return; const i = Y * W + X; if (d >= zb[i]){ zb[i] = d; keys[i] = key; tag[i] = tg; } };
  o.wall = (a, b, z0, z1, fn, tg = 0) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]; if (dx <= 1e-9 || k < 1e-6 || z1 <= z0) return;
    const len = Math.hypot(dx, dy), nx = dy / len, tone = nx < -.35 ? 2 : nx > .35 ? 0 : 1, XL = Math.floor(ox + a[0] / mpp);
    for (let X = Math.floor(ox + a[0] / mpp); X <= Math.ceil(ox + b[0] / mpp); X++){
      const t = ((X + .5 - ox) * mpp - a[0]) / dx; if (t < 0 || t >= 1) continue;
      const py = a[1] + t * dy, Yt = oy - py / mpp - z1 * k / mpp, Yb = oy - py / mpp - z0 * k / mpp;
      for (let Y = Math.floor(Yt); Y <= Math.ceil(Yb); Y++){
        const z = (-(Y + .5 - oy) * mpp - py) / k; if (z < z0 || z > z1) continue;
        o.put(X, Y, z - k * py, fn({t, z, X, Y, row: Math.floor(Y + .5 - Yt), rowB: Math.floor(Yb - Y - .5), col: X - XL, nx, tone}), tg);
      }
    }
  };
  o.roof = (poly, z, fn, tg = 0) => {
    const pr = poly.map(([x, y]) => o.P(x, y, z)), xs = pr.map(p => p[0]), ys = pr.map(p => p[1]);
    for (let Y = Math.floor(Math.min(...ys)); Y <= Math.ceil(Math.max(...ys)); Y++) for (let X = Math.floor(Math.min(...xs)); X <= Math.ceil(Math.max(...xs)); X++){
      const x = (X + .5 - ox) * mpp, y = -(Y + .5 - oy) * mpp - z * k;
      let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){ const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
      if (inside) o.put(X, Y, z - k * y + 1e-3, fn({x, y, X, Y}), tg);
    }
  };
  o.prism = (poly, z0, z1, wallFn, roofFn, tg = 0) => {
    for (let i = 0; i < poly.length; i++) o.wall(poly[i], poly[(i + 1) % poly.length], z0, z1, wallFn, tg);
    if (roofFn) o.roof(poly, z1, roofFn, tg);
  };
  o.line = (p0, p1, key, bias = .5, tg = 0) => {
    const [X0, Y0] = o.P(...p0), [X1, Y1] = o.P(...p1), d0 = p0[2] - k * p0[1], d1 = p1[2] - k * p1[1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(X1 - X0), Math.abs(Y1 - Y0))));
    for (let i = 0; i <= n; i++){ const f = i / n, X = Math.floor(X0 + (X1 - X0) * f), Y = Math.floor(Y0 + (Y1 - Y0) * f);
      o.put(X, Y, d0 + (d1 - d0) * f + bias, typeof key === 'function' ? key(f, X, Y) : key, tg); }
  };
  o.tri = (a, b, c, key, tg = 0) => {
    const A = o.P(...a), B = o.P(...b), C = o.P(...c), da = a[2] - k * a[1], db = b[2] - k * b[1], dc = c[2] - k * c[1];
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(den) < 1e-9) return;
    for (let Y = Math.floor(Math.min(A[1], B[1], C[1])); Y <= Math.ceil(Math.max(A[1], B[1], C[1])); Y++)
      for (let X = Math.floor(Math.min(A[0], B[0], C[0])); X <= Math.ceil(Math.max(A[0], B[0], C[0])); X++){
        const px = X + .5, py = Y + .5, l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        o.put(X, Y, l1 * da + l2 * db + l3 * dc, typeof key === 'function' ? key(X, Y) : key, tg);
      }
  };
  o.rims = (tg, hi, lo) => {
    const src = keys.slice(), T = (X, Y) => X < 0 || Y < 0 || X >= W || Y >= H ? -1 : tag[Y * W + X];
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++){ const i = Y * W + X; if (tag[i] !== tg || !src[i]) continue;
      if (hi && (T(X, Y - 1) !== tg || T(X - 1, Y) !== tg)) keys[i] = hi; else if (lo && (T(X, Y + 1) !== tg || T(X + 1, Y) !== tg)) keys[i] = lo; }
  };
  o.seams = key => { const src = tag.slice();
    for (let Y = 1; Y < H; Y++) for (let X = 0; X < W; X++){ const i = Y * W + X, a = src[i], b = src[i - W];
      if (a && b && a !== b && zb[i] > zb[i - W] + 1) keys[i] = key; } };
  o.outline = key => { const m = keys.map(q => q ? 1 : 0), gm = PX.maskGrow(m, W, H, 1); for (let i = 0; i < W * H; i++) if (gm[i] && !m[i]) keys[i] = key; };
  o.bake = id => baked(id, W, H, keys, ox, oy);
  return o;
}
SPR.obl = obl;
const FAM = {res: {every: 3, run: 3, lit: .3, cool: .12}, com: {every: 0, run: 6, lit: .26, cool: .5}, ind: {every: 4, run: 4, lit: .12, cool: .5}, civ: {every: 3, run: 3, lit: .22, cool: .2}};
SPR.facade = (fam, tone, row, col, night, seed = 0) => {
  const F = FAM[fam] || FAM.res, base = 'bld.' + fam + '.f' + tone;
  if (row <= 0 || (row & 1)) return base;                                          // parapet row, then spandrel / window rows
  if (F.every && col % F.every === F.every - 1) return base;                       // piers between window bays
  if (fam === 'ind' && (row & 3) !== 2) return base;
  if (!night) return tone === 2 ? 'wnd.glass2' : 'wnd.glass1';
  const run = Math.floor((col + (ih(row, 0, seed) * F.run | 0)) / F.run), h = ih(row, run, seed);
  if (h >= F.lit || ih(col, row, seed + 2) < .12) return 'wnd.off';                 // a lit run, with the odd dark pane
  return ih(run, row >> 1, seed + 1) < F.cool ? 'wnd.cool' : h < F.lit * .4 ? 'wnd.lit2' : 'wnd.lit1';
};
const perim = poly => { const L = poly.map((p, i) => Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1])), len = L.reduce((a, b) => a + b, 0);
  return {len, at(s){ s = ((s % len) + len) % len; for (let i = 0; i < poly.length; i++){ if (s <= L[i]){ const a = poly[i], b = poly[(i + 1) % poly.length], f = s / L[i]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; } s -= L[i]; } return poly[0]; }}; };
const ellipse = (a, b, n = 32, rot = 0, cx = 0, cy = 0) => Array.from({length: n}, (_, i) => { const t = i / n * TAU, x = a * Math.cos(t), y = b * Math.sin(t);
  return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; });

/* =====================================================================================
   OBLIQUE LANDMARKS — same projection and scale as the generic extruded buildings, at the TRUE size:
   SPR.landmark(id, mpp, k = SPR.K, night) with id 'cantonTower'|'ifc'|'ctf'|'opera'|'haixinsha'
   → baked, anchor = ground centre (plan origin). SPR.LANDMARK_M[id] = {h, w} metres. No ground shadow inside
   (the ground bake owns shadows).
   ===================================================================================== */
SPR.LANDMARK_M = {cantonTower: {h: 600, w: 104}, ifc: {h: 440, w: 70}, ctf: {h: 530, w: 66}, opera: {h: 43, w: 200}, haixinsha: {h: 40, w: 250}};
const lmBox = (mpp, k, wm, hm, sm = wm) => { const W = Math.ceil(wm / mpp) + 12, H = Math.ceil((hm * k + sm) / mpp) + 14; return {W, H, ox: W >> 1, oy: H - Math.ceil(sm / 2 / mpp) - 6}; };

/* (a generator: SPR.prebake runs it in idle slices — at 2–2.5 m/px it takes 9–15 ms; everyone else drains it at once, cantonTower2) */
let SDL = Infinity;
const SLATE = () => SDL !== Infinity && performance.now() > SDL;
function* cantonTower2G(mpp, k, night){
  const HB = 454, HT = 600, tw = .75 * Math.PI, b = lmBox(mpp, k, 110, HT, 110), o = obl(mpp, k, b.W, b.H, b.ox, b.oy);
  const cp = (ph, t) => { const x0 = 40 * Math.cos(ph), y0 = 30 * Math.sin(ph), x1 = 27 * Math.cos(ph + tw), y1 = 20.25 * Math.sin(ph + tw); return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, t * HB]; };
  const sect = (t, s = 1, n = 40) => Array.from({length: n}, (_, i) => { const p = cp(i / n * TAU, t); return [p[0] * s, p[1] * s]; });
  const bodyPx = HB * k / mpp, basePx = 80 / mpp, big = bodyPx > 70, small = bodyPx < 40;
  const ramp = (t, X, Y, st) => { const up = (t - .45) / .2 > PX.bayer(X, Y);           // lower magenta → upper lilac (night) / steel (day)
    return (up ? ['tower.d1', 'tower.violet', 'tower.lilac', 'tower.top'] : ['tower.d2', 'tower.d3', 'tower.d4', 'tower.hi'])[Math.max(0, Math.min(3, st))]; };
  // plinth + core + floor blocks + top house
  o.prism(ellipse(46, 35, 36), 0, 6, q => q.tone === 2 ? 'tower.base' : 'tower.baseLo', () => 'tower.base', 1);
  if (SLATE()) yield;
  if (small){
    /* small (≥ 5 m/px at k .4 — review 2: the lattice turned into pink speckle there): a clean shaded silhouette of the twisted
       hyperboloid — 1 px slices of the true section (so the narrow waist and the flared top read), lit left / shaded right, a
       brighter ring every third slice (the tower's light bands) */
    const M = Math.max(4, Math.round(bodyPx));
    for (let j = 0; j < M; j++){ const t0 = j / M, t1 = (j + 1) / M, band = j % 3 === 1;
      o.prism(sect((t0 + t1) / 2), 8 + t0 * (HB - 30), 8 + t1 * (HB - 30), q => night ? (band ? ['tower.d3', 'tower.d4', 'tower.hi'] : ['tower.d2', 'tower.d3', 'tower.d4'])[q.tone]
        : (band ? ['tower.d2', 'tower.d3', 'tower.hi'] : ['tower.d1', 'tower.d2', 'tower.d4'])[q.tone], null, 5); if (SLATE()) yield; }
    o.prism(sect(.955, .93), HB - 22, HB, q => q.row === 0 ? 'tower.top' : q.tone === 2 ? (night ? 'tower.hi' : 'tower.d4') : night ? 'tower.d3' : 'tower.d2', () => 'tower.d1', 4);
  } else {
  o.prism(ellipse(9, 7.5, 20), 8, HB - 20, q => night ? (q.row > 1 && (q.row % 3 === 0) && ih(q.X, q.row, 5) < .25 ? 'win.amber' : q.tone === 2 ? 'tower.glow' : 'tower.core') : q.tone === 2 ? 'tower.d1' : 'tower.core', null, 2);
  if (SLATE()) yield;
  if (big) for (const [z0, z1] of [[118, 150], [230, 262]]){ const t = (z0 + z1) / 2 / HB;
    o.prism(sect(t, .86), z0, z1, q => (q.row & 1) ? 'tower.d1' : night ? (ih(q.X, q.row, 3) < .45 ? 'wnd.cool' : 'wnd.off') : 'wnd.glass1', () => 'tower.d1', 3); if (SLATE()) yield; }
  o.prism(sect(.955, .93), HB - 22, HB, q => q.row === 0 ? 'tower.top' : q.rowB === 1 ? (night ? (ih(q.X, 1, 4) < .7 ? 'wnd.lit2' : 'wnd.cool') : 'wnd.glass2') : q.tone === 2 ? 'tower.d3' : 'tower.d2', () => 'tower.d1', 4);
  // lattice: N inclined columns (back ones dim, front ones lit by side), ring beams every ~4 px
  const N = Math.max(6, Math.min(24, 2 * Math.round(basePx / 3.2))), nR = Math.max(3, Math.round(bodyPx / (big ? 4 : 5)));
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++){
    const ph = i / N * TAU, a = cp(ph, 0), c = cp(ph, 1);
    o.line([a[0], a[1], 8], c, (f, X, Y) => { const p = cp(ph, f), front = p[1] < 0; if (front !== !!pass) return null;
      const lit = p[0] < -3 ? 1 : p[0] > 6 ? -1 : 0; return front ? ramp(f, X, Y, (f > .5 ? 1 : 2) + lit) : ramp(f, X, Y, 0); }, pass ? 1.5 : .5, 5);
    if (SLATE()) yield;
  }
  for (let j = 1; j <= nR; j++){ const t = j / (nR + .6), n = 72;
    for (let i = 0; i < n; i++){ const a = cp(i / n * TAU, t), c = cp((i + 1) / n * TAU, t);
      o.line(a, c, (f, X, Y) => { const front = a[1] + c[1] < 0, lit = a[0] < -3 ? 1 : a[0] > 6 ? -1 : 0; return front ? ramp(t, X, Y, (t > .5 ? 0 : 1) + lit) : null; }, 1.2, 5); }
    if (SLATE()) yield; }
  // hollow of the lattice: fill each row between its outermost lattice pixels (see-through dark / grey core space)
  const yTop = Math.round(o.P(0, 0, HB)[1]) + 2, yBot = Math.round(o.P(0, -30, 8)[1]);
  for (let Y = yTop; Y < yBot; Y++){ let x0 = -1, x1 = -1; if (!((Y - yTop) & 31) && SLATE()) yield;
    for (let X = 0; X < b.W; X++) if (o.tag[Y * b.W + X] === 5 && o.keys[Y * b.W + X]){ if (x0 < 0) x0 = X; x1 = X; }
    for (let X = x0 + 1; X < x1; X++){ const i = Y * b.W + X; if (!o.keys[i] || o.tag[i] === 1) o.keys[i] = 'tower.void'; } }   // (the podium shows only outside)
  }
  // top: roof deck with the bubble-tram rim, then the antenna mast (tapered, banded) and the beacon
  o.roof(sect(1, .96), HB, q => 'tower.d1', 6); o.rims(6, 'tower.top', night ? 'tower.d4' : 'tower.d3');
  if (SLATE()) yield;
  const segs = 8;
  for (let s = 0; s < segs; s++){ const z0 = HB + s * (HT - HB - 10) / segs, z1 = z0 + (HT - HB - 10) / segs, r = 7.5 - 5.5 * s / segs;
    o.prism(ellipse(r, r, 12), z0, z1, q => s % 2 ? (q.tone === 2 ? 'tower.top' : 'tower.lilac') : q.tone === 2 ? 'tower.lilac' : night ? 'tower.violet' : 'tower.d2', () => 'tower.top', 7); }
  o.line([0, 0, HT - 10], [0, 0, HT], 'tower.top', 1);
  const [bx, by] = o.P(0, 0, HT); o.put(Math.floor(bx), Math.floor(by), 1e4, 'tower.beacon');
  if (SLATE()) yield;
  o.outline('tower.ol');
  if (night && bodyPx > 40){ if (SLATE()) yield;                                                        // dithered violet halo
    let ring = o.keys.map(q => q ? 1 : 0);
    [[.55, 'tower.d2'], [.25, 'tower.glow']].forEach(([fade, key]) => { const nx = PX.maskGrow(ring, b.W, b.H, 1);
      for (let i = 0; i < nx.length; i++) if (nx[i] && !ring[i] && PX.bayer(i % b.W, (i / b.W) | 0) < fade && (i / b.W | 0) < b.oy - 2) o.keys[i] = key; ring = nx; });
  }
  if (SLATE()) yield;
  const spr = o.bake('tower2'); spr.beacon = [Math.floor(bx) - b.ox, Math.floor(by) - b.oy]; return spr;
}
const drain = g => { let r; do r = g.next(); while (!r.done); return r.value; };
const cantonTower2 = (mpp, k, night) => drain(cantonTower2G(mpp, k, night));

function tower(id, mpp, k, night, o2){                       // IFC / CTF: extruded CBD glass towers + their special art
  const b = lmBox(mpp, k, o2.w + 20, o2.h, o2.w + 20), o = obl(mpp, k, b.W, b.H, b.ox, b.oy);
  o2.tiers.forEach(([poly, z0, z1, wallFn], i) => o.prism(poly, z0, z1, q => wallFn(q, i), q => 'bld.com.r2', 10 + i));
  o2.tiers.forEach((tr, i) => o.rims(10 + i, 'bld.com.hi', 'bld.com.r1'));
  if (o2.top) o2.top(o);
  o.outline('bld.com.r0');
  return o.bake(id);
}
const roundTri = (R, rr, rot, n = 8) => { const out = [];
  for (let v = 0; v < 3; v++){ const a = rot + v * TAU / 3, cx = (R - rr * 2) * Math.cos(a), cy = (R - rr * 2) * Math.sin(a);
    for (let j = 0; j <= n; j++){ const t = a - Math.PI / 3 + j / n * (2 * Math.PI / 3); out.push([cx + rr * 2 * Math.cos(t), cy + rr * 2 * Math.sin(t)]); } }
  return out; };
/* small (drawn under ~40 px tall, i.e. ≥ 5 m/px at k .4 — review 1: the diagrid broke into blotches there): a clean rounded-
   triangle glass prism, the lit top-left edge, two diagonal highlight lines instead of the diagrid, no window rows */
function ifc2(mpp, k, night){
  const H = 432, plan = roundTri(40, 6, -Math.PI / 2 + .2), per = perim(plan), crownZ = H - 2.5 * mpp / k, small = 440 * k / mpp < 40;
  const face = small ? (q => q.row <= 1 ? (night ? 'lm.crown' : 'lm.ribHi')     // night (review 2): lit cool floor rows, so it reads as the lit IFC
      : night && q.row % 3 === 2 && ih(q.X, q.row, 7) < .55 ? (ih(q.X, q.row, 8) < .3 ? 'car.glassHi' : 'win.cool') : ['lm.g1', 'lm.g2', 'lm.g3'][q.tone] || 'lm.g2')
    : q => q.row <= 1 ? (night ? 'lm.crown' : 'lm.ribHi') : SPR.facade('com', q.tone, q.row, q.col, night, 11);
  return tower(small ? 'ifc2s' : 'ifc2', mpp, k, night, {w: 76, h: 440, tiers: [[plan, 0, H, face]], top(o){
    const nL = Math.max(6, Math.min(16, Math.round(per.len / Math.max(26, mpp * 6)))), slope = per.len / nL / 2 / 54, dz = Math.max(1, mpp);
    if (small){ const sl = per.len / 2 / H;                                          // two highlight lines, one turn over the height
      for (const i of [0, 1]){ let prev = null;
        for (let z = 0; z <= crownZ + 1e-6; z += dz){ const zz = Math.min(z, crownZ), [x, y] = per.at(i * per.len / 2 + zz * sl), cur = [x, y, zz];
          if (prev) o.line(prev, cur, night ? 'lm.crown' : 'lm.ribHi', 1, 10); prev = cur; } }
    } else for (const dir of [1, -1]) for (let i = 0; i < nL; i++){                // diagrid: members spiral both ways, diamonds 54 m tall
      let prev = null;
      for (let z = 0; z <= crownZ + 1e-6; z += dz){ const zz = Math.min(z, crownZ), [x, y] = per.at(i * per.len / nL + dir * zz * slope), cur = [x, y, zz];
        if (prev) o.line(prev, cur, x < -12 ? (night ? 'lm.crown' : 'lm.ribHi') : night ? 'lm.cool' : 'lm.rib', 1.5, 10);
        prev = cur; }
    }
    o.prism(roundTri(22, 4, -Math.PI / 2 + .2), H, H + 8, q => night ? 'lm.crown' : 'bld.com.f2', () => 'bld.com.r3', 20); o.rims(20, 'bld.com.hi', 'bld.com.r1');
    const [X, Y] = o.P(0, 4, H + 8); o.put(Math.floor(X), Math.floor(Y), 1e4, night ? 'tower.beacon' : 'bld.com.r1'); }});
}
function ctf2(mpp, k, night){
  const sq = (h, ch) => [[-h + ch, -h], [h - ch, -h], [h, -h + ch], [h, h - ch], [h - ch, h], [-h + ch, h], [-h, h - ch], [-h, -h + ch]];
  const face = (q, i) => {
    const r = q.row, c = q.col;
    if (i === 3) return c % 2 ? (night ? 'lm.crown' : 'lm.ribHi') : 'bld.com.f' + q.tone;           // crown: open fins
    if (r === 0) return 'lm.ribHi';                                                               // setback lip
    if (c % 3 === 0) return night ? 'bld.com.f2' : q.tone === 0 ? 'lm.rib' : 'lm.ribHi';            // white terracotta fins
    return SPR.facade('com', q.tone, r, c, night, 23);
  };
  return tower('ctf2', mpp, k, night, {w: 68, h: 530, tiers: [[sq(33, 9), 0, 250, face], [sq(30, 8), 250, 390, face], [sq(26.5, 7), 390, 470, face], [sq(22, 6), 470, 515, face]], top(o){
    o.prism(sq(12, 3), 515, 521, q => 'bld.com.f' + q.tone, () => 'bld.com.r3', 20); o.rims(20, 'bld.com.hi', 'bld.com.r1');
    o.line([0, 4, 521], [0, 4, 530], night ? 'lm.crown' : 'lm.rib', 1); const [X, Y] = o.P(0, 4, 530); o.put(Math.floor(X), Math.floor(Y), 1e4, 'tower.beacon'); }});
}
/* faceted pebbles / sails: triangle meshes, flat-shaded per facet (3 steps), seams on every mesh edge */
function meshShade(a, b, c){ const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; if (n[2] < 0) n = n.map(q => -q);
  const L = [-.55, .45, .7], m = Math.hypot(...n) * Math.hypot(...L); return (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / m; }
function pebble(o, cx, cy, A, B, H, seed, tg, night, keysFn){
  const nA = 9, rings = [[1, 0], [.78, .5], [.5, .84], [.2, 1]], pts = rings.map(([r, z], ri) => Array.from({length: nA}, (_, i) => {
    const a = (i + (ri % 2) * .5 + (ih(i, ri, seed) - .5) * .5) / nA * TAU, rr = r * (1 + (ih(ri, i, seed + 1) - .5) * .18);
    return [cx + A * rr * Math.cos(a), cy + B * rr * Math.sin(a), H * z * (ri ? 1 + (ih(i, ri, seed + 2) - .5) * .12 : 1)]; }));
  const apex = [cx - A * .08, cy + B * .1, H], tris = [];
  for (let r = 0; r < 3; r++) for (let i = 0; i < nA; i++){ const a = pts[r][i], b = pts[r][(i + 1) % nA], c = pts[r + 1][i], d = pts[r + 1][(i + 1) % nA];
    if (r % 2) tris.push([a, b, d], [a, d, c]); else tris.push([a, b, c], [b, d, c]); }
  for (let i = 0; i < nA; i++) tris.push([pts[3][i], pts[3][(i + 1) % nA], apex]);
  tris.forEach(([a, b, c], ti) => { const s = meshShade(a, b, c), foot = ti < nA * 2 && night;
    o.tri(a, b, c, foot ? (X, Y) => (Y & 1) && ih(X >> 1, Y, seed) < .3 ? (ih(X, Y, seed + 1) < .5 ? 'lm.lit' : 'lm.lit2') : keysFn(s) : keysFn(s), tg); });
  if (o.mpp < 2.4) tris.forEach(([a, b, c], ti) => [[a, b], [b, c], [c, a]].forEach(([p, q], ei) => {   // glass seams (only where they fit)
    if (p[2] > 0 || q[2] > 0) o.line(p, q, night ? (ih(ti, ei, seed) < .3 ? 'lm.lit' : 'lm.sailLo') : 'lm.stoneLo', .6, tg); }));
}
function opera2(mpp, k, night){
  const b = lmBox(mpp, k, 210, 43, 160), o = obl(mpp, k, b.W, b.H, b.ox, b.oy);
  const ramp = s => s > .78 ? 'lm.stoneHi' : s > .5 ? 'lm.stone' : 'lm.stoneLo';
  pebble(o, -28, 14, 62, 44, 43, 3, 2, night, ramp);
  pebble(o, 58, -24, 34, 24, 24, 8, 3, night, ramp);
  o.seams('lm.ol'); o.outline('lm.ol');
  return o.bake('opera2');
}
function haixinsha2(mpp, k, night){
  const b = lmBox(mpp, k, 260, 48, 90), o = obl(mpp, k, b.W, b.H, b.ox, b.oy);
  o.prism([[-122, -20], [122, -20], [122, 4], [-122, 4]], 0, 5, q => q.row % 2 ? 'lm.stoneLo' : 'lm.stone', q => (q.Y & 1) ? 'lm.stone' : 'lm.stoneHi', 1);   // stands
  [-92, -30, 32, 94].forEach((cx, si) => {
    // a fin: pinned at the west foot, the curved leading edge sweeps up and back to a high tip over the east foot
    const base = u => [cx - 30 + u * 56, -16 + Math.sin(u * Math.PI) * 3, 3], top = u => [cx - 30 + u * 60, -16 + u * 26, 3 + 42 * Math.pow(Math.sin(u * Math.PI / 2), 1.6)];
    const g = (u, v) => { const a = base(u), c = top(u); return [a[0] + (c[0] - a[0]) * v, a[1] + (c[1] - a[1]) * v, a[2] + (c[2] - a[2]) * v]; }, nu = 10, nv = 3;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++){ const a = g(i / nu, j / nv), bb = g((i + 1) / nu, j / nv), c = g(i / nu, (j + 1) / nv), d = g((i + 1) / nu, (j + 1) / nv);
      const key = j === 0 ? 'lm.sailLo' : 'lm.sail';   // membrane: bright top, shaded foot
      o.tri(a, bb, d, key, 2 + si); o.tri(a, d, c, key, 2 + si); }
    for (let i = 0; i < nu; i++) o.line(g(i / nu, 1), g((i + 1) / nu, 1), night ? 'lm.lit' : 'lm.ribHi', .7, 2 + si);   // leading edge
    for (const u of [.3, .6]) o.line(g(u, 0), g(u, 1), 'lm.rib', .4, 2 + si);                                          // cable lines
  });
  o.seams('lm.ol'); o.outline('lm.ol');
  return o.bake('hxs2');
}
const LM2 = {cantonTower: cantonTower2, ifc: ifc2, ctf: ctf2, opera: opera2, haixinsha: haixinsha2}, LMG = {cantonTower: cantonTower2G};
const lmKey = (id, mpp, kk, night) => ['lm2', id, mpp.toFixed(3), kk, !!night, PX.theme].join('|');
SPR.landmark = (id, mpp, k = SPR.K, night = PX.theme === 'night') => {
  mpp = Math.max(.25, +mpp); const kk = Math.round(k * 100) / 100;
  return cached(lmKey(id, mpp, kk, night), () => LM2[id](mpp, kk, !!night));
};
/* one prebake landmark job → false while a generator one is under way (stepped until `until`; a theme change restarts it) */
const lmGen = new Map();
function lmJob(id, m, k, night, until){
  const mpp = Math.max(.25, +m), kk = Math.round(k * 100) / 100, key = lmKey(id, mpp, kk, night);
  if (memo.has(key)){ lmGen.delete(key); return true; }
  if (!LMG[id]){ memo.set(key, LM2[id](mpp, kk, !!night)); return true; }
  let j = lmGen.get(key); if (!j || j.th !== PX.theme) lmGen.set(key, j = {g: LMG[id](mpp, kk, !!night), th: PX.theme});
  SDL = until; let r; try { r = j.g.next(); } finally { SDL = Infinity; }
  if (!r.done) return false;
  lmGen.delete(key); memo.set(key, r.value); return true;
}

/* SPR.prebake({night, levels, k, types}) → Promise: bakes every vehicle / boat / wake heading and the landmarks at
   each zoom level (metres per art px) in idle-time slices of ≤ 8 ms, so nothing is rasterised mid-ride.
   ~2400 traffic sprites ≈ 0.5 s total; a landmark ≤ 5 ms, the Canton Tower at 2–2.5 m/px 9–15 ms: stepped across slices (stage 1 r4) */
SPR.prebake = (o = {}) => {
  const night = o.night === undefined ? PX.theme === 'night' : o.night, k = o.k === undefined ? SPR.K : o.k, jobs = [];
  for (const t of SPR.VEH_TYPES){ const nc = t === 'taxi' ? 1 : t === 'bus' ? 3 : 6; for (let c = 0; c < nc; c++) for (let h = 0; h < 64; h++) jobs.push(() => SPR.veh(t, c, h, night)); }
  for (const t of SPR.BOAT_TYPES) for (let h = 0; h < 64; h++){ jobs.push(() => SPR.boat(t, h, night)); for (let f = 0; f < 3; f++) jobs.push(() => SPR.wake(t, h, f)); }
  for (const m of o.levels || []) for (const id in LM2) jobs.push(until => lmJob(id, m, k, night, until));
  const idle = window.requestIdleCallback || (f => setTimeout(() => f({timeRemaining: () => 6}), 16));
  return new Promise(res => { let i = 0; const run = d => { const until = performance.now() + Math.min(8, Math.max(2, d.timeRemaining()));
    while (i < jobs.length && performance.now() < until) if (jobs[i](until) !== false) i++;
    if (i < jobs.length) idle(run); else res(jobs.length); }; idle(run); });
};

/* =====================================================================================
   3/4 TREES — canopy lifted above a short trunk, ground shadow falling bottom-right, anchor = trunk foot.
   SPR.trees34[0–3] small round · medium round · big banyan (3 clumps, 2px trunk) · palm; SPR.streetTree34;
   SPR.bushes34[0–1] (low mounds, no trunk). Def sprites (theme-free) like v1 — draw with SPR.put.
   ===================================================================================== */
function tree34(id, clumps, trunk, tw = 1){
  let R = 0; clumps.forEach(([cx, cy, r]) => { R = Math.max(R, Math.hypot(cx, cy) + r); });
  const W = Math.ceil(R * 2) + 6, H = Math.ceil(R * 2 + trunk) + 5, gx = W >> 1, gy = H - 3, ccy = gy - trunk - R + .5;
  const g = grid(W, H), m = new Uint8Array(W * H), owner = new Int8Array(W * H).fill(-1), z = new Float32Array(W * H).fill(-9);
  const ramp = ['green.d1', 'green.d2', 'green.d3', 'green.d4', 'green.hi'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){                        // ground shadow (under everything)
    const dx = (x + .5 - gx - .5 - R * .4) / (R * .85), dy = (y + .5 - gy - .5) / Math.max(1.1, R * .36);
    if (dx * dx + dy * dy <= 1) g.set(x, y, 'shadow');
  }
  for (let y = gy - trunk; y <= gy; y++) for (let j = 0; j < tw; j++) g.set(gx + j - (tw >> 1), y, j === 0 && tw > 1 ? 'tree.trunk' : tw > 1 ? 'tree.trunkLo' : 'tree.trunk');
  if (tw === 1) g.set(gx + 1, gy, 'tree.trunkLo');
  clumps.forEach(([cx, cy, r, lift = 0], ci) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const dx = x + .5 - (gx + .5 + cx), dy = y + .5 - (ccy + cy), d2 = dx * dx + dy * dy; if (d2 > r * r) continue;
      const nz = Math.sqrt(r * r - d2), k = y * W + x, zz = nz + lift - dy * .15;
      m[k] = 1; if (zz <= z[k]) continue; z[k] = zz; owner[k] = ci;
      const b = shade(dx, dy - r * .15, nz);
      g.a[k] = pick(ramp, b < .05 ? 0 : b < .42 ? 1 : b < .72 ? 2 : b < .9 ? 3 : 4);
    }
  });
  const e = PX.maskEdge(m, W, H);
  for (let k = 0; k < m.length; k++){ if (!m[k]) continue; if (e[k]){ g.a[k] = 'green.d0'; continue; }
    const x = k % W, y = (k / W) | 0;
    for (const [ox, oy] of [[-1, 0], [0, -1]]){ const j = (y + oy) * W + x + ox; if (owner[j] >= 0 && owner[j] !== owner[k] && z[j] > z[k] + .5){ g.a[k] = 'green.d1'; break; } } }
  return toSprite(id, g, gx, gy);
}
function palm34(){
  const W = 15, H = 17, gx = 7, gy = 14, top = [gx + 1, gy - 7], g = grid(W, H), m = new Uint8Array(W * H);
  for (let y = gy; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 4; x++) if (Math.abs(x - gx - 1.5) + (y - gy) * 2 < 3.5) g.set(x, y, 'shadow');
  for (let j = 0; j <= 6; j++){ const y = gy - j, x = gx + (j >= 4 ? 1 : 0); g.set(x, y, j % 2 ? 'tree.trunkLo' : 'tree.trunk'); }
  for (let f = 0; f < 7; f++){
    const a = f / 7 * TAU - .3, dx = Math.cos(a), dy = Math.sin(a) * .7, droop = 1.6;
    const fm = PX.mask(W, H, gg => { gg.beginPath(); gg.moveTo(top[0] + .5, top[1] + .5);
      gg.quadraticCurveTo(top[0] + .5 + dx * 3, top[1] + .5 + dy * 3 - 1.2, top[0] + .5 + dx * 5.4, top[1] + .5 + dy * 5.4 + droop);
      gg.lineWidth = 1.9; gg.lineCap = 'round'; gg.stroke(); });
    const b = shade(dx, dy, .8);
    for (let k = 0; k < fm.length; k++) if (fm[k] && !m[k]){ const x = k % W, y = (k / W) | 0, d = Math.hypot(x - top[0], y - top[1]);
      m[k] = 1; g.a[k] = b > .55 ? (d < 3 ? 'green.hi' : 'green.d4') : b > .15 ? (d < 3 ? 'green.d4' : 'green.d3') : (d < 3 ? 'green.d3' : 'green.d2'); }
  }
  g.set(top[0], top[1], 'green.d1');
  const e = PX.maskEdge(m, W, H); for (let k = 0; k < m.length; k++) if (e[k]) g.a[k] = 'green.d0';
  return toSprite('palm34', g, gx, gy);
}
SPR.trees34 = [
  tree34('t34a', [[0, 0, 2.7]], 1),
  tree34('t34b', [[0, 0, 3.7]], 2),
  tree34('t34c', [[-1.6, .6, 3.3], [1.9, .8, 3.1], [0, -1.2, 3.1, .6]], 2, 2),
  palm34(),
];
SPR.streetTree34 = tree34('st34', [[0, 0, 2.2]], 1);
SPR.bushes34 = [tree34('b34a', [[-.9, 0, 1.7], [.9, 0, 1.6]], 0), tree34('b34b', [[-1.6, .2, 1.8], [0, -.3, 1.9, .3], [1.6, .2, 1.7]], 0)];

window.SPR = SPR;
})();
