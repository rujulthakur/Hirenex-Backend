import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      PORT: '4001',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/trusthire_test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_ACCESS_SECRET: 'test_access_secret_test_access_secret_123',
      JWT_REFRESH_SECRET: 'test_refresh_secret_test_refresh_secret_12',
      CORS_ORIGINS: 'http://localhost:5173',
      COOKIE_SAMESITE: 'lax',
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-2.0-flash',
      DEMO_MODE: 'true',
      APP_BASE_URL: 'http://localhost:4000',
      PORTAL_BASE_URL: 'http://localhost:5173',
    },
  },
});
