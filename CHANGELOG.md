# Changelog

All notable changes to 拼音快线 · Guangzhou Metro Pinyin Express are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (0.x while in development).

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

[0.0.3]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/JamieStudio-lab/guangzhou-metro-typing/releases/tag/v0.0.1
