# ELECTRON.md — Electron Shells & IPC Channels

The monorepo contains **two** Electron shells:

1. **POS shell** — `restaurant-pos/electron/` (`main.ts`, `preload.ts`)
2. **Admin shell** — `admin-dashboard/electron/` (`main.ts`, `preload.ts`)

Both follow the same security posture:
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, with a
CSP injected for `file://` loads. Native capabilities are exposed only
through `contextBridge` IPC.

---

## 1. POS Shell (`restaurant-pos/electron/`)

### Security Configuration

```typescript
const mainWindow = new BrowserWindow({
  minWidth: 1024,
  minHeight: 768,
  backgroundColor: '#faf8ff',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,   // isolate renderer
    nodeIntegration: false,   // no raw Node in the browser context
    sandbox: true,            // preload sandboxing
  },
});
```

### IPC Channels (from `preload.ts`)

| Channel | Direction | Purpose |
|---|---|---|
| `window:reload` | Renderer → Main | Reload the POS window |
| `window:toggleFullScreen` | Renderer → Main | Toggle fullscreen |
| `window:toggleFrame` | Renderer → Main | Toggle frameless kiosk |
| `window:getFrameState` | Renderer → Main | Read current frame state |
| `window:getZoomInfo` | Renderer → Main | Read zoom level |
| `app:getVersion` | Renderer → Main | App version string |
| `app:getEnvironment` | Renderer → Main | Environment (dev/prod) |
| `printer:list` | Renderer → Main | List thermal printers |
| `printer:print` | Renderer → Main | Print a receipt/KOT payload |
| `dialog:saveFile` | Renderer → Main | Save file dialog |

---

## 2. Admin Shell (`admin-dashboard/electron/`)

| Channel | Direction | Purpose |
|---|---|---|
| `get-app-info` | Renderer → Main | App name/version |
| `get-env` | Renderer → Main | Environment info |
| `open-file-dialog` | Renderer → Main | Pick a file |
| `save-file-dialog` | Renderer → Main | Save file |
| `print` | Renderer → Main | Print |
| `show-notification` | Renderer → Main | OS notification |
| `check-for-updates` | Renderer → Main | Auto-update check |
| `quit-and-install` | Renderer → Main | Apply update + quit |

---

## 3. Build & Packaging

- POS: `electron-builder` config at
  `restaurant-pos/electron/electron-builder.json`; build via
  `npm run build` in `restaurant-pos/` (esbuild bundles `main.ts` →
  `main.js`, `preload.ts` → `preload.js`).
- Admin: `esbuild` bundles in `admin-dashboard/electron/`; packaging via
  `electron-builder --config electron-builder.json` (`package:win`,
  `package:mac`, `package:linux`).

See [ARCHITECTURE.md](ARCHITECTURE.md) §11 for the data-flow context.
