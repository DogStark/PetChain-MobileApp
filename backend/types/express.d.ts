import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    db?: {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    };
    user?: {
      id: string;
      email?: string;
      role?: string;
      mfaVerified?: boolean;
    };
    requestId?: string;
    correlationId?: string;
  }
}
