import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/session';

/** Sticky app header: brand, mode badge, track & cart buttons. */
export default function Header() {
  const { qr, type, cart, clientRef } = useSession();
  const navigate = useNavigate();
  const count = cart.reduce((s, l) => s + l.qty, 0);

  const modeLabel =
    type === 'table'
      ? `🪑 Table ${qr?.tableNumber || qr?.tableId || ''}`
      : type === 'car'
        ? `🚗 ${qr?.parkingSlot || 'Car'}`
        : '🥡 Pickup';

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-name">{qr?.restaurant?.name || 'QR Ordering'}</span>
        <span className="brand-tag">{qr?.restaurant?.tagline || 'Order in seconds'}</span>
      </div>
      <span className="mode-badge">{modeLabel}</span>
      {clientRef && (
        <button className="icon-btn" title="Track order" onClick={() => navigate('track')}>
          🧾
        </button>
      )}
      <button className="cart-btn" title="Cart" onClick={() => navigate('cart')}>
        🛒
        {count > 0 && (
          <motion.span
            key={count}
            className="cart-count"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.5, 1] }}
            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
          >
            {count}
          </motion.span>
        )}
      </button>
    </header>
  );
}
