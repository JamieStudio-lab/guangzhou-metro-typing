# Changelog

All notable changes to 地铁键速 · Metro Typing · Guangzhou (一键到底 before v0.1.6, 拼音快线 · Guangzhou Metro Pinyin Express before v0.1.0) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (0.x while in development).

## [0.4.7] - 2026-07-17

### Added
- **The network map on the menu now zooms and pans.** With no line selected, you can zoom into the full 19-line map to pick out a line more easily: scroll to zoom on a computer, or pinch with two fingers on a touch screen (zoom is capped both ways — you can't zoom past the whole network, or deeper than 5×). Once zoomed in, drag to pan — click-drag with a mouse, or a one-finger drag on touch (when not zoomed, a one-finger drag still scrolls the page as before). A **↺ 复位 / Reset** chip appears in the map's corner to return to the default view; a double-click (or double-tap) does the same. Selecting a line still snaps the map to that line as before.
- **Hover a stop to see its name.** On the network map, moving the pointer over any station fades its name in (and back out when you leave), with a subtle halo so it stays readable over the lines. Stops remain non-clickable — the hover is just for reading the map; you still pick a line by clicking the line itself or its card.

## [0.4.6] - 2026-07-17

### Changed
- **Quitting mid-run is now an in-game dialog, not a browser popup.** The exit chip's icon becomes a clean ✕ (dropping the old ⏏), and the chip turns metro-warning red — a translucent red tint that goes solid on hover — so it reads clearly as "leave this run" and stands apart from the amber settings/account chips. Tapping it (or pressing Esc) now opens a settings-style in-game confirmation — *退出本次行程？ / Quit this run?* — with **继续游戏 / Keep playing** as the emphasized default and **退出 / Quit** as the secondary, destructive action, instead of the OS confirm box. The run **pauses while the dialog is open**: the train, the timer, and the Long-Name Gauntlet's countdown all freeze, then resume without penalty if you keep playing (the old popup only froze things as a side effect of blocking the tab). A finished run still exits straight to the menu with no prompt.

## [0.4.5] - 2026-07-17

### Changed
- **The game map only labels the line you're riding.** Before a run began, the map drew station names for the whole 2026 network at once — hundreds of labels crowding each other into an unreadable wash. Now only the line you picked shows its stop names; every other line stays on the map as dimmed dots and track (so you can still see where your line sits in the network), just without the name clutter. The names still fade away on your first keystroke and return, for your line alone, at the terminus recap. Unchanged for the Long-Name Gauntlet.

## [0.4.4] - 2026-07-17

### Added
- **The board now previews the stop after this one.** To the right of the station you're currently typing (labeled 下一站 / NEXT STOP), a smaller, dimmed panel shows what's coming up next on the line — 接下来 / THEN, with the next station's name and toned pinyin — so you can read ahead the way a real metro display lets you. When that upcoming stop is the end of the line the label switches to 终点站 / TERMINUS; once you reach the terminus itself the panel steps aside. It's a line-run touch only — the Long-Name Gauntlet keeps its surprise (and its countdown ring).

## [0.4.3] - 2026-07-17

### Changed
- **The input box is gone — you now type "into" the station name itself.** The board no longer shows a text field; the toned pinyin line *is* the input, lighting up letter by letter as you type (green = locked in, amber underline = next, dim = to come), with a shake on a wrong key. This was always the real feedback — the box just mirrored the correct prefix redundantly — so removing it makes for a cleaner, more game-like board. On touch devices, tap the board to bring the keyboard back up.
- **Correct keystrokes lock in — no deleting and retyping.** Backspace and Delete are disabled during a run. Once you've typed a letter correctly it stays; a mistake still counts against accuracy and breaks your combo, the same as before, but you can't rewind to erase it. Keeps the pressure honest and the speed real.

## [0.4.2] - 2026-07-17

### Changed
- **The settings panel's three controls are more intuitive.** *Sound* is now an on/off toggle switch instead of a 音效/静音 text button — the amber "on" state reads at a glance. *Theme* gains a third state: it now cycles 浅色 → 深色 → 跟随系统 (Light → Dark → System), and "System" follows the device's OS light/dark setting live (flipping the OS theme re-themes the page on the spot). Dark stays the default for new visitors. *Language* becomes a ‹ 中文 › stepper with left/right arrows — room to add more languages later — and the row's Chinese label now reads 语言 (Language) so it's findable even by someone who can't read the current UI language.
- **Signed-in profiles remember "System".** The theme preference (including the new System option) syncs to your account and applies across devices, rather than only the resolved light/dark value. Existing live databases need a one-line migration to allow the new value (see `supabase/setup.sql`).

## [0.4.1] - 2026-07-17

### Changed
- **Eased the opening animation's pace.** The boot splash was a touch brisk, so the loading bar, the train's drive-across, and the title/rails reveal are all slowed by roughly a fifth. Same sequence, just a little more room to breathe. Skip, once-per-session, and reduced-motion behavior are unchanged.

## [0.4.0] - 2026-07-17

### Changed
- **A new boot splash replaces the old rushed title intro.** The opening now starts on a black screen with a train-themed loading bar — an amber fill with a little train riding its leading edge. When it completes, the screen fades to the home page and a train drives across the hero to "deliver" the title: the logo, subtitle, and depart button fade up in its wake while the line-colored rails draw themselves in. It runs once per browser session — a tap, click, or key skips straight to the static home, and `prefers-reduced-motion` skips it outright. (Placeholder art for now; a richer opening is planned.)
- **Dark theme and Chinese are now the defaults.** A first-time visitor (no saved preference) starts in the dark theme and Chinese UI regardless of OS/browser settings, instead of following the system color scheme and `navigator.language`. A stored choice still wins, the theme/language toggles work as before, and signed-in profile preferences still apply. The app no longer auto-switches theme when the OS light/dark setting changes, so the dark default holds.

## [0.3.10] - 2026-07-17

### Fixed
- **Line-colored buttons on the mid-tone palettes were weak-contrast.** For lines whose color sits in the awkward middle brightness — Line 22's orange, Line 8's teal, Line 13's olive, Line 10's slate-blue, plus Line 4's green — neither black nor white label text lands with comfortable contrast, so the depart button, the result "再来一次 / Play again" button, the line-number circle, and the leaderboard tabs read soft (Line 22 actually fell below the AA bar at 4.4:1). Those fills now nudge just far enough (lighter under dark text, deeper under white text) to clear a 6:1 floor against their chosen label, so every line's buttons read cleanly. Lines already above the floor keep their exact official color, and map strokes, rivers, and the run accent stay the real line colors throughout — only the button/chip fills adjust.

## [0.3.9] - 2026-07-17

### Fixed
- **The result screen's "再来一次 / Play again" button was unreadable on dark lines.** It painted the line color behind the button but always left the label black, so on the darker palettes — Line 21's near-black navy sank to a 1.2:1 contrast, essentially invisible, with Lines 2/4/5/6/12/14/18 also failing legibility — the text vanished into the fill. The button now picks black or white per line the way every other line-colored button already did, so the label always reads. (Boss results, already fixed red, were unaffected.)
- **Dark line names were dim on the in-game board.** In the dark theme the LED station name, speedometer digits, and HUD readouts are drawn in the run's line color on the near-black board; for the darkest lines that meant Line 21's name at ~1.2:1 (barely visible while playing) and Lines 6/12/14/18 hovering around 2–3:1. Those colors are now lightened just enough — only when too dark, only for on-board text — to clear a readable contrast floor, while the map strokes, chips, and light theme keep the exact official colors. The `#新纪录 / NEW BEST` badge also gets a light-theme text color so it stops sitting dark-on-dark-green.

## [0.3.8] - 2026-07-17

### Added
- **The map is now a full selection surface: click to dismiss, too.** Clicking the focused line's path again — or any blank patch of map (background, rivers) — collapses its card and glides the map back out to the whole network, mirroring how clicking a line zooms in. Station dots are deliberately inert: a click aimed at a line that lands on a dot neither selects nor dismisses anything.

### Changed
- **Clicking a line on the map no longer yanks the page down.** Picking a line by its map path used to fire two competing scrolls (the adaptive expand scroll, then a card-centering one that won and dragged the freshly-zooming map off screen). Now the page simply stays where it is — the chosen card already rises to the slot right under the map — scrolling down only the minimum needed to keep the card's bottom edge, with its depart button, above the fold on shorter windows. Card-header clicks keep the v0.3.4 adaptive scroll unchanged.

### Fixed
- **The expand scroll landed off-target on phones.** On the stacked mobile layout the scroll was computed before the legend row hid and before the map's height re-hugged the focused line's shape, so it overshot or undershot by that much — a tall line like Line 3 could push the depart button below the fold (since v0.3.4, worsened by v0.3.7's rotation; card-header taps included). The legend now hides inside the same layout pass (cards glide over the gap instead of snapping) and the scroll predicts the map's final height, so the card bottom lands exactly at the screen's bottom edge.

## [0.3.7] - 2026-07-17

### Added
- **The overview map now rotates to give a focused line the biggest stage it can get.** Picking a line (legend pin, card expand, or clicking its path) no longer just zooms to its bbox: the map scans every angle and turns so the line's long axis fills the map card — a near-vertical line like Line 3 swings ~90° to lie flat across the full width, roughly doubling its on-screen size. The smallest rotation within 3% of the best fit wins, so roundish lines (the Line 11 loop) barely move, and on portrait screens — where vertical lines already fit — the map stays put. Zoom, rotation, and labels tween together in the existing 420 ms glide; unfocusing turns everything back; `prefers-reduced-motion` snaps instantly.
- **Strip-map station labels on rotated lines.** Labels counter-rotate to stay level, and once a line turns past 20° they switch from the hand-placed layout to diagonal 45° tags — constant footprint along the track, so long names can't pile up once the line lies horizontal. Each station leans −45° or +45° depending on its local track direction, keeping every tag at least 45° off its own line (dense doglegs like Line 2's city core stay legible), and the view pads itself so terminal tags don't clip at the edges.
- **A little compass.** A north cue fades in over the map's corner whenever it's rotated, needle tracking the turn, and disappears when the map is upright again.

## [0.3.6] - 2026-07-17

### Changed
- **The night hero's scrim settled at 25%** (from v0.3.5's 18%, tower-cutout dimming matched at `brightness(.75)`) — a touch more contrast under the title without putting out the city lights.

## [0.3.5] - 2026-07-17

### Added
- **The dark theme gets a real night skyline.** The title screen now swaps its art with the theme: a new night render of the Canton Tower scene — lit tower, neon skyline, river reflections — in dark, the daytime render in light. The dusk scrim that used to fake night over the day photo eased from 45% to 18%, so the city lights actually glow. Under the hood the hero art became theme-picked CSS backgrounds: each theme downloads only its own image pair, the boot preload follows the active theme, and the other pair quietly prefetches a few seconds after boot so the settings toggle swaps scenes instantly.

## [0.3.4] - 2026-07-17

### Changed
- **Expanding a card now scrolls adaptively instead of to a fixed anchor.** If the whole map and the whole expanded card can share the screen, the page aligns the map's top to the viewport (both fully visible); on shorter windows it pins the card's bottom to the screen's bottom edge, so the full card shows with as much of the zoomed map above as fits. The card's final height is predicted (header + body content) before the expand/FLIP animations start, since neither reports the true size mid-flight.

## [0.3.3] - 2026-07-17

### Added
- **Sort the line cards your way.** A 排序 / SORT chip row sits between the map and the cards: order by line number, stop count, or difficulty; tapping the active chip again flips ascending ↔ descending (arrow on the chip shows which). The gauntlet card always closes the list, and re-sorting glides the cards to their new slots. The choice is session-only, like everything else while signed out.
- **The gauntlet card shows its range** — row 2 now reads first word → longest word, mirroring the line cards' terminals.

### Changed
- **Card headers breathe in two rows.** Row 1: difficulty tag, line roundel, name, chevron; row 2: terminals and stop count. The narrow-viewport and narrow-cell wrap hacks that the old single-row header needed are gone.
- **An expanded card rises to the top, right under the map.** Opening a card promotes it to a full-width slot above the others (FLIP animation — siblings glide, the card grows), and the page scrolls so the zoomed map and the open card share the screen. Collapsing or picking another card animates everything back. Under `prefers-reduced-motion` the moves are instant.

## [0.3.2] - 2026-07-17

### Added
- **All 19 lines of the 2026 network are playable.** Lines 4–14, 18, 21, 22, the Guangfo line, and the APM join the original three — 296 unique stations, 63 real interchanges, every one with hand-authored toned pinyin (cross-checked programmatically against OSM's official romanizations), per-segment distances scaled to each line's official length, and bilingual line descriptions fact-checked against Wikipedia (per-line top speeds too: 160 km/h on the D-type expresses 18/22 down to 55 on the APM). Line 12 ships as its opened east section; Line 21 starts at 天河公园 while its 员村 stub is closed for rebuilding; the Line 3 airport branch and Knowledge City line aren't modeled.
- **Line 3 grows its 2024 eastern extension.** 海傍 / 海涌路 / 石碁南 / 傍江 extend the classic segment to 20 stations — new l3 runs earn more than the old records, which stay on the board.
- **Line 11 draws as the loop it is.** The playable run is linear (赤沙 → 龙潭), and the map closes the ring with a decorative arc.
- **A completion badge for every line,** each wearing a dot in its line color; the l1/l2/l3 badges players already earned keep their ids and names.

### Changed
- **The menu scales to twenty cards.** Cards flow into a two-column grid on desktop (single column on phones) in line-number order — 1…14, 18, 21, 22, GF, APM — with the boss card closing the set; a container query wraps each card's header when its cell gets narrow. Difficulty tags are now terciles of the ranking (7 EASY / 6 MEDIUM / 6 HARD) instead of "everything after the second card is HARD"; honest consequence: Line 1 now reads MEDIUM and Line 2 HARD.
- **Legend and leaderboard grew up.** The map legend packs its 20 pills into a two-column grid beside the overview map (wrap-row on mobile), and the leaderboard + my-records tabs became number roundels in official line colors (full name in the tooltip), with the gauntlet tab keeping its label.
- **The camera frames your line, not the whole map.** With 19 lines drawn, the run's opening shot and the terminus recap now fit the ridden line's bounding box (`fitSeq`) instead of the entire network; the LED board's line chip stretches to a pill for "APM".
- **The boss pool nearly tripled.** Every station name ≥14 letters across the network now qualifies: 13 → 36 words, still 3 lives — a full clear is a real marathon now, and old gauntlet records will be overtaken.
- **Confetti celebrates in all 19 line colors,** and the footnote/aria text now describe the full network. Fonts were re-subset for the 16 new rare station characters (㘵冼埔姬暹柯梓棣浔湴漖琶碁邨陂鹭); the Guangfo station 𧒽岗's Ext-B character isn't in Resource Han Rounded, so that one glyph renders in the system font.

### Ops
- **Run `supabase/migrations/0.3.2-mode-whitelist.sql` on the live database** (SQL editor, once) — it widens the `scores.mode` CHECK to the new line ids. Until then, signed-in uploads on new lines politely fail with "☁ upload failed"; the other caps hold (a 32-station line still peaks ≈22k points vs the 200000 cap). `setup.sql` carries the same list for fresh provisions and now warns against re-running it on live data.

### Fixed
- **Stale transfer badges.** The hand-authored ⇄ hints (e.g. Line 1 芳村 claiming a Guangfo transfer it doesn't have) are gone — drawn interchanges get their white dot automatically from the map registry, and only the un-modeled Line 3 airport branch keeps ⇄3 badges (林和西, 广州东站, 燕塘, 嘉禾望岗, 高增).

## [0.3.1] - 2026-07-17

### Fixed
- **Badges no longer show as unearned right after signing in.** `afterLogin()` fired the badge fetch without awaiting it, so opening the account dialog quickly after login rendered every chip dim plus a bogus "No badges yet" line until the next open. The login flow now waits for badges before reporting itself done, and `loadBadges()` repaints the dialog if it's already open when the badges arrive (covers the slow-network session-restore path at boot, too).

## [0.3.0] - 2026-07-17

### Added
- **My records — your best 5 runs per line.** The signed-in account dialog grows a 我的纪录 / My records section: Line 1/2/3/Gauntlet tabs (same pill style as the leaderboard) with up to five of your top-scoring uploaded runs each, showing rank, date, stars, WPM, accuracy, and score. Your #1 run wears the leaderboard's amber highlight. Rows come straight from the existing `scores` table (no backend changes), are cached per mode, refresh after each upload, and degrade to a quiet message offline.
- **The upload note now places the run in your own history.** Alongside the global rank, finishing a signed-in run appends 个人新纪录！/ new personal best! when the run tops your uploads in that mode, or 个人第 N 佳 / your #N best when it lands in your top 5. Slower runs outside your top 5 add nothing.

### Changed
- The account dialog scrolls when its content outgrows short viewports (it now hosts badges *and* records).

## [0.2.14] - 2026-07-17

### Changed
- **The hero rails breathe again.** In the title screen's lower band the orange, green, and red decorative rails had drifted within 4–8 units of each other (7-unit strokes — they visually touched). The orange rail's right run rises from y≈528 to y≈496, and the green rail is redrawn as a bottom-right elbow that enters from the right edge at y≈585 and dives off the bottom, instead of co-running the full width squeezed between orange and red. The red rail is untouched; every neighboring pair in the band now sits ≥ ~50 units apart, and all six lines keep their boot draw-in and glide animations.

## [0.2.13] - 2026-07-16

### Changed
- **The result card floats centered.** `#result` is now a full-viewport flex container that centers the card both ways on any screen size; previously the card hugged the top with a fixed margin. The card keeps its 688 px width cap.
- **Colored top bar removed.** The 6 px line-color strip across the top of the result card (`​.rcard::before`) is gone — the line color already speaks through the score/WPM/ACC cell tints and the replay button.

### Fixed
- **The global-rank note now reports your real standing.** After an upload it said “当前全球第 N 名 / #N worldwide” but ranked *this run's* score against every player's best — so replaying below your own record counted **your own best against you** (e.g. the #1 player finishing a casual slower run was told they were #2). The note now looks up your best in the mode first and ranks that, matching what the leaderboard actually shows. Verified against the live backend.

## [0.2.12] - 2026-07-16

### Added
- **The score counts up.** When the result card appears, the SCORE value rolls from 0 to its final total over ~0.9 s with an ease-out curve — a small ceremony for the run's headline number. It plays once per finish (language switches re-render the final value without replaying) and is skipped under `prefers-reduced-motion`.

### Changed
- **The stat grid now has three tiers.** Cells are regrouped into run logistics on top (time, distance/cleared, top speed/lives, errors) and performance below (WPM, accuracy, combo, score). WPM and accuracy get a light line-color tint (7% tonal mix, half the score cell's 14%), so the eye lands on score first, speed and accuracy second, everything else third.

### Fixed
- **Reduced-motion boot crash.** With `prefers-reduced-motion` on, the intro skip called `clearTimeout(tm)` before the `const tm` existed (temporal dead zone), throwing on load and killing the whole script — no line cards, no legend, no version footnote. The timer handle is now declared before the skip path runs.

## [0.2.11] - 2026-07-16

### Changed
- **The speedometer behaves like one.** The gauge needle used to track each keystroke's speed burst through a fast 0.22 s filter — flicking up and down like a tachometer. It now has instrument inertia: a quicker 0.55 s spin-up and a slow 1.3 s coast-down, so sustained typing reads as a steady needle that eases down when you pause instead of bouncing per letter. Train motion, flames, and scoring are untouched — only the displayed speed is smoothed.
- **The WPM chip is live.** It was a whole-run average updated only on keystrokes; now it's a rolling ~10 s window (ramping up from the run's start), refreshed 4×/s from the frame loop — it tracks your current pace and visibly decays while you idle. The result screen still reports whole-run WPM.
- **Roomier result card.** Bigger type and more air throughout the level-complete box: title 24 → 28 px, medal 48 → 56 px, stars 19 → 22 px, stat values 21 → 26 px with clearer labels, cell padding 10×12 → 14×16, wider grid gaps and margins, taller heat strip, and the card itself grows to 720 px with more padding. The SCORE cell is now the hero stat: line-color tonal tint and a 30 px value.

## [0.2.10] - 2026-07-16

### Added
- **Typed-name burst on the map.** The instant a station name is fully typed, its stop celebrates: a green ring (the heat palette's `--good`) blooms outward from the dot once, and the stop's 汉字 pops up in green a little above the shape — a brief reveal on the otherwise name-less typing map — holds for a beat, then fades (~1.6 s total). Interchange stations get a wider ring and extra name clearance; a thin page-background stroke keeps the green name legible over rails and rivers in both themes. Under `prefers-reduced-motion` the ring is skipped and the name simply appears and goes.

## [0.2.9] - 2026-07-16

### Changed
- **The lens looks where you're going.** The camera center now leans 25% ahead of the train toward the next platform, so upcoming track fills more of the frame than track already ridden; the bias fades naturally as the train closes in on the stop.
- **Tighter zoom across the board.** The per-hop zoom formula drops from `300 + 140·km` (380–880) to `230 + 110·km` (310–780 SVG units) — every ride sits noticeably closer to the rails — guarded by a new hard floor that keeps both the stop just left *and* the stop ahead inside the frame (with padding, aspect-ratio aware) at all times, on any viewport.
- **Hop-to-hop zoom crossfades.** Over the last 20% of each segment the zoom target eases into the next segment's width (smoothstep), so a short hop feeding a long express gap no longer steps the lens at the platform.
- **Arrivals punch in.** Landing at a platform dips the zoom ~4% for about half a second — a soft punctuation mark per stop. Skipped under `prefers-reduced-motion`.

## [0.2.8] - 2026-07-16

### Changed
- **The lens frames the hop, not the speed.** The follow camera's zoom is now keyed to the distance of the segment being ridden — close old-town stops pull the camera way in (0.9 km → 426 SVG units wide), long express gaps ease it out (4.3 km → the 880 cap; `clamp(300 + 140·km, 380, 880)`), so every station-to-station crossing occupies a similar fraction of the screen and reads at a similar pace. The v0.2.2 speed-linked widening is gone: the zoom target only changes at stations, and the zoom itself glides at half the pan's smoothing rate, so the lens stays calm instead of breathing with every keystroke burst.

## [0.2.7] - 2026-07-16

### Changed
- **The camera pulls back further — the ride reads calmer still.** The follow window widens again, 560–800 → 700–960 SVG units (~20% more line in frame at every speed), so the train's on-screen motion between stops is proportionally slower. To offset the wider view the map train sprite is scaled up 15%, keeping it readable without touching the flames' alignment.
- **The hero train matches the gameplay train.** The boot intro's left-to-right train on the title screen is redrawn in v0.2.6's top-down roofline style: three cars with dark gangway connectors between them, twin amber livery stripes along each roof edge, paired AC units, and a windshield arc + twin glowing headlights on the lead car. Same once-only crossing animation, still hidden under `prefers-reduced-motion`.

## [0.2.6] - 2026-07-16

### Added
- **Top-down train.** The map train is redrawn as a true bird's-eye roofline to match the map's perspective: a rounded roof with two carriage-joint panel lines and a pair of AC units, twin line-color livery stripes along the roof edges (recolored per run like the old band), a dark windshield arc at the nose, and twin headlights with a soft glow cone ahead. Same footprint as before, so the hot-streak flames and speed lines line up unchanged.

### Changed
- **The map clears once you start typing.** On a run's first keystroke every station name (汉字, pinyin, transfer tags) fades off the game map, leaving just the line, the dots, and the train — the LED board is where you read the next stop. The names return with the zoomed-out recap at the terminus. Transition suppressed under `prefers-reduced-motion`.
- **More line in frame — the train reads calmer.** The follow camera's window widens from 470–700 to 560–800 SVG units, so a longer stretch of line is visible at every speed and the train's on-screen motion is proportionally slower, most noticeably on the short old-town hops where the tight zoom used to make it dart between platforms.
- **Station labels sit farther from their dots.** All eight `labelPos` offsets push outward (sides 16 → 23 units, above/below +6, diagonals +5), clearing the interchange rings and heat halos now that the map is the star during a run.

## [0.2.5] - 2026-07-16

### Changed
- **Station easing: the ride swells between stops.** The per-name distance mapping is no longer linear: each name's typed fraction passes through a 70% smoothstep blend (`EASE` knob, 0 = linear, 1 = full stop at platforms), so the first letters pull the train gently away from the platform (~0.3× pace), the middle letters cruise it at up to ~1.35×, and the last letters brake it smoothly into the next stop. Because the curve still maps 1 → 1, v0.2.4's guarantee is untouched — the final letter still lands the train on the platform. The speedometer now sweeps up and down across every segment, and the speed-linked camera breathes with it.
- **Hot-streak flames read sustained pace.** The flames now key off a slower ~1.2 s-averaged speed instead of the instantaneous needle, so the deliberate per-station dips introduced by the easing don't extinguish a genuine streak — flames persist through stops while you keep typing fast, and still die out when you actually slow down or fumble.

## [0.2.4] - 2026-07-16

### Changed
- **The last letter lands the train on the platform.** The throttle/brake physics (live typing rate → target speed → acceleration clamps) are replaced by direct drive: each correct letter owns its slice of the segment's distance, and the train pursues that earned point with a short chase constant (`CHASE`, 0.17 s) plus a minimum closing speed (`ARRIVE_V`, 30% of cap), so finishing a station's name glides the train onto that platform within ~0.3 s — arrival is synchronized with typing, not seconds behind it. Pause mid-name and the train settles exactly at the distance you've earned.
- **Speed is now honest per segment.** The speedometer reads the derivative of real motion (lightly smoothed for the needle): the same typing pace rides visibly faster across a long gap with a short name (市桥 → 汉溪长隆) than through dense old-town hops — and on such express segments the readout can genuinely exceed the line cap (the needle pegs, the digits tell the truth, TOP SPEED on the result screen included). Hot-streak flames still key off the same per-line redline fractions from v0.2.3.
- **Feel knobs simplified.** `ERR_KEEP` and the 2 s keystroke-rate window are gone (they only fed the old throttle); a typo now brakes the train naturally because credit stops flowing. The knobs are `CRUISE_CPS` (display scale), `CHASE`, and `ARRIVE_V`.

## [0.2.3] - 2026-07-16

### Changed
- **A completed stop is always reached.** The train's throttle used to be pure live typing rate, so finishing a station's name and then pausing (reading the next name, thinking) let the needle sag to zero and the train brake to a halt *just short* of the platform it had already earned — it only rolled through once the next name's letters arrived. Now any earned track ahead of the train keeps it rolling at a coasting floor (`COAST`, ≥32% of the line cap) until it physically passes that stop; the arrival brake curve still eases it into the platform, and fast typing still drives it fast.
- **Fire and bonuses scale with line difficulty.** Each line gets an ease rank from its existing difficulty score (name length + station count — the menu's card order, Line 3 easiest → Line 2 hardest), and three thresholds now ride on it instead of being global constants: the redline that ignites the hot-streak flames (84% of cap on the hardest line down to 70% on the easiest), the combos that grow the fire tiers (×10/×20 hardest down to ×6/×12 easiest), and the per-combo score bonus step (+10% per combo hardest up to +14% easiest, same ×20 cap) so big point pops show up sooner on easy lines. Boss mode keeps the old flat values.

## [0.2.2] - 2026-07-16

### Added
- **Combo-tiered fire.** The hot-streak blaze now grows with the station combo: at ×10 the exhaust flame scales up ~40%, the speed lines brighten, and the gauge's ember glow rises higher; at ×20 the flame is ~85% larger, the speed lines thicken, and the gauge shake quickens. Dropping the combo (a typo) or falling out of the redline clears the tiers with the fire.

### Changed
- **The camera pulls back with speed.** The follow window widens up to ~50% (470 → 700 SVG units) proportionally to current speed, so a full-throttle run visibly opens up the map and braking into a station tightens back in — a cheap but real sense of pace.
- **Feel knobs extracted.** The two physics tuning constants now sit at the top of `js/game.js`: `CRUISE_CPS` (typing rate that sustains the line cap, 5.5) and `ERR_KEEP` (fraction of the rate window kept after a typo, 0.5) — one obvious place for playtest tweaks.

## [0.2.1] - 2026-07-16

### Added
- **Hot-streak fire effects.** Sustained fast, clean typing pushes the needle into the redline (≥84% of the line cap, with hysteresis so it doesn't flicker) and the cab catches fire: the speedometer box glows, vibrates subtly, and an ember gradient flickers up from its base, while the map train grows an animated two-tone exhaust flame plus trailing speed lines. Any typo cuts the rate window in half — the flames die on their own as the needle falls. Everything is suppressed under `prefers-reduced-motion`.
- **Per-letter feedback on the LED board.** Correctly typed letters pop in (brief white flash + scale bounce as they turn green); a wrong keystroke shakes the expected letter and flashes it red, alongside the existing input-field shake.

### Changed
- **The train now moves *while* you type, not per completed name.** Each correct letter buys its share of the segment's real distance ("track credit"), and your live typing rate (2 s window) is the throttle: type fast and the train accelerates toward the line's real cap (~5.5 letters/s sustains it), slow down and it decelerates, stop and it brakes smoothly to a halt at the edge of the distance you've earned — including a natural dwell at a platform if you pause between names. Errors brake the train too. The per-segment travel queue, the express catch-up runs, and the per-station speed formula are gone; once the terminus name is typed the train coasts home at full throttle on its remaining credit. Arrivals (heat rings, toasts, the finish) now fire the moment the train physically passes each station.
- **The speedometer is truly live.** The needle and digital readout follow the physics every frame — accelerating on keystrokes, sagging when you hesitate — instead of replaying a canned per-segment speed curve. TOP SPEED on the result screen now means your real sustained peak.
- **Cleaner gauge face.** The static labels (MAX n km/h, the 0 / cap endpoints, the km/h unit) are gone — just arc, redline, ticks, needle, and the big readout — and the SVG viewBox is cropped to the drawn face so the dial sits vertically centered in its box instead of floating high.
- **HUD breathing room.** The cab cluster starts 62px down (was 44px), clearing the floating ⚙ SETTINGS / ⏏ QUIT pills comfortably.

## [0.2.0] - 2026-07-16

### Added
- **The first stop is played, not skipped.** A run now opens on the origin station (board label 始发站 / ORIGIN): its pinyin is typed like any other stop and earns score, counts toward accuracy/WPM, and gets a real speed color in the progress bar, heat strip, and fastest/slowest stats (the origin cell used to be hard-coded green). The train departs in place — completing the origin closes the doors (车门已关闭 / Doors closed toast) and movement begins with the next stop. The station counter reads over the full count (1/16 … 16/16), the menu's "letters to type" stat is finally truthful, and signed-in uploads report cleared/total over all stations.
- **Segment distance on the board.** The counter row shows how far the next hop is (e.g. `3/16 · 1.7 km`), making the distance-based travel times legible.

### Changed
- **Travel time follows real inter-station distance and typing speed.** Train speed derives from typing pace (up to the line's real top speed — 80 km/h on Lines 1/2, 120 on Line 3) and travel time = √distance ÷ speed, so the 4.3 km 市桥 → 汉溪长隆 gap genuinely rides longer than a 0.9 km old-town hop, while the √ compression keeps the long/short spread around 2× (clamped 0.5–3.6 s). Typing ahead still works: with a backlog queued, segments run express (duration cut up to ~2×, speed boosted toward the cap) so the train catches up and the result screen is never delayed. The speedometer needle and the TOP SPEED result stat now reflect these per-segment speeds.
- **Driver's-cab HUD.** The speedometer and stat chips trade their flat tonal cards for the LED board's hardware look: dark glass gradient, dot-matrix texture, 1px edge, values grown 19px → 27px in the line color with a soft glow (combo stays amber), plus a scale-pop when score or combo change. The gauge grows ~30% (196×125 px) with thicker arcs, a line-colored needle, and a 26px → 33px readout. The light theme falls back to tonal cards exactly like the board does, and `prefers-reduced-motion` disables the pop.

### Fixed
- **HUD no longer hides under the floating pills.** The top chip row used to tuck beneath the fixed ⚙/⏏ pills in the viewport corner (barely noticeable with the old dim 19px values, plainly broken with the new large digits); the HUD now starts below them at every width.

## [0.1.13] - 2026-07-16

### Changed
- **New settings icon.** The top-right settings chip swaps the text glyph ⚙ for a proper stroked gear SVG (inherits the button's text color, so it works in both themes and both button states). The icon lives outside the `data-i18n` span so language switches can't wipe it.
- **Bigger settings-dialog text.** The dialog title grows 20px → 22px and the row labels (SOUND/THEME/LANGUAGE · 音效/主题/语言) 11px → 13px; the buttons are unchanged.

## [0.1.12] - 2026-07-16

### Fixed
- **Amber "on" buttons readable again in the dark theme.** The signed-in account chip and the settings dialog's SOUND toggle set their text to near-black for the amber `.on` state, but later background rules (`#fchips .hbtn`, `.srow .hbtn`) overrode the amber fill back to a dark surface — leaving dark-on-dark, invisible text (only hover restored the amber). The `.on` background now wins in both contexts, in both themes.

## [0.1.11] - 2026-07-16

### Changed
- **Bigger difficulty text, same pill sizes.** The difficulty capsules on the line cards trade their wide letter-spacing for font size (11px/.1em → 13px/.03em; 12px on narrow screens), and Chinese — only two characters per label — goes bigger still (15px). The in-game difficulty chip gets the same treatment (11px/.12em → 12.5px/.06em, 13.5px in Chinese). Pill dimensions are unchanged.
- **IMPOSSIBLE → INSANE.** The boss card's English difficulty label is renamed so all four labels sit comfortably at the larger size (中文 极难 unchanged).

## [0.1.10] - 2026-07-16

### Changed
- **Smaller, cleaner expand arrow on the line cards.** The circled arrow at the right edge of each line card (and the boss card) shrinks from 52px to 40px — the same height as the line-number circle — and the text triangle `▾` is replaced by a round-capped SVG chevron that fills more of the circle. It still takes the line's color and still flips upward when the card opens.

## [0.1.9] - 2026-07-16

### Changed
- **Stronger title-screen scrim.** The theme mask over the scene deepens from 30% to 45% black (dark) and from 34% to 48% white (light), and the tower cutout's equivalent filters follow (`brightness(.55)` dark, `contrast(.35) brightness(1.48)` light), so the rails, trains, and title stand out more against the artwork.

## [0.1.8] - 2026-07-16

### Fixed
- **Title text no longer washed by the theme scrim.** v0.1.7's second full-screen mask (over the tower cutout) sat above the title block, tinting 地铁键速, the subtitle, and the button grey/white depending on theme — and stacked with the first mask it also over-dimmed the background photo. The overlay element is gone; the tower cutout now gets the equivalent dimming via a CSS filter on the image itself (`brightness(.7)` dark ≙ 30% black, `contrast(.49) brightness(1.34)` light ≙ 34% white), so the text sits above every scrim, the tower still reads dimmed and still overlaps the logo for depth, and each layer of the scene is masked exactly once.

## [0.1.7] - 2026-07-16

### Fixed
- **Title-screen rails render whole again.** The six decorative rails could appear cut off mid-run — with the glider "trains" sailing past the visible end of their line — because `vector-effect="non-scaling-stroke"` makes browsers compute dash metrics in screen space while the `pathLength="1"` draw/glide dash tricks assume user space, so the "full-length" dash only covered part of each path at most window sizes. The attribute is gone from all twelve paths; dashing now matches the geometry exactly at any viewport.

### Changed
- **Flat title type.** The 地铁键速 logotype loses its dark drop shadow and per-character amber glow, and METRO TYPING · GUANGZHOU loses its shadow too — clean flat text over the scene (the LED flicker intro is unchanged).
- **Tricolor ribbon removed.** The line-colored bar + interchange dot under the Latin subtitle is gone, along with its intro animations.
- **Theme scrims under the rails.** Two semi-transparent masks — black in the dark theme, white in light — now sandwich the scene (one over the city photo beneath the back rails, one over the tower cutout beneath the front rails), so lines and trains pop against the artwork in both themes. They replace the old center vignette and the dark theme's whole-scene veil, which sat *above* the back rails and dimmed them; light-theme rail opacity is raised slightly now that the scrim guarantees contrast.

## [0.1.6] - 2026-07-16

### Changed
- **Renamed to 地铁键速.** The game drops the 一键到底 name everywhere — browser tab, opening page, README. The opening page shows the new name as a fixed bilingual logotype (big 地铁键速 with METRO TYPING · GUANGZHOU beneath) that no longer swaps with the language toggle, and its button becomes 选择关卡 / SELECT LEVEL.
- **Fullscreen title screen.** The opening page now fills the whole viewport like a game title screen: the new Canton Tower city scene (`assets/guangzhou-tower-v2.jpg`) as the backdrop with an aligned tower-only alpha cutout (`…-tower-only.png`) layered *in front of* the logo for depth, a radial scrim for text contrast, a bottom fade into the page background, and a darker veil in the dark theme. The hero copy paragraph is gone.
- **Orthogonal rails.** The six decorative line-colored curves are redrawn metro-map style — straight horizontal/vertical runs with rounded 90° turns (four behind the tower, two in front). Their SVGs switch from `preserveAspectRatio="none"` to `xMidYMid slice` so corners stay perfectly round at any window size; the draw-in and gliding-light animations remain.
- **Top nav bar removed on every screen.** 登录 and ⚙ 设置 float as frosted pills in the top-right corner (⏏ 退出 joins them during a run, replacing the old header quit button); the game screen now uses the full viewport height. Language, theme, and sound live in a new settings dialog (`#setDlg`) that reuses the account-dialog styling — the buttons keep their old ids, so cloud preference sync is untouched.

### Added
- **Boot intro (~3 s, once per page load).** Platform screen doors slide apart → the rails draw themselves in → a small metro train glides across behind the logo → the four characters flicker on like the LED departure board, finished by a line-colored ribbon and a pulsing interchange dot, then the button and scroll cue fade in. Any click or keypress fast-forwards to the final state, `prefers-reduced-motion` renders it static immediately, and returning to the menu from a run never replays it (the animations are gated by a `.intro` class the JS removes once).

### Fixed
- **Opening page stuck behind the top edge after 开始游戏 → ↑ TOP.** `#menu`'s `overflow:hidden` made it a programmatically scrollable container (a decorative blob overflows it by 80px), so the start button's `scrollIntoView` scrolled `#menu` itself by 80px; scrolling back only reset the window and the hero stayed clipped. `#menu`/`#result` now use `overflow:clip`, which forbids inner scrolling entirely.

## [0.1.5] - 2026-07-16

### Added
- **Rounded open-source typefaces.** The whole UI switches from system fonts to a self-hosted rounded trio (all SIL OFL 1.1, subset to ~1.2 MB total): [资源圆体 Resource Han Rounded](https://github.com/CyanoHao/Resource-Han-Rounded) for Chinese (Regular + Bold, subset to every string the game renders plus the 3,500 common 通用规范汉字 so leaderboard nicknames render rounded too), [Nunito](https://github.com/googlefonts/nunito) (variable) for Latin, and [Sono](https://fonts.google.com/specimen/Sono) (variable, MONO axis pinned) replacing the sharp system monospace everywhere — LED board pinyin, HUD chips, gauge, and leaderboard.
- Dev-only `tools/subset-fonts.js` (Node + pyftsubset) regenerates the woff2 subsets in `assets/fonts/` from full source fonts; `tools/hanzi-3500.txt` holds the common-character list. OFL license texts ship alongside the fonts; README gains a typeface attribution note.
- The two Chinese font files are preloaded from `index.html` to minimize FOUT on the hero; everything falls back gracefully to the previous system stacks offline or from `file://` before fonts load.

## [0.1.4] - 2026-07-16

### Changed
- **Solid difficulty capsules.** The line cards' difficulty capsules drop the outlined/tonal look for a solid fill in the difficulty color (dark ink text in the dark theme, white in light), and grow to 40px tall — flush with the line-number badge.
- The expand chevron's outlined circle grows from 40px to 52px with a larger, optically centered ▾ glyph.
- **Station names on demand.** The overview map no longer shows station-name labels by default or on legend hover — a line's 汉字/pinyin labels fade in only while that line is focused, via its expanded card or a legend click-to-pin, keeping the resting map (and the other lines during focus) clean.
- Interchange stations read more clearly: their dots grow from r=8 to r=10 (heat rings 12 → 14) on both the overview and game maps, versus r=5.5 regular stops.

## [0.1.3] - 2026-07-16

### Added
- **Difficulty capsules.** The line cards' amber star rows are replaced by equal-width colored capsules — 简单/EASY (green), 中等/MEDIUM (amber), 困难/HARD (new orange token `--hard`), and 极难/IMPOSSIBLE (red) on the boss card — echoing the in-game difficulty-tag style (colored border + tonal fill, per-theme colors).
- **Wiki-sourced line descriptions.** Each line's one-line fact is now a 2–3 sentence bilingual description stored as `desc:{zh,en}` in `js/data.js` (facts from the zh/en Wikipedia articles): opening dates, network role, landmarks, and records (L1 first line/1997, L2 first with platform screen doors/2010 re-alignment, L3 first 120 km/h Y-shaped line).
- **Stat tiles.** The expanded card's mono meta line becomes three tonal tiles tinted in the line's color — 线路全长 ≈km / 拼音总量 total letters (new derived `L.letters`) / 平均每站 avg letters per stop; the boss card shows words to clear / longest name / lives.

### Changed
- The expand chevron is now a 40px outlined circle in the line's color (same size as the line-number badge), still rotating 180° on expand.
- Card hover tint uses each card's line color instead of the global amber, and the termini text ("西塱 → 广州东站") gains line-colored endpoint dots.
- The ⇄换向 reverse button grows into a proper button (flex share of the row, larger padding) with more breathing space between the action buttons.

### Removed
- **Station-name preview chips.** The expanded line/boss cards no longer list every station's 汉字 + pinyin — players shouldn't be able to memorize the run before departing. (The route still shows termini and stop count.)

## [0.1.2] - 2026-07-16

### Added
- **Legend click-to-pin.** Clicking a legend pill pins its line — the overview map highlights and zooms to it (reusing the card zoom) until the pill is clicked again or a line card is opened. Pills are now real buttons: `role="button"`, `aria-pressed`, Enter/Space support, and an amber-tinted pinned state; the pin survives language switches.

### Changed
- **Sticky legend highlight.** Moving the pointer between legend pills no longer flickers the map back to the full network mid-move — the last hovered line stays highlighted until the pointer reaches the next pill or leaves the legend area (then it reverts to the pinned or expanded line, or the full network).
- Each legend pill's interactive area is invisibly enlarged (≈5–6px on every side), bridging the gaps between pills.
- The legend hides while any line/boss card is expanded, giving the zoomed map the full card width; it returns when the card collapses.

## [0.1.1] - 2026-07-15

### Added
- **Opening page.** The menu now begins with a full-viewport start screen: the hero copy on the left, the Canton Tower (`assets/guangzhou-tower.png`, downscaled to 800px with a bottom fade-out mask) on the right, and six curved "metro lines" in the official Line 1–6 colors weaving across the page — four behind the tower, two in front. Each curve draws itself in on load, then a small light pulse keeps gliding along it; everything renders static under `prefers-reduced-motion`.
- **开始游戏 / START GAME** button on the opening page smooth-scrolls down to the map + line-selection area (a bouncing chevron at the bottom hints at the scroll).
- **↑ 首页 / TOP** floating pill (bottom right) fades in once the opening page scrolls out of view and smooth-scrolls back to the top; it hides automatically during play.
- `--l4`/`--l5`/`--l6` color tokens (Lines 4–6 official palette), used by the decorative curves only.

### Changed
- Returning to the menu from a run (⏏ 退出 or 选择线路) now lands directly on the line-selection area instead of the opening page.
- Hero title/copy sizes bumped to opening-page scale.

## [0.1.0] - 2026-07-15

### Changed
- **Rebrand: 拼音快线 · Guangzhou Metro Pinyin Express is now 一键到底 · Metro Typing · Guangzhou.** The old name framed the game as a pinyin drill; 一键到底 puns on riding the line all the way to the end, one keystroke at a time — matching what the game is actually about: fun, typing speed, and discovering Guangzhou.
- New couplet-style hero copy in both languages (中文「指尖出发，一键到底」——每敲对一个站名，列车就前进一站 / English "Ready for metro typing!"), new page title, and header brand.
- The footnote now says "typing game" (打字游戏) instead of "typing practice" (打字练习游戏); README and docs updated to the new positioning.

### Removed
- The hero eyebrow line ("TYPE · RIDE · MASTER PINYIN") and its stylesheet rule.

## [0.0.9] - 2026-07-15

### Added
- **Accordion line cards.** The menu cards are now a single-column stack of slim, full-width rows showing only the essentials: difficulty stars, line-number badge, line name, termini, and stop count. Clicking a card expands it in place (one at a time) to reveal the line's description, ≈km and average letters per stop, your session best, a preview strip of every station as 汉字 + pinyin chips (in travel direction), and the ⇄换向 / 出发 buttons. The boss card follows the same pattern with its word list.
- **Map zoom-to-line.** Expanding a card animates the overview map's viewBox to that line's bounding box and dims the other lines; collapsing zooms back out to the whole network (instant under `prefers-reduced-motion`). Clicking a line on the map now opens its card. The open card — and the zoom — survive language switches and returning from a run.
- Automatic per-color button text: elements painted in a line's color (出发 buttons, line badges, leaderboard tabs, the LED board's line chip) now pick black or white text by the color's luminance — Line 2's dark blue gets white text (6.5:1) instead of the old near-black (2.9:1, a WCAG failure).

### Changed
- Whole-app type-scale and spacing pass: bigger fonts and more breathing room on the menu (hero, legend, cards, leaderboard, footnote) with a modest bump for the in-game HUD, LED board, input, and result screen.
- The left color bar and the "LEVEL N" labels are gone from the cards; difficulty reads from the stars alone.
- The header wraps on narrow screens instead of overflowing horizontally.

### Fixed
- WCAG AA (≥4.5:1) contrast across both themes, verified programmatically: secondary text (`--dim` both themes, light `--mut`), amber used as text (new `--amber-tx` token — eyebrow, stars, combo chip, top-3 ranks, countdown, active pinyin letter), light-theme `--good`/`--mid`/`--bad` (session best, difficulty tags on the light LED board, boss accents), and the focus outline.

## [0.0.8] - 2026-07-14

### Added
- **Optional player accounts** (Supabase, free tier): a new header button opens a sign in / sign up dialog (email + password, no confirmation email needed; nickname shown on the leaderboard). Signing up requires an **invite code**, validated and consumed server-side, so registrations stay throttled to people you invited. Signed-out play is unchanged and still works fully offline / from `file://`.
- **Global leaderboard** on the menu — top-10 best scores per mode (Line 1 / 2 / 3 / Gauntlet), visible to everyone, with your own row highlighted when signed in.
- **Score upload**: finished runs of signed-in players upload automatically; the result screen shows your worldwide rank.
- **Badges**: ten achievements (first ride, each line cleared, triple star, gauntlet clear, 60/100 WPM, 20× combo, 100% accuracy) awarded on the result screen and collected in the account dialog.
- **Settings sync**: language and theme preferences save to your account and apply on any device you sign in from.
- `js/cloud.js` — a zero-dependency cloud layer (plain `fetch` against Supabase's auth/REST HTTP APIs; no SDK, no build step) that degrades gracefully whenever the network or backend is unavailable.
- `supabase/setup.sql` — the backend schema: tables, row-level security (users can only write their own rows; score sanity caps as cheap anti-cheat), and the best-score-per-player leaderboard view.

### Changed
- The menu footnote now says: signed out, scores remain session-only; signed in, they upload to the leaderboard.
- `localStorage` additionally stores the Supabase session (`sb_session`) beside the existing `lang`/`theme` preferences.

## [0.0.7] - 2026-07-14

### Added
- `js/geo.js`: real geographic data for the **whole 2026 Guangzhou Metro network** — all 19 numbered lines plus the Guangfo Line and APM (367 stations with 汉字/English names and coordinates, plus each line's official color), generated from OpenStreetMap via the new dev script `tools/fetch-geo.js` (re-run it to refresh; it fail-hards if any playable station is missing). Only Lines 1/2/3 are rendered so far; the rest of the data is ready for future lines.
- OpenStreetMap ODbL attribution in the menu footnote and README.

### Changed
- Both maps now draw the **real geography** of Lines 1/2/3: station positions are projected from latitude/longitude (equirectangular), so Line 1 hooks north to 广州东站, Line 2 bends around 洛溪 island, and Line 3 runs its long Panyu diagonal. Line paths get smoothed rounded corners at bends; the Pearl River decoration was redrawn to match the projected geography.
- Line colors switched to the official palette: Line 1 `#F3D03E`, Line 2 `#00629B`, Line 3 `#ECA154` (previously approximate hues for 2/3).
- The map legend is now a vertical column beside the overview map (wrapping back below it on narrow screens), and hovering or focusing a legend entry highlights that line while dimming the others.
- Station labels re-placed for the geographic layout (new upper-right/below-right label positions).

## [0.0.6] - 2026-07-14

### Added
- Language toggle (中文 / English) in the header. The whole interface now renders in a single language instead of the doubled-up bilingual labels; the default follows the browser language (`zh*` → 中文, otherwise English). Station names, pinyin, and map labels are gameplay content and stay 汉字 + pinyin in both languages. Line facts reuse the existing "中文 · English" strings in `js/data.js`, split per language.
- The language choice — and a manually toggled theme — now persist across visits in `localStorage`. Scores remain session-only as promised.

### Removed
- The three how-to cards on the menu (① 选择线路 / ② 输入拼音 / ③ 列车前进) — they added no useful information.

## [0.0.5] - 2026-07-14

### Changed
- Light theme is now neutral cool-white instead of warm golden-cream: backgrounds, panels, edges, header/map/boss gradients, shadows, and map furniture all moved to a faint navy-gray white family (never pure white). The amber accent, line colors, and the entire dark theme are unchanged.
- In light mode the HUD cards (speedometer box and TIME/DIST/WPM/ACC/COMBO/SCORE chips) are now near-white: the per-line `--tint` mixes the line color into `--panel` instead of the darker `--panel2`.
- The LED destination board is now a light tonal card in light mode (light gradient, dark-on-light dot matrix, light filled input, no text glows); it keeps its dark hardware look in the dark theme.

## [0.0.4] - 2026-07-14

### Changed
- UI restyled on the Material Design 3 (Material You) system, adapted to the game's metro theme: amber-gold seed over navy tonal surfaces (dark) and warm cream surfaces (light) — never pure white/black. Tokens for shape (`--r-*`), motion (`--ease`, MD3 emphasized-decelerate), and elevation (`--sh1..3`) now live in `css/style.css`.
- All buttons are pill-shaped with press feedback (`active` scale); hover uses MD3 state layers (`color-mix` overlays) instead of color/border shifts; cards and panels use larger organic radii (16–32px) and tonal separation instead of 1px borders.
- Material You "dynamic color": during a run, the chosen line's color subtly tints the HUD chips and speedometer container via `--tint`.
- The pinyin input is now an MD3 filled text field (rounded top, 2px bottom border that lights up in the line color on focus).
- The LED destination board keeps its dark hardware identity (dot matrix, glow, sheen) in **both** themes — in light mode it now stays dark like a real metro display.
- Decorative blurred color blobs (line colors + amber) behind the menu and result screens; the game screen stays clean.
- Softer type: heavy 800 weights reduced to 700 outside the brand and LED board.

## [0.0.3] - 2026-07-14

### Added
- Light theme. The page now follows the system color scheme on load (`prefers-color-scheme`) and a new theme button in the header (深色 DARK / 浅色 LIGHT) toggles it; the choice is session-only, consistent with the no-persistence principle. All surfaces are themed — menu, network map, game map, speedometer, LED board, boss stage, and result card — with line colors darkened via `color-mix` where they appear as text on light backgrounds.

### Changed
- Header sound button: emoji icon removed; the on/off state now shows as a solid (filled) vs. outline button, labeled 音效 SOUND / 静音 MUTED.

## [0.0.2] - 2026-07-14

### Changed
- Split the single-file game into `index.html` (markup), `css/style.css`, `js/data.js` (station data), and `js/game.js` (engine) — still no build step, still works offline via `file://`.

### Added
- Version number (`APP_VERSION`) displayed in the menu footnote so deployed pages identify their release.
- This changelog, `.editorconfig`, and shared VS Code workspace settings (Live Server recommendation).
- Versioning workflow documented in `CLAUDE.md`: bump → changelog → commit → tag → push → GitHub Release.

## [0.0.1] - 2026-07-14

### Added
- Initial complete game in a single `index.html`: Guangzhou Metro Lines 1/2/3 with schematic SVG map, pinyin typing to drive the train, speedometer/WPM/accuracy/combo HUD, difficulty levels by station-name length, color-coded progress, and the Long-Name Gauntlet boss mode.
- README, MIT license, `.gitignore`, `CLAUDE.md`.

[0.4.7]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.10...v0.4.0
[0.3.10]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.14...v0.3.0
[0.2.14]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.13...v0.2.0
[0.1.13]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.9...v0.1.0
[0.0.9]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/releases/tag/v0.0.1
