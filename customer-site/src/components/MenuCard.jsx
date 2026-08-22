import { motion } from 'framer-motion';

/** Menu item card — image on the left, name/desc/price/add-btn stacked on the right. */
export default function MenuCard({ item, index, onAdd }) {
  const hasVariant = item.hasConfiguration;

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
      <div className="menu-info">
        <div className="menu-name">
          {item.name}
          {hasVariant && <span className="menu-customize-tag">Customize</span>}
        </div>
        {item.description && (
          <div className="menu-desc">{item.description}</div>
        )}
        <div className="menu-foot">
          <span className="price">₹{Number(item.price || 0).toFixed(2)}</span>
          {item.available ? (
            <motion.button
              className={`add-btn${hasVariant ? ' custom' : ''}`}
              whileTap={{ scale: 0.85 }}
              onClick={() => onAdd(item)}
            >
              {hasVariant ? 'Pick Options' : 'Add +'}
            </motion.button>
          ) : (
            <span className="sold-out-tag">SOLD OUT</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
