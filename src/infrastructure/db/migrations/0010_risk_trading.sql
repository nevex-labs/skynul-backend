CREATE TABLE "risk_daily_volume" (
	"user_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"venue" varchar(50) NOT NULL,
	"volume_usd" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "risk_daily_volume_user_id_date_venue_pk" PRIMARY KEY("user_id","date","venue")
);
ALTER TABLE "risk_daily_volume" ADD CONSTRAINT "risk_daily_volume_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
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
ALTER TABLE "risk_positions" ADD CONSTRAINT "risk_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
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
ALTER TABLE "yolo_trades" ADD CONSTRAINT "yolo_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "trade_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"venue" varchar(50) NOT NULL,
	"capability" varchar(100) NOT NULL,
	"symbol" varchar(50),
	"side" varchar(10),
	"entry_price" real,
	"exit_price" real,
	"size" real,
	"pnl_usd" real DEFAULT 0 NOT NULL,
	"pnl_pct" real DEFAULT 0 NOT NULL,
	"score_pnl" real DEFAULT 0 NOT NULL,
	"score_discipline" real DEFAULT 0 NOT NULL,
	"score_efficiency" real DEFAULT 0 NOT NULL,
	"score_total" real DEFAULT 0 NOT NULL,
	"steps_used" integer DEFAULT 0 NOT NULL,
	"max_steps" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"had_open_positions_at_done" boolean DEFAULT false NOT NULL,
	"is_paper" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "trade_scores" ADD CONSTRAINT "trade_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
