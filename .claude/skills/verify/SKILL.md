---
name: verify
description: Drive the typing game headlessly in Chrome to verify UI/gameplay changes end-to-end (menu, typing, themes, boss, result).
---

# Verify: drive the game in headless Chrome

Static page, no build. Surface = the browser at `file://<repo>/index.html` (file:// support is a hard requirement — always test it, no server needed).

## Handle

Playwright package is not installed globally; browsers are cached. Recipe that works:

```bash
cd <scratchpad> && npm i playwright-core --silent
```

```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true });
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, colorScheme:'dark' }); // or 'light', reducedMotion:'reduce'
```

## Driving

- `page.on('dialog', d => d.accept())` — **required**: quitting a run (`#homeBtn`) fires `confirm()`; without a handler Playwright cancels it and you never get back to the menu.
- Game globals are top-level `const` in classic scripts — still reachable from `page.evaluate` (e.g. `S.key` = current station's toneless pinyin).
- Start a run: `page.click('.card .go')` (cards are difficulty-ordered: first = Line 3). Boss: `.card.boss .go`.
- Type a station: `await page.type('#pyin', await page.evaluate(() => S.key))`. Loop until `#result` unhides (~10 s for a full line; travels are queued, wait ≤60 s).
- Checks that catch regressions: `#menu .footnote` contains `v<APP_VERSION>`; `#py .c.done` count after partial typing; `.chip` background is line-tinted (near-white in light theme since v0.0.5); `#board` is a light tonal card in light theme (light gradient, dark text, `#zhTxt` glow off) but keeps the dark gradient + glow in dark theme.
- Chrome may report computed colors as `color(srgb 0.99 0.98 0.95)` floats, not `rgb(…)` — parse both when asserting luminance.

## Flows worth driving

Menu (dark+light, fullPage screenshot) → run with a wrong-input probe (`zzz` → cleared, combo reset) → full line to result → light-theme run (light LED board, dark-theme board unchanged) → boss mode (countdown ring visible) → 390px mobile viewport.
