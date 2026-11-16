ALTER TABLE "owner_settings" ADD COLUMN "health_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "health_consent_version" text;--> statement-breakpoint
-- One-off cleanup of data kept longer than the retention rules allow (the cron enforces them from now on).
UPDATE "capture_drafts" SET "message_text" = NULL WHERE "status" <> 'pending' AND "message_text" IS NOT NULL;--> statement-breakpoint
UPDATE "capture_drafts" SET "status" = 'expired', "message_text" = NULL WHERE "status" = 'pending' AND "created_at" < now() - interval '7 days';--> statement-breakpoint
UPDATE "owner_settings" SET "ai_clarification_history" = NULL, "ai_clarification_updated_at" = NULL WHERE "ai_clarification_updated_at" < now() - interval '30 minutes';--> statement-breakpoint
DELETE FROM "ai_provider_usage_events" WHERE "occurred_at" < now() - interval '30 days';--> statement-breakpoint
DELETE FROM "notification_deliveries" WHERE "created_at" < now() - interval '90 days';
