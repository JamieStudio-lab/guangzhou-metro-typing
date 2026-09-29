/* weather.js — WEATHER (v3): rain now and then, Guangzhou style. Pixel rules as everywhere (one art canvas, integer pixels,
   palette colours only — PX.audit stays 0 — no alpha, no smoothing). Needs pixel.js, palette.js (rain.* keys), geom.js,
   world.js (read-only lookups: WORLD.ready / groundAt / coveredAt). Global WEATHER. Classic script, no deps, file://.
   What it draws (only while it rains or the ground is still wet — a dry frame costs nothing):
   · drawGround (after the ground bake, before traffic): splash crowns (2 frames) on roads / pavements, rain rings (4 frames,
     flattened for the oblique view) on the river, puddles that grow with the spell and dry after it (sky glint, warm near a
     lamp), and at night the wet street mirroring the city: short dithered vertical streaks under the street lamps, longer broken
     ones on the river under the quay lamps, and one clean 2–4 px dash per window-column group under the lit facades (mirrored about
     the facade's foot, ≤ 40 per chunk). All world-anchored (level px), so they
     scroll with the map; the structure layer and traffic drawn later occlude them naturally.
   · drawSky (after the structure bake, before the line / train / labels): the WET PALETTE SWAP — every map colour turns into its
     rain.wet twin (palette.js: a fixed darker / cooler curve), on while the ground is wet (wet > 0.1), switched through a
     world-anchored 4×4 Bayer dither over ~1.5 s only (frozen to on/off mid-zoom; never alpha), lights (lamps, windows, beams,
     tower LEDs) excluded so they glow harder in the rain — then splashes on the roofs, then the falling rain: short streaks on a
     1:2 slant (near: 4 px head + tail, 6 px at peak; far: 2 px, slower), density by intensity (super-linear above 0.7: ×1.8 at
     1), a warm tint where a drop crosses a lamp pool at night. By day a dark slate head with a light tip pixel, ×1.5 density
     (review round 1: the light streaks vanished on the light city). Rain moves with the camera (the
     drops live in the world, not on the lens).
   Spells ('auto'): deterministic from the seed — the first 30–60 s into play, then every 1.5–4 min, each 40–90 s, peak
   0.4–1 (the first one heavy), fading in / out over ~5 s with a slow gust wobble; the ground dries ~20 s behind the sky.
   API (the v3 WEATHER contract + extras):
   WEATHER.init(d = PX.D, seed = 7)    reset the clock, schedule and caches
   WEATHER.update(dt, view, mode)      mode 'auto' | 'clear' | 'rain': advances the play clock (dt = 0 → frozen), the eased
                                       intensity WEATHER.rain 0..1, the ground wetness WEATHER.wet 0..1 and the camera drift
   WEATHER.drawGround(g, view)         see above
   WEATHER.drawSky(g, view)            see above
   WEATHER.drawOver(g, view)           after the line + the train: the tails of every 4th near drop drawSky drew (review round 2)
   WEATHER.warm(view, ms = 1.5)        build the effect chunks that view needs (main.js: a zoom's target level) within ms
   WEATHER.tint(key) → key             the rain.wet twin of a palette key (the key itself for lights / keys without a twin)
   WEATHER.rain, WEATHER.wet           0..1 (eased)
   WEATHER.spell                       {active, t0, t1, peak}: the current spell, or the next one while dry (play-clock s)
   WEATHER.seek(rainT, mode?)          deterministic captures: 'auto' → the clock rainT s into the FIRST spell; 'rain' → rainT s
                                       after switching it on; 'clear' → rainT s after switching it off. Snaps rain / wet (no lag).
   WEATHER.peak                        intensity of the forced 'rain' mode (default .85)
   WEATHER.wetFx                       true (default): the wet palette swap (drawSky's full-frame read / write); false (the ride's frame
                                       governor, level 1): no swap, no window mirrors, no warm drops — splashes, drops, rings, puddles and
                                       lamp streaks stay, the drops then drawn as 1 px rects (no frame readback)
   WEATHER.budget                      ms per frame for building the world-anchored effect caches (default 0.6; Infinity =
                                       build everything in the first frame — use it for captures)
   WEATHER.stats                       {ms, msG, msS, chunks, drops}: last frame's cost (ms) and counts
   WEATHER.dirty(lvl, k, X0, Y0, n)    forget the effect chunks over level px [X0, X0 + n)² (world.js calls it when it rebakes a render tile
                                       for late map data: the ground / structure maps the chunks were read from changed) */
(function(){
const hash = GEOM.hash;
const WEATHER = {rain: 0, wet: 0, veil: 0, mode: 'auto', T: 0, peak: .85, budget: .6, wetFx: true, spell: {active: false, t0: 0, t1: 0, peak: 0},
  stats: {ms: 0, msG: 0, msS: 0, chunks: 0, drops: 0}};
let seed = 7, SP = [], lv = 0, camX = 0, camY = 0, prevCam = null, fc = 0, prime = 0;
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ---------- the spell schedule (play clock, deterministic) ---------- */
function schedule(upto){
  while (!SP.length || SP[SP.length - 1][1] < upto + 300){
    const n = SP.length, r = i => hash(seed, n, 30 + i), end = n ? SP[n - 1][1] : 0;
    const t0 = n ? end + 90 + r(1) * 150 : 30 + r(1) * 30, dur = 40 + r(2) * 50, peak = n ? .4 + r(3) * .6 : .9;
    SP.push([t0, t0 + dur, peak, r(4) * 6.28]);
  }
}
function scheduled(T){
  schedule(T);
  for (const s of SP){ if (T < s[0]) break; if (T < s[1]){ const u = T - s[0];
    return clamp(s[2] * smooth(u / 5) * smooth((s[1] - T) / 5) * (1 + .1 * Math.sin(u * .45 + s[3])), 0, 1); } }
  return 0;
}
const target = mode => mode === 'rain' ? WEATHER.peak : mode === 'clear' ? 0 : scheduled(WEATHER.T);
/* one clock step: lv chases the target (≤ 0.22/s → a ~5 s fade on a mode switch), the ground wets fast and dries slowly */
function step(dt, mode){
  const tg = target(mode), r = .22 * dt;
  lv = mode === 'auto' && Math.abs(tg - lv) <= r * 1.6 ? tg : lv + clamp(tg - lv, -r, r);
  const w = WEATHER.wet;
  /* wets fast; dries slowly after an 'auto' spell (the after-rain look), fast when switched to 'clear' by hand (review round 2: the owner
     comparing Rain ↔ Clear saw a dark wet map for ~45 s) */
  WEATHER.wet = clamp(w + (lv - w) * Math.min(1, dt / (lv > w ? 3 : mode === 'clear' ? 2.5 : 20)), 0, 1);
  if (lv === 0 && WEATHER.wet < .02) WEATHER.wet = 0;
  WEATHER.rain = lv;
}
function spellInfo(){
  if (WEATHER.mode === 'rain') return {active: true, t0: 0, t1: Infinity, peak: WEATHER.peak};
  if (WEATHER.mode === 'clear') return {active: false, t0: 0, t1: 0, peak: 0};
  schedule(WEATHER.T); const T = WEATHER.T, s = SP.find(s => T < s[1]) || SP[SP.length - 1];
  return {active: T >= s[0] && T < s[1], t0: s[0], t1: s[1], peak: s[2]};
}
WEATHER.init = (d = PX.D, sd = 7) => {
  seed = sd | 0; SP = []; lv = 0; WEATHER.T = 0; WEATHER.rain = WEATHER.wet = WEATHER.veil = 0; camX = camY = 0; prevCam = null;
  caches.clear(); schedule(0); WEATHER.spell = spellInfo();
};
WEATHER.update = (dt, v, mode) => {
  WEATHER.mode = mode || WEATHER.mode || 'auto'; fc++;
  dt = Math.max(0, Math.min(dt || 0, .25));
  if (dt > 0){ WEATHER.T += dt; step(dt, WEATHER.mode); }
  else if (WEATHER.mode === 'clear' && lv === 0) WEATHER.rain = 0;
  if (v){ const c = {cx: v.cx, cy: v.cy, mpp: v.mpp};
    if (prevCam){ const dx = (c.cx - prevCam.cx) / c.mpp, dy = -(c.cy - prevCam.cy) / c.mpp;
      if (Math.abs(dx) < 4000 && Math.abs(dy) < 4000){ camX += dx; camY += dy; } }
    prevCam = c; }
  /* the wet palette swap is ON while the ground is wet (wet > 0.1) and switches through the Bayer dither over ~1.5 s only
     (review round 1: no minute-long half-tone while drying — the puddles and lamp streaks carry the drying look) */
  /* review round 2: switched ON over 1.5 s, OFF over 4.5 s (it read as a flicker / 'the sun came out' mid-hop in 1.5 s) */
  if (dt > 0) WEATHER.veil = clamp(WEATHER.veil + clamp((WEATHER.wet > .1 ? 1 : 0) - WEATHER.veil, -dt / 4.5, dt / 1.5), 0, 1);
  WEATHER.spell = spellInfo();
};
WEATHER.seek = (sec, mode = WEATHER.mode) => {
  WEATHER.mode = mode; sec = Math.max(0, sec);
  let T0;
  if (mode === 'auto'){ schedule(0); T0 = SP[0][0] - 1; lv = 0; WEATHER.wet = 0; }
  else { T0 = WEATHER.T; lv = mode === 'rain' ? 0 : WEATHER.peak; WEATHER.wet = mode === 'rain' ? 0 : WEATHER.peak; }
  WEATHER.T = T0; const end = mode === 'auto' ? SP[0][0] + sec : T0 + sec;
  while (WEATHER.T < end - 1e-9){ const d = Math.min(.1, end - WEATHER.T); WEATHER.T += d; step(d, mode); }
  WEATHER.veil = WEATHER.wet > .1 ? 1 : 0; WEATHER.spell = spellInfo(); prime = 3;   // the next 3 frames build their caches in full
};

/* ---------- palette: the wet swap table (by colour), protected lights, effect colours ---------- */
const LIGHTS = {night: ['win', 'lamp', 'road.lit', 'wnd.lit1', 'wnd.lit2', 'wnd.cool', 'veh.head', 'veh.head2', 'veh.tail', 'veh.sign', 'veh.beam1',
    'veh.beam2', 'veh.busWin', 'boat.light', 'boat.win', 'boat.winHi', 'boat.led1', 'boat.led2', 'boat.led3', 'boat.red', 'boat.green', 'water.glint',
    'tower.d2', 'tower.d3', 'tower.d4', 'tower.hi', 'tower.top', 'tower.lilac', 'tower.violet', 'tower.glow', 'tower.glow2', 'tower.beacon',
    'lm.lit', 'lm.lit2', 'lm.cool', 'lm.crown', 'car.glassHi'],
  day: ['veh.tail', 'boat.red', 'boat.green', 'tower.beacon']};
const RAINFX = ['near', 'nearLo', 'far', 'tip', 'splash', 'splash2', 'puddle', 'puddleLo', 'glint', 'glintWarm'];
const le32 = hex => { const c = PX.rgb(hex); return (0xff000000 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0; };
const HS = 2048, HK = new Uint32Array(HS), HV = new Uint32Array(HS);               // (open-addressing fallback for index collisions)
const I18 = p => ((p & 0xfc) << 10) | ((p >>> 4) & 0xfc0) | ((p >>> 18) & 0x3f), T18 = new Int16Array(1 << 18), TK = new Uint32Array(512), TV = new Uint32Array(512);
let palTheme = null, C = null;
function palette(){
  if (palTheme === PX.theme && C) return C;
  palTheme = PX.theme; HK.fill(0); HV.fill(0); T18.fill(-1);
  const P = PX.pal, walk = (o, p, f) => { for (const k in o){ const v = o[k], q = p ? p + '.' + k : k; if (typeof v === 'string') f(q, v); else walk(v, q, f); } };
  const prot = new Set();
  for (const key of LIGHTS[PX.theme] || []){ const v = key.split('.').reduce((o, k) => o && o[k], P); if (!v) continue;
    if (typeof v === 'string') prot.add(v.toLowerCase()); else walk(v, '', (q, h) => prot.add(h.toLowerCase())); }
  for (const k of RAINFX) prot.add(P.rain[k].toLowerCase());
  const map = new Map(), tintK = new Map();
  for (const f in P.rain.wet){ const src = f.split('_').reduce((o, k) => o && o[k], P); if (typeof src !== 'string') continue;   // (paths with '_' in a key are skipped)
    const s = src.toLowerCase(); if (prot.has(s)) continue;
    tintK.set(f.replace(/_/g, '.'), 'rain.wet.' + f);
    if (!map.has(s)) map.set(s, P.rain.wet[f].toLowerCase()); }
  let n = 0;
  for (const [s, d] of map){ if (s === d) continue; const p = le32(s), q = le32(d), ix = I18(p);
    if (T18[ix] === -1 && n < 512){ T18[ix] = n; TK[n] = p; TV[n] = q; n++; continue; }
    if (T18[ix] >= 0) T18[ix] = -2;                                                     // collision: this slot goes through the hash
    let h = Math.imul(p, 0x9E3779B1) >>> 21; while (HK[h]) h = (h + 1) & (HS - 1); HK[h] = p; HV[h] = q; }
  for (let i = 0; i < n; i++) if (T18[I18(TK[i])] === -2){ const p = TK[i]; let h = Math.imul(p, 0x9E3779B1) >>> 21; while (HK[h]) h = (h + 1) & (HS - 1); HK[h] = p; HV[h] = TV[i]; }
  const col = k => PX.col(k), u = k => le32(PX.col(k));
  C = {tintK, n: map.size,
    near: u('rain.near'), nearLo: u('rain.nearLo'), far: u('rain.far'), tip: u('rain.tip'), splashU: u('rain.splash'), splash2U: u('rain.splash2'),
    warm: u('win.orange'), warmLo: u('win.warm'),
    warmSet: new Set(PX.theme === 'night' ? ['lamp.glow1', 'lamp.glow2', 'lamp.glow3', 'road.lit', 'lamp.head'].map(u) : []),
    lampU: u('lamp.head'),
    litU: new Map(PX.theme === 'night' ? [['wnd.lit2', 0], ['win.amber', 0], ['win.hot', 0], ['wnd.lit1', 1], ['win.orange', 1], ['wnd.cool', 2], ['win.cool', 2]].map(([k, i]) => [u(k), i]) : []),
    splash: col('rain.splash'), splash2: col('rain.splash2'), puddle: col('rain.puddle'), puddleLo: col('rain.puddleLo'), glint: col('rain.glint'), glintWarm: col('rain.glintWarm'), warmPud: col('lamp.glow1'), warmPudHi: col('lamp.glow2'),
    ring: PX.theme === 'night' ? [col('rain.ring'), col('rain.ring'), col('rain.ring2'), col('rain.ring3')] : [col('rain.ring'), col('rain.ring2'), col('rain.ring2'), col('rain.ring3')],   // day: no white cross
    refl: [col('win.orange'), col('win.warm'), col('win.dim'), col('lamp.glow1')],
    wrefl: [col('win.orange'), col('win.warm'), col('rain.nearLo')], wreflLo: [col('win.warm'), col('win.dim'), col('rain.far')]};
  return C;
}
WEATHER.tint = key => { const c = palette(); return c.tintK.get(key) || key; };

/* ---------- world-anchored effect caches: 64² level-px chunks per theme|lvl|k ----------
   chunk = {X0, Y0, g: ground candidates built (via WORLD lookups on a chunk-sized view), sp: splash [X, Y, roof, h],
   rg: ring [X, Y, h], pd: puddle [X, Y, w, h2, thr, gx, warm], lm: lamp streaks [X, Y, len], wr: window reflections [X, Y, c, d, thr],
   lampA / winA: screen area already scanned for lamps (ground read) / lit windows (structure read)} */
const CH = 64, caches = new Map(), budget = () => prime > 0 ? Infinity : WEATHER.budget;
function cacheFor(v){
  const key = PX.theme + '|' + v.lvl + '|' + v.k; let c = caches.get(key);
  if (!c){ c = new Map(); caches.set(key, c); if (caches.size > 8) caches.delete(caches.keys().next().value); }
  if (c.size > 900) c.clear();
  return c;
}
function chunksOf(v, c){
  const out = [], x0 = Math.floor(Math.floor(v.ox) / CH), y0 = Math.floor(Math.floor(v.oy) / CH), x1 = Math.floor((v.ox + v.W / v.zs) / CH), y1 = Math.floor((v.oy + v.H / v.zs) / CH);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++){ const k = cx * 100003 + cy; let ch = c.get(k);
    if (!ch){ ch = {X0: cx * CH, Y0: cy * CH, g: false, sp: [], rg: [], pd: [], lm: [], lw: [], wr: [], lampA: 0, winA: 0, lset: new Set(), wset: new Set(), wg: new Set()}; c.set(k, ch); }
    out.push(ch); }
  return out;
}
const miniView = (ch, v) => GEOM.view({lvl: v.lvl, k: v.k, cx: ch.X0 * v.lvl, cy: -ch.Y0 * v.lvl, ax: 0, ay: 0, W: CH, H: CH, theme: PX.theme});
function buildGround(ch, v){
  const mv = miniView(ch, v); if (!WORLD.ready(mv)) return false;
  const lvl = v.lvl, st = lvl <= 5, city = lvl > 16, G = WORLD.G, X0 = ch.X0, Y0 = ch.Y0;
  ch.g = true; ch.mv = mv; if (city) return true;
  const cls = (x, y) => WORLD.coveredAt(x, y, mv) ? 9 : WORLD.groundAt(x, y, mv);
  const S = st ? (lvl <= 3.2 ? 5 : 6) : 7;
  for (let j = 0; j < CH; j += S) for (let i = 0; i < CH; i += S){
    const X = X0 + i, Y = Y0 + j, x = i + Math.floor(hash(X, Y, 301) * S), y = j + Math.floor(hash(X, Y, 302) * S); if (x >= CH || y >= CH) continue;
    const c = cls(x, y), h = hash(X0 + x, Y0 + y, 303);
    if (c === G.WATER){ if (h < (st ? .55 : .3)) ch.rg.push(X0 + x, Y0 + y, h); }
    else if (c === 9){ if (st && h < .35) ch.sp.push(X0 + x, Y0 + y, 1, h); }
    else if (c === G.ROAD || c === G.DECK){ if (h < .6) ch.sp.push(X0 + x, Y0 + y, 0, h); }
    else if (h < .3) ch.sp.push(X0 + x, Y0 + y, 2, h);                                  // open ground (parks too): a dimmer splash
  }
  if (lvl <= 4){                                                                        // puddles on the carriageway
    const PS = 12;
    for (let j = 0; j < CH; j += PS) for (let i = 0; i < CH; i += PS){
      const X = X0 + i, Y = Y0 + j; if (hash(X, Y, 311) > .55) continue;
      const w = 3 + Math.floor(hash(X, Y, 312) * 4), h2 = w >= 5 ? 2 : 1, x = i + Math.floor(hash(X, Y, 313) * (PS - w)), y = j + Math.floor(hash(X, Y, 314) * (PS - 2));
      let ok = x + w <= CH + 8;
      for (let r = 0; ok && r < h2; r++) for (let q = (h2 === 2 && r === 0 ? 1 : 0); q < (h2 === 2 && r === 0 ? w - 1 : w); q++) if (cls(x + q, y + r) !== G.ROAD){ ok = false; break; }
      if (!ok) continue;
      if (h2 === 1 ? cls(x - 1, y) !== G.ROAD || cls(x + w, y) !== G.ROAD : false) continue;
      ch.pd.push(X0 + x, Y0 + y, w, h2, .25 + hash(X, Y, 315) * .6, (h2 === 2 ? 1 : 0) + Math.floor(hash(X, Y, 316) * (w - (h2 === 2 ? 2 : 0))), 0);
    }
  }
  return true;
}
/* visible part of a chunk on the screen (rest views only), as a screen rect */
const visRect = (ch, v) => { const x0 = Math.max(0, ch.X0 - v.ox), y0 = Math.max(0, ch.Y0 - v.oy), x1 = Math.min(v.W, ch.X0 + CH - v.ox), y1 = Math.min(v.H, ch.Y0 + CH - v.oy);
  return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0, a: (x1 - x0) * (y1 - y0)} : null; };
/* night street tier: the lamps of the ground layer (every lamp.head pixel there is a street / quay / parapet lamp) */
function scanLamps(ch, v, d, bw, bx, by, r, pal){
  const mv = ch.mv, G = WORLD.G, L = clamp(Math.round(22 / v.lvl), 4, 9);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++){ if (d[(y - by) * bw + x - bx] !== pal.lampU) continue;
    const X = v.ox + x, Y = v.oy + y, k = X * 65536 + Y; if (ch.lset.has(k)) continue; ch.lset.add(k);
    let n = 0, wq = 0; for (let q = 1; q <= L; q++){ const lx = X - ch.X0, ly = Y + q - ch.Y0; if (WORLD.coveredAt(lx, ly, mv)) break; if (WORLD.groundAt(lx, ly, mv) === G.WATER){ wq = q; break; } n = q; }
    if (n >= 2) ch.lm.push(X, Y, n);
    /* a quay lamp over the river: a longer, broken streak on the water (review round 1) */
    if (wq && wq <= 3){ const Lw = clamp(Math.round(34 / v.lvl), 4, 8); let m = 0;
      for (let q = wq; q < wq + Lw; q++){ const lx = X - ch.X0, ly = Y + q - ch.Y0; if (WORLD.coveredAt(lx, ly, mv) || WORLD.groundAt(lx, ly, mv) !== G.WATER) break; m++; }
      if (m >= 3) ch.lw.push(X, Y + wq, m); }
    for (let j = 0; j < ch.pd.length; j += 7) if (Math.abs(ch.pd[j] - X) < 9 && ch.pd[j + 1] - Y >= -2 && ch.pd[j + 1] - Y < 10) ch.pd[j + 6] = 1;   // a lamp warms the puddle's glint
  }
  ch.lampA = r.a;
}
/* night street tier: lit facade windows (structure pixels) mirror onto the wet ground in front of the facade's foot */
function scanWindows(ch, v, d, r, pal){
  const W = v.W, G = WORLD.G, maxD = clamp(Math.round(26 / v.lvl), 4, 11);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++){
    const c = pal.litU.get(d[y * W + x]); if (c === undefined) continue;
    const X = v.ox + x, Y = v.oy + y, k = X * 65536 + Y; if (ch.wset.has(k)) continue; ch.wset.add(k);
    if (!WORLD.coveredAt(x, y, v)) continue;
    let b = y + 1; while (b - y <= maxD && WORLD.coveredAt(x, b, v)) b++;
    const dd = b - y; if (dd > maxD) continue;
    const ty = b + dd - 1, gk = (X >> 2) * 65536 + v.oy + b; if (ch.wg.has(gk) || ch.wr.length >= 5 * 40) continue;   // one per 4-column group per facade foot
    if (hash(X, ty, 321) > 1.15 - dd / maxD) continue;
    if (WORLD.coveredAt(x, ty, v)) continue; const gc = WORLD.groundAt(x, ty, v); if (gc === G.WATER) continue;
    ch.wg.add(gk); ch.wr.push(X, v.oy + ty, c, dd <= maxD / 2 ? 2 + Math.floor(hash(X, ty, 323) * 3) : 2, .15 + hash(X, ty, 322) * .6);
  }
  ch.winA = r.a;
}

/* ---------- drawGround ---------- */
WEATHER.drawGround = (g, v) => {
  const t0 = performance.now(); WEATHER.stats.msG = 0;
  if (!(WEATHER.rain > 0 || WEATHER.wet > 0) || !window.WORLD || !WORLD.ready) return;
  const pal = palette(), c = cacheFor(v), chs = chunksOf(v, c), st = v.lvl <= 5, night = v.night, T = WEATHER.T, R = WEATHER.rain, wet = WEATHER.wet;
  const until = t0 + budget();
  for (const ch of chs) if (!ch.g && performance.now() < until) buildGround(ch, v);
  /* lamps: one read of the ground layer over the chunks that gained screen area (every 4th frame; captures: at once) */
  if (v.rest && night && st && (budget() === Infinity || (fc & 3) === 0)){
    const need = []; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const ch of chs){ if (!ch.g) continue; const r = visRect(ch, v); if (r && r.a > ch.lampA){ need.push([ch, r]); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); } }
    if (need.length){ const d = new Uint32Array(g.getImageData(x0, y0, x1 - x0, y1 - y0).data.buffer);
      for (const [ch, r] of need){ if (performance.now() >= until) break; scanLamps(ch, v, d, x1 - x0, x0, y0, r, pal); } }
  }
  const sx = X => v.sx(X), sy = Y => v.sy(Y), W = v.W, H = v.H, on = (x, y) => x >= -2 && y >= -2 && x < W + 2 && y < H + 2;
  const Q = new Map(), put = (col, x, y, w = 1) => { let a = Q.get(col); if (!a) Q.set(col, a = []); a.push(x, y, w); };
  const fr2 = Math.floor(T * 3) & 1;
  for (const ch of chs){ if (!ch.g) continue;
    /* puddles (grow with the wetness, dry in reverse order) */
    const P = ch.pd;
    for (let j = 0; j < P.length; j += 7){ if (wet < P[j + 4]) continue; const x = sx(P[j]), y = sy(P[j + 1]), w = P[j + 2], h2 = P[j + 3]; if (!on(x, y)) continue;
      const dry = wet < P[j + 4] + .08;                                                  // a puddle just forming / drying: a thin film
      const warm = P[j + 6] && night, body = dry ? (warm ? pal.warmPud : pal.puddleLo) : (warm ? pal.warmPudHi : pal.puddle), rim = warm ? pal.warmPud : pal.puddleLo;
      if (h2 === 2){ put(body, x + 1, y, w - 2); put(rim, x, y + 1, 1); put(body, x + 1, y + 1, w - 2); put(rim, x + w - 1, y + 1, 1); }
      else put(body, x, y, w);
      if (!dry && hash(P[j], P[j + 1], Math.floor(T * .8 + hash(P[j], 0, 317) * 5)) < .8) put(P[j + 6] && night ? pal.glintWarm : pal.glint, x + P[j + 5], y, 1); }
    /* night: lamp streaks and window reflections on the wet street */
    if (night && st){
      const Lm = ch.lm, k = Math.min(1, wet * 1.6);
      for (let j = 0; j < Lm.length; j += 3){ const x = sx(Lm[j]), y = sy(Lm[j + 1]), n = Math.round(Lm[j + 2] * k); if (!on(x, y + n)) continue;
        for (let q = 1; q <= n; q++){ if (q > 2 && ((q + fr2 + Lm[j]) & 1)) continue; put(pal.refl[Math.min(3, Math.floor((q - 1) * 4 / Math.max(3, n)))], x, y + q, 1); } }
      const Lw = ch.lw;                                                                   // quay lamps on the river: broken, shimmering
      for (let j = 0; j < Lw.length; j += 3){ const x = sx(Lw[j]), y = sy(Lw[j + 1]), n = Math.round(Lw[j + 2] * k); if (!on(x, y + n)) continue;
        for (let q = 0; q < n; q++){ if ((q + fr2) & 1) continue; put(pal.refl[Math.min(3, 1 + Math.floor(q * 3 / Math.max(3, n)))], x, y + q, 1); } }
      const Wr = ch.wr;                                                                   // lit windows: a clean solid dash, 2–4 px
      for (let j = 0; j < Wr.length; j += 5){ if (wet < Wr[j + 4]) continue; const x = sx(Wr[j]), y = sy(Wr[j + 1]); if (!on(x, y)) continue;
        const n = Wr[j + 3]; put(pal.wrefl[Wr[j + 2]], x, y, 1); for (let q = 1; q < n; q++) put(pal.wreflLo[Wr[j + 2]], x, y + q, 1); }
    }
    if (!(R > 0)) continue;
    /* splash crowns: frame 0 a dot, frame 1 two droplets (street); district: a dot */
    const S = ch.sp, dens = R * (st ? .5 : .35);
    for (let j = 0; j < S.length; j += 4){ const kd = S[j + 2]; if (kd === 1) continue; const h = S[j + 3], per = .45 + h * .5, u = T / per + h * 7, n = Math.floor(u), f = (u - n) * per;
      if (f >= .15 || hash(S[j], S[j + 1], n) > dens) continue; const x = sx(S[j]), y = sy(S[j + 1]); if (!on(x, y)) continue;
      if (f < .075 || !st) put(st && !kd ? pal.splash : pal.splash2, x, y, 1); else if (!kd){ put(pal.splash2, x - 1, y - 1, 1); put(pal.splash2, x + 1, y - 1, 1); } }
    /* rain rings on the river: dot → cross → flat ring → broken wide ring */
    const Rg = ch.rg, rd = R * (st ? .6 : .4);
    for (let j = 0; j < Rg.length; j += 3){ const h = Rg[j + 2], per = .9 + h * 1.3, u = T / per + h * 11, n = Math.floor(u), f = (u - n) * per, fi = Math.floor(f / .1);
      if (fi > (st ? 3 : 1) || hash(Rg[j], Rg[j + 1], n) > rd) continue; const x = sx(Rg[j]), y = sy(Rg[j + 1]); if (!on(x, y)) continue;
      const col = pal.ring[fi];
      for (const [dx, dy] of RING[fi]) put(col, x + dx, y + dy, 1); }
  }
  for (const [col, a] of Q){ g.fillStyle = col; for (let i = 0; i < a.length; i += 3) g.fillRect(a[i], a[i + 1], a[i + 2], 1); }
  WEATHER.stats.chunks = chs.length;
  WEATHER.stats.msG = performance.now() - t0;
};
const RING = [[[0, 0]], [[-1, 0], [1, 0], [0, -1], [0, 1]], [[-2, 0], [2, 0], [-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]],
  [[-3, 0], [3, 0], [-2, -1], [2, -1], [-2, 1], [2, 1], [0, -1], [0, 1]]];

/* ---------- drawSky: wet palette swap (dithered), roof splashes, falling rain ---------- */
/* the swap loops (top-level functions so they optimise well): 18-bit colour index → table slot, exact-match check */
const slowSwap = p => { let h = Math.imul(p, 0x9E3779B1) >>> 21; for (;;){ const k = HK[h]; if (k === p) return HV[h]; if (!k) return p; h = (h + 1) & (HS - 1); } };
function swapFull(d, n){
  for (let i = 0; i < n; i++){ const p = d[i], s = T18[((p & 0xfc) << 10) | ((p >>> 4) & 0xfc0) | ((p >>> 18) & 0x3f)];
    if (s >= 0){ if (TK[s] === p) d[i] = TV[s]; } else if (s === -2) d[i] = slowSwap(p); }
}
function swapDither(d, W, H, ox, oy, veil){
  for (let y = 0, i = 0; y < H; y++){ const rb = ((y + oy) & 3) << 2;
    for (let x = 0; x < W; x++, i++){ if (B4[rb | ((x + ox) & 3)] >= veil) continue; const p = d[i], s = T18[((p & 0xfc) << 10) | ((p >>> 4) & 0xfc0) | ((p >>> 18) & 0x3f)];
      if (s >= 0){ if (TK[s] === p) d[i] = TV[s]; } else if (s === -2) d[i] = slowSwap(p); } }
}
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(b => (b + .5) / 16);
let img = null, over = null, overC = null;
WEATHER.drawSky = (g, v) => {
  const t0 = performance.now(); WEATHER.stats.msS = 0; WEATHER.stats.drops = 0; over = null;
  const R = WEATHER.rain, fx = WEATHER.wetFx !== false; let veil = fx ? WEATHER.veil : 0; if (!(R > 0 || veil > 0)) return;
  if (!v.rest && veil > 0 && veil < 1) veil = veil >= .5 ? 1 : 0;                      // no half-tone crawling during a zoom
  const pal = palette(), W = v.W, H = v.H, st = v.lvl <= 5, T = WEATHER.T;
  let d = null, PQ = null;                                                              // (no wetFx: the drops go into per-colour rect lists)
  if (fx){ img = g.getImageData(0, 0, W, H); d = new Uint32Array(img.data.buffer); } else PQ = new Map();
  /* (night street tier) read the lit windows of the finished structure layer before anything changes a pixel */
  if (fx && v.rest && v.night && st && window.WORLD && WORLD.coveredAt){
    const until = t0 + budget(), chs = (budget() === Infinity || (fc & 3) === 2) ? chunksOf(v, cacheFor(v)) : [];
    for (const ch of chs){ if (!ch.g || performance.now() >= until) continue; const r = visRect(ch, v); if (r && r.a > ch.winA) scanWindows(ch, v, d, r, pal); }
  }
  const t1 = performance.now(); WEATHER.stats.scan = t1 - t0;
  /* 1. the wet swap: world-anchored Bayer threshold (full at veil 1) */
  if (veil > 0 && pal.n){
    const full = veil >= 1, ox = Math.round(v.ox * v.zs) & 3, oy = Math.round(v.oy * v.zs) & 3;
    if (full) swapFull(d, W * H); else swapDither(d, W, H, ox, oy, veil);
  }
  const t2 = performance.now(); WEATHER.stats.swap = t2 - t1;
  if (R > 0){
    const set = fx ? (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) d[y * W + x] = c; }
      : (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H){ let a = PQ.get(c); if (!a) PQ.set(c, a = []); a.push(x, y); } };
    /* 2. splashes on roofs (structure pixels) */
    if (st){ const c = cacheFor(v), chs = chunksOf(v, c), dens = R * .45;
      for (const ch of chs){ if (!ch.g) continue; const S = ch.sp;
        for (let j = 0; j < S.length; j += 4){ if (S[j + 2] !== 1) continue; const h = S[j + 3], per = .45 + h * .5, u = T / per + h * 7, n = Math.floor(u), f = (u - n) * per;
          if (f >= .15 || hash(S[j], S[j + 1], n) > dens) continue; const x = v.sx(S[j]), y = v.sy(S[j + 1]);
          if (f < .075) set(x, y, pal.splashU); else { set(x - 1, y - 1, pal.splash2U); set(x + 1, y - 1, pal.splash2U); } } } }
    /* 3. falling rain: drops live in a world-anchored (camera-drift) wrap domain, re-seeded every fall cycle */
    /* density: super-linear above 0.7 (×1.8 at 1: a Guangzhou downpour), ×1.5 by day (dark streaks on a light city are sparser to the eye) */
    /* review round 2: by day a light spell (peak 0.4–0.5) was barely there — the drops are drawn as if its peak were ≥ 0.6 (the fades
       keep their shape: the intensity is scaled, not floored) */
    const sp = WEATHER.spell || {}, Rd = !v.night && WEATHER.mode === 'auto' && sp.peak > 0 ? Math.min(1, R * Math.max(1, .6 / sp.peak)) : R;
    const boost = (Rd > .7 ? 1 + (Rd - .7) / .3 * .8 : 1) * (v.night ? 1 : 1.5);
    const PADR = 8, Dw = W + PADR * 2, Dh = H + PADR * 2, area = W * H, nN = Math.round(area * .0015 * Rd * boost), nF = Math.round(area * .0022 * Rd * boost), day = !v.night;
    const cx = Math.round(camX), cy = Math.round(camY), warm = fx && v.night && pal.warmSet.size; over = []; overC = [pal.nearLo, pal.warmLo];
    const drop = (i, near) => {
      const h1 = hash(i, near, 401), v0 = near ? 330 + h1 * 70 : 200 + h1 * 45, Lc = near ? 60 + hash(i, near, 402) * 90 : 40 + hash(i, near, 402) * 70;
      const u = T * v0 / Lc + hash(i, near, 403), n = Math.floor(u), yf = Math.floor((u - n) * Lc);
      const x0 = Math.floor(hash(i, n, 404 + near) * Dw * 2), y0 = Math.floor(hash(i, n, 406 + near) * Dh);
      const yy = (y0 + yf) & ~1, x = ((x0 - (yy >> 1) - cx) % Dw + Dw) % Dw - PADR, y = ((yy - cy) % Dh + Dh + Dh) % Dh - PADR;
      const yq = y & ~1;
      if (near){
        const hot = warm && x >= 0 && x < W && yq >= 0 && yq < H && pal.warmSet.has(d[yq * W + x]);
        set(x, yq, hot ? pal.warm : pal.near); set(x, yq + 1, hot ? pal.warm : pal.near); set(x + 1, yq - 1, hot ? pal.warmLo : pal.nearLo); set(x + 1, yq - 2, hot ? pal.warmLo : pal.nearLo);
        if (Rd > .75 && hash(i, n, 409) < (Rd - .75) * 3.2){ set(x + 2, yq - 3, hot ? pal.warmLo : pal.nearLo); set(x + 2, yq - 4, hot ? pal.warmLo : pal.nearLo); }   // peak: 6 px
        /* day: a light blue-grey 2 px tip on the 1:2 slant (review round 2: the near-white 1 px tip read as sparkle / sleet on dark roofs) */
        if (day){ set(x - 1, yq + 2, pal.splash2U); set(x - 1, yq + 3, pal.splash2U); }
        if (over && (i & 3) === 0) over.push(x + 1, yq - 1, x + 1, yq - 2, hot ? 1 : 0);   // every 4th near drop's tail, redrawn over the train (drawOver)
      } else {
        const hot = warm && x >= 0 && x < W && yq >= 0 && yq < H && pal.warmSet.has(d[yq * W + x]);
        set(x, yq, hot ? pal.warmLo : pal.far); set(x, yq + 1, hot ? pal.warmLo : pal.far);
      }
    };
    for (let i = 0; i < nF; i++) drop(i, 0);
    for (let i = 0; i < nN; i++) drop(i, 1);
    WEATHER.stats.drops = nN + nF;
  }
  if (fx) g.putImageData(img, 0, 0);
  else for (const [c, a] of PQ){ g.fillStyle = hex(c); for (let i = 0; i < a.length; i += 2) g.fillRect(a[i], a[i + 1], 1, 1); }
  if (prime > 0) prime--;
  WEATHER.stats.msS = performance.now() - t0; WEATHER.stats.ms = WEATHER.stats.msG + WEATHER.stats.msS;
};

/* WEATHER.drawOver(g, view): after the line and the train (main.js), a sparse subset of the falling rain — the tail pixels of every 4th near
   drop drawSky just drew — so the train and the line band are rained on too, yet stay legible (review round 2: the streaks stopped
   cleanly at the band, as if the train sat under glass) */
const hex = u => '#' + [u & 255, u >>> 8 & 255, u >>> 16 & 255].map(c => c.toString(16).padStart(2, '0')).join('');
WEATHER.drawOver = (g, v) => {
  if (!over || !over.length) return; const W = v.W, H = v.H, cs = overC.map(hex);
  for (let j = 0; j < over.length; j += 5){ g.fillStyle = cs[over[j + 4]];
    for (const [x, y] of [[over[j], over[j + 1]], [over[j + 2], over[j + 3]]]) if (x >= 0 && y >= 0 && x < W && y < H) g.fillRect(x, y, 1, 1); }
  over = null;
};
/* WEATHER.warm(view, ms): build the effect chunks a view will need (main.js calls it for a zoom's target level while the zoom is
   pending / gliding, so rings / splashes / puddles are there when it lands — review round 1) */
WEATHER.warm = (v, ms = 1.5) => {
  if (!(WEATHER.rain > 0 || WEATHER.wet > 0) || !window.WORLD || !WORLD.ready) return;
  const until = performance.now() + ms;
  for (const ch of chunksOf(v, cacheFor(v))){ if (performance.now() >= until) break; if (!ch.g) buildGround(ch, v); }
};
WEATHER._pd = v => { const out = []; for (const ch of chunksOf(v, cacheFor(v))) for (let j = 0; j < ch.pd.length; j += 7) out.push([v.sx(ch.pd[j]), v.sy(ch.pd[j + 1]), ch.pd[j + 2], ch.pd[j + 3]]); return out; };
WEATHER._dbg = () => { const o = {}; for (const [k, c] of caches){ const t = {chunks: c.size, built: 0, sp: 0, rg: 0, pd: 0, lm: 0, wr: 0};
  for (const ch of c.values()){ if (ch.g) t.built++; t.sp += ch.sp.length / 4; t.rg += ch.rg.length / 3; t.pd += ch.pd.length / 7; t.lm += ch.lm.length / 3; t.wr += ch.wr.length / 5; } o[k] = t; } return o; };
WEATHER.dirty = (lvl, k, X0, Y0, n) => {
  const c = caches.get(PX.theme + '|' + lvl + '|' + k); if (!c) return;
  for (let cy = Math.floor(Y0 / CH); cy <= Math.floor((Y0 + n - 1) / CH); cy++) for (let cx = Math.floor(X0 / CH); cx <= Math.floor((X0 + n - 1) / CH); cx++) c.delete(cx * 100003 + cy);
};
if (window.WORLD && WORLD.onRebake) WORLD.onRebake(WEATHER.dirty);
window.WEATHER = WEATHER;
})();
