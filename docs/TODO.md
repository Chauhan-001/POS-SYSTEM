# TODO — Fix Electron Window Cropped at Bottom

## Root Cause
`window.innerHeight` (768px) > `screen.height` (720px). The window is created/maximized larger than the physical visible screen, so the bottom content is clipped.

## Steps
- [x] Diagnose issue (window size 768px vs screen 720px)
- [x] Edit `restaurant-pos/electron/main.ts`:
  - [x] In `createWindow()`: fetch primary display once; clamp width/height to `display.bounds`; pass `x`/`y` from `display.workArea` so the window sits inside the visible region
  - [x] In `ready-to-show`: after `maximize()`, add safety-clamp — if window bounds exceed display bounds, `setBounds()` to the clamped size before `show()`
- [x] Recompile Electron main process (`npx tsc -p electron/tsconfig.json`) — compiled `main.js` verified to contain the clamping logic
