CREATE TABLE "task_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"prompt" text NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"search_vector" text,
	"provider" varchar(50),
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_logs_task_id_unique" UNIQUE("task_id")
);
CREATE INDEX "task_logs_user_id_idx" ON "task_logs" USING btree ("user_id");
CREATE INDEX "task_logs_task_id_idx" ON "task_logs" USING btree ("task_id");
CREATE INDEX "task_logs_created_at_idx" ON "task_logs" USING btree ("created_at");
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "user_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fact" text NOT NULL,
	"search_vector" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "user_facts_user_id_idx" ON "user_facts" USING btree ("user_id");
CREATE INDEX "user_facts_created_at_idx" ON "user_facts" USING btree ("created_at");
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "user_learnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255),
	"content" text NOT NULL,
	"category" varchar(100),
	"relevance_score" real DEFAULT 1 NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"search_vector" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "user_learnings_user_id_idx" ON "user_learnings" USING btree ("user_id");
CREATE INDEX "user_learnings_task_id_idx" ON "user_learnings" USING btree ("task_id");
ALTER TABLE "user_learnings" ADD CONSTRAINT "user_learnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
