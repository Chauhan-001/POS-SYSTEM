import { useEffect } from 'react';
import { motion } from 'framer-motion';

/** Full-screen "order placed" stamp — auto-dismisses into the track page. */
export default function Stamp({ onDone }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      className="stamp-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="stamp"
        initial={{ scale: 2.2, rotate: -14, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      >
        <div className="stamp-big">Order in!</div>
        <div className="stamp-sub">The kitchen is on it 🔥</div>
      </motion.div>
    </motion.div>
  );
}
