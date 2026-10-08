/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentRemoval.test.ts — MANDATORY NEGATIVE TEST.
 *
 * After the architecture change the old DETERMINISTIC marketing targeting agent
 * must be unreachable from production, through any route or service:
 *
 *   /intelligence → runMarketingAgentDeterministic()   ✗
 *   /recommend    → runMarketingAgentDeterministic()   ✗
 *   /proposal     → runMarketingAgentDeterministic()   ✗
 *
 * The scan walks the PRODUCTION sources (test files are skipped on purpose:
 * migration tests may still name the removed symbols). It also pins the router
 * behaviour: /proposal only ever persists a ranked recommendation.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** Removed symbols that must not exist anywhere in production code. */
const REMOVED_SYMBOLS = [
  'runMarketingAgentDeterministic',
  'createProposalFromAgentResult',
  'resolveAgentTargets',
];

function productionFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) productionFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

describe('removed deterministic marketing agent', () => {
  it('has no production caller anywhere under src/', () => {
    const files = productionFiles(SRC);
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const symbol of REMOVED_SYMBOLS) {
        if (content.includes(symbol)) offenders.push(`${path.relative(SRC, file)} :: ${symbol}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the deterministic targeting ladder no longer exists', () => {
    const agent = fs.readFileSync(path.join(SRC, 'ai/agents/marketingAgent.ts'), 'utf8');
    for (const gone of ['CAUSAL_UPLIFT', 'RESPONSE_MODEL', 'ML_SEGMENTS', 'targetingSource', 'offerDraft']) {
      expect(agent).not.toContain(gone);
    }
    // The agentic insight contract is what remains.
    expect(agent).toContain('agentic_insight');
    expect(agent).toContain('runBoundedAgentLoop');
  });

  it('/proposal only accepts a ranked recommendation (never an agentic insight)', () => {
    const routes = fs.readFileSync(path.join(SRC, 'ai/agents/marketingAgentRoutes.ts'), 'utf8');
    // Only the ranked-recommendation mapper is wired into /proposal.
    expect(routes).toContain('createProposalFromRankedRecommendation');
    expect(routes).toContain('recommendation as SelectedRecommendationInput');
    // The agentic insight run must not be invoked by /proposal.
    const proposalBlock = routes.slice(routes.indexOf("'/proposal'"));
    expect(proposalBlock).not.toContain('runMarketingAgent');
    expect(proposalBlock).toContain('400');
  });

  it('/recommend serves the agentic insight agent (System #2), not a targeting result', () => {
    const routes = fs.readFileSync(path.join(SRC, 'ai/agents/marketingAgentRoutes.ts'), 'utf8');
    const recommendBlock = routes.slice(routes.indexOf("'/recommend'"), routes.indexOf("'/intelligence'"));
    expect(recommendBlock).toContain('runMarketingAgent');
    expect(recommendBlock).not.toContain('Deterministic');
  });

  it('the audience resolver that served the removed bridge is gone', () => {
    expect(fs.existsSync(path.join(SRC, 'ai/agents/audienceResolver.ts'))).toBe(false);
  });
});
