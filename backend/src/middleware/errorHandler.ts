/**
 * =============================================================================
 *  errorHandler.ts — Global Express Error Handler
 * =============================================================================
 *
 * Purpose:
 *   Catches all unhandled errors and returns structured JSON responses.
 *   Differentiates between AppError (expected, known errors) and
 *   unexpected errors (logs full stack trace, returns generic 500).
 *
 * Phase 2.1 hardening:
 *   - Mongo duplicate-key (E11000) → 409 with a safe, sanitized message.
 *   - Mongo CastError / validation → 400.
 *   - validation errors from a schema.parse in a controller → 400.
 *   - Plain Error in production → generic 500 (no internal leakage);
 *     in development the message is revealed to aid debugging.
 *   - Every 5xx is logged to the request audit channel via console.error.
 *
 * Usage:
 *   // In server.ts (must be registered AFTER all routes):
 *   app.use(errorHandler);
 *
 *   // In controllers/services, throw known errors:
 *   throw new AppError(404, 'Customer not found');
 *
 * Middleware Registration:
 *   Must be the LAST middleware in the Express chain.
 *   Only catches errors passed via next(err) or thrown in async handlers.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

interface MongoErrorLike {
  code?: number;
  message?: string;
  errors?: Record<string, unknown>;
}

/** Detect a MongoDB duplicate-key error (code 11000). */
function isDuplicateKey(err: MongoErrorLike): boolean {
  return err?.code === 11000;
}

/** Detect a MongoDB validation error. */
function isMongoValidationError(err: MongoErrorLike): boolean {
  return Boolean(err?.errors && typeof err.errors === 'object');
}

/** Extract a safe description from a duplicate-key error (never leaks values). */
function duplicateKeyMessage(err: MongoErrorLike): string {
  // e.g. "dup key: { restaurantId: ..., clientRef: ... }" → "restaurantId, clientRef"
  const match = /E11000 duplicate key error[^{]*\{([^}]*)\}/.exec(typeof err.message === 'string' ? err.message : '');
  const fields = match
    ? match[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).join(', ')
    : 'a unique field';
  return `A record with the same ${fields || 'unique value'} already exists`;
}

const isProd = () => process.env.NODE_ENV === 'production';

export function errorHandler(
  err: Error & Partial<MongoErrorLike>,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ─── Known application error ───────────────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // ─── Multer upload errors → 400 with a readable message ────────
  if ((err as any)?.name === 'MulterError') {
    const multerErr = err as any;
    const message = multerErr.code === 'LIMIT_FILE_SIZE'
      ? 'File exceeds the maximum allowed upload size'
      : multerErr.code === 'LIMIT_FILE_COUNT'
        ? 'Only one file may be uploaded at a time'
        : `Upload failed: ${multerErr.message || 'invalid upload request'}`;
    res.status(400).json({ error: message, code: multerErr.code });
    return;
  }

  // ─── Mongo duplicate key (11000) → 409 Conflict ────────────────
  if (isDuplicateKey(err)) {
    const message = duplicateKeyMessage(err);
    console.error('[DuplicateKey]', message);
    res.status(409).json({ error: message });
    return;
  }

  // ─── Mongo validation error → 400 ──────────────────────────────
  if (isMongoValidationError(err)) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION' });
    return;
  }

  // ─── Unexpected error ──────────────────────────────────────────
  console.error('[UnhandledError]', err);

  // In production, never leak the raw error message — return a safe generic.
  if (isProd()) {
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
}