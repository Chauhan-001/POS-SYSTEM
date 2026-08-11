import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, errMsg } from '../api';
import { useSession } from '../context/session';

const REASONS = [
  { key: 'water', emoji: '💧', label: 'Water' },
  { key: 'tissue', emoji: '🧻', label: 'Tissue' },
  { key: 'bill', emoji: '🧾', label: 'Bill' },
  { key: 'assistance', emoji: '🙋', label: 'Assistance' },
];

/** Floating action button → bottom sheet of waiter-call reasons. */
export default function WaiterFab() {
  const { showToast, waiterCall } = useSession();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (reason, message) => {
    if (sending) return;
    setSending(true);
    try {
      await waiterCall({ type: reason, message });
      showToast('Staff notified! 🙋');
      setOpen(false);
      setCustom('');
    } catch (err) {
      showToast(errMsg(err, 'Could not reach staff'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <motion.button
        className="fab"
        title="Call staff"
        whileTap={{ scale: 0.85 }}
        animate={{ rotate: [0, -6, 6, 0] }}
        transition={{ repeat: Infinity, repeatDelay: 4, duration: 0.6 }}
        onClick={() => setOpen(true)}
      >
        🛎️
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="sheet-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sheet-handle" />
              <h3 className="sheet-title">Need a hand? 🛎️</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Tap once — staff zooms right over.
              </p>
              <div className="waiter-grid">
                {REASONS.map((r) => (
                  <motion.button
                    key={r.key}
                    className="waiter-reason"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => send(r.key)}
                  >
                    <span>{r.emoji}</span>
                    {r.label}
                  </motion.button>
                ))}
              </div>
              <span className="field-label">✏️ Something else?</span>
              <div className="row">
                <input
                  className="input"
                  placeholder="Type your message…"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button
                  className="btn btn-teal"
                  disabled={!custom.trim() || sending}
                  onClick={() => send('custom', custom.trim())}
                >
                  Send
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
