import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/db/schema/index.ts',
  out: './src/infrastructure/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://skynul:skynul_password@localhost:5433/skynul',
  },
  verbose: true,
  strict: true,
});
