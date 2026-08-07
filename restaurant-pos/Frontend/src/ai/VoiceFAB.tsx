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
  Edit3, Volume2, Globe,
} from 'lucide-react';
import type { InventoryItem } from '../../components/inventory/types';
import { useNotify, useInventory } from '../../components/inventory/InventoryManager';
import { getAuthToken } from '../api/client';

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
}

interface VoiceParseResult {
  success: boolean;
  auditLogId?: string;
  transcript?: string;
  parsed?: {
    intent: IntentType;
    items: ParsedItem[];
    confidence: number;
    language?: string;
    originalText: string;
    error?: string;
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

    try {
      const response = await fetch('/api/voice-inventory/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({
          transcript: trimmed,
          language,
          items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error (${response.status}): ${errText.slice(0, 100)}`);
      }

      const result: VoiceParseResult = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to parse voice command');
        return;
      }

      setParsedResult(result);
      if (result.auditLogId) setLogId(result.auditLogId);
    } catch (err: any) {
      console.error('[VoiceFAB] Parse error:', err.message);
      setError(err.message || 'Failed to connect. Is the backend running?');

      // Fallback: try the old /api/ai/inventory-voice endpoint
      try {
        const fallbackRes = await fetch('/api/ai/inventory-voice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken() || ''}`,
          },
          body: JSON.stringify({
            transcript: trimmed,
            items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
          }),
        });
        const fbData = await fallbackRes.json();
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
        authHeaderPresent: !!getAuthToken(), // presence only — never the token
      });
      const response = await fetch('/api/voice-inventory/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({
          audio: audioBase64,
          audioMimeType: blob.type || 'audio/webm',
          language,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        console.error('[VoiceFAB] Transcribe HTTP error', response.status, errText);
        throw new Error(`Transcribe API error (${response.status}): ${errText.slice(0, 100)}`);
      }

      const result = await response.json();
      console.log('[VoiceFAB] Transcribe response', { success: result.success, transcript: result.transcript, confidence: result.confidence, error: result.error });
      if (!result.success || !result.transcript) {
        throw new Error(result.error || 'No speech detected');
      }
      setInput(result.transcript);
      analyzeText(result.transcript);
    } catch (err: any) {
      console.error('[VoiceFAB] Transcribe error (full):', err);
      setError(err.message || 'Transcription failed. Type instead.');
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
    if (!logId) {
      setError('Cannot confirm — no audit log reference. Try parsing again.');
      return;
    }

    setIsConfirming(true);

    try {
      const response = await fetch('/api/voice-inventory/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({
          logId,
          action: 'confirm',
          editedItems: parsedResult.parsed.items.map(i => ({
            name: i.canonicalName || i.item,
            quantity: i.quantity,
            unit: i.unit || 'pcs',
          })),
        }),
      });

      const result: ConfirmationResult = await response.json();

      if (result.success) {
        setConfirmResult(result);

        // Update local inventory state
        const intent = parsedResult.parsed!.intent;
        for (const item of parsedResult.parsed!.items) {
          const name = item.canonicalName || item.item;
          const existing = inventory.items.find(
            i => i.name.toLowerCase() === name.toLowerCase()
          );
          if (existing) {
            if (intent === 'inventory_add') {
              inventory.addStock(existing.name, item.quantity);
            } else if (intent === 'inventory_remove' || intent === 'inventory_waste') {
              inventory.removeStock(existing.name, item.quantity);
            }
          }
        }

        notify(
          `${INTENT_META[parsedResult.parsed!.intent].verb} ${parsedResult.parsed!.items.length} item(s) — done!`,
          'success'
        );

        // Close after showing success briefly
        setTimeout(() => {
          setIsOpen(false);
          setParsedResult(null);
          setConfirmResult(null);
          setInput('');
        }, 1200);
      } else {
        setError(result.error || 'Confirmation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Confirmation failed');
    } finally {
      setIsConfirming(false);
    }
  }, [parsedResult, logId, inventory, notify]);

  const handleCancel = useCallback(() => {
    // Send cancel to backend if we have a logId
    if (logId) {
      fetch('/api/voice-inventory/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({ logId, action: 'cancel' }),
      }).catch(() => {});
    }

    setParsedResult(null);
    setConfirmResult(null);
    setInput('');
    setError(null);
    setLogId(null);
  }, [logId]);

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
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[#004ac6] to-blue-600 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center z-[100] group"
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
              className="bg-white rounded-3xl shadow-2xl max-w-lg w-full mx-auto overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* ================================================================ */}
              {/* HEADER */}
              {/* ================================================================ */}
              <div className="px-6 pt-6 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#004ac6]/10 to-blue-50 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-[#004ac6]" />
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
                            ? 'bg-white text-[#004ac6] shadow-sm'
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
              {/* INPUT / MIC AREA (shown when no result yet) */}
              {/* ================================================================ */}
              {!parsedResult && !confirmResult?.success && (
                <div className="px-6 py-6 flex flex-col items-center gap-5">
                  {/* Mic button */}
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`w-24 h-24 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg ${
                      isListening
                        ? 'bg-red-500 scale-110 shadow-red-200 animate-pulse'
                        : 'bg-gradient-to-br from-[#004ac6] to-blue-600 hover:scale-105 hover:shadow-[#004ac6]/30'
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
                          className="w-[3px] bg-gradient-to-t from-[#004ac6] to-blue-400 rounded-full animate-pulse"
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
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-[#e1e2ed] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6] transition-all"
                          autoFocus
                        />
                      </div>
                      <button
                        onClick={() => analyzeText(input)}
                        disabled={!input.trim() || isParsing}
                        className="px-5 py-3 bg-[#004ac6] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
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
                    <div className="flex items-center gap-2 text-xs text-[#004ac6] font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      AI is parsing your command...
                    </div>
                  )}

                  {/* Example chips */}
                  {!isListening && !isParsing && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[
                        { text: 'Add 20 kg flour', intent: 'add' as const },
                        { text: 'Log 3 paneer spoiled', intent: 'waste' as const },
                        { text: '5 litre doodh waste', intent: 'hinglish' as const },
                      ].map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => { setInput(ex.text); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-[10px] font-semibold text-gray-500 hover:border-[#004ac6]/30 hover:text-[#004ac6] transition-all cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3" />
                          {ex.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ================================================================ */}
              {/* CONFIRMATION SCREEN */}
              {/* ================================================================ */}
              <AnimatePresence>
                {parsedResult?.parsed && !confirmResult?.success && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-[#e1e2ed] overflow-hidden"
                  >
                    <div className="px-6 py-4">
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

                      {/* Items list with stock preview */}
                      <div className="space-y-2 mb-4">
                        {parsedResult.parsed.items.map((item, i) => {
                          const existing = inventory.items.find(
                            inv => inv.name.toLowerCase() === (item.canonicalName || item.item).toLowerCase()
                          );
                          const currentStock = existing?.currentStock ?? 0;
                          const unit = item.unit || existing?.unit || 'pcs';
                          const isAdd = parsedResult.parsed!.intent === 'inventory_add';
                          const isRemove = parsedResult.parsed!.intent === 'inventory_remove' || parsedResult.parsed!.intent === 'inventory_waste';
                          const newStock = isAdd ? currentStock + item.quantity :
                            isRemove ? Math.max(0, currentStock - item.quantity) :
                            item.quantity;
                          const stockChange = newStock - currentStock;
                          const diffColor = stockChange > 0 ? 'text-emerald-600' :
                            stockChange < 0 ? 'text-red-600' : 'text-gray-400';

                          return (
                            <div key={i} className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-800 truncate">
                                    {item.canonicalName || item.item}
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    {item.quantity} {unit} × {INTENT_META[parsedResult.parsed!.intent].verb}
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

                              {/* Stock level bar */}
                              {existing && existing.currentStock > 0 && (
                                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
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
                          disabled={isConfirming || parsedResult.parsed.items.length === 0}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
