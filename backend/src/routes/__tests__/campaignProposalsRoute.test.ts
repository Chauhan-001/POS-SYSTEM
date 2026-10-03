/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * campaignProposalsRoute.test.ts — regression guard for the proposal inbox.
 *
 * History: GET /proposals was registered AFTER GET /:id, so the inbox request
 * was captured by the /:id handler and failed ObjectId validation (HTTP 400).
 * The inbox was unreachable, which is why no UI could be wired to it. These
 * tests pin the route ordering so it cannot regress silently.
 */

import { describe, it, expect } from 'vitest';
import campaignsRouter from '../campaigns';

interface Layer {
  methods: string[];
  path: string | undefined;
}

function routeLayers(router: { stack: Array<{ route?: { methods?: Record<string, boolean>; path?: string } }> }): Layer[] {
  return router.stack.map((l) => ({
    methods: Object.keys(l.route?.methods ?? {}),
    path: l.route?.path,
  }));
}

describe('campaigns route ordering (proposal inbox regression guard)', () => {
  it('registers GET /proposals BEFORE GET /:id so the inbox is not captured as an ObjectId param', () => {
    const getLayers = routeLayers(campaignsRouter).filter((l) => l.methods.includes('get'));
    const proposalsIdx = getLayers.findIndex((l) => l.path === '/proposals');
    const idIdx = getLayers.findIndex((l) => l.path === '/:id');
    expect(proposalsIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(-1);
    expect(proposalsIdx).toBeLessThan(idIdx);
  });

  it('keeps the full proposal lifecycle mounted', () => {
    const paths = routeLayers(campaignsRouter).map((l) => l.path);
    for (const expected of [
      '/proposals',
      '/proposals/:id/submit',
      '/proposals/:id/approve',
      '/proposals/:id/reject',
      '/proposals/:id/schedule',
      '/proposals/:id/measure',
    ]) {
      expect(paths).toContain(expected);
    }
  });
});
