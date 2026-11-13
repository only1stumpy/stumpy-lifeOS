ALTER TABLE "owner_settings" ADD COLUMN "sex" text;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "profile_onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "owner_settings" SET "profile_onboarding_completed" = true WHERE "id" IN (SELECT "owner_id" FROM "nutrition_targets");
