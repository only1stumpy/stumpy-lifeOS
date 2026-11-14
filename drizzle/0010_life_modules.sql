ALTER TABLE "owner_settings" ADD COLUMN "enabled_modules" text[] DEFAULT ARRAY['nutrition','finance','gym']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "modules_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "owner_settings" SET "modules_configured" = true WHERE "notifications_configured" = true OR "profile_onboarding_completed" = true;
