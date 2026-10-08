/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * llmClient.ts — the shared LLM abstraction (Calendar Phase 2, spec §1/§14).
 * This is the FIRST and ONLY LLM caller in the backend: any future AI feature
 * (calendar assistant, marketing agent reasoning, semantic interpretation)
 * must go through it — no per-feature SDKs or duplicate clients.
 *
 * Provider routing (Phase 1 — Marketing Agent foundation):
 *   - gemini                → generateContent (JSON response mode) [unchanged]
 *   - openai | custom | ollama → {baseUrl}/chat/completions (JSON mode where
 *     supported). `backend/.env` configures AI_PROVIDER=custom against an
 *     OpenAI-compatible endpoint, so this route is the one actually live.
 *   - anything else         → typed `unsupported_provider` LlmError.
 *
 * Key pool + failover:
 *   The primary key (AI_API_KEY) plus the configured fallback keys
 *   (AI_API_KEY_FALLBACK / AI_API_KEY_FALLBACKS) form an ordered pool. A call
 *   that fails with a TRANSIENT error (HTTP 429, timeout, 5xx/network) moves on
 *   to the next key instead of failing the whole agent step:
 *
 *     key A → 429/timeout/5xx → key B → success → (sticky) key B for the next
 *     call in the same agent loop → key C only if B also fails.
 *
 *   A key that just worked is remembered ("sticky") so the rest of an agent
 *   loop does not keep re-probing a key the provider has throttled, and
 *   rate-limited keys get a short cooldown so the pool skips them. Permanent
 *   failures (bad request, unparseable JSON, unconfigured provider) are NOT
 *   failover-eligible: every key would fail identically, so they surface
 *   immediately. Attempts per call are hard-capped (`LLM_MAX_ATTEMPTS`).
 *
 * The API keys are server-only and are NEVER logged, returned, or included in
 * errors (errors carry status codes and kinds only — never URLs or key
 * material). The pool state export reports COUNTS only.
 *
 * Callers receive PARSED JSON or a typed LlmError — never free-form prose as
 * a primary output (spec §2). `generateJson` keeps its original contract;
 * `generateJsonWithMeta` additionally returns token usage / model / latency so
 * callers can enforce token budgets and write AIUsageLog entries.
 */

import crypto from 'node:crypto';
import { config } from '../../config';

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_configured' | 'unsupported_provider' | 'http_error' | 'timeout' | 'rate_limited' | 'invalid_json',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmJsonRequest {
  /** System-style instruction (role + constraints). */
  system: string;
  /** User prompt (the structured ask). */
  prompt: string;
  /** Optional JSON schema hint appended to the instruction. */
  schemaHint?: string;
  timeoutMs?: number;
  /**
   * Opt-in EXTRA attempt for a transient failure (rate limit / timeout / 5xx).
   *
   * OFF by default
   * on purpose: the bounded agent loop spends a per-run wall-clock budget, so
   * it must never silently pay for an attempt it did not ask for. Callers that
   * can afford one extra attempt (the marketing insight synthesis) opt in.
   * The policy is exactly ONE extra attempt after a short fixed backoff —
   * never an unbounded loop. Note that failover across a pool with MORE THAN
   * ONE key happens regardless of this flag: switching keys is the recovery
   * path, this flag only adds one last attempt once the pool has been walked.
   */
  retryOnRateLimit?: boolean;
}

/** Token usage where the provider reports it (0 when unavailable). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Parsed value + per-call metadata for observability and budgeting. */
export interface LlmJsonResult<T> {
  value: T;
  model: string;
  provider: string;
  latencyMs: number;
  usage: LlmUsage;
  /**
   * Position of the key in the pool that served this call (0 = primary).
   * Observability only — it identifies a slot, never key material.
   */
  keySlot?: number;
}

/** One candidate in the key pool: the secret plus its stable pool position. */
interface LlmKeyCandidate {
  apiKey: string;
  slot: number;
}

/**
 * All configured keys in rotation order: primary first, then fallbacks,
 * de-duplicated (a key pasted into both env vars is used once).
 */
function keyPool(): string[] {
  const { apiKey, fallbackApiKeys } = config.ai;
  return [apiKey, ...(fallbackApiKeys ?? [])].map((k) => (k ?? '').trim()).filter((k, i, arr) => !!k && arr.indexOf(k) === i);
}

export function isLlmConfigured(): boolean {
  return keyPool().length > 0;
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Short, fixed backoff before an extra attempt on an already-tried key. */
export const RATE_LIMIT_RETRY_BACKOFF_MS = 750;

/** How many extra attempts the opt-in retry policy permits (always exactly one). */
export const RATE_LIMIT_MAX_RETRIES = 1;

/**
 * Hard cap on provider attempts for ONE logical call. Failover is a recovery
 * path, not a search: at most three keys (A → B → C) are tried, plus the one
 * opt-in retry. This keeps the agent loop's wall-clock budget bounded even
 * when the whole pool is throttled.
 */
export const LLM_MAX_ATTEMPTS = 3;

/**
 * Rate-limited keys are cooled down so the pool stops hammering a key the
 * provider is already rejecting. Kept short (a minute) because a 429 is
 * usually per-minute, not per-day — unlike CricAPI's 15-minute quota block.
 */
function rateLimitCooldownMs(): number {
  const seconds = parseInt(process.env.AI_KEY_COOLDOWN_SECONDS || '', 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1_000;
}

/**
 * Keys the provider rejected as unauthorized (401/403). A bad credential does
 * not heal on its own, so it is quarantined for the life of the process rather
 * than re-probed after a cooldown timer.
 *
 * This matters because the attempt budget is smaller than a large pool: when
 * rejected keys kept returning to the rotation they consumed every attempt,
 * so a request failed with "invalid API key" even though a working key was
 * configured and never tried.
 */
const permanentlyDisabledKeys = new Set<string>();

const keyCooldownUntil = new Map<string, number>();

/**
 * The key that last served a call successfully. Sticky so the remaining calls
 * of an agent loop keep using the key that is actually working instead of
 * re-probing the primary that just rate-limited us.
 */
let activeApiKey: string | null = null;

function keyUsable(key: string, now = Date.now()): boolean {
  if (permanentlyDisabledKeys.has(key)) return false;
  const until = keyCooldownUntil.get(key);
  return until === undefined || until <= now;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Candidate order for one call: usable keys first (the sticky key, if any,
 * ahead of pool order), cooled-down keys last. When EVERY key is cooled down
 * they are still tried — better to attempt than to report no data at all.
 */
function orderedCandidates(now = Date.now()): LlmKeyCandidate[] {
  const slots: LlmKeyCandidate[] = keyPool().map((apiKey, slot) => ({ apiKey, slot }));
  const sticky = activeApiKey ? slots.find((c) => c.apiKey === activeApiKey) : undefined;
  const ordered = sticky ? [sticky, ...slots.filter((c) => c !== sticky)] : slots;
  return [...ordered.filter((c) => keyUsable(c.apiKey, now)), ...ordered.filter((c) => !keyUsable(c.apiKey, now))];
}

/**
 * Which failure should be REPORTED when a request exhausts the pool?
 *
 * A real pool mixes causes: the working keys may be throttled (429) while stale
 * credentials are rejected (401). The LAST error is then a rejected key, which
 * hides the actual reason and sends the caller down the wrong recovery path
 * ("fix your API key" instead of "retry shortly"). Higher rank wins.
 */
function errorRank(err: LlmError): number {
  switch (err.kind) {
    case 'rate_limited':
      return 6;
    case 'timeout':
      return 5;
    case 'not_configured':
    case 'unsupported_provider':
      return 4;
    case 'http_error': {
      const status = err.httpStatus ?? 0;
      // Network/transport failure or provider-side 5xx: transient, retryable.
      if (status === 0 || status === 408 || status >= 500) return 4;
      // Any other 4xx is a genuine request problem (retryable JSON failures are
      // handled by the caller) — more actionable than a rejected credential.
      if (status !== 401 && status !== 403) return 3;
      return 2;
    }
    default:
      return 1;
  }
}

/**
 * Is this failure worth trying another key for? Transient/provider-side
 * conditions only — a bad request or unparseable content fails identically on
 * every key, so it must surface immediately instead of burning the pool.
 */
function isFailoverEligible(err: LlmError): boolean {
  if (err.kind === 'rate_limited' || err.kind === 'timeout') return true;
  if (err.kind === 'http_error') {
    const status = err.httpStatus ?? 0;
    // 0 = network/transport failure; 401/403 = this key is rejected;
    // 408/5xx = provider-side or gateway-side transient.
    return status === 0 || status === 401 || status === 403 || status === 408 || status >= 500;
  }
  return false;
}

/** Cool down a key the provider itself rejected (never applied to 5xx/timeouts). */
function coolDown(key: string, err: LlmError): void {
  if (err.kind === 'rate_limited') {
    keyCooldownUntil.set(key, Date.now() + rateLimitCooldownMs());
    return;
  }
  if (isInvalidKeyError(err)) {
    // Permanent: the credential is wrong/revoked, not throttled. Quarantine it
    // so it can never take an attempt away from a key that does work.
    permanentlyDisabledKeys.add(key);
  }
}

/** A rejected credential — permanent for this process, unlike a transient error. */
function isInvalidKeyError(err: LlmError): boolean {
  return err.httpStatus === 401 || err.httpStatus === 403;
}

export interface LlmKeyPoolState {
  /** Keys configured in the pool (never the key values themselves). */
  totalKeys: number;
  /** Keys currently under cooldown (rate-limited or rejected). */
  blockedKeys: number;
  /** True when EVERY configured key is cooled down. */
  allBlocked: boolean;
}

/** Cooldown state of the LLM key pool — safe to surface (no key material). */
export function getLlmKeyPoolState(now = Date.now()): LlmKeyPoolState {
  const pool = keyPool();
  const blocked = pool.filter((k) => !keyUsable(k, now));
  return {
    totalKeys: pool.length,
    blockedKeys: blocked.length,
    allBlocked: pool.length > 0 && blocked.length === pool.length,
  };
}

/** Test hook — forget cooldowns, quarantined keys and the sticky key. */
export function resetLlmKeyRotation(): void {
  keyCooldownUntil.clear();
  permanentlyDisabledKeys.clear();
  activeApiKey = null;
}

/** Health of ONE pooled key, as judged by the provider itself. */
export type LlmKeyHealth = 'valid' | 'rate_limited' | 'dead' | 'unreachable';

/**
 * Result of a key-pool health check.
 *
 * Counts, positions and short non-reversible FINGERPRINTS only — never key
 * material, and never a URL that contains one. A fingerprint (first 8 hex
 * chars of the key's SHA-256) is enough for an operator to tell two key lines
 * apart while pruning a .env without ever exposing the secret.
 */
export interface LlmKeyHealthReport {
  provider: string;
  checkedAt: string;
  /** Keys configured in the pool (never the values). */
  totalKeys: number;
  /** Keys the provider accepted outright (HTTP 200) — the real capacity. */
  validKeys: number;
  /** Keys that authenticated but are throttled right now (HTTP 429). */
  rateLimitedKeys: number;
  /** Keys the provider REJECTED (401/403) — dead credentials. */
  deadKeys: number;
  /** Keys whose state could not be determined (network failure / 5xx). */
  unreachableKeys: number;
  /** 1-based pool positions of the rejected keys, so they can be found. */
  deadSlots: number[];
  /** `slot:fingerprint` for accepted keys (operator findable, never the value). */
  validFingerprints: string[];
  /** Fingerprints of the rejected keys. */
  deadFingerprints: string[];
  /** Every configured key was rejected — the pool cannot serve one request. */
  allDead: boolean;
  /** Set when no probe was possible (no keys / provider without this probe). */
  skippedReason?: string;
}

/** How long a single key's auth probe may take (never slows startup). */
export const KEY_HEALTH_PROBE_TIMEOUT_MS = 8_000;

/** Short, non-reversible identifier for a key — safe to log. */
export function keyFingerprint(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}

/**
 * Ask the provider whether each pooled key still AUTHENTICATES.
 *
 * Uses the token-free `GET {baseUrl}/models` endpoint: it consumes no tokens
 * and no completion quota, so it is safe to run at startup and around a
 * rotation. A key is DEAD only when the provider rejects the credential itself
 * (401/403) — a 429 proves the key authenticated, it is merely throttled, and
 * a network/5xx answer leaves the key's state unknown (it must never be
 * treated as dead, or a transient outage would empty the pool).
 *
 * With `quarantineDead` (on by default) the rejected keys are added to the
 * permanent-disable list, so a later agent run never burns a failover attempt
 * on a credential that cannot work — the runtime half of pruning the .env.
 *
 * NEVER throws: a health check must not be able to break startup.
 */
export async function checkLlmKeyPoolHealth(opts: {
  timeoutMs?: number;
  quarantineDead?: boolean;
} = {}): Promise<LlmKeyHealthReport> {
  const quarantineDead = opts.quarantineDead ?? true;
  const timeoutMs = opts.timeoutMs ?? KEY_HEALTH_PROBE_TIMEOUT_MS;
  const base: Omit<LlmKeyHealthReport, 'skippedReason'> = {
    provider: config.ai.provider,
    checkedAt: new Date().toISOString(),
    totalKeys: 0,
    validKeys: 0,
    rateLimitedKeys: 0,
    deadKeys: 0,
    unreachableKeys: 0,
    deadSlots: [],
    validFingerprints: [],
    deadFingerprints: [],
    allDead: false,
  };

  const pool = keyPool();
  if (pool.length === 0) return { ...base, skippedReason: 'no keys configured (AI_API_KEY unset)' };

  // Only the OpenAI-compatible route is probed: it exposes a token-free auth
  // endpoint at a predictable path. Any other provider is reported as
  // unchecked rather than guessed at.
  const openAiCompatible = config.ai.provider === 'openai' || config.ai.provider === 'custom' || config.ai.provider === 'ollama';
  if (!openAiCompatible || !config.ai.baseUrl) {
    return {
      ...base,
      totalKeys: pool.length,
      skippedReason: `provider '${config.ai.provider}' has no token-free probe endpoint`,
    };
  }

  const url = `${config.ai.baseUrl.replace(/\/$/, '')}/models`;
  const outcomes = await Promise.all(
    pool.map(async (key, index): Promise<{ index: number; key: string; health: LlmKeyHealth }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
        if (res.status === 401 || res.status === 403) return { index, key, health: 'dead' };
        if (res.status === 429) return { index, key, health: 'rate_limited' };
        if (res.ok) return { index, key, health: 'valid' };
        return { index, key, health: 'unreachable' };
      } catch {
        return { index, key, health: 'unreachable' };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const report: LlmKeyHealthReport = { ...base, totalKeys: pool.length };
  for (const outcome of outcomes) {
    const slot = outcome.index + 1;
    const label = `slot${slot}:${keyFingerprint(outcome.key)}`;
    switch (outcome.health) {
      case 'valid':
        report.validKeys += 1;
        report.validFingerprints.push(label);
        break;
      case 'rate_limited':
        report.rateLimitedKeys += 1;
        report.validFingerprints.push(label);
        break;
      case 'dead':
        report.deadKeys += 1;
        report.deadSlots.push(slot);
        report.deadFingerprints.push(label);
        if (quarantineDead) permanentlyDisabledKeys.add(outcome.key);
        break;
      default:
        report.unreachableKeys += 1;
    }
  }
  report.allDead = report.deadKeys === pool.length;
  return report;
}

/**
 * Generate a JSON response from the configured LLM (original contract).
 */
export async function generateJson<T = unknown>(req: LlmJsonRequest): Promise<T> {
  return (await generateJsonWithMeta<T>(req)).value;
}

/**
 * Generate a JSON response and return usage/model/latency metadata.
 *
 * This is the ONLY place a provider request is retried or fails over. The
 * candidate pool is walked in order (sticky key first, then the rest), moving
 * on for transient failures (429 / timeout / 5xx / 401) and stopping
 * immediately for permanent ones. Attempts are hard-capped; when the caller
 * opts into `retryOnRateLimit` the cap allows one extra attempt after a short
 * fixed backoff. The last typed `LlmError` is thrown so callers can degrade
 * gracefully.
 */
export async function generateJsonWithMeta<T = unknown>(req: LlmJsonRequest): Promise<LlmJsonResult<T>> {
  const candidates = orderedCandidates();
  if (candidates.length === 0) {
    throw new LlmError('LLM not configured (AI_API_KEY unset)', 'not_configured');
  }
  const width = Math.min(candidates.length, LLM_MAX_ATTEMPTS);
  // Pass 1 walks the pool (A → B → C). Pass 2 exists only for the opt-in
  // rate-limit retry: after a short backoff the pool is tried once more, in
  // case the throttle was per-minute. A non-rate-limit failure never gets a
  // second pass, so permanent errors cost exactly one attempt per key.
  const passes = req.retryOnRateLimit ? 1 + RATE_LIMIT_MAX_RETRIES : 1;

  // The MOST ACTIONABLE failure seen (not merely the last one): a rejected key
  // must never mask the throttle that actually blocked the request.
  let bestError: LlmError | null = null;
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0) {
      if (bestError?.kind !== 'rate_limited') break;
      await sleep(RATE_LIMIT_RETRY_BACKOFF_MS);
    }
    // The budget caps TRANSIENT attempts only (429 / timeout / 5xx / network).
    // A key the provider rejects as unauthorized is walked past WITHOUT
    // spending budget: otherwise a pool holding mostly-invalid keys exhausts
    // every attempt on credentials that can never succeed and the request
    // fails while a working key was never tried.
    let budget = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      if (budget >= width) break;
      const candidate = candidates[i];
      try {
        const result = await generateJsonOnce<T>(req, candidate);
        activeApiKey = candidate.apiKey;
        return result;
      } catch (err) {
        const llmError = err instanceof LlmError ? err : new LlmError('LLM unavailable', 'http_error');
        if (!isFailoverEligible(llmError)) throw llmError;
        if (!bestError || errorRank(llmError) > errorRank(bestError)) bestError = llmError;
        coolDown(candidate.apiKey, llmError);
        if (!isInvalidKeyError(llmError)) budget += 1;
      }
    }
  }
  throw bestError ?? new LlmError('LLM request failed', 'http_error');
}

/** One provider attempt with one key — no retry/failover logic here. */
async function generateJsonOnce<T = unknown>(req: LlmJsonRequest, candidate: LlmKeyCandidate): Promise<LlmJsonResult<T>> {
  const provider = config.ai.provider;
  if (provider === 'gemini') {
    return geminiRequest<T>(req, candidate);
  }
  if (provider === 'openai' || provider === 'custom' || provider === 'ollama') {
    return openAiCompatibleRequest<T>(req, provider, candidate);
  }
  throw new LlmError(`LLM provider '${provider}' is not wired (gemini + openai-compatible only)`, 'unsupported_provider');
}

/** One shared timeout helper — abort → typed `timeout` LlmError. */
function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * Extract a SHORT, safe reason from a provider error body. Provider error
 * payloads occasionally echo request content, so only the structured
 * `error.message` / `error.type` fields are read and the result is capped.
 * The API key never appears here (it is only ever sent in a header).
 */
async function providerErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const json = JSON.parse(text) as { error?: { message?: unknown; type?: unknown }; message?: unknown };
      const msg = json?.error?.message ?? json?.message;
      const type = json?.error?.type;
      const parts = [typeof type === 'string' ? type : '', typeof msg === 'string' ? msg : ''].filter(Boolean);
      if (parts.length) return parts.join(': ').slice(0, 300);
    } catch {
      // Non-JSON body — fall through to a truncated raw snippet.
    }
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

/** Map an abort into the typed timeout error (callers never see raw AbortError). */
function rethrowAsLlmError(err: unknown): never {
  if (err instanceof LlmError) throw err;
  if (err instanceof Error && err.name === 'AbortError') {
    throw new LlmError('LLM request timed out', 'timeout');
  }
  throw new LlmError(`LLM unavailable: ${err instanceof Error ? err.message : String(err)}`, 'http_error');
}

// ─── Gemini (original path, behavior preserved) ────────────────────────────

async function geminiRequest<T>(req: LlmJsonRequest, candidate: LlmKeyCandidate): Promise<LlmJsonResult<T>> {
  const baseUrl = (config.ai.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gemini-2.0-flash';
  const timeoutMs = req.timeoutMs ?? config.ai.timeout;
  const instruction = req.schemaHint ? `${req.system}\n\nReturn JSON matching this shape:\n${req.schemaHint}` : req.system;
  const started = Date.now();

  try {
    const payload = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${instruction}\n\n---\n${req.prompt}` }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: config.ai.temperature,
            maxOutputTokens: config.ai.maxTokens,
          },
        }),
        signal,
      });

      if (res.status === 429) throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
      if (!res.ok) {
        const detail = await providerErrorDetail(res);
        throw new LlmError(`LLM request failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`, 'http_error', res.status);
      }

      try {
        return await res.json();
      } catch {
        throw new LlmError('LLM returned invalid JSON envelope', 'invalid_json');
      }
    });

    // Gemini shape: candidates[0].content.parts[*].text
    const text = extractText(payload);
    if (!text) throw new LlmError('LLM response contained no text', 'invalid_json');

    return {
      value: parseJsonContent<T>(text),
      model,
      provider: 'gemini',
      latencyMs: Date.now() - started,
      usage: geminiUsage(payload),
      keySlot: candidate.slot,
    };
  } catch (err) {
    rethrowAsLlmError(err);
  }
}

function geminiUsage(payload: unknown): LlmUsage {
  const meta = (payload as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } })?.usageMetadata;
  const inputTokens = Number(meta?.promptTokenCount) || 0;
  const outputTokens = Number(meta?.candidatesTokenCount) || 0;
  const totalTokens = Number(meta?.totalTokenCount) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function extractText(payload: unknown): string | null {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => p?.text ?? '').join('');
  return text.trim() || null;
}

// ─── OpenAI-compatible (openai | custom | ollama) ──────────────────────────

async function openAiCompatibleRequest<T>(
  req: LlmJsonRequest,
  provider: 'openai' | 'custom' | 'ollama',
  candidate: LlmKeyCandidate,
): Promise<LlmJsonResult<T>> {
  const baseUrl = (config.ai.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new LlmError('LLM not configured (AI_BASE_URL unset)', 'not_configured');
  }
  const model = config.ai.model;
  const timeoutMs = req.timeoutMs ?? config.ai.timeout;
  const instruction = req.schemaHint ? `${req.system}\n\nReturn JSON matching this shape:\n${req.schemaHint}` : req.system;
  const started = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: req.prompt },
    ],
    temperature: config.ai.temperature,
    max_tokens: config.ai.maxTokens,
    stream: false,
  };
  // JSON output mode — supported by OpenAI and OpenAI-compatible gateways
  // (Groq). Ollama's /chat/completions does not accept the field, so it is
  // omitted there; the prompt still demands JSON and invalid JSON still
  // surfaces as a typed `invalid_json` error.
  if (provider !== 'ollama') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const payload = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Key is sent to the provider only — never appears in errors/logs.
          Authorization: `Bearer ${candidate.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (res.status === 429) throw new LlmError('LLM rate limit reached', 'rate_limited', 429);
      if (!res.ok) {
        const detail = await providerErrorDetail(res);
        throw new LlmError(`LLM request failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`, 'http_error', res.status);
      }

      try {
        return await res.json();
      } catch {
        throw new LlmError('LLM returned invalid JSON envelope', 'invalid_json');
      }
    });

    const content = extractOpenAiText(payload);
    if (!content) throw new LlmError('LLM response contained no text', 'invalid_json');

    return {
      value: parseJsonContent<T>(content),
      model,
      provider,
      latencyMs: Date.now() - started,
      usage: openAiUsage(payload),
      keySlot: candidate.slot,
    };
  } catch (err) {
    rethrowAsLlmError(err);
  }
}

function extractOpenAiText(payload: unknown): string | null {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim() || null;
  // Some gateways return content as an array of parts.
  if (Array.isArray(content)) {
    const text = content.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('');
    return text.trim() || null;
  }
  return null;
}

function openAiUsage(payload: unknown): LlmUsage {
  const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
  const inputTokens = Number(usage?.prompt_tokens) || 0;
  const outputTokens = Number(usage?.completion_tokens) || 0;
  const totalTokens = Number(usage?.total_tokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

// ─── Shared parsing ─────────────────────────────────────────────────────────

function parseJsonContent<T>(text: string): T {
  try {
    return JSON.parse(stripFences(text)) as T;
  } catch {
    throw new LlmError('LLM returned non-JSON content', 'invalid_json');
  }
}

/** Models sometimes wrap JSON in markdown fences even in JSON mode. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export { NO_USAGE as LLM_NO_USAGE };