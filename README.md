# 一键到站 · Keys to the City

A typing speed run through the Guangzhou Metro: pick a line (**1, 2, or 3**), type each station's pinyin, and every stop is one keystroke away. Faster, more accurate typing means higher train speed, longer combos, and bigger scores — and you ride past the real geography of the city while you're at it.

**Play it:** https://jamiestudio-lab.github.io/guangzhou-metro-typing/ — or open `index.html` locally in any browser. No build step, no dependencies, works offline.

Plain HTML/CSS/JS split across `index.html` (markup), `css/style.css`, `js/geo.js` (network geography), `js/data.js` (playable station data), and `js/game.js` (engine). Version history lives in [CHANGELOG.md](CHANGELOG.md); each release is also tagged on GitHub.

## How to play

1. Pick a line and direction. Lines are ranked **Level 1–3 by average station-name length** (Line 3 → Line 1 → Line 2), and each stop carries a 短/中/长 difficulty tag — longer names score more.
2. The LED destination board shows the next stop in 汉字 with toned pinyin underneath. Type the **toneless** pinyin on an English keyboard; spaces are optional (`tiyuxilu` ✓). Correct letters light up green; finish the name and the train departs.
3. Watch the HUD: speedometer driven by your typing pace (Line 3 authentically tops out at 120 km/h vs. 80 on Lines 1–2), plus distance, time, WPM, accuracy, combo, and score.
4. **Level 4 — Long-Name Gauntlet:** the network's 13 longest station names against a countdown ring, three lives, from 汉溪长隆 up to the 22-letter 白云文化广场.

## Features

- SVG network map drawn from **real station geography** (projected from OpenStreetMap coordinates) with the Pearl River, interchange rings, real transfer badges, a hover-highlight legend, and a camera that follows your train
- Progress shown in color everywhere: per-letter lighting on the board, heat-colored stations and progress bar (green/amber/red by typing speed), and an end-of-run heat strip with fastest/slowest stop callouts
- Combo multipliers, medals (trainee → skilled → ace driver), arrival chimes (mutable), and per-line session-best records
- Vanilla HTML/CSS/JS with zero dependencies; responsive from phone to desktop; respects `prefers-reduced-motion`

## Data notes

Fan-made typing game, not affiliated with Guangzhou Metro. Covers the classic **main-line segments** of Lines 1, 2, and 3 (no extensions or the airport branch); inter-station distances are approximate. Station pinyin is toned for display and matched tonelessly for input (e.g. 市二宫 → `shiergong`).

`js/geo.js` holds real coordinates, names, and official colors for the **entire 2026 network** (all 19 numbered lines + Guangfo + APM, 367 stations), generated from the OpenStreetMap Overpass API by `tools/fetch-geo.js` — the groundwork for adding more playable lines. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under ODbL 1.0.
