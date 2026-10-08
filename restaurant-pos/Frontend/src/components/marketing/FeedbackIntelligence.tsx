/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeedbackIntelligence — the three intelligence tabs of the feedback
 * workspace (FeedRag-style):
 *
 *   FeedbackAnalyticsTab — aspect breakdown, weekly sentiment trend,
 *                          executive AI insight (cached, regenerable).
 *   FeedbackIssuesTab    — recurring problem categories, severity-ranked.
 *   FeedbackAskTab       — RAG "ask your feedback" chat with cited sources.
 *
 * All AI features degrade gracefully: when the AI layer is unavailable the
 * backend answers with deterministic fallbacks and the UI labels them
 * honestly ("AI unavailable — showing computed summary").
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, Sparkles, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Send, Quote, BarChart3 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import * as api from '../../api/client';
import { debugWarn } from '../../utils/debugLog';
import { EmptyState, fmtNumber } from './shared';

const ASPECT_LABELS: Record<string, string> = {
  food_quality: 'Food quality', taste: 'Taste', temperature: 'Temperature', service: 'Service',
  staff: 'Staff', waiting_time: 'Wait time', price: 'Price', ambience: 'Ambience',
  cleanliness: 'Cleanliness', portion_size: 'Portions', delivery: 'Delivery', packaging: 'Packaging',
  menu: 'Menu', value_for_money: 'Value for money',
};

const ISSUE_LABELS: Record<string, string> = {
  waiting_time: 'Waiting time', food_temperature: 'Food temperature', food_quality: 'Food quality',
  service_attitude: 'Service attitude', order_accuracy: 'Order accuracy', cleanliness: 'Cleanliness',
  price_value: 'Price / value', portion_size: 'Portion size', delivery_delay: 'Delivery delay',
  packaging: 'Packaging', staff_behaviour: 'Staff behaviour', other: 'Other',
};

const label = (key: string, map: Record<string, string>) => map[key] ?? key.replace(/_/g, ' ');

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  );
}

function AiBadge({ source }: { source: 'ai' | 'local' }) {
  return source === 'ai' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 text-[9px] font-black uppercase">
      <Sparkles className="w-2.5 h-2.5" /> AI
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-lg bg-gray-50 text-gray-500 border border-gray-200 text-[9px] font-black uppercase">
      Computed
    </span>
  );
}

// ─── Analytics tab ───────────────────────────────────────────────

interface AnalyticsData {
  totalAnalyzed: number;
  totalFeedback: number;
  sentiment: Record<string, number>;
  aspects: { aspect: string; mentions: number; avgScore: number; positive: number; negative: number }[];
  weeklyTrend: { weekStart: string; avgScore: number; count: number }[];
  severity: Record<string, number>;
}

interface InsightData {
  headline: string;
  paragraphs: string[];
  recommendations: string[];
  source: 'ai' | 'local';
  generatedAt: string;
}

export function FeedbackAnalyticsTab() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, i] = await Promise.all([api.fetchFeedbackAnalytics(), api.fetchFeedbackInsight()]);
      const ad: any = a?.data || a;
      const id: any = i?.data || i;
      if (ad?.success) setAnalytics(ad.analytics);
      if (id?.success && id.insight) setInsight(id.insight);
    } catch (err) {
      debugWarn('FeedbackIntel', 'analytics load failed:', err);
      setError('Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerateInsight = async () => {
    setGenerating(true);
    try {
      const res: any = await api.generateFeedbackInsight();
      const d = res?.data || res;
      if (d?.success) setInsight(d.insight);
    } catch (err) {
      debugWarn('FeedbackIntel', 'insight generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs font-semibold">Analyzing feedback…</span>
      </div>
    );
  }
  if (error) return <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">{error}</div>;
  if (!analytics || analytics.totalFeedback === 0) {
    return <EmptyState icon="📊" title="No data yet" subtitle="Analytics appear once customers start leaving feedback." />;
  }

  const sentimentData = [
    { name: 'Positive', value: analytics.sentiment.positive || 0, color: '#10b981' },
    { name: 'Mixed', value: analytics.sentiment.mixed || 0, color: '#f59e0b' },
    { name: 'Neutral', value: analytics.sentiment.neutral || 0, color: '#9ca3af' },
    { name: 'Negative', value: analytics.sentiment.negative || 0, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      {/* Executive insight */}
      <SectionCard title="Executive Summary">
        {insight ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AiBadge source={insight.source} />
              <span className="text-[9px] text-gray-400">
                {new Date(insight.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                onClick={regenerateInsight}
                disabled={generating}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 text-[10px] font-bold text-gray-500 hover:border-teal-300 hover:text-teal-600 cursor-pointer disabled:opacity-40"
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Regenerate
              </button>
            </div>
            <p className="text-sm font-black text-gray-900">{insight.headline}</p>
            {insight.paragraphs.map((p, i) => (
              <p key={i} className="text-xs text-gray-600 leading-relaxed">{p}</p>
            ))}
            {insight.recommendations.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {insight.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 bg-teal-50/60 border border-teal-100 rounded-xl px-3 py-2">
                    <Sparkles className="w-3 h-3 text-teal-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-teal-800 font-semibold">{r}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">Generate an AI executive summary of your customer feedback.</p>
            <button
              onClick={regenerateInsight}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50 shrink-0"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate
            </button>
          </div>
        )}
      </SectionCard>

      {/* Sentiment split */}
      <SectionCard title="Sentiment Split">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {sentimentData.map((d) => (
            <div key={d.name} className="rounded-xl border border-[var(--color-border-default)] p-3 text-center">
              <p className="text-xl font-black" style={{ color: d.color }}>{fmtNumber(d.value)}</p>
              <p className="text-[10px] font-bold text-gray-400">{d.name}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Weekly trend */}
      {analytics.weeklyTrend.some((w) => w.count > 0) && (
        <SectionCard title="Sentiment Trend (last 8 weeks)">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={analytics.weeklyTrend.map((w) => ({ ...w, label: w.weekStart.slice(5) }))}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis domain={[-1, 1]} tick={{ fontSize: 10 }} stroke="#9ca3af" width={32} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 12, border: '1px solid #e5e7eb' }}
                formatter={(v: any) => [v, 'Sentiment']}
              />
              <Line type="monotone" dataKey="avgScore" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-1">+1 = fully positive, −1 = fully negative</p>
        </SectionCard>
      )}

      {/* Aspect breakdown */}
      {analytics.aspects.length > 0 && (
        <SectionCard title="Aspect Breakdown">
          <ResponsiveContainer width="100%" height={Math.max(160, analytics.aspects.length * 34)}>
            <BarChart data={analytics.aspects.map((a) => ({ name: label(a.aspect, ASPECT_LABELS), score: a.avgScore }))} layout="vertical">
              <XAxis type="number" domain={[-1, 1]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" width={110} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 12, border: '1px solid #e5e7eb' }} formatter={(v: any) => [v, 'Avg score']} />
              <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                {analytics.aspects.map((a, i) => (
                  <Cell key={i} fill={a.avgScore > 0.1 ? '#10b981' : a.avgScore < -0.1 ? '#ef4444' : '#9ca3af'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-1">{fmtNumber(analytics.totalAnalyzed)} of {fmtNumber(analytics.totalFeedback)} feedback entries analyzed</p>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Issues tab ──────────────────────────────────────────────────

interface IssueSummary {
  category: string;
  count: number;
  maxSeverity: 'low' | 'medium' | 'high' | 'critical';
  firstSeen: string;
  lastSeen: string;
  trend: 'rising' | 'stable' | 'falling';
  sampleEvidence: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-gray-50 text-gray-600 border-gray-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

function TrendIcon({ trend }: { trend: 'rising' | 'stable' | 'falling' }) {
  if (trend === 'rising') return <span className="inline-flex items-center gap-0.5 text-red-500 text-[10px] font-bold"><TrendingUp className="w-3 h-3" /> rising</span>;
  if (trend === 'falling') return <span className="inline-flex items-center gap-0.5 text-emerald-600 text-[10px] font-bold"><TrendingDown className="w-3 h-3" /> falling</span>;
  return <span className="inline-flex items-center gap-0.5 text-gray-400 text-[10px] font-bold"><Minus className="w-3 h-3" /> stable</span>;
}

export function FeedbackIssuesTab() {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res: any = await api.fetchFeedbackIssues();
        const d = res?.data || res;
        if (d?.success) setIssues(d.issues || []);
      } catch (err) {
        debugWarn('FeedbackIntel', 'issues load failed:', err);
        setError('Could not load issues.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs font-semibold">Loading issues…</span>
      </div>
    );
  }
  if (error) return <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600">{error}</div>;
  if (issues.length === 0) {
    return <EmptyState icon="✅" title="No recurring issues detected" subtitle="When multiple customers flag the same problem, it will be tracked here by severity." />;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400">Recurring problems ranked by severity and frequency.</p>
      {issues.map((iss) => (
        <div key={iss.category} className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-black text-gray-900">{label(iss.category, ISSUE_LABELS)}</p>
                <p className="text-[10px] text-gray-400">
                  First {new Date(iss.firstSeen).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · Last {new Date(iss.lastSeen).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TrendIcon trend={iss.trend} />
              <span className={`px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase ${SEVERITY_STYLES[iss.maxSeverity]}`}>{iss.maxSeverity}</span>
              <span className="text-[11px] font-black text-gray-700">×{iss.count}</span>
            </div>
          </div>
          {iss.sampleEvidence && (
            <div className="mt-3 flex items-start gap-2 bg-gray-50 rounded-xl px-4 py-2.5">
              <Quote className="w-3 h-3 text-gray-300 mt-0.5 shrink-0" />
              <p className="text-[11px] text-gray-600 italic">"{iss.sampleEvidence}"</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Ask AI tab (RAG chat) ───────────────────────────────────────

interface AskSource { feedbackId: string; rating: number; comment: string | null; createdAt: string; score: number }
interface AskMessage { role: 'user' | 'assistant'; text: string; sources?: AskSource[]; confidence?: string; aiUsed?: boolean }

const SUGGESTED_QUESTIONS = [
  'What do customers complain about the most?',
  'What do customers say about our service?',
  'Are there complaints about food temperature?',
  'What do customers love?',
];

export function FeedbackAskTab() {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res: any = await api.askFeedbackQuestion(q);
      const d = res?.data || res;
      if (d?.success) {
        setMessages((m) => [...m, { role: 'assistant', text: d.answer, sources: d.sources || [], confidence: d.confidence, aiUsed: d.aiUsed }]);
      } else {
        setMessages((m) => [...m, { role: 'assistant', text: 'Sorry — could not answer that right now. Please try again.' }]);
      }
    } catch (err) {
      debugWarn('FeedbackIntel', 'ask failed:', err);
      setMessages((m) => [...m, { role: 'assistant', text: 'Sorry — could not reach the server. Check your connection and try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-4 h-4 text-teal-600" />
          <p className="text-sm font-black text-gray-900">Ask your feedback</p>
        </div>
        <p className="text-[11px] text-gray-400">Ask questions about past customer feedback. Answers are grounded in the reviews themselves — every answer cites its sources below it.</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Try asking</p>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="block w-full text-left px-4 py-2.5 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-xs font-semibold text-gray-600 hover:border-teal-300 hover:text-teal-700 cursor-pointer transition-all"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
              m.role === 'user'
                ? 'bg-teal-600 text-white'
                : 'bg-[var(--color-bg-white)] border border-[var(--color-border-default)]'
            }`}>
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.text}</p>
              {m.role === 'assistant' && m.confidence && (
                <p className="text-[9px] font-bold text-gray-400 mt-2">
                  Confidence: {m.confidence}{m.aiUsed === false ? ' · AI unavailable — showing most relevant reviews' : ''}
                </p>
              )}
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <div className="mt-2.5 space-y-1.5 border-t border-gray-100 pt-2.5">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Sources</p>
                  {m.sources.slice(0, 5).map((s) => (
                    <div key={s.feedbackId} className="flex items-start gap-2">
                      <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">{s.rating}★</span>
                      <p className="text-[10px] text-gray-500 leading-snug">
                        "{s.comment ?? '(rating only)'}"
                        <span className="text-gray-300"> · {new Date(s.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-gray-400 px-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-semibold">Searching feedback…</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(input); }}
          placeholder="Ask about your feedback…"
          maxLength={300}
          className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-200"
        />
        <button
          onClick={() => ask(input)}
          disabled={busy || !input.trim()}
          className="p-2.5 rounded-xl bg-teal-600 text-white cursor-pointer disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
