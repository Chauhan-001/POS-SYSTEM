/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * auditContextMiddleware.ts — Seeds request-scoped audit context.
 *
 * Mounted before routes (immediately before the request logger) so every
 * handler can rely on requestId/correlationId + the live req reference being
 * available inside the AsyncLocalStorage store.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { withAuditStore, requestIp } from './auditContext';

export function auditContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  const headerCorrelation = req.headers['x-correlation-id'];
  const correlationId =
    (typeof headerCorrelation === 'string' && headerCorrelation.length > 0 ? headerCorrelation : undefined) ||
    requestId;

  const ua = (req.headers['user-agent'] as string) || undefined;

  withAuditStore(
    {
      requestId,
      correlationId,
      ip: requestIp(req),
      userAgent: ua,
      method: req.method,
      path: req.originalUrl || req.path,
      req,
    },
    () => next(),
  );
}