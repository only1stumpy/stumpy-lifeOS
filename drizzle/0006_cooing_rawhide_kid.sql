CREATE TABLE "finance_debt_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capture_draft_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"person_name" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"opened_as" text,
	"debt_id" uuid,
	"account_id" uuid,
	"due_on" date,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_debt_drafts_operation_valid" CHECK ("finance_debt_drafts"."operation" in ('create', 'repayment')),
	CONSTRAINT "finance_debt_drafts_direction_valid" CHECK ("finance_debt_drafts"."direction" in ('i_owe', 'owed_to_me')),
	CONSTRAINT "finance_debt_drafts_amount_positive" CHECK ("finance_debt_drafts"."amount" > 0),
	CONSTRAINT "finance_debt_drafts_fields_match_operation" CHECK (("finance_debt_drafts"."operation" = 'create' and "finance_debt_drafts"."opened_as" in ('transfer', 'opening_balance') and "finance_debt_drafts"."debt_id" is null) or ("finance_debt_drafts"."operation" = 'repayment' and "finance_debt_drafts"."opened_as" is null and "finance_debt_drafts"."debt_id" is not null)),
	CONSTRAINT "finance_debt_drafts_account_match_operation" CHECK (("finance_debt_drafts"."opened_as" = 'opening_balance' and "finance_debt_drafts"."account_id" is null) or ("finance_debt_drafts"."opened_as" = 'transfer' and "finance_debt_drafts"."account_id" is not null) or ("finance_debt_drafts"."operation" = 'repayment' and "finance_debt_drafts"."account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance_debt_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"debt_id" uuid NOT NULL,
	"finance_entry_id" uuid NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_debt_repayments_amount_positive" CHECK ("finance_debt_repayments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "finance_debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"direction" text NOT NULL,
	"original_amount" numeric(18, 4) NOT NULL,
	"opened_as" text NOT NULL,
	"due_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_debts_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "finance_debts_person_nonempty" CHECK (length(trim("finance_debts"."person_name")) > 0),
	CONSTRAINT "finance_debts_direction_valid" CHECK ("finance_debts"."direction" in ('i_owe', 'owed_to_me')),
	CONSTRAINT "finance_debts_opened_as_valid" CHECK ("finance_debts"."opened_as" in ('transfer', 'opening_balance')),
	CONSTRAINT "finance_debts_amount_positive" CHECK ("finance_debts"."original_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "capture_drafts" DROP CONSTRAINT "capture_drafts_kind_valid";--> statement-breakpoint
ALTER TABLE "finance_debt_drafts" ADD CONSTRAINT "finance_debt_drafts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_drafts" ADD CONSTRAINT "finance_debt_drafts_debt_id_finance_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."finance_debts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_drafts" ADD CONSTRAINT "finance_debt_drafts_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_drafts" ADD CONSTRAINT "finance_debt_drafts_capture_owner_fk" FOREIGN KEY ("capture_draft_id","owner_id") REFERENCES "public"."capture_drafts"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_repayments" ADD CONSTRAINT "finance_debt_repayments_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_repayments" ADD CONSTRAINT "finance_debt_repayments_debt_id_finance_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."finance_debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debt_repayments" ADD CONSTRAINT "finance_debt_repayments_finance_entry_id_finance_entries_id_fk" FOREIGN KEY ("finance_entry_id") REFERENCES "public"."finance_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_debts" ADD CONSTRAINT "finance_debts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_debt_drafts_capture_unique" ON "finance_debt_drafts" USING btree ("capture_draft_id");--> statement-breakpoint
CREATE INDEX "finance_debt_drafts_owner_created_idx" ON "finance_debt_drafts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "finance_debt_repayments_owner_debt_idx" ON "finance_debt_repayments" USING btree ("owner_id","debt_id","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_debts_owner_direction_due_idx" ON "finance_debts" USING btree ("owner_id","direction","due_on");--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_kind_valid" CHECK ("capture_drafts"."kind" in ('nutrition', 'finance', 'combined', 'debt'));