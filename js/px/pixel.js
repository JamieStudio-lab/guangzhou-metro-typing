/* pixel.js — shared pixel-art core for the Metro Typing pixel mockup.
   THE RULES (every file must follow them, this is what keeps the style consistent):
   1. Everything is drawn onto ONE art-resolution canvas (PX.W × PX.H art pixels), shown at an
      integer CSS scale (PX.scale, default 2) with image-rendering:pixelated. No DOM art, no CSS-scaled
      elements, no second pixel size anywhere ("mixels").
   2. Integer coordinates only. Round every draw position. No sprite rotation/scaling at draw time,
      no imageSmoothing, no anti-aliased edges left in the frame: vector shapes go through PX.mask()
      (alpha-thresholded) before they are coloured.
   3. Every final pixel is a colour from the active palette (PX.pal, from palette.js). PX.audit() counts
      stray colours in a frame — it must report 0.
   4. Text only via PX.text()/PX.ledText() with the pixel fonts at their native sizes.
   Classic script, no modules (must work from file://). Exposes the global PX.
   Ride data + line: PX.use(d, line) sets PX.D (the one data handle every module's init() defaults to: track / trackLen = the
   ridden track, ORIENTED in ride order, metres; stations in ride order, d = metres along it; optional trackClose = a loop line's
   decorative closing polyline, drawn, never ridden) and PX.lineId (line id, e.g. 'l3'). PX.lk(role) → the palette key of the
   current line's colour role: 'line' (official hex), 'dim' (map context), or lsh.<id>.{lo hi glow case ink led ledGlow txt} (palette.js).
   API (each section below documents its own): PX.lru(cap) · makeCanvas · rgb / col / setTheme / lum / contrast / paletteList ·
   bayer / ditherPick (4×4 ordered dither: every fade and transition) · mask / maskEdge / maskGrow / paintMask (vector → crisp
   coverage) · rect / px / line / polyline / disc / ring · bake / blit (sprites) · FONTS / text / measure / textBox / ledText ·
   panel · audit (stray colours of a frame, must be 0) / clearCaches. */
(function(){
const PX = {scale:2, W:0, H:0, pal:null, theme:'night', D:null, lineId:'l3'};
PX.use = (d, line) => { PX.D = d; if (line) PX.lineId = line; return d; };
PX.lk = (role = 'line', id = PX.lineId) => role === 'line' ? 'line.' + id : role === 'dim' ? 'lineDim.' + id : 'lsh.' + id + '.' + role;
/* least-recently-used map (Map keeps insertion order: a hit is re-inserted, the oldest goes first) */
PX.lru = cap => { const m = new Map(); return {m, clear: () => m.clear(), get size(){ return m.size; },
  get(k){ const v = m.get(k); if (v !== undefined){ m.delete(k); m.set(k, v); } return v; },
  set(k, v){ m.delete(k); m.set(k, v); if (m.size > cap) m.delete(m.keys().next().value); return v; }}; };

/* ---------- canvases & colour ---------- */
PX.makeCanvas = (w, h) => {
  const c = document.createElement('canvas'); c.width = Math.max(1, w|0); c.height = Math.max(1, h|0);
  const g = c.getContext('2d', {willReadFrequently:true}); g.imageSmoothingEnabled = false;
  return {c, g};
};
const rgbCache = new Map();
PX.rgb = hex => {                       // '#rrggbb' -> [r,g,b]
  let v = rgbCache.get(hex); if (v) return v;
  const h = hex.replace('#','');
  v = [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  rgbCache.set(hex, v); return v;
};
PX.col = key => {                       // palette key -> hex ('#...' passes through)
  if (!key) return null;
  if (key[0] === '#') return key;
  const p = PX.pal, v = key.split('.').reduce((o,k) => o && o[k], p);
  if (!v) throw new Error('PX.col: unknown palette key "' + key + '" in theme ' + PX.theme);
  return v;
};
PX.setTheme = name => { PX.theme = name; PX.pal = PAL[name]; PX.clearCaches(); };
/* WCAG relative luminance / contrast ratio of palette keys or hexes (the same maths as js/game.js lumOf / crOf) */
PX.lum = key => PX.rgb(PX.col(key)).map(c => (c /= 255) <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)).reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0);
PX.contrast = (a, b) => { const x = PX.lum(a), y = PX.lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
/* every colour in the active palette (nested objects flattened) */
PX.paletteList = () => {
  const out = new Set(), walk = o => { for (const k in o){ const v = o[k]; if (typeof v === 'string' && v[0] === '#') out.add(v.toLowerCase()); else if (v && typeof v === 'object') walk(v); } };
  walk(PX.pal); return [...out];
};

/* ---------- ordered dither (Bayer 4×4), for gradients/glows made of palette colours ---------- */
const B4 = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5];
PX.bayer = (x, y) => (B4[((y & 3) << 2) | (x & 3)] + .5) / 16;   // 0..1 threshold
PX.ditherPick = (x, y, t, a, b) => (t > PX.bayer(x, y) ? b : a);  // t=0 → a, t=1 → b

/* ---------- masks: vector drawing → crisp binary coverage ---------- */
/* PX.mask(w,h,draw) runs draw(g) on a scratch canvas (draw in any opaque colour), then thresholds
   alpha at 50% → Uint8Array (1 = covered). Use it for every vector shape (polygons, thick paths). */
PX.mask = (w, h, draw) => {
  const {g} = PX.makeCanvas(w, h);
  g.fillStyle = g.strokeStyle = '#fff'; draw(g);
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j] >= 128 ? 1 : 0;
  return m;
};
PX.maskEdge = (m, w, h, diag) => {      // pixels in m that touch a pixel outside m (inner outline)
  const e = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x; if (!m[i]) continue;
    const out = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx];
    if (out(x-1,y) || out(x+1,y) || out(x,y-1) || out(x,y+1) || (diag && (out(x-1,y-1) || out(x+1,y-1) || out(x-1,y+1) || out(x+1,y+1)))) e[i] = 1;
  }
  return e;
};
PX.maskGrow = (m, w, h, r = 1) => {     // dilate by r pixels (square)
  let cur = m;
  for (let k = 0; k < r; k++){
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x; if (cur[i]){ o[i] = 1; continue; }
      if ((x > 0 && cur[i-1]) || (x < w-1 && cur[i+1]) || (y > 0 && cur[i-w]) || (y < h-1 && cur[i+w])) o[i] = 1;
    }
    cur = o;
  }
  return cur;
};
/* paint a mask into an ImageData; colour = hex or fn(x,y) -> hex|null */
PX.paintMask = (img, m, colour) => {
  const d = img.data, w = img.width, fixed = typeof colour === 'string' ? PX.rgb(colour) : null;
  for (let i = 0; i < m.length; i++){
    if (!m[i]) continue;
    let c = fixed;
    if (!c){ const h = colour(i % w, (i / w) | 0); if (!h) continue; c = PX.rgb(h); }
    const j = i << 2; d[j] = c[0]; d[j+1] = c[1]; d[j+2] = c[2]; d[j+3] = 255;
  }
};

/* ---------- primitives (integer, no AA) ---------- */
PX.rect = (g, x, y, w, h, key) => { g.fillStyle = PX.col(key); g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
PX.px = (g, x, y, key) => { g.fillStyle = PX.col(key); g.fillRect(Math.round(x), Math.round(y), 1, 1); };
/* Bresenham line with a square brush of size `thick` */
PX.line = (g, x0, y0, x1, y1, key, thick = 1) => {
  g.fillStyle = PX.col(key);
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, o = (thick - 1) >> 1;
  let err = dx + dy;
  for (;;){
    g.fillRect(x0 - o, y0 - o, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy){ err += dy; x0 += sx; }
    if (e2 <= dx){ err += dx; y0 += sy; }
  }
};
PX.polyline = (g, pts, key, thick = 1) => { for (let i = 1; i < pts.length; i++) PX.line(g, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1], key, thick); };
/* filled disc / ring of integer radius, pixel-exact */
PX.disc = (g, cx, cy, r, key) => {
  g.fillStyle = PX.col(key); cx = Math.round(cx); cy = Math.round(cy);
  for (let y = -r; y <= r; y++){ const hw = Math.floor(Math.sqrt(r * r + r * .8 - y * y)); g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1); }
};
PX.ring = (g, cx, cy, r, key) => {
  g.fillStyle = PX.col(key); cx = Math.round(cx); cy = Math.round(cy);
  const inside = (x, y, rr) => x * x + y * y <= rr * rr + rr * .8;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (inside(x, y, r) && !inside(x, y, r - 1)) g.fillRect(cx + x, cy + y, 1, 1);
};

/* ---------- sprites ----------
   sprite = {w, h, rows:[...strings of length w], key:{ch:'paletteKey'}}; '.' or ' ' = transparent.
   Pre-bake with PX.bake(sprite) (per theme; cached). Blit at integer positions only. */
const bakeCache = new Map();
PX.bake = (spr, opts = {}) => {
  const k = spr.id + '|' + PX.theme + '|' + (opts.flipX ? 'fx' : '') + (opts.flipY ? 'fy' : '') + '|' + (opts.remap ? JSON.stringify(opts.remap) : '');
  let c = bakeCache.get(k); if (c) return c;
  const {c: cv, g} = PX.makeCanvas(spr.w, spr.h);
  for (let y = 0; y < spr.h; y++){
    const row = spr.rows[y];
    for (let x = 0; x < spr.w; x++){
      const ch = row[x]; if (ch === '.' || ch === ' ' || ch === undefined) continue;
      let key = spr.key[ch]; if (!key) continue;
      if (opts.remap && opts.remap[key]) key = opts.remap[key];
      g.fillStyle = PX.col(key);
      g.fillRect(opts.flipX ? spr.w - 1 - x : x, opts.flipY ? spr.h - 1 - y : y, 1, 1);
    }
  }
  bakeCache.set(k, cv); return cv;
};
PX.blit = (g, spr, x, y, opts) => g.drawImage(spr instanceof HTMLCanvasElement ? spr : PX.bake(spr, opts), Math.round(x), Math.round(y));

/* ---------- text ----------
   Fonts are registered by fonts.js (FontFace from embedded data, works on file://).
   Font ids → CSS font at the font's NATIVE pixel size (never scale a pixel font). */
PX.FONTS = {fp8:'8px FP8', fp10:'10px FP10', fp12:'12px FP12', fp16:'16px FP16'};
const glyphs = PX.lru(1500), textCache = PX.lru(1500), ledCache = PX.lru(64);   // glyph masks · coloured text canvases · LED text canvases
function glyphMask(str, font){
  const k = font + '|' + str; let v = glyphs.get(k); if (v) return v;
  const css = PX.FONTS[font] || font;
  const {g: mg} = PX.makeCanvas(4, 4); mg.font = css;
  const size = parseInt(css, 10) || 12, w = Math.ceil(mg.measureText(str).width) + 2, h = Math.ceil(size * 1.5) + 2;
  const {g} = PX.makeCanvas(w, h); g.font = css; g.textBaseline = 'top'; g.fillStyle = '#fff'; g.fillText(str, 1, 1);
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let i = 0; i < m.length; i++) if (d[i * 4 + 3] >= 128){ m[i] = 1; const x = i % w, y = (i / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  v = {m, w, h, adv: Math.round(mg.measureText(str).width), minX, maxX, minY, maxY};
  glyphs.set(k, v); return v;
}
/* PX.text(g, str, x, y, {font, color, outline, shadow, align}) → drawn width.
   y is the top of the text box. outline = palette key for a 1px 8-way outline; shadow = key for a 1px drop shadow (down-right). */
PX.text = (g, str, x, y, o = {}) => {
  const font = o.font || 'fp12', gm = glyphMask(String(str), font);
  const k = [font, str, o.color, o.outline, o.shadow, PX.theme].join('|');
  let cv = textCache.get(k);
  if (!cv){
    const pad = 1, {c, g: tg} = PX.makeCanvas(gm.w + pad * 2, gm.h + pad * 2), img = tg.createImageData(c.width, c.height);
    const put = (dx, dy, hex) => { const col = PX.rgb(PX.col(hex)); for (let i = 0; i < gm.m.length; i++){ if (!gm.m[i]) continue; const x = (i % gm.w) + pad + dx, y = ((i / gm.w) | 0) + pad + dy; const j = (y * c.width + x) * 4; img.data[j] = col[0]; img.data[j+1] = col[1]; img.data[j+2] = col[2]; img.data[j+3] = 255; } };
    if (o.outline) for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) put(dx, dy, o.outline);
    if (o.shadow) put(1, 1, o.shadow);
    put(0, 0, o.color || 'text');
    tg.putImageData(img, 0, 0); cv = c; textCache.set(k, cv);
  }
  const width = gm.adv;
  let dx = Math.round(x) - 2; if (o.align === 'center') dx -= Math.round(width / 2); else if (o.align === 'right') dx -= width;
  g.drawImage(cv, dx, Math.round(y) - 2 - (gm.minY > 1 && o.tight ? gm.minY - 1 : 0));
  return width;
};
PX.measure = (str, font = 'fp12') => glyphMask(String(str), font).adv;
PX.textBox = (str, font = 'fp12') => { const gm = glyphMask(String(str), font); return {w: gm.adv, top: gm.minY - 1, bottom: gm.maxY - 1, h: gm.maxY - gm.minY + 1}; };
/* LED dot-matrix text: each font pixel becomes one lit art pixel on a pitch-2 grid (1px dot + 1px gap),
   like a real metro LED sign. `off` draws the unlit dot grid over the text's box (optional). The dots are baked once per
   text|font|colours|pitch|theme into a small canvas (LRU, 64) and blitted 1:1. */
PX.ledText = (g, str, x, y, o = {}) => {
  const font = o.font || 'fp12', gm = glyphMask(String(str), font), pitch = o.pitch || 2, on = PX.col(o.on || 'led.on'), off = o.off ? PX.col(o.off) : null;
  const k = [font, str, on, off, pitch, PX.theme].join('|');
  let cv = ledCache.get(k);
  if (!cv){
    const {c, g: lg} = PX.makeCanvas(gm.w * pitch, gm.h * pitch);
    for (let yy = 0; yy < gm.h; yy++) for (let xx = 0; xx < gm.w; xx++){
      const lit = gm.m[yy * gm.w + xx];
      if (!lit && !off) continue;
      lg.fillStyle = lit ? on : off; lg.fillRect(xx * pitch, yy * pitch, 1, 1);
    }
    cv = ledCache.set(k, c);
  }
  const x0 = Math.round(x), y0 = Math.round(y);
  let ox = x0; if (o.align === 'center') ox -= Math.round(gm.adv * pitch / 2); else if (o.align === 'right') ox -= gm.adv * pitch;
  g.drawImage(cv, ox - pitch, y0 - pitch);
  return gm.adv * pitch;
};

/* ---------- panels: pixel frames for UI (1px outline, 1px bevel) ---------- */
PX.panel = (g, x, y, w, h, o = {}) => {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const fill = o.fill || 'ui.panel', edge = o.edge || 'ui.edge', hi = o.hi || 'ui.hi', lo = o.lo || 'ui.lo';
  PX.rect(g, x + 1, y, w - 2, 1, edge); PX.rect(g, x + 1, y + h - 1, w - 2, 1, edge);
  PX.rect(g, x, y + 1, 1, h - 2, edge); PX.rect(g, x + w - 1, y + 1, 1, h - 2, edge);
  PX.rect(g, x + 1, y + 1, w - 2, h - 2, fill);
  if (hi) PX.rect(g, x + 2, y + 1, w - 4, 1, hi);
  if (lo) PX.rect(g, x + 2, y + h - 2, w - 4, 1, lo);
};

/* ---------- audit: stray colours in a finished frame (must be 0) ---------- */
PX.audit = (g, w, h) => {
  const allowed = new Set(PX.paletteList().map(hx => PX.rgb(hx).join(','))), d = g.getImageData(0, 0, w, h).data, stray = new Map();
  let n = 0;
  for (let i = 0; i < d.length; i += 4){ if (d[i+3] === 0) continue; const k = d[i] + ',' + d[i+1] + ',' + d[i+2]; if (!allowed.has(k)){ n++; stray.set(k, (stray.get(k) || 0) + 1); } }
  return {stray: n, colours: [...stray.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)};
};

PX.clearCaches = () => { bakeCache.clear(); textCache.clear(); ledCache.clear(); };
window.PX = PX;
})();
