/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cricketKeyRotation.test.ts — when the primary CricAPI key is quota-blocked
 * (HTTP 200 + reason → rate_limited), the fetch must rotate to the next key
 * in the pool instead of reporting "no matches".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../../../../config';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { fetchAllMatches } from '../cricketService';
import { clearCricketKeyCooldowns } from '../cricketProvider';

function okResponse(data: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  clearCricketKeyCooldowns();
});

describe('cricket fallback key rotation', () => {
  it('rotates to the next key when the primary is quota-blocked and still never logs the key', async () => {
    const fallbacks = ['aaaa-bbbb', 'cccc-dddd'];
    (config.cricket as unknown as { fallbackApiKeys: string[] }).fallbackApiKeys = fallbacks;

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logged.push(args.join(' ')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Call 1 with key A → quota-block; call 2 with key B → success.
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ reason: 'Blocking since hits today exceeded hits limit', data: [] }) })
      .mockImplementation(async (url: string) => {
        // Every successful call must use a fallback key, not the primary.
        expect(url).not.toMatch(/apikey=e49c06d9/);
        return okResponse([
          { id: 'm1', name: 'IND vs AUS', date: '2026-10-10', dateTimeGMT: '2026-10-10T09:00:00Z', teams: ['India', 'Australia'] },
        ]);
      });

    const outcome = await fetchAllMatches();

    expect(outcome.matches.length).toBeGreaterThan(0);
    // 2 pages: page 1 (primary blocked → fallback succeeds), page 2 (empty → stop).
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const rotationLogged = logged.join('\n').includes('keyRotated=true');
    expect(rotationLogged).toBe(true);
    // Keys never appear in logs.
    for (const line of logged) {
      for (const key of [...fallbacks]) expect(line).not.toContain(key);
    }
    spy.mockRestore();
    warnSpy.mockRestore();
  });

  it('reports honest unavailability when the whole pool is exhausted', async () => {
    (config.cricket as unknown as { fallbackApiKeys: string[] }).fallbackApiKeys = ['ffff-1111'];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reason: 'Blocking since hits today exceeded hits limit', data: [] }),
    });

    await expect(fetchAllMatches()).rejects.toThrow(/hits today|exhausted/i);
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary + one fallback, no more
  });
});
