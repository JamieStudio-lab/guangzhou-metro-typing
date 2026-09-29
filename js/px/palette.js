/* palette.js — the art bible's colours. PAL.night / PAL.day have IDENTICAL key trees; every pixel on the
   canvas must be one of these (PX.audit). Keys are ROLES, not hues: e.g. win.amber is a warm window light
   at night and a rooftop vent/skylight by day. Each theme is built from one small swatch set (sw) of
   hue-shifted ramps — shadows lean blue/violet, highlights lean warm — and the key tree only aliases
   those swatches, so each theme has ~60 art colours + the 19 official line colours.
   Ramp convention: d0 = darkest (also the ramp's own 1px outline), rising to hi. Light from top-left.
   v2 groups: veh.c0–c5 / taxi / green / roof {hi mid lo face} (face = the 1px oblique side), veh lights & beam;
   boat.w / boat.dk hull ramps, wood, LED strip, window keys; bld.res|com|ind|civ {r0 r1 r2 r3 hi = roof, f0 f1 f2 =
   facade SE / S / SW, always under r1}; wnd.* facade windows (night lit warm ×2 + cool + off; day glass ×2); tree.trunk. */
(function(){
/* official Guangzhou Metro line colours (identical in both themes; main strokes stay these hexes): js/data.js L.color when the game has
   loaded it (LINES, the canonical palette), else this copy (the px-dev / mockup harness) */
const LINE = {l1:'#F3D03E', l2:'#00629B', l3:'#ECA154', l4:'#00843D', l5:'#C5003E', l6:'#80225F', l7:'#97D700',
  l8:'#008C95', l9:'#71CC98', l10:'#7389B2', l11:'#FFB40C', l12:'#505D12', l13:'#8E8C13', l14:'#81312F',
  l18:'#0047BA', l21:'#201747', l22:'#CD5228', lgf:'#C4D600', lapm:'#00B5E2'};
try { if (typeof LINES !== 'undefined' && Array.isArray(LINES)) for (const L of LINES) if (L && L.id && /^#[0-9a-f]{6}$/i.test(L.color)) LINE[L.id] = L.color; } catch (e){}

const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
/* per-line shades lsh.<id>.{disp trav lo hi glow case sign ink led ledGlow txt}, derived per theme from the official hex (contrast maths =
   js/game.js lumOf / txOn / dispOf / btnBg). Every lightness change moves along the line's own hue in OKLab (shift / atL: L changed,
   chroma kept — trimmed only to stay inside sRGB), never by mixing toward white or black. disp = the DISPLAY colour of the ridden line
   (track core, car stripe, next-stop marker, cluster arc): at night lightened until ≥ 3:1 on the ground (land.d1), by day the official
   hex unless it melts into the ground (< 1.6:1: darkened until 1.6); trav = disp dimmed like lineDim (the travelled track); lo → the
   theme's dark end (sw.k0), hi = a lighter step of the line's own hue with a 15 % warm bias toward sw.a5, glow → the ground — at night
   from disp, by day from the official hex; case (track casing, day car halo) = lo, at night hi where the line melts into the ground, by
   day darkened until ≥ 2.5:1 on the ground; sign = the fill of anything carrying text on the line colour (next-stop sign, edge pointer,
   roundel): disp at night / official by day, nudged in lightness until dark or light ink reaches ≥ 4.5:1 (the smaller step wins);
   ink = that ink; led = lightened until ≥ 7:1 on the LED glass (board.glass, ui.js: #0d1024 in both themes; its 2 px dot grid dims
   it), ledGlow = its dot bleed (led 30 % into the glass; the same in both themes, like the LED face); txt = line-colour text on the
   cluster's screens (led.bg): lightened at night / darkened by day until ≥ 3.5:1. o.lsh = hand-tuned overrides (Line 3). */
const lumOf = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)).reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0);
const crOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const lin = c => (c /= 255) <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4), gam = v => v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055;
const oklab = hex => { const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.substr(i, 2), 16)));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]; };
const linOf = (L, a, b) => { const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]; };
const atL = (hex, L) => { const [, a, b] = oklab(hex), ok = k => linOf(L, a * k, b * k).every(v => v >= -1e-4 && v <= 1.0001); let k = 1;   // hex at OKLab lightness L
  if (!ok(1)){ let lo = 0, hi = 1; for (let i = 0; i < 14; i++){ const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } k = lo; }
  return '#' + linOf(L, a * k, b * k).map(v => Math.round(255 * gam(Math.max(0, Math.min(1, v)))).toString(16).padStart(2, '0')).join(''); };
/* hex lightened (up) / darkened in OKLab L until its contrast with ref reaches min (unchanged if it already does; null if impossible) */
const shift = (hex, ref, min, up) => { const y = up ? (lumOf(ref) + .05) * min - .05 : (lumOf(ref) + .05) / min - .05, pass = h => up ? lumOf(h) >= y : lumOf(h) <= y;
  if (pass(hex)) return hex.toLowerCase(); if (y > 1 || y < 0) return null;
  let lo = oklab(hex)[0], hi = up ? 1 : 0; for (let i = 0; i < 18; i++){ const m = (lo + hi) / 2; if (pass(atL(hex, m))) hi = m; else lo = m; }
  return atL(hex, hi); };
const GLASS = '#0d1024', SIGN_MIN = 4.5, LED_MIN = 7;
function shades(sw, o){
  const night = o.night, ground = sw.l1, A5 = oklab(sw.a5)[0], out = {};
  const signOf = f => { if (Math.max(crOf(f, sw.k0), crOf(f, sw.k11)) >= SIGN_MIN) return f;
    const a = shift(f, sw.k0, SIGN_MIN, true), d = shift(f, sw.k11, SIGN_MIN, false), b = night && d && crOf(d, ground) < 3 ? null : d, L = oklab(f)[0];   // (night: never darker than disp's 3:1)
    return !a || !b ? a || b || f : Math.abs(oklab(a)[0] - L) <= Math.abs(oklab(b)[0] - L) ? a : b; };
  for (const id in LINE){
    const c = LINE[id].toLowerCase(), p = o.lsh[id] || {};
    const disp = p.disp || (night ? shift(c, ground, 3, true) : shift(c, ground, 1.6, false)) || c, base = night ? disp : c, L = oklab(base)[0];
    const lo = mix(base, sw.k0, night ? .45 : .35), hi = mix(atL(base, L + (A5 - L) * (night ? .55 : .5)), sw.a5, .15), glow = mix(base, ground, night ? .7 : .6);
    const cs = night ? (crOf(disp, ground) >= 2 || crOf(lo, ground) >= crOf(hi, ground) ? lo : hi) : shift(lo, ground, 2.5, false) || lo;
    const sign = signOf(night ? disp : c), led = shift(c, GLASS, LED_MIN, true) || '#ffffff';
    out[id] = {disp, trav: mix(disp, o.dimBase, o.dimT), lo, hi, glow, case: cs, sign, ink: crOf(sign, sw.k0) >= crOf(sign, sw.k11) ? sw.k0 : sw.k11,
      led, ledGlow: mix(led, GLASS, .7), txt: shift(c, o.ledBg, 3.5, night) || c, ...p};
  }
  return out;
}
function build(sw, o){
  return {
    ink: sw.k0, shadow: o.shadow, bg: o.bg,
    land:  {d0: sw.l0, d1: sw.l1, d2: sw.l2, d3: sw.l3},
    block: {d0: sw.k1, d1: sw.b1, d2: sw.b2, d3: sw.b3, d4: sw.b4, hi: sw.b5},       // city blocks & roofs
    roofV: {d1: sw.v1, d2: sw.v2, d3: sw.v3},                                          // roof variant (violet / terracotta)
    win:   o.win,
    road:  {curb: sw.l0, walk: o.walk, surf: sw.r0, major: sw.r1, mark: sw.rm, centre: o.centre, lit: o.lit},
    water: {deep: sw.w0, d1: sw.w1, mid: sw.w2, shallow: sw.w3, shore: sw.w4, foam: sw.w5, glint: o.glint},
    green: {d0: sw.g0, d1: sw.g1, d2: sw.g2, d3: sw.g3, d4: sw.g4, hi: sw.g5},
    sand:  {d1: sw.s1, d2: sw.s2, d3: sw.s3, hi: sw.s4},
    rail:  {bed: sw.s1, tie: o.tie, steel: sw.k7, steelHi: sw.k9},
    line: {...LINE},
    lineDim: Object.fromEntries(Object.entries(LINE).map(([k, v]) => [k, mix(v, o.dimBase, o.dimT)])),   // other lines as map context
    lsh:   shades(sw, o),                                                              // per-line shades (above), keyed by line id
    stn:   {fill: o.stnFill, lo: o.stnLo, ring: sw.k0, done: o.done, doneLo: o.doneLo, doneRing: o.doneRing, plat: o.plat, platLo: o.platLo},
    car:   {d0: sw.k0, lo: o.carLo, mid: o.carMid, hi: o.carHi, top: o.carTop, glass: o.glass, glassHi: o.glassHi, lamp: sw.a5, tail: sw.red, vent: o.vent},
    tower: o.tower,
    lm:    o.lm,                                                                        // other landmarks
    lamp:  {pole: o.pole, head: o.lampHead, glow1: o.glow1, glow2: o.glow2, glow3: o.glow3},
    veh:   {a: o.vehA, aLo: o.vehALo, b: o.vehB, bLo: o.vehBLo, bus: sw.a3, busLo: sw.a2, glass: o.glass, head: sw.a5, tail: sw.red,
            ...o.veh},                                                                  // v2 top-view traffic (see o.veh)
    boat:  {hull: o.hull, hullLo: o.hullLo, deck: o.deck, cabin: o.cabin, light: o.boatLight, ...o.boat},
    bld:   o.bld,                                                                       // v2 oblique buildings: per family roof ramp r0..hi + facade ramp f0..f2 (f2 ≤ r1)
    wnd:   o.wnd,                                                                       // v2 facade windows (night: lit warm ×2, cool, off; day: glass ×2)
    tree:  o.tree,                                                                      // v2 3/4 trees: trunk
    text: o.text, textDim: o.textDim, textOutline: o.textOutline,
    ui:    {panel: o.panel, panel2: o.panel2, edge: o.edge, hi: o.uiHi, lo: o.uiLo, accent: o.accent, accentLo: o.accentLo},
    led:   {on: o.ledOn, off: o.ledOff, glow: o.ledGlow, bg: o.ledBg},
    hud:   {good: o.good, warn: o.warn, bad: o.bad},
    fire:  {lo: o.fire[0], t1: o.fire[1], t2: o.fire[2], t3: o.fire[3], core: o.fire[4]},
  };
}

/* ---------- NIGHT: Guangzhou after dark — deep navy/indigo, warm amber lights, dark teal river ---------- */
const N = {
  k0:'#070816', k1:'#0d1024', k2:'#141935', k3:'#1c2244', k4:'#262d55', k5:'#323b68', k6:'#434e80',
  k7:'#5b679b', k8:'#7c87ba', k9:'#a6aed8', k10:'#d0d5f0', k11:'#f1f1ff',
  b1:'#1c2244', b2:'#23244f', b3:'#2f3166', b4:'#3f4381', b5:'#595fa3',                 // roofs: indigo
  v1:'#241a44', v2:'#34275c', v3:'#4a3879',                                               // roofs: violet
  a1:'#5a3030', a2:'#9c4a2c', a3:'#e0802c', a4:'#ffb445', a5:'#ffe29a', red:'#ff5a64',   // warm lights
  c1:'#86a8e6', c2:'#d8e8ff',                                                             // cool lights
  l0:'#0d1024', l1:'#11162a', l2:'#171d34', l3:'#1f2640',                                 // ground (slate)
  r0:'#262c44', r1:'#2e3550', rm:'#434e80',                                               // asphalt
  w0:'#041620', w1:'#07212c', w2:'#0b2e3b', w3:'#12404e', w4:'#1f5864', w5:'#4a8a92',     // river: dark teal
  g0:'#08181a', g1:'#0d2426', g2:'#14332f', g3:'#1d453a', g4:'#2c5e4a', g5:'#4a7d5e',     // parks
  s1:'#262338', s2:'#34304a', s3:'#47405e', s4:'#5f5676',                                 // plaza / sand
  m1:'#4a2470', m2:'#8a34a0', m3:'#d45ac8', m4:'#ffa6ea', m5:'#c4acff',                   // tower lights
};
const night = build(N, {
  win: {dim: N.a1, warm: N.a2, orange: N.a3, amber: N.a4, hot: N.a5, cool: N.c1, coolHi: N.c2},
  bg: N.k1, shadow: N.k0, dimBase: N.l1, dimT: .5, walk: N.l3, centre: '#8a7a58', lit: '#3a2e3e', glint: N.a4, tie: N.k3,
  night: true, lsh: {l3: {lo: '#8a5230', hi: '#ffd296', glow: N.a1, case: '#8a5230', txt: LINE.l3, ledGlow: N.a1}},   // Line 3: hand-tuned (mockup v3)
  stnFill: N.k11, stnLo: N.k9, done: N.k6, doneLo: N.k5, doneRing: N.k1, plat: N.k6, platLo: N.k4,
  carLo: N.k8, carMid: N.k9, carHi: N.k10, carTop: N.k11, glass: N.k2, glassHi: N.c1, vent: N.k7,
  tower: {ol: N.k0, void: N.k1, core: N.v1, d1: N.v3, d2: N.m1, d3: N.m2, d4: N.m3, hi: N.m4, top: N.k11, lilac: N.m5, violet: '#7a64c4', glow: N.v2, glow2: N.m1, beacon: N.red, base: N.s2, baseLo: N.s1},
  lm: {ol: N.k0, g0: N.k2, g1: N.k3, g2: N.k4, g3: N.k6, rib: N.k8, ribHi: N.k10, crown: N.c2, lit: N.a4, lit2: N.a3, cool: N.c1, stoneLo: N.k2, stone: N.k4, stoneHi: N.k6, sail: N.k9, sailLo: N.k7},
  pole: N.k5, lampHead: N.a5, glow1: '#3a2e3e', glow2: N.a1, glow3: N.a2,
  hull: N.k8, hullLo: N.k6, deck: N.k4, cabin: N.k3, boatLight: N.a4,
  vehA: N.k9, vehALo: N.k7, vehB: N.c1, vehBLo: N.k6,
  /* v2 traffic, night: bodies sit 1–2 steps under the train's roof ramp (k9–k11) so the player always reads first */
  veh: {c0: {hi: N.k9, mid: N.k8, lo: N.k7, face: N.k5},                                // white
        c1: {hi: N.k7, mid: N.k6, lo: N.k5, face: N.k3},                                // silver
        c2: {hi: N.k5, mid: N.k3, lo: N.k2, face: N.k1},                                // black
        c3: {hi: '#c25068', mid: '#8e3050', lo: '#64213e', face: '#42182e'},            // red
        c4: {hi: '#5b82d6', mid: '#3d5cae', lo: '#2b4184', face: '#1d2b5c'},            // blue
        c5: {hi: '#a89274', mid: '#7e6c5a', lo: '#5c4e48', face: '#3c3238'},            // champagne
        taxi: {hi: '#f0884a', mid: '#c85a2c', lo: '#943c26', face: '#62281e'},          // Guangzhou 闪电橙 (lightning orange, 2021 livery)
        green: {hi: '#4aa878', mid: '#2e7c5a', lo: '#205a46', face: '#153c32'},         // bus livery
        roof: {hi: N.k8, mid: N.k7, lo: N.k6, face: N.k4},                              // bus roof / truck box
        glassHi: N.k6, head2: N.k11, lamp: N.k7, tailOff: '#6a2a3a', sign: N.a5, signOff: N.k8,
        beam1: N.a2, beam2: N.a1, busWin: N.a4},                                        // headlight throw: warm, sparse (review 1)
  boat: {w: {hi: N.k9, mid: N.k8, lo: N.k7, face: N.k5}, dk: {hi: N.k5, mid: N.k4, lo: N.k3, face: N.k2},
         wood: {hi: '#6a5048', mid: '#4c3a3c', lo: '#342a34'}, rust: '#5a2e36', win: N.a4, winHi: N.a5,
         led1: N.m4, led2: '#5ad8ff', led3: N.a4, stripe: '#3a6ac8', red: N.red, green: '#4ad48a'},
  bld: {res: {r0: N.k1, r1: N.b1, r2: N.b2, r3: N.b3, hi: N.b4, f0: '#12132e', f1: '#17183a', f2: '#1d1f46'},
        com: {r0: N.k1, r1: '#1e2740', r2: '#27324e', r3: '#33405e', hi: '#4a5a7c', f0: '#0e1528', f1: '#131c34', f2: '#1a2542'},
        ind: {r0: N.k1, r1: '#1b2530', r2: '#232f3c', r3: '#2e3c4a', hi: '#415366', f0: '#0f151c', f1: '#141b24', f2: '#1a232e'},
        civ: {r0: N.k1, r1: N.v1, r2: N.v2, r3: N.v3, hi: '#5f4b92', f0: '#150f2a', f1: '#1b1434', f2: '#221a40'}},
  wnd: {lit1: N.a3, lit2: N.a4, cool: N.c1, off: '#0a0b1c', glass1: '#1a2848', glass2: '#24365a'},
  tree: {trunk: '#2a1e2a', trunkLo: '#1c1422'},
  text: N.k11, textDim: N.k8, textOutline: N.k0,
  panel: N.k2, panel2: N.k3, edge: N.k0, uiHi: N.k5, uiLo: N.k1, accent: N.a4, accentLo: N.a2,
  ledOn: N.a4, ledOff: '#2a1e26', ledGlow: N.a1, ledBg: N.k1,
  good: '#5fd38c', warn: N.a4, bad: N.red,
  fire: [N.a2, N.a3, N.a4, N.red, N.a5],
});

/* ---------- DAY: soft daylight — warm cream ground, pale roofs, sage parks, calm blue river ---------- */
const D = {
  k0:'#3a3348', k1:'#4d4659', k2:'#61596b', k3:'#776f7f', k4:'#8e8795', k5:'#a59fab', k6:'#bbb6bf',
  k7:'#cfcacd', k8:'#dfdad6', k9:'#ebe6de', k10:'#f4f0e6', k11:'#fbf8f0',
  b1:'#b9aea4', b2:'#cbc1b4', b3:'#dbd2c3', b4:'#e8e0d0', b5:'#f5efe2',                 // roofs: warm cream-grey
  v1:'#c09a88', v2:'#d2ae98', v3:'#e2c4ac',                                               // roofs: terracotta
  a1:'#7d8fa6', a2:'#97abc0', a3:'#b3c7d6', a4:'#cfdee6', a5:'#f2e3b0', red:'#d9434d',   // glass by day
  c1:'#8fb5d6', c2:'#e4f0f6',
  l0:'#cbc3b0', l1:'#d8d1bf', l2:'#e3ddcc', l3:'#ece7d8',                                 // ground (cream)
  r0:'#ebe6de', r1:'#f4f0e6', rm:'#bbb6bf',                                               // pale concrete roads (lighter than the ground)
  w0:'#4d86a0', w1:'#5b95ae', w2:'#6ea7bd', w3:'#88bccb', w4:'#a8d1d9', w5:'#d6ebe7',     // river: calm blue
  g0:'#46634a', g1:'#577753', g2:'#6a8b5d', g3:'#809f6b', g4:'#9ab47f', g5:'#b8ca98',     // parks: sage
  s1:'#c7b28c', s2:'#d6c39d', s3:'#e3d4b0', s4:'#eee3c6',                                 // plaza / sand
};
const day = build(D, {
  win: {dim: D.b1, warm: D.b1, orange: D.v1, amber: D.b2, hot: D.b5, cool: D.a2, coolHi: D.a4},   // by day: rooftop vents & skylights
  bg: D.k7, shadow: '#9f98a2', walk: D.l0, dimBase: D.l2, dimT: .45, centre: '#e8b64a', lit: D.r1, glint: D.k11, tie: D.k4,
  night: false, lsh: {l3: {disp: LINE.l3, lo: '#b8702e', hi: '#f7cf9c', glow: '#f1d9b8', case: '#b8702e', txt: '#b8702e', ledGlow: N.a1}},   // (1.41:1 on the ground: approved)
  stnFill: D.k11, stnLo: D.k7, done: D.k6, doneLo: D.k5, doneRing: D.k3, plat: D.k8, platLo: D.k6,
  carLo: D.k6, carMid: D.k8, carHi: D.k10, carTop: D.k11, glass: D.k1, glassHi: D.c1, vent: D.k5,
  tower: {ol: D.k0, void: D.k3, core: D.k4, d1: D.k5, d2: D.k6, d3: D.k7, d4: D.k8, hi: D.k10, top: D.k11, lilac: D.k9, violet: D.k6, glow: D.k6, glow2: D.k7, beacon: D.red, base: D.s2, baseLo: D.s1},
  lm: {ol: D.k0, g0: D.a1, g1: D.a2, g2: D.a3, g3: D.a4, rib: D.k8, ribHi: D.k11, crown: D.k10, lit: D.a4, lit2: D.a3, cool: D.c1, stoneLo: D.k2, stone: D.k3, stoneHi: D.k5, sail: D.k11, sailLo: D.k7},
  pole: D.k3, lampHead: D.k7, glow1: D.k8, glow2: D.k9, glow3: D.k10,
  hull: D.k11, hullLo: D.k6, deck: D.v2, cabin: D.k8, boatLight: D.c1,
  vehA: D.a2, vehALo: D.a1, vehB: D.v2, vehBLo: D.v1,                 // coloured bodies: ≥2 steps off the pale concrete and the white train
  veh: {c0: {hi: D.k11, mid: D.k10, lo: D.k8, face: D.k6},
        c1: {hi: D.k8, mid: D.k6, lo: D.k5, face: D.k4},
        c2: {hi: D.k3, mid: D.k1, lo: D.k0, face: '#2a2436'},
        c3: {hi: '#e8606a', mid: '#c83c48', lo: '#9a2c3c', face: '#6e2030'},
        c4: {hi: '#6a98e0', mid: '#3f6cc0', lo: '#2e5096', face: '#223a6c'},
        c5: {hi: '#e6d4b0', mid: '#cbb48c', lo: '#a8906e', face: '#7e6a54'},
        taxi: {hi: '#f59a5a', mid: '#e0662a', lo: '#b04a20', face: '#7a3418'},
        green: {hi: '#6cc08e', mid: '#3f9a66', lo: '#2e7a50', face: '#1f5638'},
        roof: {hi: D.k11, mid: D.k9, lo: D.k7, face: D.k5},
        glassHi: D.a3, head2: D.k11, lamp: D.k7, tailOff: '#a8454e', sign: D.k11, signOff: D.k7,
        beam1: D.l3, beam2: D.l2, busWin: D.a1},
  boat: {w: {hi: D.k11, mid: D.k10, lo: D.k8, face: D.k6}, dk: {hi: D.k3, mid: D.k2, lo: D.k1, face: D.k0},
         wood: {hi: '#c89a6a', mid: '#a87a52', lo: '#80603e'}, rust: '#9a5040', win: D.a1, winHi: D.a3,
         led1: D.v2, led2: D.a3, led3: D.b1, stripe: '#2f6fc0', red: D.red, green: '#3f9a63'},
  bld: {res: {r0: D.k1, r1: D.b1, r2: D.b2, r3: D.b3, hi: D.b4, f0: '#8a8076', f1: '#9e9388', f2: '#b1a698'},
        com: {r0: D.k1, r1: '#a4adb9', r2: '#b8c0ca', r3: '#cbd2da', hi: '#e0e5ea', f0: '#56708a', f1: '#6a86a0', f2: '#809cb4'},
        ind: {r0: D.k1, r1: '#a3a79f', r2: '#b7bab2', r3: '#cacdc5', hi: '#dfe0d8', f0: '#7c8078', f1: '#8f938a', f2: '#a3a69c'},
        civ: {r0: D.k1, r1: D.v1, r2: D.v2, r3: D.v3, hi: '#efd6c0', f0: '#8e6a5c', f1: '#a27a6a', f2: '#b68c7a'}},
  wnd: {lit1: '#a9bccb', lit2: D.a4, cool: D.c2, off: '#5d6f86', glass1: D.a1, glass2: D.a2},
  tree: {trunk: '#7a5a44', trunkLo: '#5a4032'},
  text: D.k0, textDim: D.k2, textOutline: D.k11,
  panel: D.k10, panel2: D.k9, edge: D.k3, uiHi: D.k11, uiLo: D.k7, accent: '#d98a1c', accentLo: '#a8621a',
  ledOn: '#d98a1c', ledOff: D.k8, ledGlow: D.v3, ledBg: D.k10,
  good: '#3f9a63', warn: '#d98a1c', bad: D.red,
  fire: ['#a8621a', '#d98a1c', '#f0b440', D.red, '#fbe7a6'],
});

/* ---------- RAIN (v3, weather.js): falling streaks, splashes, puddles, and the WET palette swap ----------
   rain.* = the few rain-only art colours (identical key trees in both themes). rain.wet.<group_path> = the "wet" twin of
   every map colour (a classic palette swap, SNES-style: slightly darker and cooler; weather.js swaps a pixel to its twin
   through an ordered Bayer dither while a spell fades in/out, never by alpha). The twins are generated from the base
   swatches by one fixed per-theme curve, so the rainy scene keeps the exact same ramps, one notch wetter. */
const WETG = ['ink', 'shadow', 'bg', 'land', 'block', 'roofV', 'win', 'road', 'water', 'green', 'sand', 'rail', 'lineDim', 'tower', 'lm',
  'lamp', 'veh', 'boat', 'bld', 'wnd', 'tree'];
const flat = (o, p, out) => { for (const k in o){ const v = o[k], q = p ? p + '_' + k : k; if (typeof v === 'string') out[q] = v; else flat(v, q, out); } return out; };
const wetOf = (hex, m, tint, t) => { const c = [1, 3, 5].map((i, j) => parseInt(hex.substr(i, 2), 16) * m[j]), tc = [1, 3, 5].map(i => parseInt(tint.substr(i, 2), 16));
  return '#' + c.map((v, j) => Math.max(0, Math.min(255, Math.round(v * (1 - t) + tc[j] * t))).toString(16).padStart(2, '0')).join(''); };
function addRain(P, r, m, tint, t){
  const src = {}; for (const g of WETG) flat({[g]: P[g]}, '', src);
  for (const id in P.lsh) src['lsh_' + id + '_trav'] = P.lsh[id].trav;               // the ridden line's travelled track gets wet like lineDim
  const wet = {}; for (const q in src) wet[q] = wetOf(src[q], m, tint, t);
  P.rain = {...r, wet};
}
addRain(night, {
  near: '#9fb0d2', nearLo: '#61709e', far: '#46547f', tip: '#9fb0d2',                   // streaks: head / tail of a near drop, far drops (tip: day only)
  splash: '#b9c7e2', splash2: '#6f7fab',                                                 // 2-frame splash crown on roads / roofs
  puddle: '#343c6c', puddleLo: '#262d52', glint: '#a6b4d8', glintWarm: N.a3,            // puddles mirror the city-lit sky (violet-blue), a lamp nearby warms them
  ring: N.w5, ring2: N.w4, ring3: N.w3,                                                  // rings on the river (foam → shore → shallow)
}, [.8, .85, .95], '#0a1030', .06);
addRain(day, {
  near: '#3f4d63', nearLo: '#66778f', far: '#7a8aa0', tip: '#eef3f6',                  // day (review round 1): a dark slate head ≥ 2 steps under the wet
                                                                                         // pavement AND the wet river, a light tip pixel so it reads on both
  splash: '#d6dde4', splash2: '#b8c6d2',                                                 // day splash: a cool light grey, not a white sparkle
  puddle: '#9aa7b3', puddleLo: '#b3bdc6', glint: '#eef3f6', glintWarm: '#eef3f6',
  ring: D.w5, ring2: D.w4, ring3: D.w3,
}, [.86, .89, .93], '#6f7f96', .1);

window.PAL = {night, day};
})();
