import { z } from 'zod';

/** Small data URL only: png, jpeg or webp. The app shrinks photos to about 256px, so real ones are far below the cap. */
export const AVATAR_MAX_CHARS = 400_000;
const avatarSchema = z
  .string()
  .max(AVATAR_MAX_CHARS)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG, JPEG or WebP image');

export const preferencesSchema = z
  .object({
    emailAlerts: z.boolean(),
    scoringDone: z.boolean(),
    weeklyDigest: z.boolean(),
    autoOpenResults: z.boolean(),
    reduceMotion: z.boolean(),
    language: z.string().trim().max(12),
    timeZone: z.string().trim().max(64),
    theme: z.enum(['dark', 'light']),
    density: z.enum(['comfortable', 'compact']),
    sidebarCollapsed: z.boolean(),
    blindMode: z.boolean(),
  })
  .partial()
  .strict();

export const profilePatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    avatar: avatarSchema.nullable(),
    preferences: preferencesSchema,
  })
  .partial()
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
