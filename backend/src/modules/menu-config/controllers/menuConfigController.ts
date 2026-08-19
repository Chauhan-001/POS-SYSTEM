/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * menuConfigController — HTTP surface for the reusable Menu Configuration
 * module. Tenant is ALWAYS derived from the authenticated user
 * (req.user.restaurantId) — never from the request body/query.
 */

import { NextFunction, Request, Response } from 'express';
import * as templateService from '../services/templateService';
import * as productConfigService from '../services/productConfigService';
import { resolveProductConfiguration, summarizeConfigurations } from '../services/configurationResolver';
import { validateProductConfigurationSelection } from '../services/configurationValidator';
import { buildCatalog } from '../services/catalogService';
import { ConfigType } from '../constants';

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function userOf(req: Request): { restaurantId: string; name?: string; branchId?: string } {
  const u = (req as any).user as { restaurantId?: string; name?: string; branchId?: string } | undefined;
  return (u || {}) as { restaurantId: string; name?: string; branchId?: string };
}

function ok(res: Response, data: unknown): void {
  res.json({ data });
}

// ─── Templates ────────────────────────────────────────────────────

export const listTemplates = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await templateService.list(restaurantId, req.query as any));
});

export const getTemplate = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await templateService.getById(restaurantId, req.params.id));
});

export const createTemplate = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  const template = await templateService.create(restaurantId, req.body, { name });
  res.status(201).json({ data: template });
});

export const updateTemplate = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await templateService.update(restaurantId, req.params.id, req.body, { name }));
});

export const archiveTemplate = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await templateService.archive(restaurantId, req.params.id, { name }));
});

export const copyTemplate = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await templateService.copy(restaurantId, req.params.id, req.body ?? {}, { name }));
});

export const templateUsage = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await templateService.usage(restaurantId, req.params.id));
});

// ─── Product configuration relationship ───────────────────────────

export const attachConfiguration = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  const { type, ...refInput } = req.body as { type: ConfigType } & Record<string, unknown>;
  const ref = await productConfigService.attachConfiguration(
    restaurantId,
    req.params.productId,
    type,
    refInput as any,
    { name }
  );
  res.status(201).json({ data: ref });
});

export const updateConfiguration = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await productConfigService.updateConfiguration(
    restaurantId,
    req.params.productId,
    req.params.refId,
    req.body,
    { name }
  ));
});

export const detachConfiguration = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await productConfigService.detachConfiguration(
    restaurantId,
    req.params.productId,
    req.params.refId,
    { name }
  ));
});

export const resetOverrides = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await productConfigService.resetOverrides(
    restaurantId,
    req.params.productId,
    req.params.refId,
    { name }
  ));
});

// ─── Resolution + validation ──────────────────────────────────────

export const resolveProduct = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const includeArchived = req.query.includeArchived === 'true';
  ok(res, await resolveProductConfiguration(restaurantId, req.params.productId, { includeArchived }));
});

export const validateSelection = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const resolved = await resolveProductConfiguration(restaurantId, req.body.productId);
  ok(res, validateProductConfigurationSelection(resolved, req.body.selection));
});

export const summarizeProducts = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await summarizeConfigurations(restaurantId, req.body.productIds));
});

export const getCatalog = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await buildCatalog(restaurantId));
});
