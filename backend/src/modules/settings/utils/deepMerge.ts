/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deep-merge helper for settings priority resolution.
 * Plain objects merge recursively; arrays and primitives are replaced
 * by the higher-priority scope (device > branch > restaurant).
 */

export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, any>>(
  base: T,
  override: Partial<T>
): T {
  if (!override) return base;
  const out: Record<string, any> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    const bv = base[key];
    if (isPlainObject(ov) && isPlainObject(bv)) {
      out[key] = deepMerge(bv, ov);
    } else {
      out[key] = ov;
    }
  }
  return out as T;
}
