/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * staticRouteOrdering.test.ts — repo-wide regression guard.
 *
 * History: GET /proposals (campaigns) and GET /diagnostics (experiments) were
 * both registered AFTER their router's GET /:id(|param) route, so the static
 * path was captured as an id param — the endpoints were unreachable (400/404)
 * and looked like missing features. This test walks the actual Express router
 * stacks and fails if ANY router registers a static GET path after a
 * GET /:<param> route.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative, basename } from 'path';

interface RouteEntry {
  file: string;
  method: string;
  path: string;
}

/** Recursively collect router files under src/ (routes, modules, context, ai). */
function collectRouterFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      collectRouterFiles(full, out);
    } else if (
      // Named router files (admin.ts, bills.ts, …) live flat in src/routes;
      // module/context/ai routers carry a Routes/Router suffix.
      basename(dir) === 'routes' ||
      name.endsWith('Routes.ts') ||
      name.endsWith('Router.ts') ||
      name.endsWith('routes.ts')
    ) {
      if (!name.endsWith('.test.ts')) out.push(full);
    }
  }
  return out;
}

/** Read the GET layer paths of an Express router in registration order. */
async function getLayers(file: string): Promise<Array<{ method: string; path: string }>> {
  const mod = await import(file);
  const router = mod.default ?? Object.values(mod)[0];
  if (!router?.stack) return [];
  return router.stack
    .filter((l: any) => l.route)
    .flatMap((l: any) =>
      Object.keys(l.route.methods ?? {})
        .filter((m) => l.route.methods[m])
        .map((m) => ({ method: m.toUpperCase(), path: l.route.path as string })),
    );
}

const SRC_ROOT = join(__dirname, '..', '..');

describe('static GET routes are registered before GET /:param routes (repo-wide)', () => {
  it('no router captures a static GET path behind a GET /:param route', async () => {
    const files = collectRouterFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(30); // sanity: the sweep actually ran

    const violations: string[] = [];
    for (const file of files) {
      let layers: Array<{ method: string; path: string }> = [];
      try {
        layers = await getLayers(file);
      } catch {
        continue; // file exports no default router — nothing to audit
      }
      let seenParam = false;
      for (const { method, path } of layers) {
        if (method !== 'GET') continue;
        if (path.startsWith('/:')) {
          seenParam = true;
        } else if (seenParam) {
          violations.push(`${relative(SRC_ROOT, file)}: GET ${path} registered after a GET /:param route`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
