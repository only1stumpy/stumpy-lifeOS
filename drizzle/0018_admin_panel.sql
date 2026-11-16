CREATE TABLE "admin_cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"sent" integer,
	"failed" integer,
	"skipped_owners" integer,
	"error_class" text
);
--> statement-breakpoint
CREATE TABLE "admin_kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_provider_usage_events" ADD COLUMN "failure_kind" text;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD COLUMN "last_active_date" date;--> statement-breakpoint
CREATE INDEX "admin_cron_runs_started_idx" ON "admin_cron_runs" USING btree ("started_at");