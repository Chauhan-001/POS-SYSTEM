/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * feedbackIntelligenceService — FeedRag-style feedback intelligence for the
 * POS receipt-QR feedback, in TypeScript only.
 *
 * Pipeline (mirrors FeedRag's architecture, adapted to the POS backend):
 *
 *   ReceiptFeedback row
 *     → aspect analysis (LLM via the shared llmClient; deterministic local
 *       lexicon fallback when the AI layer is unavailable)
 *     → FeedbackAnalysis store (+ local hashed embedding of the comment)
 *     → analytics / issues aggregation
 *     → RAG "ask your feedback" (cosine retrieval + grounded LLM answer)
 *     → executive insight synthesis (cached in FeedbackInsight)
 *
 * All LLM calls go through `backend/src/ai/shared/llmClient.ts` — the single
 * mandated LLM gateway (no per-feature SDKs). Embeddings are a deterministic
 * in-process hashed-token scheme (FeedRag's "local semantic fallback"
 * approach): no external embedding endpoint is needed at POS data volumes.
 */

import { generateJson, isLlmConfigured, LlmError } from '../ai/shared/llmClient';
import FeedbackAnalysis, { type IFeedbackIssue } from '../models/customers/FeedbackAnalysis';
import FeedbackInsight from '../models/customers/FeedbackInsight';

// ─── Domain constants ────────────────────────────────────────────

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

/** Positive / negative keyword lexicon for the deterministic fallback analyzer. */
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

// ─── Embedding (local, deterministic — no external endpoint) ─────

const EMBEDDING_DIM = 256;
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'was', 'were', 'it', 'this', 'that', 'of', 'to', 'in', 'on', 'for', 'with', 'we', 'i', 'you', 'they', 'at', 'as', 'very', 'so', 'too', 'our', 'my', 'me']);

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Local hashed-token embedding: word unigrams (weight 1.0) + character
 * trigrams (weight 0.35) hashed into a fixed 256-dim space, L2-normalized.
 * Deterministic, offline, and good enough for retrieval at the few-hundred
 * comments per restaurant that POS feedback produces.
 */
export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const clean = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return vec;

  const tokens = clean.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
  for (const tok of tokens) {
    vec[fnv1a(tok) % EMBEDDING_DIM] += 1.0;
    // Light stemming: also hash the token without plural/suffix so "waited"
    // and "waiting" land close together.
    const stem = tok.replace(/(ing|ed|es|s)$/, '');
    if (stem.length > 2 && stem !== tok) vec[fnv1a(stem) % EMBEDDING_DIM] += 0.6;
    for (let i = 0; i < tok.length - 2; i++) {
      vec[fnv1a(tok.slice(i, i + 3)) % EMBEDDING_DIM] += 0.35;
    }
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are L2-normalized
}

/** Expand a query with light synonyms so retrieval recalls related wording. */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  wait: ['wait', 'delay', 'slow', 'queue', 'late'],
  cold: ['cold', 'temperature', 'lukewarm'],
  staff: ['staff', 'waiter', 'service', 'server'],
  dirty: ['dirty', 'clean', 'hygiene', 'unclean'],
  price: ['price', 'expensive', 'cost', 'value'],
  taste: ['taste', 'flavour', 'flavor', 'bland'],
  quality: ['quality', 'fresh', 'stale'],
  portion: ['portion', 'quantity'],
};

function expandQuery(text: string): string {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const extra = words.flatMap((w) => QUERY_EXPANSIONS[w] ?? []);
  return [...text, ...extra].join(' ');
}

// ─── Local (rule-based) analysis fallback ────────────────────────

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

// ─── AI analysis (single-gateway LLM call with fallback) ─────────

const ANALYSIS_SYSTEM =
  'You are a restaurant feedback analyst. Analyze the customer feedback and reply with STRICT JSON only, no prose. ' +
  `Allowed aspect values: ${FEEDBACK_ASPECTS.join(', ')}. ` +
  `Allowed issue categories: ${ISSUE_CATEGORIES.join(', ')}. ` +
  'Scores are -1 (very negative) to 1 (very positive). Every aspect/issue must include a verbatim "evidence" quote from the comment.';

interface AiAnalysisShape {
  overall_sentiment: 'positive' | 'mixed' | 'neutral' | 'negative';
  sentiment_score: number;
  aspects: { aspect: string; sentiment: 'positive' | 'neutral' | 'negative'; score: number; evidence: string }[];
  issues: { category: string; severity: 'low' | 'medium' | 'high' | 'critical'; evidence: string }[];
  summary: string;
  suggested_action: string;
}

async function analyzeWithAi(comment: string, rating: number, billTotal?: number): Promise<AiAnalysisShape | null> {
  if (!isLlmConfigured()) return null;
  const context = [
    comment ? `Customer comment: "${comment}"` : 'The customer left NO written comment.',
    `Star rating: ${rating}/5.`,
    billTotal != null ? `Bill total: ₹${billTotal}.` : '',
  ].filter(Boolean).join('\n');
  try {
    const value = await generateJson<AiAnalysisShape>({
      system: ANALYSIS_SYSTEM,
      prompt: context,
      schemaHint: '{"overall_sentiment":"positive|mixed|neutral|negative","sentiment_score":0,"aspects":[{"aspect":"taste","sentiment":"positive","score":0.9,"evidence":"..."}],"issues":[{"category":"waiting_time","severity":"medium","evidence":"..."}],"summary":"...","suggested_action":"..."}',
      timeoutMs: 20_000,
    });
    if (!value || typeof value !== 'object' || !value.overall_sentiment) return null;
    return value;
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'unknown';
    console.warn(`[FeedbackIntel] AI analysis unavailable (${kind}) — using local analyzer`);
    return null;
  }
}

// ─── Ensure analyzed ─────────────────────────────────────────────

/**
 * Analyze up to `max` un-analyzed feedback rows for a restaurant.
 * Returns how many rows were analyzed. Rating-only rows (no comment) get a
 * cheap rating-derived analysis without an LLM call.
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

  let result: {
    overallSentiment: 'positive' | 'mixed' | 'neutral' | 'negative';
    sentimentScore: number;
    aspects: { aspect: string; sentiment: string; score: number; evidence: string }[];
    issues: IFeedbackIssue[];
    summary: string;
    suggestedAction: string;
    source: 'ai' | 'local' | 'rating_only';
    modelId?: string;
  };

  if (!comment) {
    result = { ...ratingOnlyAnalysis(rating), source: 'rating_only' };
  } else {
    const ai = await analyzeWithAi(comment, rating);
    if (ai) {
      result = {
        overallSentiment: ai.overall_sentiment,
        sentimentScore: clampScore(Number(ai.sentiment_score) || 0),
        aspects: (ai.aspects || [])
          .filter((a) => a && a.aspect)
          .map((a) => ({
            aspect: FEEDBACK_ASPECTS.includes(a.aspect as any) ? a.aspect : 'food_quality',
            sentiment: a.sentiment || 'neutral',
            score: clampScore(Number(a.score) || 0),
            evidence: String(a.evidence || '').slice(0, 200),
          })),
        issues: (ai.issues || [])
          .filter((i) => i && i.category)
          .map((i) => ({
            category: ISSUE_CATEGORIES.includes(i.category as any) ? i.category : 'other',
            severity: SEVERITY_RANK[i.severity] ? i.severity : 'medium',
            evidence: String(i.evidence || '').slice(0, 200),
          })),
        summary: String(ai.summary || '').slice(0, 300),
        suggestedAction: String(ai.suggested_action || '').slice(0, 300),
        source: 'ai',
        modelId: 'shared-llm',
      };
    } else {
      result = { ...analyzeCommentLocal(comment, rating), source: 'local' };
    }
  }

  await FeedbackAnalysis.findOneAndUpdate(
    { feedbackId: fb._id },
    {
      restaurantId,
      feedbackId: fb._id,
      feedbackCreatedAt: fb.createdAt || new Date(),
      embedding: comment ? embedText(comment) : [],
      analyzedAt: new Date(),
      ...result,
    },
    { upsert: true },
  );
}

/** Force re-analysis of every feedback row (used by the panel's refresh). */
export async function reanalyzeAll(restaurantId: string): Promise<number> {
  const { default: ReceiptFeedback } = await import('../models/customers/ReceiptFeedback');
  await FeedbackAnalysis.deleteMany({ restaurantId });
  await FeedbackInsight.deleteOne({ restaurantId });
  const rows = await ReceiptFeedback.find({ restaurantId }).sort({ createdAt: -1 }).limit(200).lean();
  let n = 0;
  for (const fb of rows as any[]) {
    await analyzeOne(restaurantId, fb);
    n++;
  }
  return n;
}

// ─── Analytics aggregation ───────────────────────────────────────

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
        // Only bucket into the FIRST matching week window (most recent) —
        // score contribution per row per week window it falls in.
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

// ─── Recurring issues ────────────────────────────────────────────

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
        // internal rank for sorting (severity × volume)
        _rank: rank * 10 + Math.min(v.count, 10),
      };
    })
    .sort((a: any, b: any) => b._rank - a._rank)
    .map(({ _rank, ...rest }: any) => rest as FeedbackIssueSummary);
}

// ─── RAG: ask your feedback ──────────────────────────────────────

export interface AskResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  sources: { feedbackId: string; rating: number; comment: string | null; createdAt: string; score: number }[];
  aiUsed: boolean;
}

export async function askFeedback(restaurantId: string, question: string): Promise<AskResult> {
  const qVec = embedText(expandQuery(question));
  const rows = await FeedbackAnalysis.find({ restaurantId })
    .select('feedbackId embedding sentimentScore')
    .limit(2000)
    .lean();

  const scored = (rows as any[])
    .filter((r) => r.embedding?.length === EMBEDDING_DIM)
    .map((r) => ({ id: String(r.feedbackId), sim: cosineSimilarity(qVec, r.embedding), sentimentScore: r.sentimentScore }))
    .filter((r) => r.sim > 0.04)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 8);

  if (!scored.length) {
    return {
      answer: 'No relevant feedback found for that question yet. Try different words, or check back after more customers submit comments.',
      confidence: 'low',
      sources: [],
      aiUsed: false,
    };
  }

  const { default: ReceiptFeedback } = await import('../models/customers/ReceiptFeedback');
  const feedbacks = await ReceiptFeedback.find({ _id: { $in: scored.map((s) => s.id) } }).lean();
  const fbMap = new Map((feedbacks as any[]).map((f) => [String(f._id), f]));

  const sources = scored
    .map((s) => {
      const f = fbMap.get(s.id);
      return f
        ? {
            feedbackId: String(f._id),
            rating: f.rating,
            comment: f.comment || null,
            createdAt: new Date(f.createdAt).toISOString(),
            score: Math.round(s.sim * 1000) / 1000,
          }
        : null;
    })
    .filter(Boolean) as AskResult['sources'];

  // Grounded LLM answer; extractive fallback when AI is unavailable.
  if (isLlmConfigured()) {
    const context = sources
      .map((s, i) => `[${i + 1}] (${s.rating}/5, ${new Date(s.createdAt).toLocaleDateString('en-IN')}) ${s.comment ?? '(no comment)'}`)
      .join('\n');
    try {
      const value = await generateJson<{ answer: string; confidence: 'high' | 'medium' | 'low' }>({
        system:
          'You answer questions about a restaurant\'s customer feedback STRICTLY from the provided reviews. ' +
          'Reply with STRICT JSON: {"answer": string, "confidence": "high|medium|low"}. ' +
          'Cite reviews inline like [1]. If the reviews do not contain the answer, say so honestly. Max 120 words.',
        prompt: `Question: ${question}\n\nReviews:\n${context}`,
        schemaHint: '{"answer":"...","confidence":"medium"}',
        timeoutMs: 20_000,
      });
      if (value?.answer) {
        return { answer: value.answer, confidence: value.confidence || 'medium', sources, aiUsed: true };
      }
    } catch (err) {
      const kind = err instanceof LlmError ? err.kind : 'unknown';
      console.warn(`[FeedbackIntel] RAG answer unavailable (${kind}) — using extractive fallback`);
    }
  }

  const avgRating = sources.reduce((s, r) => s + r.rating, 0) / sources.length;
  const quotes = sources.slice(0, 4).map((s) => `• (${s.rating}/5) "${s.comment}"`).join('\n');
  return {
    answer: `Most relevant feedback (avg ${avgRating.toFixed(1)}/5 across ${sources.length} reviews):\n${quotes}`,
    confidence: 'low',
    sources,
    aiUsed: false,
  };
}

// ─── Executive insight ───────────────────────────────────────────

export async function getLatestInsight(restaurantId: string) {
  return FeedbackInsight.findOne({ restaurantId }).lean();
}

export async function generateInsight(restaurantId: string) {
  await ensureFeedbackAnalyzed(restaurantId, 25);
  const analytics = await getAnalytics(restaurantId);
  const issues = await getIssues(restaurantId);

  const topNegative = analytics.aspects.filter((a) => a.negative > 0).slice(0, 4);
  const topPositive = analytics.aspects.filter((a) => a.positive > 0 && a.avgScore > 0).slice(0, 4);

  let insight: { headline: string; paragraphs: string[]; recommendations: string[]; source: 'ai' | 'local' };

  if (isLlmConfigured() && analytics.totalAnalyzed > 0) {
    const facts = [
      `Total feedback: ${analytics.totalAnalyzed} analyzed (of ${analytics.totalFeedback}).`,
      `Sentiment split: ${JSON.stringify(analytics.sentiment)}.`,
      `Rating distribution severity of issues: ${JSON.stringify(analytics.severity)}.`,
      `Top aspects: ${analytics.aspects.slice(0, 6).map((a) => `${a.aspect} (avg ${a.avgScore}, ${a.mentions} mentions, ${a.negative} negative)`).join('; ') || 'none'}.`,
      `Recurring issues: ${issues.slice(0, 5).map((i) => `${i.category} ×${i.count} (${i.maxSeverity}, ${i.trend})`).join('; ') || 'none'}.`,
    ].join('\n');
    try {
      const value = await generateJson<{ headline: string; paragraphs: string[]; recommendations: string[] }>({
        system:
          'You are an executive business analyst for a restaurant. Using ONLY the facts provided, reply with STRICT JSON: ' +
          '{"headline": string, "paragraphs": string[2-3], "recommendations": string[2-4]}. ' +
          'Be concrete, mention aspects/issues by name, keep it under 200 words total.',
        prompt: facts,
        schemaHint: '{"headline":"...","paragraphs":["..."],"recommendations":["..."]}',
        timeoutMs: 25_000,
        retryOnRateLimit: true,
      });
      if (value?.headline) {
        insight = {
          headline: value.headline,
          paragraphs: (value.paragraphs || []).slice(0, 4).map(String),
          recommendations: (value.recommendations || []).slice(0, 5).map(String),
          source: 'ai',
        };
      } else {
        insight = localInsight(analytics, issues, topPositive, topNegative);
      }
    } catch {
      insight = localInsight(analytics, issues, topPositive, topNegative);
    }
  } else {
    insight = localInsight(analytics, issues, topPositive, topNegative);
  }

  await FeedbackInsight.findOneAndUpdate(
    { restaurantId },
    { restaurantId, ...insight, generatedAt: new Date() },
    { upsert: true },
  );
  return { ...insight, generatedAt: new Date().toISOString() };
}

function localInsight(
  analytics: FeedbackAnalytics,
  issues: FeedbackIssueSummary[],
  topPositive: FeedbackAnalytics['aspects'],
  topNegative: FeedbackAnalytics['aspects'],
) {
  const neg = analytics.sentiment.negative + analytics.sentiment.mixed;
  const total = Math.max(1, analytics.totalAnalyzed);
  const paragraphs = [
    `${analytics.totalAnalyzed} feedback responses analyzed. Sentiment: ${analytics.sentiment.positive} positive, ${analytics.sentiment.mixed} mixed, ${analytics.sentiment.neutral} neutral, ${analytics.sentiment.negative} negative — ${Math.round((neg / total) * 100)}% needs attention.`,
    topPositive.length ? `Strengths: ${topPositive.map((a) => a.aspect.replace(/_/g, ' ')).join(', ')}.` : 'No clearly positive aspect detected yet.',
    topNegative.length ? `Pain points: ${topNegative.map((a) => a.aspect.replace(/_/g, ' ')).join(', ')}.` : 'No dominant pain point detected yet.',
  ];
  const recommendations = issues.slice(0, 3).map((i) => `Address the recurring "${i.category.replace(/_/g, ' ')}" issue (${i.count} occurrences, trending ${i.trend}).`);
  return { headline: issues.length ? `${issues[0].count}× recurring "${issues[0].category.replace(/_/g, ' ')}" is the top issue` : 'Feedback overview', paragraphs, recommendations, source: 'local' as const };
}
