/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LoyaltyQrPanel â€” POS dashboard card that renders the restaurant's public
 * loyalty QR. Customers scan the QR and land on /public/{token} (served by the
 * backend) which shows the live rewards catalog, offers and earn rate.
 *
 * The publicToken is minted lazily by the server the first time a device syncs
 * settings (settingsService.getEffective) â€” the panel needs no "Save".
 */

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link2, Check, Copy, Printer, RefreshCw, ExternalLink, QrCode } from 'lucide-react';

interface LoyaltyQrPanelProps {
  /** Public store token from the server-synced settings. */
  publicToken: string | null;
  /** Restaurant name for the printed header. */
  restaurantName?: string;
  /** Extra label shown under the QR (e.g. "Place at the counter"). */
  caption?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function LoyaltyQrPanel({ publicToken, restaurantName = '', caption }: LoyaltyQrPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!publicToken) {
      setUrl('');
      return;
    }
    const target = `${window.location.origin}/public/${encodeURIComponent(publicToken)}`;
    setUrl(target);
    setRenderError(null);
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, target, {
        width: 400,
        margin: 3,
        color: { dark: '#0b1f3a', light: '#ffffff' },
      }).catch((err) => {
        if (!cancelled) setRenderError(err?.message || 'QR generation failed');
      });
    }
    return () => { cancelled = true; };
  }, [publicToken]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handlePrint = () => {
    if (!url || !canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const title = (restaurantName || 'Our rewards program').trim();
    const html = [
      '<html><head><title>Loyalty QR</title><style>',
      'body{margin:0;padding:20px;font-family:Arial,sans-serif;color:#111;text-align:center;width:300px;}',
      'img{width:210px;height:210px;display:block;margin:0 auto;border:8px solid #fff;}',
      'h2{font-size:16px;margin:10px 0 2px;}',
      'p{font-size:11px;color:#555;margin:4px 0;}',
      '.url{font-size:9px;color:#888;word-break:break-all;margin-top:8px;}',
      '</style></head><body>',
      '<h2>', escapeHtml(title), '</h2>',
      '<p>Scan to see our rewards', caption ? ` &mdash; ${escapeHtml(caption)}` : '', '</p>',
      '<img src="', escapeHtml(dataUrl), '" alt="QR" />',
      '<p class="url">', escapeHtml(url), '</p>',
      '<script>window.onload=function(){window.print();}</script>',
      '</body></html>',
    ].join('');

    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.top = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.onload = () => { (frame.contentWindow || window).print(); };
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
    }
    setTimeout(() => document.body.removeChild(frame), 4000);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-color)]" />
        <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">
          Loyalty QR <span className="text-gray-400 font-semibold">/ Public Store</span>
        </h3>
        <button
          type="button"
          onClick={() => setRenderError(null)}
          className="ml-auto flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-[var(--brand-color)] transition-colors cursor-pointer"
          title="Regenerate QR"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {!publicToken ? (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
          <Link2 className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800 space-y-1">
            <p className="font-bold">Waiting for the public store linkâ€¦</p>
            <p>Your server issues the QR link automatically when this device syncs settings. Refresh the page or check the internet/offline pill above.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-6">
            <div className="shrink-0 rounded-2xl border border-[#e1e2ed] bg-white p-3 shadow-sm">
              {renderError ? (
                <div className="w-52 h-52 flex items-center justify-center text-xs text-red-500 font-bold text-center px-4">{renderError}</div>
              ) : (
                <canvas ref={canvasRef} className="w-52 h-52" aria-label="Loyalty QR code" />
              )}
            </div>

            <div className="flex-1 min-w-[220px] space-y-2.5">
              <p className="text-xs font-bold text-gray-700">Scan & earn â€” customers see live rewards &amp; offers</p>
              <p className="text-[11px] leading-relaxed text-gray-500 break-all bg-[#f6f7fb] border border-[#e9ebf4] rounded-xl p-3">
                <span className="font-mono">{url}</span>
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={copied}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--brand-color)] text-white text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#d7dae6] text-gray-700 text-[11px] font-bold hover:bg-[#f3f4fa] transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#d7dae6] text-gray-700 text-[11px] font-bold hover:bg-[#f3f4fa] transition-colors cursor-pointer no-underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
              </div>
            </div>
          </div>

          <div className="bg-[#f6f7fb] border border-[#e9ebf4] rounded-xl p-3 text-[11px] text-gray-500 leading-relaxed space-y-1">
            <p className="flex items-center gap-1.5 font-bold text-gray-600">
              <QrCode className="w-3.5 h-3.5" /> How this works
            </p>
            <p>Customers scan the QR on their phone to open your public store page: promotional offers, rewards catalog and how fast you can earn points.</p>
            <p>The link uses this device&apos;s origin (<span className="font-mono text-[10px]">{window.location.origin}</span>) â€” keep the QR page reachable from your customer network (Wi-Fi / hotspot).</p>
          </div>
        </>
      )}
    </div>
  );
}