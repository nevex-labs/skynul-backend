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
ALTER TABLE "trading_settings" ADD CONSTRAINT "trading_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
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
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "paper_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset" varchar(50) NOT NULL,
	"amount" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "paper_balances_user_asset_unique" UNIQUE("user_id","asset")
);
ALTER TABLE "paper_balances" ADD CONSTRAINT "paper_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
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
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
