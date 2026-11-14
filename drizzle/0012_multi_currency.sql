ALTER TABLE "exchange_rates" DROP CONSTRAINT "exchange_rates_rate_positive";--> statement-breakpoint
ALTER TABLE "finance_accounts" DROP CONSTRAINT "finance_accounts_currency_valid";--> statement-breakpoint
ALTER TABLE "finance_entries" DROP CONSTRAINT "finance_entries_usd_rate_required";--> statement-breakpoint
ALTER TABLE "finance_entries" DROP CONSTRAINT "finance_entries_currency_valid";--> statement-breakpoint
ALTER TABLE "money_drafts" DROP CONSTRAINT "money_drafts_currency_valid";--> statement-breakpoint
ALTER TABLE "money_drafts" DROP CONSTRAINT "money_drafts_rate_positive";--> statement-breakpoint
ALTER TABLE "recurring_payments" DROP CONSTRAINT "recurring_payments_currency_valid";--> statement-breakpoint
DROP INDEX "exchange_rates_owner_effective_at_unique";--> statement-breakpoint
ALTER TABLE "exchange_rates" RENAME COLUMN "usd_to_prb_rate" TO "rate_to_base";--> statement-breakpoint
ALTER TABLE "finance_entries" RENAME COLUMN "usd_to_prb_rate" TO "rate_to_base";--> statement-breakpoint
ALTER TABLE "money_drafts" RENAME COLUMN "usd_to_prb_rate" TO "rate_to_base";--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD COLUMN "currency" text;--> statement-breakpoint
UPDATE "exchange_rates" SET "currency" = 'USD';--> statement-breakpoint
ALTER TABLE "exchange_rates" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "base_currency" text;--> statement-breakpoint
UPDATE "owner_settings" SET "base_currency" = 'PRB' WHERE EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."owner_id" = "owner_settings"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_owner_currency_effective_at_unique" ON "exchange_rates" USING btree ("owner_id","currency","effective_at");--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_valid" CHECK ("exchange_rates"."currency" ~ '^[A-Z]{3,5}$');--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_rate_positive" CHECK ("exchange_rates"."rate_to_base" > 0);--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_currency_valid" CHECK ("finance_accounts"."currency" ~ '^[A-Z]{3,5}$');--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_rate_positive" CHECK ("finance_entries"."rate_to_base" is null or "finance_entries"."rate_to_base" > 0);--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_currency_valid" CHECK ("finance_entries"."currency" ~ '^[A-Z]{3,5}$');--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_currency_valid" CHECK ("money_drafts"."currency" ~ '^[A-Z]{3,5}$');--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_rate_positive" CHECK ("money_drafts"."rate_to_base" is null or "money_drafts"."rate_to_base" > 0);--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_currency_valid" CHECK ("recurring_payments"."currency" ~ '^[A-Z]{3,5}$');
