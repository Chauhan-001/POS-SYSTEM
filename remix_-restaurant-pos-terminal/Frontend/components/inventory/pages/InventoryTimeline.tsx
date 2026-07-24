import { motion } from 'motion/react';
import { Activity } from 'lucide-react';
import { TIMELINE_ENTRIES } from '../data';
import TimelineCard from '../components/TimelineCard';

export default function InventoryTimeline() {
  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Activity</h1>
        <p className="text-xs text-gray-400 mt-0.5">{TIMELINE_ENTRIES.length} events today</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
      >
        {TIMELINE_ENTRIES.map((entry, i) => (
          <TimelineCard key={entry.id} entry={entry} isLast={i === TIMELINE_ENTRIES.length - 1} />
        ))}
      </motion.div>
    </div>
  );
}