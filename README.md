# 拼音快线 · Guangzhou Metro Pinyin Express

A single-file browser game: drive trains along Guangzhou Metro **Lines 1, 2, and 3** by typing each station's pinyin. Faster, more accurate typing means higher train speed, longer combos, and bigger scores.

**Play it:** open `index.html` in any browser — no build step, no dependencies, works offline. (If GitHub Pages is enabled for this repo, it plays directly from the Pages URL.)

## How to play

1. Pick a line and direction. Lines are ranked **Level 1–3 by average station-name length** (Line 3 → Line 1 → Line 2), and each stop carries a 短/中/长 difficulty tag — longer names score more.
2. The LED destination board shows the next stop in 汉字 with toned pinyin underneath. Type the **toneless** pinyin on an English keyboard; spaces are optional (`tiyuxilu` ✓). Correct letters light up green; finish the name and the train departs.
3. Watch the HUD: speedometer driven by your typing pace (Line 3 authentically tops out at 120 km/h vs. 80 on Lines 1–2), plus distance, time, WPM, accuracy, combo, and score.
4. **Level 4 — Long-Name Gauntlet:** the network's 13 longest station names against a countdown ring, three lives, from 汉溪长隆 up to the 22-letter 白云文化广场.

## Features

- Schematic SVG network map with the Pearl River, interchange rings, real transfer badges, and a camera that follows your train
- Progress shown in color everywhere: per-letter lighting on the board, heat-colored stations and progress bar (green/amber/red by typing speed), and an end-of-run heat strip with fastest/slowest stop callouts
- Combo multipliers, medals (trainee → skilled → ace driver), arrival chimes (mutable), and per-line session-best records
- Vanilla HTML/CSS/JS in one file; responsive from phone to desktop; respects `prefers-reduced-motion`

## Data notes

Fan-made typing practice, not affiliated with Guangzhou Metro. Covers the classic **main-line segments** of Lines 1, 2, and 3 (no extensions or the airport branch); inter-station distances are approximate. Station pinyin is toned for display and matched tonelessly for input (e.g. 市二宫 → `shiergong`).
