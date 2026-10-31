import type { AuthUser } from './auth.schema';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the requestId middleware. */
      id: string;
      /** Set by the authenticate middleware. */
      user?: AuthUser;
    }
  }
}

export {};
