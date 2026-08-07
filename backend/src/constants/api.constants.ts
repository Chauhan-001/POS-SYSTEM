/**
 * ============================================================================
 * MODULE: Backend API Constants
 * ============================================================================
 * Purpose: Centralizes HTTP status codes, error messages, token expiry values,
 * and database seed defaults for the Express API service.
 * ============================================================================
 */

export const API_CONSTANTS = {
  DEFAULT_PORT: 3002,
  JWT_EXPIRATION: '24h',
  SALT_ROUNDS: 10,

  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
  },

  MESSAGES: {
    INVALID_CREDENTIALS: 'Invalid userId or password',
    UNAUTHORIZED_ACCESS: 'Unauthorized access',
    SERVER_ERROR: 'Internal server error',
  },
} as const;
