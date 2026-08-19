import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { errMsg } from '../api';
import { getSocket } from '../socket';
import Header from '../components/Header';
import Stepper from '../components/Stepper';
import { Squiggle } from '../components/bits';
import { useSession } from '../context/session';

/** Tracking page: live order status (poll + socket), items, totals, timeline. */
export default function TrackPage() {
  const { type, clientRef, trackOrder } = useSession();
  const navigate = useNavigate();

  const [track, setTrack] = useState(null);
  const [err, setErr] = useState('');

  /* ------------------------- poll + socket refresh ----------------------- */
  const load = useCallback(async () => {
    if (!clientRef) return;
    try {
      const data = await trackOrder();
      if (data) setTrack(data);
    } catch (e) {
      setErr(errMsg(e, 'Could not refresh your order'));
    }
  }, [clientRef, trackOrder]);

  useEffect(() => {
    const poll = async () => {
      await load();
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!clientRef) return;
    const socket = getSocket(clientRef);
    const onUpdate = () => load();
    socket.on('order:updated', onUpdate);
    return () => {
      socket.off('order:updated', onUpdate);
    };
  }, [clientRef, load]);

  const order = track?.order || null;
  const items = track?.items || [];
  const timeline = track?.timeline || [];
  const cancelled = order && ['Cancelled', 'Refunded'].includes(order.status);

  return (
    <div className="page">
      <Header />

      {order && type === 'car' && (
        <motion.div
          className="card card-tilt mb"
          style={{ background: 'var(--teal)', color: '#fff' }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <h2 className="display" style={{ fontSize: 24 }}>
            Delivering to your car 🚗
          </h2>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
            {order.parkingSlot ? `Slot ${order.parkingSlot}` : 'Look out for your order!'}
            {order.carPlate ? ` · ${order.carPlate}` : ''}
          </p>
        </motion.div>
      )}

      {order && type === 'pickup' && (
        <div className="pickup-token">
          <small>Show this at the counter</small>
          <div className="code">#{order.orderNumber}</div>
          <small>{order.status === 'Ready' ? '🔔 It’s ready — go grab it!' : 'We’ll shout when it’s hot'}</small>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}

      {!order && !err && (
        <div className="loader-wrap">
          <div>
            <span className="loader-emoji">🍳</span>
            <h2 className="display">Checking the kitchen…</h2>
          </div>
        </div>
      )}

      {order && (
        <>
          <motion.div
            className={`card mb ${cancelled ? '' : 'card-tilt'}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="row spread">
              <h3 className="display" style={{ fontSize: 18 }}>
                Order #{order.orderNumber}
              </h3>
              <span className={`sticker ${cancelled ? 'sticker-ketchup' : 'sticker-teal'}`}>
                {cancelled ? 'Cancelled' : order.status}
              </span>
            </div>
            <p className="muted" style={{ margin: '6px 0' }}>
              {items.map((it) => `${it.quantity}× ${it.productName}`).join(' · ')}
            </p>
            {cancelled ? (
              <div className="split-result" style={{ transform: 'rotate(1deg)' }}>
                This order was cancelled 😢 — talk to the counter for a refund.
              </div>
            ) : (
              <Stepper status={order.status} />
            )}
          </motion.div>

          {/* totals */}
          <Squiggle color="#2A9D8F" />
          <h2 className="section-title">Bill 🧾</h2>
          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <span>₹{Number(order.subtotal || 0).toFixed(2)}</span>
            </div>
            {order.discount > 0 && (
              <div className="totals-row">
                <span>Discount</span>
                <span>−₹{Number(order.discount).toFixed(2)}</span>
              </div>
            )}
            <div className="totals-row">
              <span>GST</span>
              <span>₹{Number(order.gst || 0).toFixed(2)}</span>
            </div>
            {order.tip > 0 && (
              <div className="totals-row">
                <span>Tip</span>
                <span>₹{Number(order.tip).toFixed(2)}</span>
              </div>
            )}
            <div className="totals-row grand">
              <span>Total</span>
              <span>₹{Number(order.grandTotal || 0).toFixed(2)}</span>
            </div>
          </div>

          {/* timeline */}
          {timeline.length > 0 && (
            <>
              <h2 className="section-title">Updates</h2>
              <div className="stack">
                {[...timeline].reverse().map((t, i) => (
                  <div className="timeline-item" key={i}>
                    <span className="timeline-dot" />
                    <div>
                      <div className="menu-name" style={{ fontSize: 14 }}>{t.description}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="center mt">
            <button className="btn btn-mustard" onClick={() => navigate('..')}>
              + Add more food
            </button>
          </div>
        </>
      )}
    </div>
  );
}
