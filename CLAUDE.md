# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

一键到底 · Metro Typing · Guangzhou (named 拼音快线 · Pinyin Express before v0.1.0) — a browser typing game. Players pick a Guangzhou Metro line (1/2/3), type each station name in toneless pinyin to drive the train forward, and are scored on speed, accuracy, and combos. Difficulty levels derive from station-name length; progress is shown with colors on an SVG map drawn from real station geography.

- **Vanilla HTML/CSS/JS, no build step, no dependencies, no package manager.** Keep it that way — do not introduce tooling or frameworks unless explicitly asked.
- Run it by opening `index.html` in a browser or via any static server (VS Code Live Server is the recommended workflow). Must keep working from `file://` — so **plain `<script>` tags only, never ES modules**.
- Repo: https://github.com/JamieStudio-lab/guangzhou-metro-typing · Live: https://jamiestudio-lab.github.io/guangzhou-metro-typing/

## File structure

- `index.html` — markup only: `#menu` (hero, overview map `#ovMap` + vertical hover-highlight legend `#legend`, line cards, leaderboard `.lbcard`), `#game` (HUD chips + speedometer `#gauge`, game map `#gMap`, boss stage, LED board `#board` with pinyin display `#py` and input `#pyin`), `#result` (incl. `#newBadges`/`#cloudNote`), the account `<dialog id="accDlg">` (inner HTML built by `cloud.js`). Loads the stylesheet and the four scripts (order matters: `geo.js` → `data.js` → `game.js` → `cloud.js`; they share global scope).
- `js/geo.js` — **generated, do not edit by hand**: real geography for the whole 2026 network (all 19 numbered lines + Guangfo + APM; per line: ref/names/official color/OSM relation ids, stations as `{zh,en,lat,lon}` in line order). Regenerate with `node tools/fetch-geo.js` (Overpass API; needs network; fail-hards if any playable station name in `data.js` stops matching — extend its `ALIAS` map for renames). Data © OpenStreetMap contributors (ODbL) — keep the footnote/README attribution.
- `css/style.css` — all styles. Material Design 3 token system via custom properties on `:root` (dark default) and `:root[data-theme="light"]`: tonal surfaces (`--ink`/`--panel`/`--panel2`), shape scale `--r-*`, motion `--ease`, elevations `--sh1..3`, line colors `--l1/--l2/--l3`, per-run accent `--lc` (see “Design system”). Sections are commented: tokens, header, menu, game, boss stage, LED board, result, map SVG text, confetti.
- `js/data.js` — the playable station data, marked by `/*__DATA__*/…/*__END_DATA__*/`: the `TONE` map + `normPy()` normalizer and the `LINES` array. Each station is a tuple `[汉字, toned pinyin, x, y, labelPos, transfers?]`; `segKm` holds inter-station distances. The x/y are only schematic **fallbacks** — real positions are projected from `geo.js` at load (matched by 汉字), so adding a station needs no coordinates, but `labelPos` (l/r/a/b/ul/ur/bl/br) must be tuned against the geographic layout. Everything else (toneless `key`, total `km`, `avgLen`, level ordering, the `BOSS` list of names ≥14 letters) is **derived automatically in game.js** — to add or edit stations/lines, only touch this file (and regenerate `geo.js` if the network grew).
- `js/cloud.js` — optional cloud layer (accounts, settings sync, score upload, leaderboard, badges) against Supabase project `rlnkfalmlnjxqtbjrnrk`. **Zero-dependency by design**: plain `fetch` against the GoTrue (`/auth/v1`) and PostgREST (`/rest/v1`) HTTP APIs — never introduce the supabase-js SDK. Loads last (after `game.js`, whose globals it uses: `store`, `t`/`T`/`LANG`, `setLang`/`setTheme`/`themeManual`, `$`, `LINES`). Everything must degrade to offline play when the network/backend is unavailable, including from `file://`. The publishable key in this file is public by design; security lives in the row-level security policies. `game.js` calls back via `typeof`-guarded hooks: `cloudLangRefresh()` (end of `setLang`) and `cloudOnResult(run)` (end of `showResult`, non-rerender only). Escape all user-generated strings (nicknames!) with its `esc()` before injecting into HTML.
- `supabase/setup.sql` — backend schema: `invites` (RLS with no policies = invisible to the API; registration gate), `profiles` (nickname + lang/theme prefs; created **only** via the security-definer RPC `register_profile`, which consumes an invite use — there is no direct insert policy), `scores` (immutable, with sanity-cap CHECKs as cheap anti-cheat: wpm ≤ 200 etc.; inserts also require a profile), `badges`, the `check_invite` RPC (non-consuming pre-check), and the `leaderboard` view (best score per player per mode, `security_invoker`). RLS: everyone reads, users insert/update only their own rows. Paste into the Supabase SQL Editor to (re)provision — **it drops and recreates**, so it wipes data once live. Invite codes are managed with plain SQL on `invites` (examples at the bottom of the file).
- `js/game.js` — everything else: `APP_VERSION`, `GEOPOS` (equirectangular projection of `GEO` lat/lon → SVG units, ≈34 units/km; constants `K`/`LON0`/`LAT0` tuned so the playable network starts near x≈100,y≈60), the i18n layer (dict `T`, `t()`, `setLang()`), data normalization, map building (`buildRegistry()`/`REG` dedupes interchanges by 汉字 — transfer stations share coords automatically via `GEOPOS`; `roundPath()` smooths bends; `buildMap()` renders rivers/lines/stations/train), the legend (`renderLegend()`/`ovHighlight()` — hover/focus dims other lines on `#ovMap`), game state object `S`, `startLine`/`startBoss`, the typing core `handleTyping()` (prefix-match against `S.key`, errors reset combo), `completeStation()` → queued train travels, the rAF `tick()` loop (train, camera follow, speedometer), boss mode (countdown ring, 3 lives), and `showResult()` (WPM/accuracy/stars, heat strip, in-memory session bests).
- `tools/fetch-geo.js` — dev-only Node ≥18 script (zero deps) that regenerates `js/geo.js` from the Overpass API; never loaded by the page.

## Versioning workflow (required for every user-visible iteration)

Versions are semver, currently 0.x (v1.0.0 is reserved for a milestone the user declares). For each iteration that changes what users see or play:

1. Bump `APP_VERSION` in `js/game.js` (patch = fixes/tweaks, minor = new features, major = reworks). It is displayed in the menu footnote automatically.
2. Add a dated entry to `CHANGELOG.md` (Keep a Changelog format) and update the compare links at the bottom.
3. Commit, then `git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"` and `git push --follow-tags`.
4. Create a GitHub Release for the tag with the changelog entry as the notes (`gh release create` if logged in, otherwise ask the user).

## Conventions

- UI text is single-language, switched by the header 中文/English toggle (since v0.0.6). All strings live in the `T` dict in `js/game.js` (`t(key, …args)`; values may be template functions); static markup is tagged `data-i18n="key"` and refreshed by `setLang()`, dynamic strings call `t()` at render time. Default follows `navigator.language`. Station names/pinyin/map labels stay 汉字 + pinyin in both languages; per-line facts in `js/data.js` stay in the `"中文 · English"` format and are split by `factOf()`.
- Difficulty tags come from `diffOf(key.length)`: ≤7 short, ≤12 medium, else long. Speed heat colors from `heatOf(perf)`: green/amber/red.
- Scores/bests are **session-only when signed out** (the footnote promises this — don't add local score persistence); signed-in players' finished runs upload to Supabase via `js/cloud.js` (since v0.0.8). localStorage keys: `lang`, `theme`, and the auth session `sb_session` (via the `store` helper in `js/game.js`, which no-ops when storage is unavailable).
- Playable data covers classic main-line segments of Lines 1/2/3 only; distances approximate; fan-made, not affiliated with Guangzhou Metro. `js/geo.js` already holds the whole network (coords + official colors) for future lines — a new playable line still needs pinyin, `segKm`, and `labelPos` authored in `data.js`.
- Line colors are the official palette (L1 `#F3D03E`, L2 `#00629B`, L3 `#ECA154`), duplicated in `data.js` (`L.color`, canonical) and `css/style.css` (`--l1/--l2/--l3`, blobs + brandbars) — keep them in sync (confetti in `game.js` too).
- Pinyin is displayed toned but matched tonelessly (市二宫 → `shiergong`).
- Respect the existing style: compact code, minimal comments, `prefers-reduced-motion` support, `--lc` accent recolors per line.

## Design system (Material Design 3 / Material You, adapted)

Since v0.0.4 the UI follows MD3, adapted to the game's metro theme — **do not** use the canonical purple seed or Google Fonts. Rules for any UI work:

- **Seed & palette**: amber-gold metro accent (`--amber`) is the primary seed over navy-tinted tonal surfaces (dark default) / warm cream surfaces (light). Never pure white or pure black backgrounds. Tertiary/danger is `--bad`.
- **Dynamic color**: the chosen line personalizes the run — JS sets `--lc` on `body`/`#board`, and `--tint` (`color-mix` of `--lc` into `--panel2`, defined on `body`, 8% dark / 5% light) tints game-screen containers (chips, gauge). Note: `--tint`/`--lct` must stay declared on `body`, not `:root`, so `var(--lc)` resolves where JS sets it.
- **Shape scale** `--r-xs…--r-2xl,--r-full`: all buttons are pills (`--r-full`) with `:active{transform:scale(.95–.97)}`; chips/cells `--r-md`; cards `--r-lg`; map/board/result panels `--r-xl`; hero `--r-2xl`. Input `#pyin` is an MD3 filled text field: rounded top corners, square bottom, 2px bottom border that turns `--lc` on focus.
- **State layers, not hue shifts**: hover = `color-mix` overlay (10% white into filled buttons; 10% `--amber` into tonal surfaces). Elevation via `--sh1..3` soft shadows + tonal separation instead of 1px borders. Motion: 200–300ms with `--ease` (MD3 emphasized-decelerate); transforms disabled under `prefers-reduced-motion`.
- **Blur shapes**: decorative `.blobs` (aria-hidden, `z-index:-1`, line-color circles as radial-gradient fades, opacity `--blob-op`) live on `#menu` and `#result` **only** — keep the game screen clean. Use radial-gradient fades, not `filter:blur` — blur bleeds past the section's `overflow:hidden` clip and leaves visible rectangle edges.
- **LED board**: `#board` keeps its dark hardware look (gradient, dot matrix, sheen, glow) in the **dark** theme only. Since v0.0.5 the light theme renders it as a light tonal card: the `:root[data-theme="light"] #board` block overrides only the `--brd-*` gradient/dot/sheen tokens and `--input-bg`, everything else (text, rails, `--lct`) inherits the page's light tokens, and the `#zhTxt`/`#py .c.done` glows are disabled in light.

## Testing

No test framework. Verify changes by opening `index.html` in a browser (both via a local server and directly via `file://`) and playing a short run: pick a line, type a few stations (check letter-by-letter highlighting, train movement, gauge, combo), and try the boss mode if the change touches timing or data. `node --check js/*.js` catches syntax errors quickly.
