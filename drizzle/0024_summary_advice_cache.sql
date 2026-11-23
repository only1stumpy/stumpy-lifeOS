CREATE TABLE "summary_advice_cache" (
	"owner_id" uuid NOT NULL,
	"period" text NOT NULL,
	"start" date NOT NULL,
	"end" date NOT NULL,
	"advice" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_advice_cache_pk" PRIMARY KEY("owner_id","period","start","end"),
	CONSTRAINT "summary_advice_cache_period_valid" CHECK ("summary_advice_cache"."period" in ('day', 'week', 'month'))
);
--> statement-breakpoint
ALTER TABLE "summary_advice_cache" ADD CONSTRAINT "summary_advice_cache_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;
