CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limit_counters_count_nonnegative" CHECK ("rate_limit_counters"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");