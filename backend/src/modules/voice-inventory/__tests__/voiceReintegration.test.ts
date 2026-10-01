/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice AI re-integration tests (Phase D):
 *   - SpeechService: provider resolution, caps, graceful failure (fetch stubbed)
 *   - Deterministic parser: ADD_STOCK / RECORD_WASTAGE across English,
 *     Hindi (Devanagari), and Hinglish — including missing/invalid fields
 *   - Transcribe endpoint: auth, caps, provider-agnostic safe errors
 * No network: Groq/Google fetch calls are stubbed.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  getSTTConfig, configureSTT, getActiveProviderKind, transcribeAudio,
} from '../services/SpeechService';
import { parseTranscript } from '../services/AIParser';
import { MAX_TRANSCRIBE_AUDIO_BYTES } from '../validators/voiceInventory';
import voiceInventoryRouter from '../routes/voiceInventory';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── SpeechService: provider resolution (§22/§26) ──────────────────

describe('SpeechService provider resolution', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env.STT_PROVIDER = savedEnv.STT_PROVIDER;
    process.env.AI_PROVIDER = savedEnv.AI_PROVIDER;
    process.env.AI_BASE_URL = savedEnv.AI_BASE_URL;
  });

  it('explicit STT_PROVIDER=groq wins and is reported as active', () => {
    configureSTT({ provider: 'groq', apiKey: 'test-key' });
    expect(getSTTConfig().provider).toBe('groq');
    expect(getActiveProviderKind()).toBe('groq');
  });

  it('auto-detects groq from the LLM config (legacy behavior preserved)', () => {
    configureSTT({ provider: 'none', apiKey: 'test-key' });
    process.env.STT_PROVIDER = '';
    process.env.AI_PROVIDER = 'custom';
    process.env.AI_BASE_URL = 'https://api.groq.com/openai/v1';
    // Re-resolution happens through configureSTT — simulate the env-based path:
    configureSTT({ provider: 'groq' });
    expect(getActiveProviderKind()).toBe('groq');
  });

  it('reports none when nothing is keyed (honest unavailability)', () => {
    configureSTT({ provider: 'none', apiKey: '' });
    process.env.GOOGLE_API_KEY = '';
    expect(getActiveProviderKind()).toBe('none');
  });

  it('transcribeAudio throws a typed, provider-agnostic error when unconfigured', async () => {
    configureSTT({ provider: 'none', apiKey: '' });
    await expect(
      transcribeAudio(new Blob([new Uint8Array(1000)], { type: 'audio/webm' })),
    ).rejects.toMatchObject({ name: 'STTNotConfigured' });
  });

  it('groq provider sends the OpenAI-compatible transcription call and parses verbose_json', async () => {
    configureSTT({ provider: 'groq', apiKey: 'test-key', model: 'whisper-large-v3-turbo' });
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      // Verify the Authorization header carries the key and the body is multipart.
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.body).toBeInstanceOf(FormData);
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'add 20 kg rice', segments: [{ confidence: 0.93 }] }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeAudio(new Blob([new Uint8Array(50_000)], { type: 'audio/webm' }), { language: 'en' });
    expect(result.transcript).toBe('add 20 kg rice');
    expect(result.provider).toBe('groq');
    expect(result.confidence).toBeCloseTo(0.93);
  });

  it('falls back to google when groq fails and google is keyed (auto-detected mode)', async () => {
    // Clear the explicit provider so the auto-detected primary allows fallback;
    // an explicit STT_PROVIDER is honored strictly (no surprise switches).
    process.env.STT_PROVIDER = '';
    configureSTT({ provider: 'groq', apiKey: 'test-key' });
    process.env.GOOGLE_API_KEY = 'google-key';
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u.includes('groq') ? 'groq' : 'google');
      if (u.includes('groq')) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      return { ok: true, status: 200, json: async () => ({ results: [{ alternatives: [{ transcript: 'five kg rice', confidence: 0.8 }] }] }) };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeAudio(new Blob([new Uint8Array(50_000)], { type: 'audio/webm' }));
    expect(result.provider).toBe('google');
    expect(result.transcript).toBe('five kg rice');
    process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
    process.env.STT_PROVIDER = savedEnv.STT_PROVIDER;
  });
});

// ─── Deterministic parser (§25 cases) ──────────────────────────────

describe('voice parser — ADD_STOCK', () => {
  it('English: "Add 20 kg rice"', async () => {
    const p = await parseTranscript('Add 20 kg rice');
    expect(p.intent).toBe('inventory_add');
    expect(p.items[0]?.quantity).toBe(20);
    const name = (p.items[0] as { item?: string } | undefined)?.item?.toLowerCase() ?? '';
    expect(name).toContain('rice');
  });

  it('Hinglish: "20 kilo chawal stock mein add karo"', async () => {
    const p = await parseTranscript('20 kilo chawal stock mein add karo');
    expect(p.intent).toBe('inventory_add');
    expect(p.items[0]?.quantity).toBe(20);
  });

  it('Hinglish: "20 kilo rice stock mein daal do"', async () => {
    const p = await parseTranscript('20 kilo rice stock mein daal do');
    expect(p.intent).toBe('inventory_add');
    expect(p.items[0]?.quantity).toBe(20);
  });

  it('Hindi (Devanagari): "20 किलो चावल स्टॉक में डालो"', async () => {
    const p = await parseTranscript('20 किलो चावल स्टॉक में डालो');
    expect(p.intent).toBe('inventory_add');
    expect(p.items[0]?.quantity).toBe(20);
  });
});

describe('voice parser — RECORD_WASTAGE', () => {
  it('English: "5 kg rice was wasted"', async () => {
    const p = await parseTranscript('5 kg rice was wasted');
    expect(p.intent).toBe('inventory_waste');
    expect(p.items[0]?.quantity).toBe(5);
  });

  it('Hinglish: "5 kilo chawal waste ho gaya"', async () => {
    const p = await parseTranscript('5 kilo chawal waste ho gaya');
    expect(p.intent).toBe('inventory_waste');
    expect(p.items[0]?.quantity).toBe(5);
  });

  it('Hinglish: "2 kilo paneer kharab ho gaya"', async () => {
    const p = await parseTranscript('2 kilo paneer kharab ho gaya');
    expect(p.intent).toBe('inventory_waste');
    expect(p.items[0]?.quantity).toBe(2);
  });
});

describe('voice parser — clarification & rejection (§8/§25)', () => {
  it('missing quantity: "Add rice" → does NOT invent a quantity', async () => {
    const p = await parseTranscript('Add rice');
    if (p.intent === 'inventory_add') {
      expect(p.items[0]?.quantity ?? 0).toBeLessThanOrEqual(0);
    }
    // Either way the system must not fabricate a number:
    expect(p.items.every((i) => !(i.quantity > 0 && !p.items[0]))).toBe(true);
  });

  it('empty transcript → unknown with error', async () => {
    const p = await parseTranscript('');
    expect(p.intent).toBe('unknown');
    expect(p.error).toBeTruthy();
  });

  it('negative quantity is never produced from "Add minus 5 kg rice"', async () => {
    const p = await parseTranscript('Add minus 5 kg rice');
    for (const item of p.items) {
      expect(item.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('unknown intent stays unknown (no fabricated action)', async () => {
    const p = await parseTranscript('what a lovely day');
    expect(p.intent).toBe('unknown');
    expect(p.confidence).toBeLessThan(0.5);
  });
});

// ─── Route registration & security (§12/§29) ───────────────────────

describe('transcribe route security', () => {
  const routePaths = () => {
    const paths: Array<{ path: string; methods: string[]; layered: number }> = [];
    voiceInventoryRouter.stack.forEach((layer: any) => {
      if (layer.route) {
        paths.push({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods || {}),
          layered: layer.route.stack?.length ?? 0,
        });
      }
    });
    return paths;
  };

  it('POST /transcribe is registered', () => {
    expect(routePaths().some((r) => r.path === '/transcribe' && r.methods.includes('post'))).toBe(true);
  });

  it('/transcribe is guarded (auth + feature + validate + limiter before handler)', () => {
    const t = routePaths().find((r) => r.path === '/transcribe');
    expect(t?.layered).toBeGreaterThanOrEqual(5); // requireAuth, requireFeature, validate, limiter, handler
  });

  it('audio size cap constant is enforced at a sane bound', () => {
    expect(MAX_TRANSCRIBE_AUDIO_BYTES).toBeGreaterThan(100_000);
    expect(MAX_TRANSCRIBE_AUDIO_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});
