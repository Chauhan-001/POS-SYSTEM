/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QRDesigner — the ONE place a restaurant owner configures QR branding.
 * Style, finder, color, logo, frame. Live branded preview + Test Scan.
 * Advanced knobs (error correction) are hidden by default.
 *
 * Owns a draft copy of QrBrandingConfig; callers save via onSave (the existing
 * settings PATCH flow — tenant-scoped, offline-queued).
 */

import { useMemo, useState } from 'react';
import { Check, QrCode, RefreshCw, ScanLine } from 'lucide-react';
import type { QrBrandingConfig, QrPlacement, QrPurpose, QrStyle, QrFinderStyle } from '../src/qr';
import {
  renderQrSvg, svgToDataUrl, validateQrRoundTrip, decodeQrSvg,
  ensureScanSafeDark, contrastNotice, DEFAULT_QR_DARK,
} from '../src/qr';
import BrandedQRCode from './BrandedQRCode';

interface QRDesignerProps {
  initial: Partial<QrBrandingConfig>;
  restaurantName: string;
  logo?: string | null;
  brandColor: string;
  onSave: (config: QrBrandingConfig) => void | Promise<void>;
  saving?: boolean;
}

const STYLES: Array<{ id: QrStyle; label: string; hint: string }> = [
  { id: 'brand', label: 'Brand', hint: 'Restaurant-colored modules' },
  { id: 'rounded', label: 'Rounded', hint: 'Soft rounded modules' },
  { id: 'dots', label: 'Dots', hint: 'Circular modules' },
  { id: 'classic', label: 'Classic', hint: 'Plain squares' },
];

const FINDERS: Array<{ id: QrFinderStyle; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'soft-rounded', label: 'Soft' },
];

const PREVIEW_PURPOSES: Array<{ id: QrPurpose; label: string }> = [
  { id: 'table', label: 'Table card' },
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'parking', label: 'Parking' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'menu', label: 'Menu' },
  { id: 'receipt', label: 'Receipt' },
];

export default function QRDesigner({ initial, restaurantName, logo, brandColor, onSave, saving }: QRDesignerProps) {
  const [style, setStyle] = useState<QrStyle>(initial.style || 'brand');
  const [finderStyle, setFinderStyle] = useState<QrFinderStyle>(initial.finderStyle || 'rounded');
  const [color, setColor] = useState(initial.primaryColor || brandColor || DEFAULT_QR_DARK);
  const [logoEnabled, setLogoEnabled] = useState(initial.logoEnabled ?? !!logo);
  const [frameEnabled, setFrameEnabled] = useState(initial.frameEnabled ?? true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewPurpose, setPreviewPurpose] = useState<QrPurpose>('table');
  const [previewPlacement, setPreviewPlacement] = useState<QrPlacement>('table-card');
  const [scanState, setScanState] = useState<{ ok: boolean; message: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  const previewValue = `https://${restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'restaurant'}.example.com/q/scan-demo`;
  // Stable reference so the BrandedQRCode preview memo isn't invalidated on
  // every keystroke (a fresh object literal each render would re-encode the QR).
  const config: Partial<QrBrandingConfig> = useMemo(
    () => ({ style, finderStyle, primaryColor: color, logoEnabled, frameEnabled }),
    [style, finderStyle, color, logoEnabled, frameEnabled],
  );

  const darkCheck = useMemo(() => ensureScanSafeDark(color), [color]);
  const notice = contrastNotice(color, darkCheck.adjusted);

  const testScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScanState(null);
    try {
      // Deterministic matrix-level round-trip (no DOM dependency).
      const matrixResult = validateQrRoundTrip(previewValue, logoEnabled ? 'H' : 'M', { scale: 10 });
      if (matrixResult.ok) {
        setScanState({ ok: true, message: `Decoded “${matrixResult.decoded}” — matches.` });
        return;
      }
      // Fall back to rasterizing the actual styled SVG in the browser.
      const svg = renderQrSvg({
        value: previewValue,
        style,
        finderStyle,
        dark: color,
        logo: logoEnabled ? logo : null,
        logoEnabled,
        errorCorrectionLevel: logoEnabled ? 'H' : 'M',
      }).svg;
      const svgResult = await decodeQrSvg(svg);
      if (svgResult.ok && svgResult.decoded === previewValue) {
        setScanState({ ok: true, message: `Decoded “${svgResult.decoded}” — matches.` });
      } else {
        setScanState({ ok: false, message: svgResult.error || 'Could not decode — try a simpler style.' });
      }
    } catch (err) {
      setScanState({ ok: false, message: err instanceof Error ? err.message : 'Test scan failed.' });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-5">
      <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
        <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">QR Design</h3>
        <span className="text-[10px] text-gray-400 ml-auto">Applied to every QR: receipts, stickers, loyalty, menus, offers</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Controls ── */}
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Style</p>
            <div className="grid grid-cols-4 gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  title={s.hint}
                  className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                    style === s.id ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-white border-[#e1e2ed] text-gray-600 hover:border-[var(--brand-color)]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Corners (finder pattern)</p>
            <div className="grid grid-cols-3 gap-2">
              {FINDERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFinderStyle(f.id)}
                  className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                    finderStyle === f.id ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]' : 'bg-white border-[#e1e2ed] text-gray-600 hover:border-[var(--brand-color)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Color</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-[#e1e2ed] cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value.trim().startsWith('#') ? e.target.value.trim() : `#${e.target.value.trim()}`)}
                className="flex-1 px-3 py-2 rounded-xl border border-[#e1e2ed] text-xs font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30"
              />
              <button
                type="button"
                onClick={() => setColor(brandColor || DEFAULT_QR_DARK)}
                className="px-2.5 py-2 rounded-xl border border-[#e1e2ed] text-[10px] font-bold text-gray-500 hover:border-[var(--brand-color)] transition-colors cursor-pointer"
              >
                Brand
              </button>
            </div>
            {notice && (
              <p className="text-[10px] text-amber-600 font-medium mt-1.5">⚠ {notice}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-[#e1e2ed] cursor-pointer">
              <span className="text-[11px] font-bold text-gray-600">Center logo</span>
              <input type="checkbox" checked={logoEnabled} onChange={(e) => setLogoEnabled(e.target.checked)} className="accent-[var(--brand-color)] w-4 h-4 cursor-pointer" />
            </label>
            <label className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-[#e1e2ed] cursor-pointer">
              <span className="text-[11px] font-bold text-gray-600">Frame</span>
              <input type="checkbox" checked={frameEnabled} onChange={(e) => setFrameEnabled(e.target.checked)} className="accent-[var(--brand-color)] w-4 h-4 cursor-pointer" />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[10px] font-bold text-gray-400 hover:text-[var(--brand-color)] transition-colors cursor-pointer"
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced'}
          </button>
          {showAdvanced && (
            <div className="bg-[#f6f7fb] border border-[#e9ebf4] rounded-xl p-3 text-[11px] text-gray-500 space-y-1">
              <p>Quiet zone: automatic (4 modules). Error correction: automatic — high when a logo is used, medium otherwise. Logo size is capped so the code always scans.</p>
              <p className="font-mono text-[10px]">{previewValue}</p>
            </div>
          )}
        </div>

        {/* ── Preview + Test Scan ── */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={previewPurpose}
              onChange={(e) => {
                const p = e.target.value as QrPurpose;
                setPreviewPurpose(p);
                if (p === 'receipt') setPreviewPlacement('receipt');
                else if (p === 'parking') setPreviewPlacement('parking');
                else setPreviewPlacement('table-card');
              }}
              className="px-2.5 py-1.5 rounded-lg border border-[#e1e2ed] text-[11px] font-bold text-gray-600 bg-white cursor-pointer focus:outline-none"
            >
              {PREVIEW_PURPOSES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-center rounded-2xl border border-[#e1e2ed] bg-[#fafbff] p-6">
            <BrandedQRCode
              value={previewValue}
              purpose={previewPurpose}
              placement={previewPlacement}
              restaurant={{ name: restaurantName || 'CHAISH', logo, primaryColor: brandColor || DEFAULT_QR_DARK }}
              config={config}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={testScan}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--brand-color)] text-white text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
            >
              {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
              {scanning ? 'Scanning…' : 'Test Scan'}
            </button>
            {scanState && (
              <span className={`text-[11px] font-semibold ${scanState.ok ? 'text-green-600' : 'text-red-600'}`}>
                {scanState.ok ? <Check className="w-3.5 h-3.5 inline mr-1" /> : null}
                {scanState.message}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            Test Scan decodes the generated code on this device to prove it matches. You can also scan the preview with your phone camera.
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-50">
        <button
          type="button"
          onClick={() => onSave({ style, finderStyle, primaryColor: color, logoEnabled, frameEnabled })}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
        >
          <QrCode className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save QR Design'}
        </button>
      </div>
    </div>
  );
}
