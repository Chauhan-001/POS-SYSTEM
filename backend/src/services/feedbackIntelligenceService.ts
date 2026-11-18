/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * feedbackIntelligenceService — deterministic feedback analysis for the POS
 * receipt-QR feedback.
 *
 * Pipeline:
 *
 *   ReceiptFeedback row
 *     → lexicon/aspect analysis (no LLM, no embeddings, no external service)
 *     → FeedbackAnalysis store
 *     → analytics / recurring-issue aggregation
 *
 * This replaces the previous FeedRag-style RAG pipeline. Analysis is fully
 * local and deterministic so feedback reporting works with no AI provider,
 * no vector store and no network dependency.
 */

import FeedbackAnalysis, { type IFeedbackIssue } from '../models/customers/FeedbackAnalysis';

// ─── Domain constants ────────────────────────────────────────────────────────

export const FEEDBACK_ASPECTS = [
  'food_quality', 'taste', 'temperature', 'service', 'staff', 'waiting_time',
  'price', 'ambience', 'cleanliness', 'portion_size', 'delivery', 'packaging',
  'menu', 'value_for_money',
] as const;

export const ISSUE_CATEGORIES = [
  'waiting_time', 'food_temperature', 'food_quality', 'service_attitude',
  'order_accuracy', 'cleanliness', 'price_value', 'portion_size',
  'delivery_delay', 'packaging', 'staff_behaviour', 'other',
] as const;

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Positive / negative keyword lexicon for the deterministic analyzer. */
const POSITIVE_WORDS = ['amazing', 'great', 'good', 'excellent', 'tasty', 'delicious', 'fresh', 'friendly', 'polite', 'quick', 'fast', 'clean', 'perfect', 'loved', 'love', 'best', 'awesome', 'recommend', 'hot', 'worth', 'reasonable', 'generous', 'prompt', 'attentive', 'nice'];
const NEGATIVE_WORDS = ['cold', 'stale', 'bad', 'worst', 'terrible', 'awful', 'slow', 'delay', 'late', 'dirty', 'rude', 'expensive', 'overpriced', 'bland', 'undercooked', 'overcooked', 'burnt', 'soggy', 'hair', 'unhygienic', 'long', 'wait', 'forgot', 'wrong', 'missing', 'spilled', 'leaked', 'noisy', 'cramped', 'small', 'disappointing', 'disappointed', 'never', 'poor'];

/** Aspect keyword hints for the fallback analyzer. */
const ASPECT_KEYWORDS: Record<string, string[]> = {
  taste: ['taste', 'tasty', 'flavour', 'flavor', 'bland', 'delicious', 'yummy', 'salty', 'spicy', 'sweet'],
  temperature: ['cold', 'hot', 'warm', 'lukewarm', 'frozen', 'reheated'],
  service: ['service', 'waiter', 'waitress', 'staff', 'server', 'attentive', 'rude', 'polite', 'friendly', 'manager'],
  waiting_time: ['wait', 'waited', 'waiting', 'slow', 'delay', 'late', 'forever', 'minutes', 'hour', 'queue'],
  food_quality: ['food', 'fresh', 'stale', 'raw', 'undercooked', 'overcooked', 'burnt', 'soggy', 'hair', 'quality'],
  price: ['price', 'cost', 'expensive', 'cheap', 'overpriced', 'billing', 'charge'],
  value_for_money: ['worth', 'value', 'money', 'overpriced', 'reasonable'],
  portion_size: ['portion', 'quantity', 'small', 'large', 'less', 'enough', 'generous'],
  ambience: ['ambience', 'atmosphere', 'music', 'noisy', 'crowded', 'cramped', 'decor', 'vibe'],
  cleanliness: ['clean', 'dirty', 'hygiene', 'hygienic', 'unclean', 'smell', 'stink', 'washroom', 'toilet'],
  delivery: ['delivery', 'delivered', 'zomato', 'swiggy', 'rider', 'parcel'],
  packaging: ['packaging', 'packed', 'box', 'spilled', 'leaked', 'container'],
  order_accuracy: ['wrong', 'missing', 'forgot', 'instead', 'incorrect', 'order'],
  menu: ['menu', 'options', 'variety', 'items', 'unavailable'],
};

// ─── Local rule-based analysis ──────────────────────────────────────────────

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
}

export function analyzeCommentLocal(comment: string, rating: number) {
  const text = (comment || '').toLowerCase();
  const aspects: { aspect: string; sentiment: 'positive' | 'neutral' | 'negative'; score: number; evidence: string }[] = [];

  if (text) {
    const sentences = comment.split(/[.!?\n;,]/).map((s) => s.trim()).filter(Boolean);
    for (const [aspect, kws] of Object.entries(ASPECT_KEYWORDS)) {
      const hits = sentences.filter((s) => {
        const ls = s.toLowerCase();
        return kws.some((k) => ls.includes(k));
      });
      if (!hits.length) continue;
      const joined = hits.join('. ');
      const pos = POSITIVE_WORDS.filter((w) => joined.toLowerCase().includes(w)).length;
      const neg = NEGATIVE_WORDS.filter((w) => joined.toLowerCase().includes(w)).length;
      const score = pos === neg ? 0 : clampScore((pos - neg) / Math.max(1, pos + neg));
      aspects.push({
        aspect,
        sentiment: score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral',
        score,
        evidence: joined.slice(0, 160),
      });
    }
  }

  const issues: IFeedbackIssue[] = aspects
    .filter((a) => a.sentiment === 'negative')
    .map((a) => ({
      category: ISSUE_CATEGORIES.includes(a.aspect as any) ? a.aspect : mapAspectToIssue(a.aspect),
      severity: rating <= 2 ? 'high' : rating === 3 ? 'medium' : 'low',
      evidence: a.evidence,
    }));

  const sentimentScore = comment
    ? clampScore(
        (POSITIVE_WORDS.filter((w) => text.includes(w)).length - NEGATIVE_WORDS.filter((w) => text.includes(w)).length) /
          Math.max(3, POSITIVE_WORDS.filter((w) => text.includes(w)).length + NEGATIVE_WORDS.filter((w) => text.includes(w)).length),
      )
    : 0;

  return {
    overallSentiment: deriveOverallSentiment(sentimentScore, rating),
    sentimentScore,
    aspects,
    issues,
    summary: comment ? `Rating ${rating}/5 — "${comment.slice(0, 120)}"` : `Rating ${rating}/5 (no comment).`,
    suggestedAction: issues.length ? `Review the recurring "${issues[0].category.replace(/_/g, ' ')}" complaint raised in this feedback.` : '',
  };
}

function mapAspectToIssue(aspect: string): string {
  const map: Record<string, string> = {
    waiting_time: 'waiting_time',
    temperature: 'food_temperature',
    food_quality: 'food_quality',
    service: 'service_attitude',
    staff: 'staff_behaviour',
    price: 'price_value',
    value_for_money: 'price_value',
    cleanliness: 'cleanliness',
    portion_size: 'portion_size',
    delivery: 'delivery_delay',
    packaging: 'packaging',
    menu: 'order_accuracy',
    taste: 'food_quality',
    ambience: 'other',
  };
  return map[aspect] ?? 'other';
}

function deriveOverallSentiment(score: number, rating: number): 'positive' | 'mixed' | 'neutral' | 'negative' {
  if (score >= 0.3 || (score === 0 && rating >= 4)) return 'positive';
  if (score <= -0.3 || (score === 0 && rating <= 2)) return 'negative';
  if (score === 0) return 'neutral';
  return 'mixed';
}

function ratingOnlyAnalysis(rating: number) {
  return {
    overallSentiment: rating >= 4 ? 'positive' as const : rating === 3 ? 'neutral' as const : 'negative' as const,
    sentimentScore: clampScore((rating - 3) / 2),
    aspects: [],
    issues: [],
    summary: `Rated ${rating}/5 without a written comment.`,
    suggestedAction: '',
  };
}

// ─── Ensure analyzed ────────────────────────────────────────────────────────

/**
 * Analyze up to `max` un-analyzed feedback rows for a restaurant.
 * Returns how many rows were analyzed.
 */
export async function ensureFeedbackAnalyzed(restaurantId: string, max = 25): Promise<number> {
  const { default: ReceiptFeedback } = await import('../models/customers/ReceiptFeedback');

  const existing = await FeedbackAnalysis.find({ restaurantId }).select('feedbackId').lean();
  const done = new Set(existing.map((a: any) => String(a.feedbackId)));

  const pending = await ReceiptFeedback.find({ restaurantId })
    .sort({ createdAt: -1 })
    .limit(max * 3)
    .lean();

  let analyzed = 0;
  for (const fb of pending as any[]) {
    if (analyzed >= max) break;
    if (done.has(String(fb._id))) continue;
    await analyzeOne(restaurantId, fb);
    analyzed++;
  }
  return analyzed;
}

async function analyzeOne(restaurantId: string, fb: any): Promise<void> {
  const comment: string = fb.comment || '';
  const rating: number = fb.rating || 3;

  const result = comment
    ? { ...analyzeCommentLocal(comment, rating), source: 'local' as const }
    : { ...ratingOnlyAnalysis(rating), source: 'rating_only' as const };

  await FeedbackAnalysis.findOneAndUpdate(
    { feedbackId: fb._id },
    {
      restaurantId,
      feedbackId: fb._id,
      feedbackCreatedAt: fb.createdAt || new Date(),
      analyzedAt: new Date(),
      modelId: '',
      ...result,
    },
    { upsert: true },
  );
}

/** Force re-analysis of every feedback row (used by the panel's refresh). */
export async function reanalyzeAll(restaurantId: string): Promise<number> {
  const { default: ReceiptFeedback } = await import('../models/customers/ReceiptFeedback');
  await FeedbackAnalysis.deleteMany({ restaurantId });
  const rows = await ReceiptFeedback.find({ restaurantId }).sort({ createdAt: -1 }).limit(200).lean();
  let n = 0;
  for (const fb of rows as any[]) {
    await analyzeOne(restaurantId, fb);
    n++;
  }
  return n;
}

// ─── Analytics aggregation ──────────────────────────────────────────────────

export interface FeedbackAnalytics {
  totalAnalyzed: number;
  totalFeedback: number;
  sentiment: Record<string, number>;
  aspects: { aspect: string; mentions: number; avgScore: number; positive: number; negative: number }[];
  weeklyTrend: { weekStart: string; avgScore: number; count: number }[];
  severity: Record<string, number>;
}

export async function getAnalytics(restaurantId: string): Promise<FeedbackAnalytics> {
  const { default: ReceiptFeedback } = await import('../models/customers/ReceiptFeedback');
  const [totalAnalyzed, totalFeedback] = await Promise.all([
    FeedbackAnalysis.countDocuments({ restaurantId }),
    ReceiptFeedback.countDocuments({ restaurantId }),
  ]);

  const rows = await FeedbackAnalysis.find({ restaurantId }).select('overallSentiment sentimentScore aspects issues feedbackCreatedAt').lean();

  const sentiment: Record<string, number> = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  const severity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const aspectAgg = new Map<string, { mentions: number; scoreSum: number; positive: number; negative: number }>();

  for (const r of rows as any[]) {
    if (sentiment[r.overallSentiment] !== undefined) sentiment[r.overallSentiment]++;
    for (const iss of r.issues || []) if (severity[iss.severity] !== undefined) severity[iss.severity]++;
    for (const a of r.aspects || []) {
      const cur = aspectAgg.get(a.aspect) || { mentions: 0, scoreSum: 0, positive: 0, negative: 0 };
      cur.mentions++;
      cur.scoreSum += a.score;
      if (a.sentiment === 'positive') cur.positive++;
      if (a.sentiment === 'negative') cur.negative++;
      aspectAgg.set(a.aspect, cur);
    }
  }

  // Weekly trend over the last 8 weeks (by feedback submission date).
  const now = Date.now();
  const weeks: { start: number; scores: number[] }[] = [];
  for (let i = 7; i >= 0; i--) {
    weeks.push({ start: now - (i + 1) * 7 * 864e5, scores: [] });
  }
  for (const r of rows as any[]) {
    const t = new Date(r.feedbackCreatedAt || (r as any).createdAt || now).getTime();
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (t >= weeks[i].start) {
        weeks[i].scores.push(r.sentimentScore);
        break;
      }
    }
  }

  return {
    totalAnalyzed,
    totalFeedback,
    sentiment,
    aspects: [...aspectAgg.entries()]
      .map(([aspect, v]) => ({
        aspect,
        mentions: v.mentions,
        avgScore: Math.round((v.scoreSum / v.mentions) * 100) / 100,
        positive: v.positive,
        negative: v.negative,
      }))
      .sort((a, b) => b.mentions - a.mentions),
    weeklyTrend: weeks.map((w) => ({
      weekStart: new Date(w.start).toISOString().slice(0, 10),
      avgScore: w.scores.length ? Math.round((w.scores.reduce((s, v) => s + v, 0) / w.scores.length) * 100) / 100 : 0,
      count: w.scores.length,
    })),
    severity,
  };
}

// ─── Recurring issues ──────────────────────────────────────────────────────

export interface FeedbackIssueSummary {
  category: string;
  count: number;
  maxSeverity: 'low' | 'medium' | 'high' | 'critical';
  firstSeen: string;
  lastSeen: string;
  trend: 'rising' | 'stable' | 'falling';
  sampleEvidence: string;
}

export async function getIssues(restaurantId: string): Promise<FeedbackIssueSummary[]> {
  const rows = await FeedbackAnalysis.find({ restaurantId }).select('issues feedbackCreatedAt').lean();
  const agg = new Map<string, { count: number; maxSev: number; dates: Date[]; evidence: string }>();
  const cutoff = Date.now() - 14 * 864e5;

  for (const r of rows as any[]) {
    const t = new Date(r.feedbackCreatedAt || (r as any).createdAt || Date.now());
    for (const iss of r.issues || []) {
      const cur = agg.get(iss.category) || { count: 0, maxSev: 0, dates: [], evidence: '' };
      cur.count++;
      cur.maxSev = Math.max(cur.maxSev, SEVERITY_RANK[iss.severity] || 2);
      cur.dates.push(t);
      if (!cur.evidence) cur.evidence = iss.evidence || '';
      agg.set(iss.category, cur);
    }
  }

  return [...agg.entries()]
    .map(([category, v]) => {
      const recent = v.dates.filter((d) => d.getTime() >= cutoff).length;
      const older = v.count - recent;
      const rank = (SEVERITY_RANK[Object.keys(SEVERITY_RANK)[v.maxSev - 1]] || 2);
      return {
        category,
        count: v.count,
        maxSeverity: (Object.keys(SEVERITY_RANK)[v.maxSev - 1] as any) || 'medium',
        firstSeen: new Date(Math.min(...v.dates.map((d) => d.getTime()))).toISOString(),
        lastSeen: new Date(Math.max(...v.dates.map((d) => d.getTime()))).toISOString(),
        trend: recent > older ? 'rising' : recent < older ? 'falling' : 'stable',
        sampleEvidence: v.evidence,
        _rank: rank * 10 + Math.min(v.count, 10),
      };
    })
    .sort((a: any, b: any) => b._rank - a._rank)
    .map(({ _rank, ...rest }: any) => rest as FeedbackIssueSummary);
}
