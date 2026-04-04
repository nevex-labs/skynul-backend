CREATE TABLE "channel_global_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"auto_approve" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX "channel_global_settings_singleton" ON "channel_global_settings" USING btree ((true));
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
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"theme_mode" varchar(20) DEFAULT 'dark' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"active_provider" varchar(50) DEFAULT 'chatgpt' NOT NULL,
	"openai_model" varchar(100) DEFAULT 'gpt-4.1-mini' NOT NULL,
	"task_memory_enabled" boolean DEFAULT true NOT NULL,
	"task_auto_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "app_settings_user_id_unique" UNIQUE("user_id")
);
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
