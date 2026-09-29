#!/usr/bin/env python3
"""build-fonts.py — builds js/px/fonts.js (the pixel fonts of the pixel ride). Dev-only; the game never runs it.

Usage:  python3 tools/px/build-fonts.py [SRC_DIR]     (default SRC_DIR: tools/fonts-src/px, gitignored)
Needs:  fontTools + brotli (pip3 install --user "fonttools[woff]" brotli)
SRC_DIR holds these woff2 files, unzipped from TakWolf's GitHub releases:
  fusion-pixel-{8,10,12}px-proportional-zh_hans.otf.woff2   Fusion Pixel Font v2026.09.25
    https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.25/fusion-pixel-font-{8,10,12}px-proportional-otf.woff2-v2026.09.25.zip
  ark-pixel-16px-proportional-zh_cn.otf.woff2               Ark Pixel Font v2026.09.01 (the last release
                                                            that ships 16px; it has only ~99 hanzi)
    https://github.com/TakWolf/ark-pixel-font/releases/download/2026.09.01/ark-pixel-font-16px-proportional-otf.woff2-v2026.09.01.zip
All SIL OFL 1.1 — license texts in assets/fonts/px/LICENSE-*.txt (from the zips' OFL.txt + LICENSES/).

What it does, per family (FP8 FP10 FP12 FP16):
  1. subsets the source to the charset: every hanzi the canvas can print — js/geo.js, js/data.js (station and line
     names), js/game.js (the zh UI strings), js/px/*.js (ride UI, labels, sprites, the LED board's announcements
     js/px/ann.js incl. Cantonese 喺 嘅; tracked files only, so every clone builds the same file) — plus ASCII,
     Latin-1, toned pinyin, CJK punctuation, fullwidth forms and a few arrows/symbols. No 3500 common hanzi:
     nicknames never reach the canvas yet. Re-run whenever lines, stations or zh strings are added;
  2. hanzi the source lacks are taken from the nearest other size and rebuilt at THIS size's em, so
     they still draw at 1 font px = 1 art px (FP16 takes ALL its hanzi from FP12 this way, aligned to
     the cap height, so every Chinese glyph on screen shares one design);
  3. rewrites the vertical metrics so canvas textBaseline 'top' lands on a whole pixel exactly
     `ascent` px above the baseline (ascent = tallest ink of CJK, ASCII, toned pinyin; ≤ px);
  4. insets every outline by 0.05 px. Chrome on macOS dilates glyphs while rasterising (a faint fringe,
     alpha up to ~131 at 16px inside tight hanzi corners) and PX's 50% alpha threshold would turn that
     fringe into extra ink. With the inset the fringe stays <= ~85 while real pixels stay >= 254 (>= ~207 on
     rasterisers that don't dilate), so PX.text's mask equals the font's pixel design exactly;
  5. renames the font (Fusion Pixel has the Reserved Font Name 'Fusion Pixel');
  6. writes js/px/fonts.js: base64 woff2 + FontFace registration + FONTS.info metrics (byte-stable: no timestamps).
"""
import base64, glob, io, json, os, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools/fonts-src/px')
OUT = os.path.join(ROOT, 'js/px/fonts.js')

FUSION = ('Fusion Pixel Font {px}px proportional zh_hans v2026.09.25 (TakWolf) — subset', 'SIL OFL 1.1 — assets/fonts/px/LICENSE-fusion-pixel.txt (+ component licenses)')
ARK = ('Ark Pixel Font 16px proportional zh_cn v2026.09.01 (TakWolf) — subset; hanzi from FP12', 'SIL OFL 1.1 — assets/fonts/px/LICENSE-ark-pixel.txt, assets/fonts/px/LICENSE-fusion-pixel.txt')
SPECS = [  # id, px, source file, donors (nearest size first), take all hanzi from a donor?
    dict(id='FP8',  px=8,  file='fusion-pixel-8px-proportional-zh_hans.otf.woff2',  donors=['FP10', 'FP12'], meta=FUSION),
    dict(id='FP10', px=10, file='fusion-pixel-10px-proportional-zh_hans.otf.woff2', donors=['FP8', 'FP12'], meta=FUSION),
    dict(id='FP12', px=12, file='fusion-pixel-12px-proportional-zh_hans.otf.woff2', donors=['FP10', 'FP8'], meta=FUSION),
    dict(id='FP16', px=16, file='ark-pixel-16px-proportional-zh_cn.otf.woff2',      donors=['FP12', 'FP10', 'FP8'], meta=ARK, hanFromDonor=True),
]
for s in SPECS:
    if not os.path.exists(os.path.join(SRC, s['file'])): sys.exit('missing %s — see the header for download sources' % os.path.join(SRC, s['file']))

# ---------- charset ----------
is_han = lambda c: 0x3400 <= ord(c) <= 0x9FFF or 0x20000 <= ord(c) <= 0x2FA1F
TONES = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ'
SCAN = ['js/geo.js', 'js/data.js', 'js/game.js'] + sorted(os.path.relpath(f, ROOT) for f in glob.glob(os.path.join(ROOT, 'js/px/*.js')) if not f.endswith('/fonts.js'))
text = ''.join(open(os.path.join(ROOT, f), encoding='utf8').read() for f in SCAN)
CHARS = {c for c in text if is_han(c)}
CHARS |= {chr(i) for i in [*range(0x20, 0x7F), *range(0xA0, 0x100), *range(0x3000, 0x3040), *range(0xFF01, 0xFF5F)]}
MUST = set(TONES + '←→↑↓·×★♥■□') | {chr(i) for i in range(0x20, 0x7F)}  # every size must draw these
CHARS |= MUST | set('‐–—‘’“”…•‰€™℃№')
# glyphs that must fit under 'top' (what the game actually prints): ASCII, pinyin, capital A/E/O with tones, hanzi
REAL = set(chr(i) for i in range(0x21, 0x7F)) | set(TONES[:25] + 'ĀÁǍÀĒÉĚÈŌÓǑÒ')  # pinyin never starts with I/U/Ü

src = {s['id']: TTFont(os.path.join(SRC, s['file'])) for s in SPECS}
cmap = {k: f.getBestCmap() for k, f in src.items()}

def bounds(fid, c):
    f = src[fid]; gs = f.getGlyphSet(); bp = BoundsPen(gs); gs[cmap[fid][ord(c)]].draw(bp)
    return bp.bounds  # (xMin, yMin, xMax, yMax) in font units, or None

def outline(fid, c):
    rec = RecordingPen(); src[fid].getGlyphSet()[cmap[fid][ord(c)]].draw(rec); return repr(rec.value)

REF = '固'  # boxy reference hanzi present in all four sources: centres the donor hanzi
def han_centre(fid): b = bounds(fid, REF); return (b[1] + b[3]) / 200

# ---------- builders ----------
def set_metrics(f, px, asc, name):
    """ascent+descent == em, so Chrome's normalised 'top' = asc exactly (typo, hhea and win all agree)."""
    a, d = asc * 100, (px - asc) * 100
    f['hhea'].ascent, f['hhea'].descent, f['hhea'].lineGap = a, -d, 0
    o = f['OS/2']; o.sTypoAscender, o.sTypoDescender, o.sTypoLineGap, o.usWinAscent, o.usWinDescent = a, -d, 0, a, d
    o.version = max(o.version, 4); o.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    n = f['name']
    for rec in list(n.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22): n.removeNames(nameID=rec.nameID)
    for nid, v in ((1, name), (2, 'Regular'), (3, name + ' pixel-ride subset'), (4, name), (6, name.replace(' ', '-'))):
        n.setName(v, nid, 3, 1, 0x409)
    n.setName('Modified (subset, re-metriced) for the Metro Typing pixel ride; SIL OFL 1.1', 10, 3, 1, 0x409)

INSET = 5  # font units (1/100 px) every outline edge moves inward — see step 4 in the header
def inset(rec_value, pen, dy=0):
    """Replay a RecordingPen of a rectilinear pixel outline into pen, every edge moved INSET units into the
    ink (CFF winding: ink is on the right of each edge) and the whole glyph moved dy units up."""
    pts = []
    def flush():
        n = len(pts)
        if n < 3: return
        out = []
        for i in range(n):
            (ax, ay), (x, y), (bx, by) = pts[i - 1], pts[i], pts[(i + 1) % n]
            r1, r2 = (y - ay, ax - x), (by - y, x - bx)                       # right-hand normals of both edges
            u1, u2 = [(v[0] / (max(map(abs, v)) or 1), v[1] / (max(map(abs, v)) or 1)) for v in (r1, r2)]
            ox, oy = u1 if u1 == u2 else (u1[0] + u2[0], u1[1] + u2[1])       # rectilinear corner → move diagonally
            out.append((x + INSET * ox, y + INSET * oy + dy))
        pen.moveTo(out[0]); [pen.lineTo(q) for q in out[1:]]; pen.closePath()
    for op, args in rec_value:
        if op == 'moveTo': flush(); pts[:] = [args[0]]
        elif op == 'lineTo': pts.append(args[0])
        elif op in ('closePath', 'endPath'):
            if len(pts) > 1 and pts[-1] == pts[0]: pts.pop()
            flush(); pts[:] = []
        else: raise ValueError('not a pixel outline: ' + op)
    flush()

def inset_all(f):
    """Rewrite every CFF charstring of f through inset()."""
    top = f['CFF '].cff.topDictIndex[0]; cs = top.CharStrings; gs = f.getGlyphSet()
    for name in f.getGlyphOrder():
        old, _ = cs.getItemAndSelector(name); rec = RecordingPen(); gs[name].draw(rec)
        pen = T2CharStringPen(f['hmtx'][name][0], None); inset(rec.value, pen)
        new = pen.getCharString(private=old.private, globalSubrs=old.globalSubrs)
        if cs.charStringsAreIndexed: cs.charStringsIndex[cs.charStrings[name]] = new
        else: cs.charStrings[name] = new

def woff2(f):
    f.flavor = 'woff2'; f.recalcTimestamp = False; b = io.BytesIO(); f.save(b); return b.getvalue()

def primary(spec, chars, asc):
    f = TTFont(os.path.join(SRC, spec['file']))
    o = subset.Options(); o.hinting = False; o.name_IDs = ['*']; o.drop_tables += ['vhea', 'vmtx', 'DSIG']
    s = subset.Subsetter(o); s.populate(unicodes=[ord(c) for c in chars]); s.subset(f)
    inset_all(f); set_metrics(f, spec['px'], asc, 'PixelRide ' + spec['id'])
    return woff2(f)

def fallback(spec, donor, chars, dy, asc):
    """Donor glyphs copied 1:1 (no scaling) into a CFF font whose em = this size, shifted dy px up."""
    d, gs, upm = src[donor], src[donor].getGlyphSet(), spec['px'] * 100
    order, cs, hmtx, cm = ['.notdef'], {'.notdef': T2CharStringPen(upm // 2, None).getCharString()}, {'.notdef': (upm // 2, 0)}, {}
    for c in chars:
        gname, adv, b = 'u%04X' % ord(c), d['hmtx'][cmap[donor][ord(c)]][0], bounds(donor, c)
        pen = T2CharStringPen(adv, None); rec = RecordingPen(); gs[cmap[donor][ord(c)]].draw(rec); inset(rec.value, pen, dy * 100)
        order.append(gname); cm[ord(c)] = gname; cs[gname] = pen.getCharString(); hmtx[gname] = (adv, int(b[0]) if b else 0)
    fb = FontBuilder(upm, isTTF=False); fb.setupGlyphOrder(order); fb.setupCharacterMap(cm)
    fb.setupCFF('PixelRide-%s-%s' % (spec['id'], donor), {}, cs, {})
    fb.setupHorizontalMetrics(hmtx); fb.setupHorizontalHeader(); fb.setupNameTable({'familyName': 'x', 'styleName': 'Regular'})
    fb.setupOS2(); fb.setupPost(); fb.updateHead(created=d['head'].created, modified=d['head'].modified)  # donor's dates: byte-stable
    fb.font['name'].setName(str(d['name'].getDebugName(0)), 0, 3, 1, 0x409)
    set_metrics(fb.font, spec['px'], asc, 'PixelRide %s from %s' % (spec['id'], donor))
    return woff2(fb.font)

def urange(chars): return ','.join('U+%X' % ord(c) for c in sorted(chars))

# ---------- build ----------
faces, info, report = [], {}, []
for spec in SPECS:
    fid, px = spec['id'], spec['px']
    own = {c for c in CHARS if ord(c) in cmap[fid] and not (spec.get('hanFromDonor') and is_han(c))}
    take = {}  # donor -> chars
    for c in sorted(CHARS - own):
        if not (is_han(c) or c in MUST): continue  # a stray symbol a size lacks is simply left out
        dn = next((d for d in spec['donors'] if ord(c) in cmap[d]), None)
        if dn: take.setdefault(dn, set()).add(c)
        else: report.append('%s: no pixel glyph anywhere for %s U+%X' % (fid, c, ord(c)))
    # ascent = tallest ink among what the game prints: own REAL glyphs + main donor's hanzi after shift
    tops = [bounds(fid, c)[3] / 100 for c in own if c in REAL and bounds(fid, c)]
    tops += [bounds(fid, REF)[3] / 100]  # own hanzi (FP16: replaced below)
    shift = {}
    for dn in take:
        dy = round(han_centre(fid) - han_centre(dn))
        shift[dn] = dy
    if spec.get('hanFromDonor'):
        dn = spec['donors'][0]; tops[-1] = bounds(dn, REF)[3] / 100 + shift[dn]
    asc = int(min(px, max(tops)))
    for dn in take:  # a bigger donor may not poke more than 1px above 'top' (PX.text keeps 1px of margin)
        dtop = max(bounds(dn, c)[3] / 100 for c in take[dn] if bounds(dn, c))
        shift[dn] = int(min(shift[dn], asc + 1 - dtop))
    faces.append(dict(family=fid, range=None, data=primary(spec, own, asc)))
    for dn, cs in take.items():
        faces.append(dict(family=fid, range=urange(cs), data=fallback(spec, dn, sorted(cs), shift[dn], asc)))
    # metrics for UI alignment, in art px; rows are offsets from PX.text's y (= top of the box)
    hsrc = spec['donors'][0] if spec.get('hanFromDonor') else fid
    hb = bounds(hsrc, REF); hy = shift.get(hsrc, 0) if spec.get('hanFromDonor') else 0
    capH, xH = bounds(fid, 'H')[3] / 100, bounds(fid, 'x')[3] / 100
    info[fid] = dict(
        source=spec['meta'][0].format(px=px), license=spec['meta'][1], px=px,
        ascent=asc,                                   # baseline is at y+ascent (last row of 'H' = y+ascent-1)
        cap=int(capH), xHeight=int(xH),               # 'H' top row = y+ascent-cap; 'x' top row = y+ascent-xHeight
        descent=int(-bounds(fid, 'g')[1] / 100),      # rows below the baseline used by g j p q y
        hanTop=int(asc - (hb[3] / 100 + hy)), hanH=int((hb[3] - hb[1]) / 100),  # ideograph rows y+hanTop … +hanH-1
        hanAdv=int(src[hsrc]['hmtx'][cmap[hsrc][ord(REF)]][0] / 100),
        spaceAdv=int(src[fid]['hmtx'][cmap[fid][32]][0] / 100),
        tones=all(len({outline(fid, c) for c in grp}) == 4 for grp in ('āáǎà', 'ǖǘǚǜ')),  # 4 tone marks distinct?
        fallback={dn: ''.join(sorted(cs)) for dn, cs in take.items() if len(cs) < 40} or None,
    )
    if spec.get('hanFromDonor'): info[fid]['hanFrom'] = hsrc

js_faces = ',\n'.join('  {family:%s, range:%s, data:"%s"}' % (json.dumps(f['family']), json.dumps(f['range']), base64.b64encode(f['data']).decode()) for f in faces)
out = f'''/* fonts.js — GENERATED by tools/px/build-fonts.py, do not edit by hand.
   Pixel fonts for the pixel ride, embedded as base64 woff2 and registered with FontFace
   (works from file://). Families: FP8 FP10 FP12 FP16 — use them ONLY at their native size
   (PX.FONTS: '8px FP8', '10px FP10', '12px FP12', '16px FP16'): 1 font px = 1 art px.
   Sources (SIL OFL 1.1, see assets/fonts/px/LICENSE-*.txt): Fusion Pixel Font 8/10/12px and Ark Pixel Font 16px
   by TakWolf, subset + renamed. FP16's hanzi are FP12's glyphs on the 16px line (Ark 16px has ~99 hanzi).
   A few rare hanzi missing from one size come from the nearest other size, still 1:1 pixels.
   Charset: station/line names, zh UI strings, announcements, Latin-1, toned pinyin — re-run the builder after
   adding stations or zh strings (it has no common-hanzi set, so arbitrary user text is not covered).
   FONTS.ready: Promise<info>, resolves when every face is loaded.
   FONTS.info[id] (art px; y = the y given to PX.text, the top of the text box):
     ascent  baseline at y+ascent; tallest normal ink (hanzi, ASCII, toned pinyin) starts at row >= y
     cap / xHeight  'H' top row = y+ascent-cap, 'x' top row = y+ascent-xHeight
     descent rows below the baseline used by g j p q y
     hanTop / hanH  ideographs fill rows y+hanTop … y+hanTop+hanH-1;  hanAdv / spaceAdv  advance widths
     tones   false = the four tone marks look alike at this size (FP8): use FP10+ for toned pinyin
     fallback  {{sourceFamily: chars}} rare hanzi drawn with another size's glyphs (still 1:1 pixels) */
(function(){{
const INFO = {json.dumps(info, ensure_ascii=False, indent=1)};
const FACES = [
{js_faces}
];
const bin = s => {{ const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }};
const ready = Promise.all(FACES.map(f => {{
  const ff = new FontFace(f.family, bin(f.data), f.range ? {{unicodeRange: f.range}} : {{}});
  document.fonts.add(ff); return ff.load();
}})).then(() => INFO);
window.FONTS = {{ready, info: INFO}};
}})();
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf8').write(out)
print('scanned', ' '.join(SCAN))
print('charset %d chars (%d hanzi); faces %d; js/px/fonts.js %.1f KB (%d bytes)' % (len(CHARS), sum(map(is_han, CHARS)), len(faces), len(out.encode()) / 1024, len(out.encode())))
for f in faces: print('  %-5s %-40s %6.1f KB woff2, %6.1f KB base64' % (f['family'], (f['range'] or 'primary')[:40], len(f['data']) / 1024, len(base64.b64encode(f['data'])) / 1024))
for fid, i in info.items(): print(' ', fid, {k: v for k, v in i.items() if k not in ('source', 'license')})
for r in report: print('  WARN', r)
