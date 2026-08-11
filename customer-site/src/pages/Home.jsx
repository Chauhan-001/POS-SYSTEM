import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Marquee, Squiggle } from '../components/bits';

/**
 * Landing page — mostly for testing: paste a restaurant's publicToken (the
 * `pbl_…` value the POS prints in QR Studio stickers) and open it in any mode.
 * Real customers never see this screen; they scan a printed sticker.
 */
export default function Home() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('pickup');

  const go = () => {
    const t = token.trim();
    if (!t) return;
    navigate(`/${encodeURIComponent(t)}?mode=${mode}`);
  };

  return (
    <div className="shell">
      <div className="page">
        <h1 className="hero-title">
          QR <span className="bolt">Ordering</span> ⚡
        </h1>
        <span className="sticker">Scan → Order → Nom. That’s it.</span>
        <Squiggle />
        <p style={{ fontWeight: 600 }}>
          No app. No waiting. Scan the QR at your table, car slot, or the pickup
          counter and you’re ordering in seconds.
        </p>

        <h2 className="section-title">Open a restaurant storefront</h2>

        <div className="card">
          <span className="field-label">Public store token (from QR Studio)</span>
          <input
            className="input"
            placeholder="pbl_abc123…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <span className="field-label">Ordering mode</span>
          <div className="option-row">
            {[
              { key: 'table', label: '🍽 Table' },
              { key: 'car', label: '🚗 Car' },
              { key: 'pickup', label: '🥡 Pickup' },
            ].map((m) => (
              <button
                key={m.key}
                className={`option-pill${mode === m.key ? ' selected' : ''}`}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button className="btn btn-ketchup btn-block btn-lg" onClick={go} disabled={!token.trim()}>
            Open store ⚡
          </button>
        </div>

        <Squiggle color="#2A9D8F" />
        <p className="muted center">
          Tip: print real stickers from the POS → More → QR Studio.
        </p>
      </div>
      <Marquee />
    </div>
  );
}
