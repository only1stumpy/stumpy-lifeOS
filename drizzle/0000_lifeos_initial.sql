CREATE TABLE "capture_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"telegram_update_row_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_text" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capture_drafts_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "capture_drafts_kind_valid" CHECK ("capture_drafts"."kind" in ('nutrition', 'finance', 'combined')),
	CONSTRAINT "capture_drafts_status_valid" CHECK ("capture_drafts"."status" in ('pending', 'confirmed', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"usd_to_prb_rate" numeric(12, 6) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_rate_positive" CHECK ("exchange_rates"."usd_to_prb_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"muscle_group" text,
	"equipment" text,
	"instructions" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_id_owner_unique" UNIQUE("id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_accounts_id_owner_currency_unique" UNIQUE("id","owner_id","currency"),
	CONSTRAINT "finance_accounts_currency_valid" CHECK ("finance_accounts"."currency" in ('PRB', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_type" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_categories_id_owner_type_unique" UNIQUE("id","owner_id","entry_type"),
	CONSTRAINT "finance_categories_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "finance_categories_entry_type_valid" CHECK ("finance_categories"."entry_type" in ('expense', 'income'))
);
--> statement-breakpoint
CREATE TABLE "finance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capture_draft_id" uuid,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"recurring_payment_id" uuid,
	"entry_type" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"usd_to_prb_rate" numeric(12, 6),
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_entries_entry_type_valid" CHECK ("finance_entries"."entry_type" in ('expense', 'income')),
	CONSTRAINT "finance_entries_amount_positive" CHECK ("finance_entries"."amount" > 0),
	CONSTRAINT "finance_entries_currency_valid" CHECK ("finance_entries"."currency" in ('PRB', 'USD')),
	CONSTRAINT "finance_entries_usd_rate_required" CHECK (("finance_entries"."currency" = 'USD' and "finance_entries"."usd_to_prb_rate" is not null and "finance_entries"."usd_to_prb_rate" > 0) or ("finance_entries"."currency" = 'PRB' and "finance_entries"."usd_to_prb_rate" is null)),
	CONSTRAINT "finance_entries_source_valid" CHECK ("finance_entries"."source" in ('chat', 'mini_app', 'recurring'))
);
--> statement-breakpoint
CREATE TABLE "food_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"composition" text,
	"portion_label" text NOT NULL,
	"calories" numeric(9, 2) NOT NULL,
	"protein_grams" numeric(9, 3) NOT NULL,
	"fat_grams" numeric(9, 3) NOT NULL,
	"carbs_grams" numeric(9, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_templates_values_nonnegative" CHECK ("food_templates"."calories" >= 0 and "food_templates"."protein_grams" >= 0 and "food_templates"."fat_grams" >= 0 and "food_templates"."carbs_grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "money_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capture_draft_id" uuid NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"proposed_category" text,
	"entry_type" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"usd_to_prb_rate" numeric(12, 6),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_drafts_entry_type_valid" CHECK ("money_drafts"."entry_type" in ('expense', 'income')),
	CONSTRAINT "money_drafts_amount_positive" CHECK ("money_drafts"."amount" > 0),
	CONSTRAINT "money_drafts_currency_valid" CHECK ("money_drafts"."currency" in ('PRB', 'USD')),
	CONSTRAINT "money_drafts_rate_positive" CHECK ("money_drafts"."usd_to_prb_rate" is null or "money_drafts"."usd_to_prb_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capture_draft_id" uuid NOT NULL,
	"name" text NOT NULL,
	"composition" text,
	"portion_label" text NOT NULL,
	"calories" numeric(9, 2) NOT NULL,
	"protein_grams" numeric(9, 3) NOT NULL,
	"fat_grams" numeric(9, 3) NOT NULL,
	"carbs_grams" numeric(9, 3) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_drafts_values_nonnegative" CHECK ("nutrition_drafts"."calories" >= 0 and "nutrition_drafts"."protein_grams" >= 0 and "nutrition_drafts"."fat_grams" >= 0 and "nutrition_drafts"."carbs_grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capture_draft_id" uuid,
	"template_id" uuid,
	"name" text NOT NULL,
	"composition" text,
	"portion_label" text NOT NULL,
	"calories" numeric(9, 2) NOT NULL,
	"protein_grams" numeric(9, 3) NOT NULL,
	"fat_grams" numeric(9, 3) NOT NULL,
	"carbs_grams" numeric(9, 3) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"estimated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_entries_values_nonnegative" CHECK ("nutrition_entries"."calories" >= 0 and "nutrition_entries"."protein_grams" >= 0 and "nutrition_entries"."fat_grams" >= 0 and "nutrition_entries"."carbs_grams" >= 0),
	CONSTRAINT "nutrition_entries_source_valid" CHECK ("nutrition_entries"."source" in ('chat', 'mini_app', 'template'))
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"calories" numeric(9, 2) NOT NULL,
	"protein_grams" numeric(9, 3) NOT NULL,
	"fat_grams" numeric(9, 3) NOT NULL,
	"carbs_grams" numeric(9, 3) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_targets_values_nonnegative" CHECK ("nutrition_targets"."calories" >= 0 and "nutrition_targets"."protein_grams" >= 0 and "nutrition_targets"."fat_grams" >= 0 and "nutrition_targets"."carbs_grams" >= 0),
	CONSTRAINT "nutrition_targets_source_valid" CHECK ("nutrition_targets"."source" in ('manual', 'suggested'))
);
--> statement-breakpoint
CREATE TABLE "owner_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"editing_capture_id" uuid,
	"timezone" text DEFAULT 'Europe/Chisinau' NOT NULL,
	"date_of_birth" date,
	"height_cm" numeric(6, 2),
	"activity_level" text,
	"goal_type" text DEFAULT 'gain_mass' NOT NULL,
	"finance_confirmation_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_settings_height_positive" CHECK ("owner_settings"."height_cm" is null or "owner_settings"."height_cm" > 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"next_due_on" date NOT NULL,
	"interval_unit" text NOT NULL,
	"interval_count" smallint DEFAULT 1 NOT NULL,
	"reminder_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_reminded_on" date,
	"last_paid_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_payments_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "recurring_payments_amount_positive" CHECK ("recurring_payments"."amount" > 0),
	CONSTRAINT "recurring_payments_currency_valid" CHECK ("recurring_payments"."currency" in ('PRB', 'USD')),
	CONSTRAINT "recurring_payments_interval_valid" CHECK ("recurring_payments"."interval_unit" in ('day', 'week', 'month', 'year') and "recurring_payments"."interval_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"processing_started_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "telegram_updates_status_valid" CHECK ("telegram_updates"."status" in ('received', 'processing', 'processed', 'failed')),
	CONSTRAINT "telegram_updates_attempt_count_nonnegative" CHECK ("telegram_updates"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weight_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"weight_kg" numeric(7, 3) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_entries_weight_positive" CHECK ("weight_entries"."weight_kg" > 0)
);
--> statement-breakpoint
CREATE TABLE "workout_day_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"workout_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"planned_sets" smallint DEFAULT 3 NOT NULL,
	"target_reps_min" smallint,
	"target_reps_max" smallint,
	"rest_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_day_exercises_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "workout_day_exercises_position_nonnegative" CHECK ("workout_day_exercises"."position" >= 0),
	CONSTRAINT "workout_day_exercises_planned_sets_positive" CHECK ("workout_day_exercises"."planned_sets" > 0),
	CONSTRAINT "workout_day_exercises_target_reps_valid" CHECK (("workout_day_exercises"."target_reps_min" is null or "workout_day_exercises"."target_reps_min" > 0) and ("workout_day_exercises"."target_reps_max" is null or "workout_day_exercises"."target_reps_max" > 0) and ("workout_day_exercises"."target_reps_min" is null or "workout_day_exercises"."target_reps_max" is null or "workout_day_exercises"."target_reps_max" >= "workout_day_exercises"."target_reps_min")),
	CONSTRAINT "workout_day_exercises_rest_nonnegative" CHECK ("workout_day_exercises"."rest_seconds" is null or "workout_day_exercises"."rest_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workout_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekday" smallint,
	"position" smallint DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_days_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "workout_days_position_nonnegative" CHECK ("workout_days"."position" >= 0),
	CONSTRAINT "workout_days_weekday_valid" CHECK ("workout_days"."weekday" is null or "workout_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "workout_session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"workout_day_exercise_id" uuid,
	"exercise_id" uuid NOT NULL,
	"exercise_name" text NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_session_exercises_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "workout_session_exercises_position_nonnegative" CHECK ("workout_session_exercises"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"workout_day_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sessions_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "workout_sessions_status_valid" CHECK ("workout_sessions"."status" in ('active', 'completed', 'cancelled')),
	CONSTRAINT "workout_sessions_completed_at_valid" CHECK (("workout_sessions"."status" = 'completed' and "workout_sessions"."completed_at" is not null) or ("workout_sessions"."status" <> 'completed' and "workout_sessions"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_number" smallint NOT NULL,
	"weight_kg" numeric(8, 3),
	"repetitions" integer,
	"duration_seconds" integer,
	"distance_meters" numeric(10, 2),
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sets_number_positive" CHECK ("workout_sets"."set_number" > 0),
	CONSTRAINT "workout_sets_weight_nonnegative" CHECK ("workout_sets"."weight_kg" is null or "workout_sets"."weight_kg" >= 0),
	CONSTRAINT "workout_sets_repetitions_positive" CHECK ("workout_sets"."repetitions" is null or "workout_sets"."repetitions" > 0),
	CONSTRAINT "workout_sets_duration_nonnegative" CHECK ("workout_sets"."duration_seconds" is null or "workout_sets"."duration_seconds" >= 0),
	CONSTRAINT "workout_sets_distance_nonnegative" CHECK ("workout_sets"."distance_meters" is null or "workout_sets"."distance_meters" >= 0),
	CONSTRAINT "workout_sets_completion_valid" CHECK (("workout_sets"."is_completed" = false and "workout_sets"."completed_at" is null) or ("workout_sets"."is_completed" = true and "workout_sets"."completed_at" is not null and ("workout_sets"."weight_kg" is not null or "workout_sets"."repetitions" is not null or "workout_sets"."duration_seconds" is not null or "workout_sets"."distance_meters" is not null)))
);
--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_drafts" ADD CONSTRAINT "capture_drafts_telegram_update_row_id_telegram_updates_id_fk" FOREIGN KEY ("telegram_update_row_id") REFERENCES "public"."telegram_updates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_capture_owner_fk" FOREIGN KEY ("capture_draft_id","owner_id") REFERENCES "public"."capture_drafts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_account_owner_currency_fk" FOREIGN KEY ("account_id","owner_id","currency") REFERENCES "public"."finance_accounts"("id","owner_id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_category_owner_type_fk" FOREIGN KEY ("category_id","owner_id","entry_type") REFERENCES "public"."finance_categories"("id","owner_id","entry_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_recurring_owner_fk" FOREIGN KEY ("recurring_payment_id","owner_id") REFERENCES "public"."recurring_payments"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_templates" ADD CONSTRAINT "food_templates_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_capture_owner_fk" FOREIGN KEY ("capture_draft_id","owner_id") REFERENCES "public"."capture_drafts"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_account_owner_currency_fk" FOREIGN KEY ("account_id","owner_id","currency") REFERENCES "public"."finance_accounts"("id","owner_id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_drafts" ADD CONSTRAINT "money_drafts_category_owner_type_fk" FOREIGN KEY ("category_id","owner_id","entry_type") REFERENCES "public"."finance_categories"("id","owner_id","entry_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_drafts" ADD CONSTRAINT "nutrition_drafts_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_drafts" ADD CONSTRAINT "nutrition_drafts_capture_owner_fk" FOREIGN KEY ("capture_draft_id","owner_id") REFERENCES "public"."capture_drafts"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entries" ADD CONSTRAINT "nutrition_entries_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entries" ADD CONSTRAINT "nutrition_entries_template_id_food_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."food_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entries" ADD CONSTRAINT "nutrition_entries_capture_owner_fk" FOREIGN KEY ("capture_draft_id","owner_id") REFERENCES "public"."capture_drafts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_account_owner_currency_fk" FOREIGN KEY ("account_id","owner_id","currency") REFERENCES "public"."finance_accounts"("id","owner_id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_category_owner_type_fk" FOREIGN KEY ("category_id","owner_id") REFERENCES "public"."finance_categories"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_day_exercises" ADD CONSTRAINT "workout_day_exercises_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_day_exercises" ADD CONSTRAINT "workout_day_exercises_day_owner_fk" FOREIGN KEY ("workout_day_id","owner_id") REFERENCES "public"."workout_days"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_day_exercises" ADD CONSTRAINT "workout_day_exercises_exercise_owner_fk" FOREIGN KEY ("exercise_id","owner_id") REFERENCES "public"."exercises"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_days" ADD CONSTRAINT "workout_days_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_session_owner_fk" FOREIGN KEY ("session_id","owner_id") REFERENCES "public"."workout_sessions"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_day_item_owner_fk" FOREIGN KEY ("workout_day_exercise_id","owner_id") REFERENCES "public"."workout_day_exercises"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ADD CONSTRAINT "workout_session_exercises_exercise_owner_fk" FOREIGN KEY ("exercise_id","owner_id") REFERENCES "public"."exercises"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_day_owner_fk" FOREIGN KEY ("workout_day_id","owner_id") REFERENCES "public"."workout_days"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_owner_id_owner_settings_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_session_exercise_owner_fk" FOREIGN KEY ("session_exercise_id","owner_id") REFERENCES "public"."workout_session_exercises"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_drafts_owner_status_created_idx" ON "capture_drafts" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_owner_effective_at_unique" ON "exchange_rates" USING btree ("owner_id","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_owner_name_unique" ON "exercises" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "exercises_owner_name_idx" ON "exercises" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_owner_name_unique" ON "finance_accounts" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_one_default_per_owner" ON "finance_accounts" USING btree ("owner_id") WHERE "finance_accounts"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_owner_name_type_unique" ON "finance_categories" USING btree ("owner_id","name","entry_type");--> statement-breakpoint
CREATE INDEX "finance_categories_owner_type_idx" ON "finance_categories" USING btree ("owner_id","entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_entries_capture_unique" ON "finance_entries" USING btree ("capture_draft_id");--> statement-breakpoint
CREATE INDEX "finance_entries_owner_occurred_idx" ON "finance_entries" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_entries_owner_category_occurred_idx" ON "finance_entries" USING btree ("owner_id","category_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "food_templates_owner_name_unique" ON "food_templates" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "money_drafts_capture_unique" ON "money_drafts" USING btree ("capture_draft_id");--> statement-breakpoint
CREATE INDEX "money_drafts_owner_created_idx" ON "money_drafts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_owner_key_unique" ON "notification_deliveries" USING btree ("owner_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_drafts_capture_unique" ON "nutrition_drafts" USING btree ("capture_draft_id");--> statement-breakpoint
CREATE INDEX "nutrition_drafts_owner_created_idx" ON "nutrition_drafts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_entries_capture_unique" ON "nutrition_entries" USING btree ("capture_draft_id");--> statement-breakpoint
CREATE INDEX "nutrition_entries_owner_occurred_idx" ON "nutrition_entries" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_targets_owner_effective_from_unique" ON "nutrition_targets" USING btree ("owner_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_settings_telegram_user_id_unique" ON "owner_settings" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "recurring_payments_owner_due_idx" ON "recurring_payments" USING btree ("owner_id","is_active","next_due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_updates_update_id_unique" ON "telegram_updates" USING btree ("telegram_update_id");--> statement-breakpoint
CREATE INDEX "telegram_updates_owner_received_idx" ON "telegram_updates" USING btree ("owner_id","received_at");--> statement-breakpoint
CREATE INDEX "weight_entries_owner_occurred_idx" ON "weight_entries" USING btree ("owner_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_day_exercises_day_position_unique" ON "workout_day_exercises" USING btree ("workout_day_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_days_owner_position_unique" ON "workout_days" USING btree ("owner_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_session_exercises_session_position_unique" ON "workout_session_exercises" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "workout_sessions_owner_started_idx" ON "workout_sessions" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sets_exercise_number_unique" ON "workout_sets" USING btree ("session_exercise_id","set_number");