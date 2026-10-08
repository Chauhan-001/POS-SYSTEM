/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * noCommittedSecrets.test.ts — regression guard for the 2026-10 credential
 * incident (commit b5de06b), where live JWT access/refresh tokens were swept
 * into the repo as ad-hoc audit probe artifacts.
 *
 * The guard does three bounded checks:
 *   1. The known credential artifacts do not exist on disk.
 *   2. No git-tracked path matches the audit-artifact naming pattern.
 *   3. No top-level file in `backend/` (the directory the incident wrote to)
 *      contains a JWT-shaped token or a raw accessToken/refreshToken pair.
 *
 * It deliberately does NOT scan the whole tree (slow, and node_modules/lock
 * files are irrelevant); it guards the exact failure mode that occurred.
 * Git is used when available but is not required for the test to run.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src/__tests__ -> backend
const backendRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(backendRoot, '..');

/** Ad-hoc audit probe artifacts that must never be tracked or on disk. */
const FORBIDDEN_ARTIFACT_PATTERNS = [
  /^backend\/audit-token\.txt$/,
  /^backend\/audit-login\.json$/,
  /^backend\/audit-intel(-exp|365)?\.json$/,
  /^backend\/audit-(rec|prop)\.json$/,
  /^backend\/audit-(mongo|usage|usage2)-probe\.ts$/,
];

/** A JWT has three base64url segments; the signature is what makes it live. */
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

function gitTrackedFiles(): string[] | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return null; // git unavailable in this environment — skip that layer
  }
}

describe('no committed credential artifacts', () => {
  const KNOWN_CREDENTIAL_ARTIFACTS = [
    'backend/audit-token.txt',
    'backend/audit-login.json',
    'backend/audit-intel.json',
    'backend/audit-intel-exp.json',
    'backend/audit-intel365.json',
    'backend/audit-rec.json',
    'backend/audit-prop.json',
    'backend/audit-mongo-probe.ts',
    'backend/audit-usage-probe.ts',
    'backend/audit-usage2.ts',
  ];

  it('the known credential artifacts are absent from the working tree', () => {
    const present = KNOWN_CREDENTIAL_ARTIFACTS.filter((p) => fs.existsSync(path.join(repoRoot, p)));
    expect(present).toEqual([]);
  });

  it('no git-tracked path matches an audit credential artifact name', () => {
    const tracked = gitTrackedFiles();
    if (tracked === null) return; // git not available — cannot evaluate this layer
    const offenders = tracked.filter((p) => FORBIDDEN_ARTIFACT_PATTERNS.some((re) => re.test(p)));
    expect(offenders).toEqual([]);
  });

  it('no top-level backend file contains a JWT or raw token pair', () => {
    const entries = fs.readdirSync(backendRoot, { withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(backendRoot, entry.name);
      // Bounded read: the incident artifacts were tiny JSON/txt files.
      let text: string;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 256 * 1024) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (JWT_RE.test(text)) {
        offenders.push(`${entry.name}: JWT-shaped token`);
        continue;
      }
      if (/"refreshToken"\s*:\s*"/.test(text) && /"accessToken"\s*:\s*"/.test(text)) {
        offenders.push(`${entry.name}: raw accessToken/refreshToken pair`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
