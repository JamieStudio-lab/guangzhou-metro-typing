# Changelog

All notable changes to 地铁键速 · Metro Typing · Guangzhou (一键到底 before v0.1.6, 拼音快线 · Guangzhou Metro Pinyin Express before v0.1.0) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (0.x while in development).

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
