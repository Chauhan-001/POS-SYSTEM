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
import { generateJson, generateJsonWithMeta, isLlmConfigured, LlmError } from '../llmClient';

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
  config.ai.provider = 'custom';
  config.ai.baseUrl = 'https://groq.example/openai/v1';
  config.ai.model = 'test-model';
  config.ai.timeout = 2_000;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.AI_MODEL = originalModelEnv;
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

  it('schema hint is folded into the system instruction, not sent as a third message', async () => {
    const fetchMock = stubFetch(() => okJson({ choices: [{ message: { content: '{}' } }] }));
    await generateJson({ system: 'sys', prompt: 'user', schemaHint: '{"a":1}' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchCall)[1].body));
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain('{"a":1}');
  });
});
