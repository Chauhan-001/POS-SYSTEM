import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, Square, Check, X, History, Package, Plus, Minus, Trash2, ShoppingCart, MessageSquare, AlertTriangle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotify, useInventory } from '../InventoryManager';
import type { InventoryItem } from '../types';
import { getAuthToken } from '../../../src/api/client';
import {
  mapLlmAction,
  type LlmParseResponse,
  type LlmActionResult,
  type ActionType as LlmActionType,
} from '../../../src/ai/llmActionMapper';

type LogEntry = {
  id: string;
  type: LlmActionType;
  summary: string;
  timestamp: string;
};

type DiagnosticInfo = {
  frontendError?: string;
  backendError?: string;
  httpStatus?: number | string;
  groqResponse?: string;
  stackTrace?: string;
  requestUrl?: string;
  modelName?: string;
  endpointUsed?: string;
  sdkMethod?: string;
};

const actionMeta: Record<LlmActionType, { icon: typeof Package; color: string }> = {
  add_stock: { icon: ShoppingCart, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  log_waste: { icon: Trash2, color: 'bg-red-50 border-red-200 text-red-700' },
  remove_stock: { icon: Minus, color: 'bg-amber-50 border-amber-200 text-amber-700' },
  adjust_stock: { icon: Plus, color: 'bg-blue-50 border-blue-200 text-blue-700' },
  purchase_reminder: { icon: ShoppingCart, color: 'bg-purple-50 border-purple-200 text-purple-700' },
  supplier_update: { icon: Package, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
};

function DiagPanel({ diag }: { diag: DiagnosticInfo }) {
  const rows: Array<[string, string | number | undefined]> = [
    ['Frontend error', diag.frontendError],
    ['Backend error', diag.backendError],
    ['HTTP status', diag.httpStatus],
    ['Groq response', diag.groqResponse],
    ['Request URL', diag.requestUrl],
    ['Model name', diag.modelName],
    ['Endpoint used', diag.endpointUsed],
    ['SDK method', diag.sdkMethod],
  ];
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <h2 className="text-xs font-bold text-red-700 uppercase">Complete Error Diagnostics</h2>
      </div>
      <div className="space-y-1.5 font-mono text-[11px]">
        {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-red-500 font-bold uppercase tracking-wide">{label}</span>
            <span className="text-red-800 bg-white rounded-lg px-2 py-1 border border-red-100 break-all whitespace-pre-wrap">{value}</span>
          </div>
        ))}
        {diag.stackTrace && (
          <div className="flex flex-col gap-0.5">
            <span className="text-red-500 font-bold uppercase tracking-wide">Stack trace</span>
            <pre className="text-red-800 bg-white rounded-lg px-2 py-1 border border-red-100 break-all whitespace-pre-wrap overflow-x-auto">{diag.stackTrace}</pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function VoicePage() {
  const notify = useNotify();
  const inventory = useInventory();
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsed, setParsed] = useState<LlmActionResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [listeningText, setListeningText] = useState('');
  const [diag, setDiag] = useState<DiagnosticInfo | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ─── LLM parse (production path) ───────────────────────────────
  // Microphone → Groq Whisper → Transcript → /api/voice-inventory/parse
  // → Groq Llama structured JSON → Alias dictionary → inventory action.
  // Does NOT use the rule-based parseCommand().
  const analyze = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsParsing(true);
    setDiag(null);
    setParsed(null);
    const REQUEST_URL = '/api/voice-inventory/parse';
    try {
      const response = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({
          transcript: trimmed,
          language: 'hi-en',
          items: inventory.items.map(i => ({ name: i.name, unit: i.unit })),
        }),
      });
      let result: LlmParseResponse;
      try {
        result = await response.json();
      } catch {
        result = { success: false, error: 'Backend returned non-JSON response', latencyMs: 0 };
      }
      console.log('[VoicePage] LLM parse response', { status: response.status, result });

      if (!response.ok) {
        const d: DiagnosticInfo = {
          frontendError: `Parse HTTP ${response.status}`,
          backendError: result?.error,
          httpStatus: response.status,
          requestUrl: REQUEST_URL,
        };
        setDiag(d);
        notify(result?.error || `Parse failed (HTTP ${response.status}). Type instead.`, 'warning');
        return;
      }
      if (!result.success || !result.parsed) {
        const d: DiagnosticInfo = {
          frontendError: 'LLM parse returned no structured action',
          backendError: result?.error,
          httpStatus: response.status,
          requestUrl: REQUEST_URL,
        };
        setDiag(d);
        notify(result?.error || 'Could not understand. Try "add 20L milk" or "log 3 bread as expired".', 'warning');
        return;
      }

      const action = mapLlmAction(result, inventory.items);
      if (!action) {
        setDiag({
          frontendError: `LLM returned intent "${result.parsed.intent}" but no actionable item/quantity`,
          backendError: result?.error,
          httpStatus: response.status,
          requestUrl: REQUEST_URL,
        });
        notify('Could not understand — missing item or quantity. Try again.', 'warning');
        return;
      }

      setParsed(action);
      setInput('');
    } catch (err: any) {
      console.error('[VoicePage] LLM parse error (full):', err);
      setDiag({
        frontendError: err?.message || String(err),
        stackTrace: err?.stack || undefined,
        requestUrl: REQUEST_URL,
      });
      notify(err?.message || 'Failed to connect. Is the backend running?', 'warning');
    } finally {
      setIsParsing(false);
    }
  }, [inventory.items, notify]);

  // ─── MediaRecorder fallback (Electron / no Web Speech API) ───────
  // Records audio, transcribes via Groq Whisper on the backend, then runs
  // the normal local parse.
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

  const transcribeAudioBlob = useCallback(async (blob: Blob) => {
    setIsListening(false);
    setListeningText('Transcribing audio...');
    const REQUEST_URL = '/api/voice-inventory/transcribe';
    try {
      const audioBase64 = await blobToBase64(blob);
      console.log('[VoicePage] Sending transcribe request', {
        endpoint: REQUEST_URL,
        method: 'POST',
        payloadBase64Chars: audioBase64.length,
        mimeType: blob.type || 'audio/webm',
        blobSize: blob.size,
        authHeaderPresent: !!getAuthToken(), // presence only — never the token
      });
      const response = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken() || ''}`,
        },
        body: JSON.stringify({
          audio: audioBase64,
          audioMimeType: blob.type || 'audio/webm',
          language: 'hi-en',
        }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        console.error('[VoicePage] Transcribe HTTP error', response.status, errText);
        throw new Error(`Transcribe API error (${response.status}): ${errText.slice(0, 100)}`);
      }
      const result = await response.json();
      console.log('[VoicePage] Transcribe response', { success: result.success, transcript: result.transcript, confidence: result.confidence, error: result.error, diagnostics: result.diagnostics });
      if (!result.success || !result.transcript) {
        const e = new Error(result.error || 'No speech detected');
        (e as any).backendError = result.error;
        (e as any).diagnostics = result.diagnostics;
        (e as any).httpStatus = response.status;
        (e as any).requestUrl = REQUEST_URL;
        throw e;
      }
      // LOG: Whisper transcript → feed into LLM parse
      console.log('[VoicePage] Whisper transcript → LLM parse:', JSON.stringify(result.transcript));
      await analyze(result.transcript);
    } catch (err: any) {
      console.error('[VoicePage] Transcribe error (full):', err);
      const d: DiagnosticInfo = {
        frontendError: err?.message || String(err),
        stackTrace: err?.stack || undefined,
        httpStatus: err?.httpStatus,
        requestUrl: err?.requestUrl || REQUEST_URL,
      };
      if (err?.backendError) d.backendError = err.backendError;
      if (err?.diagnostics) {
        d.groqResponse = err.diagnostics.responseBody;
        d.modelName = err.diagnostics.model;
        d.endpointUsed = err.diagnostics.requestUrl;
        d.sdkMethod = err.diagnostics.endpointMethod;
        d.backendError = d.backendError || err.diagnostics.message;
        if (!d.httpStatus && err.diagnostics.status) d.httpStatus = err.diagnostics.status;
        if (!d.stackTrace) d.stackTrace = err.diagnostics.stack;
      }
      setDiag(d);
    } finally {
      setIsListening(false);
    }
  }, [notify, analyze]);

  const startMediaRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error('[VoicePage] navigator.mediaDevices.getUserMedia NOT available');
        setDiag({ frontendError: 'navigator.mediaDevices.getUserMedia is not available in this Electron/browser build' });
        notify('Microphone not available in this browser. Type instead.', 'warning');
        return;
      }
      console.log('[VoicePage] Requesting mic permission (getUserMedia)...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VoicePage] Mic permission GRANTED, tracks:', stream.getAudioTracks().map(t => t.label || t.kind));

      // Log MediaRecorder support BEFORE constructing (Electron/Chromium may
      // not support webm+opus; Safari differs too).
      const supported = typeof MediaRecorder !== 'undefined'
        ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
            .filter(t => MediaRecorder.isTypeSupported(t))
        : [];
      console.log('[VoicePage] MediaRecorder supported types:', supported);

      const recorder = new MediaRecorder(stream);
      console.log('[VoicePage] MediaRecorder created, mimeType:', recorder.mimeType, '| state:', recorder.state);
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
          console.warn('[VoicePage] Could not decode audio for sample rate:', decodeErr?.message || decodeErr);
        }
        console.log('[VoicePage] Audio blob produced', info);
        await transcribeAudioBlob(blob);
      };
      recorder.onerror = (e: any) => {
        console.error('[VoicePage] MediaRecorder error (full):', e?.error || e);
        stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        setDiag({
          frontendError: `MediaRecorder error: ${e?.error?.message || JSON.stringify(e?.error || e)}`,
          stackTrace: e?.error?.stack || undefined,
        });
      };
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = chunks;
      recorder.start();
      setIsListening(true);
      setListeningText('');
    } catch (err: any) {
      console.error('[VoicePage] Mic permission DENIED or error (full):', err?.name, err?.message, err?.stack || err);
      setIsListening(false);
      setDiag({
        frontendError: `Microphone access error: ${err?.name || err?.message || 'unknown'}`,
        stackTrace: err?.stack || undefined,
      });
    }
  }, [notify, transcribeAudioBlob]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isElectron = !!(window as any).electronAPI;
    console.log('[VoicePage] startListening', { hasWebSpeechAPI: !!SR, isElectron });

    // In Electron the Web Speech API often exists but cannot reach Google's
    // service (network/service-not-allowed) — ALWAYS use the backend Groq
    // Whisper path there instead of the browser's Web Speech API.
    if (!SR || isElectron) {
      console.log('[VoicePage] Using MediaRecorder → backend Groq Whisper (no usable Web Speech API)');
      startMediaRecording();
      return;
    }
    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setListeningText(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        console.log('[VoicePage] Web Speech final transcript:', transcript);
        setInput(transcript);
        setIsListening(false);
        analyze(transcript);
      }
    };
      recognition.onerror = (e: any) => {
        // NEVER hide the error — log the code + event, then fall back to the
        // backend Groq Whisper path on service-level failures instead of
        // showing the generic "Voice failed" toast.
        console.error('[VoicePage] SpeechRecognition error (full):', e?.error, e);
        setIsListening(false);
        setDiag({
          frontendError: `SpeechRecognition error code: ${e?.error || 'unknown'}`,
          stackTrace: e?.stack || undefined,
        });
        if (e?.error === 'no-speech') {
          notify('No speech detected. Try again or type instead.', 'warning');
          return;
        }
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'network') {
          console.warn('[VoicePage] Web Speech API unavailable (' + e?.error + ') — falling back to Groq Whisper');
          startMediaRecording();
          return;
        }
        notify(`Voice error (${e?.error || 'unknown'}). Try typing.`, 'warning');
      };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setListeningText('');
  }, [notify, startMediaRecording]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  const confirmAction = () => {
    if (!parsed) return;
    parsed.exec(inventory, notify);
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
            {isListening ? (listeningText || 'Listening...') : isParsing ? 'Parsing with AI...' : 'Tap mic or type a command'}
          </p>

          {!isListening && (
            <div className="w-full flex gap-2">
              <div className="relative flex-1">
                <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !isParsing) analyze(input); }}
                  disabled={isParsing}
                  className="w-full pl-9 pr-3 py-3 bg-gray-50 border border-[#e1e2ed] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#004ac6]/20 focus:border-[#004ac6] disabled:opacity-50"
                  placeholder='e.g. "add 20L milk at ₹56 from Amul Dairy"' />
              </div>
              <button onClick={() => analyze(input)} disabled={isParsing || !input.trim()}
                className="px-5 py-3 bg-[#004ac6] text-white rounded-2xl text-sm font-bold hover:bg-[#003ea8] transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Go'}
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Complete error diagnostics (only when a failure occurred) */}
      {diag && (
        <div className="relative">
          <button onClick={() => setDiag(null)}
            className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center cursor-pointer shadow"
            title="Dismiss"
          ><X className="w-3 h-3" /></button>
          <DiagPanel diag={diag} />
        </div>
      )}

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
