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
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
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
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
