/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scenarios.harness.ts — the shared machinery for the Phase 17 scenario matrix.
 * NOT a suite (no `.test.` in the name), so vitest never runs it directly.
 *
 * Purpose: every scenario is driven through the REAL canonical path —
 * `runMarketingAnalyze` → domain capabilities → situation model → candidate
 * engine → deterministic gate → ranking → critic — against a real (in-memory)
 * MongoDB, with the LLM either disabled or stubbed. Nothing here re-implements
 * a layer or mocks a domain capability: the point of the matrix is to prove the
 * behaviour of the code the owner's request actually runs.
 *
 * The LLM is stubbed, not the pipeline: `disableLlm: true` exercises the
 * documented deterministic fallbacks (including the no-model critic), and
 * `llm`/`criticLlm` accept a scripted model for the cases that need one. This
 * is why the matrix can run in CI without a provider.
 *
 * HONESTY CONTRACT enforced by the helpers below — a scenario may assert a
 * disclosure or an absence, never a flattering rewrite:
 *   - an area with no data reports `unavailable`, never "healthy";
 *   - a declared-only capability is disclosed, never silently dropped;
 *   - nothing is recommended from an empty database;
 *   - confidence is never inflated to cover a missing domain.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { registerAllTools } from '../../tools/registerAllTools';
import { registerMarketingDomainTools } from '../domains';
import { runMarketingAnalyze, type AnalyzeOptions } from '../analyze';
import type { AnalyzeResponse } from '../contracts';
import type { IntelligenceDomain } from '../contracts';

import Product from '../../../models/catalog/Product';
import Customer from '../../../models/customers/Customer';
import Offer from '../../../models/marketing/Offer';
import CampaignHistory from '../../../models/marketing/CampaignHistory';
import RestaurantModel from '../../../models/core/Restaurant';
import Branch from '../../../models/core/Branch';

/** Two distinct, valid tenants so cross-tenant blindness is expressible. */
export const TENANT_A = { restaurantId: '507f1f77bcf86cd799439011', actorId: 'scenario-owner-a' };
export const TENANT_B = { restaurantId: '507f1f77bcf86cd799439022', actorId: 'scenario-owner-b' };

let mongod: MongoMemoryServer | null = null;
let seq = 0;

export async function startScenarioDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  registerMarketingDomainTools();
  registerAllTools();
}

export async function stopScenarioDb(): Promise<void> {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
}

/**
 * Clear exactly what the seed helpers write (nothing else exists in a fresh
 * in-memory database), so one scenario can never leak data into the next.
 */
export async function resetScenarioDb(): Promise<void> {
  await Promise.all([
    Product.deleteMany({}).exec(),
    Customer.deleteMany({}).exec(),
    Offer.deleteMany({}).exec(),
    CampaignHistory.deleteMany({}).exec(),
    RestaurantModel.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers — the smallest real rows that make a dimension produce evidence
// ─────────────────────────────────────────────────────────────────────────────

export async function seedProduct(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Product.create({
    name: `Scenario Item ${seq}`,
    code: `SC-${seq}`,
    price: 200,
    category: 'Main Course',
    gstPercent: 5,
    availability: true,
    restaurantId,
    ...overrides,
  } as never);
}

export async function seedCustomer(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Customer.create({
    name: `Scenario Customer ${seq}`,
    phone: `9800000${String(seq).padStart(3, '0')}`,
    restaurantId,
    ...overrides,
  } as never);
}

export async function seedOffer(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Offer.create({
    title: `Scenario Offer ${seq}`,
    description: 'Scenario offer',
    type: 'percentage',
    value: 10,
    status: 'active',
    restaurantId,
    startDate: new Date(Date.now() - 5 * 86_400_000),
    endDate: new Date(Date.now() + 5 * 86_400_000),
    ...overrides,
  } as never);
}

export async function seedCampaignHistory(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return CampaignHistory.create({
    name: `Scenario Campaign ${seq}`,
    channel: 'whatsapp',
    // Real enum: 'pending' | 'sent' | 'failed' | 'partial'.
    status: 'sent',
    restaurantId,
    sentDate: new Date(Date.now() - 10 * 86_400_000),
    recipientCount: 100,
    redeemedCount: 5,
    campaignCost: 500,
    ...overrides,
  } as never);
}

export async function seedRestaurant(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return RestaurantModel.create({
    name: `Scenario Restaurant ${seq}`,
    restaurantId,
    ...overrides,
  } as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Running one scenario
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioOptions {
  /** Writes the rows this scenario needs, before the run. */
  seed?: () => Promise<void>;
  goal?: string;
  lookbackDays?: number;
  limit?: number;
  /** Deterministic path with the documented no-model fallbacks (default true). */
  disableLlm?: boolean;
  llm?: AnalyzeOptions['llm'];
  criticLlm?: AnalyzeOptions['criticLlm'];
  tenant?: { restaurantId: string; actorId?: string };
  requestId?: string;
}

export async function runScenario(opts: ScenarioOptions = {}): Promise<AnalyzeResponse> {
  if (opts.seed) await opts.seed();
  return runMarketingAnalyze({
    tenant: opts.tenant ?? TENANT_A,
    goal: opts.goal,
    lookbackDays: opts.lookbackDays,
    limit: opts.limit,
    requestId: opts.requestId ?? `scenario-${seq}`,
    disableLlm: opts.disableLlm ?? true,
    ...(opts.llm ? { llm: opts.llm } : {}),
    ...(opts.criticLlm ? { criticLlm: opts.criticLlm } : {}),
  });
}

/** Compact, assertion-friendly view of a run. Never a rewrite of it. */
export interface ScenarioDigest {
  status: AnalyzeResponse['status'];
  risk: AnalyzeResponse['risk'];
  confidence: number;
  /** domain → reported status, for the domains the run actually touched. */
  domains: Record<string, string>;
  unavailableDomains: IntelligenceDomain[];
  missingEvidence: string[];
  uncertainties: string[];
  contradictions: string[];
  facts: number;
  signals: number;
  recommendations: number;
  rejected: number;
  degradations: string;
  directionPolicyApplied: boolean;
  memoryEpisodeWritten: boolean;
}

export function digest(r: AnalyzeResponse): ScenarioDigest {
  const domains: Record<string, string> = {};
  for (const d of r.situation.investigatedDomains) domains[d.domain] = d.status;
  return {
    status: r.status,
    risk: r.risk,
    confidence: r.confidence,
    domains,
    unavailableDomains: r.situation.unavailableDomains,
    missingEvidence: r.situation.missingEvidence,
    uncertainties: r.situation.uncertainties,
    contradictions: r.situation.contradictions,
    facts: r.situation.confirmedFacts.length,
    signals: r.situation.topSignals.length,
    recommendations: r.recommendations.length,
    rejected: r.rejected.length,
    degradations: r.degradations.join(' | '),
    directionPolicyApplied: r.directionPolicy.applied,
    memoryEpisodeWritten: r.memoryWrite.episodeWritten,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared invariant assertions
// ─────────────────────────────────────────────────────────────────────────────

/** Declared-only capabilities must ALWAYS be disclosed in every run. */
export function declaredOnlyDomainNames(r: AnalyzeResponse): string[] {
  return r.situation.investigatedDomains.filter((d) => !d.implemented).map((d) => d.domain);
}

/** The full text a run used to explain itself — the disclosure surface. */
export function disclosureText(r: AnalyzeResponse): string {
  return [
    ...r.degradations,
    ...r.situation.missingEvidence,
    ...r.situation.uncertainties,
    ...r.situation.contradictions,
  ].join(' | ');
}
