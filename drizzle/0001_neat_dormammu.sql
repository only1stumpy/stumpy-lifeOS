ALTER TABLE "recurring_payments" ADD COLUMN "anchor_day" smallint;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD COLUMN "anchor_month" smallint;--> statement-breakpoint
UPDATE "recurring_payments"
SET
	"anchor_day" = EXTRACT(DAY FROM "next_due_on")::smallint,
	"anchor_month" = EXTRACT(MONTH FROM "next_due_on")::smallint;--> statement-breakpoint
ALTER TABLE "recurring_payments" ALTER COLUMN "anchor_day" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_payments" ALTER COLUMN "anchor_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_anchor_day_valid" CHECK ("recurring_payments"."anchor_day" between 1 and 31);--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_anchor_month_valid" CHECK ("recurring_payments"."anchor_month" between 1 and 12);
