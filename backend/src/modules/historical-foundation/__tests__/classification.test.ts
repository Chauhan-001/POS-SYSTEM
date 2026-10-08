/**
 * PHASE 1 — classification coverage + integrity tests.
 *
 * These are the Phase 1 completion gate (prompt §56): the registry must classify
 * EVERY live collection, each domain must carry exactly one valid action, and the
 * tenant/branch scoping must be explicit. Pure — no DB.
 */

import { describe, expect, it } from 'vitest';

import {
  CLASSIFICATIONS,
  LIVE_COLLECTIONS_SNAPSHOT,
  classifiedActions,
  classifiedCollections,
  classifyCollection,
  coverageGaps,
  findDomain,
} from '../classification';
import { DATA_STATUSES, HISTORICAL_ACTIONS } from '../dataContract';

describe('classification coverage', () => {
  it('classifies every live collection (no unclassified, no phantom, no double-owner)', () => {
    const gaps = coverageGaps();
    expect(gaps.unclassified, `unclassified: ${gaps.unclassified.join(', ')}`).toEqual([]);
    expect(gaps.phantom, `phantom (named but not live): ${gaps.phantom.join(', ')}`).toEqual([]);
    expect(gaps.duplicateOwners, `double-owned: ${gaps.duplicateOwners.join(', ')}`).toEqual([]);
  });

  it('covers all 128 collections from the 2026-10-08 snapshot', () => {
    expect(LIVE_COLLECTIONS_SNAPSHOT).toHaveLength(128);
    expect(classifiedCollections()).toHaveLength(128);
    // The registry must be a permutation of the snapshot.
    expect([...classifiedCollections()].sort()).toEqual([...LIVE_COLLECTIONS_SNAPSHOT].sort());
  });

  it('assigns each domain exactly one valid action and one valid status', () => {
    for (const c of CLASSIFICATIONS) {
      expect(HISTORICAL_ACTIONS, c.domain).toContain(c.action);
      expect(DATA_STATUSES, c.domain).toContain(c.status);
      expect(c.collections.length, c.domain).toBeGreaterThan(0);
    }
  });

  it('has unique domain keys and every collection resolves to exactly one domain', () => {
    const domains = CLASSIFICATIONS.map((c) => c.domain);
    expect(new Set(domains).size).toBe(domains.length);
    for (const col of LIVE_COLLECTIONS_SNAPSHOT) {
      const owner = classifyCollection(col);
      expect(owner, col).toBeDefined();
      expect(owner!.collections).toContain(col);
    }
  });

  it('declares reader surfaces for every domain and only valid surfaces', () => {
    for (const c of CLASSIFICATIONS) {
      expect(c.readers.length, c.domain).toBeGreaterThan(0);
      expect(c.writer.length, c.domain).toBeGreaterThan(0);
    }
  });
});

describe('classification key decisions (documented in MASTER-HISTORICAL-DATA-TODO §4)', () => {
  it('treats the transaction spine as REUSE_EXISTING (never regenerate real history)', () => {
    expect(findDomain('sales.transactionSpine')?.action).toBe('REUSE_EXISTING');
  });

  it('treats recipe cost as RECONSTRUCT/UNAVAILABLE (never fabricate historical cost)', () => {
    const r = findDomain('recipes.cost');
    expect(r?.action).toBe('RECONSTRUCT');
    expect(r?.status).toBe('UNAVAILABLE');
  });

  it('treats experiment definitions as BACKFILL_MISSING but never fabricates them', () => {
    const e = findDomain('experiments.causal');
    expect(e?.action).toBe('BACKFILL_MISSING');
    expect(e?.note ?? '').toMatch(/do NOT fabricate/i);
  });

  it('keeps platform billing operational-only and separate from restaurant finance', () => {
    expect(findDomain('admin.platform')?.action).toBe('LEAVE_OPERATIONAL_ONLY');
    expect(findDomain('finance')?.action).toBe('REUSE_EXISTING');
  });

  it('flags recipeconsumptions-date implementations as out of scope for direct generate', () => {
    // The classification must never mark the spine as GENERATE_SYNTHETIC_DEV_DATA.
    expect(classifiedActions()).not.toContain('GENERATE_SYNTHETIC_DEV_DATA');
  });
});
