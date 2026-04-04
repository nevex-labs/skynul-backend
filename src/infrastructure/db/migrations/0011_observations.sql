CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255),
	"type" varchar(50) DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"project_id" integer,
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
CREATE INDEX "observations_user_id_idx" ON "observations" USING btree ("user_id");
CREATE INDEX "observations_topic_key_idx" ON "observations" USING btree ("topic_key");
CREATE INDEX "observations_project_id_idx" ON "observations" USING btree ("project_id");
CREATE INDEX "observations_type_idx" ON "observations" USING btree ("type");
CREATE INDEX "observations_hash_idx" ON "observations" USING btree ("normalized_hash");
CREATE INDEX "observations_updated_at_idx" ON "observations" USING btree ("updated_at");
CREATE INDEX "observations_deleted_at_idx" ON "observations" USING btree ("deleted_at");
ALTER TABLE "observations" ADD CONSTRAINT "observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "observations" ADD CONSTRAINT "observations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
