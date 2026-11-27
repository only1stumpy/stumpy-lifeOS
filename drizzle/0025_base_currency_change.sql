CREATE TABLE "base_currency_changes" (
	"owner_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"previous_currency" text NOT NULL,
	"currency" text NOT NULL,
	"rate_to_new" numeric(20, 10) NOT NULL,
	"audit" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_currency_changes_owner_id_epoch_pk" PRIMARY KEY("owner_id","epoch"),
	CONSTRAINT "base_currency_changes_rate_positive" CHECK ("base_currency_changes"."rate_to_new" > 0)
);
--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "base_currency_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "base_currency_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "base_currency_changes" ADD CONSTRAINT "base_currency_changes_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;
