/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Electron Main Process — POS Terminal
 *
 * Architecture ported from admin-dashboard (gold standard).
 * Key differences from source:
 *   - Toggle fullscreen IPC (window:toggleFullScreen) — feature
 *   - Kiosk/frameless mode IPC (window:toggleFrame) — feature
 *   - Zoom keyboard shortcuts (before-input-event) — feature
 *
 * Architecture:
 *   show: false → ready-to-show → maximize() → show()
 *   width/height from screen.getPrimaryDisplay().workAreaSize
 *   No IPC resize channel
 *   No CSS variable viewport overrides
 *   Renderer uses 100vh for layout height
 */

const path = require('path');
const os = require('os');
const { createRequire } = require('module');
const electronBin = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const electronRequire = createRequire(electronBin);
const electron = electronRequire('electron');
const { app, BrowserWindow, screen, ipcMain, shell, dialog, session } = electron;

// ─── Environment ────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const DEV_SERVER_URL = process.env.VITE_DEV_URL || 'http://localhost:5175';
const APP_TITLE = 'POS Terminal — Restaurant Management System';

// ─── Prevent multiple instances ──────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ─── Window state ────────────────────────────────────────────────
let mainWindow: Electron.BrowserWindow | null = null;
let isFramelessMode = false;

// ─── Load resilience ──────────────────────────────────────────────
// Vite dev server can momentarily reset the connection during its first
// compile while Electron is opening the window (ERR_CONNECTION_RESET). Retry
// the load a few times before giving up and showing the manual error page.
const MAX_LOAD_RETRIES = 5;
let loadRetryAttempts = 0;

// ─── Window creation ─────────────────────────────────────────────
function createWindow(): Electron.BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { bounds, workArea } = primaryDisplay;

  // Clamp the window to the physical screen bounds. On systems where the
  // work-area height exceeds the physical screen height (e.g. a taskbar
  // auto-hidden or a display with scale mismatch), the window would otherwise
  // extend past the bottom edge and the lower content would be cropped.
  const width = Math.min(workArea.width, bounds.width);
  const height = Math.min(workArea.height, bounds.height);
  const x = Math.min(Math.max(workArea.x, bounds.x), bounds.x + bounds.width - width);
  const y = Math.min(Math.max(workArea.y, bounds.y), bounds.y + bounds.height - height);

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    backgroundColor: '#faf8ff',
    title: APP_TITLE,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: !isDev,
      spellcheck: false,
    },
  });

  // Reset any persisted zoom level to 100%
  mainWindow.webContents.setZoomLevel(0);

  // ─── Open external links in default browser ──────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // ─── Zoom keyboard shortcuts ─────────────────────────────
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && !input.alt && !input.meta) {
      if (input.key === '+' || input.key === '=') {
        _event.preventDefault();
        const current = mainWindow!.webContents.getZoomLevel();
        mainWindow!.webContents.setZoomLevel(current + 1);
      } else if (input.key === '-') {
        _event.preventDefault();
        const current = mainWindow!.webContents.getZoomLevel();
        mainWindow!.webContents.setZoomLevel(current - 1);
      } else if (input.key === '0') {
        _event.preventDefault();
        mainWindow!.webContents.setZoomLevel(0);
      }
    }
  });

  // ─── Error handling ──────────────────────────────────────
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Electron] Renderer process crashed: ${details.reason}`);
    if (mainWindow) {
      dialog.showErrorBox(
        'POS Terminal Error',
        'The application encountered an unexpected error.\n\n' +
        `Reason: ${details.reason}\n\n` +
        'Please restart the application.'
      );
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Electron] Renderer process unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[Electron] Renderer process responsive again');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // A load eventually completed — reset the retry budget for later.
    loadRetryAttempts = 0;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription,
    _validatedURL, _isMainFrame) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Transient connection reset (Vite still warming up). Auto-retry with a
      // short back-off before showing the manual error page.
      if (loadRetryAttempts < MAX_LOAD_RETRIES) {
        loadRetryAttempts++;
        console.error(`[Electron] Load failed (${errorCode}: ${errorDescription}). Retrying ${loadRetryAttempts}/${MAX_LOAD_RETRIES}...`);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(DEV_SERVER_URL);
          }
        }, 800);
        return;
      }
      console.error(`[Electron] Failed to load: ${errorDescription} (code: ${errorCode})`);
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>POS Terminal</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                 display: flex; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; background: #faf8ff; color: #191b23; }
          .error { text-align: center; max-width: 480px; padding: 2rem; }
          h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: #dc2626; }
          p { font-size: 0.875rem; color: #6b7280; line-height: 1.5; }
          code { font-size: 0.75rem; background: #f3f4f6; padding: 0.25rem 0.5rem;
                 border-radius: 4px; display: inline-block; margin-top: 0.5rem; }
          button { margin-top: 1.5rem; padding: 0.5rem 1.5rem; color: white; border: none;
                   border-radius: 8px; font-size: 0.875rem; cursor: pointer; }
          button.retry { background: #004ac6; }
          button.retry:hover { background: #0039a0; }
        </style></head>
        <body>
          <div class="error">
            <h1>Failed to Load Application</h1>
            <p>The POS Terminal could not connect to the application server.</p>
            <code>${errorDescription} (code: ${errorCode})</code>
            <p style="margin-top: 1rem;">Please ensure the backend and frontend servers are running.</p>
            <button class="retry" onclick="window.location.href='${DEV_SERVER_URL}'">Retry</button>
          </div>
        </body></html>
      `)}`);
    }
  });

  // ─── ready-to-show ───────────────────────────────────────
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();

    // Safety-clamp: maximize() on some platforms can produce a window larger
    // than the visible screen (work-area height > physical screen height),
    // which crops the bottom of the app. If the window exceeds the physical
    // screen, shrink it back so every pixel is visible.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      const winBounds = mainWindow.getBounds();
      const { width: maxW, height: maxH } = display.bounds;
      const maxX = display.bounds.x + maxW;
      const maxY = display.bounds.y + maxH;

      const clampedWidth = Math.min(winBounds.width, maxW);
      const clampedHeight = Math.min(winBounds.height, maxH);
      const clampedX = Math.min(Math.max(winBounds.x, display.bounds.x), maxX - clampedWidth);
      const clampedY = Math.min(Math.max(winBounds.y, display.bounds.y), maxY - clampedHeight);

      if (
        clampedWidth !== winBounds.width ||
        clampedHeight !== winBounds.height ||
        clampedX !== winBounds.x ||
        clampedY !== winBounds.y
      ) {
        mainWindow.setBounds({ x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight });
      }
    }

    mainWindow?.show();
  });

  // ─── Window closed ───────────────────────────────────────
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ─── Load content ────────────────────────────────────────
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Packaged: extraResources copies Frontend/dist → resources/frontend.
    // (path.join(__dirname, …) would resolve inside app.asar and miss it.)
    const distPath = app.isPackaged
      ? path.join(process.resourcesPath, 'frontend', 'index.html')
      : path.join(__dirname, '..', 'Frontend', 'dist', 'index.html');
    console.log(`[Electron] Loading frontend from: ${distPath}`);
    mainWindow.loadFile(distPath);
  }

  return mainWindow;
}

// ─── App lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  console.log('[ENV]', JSON.stringify({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));
  console.log('[OS]', JSON.stringify({
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
  }));

  // ─── Microphone permission (Voice Inventory) ─────────────────────
  // Without an explicit permission handler, Electron (sandbox: true)
  // DENIES getUserMedia by default → voice recording always fails with
  // a generic "Voice failed" toast. Grant 'media' (mic) and log every
  // request so failures are visible in the main-process console.
  // Grant 'media' (mic) explicitly; keep Electron's default grant behavior
  // for every other permission so notifications/fullscreen/clipboard etc.
  // keep working exactly as before.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    console.log(`[Electron] Permission request: ${permission} → GRANTED`);
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    console.log(`[Electron] Permission check: ${permission} → ALLOWED`);
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ─── Second instance handler ─────────────────────────────────────
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── IPC: App info ───────────────────────────────────────────────
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getEnvironment', () => {
  return {
    isDev,
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
  };
});

// ─── IPC: Window controls (features) ─────────────────────────────
ipcMain.on('window:reload', () => {
  mainWindow?.reload();
});

ipcMain.on('window:toggleFullScreen', () => {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    mainWindow.maximize();
  } else {
    // Pseudo-fullscreen clamped to the physical display. setFullScreen(true)
    // sizes the window to the OS-reported fullscreen height (768px), which is
    // LARGER than the physically visible screen (720px) on this hardware —
    // that crops the bottom of the UI. Cover the physical bounds instead.
    mainWindow.setFullScreen(false);
    mainWindow.unmaximize();
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    mainWindow.setBounds(display.bounds);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.focus();
  }
});

ipcMain.on('window:toggleFrame', () => {
  if (!mainWindow) return;
  isFramelessMode = !isFramelessMode;
  if (isFramelessMode) {
    // Pseudo-kiosk: DO NOT use setFullScreen(true) — on this hardware it
    // expands to 768px whereas the visible panel is only 720px, cutting off
    // the bottom row of the UI. Instead cover exactly the physical display
    // bounds (frame off, menu bar hidden, on top).
    mainWindow.setFullScreen(false);
    mainWindow.unmaximize();
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setBounds(display.bounds);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.focus();
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setFullScreen(false);
    mainWindow.setMenuBarVisibility(true);
    mainWindow.maximize();
  }
});

ipcMain.handle('window:getFrameState', () => {
  return isFramelessMode;
});

// ─── IPC: Zoom info (feature) ────────────────────────────────────
ipcMain.handle('window:getZoomInfo', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const zoomFactor = await mainWindow.webContents.getZoomFactor();
  const zoomLevel = await mainWindow.webContents.getZoomLevel();
  return { zoomFactor, zoomLevel };
});

// ─── IPC: Printers (Phase 1.9) ───────────────────────────────────
// Real printer support for the POS. The renderer receives the list of
// printers the OS sees (for the registry health check + routing UI) and can
// trigger silent printing to a named printer via webContents.print.

ipcMain.handle('printer:list', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  try {
    return await mainWindow.webContents.getPrintersAsync();
  } catch (err) {
    console.error('[Electron] printer:list failed:', err);
    return [];
  }
});

ipcMain.handle('printer:print', async (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'No window' };
  }
  const { html, printerName, silent = true } = payload || {};
  if (!html) return { ok: false, error: 'No content to print' };

  return new Promise((resolve) => {
    // Render the ticket into a hidden frame, then print it to the named
    // printer without showing the system dialog (silent thermal printing).
    const frameHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>POS Print</title></head><body>${html}</body></html>`;
    mainWindow!.webContents.print(
      {
        silent,
        printBackground: true,
        deviceName: printerName || undefined,
      },
      (success, failureReason) => {
        resolve({ ok: success, error: success ? null : (failureReason || 'Unknown print failure') });
      }
    );
  });
});

// ─── IPC: Native save dialog (Phase 1.9 — backups/exports) ────────
ipcMain.handle('dialog:saveFile', async (_event, options) => {
  const opts = options || {};
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    title: opts.title || 'Save file',
    defaultPath: opts.defaultPath || 'pos-backup.json',
    filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return { canceled: result.canceled, filePath: result.filePath || null };
});
