#!/usr/bin/env python3
"""build-fonts.py — builds js/px/fonts.js (the pixel fonts: ride, menu, dialogs) and js/px/fonts-han.js (FP12's
common-hanzi supplement for nicknames). Dev-only; the game never runs it.

Usage:  PYTHONDONTWRITEBYTECODE=1 python3 tools/px/build-fonts.py [--strict] [SRC_DIR]
          (default SRC_DIR: tools/fonts-src/px, gitignored)
        --strict  exit 1 (writing nothing) when any WARNING below is printed; without it the files are written anyway
Needs:  fontTools + brotli (pip3 install --user "fonttools[woff]" brotli)
SRC_DIR holds these woff2 files, unzipped from TakWolf's GitHub releases:
  fusion-pixel-{8,10,12}px-proportional-zh_hans.otf.woff2   Fusion Pixel Font v2026.09.25
    https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.25/fusion-pixel-font-{8,10,12}px-proportional-otf.woff2-v2026.09.25.zip
  ark-pixel-16px-proportional-zh_cn.otf.woff2               Ark Pixel Font v2026.09.01 (the last release
                                                            that ships 16px; it has only ~99 hanzi)
    https://github.com/TakWolf/ark-pixel-font/releases/download/2026.09.01/ark-pixel-font-16px-proportional-otf.woff2-v2026.09.01.zip
All SIL OFL 1.1 — license texts in assets/fonts/px/LICENSE-*.txt (from the zips' OFL.txt + LICENSES/).

What it does, per family (FP8 FP10 FP12 FP16):
  1. subsets the source to the charset: every hanzi the page can print — index.html (static zh markup), js/geo.js,
     js/data.js (station and line names), js/game.js (the zh UI strings), js/cloud.js (account, leaderboard),
     js/px/*.js (ride UI, labels, sprites, the LED board's announcements js/px/ann.js incl. Cantonese 喺 嘅; tracked
     files only, so every clone builds the same file) — plus every other non-ASCII symbol their code prints (comments
     stripped: they hold maths like ≤ ≈), ASCII, Latin-1, toned pinyin, CJK punctuation, fullwidth forms and a few
     arrows/symbols (MUST: every size draws them). Re-run whenever lines, stations, zh strings or UI symbols change;
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
  6. writes js/px/fonts.js: base64 woff2 + FontFace registration + FONTS.info metrics (byte-stable: no timestamps);
  7. writes js/px/fonts-han.js: one more FP12 face (same family, steps 1/3/4/5) holding the hanzi of
     tools/hanzi-3500.txt that fonts.js lacks, its unicodeRange limited to them, so the browser picks it per glyph.
     The game loads it lazily where nicknames show; the ride never pays for it.
WARNING lists (--strict makes any of them fatal): scanned characters FP12 — the DOM/UI face — cannot draw (with the
sources that do have them and the files that print them), MUST symbols a size can't get from any source, and
hanzi-3500 hanzi Fusion 12px lacks. Such a character falls back to a system font, one glyph at a time.
"""
import base64, glob, gzip, io, json, os, re, sys, unicodedata
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
ARGS, STRICT = [a for a in sys.argv[1:] if not a.startswith('--')], '--strict' in sys.argv[1:]
SRC = ARGS[0] if ARGS else os.path.join(ROOT, 'tools/fonts-src/px')
OUT, OUT_HAN = os.path.join(ROOT, 'js/px/fonts.js'), os.path.join(ROOT, 'js/px/fonts-han.js')
HAN3500 = os.path.join(ROOT, 'tools/hanzi-3500.txt')

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
GEN = ('js/px/fonts.js', 'js/px/fonts-han.js')
SCAN = ['index.html', 'js/geo.js', 'js/data.js', 'js/game.js', 'js/cloud.js'] + sorted(r for r in (os.path.relpath(f, ROOT) for f in glob.glob(os.path.join(ROOT, 'js/px/*.js'))) if r not in GEN)

def code_text(src, html=False):
    """src without its comments: JS // and /* */ (string, template and regex literals respected); HTML <!-- --> too."""
    if html:
        src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
        return re.sub(r'(<script[^>]*>)(.*?)(</script>)', lambda m: m[1] + code_text(m[2]) + m[3], src, flags=re.S)
    out, i, n, stack, prev = [], 0, len(src), [0], ''  # stack: brace depth of the code inside each open `${`
    while i < n:
        c = src[i]
        if src.startswith('//', i): i = src.find('\n', i); i = n if i < 0 else i; continue
        if src.startswith('/*', i): i = src.find('*/', i + 2); i = n if i < 0 else i + 2; continue
        if c in '\'"' or c == '/' and (not prev or prev in '(,=:[!&|?{};+-*%<>~^' or re.search(r'\b(return|typeof|case|in|of)\s*$', ''.join(out[-12:]))):
            j, cls = i + 1, False  # a string, or a regex literal (may hold quotes and /)
            while j < n and src[j] != '\n':
                if src[j] == '\\': j += 2; continue
                if c == '/' and src[j] in '[]': cls = src[j] == '['
                elif src[j] == c and not cls: break
                j += 1
            out.append(src[i:j + 1]); i, prev = j + 1, c; continue
        if c == '`' or c == '}' and len(stack) > 1 and stack[-1] == 0:  # a template literal (or its tail after `${…}`)
            if c == '}': stack.pop()
            j = i + 1
            while j < n and src[j] != '`' and not src.startswith('${', j): j += 2 if src[j] == '\\' else 1
            if src.startswith('${', j): out.append(src[i:j + 2]); stack.append(0); i, prev = j + 2, '{'
            else: out.append(src[i:j + 1]); i, prev = j + 1, '`'
            continue
        if c in '{}': stack[-1] += 1 if c == '{' else -1
        out.append(c); i += 1
        if not c.isspace(): prev = c
    return ''.join(out)

TEXT = {f: open(os.path.join(ROOT, f), encoding='utf8').read() for f in SCAN}
CODE = {f: code_text(t, f.endswith('.html')) for f, t in TEXT.items()}
CHARS = {c for t in TEXT.values() for c in t if is_han(c)}  # hanzi: from comments too (a harmless superset)
prints = lambda c: ord(c) > 0x7E and not is_han(c) and unicodedata.category(c) not in ('Cc', 'Cf', 'Mn', 'Zl', 'Zp')
SYMS = {c for t in CODE.values() for c in t if prints(c)}  # every other symbol the code (not a comment) prints
CHARS |= {chr(i) for i in [*range(0x20, 0x7F), *range(0xA0, 0x100), *range(0x3000, 0x3040), *range(0xFF01, 0xFF5F)]}
MUST = set(TONES + '←→↑↓·×★♥■□⇄☆↻−') | {chr(i) for i in range(0x20, 0x7F)}  # every size must draw these
CHARS |= MUST | set('‐–—‘’“”…•‰€™℃№') | SYMS
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

def primary(spec, chars, asc, name=None):
    f = TTFont(os.path.join(SRC, spec['file']))
    o = subset.Options(); o.hinting = False; o.name_IDs = ['*']; o.drop_tables += ['vhea', 'vmtx', 'DSIG']
    s = subset.Subsetter(o); s.populate(unicodes=[ord(c) for c in chars]); s.subset(f)
    inset_all(f); set_metrics(f, spec['px'], asc, name or 'PixelRide ' + spec['id'])
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

def urange(chars):  # 'U+4E00-4E03,U+4E07,…' (runs of consecutive code points merged)
    runs = []
    for u in sorted(map(ord, chars)):
        if runs and runs[-1][1] == u - 1: runs[-1][1] = u
        else: runs.append([u, u])
    return ','.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in runs)
gz = lambda b: len(gzip.compress(b, 9, mtime=0))
def steps(chars):  # sorted chars as steps between code points, one ASCII char each ('#'…'|' = 1…90) or '~hex;'
    out, u = [], ord(chars[0]) - 1
    for c in map(ord, chars): out.append(chr(34 + c - u) if c - u <= 90 else '~%x;' % (c - u)); u = c
    return ''.join(out)

# ---------- build ----------
faces, info, report, cover = [], {}, [], {}
for spec in SPECS:
    fid, px = spec['id'], spec['px']
    own = {c for c in CHARS if ord(c) in cmap[fid] and not (spec.get('hanFromDonor') and is_han(c))}
    take = {}  # donor -> chars
    for c in sorted(CHARS - own):
        if not (is_han(c) or c in MUST): continue  # a stray symbol a size lacks is simply left out
        dn = next((d for d in spec['donors'] if ord(c) in cmap[d]), None)
        if dn: take.setdefault(dn, set()).add(c)
        elif c in MUST: report.append('%s: no pixel glyph anywhere for MUST %s U+%04X' % (fid, c, ord(c)))
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
    cover[fid] = own.union(*take.values())
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

# ---------- the nickname supplement: hanzi-3500 minus what fonts.js has, FP12 only ----------
han = {c for c in open(HAN3500, encoding='utf8').read() if is_han(c)} - CHARS
HAN = sorted(c for c in han if ord(c) in cmap['FP12'])
han_data = primary(next(s for s in SPECS if s['id'] == 'FP12'), HAN, info['FP12']['ascent'], 'PixelRide FP12 han')

# ---------- warnings: what FP12 (the DOM/UI face) cannot draw ----------
where = lambda c: ' '.join(f for f in SCAN if c in (TEXT[f] if is_han(c) else CODE[f]))
has = lambda c: '+'.join(s['id'] for s in SPECS if ord(c) in cmap[s['id']])
warn = ['%s U+%04X  %-26s %s' % (c, ord(c), 'only in ' + has(c) if has(c) else 'no pixel glyph anywhere', where(c))
        for c in sorted(SYMS | {c for c in CHARS if is_han(c)}) if c not in cover['FP12']]
warn += report + ['%s U+%04X  %-26s tools/hanzi-3500.txt' % (c, ord(c), 'not in Fusion 12px') for c in sorted(han - set(HAN))]
def warnings():
    if not warn: return
    print('WARNING: %d character(s) without a pixel glyph in FP12 — a system font draws them, one glyph at a time%s:' % (len(warn), '' if STRICT else ' (--strict: exit 1)'))
    for w in warn: print('  ' + w)
if STRICT and warn: warnings(); sys.exit('--strict: %d warning(s), nothing written' % len(warn))

js_faces = ',\n'.join('  {family:%s, range:%s, data:"%s"}' % (json.dumps(f['family']), json.dumps(f['range']), base64.b64encode(f['data']).decode()) for f in faces)
out = f'''/* fonts.js — GENERATED by tools/px/build-fonts.py, do not edit by hand.
   Pixel fonts for the pixel UI (canvas and pixel DOM chrome), embedded as base64 woff2 and registered with FontFace
   (works from file://). Families: FP8 FP10 FP12 FP16 — use them ONLY at their native size
   (PX.FONTS: '8px FP8', '10px FP10', '12px FP12', '16px FP16'): 1 font px = 1 art px.
   Sources (SIL OFL 1.1, see assets/fonts/px/LICENSE-*.txt): Fusion Pixel Font 8/10/12px and Ark Pixel Font 16px
   by TakWolf, subset + renamed. FP16's hanzi are FP12's glyphs on the 16px line (Ark 16px has ~99 hanzi).
   A few rare hanzi or MUST symbols missing from one size come from the nearest other size, still 1:1 pixels.
   Charset: station/line names, zh UI strings (index.html, game.js, cloud.js), announcements, the symbols the code
   prints, Latin-1, toned pinyin — re-run the builder after adding stations, zh strings or symbols. Arbitrary user
   text: fonts-han.js adds the 3500 common hanzi to FP12 (loaded apart); anything rarer falls back per glyph.
   FONTS.ready: Promise<info>, resolves when every face is loaded.  FONTS.hanReady: see fonts-han.js.
   FONTS.info[id] (art px; y = the y given to PX.text, the top of the text box):
     ascent  baseline at y+ascent; tallest normal ink (hanzi, ASCII, toned pinyin) starts at row >= y
     cap / xHeight  'H' top row = y+ascent-cap, 'x' top row = y+ascent-xHeight
     descent rows below the baseline used by g j p q y
     hanTop / hanH  ideographs fill rows y+hanTop … y+hanTop+hanH-1;  hanAdv / spaceAdv  advance widths
     tones   false = the four tone marks look alike at this size (FP8): use FP10+ for toned pinyin
     fallback  {{sourceFamily: chars}} rare glyphs drawn with another size's pixels (still 1:1) */
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
window.FONTS = Object.assign(window.FONTS || {{}}, {{ready, info: INFO}});
}})();
'''
out_han = f'''/* fonts-han.js — GENERATED by tools/px/build-fonts.py, do not edit by hand.
   FP12's common-hanzi supplement, for text no build can know: player nicknames (leaderboard, account dialog).
   One more FontFace in the SAME family "FP12" (base64 woff2, works from file://) whose unicodeRange holds only the
   {len(HAN)} hanzi of tools/hanzi-3500.txt that fonts.js lacks, so the browser takes each glyph from whichever FP12
   face has it — in the DOM (font-family FP12 at 12 × the art px) and on a canvas ('12px FP12') alike. Same Fusion
   Pixel 12px design and metrics as fonts.js's FP12; FP8/FP10/FP16 get no supplement. A rarer hanzi or an emoji
   still falls back to the next font of the stack, one glyph at a time.
   Load it lazily, only where a nickname may show ({len(han_data) // 1024} KB woff2); before or after fonts.js, either works.
   FONTS.hanReady: Promise<boolean> — true once the face is loaded, false if the browser refused it (never rejects).
   Creates window.FONTS when fonts.js hasn't run yet (fonts.js then keeps hanReady).
   Source: Fusion Pixel Font 12px proportional zh_hans v2026.09.25 by TakWolf, subset + renamed
   (SIL OFL 1.1, assets/fonts/px/LICENSE-fusion-pixel.txt). */
(function(){{
const RUN = {json.dumps(steps(HAN))};  // its hanzi, each as the step from the previous code point: '#'…'|' = 1…90, '~hex;' more
const DATA = "{base64.b64encode(han_data).decode()}";
const b = atob(DATA), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
let cp = 0x{ord(HAN[0]) - 1:X};
const range = RUN.replace(/~(\\w+);|[^]/g, (m, h) => ',U+' + (cp += h ? parseInt(h, 16) : m.charCodeAt(0) - 34).toString(16)).slice(1);
const ff = new FontFace('FP12', u.buffer, {{unicodeRange: range}}); document.fonts.add(ff);
(window.FONTS || (window.FONTS = {{}})).hanReady = ff.load().then(() => true, () => false);
}})();
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
for path, s in ((OUT, out), (OUT_HAN, out_han)): open(path, 'w', encoding='utf8').write(s)
ob, hb = out.encode(), out_han.encode()
print('scanned', ' '.join(SCAN))
print('charset %d chars (%d hanzi); faces %d; js/px/fonts.js %.1f KB (%d bytes, %.1f KB gz)' % (len(CHARS), sum(map(is_han, CHARS)), len(faces), len(ob) / 1024, len(ob), gz(ob) / 1024))
for f in faces: print('  %-5s %-40s %6.1f KB woff2, %6.1f KB base64' % (f['family'], (f['range'] or 'primary')[:40], len(f['data']) / 1024, len(base64.b64encode(f['data'])) / 1024))
for fid, i in info.items(): print(' ', fid, {k: v for k, v in i.items() if k not in ('source', 'license')})
print('js/px/fonts-han.js: FP12 + %d hanzi (hanzi-3500 minus fonts.js); %.1f KB woff2, %.1f KB base64; %.1f KB (%d bytes, %.1f KB gz)'
      % (len(HAN), len(han_data) / 1024, len(base64.b64encode(han_data)) / 1024, len(hb) / 1024, len(hb), gz(hb) / 1024))
warnings()
