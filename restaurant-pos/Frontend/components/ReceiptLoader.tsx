/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReceiptLoader — the POS boot loading animation: a receipt prints out of a
 * thermal printer (paper rises, line items ink in, LED blinks, barcode at the
 * foot), then the cycle restarts. Pure CSS keyframes — zero dependencies, so
 * it works offline and never blocks first paint.
 *
 * The whole animation lives in one <style> block inside the component so it
 * can be dropped into any loading surface (boot, plan gate, lazy workspace)
 * without touching global CSS.
 */

const LINE_WIDTHS = ['72%', '88%', '60%', '78%', '90%', '64%', '48%'];

export default function ReceiptLoader({
  label = 'Initializing POS Terminal…',
  size = 'md',
}: {
  label?: string;
  size?: 'md' | 'lg';
}) {
  const scale = size === 'lg' ? 1.25 : 1;
  return (
    <div className="flex flex-col items-center select-none">
      <style>{`
        .rl-stage {
          position: relative;
          width: ${130 * scale}px;
          height: ${104 * scale}px;
          overflow: hidden;
          transform: scale(${scale});
          transform-origin: bottom center;
        }
        /* Printer chassis */
        .rl-printer {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 58px;
          background: linear-gradient(180deg, #2b2f3a 0%, #1d2028 100%);
          border-radius: 10px 10px 12px 12px;
          box-shadow: 0 10px 22px -8px rgba(25, 27, 35, 0.45);
          z-index: 3;
        }
        .rl-printer::before { /* paper slot */
          content: '';
          position: absolute;
          left: 10px; right: 10px; top: -4px;
          height: 8px;
          background: #14161c;
          border-radius: 4px;
        }
        .rl-printer::after { /* brand stripe */
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 7px;
          background: linear-gradient(90deg, transparent 6%, rgba(255,255,255,0.14) 12%, transparent 18%, transparent 42%, rgba(255,255,255,0.14) 48%, transparent 54%, transparent 78%, rgba(255,255,255,0.14) 84%, transparent 90%);
        }
        .rl-led {
          position: absolute;
          top: 16px; left: 14px;
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 6px rgba(52, 211, 153, 0.9);
          animation: rl-led-blink 1.15s ease-in-out infinite;
        }
        .rl-btn {
          position: absolute;
          top: 15px; right: 13px;
          width: 16px; height: 16px;
          border-radius: 4px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.14);
        }
        /* Rising receipt paper */
        .rl-paper {
          position: absolute;
          left: 50%;
          bottom: 46px;
          width: 92px;
          padding: 8px 9px 7px;
          background: #ffffff;
          border-radius: 3px 3px 0 0;
          box-shadow: 0 2px 10px rgba(0,0,0,0.12);
          transform-origin: bottom center;
          animation: rl-paper-rise 2.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
          z-index: 2;
        }
        .rl-paper::after { /* perforation */
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: 3px;
          height: 2px;
          background-image: radial-gradient(circle, #e5e7eb 1.5px, transparent 1.6px);
          background-size: 6px 2px;
          background-repeat: repeat-x;
        }
        .rl-line {
          display: block;
          height: 4px;
          border-radius: 2px;
          background: linear-gradient(90deg, #3f3f46 0%, #71717a 100%);
          margin-bottom: 5px;
          transform: scaleX(0);
          transform-origin: left center;
          animation: rl-line-in 2.8s ease-out infinite;
        }
        .rl-line.total {
          height: 5px;
          background: linear-gradient(90deg, var(--brand-color, #004ac6) 0%, #7c3aed 100%);
        }
        .rl-barcode {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 14px;
          margin-top: 7px;
          justify-content: center;
        }
        .rl-barcode span {
          width: 2px;
          background: #18181b;
          border-radius: 1px;
          opacity: 0;
          animation: rl-line-in 2.8s ease-out infinite;
        }
        /* Animations */
        @keyframes rl-paper-rise {
          0%   { transform: translate(-50%, 6px) scale(0.92); opacity: 0; }
          8%   { transform: translate(-50%, 4px) scale(0.97); opacity: 1; }
          46%  { transform: translate(-50%, -52px) scale(1); opacity: 1; }
          74%  { transform: translate(-50%, -52px) scale(1); opacity: 1; }
          88%  { transform: translate(-50%, -56px) scale(1); opacity: 0; }
          100% { transform: translate(-50%, 6px) scale(0.92); opacity: 0; }
        }
        @keyframes rl-line-in {
          0%, 12% { transform: scaleX(0); opacity: 0; }
          32%, 74% { transform: scaleX(1); opacity: 1; }
          90%, 100% { transform: scaleX(1); opacity: 0; }
        }
        @keyframes rl-led-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes rl-label-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>

      <div className="rl-stage" aria-hidden="true">
        <div className="rl-paper">
          {LINE_WIDTHS.map((w, i) => (
            <span key={i} className="rl-line" style={{ width: w, animationDelay: `${0.1 + i * 0.12}s` }} />
          ))}
          <span className="rl-line total" style={{ width: '84%', animationDelay: '0.94s' }} />
          <div className="rl-barcode">
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} style={{ height: `${8 + (i % 3) * 3}px`, animationDelay: `${0.98 + i * 0.05}s` }} />
            ))}
          </div>
        </div>
        <div className="rl-printer">
          <div className="rl-led" />
          <div className="rl-btn" />
        </div>
      </div>

      <p
        className="mt-3 text-sm font-semibold text-gray-500"
        style={{ animation: 'rl-label-pulse 2.2s ease-in-out infinite' }}
      >
        {label}
      </p>
    </div>
  );
}
