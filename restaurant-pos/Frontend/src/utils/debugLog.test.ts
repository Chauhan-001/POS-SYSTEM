/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the debugLog utility — verifies that debugWarn only logs in dev mode
 * and is silent in production mode. Uses vi.resetModules() and vi.stubEnv() to
 * safely control the environment without ESM module caching side effects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('debugWarn', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should call console.warn in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { debugWarn } = await import('./debugLog');

    debugWarn('TestContext', 'test message', { detail: 42 });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[TestContext]', 'test message', { detail: 42 });
  });

  it('should NOT call console.warn in production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { debugWarn } = await import('./debugLog');

    debugWarn('TestContext', 'this should be silent');

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('should export IS_DEV as false when in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { IS_DEV } = await import('./debugLog');

    expect(IS_DEV).toBe(false);
  });

  it('should export IS_DEV as true when in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { IS_DEV } = await import('./debugLog');

    expect(IS_DEV).toBe(true);
  });

  it('should handle no additional arguments gracefully', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { debugWarn } = await import('./debugLog');

    debugWarn('JustContext');

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[JustContext]');
  });

  it('should handle multiple arguments of different types', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { debugWarn } = await import('./debugLog');

    debugWarn('Multi', 1, 'two', true, null, undefined, { nested: { a: 1 } });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[Multi]', 1, 'two', true, null, undefined, { nested: { a: 1 } }
    );
  });
});
