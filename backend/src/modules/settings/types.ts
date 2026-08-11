/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * settings module types (Phase 1.9) — centralized POS configuration.
 */

import type { SettingsScope } from './models/RestaurantSettings';

export interface SettingsPatchInput {
  scope: SettingsScope;
  branchId?: string;
  deviceId?: string;
  settings: Record<string, any>;
  /** Optimistic concurrency — server rejects with 409 when it differs. */
  baseVersion?: number;
  changeReason?: string;
}

export interface SettingsRollbackInput {
  scope: SettingsScope;
  branchId?: string;
  deviceId?: string;
  toVersion: number;
  changeReason?: string;
}

export interface EffectiveSettingsResult {
  settings: Record<string, any>;
  /** Public store token embedded in the loyalty QR (minted lazily; read-only). */
  publicToken?: string;
  meta: {
    version: number;
    scope: SettingsScope;
    branchId?: string | null;
    deviceId?: string | null;
    updatedAt?: Date | null;
    updatedBy?: string | null;
  };
  /** Per-scope settingsVersion — client uses the target scope's version as baseVersion. */
  versions?: {
    restaurant: number;
    branch: number;
    device: number;
  };
}

export interface PrinterInput {
  name: string;
  type: 'kitchen' | 'receipt' | 'bar' | 'dessert' | 'kds' | 'network' | 'usb' | 'bluetooth';
  connection: {
    kind: 'network' | 'usb' | 'bluetooth';
    host?: string;
    port?: number;
    address?: string;
  };
  paperSize?: '58mm' | '80mm';
  copies?: number;
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  encoding?: string;
  receiptWidthChars?: number;
  isDefault?: boolean;
  enabled?: boolean;
  branchId?: string;
  deviceId?: string;
}

export interface PrinterTestResult {
  id: string;
  name: string;
  healthStatus: 'unknown' | 'online' | 'offline' | 'error';
  ok: boolean;
  message: string;
  latencyMs?: number;
  testedAt: string;
}
