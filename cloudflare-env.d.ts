interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

interface CloudflareEnv {
  ASSETS?: {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
  DB: D1Database;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  DZN_CRON_SECRET?: string;
  SYNC_CRON_SECRET?: string;
  DZN_APP_URL?: string;
  SYNC_WORKER_HEALTH_TOKEN?: string;
  DZN_ADMIN_DISCORD_IDS?: string;
  DZN_OWNER_DISCORD_IDS?: string;
  DISCORD_BOT_TOKEN?: string;
  MOCK_AUTH?: string;
  MOCK_NITRADO?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_PREMIUM?: string;
  STRIPE_PRICE_NETWORK?: string;
  STRIPE_PRICE_PARTNER?: string;
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID?: string;
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID?: string;
  NEXT_PUBLIC_STRIPE_PREMIUM_PRICE_ID?: string;
  NEXT_PUBLIC_APP_URL?: string;
}
