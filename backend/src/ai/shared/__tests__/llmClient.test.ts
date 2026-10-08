/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * llmClient.test.ts — Phase 1 foundation: the ONE shared LLM client must
 * route the configured custom/OpenAI-compatible provider (Groq in .env),
 * preserve the original Gemini path, keep typed LlmError kinds, and never
 * leak the API key.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { config } from '../../../config';
import {
  checkLlmKeyPoolHealth,
  generateJson,
  generateJsonWithMeta,
  getLlmKeyPoolState,
  isLlmConfigured,
  LlmError,
  LLM_MAX_ATTEMPTS,
  resetLlmKeyRotation,
  RATE_LIMIT_RETRY_BACKOFF_MS,
} from '../llmClient';

const original = { ...config.ai };
const originalModelEnv = process.env.AI_MODEL;

beforeAll(() => {
  // Unit tests must never depend on (or hit) a real provider.
  config.ai.apiKey = 'sk-unit-test-secret';
  config.ai.baseUrl = '';
  config.ai.model = 'test-model';
});

beforeEach(() => {
  config.ai.apiKey = 'sk-unit-test-secret';
  config.ai.fallbackApiKeys = [];
  config.ai.provider = 'custom';
  config.ai.baseUrl = 'https://groq.example/openai/v1';
  config.ai.model = 'test-model';
  config.ai.timeout = 2_000;
  resetLlmKeyRotation();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.AI_MODEL = originalModelEnv;
  resetLlmKeyRotation();
});

afterAll(() => {
  Object.assign(config.ai, original);
});

type FetchCall = [string, RequestInit];

function stubFetch(impl: (url: string, init: RequestInit) => Promise<unknown> | unknown) {
  const mock = vi.fn(async (url: unknown, init?: unknown) => impl(String(url), (init ?? {}) as RequestInit));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function okJson(payload: unknown) {
  return { status: 200, ok: true, json: async () => payload };
}

describe('custom / OpenAI-compatible provider (the configured .env route)', () => {
  it('routes to {baseUrl}/chat/completions with JSON mode, bearer auth, and returns value + usage', async () => {
    config.ai.provider = 'custom';
    const fetchMock = stubFetch(() =>
      okJson({
        choices: [{ message: { content: '{"plan":["a"],"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }),
    );

    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 'sys', prompt: 'user ask' });

    expect(res.value).toEqual({ plan: ['a'], ok: true });
    expect(res.provider).toBe('custom');
    expect(res.model).toBe('test-model');
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe('https://groq.example/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-unit-test-secret');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('test-model');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1]).toMatchObject({ role: 'user', content: 'user ask' });
  });

  it('supports provider "openai" on the same route and strips markdown fences', async () => {
    config.ai.provider = 'openai';
    const fetchMock = stubFetch(() => okJson({ choices: [{ message: { content: '```json\n{"n":1}\n```' } }], usage: {} }));

    const res = await generateJsonWithMeta({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ n: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
  });

  it('omits response_format for ollama (unsupported field) but keeps JSON parsing', async () => {
    config.ai.provider = 'ollama';
    const fetchMock = stubFetch(() => okJson({ choices: [{ message: { content: '{"n":2}' } }] }));

    await generateJsonWithMeta({ system: 's', prompt: 'p' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchCall)[1].body));
    expect('response_format' in body).toBe(false);
  });

  it('generateJson (original contract) returns only the parsed value', async () => {
    stubFetch(() => okJson({ choices: [{ message: { content: '{"x":5}' } }] }));
    await expect(generateJson({ system: 's', prompt: 'p' })).resolves.toEqual({ x: 5 });
  });
});

describe('Gemini path (behavior preserved)', () => {
  it('calls generateContent with JSON mime mode and parses candidates + usageMetadata', async () => {
    config.ai.provider = 'gemini';
    config.ai.baseUrl = 'https://gemini.example/v1beta';
    process.env.AI_MODEL = 'gemini-test-model';
    const fetchMock = stubFetch(() =>
      okJson({
        candidates: [{ content: { parts: [{ text: '{"events":[1]}' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      }),
    );

    const res = await generateJsonWithMeta({ system: 's', prompt: 'p' });

    expect(res.value).toEqual({ events: [1] });
    expect(res.provider).toBe('gemini');
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe('https://gemini.example/v1beta/models/gemini-test-model:generateContent?key=sk-unit-test-secret');
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('failure contracts (typed LlmError, graceful degradation)', () => {
  it('unsupported provider → unsupported_provider, message never contains the key', async () => {
    config.ai.provider = 'anthropic';
    const err = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('unsupported_provider');
    expect(String((err as LlmError).message)).not.toContain('sk-unit-test-secret');
  });

  it('missing key → not_configured and isLlmConfigured() is false', async () => {
    config.ai.apiKey = '';
    expect(isLlmConfigured()).toBe(false);
    const err = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect((err as LlmError).kind).toBe('not_configured');
  });

  it('missing base URL for an openai-compatible provider → not_configured', async () => {
    config.ai.baseUrl = '';
    const err = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect((err as LlmError).kind).toBe('not_configured');
  });

  it('abort → timeout', async () => {
    stubFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    const err = await generateJson({ system: 's', prompt: 'p', timeoutMs: 15 }).catch((e) => e as LlmError);
    expect((err as LlmError).kind).toBe('timeout');
  });

  it('non-JSON model content → invalid_json', async () => {
    stubFetch(() => okJson({ choices: [{ message: { content: 'this is not json' } }] }));
    const err = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect((err as LlmError).kind).toBe('invalid_json');
  });

  it('429 → rate_limited; 500 → http_error with status and no key in the message', async () => {
    stubFetch(() => ({ status: 429, ok: false, json: async () => ({}) }));
    const rate = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect((rate as LlmError).kind).toBe('rate_limited');

    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 500, ok: false, json: async () => ({}) }));
    const http = await generateJson({ system: 's', prompt: 'p' }).catch((e) => e as LlmError);
    expect((http as LlmError).kind).toBe('http_error');
    expect((http as LlmError).httpStatus).toBe(500);
    expect(String((http as LlmError).message)).not.toContain('sk-unit-test-secret');
  });

  it('400 JSON-validation failure surfaces a short provider reason and never the key', async () => {
    stubFetch(() => ({
      status: 400,
      ok: false,
      text: async () =>
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'Failed to validate JSON. Please adjust your prompt.' } }),
    }));
    const err = (await generateJson({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('http_error');
    expect(err.httpStatus).toBe(400);
    expect(err.message).toContain('invalid_request_error');
    expect(err.message).toContain('Failed to validate JSON');
    expect(err.message).not.toContain('sk-unit-test-secret');
  });

  it('a non-ok response with no readable body still yields a typed http_error (no throw)', async () => {
    stubFetch(() => ({ status: 502, ok: false }));
    const err = (await generateJson({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('http_error');
    expect(err.httpStatus).toBe(502);
  });

  it('schema hint is folded into the system instruction, not sent as a third message', async () => {
    const fetchMock = stubFetch(() => okJson({ choices: [{ message: { content: '{}' } }] }));
    await generateJson({ system: 'sys', prompt: 'user', schemaHint: '{"a":1}' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchCall)[1].body));
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain('{"a":1}');
  });
});

/**
 * A transient provider 429 must not discard an investigation that already ran,
 * but the retry must stay strictly bounded (one attempt, short backoff) and
 * must stay OPT-IN so the bounded agent loop's wall-clock budget is unchanged.
 */
describe('bounded 429 retry', () => {
  const tooManyRequests = () => ({ status: 429, ok: false, text: async () => 'slow down' });

  it('is OFF by default: a 429 fails immediately with a single attempt', async () => {
    const fetchMock = stubFetch(tooManyRequests);
    const err = (await generateJson({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('rate_limited');
    expect(err.httpStatus).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('with retryOnRateLimit, ONE transient 429 is retried after a short backoff and can succeed', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchMock = stubFetch(() => {
        calls += 1;
        return calls === 1 ? tooManyRequests() : okJson({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} });
      });
      const pending = generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p', retryOnRateLimit: true });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_BACKOFF_MS + 10);
      const res = await pending;
      expect(res.value).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second 429 is NOT retried again — the typed error surfaces for graceful degradation', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubFetch(tooManyRequests);
      const pending = generateJsonWithMeta({ system: 's', prompt: 'p', retryOnRateLimit: true });
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'rate_limited', httpStatus: 429 });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_BACKOFF_MS + 10);
      await assertion;
      // Exactly one retry — never an unbounded loop, never a hang.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never retries a permanent failure (500) even when the flag is set', async () => {
    const fetchMock = stubFetch(() => ({ status: 500, ok: false, text: async () => 'boom' }));
    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p', retryOnRateLimit: true }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('http_error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Key-pool failover: a throttled/dead key must not fail the whole agent step
 * when another configured key can serve it. The pool is walked in order and
 * the key that works becomes sticky for the rest of the loop.
 */
describe('key pool failover', () => {
  const KEY_A = 'sk-primary-secret';
  const KEY_B = 'sk-fallback-b-secret';
  const KEY_C = 'sk-fallback-c-secret';

  const rateLimited = () => ({ status: 429, ok: false, text: async () => 'slow down' });
  const serverError = () => ({ status: 503, ok: false, text: async () => 'upstream down' });
  const ok = (value: unknown) => okJson({ choices: [{ message: { content: JSON.stringify(value) } }], usage: {} });

  it('A → 429 → B: the fallback key serves the call and the result reports the working slot', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    const seen: string[] = [];
    const fetchMock = stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      return auth === `Bearer ${KEY_A}` ? rateLimited() : ok({ ok: true });
    });

    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ ok: true });
    expect(seen).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(res.keySlot).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the working key for the NEXT call of the same loop (sticky, no re-probe of A)', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    const seen: string[] = [];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      return auth === `Bearer ${KEY_A}` ? rateLimited() : ok({ n: seen.length });
    });

    await generateJsonWithMeta({ system: 's', prompt: 'call 1' });
    await generateJsonWithMeta({ system: 's', prompt: 'call 2' });
    // Call 1: A then B. Call 2: B only — the cooled-down primary is skipped.
    expect(seen).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_B}`]);
  });

  it('escalates to a third key only when the first fallback also fails', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B, KEY_C];
    const seen: string[] = [];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      return auth === `Bearer ${KEY_C}` ? ok({ ok: true }) : serverError();
    });

    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ ok: true });
    expect(res.keySlot).toBe(2);
    expect(seen).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_C}`]);
  });

  it('a timeout on one key fails over to the next', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    const seen: string[] = [];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      if (auth === `Bearer ${KEY_A}`) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }
      return ok({ ok: true });
    });

    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p', timeoutMs: 15 });
    expect(res.value).toEqual({ ok: true });
    expect(seen).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it('stops at the pool when every key is throttled and reports the typed 429', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B, KEY_C];
    const fetchMock = stubFetch(rateLimited);

    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('rate_limited');
    expect(err.httpStatus).toBe(429);
    // One pass over the pool — bounded, no unbounded hammering.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getLlmKeyPoolState().blockedKeys).toBe(3);
    expect(getLlmKeyPoolState().allBlocked).toBe(true);
  });

  it('caps the pool walk at LLM_MAX_ATTEMPTS keys even when more are configured', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B, KEY_C, 'sk-d-secret', 'sk-e-secret'];
    const fetchMock = stubFetch(rateLimited);

    await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(LLM_MAX_ATTEMPTS);

    // The opt-in retry adds at most ONE more bounded pass over that cap.
    resetLlmKeyRotation();
    const retryMock = stubFetch(rateLimited);
    await generateJsonWithMeta({ system: 's', prompt: 'p', retryOnRateLimit: true }).catch(() => undefined);
    expect(retryMock.mock.calls.length).toBeLessThanOrEqual(LLM_MAX_ATTEMPTS * 2);
  });

  it('never fails over on a permanent 400 (every key would fail identically)', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    const fetchMock = stubFetch(() => ({ status: 400, ok: false, text: async () => '{"error":{"message":"bad request"}}' }));

    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('http_error');
    expect(err.httpStatus).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fails over on unparseable model output', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    const fetchMock = stubFetch(() => okJson({ choices: [{ message: { content: 'not json' } }] }));

    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe('invalid_json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports only counts (never key material) and never leaks a key in an error message', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    stubFetch(() => ({ status: 500, ok: false, text: async () => 'boom' }));

    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    const surface = `${err.message} ${JSON.stringify(getLlmKeyPoolState())}`;
    expect(surface).not.toContain(KEY_A);
    expect(surface).not.toContain(KEY_B);
    expect(getLlmKeyPoolState()).toEqual({ totalKeys: 2, blockedKeys: 0, allBlocked: false });
  });

  it('cools down a key the provider rejects as unauthorized and serves from the next one', async () => {
    config.ai.apiKey = KEY_A;
    config.ai.fallbackApiKeys = [KEY_B];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      return auth === `Bearer ${KEY_A}` ? { status: 401, ok: false, text: async () => 'invalid api key' } : ok({ ok: true });
    });

    await generateJsonWithMeta({ system: 's', prompt: 'p' });
    expect(getLlmKeyPoolState().blockedKeys).toBe(1);
    expect(getLlmKeyPoolState().allBlocked).toBe(false);
  });

  it('walks PAST rejected keys without spending the attempt budget, so a valid key further down the pool is still reached', async () => {
    // Four keys that always 401, then a working key — all beyond
    // LLM_MAX_ATTEMPTS. The budget must be spent only on transient failures,
    // or this request fails while a perfectly good key sits untried.
    const BAD = ['sk-bad-1', 'sk-bad-2', 'sk-bad-3', 'sk-bad-4'];
    config.ai.apiKey = BAD[0];
    config.ai.fallbackApiKeys = [...BAD.slice(1), 'sk-good-secret'];
    const seen: string[] = [];
    const fetchMock = stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      return auth === 'Bearer sk-good-secret'
        ? ok({ ok: true })
        : { status: 401, ok: false, text: async () => 'invalid api key' };
    });

    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ ok: true });
    // Every rejected key is quarantined, and the working key was reached.
    expect(seen.filter((a) => a === 'Bearer sk-good-secret')).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(LLM_MAX_ATTEMPTS);

    // The quarantined keys stay out of the rotation on the next call.
    seen.length = 0;
    await generateJsonWithMeta({ system: 's', prompt: 'p' });
    expect(seen).toEqual(['Bearer sk-good-secret']);
  });

  it('reports the THROTTLE, not a rejected key, when the pool mixes both causes', async () => {
    // The working key is throttled and the remaining configured keys are
    // stale. The last attempt therefore ends on a 401 — but "invalid API key"
    // is not why the request failed, and reporting it sends the caller down
    // the wrong recovery path.
    config.ai.apiKey = 'sk-throttled-secret';
    config.ai.fallbackApiKeys = ['sk-bad-1', 'sk-bad-2'];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      if (auth === 'Bearer sk-throttled-secret') return rateLimited();
      return { status: 401, ok: false, text: async () => 'invalid api key' };
    });

    const err = (await generateJsonWithMeta({ system: 's', prompt: 'p' }).catch((e) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe('rate_limited');
    // A rejected credential is permanent for this process, so those keys are
    // quarantined; the throttle on the working key is a cooldown, not a ban.
    expect(getLlmKeyPoolState().blockedKeys).toBe(3);
    expect(String(err.message)).not.toMatch(/sk-|api key/i);
  });

  it('isLlmConfigured() is true when only a fallback key is set', async () => {
    config.ai.apiKey = '';
    config.ai.fallbackApiKeys = ['sk-fallback-b-secret'];
    expect(isLlmConfigured()).toBe(true);
    stubFetch(() => ok({ ok: true }));
    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ ok: true });
  });
});

describe('key-pool health check (startup diagnosis)', () => {
  const ok = (value: unknown) => okJson({ choices: [{ message: { content: JSON.stringify(value) } }], usage: {} });
  const GOOD = 'sk-healthy-secret';
  const THROTTLED = 'sk-throttled-secret';
  const BAD_1 = 'sk-dead-one-secret';
  const BAD_2 = 'sk-dead-two-secret';

  /** Answer the token-free auth probe per key. */
  const probe = (statusFor: (key: string) => number | 'network') =>
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      const status = statusFor(auth.replace('Bearer ', ''));
      if (status === 'network') throw new Error('ECONNRESET');
      return status === 200 ? okJson({ data: [] }) : { status, ok: false, text: async () => 'nope' };
    });

  it('reports how many keys authenticate, and classifies a throttle as AUTHENTICATED', async () => {
    config.ai.apiKey = GOOD;
    config.ai.fallbackApiKeys = [THROTTLED, BAD_1];
    probe((key) => (key === GOOD ? 200 : key === THROTTLED ? 429 : 401));

    const report = await checkLlmKeyPoolHealth({ quarantineDead: false });
    expect(report.totalKeys).toBe(3);
    expect(report.validKeys).toBe(1);
    // A 429 proves the credential was accepted — it is throttled, not dead.
    expect(report.rateLimitedKeys).toBe(1);
    expect(report.deadKeys).toBe(1);
    expect(report.deadSlots).toEqual([3]);
    expect(report.allDead).toBe(false);
    // One entry per WORKING key, identifiable without exposing the secret.
    expect(report.validFingerprints).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('sk-');
  });

  it('quarantines the rejected keys so agent runs never pay for them', async () => {
    config.ai.apiKey = BAD_1;
    config.ai.fallbackApiKeys = [BAD_2, GOOD];
    const fetchMock = probe((key) => (key === GOOD ? 200 : 401));

    await checkLlmKeyPoolHealth();
    expect(getLlmKeyPoolState().blockedKeys).toBe(2);

    // The next real call reaches the working key without re-probing the dead ones.
    fetchMock.mockClear();
    const seen: string[] = [];
    stubFetch((_url, init) => {
      const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');
      seen.push(auth);
      return ok({ ok: true });
    });
    const res = await generateJsonWithMeta<{ ok: boolean }>({ system: 's', prompt: 'p' });
    expect(res.value).toEqual({ ok: true });
    expect(seen).toEqual([`Bearer ${GOOD}`]);
  });

  it('flags an entirely rejected pool without inventing a success', async () => {
    config.ai.apiKey = BAD_1;
    config.ai.fallbackApiKeys = [BAD_2];
    probe(() => 401);

    const report = await checkLlmKeyPoolHealth({ quarantineDead: false });
    expect(report.deadKeys).toBe(2);
    expect(report.validKeys).toBe(0);
    expect(report.deadSlots).toEqual([1, 2]);
    expect(report.allDead).toBe(true);
  });

  it('never treats a network failure or a 5xx as a dead credential', async () => {
    // A transient provider outage must not be mistaken for a bad key: doing so
    // would permanently disable a pool that is merely unreachable.
    config.ai.apiKey = GOOD;
    config.ai.fallbackApiKeys = ['sk-flaky-secret'];
    probe((key) => (key === GOOD ? 'network' : 503));

    const report = await checkLlmKeyPoolHealth();
    expect(report.unreachableKeys).toBe(2);
    expect(report.deadKeys).toBe(0);
    expect(report.allDead).toBe(false);
    expect(getLlmKeyPoolState().blockedKeys).toBe(0);
  });

  it('skips (never throws) when the pool is empty or the provider has no probe', async () => {
    config.ai.apiKey = '';
    config.ai.fallbackApiKeys = [];
    expect((await checkLlmKeyPoolHealth()).skippedReason).toMatch(/no keys configured/i);

    config.ai.apiKey = GOOD;
    config.ai.provider = 'gemini';
    stubFetch(() => {
      throw new Error('must not be called');
    });
    const report = await checkLlmKeyPoolHealth();
    expect(report.skippedReason).toMatch(/no token-free probe endpoint/i);
    expect(report.totalKeys).toBe(1);
    expect(report.deadKeys).toBe(0);
  });

});
