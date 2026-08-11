/** Small decorative building blocks shared across pages. */

const TICKER =
  '⚡ BOLT-FAST SERVICE ⚡ NO APP NEEDED ⚡ PAY HOW YOU LIKE ⚡ FRESH OFF THE GRILL ⚡ ';

export function Marquee() {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        <span>{TICKER.repeat(2)}</span>
        <span>{TICKER.repeat(2)}</span>
      </div>
    </div>
  );
}

/** Wiggly SVG squiggle divider. */
export function Squiggle({ color = '#E63946' }) {
  return (
    <svg
      className="squiggle"
      viewBox="0 0 300 20"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d="M2 10 Q 17 2, 32 10 T 62 10 T 92 10 T 122 10 T 152 10 T 182 10 T 212 10 T 242 10 T 272 10 T 302 10"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VegDot({ veg }) {
  return <span className={`veg-dot${veg ? '' : ' nonveg'}`} title={veg ? 'Veg' : 'Non-veg'} />;
}
