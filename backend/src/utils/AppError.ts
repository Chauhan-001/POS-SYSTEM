/**
 * =============================================================================
 *  AppError.ts — Custom Error Class for Known Application Errors
 * =============================================================================
 *
 * Purpose:
 *   Standardized error class for expected/known errors.
 *   Carries both a message and an HTTP status code.
 *   Error handler middleware differentiates AppError from unexpected errors.
 *
 * Usage:
 *   throw new AppError(404, 'Customer not found');
 *   throw new AppError(400, 'Invalid phone number format');
 *
 * The global errorHandler in middleware/errorHandler.ts reads statusCode
 * to set HTTP response status, vs. returning 500 for unknown errors.
 */

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
