import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

// API Keys y secrets de proveedores externos (por usuario)
export const providerSecrets = pgTable(
  'provider_secrets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(), // 'openai', 'coinbase', 'binance', etc.
    keyName: varchar('key_name', { length: 100 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Un usuario no puede tener duplicados del mismo provider+keyName
    uniqueKey: { columns: [table.userId, table.provider, table.keyName] },
  })
);

// Settings globales de la app (por usuario)
export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),

  // Capabilities
  capabilityFsRead: boolean('capability_fs_read').notNull().default(false),
  capabilityFsWrite: boolean('capability_fs_write').notNull().default(false),
  capabilityCmdRun: boolean('capability_cmd_run').notNull().default(false),
  capabilityNetHttp: boolean('capability_net_http').notNull().default(false),

  // Theme & Language
  themeMode: varchar('theme_mode', { length: 20 }).notNull().default('dark'),
  language: varchar('language', { length: 10 }).notNull().default('en'),

  // Provider
  activeProvider: varchar('active_provider', { length: 50 }).notNull().default('chatgpt'),
  openaiModel: varchar('openai_model', { length: 100 }).notNull().default('gpt-4.1-mini'),

  // Features
  taskMemoryEnabled: boolean('task_memory_enabled').notNull().default(true),
  taskAutoApprove: boolean('task_auto_approve').notNull().default(false),
  paperTradingEnabled: boolean('paper_trading_enabled').notNull().default(false),

  // Workspace
  workspaceRoot: varchar('workspace_root', { length: 500 }),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Configuración de trading (por usuario)
export const tradingSettings = pgTable('trading_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),

  // Paper trading
  paperTrading: boolean('paper_trading').notNull().default(true),

  // Auto-approve
  autoApprove: boolean('auto_approve').notNull().default(false),

  // Proveedores activos
  cexProviders: jsonb('cex_providers').notNull().default('[]'),
  dexProviders: jsonb('dex_providers').notNull().default('[]'),

  // Config por cadena
  chainConfigs: jsonb('chain_configs').notNull().default('{}'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Schedules de tareas recurrentes (por usuario)
export const taskSchedules = pgTable('task_schedules', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  scheduleId: varchar('schedule_id', { length: 100 }).notNull().unique(),
  prompt: text('prompt').notNull(),
  capabilities: jsonb('capabilities').notNull().default('[]'),
  mode: varchar('mode', { length: 20 }).notNull().default('browser'),
  frequency: varchar('frequency', { length: 20 }).notNull(), // 'daily', 'weekly', 'custom'
  cronExpr: varchar('cron_expr', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),

  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Tasks (para reemplazar data/tasks.json)
export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  taskId: varchar('task_id', { length: 100 }).notNull().unique(),
  prompt: text('prompt').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  capabilities: jsonb('capabilities').notNull().default('[]'),
  mode: varchar('mode', { length: 20 }).notNull().default('browser'),
  source: varchar('source', { length: 50 }),
  parentTaskId: varchar('parent_task_id', { length: 100 }),

  // Resultados
  result: jsonb('result'),
  summary: text('summary'),
  error: text('error'),

  // Metadata
  steps: integer('steps').default(0),
  maxSteps: integer('max_steps'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type ProviderSecret = typeof providerSecrets.$inferSelect;
export type NewProviderSecret = typeof providerSecrets.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type TradingSetting = typeof tradingSettings.$inferSelect;
export type NewTradingSetting = typeof tradingSettings.$inferInsert;
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type NewTaskSchedule = typeof taskSchedules.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
