/* ui.js — the ride screen's pixel HUD: cab cluster (speedometer + 6 stats), LED board, attribution.
   Same rules as pixel.js: one art canvas, integer coordinates, palette colours only, text only through
   PX.text / PX.ledText at native font sizes. Panels follow the sprites' light logic (top-left light):
   raised hardware = 1px ui.edge outline, lit top/left bevel, shaded bottom/right bevel, 1px `shadow`
   to the bottom-right; recessed screens invert the bevel (dark top/left lip, lit bottom/right lip).
   The LED board's face is emissive hardware: it is the same dark glass with the same LEDs in both themes
   (palette group `board`, identical hexes night and day) — only the frame around it follows the theme.
   UI.layout(W, H, {top, right, kb, safe}?) → {portrait, compact, kb, mq, tight, view, cluster, board, attribution} rects in art px (call
   after FONTS.ready): top = the first art px row below the page's floating chips (the cluster starts there), right = the chips' width
   from the right edge, kb = soft keyboard up (no cluster: a zero-size rect at top; the board docks at the bottom without the portrait
   marquee row), safe = {t, r, b, l} safe-area insets (art px). tight = too short for the whole board (it would leave the top or meet the
   chips): no header row / THEN column, beside the chips when needed, then view = the map column's free area (else null); a cluster
   that would meet the board is dropped.
   UI.draw(g, st, layout?) draws all three and returns the layout. UI.reduced (prefers-reduced-motion): the next-stop lamp stays lit,
   the marquee pages instead of scrolling, no shake, no ember flicker. Line-agnostic: the line is PX.lineId, its colours PX.lk(role)
   (LED text lsh.led + its bleed lsh.ledGlow, roundel numeral lsh.ink, cluster digits lsh.txt). UI.tag = optional pill text over the attribution
   (e.g. 'MOCKUP'; null = none). st = {
     theme,
     station:{zh, py (toned), typed (letters typed), wrongFlash 0..1, transfers:[lineKeys]}, next:{zh,py}|null,
     terminus:{zh, py, en?}, idx (1-based, the station being typed), total, kmToNext, speedKmh, maxKmh, wpm, acc (%),
     combo, comboTier 0–3, score, time (s), dist (km), t (s, animation clock),
     lab:{time, dist, wpm, acc, combo, score}? cluster labels (default zh) · head:{zh, en}? the board's label (default 下一站 NEXT) ·
     next.end = the next stop is the terminus (THEN → 终点站 TERMINUS),
     route:{cur, next, total, p?}  0-based: stations < cur passed (RED), cur and later GREEN, `next` BLINKS ~2 Hz;
                                   p = 0..1 of the hop cur → next travelled (optional; the red creeps along it),
     idle   s since the last correct letter (optional), cps  letters/s over the last few s (optional)}.
   Announcements (#8): the LED marquee shows 本次列车开往… / transfer lines; when idle ≥ 2.5 s, or a name is in
   progress and cps < 1.5, it cycles ANN.idle (ann.js: real Guangzhou Metro between-stop reminders,
   sources in that file), zh then en, each held 1.2 s at the window start then scrolled; back after 1 s of brisk typing.
   Needs pixel.js, palette.js, fonts.js, sprites.js (+ ann.js, optional). Exposes the global UI. */
(function(){
const UI = {tag: null, reduced: false}, R = PX.rect, TAU = Math.PI * 2;
const isLetter = ch => /\p{L}/u.test(ch);
const cache = new Map();                       // static layers, baked per theme + size; the 8 last used (2 sizes × 2 themes × 2 layers)
const baked = (key, w, h, draw) => {
  key += '|' + PX.theme; let c = cache.get(key);
  if (c) cache.delete(key); else { const cv = PX.makeCanvas(w, h); draw(cv.g); c = cv.c; if (cache.size >= 8) cache.delete(cache.keys().next().value); }
  cache.set(key, c); return c;
};

/* ---------- palette: the LED face (both themes identical: a lit LED sign looks the same by day) ----------
   every hex is an existing night swatch: glass k1, lattice = led.off, glow = led.glow, amber = led.on,
   hi k11, dim k8, faint k5, good = hud.good, red = hud.bad / veh.c3 ramp, green = hud.good / veh.green ramp */
const LEDF = {glass: '#0d1024', off: '#2a1e26', glow: '#5a3030', amber: '#ffb445', hi: '#f1f1ff', dim: '#7c87ba', faint: '#323b68',
  good: '#5fd38c', bad: '#ff5a64', red: '#ff5a64', redLo: '#8e3050', redDk: '#42182e', green: '#5fd38c', greenLo: '#205a46', greenDk: '#153c32'};
PAL.night.board = {...LEDF}; PAL.day.board = {...LEDF};

/* colour roles per theme; line-coloured text is darkened to the line's lo step by day (legibility) */
const night = () => PX.theme === 'night';
const lineK = () => PX.lk('disp'), lineTxt = () => PX.lk('txt'), lineHi = () => PX.lk('hi'), lineLo = () => PX.lk('lo');
const frameFill = () => night() ? 'ui.panel' : 'ui.panel2';
const faint = () => night() ? 'ui.hi' : 'ui.lo';          // dotted dividers, minor ticks: visible but quiet on the glass

/* ---------- shapes ---------- */
/* raised hardware panel: PX.panel + lit left / shaded right bevel + 1px drop shadow bottom-right */
function frame(g, x, y, w, h){
  PX.panel(g, x, y, w, h, {fill: frameFill()});
  R(g, x + 1, y + 1, 1, h - 3, 'ui.hi'); R(g, x + w - 2, y + 2, 1, h - 3, 'ui.lo');
  R(g, x + w, y + 2, 1, h - 2, 'shadow'); R(g, x + 2, y + h, w - 2, 1, 'shadow'); R(g, x + w - 1, y + h - 1, 1, 1, 'shadow');
}
/* recessed glass screen; dots = a faint dot-matrix (pitch 2, lattice at x+2,y+2) */
function inset(g, x, y, w, h, dots, fill = 'led.bg'){
  R(g, x, y, w, 1, 'ui.edge'); R(g, x, y, 1, h, 'ui.edge');
  R(g, x + 1, y + h - 1, w - 1, 1, 'ui.hi'); R(g, x + w - 1, y + 1, 1, h - 1, 'ui.hi');
  R(g, x + 1, y + 1, w - 2, h - 2, fill);
  if (dots) for (let yy = y + 2; yy < y + h - 2; yy += 2) for (let xx = x + 2; xx < x + w - 2; xx += 2) R(g, xx, yy, 1, 1, dots);
}
/* 1px outlined pill (rounded corners), optional fill */
function pill(g, x, y, w, h, edge, fill){
  R(g, x + 1, y, w - 2, 1, edge); R(g, x + 1, y + h - 1, w - 2, 1, edge); R(g, x, y + 1, 1, h - 2, edge); R(g, x + w - 1, y + 1, 1, h - 2, edge);
  if (fill) R(g, x + 1, y + 1, w - 2, h - 2, fill);
}
/* line roundel: ink ring, line-colour face (lsh.sign) with lit top-left / shaded bottom-right rim, numeral in lsh.ink; a label wider than
   the disc (APM) stretches it into a stadium by e px a side, left edge fixed → returns e */
function roundel(g, x0, cy, r, label){
  const f = label.length > 1 ? 'fp8' : 'fp10', w = PX.measure(label, f) - 1, e = Math.max(0, Math.ceil((w + 3 - 2 * r) / 2)), cx = x0 + e;
  const inD = (x, y, rr) => { x = x < -e ? x + e : x > e ? x - e : 0; return x * x + y * y <= rr * rr + rr * .8; };
  for (let y = -r; y <= r; y++) for (let x = -r - e; x <= r + e; x++){
    if (!inD(x, y, r)) continue;
    const k = !inD(x, y, r - 1) ? 'ink' : !inD(x - 1, y - 1, r - 1) ? lineHi() : !inD(x + 1, y + 1, r - 1) ? lineLo() : PX.lk('sign');
    R(g, cx + x, cy + y, 1, 1, k);
  }
  PX.text(g, label, cx - (w >> 1), cy - (f === 'fp8' ? 3 : 6), {font: f, color: PX.lk('ink')});
  return e;
}
const lineNum = () => PX.lineId.replace(/^l/, '').toUpperCase();      // 1 … 22, GF, APM (Latin: no hanzi below fp10)
/* a bilingual label: 汉字 in fp10 + the English word in fp8 on the same baseline, 3 px apart — used for NEXT and THEN alike */
function biLabel(g, zh, en, x, y, cz, ce){
  const w = PX.text(g, zh, x, y, {font: 'fp10', color: cz});
  return en ? w + 3 + PX.text(g, en, x + w + 3, y + 3, {font: 'fp8', color: ce}) : w;
}

/* ---------- local icons (same format + keys as SPR.icon: i = text, d = textDim, a = ui.accent) ---------- */
const IK = {i: 'text', d: 'textDim', a: 'ui.accent'};
const ICON_ACC = {id: 'uiAcc', w: 9, h: 9, ax: 4, ay: 4, key: IK, rows: [
  '..iiiii..',
  '.id...di.',
  'i..ddd..i',
  'i.d...d.i',
  'i.d.a.d.i',
  'i.d...d.i',
  'i..ddd..i',
  '.id...di.',
  '..iiiii..']};
const FLAME_OFF = {night: {'fire.t1': 'textDim', 'fire.lo': 'ui.hi', 'fire.core': 'ui.hi'}, day: {'fire.lo': 'textDim', 'fire.t1': 'ui.lo', 'fire.core': 'ui.lo'}};

/* ---------- layout ---------- */
const CELL_H = 30, CELL_C = 15, BOARD_H = 82, MQ_H = 22, TIGHT_H = 66;   // MQ_H: the portrait board's own marquee row · TIGHT_H: name + pinyin + route only
UI.layout = (W, H, o = {}) => {
  const sf = o.safe || {}, sl = sf.l | 0, sr = sf.r | 0, sb = sf.b | 0, portrait = W < H, M = portrait ? 4 : 6, kb = !!o.kb, top = Math.max(M + (sf.t | 0), o.top | 0);
  const cw = portrait ? W - 2 * M - 1 - sl - sr : 203, compact = cw - 8 < 175;   // too narrow for dial + 3 cells: 2 × 3 icon cells
  const ch = compact ? 3 * CELL_C + 2 + 8 : 2 * CELL_H + 1 + 8;
  let cluster = kb ? {x: W - M - sr, y: top, w: 0, h: 0} : {x: W - M - sr - cw - 1, y: top, w: cw, h: ch};
  let mq = portrait && !kb; const room = W - 2 * M - 1 - sl - sr;
  const bw = portrait ? room : Math.min(room, Math.max(320, Math.round(W * .6))), bh = BOARD_H + (mq ? MQ_H : 0);
  let board = {x: portrait ? M + sl : Math.max(M + sl, (W - bw) >> 1), y: H - M - bh - 1 - sb, w: bw, h: bh}, tight = false, view = null;
  /* very short (landscape phone + keyboard): the whole board would run off the top or under the page's floating chips (o.right: their
     width from the right edge) — the essential rows only (LED name + pinyin, route strip), left of the chips if it still meets them;
     the map shows in the column beside it (view: the camera's free area) */
  const chipL = W - (o.right | 0), under = r => o.right > 0 && r.y < top && r.x + r.w > chipL;
  if (board.y < 0 || under(board)){
    tight = true; mq = false; board = {x: board.x, y: Math.max(0, H - Math.min(M, 2) - TIGHT_H - 1 - sb), w: bw, h: TIGHT_H};
    if (under(board) && chipL - 4 - M - sl >= 160){ board.x = M + sl; board.w = Math.min(bw, chipL - 4 - M - sl);
      const vx = board.x + board.w + 3; view = {x: vx, y: top, w: W - M - sr - vx, h: H - top - M - sb}; if (view.w < 40 || view.h < 24) view = null; }
  }
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (cluster.w && hit(cluster, board)) cluster = {x: W - M - sr, y: top, w: 0, h: 0};           // no room for the cab cluster: the board wins
  /* attribution: bottom-left beside the board when its widest line fits the gap, else above the board (as in portrait); board left
     of the chips: one line above it when there is room, else at the foot of the map column */
  const over = view && board.y - 3 - ((UI.tag ? 11 : -1) + 9) >= 0 && attrLines(room).length === 1;
  const gap = view ? view.w : board.x - M - sl - 6, side = !over && (view || (!portrait && attrLines(gap).every(s => PX.measure(s, 'fp8') <= gap)));
  const lines = attrLines(side ? gap : room), aw = Math.max(...lines.map(s => PX.measure(s, 'fp8'))), ah = (UI.tag ? 11 : -1) + lines.length * 9;
  const attribution = {x: side && view ? view.x : M + sl, y: side ? H - M - sb - ah : board.y - 3 - ah, w: Math.max(aw, 36), h: ah, lines};
  if (view) view.h = Math.max(8, (side ? attribution.y - 1 : H - M - sb) - view.y);
  return {portrait, compact, kb, mq, tight, view, cluster, board, attribution};
};
const ATTR = '© OpenStreetMap contributors';          // Latin only: no hanzi below fp10
const attrLines = maxW => PX.measure(ATTR, 'fp8') <= maxW ? [ATTR] : ['© OpenStreetMap', 'contributors'];

/* ---------- cab cluster ---------- */
const LAB0 = {time: '用时', dist: '里程', wpm: '键速', acc: '准确率', combo: '连击', score: '得分'};
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const flameIcon = st => st.comboTier ? SPR.icon.flame[Math.min(3, st.comboTier) - 1] : SPR.icon.flame[0];
const flameOpt = st => st.comboTier ? undefined : {remap: FLAME_OFF[PX.theme] || FLAME_OFF.night};
const comboCol = st => st.comboTier ? (night() ? ['', 'fire.t2', 'fire.core', 'fire.core'][Math.min(3, st.comboTier)] : 'fire.lo') : 'text';   // only the combo is warm
function unitAfter(g, unit, x, y){                     // unit after an fp12 value whose top is y
  if (unit === '%') PX.text(g, unit, x, y + 3, {font: 'fp10', color: 'textDim'});        // fp8's % reads as an x
  else if (unit) PX.text(g, unit, x + 1, y + 6, {font: 'fp8', color: 'textDim'});
}
function cluster(g, r, st, portrait, compact){
  const {x, y, w, h} = r, ix = x + 4, iy = y + 4, iw = w - 8, ih = h - 8;
  if (compact) return clusterCompact(g, r, st);
  /* gauge width, 3 cells, 3 dividers; on wide portrait screens the gauge is capped and the cells widen */
  const cw0 = 44, gs = portrait ? Math.min(iw - 2 - 3 * cw0 - 1, 70) : iw - 2 - 3 * cw0 - 1, cw = portrait ? Math.floor((iw - 3 - gs) / 3) : cw0;
  g.drawImage(baked('cluster|' + w + 'x' + h + '|' + cw, w + 1, h + 1, bg => {
    frame(bg, 0, 0, w, h); inset(bg, 3, 3, w - 6, h - 6, night() ? 'ui.panel' : null);
    const dv = (dx, dy, dw, dh) => { for (let k = 0; k < Math.max(dw, dh); k += 2) R(bg, dx + (dw > 1 ? k : 0), dy + (dh > 1 ? k : 0), 1, 1, faint()); };
    dv(4 + gs, 5, 1, ih - 2);                                              // gauge | stats
    for (let c = 1; c < 3; c++) dv(4 + gs + 1 + c * (cw + 1) - 1, 5, 1, ih - 2);
    dv(4 + gs + 2, 4 + CELL_H, iw - gs - 3, 1);                            // row divider
  }), x, y);
  gauge(g, ix, iy, gs, ih, st);
  const lb = st.lab || LAB0, cells = [
    [SPR.icon.clock, lb.time, fmtTime(st.time), ''],
    [SPR.icon.distance, lb.dist, (st.dist || 0).toFixed(1), 'km'],
    [SPR.icon.keyboard, lb.wpm, String(Math.round(st.wpm || 0)), 'wpm'],
    [ICON_ACC, lb.acc, String(Math.round(st.acc ?? 100)), '%'],
    [flameIcon(st), lb.combo, String(st.combo || 0), ''],
    [SPR.icon.star, lb.score, String(Math.round(st.score || 0)), ''],
  ];
  cells.forEach(([ic, label, val, unit], k) => {
    const cx = ix + gs + 1 + (k % 3) * (cw + 1), cy = iy + (k / 3 | 0) * (CELL_H + 1);
    SPR.put(g, ic, cx + 6, cy + 8, k === 4 ? flameOpt(st) : undefined);
    const lf = PX.measure(label, 'fp10') <= cw - 14 || /\p{Script=Han}/u.test(label) ? 'fp10' : 'fp8';   // a long Latin label steps down to fp8
    PX.text(g, label, cx + 13, cy + (lf === 'fp10' ? 2 : 4), {font: lf, color: 'textDim'});
    const vw = PX.text(g, val, cx + 3, cy + 14, {font: 'fp12', color: k === 4 ? comboCol(st) : 'text'});
    unitAfter(g, unit, cx + 3 + vw, cy + 14);
  });
}
/* very narrow screens (≈130 art px: a phone at 3×): no dial — 2 columns × 3 rows of icon + value (labels dropped,
   the icons carry the meaning; distance gives way to speed) */
function clusterCompact(g, r, st){
  const {x, y, w, h} = r, iw = w - 8, cw = (iw - 1) >> 1;
  g.drawImage(baked('clusterC|' + w + 'x' + h, w + 1, h + 1, bg => {
    frame(bg, 0, 0, w, h); inset(bg, 3, 3, w - 6, h - 6, night() ? 'ui.panel' : null);
    for (let k = 0; k < h - 10; k += 2) R(bg, 4 + cw, 5 + k, 1, 1, faint());
    for (const ry of [1, 2]) for (let k = 0; k < iw - 2; k += 2) R(bg, 5 + k, 4 + ry * (CELL_C + 1) - 1, 1, 1, faint());
  }), x, y);
  const cells = [
    [SPR.icon.speed, String(Math.round(Math.max(0, st.speedKmh || 0))), 'km/h', lineTxt()],
    [SPR.icon.clock, fmtTime(st.time), ''],
    [SPR.icon.keyboard, String(Math.round(st.wpm || 0)), 'wpm'],
    [ICON_ACC, String(Math.round(st.acc ?? 100)), '%'],
    [flameIcon(st), String(st.combo || 0), '', comboCol(st)],
    [SPR.icon.star, String(Math.round(st.score || 0)), ''],
  ];
  cells.forEach(([ic, val, unit, col], k) => {
    const cx = x + 4 + (k % 2) * (cw + 1), cy = y + 4 + (k >> 1) * (CELL_C + 1);
    SPR.put(g, ic, cx + 6, cy + 7, k === 4 ? flameOpt(st) : undefined);
    const vw = PX.text(g, val, cx + 13, cy + 1, {font: 'fp12', color: col || 'text'});
    unitAfter(g, unit, cx + 13 + vw, cy + 1);
  });
}

/* speedometer: tick-dot ring, 2px speed arc (lit to the current speed, red zone at the top end), pixel needle
   (PX.line) from the dial centre, a recessed LCD window with the digital speed, ember glow by combo tier */
const A0 = 170, SWEEP = 200, RED = .85;
const ang = f => (A0 + SWEEP * f) * TAU / 360;
const arcSets = new Map();
function arcPixels(r){                         // clean 2px ring (PX.ring's disc test), each pixel tagged with its sweep fraction
  let v = arcSets.get(r); if (v) return v; v = [];
  const inD = (x, y, rr) => x * x + y * y <= rr * rr + rr * .8;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++){
    if (!inD(x, y, r) || inD(x, y, r - 2)) continue;
    const a = ((Math.atan2(y, x) * 360 / TAU - A0) % 360 + 360) % 360;
    if (a <= SWEEP) v.push([x, y, a / SWEEP]);
  }
  arcSets.set(r, v); return v;
}
/* combo heat: small flame tongues (the SPR.icon.flame language) rising from the gauge's base either side of the LCD —
   tier 1: two small ones, tier 2: four, tier 3: four big ones + rising sparks; they flicker a pixel, no dither field */
function embers(g, x, y, w, h, tier, t, hole){
  const spr = SPR.icon.flame[tier - 1], n = tier > 1 ? 2 : 1, by = y + h - 1 - (spr.h - spr.ay);
  for (let k = 0; k < n; k++) for (const side of [-1, 1]){
    const fx = side < 0 ? hole.x - 5 - k * 9 : hole.x + hole.w + 4 + k * 9, dy = UI.reduced ? 0 : ((t * 6 + k * 2 + (side > 0 ? 1 : 0)) | 0) % 2;
    if (fx - spr.ax < x + 1 || fx + spr.w - spr.ax > x + w - 1) continue;
    SPR.put(g, spr, fx, by - dy);
    if (tier === 3 && !UI.reduced){ const p = (t * .8 + k * .37 + (side > 0 ? .5 : 0)) % 1, sy = Math.round(by - spr.ay - 2 - p * 14); if (sy > y + 1) R(g, fx + (dy ? 1 : 0), sy, 1, 1, p < .5 ? 'fire.t2' : 'fire.t1'); }
  }
}
function gauge(g, x, y, w, h, st){
  const cx = x + (w >> 1), ra = Math.min((w >> 1) - 5, 24), cy = y + ra + 5, max = st.maxKmh || 120;
  const sp = Math.max(0, st.speedKmh || 0), f = Math.min(1, sp / max), tier = Math.min(3, st.comboTier || 0);
  const lcd = {x: cx - 13, y: cy + 4, w: 27, h: 23}, arc = PX.contrast(lineK(), 'led.bg') >= 1.5 ? lineK() : lineTxt();   // a line lost on the screen: its text shade
  if (tier) embers(g, x, y, w, h, tier, st.t || 0, lcd);
  /* tick dots every 10 km/h (majors every 40: 2px, brighter) */
  for (let v = 0; v <= max; v += 10){
    const a = ang(v / max), major = v % 40 === 0;
    R(g, cx + Math.round(Math.cos(a) * (ra + 2)), cy + Math.round(Math.sin(a) * (ra + 2)), 1, 1, major ? 'textDim' : faint());
    if (major) R(g, cx + Math.round(Math.cos(a) * (ra + 3)), cy + Math.round(Math.sin(a) * (ra + 3)), 1, 1, 'textDim');
  }
  /* speed arc */
  for (const [dx, dy, af] of arcPixels(ra)){
    const lit = af <= f, red = af >= RED;
    const k = lit ? (af > f - .03 ? lineHi() : red ? 'hud.bad' : arc) : red ? 'led.glow' : night() ? 'ui.panel2' : 'ui.lo';
    R(g, cx + dx, cy + dy, 1, 1, k);
  }
  /* needle + pivot hub */
  const a = ang(f), rn = ra - 5;
  PX.line(g, cx, cy, cx + Math.cos(a) * rn, cy + Math.sin(a) * rn, 'hud.bad');
  PX.disc(g, cx, cy, 2, 'ink'); R(g, cx - 1, cy, 3, 1, 'textDim'); R(g, cx, cy - 1, 1, 3, 'textDim'); R(g, cx, cy, 1, 1, 'text');
  /* digital speed in a recessed LCD window below the hub */
  inset(g, lcd.x, lcd.y, lcd.w, lcd.h, null);
  PX.text(g, String(Math.round(sp)), cx + 1, cy + 4, {font: 'fp16', color: lineTxt(), align: 'center'});
  PX.text(g, 'km/h', cx + 1, cy + 19, {font: 'fp8', color: 'textDim', align: 'center'});
}

/* ---------- announcements (#8): what the marquee shows, a small state machine with hysteresis ---------- */
const IDLE_IN = 2.5, SLOW_IN = 1.5, SLOW_OUT = 2, HYST = .5;      // s · letters/s · letters/s · s
const HOLD = 1.2, SPEED = 40, GAP = 32;                             // hold at the window start (s) · scroll (art px/s: one 2-px LED step every 3 frames at 60 Hz, an even tick) · item gap (px)
/* fallback when ann.js is absent (same sources: 360百科《广州地铁报站示例》; GZ Metro sign standard 2024). ann.js declares `const ANN` (a
   global binding, not a window property) */
const IDLE_FALLBACK = [{zh: '文明和谐，请勿在车厢内大声喧哗', en: 'Please keep your voice down on the train'},
  {zh: '请为老人、孕妇、儿童、残疾人让座', en: 'Offer your seat to those in need'}, {zh: '请站稳扶好', en: 'Please Stand Firm'}];
const annS = () => typeof ANN !== 'undefined' && ANN ? ANN : null;
const unfilled = s => /\{\w+\}/.test(s);                            // a template item whose {placeholders} were not filled never shows
let idleC = null;
const idleList = () => { const A = annS(), src = A && A.idle && A.idle.length ? A.idle : IDLE_FALLBACK;
  if (!idleC || idleC.src !== src){ const l = src.filter(a => a.zh && a.en && !unfilled(a.zh) && !unfilled(a.en)); idleC = {src, l: l.length ? l : IDLE_FALLBACK}; } return idleC.l; };
const annOf = (list, id) => { const A = annS(); return A && Array.isArray(A[list]) ? A[list].find(a => a.id === id) : null; };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const toneless = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lineNames = (keys, en) => { const A = annS(); if (A && A.lines) return A.lines(keys, en ? 'en' : 'zh');
  const n = keys.map(k => { const n = k.replace(/^l/, ''); return en ? (n === 'apm' ? 'APM Line' : n === 'gf' ? 'Guangfo Line' : 'Line ' + n) : (n === 'apm' ? 'APM线' : n === 'gf' ? '广佛线' : n + '号线'); });
  return en ? n.slice(0, -1).join(', ') + (n.length > 1 ? ' and ' : '') + n[n.length - 1] : n.join('、'); };
/* the normal program, as the car announces it (ann.js): at the origin only where the train goes; between stops the next stop's
   interchange (可换乘…), its places (去往…的乘客请准备, ANN.poi: only at those stations), then the terminus (本次列车开往…方向, or
   下一站是本次列车的终点站 on the last hop, 请全部乘客带齐行李物品… once there); Line 3 adds 请上车的乘客往车厢中部走 (it plays it at every stop) */
function infoItems(st){
  const out = [], s = st.station || {}, tr = s.transfers || [], ter = st.terminus, A = annS(), origin = st.idx === 1, last = st.idx != null && st.idx === st.total;
  const push = (a, v) => { if (a) out.push(fill(a.zh, v), fill(a.en, v)); };
  if (!origin && tr.length) push(annOf('transfer', 'with') || {zh: '可换乘{line}', en: 'The interchange with {lineEn}.'}, {line: lineNames(tr), lineEn: lineNames(tr, 1)});
  const poi = !origin && !(st.route && st.route.next < 0) && A && A.poi && s.zh ? A.poi[s.zh] : null;
  if (poi) push(annOf('arrival', 'prepare'), {poi: poi.zh, poiEn: poi.en});
  if (ter && ter.zh){
    const en = ter.en || (PX.D && PX.D.stations && (PX.D.stations.find(x => x.zh === ter.zh) || {}).en) || toneless(ter.py);
    if (st.route && st.route.next < 0) push(annOf('arrival', 'terminus'), {});          // standing at the terminus
    else if (last && !origin) push(annOf('arrival', 'nextEnd') || {zh: '下一站是本次列车的终点站：{stop}', en: 'The next station is {stopEn}, the terminal of this journey.'}, {stop: ter.zh, stopEn: en});
    else push(annOf('departure', 'bound') || {zh: '本次列车开往{dest}方向', en: 'This train is bound for {destEn}.'}, {dest: ter.zh, destEn: en});
  }
  if (PX.lineId === 'l3') push(annOf('departure', 'middle'), {});
  return out.filter(x => x && !unfilled(x));
}
const AN = {mode: 'info', t0: null, key: '', off: null, next: 0, i0: 0, seen: 0, lastT: null};
function announce(st, letters){
  const t = st.t || 0, S = AN, typed = (st.station || {}).typed || 0, N = idleList().length;
  const cur = st.route ? st.route.cur : (st.idx || 1) - 2;
  if (S.lastT == null || t < S.lastT - 1e-6 || t - S.lastT > 1.5)          // first frame, a seek or a long gap: forget the history
    Object.assign(S, {mode: 'info', t0: null, key: '', off: null, next: ((cur * 7) % N + N) % N, seen: 0});
  S.lastT = t;
  if (st.idle != null){
    const prog = typed > 0 && typed < letters, slow = prog && st.cps != null && st.cps < (S.mode === 'idle' ? SLOW_OUT : SLOW_IN);
    if (st.idle >= IDLE_IN || slow){
      S.off = null;
      if (S.mode !== 'idle') Object.assign(S, {mode: 'idle', t0: t - (st.idle >= IDLE_IN ? st.idle - IDLE_IN : 0), i0: S.next, seen: 0});   // backdated: stills are reproducible
    } else if (S.mode === 'idle'){
      if (S.off == null) S.off = t;
      if (t - S.off >= HYST) Object.assign(S, {mode: 'info', t0: t, key: '', off: null, next: (S.i0 + Math.max(1, S.seen)) % N});
    }
  }
  if (S.mode === 'idle'){
    const L = idleList();
    return {idle: true, tau: t - S.t0, item: k => { const a = L[(S.i0 + (k >> 1)) % N]; return k & 1 ? a.en : a.zh; }};
  }
  const items = infoItems(st), key = items.join('|');
  if (key !== S.key){ if (S.key) S.t0 = t; S.key = key; }                  // content changed (new hop): restart at the first item
  return items.length ? {idle: false, tau: S.t0 == null ? t : t - S.t0, item: k => items[k % items.length]} : null;
}
/* LED marquee in a clipped dot window [x0, x1) (x0, x1 on the lattice): each item holds HOLD s at the window start,
   then scrolls left in whole LED columns (2 art px) while the next item follows GAP px behind; fully lit dots, hard clip */
const mw = s => PX.measure(s, 'fp10') * 2;
/* reduced motion: no scrolling — each item is cut into window-wide pages of whole characters (Latin at a space when one is near), each
   page held PAGE s */
const PAGE = 2, pagesC = new Map();
function pages(s, w){
  const key = s + '|' + w; let p = pagesC.get(key); if (p) return p; p = [];
  const ch = [...s]; let i = 0;
  while (i < ch.length){ let j = i + 1; while (j < ch.length && mw(ch.slice(i, j + 1).join('')) <= w) j++;
    if (j < ch.length){ const sp = ch.slice(i, j).lastIndexOf(' '); if (sp > (j - i) / 2) j = i + sp + 1; }
    p.push(ch.slice(i, j).join('').trim()); i = j; }
  if (pagesC.size > 200) pagesC.clear(); pagesC.set(key, p); return p;
}
function marquee(g, x0, x1, oy, top, bot, prog){
  if (UI.reduced){
    let tau = Math.max(0, prog.tau), k = 0;
    for (; k < 1e4; k++){ const d = pages(prog.item(k), x1 - x0).length * PAGE; if (tau < d) break; tau -= d; }
    if (prog.idle) AN.seen = Math.max(AN.seen, (k >> 1) + 1);
    const pg = pages(prog.item(k), x1 - x0), s = pg[Math.min(pg.length - 1, Math.floor(tau / PAGE))] || '';
    g.save(); g.beginPath(); g.rect(x0, top, x1 - x0, bot - top); g.clip();
    PX.ledText(g, s, x0, oy, {font: 'fp10', pitch: 2, on: 'board.amber'}); g.restore(); return;
  }
  let tau = Math.max(0, prog.tau), k = 0, P = 0;
  for (; k < 1e4; k++){ const d = HOLD + (mw(prog.item(k)) + GAP) / SPEED; if (tau < d) break; tau -= d; P += mw(prog.item(k)) + GAP; }
  const o = P + (tau <= HOLD ? 0 : 2 * Math.floor((tau - HOLD) * SPEED / 2));
  if (prog.idle) AN.seen = Math.max(AN.seen, (k >> 1) + 1);
  g.save(); g.beginPath(); g.rect(x0, top, x1 - x0, bot - top); g.clip();
  for (let x = x0 + P - o; x < x1 && k < 1e4; k++){ const s = prog.item(k); PX.ledText(g, s, x, oy, {font: 'fp10', pitch: 2, on: 'board.amber'}); x += mw(s) + GAP; }
  g.restore();
}

/* ---------- LED board ---------- */
const amber = () => 'board.amber';
const diffOf = n => n <= 7 ? ['短', 'SHORT', 'hud.good'] : n <= 12 ? ['中', 'MEDIUM', night() ? 'led.on' : 'ui.accentLo'] : ['长', 'LONG', 'fire.lo'];   // red is kept for errors
function board(g, r, st, portrait, mq = portrait, tight = false){
  const {x, y, w, h} = r, sta = st.station || {}, py = sta.py || '', letters = [...py].filter(isLetter).length;
  const zh = sta.zh || '', ww = w - 8, need = PX.measure(zh, 'fp12') * 2;
  const wx = x + 4, wy = y + (tight ? 4 : 20), wh = 48 + (mq ? MQ_H : 0);   // tight: no header row
  const lx = wx + 5, ly = wy + 1;                // LED lattice origin: dots at (lx + 2i, ly + 2 + 2j)
  /* THEN column: 108 px; portrait gives way (down to 46 px) so a long name stays at full LED size, and drops it when even that
     would squeeze the name (a phone at 3×); tight: none */
  const thenW = tight ? 0 : portrait ? (ww - 10 - need >= 46 ? Math.min(64, ww - 10 - need) : 0) : 108;
  const prog = announce(st, letters), wide = !portrait && prog && prog.idle;        // landscape idle: the marquee spans the THEN column
  const rw = wide ? 0 : thenW, divX = thenW ? wx + ww - thenW - 1 : wx + ww, ledW = divX - wx - 8;
  const edgeX = rw ? divX : wx + ww;             // right end of the lattice this frame
  /* LED face: hardware frame + recessed dark glass + unlit lattice; the route strip's own glass slot at the bottom */
  g.drawImage(baked('board|' + w + 'x' + h + '|' + rw + '|' + thenW + '|' + (wy - y), w + 1, h + 1, bg => {
    frame(bg, 0, 0, w, h); inset(bg, 4, wy - y, ww, wh, null, 'board.glass');
    const lat = (x0, x1, y0, y1) => { for (let yy = y0; yy <= y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) R(bg, xx, yy, 1, 1, 'board.off'); };
    lat(lx - x, edgeX - x - 2, ly - y + 2, wy - y + (mq ? 47 : wh - 3));
    if (mq) lat(lx - x, wx - x + ww - 2, wy - y + 49, wy - y + wh - 3);
    if (rw) for (let yy = wy - y + 3; yy < wy - y + (mq ? 46 : wh - 3); yy += 2) R(bg, divX - x, yy, 1, 1, 'board.faint');   // dotted divider
    inset(bg, 4, h - 12, ww, 9, null, 'board.glass');
  }), x, y);
  if (!tight) header(g, x, y, w, st, letters, portrait);
  /* station name in LED dots (fp12 at pitch 2; fp10 when long; plain fp12 as the last resort) — its fit never depends on the
     marquee's mode, so the name never jumps */
  const on = PX.lk('led'), glow = PX.lk('ledGlow');
  const fit = [['fp12', 2], ['fp10', 2]].find(([f, p]) => PX.measure(zh, f) * p <= ledW);
  if (fit){
    const [f, p] = fit, oy = f === 'fp12' ? ly : ly + 2;
    if (f === 'fp12') for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) PX.ledText(g, zh, lx + dx, oy + dy, {font: f, pitch: p, on: glow});   // bleed in the line's own hue
    PX.ledText(g, zh, lx, oy, {font: f, pitch: p, on});
  } else PX.text(g, zh, lx, wy + 12, {font: 'fp12', color: on});
  const nameW = fit ? PX.measure(zh, fit[0]) * 2 : PX.measure(zh, 'fp12');
  /* the marquee: landscape — in the name row, right of the name (over the THEN column while idle); portrait — its own row */
  if (prog){
    const snap = v => lx + 2 * Math.floor((v - lx) / 2);
    if (mq) marquee(g, lx, snap(wx + ww - 3), ly + 46, wy + 47, wy + wh - 1, prog);
    else {
      const m0 = snap(lx + nameW + 11), m1 = snap(edgeX - 3);
      if (m1 - m0 >= 40){
        for (let yy = ly + 4; yy <= ly + 22; yy += 2) R(g, m0 - 6, yy, 1, 1, 'board.faint');        // a quiet dotted rule between name and marquee
        marquee(g, m0, m1, ly + 2, wy + 1, wy + 27, prog);
      }
    }
  }
  /* toned pinyin: typed = green, current = amber + underline (red + shake on a wrong key), rest dim */
  const pf = PX.measure(py, 'fp12') <= ledW + 4 ? 'fp12' : 'fp10';
  const track = pf === 'fp12' && PX.measure(py, 'fp12') + [...py].length <= ledW + 4 ? 1 : 0;   // 1px tracking when it fits (the game's spaced pinyin)
  pinyin(g, py, sta.typed || 0, lx, wy + (pf === 'fp12' ? 30 : 31), sta.wrongFlash || 0, st.t || 0, track, pf);
  const bad = (sta.wrongFlash || 0) > .4;
  if (bad){ R(g, wx, wy, ww, 1, 'board.bad'); R(g, wx, wy, 1, wh, 'board.bad'); R(g, wx + 1, wy + wh - 1, ww - 1, 1, 'board.bad'); R(g, wx + ww - 1, wy + 1, 1, wh - 1, 'board.bad'); }
  /* THEN column */
  if (rw){
    const nx = divX + 5, nxt = st.next;
    biLabel(g, nxt && nxt.end ? '终点站' : '接下来', portrait ? '' : nxt && nxt.end ? 'TERMINUS' : 'THEN', nx, wy + 3, 'board.hi', 'board.dim');
    if (nxt){
      PX.text(g, nxt.zh, nx, wy + 15, {font: 'fp12', color: on});
      if (PX.measure(nxt.py, 'fp10') <= rw - 7) PX.text(g, nxt.py, nx, wy + 32, {font: 'fp10', color: 'board.dim'});
    } else PX.text(g, '终点站', nx, wy + 15, {font: 'fp12', color: 'board.dim'});
  }
  routeStrip(g, wx, y + h - 12, ww, st);
}
/* header on the frame: roundel · 下一站 NEXT · difficulty tag … count · km (count, then the tag, give way when narrow) */
function header(g, x, y, w, st, letters, portrait){
  const sta = st.station || {};
  const e2 = 2 * roundel(g, x + 10, y + 10, 6, lineNum());
  const hd = st.head || {zh: '下一站', en: 'NEXT'};
  let hx = x + 20 + e2 + biLabel(g, hd.zh, portrait ? '' : hd.en, x + 20 + e2, y + 4, 'text', 'textDim') + 5;
  const bad = (sta.wrongFlash || 0) > .4, [dz, den, dk0] = diffOf(letters), dk = bad ? 'hud.bad' : dk0;
  const zw = PX.measure(dz, 'fp10'), tw = zw + (portrait ? 0 : 3 + PX.measure(den, 'fp8')) + 5;
  const idx = st.idx ?? (st.route ? st.route.next + 1 : 1), total = st.total ?? (st.route && st.route.total) ?? 0;
  const cnt = idx + '/' + total, km = (st.kmToNext ?? 0).toFixed(1) + ' km', rx = x + w - 6;
  const kw = PX.measure(km, 'fp10'), dot = PX.measure('·', 'fp10'), cw = PX.measure(cnt, 'fp10');
  const withCnt = hx + tw + 6 <= rx - kw - dot - 6 - cw, withTag = hx + tw + 4 <= rx - kw;
  if (withTag){                                   /* 汉字 in fp10 (no hanzi below fp10), the Latin word in fp8; a wrong key inverts the pill */
    const tk = bad ? 'led.bg' : dk;
    pill(g, hx, y + 3, tw, 13, dk, bad ? 'hud.bad' : null); PX.text(g, dz, hx + 3, y + 3, {font: 'fp10', color: tk});
    if (!portrait) PX.text(g, den, hx + 3 + zw + 3, y + 6, {font: 'fp8', color: tk});
  }
  PX.text(g, km, rx, y + 4, {font: 'fp10', color: 'textDim', align: 'right'});
  if (withCnt){
    PX.text(g, '·', rx - kw - 3, y + 4, {font: 'fp10', color: 'textDim', align: 'right'});
    PX.text(g, cnt, rx - kw - dot - 6, y + 4, {font: 'fp10', color: 'text', align: 'right'});
  }
}
function pinyin(g, py, typed, x, y, wrong, t, track, font = 'fp12'){
  const chars = [...py], ul = font === 'fp12' ? 15 : 12;
  let px = x;
  for (const ch of chars){ if (ch !== ' ') PX.text(g, ch, px, y, {font, color: 'board.glass', outline: 'board.glass'}); px += PX.measure(ch, font) + track; }
  let li = 0; px = x;
  for (let i = 0; i < chars.length; i++){
    const ch = chars[i], adv = PX.measure(ch, font) + track;
    if (ch === ' '){ px += adv; continue; }
    let col = 'board.dim', cur = false;
    if (isLetter(ch)){ if (li < typed) col = 'board.good'; else if (li === typed){ cur = true; col = wrong > 0 ? 'board.bad' : amber(); } li++; }
    const sx = cur && wrong > .4 && !UI.reduced ? ((t * 30 | 0) % 2 ? 2 : -2) : 0;
    PX.text(g, ch, px + sx, y, {font, color: col});
    if (cur) R(g, px + sx, y + ul, adv - 1 - track, 1, col);
    px += adv;
  }
}
/* route strip (#7), like Guangzhou Metro's lit route maps: every station a round LED lamp on a lit line — passed stations and
   track RED, the current station and everything ahead GREEN, the next stop BLINKING (~2 Hz, bright ↔ unlit green). The hop
   being ridden turns red as the train covers it (route.p), and route.cur's lamp turns red once p > 0 (the train has left it).
   Lamp size by room: 5×5 (pitch ≥ 12) · 3×3 · 1×3. */
function routeStrip(g, x, y, w, st){
  const rt = st.route || {cur: (st.idx || 1) - 2, next: (st.idx || 1) - 1, total: st.total};
  const n = Math.max(2, rt.total || 2), cur = rt.cur, nx = rt.next ?? cur + 1, p = Math.max(0, Math.min(1, rt.p || 0));
  const cy = y + 4, pitch = Math.min(24, Math.floor((w - 12) / (n - 1))), len = pitch * (n - 1), x0 = x + ((w - len) >> 1);
  const hs = pitch >= 12 ? 2 : pitch >= 5 ? 1 : 0, blink = UI.reduced || Math.floor((st.t || 0) * 4) % 2 === 0;
  /* track: 1 px line between lamps, red up to the train (the passed hops + p of the current one), green ahead */
  for (let i = 0; i < n - 1; i++){
    const a = x0 + i * pitch + hs + 1, b = x0 + (i + 1) * pitch - hs - 1;          // [a, b) between the lamps
    const split = i < cur ? b : i === cur ? Math.round(x0 + (i + p) * pitch) : a, s = Math.max(a, Math.min(b, split));
    if (s > a) R(g, a, cy, s - a, 1, 'board.red');
    if (b > s) R(g, s, cy, b - s, 1, 'board.green');
  }
  for (let i = 0; i < n; i++){
    const lx = x0 + i * pitch, passed = i < cur || (i === cur && p > 0), isNext = i === nx;   // the departed platform turns red as the train leaves it
    const [hi, lo] = passed ? ['board.red', 'board.redLo'] : isNext && !blink ? ['board.greenLo', 'board.greenDk'] : ['board.green', 'board.greenLo'];
    if (hs === 2){                                  // .LLL. / LHHHL ×3 / .LLL.
      R(g, lx - 1, cy - 2, 3, 1, lo); R(g, lx - 1, cy + 2, 3, 1, lo); R(g, lx - 2, cy - 1, 1, 3, lo); R(g, lx + 2, cy - 1, 1, 3, lo);
      R(g, lx - 1, cy - 1, 3, 3, hi);
      if (isNext && blink){                        // lit: a hot centre + a 1px halo ring (7×7, rounded) so a still frame shows it too
        R(g, lx, cy, 1, 1, 'board.hi');
        R(g, lx - 1, cy - 3, 3, 1, 'board.greenLo'); R(g, lx - 1, cy + 3, 3, 1, 'board.greenLo'); R(g, lx - 3, cy - 1, 1, 3, 'board.greenLo'); R(g, lx + 3, cy - 1, 1, 3, 'board.greenLo');
        R(g, lx - 2, cy - 2, 1, 1, 'board.greenDk'); R(g, lx + 2, cy - 2, 1, 1, 'board.greenDk'); R(g, lx - 2, cy + 2, 1, 1, 'board.greenDk'); R(g, lx + 2, cy + 2, 1, 1, 'board.greenDk');
      }
    } else if (hs === 1){                           // LHL / HHH / LHL (the lit next stop: a hot centre)
      R(g, lx - 1, cy - 1, 3, 3, lo); R(g, lx - 1, cy, 3, 1, hi); R(g, lx, cy - 1, 1, 3, hi);
      if (isNext && blink) R(g, lx, cy, 1, 1, 'board.hi');
    } else R(g, lx, cy - 1, 1, 3, hi);
  }
}

/* ---------- attribution ---------- */
function attribution(g, a){
  const t = UI.tag; if (t){ pill(g, a.x, a.y, PX.measure(t, 'fp8') + 5, 10, 'ink', 'ui.accent'); PX.text(g, t, a.x + 3, a.y + 2, {font: 'fp8', color: 'ink'}); }
  a.lines.forEach((s, k) => PX.text(g, s, a.x, a.y + (t ? 12 : 0) + k * 9, {font: 'fp8', color: 'textDim', outline: 'textOutline'}));
}

UI.draw = (g, st, L = UI.layout(PX.W || g.canvas.width, PX.H || g.canvas.height)) => {
  if (L.cluster.w > 0) cluster(g, L.cluster, st, L.portrait, L.compact);
  board(g, L.board, st, L.portrait, L.mq == null ? L.portrait : L.mq, !!L.tight); attribution(g, L.attribution);
  return L;
};
window.UI = UI;
})();
