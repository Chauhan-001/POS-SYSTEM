import { z } from 'zod';
import { phone } from './common';

export const loginSchema = z.object({
  restaurantId: z.string().min(1).max(50).transform(v => v.trim().toUpperCase()).optional(),
  phone: phone.optional(),
  username: z.string().min(1).max(100).optional(),
  password: z.string().min(1, 'Password is required').max(100),
  mode: z.enum(['password', 'pin', 'role_pin']).optional().default('pin'),
  rememberMe: z.boolean().optional().default(false),
  // Server-attributed context (IP + User-Agent) for session/login-history.
  ipAddress: z.string().max(64).optional(),
  userAgent: z.string().max(400).optional(),
  deviceInfo: z.object({
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),
    os: z.string().optional(),
    osVersion: z.string().optional(),
    appVersion: z.string().optional(),
  }).optional().default({}),
}).refine((data) => {
  return (data.restaurantId && data.phone) || data.username;
}, { message: 'Either restaurantId+phone or username must be provided', path: ['username'] });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
  // Device identity so token refresh can reject blocked devices.
  deviceId: z.string().optional(),
}).strict();

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
  allDevices: z.boolean().optional().default(false),
}).strict();

export const adminLoginSchema = z.object({
  userId: z.string().min(1, 'User ID is required').max(100),
  password: z.string().min(1, 'Password is required').max(100),
  rememberMe: z.boolean().optional().default(false),
}).strict();

export const ownerRegistrationSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  phone: phone,
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  confirmPassword: z.string(),
  restaurantName: z.string().min(2, 'Restaurant name must be at least 2 characters').max(200),
  // Owner-chosen login (falls back to phone when omitted — legacy clients).
  userId: z.string().min(3, 'User ID must be at least 3 characters').max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'User ID can only contain letters, numbers and underscores')
    .optional(),
  // Paid onboarding: presence of planId requires payment proof (order + payment).
  planId: z.string().min(1).max(50).optional(),
  paymentOrderId: z.string().min(1).max(64).optional(),
  paymentId: z.string().min(1).max(64).optional(),
  paymentSignature: z.string().min(1).max(256).optional(),
}).strict().refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
}).refine((data) => {
  // A paid plan must come with payment proof; a trial never needs one.
  if (data.planId) return !!(data.paymentOrderId && data.paymentId);
  return true;
}, {
  message: 'Payment proof (orderId + paymentId) is required when selecting a paid plan',
  path: ['paymentOrderId'],
});

/** Public pre-registration payment order (plan purchase before account creation). */
export const registerOrderSchema = z.object({
  planId: z.string().min(1).max(50).optional(),
  billingPeriod: z.enum(['monthly', 'yearly']).optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
}).strict();

export const generateCredentialsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(40),
  role: z.enum(['Owner', 'Manager', 'Cashier']).default('Cashier'),
  avoid: z.array(z.string()).optional(),
}).strict();
