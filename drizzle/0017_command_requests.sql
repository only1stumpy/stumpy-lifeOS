CREATE TABLE "command_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_requests" ADD CONSTRAINT "command_requests_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "command_requests_owner_request_unique" ON "command_requests" USING btree ("owner_id","client_request_id");