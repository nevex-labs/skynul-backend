/**
 * Centralized configuration
 * All env vars and config values in one place
 */

export const config = {
  // Server
  port: Number.parseInt(process.env.SKYNUL_PORT ?? '3141', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Paths
  dataDir: process.env.SKYNUL_DATA_DIR,

  // Security
  apiToken: process.env.SKYNUL_API_TOKEN,
  jwtSecret: process.env.JWT_SECRET,

  // Features
  streaming: process.env.SKYNUL_STREAMING !== 'false',
  logLevel: process.env.SKYNUL_LOG_LEVEL ?? 'info',

  // Rate Limiting
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production' && process.env.SKYNUL_RATE_LIMIT_ENABLED !== 'false',
    globalRpm: Number.parseInt(process.env.SKYNUL_RATE_LIMIT_RPM ?? '100', 10),
    tasksPerMin: Number.parseInt(process.env.SKYNUL_RATE_LIMIT_TASKS_PER_MIN ?? '10', 10),
    messagesPerMin: 20,
    resumesPerMin: 5,
    websocketPerMin: 10,
  },

  // Shutdown
  shutdownTimeoutMs: Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10),
  agentLoopTimeoutMs: Number.parseInt(process.env.AGENT_LOOP_TIMEOUT_MS ?? '60000', 10),

  // AI Providers
  providers: {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    kimi: process.env.KIMI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    ollama: process.env.OLLAMA_HOST,
  },

  // Database
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  // External Services
  external: {
    supabase: {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    },
    coinbase: {
      apiKey: process.env.COINBASE_API_KEY,
    },
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    },
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    whatsapp: {
      session: process.env.WHATSAPP_SESSION,
    },
    polymarket: {
      apiKey: process.env.POLYMARKET_API_KEY,
    },
  },

  // Development
  debug: process.env.DEBUG === 'true',
  headless: process.env.HEADLESS !== 'false',
  paperTrading: process.env.PAPER_TRADING !== 'false',
} as const;

// Type-safe config getter
export function getConfig<T extends keyof typeof config>(key: T): (typeof config)[T] {
  return config[key];
}

// Legacy helper for data directory
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function getDataDir(): string {
  const dir = config.dataDir ?? join(homedir(), '.skynul');
  mkdirSync(dir, { recursive: true });
  return dir;
}
