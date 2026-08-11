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
}).strict().refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const generateCredentialsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(40),
  role: z.enum(['Owner', 'Manager', 'Cashier']).default('Cashier'),
  avoid: z.array(z.string()).optional(),
}).strict();
