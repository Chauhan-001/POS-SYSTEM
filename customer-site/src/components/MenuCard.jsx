import { motion } from 'framer-motion';

/** Menu item card — flat item, image or emoji, price, SOLD OUT state. */
export default function MenuCard({ item, index, onAdd }) {
  return (
    <motion.div
      className={`menu-card${item.available ? '' : ' is-unavailable'}`}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
    >
      {item.image ? (
        <img className="menu-img" src={item.image} alt={item.name} loading="lazy" />
      ) : (
        <div className="menu-emoji">🍽️</div>
      )}
      <div className="menu-name">{item.name}</div>
      <div className="price">₹{Number(item.price || 0).toFixed(2)}</div>

      {item.available ? (
        <motion.button className="add-btn" whileTap={{ scale: 0.85 }} onClick={() => onAdd(item)}>
          Add +
        </motion.button>
      ) : (
        <span className="sold-out-tag">SOLD OUT</span>
      )}
    </motion.div>
  );
}
