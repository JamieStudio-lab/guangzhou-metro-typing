/* labels.js — LABELS: station markers, station labels, the next-stop sign and the edge pointer (v2, SPEC.md
   "v2 architecture" §6.3, owner feedback #3: labels must be STABLE near the screen margin).
   Needs pixel.js, palette.js, fonts.js, sprites.js, train.js (TRAIN.along(s) → metres, v2). Global LABELS.

   LABELS.init(d = PX.D)                    line-agnostic: stations in ride order (d.stations[].d along TRAIN's track); sign /
                                            marker colours from PX.lk(role) of the current line PX.lineId.
   LABELS.drawMarkers(g, view, ss)          station roundels (next / done / todo; interchange variants) at anchor(i).
   LABELS.draw(g, view, ss, uiRects?)       labels: 汉字 (fp12) over toned pinyin (fp10), outlined; the highlighted
                                            station on the line-colour sign; then the edge pointer ([arrow] 汉字 1.5 km)
                                            while that platform is outside the free view. uiRects default
                                            [cluster, board, attribution] from view.ui; a rect with over: true is the page's
                                            DOM over the canvas (the chips) — even the sign fades under it.
   LABELS.anchor(i, view)                   → {x, y} screen art px of station i's ground point (markers + labels share it).
   LABELS.layout(lvl, k, highlight, seed?)  → the cached placement [{dx, dy, w, h, kind, show, ci (side)}] per station.
   LABELS.placement(lvl, k, highlight)      → the placement as SHOWN (seeded by the previous one: stations keep their side).
   LABELS.opts = {edge: 'clip' | 'fade', hud: 'fade' | 'under', fade: .2 (s)}
   LABELS.last                              what the last draw put on screen: {labels: [{i, x, y, w, h, a}], pointer}.
   ss = {status: ['done'|'next'|'todo', …], next, highlight?, trainS, hold? (freeze the pointer's on/off), …}; ss.cars / ss.landmarks are NOT used: the train
         and the per-frame screen rects depend on the camera, and nothing about a label may (feedback #3).

   HOW IT STAYS STABLE (the v1 bug: labels were re-scored every frame against the screen edges and the moving train,
   so near the margin they hopped between candidate spots and blinked):
   - Placement is solved ONCE per key `lvlTo|k|highlight`, in level px, from camera-independent inputs only: the
     stations' anchors, the track near each station, landmark boxes (from d.landmarks + a size table, never
     the per-frame screen rects) and font metrics. Priority: highlight, interchanges, then |i − highlight|.
   - Every frame a label is drawn at anchor + cached offset: it scrolls with the map pixel for pixel, the canvas clips
     it at the screen edge (opts.edge 'fade' instead hides it with a time-based dither fade, hysteresis 1 / 4 px).
   - A label that slides under a HUD panel fades out (dither, 0.2 s, time-based) and back once it is ≥ 4 px clear
     (opts.hud 'under' = let the HUD simply cover it); a panel hugging a screen edge owns the strip up to that edge.
     The highlighted sign never fades for the HUD (it cross-fades with the edge pointer instead), only under the page's chips (over).
   - When the key changes (arrival → new highlight, a zoom → new lvlTo) the new placement is seeded by the old one, so a
     label keeps its side and just swaps content (sign ↔ plain label) in place; one that must change side cross-dissolves
     (old spot out WHILE the new spot comes in). The station the train stands at never fades for the HUD.
   - Edge pointer (v3, review round 1): on whenever the highlighted platform is hidden — its anchor outside view.ui.free inset 4
     (off-screen, under the LED board or the portrait cluster strip) — for 0.25 s (1 s when the settling camera will bring it in;
     never switched on while that zoom runs); off once it is, and will stay, ≥ 16 px inside for 0.1 s and has shown ≥ 0.4 s — also
     while the train is about to arrive (no stale pointer beside a platform in plain view). Off at once (fading) while the train
     stands at / pulls into that platform (last 12 px) or the run is over — no '0.0 km' sign, no spinning arrow. Fades in / out;
     its box eases toward the target (10/s, ≤ 720 px/s, integer draw, snaps when settled), slides off the HUD panels keeping the side
     it chose (12 px stickiness); once the platform is itself in the free view the box and arrow hold still while it fades, and the
     km text freezes; the arrow points from the sign to the platform, octant with 0.6-step hysteresis; constant width.
     Review round 2: the wait is 0.6 s (not 1 s) when the camera will bring it in, off after 0.05 s (not 0.1 s) inside; the box also
     slides off the train's head and the platform marker; a box still on the platform switches off (not again while it only peeks in).
   All fades are driven by view.dt; dt = 0 (paused / seeking / a capture) snaps every fade to its target, so a
   captured frame is deterministic. */
(function(){
const LABELS = {opts: {edge: 'clip', hud: 'fade', fade: .2}, last: null};
const TV = {s: null, v: 0};
let D = null, cache = new Map(), spr = new Map(), st8 = [], P = null, PG = null, shown = null, lid = 0;
/* landmark boxes for placement, metres: w = plan width, d = plan depth; h from d.landmarks (fallback here) */
const LM = {cantonTower: {w: 110, d: 110, h: 600}, ifc: {w: 70, d: 70, h: 440}, ctf: {w: 75, d: 75, h: 530},
  operaHouse: {w: 260, d: 200, h: 43}, haixinsha: {w: 300, d: 260, h: 24}};
const tierOf = lvl => lvl <= 5 ? 'street' : lvl <= 16 ? 'district' : 'city';
const hasX = s => (s.transfers || []).length > 0;

LABELS.init = (d = PX.D) => { D = d; cache = new Map(); metC.clear(); spr = new Map(); st8 = []; P = null; PG = null; shown = null; LABELS.last = null; return LABELS; };
const anchor = LABELS.anchor = (i, v) => { const p = TRAIN.along(D.stations[i].d); return v.toScreen(p.x, p.y, 0); };
const uiOf = v => v.ui ? [v.ui.cluster, v.ui.board, v.ui.attribution].filter(Boolean) : [];

/* ---------- label metrics (v1 look): kind 'hi' = next-stop sign, 'full' = 汉字 + pinyin, 'small' = 汉字 fp10 ---------- */
const metC = new Map();
function met(i, kind){ const k = i + '|' + kind; let m = metC.get(k); if (!m) metC.set(k, m = met0(i, kind)); return m; }
function met0(i, kind){
  const s = D.stations[i], isHi = kind === 'hi', small = kind === 'small', nch = (s.transfers || []).length;
  const fz = small ? 'fp10' : 'fp12', cs = isHi ? 8 : 6, wz = PX.measure(s.zh, fz), wp = small ? 0 : PX.measure(s.py, 'fp10'), pad = isHi ? 3 : 1;
  const w = Math.max(wz + (nch ? 2 + nch * cs : 0), wp) + pad * 2, h = (small ? 11 : 25) + (isHi ? 2 : 0);
  return {fz, cs, wz, pad, w, h, mid: small ? 5 : 8, r: (hasX(s) ? 5 : 3) + (small ? 3 : 4), small, isHi};
}

/* ---------- the placement cache: solved once per lvl|k|highlight(|seed), never per frame ----------
   seed = the layout on screen before (review 1): each station prefers the SIDE (candidate index) it already uses unless that
   collides, so at an arrival the sign just reached turns into its plain label in place and the new next stop's plain label
   turns into the sign in place — no fade out / fade in at another spot (the blink the owner saw). */
const layout = LABELS.layout = (lvl, k, hi, seed = null) => {
  const key = lvl + '|' + k + '|' + hi + (seed ? '|' + seed.id : ''); let L = cache.get(key); if (L) return L;
  const st = D.stations, n = st.length, city = tierOf(lvl) === 'city';
  const A = st.map(s => { const p = TRAIN.along(s.d); return [p.x / lvl, -p.y / lvl]; });          // anchors, level px
  const lms = (D.landmarks || []).map(l => { const t = LM[l.id]; if (!t) return null; const h = l.h || t.h;
    return {x: (l.x - t.w / 2) / lvl, y: (-l.y - t.d / 2 - h * k) / lvl, w: t.w / lvl, h: (t.d + h * k) / lvl}; }).filter(Boolean);
  const order = st.map((s, i) => i).sort((a, b) => (b === hi) - (a === hi) || hasX(st[b]) - hasX(st[a]) || (hi >= 0 ? Math.abs(a - hi) - Math.abs(b - hi) : 0) || a - b);
  const placed = []; L = new Array(n);
  for (const i of order){
    const kind = i === hi ? 'hi' : city ? 'small' : 'full', M = met(i, kind), {w, h, mid, r} = M, [ax, ay] = A[i];
    /* a plain label takes the sign's candidate spots, shifted by the sign's extra padding (+2, +1): its text sits on exactly the
       sign's text pixels, so the sign ↔ plain swap at an arrival changes the plate, never moves the name (review 2) */
    const Mh = kind === 'full' ? met(i, 'hi') : M, sx = kind === 'full' ? Mh.pad - M.pad : 0, sy = kind === 'full' ? 1 : 0, wc = Mh.w, hc = Mh.h;
    const line = [];                                                   // the track near the station (the train's path), level px
    for (let s = st[i].d - 70 * lvl; s <= st[i].d + 70 * lvl; s += 3 * lvl){ const p = TRAIN.along(s); line.push([p.x / lvl, -p.y / lvl]); }
    const cand = [[r, -mid], [-r - wc, -mid], [r - 2, -hc - 2], [r - 2, 3], [-r - wc + 2, -hc - 2], [-r - wc + 2, 3], [-(wc >> 1), -hc - r], [-(wc >> 1), r]].map(([x, y]) => [x + sx, y + sy]);
    let best = cand[0], bs = 1e9, bc = 0, raw = 1e9;
    cand.forEach(([dx, dy], ci) => {
      const x = ax + dx, y = ay + dy, hit = (px, py, e) => px > x - e && px < x + w + e && py > y - e && py < y + h + e;
      const over = (q, e = 2) => x < q.x + q.w + e && x + w + e > q.x && y < q.y + q.h + e && y + h + e > q.y;
      const dR = (qx, qy) => Math.hypot(Math.max(x - qx, 0, qx - x - w), Math.max(y - qy, 0, qy - y - h)), own = dR(ax, ay);
      const pref = seed && seed[i] && seed[i].ci === ci ? 40 : 0; let sc = ci * .5 - pref;
      for (const q of placed) if (over(q)) sc += 1000;
      for (const q of lms) if (over(q, 0)) sc += 900;
      for (let j = 0; j < n; j++){ const [mx, my] = A[j], mr = (hasX(st[j]) ? 6 : 4) + (city ? 6 : 0);
        if (Math.abs(mx - ax) > 200 || Math.abs(my - ay) > 200) continue;
        if (hit(mx, my, mr)) sc += 300; else if (j !== i && dR(mx, my) < own + 3) sc += 300; }       // never read as another's label
      for (const [px, py] of line) if (hit(px, py, 3)) sc += 15;
      if (sc < bs){ bs = sc; best = [dx, dy]; bc = ci; raw = sc + pref; }
    });
    const show = i === hi || raw < 1000;
    L[i] = {dx: best[0], dy: best[1], w, h, kind, show, ci: bc};
    if (show) placed.push({x: ax + best[0], y: ay + best[1], w: w + 1, h: h + 1});
  }
  L.id = ++lid; L.key = key;
  if (cache.size > 48) cache.delete(cache.keys().next().value);
  cache.set(key, L); return L;
};
/* the layout for lvl|k|highlight as it is SHOWN: seeded by the one shown before (see above). main.js asks it too (the camera
   keeps the next stop's sign inside the free area), so both see the same boxes. */
const placement = LABELS.placement = (lvl, k, hi) => {
  const key = lvl + '|' + k + '|' + hi;
  if (!shown || shown.key !== key) shown = {key, L: layout(lvl, k, hi, shown ? shown.L : null)};
  return shown.L;
};

/* ---------- label sprites: drawn once per station|kind|colour|theme into a padded canvas; faded variants cached ---------- */
const PAD = 2;
function labelSprite(i, kind, done){
  const key = i + '|' + kind + '|' + (done ? 1 : 0) + '|' + PX.theme + '|' + PX.lineId; let c = spr.get(key); if (c) return c;
  const s = D.stations[i], M = met(i, kind), {w, h, pad, fz, cs, wz, isHi, small} = M, cv = PX.makeCanvas(w + PAD * 2 + 1, h + PAD * 2 + 1), g = cv.g, x = PAD, y = PAD;
  const col = isHi ? PX.lk('ink') : done ? 'textDim' : 'text', o = isHi ? {color: col} : {color: col, outline: 'textOutline'};
  if (isHi) sign(g, x, y, w, h);
  PX.text(g, s.zh, x + pad, y + (isHi ? 1 : 0), {font: fz, ...o});
  if (!small) PX.text(g, s.py, x + pad, y + 13 + (isHi ? 1 : 0), {font: 'fp10', ...o});
  chipRow(g, s, x + pad + wz + 2, y + 3, cs, isHi);
  c = {c: cv.c, w, h, f: []}; spr.set(key, c); return c;
}
/* ordered-dither fade in the sprite's own coordinates (the pattern travels with the label, no crawl): 8 steps */
function blitA(g, o, x, y, a){
  const q = Math.max(0, Math.min(8, Math.round(a * 8))); if (!q) return;
  if (q === 8){ g.drawImage(o.c, x, y); return; }
  let f = o.f[q];
  if (!f){ const W = o.c.width, H = o.c.height, cv = PX.makeCanvas(W, H), img = o.c.getContext('2d').getImageData(0, 0, W, H), d = img.data;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (PX.bayer(xx, yy) >= q / 8) d[(yy * W + xx) * 4 + 3] = 0;
    cv.g.putImageData(img, 0, 0); f = o.f[q] = cv.c; }
  g.drawImage(f, x, y);
}

/* ---------- markers ---------- */
LABELS.drawMarkers = (g, v, ss) => {
  const frame = Math.floor(v.t * 4) % 4;
  D.stations.forEach((s, i) => {
    const p = anchor(i, v); if (!v.onScreen(p.x, p.y, 12)) return;
    const inter = hasX(s), sts = ss.status[i];
    SPR.put(g, sts === 'next' ? SPR.stnNext(frame, inter) : sts === 'done' ? (inter ? SPR.stn.doneInter : SPR.stn.done) : (inter ? SPR.stn.inter : SPR.stn.normal), p.x, p.y);
  });
};

/* ---------- labels + pointer ---------- */
const touch = (b, r, e) => b.x < r.x + r.w + e && b.x + b.w + e > r.x && b.y < r.y + r.h + e && b.y + b.h + e > r.y;
LABELS.draw = (g, v, ss, avoid = uiOf(v)) => {
  const st = D.stations, hi = ss.highlight != null ? ss.highlight : ss.next, L = placement(v.lvlTo, v.k, hi), snap = !v.dt, rate = snap ? 1 : v.dt / LABELS.opts.fade;
  const stand = ss.cur != null && ss.cur >= 0 && Math.abs(ss.trainS - st[ss.cur].d) < 2 ? ss.cur : -1;   // the station the train stands at
  const out = [], toward = (a, t) => snap ? t : a < t ? Math.min(t, a + rate) : Math.max(t, a - rate), W = v.W, H = v.H;
  const order = st.map((s, i) => i).sort((a, b) => (a === hi) - (b === hi) || (b - a));       // highlight drawn last (on top)
  if (v.dt && TV.s != null){ const sp = Math.max(0, ss.trainS - TV.s) / v.dt; TV.v += (sp - TV.v) * Math.min(1, v.dt / .3); } TV.s = ss.trainS;   // train speed (m/s, eased)
  const togo = hi >= 0 ? st[hi].d - ss.trainS : 1e9, standAt = hi >= 0 && (hi === ss.cur || ss.next === -1 || Math.abs(togo) < Math.max(3, 12 * v.mpp));   // v3 (b): at / pulling into the platform
  const ptrOn = pointerOn(v, hi, ss.hold, ss.hiAt, standAt);                        // while the pointer shows, it stands in for the next-stop sign
  /* a panel that hugs a screen edge owns the strip up to that edge, so a hidden label does not pop back in the gap */
  const hud = avoid.map(r => { const E = 1e4, x0 = r.x <= 8 ? -E : r.x, y0 = r.y <= 8 ? -E : r.y, x1 = r.x + r.w >= W - 8 ? E : r.x + r.w, y1 = r.y + r.h >= H - 8 ? E : r.y + r.h;
    return {x: x0, y: y0, w: x1 - x0, h: y1 - y0, over: !!r.over}; });
  const vis = (x, y, M) => !(x > W || y > H || x + M.w + PAD * 2 + 1 < 0 || y + M.h + PAD * 2 + 1 < 0);
  for (const i of order){
    const want = L[i], p = anchor(i, v); let s = st8[i];
    if (!s) s = st8[i] = {dx: want.dx, dy: want.dy, kind: want.kind, ci: want.ci, a: null, hud: false, edge: false, g: null};
    if (s.dx !== want.dx || s.dy !== want.dy || s.kind !== want.kind){
      /* the key changed (arrival, zoom): invisible or on the same side → take the new spot / content at once (a swap in place);
         another side → cross-dissolve: the old label fades out where it was WHILE the new one fades in (never out-then-in) */
      if (!snap && s.a > 0 && s.ci !== want.ci){ s.g = {dx: s.dx, dy: s.dy, kind: s.kind, a: s.a}; s.a = 0; }
      s.dx = want.dx; s.dy = want.dy; s.kind = want.kind; s.ci = want.ci;
    }
    if (s.g){ const G = s.g, M = met(i, G.kind), x = p.x + G.dx - PAD, y = p.y + G.dy - PAD; G.a = snap ? 0 : Math.max(0, G.a - rate);
      if (G.a <= 0) s.g = null; else if (vis(x, y, M)) blitA(g, labelSprite(i, G.kind, ss.status[i] === 'done' && G.kind !== 'hi'), x, y, G.a); }
    const M = met(i, s.kind), x = p.x + s.dx - PAD, y = p.y + s.dy - PAD, box = {x: x + PAD, y: y + PAD, w: M.w, h: M.h};
    s.hud = LABELS.opts.hud === 'fade' && i !== stand && hud.some(r => (s.kind !== 'hi' || r.over) && touch(box, r, s.hud ? 4 : 1));   // hysteresis 1 / 4 px
    if (LABELS.opts.edge === 'fade' && s.kind !== 'hi'){ const e = s.edge ? 4 : 1; s.edge = box.x < e || box.y < e || box.x + box.w > W - e || box.y + box.h > H - e; }
    else s.edge = false;
    const target = want.show && !s.hud && !s.edge && !(s.kind === 'hi' && ptrOn) ? 1 : 0;
    s.a = s.a === null ? target : toward(s.a, target);
    if (s.a <= 0 || !vis(x, y, M)) continue;                                                   // culled only when fully off-screen
    blitA(g, labelSprite(i, s.kind, ss.status[i] === 'done' && s.kind !== 'hi'), x, y, s.a); out.push({i, x: box.x, y: box.y, w: box.w, h: box.h, a: s.a});
  }
  if (PG){ PG.a = snap ? 0 : PG.a - rate; if (PG.a <= 0) PG = null; else blitA(g, PG.o, PG.x - PAD, PG.y - PAD, PG.a); }
  /* the pointer also slides off the train's head and the platform marker (review round 2: it sat on the nose / on the platform where
     the track leaves the free area) */
  const trainBox = (ss.cars || []).slice(0, 2).map(c => ({x: c.x - 9, y: c.y - 9, w: 18, h: 18}));
  const hp = hi >= 0 ? anchor(hi, v) : null, platBox = hp ? [{x: hp.x - 6, y: hp.y - 6, w: 12, h: 12}] : [];   // …and off the platform it points to
  LABELS.last = {labels: out, pointer: hi >= 0 && P ? pointer(g, v, ss, hi, avoid.concat(trainBox, platBox), snap, rate) : null};
};

/* the line-colour sign (next station, edge pointer; fill lsh.sign, its text lsh.ink ≥ 4.5:1): PX.panel + the HUD frame's lit left / shaded right bevel
   and 1px drop shadow bottom-right, so map signs and HUD panels share one light */
function sign(g, x, y, w, h){
  PX.panel(g, x, y, w, h, {fill: PX.lk('sign'), edge: 'ink', hi: PX.lk('hi'), lo: PX.lk('lo')});
  PX.rect(g, x + 1, y + 1, 1, h - 3, PX.lk('hi')); PX.rect(g, x + w - 2, y + 2, 1, h - 3, PX.lk('lo'));
  PX.rect(g, x + w, y + 2, 1, h - 2, 'shadow'); PX.rect(g, x + 2, y + h, w - 2, 1, 'shadow'); PX.rect(g, x + w - 1, y + h - 1, 1, 1, 'shadow');
}
/* interchange chips: a line-colour square in a 1px ink frame, one per transfer line; on the line-colour sign a white
   ring sits inside the frame (ink · white · colour), so yellow / orange lines never melt into the orange sign */
function chipRow(g, s, x, y, c, ring){ (s.transfers || []).forEach((lk, j) => { const X = x + j * c; PX.rect(g, X, y, c, c, 'ink');
  if (ring){ PX.rect(g, X + 1, y + 1, c - 2, c - 2, 'stn.fill'); PX.rect(g, X + 2, y + 2, c - 4, c - 4, 'line.' + lk); } else PX.rect(g, X + 1, y + 1, c - 2, c - 2, 'line.' + lk); }); }

/* edge pointer sprite: [arrow] 汉字 1.5 km, constant width per station (digits measured as '8', km right-aligned) */
function pointerSprite(zh, kmS, oct){
  const key = 'ptr|' + zh + '|' + kmS + '|' + oct + '|' + PX.theme + '|' + PX.lineId; let c = spr.get(key); if (c) return c;
  const wz = PX.measure(zh, 'fp12'), wk = PX.measure(kmS.replace(/\d/g, '8'), 'fp10'), w = 4 + 7 + 3 + wz + 4 + wk + 3, h = 16;
  const cv = PX.makeCanvas(w + PAD * 2 + 1, h + PAD * 2 + 1), g = cv.g, x = PAD, y = PAD;
  const ink = PX.lk('ink');
  sign(g, x, y, w, h); SPR.put(g, SPR.arrow8[oct], x + 4 + 3, y + 8, {remap: {ink}});
  PX.text(g, zh, x + 14, y + 1, {font: 'fp12', color: ink});
  PX.text(g, kmS, x + w - 3 - PX.measure(kmS, 'fp10'), y + 3, {font: 'fp10', color: ink});
  if (spr.size > 400) for (const k of [...spr.keys()]) if (k.startsWith('ptr|')) spr.delete(k);
  c = {c: cv.c, w, h, f: []}; spr.set(key, c); return c;
}
const freeOf = v => v.ui && v.ui.free || {x: 0, y: 0, w: v.W, h: v.H};
const inFree = (fr, x, y, I) => x >= fr.x + I && y >= fr.y + I && x < fr.x + fr.w - I && y < fr.y + fr.h - I;
/* pointer on / off (v3, see the header): R = the platform's anchor now, A = ss.hiAt (where it will be once the camera has settled)
   or R. A new next stop starts on only if A is out; later it comes on after R has been out for 0.25 s (1 s if A is in, never
   during `hold`), goes off once A and R have been ≥ 16 px inside for 0.2 s (≥ 0.6 s after it came on; not while about to arrive
   unless standing), and is forced off while the train stands at / pulls into it. A pointer whose station stops being the
   highlight fades out where it stands. dt = 0 (paused / a capture): decided at once. */
function pointerOn(v, hi, hold, at, stand = false){
  if (hi < 0){ P = null; return false; }
  const R = anchor(hi, v), A = at || R, fr = freeOf(v), out = p => !inFree(fr, p.x, p.y, 4);
  if (!P || P.hi !== hi){
    /* a new next stop: decided at once from where the camera will settle — and only if the platform will be well out (≥ 24 px),
       so one the ride brings in within a moment never flashes a pointer (review 2). A pointer still showing MORPHS into the new
       one (content swapped, box eased to its new spot), never fades out at the margin while the new one fades in */
    const on = !stand && !!at && out(A), keep = on && P && P.a > 0 && P.o && v.dt;   // v3 (a): out of the FREE area at all, not only far out
    if (!keep && P && P.a > 0 && P.o && v.dt) PG = {o: P.o, x: P.X, y: P.Y, a: P.a};                         // the old pointer fades out, never pops
    P = {hi, on, a: keep ? P.a : 0, x: keep ? P.x : 0, y: keep ? P.y : 0, oct: keep ? P.oct : -1, side: keep ? P.side : null, tc: 0, tr: 0, tOn: v.t, t0: v.t};
    return P.on; }
  if (stand){ P.on = false; P.tc = P.tr = 0; return false; }                     // v3 (b): the train is at the platform — no pointer (fades out, arrow frozen)
  if (!P.on){
    /* v3 (a): the platform hidden anywhere outside the free map area (under the LED board, the cluster strip, off-screen) brings the
       pointer on: after 0.25 s — or 1 s when the settling camera will bring it in (never while that zoom / glide is still running) */
    if (P.cov && (!inFree(fr, R.x, R.y, 0) || inFree(fr, R.x, R.y, 16))) P.cov = false;   // (switched off for covering it: not again while it peeks in)
    const o = out(R) && !P.cov; P.tr = o ? P.tr + v.dt : 0;
    if (o && (!v.dt || P.tr >= (at && !out(A) ? (hold ? 1e9 : .6) : .25))){ P.on = true; P.tc = P.tr = 0; P.tOn = v.t; }
    return P.on; }
  /* off once the platform IS (and will stay) clear inside — also while about to arrive (review round 1: no stale pointer beside a
     platform in plain view); the sign fades in as the pointer fades out */
  /* review round 2: a pointer whose box sits on the platform it points to (the platform just inside, at the board's edge) is off —
     the platform itself shows */
  const covered = P.o && P.a > 0 && inFree(fr, R.x, R.y, 0) && R.x >= P.X - 2 && R.x < P.X + P.o.w + 2 && R.y >= P.Y - 2 && R.y < P.Y + P.o.h + 2;
  const flip = covered || (inFree(fr, A.x, A.y, 16) && inFree(fr, R.x, R.y, 16));
  if ((hold && !covered) || !flip){ P.tc = 0; return P.on; }
  if (v.dt) P.tc += v.dt;
  if (!v.dt || (P.tc >= .05 && v.t - P.tOn >= .4) || covered){ P.on = false; P.tc = 0; P.tOn = v.t; P.cov = !!covered; }
  return P.on;
}
function pointer(g, v, ss, hi, avoid, snap, rate){
  const st = D.stations, fr = freeOf(v), A = anchor(hi, v), inside = (x, y, I) => inFree(fr, x, y, I);
  if (!P.on && P.a <= 0) return null;                                            // (off and faded out)
  const S = ss.trainS, I = 8, kmS = P.on || !P.km ? (P.km = Math.max(0, (st[hi].d - S) / 1000).toFixed(1) + ' km') : P.km;   // (frozen while it fades)
  const w = 4 + 7 + 3 + PX.measure(st[hi].zh, 'fp12') + 4 + PX.measure(kmS.replace(/\d/g, '8'), 'fp10') + 3, h = 16;   // = pointerSprite's box
  if (P.on && !(P.a > 0 && inside(A.x, A.y, I))){                               // v3: once the platform itself is in the free view the
                                                                                 // pointer holds its spot and arrow while it fades (no spin)
    /* target: where the track ahead leaves the free view (inset 8), box clamped inside it */
    let ex = A.x, ey = A.y;
    for (let s = S, ds = 2 * v.mpp; s <= st[hi].d; s += ds){ const a = TRAIN.along(s), p = v.toScreen(a.x, a.y); if (!inside(p.x, p.y, I)){ ex = p.x; ey = p.y; break; } }
    const cx = Math.max(fr.x + I, Math.min(fr.x + fr.w - I, ex)), cy = Math.max(fr.y + I, Math.min(fr.y + fr.h - I, ey));
    let x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    const clampF = () => { x = Math.max(fr.x + 2, Math.min(fr.x + fr.w - w - 3, x)); y = Math.max(fr.y + 2, Math.min(fr.y + fr.h - h - 3, y)); };
    clampF();
    /* slide off the HUD panels: least displacement, but keep the side chosen before unless another is ≥ 12 px shorter */
    for (let n = 0; n < 3; n++){
      const r = avoid.find(r => touch({x, y, w, h}, r, 2)); if (!r){ if (n === 0) P.side = null; break; }
      const opts = {up: [x, r.y - h - 3], down: [x, r.y + r.h + 3], left: [r.x - w - 3, y], right: [r.x + r.w + 3, y]};
      let best = null, bd = 1e9;
      for (const k in opts){ const [tx, ty] = opts[k]; if (tx < fr.x + 2 || ty < fr.y + 2 || tx > fr.x + fr.w - w - 3 || ty > fr.y + fr.h - h - 3) continue;
        const d = Math.abs(tx - x) + Math.abs(ty - y) - (k === P.side ? 12 : 0); if (d < bd){ bd = d; best = k; } }
      if (!best) break;
      P.side = best; [x, y] = opts[best];
    }
    if (snap || P.a <= 0){ P.x = x; P.y = y; }
    else {                                                                        // ease (10/s), at most 720 px/s, snap when settled
      const e = 1 - Math.exp(-v.dt * 10), cap = 720 * v.dt; let mx = (x - P.x) * e, my = (y - P.y) * e; const m = Math.hypot(mx, my);
      if (m > cap){ mx *= cap / m; my *= cap / m; } P.x += mx; P.y += my; if (Math.abs(x - P.x) < .3 && Math.abs(y - P.y) < .3){ P.x = x; P.y = y; } }
  }
  if (P.on && !(P.a > 0 && inside(A.x, A.y, I))){                                // (the box and the arrow hold still once the platform is in view)
    /* the arrow: bearing from the (eased) sign to the platform, octant with 0.6-step hysteresis — it never flickers */
    const q = Math.atan2(A.y - (P.y + h / 2), A.x - (P.x + w / 2)) / (Math.PI / 4), dq = ((q - P.oct) % 8 + 12) % 8 - 4;
    if (P.oct < 0 || Math.abs(dq) > .6) P.oct = ((Math.round(q) % 8) + 8) % 8;
  }
  P.a = snap ? (P.on ? 1 : 0) : P.on ? Math.min(1, P.a + rate) : Math.max(0, P.a - rate);
  const o = pointerSprite(st[hi].zh, kmS, P.oct), X = Math.round(P.x), Y = Math.round(P.y);
  P.o = o; P.X = X; P.Y = Y;
  blitA(g, o, X - PAD, Y - PAD, P.a);
  return {x: X, y: Y, w, h, a: P.a, oct: P.oct, on: P.on, side: P.side};
}

window.LABELS = LABELS;
})();
