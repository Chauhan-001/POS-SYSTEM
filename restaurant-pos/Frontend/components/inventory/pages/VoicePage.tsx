import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Mic, Square, Check, X, History, Package, Plus, Minus, Trash2,
  ShoppingCart, MessageSquare, AlertTriangle, Loader2, Sparkles, Globe,
  ArrowRight, HelpCircle, Volume2, ChevronDown, ChevronUp, Wand2,
  RotateCcw, CalendarDays, Tag, Hourglass,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Modal from '../components/Modal';
import { useNotify, useInventory } from '../InventoryManager';
import apiClient from '../../../src/api/axios';

// ====================================================================
// TYPES
// ====================================================================

type IntentType =
  | 'inventory_add'
  | 'inventory_remove'
  | 'inventory_adjust'
  | 'inventory_waste'
  | 'purchase_reminder'
  | 'supplier_update'
  | 'unknown';

interface ParsedItem {
  item: string;
  quantity: number;
  unit?: string;
  canonicalName?: string;
  productId?: string;
  resolutionConfidence?: number;
  ambiguous?: boolean;
  candidates?: Array<{ name: string; unit?: string; currentStock?: number }>;
  /** Purchase rate (₹/unit) detected from the spoken command. */
  rate?: number;
}

interface VoiceParseResult {
  success: boolean;
  auditLogId?: string;
  pendingActionId?: string;
  confirmationToken?: string;
  confirmationExpiresAt?: string;
  transcript?: string;
  parsed?: {
    intent: IntentType;
    items: ParsedItem[];
    confidence: number;
    language?: string;
    originalText: string;
    error?: string;
    /** Supplier/vendor named in the command ("... from Verka Dairy"). */
    supplier?: string;
    /** Purchase date (YYYY-MM-DD) — defaults to today when not spoken. */
    date?: string;
    /** Brand/variant named in the command ("Amul brand butter"). */
    brand?: string;
    /** Expiry date of the incoming batch ("expiry 31 Dec 2026"). */
    expiryDate?: string;
  };
  missingFields?: string[];
  suggestions?: string[];
  confirmation?: {
    transcript: string;
    intent: IntentType;
    items: ParsedItem[];
    confidence: number;
    missingFields: string[];
    suggestions?: string[];
  };
  error?: string;
  latencyMs: number;
}

interface ConfirmationResult {
  success: boolean;
  data?: {
    operation: string;
    updatedItems: Array<{ itemName: string; previousStock: number; newStock: number; unit: string }>;
    totalChanges: number;
  };
  error?: string;
  errors?: string[];
}

/** One entry in the local "Recent Actions" feed. */
type LogEntry = {
  id: string;
  intent: IntentType;
  summary: string;
  timestamp: string;
  /** Backend VoiceAuditLog id — present only for confirmed, undoable actions. */
  auditLogId?: string;
  /** Authoritative stock changes the server applied (for the undo summary). */
  appliedItems?: Array<{ itemName: string; previousStock: number; newStock: number; unit: string }>;
  /** True once the action has been successfully undone (undo button hidden). */
  undone?: boolean;
};

type DiagState = {
  open: boolean;
  info: { label: string; value: string }[];
};

// ====================================================================
// INTENT METADATA
// ====================================================================

const INTENT_META: Record<IntentType, {
  icon: typeof ShoppingCart;
  label: string;
  verb: string;
  color: string;
  emoji: string;
}> = {
  inventory_add: {
    icon: ShoppingCart, label: 'Add Stock', verb: 'Add',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200', emoji: '📦',
  },
  inventory_remove: {
    icon: Trash2, label: 'Remove Stock', verb: 'Remove',
    color: 'bg-amber-100 text-amber-700 border-amber-200', emoji: '⬇️',
  },
  inventory_adjust: {
    icon: Plus, label: 'Adjust Stock', verb: 'Set',
    color: 'bg-blue-100 text-blue-700 border-blue-200', emoji: '✏️',
  },
  inventory_waste: {
    icon: Trash2, label: 'Log Waste', verb: 'Waste',
    color: 'bg-red-100 text-red-700 border-red-200', emoji: '🗑️',
  },
  purchase_reminder: {
    icon: ShoppingCart, label: 'Purchase Reminder', verb: 'Order',
    color: 'bg-purple-100 text-purple-700 border-purple-200', emoji: '📋',
  },
  supplier_update: {
    icon: Package, label: 'Supplier Update', verb: 'Update',
    color: 'bg-indigo-100 text-indigo-700 border-indigo-200', emoji: '🏢',
  },
  unknown: {
    icon: HelpCircle, label: 'Unknown', verb: '?',
    color: 'bg-gray-100 text-gray-600 border-gray-200', emoji: '❓',
  },
};

const LANGUAGES = [
  { code: 'hi-en', label: 'Hinglish', native: 'हिंग्लिश' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

const EXAMPLES: { text: string; emoji: string; intent: IntentType }[] = [
  { text: 'Add 20 kg flour', emoji: '📦', intent: 'inventory_add' },
  { text: 'Log 3 paneer spoiled', emoji: '🗑️', intent: 'inventory_waste' },
  { text: 'Remove 5 litre oil', emoji: '⬇️', intent: 'inventory_remove' },
  { text: 'Order reminder: tomato', emoji: '📋', intent: 'purchase_reminder' },
  { text: '20 kilo aata add karo', emoji: '🎤', intent: 'inventory_add' },
  { text: 'Update supplier of bread', emoji: '🏢', intent: 'supplier_update' },
];

const stepFor = (unit?: string): number => {
  const u = (unit || 'pcs').toLowerCase();
  return u === 'kg' || u === 'l' || u === 'litre' || u === 'liter' || u === 'ml' || u === 'g' || u === 'gram'
    ? 0.5
    : 1;
};

const getSpeechLang = (langCode: string): string => {
  const map: Record<string, string> = { 'hi-en': 'hi-IN', hi: 'hi-IN', en: 'en-IN' };
  return map[langCode] || 'hi-IN';
};

// ====================================================================
// COMPONENT
// ====================================================================

export default function VoicePage() {
  const notify = useNotify();
  const inventory = useInventory();

  // Input state
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('hi-en');
  const [isListening, setIsListening] = useState(false);
  const [listeningText, setListeningText] = useState('');

  // Parse state
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<VoiceParseResult | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);

  // Confirmation UI state
  const [rowQtys, setRowQtys] = useState<Record<number, number>>({});
  const [rowPicks, setRowPicks] = useState<Record<number, string>>({});
  const [rowRates, setRowRates] = useState<Record<number, number | ''>>({});
  // Purchase date shown in the confirm panel — editable so a misheard spoken
  // date (e.g. "kal" parsed as today) can be corrected before confirming.
  // Initialized from the parse result (which defaults to today when none was
  // spoken) and sent back to the server on confirm.
  const [editableDate, setEditableDate] = useState('');
  // Supplier/vendor shown in the confirm panel — editable so a misheard
  // supplier can be corrected (or added when one wasn't spoken). Sent back
  // to the server on confirm; empty string means "no supplier".
  const [editableSupplier, setEditableSupplier] = useState('');
  // Brand/variant shown in the confirm panel — the same product can come from
  // different brands, so it's editable too. Empty string means "not mentioned".
  const [editableBrand, setEditableBrand] = useState('');
  // Expiry date of the incoming batch — editable date picker; empty means
  // "not mentioned" (the product keeps whatever expiry it already has).
  const [editableExpiry, setEditableExpiry] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);

  // Error + diagnostics (friendly banner, collapsible technical details)
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagState>({ open: false, info: [] });

  // Recent actions
  const [log, setLog] = useState<LogEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_voice_log') || '[]');
    } catch {
      return [];
    }
  });

  // Undo confirmation
  const [undoTarget, setUndoTarget] = useState<LogEntry | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const waveBars = useMemo(() => {
    if (!isListening) return [];
    return Array.from({ length: 24 }).map((_, i) => ({
      key: i,
      height: `${15 + Math.random() * 75}%`,
      delay: `${i * 0.05}s`,
      duration: `${0.5 + Math.random() * 0.6}s`,
    }));
  }, [isListening]);

  // Persist the recent-actions log
  useEffect(() => {
    try {
      localStorage.setItem('pos_voice_log', JSON.stringify(log.slice(0, 25)));
    } catch { /* storage full — ignore */ }
  }, [log]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ==================================================================
  // AI PARSE
  // ==================================================================

  const analyze = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsParsing(true);
    setError(null);
    setDiag({ open: false, info: [] });
    setParsedResult(null);
    setConfirmDone(false);
    setLogId(null);
    setPendingActionId(null);
    setConfirmationToken(null);
    setRowQtys({});
    setRowPicks({});
    setRowRates({});
    setEditableDate('');
    setEditableSupplier('');
    setEditableBrand('');
    setEditableExpiry('');

    try {
      // Uses the app's authenticated axios client so an expired JWT is
      // auto-refreshed instead of surfacing "Invalid or expired token".
      const { data } = await apiClient.post('/voice-inventory/parse', {
        transcript: trimmed,
        language,
        items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
      });
      const result: VoiceParseResult = data;

      if (!result.success || !result.parsed) {
        const info = [
          { label: 'Request URL', value: '/api/voice-inventory/parse' },
          ...(result?.error ? [{ label: 'Backend error', value: result.error }] : []),
        ];
        setDiag({ open: false, info });
        setError(result?.error || 'Could not understand. Try "add 20L milk" or "log 3 bread as expired".');
        return;
      }

      if (result.parsed.intent === 'unknown') {
        setDiag({ open: false, info: [{ label: 'Intent', value: 'unknown' }] });
        setError('I did not catch an inventory action. Try "add 5 kg flour" or "log 2 paneer waste".');
        return;
      }

      setParsedResult(result);
      // Seed the editable date/supplier from what was heard — date defaults to
      // today when none was spoken, supplier to empty.
      setEditableDate(result.parsed?.date || new Date().toISOString().slice(0, 10));
      setEditableSupplier(result.parsed?.supplier || '');
      setEditableBrand(result.parsed?.brand || '');
      setEditableExpiry(result.parsed?.expiryDate || '');
      if (result.auditLogId) setLogId(result.auditLogId);
      if (result.pendingActionId && result.confirmationToken) {
        setPendingActionId(result.pendingActionId);
        setConfirmationToken(result.confirmationToken);
      }
      setInput('');
    } catch (err: any) {
      console.error('[VoicePage] Parse error (full):', err);
      const backendMsg = err?.response?.data?.error;
      setDiag({
        open: false,
        info: [
          { label: 'Endpoint', value: '/api/voice-inventory/parse' },
          ...(err?.response?.status ? [{ label: 'HTTP status', value: String(err.response.status) }] : []),
          ...(backendMsg ? [{ label: 'Backend error', value: backendMsg }] : []),
          { label: 'Frontend error', value: err?.message || String(err) },
        ],
      });
      setError(backendMsg || err?.message || 'Failed to connect. Is the backend running?');
    } finally {
      setIsParsing(false);
    }
  }, [inventory.items, language]);

  // ==================================================================
  // CONFIRM / CANCEL (server-authoritative, token-based)
  // ==================================================================

  const handleConfirm = useCallback(async () => {
    if (!parsedResult?.parsed?.items.length) return;

    const editedItems = parsedResult.parsed.items.map((item, i) => ({
      name: rowPicks[i] || item.canonicalName || item.item,
      quantity: rowQtys[i] ?? item.quantity,
      unit: item.unit || 'pcs',
      productId: item.productId,
      // Send the (possibly edited) spoken rate so the server records it as
      // the purchase rate/averageCost on add.
      rate: rowRates[i] === '' ? undefined : rowRates[i] ?? item.rate,
    }));
    // Corrected purchase date — the server uses it for the purchase record.
    const confirmDate = editableDate || parsedResult.parsed.date;
    // Corrected supplier — trimmed; empty means "no supplier" (server records
    // the purchase with just the rate, or skips it when neither is present).
    const confirmSupplier = editableSupplier.trim() || undefined;
    // Corrected brand — trimmed; empty means "not mentioned" (server records
    // the purchase without a brand).
    const confirmBrand = editableBrand.trim() || undefined;
    // Corrected expiry — empty means "not mentioned" (product keeps its own).
    const confirmExpiry = editableExpiry || undefined;

    setIsConfirming(true);
    setError(null);
    try {
      let result: ConfirmationResult;
      if (pendingActionId && confirmationToken) {
        const { data } = await apiClient.post('/voice-inventory/confirm', {
          pendingActionId, confirmationToken, action: 'confirm', editedItems,
          date: confirmDate, supplier: confirmSupplier, brand: confirmBrand, expiryDate: confirmExpiry,
        });
        result = data;
      } else if (logId) {
        const { data } = await apiClient.post('/voice-inventory/confirm', {
          logId, action: 'confirm', editedItems,
          date: confirmDate, supplier: confirmSupplier, brand: confirmBrand, expiryDate: confirmExpiry,
        });
        result = data;
      } else {
        setError('Missing confirmation token — please run the command again.');
        return;
      }

      if (result.success) {
        const meta = INTENT_META[parsedResult.parsed!.intent];
        setLog(prev => [{
          id: `log_${Date.now()}`,
          intent: parsedResult.parsed!.intent,
          summary: `${meta.emoji} ${meta.label}: ${editedItems.map(e => `${e.quantity}${e.unit} ${e.name}`).join(', ')}`,
          timestamp: new Date().toLocaleTimeString(),
          // Keep the backend audit-log id + applied stock deltas so the
          // Recent Actions row can offer a precise server-side undo. `logId`
          // state holds the auditLogId returned by the parse response.
          auditLogId: result.data?.operation ? logId || undefined : undefined,
          appliedItems: result.data?.updatedItems,
        }, ...prev]);

        // Server is authoritative — re-pull the catalog so auto-created
        // items and updated stock appear immediately.
        inventory.refreshItems().catch(() => {});
        setConfirmDone(true);
        notify(`${meta.label} complete — ${editedItems.length} item(s) updated`, 'success');

        setTimeout(() => {
          setParsedResult(null);
          setConfirmDone(false);
          setLogId(null);
          setPendingActionId(null);
          setConfirmationToken(null);
          setRowQtys({});
          setRowPicks({});
          setRowRates({});
          setEditableDate('');
          setEditableSupplier('');
          setEditableBrand('');
          setEditableExpiry('');
        }, 1600);
      } else {
        const msg = Array.isArray(result.errors) && result.errors.length
          ? result.errors.join(' ')
          : (result.error || 'Confirmation failed — please try again.');
        setError(msg);
        setDiag({
          open: false,
          info: [
            { label: 'Endpoint', value: '/api/voice-inventory/confirm' },
            { label: 'Items', value: JSON.stringify(editedItems) },
            ...(result.error ? [{ label: 'Backend error', value: result.error }] : []),
          ],
        });
      }
    } catch (err: any) {
      console.error('[VoicePage] Confirm error:', err);
      const backendMsg = err?.response?.data?.error;
      setError(backendMsg || err?.message || 'Confirmation failed — network error.');
    } finally {
      setIsConfirming(false);
    }
  }, [parsedResult, logId, pendingActionId, confirmationToken, rowQtys, rowPicks, editableDate, editableSupplier, editableBrand, editableExpiry, inventory, notify]);

  // ==================================================================
  // UNDO A RECENT ACTION (server-authoritative reverse)
  // ==================================================================

  const handleUndo = useCallback(async () => {
    if (!undoTarget?.auditLogId || isUndoing) return;
    setIsUndoing(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/voice-inventory/undo', {
        logId: undoTarget.auditLogId,
      });
      if (data?.success) {
        const items = (data?.data?.updatedItems || [])
          .map((u: any) => `${u.newStock}${u.unit} ${u.itemName}`)
          .join(', ');
        // Mark the row as undone (keep it visible so the history is honest).
        setLog(prev => prev.map(e => e.id === undoTarget.id ? { ...e, undone: true } : e));
        // Server is authoritative — re-pull the catalog so the reverted stock
        // shows immediately across the inventory module.
        inventory.refreshItems().catch(() => {});
        notify(`Undone: ${undoTarget.summary.replace(/^[^ ]+ /, '')}${items ? ` → ${items}` : ''}`, 'success');
        setUndoTarget(null);
      } else {
        const msg = Array.isArray(data?.errors) && data.errors.length
          ? data.errors.join(' ')
          : (data?.error || 'Could not undo this action.');
        setError(msg);
        notify(msg, 'warning');
      }
    } catch (err: any) {
      console.error('[VoicePage] Undo error:', err);
      const backendMsg = err?.response?.data?.error;
      const friendly = backendMsg || err?.message || 'Undo failed — network error.';
      setError(friendly);
      notify(friendly, 'warning');
    } finally {
      setIsUndoing(false);
    }
  }, [undoTarget, isUndoing, inventory, notify]);

  const handleCancel = useCallback(() => {
    // Best-effort server cancel — consumes/rejects the pending token.
    if (pendingActionId && confirmationToken) {
      apiClient.post('/voice-inventory/confirm', { pendingActionId, confirmationToken, action: 'cancel' }).catch(() => {});
    } else if (logId) {
      apiClient.post('/voice-inventory/confirm', { logId, action: 'cancel' }).catch(() => {});
    }
    setParsedResult(null);
    setError(null);
    setDiag({ open: false, info: [] });
    setLogId(null);
    setPendingActionId(null);
    setConfirmationToken(null);
    setRowQtys({});
    setRowPicks({});
    setRowRates({});
    setEditableDate('');
    setEditableSupplier('');
    setEditableBrand('');
    setEditableExpiry('');
  }, [logId, pendingActionId, confirmationToken]);

  // ==================================================================
  // MIC / RECORDING
  // ==================================================================

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const transcribeAudioBlob = useCallback(async (blob: Blob) => {
    setIsListening(false);
    setListeningText('Transcribing audio...');
    try {
      const audioBase64 = await blobToBase64(blob);
      const { data } = await apiClient.post('/voice-inventory/transcribe', {
        audio: audioBase64,
        audioMimeType: blob.type || 'audio/webm',
        language,
      });
      const result = data;
      if (!result.success || !result.transcript) {
        setError(result.error || 'No speech detected. Try again or type instead.');
        return;
      }
      setInput(result.transcript);
      await analyze(result.transcript);
    } catch (err: any) {
      console.error('[VoicePage] Transcribe error:', err);
      const backendMsg = err?.response?.data?.error;
      setError(backendMsg || err?.message || 'Transcription failed. Type your command instead.');
    } finally {
      setIsListening(false);
    }
  }, [language, analyze]);

  const startMediaRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Microphone not available in this browser. Type your command instead.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        await transcribeAudioBlob(blob);
      };
      recorder.onerror = (e: any) => {
        console.error('[VoicePage] MediaRecorder error:', e?.error || e);
        stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        setError('Recording failed. Type your command instead.');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
      setListeningText('');
    } catch (err: any) {
      console.error('[VoicePage] Mic error:', err?.name, err?.message);
      setIsListening(false);
      setError(`Microphone access denied (${err?.name || err?.message || 'unknown'}). Type instead.`);
    }
  }, [transcribeAudioBlob]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isElectron = !!(window as any).electronAPI;

    // In Electron the Web Speech API cannot reach its service — always use the
    // backend STT chain there.
    if (!SR || isElectron) {
      startMediaRecording();
      return;
    }

    const recognition = new SR();
    recognition.lang = getSpeechLang(language);
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setListeningText(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        setInput(transcript);
        setIsListening(false);
        analyze(transcript);
      }
    };
    recognition.onerror = (e: any) => {
      console.error('[VoicePage] SpeechRecognition error:', e?.error);
      setIsListening(false);
      if (e?.error === 'no-speech') {
        setError('No speech detected. Try again or type instead.');
        return;
      }
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'network') {
        startMediaRecording();
        return;
      }
      setError(`Voice error (${e?.error || 'unknown'}). Try typing instead.`);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setListeningText('');
  }, [language, startMediaRecording, analyze]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  // ==================================================================
  // RENDER HELPERS
  // ==================================================================

  const renderConfidenceBadge = (confidence: number) => {
    const level = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
    const colors = {
      high: 'bg-emerald-100 text-emerald-700',
      medium: 'bg-amber-100 text-amber-700',
      low: 'bg-red-100 text-red-700',
    };
    const labels = { high: 'High', medium: 'Medium', low: 'Low' };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[level]}`}>
        {labels[level]} confidence
      </span>
    );
  };

  // ==================================================================
  // MAIN RENDER
  // ==================================================================

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* ===== HEADER ===== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--brand-color)] to-blue-600 flex items-center justify-center shadow-md">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-gray-900 flex items-center gap-2">
              Voice AI
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                ● AI Ready
              </span>
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Add stock, log waste, update items — just speak naturally
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-[#e1e2ed] rounded-xl p-0.5 shadow-xs">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`px-2.5 py-1.5 rounded-[10px] text-[10px] font-bold transition-all cursor-pointer ${
                  language === l.code
                    ? 'bg-[var(--brand-color)] text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {l.native}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLog([])}
            disabled={log.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e1e2ed] rounded-xl text-[10px] font-bold text-gray-500 hover:border-red-300 hover:text-red-600 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear action history"
          >
            <Trash2 className="w-3 h-3" /> Clear log
          </button>
        </div>
      </div>

      {/* Main grid — 2:3 proportion: the Active Command Panel (right) gets the
          majority of the width so multi-item confirmations have room to breathe. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* ===== LEFT — MICROPHONE / VOICE INPUT (2/5) ===== */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-[var(--brand-color)]/[0.05] via-white to-blue-50/40 rounded-2xl border border-[var(--brand-color)]/15 shadow-sm lg:col-span-2 overflow-hidden"
        >
          {/* Section header — visually differentiates the input panel from the command panel */}
          <div className="px-4 py-2.5 border-b border-[var(--brand-color)]/10 bg-white/60 flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[var(--brand-color)]/10 flex items-center justify-center">
              <Mic className="w-3.5 h-3.5 text-[var(--brand-color)]" />
            </div>
            <span className="text-[10px] font-black text-gray-700 uppercase tracking-wider">Voice Input</span>
            {isListening && (
              <span className="ml-auto flex items-center gap-1 text-[9px] font-bold text-red-500">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                REC
              </span>
            )}
          </div>
          <div className="flex flex-col items-center gap-3 p-5">
            {/* Mic button */}
            <button
              onClick={isListening ? stopListening : startListening}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg ring-4 ${
                isListening
                  ? 'bg-red-500 scale-110 shadow-red-200 ring-red-100 animate-pulse'
                  : 'bg-gradient-to-br from-[var(--brand-color)] to-blue-600 hover:scale-105 hover:shadow-[var(--brand-color)]/30 ring-[var(--brand-color)]/15'
              }`}
              title={isListening ? 'Stop recording' : 'Tap to speak'}
            >
              {isListening ? <Square className="w-7 h-7 text-white" /> : <Mic className="w-7 h-7 text-white" />}
            </button>

            {/* Waveform */}
            {isListening && waveBars.length > 0 && (
              <div className="flex items-center gap-0.5 h-8">
                {waveBars.map(bar => (
                  <div
                    key={bar.key}
                    className="w-[3px] bg-gradient-to-t from-[var(--brand-color)] to-blue-400 rounded-full animate-pulse"
                    style={{ height: bar.height, animationDelay: bar.delay, animationDuration: bar.duration }}
                  />
                ))}
              </div>
            )}

            <p className="text-[11px] font-semibold text-gray-500">
              {isListening
                ? (listeningText || 'Listening...')
                : isParsing
                  ? 'AI is parsing your command...'
                  : 'Tap the mic or type a command'}
            </p>

            {/* Friendly error banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="w-full bg-red-50 border border-red-200 rounded-2xl overflow-hidden"
                >
                  <div className="p-3.5 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-red-700 font-medium leading-relaxed">{error}</p>
                      {diag.info.length > 0 && (
                        <button
                          onClick={() => setDiag(d => ({ ...d, open: !d.open }))}
                          className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer"
                        >
                          {diag.open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {diag.open ? 'Hide technical details' : 'Show technical details'}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => { setError(null); setDiag({ open: false, info: [] }); }}
                      className="text-red-400 hover:text-red-600 cursor-pointer shrink-0"
                      title="Dismiss"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {diag.open && diag.info.length > 0 && (
                    <div className="px-3.5 pb-3.5 space-y-1.5 font-mono text-[10px]">
                      {diag.info.map((row, i) => (
                        <div key={i} className="bg-white rounded-lg px-2.5 py-1.5 border border-red-100">
                          <span className="text-red-500 font-bold uppercase tracking-wide">{row.label}: </span>
                          <span className="text-red-800 break-all">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Text input */}
            {!isListening && !isParsing && (
              <div className="w-full flex gap-2">
                <div className="relative flex-1">
                  <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') analyze(input); }}
                    className="w-full pl-9 pr-3 py-3 bg-gray-50 border border-[#e1e2ed] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all"
                    placeholder={
                      language === 'hi'
                        ? 'जैसे "20 kg aata add karo" या "3 paneer waste"'
                        : language === 'hi-en'
                          ? 'Try: "20 kg aata add karo" or "3 paneer waste"'
                          : 'Try: "add 20L milk" or "log 3 bread expired"'
                    }
                  />
                </div>
                <button
                  onClick={() => analyze(input)}
                  disabled={!input.trim()}
                  className="px-5 py-3 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Go
                </button>
              </div>
            )}

            {isParsing && (
              <div className="flex items-center gap-2 text-xs text-[var(--brand-color)] font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                AI is parsing your command...
              </div>
            )}
          </div>
        </motion.div>

        {/* ===== RIGHT — ACTIVE COMMAND / CONFIRMATION (3/5) ===== */}
        <div className="lg:col-span-3">
          <AnimatePresence mode="wait">
          {parsedResult?.parsed ? (
            <motion.div
              key="active-command"
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white rounded-2xl border-2 border-[var(--brand-color)] shadow-lg overflow-hidden"
            >
              <div className="px-5 py-3 bg-[var(--brand-color)]/5 border-b border-[var(--brand-color)]/10 flex items-center gap-2">
                {confirmDone ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Wand2 className="w-4 h-4 text-[var(--brand-color)]" />
                )}
                <span className={`text-xs font-bold ${confirmDone ? 'text-emerald-600' : 'text-[var(--brand-color)]'}`}>
                  {confirmDone ? 'Done!' : 'Confirm your command'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-base leading-none">{INTENT_META[parsedResult.parsed.intent].emoji}</span>
                  <span className="text-[10px] font-bold text-gray-500">{INTENT_META[parsedResult.parsed.intent].label}</span>
                  {renderConfidenceBadge(parsedResult.parsed.confidence)}
                </div>
              </div>

              <div className="p-5">
                {/* What the user said */}
                <div className="bg-gray-50 rounded-xl px-3.5 py-2.5 mb-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">You said</p>
                  <p className="text-sm text-gray-700">“{parsedResult.transcript}”</p>
                </div>

                {/* Missing fields / suggestions */}
                {parsedResult.missingFields && parsedResult.missingFields.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mb-3">
                    <p className="text-[11px] font-bold text-amber-800 mb-1">⚠️ Missing information</p>
                    <ul className="space-y-0.5">
                      {parsedResult.missingFields.map((f, i) => (
                        <li key={i} className="text-[11px] text-amber-700">• {f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Supplier chip + editable purchase date — the date heard in
                    the command can be corrected before confirming (voice adds
                    record it into the purchases feed + item history). */}
                {(parsedResult.parsed.supplier || parsedResult.parsed.date || parsedResult.parsed.intent === 'inventory_add') && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {(parsedResult.parsed.supplier || parsedResult.parsed.intent === 'inventory_add') && (
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100/70 transition-all"
                        title="Supplier — tap to correct a misheard vendor"
                      >
                        <Package className="w-3 h-3 shrink-0" />
                        <span className="uppercase tracking-wide text-indigo-400 text-[9px]">Supplier</span>
                        <input
                          type="text"
                          value={editableSupplier}
                          placeholder="Not mentioned"
                          maxLength={200}
                          onChange={e => setEditableSupplier(e.target.value)}
                          className="bg-transparent border-none outline-none p-0 text-[10px] font-bold text-indigo-700 w-[7.5rem] placeholder:text-gray-400"
                        />
                        {editableSupplier && (
                          <button
                            type="button"
                            onClick={() => setEditableSupplier('')}
                            className="text-indigo-400 hover:text-indigo-600 cursor-pointer shrink-0"
                            title="Clear supplier"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                    {(parsedResult.parsed.brand || parsedResult.parsed.intent === 'inventory_add') && (
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-[10px] font-bold text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100/70 transition-all"
                        title="Brand — same product can come from different brands; tap to add or correct"
                      >
                        <Tag className="w-3 h-3 shrink-0" />
                        <span className="uppercase tracking-wide text-cyan-400 text-[9px]">Brand</span>
                        <input
                          type="text"
                          value={editableBrand}
                          placeholder="Not mentioned"
                          maxLength={200}
                          onChange={e => setEditableBrand(e.target.value)}
                          className="bg-transparent border-none outline-none p-0 text-[10px] font-bold text-cyan-700 w-[7.5rem] placeholder:text-gray-400"
                        />
                        {editableBrand && (
                          <button
                            type="button"
                            onClick={() => setEditableBrand('')}
                            className="text-cyan-400 hover:text-cyan-600 cursor-pointer shrink-0"
                            title="Clear brand"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                    <label
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-[10px] font-bold text-purple-700 cursor-pointer hover:border-purple-300 hover:bg-purple-100/70 transition-all [color-scheme:light]"
                      title="Purchase date — tap to correct a misheard date"
                    >
                      <CalendarDays className="w-3 h-3 shrink-0" />
                      <span className="uppercase tracking-wide text-purple-400 text-[9px]">Date</span>
                      <input
                        type="date"
                        value={editableDate || parsedResult.parsed.date || new Date().toISOString().slice(0, 10)}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={e => setEditableDate(e.target.value)}
                        className="bg-transparent border-none outline-none p-0 text-[10px] font-bold text-purple-700 cursor-pointer w-[8.75rem]"
                      />
                    </label>
                    {(parsedResult.parsed.expiryDate || parsedResult.parsed.intent === 'inventory_add') && (
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700 hover:border-rose-300 hover:bg-rose-100/70 transition-all [color-scheme:light]"
                        title="Expiry date — the incoming batch's expiry; tap to add or correct"
                      >
                        <Hourglass className="w-3 h-3 shrink-0" />
                        <span className="uppercase tracking-wide text-rose-400 text-[9px]">Expiry</span>
                        <span className="relative block w-[8.5rem]">
                          <input
                            type="date"
                            min={new Date().toISOString().slice(0, 10)}
                            value={editableExpiry}
                            onChange={e => setEditableExpiry(e.target.value)}
                            className="bg-transparent border-none outline-none p-0 text-[10px] font-bold text-rose-700 cursor-pointer w-full"
                          />
                          {!editableExpiry && (
                            <span className="absolute inset-y-0 left-0 flex items-center text-[10px] font-bold text-gray-400 pointer-events-none">
                              Not mentioned
                            </span>
                          )}
                        </span>
                        {editableExpiry && (
                          <button
                            type="button"
                            onClick={() => setEditableExpiry('')}
                            className="text-rose-400 hover:text-rose-600 cursor-pointer shrink-0"
                            title="Clear expiry"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Product rows — primary result of the voice command */}
                <div className="space-y-3">
                  {parsedResult.parsed.items.map((item, i) => {
                    const pickedName = rowPicks[i] || item.canonicalName || item.item;
                    const existing = inventory.items.find(
                      inv => inv.name.toLowerCase() === pickedName.toLowerCase()
                    );
                    const currentStock = existing?.currentStock ?? 0;
                    const unit = item.unit || existing?.unit || 'pcs';
                    const qty = rowQtys[i] ?? item.quantity;
                    const isAdd = parsedResult.parsed!.intent === 'inventory_add';
                    const isRemove = parsedResult.parsed!.intent === 'inventory_remove' || parsedResult.parsed!.intent === 'inventory_waste';
                    const newStock = isAdd ? currentStock + qty : isRemove ? Math.max(0, currentStock - qty) : qty;
                    const stockChange = newStock - currentStock;
                    const diffColor = stockChange > 0 ? 'text-emerald-600' : stockChange < 0 ? 'text-red-600' : 'text-gray-400';
                    const isAmbiguous = !!item.ambiguous || (!item.canonicalName && (item.candidates?.length || 0) > 0);
                    const candidates = item.candidates && item.candidates.length > 1
                      ? item.candidates
                      : inventory.items
                          .filter(inv => inv.name.toLowerCase().includes((item.item || '').toLowerCase()) ||
                                         (item.item || '').toLowerCase().includes(inv.name.toLowerCase()))
                          .map(c => ({ name: c.name, unit: c.unit, currentStock: c.currentStock }));

                    return (
                      <div key={i} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        {/* Product identity */}
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[var(--brand-color)]/15 to-blue-100 flex items-center justify-center text-base font-black text-[var(--brand-color)] shrink-0">
                            {(rowPicks[i] || item.canonicalName || item.item).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-black text-gray-900 truncate">
                              {isAmbiguous ? item.item : (rowPicks[i] || item.canonicalName || item.item)}
                              {!existing && isAdd && (
                                <span className="ml-2 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100 align-middle">
                                  New item
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400">
                              {qty} {unit} × {INTENT_META[parsedResult.parsed!.intent].verb}
                            </p>
                          </div>
                        </div>

                        {/* Ambiguous item resolution */}
                        {isAmbiguous && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <p className="text-[11px] font-bold text-amber-800">Which item did you mean?</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {candidates.length > 0 ? (
                                candidates.map((c, ci) => (
                                  <button
                                    key={ci}
                                    onClick={() => setRowPicks(p => ({ ...p, [i]: c.name }))}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                                      rowPicks[i] === c.name
                                        ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)]'
                                        : 'bg-white text-gray-700 border-gray-200 hover:border-[var(--brand-color)]/40'
                                    }`}
                                  >
                                    {c.name} {c.currentStock != null ? `(${c.currentStock} ${c.unit || 'pcs'})` : ''}
                                  </button>
                                ))
                              ) : (
                                <p className="text-[11px] text-amber-700">
                                  No matching item — this will be added as a new item.
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Quantity stepper + stock preview */}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setRowQtys(q => ({ ...q, [i]: Math.max(0.05, (q[i] ?? item.quantity) - stepFor(unit)) }))}
                              className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-all"
                              aria-label={`Decrease ${item.item}`}
                            >
                              <span className="text-base leading-none font-bold">−</span>
                            </button>
                            <input
                              type="number"
                              min={0}
                              step={stepFor(unit)}
                              value={Math.round((rowQtys[i] ?? item.quantity) * 100) / 100}
                              onChange={e => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v >= 0) setRowQtys(q => ({ ...q, [i]: v }));
                              }}
                              className="w-16 text-center text-sm font-bold bg-white border border-[#e1e2ed] rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
                            />
                            <button
                              onClick={() => setRowQtys(q => ({ ...q, [i]: (q[i] ?? item.quantity) + stepFor(unit) }))}
                              disabled={isConfirming}
                              className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-all"
                              aria-label={`Increase ${pickedName}`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          {existing && (
                            <span className={`text-sm font-black ${diffColor} shrink-0`}>
                              {currentStock}
                              <ArrowRight className="w-3.5 h-3.5 inline mx-1 align-middle" />
                              {newStock} {unit}
                            </span>
                          )}
                        </div>

                        {/* Purchase rate (₹/unit) — detected from speech, editable */}
                        {isAdd && (
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed border-gray-200">
                            <span className="text-[10px] font-semibold text-gray-500 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-purple-500" />
                              Rate detected
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] font-bold text-gray-500">₹</span>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                placeholder={existing?.averageCost ? String(existing.averageCost) : '—'}
                                value={rowRates[i] ?? item.rate ?? ''}
                                onChange={e => {
                                  const v = e.target.value === '' ? '' : parseFloat(e.target.value);
                                  if (v === '' || (!isNaN(v) && v >= 0)) setRowRates(r => ({ ...r, [i]: v }));
                                }}
                                className="w-20 text-right text-sm font-bold bg-white rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
                                title="Purchase rate per unit — saved to the product's average cost"
                              />
                              <span className="text-[10px] text-gray-400">/{unit}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-[#e1e2ed]">
                  <button
                    onClick={handleCancel}
                    disabled={isConfirming}
                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-40"
                  >
                    <X className="w-4 h-4" /> Cancel
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={isConfirming || confirmDone || parsedResult.parsed.items.some((item, i) =>
                      (!!item.ambiguous || (!item.canonicalName && (item.candidates?.length || 0) > 0)) && !rowPicks[i]
                    )}
                    className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all cursor-pointer shadow-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isConfirming ? 'Updating...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-2xl border border-dashed border-[#d7dbea] shadow-sm min-h-[280px] flex flex-col items-center justify-center text-center p-6"
            >
              <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-500" />
              </div>
              <p className="text-sm font-bold text-gray-900 mt-3">Active Command Panel</p>
              <p className="text-[11px] text-gray-400 mt-1 max-w-[260px] leading-relaxed">
                Speak or type a command and the recognized action with confirmation will appear here.
              </p>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>

      {/* ===== QUICK COMMANDS ===== */}
      {!isParsing && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
            <Volume2 className="w-3 h-3" /> Quick Commands
          </p>
          <div className="flex-1 h-px bg-[#e1e2ed] min-w-[40px]" />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setInput(ex.text); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#e1e2ed] rounded-lg text-[11px] font-semibold text-gray-500 hover:border-[var(--brand-color)]/40 hover:text-[var(--brand-color)] hover:shadow-sm transition-all cursor-pointer"
              >
                <span className="text-xs">{ex.emoji}</span>
                <span className="truncate">{ex.text}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* ===== BOTTOM INFO ROW — RECENT ACTIONS / TIPS / CATALOG ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {/* Recent actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[#e1e2ed] flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-bold">Recent Actions</h2>
            {log.length > 0 && (
              <span className="text-[10px] text-gray-400 ml-auto bg-gray-50 px-1.5 py-0.5 rounded-full">
                {log.length}
              </span>
            )}
          </div>
          {log.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <MessageSquare className="w-9 h-9 text-gray-200 mb-2.5" />
              <p className="text-sm font-semibold text-gray-400">No actions yet</p>
              <p className="text-[11px] text-gray-300 mt-1">Confirmed voice commands appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e1e2ed] max-h-60 overflow-y-auto">
              {log.map(entry => {
                const meta = INTENT_META[entry.intent] || INTENT_META.unknown;
                const canUndo = !!entry.auditLogId && !entry.undone;
                return (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}>
                      <meta.icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 leading-snug">{entry.summary}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{entry.timestamp}</p>
                    </div>
                    {entry.undone ? (
                      <span className="text-[9px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
                        Undone
                      </span>
                    ) : canUndo ? (
                      <button
                        onClick={() => setUndoTarget(entry)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 opacity-60 group-hover:opacity-100 hover:bg-amber-100 hover:border-amber-300 transition-all cursor-pointer shrink-0"
                        title="Undo this action (reverses the stock change)"
                      >
                        <RotateCcw className="w-3 h-3" /> Undo
                      </button>
                    ) : (
                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                        Done
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Voice tips */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-[var(--brand-color)]/[0.04] to-blue-50/40 rounded-2xl border border-[#e1e2ed] p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-4 h-4 text-[var(--brand-color)]" />
            <h2 className="text-xs font-black text-gray-900 uppercase tracking-wider">Voice Tips</h2>
          </div>
          <ul className="space-y-2.5 text-[11px] text-gray-600">
            <li className="flex items-start gap-2">
              <Globe className="w-3.5 h-3.5 text-[var(--brand-color)] mt-0.5 shrink-0" />
              <span>Speak in <strong>Hinglish, Hindi or English</strong> — switch above.</span>
            </li>
            <li className="flex items-start gap-2">
              <ShoppingCart className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <span><strong>Add:</strong> “add 20 kg flour” or “5 litre doodh add karo”.</span>
            </li>
            <li className="flex items-start gap-2">
              <Trash2 className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              <span><strong>Waste:</strong> “log 3 paneer spoiled” or “2 bread kharab”.</span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <span><strong>Adjust:</strong> “set milk stock to 40 litres”.</span>
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-500 mt-0.5 shrink-0" />
              <span>New items are <strong>auto-created</strong> when they aren't in your catalog yet.</span>
            </li>
          </ul>
        </motion.div>

        {/* Your catalog */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white rounded-2xl border border-[#e1e2ed] p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-gray-400" />
            <h2 className="text-xs font-black text-gray-900 uppercase tracking-wider">Your Catalog</h2>
          </div>
          <p className="text-3xl font-black text-gray-900">{inventory.items.length}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">items in inventory</p>
          {inventory.items.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {inventory.items.slice(0, 8).map(c => (
                <span key={c.id} className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-[#e1e2ed] px-2 py-0.5 rounded-full">
                  {c.name}
                </span>
              ))}
              {inventory.items.length > 8 && (
                <span className="text-[9px] font-bold text-gray-400 px-1 py-0.5">
                  +{inventory.items.length - 8} more
                </span>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* ===== UNDO CONFIRMATION MODAL ===== */}
      <Modal
        isOpen={undoTarget !== null}
        onClose={() => { if (!isUndoing) setUndoTarget(null); }}
        title="Undo this action?"
        size="sm"
      >
        <div className="text-center py-4">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <RotateCcw className="w-6 h-6 text-amber-600" />
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Are you sure you want to undo{' '}
            <span className="font-bold text-gray-900">{undoTarget?.summary}</span>?
          </p>
          <p className="text-xs text-gray-400 mt-2">
            The stock change will be reversed. This cannot be undone.
          </p>
        </div>
        <div className="flex gap-3 justify-center pt-4 border-t border-[#e1e2ed]">
          <button
            onClick={() => setUndoTarget(null)}
            disabled={isUndoing}
            className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 cursor-pointer transition-all disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleUndo}
            disabled={isUndoing}
            className="px-6 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 cursor-pointer shadow-sm transition-all disabled:opacity-40 flex items-center gap-2"
          >
            {isUndoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {isUndoing ? 'Undoing...' : 'Yes, Undo'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
