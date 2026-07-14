# Changelog

All notable changes to 拼音快线 · Guangzhou Metro Pinyin Express are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (0.x while in development).

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

[0.0.4]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/releases/tag/v0.0.1
