import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

/** One Telegram user's LifeOS profile and settings shared by the bot and Mini App. */
export const ownerSettings = pgTable(
  "owner_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramUserId: text("telegram_user_id").notNull(),
    editingCaptureId: uuid("editing_capture_id"),
    aiClarificationHistory: jsonb("ai_clarification_history").$type<{ role: "user" | "assistant"; text: string }[]>(),
    aiClarificationUpdatedAt: timestamp("ai_clarification_updated_at", { withTimezone: true, mode: "date" }),
    aiOnboardingCompleted: boolean("ai_onboarding_completed").default(false).notNull(),
    aiModelQueueInitialized: boolean("ai_model_queue_initialized").default(false).notNull(),
    timezone: text("timezone").default("Europe/Chisinau").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    heightCm: numeric("height_cm", { precision: 6, scale: 2 }),
    activityLevel: text("activity_level"),
    goalType: text("goal_type").default("gain_mass").notNull(),
    sex: text("sex"),
    profileOnboardingCompleted: boolean("profile_onboarding_completed").default(false).notNull(),
    notificationsConfigured: boolean("notifications_configured").default(false).notNull(),
    dailySummaryEnabled: boolean("daily_summary_enabled").default(false).notNull(),
    weeklySummaryEnabled: boolean("weekly_summary_enabled").default(false).notNull(),
    weightReminderEnabled: boolean("weight_reminder_enabled").default(false).notNull(),
    summaryTime: text("summary_time"),
    lastSeenVersion: text("last_seen_version"),
    enabledModules: text("enabled_modules").array().default(sql`ARRAY['nutrition','finance','gym']::text[]`).notNull(),
    modulesConfigured: boolean("modules_configured").default(false).notNull(),
    disabledFeatures: text("disabled_features").array().default(sql`ARRAY[]::text[]`).notNull(),
    /** Currency of the first account; totals, plans and debts are kept in it. Null until the first account. */
    baseCurrency: text("base_currency"),
    financeConfirmationRequired: boolean("finance_confirmation_required").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("owner_settings_telegram_user_id_unique").on(table.telegramUserId),
    check("owner_settings_height_positive", sql`${table.heightCm} is null or ${table.heightCm} > 0`),
  ],
);

/** Per-user BYOK credentials for OpenAI-compatible AI providers. API keys are encrypted at rest. */
export const aiProviderProfiles = pgTable(
  "ai_provider_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    model: text("model").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("ai_provider_profiles_owner_order_idx").on(table.ownerId, table.sortOrder, table.createdAt),
    check("ai_provider_profiles_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

/** One provider account/API key per user; the encrypted credential never leaves server code. */
export const aiProviderAccounts = pgTable(
  "ai_provider_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    authHeaderName: text("auth_header_name").default("authorization").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    freeTierConfirmed: boolean("free_tier_confirmed").default(false).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    models: jsonb("models").$type<{
      id: string;
      name: string;
      supportsImages: boolean;
      contextLength: number | null;
      freeRequestsPerDay: number | null;
      freeRequestsPerMinute: number | null;
      freeTokensPerMinute: number | null;
    }[]>().default([]).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("ai_provider_accounts_owner_provider_order_idx").on(table.ownerId, table.providerId, table.sortOrder, table.createdAt),
    check("ai_provider_accounts_provider_valid", sql`${table.providerId} in ('gemini', 'groq', 'cerebras', 'openrouter', 'custom')`),
    check("ai_provider_accounts_auth_header_valid", sql`${table.authHeaderName} in ('authorization', 'x-goog-api-key')`),
    check("ai_provider_accounts_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

/** User-selected free models are shared across the provider card's connected accounts. */
export const aiProviderModelSelections = pgTable(
  "ai_provider_model_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("ai_provider_model_selections_owner_provider_model_unique").on(table.ownerId, table.providerId, table.modelId),
    index("ai_provider_model_selections_owner_provider_order_idx").on(table.ownerId, table.providerId, table.sortOrder),
    check("ai_provider_model_selections_provider_valid", sql`${table.providerId} in ('gemini', 'groq', 'cerebras', 'openrouter', 'custom')`),
    check("ai_provider_model_selections_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

/** Minimal per-model request counters for the limits screen; no prompt or response data is stored. */
export const aiProviderUsageEvents = pgTable(
  "ai_provider_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => aiProviderAccounts.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    outcome: text("outcome").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_provider_usage_owner_occurred_idx").on(table.ownerId, table.occurredAt),
    index("ai_provider_usage_account_model_occurred_idx").on(table.accountId, table.modelId, table.occurredAt),
    check("ai_provider_usage_outcome_valid", sql`${table.outcome} in ('success', 'failure')`),
  ],
);

/** Persisted Telegram update metadata makes webhook retries idempotent. */
export const telegramUpdates = pgTable(
  "telegram_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    telegramUpdateId: bigint("telegram_update_id", { mode: "number" }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("received").notNull(),
    attemptCount: smallint("attempt_count").default(0).notNull(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true, mode: "date" }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("telegram_updates_update_id_unique").on(table.telegramUpdateId),
    index("telegram_updates_owner_received_idx").on(table.ownerId, table.receivedAt),
    check("telegram_updates_status_valid", sql`${table.status} in ('received', 'processing', 'processed', 'failed')`),
    check("telegram_updates_attempt_count_nonnegative", sql`${table.attemptCount} >= 0`),
  ],
);

/** Fixed-window request counters used by the rate limiter; rows older than two days are purged by the cron job. */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").default(0).notNull(),
  },
  (table) => [
    primaryKey({ name: "rate_limit_counters_pk", columns: [table.key, table.windowStart] }),
    index("rate_limit_counters_window_idx").on(table.windowStart),
    check("rate_limit_counters_count_nonnegative", sql`${table.count} >= 0`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_owner_key_unique").on(table.ownerId, table.key),
  ],
);

/** One row per confirmation action; a combined food + purchase capture shares this id. */
export const captureDrafts = pgTable(
  "capture_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    telegramUpdateRowId: uuid("telegram_update_row_id").references(() => telegramUpdates.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").default("pending").notNull(),
    messageText: text("message_text"),
    /** Id of the bot message showing this draft, so bulk actions can clean it up. */
    telegramMessageId: integer("telegram_message_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("capture_drafts_id_owner_unique").on(table.id, table.ownerId),
    index("capture_drafts_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt),
    check("capture_drafts_kind_valid", sql`${table.kind} in ('nutrition', 'finance', 'combined', 'debt')`),
    check("capture_drafts_status_valid", sql`${table.status} in ('pending', 'confirmed', 'cancelled', 'expired')`),
  ],
);

export const nutritionTargets = pgTable(
  "nutrition_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    calories: numeric("calories", { precision: 9, scale: 2 }).notNull(),
    proteinGrams: numeric("protein_grams", { precision: 9, scale: 3 }).notNull(),
    fatGrams: numeric("fat_grams", { precision: 9, scale: 3 }).notNull(),
    carbsGrams: numeric("carbs_grams", { precision: 9, scale: 3 }).notNull(),
    source: text("source").default("manual").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("nutrition_targets_owner_effective_from_unique").on(table.ownerId, table.effectiveFrom),
    check("nutrition_targets_values_nonnegative", sql`${table.calories} >= 0 and ${table.proteinGrams} >= 0 and ${table.fatGrams} >= 0 and ${table.carbsGrams} >= 0`),
    check("nutrition_targets_source_valid", sql`${table.source} in ('manual', 'suggested')`),
  ],
);

export const nutritionDrafts = pgTable(
  "nutrition_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    captureDraftId: uuid("capture_draft_id").notNull(),
    name: text("name").notNull(),
    composition: text("composition"),
    portionLabel: text("portion_label").notNull(),
    calories: numeric("calories", { precision: 9, scale: 2 }).notNull(),
    proteinGrams: numeric("protein_grams", { precision: 9, scale: 3 }).notNull(),
    fatGrams: numeric("fat_grams", { precision: 9, scale: 3 }).notNull(),
    carbsGrams: numeric("carbs_grams", { precision: 9, scale: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    estimated: boolean("estimated").default(true).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("nutrition_drafts_capture_unique").on(table.captureDraftId),
    foreignKey({
      name: "nutrition_drafts_capture_owner_fk",
      columns: [table.captureDraftId, table.ownerId],
      foreignColumns: [captureDrafts.id, captureDrafts.ownerId],
    }).onDelete("cascade"),
    index("nutrition_drafts_owner_created_idx").on(table.ownerId, table.createdAt),
    check("nutrition_drafts_values_nonnegative", sql`${table.calories} >= 0 and ${table.proteinGrams} >= 0 and ${table.fatGrams} >= 0 and ${table.carbsGrams} >= 0`),
  ],
);

export const foodTemplates = pgTable(
  "food_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    composition: text("composition"),
    portionLabel: text("portion_label").notNull(),
    calories: numeric("calories", { precision: 9, scale: 2 }).notNull(),
    proteinGrams: numeric("protein_grams", { precision: 9, scale: 3 }).notNull(),
    fatGrams: numeric("fat_grams", { precision: 9, scale: 3 }).notNull(),
    carbsGrams: numeric("carbs_grams", { precision: 9, scale: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("food_templates_owner_name_unique").on(table.ownerId, table.name),
    check("food_templates_values_nonnegative", sql`${table.calories} >= 0 and ${table.proteinGrams} >= 0 and ${table.fatGrams} >= 0 and ${table.carbsGrams} >= 0`),
  ],
);

export const nutritionEntries = pgTable(
  "nutrition_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    captureDraftId: uuid("capture_draft_id"),
    templateId: uuid("template_id").references(() => foodTemplates.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    composition: text("composition"),
    portionLabel: text("portion_label").notNull(),
    calories: numeric("calories", { precision: 9, scale: 2 }).notNull(),
    proteinGrams: numeric("protein_grams", { precision: 9, scale: 3 }).notNull(),
    fatGrams: numeric("fat_grams", { precision: 9, scale: 3 }).notNull(),
    carbsGrams: numeric("carbs_grams", { precision: 9, scale: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").default("chat").notNull(),
    estimated: boolean("estimated").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("nutrition_entries_capture_unique").on(table.captureDraftId),
    foreignKey({
      name: "nutrition_entries_capture_owner_fk",
      columns: [table.captureDraftId, table.ownerId],
      foreignColumns: [captureDrafts.id, captureDrafts.ownerId],
    }).onDelete("restrict"),
    index("nutrition_entries_owner_occurred_idx").on(table.ownerId, table.occurredAt),
    check("nutrition_entries_values_nonnegative", sql`${table.calories} >= 0 and ${table.proteinGrams} >= 0 and ${table.fatGrams} >= 0 and ${table.carbsGrams} >= 0`),
    check("nutrition_entries_source_valid", sql`${table.source} in ('chat', 'mini_app', 'template')`),
  ],
);

export const weightEntries = pgTable(
  "weight_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg", { precision: 7, scale: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    index("weight_entries_owner_occurred_idx").on(table.ownerId, table.occurredAt),
    check("weight_entries_weight_positive", sql`${table.weightKg} > 0`),
  ],
);

export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }).default("0").notNull(),
    /** ISO 4217 or custom code, 3-5 uppercase Latin letters (PRB is not ISO). */
    currency: text("currency").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("finance_accounts_owner_name_unique").on(table.ownerId, table.name),
    unique("finance_accounts_id_owner_currency_unique").on(table.id, table.ownerId, table.currency),
    uniqueIndex("finance_accounts_one_default_per_owner").on(table.ownerId).where(sql`${table.isDefault}`),
    check("finance_accounts_currency_valid", sql`${table.currency} ~ '^[A-Z]{3,5}$'`),
  ],
);

export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entryType: text("entry_type").notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("finance_categories_owner_name_type_unique").on(table.ownerId, table.name, table.entryType),
    unique("finance_categories_id_owner_type_unique").on(table.id, table.ownerId, table.entryType),
    unique("finance_categories_id_owner_unique").on(table.id, table.ownerId),
    index("finance_categories_owner_type_idx").on(table.ownerId, table.entryType),
    check("finance_categories_entry_type_valid", sql`${table.entryType} in ('expense', 'income')`),
  ],
);

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    rateToBase: numeric("rate_to_base", { precision: 12, scale: 6 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("exchange_rates_owner_currency_effective_at_unique").on(table.ownerId, table.currency, table.effectiveAt),
    check("exchange_rates_rate_positive", sql`${table.rateToBase} > 0`),
    check("exchange_rates_currency_valid", sql`${table.currency} ~ '^[A-Z]{3,5}$'`),
  ],
);

export const recurringPayments = pgTable(
  "recurring_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    nextDueOn: date("next_due_on", { mode: "string" }).notNull(),
    anchorDay: smallint("anchor_day").notNull(),
    anchorMonth: smallint("anchor_month").notNull(),
    intervalUnit: text("interval_unit").notNull(),
    intervalCount: smallint("interval_count").default(1).notNull(),
    reminderEnabled: boolean("reminder_enabled").default(true).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastRemindedOn: date("last_reminded_on", { mode: "string" }),
    lastPaidOn: date("last_paid_on", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("recurring_payments_id_owner_unique").on(table.id, table.ownerId),
    foreignKey({
      name: "recurring_payments_account_owner_currency_fk",
      columns: [table.accountId, table.ownerId, table.currency],
      foreignColumns: [financeAccounts.id, financeAccounts.ownerId, financeAccounts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "recurring_payments_category_owner_type_fk",
      columns: [table.categoryId, table.ownerId],
      foreignColumns: [financeCategories.id, financeCategories.ownerId],
    }).onDelete("restrict"),
    index("recurring_payments_owner_due_idx").on(table.ownerId, table.isActive, table.nextDueOn),
    check("recurring_payments_amount_positive", sql`${table.amount} > 0`),
    check("recurring_payments_currency_valid", sql`${table.currency} ~ '^[A-Z]{3,5}$'`),
    check("recurring_payments_interval_valid", sql`${table.intervalUnit} in ('day', 'week', 'month', 'year') and ${table.intervalCount} > 0`),
    check("recurring_payments_anchor_day_valid", sql`${table.anchorDay} between 1 and 31`),
    check("recurring_payments_anchor_month_valid", sql`${table.anchorMonth} between 1 and 12`),
  ],
);

export const moneyDrafts = pgTable(
  "money_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    captureDraftId: uuid("capture_draft_id").notNull(),
    accountId: uuid("account_id"),
    categoryId: uuid("category_id"),
    proposedCategory: text("proposed_category"),
    entryType: text("entry_type").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    rateToBase: numeric("rate_to_base", { precision: 12, scale: 6 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("money_drafts_capture_unique").on(table.captureDraftId),
    foreignKey({
      name: "money_drafts_capture_owner_fk",
      columns: [table.captureDraftId, table.ownerId],
      foreignColumns: [captureDrafts.id, captureDrafts.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "money_drafts_account_owner_currency_fk",
      columns: [table.accountId, table.ownerId, table.currency],
      foreignColumns: [financeAccounts.id, financeAccounts.ownerId, financeAccounts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "money_drafts_category_owner_type_fk",
      columns: [table.categoryId, table.ownerId, table.entryType],
      foreignColumns: [financeCategories.id, financeCategories.ownerId, financeCategories.entryType],
    }).onDelete("restrict"),
    index("money_drafts_owner_created_idx").on(table.ownerId, table.createdAt),
    check("money_drafts_entry_type_valid", sql`${table.entryType} in ('expense', 'income')`),
    check("money_drafts_amount_positive", sql`${table.amount} > 0`),
    check("money_drafts_currency_valid", sql`${table.currency} ~ '^[A-Z]{3,5}$'`),
    check("money_drafts_rate_positive", sql`${table.rateToBase} is null or ${table.rateToBase} > 0`),
  ],
);

/** Confirmed income and expenses; non-base currencies keep the rate captured for that operation. */
export const financeEntries = pgTable(
  "finance_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    captureDraftId: uuid("capture_draft_id"),
    accountId: uuid("account_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    recurringPaymentId: uuid("recurring_payment_id"),
    entryType: text("entry_type").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    rateToBase: numeric("rate_to_base", { precision: 12, scale: 6 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").default("chat").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("finance_entries_capture_unique").on(table.captureDraftId),
    foreignKey({
      name: "finance_entries_capture_owner_fk",
      columns: [table.captureDraftId, table.ownerId],
      foreignColumns: [captureDrafts.id, captureDrafts.ownerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "finance_entries_account_owner_currency_fk",
      columns: [table.accountId, table.ownerId, table.currency],
      foreignColumns: [financeAccounts.id, financeAccounts.ownerId, financeAccounts.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "finance_entries_category_owner_type_fk",
      columns: [table.categoryId, table.ownerId, table.entryType],
      foreignColumns: [financeCategories.id, financeCategories.ownerId, financeCategories.entryType],
    }).onDelete("restrict"),
    foreignKey({
      name: "finance_entries_recurring_owner_fk",
      columns: [table.recurringPaymentId, table.ownerId],
      foreignColumns: [recurringPayments.id, recurringPayments.ownerId],
    }).onDelete("restrict"),
    index("finance_entries_owner_occurred_idx").on(table.ownerId, table.occurredAt),
    index("finance_entries_owner_category_occurred_idx").on(table.ownerId, table.categoryId, table.occurredAt),
    check("finance_entries_entry_type_valid", sql`${table.entryType} in ('expense', 'income')`),
    check("finance_entries_amount_positive", sql`${table.amount} > 0`),
    check("finance_entries_currency_valid", sql`${table.currency} ~ '^[A-Z]{3,5}$'`),
    check("finance_entries_rate_positive", sql`${table.rateToBase} is null or ${table.rateToBase} > 0`),
    check("finance_entries_source_valid", sql`${table.source} in ('chat', 'mini_app', 'recurring')`),
  ],
);

/** Planned purchases are separate from actual expenses and are always in the base currency. */
export const financePlans = pgTable(
  "finance_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("finance_plans_id_owner_unique").on(table.id, table.ownerId),
    index("finance_plans_owner_created_idx").on(table.ownerId, table.createdAt),
    check("finance_plans_amount_positive", sql`${table.amount} > 0`),
  ],
);

/** Open and closed personal debts; old balances are recorded without backdating finance. */
export const financeDebts = pgTable(
  "finance_debts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    direction: text("direction").notNull(),
    originalAmount: numeric("original_amount", { precision: 18, scale: 4 }).notNull(),
    openedAs: text("opened_as").notNull(),
    dueOn: date("due_on", { mode: "string" }),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("finance_debts_id_owner_unique").on(table.id, table.ownerId),
    index("finance_debts_owner_direction_due_idx").on(table.ownerId, table.direction, table.dueOn),
    check("finance_debts_person_nonempty", sql`length(trim(${table.personName})) > 0`),
    check("finance_debts_direction_valid", sql`${table.direction} in ('i_owe', 'owed_to_me')`),
    check("finance_debts_opened_as_valid", sql`${table.openedAs} in ('transfer', 'opening_balance')`),
    check("finance_debts_amount_positive", sql`${table.originalAmount} > 0`),
  ],
);

/** Each partial repayment is a separate row linked to its actual finance operation. */
export const financeDebtRepayments = pgTable(
  "finance_debt_repayments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    debtId: uuid("debt_id").notNull().references(() => financeDebts.id, { onDelete: "cascade" }),
    financeEntryId: uuid("finance_entry_id").notNull().references(() => financeEntries.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("finance_debt_repayments_owner_debt_idx").on(table.ownerId, table.debtId, table.occurredAt),
    check("finance_debt_repayments_amount_positive", sql`${table.amount} > 0`),
  ],
);

/** Explicit bot confirmation drafts for creating a debt or recording a repayment. */
export const financeDebtDrafts = pgTable(
  "finance_debt_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    captureDraftId: uuid("capture_draft_id").notNull(),
    operation: text("operation").notNull(),
    personName: text("person_name").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    openedAs: text("opened_as"),
    debtId: uuid("debt_id").references(() => financeDebts.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").references(() => financeAccounts.id, { onDelete: "restrict" }),
    dueOn: date("due_on", { mode: "string" }),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("finance_debt_drafts_capture_unique").on(table.captureDraftId),
    foreignKey({
      name: "finance_debt_drafts_capture_owner_fk",
      columns: [table.captureDraftId, table.ownerId],
      foreignColumns: [captureDrafts.id, captureDrafts.ownerId],
    }).onDelete("cascade"),
    index("finance_debt_drafts_owner_created_idx").on(table.ownerId, table.createdAt),
    check("finance_debt_drafts_operation_valid", sql`${table.operation} in ('create', 'repayment')`),
    check("finance_debt_drafts_direction_valid", sql`${table.direction} in ('i_owe', 'owed_to_me')`),
    check("finance_debt_drafts_amount_positive", sql`${table.amount} > 0`),
    check("finance_debt_drafts_fields_match_operation", sql`(${table.operation} = 'create' and ${table.openedAs} in ('transfer', 'opening_balance') and ${table.debtId} is null) or (${table.operation} = 'repayment' and ${table.openedAs} is null and ${table.debtId} is not null)`),
    check("finance_debt_drafts_account_match_operation", sql`(${table.openedAs} = 'opening_balance' and ${table.accountId} is null) or (${table.openedAs} = 'transfer' and ${table.accountId} is not null) or (${table.operation} = 'repayment' and ${table.accountId} is not null)`),
  ],
);

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    muscleGroup: text("muscle_group"),
    equipment: text("equipment"),
    instructions: text("instructions"),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("exercises_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("exercises_owner_name_unique").on(table.ownerId, table.name),
    index("exercises_owner_name_idx").on(table.ownerId, table.name),
  ],
);

export const workoutDays = pgTable(
  "workout_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    weekday: smallint("weekday"),
    position: smallint("position").default(0).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("workout_days_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("workout_days_owner_position_unique").on(table.ownerId, table.position),
    check("workout_days_position_nonnegative", sql`${table.position} >= 0`),
    check("workout_days_weekday_valid", sql`${table.weekday} is null or ${table.weekday} between 0 and 6`),
  ],
);

export const workoutDayExercises = pgTable(
  "workout_day_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    workoutDayId: uuid("workout_day_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    position: smallint("position").default(0).notNull(),
    plannedSets: smallint("planned_sets").default(3).notNull(),
    targetRepsMin: smallint("target_reps_min"),
    targetRepsMax: smallint("target_reps_max"),
    restSeconds: integer("rest_seconds"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("workout_day_exercises_id_owner_unique").on(table.id, table.ownerId),
    foreignKey({
      name: "workout_day_exercises_day_owner_fk",
      columns: [table.workoutDayId, table.ownerId],
      foreignColumns: [workoutDays.id, workoutDays.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "workout_day_exercises_exercise_owner_fk",
      columns: [table.exerciseId, table.ownerId],
      foreignColumns: [exercises.id, exercises.ownerId],
    }).onDelete("restrict"),
    uniqueIndex("workout_day_exercises_day_position_unique").on(table.workoutDayId, table.position),
    check("workout_day_exercises_position_nonnegative", sql`${table.position} >= 0`),
    check("workout_day_exercises_planned_sets_positive", sql`${table.plannedSets} > 0`),
    check("workout_day_exercises_target_reps_valid", sql`(${table.targetRepsMin} is null or ${table.targetRepsMin} > 0) and (${table.targetRepsMax} is null or ${table.targetRepsMax} > 0) and (${table.targetRepsMin} is null or ${table.targetRepsMax} is null or ${table.targetRepsMax} >= ${table.targetRepsMin})`),
    check("workout_day_exercises_rest_nonnegative", sql`${table.restSeconds} is null or ${table.restSeconds} >= 0`),
  ],
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    workoutDayId: uuid("workout_day_id"),
    name: text("name").notNull(),
    status: text("status").default("active").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("workout_sessions_id_owner_unique").on(table.id, table.ownerId),
    foreignKey({
      name: "workout_sessions_day_owner_fk",
      columns: [table.workoutDayId, table.ownerId],
      foreignColumns: [workoutDays.id, workoutDays.ownerId],
    }).onDelete("restrict"),
    index("workout_sessions_owner_started_idx").on(table.ownerId, table.startedAt),
    check("workout_sessions_status_valid", sql`${table.status} in ('active', 'completed', 'cancelled')`),
    check("workout_sessions_completed_at_valid", sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`),
  ],
);

export const workoutSessionExercises = pgTable(
  "workout_session_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    workoutDayExerciseId: uuid("workout_day_exercise_id"),
    exerciseId: uuid("exercise_id").notNull(),
    exerciseName: text("exercise_name").notNull(),
    position: smallint("position").default(0).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("workout_session_exercises_id_owner_unique").on(table.id, table.ownerId),
    foreignKey({
      name: "workout_session_exercises_session_owner_fk",
      columns: [table.sessionId, table.ownerId],
      foreignColumns: [workoutSessions.id, workoutSessions.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "workout_session_exercises_day_item_owner_fk",
      columns: [table.workoutDayExerciseId, table.ownerId],
      foreignColumns: [workoutDayExercises.id, workoutDayExercises.ownerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "workout_session_exercises_exercise_owner_fk",
      columns: [table.exerciseId, table.ownerId],
      foreignColumns: [exercises.id, exercises.ownerId],
    }).onDelete("restrict"),
    uniqueIndex("workout_session_exercises_session_position_unique").on(table.sessionId, table.position),
    check("workout_session_exercises_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => ownerSettings.id, { onDelete: "cascade" }),
    sessionExerciseId: uuid("session_exercise_id").notNull(),
    setNumber: smallint("set_number").notNull(),
    weightKg: numeric("weight_kg", { precision: 8, scale: 3 }),
    repetitions: integer("repetitions"),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: numeric("distance_meters", { precision: 10, scale: 2 }),
    isCompleted: boolean("is_completed").default(false).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "workout_sets_session_exercise_owner_fk",
      columns: [table.sessionExerciseId, table.ownerId],
      foreignColumns: [workoutSessionExercises.id, workoutSessionExercises.ownerId],
    }).onDelete("cascade"),
    uniqueIndex("workout_sets_exercise_number_unique").on(table.sessionExerciseId, table.setNumber),
    check("workout_sets_number_positive", sql`${table.setNumber} > 0`),
    check("workout_sets_weight_nonnegative", sql`${table.weightKg} is null or ${table.weightKg} >= 0`),
    check("workout_sets_repetitions_positive", sql`${table.repetitions} is null or ${table.repetitions} > 0`),
    check("workout_sets_duration_nonnegative", sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`),
    check("workout_sets_distance_nonnegative", sql`${table.distanceMeters} is null or ${table.distanceMeters} >= 0`),
    check("workout_sets_completion_valid", sql`(${table.isCompleted} = false and ${table.completedAt} is null) or (${table.isCompleted} = true and ${table.completedAt} is not null and (${table.weightKg} is not null or ${table.repetitions} is not null or ${table.durationSeconds} is not null or ${table.distanceMeters} is not null))`),
  ],
);
