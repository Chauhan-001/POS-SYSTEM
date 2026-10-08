/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * verify-llm-keys.ts — audit (and optionally prune) the LLM key pool.
 *
 * A configured fallback pool rots quietly: providers rotate or revoke keys and
 * every request then spends its failover attempts on dead credentials, which is
 * how an AI investigation ends up degraded (or reported as "not enough data")
 * while a working key was never reached. The runtime now quarantines rejected
 * keys as it meets them and the server reports pool health at startup; this
 * script is the deliberate, repeatable counterpart an operator runs:
 *
 *   npm run verify:llm-keys            # report only (safe, no writes)
 *   npm run verify:llm-keys -- --prune # rewrite .env to the keys that work
 *
 * Two guarantees:
 *   1. Key material is NEVER printed. Output carries counts, 1-based slots and
 *      short SHA-256 fingerprints, which is enough to tell two .env lines apart.
 *   2. `--prune` refuses to write when nothing authenticates, so a provider
 *      outage can never empty a working configuration.
 *
 * The probe is a token-free `GET {baseUrl}/models`: no completion quota is spent.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../src/config';
import { checkLlmKeyPoolHealth, keyFingerprint, type LlmKeyHealthReport } from '../src/ai/shared/llmClient';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const POOL_LINES = ['AI_API_KEY', 'AI_API_KEY_FALLBACK', 'AI_API_KEY_FALLBACKS'] as const;

function printReport(report: LlmKeyHealthReport): void {
  console.log('LLM key-pool health');
  console.log(`  provider:     ${report.provider}`);
  console.log(`  checked at:   ${report.checkedAt}`);
  if (report.skippedReason) {
    console.log(`  skipped:      ${report.skippedReason}`);
    return;
  }
  console.log(`  total keys:   ${report.totalKeys}`);
  console.log(`  authenticate: ${report.validKeys + report.rateLimitedKeys}  (${report.validKeys} ok, ${report.rateLimitedKeys} throttled)`);
  console.log(`  rejected:     ${report.deadKeys}${report.deadSlots.length ? ` (slots ${report.deadSlots.join(', ')})` : ''}`);
  console.log(`  unknown:      ${report.unreachableKeys}`);
  if (report.validFingerprints.length) console.log(`  working:      ${report.validFingerprints.join(', ')}`);
  if (report.deadFingerprints.length) console.log(`  dead:         ${report.deadFingerprints.join(', ')}`);
  if (report.allDead) console.log('  ⚠ EVERY configured key was rejected — AI features will degrade.');
}

/** Read the pool exactly the way `config.ai` builds it (order preserved). */
function configuredPool(): string[] {
  const primary = (process.env.AI_API_KEY || '').trim();
  const single = (process.env.AI_API_KEY_FALLBACK || '').trim();
  const list = (process.env.AI_API_KEY_FALLBACKS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return [primary, single, ...list].filter((k, i, all) => !!k && all.indexOf(k) === i);
}

/**
 * Rewrite ONLY the three pool lines, keeping every other line byte-identical.
 * Returns the number of keys kept, or null when nothing was written.
 */
function pruneEnvFile(kept: string[]): number | null {
  if (kept.length === 0) return null;
  const original = fs.readFileSync(ENV_PATH, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const values = [kept[0] ?? '', kept[1] ?? '', kept.slice(2).join(',')];

  POOL_LINES.forEach((name, i) => {
    const idx = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (idx === -1) {
      lines.push(`${name}=${values[i]}`);
      return;
    }
    lines[idx] = `${name}=${values[i]}`;
  });

  fs.writeFileSync(ENV_PATH, lines.join(eol), 'utf8');
  return kept.length;
}

async function main(): Promise<void> {
  const shouldPrune = process.argv.includes('--prune');
  const report = await checkLlmKeyPoolHealth({ quarantineDead: false });
  printReport(report);

  if (report.skippedReason) {
    console.log('\nNothing to prune: this provider has no token-free probe endpoint.');
    if (report.allDead) process.exitCode = 1;
    return;
  }

  if (!shouldPrune) {
    if (report.deadKeys > 0) {
      console.log(`\n${report.deadKeys} key(s) no longer authenticate. Re-run with --prune to remove them from .env.`);
    }
    if (report.allDead) process.exitCode = 1;
    return;
  }

  const pool = configuredPool();
  const dead = new Set(report.deadFingerprints.map((label) => label.split(':')[1]));
  const kept = pool.filter((key) => !dead.has(keyFingerprint(key)));

  if (kept.length === pool.length) {
    console.log('\nnothing to prune — every configured key still works.');
    return;
  }
  if (kept.length === 0) {
    console.log('\nrefusing to prune: no configured key authenticates. Replace the keys by hand.');
    process.exitCode = 1;
    return;
  }

  const written = pruneEnvFile(kept);
  if (written === null) {
    console.log('\nrefusing to prune: no configured key authenticates.');
    process.exitCode = 1;
    return;
  }
  console.log(`\npruned ${ENV_PATH}: pool ${pool.length} → ${kept.length} key(s).`);
  console.log('Restart the backend so the new pool is loaded.');
}

void main().catch((err) => {
  console.error('verify-llm-keys failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
