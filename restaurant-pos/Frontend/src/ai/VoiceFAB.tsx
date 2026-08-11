/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoiceFAB — Production-grade multilingual voice inventory entry component.
 *
 * Features:
 *   - Multilingual: English, Hindi (हिंदी), Hinglish voice + text
 *   - 7 supported intents: add, remove, adjust, waste, purchase reminder, supplier, unknown
 *   - AI-powered parsing via /api/voice-inventory/parse
 *   - Full confirmation screen with stock preview (current → new)
 *   - Low-confidence clarification with suggestions
 *   - Missing field detection and guided input
 *   - Beautiful, accessible UI with micro-interactions
 *
 * Architecture:
 *   User → Mic/Text → /api/voice-inventory/parse → ConfirmationScreen → /api/voice-inventory/confirm → Done
 *
 * The LLM NEVER writes to the database — only the /confirm endpoint does.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic, Square, X, Check, MessageSquare, ShoppingCart, Trash2,
  Plus, Sparkles, AlertTriangle, HelpCircle, Loader2, ArrowRight,
  Edit3, Volume2, Globe, Package as PackageIcon, CalendarDays, Tag, Hourglass,
} from 'lucide-react';
import type { InventoryItem } from '../../components/inventory/types';
import { useNotify, useInventory } from '../../components/inventory/InventoryManager';
import apiClient from '../api/axios';

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
  /** Purchase rate (₹/unit) — spoken in the command or the catalog average. */
  rate?: number;
  /** Where the rate came from — 'spoken' (command) vs 'average' (catalog avg cost). */
  rateSource?: 'spoken' | 'average';
  canonicalName?: string;
  productId?: string;
  /** Low value → the spoken item may be a new product or ambiguous. */
  resolutionConfidence?: number;
  /** True when the item could NOT be confidently matched to inventory. */
  ambiguous?: boolean;
  /** Candidate inventory items to pick from (disambiguation). */
  candidates?: Array<{ name: string; unit?: string; currentStock?: number }>;
}

interface VoiceParseResult {
  success: boolean;
  auditLogId?: string;
  /** Server-side pending action — required for confirm (token-based). */
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
}

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
    icon: Edit3, label: 'Adjust Stock', verb: 'Set',
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
    icon: Edit3, label: 'Supplier Update', verb: 'Update',
    color: 'bg-indigo-100 text-indigo-700 border-indigo-200', emoji: '🏢',
  },
  unknown: {
    icon: HelpCircle, label: 'Unknown', verb: '?',
    color: 'bg-gray-100 text-gray-600 border-gray-200', emoji: '❓',
  },
};

// ====================================================================
// LANGUAGE OPTIONS
// ====================================================================

const LANGUAGES = [
  { code: 'hi-en', label: 'Hinglish', native: 'हिंग्लिश' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

/** Stepper increment for a unit: fractional for weight/volume, whole for pcs. */
const stepFor = (unit?: string): number => {
  const u = (unit || 'pcs').toLowerCase();
  return u === 'kg' || u === 'l' || u === 'litre' || u === 'liter' || u === 'ml' || u === 'g' || u === 'gram'
    ? 0.5
    : 1;
};
/** Same increment, but non-zero (used for the + button). */
const stepOf = (unit?: string): number => {
  const u = (unit || 'pcs').toLowerCase();
  return u === 'kg' || u === 'l' || u === 'litre' || u === 'liter' || u === 'ml' || u === 'g' || u === 'gram'
    ? 0.5
    : 1;
};

// ====================================================================
// COMPONENT
// ====================================================================

export default function VoiceFAB() {
  // State
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState('hi-en');
  const [input, setInput] = useState('');
  const [listeningText, setListeningText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<VoiceParseResult | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  // Per-row quantity steppers (qty adjustments before confirming).
  const [rowQtys, setRowQtys] = useState<Record<number, number>>({});
  // Per-row purchase rate edits (keyed by row index). `null` = explicitly
  // cleared by the user; undefined = untouched (use the parsed rate).
  const [rowRates, setRowRates] = useState<Record<number, number | null>>({});
  // Resolved product name for ambiguous rows (keyed by row index).
  const [rowPicks, setRowPicks] = useState<Record<number, string>>({});
  // Purchase date shown in the confirm panel — editable so a misheard spoken
  // date (e.g. "kal" parsed as today) can be corrected before confirming.
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
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hooks
  const notify = useNotify();
  const inventory = useInventory();

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
  // VOICE RECOGNITION
  // ==================================================================

  const getSpeechLang = (langCode: string): string => {
    const map: Record<string, string> = {
      'hi-en': 'hi-IN',
      hi: 'hi-IN',
      en: 'en-IN',
    };
    return map[langCode] || 'hi-IN';
  };

  // ==================================================================
  // MEDIA RECORDER FALLBACK (Electron / no Web Speech API)
  // Records audio, sends it to /api/voice-inventory/transcribe (Groq
  // Whisper), then feeds the transcript into the normal AI parse flow.
  // ==================================================================

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  // ==================================================================
  // AI PARSE
  // ==================================================================

  const analyzeText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsParsing(true);
    setError(null);
    setParsedResult(null);
    setConfirmResult(null);
    setLogId(null);
    setPendingActionId(null);
    setConfirmationToken(null);
    setRowQtys({});
    setRowRates({});
    setRowPicks({});
    setEditableDate('');
    setEditableSupplier('');
    setEditableBrand('');
    setEditableExpiry('');

    try {
      // App's authenticated axios client — auto-refreshes an expired JWT so
      // the voice API never surfaces "Invalid or expired token".
      const { data } = await apiClient.post('/voice-inventory/parse', {
        transcript: trimmed,
        language,
        items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
      });

      const result: VoiceParseResult = data;

      if (!result.success) {
        setError(result.error || 'Failed to parse voice command');
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
    } catch (err: any) {
      console.error('[VoiceFAB] Parse error:', err.message);
      setError(err?.response?.data?.error || err.message || 'Failed to connect. Is the backend running?');

      // Fallback: try the old /api/ai/inventory-voice endpoint
      try {
        const fallbackRes = await apiClient.post('/ai/inventory-voice', {
          transcript: trimmed,
          items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
        });
        const fbData = fallbackRes.data;
        if (fbData.success && fbData.data) {
          const d = fbData.data;
          const existing = inventory.items.find(i => i.name.toLowerCase() === d.item?.toLowerCase());
          if (existing && d.quantity > 0) {
            setParsedResult({
              success: true,
              transcript: trimmed,
              parsed: {
                intent: d.action === 'add_stock' ? 'inventory_add' : 'inventory_waste',
                items: [{ item: existing.name, quantity: d.quantity, unit: d.unit }],
                confidence: 0.6,
                language: 'en',
                originalText: trimmed,
              },
              latencyMs: 0,
            });
            // Legacy fallback has no spoken date/supplier/brand/expiry — default
            // the date to today so corrected values still reach the server.
            setEditableDate(new Date().toISOString().slice(0, 10));
            setEditableSupplier('');
            setEditableBrand('');
            setEditableExpiry('');
            return;
          }
        }
      } catch {
        // Fallback also failed
      }
    } finally {
      setIsParsing(false);
    }
  }, [inventory.items, language]);

  const transcribeAudioBlob = useCallback(async (blob: Blob) => {
    setIsListening(false);
    setListeningText('Transcribing audio...');
    setError(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      console.log('[VoiceFAB] Sending transcribe request', {
        endpoint: '/api/voice-inventory/transcribe',
        method: 'POST',
        payloadBase64Chars: audioBase64.length,
        mimeType: blob.type || 'audio/webm',
        blobSize: blob.size,
        authHeader: 'via apiClient (auto-refresh)', // token attached by axios interceptor
      });
      const { data } = await apiClient.post('/voice-inventory/transcribe', {
        audio: audioBase64,
        audioMimeType: blob.type || 'audio/webm',
        language,
      });

      const result = data;
      console.log('[VoiceFAB] Transcribe response', { success: result.success, transcript: result.transcript, confidence: result.confidence, error: result.error });
      if (!result.success || !result.transcript) {
        throw new Error(result.error || 'No speech detected');
      }
      setInput(result.transcript);
      analyzeText(result.transcript);
    } catch (err: any) {
      console.error('[VoiceFAB] Transcribe error (full):', err);
      setError(err?.response?.data?.error || err.message || 'Transcription failed. Type instead.');
    } finally {
      setIsListening(false);
    }
  }, [language, analyzeText]);

  const startMediaRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error('[VoiceFAB] navigator.mediaDevices.getUserMedia NOT available');
        notify('Microphone not available in this browser. Type your command instead.', 'warning');
        return;
      }
      console.log('[VoiceFAB] Requesting mic permission (getUserMedia)...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VoiceFAB] Mic permission GRANTED, tracks:', stream.getAudioTracks().map(t => t.label || t.kind));

      const supported = typeof MediaRecorder !== 'undefined'
        ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
            .filter(t => MediaRecorder.isTypeSupported(t))
        : [];
      console.log('[VoiceFAB] MediaRecorder supported types:', supported);

      const recorder = new MediaRecorder(stream);
      console.log('[VoiceFAB] MediaRecorder created, mimeType:', recorder.mimeType, '| state:', recorder.state);
      const chunks: Blob[] = [];
      const startTime = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const info: Record<string, any> = {
          durationMs: Date.now() - startTime,
          mimeType: blob.type,
          sizeBytes: blob.size,
          chunkCount: chunks.length,
        };
        // Decode to expose sample rate / actual duration (checklist item 3).
        // OfflineAudioContext decodes silently (no "AudioContext not allowed
        // to start" warning) and needs no close().
        try {
          const OfflineCtx = (window as any).OfflineAudioContext;
          if (OfflineCtx) {
            const ctx = new OfflineCtx(1, 1, 44100);
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
            info.sampleRate = decoded.sampleRate;
            info.decodedDurationSec = decoded.duration;
          }
        } catch (decodeErr: any) {
          console.warn('[VoiceFAB] Could not decode audio for sample rate:', decodeErr?.message || decodeErr);
        }
        console.log('[VoiceFAB] Audio blob produced', info);
        await transcribeAudioBlob(blob);
      };
      recorder.onerror = (e: any) => {
        console.error('[VoiceFAB] MediaRecorder error (full):', e?.error || e);
        stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        notify('Recording failed. Type instead.', 'warning');
      };
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = chunks;
      recorder.start();
      setIsListening(true);
      setListeningText('');
      setError(null);
      setParsedResult(null);
      setConfirmResult(null);
    } catch (err: any) {
      console.error('[VoiceFAB] Mic permission DENIED or error (full):', err?.name, err?.message, err?.stack || err);
      setIsListening(false);
      notify(`Microphone access denied (${err?.name || err?.message || 'unknown'}). Type your command instead.`, 'warning');
    }
  }, [notify, transcribeAudioBlob]);

  // ==================================================================
  // VOICE RECOGNITION
  // ==================================================================

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isElectron = !!(window as any).electronAPI;
    console.log('[VoiceFAB] startListening', { hasWebSpeechAPI: !!SR, isElectron });

    // In Electron the Web Speech API exists but cannot reach Google's speech
    // service — ALWAYS use the backend Groq Whisper path there.
    if (!SR || isElectron) {
      console.log('[VoiceFAB] Using MediaRecorder → backend Groq Whisper (no usable Web Speech API)');
      startMediaRecording();
      return;
    }

    const recognition = new SR();
    recognition.lang = getSpeechLang(language);
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setListeningText(transcript);

      if (event.results[event.results.length - 1].isFinal) {
        setInput(transcript);
        setIsListening(false);
        analyzeText(transcript);
      }
    };

    recognition.onerror = (e: any) => {
      // Never hide the error — log the full event, then recover by falling
      // back to the backend Groq Whisper path on service-level failures.
      console.error('[VoiceFAB] SpeechRecognition error (full):', e?.error, e);
      setIsListening(false);
      if (e?.error === 'no-speech') {
        notify('No speech detected. Try again or type instead.', 'warning');
        return;
      }
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'network') {
        console.warn('[VoiceFAB] Web Speech API unavailable (' + e?.error + ') — falling back to Groq Whisper');
        startMediaRecording();
        return;
      }
      notify(`Voice error (${e?.error || 'unknown'}). Type instead.`, 'warning');
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setListeningText('');
    setError(null);
    setParsedResult(null);
    setConfirmResult(null);
  }, [language, notify, startMediaRecording]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  // ==================================================================
  // CONFIRM / CANCEL
  // ==================================================================

  const handleConfirm = useCallback(async () => {
    if (!parsedResult?.parsed || !parsedResult.parsed.items.length) return;

    // Resolve stepper/picked quantities into the final edited items.
    const editedItems = parsedResult.parsed.items.map((item, i) => ({
      name: rowPicks[i] || item.canonicalName || item.item,
      quantity: rowQtys[i] ?? item.quantity,
      unit: item.unit || 'pcs',
      // Carry the spoken/average/edited rate so the server can apply it to
      // the product's averageCost on add. (null → cleared → no rate.)
      rate: rowRates[i] === undefined ? item.rate : rowRates[i] ?? undefined,
      productId: item.productId,
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

    if (pendingActionId && confirmationToken) {
      setIsConfirming(true);
      try {
        const { data } = await apiClient.post('/voice-inventory/confirm', {
          pendingActionId,
          confirmationToken,
          action: 'confirm',
          editedItems,
          date: confirmDate,
          supplier: confirmSupplier,
          brand: confirmBrand,
          expiryDate: confirmExpiry,
        });

        const result: ConfirmationResult = data;

        if (result.success) {
          setConfirmResult(result);

          // The server confirm endpoint is authoritative (it updated the
          // product catalog + stock atomically). Re-pull the catalog so new
          // auto-created items and updated stock appear immediately — the old
          // local addStock/removeStock loop DOUBLE-COUNTED stock for existing
          // items (server + client both applied the delta) and silently did
          // nothing for auto-created ones.
          inventory.refreshItems().catch(() => {});

          notify(
            `${INTENT_META[parsedResult.parsed!.intent].verb} ${editedItems.length} item(s) — done!`,
            'success'
          );

          setTimeout(() => {
            setIsOpen(false);
            setParsedResult(null);
            setConfirmResult(null);
            setInput('');
            setLogId(null);
            setPendingActionId(null);
            setConfirmationToken(null);
            setRowQtys({});
            setRowRates({});
            setRowPicks({});
            setEditableDate('');
            setEditableSupplier('');
            setEditableBrand('');
            setEditableExpiry('');
          }, 1200);
        } else {
          setError(result.error || 'Confirmation failed');
        }
      } catch (err: any) {
        setError(err.message || 'Confirmation failed');
      } finally {
        setIsConfirming(false);
      }
    } else if (logId) {
      // Legacy path (no pending token — e.g. non-mutating intents).
      setIsConfirming(true);
      try {
        const { data } = await apiClient.post('/voice-inventory/confirm', {
          logId,
          action: 'confirm',
          editedItems,
          date: confirmDate,
          supplier: confirmSupplier,
          brand: confirmBrand,
          expiryDate: confirmExpiry,
        });

        const result: ConfirmationResult = data;

        if (result.success) {
          setConfirmResult(result);

          // See the pending-action path above — the server is authoritative,
          // so just re-sync the local catalog (no local stock double-apply).
          inventory.refreshItems().catch(() => {});

          notify(
            `${INTENT_META[parsedResult.parsed!.intent].verb} ${editedItems.length} item(s) — done!`,
            'success'
          );

          setTimeout(() => {
            setIsOpen(false);
            setParsedResult(null);
            setConfirmResult(null);
            setInput('');
            setLogId(null);
            setPendingActionId(null);
            setConfirmationToken(null);
            setRowQtys({});
            setRowRates({});
            setRowPicks({});
            setEditableDate('');
            setEditableSupplier('');
            setEditableBrand('');
            setEditableExpiry('');
          }, 1200);
        } else {
          setError(result.error || 'Confirmation failed');
        }
      } catch (err: any) {
        setError(err.message || 'Confirmation failed');
      } finally {
        setIsConfirming(false);
      }
    } else {
      setError('Cannot confirm — missing confirmation token. Try parsing again.');
    }
  }, [parsedResult, logId, pendingActionId, confirmationToken, rowQtys, rowRates, rowPicks, editableDate, editableSupplier, editableBrand, editableExpiry, inventory, notify]);

const handleCancel = useCallback(() => {
  // Send cancel to backend — requires the pending token when present.
  if (pendingActionId && confirmationToken) {
    apiClient.post('/voice-inventory/confirm', { pendingActionId, confirmationToken, action: 'cancel' }).catch(() => {});
  } else if (logId) {
    apiClient.post('/voice-inventory/confirm', { logId, action: 'cancel' }).catch(() => {});
  }

  setParsedResult(null);
  setConfirmResult(null);
  setInput('');
  setError(null);
  setLogId(null);
  setPendingActionId(null);
  setConfirmationToken(null);
  setRowQtys({});
  setRowRates({});
  setRowPicks({});
  setEditableDate('');
  setEditableSupplier('');
  setEditableBrand('');
  setEditableExpiry('');
}, [logId, pendingActionId, confirmationToken]);

const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && input.trim()) analyzeText(input);
  if (e.key === 'Escape') handleClose();
};

const handleClose = () => {
  setIsOpen(false);
  setParsedResult(null);
  setConfirmResult(null);
  setInput('');
  setError(null);
  setLogId(null);
  setPendingActionId(null);
  setConfirmationToken(null);
  setRowQtys({});
  setRowRates({});
  setRowPicks({});
  setEditableDate('');
  setEditableSupplier('');
  setEditableBrand('');
  setEditableExpiry('');
  stopListening();
};

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
        {labels[level]} Confidence
      </span>
    );
  };

  const renderLanguageIndicator = (lang?: string) => {
    const langInfo = LANGUAGES.find(l => l.code === lang);
    if (!langInfo) return null;
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold">
        <Globe className="w-3 h-3" />
        {langInfo.native}
      </span>
    );
  };

  // ==================================================================
  // MAIN RENDER
  // ==================================================================

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => { setIsOpen(true); setError(null); }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--brand-color)] to-blue-600 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center z-[100] group"
        title="Voice Inventory Entry — Tap to speak"
      >
        <Mic className="w-6 h-6 group-hover:scale-110 transition-transform" />
      </button>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={handleClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={`bg-white rounded-3xl shadow-2xl max-w-lg w-full mx-auto overflow-hidden transition-all duration-300 ${
                parsedResult?.parsed && !confirmResult?.success ? 'sm:max-w-3xl' : ''
              }`}
              onClick={e => e.stopPropagation()}
            >
              {/* ================================================================ */}
              {/* HEADER */}
              {/* ================================================================ */}
              <div className="px-6 pt-6 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--brand-color)]/10 to-blue-50 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-[var(--brand-color)]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">
                      {confirmResult?.success ? '✅ Done!' : 'Voice Inventory'}
                    </h2>
                    <p className="text-[11px] text-gray-400">
                      {confirmResult?.success
                        ? 'Inventory updated successfully'
                        : 'Add stock, log waste — just say it'
                      }
                    </p>
                  </div>
                </div>

                {/* Language selector */}
                {!confirmResult?.success && (
                  <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-0.5 border border-gray-100">
                    {LANGUAGES.map(l => (
                      <button
                        key={l.code}
                        onClick={() => setLanguage(l.code)}
                        className={`px-2 py-1 rounded-[10px] text-[10px] font-bold transition-all cursor-pointer ${
                          language === l.code
                            ? 'bg-white text-[var(--brand-color)] shadow-sm'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {l.native}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ================================================================ */}
              {/* SUCCESS STATE */}
              {/* ================================================================ */}
              {confirmResult?.success && confirmResult.data && (
                <div className="px-6 py-6">
                  <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                    <p className="text-sm font-bold text-emerald-800 mb-3">
                      {confirmResult.data.updatedItems.length} item(s) updated:
                    </p>
                    <div className="space-y-2">
                      {confirmResult.data.updatedItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-emerald-100">
                          <span className="text-sm font-semibold">{item.itemName}</span>
                          <span className="text-xs text-gray-500">
                            {item.previousStock} → <span className="text-emerald-600 font-bold">{item.newStock}</span> {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ================================================================ */}
              {/* INPUT / MIC + ACTIVE COMMAND PANEL */}
              {/* Idle: full-width mic/input. Parsed: 2:3 split — input (left,
                  2/5) + Active Command Panel (right, 3/5) so confirmations
                  get more room. */}
              {/* ================================================================ */}
              {!confirmResult?.success && (
                <div className={`border-t border-[#e1e2ed] transition-all duration-300 ${parsedResult?.parsed ? 'sm:grid sm:grid-cols-5' : ''}`}>
                <div className={`${parsedResult?.parsed ? 'sm:col-span-2 sm:border-r border-[#e1e2ed] px-5 py-5 flex flex-col items-center gap-4' : 'px-6 py-6 flex flex-col items-center gap-5'}`}>
                  {/* Mic button */}
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`${parsedResult?.parsed ? 'w-20 h-20' : 'w-24 h-24'} rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg ${
                      isListening
                        ? 'bg-red-500 scale-110 shadow-red-200 animate-pulse'
                        : 'bg-gradient-to-br from-[var(--brand-color)] to-blue-600 hover:scale-105 hover:shadow-[var(--brand-color)]/30'
                    }`}
                    title={isListening ? 'Stop recording' : 'Start recording'}
                  >
                    {isListening
                      ? <Square className="w-8 h-8 text-white" />
                      : <Mic className="w-8 h-8 text-white" />
                    }
                  </button>

                  {/* Wave animation */}
                  {isListening && (
                    <div className="flex items-center gap-0.5 h-8">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-[3px] bg-gradient-to-t from-[var(--brand-color)] to-blue-400 rounded-full animate-pulse"
                          style={{
                            height: `${15 + Math.random() * 75}%`,
                            animationDelay: `${i * 0.05}s`,
                            animationDuration: `${0.5 + Math.random() * 0.5}s`,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <p className="text-sm font-medium text-gray-500">
                    {isListening
                      ? (listeningText || 'Listening...')
                      : 'Tap the mic or type your command'
                    }
                  </p>

                  {/* Error message */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="w-full p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5"
                      >
                        <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-700">{error}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Text input */}
                  {!isListening && (
                    <div className="w-full flex gap-2">
                      <div className="relative flex-1">
                        <MessageSquare className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          ref={inputRef}
                          type="text"
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={
                            language === 'hi'
                              ? 'जैसे \"20 किलो आटा डालें\" या \"3 पनीर खराब\"'
                              : language === 'hi-en'
                              ? 'e.g. \"20 kg atta add karo\" or \"3 paneer waste\"'
                              : 'e.g. \"add 20L milk\" or \"log 3 bread expired\"'
                          }
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-[#e1e2ed] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)] transition-all"
                          autoFocus
                        />
                      </div>
                      <button
                        onClick={() => analyzeText(input)}
                        disabled={!input.trim() || isParsing}
                        className="px-5 py-3 bg-[var(--brand-color)] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {isParsing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          'Go'
                        )}
                      </button>
                    </div>
                  )}

                  {/* Parsing indicator */}
                  {isParsing && (
                    <div className="flex items-center gap-2 text-xs text-[var(--brand-color)] font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      AI is parsing your command...
                    </div>
                  )}

                  {/* Example chips — hidden in split mode to save room */}
                  {!isListening && !isParsing && !parsedResult?.parsed && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[
                        { text: 'Add 20 kg flour', intent: 'add' as const },
                        { text: 'Log 3 paneer spoiled', intent: 'waste' as const },
                        { text: '5 litre doodh waste', intent: 'hinglish' as const },
                      ].map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => { setInput(ex.text); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-[10px] font-semibold text-gray-500 hover:border-[var(--brand-color)]/30 hover:text-[var(--brand-color)] transition-all cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3" />
                          {ex.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* ============================================================ */}
                {/* RIGHT — ACTIVE COMMAND PANEL (3/5) — confirmation */}
                {/* ============================================================ */}
                {parsedResult?.parsed && (
                <div className="sm:col-span-3 px-5 py-5">
                      {/* Intent badge + confidence */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{INTENT_META[parsedResult.parsed.intent].emoji}</span>
                          <span className="text-sm font-bold">
                            {INTENT_META[parsedResult.parsed.intent].label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderLanguageIndicator(parsedResult.parsed.language)}
                          {renderConfidenceBadge(parsedResult.parsed.confidence)}
                        </div>
                      </div>

                      {/* Transcript */}
                      <div className="bg-gray-50 rounded-xl px-3 py-2 mb-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase mb-1">You said</p>
                        <p className="text-sm text-gray-700">
                          &ldquo;{parsedResult.transcript}&rdquo;
                        </p>
                      </div>

                      {/* Supplier chip + editable purchase date — the date heard
                          in the command can be corrected before confirming
                          (voice adds record it into the purchases feed). */}
                      {(parsedResult.parsed.supplier || parsedResult.parsed.date || parsedResult.parsed.intent === 'inventory_add') && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                          {(parsedResult.parsed.supplier || parsedResult.parsed.intent === 'inventory_add') && (
                            <div
                              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100/70 transition-all"
                              title="Supplier — tap to correct a misheard vendor"
                            >
                              <PackageIcon className="w-3 h-3 shrink-0" />
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
                              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-[10px] font-bold text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100/70 transition-all"
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
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-purple-50 border border-purple-200 text-[10px] font-bold text-purple-700 cursor-pointer hover:border-purple-300 hover:bg-purple-100/70 transition-all [color-scheme:light]"
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
                              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700 hover:border-rose-300 hover:bg-rose-100/70 transition-all [color-scheme:light]"
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

                      {/* Missing fields warning */}
                      {parsedResult.missingFields && parsedResult.missingFields.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-amber-800 mb-1">Missing information</p>
                              <ul className="space-y-0.5">
                                {parsedResult.missingFields.map((f, i) => (
                                  <li key={i} className="text-[11px] text-amber-700">• {f}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Suggestions */}
                      {parsedResult.suggestions && parsedResult.suggestions.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 mb-3">
                          <p className="text-xs font-bold text-blue-800 mb-1.5">💡 Suggestions</p>
                          <ul className="space-y-0.5">
                            {parsedResult.suggestions.map((s, i) => (
                              <li key={i} className="text-[11px] text-blue-700">
                                <button
                                  onClick={() => setInput(s)}
                                  className="hover:underline cursor-pointer text-left"
                                >
                                  {s}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Items list with steppers + stock preview */}
                      <div className="space-y-2 mb-4">
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
                          const newStock = isAdd ? currentStock + qty :
                            isRemove ? Math.max(0, currentStock - qty) :
                            qty;
                          const stockChange = newStock - currentStock;
                          const diffColor = stockChange > 0 ? 'text-emerald-600' :
                            stockChange < 0 ? 'text-red-600' : 'text-gray-400';

                          const isAmbiguous = !!item.ambiguous || (!item.canonicalName && (item.candidates?.length || 0) > 0);
                          const candidates = item.candidates && item.candidates.length > 1
                            ? item.candidates
                            : inventory.items.filter(
                                inv => inv.name.toLowerCase().includes((item.item || '').toLowerCase()) ||
                                       (item.item || '').toLowerCase().includes(inv.name.toLowerCase())
                              ).map(c => ({ name: c.name, unit: c.unit, currentStock: c.currentStock }));

                          return (
                            <div key={i} className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-800 truncate">
                                    {isAmbiguous
                                      ? item.item
                                      : rowPicks[i] || item.canonicalName || item.item}
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    {qty} {unit} × {INTENT_META[parsedResult.parsed!.intent].verb}
                                  </p>
                                </div>
                                {existing && (
                                  <div className={`text-right text-xs font-bold ${diffColor}`}>
                                    <span className="text-gray-400">{currentStock}</span>
                                    <ArrowRight className="w-3 h-3 inline mx-1" />
                                    <span>{newStock}</span>
                                    <span className="text-gray-400 ml-1">{unit}</span>
                                  </div>
                                )}
                              </div>

                              {/* AMBIGUOUS / unresolved item — MUST be resolved before confirm */}
                              {isAmbiguous && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                    <p className="text-[11px] font-bold text-amber-800">
                                      Which item did you mean? (unresolved)
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {candidates && candidates.length > 0 ? (
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
                                        No matching inventory item found. It may be a new product.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Quantity stepper */}
                              <div className="flex items-center justify-between mt-2">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setRowQtys(q => ({ ...q, [i]: Math.max(0.05, (q[i] ?? item.quantity) - stepFor(unit)) }))}
                                    className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-all"
                                    aria-label={`Decrease ${item.item}`}
                                  >
                                    <span className="text-sm leading-none font-bold">−</span>
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
                                    onClick={() => setRowQtys(q => ({ ...q, [i]: (q[i] ?? item.quantity) + stepOf(unit) }))}
                                    disabled={isConfirming}
                                    className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-all"
                                    aria-label={`Increase ${rowPicks[i] || item.canonicalName || item.item}`}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <span className="text-[10px] text-gray-400">{unit}</span>
                              </div>

                              {/* Purchase rate (₹/unit) — spoken, catalog average, or editable */}
                              {(() => {
                                const rateTouched = rowRates[i] !== undefined;
                                const rateVal = rateTouched ? rowRates[i] ?? undefined : item.rate;
                                const rateLabel = !rateTouched
                                  ? item.rateSource === 'spoken'
                                    ? 'Spoken'
                                    : item.rateSource === 'average'
                                      ? 'Avg rate'
                                      : null
                                  : null;
                                return (
                                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-dashed border-gray-200">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Rate</span>
                                      {rateLabel && (
                                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                          item.rateSource === 'spoken'
                                            ? 'bg-emerald-50 text-emerald-600'
                                            : 'bg-blue-50 text-blue-600'
                                        }`}>
                                          {rateLabel}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500">₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        value={rateVal == null ? '' : rateVal}
                                        onChange={e => {
                                          const v = e.target.value.trim();
                                          setRowRates(q => ({ ...q, [i]: v === '' ? null : parseFloat(v) }));
                                        }}
                                        placeholder="—"
                                        disabled={isConfirming}
                                        className="w-20 text-right text-sm font-bold bg-white border border-[#e1e2ed] rounded-lg py-1 px-2 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 disabled:opacity-50"
                                        aria-label={`Rate for ${item.item}`}
                                      />
                                      <span className="text-[10px] text-gray-400">/{unit}</span>
                                      {!rateVal && existing?.averageCost > 0 && (
                                        <button
                                          onClick={() => setRowRates(q => ({ ...q, [i]: existing.averageCost }))}
                                          disabled={isConfirming}
                                          className="text-[10px] text-blue-600 hover:underline font-semibold whitespace-nowrap cursor-pointer"
                                          title={`Use catalog average rate ₹${existing.averageCost}/${unit}`}
                                        >
                                          avg ₹{existing.averageCost}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Stock level bar */}
                              {existing && existing.currentStock > 0 && (
                                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mt-2">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      newStock > existing.maxStock * 0.8 ? 'bg-emerald-500' :
                                      newStock < existing.minStock ? 'bg-red-500' :
                                      'bg-amber-500'
                                    }`}
                                    style={{
                                      width: `${Math.min(100, (newStock / existing.maxStock) * 100)}%`,
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
                        <button
                          onClick={handleCancel}
                          disabled={isConfirming}
                          className="px-4 py-2.5 border border-gray-300 rounded-xl text-xs font-semibold hover:bg-gray-50 cursor-pointer transition-all disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirm}
                          disabled={
                            isConfirming
                            || parsedResult.parsed.items.length === 0
                            || parsedResult.parsed.items.some((item, i) =>
                                (!!item.ambiguous || (!item.canonicalName && (item.candidates?.length || 0) > 0)) && !rowPicks[i]
                              )
                          }
                          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 cursor-pointer transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isConfirming ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
