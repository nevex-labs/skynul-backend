function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? '3141'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: requireEnv('DATABASE_URL'),
  masterKey: requireEnv('MASTER_KEY'),
  allowedOrigins: (process.env.SKYNUL_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
} as const;
