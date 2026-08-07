/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * settings module barrel — centralized POS configuration (Phase 1.9).
 */

export { default as RestaurantSettings, IRestaurantSettings, SettingsScope } from './models/RestaurantSettings';
export { default as Printer, IPrinter, PrinterType } from './models/Printer';
export { settingsService, SettingsService } from './services/settingsService';
export { printerService, PrinterService } from './services/printerService';
export { settingsController } from './controllers/settingsController';
export { printerController } from './controllers/printerController';
export { default as settingsRouter } from './routes/settings';
export * from './types';
export { deepMerge } from './utils/deepMerge';
