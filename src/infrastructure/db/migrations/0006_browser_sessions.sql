CREATE TABLE "browser_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "browser_snapshots_snapshot_id_unique" UNIQUE("snapshot_id")
);
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"oauth_subject" varchar(255) NOT NULL,
	"app_user_id" integer,
	"display_name" varchar(255),
	"avatar_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sessions_session_id_unique" UNIQUE("session_id")
);
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
