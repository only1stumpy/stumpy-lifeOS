CREATE TABLE "finance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"target_month" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_plans_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "finance_plans_amount_positive" CHECK ("finance_plans"."amount" > 0),
	CONSTRAINT "finance_plans_target_month_first_day" CHECK (extract(day from "finance_plans"."target_month") = 1)
);
--> statement-breakpoint
ALTER TABLE "finance_plans" ADD CONSTRAINT "finance_plans_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_plans_owner_month_idx" ON "finance_plans" USING btree ("owner_id","target_month","created_at");