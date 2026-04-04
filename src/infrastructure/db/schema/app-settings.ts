import { boolean, foreignKey, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),

  themeMode: varchar('theme_mode', { length: 20 }).notNull().default('dark'),
  language: varchar('language', { length: 10 }).notNull().default('en'),

  activeProvider: varchar('active_provider', { length: 50 }).notNull().default('chatgpt'),
  openaiModel: varchar('openai_model', { length: 100 }).notNull().default('gpt-4.1-mini'),

  taskMemoryEnabled: boolean('task_memory_enabled').notNull().default(true),
  taskAutoApprove: boolean('task_auto_approve').notNull().default(false),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tradingSettings = pgTable('trading_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),

  paperTrading: boolean('paper_trading').notNull().default(true),
  autoApprove: boolean('auto_approve').notNull().default(false),

  cexProviders: jsonb('cex_providers').notNull().default('[]'),
  dexProviders: jsonb('dex_providers').notNull().default('[]'),
  chainConfigs: jsonb('chain_configs').notNull().default('{}'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const taskSchedules = pgTable('task_schedules', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  scheduleId: varchar('schedule_id', { length: 100 }).notNull().unique(),
  prompt: text('prompt').notNull(),
  capabilities: jsonb('capabilities').notNull().default('[]'),
  mode: varchar('mode', { length: 20 }).notNull().default('browser'),
  frequency: varchar('frequency', { length: 20 }).notNull(),
  cronExpr: varchar('cron_expr', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),

  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tasks = pgTable(
  'tasks',
  {
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

    result: jsonb('result'),
    summary: text('summary'),
    error: text('error'),

    steps: integer('steps').default(0),
    maxSteps: integer('max_steps'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentTaskId],
      foreignColumns: [table.taskId],
      name: 'tasks_parent_task_id_tasks_task_id_fk',
    }).onDelete('set null'),
  ]
);

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type TradingSetting = typeof tradingSettings.$inferSelect;
export type NewTradingSetting = typeof tradingSettings.$inferInsert;
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type NewTaskSchedule = typeof taskSchedules.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
