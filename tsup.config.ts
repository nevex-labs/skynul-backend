import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: false,
  platform: 'node',
  external: ['better-sqlite3', 'playwright-core'],
  outDir: 'dist',
  banner: {
    js: "console.log('[boot] loading modules...');",
  },
});
