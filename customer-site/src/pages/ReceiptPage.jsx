/**
 * ReceiptPage — the landing page behind the REAL QR printed on the bill.
 *
 * Privacy contract (hard requirements):
 *   - Shows ONLY the reward earned + today's bill items + a feedback box.
 *   - NEVER shows customer name / phone / cashier PII (the public API never
 *     returns them).
 *   - Openable WITHOUT a phone number — the whole page works anonymously.
 *   - "See more" is OPTIONAL: OTP login unlocks the customer's OWN loyalty
 *     summary (points balance, tier, visits).
 *   - Receipt links expire 12h after the bill was created (410 → friendly UI).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, errMsg } from '../api';
import { computeTaxSummary } from '../lib/taxSummary';

const CONFETTI = ['🎉', '⭐', '✨', '🍟', '🥳', '🎊', '🧡', '💛'];

function Confetti({ count = 14 }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 1.6 + Math.random() * 1.4,
        emoji: CONFETTI[i % CONFETTI.length],
        rot: Math.random() * 360,
      })),
    [count]
  );
  return (
    <div className="receipt-confetti" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="receipt-confetti-piece"
          style={{ left: `${p.left}%` }}
          initial={{ y: -40, opacity: 0, rotate: 0 }}
          animate={{ y: '82vh', opacity: [0, 1, 1, 0], rotate: p.rot }}
          transition={{ delay: p.delay, duration: p.dur, ease: 'easeIn' }}
        >
          {p.emoji}
        </motion.span>
      ))}
    </div>
  );
}

function StarRow({ value, onChange, disabled }) {
  return (
    <div className="receipt-stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`receipt-star ${value >= n ? 'on' : ''}`}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ReceiptPage() {
  const token = window.location.hash.split('/r/')[1]?.split('?')[0] || '';
  const [phase, setPhase] = useState('loading'); // loading | ready | expired | missing | error
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');

  // Feedback state
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [fbState, setFbState] = useState('idle'); // idle | sending | sent | failed
  const [fbError, setFbError] = useState('');

  // See-more login state
  const [showLogin, setShowLogin] = useState(false);
  const [phone, setPhone] = useState('');
  const [otpStep, setOtpStep] = useState('phone'); // phone | code
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [simCode, setSimCode] = useState('');
  const [loginState, setLoginState] = useState('idle'); // idle | sending | verifying | done | failed
  const [loginError, setLoginError] = useState('');
  const [customer, setCustomer] = useState(null);

  const load = useCallback(async () => {
    if (!token) {
      setPhase('missing');
      return;
    }
    setPhase('loading');
    try {
      const { data } = await api.get(`/receipt/${encodeURIComponent(token)}`);
      setReceipt(data?.receipt || null);
      setPhase('ready');
    } catch (e) {
      const status = e?.response?.status;
      if (status === 410) setPhase('expired');
      else if (status === 404) setPhase('missing');
      else {
        setError(errMsg(e, 'Could not load this receipt'));
        setPhase('error');
      }
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const submitFeedback = useCallback(async () => {
    if (rating < 1 || rating > 5) {
      setFbError('Please pick a star rating first.');
      return;
    }
    setFbState('sending');
    setFbError('');
    try {
      await api.post(`/receipt/${encodeURIComponent(token)}/feedback`, { rating, comment });
      setFbState('sent');
    } catch (e) {
      setFbError(errMsg(e, 'Could not send feedback. Please try again.'));
      setFbState('failed');
    }
  }, [token, rating, comment]);

  const requestOtp = useCallback(async () => {
    if (!/^[0-9+\-\s]{7,20}$/.test(phone.trim())) {
      setLoginError('Please enter a valid phone number.');
      return;
    }
    setLoginState('sending');
    setLoginError('');
    try {
      const { data } = await api.post(`/receipt/${encodeURIComponent(token)}/otp/request`, { phone });
      setSimCode(data?.simulatedCode || '');
      setOtpStep('code');
      setOtpSent(true);
      setLoginState('idle');
    } catch (e) {
      setLoginError(errMsg(e, 'Could not send the code.'));
      setLoginState('failed');
    }
  }, [token, phone]);

  const verifyOtp = useCallback(async () => {
    setLoginState('verifying');
    setLoginError('');
    try {
      const { data } = await api.post(`/receipt/${encodeURIComponent(token)}/otp/verify`, { phone, code });
      setCustomer(data?.customer || null);
      setLoginState('done');
    } catch (e) {
      setLoginError(errMsg(e, 'Invalid code.'));
      setLoginState('failed');
    }
  }, [token, phone, code]);

  // Deterministic per-slab tax breakdown — identical math to the printed
  // thermal receipt. Computed from state (before any early return) so the
  // Rules of Hooks stay intact. Show the grouped breakdown when 2+ slabs.
  const r = receipt || {};
  const items = r.items || [];
  const tax = useMemo(() => computeTaxSummary(items, r.discount || 0), [items, r.discount]);
  const multiSlab = tax.rows.length > 1;

  /* ------------------------------ loading ------------------------------ */
  if (phase === 'loading') {
    return (
      <div className="shell">
        <div className="loader-wrap">
          <div>
            <span className="loader-emoji">🧾</span>
            <h2 className="display" style={{ transform: 'rotate(-2deg)' }}>
              Pulling up your receipt…
            </h2>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="shell">
        <div className="page">
          <h1 className="hero-title">
            Link <span className="bolt">Expired</span> ⏳
          </h1>
          <div className="error-box mt">
            <p style={{ margin: '0 0 6px' }}>This receipt link is no longer active.</p>
            <p className="muted" style={{ margin: 0 }}>
              Receipt QR codes expire 12 hours after your visit to keep your details private.
              Ask the restaurant for a fresh one if you need it again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'missing') {
    return (
      <div className="shell">
        <div className="page">
          <h1 className="hero-title">
            QR <span className="bolt">Not Found</span> 🤷
          </h1>
          <div className="error-box mt">
            <p style={{ margin: 0 }}>We couldn't find this receipt. Please scan the QR printed on your bill again.</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="shell">
        <div className="page">
          <h1 className="hero-title">
            Oops <span className="bolt">😵</span>
          </h1>
          <div className="error-box mt">
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const hasReward = (r.pointsEarned > 0) || r.milestoneRewardAwarded || r.redeemedRewardTitle;
  const sym = '₹';

  return (
    <div className="shell">
      <Confetti />
      <div className="page">
        {/* ── Congrats hero ─────────────────────────────────────── */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -4 }}
          animate={{ scale: 1, opacity: 1, rotate: -2 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          className="receipt-hero"
        >
          <span className="receipt-hero-emoji">🎉</span>
          <h1 className="display" style={{ fontSize: 30 }}>Thank you for dining with us!</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{r.restaurant?.name || 'Our Restaurant'}</p>
        </motion.div>

        {/* ── Reward earned (only) ──────────────────────────────── */}
        {hasReward && (
          <motion.div
            className="card card-tilt mt"
            style={{ background: 'var(--mustard)' }}
            initial={{ x: -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 18 }}
          >
            <h2 className="display" style={{ fontSize: 18 }}>Reward Earned</h2>
            {r.pointsEarned > 0 && (
              <div className="receipt-reward-line">
                <span>⭐ Points accumulated</span>
                <strong>+{r.pointsEarned} pts</strong>
              </div>
            )}
            {r.milestoneRewardAwarded && (
              <div className="receipt-reward-line">
                <span>🎁 Milestone reward</span>
                <strong>{r.milestoneRewardAwarded}</strong>
              </div>
            )}
            {r.redeemedRewardTitle && (
              <div className="receipt-reward-line">
                <span>🏷️ Redeemed</span>
                <strong>{r.redeemedRewardTitle}</strong>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Today's bill items ────────────────────────────────── */}
        <motion.div
          className="card mt"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          <h2 className="display" style={{ fontSize: 18 }}>Today's Bill</h2>
          <p className="muted" style={{ margin: '2px 0 10px', fontSize: 13 }}>
            {r.invoiceNumber} · {r.date} {r.time}
            {r.tableNumber ? ` · Table ${r.tableNumber}` : ''}
          </p>

          <div className="receipt-items">
            {items.map((it, i) => (
              <div key={i} className="receipt-item">
                <div className="receipt-item-name">
                  <strong>{it.name}</strong>
                  {it.variantName && <span className="muted"> · {it.variantName}</span>}
                  {it.notes && <span className="muted receipt-item-note">“{it.notes}”</span>}
                </div>
                <div className="receipt-item-right">
                  <span className="muted">×{it.quantity}</span>
                  <strong>{it.isFree ? 'FREE' : `${sym}${(it.price * it.quantity).toFixed(2)}`}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="receipt-totals">
            <div className="receipt-total-line"><span>Subtotal</span><span>{sym}{(r.subtotal || 0).toFixed(2)}</span></div>
            {r.discount > 0 && (
              <div className="receipt-total-line"><span>Discount</span><span>-{sym}{(r.discount || 0).toFixed(2)}</span></div>
            )}
            {r.gst > 0 && multiSlab && (
              <div className="receipt-tax-box">
                <div className="receipt-tax-title">GST SUMMARY</div>
                {tax.rows.map((row) => (
                  <div key={row.rate} className="receipt-total-line" style={{ fontSize: 13 }}>
                    <span>
                      {row.rate}%{' '}
                      <span className="muted" style={{ fontSize: 11 }}>
                        (taxable {sym}{row.taxableAmount.toFixed(2)})
                      </span>
                    </span>
                    <span>
                      CGST {sym}{row.cgst.toFixed(2)} · SGST {sym}{row.sgst.toFixed(2)}
                    </span>
                  </div>
                ))}
                <div className="receipt-total-line" style={{ fontSize: 13, fontWeight: 700 }}>
                  <span>Total Tax</span><span>{sym}{tax.totalTax.toFixed(2)}</span>
                </div>
              </div>
            )}
            {r.gst > 0 && !multiSlab && (
              <div className="receipt-total-line"><span>Tax</span><span>{sym}{(r.gst || 0).toFixed(2)}</span></div>
            )}
            <div className="receipt-total-line receipt-grand"><span>Total</span><span>{sym}{(r.grandTotal || 0).toFixed(2)}</span></div>
            {r.paymentMethod && (
              <div className="receipt-total-line muted" style={{ fontSize: 13 }}>
                <span>Paid via</span><span>{r.paymentMethod}</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Feedback box ──────────────────────────────────────── */}
        <motion.div
          className="card mt"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          <h2 className="display" style={{ fontSize: 18 }}>How was your meal?</h2>
          <p className="muted" style={{ margin: '2px 0 10px', fontSize: 13 }}>
            Your feedback helps us get better. No sign-up needed.
          </p>

          {fbState === 'sent' ? (
            <motion.div
              className="receipt-feedback-ok"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              🧡 Thanks! Your feedback has been shared with the restaurant.
            </motion.div>
          ) : (
            <>
              <StarRow value={rating} onChange={setRating} disabled={fbState === 'sending'} />
              <textarea
                className="receipt-comment"
                rows={3}
                maxLength={1000}
                placeholder="Anything you loved (or want us to fix)…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={fbState === 'sending'}
              />
              {fbError && <p className="receipt-inline-error">{fbError}</p>}
              <button
                className="btn btn-ketchup mt"
                style={{ width: '100%' }}
                onClick={submitFeedback}
                disabled={fbState === 'sending'}
              >
                {fbState === 'sending' ? 'Sending…' : 'Send Feedback'}
              </button>
            </>
          )}
        </motion.div>

        {/* ── See more (optional OTP login) ─────────────────────── */}
        <motion.div
          className="card mt receipt-more"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.45 }}
        >
          {loginState === 'done' ? (
            <div className="receipt-customer">
              <h2 className="display" style={{ fontSize: 18 }}>
                Welcome back{customer?.name ? `, ${customer.name.split(' ')[0]}` : ''}! 👋
              </h2>
              {customer ? (
                <>
                  <div className="receipt-reward-line"><span>⭐ Points balance</span><strong>{customer.points} pts</strong></div>
                  <div className="receipt-reward-line"><span>🏆 Loyalty tier</span><strong>{customer.tier}</strong></div>
                  <div className="receipt-reward-line"><span>🛍️ Total visits</span><strong>{customer.visits}</strong></div>
                  {customer.totalSpent > 0 && (
                    <div className="receipt-reward-line"><span>💳 Lifetime spend</span><strong>{sym}{Number(customer.totalSpent).toFixed(2)}</strong></div>
                  )}
                </>
              ) : (
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  We couldn't find a loyalty account for this number yet — your next visit will start one!
                </p>
              )}
            </div>
          ) : !showLogin ? (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Want to see your points balance and loyalty tier? Log in with your phone — it's optional.
              </p>
              <button
                className="btn mt"
                style={{ width: '100%' }}
                onClick={() => { setShowLogin(true); setLoginError(''); }}
              >
                See More — Log In
              </button>
            </>
          ) : (
            <>
              <h2 className="display" style={{ fontSize: 18 }}>Log in to see more</h2>
              {otpStep === 'phone' ? (
                <>
                  <input
                    className="receipt-input"
                    type="tel"
                    inputMode="tel"
                    placeholder="Your phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loginState === 'sending'}
                  />
                  {loginError && <p className="receipt-inline-error">{loginError}</p>}
                  <button
                    className="btn btn-ketchup mt"
                    style={{ width: '100%' }}
                    onClick={requestOtp}
                    disabled={loginState === 'sending'}
                  >
                    {loginState === 'sending' ? 'Sending…' : 'Send Code'}
                  </button>
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Code sent to {phone.trim()}.
                    {simCode && (
                      <span className="receipt-sim-code"> Demo code: <strong>{simCode}</strong></span>
                    )}
                  </p>
                  <input
                    className="receipt-input mt"
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={loginState === 'verifying'}
                  />
                  {loginError && <p className="receipt-inline-error">{loginError}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      className="btn"
                      style={{ flex: 1 }}
                      onClick={() => { setOtpStep('phone'); setOtpSent(false); setCode(''); setLoginError(''); }}
                      disabled={loginState === 'verifying'}
                    >
                      Back
                    </button>
                    <button
                      className="btn btn-ketchup"
                      style={{ flex: 2 }}
                      onClick={verifyOtp}
                      disabled={loginState === 'verifying' || code.trim().length < 4}
                    >
                      {loginState === 'verifying' ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </motion.div>

        <p className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 18 }}>
          🔒 Your name and number are never shown on this page.
        </p>
      </div>
    </div>
  );
}
