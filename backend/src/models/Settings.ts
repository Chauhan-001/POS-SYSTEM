/**
 * =============================================================================
 *  Settings.ts — Platform Settings Model (MongoDB Persisted)
 * =============================================================================
 *
 * Purpose:
 *   Stores all platform-wide settings in a single document per section.
 *   Each document has a unique `key` (company, subscription, ai, general)
 *   and a `value` object containing the settings data.
 *
 * Usage:
 *   await Settings.findOne({ key: 'company' }).exec();
 *   // Returns { key: 'company', value: { name: '...', email: '...' }, updatedAt: ... }
 *
 * Sections:
 *   company    → { name, email, phone, address, logo? }
 *   subscription → { plan, maxDevices, aiEnabled, trialDays }
 *   ai         → { enabled, maxRequestsPerDay, model, apiKey? }
 *   general    → { allowRegistration, maintenanceMode, timezone, language }
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  key: string;
  value: Record<string, any>;
  updatedAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export default mongoose.model<ISettings>('Settings', SettingsSchema);

// ─── Default values ─────────────────────────────────────────────

export const DEFAULT_COMPANY = {
  name: 'POS Admin',
  email: 'admin@possystem.com',
  phone: '+1-555-000-0000',
  address: '123 Admin St, New York, NY 10001',
};

export const DEFAULT_SUBSCRIPTION = {
  plan: 'basic',
  maxDevices: 6,
  aiEnabled: true,
  trialDays: 14,
};

export const DEFAULT_AI = {
  enabled: true,
  maxRequestsPerDay: 1000,
  model: 'llama-3.3-70b-versatile',
};

export const DEFAULT_GENERAL = {
  allowRegistration: true,
  maintenanceMode: false,
  timezone: 'UTC',
  language: 'en',
};
