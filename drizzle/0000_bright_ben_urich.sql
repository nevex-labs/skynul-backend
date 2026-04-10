CREATE TABLE "agent_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"project" text,
	"scope" text NOT NULL,
	"topic_key" text,
	"normalized_hash" text,
	"revision_count" integer DEFAULT 1 NOT NULL,
	"duplicate_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint
);
--> statement-breakpoint
CREATE TABLE "channel_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_key" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_configs_user_key" UNIQUE("user_id","channel_key")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_secret" UNIQUE("user_id","type","provider")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"outcome" text NOT NULL,
	"learnings" text NOT NULL,
	"provider" text,
	"duration_ms" integer,
	"created_at" bigint NOT NULL,
	CONSTRAINT "task_memories_user_task" UNIQUE("user_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "task_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"interval_ms" integer,
	"last_check" integer,
	"last_result" text
);
--> statement-breakpoint
CREATE TABLE "task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"timestamp" bigint NOT NULL,
	"action_type" text NOT NULL,
	"action" jsonb NOT NULL,
	"screenshot_base64" text,
	"context_pct" real,
	"context_tokens" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"orchestrate" text DEFAULT 'single' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"prompt" text NOT NULL,
	"attachments" text[],
	"plan" jsonb,
	"agent_name" text,
	"agent_role" text,
	"skip_memory" boolean DEFAULT false,
	"usage_input_tokens" integer,
	"usage_output_tokens" integer,
	"summary" text,
	"error" text,
	"max_steps" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"source" text,
	"model" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain" text NOT NULL,
	"display_name" text,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wallet" UNIQUE("wallet_address","chain")
);
--> statement-breakpoint
ALTER TABLE "agent_facts" ADD CONSTRAINT "agent_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_memories" ADD CONSTRAINT "task_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_memories" ADD CONSTRAINT "task_memories_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_monitors" ADD CONSTRAINT "task_monitors_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_facts_user_idx" ON "agent_facts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_observations_user_idx" ON "agent_observations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_configs_user_idx" ON "channel_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_secrets_user" ON "secrets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_skills_user" ON "skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_memories_user_idx" ON "task_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");