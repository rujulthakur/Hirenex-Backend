import { z } from 'zod';
import { ROLES } from './enums';
import { objectIdSchema } from './common';

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

export const sendOtpSchema = z.object({ email: emailField }).strict();
export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const verifyOtpSchema = z
  .object({
    email: emailField,
    code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
  })
  .strict();
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const googleAuthSchema = z.object({ idToken: z.string().trim().min(20).max(4096) }).strict();
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

/** The user object that sits on req.user and is returned by /auth/me and the login endpoints. */
export const authUserSchema = z.object({
  id: objectIdSchema,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(ROLES),
  isDemo: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Claims inside the access JWT (sub = user id). */
export const accessClaimsSchema = z.object({
  sub: objectIdSchema,
  role: z.enum(ROLES),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

/** Claims inside the refresh JWT (sub = user id, fam = rotation family). */
export const refreshClaimsSchema = z.object({
  sub: objectIdSchema,
  fam: z.string().min(8),
  jti: z.string().min(8),
});
export type RefreshClaims = z.infer<typeof refreshClaimsSchema>;
