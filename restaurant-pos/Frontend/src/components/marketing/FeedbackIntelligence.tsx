/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FeedbackIntelligence — deterministic intelligence tabs of the feedback
 * workspace:
 *
 *   FeedbackAnalyticsTab — aspect breakdown and weekly sentiment trend.
 *   FeedbackIssuesTab    — recurring problem categories, severity-ranked.
 *
 * All values are computed on the backend from receipt-QR feedback with no LLM,
 * embeddings or external AI service.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, Minus, Quote } from 'lucide-react';
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

// ─── Analytics tab ──────────────────────────────────────────────────────────

interface AnalyticsData {
  totalAnalyzed: number;
  totalFeedback: number;
  sentiment: Record<string, number>;
  aspects: { aspect: string; mentions: number; avgScore: number; positive: number; negative: number }[];
  weeklyTrend: { weekStart: string; avgScore: number; count: number }[];
  severity: Record<string, number>;
}

export function FeedbackAnalyticsTab() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const a = await api.fetchFeedbackAnalytics();
      const ad: any = a?.data || a;
      if (ad?.success) setAnalytics(ad.analytics);
    } catch (err) {
      debugWarn('FeedbackIntel', 'analytics load failed:', err);
      setError('Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    return <EmptyState icon="💬" title="No data yet" subtitle="Analytics appear once customers start leaving feedback." />;
  }

  const sentimentData = [
    { name: 'Positive', value: analytics.sentiment.positive || 0, color: '#10b981' },
    { name: 'Mixed', value: analytics.sentiment.mixed || 0, color: '#f59e0b' },
    { name: 'Neutral', value: analytics.sentiment.neutral || 0, color: '#9ca3af' },
    { name: 'Negative', value: analytics.sentiment.negative || 0, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
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

// ─── Issues tab ─────────────────────────────────────────────────────────────

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
