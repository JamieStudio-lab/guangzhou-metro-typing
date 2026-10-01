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

One Chrome at a time, closed after each suite (`try … finally browser.close()`); runaway Chromes have crashed the machine before. Fractional dpr: judge only with a real `--force-device-scale-factor`, never `deviceScaleFactor` emulation (it softens pixel edges no real device shows).

## Driving

- Quitting a run (`#homeBtn`, or Esc) — **since v0.4.6 there is no `confirm()`**, so no `page.on('dialog')` handler is needed. It opens an in-game modal `<dialog id="quitDlg">` and pauses the run (`S.paused=true` freezes train/timer/boss countdown). To reach the menu: click `#homeBtn` → `#quitGoBtn` (退出). To resume: `#quitStayBtn` (继续游戏) / backdrop / Esc — the close handler shifts `S.t0`/`S.firstT`/`S.deadline` forward so the pause is free.
- Game globals are top-level `const` in classic scripts — still reachable from `page.evaluate` (e.g. `S.key` = current station's toneless pinyin).
- Headless boots in zh (default since v0.4.0): assert against `T[LANG]`, not hard-coded strings.
- World screen (v0.7.0, `mockups/pixel-world/SPEC.md`): `page.click('#startBtn')` folds the hero (`#menu.pk`) and shows `#pick`, one fixed full screen (no page scroll). State is top-level `let`s: `wSel` (a line id or `"boss"`, always set), `wOpen` (card shown), `wMapOn` (map frames `wSel`).
- Start a run: `page.click('#path .pw-node[data-id="l3"]')` picks + opens the level card `#card` (clicking the picked node again closes it), then `page.click('#card [data-act=go]')`; reverse first with `[data-act=rev]` (`aria-pressed`). Card closed: `#stub` opens it. Keyboard (window, capture; only with the hero folded, no dialog open, not in a field): ←/→ pick (wrapping, `boss` last), Home/End, Enter opens then starts, R reverses, Esc closes the card, then zooms home. Boss: `.pw-node[data-id="boss"]` → `[data-act=go]`. START plays `#goFx` over the ride's preparation (it hides once the ride is ready).
- Map picks: wait for the pixel map `await page.waitForFunction(() => typeof ovLive === 'function' && ovLive())` (the menu set loads after `load` + idle, or at once on `#startBtn` / a chip click), then `await page.evaluate(() => OVM.idle())`. A station's CSS px: `OVM.project(...MAPOV.lines.l3.pts[MAPOV.lines.l3.st[5]])` + `#ovHost`'s rect → `page.mouse.click` picks + opens that line; the map's START sign (`OVM.hit(x, y).cursor`) starts the open card's line.
- World checks: `#pick` has `pl-side` at 1440×900 and `pl-bottom` at 390×844 (the Auto rule); `OVM.audit()` → `{stray:0}` at rest, zoomed (`OVM.zoomAt(1)`), card open and while trains run (`OVM.trains()` = `'lively'`, `OVM.stats().trains` > 0, `.life.frames` growing; `.lifeJs` = `'in'`); `OVM.state().focus` = `wSel` whether map, dock or keys picked it; `#hudTitle` names the hovered / picked line. Reduced motion (`reducedMotion:'reduce'`): `.life.frames` stays put, no `.wipe`. The SVG `#ovMap` stays the fallback: route `**/ovmap.js` to abort → `#ovMap` visible, dock picks still work, no errors.
- End of a pixel ride: after the last station the whole-line view holds ≈ 3 s (`RIDE.recapMs()`); any key skips to `#result`. `RIDE.audit()` must stay 0 during the dissolve.
- Type a station: `await page.type('#pyin', await page.evaluate(() => S.key))`. Loop until `#result` unhides (~10 s for a full line; travels are queued, wait ≤60 s).
- Dialogs are `.pk-dlg` `<dialog>`s: `#setBtn` → `#setDlg` (close `#setClose` / Esc), `#accBtn` → `#accDlg` (never sign in or register from a test), `#lbBtn` → `#lbDlg` (tabs `#lbTabs .lbtab`, opened on `wSel`; its one live request is the read-only leaderboard GET — route `**/rest/v1/**` to abort for an offline `lbErr`), `#aboutBtn` → `#aboutDlg` (close `#aboutClose`). The chips hide off the menu (`#homeBtn` shows in a run).
- After a finished run, `#rBack` returns to the world with the ridden line picked (card closed): `bests[key].stars` ≥ 1, that node's `.pw-st svg:not(.e)` count and `#prog` (★ n/19) follow.
- Checks that catch regressions: `#aboutVer` = `v<APP_VERSION>`; `#py .c.done` count after partial typing; `.chip` background is line-tinted (near-white in light theme since v0.0.5); `#board` is a light tonal card in light theme (light gradient, dark text, `#zhTxt` glow off) but keeps the dark gradient + glow in dark theme.
- Chrome may report computed colors as `color(srgb 0.99 0.98 0.95)` floats, not `rgb(…)` — parse both when asserting luminance.

## Flows worth driving

World screen (dark+light, 1440×900 and 390×844 with `isMobile`/`hasTouch`; screenshots after `OVM.idle()`, at rest and with a card open) → leaderboard / About dialogs → `node tools/px/check-kit.js` → START from the card → run with a wrong-input probe (`zzz` → cleared, combo reset) → full line to result → light-theme run (light LED board, dark-theme board unchanged) → boss mode (countdown ring visible) → 390px mobile viewport.
