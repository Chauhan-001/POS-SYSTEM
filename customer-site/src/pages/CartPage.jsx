import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { errMsg } from '../api';
import Header from '../components/Header';
import Stamp from '../components/Stamp';
import { Squiggle } from '../components/bits';
import { cartSubtotal, linePrice, useSession } from '../context/session';

const TIP_CHIPS = [0, 10, 20, 30];

/** Cart page: lines, contact info, tip, totals, place-order CTA. */
export default function CartPage() {
  const { qr, type, cart, updateQty, removeLine, placeOrder, showToast } = useSession();
  const navigate = useNavigate();

  const [tip, setTip] = useState(0);
  const [customTip, setCustomTip] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stamped, setStamped] = useState(false);

  const subtotal = cartSubtotal(cart);
  const tax = Math.round(
    cart.reduce((s, l) => s + (Number(l.price) || 0) * l.qty * ((Number(l.gstPercent) || 5) / 100), 0) * 100
  ) / 100;
  const estTotal = Math.round((subtotal + tax + tip) * 100) / 100;

  const submit = async () => {
    if (busy || cart.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await placeOrder({ name: name.trim(), phone: phone.trim(), notes: notes.trim(), tip });
      setStamped(true);
    } catch (err) {
      setError(errMsg(err, 'Order failed — try again'));
      setBusy(false);
    }
  };

  if (cart.length === 0 && !stamped) {
    return (
      <div className="page">
        <Header />
        <div className="empty-state">
          <span className="big-emoji">🛒</span>
          <h1 className="display" style={{ transform: 'rotate(-2deg)' }}>
            Cart’s empty!
          </h1>
          <p className="muted">Your stomach called — it wants fries.</p>
          <button className="btn btn-mustard mt" onClick={() => navigate('..')}>
            Back to menu 🍔
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Header />
      <h1 className="section-title" style={{ marginTop: 0 }}>
        Your tray 🍟
      </h1>

      {cart.map((line, i) => (
        <motion.div
          className="cart-line"
          key={`${line.productId}-${i}`}
          layout
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div
            className="cart-emoji"
            style={{ background: ['var(--mustard)', '#ffd6da', '#bfe8e2'][i % 3] }}
          >
            {line.image ? <img className="cart-img" src={line.image} alt="" /> : '🍽️'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="menu-name">{line.name}</div>
            <span className="price">₹{linePrice(line).toFixed(2)}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="qty-stepper">
              <button onClick={() => updateQty(i, line.qty - 1)}>−</button>
              <span>{line.qty}</span>
              <button onClick={() => updateQty(i, line.qty + 1)}>+</button>
            </div>
            <button
              className="muted"
              style={{ background: 'none', border: 'none', textDecoration: 'underline', marginTop: 6 }}
              onClick={() => removeLine(i)}
            >
              remove
            </button>
          </div>
        </motion.div>
      ))}

      {/* contact (optional for table, required for car — car is pre-gated) */}
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <span className="field-label">Your name</span>
          <input className="input" placeholder="Alex" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <span className="field-label">Phone {type === 'car' ? '*' : '(optional)'}</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="9876543210"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

      <span className="field-label">Notes for the kitchen</span>
      <input className="input" placeholder="No onions, extra spicy…" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {/* tip selector */}
      <span className="field-label">Tip the crew 💛</span>
      <div className="option-row">
        {TIP_CHIPS.map((t) => (
          <button
            key={t}
            className={`option-pill${tip === t && !customTip ? ' selected' : ''}`}
            onClick={() => {
              setTip(t);
              setCustomTip('');
            }}
          >
            {t === 0 ? 'No tip' : `₹${t}`}
          </button>
        ))}
        <input
          className="input"
          style={{ width: 110 }}
          inputMode="numeric"
          placeholder="Custom ₹"
          value={customTip}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            setCustomTip(v);
            setTip(Number(v) || 0);
          }}
        />
      </div>

      {/* totals */}
      <div className="totals mt">
        <div className="totals-row">
          <span>Subtotal</span>
          <span>₹{subtotal.toFixed(2)}</span>
        </div>
        <div className="totals-row">
          <span>GST</span>
          <span>₹{tax.toFixed(2)}</span>
        </div>
        {tip > 0 && (
          <div className="totals-row">
            <span>Tip</span>
            <span>₹{tip.toFixed(2)}</span>
          </div>
        )}
        <div className="totals-row grand">
          <span>Total</span>
          <span>₹{estTotal.toFixed(2)}</span>
        </div>
      </div>

      {error && <div className="error-box mt">{error}</div>}

      <Squiggle />

      <motion.button
        className="btn btn-ketchup btn-block btn-lg"
        whileTap={{ scale: 0.96 }}
        disabled={busy}
        onClick={submit}
      >
        {busy ? 'Placing…' : `Place Order 🍔 — ₹${estTotal.toFixed(2)}`}
      </motion.button>
      <p className="muted center">
        {type === 'table' && 'Pay at the table when you’re done — cash, UPI or card.'}
        {type === 'car' && 'We’ll bring it to your car — pay when it arrives.'}
        {type === 'pickup' && 'Pay at the counter when you pick up.'}
      </p>

      <AnimatePresence>
        {stamped && <Stamp onDone={() => navigate('../track')} />}
      </AnimatePresence>
    </div>
  );
}
