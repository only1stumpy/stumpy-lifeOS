ALTER TABLE "owner_settings" ADD COLUMN "ai_clarification_history" jsonb;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "ai_clarification_updated_at" timestamp with time zone;