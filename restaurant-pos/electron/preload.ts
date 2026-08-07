/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Electron Preload Script — Secure bridge between main and renderer processes.
 *
 * SECURITY:
 *   - contextIsolation: true — the renderer CANNOT access Node.js APIs directly
 *   - Only specific, whitelisted APIs are exposed via contextBridge
 *   - All IPC communication uses channel whitelisting
 *   - No filesystem access is exposed to the renderer
 *
 * Architecture:
 *   Renderer (React)  ↔  contextBridge  ↔  preload  ↔  ipcRenderer  ↔  Main Process
 *
 * Architecture ported from admin-dashboard (gold standard):
 *   - No IPC resize channel — renderer uses 100vh for layout
 *   - Only app info and feature APIs exposed
 */

const { createRequire } = require('module');
const path = require('path');
const electronBin = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const electronRequire = createRequire(electronBin);
const { contextBridge, ipcRenderer } = electronRequire('electron');

/**
 * Whitelist of allowed IPC channels.
 * Any channel NOT in this list will be rejected by the proxy.
 * This prevents the renderer from accessing arbitrary main-process APIs.
 */
const ALLOWED_SEND_CHANNELS = [
  'window:reload',
  'window:toggleFullScreen',
  'window:toggleFrame',
] as const;

const ALLOWED_INVOKE_CHANNELS = [
  'app:getVersion',
  'app:getEnvironment',
  'window:getFrameState',
  'window:getZoomInfo',
  'printer:list',
  'printer:print',
  'dialog:saveFile',
] as const;

const ALLOWED_ON_CHANNELS = [
  'app:showMessage',
] as const;

type AllowedSendChannel = typeof ALLOWED_SEND_CHANNELS[number];
type AllowedInvokeChannel = typeof ALLOWED_INVOKE_CHANNELS[number];
type AllowedOnChannel = typeof ALLOWED_ON_CHANNELS[number];

/**
 * Desktop API exposed to the renderer process.
 *
 * All methods go through contextBridge — the renderer sees
 * `window.electronAPI.*` with only these specific methods.
 */
const electronAPI = {
  // ─── App Info ────────────────────────────────────────────
  getVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion' as AllowedInvokeChannel);
  },

  getEnvironment: (): Promise<{
    isDev: boolean;
    platform: string;
    electronVersion: string;
    nodeVersion: string;
    chromeVersion: string;
  }> => {
    return ipcRenderer.invoke('app:getEnvironment' as AllowedInvokeChannel);
  },

  // ─── Window Controls ────────────────────────────────────
  reload: (): void => {
    ipcRenderer.send('window:reload' as AllowedSendChannel);
  },

  toggleFullScreen: (): void => {
    ipcRenderer.send('window:toggleFullScreen' as AllowedSendChannel);
  },

  /**
   * Toggle frameless/borderless kiosk-style mode.
   * In this mode, the OS window frame (title bar, borders) is removed
   * and the app fills the entire screen — ideal for POS terminals.
   */
  toggleFrame: (): void => {
    ipcRenderer.send('window:toggleFrame' as AllowedSendChannel);
  },

  /** Get whether the window is currently in frameless/kiosk mode */
  getFrameState: (): Promise<boolean> => {
    return ipcRenderer.invoke('window:getFrameState' as AllowedInvokeChannel);
  },

  /** Get current zoom factor and zoom level */
  getZoomInfo: (): Promise<{ zoomFactor: number; zoomLevel: number } | null> => {
    return ipcRenderer.invoke('window:getZoomInfo' as AllowedInvokeChannel);
  },

  // ─── Printers (Phase 1.9) ────────────────────────────────
  /** List printers the OS sees (for the registry health check). */
  listPrinters: (): Promise<Array<{ name: string; status: number; isDefault?: boolean }>> => {
    return ipcRenderer.invoke('printer:list' as AllowedInvokeChannel);
  },

  /** Silent-print an HTML ticket to a named printer. */
  printHtml: (html: string, printerName?: string): Promise<{ ok: boolean; error: string | null }> => {
    return ipcRenderer.invoke('printer:print' as AllowedInvokeChannel, { html, printerName, silent: true });
  },

  // ─── Native save dialog (Phase 1.9 — backups/exports) ────
  /** Show the OS save dialog; returns the chosen path (or null if canceled). */
  saveFileDialog: (options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePath: string | null }> => {
    return ipcRenderer.invoke('dialog:saveFile' as AllowedInvokeChannel, options || {});
  },

  // ─── Message from Main ──────────────────────────────────
  onShowMessage: (callback: (message: string) => void): void => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => {
      callback(message);
    };
    ipcRenderer.on('app:showMessage' as AllowedOnChannel, handler);
  },

  // ─── Platform Info (sync, no IPC needed) ────────────────
  platform: process.platform,
};

// Expose the API securely to the renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// ─── Type declaration for the renderer ─────────────────────────
// This lets TypeScript in React components know about window.electronAPI
export type ElectronAPI = typeof electronAPI;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
