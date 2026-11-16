ALTER TABLE "exchange_rates" ALTER COLUMN "rate_to_base" SET DATA TYPE numeric(20, 10);--> statement-breakpoint
ALTER TABLE "finance_entries" ALTER COLUMN "rate_to_base" SET DATA TYPE numeric(20, 10);--> statement-breakpoint
ALTER TABLE "money_drafts" ALTER COLUMN "rate_to_base" SET DATA TYPE numeric(20, 10);--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "debt_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_debt_owner_fk" FOREIGN KEY ("debt_id","owner_id") REFERENCES "public"."finance_debts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Best-effort link of existing opening operations: debt and operation were inserted in one transaction, so created_at is equal.
UPDATE "finance_entries" e SET "debt_id" = d."id" FROM "finance_debts" d
WHERE d."opened_as" = 'transfer' AND e."owner_id" = d."owner_id" AND e."created_at" = d."created_at" AND e."amount" = d."original_amount" AND e."debt_id" IS NULL
AND e."entry_type" = CASE WHEN d."direction" = 'i_owe' THEN 'income' ELSE 'expense' END
AND e."name" = CASE WHEN d."direction" = 'i_owe' THEN 'Занял у ' ELSE 'Одолжил ' END || d."person_name"
AND NOT EXISTS (SELECT 1 FROM "finance_debt_repayments" r WHERE r."finance_entry_id" = e."id");
