ALTER TABLE "wallets" ALTER COLUMN "is_primary" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "is_primary" TYPE boolean USING (lower(trim("is_primary"::text)) IN ('true', 't', '1', 'yes'));--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "is_primary" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "is_primary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_daily_volume" DROP CONSTRAINT "risk_daily_volume_user_id_date_venue_pk";--> statement-breakpoint
ALTER TABLE "risk_daily_volume" ALTER COLUMN "date" TYPE date USING ("date"::date);--> statement-breakpoint
ALTER TABLE "risk_daily_volume" ADD CONSTRAINT "risk_daily_volume_user_id_date_venue_pk" PRIMARY KEY("user_id","date","venue");--> statement-breakpoint
CREATE INDEX "sessions_oauth_subject_idx" ON "sessions" USING btree ("oauth_subject");--> statement-breakpoint
CREATE INDEX "sessions_app_user_id_idx" ON "sessions" USING btree ("app_user_id");--> statement-breakpoint
UPDATE "tasks" t SET "parent_task_id" = NULL WHERE t."parent_task_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tasks" c WHERE c."task_id" = t."parent_task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_task_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("task_id") ON DELETE set null ON UPDATE no action;
