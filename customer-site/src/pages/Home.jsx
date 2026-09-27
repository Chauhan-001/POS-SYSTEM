import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Marquee, Squiggle } from '../components/bits';

/**
 * Landing page — mostly for testing: paste a restaurant's publicToken (the
 * `pbl_…` value the POS prints in QR Studio stickers) and open it in any mode.
 * Real customers never see this screen; they scan a printed sticker.
 */

/** Shape of a parsed paste: the store token plus any sticker context found in a URL. */
// (plain JSDoc — this project's pages are .jsx, not TypeScript)
// parsed = { token, mode?, ref?, tableNo?, branchId? }

/** Loose shape check — the backend enforces the authoritative patterns
 *  (`pbl_…` store token, `qr_…` sticker token); this only gates navigation so
 *  a bad paste shows a helpful message instead of a doomed 404 storefront. */
const TOKEN_RE = /^(?:pbl|qr)_[A-Za-z0-9]{6,64}$/;

/**
 * Accept BOTH the bare `pbl_…` token AND the full sticker URL the QR encodes
 * ({qrBaseUrl}/#/{token}?mode=table&ref=…&t=5&b=…). Copying the URL straight
 * out of a QR (desktop camera apps, screenshot tools) used to paste the whole
 * URL into the token field — which the backend then rejected as an unknown
 * store ("Oops — this QR didn't work. Store not found.").
 */
export function parseQrInput(raw) {
  const input = (raw || '').trim().replace(/^["'<]|["'>]$/g, '');
  if (!input) return null;

  // Bare token — use as-is.
  if (TOKEN_RE.test(input)) return { token: input };

  // A pasted sticker URL. The token lives in the hash route (#/{token}) for
  // HashRouter deploys, or as the last path segment for history-mode deploys.
  const hashIdx = input.indexOf('/#/');
  const after = hashIdx >= 0 ? input.slice(hashIdx + 3) : input;
  const [pathPart, queryPart] = after.split('?');
  let token = '';
  try {
    token = decodeURIComponent((pathPart || '').split('/').filter(Boolean).pop() || '');
  } catch {
    token = (pathPart || '').split('/').filter(Boolean).pop() || '';
  }
  if (!TOKEN_RE.test(token)) return null;

  // Preserve the sticker's ordering context so a pasted TABLE sticker still
  // reserves that exact table (mode/ref/t/b ride the QR query string).
  const q = new URLSearchParams(queryPart || '');
  return {
    token,
    mode: (q.get('mode') || '').toLowerCase() || undefined,
    ref: q.get('ref') || undefined,
    tableNo: q.get('t') || undefined,
    branchId: q.get('b') || undefined,
  };
}

export default function Home() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('pickup');
  const [parseError, setParseError] = useState(false);

  const go = () => {
    const parsed = parseQrInput(token);
    if (!parsed) {
      setParseError(true);
      return;
    }
    setParseError(false);
    // A sticker URL carries its own mode/context — it wins over the picker.
    const finalMode = parsed.mode || mode;
    const qs = new URLSearchParams({ mode: finalMode });
    if (parsed.ref) qs.set('ref', parsed.ref);
    if (parsed.tableNo) qs.set('t', parsed.tableNo);
    if (parsed.branchId) qs.set('b', parsed.branchId);
    navigate(`/${encodeURIComponent(parsed.token)}?${qs.toString()}`);
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
          <span className="field-label">Store token, sticker token, or full QR URL</span>
          <input
            className="input"
            placeholder="pbl_abc123… / qr_… (sticker token) / full sticker URL"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setParseError(false); // clear the hint as soon as they edit
            }}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          {parseError && (
            <p
              className="field-label"
              style={{ color: '#d62828', fontWeight: 700, marginTop: 6 }}
            >
              That doesn’t look like a store token — paste the pbl_… token or
              the full QR sticker URL.
            </p>
          )}
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
