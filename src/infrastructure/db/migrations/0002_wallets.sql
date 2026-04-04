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
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
