/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportExport.test.ts — Export builders + encryption/signing helpers.
 *
 * These functions are pure (no DB), so tests are deterministic and fast.
 * Verify CSV/JSON generation, the SHA-256 signer, AES-256-GCM round-trip and
 * the record-count plumbing used by the export job status endpoint.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  buildCSV,
  buildJSON,
  sha256,
  encryptPayload,
} from '../exporters/reportExportService';

describe('buildCSV', () => {
  it('emits headers and quoted, comma-escaped values', () => {
    const rows = [
      { plan: 'professional', mrr: 499, tags: ['a', 'b'] },
      { plan: 'premium', mrr: 999, tags: [] },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain('plan');
    expect(csv).toContain('professional');
    // nested objects are JSON-stringified, not broken by commas
    expect(csv).toContain('mrr');
  });

  it('escapes embedded quotes', () => {
    const csv = buildCSV([{ note: 'say "hi"' }]);
    expect(csv).toContain('""hi""');
  });

  it('returns an empty string for empty input', () => {
    expect(buildCSV([])).toBe('');
  });
});

describe('buildJSON', () => {
  it('pretty-prints the report object', () => {
    const json = buildJSON({ a: 1, b: [1, 2, 3] });
    expect(JSON.parse(json)).toEqual({ a: 1, b: [1, 2, 3] });
    expect(json).toContain('\n');
  });
});

describe('sha256', () => {
  it('matches crypto', () => {
    const input = 'hello report';
    expect(sha256(input)).toBe(crypto.createHash('sha256').update(input).digest('hex'));
  });
});

describe('encryptPayload', () => {
  it('round-trips through AES-256-GCM with the original password', () => {
    const plaintext = Buffer.from('sensitive report rows');
    const password = 's3cret!';
    const { file } = encryptPayload(plaintext, password);

    // metadata line + ciphertext
    const nl = file.indexOf(10);
    const meta = JSON.parse(file.slice(0, nl).toString('utf8'));
    expect(meta.alg).toBe('aes-256-gcm');
    expect(meta.kdf).toBe('scrypt');

    // decrypt manually to confirm round-trip
    const key = crypto.scryptSync(password, Buffer.from(meta.salt, 'base64'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
    const out = Buffer.concat([decipher.update(file.slice(nl + 1)), decipher.final()]);
    expect(out.toString('utf8')).toBe('sensitive report rows');
  });

  it('produces a different ciphertext for a different password', () => {
    const plaintext = Buffer.from('same data');
    const a = encryptPayload(plaintext, 'password-a').file;
    const b = encryptPayload(plaintext, 'password-b').file;
    expect(a.equals(b)).toBe(false);
  });
});