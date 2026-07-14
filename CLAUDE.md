# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

拼音快线 · Guangzhou Metro Pinyin Express — a single-file browser typing game. Players pick a Guangzhou Metro line (1/2/3), type each station name in toneless pinyin to drive the train forward, and are scored on speed, accuracy, and combos. Difficulty levels derive from station-name length; progress is shown with colors on a schematic SVG map.

- **Everything lives in `index.html`** (vanilla HTML/CSS/JS, ~950 lines). No build step, no dependencies, no package manager. Keep it that way — do not introduce tooling, frameworks, or split files unless explicitly asked.
- Run it by opening `index.html` in a browser (or any static server). Works offline.
- Repo: https://github.com/JamieStudio-lab/guangzhou-metro-typing

## Structure of index.html

In document order:

1. **CSS** (`<style>` in head) — dark theme via custom properties on `:root` (`--ink`, `--panel`, line colors `--l1/--l2/--l3`, per-run accent `--lc`). Sections are commented: header, menu, game, boss stage, LED board, result, map SVG text, confetti.
2. **HTML** — three screens toggled via `hidden`: `#menu` (hero, overview map `#ovMap`, line cards), `#game` (HUD chips + speedometer `#gauge`, game map `#gMap`, boss stage `#bossStage`, LED destination board `#board` with pinyin display `#py` and input `#pyin`), `#result`.
3. **JS** (one `<script>`):
   - **DATA block** between `/*__DATA__*/` and `/*__END_DATA__*/`: the `LINES` array. Each station is a tuple `[汉字, toned pinyin, x, y, labelPos, transfers?]`; `segKm` holds inter-station distances. Everything else (toneless `key`, total `km`, `avgLen`, level ordering, the `BOSS` list of names ≥14 letters) is **derived automatically** — to add or edit stations/lines, only touch this block.
   - Pinyin normalization: `TONE` map + `normPy()` strip tones/spaces; display is toned, matching is toneless (市二宫 → `shiergong`).
   - Map building: `buildRegistry()`/`REG` dedupes interchange stations across lines; `buildMap(svg, opts)` renders rivers, line paths, station dots/labels, and optionally the train.
   - Game engine: global state object `S`; `startLine`/`startBoss` set up a run; `handleTyping()` is the input core (prefix-match against `S.key`, errors reset combo); `completeStation()` queues train travels; `tick()` (rAF loop) animates train, camera follow, and speedometer; boss mode adds a countdown ring, 3 lives, and timeouts.
   - Results: `showResult()` computes WPM/accuracy/stars, heat strip, session bests (`bests`, in-memory only).

## Conventions

- UI text is bilingual: Chinese first, English second (e.g. `用时 TIME`).
- Difficulty tags come from `diffOf(key.length)`: ≤7 short, ≤12 medium, else long. Speed heat colors from `heatOf(perf)`: green/amber/red.
- Scores/bests are **session-only by design** (no localStorage) — the menu footnote promises this; don't add persistence without being asked.
- Data covers classic main-line segments of Lines 1/2/3 only; distances approximate; fan-made, not affiliated with Guangzhou Metro.
- Respect the existing style: compact code, minimal comments, `prefers-reduced-motion` support, `--lc` accent recolors per line.

## Testing

No test framework. Verify changes by opening `index.html` in a browser and playing a short run: pick a line, type a few stations (check letter-by-letter highlighting, train movement, gauge, combo), and try the boss mode if the change touches timing or data.
