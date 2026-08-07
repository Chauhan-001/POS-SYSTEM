/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validation Middleware — Validates request body, query, and params
 * against strict Zod schemas. Rejects with 400 + detailed errors
 * on any mismatch. Does NOT sanitize — it rejects.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues: { path: (string | number | symbol)[]; message: string; code: string }[] = (error as any).issues ?? [];
        res.status(400).json({
          error: 'Validation failed',
          details: issues.map(e => ({
            path: e.path.map(p => String(p)).join('.'),
            message: e.message,
            code: e.code,
          })),
        });
        return;
      }
      next(error);
    }
  };
}
