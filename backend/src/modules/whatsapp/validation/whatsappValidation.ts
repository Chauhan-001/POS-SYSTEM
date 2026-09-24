import { z } from 'zod';

export const restaurantIdSchema = z.object({
  restaurantId: z.string().min(1, 'restaurantId is required'),
});

export const sendTestSchema = z.object({
  to: z.string().min(7, 'Valid phone number is required'),
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
});

export const changeNumberSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
});
