/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentPolicy.test.ts — the policy is the permission boundary:
 * exact existing tool names only, resolved through the ONE shared registry,
 * FAIL-CLOSED on anything unknown, read-only tools only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ai } from '../../index';
import {
  MARKETING_AGENT_ALLOWED_TOOLS,
  marketingAgentPolicy,
  marketingAgentToolCatalog,
  resolveMarketingAgentTools,
} from '../policies/marketingAgentPolicy';
import { resolveAllowedTools } from '../../tools/registry/toolResolver';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import type { AiError } from '../../shared/aiErrors';

beforeAll(() => {
  ai.bootstrap();
});

describe('marketing agent policy', () => {
  it('resolves every allowed tool from the ONE shared registry (22 tools, read-only)', () => {
    const tools = resolveMarketingAgentTools();
    expect(tools).toHaveLength(MARKETING_AGENT_ALLOWED_TOOLS.length);
    // 21 Phase-1 tools + Phase 4's getPromotionCandidates (a read-only bridge
    // to the EXISTING promotion-candidate engine — no second engine).
    expect(MARKETING_AGENT_ALLOWED_TOOLS.length).toBe(22);
    for (const t of tools) {
      expect(toolRegistry.has(t.name)).toBe(true);
      expect(t.access).toBe('read');
    }
    expect(tools.map((t) => t.name).sort()).toEqual([...MARKETING_AGENT_ALLOWED_TOOLS].sort());
  });

  it('FAILS CLOSED on an unknown tool name instead of shrinking the allow-list', () => {
    let caught: AiError | undefined;
    try {
      resolveAllowedTools([...MARKETING_AGENT_ALLOWED_TOOLS, 'getNonexistentTool']);
    } catch (err) {
      caught = err as AiError;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe('TOOL_NOT_FOUND');
    expect(String(caught?.message)).toContain('getNonexistentTool');
  });

  it('does not include inventory-agent-only or write tools (no blind connections)', () => {
    expect(MARKETING_AGENT_ALLOWED_TOOLS).not.toContain('getWastage'); // inventory agent scope (spec list omits it)
    const tools = resolveMarketingAgentTools();
    expect(tools.every((t) => t.access === 'read')).toBe(true);
  });

  it('exposes a prompt catalog with a description for every allowed tool', () => {
    const catalog = marketingAgentToolCatalog();
    expect(catalog).toHaveLength(MARKETING_AGENT_ALLOWED_TOOLS.length);
    for (const entry of catalog) {
      expect(entry.name).toBeTruthy();
      expect(entry.description.length).toBeGreaterThan(10);
      expect(['sales', 'inventory', 'customers', 'products', 'marketing', 'ml', 'restaurant', 'context']).toContain(entry.category);
    }
  });

  it('policy object references names only (never tool definitions)', () => {
    expect(marketingAgentPolicy.agent).toBe('marketing_agent');
    expect(Array.isArray(marketingAgentPolicy.allowedTools)).toBe(true);
    expect(marketingAgentPolicy.allowedTools.every((n) => typeof n === 'string')).toBe(true);
  });
});
