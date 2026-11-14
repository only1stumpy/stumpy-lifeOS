ALTER TABLE "owner_settings" ADD COLUMN "notifications_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "daily_summary_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "weekly_summary_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "weight_reminder_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "summary_time" text;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "last_seen_version" text;--> statement-breakpoint
UPDATE "owner_settings" SET "notifications_configured" = true, "daily_summary_enabled" = true, "weekly_summary_enabled" = true, "weight_reminder_enabled" = true WHERE "profile_onboarding_completed" = true;
