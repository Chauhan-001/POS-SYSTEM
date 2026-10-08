/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoicePage — Inventory Voice AI.
 *
 * Layout: input on the LEFT (mic + language + text fallback), generated cards
 * on the RIGHT (parsed items with quantity / unit / cost, plus supplier,
 * purchase date, expiry date, brand), and the action history pinned at the
 * BOTTOM with per-row Undo and Edit.
 *
 * State machine:
 *   IDLE → LISTENING → TRANSCRIBING → UNDERSTANDING → READY_FOR_CONFIRMATION
 *        ↘ NEEDS_CLARIFICATION        ↘ ERROR
 *   READY_FOR_CONFIRMATION → EXECUTING → SUCCESS / ERROR
 *
 * Architecture (unchanged safety boundary):
 *   Mic/Type → /voice-inventory/transcribe → /parse → confirmation preview
 *            → /confirm (the ONLY mutation) → InventoryService
 *
 * History rows come from /voice-inventory/history (audit log). Undo calls
 * /voice-inventory/undo. Edit loads a past action back into the confirmation
 * panel so it can be re-applied with corrected details — the panel itself is
 * still the only mutation path.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Mic, Square, Check, X, Loader2, Globe, RotateCcw, AlertTriangle, Package, Sparkles, Undo2,
  Pencil, Clock, Truck, IndianRupee, CalendarDays, History as HistoryIcon,
} from 'lucide-react';
import { useInventory, useInventoryEventsCtx, useNotify } from '../InventoryManager';
import apiClient from '../../../api/axios';

// ─── API contract (mirrors backend validators) ──────────────────────

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
  rate?: number;
}

interface VoiceParseResult {
  success: boolean;
  auditLogId?: string;
  pendingActionId?: string;
  confirmationToken?: string;
  confirmationExpiresAt?: string;
  parsed?: {
    intent: IntentType;
    items: ParsedItem[];
    confidence: number;
    language?: string;
    originalText: string;
    error?: string;
    supplier?: string;
    date?: string;
    brand?: string;
    expiryDate?: string;
  };
  missingFields?: string[];
  suggestions?: string[];
  error?: string;
  latencyMs: number;
}

interface ConfirmationResult {
  success: boolean;
  data?: {
    operation: string;
    updatedItems: Array<{ itemName: string; previousStock: number; newStock: number; unit: string }>;
  };
  error?: string;
}

interface VoiceHistoryEntry {
  _id?: string;
  id?: string;
  transcript?: string;
  intent?: string;
  confirmationStatus?: string;
  undoStatus?: string;
  // AuditLogger stores `{ name, quantity, unit, previousStock, newStock }`.
  items?: Array<{
    name?: string;
    item?: string;
    itemName?: string;
    quantity?: number;
    unit?: string;
    previousStock?: number;
    newStock?: number;
  }>;
  parsedJson?: {
    supplier?: string;
    date?: string;
    brand?: string;
    expiryDate?: string;
  };
  createdAt?: string;
}

const formatCurrency = (value: number | null | undefined) => {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 'Not provided';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
};

/** Date fields are spoken/typed as YYYY-MM-DD; show them readably when valid. */
const formatSmartDate = (value?: string) => {
  if (!value) return 'Not provided';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const LANGUAGES = [
  { value: 'hi-en', label: 'Hinglish', hint: '“20 kilo chawal stock mein add kar do”' },
  { value: 'hi', label: 'हिंदी', hint: '“पाँच किलो प्याज़ खराब हो गया”' },
  { value: 'en', label: 'English', hint: '“Add 20 kg rice to stock”' },
] as const;

const INTENT_META: Record<IntentType, { label: string; cls: string; icon: typeof Package }> = {
  inventory_add: { label: 'Add Stock', cls: 'bg-emerald-100 text-emerald-700', icon: Package },
  inventory_remove: { label: 'Remove Stock', cls: 'bg-orange-100 text-orange-700', icon: Package },
  inventory_adjust: { label: 'Adjust Stock', cls: 'bg-blue-100 text-blue-700', icon: Package },
  inventory_waste: { label: 'Record Wastage', cls: 'bg-red-100 text-red-700', icon: AlertTriangle },
  purchase_reminder: { label: 'Purchase Reminder', cls: 'bg-amber-100 text-amber-700', icon: Package },
  supplier_update: { label: 'Supplier Update', cls: 'bg-violet-100 text-violet-700', icon: Package },
  unknown: { label: 'Not understood', cls: 'bg-gray-100 text-gray-600', icon: AlertTriangle },
};

type UiState =
  | 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'UNDERSTANDING'
  | 'NEEDS_CLARIFICATION' | 'READY_FOR_CONFIRMATION' | 'EXECUTING'
  | 'SUCCESS' | 'ERROR';

const isBusy = (s: UiState) => s === 'TRANSCRIBING' || s === 'UNDERSTANDING' || s === 'EXECUTING';

// ─── Component ──────────────────────────────────────────────────────

export default function VoicePage() {
  const notify = useNotify();
  const { refreshItems } = useInventory();
  const { refreshEvents } = useInventoryEventsCtx();
  // PurchasesCtx exposes no re-fetch (only local add/update/remove), so a
  // voice-created purchase surfaces in the timeline on its next load.

  const [uiState, setUiState] = useState<UiState>('IDLE');
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState<'hi-en' | 'hi' | 'en'>('hi-en');
  const [listeningText, setListeningText] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);

  const [result, setResult] = useState<VoiceParseResult | null>(null);
  const [editedItems, setEditedItems] = useState<ParsedItem[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState({ supplier: '', date: '', brand: '', expiryDate: '' });
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recognitionRef.current?.abort?.();
  }, []);

  const loadVoiceHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await apiClient.get('/voice-inventory/history', { params: { limit: 8 } });
      const rows = Array.isArray(data?.data) ? data.data : [];
      setVoiceHistory(rows.filter((entry: VoiceHistoryEntry) => entry.confirmationStatus === 'confirmed'));
    } catch {
      setVoiceHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoiceHistory();
  }, [loadVoiceHistory]);

  const handleUndoVoiceAction = useCallback(async (logId?: string) => {
    if (!logId) return;
    try {
      const { data } = await apiClient.post('/voice-inventory/undo', { logId });
      if (!data?.success) {
        await Promise.all([loadVoiceHistory(), refreshItems(), refreshEvents()]);
        setError(data?.error || 'Could not undo the voice action.');
        setUiState('ERROR');
        return;
      }
      await Promise.all([loadVoiceHistory(), refreshItems(), refreshEvents()]);
      notify('Voice action undone.', 'info');
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Undo failed. Try again.');
      setUiState('ERROR');
    }
  }, [loadVoiceHistory, notify, refreshItems, refreshEvents]);

  // ── Parse (transcript → structured command) ──
  const analyze = useCallback(async (text: string) => {
    if (!text.trim()) { setError('Nothing to understand — speak or type a command.'); setUiState('ERROR'); return; }
    setUiState('UNDERSTANDING');
    setError('');
    setEditingLogId(null);
    try {
      const { data } = await apiClient.post<VoiceParseResult>('/voice-inventory/parse', {
        transcript: text,
        language,
      });
      if (!data?.success || !data.parsed) {
        setError(data?.error || 'Could not understand. Try rephrasing.');
        setUiState('ERROR');
        return;
      }
      if (data.parsed.intent === 'unknown') {
        setError(
          data.suggestions?.[0] ||
          'Command not recognized. Try “Add 20 kg rice” or “5 kilo paneer kharab ho gaya”.',
        );
        setUiState('NEEDS_CLARIFICATION');
        return;
      }
      const needsRow = data.missingFields?.length || data.parsed.items.some((i) => i.ambiguous);
      setResult(data);
      setEditedItems(data.parsed.items.map((i) => ({ ...i })));
      setMetadata({
        supplier: data.parsed.supplier || '',
        date: data.parsed.date || '',
        brand: data.parsed.brand || '',
        expiryDate: data.parsed.expiryDate || '',
      });
      setUiState(needsRow ? 'NEEDS_CLARIFICATION' : 'READY_FOR_CONFIRMATION');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Understanding failed. Try again.');
      setUiState('ERROR');
    }
  }, [language]);

  // ── Recording → /transcribe → analyze ──
  const transcribeBlob = useCallback(async (blob: Blob) => {
    setUiState('TRANSCRIBING');
    try {
      if (blob.size < 8000) throw new Error('NO_SPEECH');
      const reader = new FileReader();
      const audio = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('READ_FAILED'));
        reader.readAsDataURL(blob);
      });
      const { data } = await apiClient.post('/voice-inventory/transcribe', {
        audio, audioMimeType: blob.type || 'audio/webm', language,
      });
      if (!data?.success || !data.transcript) throw new Error(data?.code || 'STT_FAILED');
      setInput(data.transcript);
      await analyze(data.transcript);
    } catch (e: any) {
      const code = e?.response?.data?.code || e?.message;
      setError(
        code === 'NO_SPEECH' ? 'I couldn’t hear anything. Please try again.'
        : code === 'AUDIO_TOO_LONG' ? e?.response?.data?.error
        : code === 'STT_NOT_CONFIGURED' ? 'Voice service is temporarily unavailable.'
        : 'I couldn’t understand the audio. Please try again or type instead.',
      );
      setUiState('ERROR');
    }
  }, [language, analyze]);

  const stopListening = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startMediaRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Microphone not available in this browser. Type your command instead.');
        setUiState('ERROR');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void transcribeBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setError('Recording failed. Type your command instead.');
        setUiState('ERROR');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      setUiState('LISTENING');
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setError('Microphone permission is required. Enable it in your browser settings, or type instead.');
      } else {
        setError('Could not start the microphone. Type your command instead.');
      }
      setUiState('ERROR');
    }
  }, [transcribeBlob]);

  const startListening = useCallback(() => {
    setError('');
    setResult(null);
    setConfirmation(null);
    setEditingLogId(null);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { void startMediaRecording(); return; }
    const recognition = new SR();
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setListeningText(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        setInput(transcript);
        setUiState('UNDERSTANDING');
        void analyze(transcript);
      }
    };
    recognition.onerror = (e: any) => {
      if (e?.error === 'no-speech') { setError('I couldn’t hear anything. Please try again.'); setUiState('ERROR'); return; }
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'network') {
        void startMediaRecording();
        return;
      }
      setError(`Voice error (${e?.error || 'unknown'}). Try typing instead.`);
      setUiState('ERROR');
    };
    recognition.onend = () => setUiState((s) => (s === 'LISTENING' ? 'IDLE' : s));
    recognitionRef.current = recognition;
    recognition.start();
    setUiState('LISTENING');
    setListeningText('');
  }, [language, startMediaRecording, analyze]);

  // ── Confirm / edit / cancel (the ONLY mutation path) ──
  const submitConfirmation = useCallback(async (action: 'confirm' | 'edit' | 'cancel' | 'clarify') => {
    if (!result) return;
    if (action !== 'cancel') setUiState('EXECUTING');
    try {
      const { data } = await apiClient.post<ConfirmationResult>('/voice-inventory/confirm', {
        pendingActionId: result.pendingActionId,
        confirmationToken: result.confirmationToken,
        logId: result.auditLogId,
        action: action === 'cancel' ? 'cancel' : 'confirm',
        editedItems: action === 'confirm' || action === 'edit' ? editedItems : undefined,
        supplier: metadata.supplier,
        date: metadata.date || undefined,
        brand: metadata.brand,
        expiryDate: metadata.expiryDate || undefined,
      });
      if (action === 'cancel') {
        setUiState('IDLE');
        setResult(null);
        setEditingLogId(null);
        notify('Voice command cancelled.', 'info');
        return;
      }
      if (!data?.success) {
        await Promise.all([loadVoiceHistory(), refreshItems(), refreshEvents()]);
        setError(data?.error || 'Could not apply the command.');
        setUiState('ERROR');
        return;
      }
      setConfirmation(data);
      setResult(null);
      setEditedItems([]);
      setEditingLogId(null);
      setUiState('SUCCESS');
      await Promise.all([loadVoiceHistory(), refreshItems(), refreshEvents()]);
      const items = data.data?.updatedItems ?? [];
      notify(
        items.length > 0
          ? items.map((i) => `${i.itemName}: ${i.previousStock} → ${i.newStock} ${i.unit}`).join(', ')
          : 'Voice action applied.',
        'success',
      );
    } catch (e: any) {
      await Promise.all([refreshItems(), refreshEvents()]);
      setError(e?.response?.data?.error || 'Confirmation failed. Try again.');
      setUiState('ERROR');
    }
  }, [result, editedItems, metadata, notify, loadVoiceHistory, refreshItems, refreshEvents]);

  const reset = useCallback(() => {
    setUiState('IDLE');
    setResult(null);
    setConfirmation(null);
    setError('');
    setInput('');
    setListeningText('');
    setMetadata({ supplier: '', date: '', brand: '', expiryDate: '' });
    setEditedItems([]);
    setEditingLogId(null);
  }, []);

  /**
   * Edit a past action: its items and recorded details are loaded back into
   * the confirmation panel, but WITHOUT the one-time confirm token (which is
   * long expired), so the merchant re-states the command and confirms it
   * through the normal, token-verified path.
   */
  const startEditingHistoryEntry = useCallback((entry: VoiceHistoryEntry) => {
    const meta = entry.parsedJson ?? {};
    const items: ParsedItem[] = (entry.items ?? []).map((it) => {
      const name = it.name || it.item || it.itemName || 'Item';
      return { item: name, quantity: typeof it.quantity === 'number' ? it.quantity : 0, unit: it.unit || 'pcs', canonicalName: name };
    });
    setResult({
      success: true,
      parsed: {
        intent: (entry.intent as IntentType) || 'inventory_adjust',
        items,
        confidence: 1,
        originalText: entry.transcript || '',
      },
      latencyMs: 0,
    });
    setEditedItems(items.map((i) => ({ ...i })));
    setMetadata({
      supplier: meta.supplier || '',
      date: meta.date || '',
      brand: meta.brand || '',
      expiryDate: meta.expiryDate || '',
    });
    setConfirmation(null);
    setError('');
    setEditingLogId(String(entry._id || entry.id || ''));
    setUiState('READY_FOR_CONFIRMATION');
  }, []);

  // ── Derived ──
  const parsed = result?.parsed;
  const meta = parsed ? INTENT_META[parsed.intent] : null;
  const missing = result?.missingFields ?? [];
  const clarifying = uiState === 'NEEDS_CLARIFICATION';

  const historySummary = (entry: VoiceHistoryEntry) => {
    const items = Array.isArray(entry.items) && entry.items.length > 0
      ? entry.items.map((it) => {
          const name = it.name || it.item || it.itemName || 'Item';
          const qty = typeof it.quantity === 'number' ? it.quantity : 0;
          const unit = it.unit || '';
          const delta = typeof it.previousStock === 'number' && typeof it.newStock === 'number'
            ? ` · ${it.previousStock} → ${it.newStock}${unit ? ` ${unit}` : ''}`
            : '';
          return `${name}${qty ? ` (${qty}${unit ? ` ${unit}` : ''})` : ''}${delta}`;
        }).join(', ')
      : (entry.transcript || 'Voice action');
    return items;
  };

  const intentLabel = (intent?: string) =>
    intent === 'inventory_add' ? 'Add stock'
    : intent === 'inventory_remove' ? 'Remove stock'
    : intent === 'inventory_adjust' ? 'Adjust stock'
    : intent === 'inventory_waste' ? 'Wastage'
    : intent === 'purchase_reminder' ? 'Purchase reminder'
    : intent === 'supplier_update' ? 'Supplier update'
    : 'Voice action';

  // ── Render ──
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Mic className="w-5 h-5 text-[var(--brand-color)]" /> Voice Inventory
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Speak or type — review before anything changes.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-1">
          <Globe className="w-3.5 h-3.5 text-gray-400 ml-1.5" />
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              onClick={() => setLanguage(l.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                language === l.value ? 'bg-[var(--brand-color)] text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* LEFT: input (mic + text fallback) · RIGHT: generated cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mt-4">
        {/* ── Left column: voice input ── */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-5">
            {uiState === 'LISTENING' ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="relative">
                  <span className="absolute inset-0 rounded-full bg-red-400/40 animate-ping" />
                  <button
                    onClick={stopListening}
                    className="relative w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg cursor-pointer"
                    title="Stop recording"
                  >
                    <Square className="w-6 h-6" />
                  </button>
                </div>
                <p className="text-sm font-bold">Listening… {recordSeconds > 0 ? `${recordSeconds}s` : ''}</p>
                <p className="text-sm text-gray-500 min-h-5 italic">{listeningText || 'Speak naturally'}</p>
                <p className="text-xs text-gray-400 text-center">{LANGUAGES.find((l) => l.value === language)?.hint}</p>
                <button onClick={stopListening} className="text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer">[ Stop ]</button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-2">
                <button
                  onClick={startListening}
                  disabled={isBusy(uiState)}
                  className="w-16 h-16 rounded-full bg-[var(--brand-color)] text-white flex items-center justify-center shadow-md hover:bg-[var(--color-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
                  title="Start voice input"
                >
                  {uiState === 'TRANSCRIBING' || uiState === 'UNDERSTANDING'
                    ? <Loader2 className="w-6 h-6 animate-spin" />
                    : <Mic className="w-6 h-6" />}
                </button>
                <p className="text-sm font-bold">
                  {uiState === 'TRANSCRIBING' ? 'Transcribing…'
                   : uiState === 'UNDERSTANDING' ? 'Understanding…'
                   : uiState === 'EXECUTING' ? 'Applying…'
                   : 'Tap to speak'}
                </p>
                <p className="text-xs text-gray-400 text-center">{LANGUAGES.find((l) => l.value === language)?.hint}</p>
              </div>
            )}
          </div>

          {/* Text fallback — always available */}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy(uiState)) void analyze(input); }}
              placeholder="…or type: “Add 20 kg rice” / “5 kilo chawal waste ho gaya”"
              className="flex-1 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30"
            />
            <button
              onClick={() => void analyze(input)}
              disabled={isBusy(uiState) || !input.trim()}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" />
              Parse
            </button>
          </div>

          {/* Error / clarification banner */}
          {(error || (clarifying && missing.length > 0)) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {error && <p className="font-semibold">{error}</p>}
                {clarifying && missing.includes('quantity') && parsed?.items[0]?.item && (
                  <p>How much {parsed.items[0].canonicalName || parsed.items[0].item} would you like? Fill the quantity on the right, then Confirm.</p>
                )}
                {clarifying && parsed?.items.some((i) => i.ambiguous) && (
                  <p>Multiple items matched — pick the right one on the right, then Confirm.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: generated cards ── */}
        <div className="space-y-4">
          {parsed && meta && (
            <div className="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                  {editingLogId && (
                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 inline-flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> editing a past action
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  parsed.confidence >= 0.8 ? 'bg-emerald-100 text-emerald-700'
                  : parsed.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>
                  {Math.round(parsed.confidence * 100)}% confidence
                </span>
              </div>

              {editedItems.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing was understood from: “{parsed.originalText}”</p>
              ) : (
                <div className="space-y-2">
                  {editedItems.map((item, idx) => (
                    <div key={idx} className="rounded-xl border border-[var(--color-border-default)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold flex items-center gap-1.5">
                          <Package className="w-4 h-4 text-gray-400" />
                          {item.canonicalName || item.item}
                          {item.productId && item.canonicalName && (
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">matched</span>
                          )}
                        </p>
                        {typeof item.resolutionConfidence === 'number' && item.resolutionConfidence < 0.5 && (
                          <span className="text-[10px] font-bold text-amber-600">check item</span>
                        )}
                      </div>
                      {item.ambiguous && item.candidates && item.candidates.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.candidates.slice(0, 5).map((c) => (
                            <button
                              key={c.name}
                              onClick={() => setEditedItems((prev) => prev.map((p, i) => i === idx ? { ...p, item: c.name, canonicalName: c.name, productId: c.name, ambiguous: false } : p))}
                              className="px-2 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer"
                            >
                              {c.name}{typeof c.currentStock === 'number' ? ` (${c.currentStock} ${c.unit || ''})` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs font-semibold text-gray-500">
                          Quantity
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : ''}
                            onChange={(e) => setEditedItems((prev) => prev.map((p, i) => i === idx ? { ...p, quantity: parseFloat(e.target.value) || 0 } : p))}
                            className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
                            placeholder="How much?"
                          />
                        </label>
                        <label className="text-xs font-semibold text-gray-500">
                          Unit
                          <input
                            value={item.unit || ''}
                            onChange={(e) => setEditedItems((prev) => prev.map((p, i) => i === idx ? { ...p, unit: e.target.value } : p))}
                            className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
                            placeholder="kg / L / packet"
                          />
                        </label>
                        <label className="text-xs font-semibold text-gray-500">
                          Cost per unit
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={typeof item.rate === 'number' && item.rate > 0 ? item.rate : ''}
                            onChange={(e) => setEditedItems((prev) => prev.map((p, i) => i === idx ? { ...p, rate: e.target.value ? Number(e.target.value) : undefined } : p))}
                            className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
                            placeholder="Enter cost"
                          />
                        </label>
                      </div>
                      <p className="text-[11px] text-gray-500 flex items-center gap-1">
                        <IndianRupee className="w-3 h-3" />
                        Cost: {formatCurrency(item.rate)} / {item.unit || 'unit'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Purchase details: supplier · date · expiry · brand */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-500">
                  <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" /> Supplier</span>
                  <input value={metadata.supplier} onChange={(e) => setMetadata((m) => ({ ...m, supplier: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm" placeholder="Supplier name (optional)" />
                </label>
                <label className="text-xs font-semibold text-gray-500">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Purchase date</span>
                  <input type="date" value={metadata.date} onChange={(e) => setMetadata((m) => ({ ...m, date: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
                </label>
                <label className="text-xs font-semibold text-gray-500">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Expiry date</span>
                  <input type="date" value={metadata.expiryDate} onChange={(e) => setMetadata((m) => ({ ...m, expiryDate: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
                </label>
                <label className="text-xs font-semibold text-gray-500">
                  Brand
                  <input value={metadata.brand} onChange={(e) => setMetadata((m) => ({ ...m, brand: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-[var(--color-border-default)] px-2 py-1.5 text-sm" placeholder="Brand (optional)" />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => void submitConfirmation('cancel')} disabled={isBusy(uiState)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5">
                  <X className="w-4 h-4" /> Cancel
                </button>
                <button onClick={() => void submitConfirmation(clarifying ? 'edit' : 'confirm')} disabled={isBusy(uiState)}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white disabled:opacity-40 cursor-pointer flex items-center gap-1.5">
                  {uiState === 'EXECUTING' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {clarifying ? 'Apply with these details' : 'Confirm'}
                </button>
              </div>
            </div>
          )}

          {/* Success card */}
          {uiState === 'SUCCESS' && confirmation?.data && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-2">
              <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Applied successfully
              </p>
              {confirmation.data.updatedItems.map((u, i) => (
                <p key={i} className="text-sm text-emerald-700">
                  {u.itemName}: <b>{u.previousStock}</b> → <b>{u.newStock}</b> {u.unit}
                </p>
              ))}
              <button onClick={reset} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer flex items-center gap-1 pt-1">
                <RotateCcw className="w-3.5 h-3.5" /> New command
              </button>
            </div>
          )}

          {/* Error retry */}
          {uiState === 'ERROR' && (
            <button onClick={reset} className="mx-auto flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" /> Start over
            </button>
          )}

          {/* Empty state for the right column */}
          {!parsed && uiState !== 'SUCCESS' && (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-8 text-center">
              <Package className="w-8 h-8 mx-auto text-gray-300" />
              <p className="mt-2 text-sm font-bold text-gray-600">No command yet</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Speak or type on the left — the parsed item cards appear here for review before anything changes.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM: history of actions performed ── */}
      <div className="mt-4 rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold flex items-center gap-1.5">
            <HistoryIcon className="w-4 h-4 text-gray-400" /> History of actions performed
          </p>
          <button
            type="button"
            onClick={() => void loadVoiceHistory()}
            disabled={historyLoading}
            className="text-[10px] font-bold text-gray-500 hover:text-gray-700 disabled:opacity-50 cursor-pointer"
          >
            {historyLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {voiceHistory.length === 0 ? (
          <p className="text-xs text-gray-500">No voice inventory actions yet — confirmed commands will appear here.</p>
        ) : (
          <div className="space-y-2">
            {voiceHistory.map((entry) => {
              const logId = String(entry._id || entry.id || '');
              const undone = entry.undoStatus === 'undone';
              const meta = entry.parsedJson ?? {};
              const hasDetails = Boolean(meta.supplier || meta.date || meta.expiryDate || meta.brand);
              return (
                <div key={logId || `${entry.transcript || 'voice'}-${entry.createdAt || 'history'}`} className="rounded-xl border border-[var(--color-border-default)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${undone ? 'bg-gray-100 text-gray-600' : 'bg-emerald-50 text-emerald-700'}`}>
                          {intentLabel(entry.intent)}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${undone ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'}`}>
                          {undone ? 'undone' : 'confirmed'}
                        </span>
                        <span className="text-[10px] text-gray-400 inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Recently'}
                        </span>
                      </div>

                      <p className="text-xs text-gray-700 break-words">{historySummary(entry)}</p>

                      {/* Recorded purchase details for this action */}
                      {hasDetails && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                          {meta.supplier && (
                            <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" /> Supplier: {meta.supplier}</span>
                          )}
                          {meta.date && (
                            <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Purchase: {formatSmartDate(meta.date)}</span>
                          )}
                          {meta.expiryDate && (
                            <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Expiry: {formatSmartDate(meta.expiryDate)}</span>
                          )}
                          {meta.brand && <span>Brand: {meta.brand}</span>}
                        </div>
                      )}

                      {entry.transcript && (
                        <p className="text-[10px] text-gray-400 italic break-words">“{entry.transcript}”</p>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEditingHistoryEntry(entry)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer inline-flex items-center gap-1"
                        title="Edit this action's details"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUndoVoiceAction(logId)}
                        disabled={undone || !logId}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1"
                        title={undone ? 'Already undone' : 'Undo this action'}
                      >
                        <Undo2 className="w-3 h-3" />
                        {undone ? 'Undone' : 'Undo'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}