CREATE TYPE "public"."chain" AS ENUM('evm', 'solana', 'bitcoin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"password" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"address" varchar(255) NOT NULL,
	"chain" "chain" NOT NULL,
	"is_primary" varchar(5) DEFAULT 'true' NOT NULL,
	"last_signed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "wallets_address_chain_unique" UNIQUE("address","chain")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key_name" varchar(255) NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"project_id" integer NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"added_at" timestamp DEFAULT now(),
	CONSTRAINT "project_tasks_project_id_task_id_pk" PRIMARY KEY("project_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"tag" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "browser_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "browser_snapshots_snapshot_id_unique" UNIQUE("snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"avatar_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "channel_global_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"auto_approve" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "channel_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'disconnected' NOT NULL,
	"paired" boolean DEFAULT false NOT NULL,
	"pairing_code" varchar(255),
	"error" text,
	"has_credentials" boolean DEFAULT false NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "channel_settings_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"capability_fs_read" boolean DEFAULT false NOT NULL,
	"capability_fs_write" boolean DEFAULT false NOT NULL,
	"capability_cmd_run" boolean DEFAULT false NOT NULL,
	"capability_net_http" boolean DEFAULT false NOT NULL,
	"theme_mode" varchar(20) DEFAULT 'dark' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"active_provider" varchar(50) DEFAULT 'chatgpt' NOT NULL,
	"openai_model" varchar(100) DEFAULT 'gpt-4.1-mini' NOT NULL,
	"task_memory_enabled" boolean DEFAULT true NOT NULL,
	"task_auto_approve" boolean DEFAULT false NOT NULL,
	"paper_trading_enabled" boolean DEFAULT false NOT NULL,
	"workspace_root" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "app_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "provider_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"key_name" varchar(100) NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"schedule_id" varchar(100) NOT NULL,
	"prompt" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]' NOT NULL,
	"mode" varchar(20) DEFAULT 'browser' NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"cron_expr" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "task_schedules_schedule_id_unique" UNIQUE("schedule_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(100) NOT NULL,
	"prompt" text NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"capabilities" jsonb DEFAULT '[]' NOT NULL,
	"mode" varchar(20) DEFAULT 'browser' NOT NULL,
	"source" varchar(50),
	"parent_task_id" varchar(100),
	"result" jsonb,
	"summary" text,
	"error" text,
	"steps" integer DEFAULT 0,
	"max_steps" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "trading_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"paper_trading" boolean DEFAULT true NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"cex_providers" jsonb DEFAULT '[]' NOT NULL,
	"dex_providers" jsonb DEFAULT '[]' NOT NULL,
	"chain_configs" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "trading_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "allowances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_address" varchar(255) NOT NULL,
	"chain_id" integer NOT NULL,
	"approved_amount" varchar(78) DEFAULT '0' NOT NULL,
	"used_amount" varchar(78) DEFAULT '0' NOT NULL,
	"fee_collected" varchar(78) DEFAULT '0' NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "allowances_user_token_chain_unique" UNIQUE("user_id","token_address","chain_id")
);
--> statement-breakpoint
CREATE TABLE "paper_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset" varchar(50) NOT NULL,
	"amount" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255),
	"venue" varchar(50) NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"symbol" varchar(50),
	"side" varchar(10),
	"price" real,
	"size" real,
	"amount_usd" real,
	"order_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'FILLED' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_daily_volume" (
	"user_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"venue" varchar(50) NOT NULL,
	"volume_usd" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "risk_daily_volume_user_id_date_venue_pk" PRIMARY KEY("user_id","date","venue")
);
--> statement-breakpoint
CREATE TABLE "risk_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"venue" varchar(50) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"side" varchar(10) NOT NULL,
	"size_usd" real NOT NULL,
	"task_id" varchar(255),
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"mode" varchar(20) DEFAULT 'task' NOT NULL,
	"entry_price" real,
	"exit_price" real,
	"pnl_usd" real
);
--> statement-breakpoint
CREATE TABLE "yolo_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(50) NOT NULL,
	"chain" varchar(50) NOT NULL,
	"side" varchar(10) NOT NULL,
	"size_usd" real NOT NULL,
	"entry_price" real NOT NULL,
	"exit_price" real,
	"pnl_usd" real,
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"exit_reason" varchar(50),
	"task_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255),
	"type" varchar(50) DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"project" varchar(100),
	"scope" varchar(20) DEFAULT 'project' NOT NULL,
	"topic_key" varchar(255),
	"normalized_hash" varchar(32),
	"revision_count" integer DEFAULT 1 NOT NULL,
	"duplicate_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp,
	"search_vector" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"prompt" text NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"learnings" text NOT NULL,
	"provider" varchar(50),
	"duration_ms" integer,
	"search_vector" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_memories_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "user_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fact" text NOT NULL,
	"search_vector" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_settings" ADD CONSTRAINT "trading_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_balances" ADD CONSTRAINT "paper_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_daily_volume" ADD CONSTRAINT "risk_daily_volume_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_positions" ADD CONSTRAINT "risk_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yolo_trades" ADD CONSTRAINT "yolo_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_memories" ADD CONSTRAINT "task_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_key" ON "secrets" USING btree ("user_id","key_name");--> statement-breakpoint
CREATE INDEX "observations_search_vector_idx" ON "observations" USING gin (to_tsvector('english', "search_vector"));--> statement-breakpoint
CREATE INDEX "observations_user_id_idx" ON "observations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "observations_topic_key_idx" ON "observations" USING btree ("topic_key");--> statement-breakpoint
CREATE INDEX "observations_project_idx" ON "observations" USING btree ("project");--> statement-breakpoint
CREATE INDEX "observations_type_idx" ON "observations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "observations_hash_idx" ON "observations" USING btree ("normalized_hash");--> statement-breakpoint
CREATE INDEX "observations_updated_at_idx" ON "observations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "observations_deleted_at_idx" ON "observations" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "task_memories_search_vector_idx" ON "task_memories" USING gin (to_tsvector('english', "search_vector"));--> statement-breakpoint
CREATE INDEX "task_memories_user_id_idx" ON "task_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_memories_task_id_idx" ON "task_memories" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_memories_created_at_idx" ON "task_memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_facts_search_vector_idx" ON "user_facts" USING gin (to_tsvector('english', "search_vector"));--> statement-breakpoint
CREATE INDEX "user_facts_user_id_idx" ON "user_facts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_facts_created_at_idx" ON "user_facts" USING btree ("created_at");