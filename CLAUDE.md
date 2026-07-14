# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

拼音快线 · Guangzhou Metro Pinyin Express — a browser typing game. Players pick a Guangzhou Metro line (1/2/3), type each station name in toneless pinyin to drive the train forward, and are scored on speed, accuracy, and combos. Difficulty levels derive from station-name length; progress is shown with colors on a schematic SVG map.

- **Vanilla HTML/CSS/JS, no build step, no dependencies, no package manager.** Keep it that way — do not introduce tooling or frameworks unless explicitly asked.
- Run it by opening `index.html` in a browser or via any static server (VS Code Live Server is the recommended workflow). Must keep working from `file://` — so **plain `<script>` tags only, never ES modules**.
- Repo: https://github.com/JamieStudio-lab/guangzhou-metro-typing · Live: https://jamiestudio-lab.github.io/guangzhou-metro-typing/

## File structure

- `index.html` — markup only: `#menu` (hero, overview map `#ovMap`, line cards), `#game` (HUD chips + speedometer `#gauge`, game map `#gMap`, boss stage, LED board `#board` with pinyin display `#py` and input `#pyin`), `#result`. Loads the stylesheet and the two scripts (order matters: `data.js` before `game.js`; they share global scope).
- `css/style.css` — all styles. Material Design 3 token system via custom properties on `:root` (dark default) and `:root[data-theme="light"]`: tonal surfaces (`--ink`/`--panel`/`--panel2`), shape scale `--r-*`, motion `--ease`, elevations `--sh1..3`, line colors `--l1/--l2/--l3`, per-run accent `--lc` (see “Design system”). Sections are commented: tokens, header, menu, game, boss stage, LED board, result, map SVG text, confetti.
- `js/data.js` — the station data, marked by `/*__DATA__*/…/*__END_DATA__*/`: the `TONE` map + `normPy()` normalizer and the `LINES` array. Each station is a tuple `[汉字, toned pinyin, x, y, labelPos, transfers?]`; `segKm` holds inter-station distances. Everything else (toneless `key`, total `km`, `avgLen`, level ordering, the `BOSS` list of names ≥14 letters) is **derived automatically in game.js** — to add or edit stations/lines, only touch this file.
- `js/game.js` — everything else: `APP_VERSION`, data normalization, map building (`buildRegistry()`/`REG` dedupes interchanges; `buildMap()` renders rivers/lines/stations/train), game state object `S`, `startLine`/`startBoss`, the typing core `handleTyping()` (prefix-match against `S.key`, errors reset combo), `completeStation()` → queued train travels, the rAF `tick()` loop (train, camera follow, speedometer), boss mode (countdown ring, 3 lives), and `showResult()` (WPM/accuracy/stars, heat strip, in-memory session bests).

## Versioning workflow (required for every user-visible iteration)

Versions are semver, currently 0.x (v1.0.0 is reserved for a milestone the user declares). For each iteration that changes what users see or play:

1. Bump `APP_VERSION` in `js/game.js` (patch = fixes/tweaks, minor = new features, major = reworks). It is displayed in the menu footnote automatically.
2. Add a dated entry to `CHANGELOG.md` (Keep a Changelog format) and update the compare links at the bottom.
3. Commit, then `git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"` and `git push --follow-tags`.
4. Create a GitHub Release for the tag with the changelog entry as the notes (`gh release create` if logged in, otherwise ask the user).

## Conventions

- UI text is bilingual: Chinese first, English second (e.g. `用时 TIME`).
- Difficulty tags come from `diffOf(key.length)`: ≤7 short, ≤12 medium, else long. Speed heat colors from `heatOf(perf)`: green/amber/red.
- Scores/bests are **session-only by design** (no localStorage) — the menu footnote promises this; don't add persistence without being asked.
- Data covers classic main-line segments of Lines 1/2/3 only; distances approximate; fan-made, not affiliated with Guangzhou Metro.
- Pinyin is displayed toned but matched tonelessly (市二宫 → `shiergong`).
- Respect the existing style: compact code, minimal comments, `prefers-reduced-motion` support, `--lc` accent recolors per line.

## Design system (Material Design 3 / Material You, adapted)

Since v0.0.4 the UI follows MD3, adapted to the game's metro theme — **do not** use the canonical purple seed or Google Fonts. Rules for any UI work:

- **Seed & palette**: amber-gold metro accent (`--amber`) is the primary seed over navy-tinted tonal surfaces (dark default) / warm cream surfaces (light). Never pure white or pure black backgrounds. Tertiary/danger is `--bad`.
- **Dynamic color**: the chosen line personalizes the run — JS sets `--lc` on `body`/`#board`, and `--tint` (`color-mix` of `--lc` into `--panel2`, defined on `body`, 8% dark / 5% light) tints game-screen containers (chips, gauge). Note: `--tint`/`--lct` must stay declared on `body`, not `:root`, so `var(--lc)` resolves where JS sets it.
- **Shape scale** `--r-xs…--r-2xl,--r-full`: all buttons are pills (`--r-full`) with `:active{transform:scale(.95–.97)}`; chips/cells `--r-md`; cards `--r-lg`; map/board/result panels `--r-xl`; hero `--r-2xl`. Input `#pyin` is an MD3 filled text field: rounded top corners, square bottom, 2px bottom border that turns `--lc` on focus.
- **State layers, not hue shifts**: hover = `color-mix` overlay (10% white into filled buttons; 10% `--amber` into tonal surfaces). Elevation via `--sh1..3` soft shadows + tonal separation instead of 1px borders. Motion: 200–300ms with `--ease` (MD3 emphasized-decelerate); transforms disabled under `prefers-reduced-motion`.
- **Blur shapes**: decorative `.blobs` (aria-hidden, `z-index:-1`, line-color circles as radial-gradient fades, opacity `--blob-op`) live on `#menu` and `#result` **only** — keep the game screen clean. Use radial-gradient fades, not `filter:blur` — blur bleeds past the section's `overflow:hidden` clip and leaves visible rectangle edges.
- **Exception — LED board**: `#board` keeps its dark hardware look (gradient, dot matrix, sheen, glow) in **both** themes; light theme re-overrides its inherited tokens in the `:root[data-theme="light"] #board` block. Do not materialize it into a tonal surface.

## Testing

No test framework. Verify changes by opening `index.html` in a browser (both via a local server and directly via `file://`) and playing a short run: pick a line, type a few stations (check letter-by-letter highlighting, train movement, gauge, combo), and try the boss mode if the change touches timing or data. `node --check js/*.js` catches syntax errors quickly.
