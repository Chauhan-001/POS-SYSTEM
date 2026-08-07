/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PrinterService — Real, tenant-scoped printer registry (Phase 1.9).
 *
 * Replaces the fake printer IPs previously hardcoded in the Settings UI.
 * Printers persist per restaurant (optionally scoped to branch/device).
 * Network printers support a real connectivity test (TCP connect to host:port);
 * USB/Bluetooth printers are health-marked as reachable-through-Electron since
 * the browser cannot probe them directly.
 */

import { AppError } from '../../../utils/AppError';
import Printer, { IPrinter } from '../models/Printer';
import { PrinterInput, PrinterTestResult } from '../types';
import AuditLog from '../../../models/AuditLog';
import net from 'net';

export interface PrinterActor {
  performedBy: string;
  performedById?: string;
  restaurantId: string;
  branchId?: string;
  ipAddress?: string;
}

const DEFAULT_PORT = 9100;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/** Return a valid Mongo ObjectId string, or null when the value is missing/invalid.
 *  The POS sends client-side branch identifiers (e.g. "branch_main") that are NOT
 *  ObjectIds; casting them into the ObjectId-typed Printer.branchId field throws a
 *  CastError, so invalid values are downgraded to null (restaurant-level scope). */
function cleanBranchId(v: unknown): string | null {
  return typeof v === 'string' && OBJECT_ID_RE.test(v) ? v : null;
}

async function writeAudit(actor: PrinterActor, action: string, entityId: string, details: Record<string, any>) {
  await AuditLog.create({
    action,
    entityType: 'Printer',
    entityId,
    performedBy: actor.performedBy,
    performedById: actor.performedById,
    restaurantId: actor.restaurantId,
    branchId: actor.branchId as any || null,
    ipAddress: actor.ipAddress,
    details,
  }).catch(() => { /* audit failure must never break printer writes */ });
}

/** Probe a network printer with a short TCP connect (raw ESC/POS port). */
function testNetworkConnection(host: string, port: number, timeoutMs = 2000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean, extra?: { latencyMs?: number; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok ? { ok: true, latencyMs: extra?.latencyMs } : { ok: false, error: extra?.error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, { latencyMs: Date.now() - started }));
    socket.once('timeout', () => finish(false, { error: `Connection timed out after ${timeoutMs}ms` }));
    socket.once('error', (err) => finish(false, { error: err.message }));
    socket.connect(port, host);
  });
}

export class PrinterService {
  /** List printers for a tenant, with optional branch/device/type filters. */
  async list(restaurantId: string, filter: { branchId?: string; deviceId?: string; type?: string; enabled?: boolean } = {}) {
    const query: Record<string, any> = { restaurantId, isDeleted: { $ne: true } };
    const branchId = cleanBranchId(filter.branchId);
    if (branchId) query.branchId = branchId;
    if (filter.deviceId) query.deviceId = filter.deviceId;
    if (filter.type) query.type = filter.type;
    if (filter.enabled !== undefined) query.enabled = filter.enabled;
    return Printer.find(query).sort({ isDefault: -1, name: 1 }).exec();
  }

  /** Get a single printer (tenant-scoped). */
  async getById(restaurantId: string, id: string) {
    const printer = await Printer.findOne({ _id: id, restaurantId }).exec();
    if (!printer) throw new AppError(404, 'Printer not found');
    return printer;
  }

  /** Create a printer. Enforces one default per tenant+branch scope. */
  async create(restaurantId: string, input: PrinterInput, actor: PrinterActor) {
    const { name, type, connection, branchId, deviceId, isDefault } = input;
    if (!name?.trim()) throw new AppError(400, 'Printer name is required');
    if (!connection?.kind) throw new AppError(400, 'Connection kind is required');

    if (connection.kind === 'network' && !connection.host) {
      throw new AppError(400, 'Network printers require a host (IP or hostname)');
    }

    const existing = await Printer.findOne({ restaurantId, name: name.trim() }).exec();
    if (existing) throw new AppError(409, `A printer named "${name.trim()}" already exists`);

    if (isDefault) {
      await this.clearDefault(restaurantId, branchId, deviceId);
    }

    const printer = await Printer.create({
      restaurantId,
      branchId: cleanBranchId(branchId),
      deviceId: deviceId || null,
      name: name.trim(),
      type,
      connection,
      paperSize: input.paperSize || '80mm',
      copies: input.copies ?? 1,
      margins: input.margins || {},
      encoding: input.encoding || 'UTF-8',
      receiptWidthChars: input.receiptWidthChars,
      isDefault: !!isDefault,
      enabled: input.enabled !== false,
    });

    await writeAudit(actor, 'PRINTER_CREATED', String(printer._id), {
      name: printer.name,
      type: printer.type,
      connection: printer.connection,
      isDefault: printer.isDefault,
    });
    return printer;
  }

  /** Update a printer (tenant-scoped). */
  async update(restaurantId: string, id: string, input: Partial<PrinterInput>, actor: PrinterActor) {
    const printer = await this.getById(restaurantId, id);

    if (input.name && input.name.trim() !== printer.name) {
      const clash = await Printer.findOne({ restaurantId, name: input.name.trim(), _id: { $ne: id } }).exec();
      if (clash) throw new AppError(409, `A printer named "${input.name.trim()}" already exists`);
    }
    if (input.connection?.kind === 'network' && !input.connection.host && !printer.connection.host) {
      throw new AppError(400, 'Network printers require a host (IP or hostname)');
    }
    if (input.isDefault) {
      await this.clearDefault(restaurantId, printer.branchId as any, printer.deviceId as any);
    }

    const update: Record<string, any> = { updatedAt: new Date() };
    if (input.name !== undefined) update.name = input.name.trim();
    if (input.type !== undefined) update.type = input.type;
    if (input.connection !== undefined) update.connection = { ...printer.connection, ...input.connection };
    if (input.paperSize !== undefined) update.paperSize = input.paperSize;
    if (input.copies !== undefined) update.copies = input.copies;
    if (input.margins !== undefined) update.margins = { ...printer.margins, ...input.margins };
    if (input.encoding !== undefined) update.encoding = input.encoding;
    if (input.receiptWidthChars !== undefined) update.receiptWidthChars = input.receiptWidthChars;
    if (input.isDefault !== undefined) update.isDefault = input.isDefault;
    if (input.enabled !== undefined) update.enabled = input.enabled;
    if (input.branchId !== undefined) update.branchId = cleanBranchId(input.branchId);
    if (input.deviceId !== undefined) update.deviceId = input.deviceId || null;

    const updated = await Printer.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!updated) throw new AppError(404, 'Printer not found');

    await writeAudit(actor, 'PRINTER_UPDATED', id, {
      name: updated.name,
      changed: Object.keys(update).filter((k) => k !== 'updatedAt'),
    });
    return updated;
  }

  /** Soft-delete a printer. */
  async remove(restaurantId: string, id: string, actor: PrinterActor) {
    const printer = await this.getById(restaurantId, id);
    await Printer.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date(), enabled: false } }).exec();
    await writeAudit(actor, 'PRINTER_DELETED', id, { name: printer.name, type: printer.type });
    return { ok: true, id };
  }

  /**
   * Test a printer. Network printers are probed with a real TCP connect;
   * USB/Bluetooth printers are reported as reachable via the Electron host
   * (marked 'unknown' — the terminal confirms on next print job).
   */
  async test(restaurantId: string, id: string, actor: PrinterActor): Promise<PrinterTestResult> {
    const printer = await this.getById(restaurantId, id);

    let health: IPrinter['healthStatus'] = 'unknown';
    let message = '';
    let latencyMs: number | undefined;
    let ok = false;

    if (printer.connection.kind === 'network' && printer.connection.host) {
      const port = printer.connection.port || DEFAULT_PORT;
      const result = await testNetworkConnection(printer.connection.host, port);
      health = result.ok ? 'online' : 'offline';
      ok = result.ok;
      latencyMs = result.latencyMs;
      message = result.ok
        ? `Connected to ${printer.connection.host}:${port} (${latencyMs}ms)`
        : `Cannot reach ${printer.connection.host}:${port} — ${result.error || 'connection failed'}`;
    } else {
      message = `${printer.type === 'bluetooth' ? 'Bluetooth' : 'USB'} printer — connection confirmed by the POS terminal on next print job`;
    }

    await Printer.findByIdAndUpdate(id, {
      $set: {
        healthStatus: health,
        lastTestedAt: new Date(),
        lastError: ok ? null : message,
      },
    }).exec();

    await writeAudit(actor, 'PRINTER_TESTED', id, {
      name: printer.name,
      healthStatus: health,
      latencyMs,
      message,
    });

    return {
      id,
      name: printer.name,
      healthStatus: health,
      ok,
      message,
      latencyMs,
      testedAt: new Date().toISOString(),
    };
  }

  private async clearDefault(restaurantId: string, branchId?: any, deviceId?: any) {
    const filter: Record<string, any> = { restaurantId, isDefault: true };
    const clean = cleanBranchId(branchId);
    if (clean) filter.branchId = clean;
    if (deviceId) filter.deviceId = deviceId;
    await Printer.updateMany(filter, { $set: { isDefault: false } }).exec();
  }
}

export const printerService = new PrinterService();
