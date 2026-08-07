# ELECTRON.md — Electron Main Process & IPC Blueprint

## Overview

The Desktop POS shell is built with Electron. It isolates native system capabilities while exposing a secure IPC API interface to the React renderer.

---

## 1. Process Security Configuration

```typescript
const mainWindow = new BrowserWindow({
  minWidth: 1024,
  minHeight: 768,
  backgroundColor: '#faf8ff',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,   // Security constraint: isolates renderer
    nodeIntegration: false,   // Security constraint: no raw Node access in browser context
    sandbox: true,            // Preload sandboxing
  },
});
```

---

## 2. IPC Communication Map

| Channel Name | Direction | Payload / Parameters | Purpose |
| :--- | :--- | :--- | :--- |
| `window:resize` | Main -> Renderer | `{ width, height }` | Notifies React layout of window content size updates |
| `window:reload` | Renderer -> Main | None | Reloads POS terminal window |
| `window:toggleFullScreen` | Renderer -> Main | None | Toggles full-screen window state |
| `window:toggleFrame` | Renderer -> Main | None | Toggles frameless kiosk mode |
| `app:getVersion` | Renderer -> Main | None | Returns current application version string |
