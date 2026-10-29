CREATE TABLE "ai_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"auth_header_name" text DEFAULT 'authorization' NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"free_tier_confirmed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_accounts_provider_valid" CHECK ("ai_provider_accounts"."provider_id" in ('gemini', 'groq', 'cerebras', 'openrouter', 'custom')),
	CONSTRAINT "ai_provider_accounts_auth_header_valid" CHECK ("ai_provider_accounts"."auth_header_name" in ('authorization', 'x-goog-api-key')),
	CONSTRAINT "ai_provider_accounts_sort_order_nonnegative" CHECK ("ai_provider_accounts"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_provider_model_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_model_selections_provider_valid" CHECK ("ai_provider_model_selections"."provider_id" in ('gemini', 'groq', 'cerebras', 'openrouter', 'custom')),
	CONSTRAINT "ai_provider_model_selections_sort_order_nonnegative" CHECK ("ai_provider_model_selections"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_provider_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_usage_outcome_valid" CHECK ("ai_provider_usage_events"."outcome" in ('success', 'failure'))
);
--> statement-breakpoint
ALTER TABLE "ai_provider_accounts" ADD CONSTRAINT "ai_provider_accounts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_model_selections" ADD CONSTRAINT "ai_provider_model_selections_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_usage_events" ADD CONSTRAINT "ai_provider_usage_events_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_usage_events" ADD CONSTRAINT "ai_provider_usage_events_account_id_ai_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ai_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_accounts_owner_provider_order_idx" ON "ai_provider_accounts" USING btree ("owner_id","provider_id","sort_order","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_model_selections_owner_provider_model_unique" ON "ai_provider_model_selections" USING btree ("owner_id","provider_id","model_id");--> statement-breakpoint
CREATE INDEX "ai_provider_model_selections_owner_provider_order_idx" ON "ai_provider_model_selections" USING btree ("owner_id","provider_id","sort_order");--> statement-breakpoint
CREATE INDEX "ai_provider_usage_owner_occurred_idx" ON "ai_provider_usage_events" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ai_provider_usage_account_model_occurred_idx" ON "ai_provider_usage_events" USING btree ("account_id","model_id","occurred_at");