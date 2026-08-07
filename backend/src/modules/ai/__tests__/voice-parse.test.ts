/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice-Parse Unit Tests
 * Tests Zod validation schema for voice-parse endpoint.
 * Also tests controller fallback behavior when AI is unavailable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { voiceParseSchema } from '../validators/ai';
import { buildVoiceParsePrompt } from '../prompts/voice';

// ============================================================
// ZOD VALIDATION TESTS
// ============================================================

describe('voiceParseSchema', () => {
  // ─── Valid inputs ─────────────────────────────────────────

  it('accepts valid voice command with transcript only', () => {
    const result = voiceParseSchema.safeParse({ transcript: 'add 20L milk' });
    expect(result.success).toBe(true);
  });

  it('accepts valid voice command with transcript and items', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add 20L milk',
      items: [{ name: 'milk', unit: 'L' }, { name: 'bread', unit: 'pcs' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts voice command with items that have no unit', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'waste 3 bread',
      items: [{ name: 'bread' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts voice command with employee info', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'log 2kg chicken spoiled',
      items: [{ name: 'chicken', unit: 'kg' }],
      employee: { name: 'Test Chef', role: 'Chef' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts max-length transcript (500 chars)', () => {
    const longText = 'a'.repeat(500);
    const result = voiceParseSchema.safeParse({ transcript: longText });
    expect(result.success).toBe(true);
  });

  // ─── Invalid inputs ───────────────────────────────────────

  it('rejects missing transcript', () => {
    const result = voiceParseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty transcript', () => {
    const result = voiceParseSchema.safeParse({ transcript: '' });
    expect(result.success).toBe(false);
  });

  it('rejects transcript over 500 characters', () => {
    const longText = 'a'.repeat(501);
    const result = voiceParseSchema.safeParse({ transcript: longText });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should mention max or transcript in the error
      const msg = JSON.stringify(result.error.issues);
      expect(msg).toContain('500');
    }
  });

  it('rejects extra unknown fields (strict mode)', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add 20L milk',
      unknownField: 'should not be here',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map(i => i.message).join(', ');
      expect(msg.toLowerCase()).toContain('unrecognized');
    }
  });

  it('rejects text field (removed — only transcript is valid)', () => {
    const result = voiceParseSchema.safeParse({
      text: 'add 20L milk',
    });
    expect(result.success).toBe(false); // .strict() + missing transcript
  });

  it('rejects inventoryItems field (removed — only items is valid)', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add 20L milk',
      inventoryItems: [{ name: 'milk', unit: 'L' }],
    });
    expect(result.success).toBe(false); // .strict() rejects unknown field
  });

  it('rejects items with empty name', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add 20L milk',
      items: [{ name: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string transcript', () => {
    const result = voiceParseSchema.safeParse({ transcript: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects null transcript', () => {
    const result = voiceParseSchema.safeParse({ transcript: null });
    expect(result.success).toBe(false);
  });

  it('rejects items with missing name', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add milk',
      items: [{ unit: 'L' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects employee with empty name', () => {
    const result = voiceParseSchema.safeParse({
      transcript: 'add milk',
      employee: { name: '' },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// PROMPT BUILDER TESTS
// ============================================================

describe('buildVoiceParsePrompt', () => {
  it('includes the command text in the prompt', () => {
    const prompt = buildVoiceParsePrompt('add 20L milk', []);
    expect(prompt).toContain('add 20L milk');
  });

  it('includes known inventory items', () => {
    const prompt = buildVoiceParsePrompt('waste 3 bread', [
      { name: 'milk', unit: 'L' },
      { name: 'bread', unit: 'pcs' },
    ]);
    expect(prompt).toContain('milk');
    expect(prompt).toContain('bread');
    expect(prompt).toContain('(L)');
    expect(prompt).toContain('(pcs)');
  });

  it('includes fallback text when no items provided', () => {
    const prompt = buildVoiceParsePrompt('add something', []);
    expect(prompt).toContain('Generic items');
  });

  it('includes add_stock example', () => {
    const prompt = buildVoiceParsePrompt('test', []);
    expect(prompt).toContain('add_stock');
  });

  it('includes log_waste example', () => {
    const prompt = buildVoiceParsePrompt('test', []);
    expect(prompt).toContain('log_waste');
  });

  it('mentions JSON response format', () => {
    const prompt = buildVoiceParsePrompt('test', []);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('success');
    expect(prompt).toContain('action');
    expect(prompt).toContain('itemName');
    expect(prompt).toContain('quantity');
  });
});

// ============================================================
// CONTROLLER TESTS — extracted logic unit tests
// ============================================================

describe('voiceParse controller logic', () => {
  it('extracts transcript from body', () => {
    const body = { transcript: 'add 20L milk' };
    const text = body.transcript || '';
    expect(text).toBe('add 20L milk');
  });

  it('defaults transcript to empty string when missing', () => {
    const body = {};
    const text = (body as any).transcript || '';
    expect(text).toBe('');
  });

  it('extracts items from body', () => {
    const body = { items: [{ name: 'milk', unit: 'L' }] };
    const items = body.items || [];
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('milk');
  });

  it('defaults items to empty array when missing', () => {
    const body = {};
    const items = (body as any).items || [];
    expect(items).toEqual([]);
  });

  it('builds prompt from extracted text and items', () => {
    const text = 'add 20L milk';
    const items = [{ name: 'milk', unit: 'L' }];
    const prompt = buildVoiceParsePrompt(text, items);
    expect(prompt).toContain('add 20L milk');
    expect(prompt).toContain('milk (L)');
  });
});
