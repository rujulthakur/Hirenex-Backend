import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'MongoDB connection string is required'),
  REDIS_URL: z.string().min(1, 'Redis connection string is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CORS_ORIGINS: z
    .string()
    .min(1, 'at least one allowed origin is required')
    .transform(csv)
    .refine((list) => list.length > 0, 'at least one allowed origin is required'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  LLM_PROVIDER: z.enum(['gemini', 'groq']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  INTERVIEWER_EMAILS: z
    .string()
    .optional()
    .transform((v) => csv(v ?? '').map((e) => e.toLowerCase())),
  DEMO_MODE: booleanString,
  APP_BASE_URL: z.string().url(),
  PORTAL_BASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export type EnvParseResult =
  | { ok: true; env: Env }
  | { ok: false; problems: string[] };

/** Pure parser (testable). Empty strings are treated as "not set". */
export function parseEnv(source: NodeJS.ProcessEnv): EnvParseResult {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    cleaned[key] = value === '' ? undefined : value;
  }
  const result = envSchema.safeParse(cleaned);
  if (result.success) return { ok: true, env: result.data };
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `${name}: ${issue.message}`;
  });
  return { ok: false, problems };
}

function loadEnv(): Env {
  const parsed = parseEnv(process.env);
  if (parsed.ok) return parsed.env;
  // The logger depends on env, so use stderr directly here.
  const lines = [
    '',
    'Startup stopped: the environment is not configured correctly.',
    '',
    ...parsed.problems.map((p) => `  - ${p}`),
    '',
    'Fix: copy .env.example to .env and fill in the values listed above.',
    '',
  ];
  process.stderr.write(lines.join('\n'));
  process.exit(1);
}

export const env: Env = loadEnv();
