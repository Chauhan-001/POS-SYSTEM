import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, Square, Check, X, History, Package, Plus, Trash2, ShoppingCart, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotify, useInventory } from '../InventoryManager';
import type { InventoryItem } from '../types';

type ActionType = 'add_stock' | 'log_waste' | 'add_item' | 'remove_item';

type ParsedAction = {
  type: ActionType;
  summary: string;
  details: string;
};

type LogEntry = {
  id: string;
  type: ActionType;
  summary: string;
  timestamp: string;
};

const actionMeta: Record<ActionType, { icon: typeof Package; color: string }> = {
  add_stock: { icon: ShoppingCart, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  log_waste: { icon: Trash2, color: 'bg-red-50 border-red-200 text-red-700' },
  add_item: { icon: Plus, color: 'bg-blue-50 border-blue-200 text-blue-700' },
  remove_item: { icon: X, color: 'bg-amber-50 border-amber-200 text-amber-700' },
};

function parseCommand(text: string, items: InventoryItem[]): { action: ParsedAction | null; exec: (inv: ReturnType<typeof useInventory>, notify: ReturnType<typeof useNotify>) => void } | null {
  const lower = text.toLowerCase().trim();
  const itemByName = (name: string) => items.find(i => i.name.toLowerCase() === name.toLowerCase());

  // Add stock: "add 20L milk at ₹56 from Amul Dairy"
  let m = lower.match(/^add\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle)?\s+(.+?)(?:\s+at\s+₹?([\d.]+))?(?:\s+from\s+(.+))?$/i);
  if (m) {
    const qty = parseFloat(m[1]);
    const name = m[3].trim();
    const existing = itemByName(name);
    if (existing) {
      return {
        action: { type: 'add_stock', summary: `Add ${qty}${m[2] || existing.unit} ${existing.name}`, details: `${qty} ${existing.unit} of ${existing.name}${m[4] ? ` at ₹${m[4]}/${existing.unit}` : ''}${m[5] ? ` from ${m[5].trim()}` : ''}` },
        exec: (inv) => { inv.addStock(existing.name, qty); }
      };
    }
  }

  // Log waste: "log 2L milk as spoiled" or "waste 3 bread expired"
  m = lower.match(/(?:log|waste)\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle)?\s+(.+?)(?:\s+as\s+(spoiled|burnt|expired|dropped|other))?$/i);
  if (m) {
    const qty = parseFloat(m[1]);
    const name = m[3].trim();
    const reason = m[4] || 'spoiled';
    const existing = itemByName(name);
    if (existing) {
      return {
        action: { type: 'log_waste', summary: `Log ${qty}${m[2] || existing.unit} ${existing.name} as ${reason}`, details: `${qty} ${existing.unit} ${existing.name} — ${reason} (₹${Math.round(qty * existing.averageCost)} loss)` },
        exec: (inv, notify) => { inv.removeStock(existing.name, qty); notify(`${qty} ${existing.unit} ${existing.name} logged as waste`, 'warning'); }
      };
    }
  }

  // Add item: "add item Paneer in Dairy, stock 5kg, min 2, max 10, ₹320, supplier Amul Dairy"
  m = lower.match(/^add\s+item\s+(.+?)(?:\s+in\s+(.+?))?(?:\s*,\s*stock\s+([\d.]+)\s*(l|kg|pcs|g|ml|dozen|packet|bottle))?(?:\s*,\s*min\s+([\d.]+))?(?:\s*,\s*max\s+([\d.]+))?(?:\s*,\s*₹?([\d.]+))?(?:\s*,\s*supplier\s+(.+))?$/i);
  if (m) {
    const name = m[1].trim();
    if (itemByName(name)) return null;
    const category = m[2]?.trim() || 'Other';
    const stock = m[3] ? parseFloat(m[3]) : 0;
    const unit = m[4] || 'kg';
    const minStock = m[5] ? parseFloat(m[5]) : 5;
    const maxStock = m[6] ? parseFloat(m[6]) : 50;
    const cost = m[7] ? parseFloat(m[7]) : 0;
    const supplier = m[8]?.trim() || 'Local Vendor';
    const status: InventoryItem['status'] = stock <= 0 ? 'critical' : stock <= minStock ? 'low' : 'healthy';
    return {
      action: { type: 'add_item', summary: `Add new item: ${name}`, details: `${name} in ${category} · Stock: ${stock}${unit} · Min: ${minStock} · Max: ${maxStock} · ₹${cost}/${unit} · ${supplier}` },
      exec: (inv) => {
        inv.addItem({
          id: `inv_voice_${Date.now()}`, name, category, unit, image: '',
          currentStock: stock, minStock, maxStock, averageCost: cost, supplier,
          status, lastUpdated: new Date().toISOString().slice(0, 10),
        });
      }
    };
  }

  // Remove item: "remove Milk" or "delete Bread"
  m = lower.match(/(?:remove|delete)\s+(.+?)(?:\s+from\s+inventory)?$/i);
  if (m) {
    const name = m[1].trim();
    const existing = itemByName(name);
    if (existing) {
      return {
        action: { type: 'remove_item', summary: `Remove ${existing.name}`, details: `Delete "${existing.name}" (${existing.category}) — ${existing.currentStock} ${existing.unit} in stock` },
        exec: (inv) => { inv.removeItem(existing.id); }
      };
    }
  }

  return null;
}

export default function VoicePage() {
  const notify = useNotify();
  const inventory = useInventory();
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [parsed, setParsed] = useState<{ action: ParsedAction; exec: (inv: typeof inventory) => void } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [listeningText, setListeningText] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => { if (recognitionRef.current) recognitionRef.current.abort(); };
  }, []);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { notify('Voice not supported. Type your command instead.', 'warning'); return; }
    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setListeningText(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        setInput(transcript);
        setIsListening(false);
        analyze(transcript);
      }
    };
    recognition.onerror = () => { notify('Voice failed. Try typing.', 'warning'); setIsListening(false); };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setListeningText('');
  }, [notify]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
    setIsListening(false);
  }, []);

  const analyze = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = parseCommand(trimmed, inventory.items);
    if (!result) { notify('Could not understand. Try: "add 20L milk", "log 2 bread as expired", "add item Paneer in Dairy", or "remove Milk"', 'warning'); return; }
    setParsed({ action: result.action, exec: (inv: typeof inventory) => result.exec(inv, notify) });
    setInput('');
  };

  const confirmAction = () => {
    if (!parsed) return;
    parsed.exec(inventory);
    setLog(prev => [{
      id: `log_${Date.now()}`,
      type: parsed.action.type,
      summary: parsed.action.summary,
      timestamp: new Date().toLocaleTimeString(),
    }, ...prev]);
    setParsed(null);
  };

  const examples = [
    { text: 'Add 20L milk at ₹56', icon: ShoppingCart },
    { text: 'Log 3 bread as expired', icon: Trash2 },
    { text: 'Add item Paneer in Dairy', icon: Plus },
    { text: 'Remove Tea Powder', icon: X },
  ];

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Voice AI</h1>
        <p className="text-xs text-gray-400 mt-0.5">Add stock, log waste, add or remove items — just say it</p>
      </div>

      {/* Voice / Input area */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-4">
          <button onClick={isListening ? stopListening : startListening}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg ${
              isListening ? 'bg-red-500 scale-110 shadow-red-200 animate-pulse' : 'bg-[#004ac6] hover:bg-[#003ea8] hover:scale-105'
            }`}
          >
            {isListening ? <Square className="w-7 h-7 text-white" /> : <Mic className="w-7 h-7 text-white" />}
          </button>

          {isListening && (
            <div className="flex items-center gap-1 h-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="w-1 bg-[#004ac6] rounded-full animate-pulse"
                  style={{ height: `${30 + Math.random() * 70}%`, animationDelay: `${i * 0.08}s` }} />
              ))}
            </div>
          )}
          <p className="text-xs font-semibold text-gray-500">
            {isListening ? (listeningText || 'Listening...') : 'Tap mic or type a command'}
          </p>

          {!isListening && (
            <div className="w-full flex gap-2">
              <div className="relative flex-1">
                <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') analyze(input); }}
                  className="w-full pl-9 pr-3 py-3 bg-gray-50 border border-[#e1e2ed] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6]"
                  placeholder='e.g. "add 20L milk at ₹56 from Amul Dairy"' />
              </div>
              <button onClick={() => analyze(input)}
                className="px-5 py-3 bg-[#004ac6] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm"
              >Go</button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Command examples */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        {examples.map((ex, i) => (
          <button key={i} onClick={() => { setInput(ex.text); }}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-[#e1e2ed] rounded-xl text-[10px] font-semibold text-gray-500 hover:border-[#004ac6]/30 hover:text-[#004ac6] transition-all cursor-pointer"
          >
            <ex.icon className="w-3 h-3 shrink-0" />
            {ex.text}
          </button>
        ))}
      </motion.div>

      {/* Confirmation card */}
      <AnimatePresence>
        {parsed && (
          <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-2xl border-2 border-[#004ac6] shadow-lg overflow-hidden"
          >
            <div className="px-5 py-3 bg-[#004ac6]/5 border-b border-[#004ac6]/10 flex items-center gap-2">
              <Check className="w-4 h-4 text-[#004ac6]" />
              <span className="text-xs font-bold text-[#004ac6]">Confirm Action</span>
            </div>
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${actionMeta[parsed.action.type].color}`}>
                  {(() => { const Icon = actionMeta[parsed.action.type].icon; return <Icon className="w-6 h-6" />; })()}
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold">{parsed.action.summary}</p>
                  <p className="text-sm text-gray-500 mt-1">{parsed.action.details}</p>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-[#e1e2ed]">
                <button onClick={() => setParsed(null)}
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all cursor-pointer flex items-center gap-2"
                ><X className="w-4 h-4" /> Cancel</button>
                <button onClick={confirmAction}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all cursor-pointer shadow-sm flex items-center gap-2"
                ><Check className="w-4 h-4" /> Confirm</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action log */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm"
      >
        <div className="px-5 py-4 border-b border-[#e1e2ed] flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold">Action Log</h2>
          {log.length > 0 && <span className="text-[10px] text-gray-400 ml-auto">{log.length} actions</span>}
        </div>
        {log.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <MessageSquare className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-400">No actions yet</p>
            <p className="text-xs text-gray-300 mt-1">Confirmed commands appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e1e2ed]">
            {log.map(entry => {
              const Icon = actionMeta[entry.type].icon;
              return (
                <div key={entry.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${actionMeta[entry.type].color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{entry.summary}</p>
                    <p className="text-[10px] text-gray-400">{entry.timestamp}</p>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Done</span>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
