# 地铁键速 · Metro Typing · Guangzhou

![地铁键速 · Metro Typing · Guangzhou — night skyline cover art with the Canton Tower and metro line traces](assets/metro-typing-cover.png)

A typing speed run through the Guangzhou Metro: pick any of the **19 lines of the 2026 network**, type each station's pinyin, and ride it one key at a time — all the way to the end of the line. Faster, more accurate typing means higher train speed, longer combos, and bigger scores — and you ride past the real geography of the city while you're at it, drawn as a detailed pixel-art city built from OpenStreetMap.

**Play it:** https://jamiestudio-lab.github.io/guangzhou-metro-typing/ — or open `index.html` locally in any browser. No build step, no dependencies, works offline.

Plain HTML/CSS/JS split across `index.html` (markup), `css/style.css`, `js/geo.js` (network geography), `js/boundaries.js` (city/district outlines), `js/data.js` (playable station data), `js/game.js` (engine), `js/cloud.js` (optional accounts/leaderboard layer), `js/px/` (the pixel ride renderer) and `js/map/` (its tiled map data, streamed in as you ride). Version history lives in [CHANGELOG.md](CHANGELOG.md); each release is also tagged on GitHub.

## How to play

1. Pick a line (1–14, 18, 21, 22, Guangfo, or the APM) and a direction. Cards run in line-number order, each tagged **EASY/MEDIUM/HARD from its average station-name length**, and each stop carries a 短/中/长 difficulty tag — longer names score more.
2. The LED destination board shows the next stop in 汉字 with toned pinyin underneath — and a dimmed 接下来/THEN panel previews the stop after it, like a real metro display. You type "into" the pinyin line itself: enter the **toneless** pinyin on an English keyboard (spaces optional, `tiyuxilu` ✓), correct letters lock in green (no backspace — a wrong key just breaks your combo), and finishing the name sends the train off.
3. Watch the HUD: speedometer driven by your typing pace, with authentic per-line top speeds — 160 km/h on the express Lines 18/22, 120 on Lines 3/9/14/21, down to 55 on the little APM — plus distance, time, WPM, accuracy, combo, and score.
4. **Long-Name Gauntlet:** the network's 36 longest station names against a countdown ring, three lives, all the way up to the 22-letter 白云文化广场.

## Features

- **Pixel-art ride on every line, in both directions:** a top-down pixel city built from real OpenStreetMap data — buildings with their heights, roads, rivers, parks, the Nansha sea — with traffic and boats, rain now and then, night/day palettes that follow the theme, a driver's-cab cluster, and an LED board that plays real Guangzhou Metro announcements between stops. The camera shows each hop whole, then follows the train at street level — and when you type faster than it can glide down on a hop of 5 km or more, it keeps the whole trip in view
- **Classic view:** Settings → Ride view switches back to the original SVG map (it's also the automatic fallback on devices that can't draw the pixel map); Settings also sets the pixel size (2×/3×) and the weather (auto/clear/rain)
- SVG network map drawn from **real station geography** (projected from OpenStreetMap coordinates) with the Pearl River, Guangzhou/Foshan city and district outlines, interchange rings, real transfer badges, and a hover-highlight legend
- The menu map **zooms and pans freely** — scroll or pinch deep enough for even the little APM to fill the view, with lines, dots and labels holding a constant slim on-screen weight instead of ballooning; selecting a line frames it with a measured label layout that guarantees **zero overlapping station names**
- In the Classic view, the camera follows your train and frames each hop to fill the view — short downtown hops become dramatic close-ups — with a green completion burst at every arrival and a terminus recap that zooms back out over your whole ride
- Progress shown in color everywhere: per-letter lighting on the board, heat-colored stations and progress bar (green/amber/red by typing speed), and an end-of-run heat strip with fastest/slowest stop callouts
- Combo multipliers, medals (trainee → skilled → ace driver), arrival chimes (mutable), light/dark/system themes, and a 中文/English UI toggle
- Scores are session-only by default; **invite-gated accounts** (optional, via Supabase) sync your settings, upload finished runs to a **cloud leaderboard**, and award badges — everything degrades gracefully to offline play
- Vanilla HTML/CSS/JS with zero dependencies; responsive from phone to desktop; respects `prefers-reduced-motion`

## Data notes

Fan-made typing game, not affiliated with Guangzhou Metro. Covers **all 19 lines of the 2026 network** — Lines 1–14, 18, 21, 22, the Guangfo line and the APM — as they run today (Line 12 is its opened east section; Line 21 currently starts at 天河公园; the Line 3 airport branch and the Knowledge City branch aren't modeled). Inter-station distances are approximate. Station pinyin is toned for display and matched tonelessly for input (e.g. 市二宫 → `shiergong`).

`js/geo.js` holds real coordinates, names, and official colors for the **entire 2026 network** (296 unique stations, 63 interchanges), generated from the OpenStreetMap Overpass API by `tools/fetch-geo.js` — every playable line is projected from it. The city and district outlines drawn behind the network come from `js/boundaries.js` (Guangzhou + Foshan, plus Guangzhou's 11 districts), generated the same way by `tools/fetch-boundaries.js`. The pixel ride's map (`js/map/`: street, district and city tiles plus one track per line) is packed from OpenStreetMap by `tools/fetch-map.js` → `tools/pack-map.js`, and the canvas shows its own attribution line. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under ODbL 1.0.

Typefaces (all [SIL OFL 1.1](https://openfontlicense.org/), subset for the web by `tools/subset-fonts.js`, licenses in `assets/fonts/`): [资源圆体 Resource Han Rounded](https://github.com/CyanoHao/Resource-Han-Rounded) (Chinese), [Nunito](https://github.com/googlefonts/nunito) (Latin), and [Sono](https://github.com/sursly/sono) (monospace). The pixel ride uses [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) (8/10/12 px) and [Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font) (16 px) by [TakWolf](https://github.com/TakWolf), SIL OFL 1.1, subset and embedded by `tools/px/build-fonts.py`; licenses, including those of the fonts Fusion Pixel draws on, are in `assets/fonts/px/`.
