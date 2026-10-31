import { z } from 'zod';
import { ROLES } from './enums';
import { objectIdSchema } from './common';

export const userSchema = z.object({
  id: objectIdSchema,
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(120),
  role: z.enum(ROLES),
  googleSub: z.string().optional(),
  lastLoginAt: z.string().datetime().optional(),
  isDemo: z.boolean(),
});
export type UserDto = z.infer<typeof userSchema>;

export const refreshTokenSchema = z.object({
  userId: objectIdSchema,
  tokenHash: z.string().length(64),
  family: z.string().min(8),
  expiresAt: z.date(),
  replacedBy: z.string().length(64).optional(),
  revokedAt: z.date().optional(),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
