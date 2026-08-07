/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * electron.ts — Optional Electron bridge with graceful browser fallbacks (Phase 1.9).
 *
 * The POS runs in both the browser (dev) and Electron (production). Every
 * native capability — printer list, silent print, save dialog — degrades to a
 * browser-safe behavior when window.electronAPI is unavailable, so the same
 * code paths work in both environments.
 */

interface ElectronPrinterInfo {
  name: string;
  status?: number;
  isDefault?: boolean;
}

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
};

/** List printers visible to the OS (Electron) — empty array in the browser. */
export async function listOsPrinters(): Promise<ElectronPrinterInfo[]> {
  if (!isElectron()) return [];
  try {
    const list = await (window as any).electronAPI.listPrinters();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Silent-print HTML via Electron; falls back to the window.print() dialog. */
export async function printHtml(html: string, printerName?: string): Promise<{ ok: boolean; error: string | null }> {
  if (isElectron()) {
    try {
      return await (window as any).electronAPI.printHtml(html, printerName);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Electron print failed' };
    }
  }
  // Browser fallback — hidden iframe + window.print().
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      resolve({ ok: false, error: 'No document context' });
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>POS Print</title></head><body>${html}<script>window.onload=function(){window.print();setTimeout(function(){window.parent.document.body.removeChild(window.frameElement);},500);};<\/script></body></html>`);
    doc.close();
    resolve({ ok: true, error: null });
  });
}

/**
 * Native save dialog (Electron). Returns the chosen file path, or null when the
 * dialog is canceled or the environment has no native dialog (browser → null).
 */
export async function showSaveDialog(options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
  if (!isElectron()) return null;
  try {
    const result = await (window as any).electronAPI.saveFileDialog(options || {});
    return result?.canceled ? null : (result?.filePath || null);
  } catch {
    return null;
  }
}
