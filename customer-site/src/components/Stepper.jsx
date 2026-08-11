import { motion } from 'framer-motion';

const STEPS = [
  { key: 'placed', label: 'Ordered', emoji: '✅' },
  { key: 'preparing', label: 'Preparing', emoji: '👨‍🍳' },
  { key: 'ready', label: 'Ready', emoji: '🔔' },
  { key: 'done', label: 'Done', emoji: '🍽️' },
];

/** Map POS order statuses (New/Accepted/Preparing/Ready/Served/Paid/Closed) to 4 steps. */
function statusIndex(status) {
  const s = String(status || '').toLowerCase();
  if (['paid', 'closed', 'completed', 'served'].includes(s)) return 3;
  if (s === 'ready') return 2;
  if (['accepted', 'preparing'].includes(s)) return 1;
  return 0;
}

/** Horizontal 4-step progress for a single order. */
export default function Stepper({ status }) {
  const active = statusIndex(status);
  return (
    <div className="stepper">
      {STEPS.map((step, i) => {
        const state = i < active ? 'done' : i === active ? 'active' : 'todo';
        return (
          <div key={step.key} className={`step ${state}`}>
            <motion.span
              className="step-dot"
              animate={state === 'active' ? { scale: [1, 1.25, 1] } : {}}
              transition={{ repeat: state === 'active' ? Infinity : 0, duration: 1.2 }}
            >
              {state === 'done' ? '✓' : step.emoji}
            </motion.span>
            <small>{step.label}</small>
          </div>
        );
      })}
    </div>
  );
}
