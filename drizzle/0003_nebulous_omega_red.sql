CREATE TABLE "ai_provider_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_profiles_sort_order_nonnegative" CHECK ("ai_provider_profiles"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_provider_profiles" ADD CONSTRAINT "ai_provider_profiles_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_provider_profiles_owner_order_idx" ON "ai_provider_profiles" USING btree ("owner_id","sort_order","created_at");