CREATE TABLE "ai_oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"account_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_oauth_sessions_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "ai_oauth_sessions_provider_valid" CHECK ("ai_oauth_sessions"."provider_id" in ('openrouter')),
	CONSTRAINT "ai_oauth_sessions_status_valid" CHECK ("ai_oauth_sessions"."status" in ('pending', 'exchanging', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "ai_oauth_sessions" ADD CONSTRAINT "ai_oauth_sessions_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_oauth_sessions_owner_created_idx" ON "ai_oauth_sessions" USING btree ("owner_id","created_at");