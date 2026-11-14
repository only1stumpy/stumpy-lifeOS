import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  BACKUP_VERSION,
  createBackup,
  restoreBackup,
  validateBackup,
  type BackupDatabase,
} from "@/server/backup";
import { setPendingMoneyDraftCategory } from "@/server/lifeos";
import type { Transaction } from "@/db/client";

const OWNER_ID = "123456789";
const OWNER_UUID = "10000000-0000-4000-8000-000000000001";
const UPDATE_UUID = "20000000-0000-4000-8000-000000000001";
const CAPTURE_UUID = "30000000-0000-4000-8000-000000000001";
const DEBT_CAPTURE_UUID = "30000000-0000-4000-8000-000000000002";
const REPAYMENT_CAPTURE_UUID = "30000000-0000-4000-8000-000000000003";
const TEMPLATE_UUID = "40000000-0000-4000-8000-000000000001";
const FOOD_UUID = "50000000-0000-4000-8000-000000000001";
const ACCOUNT_PRB_UUID = "60000000-0000-4000-8000-000000000001";
const ACCOUNT_USD_UUID = "60000000-0000-4000-8000-000000000002";
const CATEGORY_UUID = "70000000-0000-4000-8000-000000000001";
const RECURRING_UUID = "80000000-0000-4000-8000-000000000001";
const EXERCISE_UUID = "90000000-0000-4000-8000-000000000001";
const DAY_UUID = "a0000000-0000-4000-8000-000000000001";
const DAY_EXERCISE_UUID = "b0000000-0000-4000-8000-000000000001";
const SESSION_UUID = "c0000000-0000-4000-8000-000000000001";
const SESSION_EXERCISE_UUID = "d0000000-0000-4000-8000-000000000001";
const DEBT_UUID = "e0000000-0000-4000-8000-000000000001";
const DEBT_REPAYMENT_ENTRY_UUID = "f0000000-0000-4000-8000-000000000001";

async function migrationNames() {
  const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  return (await readdir(directory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
}

async function applyMigration(database: PGlite, name: string) {
  const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await database.exec(statement);
  }
}

async function migrate(database: PGlite) {
  for (const name of await migrationNames()) {
    await applyMigration(database, name);
  }
}

function asBackupDatabase(database: ReturnType<typeof drizzle>): BackupDatabase {
  return database as unknown as BackupDatabase;
}

test("recurring payment migration backfills anchors from existing due dates", async () => {
  const client = new PGlite();

  try {
    const migrations = await migrationNames();
    assert.ok(migrations.length >= 3);
    await applyMigration(client, migrations[0]);
    await client.exec(`
      INSERT INTO owner_settings (id, telegram_user_id)
      VALUES ('10000000-0000-4000-8000-000000000001', '123456789');
      INSERT INTO finance_accounts (id, owner_id, name, currency)
      VALUES ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Основной', 'PRB');
      INSERT INTO finance_categories (id, owner_id, name, entry_type)
      VALUES ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Связь', 'expense');
      INSERT INTO recurring_payments (id, owner_id, account_id, category_id, name, amount, currency, next_due_on, interval_unit)
      VALUES ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Подписка', 10, 'PRB', '2026-01-31', 'month');
    `);
    await applyMigration(client, migrations[1]);
    await applyMigration(client, migrations[2]!);

    const result = await client.query(
      "SELECT anchor_day, anchor_month FROM recurring_payments WHERE id = '80000000-0000-4000-8000-000000000001'",
    );
    assert.deepEqual(result.rows[0], { anchor_day: 31, anchor_month: 1 });
  } finally {
    await client.close();
  }
});

test("multi-currency migration keeps rates and entries and makes PRB the base of existing owners", async () => {
  const client = new PGlite();
  try {
    const migrations = await migrationNames();
    const last = migrations.findIndex((name) => name.startsWith("0012_"));
    assert.ok(last > 0);
    for (const name of migrations.slice(0, last)) await applyMigration(client, name);
    await client.exec(`
      INSERT INTO owner_settings (id, telegram_user_id) VALUES
        ('10000000-0000-4000-8000-000000000001', '111'),
        ('10000000-0000-4000-8000-000000000002', '222');
      INSERT INTO finance_accounts (id, owner_id, name, currency) VALUES
        ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Основной', 'PRB'),
        ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Карта', 'USD');
      INSERT INTO finance_categories (id, owner_id, name, entry_type)
        VALUES ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Еда', 'expense');
      INSERT INTO exchange_rates (owner_id, usd_to_prb_rate, effective_at)
        VALUES ('10000000-0000-4000-8000-000000000001', 16.2, '2026-10-01T00:00:00Z');
      INSERT INTO finance_entries (owner_id, account_id, category_id, entry_type, name, amount, currency, usd_to_prb_rate, occurred_at) VALUES
        ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'expense', 'Кофе', 5, 'USD', 16.2, '2026-10-02T00:00:00Z'),
        ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'expense', 'Хлеб', 20, 'PRB', NULL, '2026-10-02T00:00:00Z');
    `);
    await applyMigration(client, migrations[last]!);

    const owners = await client.query("SELECT telegram_user_id, base_currency FROM owner_settings ORDER BY telegram_user_id");
    assert.deepEqual(owners.rows, [{ telegram_user_id: "111", base_currency: "PRB" }, { telegram_user_id: "222", base_currency: null }]);
    const rates = await client.query("SELECT currency, rate_to_base::text AS rate FROM exchange_rates");
    assert.deepEqual(rates.rows, [{ currency: "USD", rate: "16.200000" }]);
    const entries = await client.query("SELECT currency, rate_to_base::text AS rate FROM finance_entries ORDER BY currency DESC");
    assert.deepEqual(entries.rows, [{ currency: "USD", rate: "16.200000" }, { currency: "PRB", rate: null }]);
    await client.exec("INSERT INTO finance_accounts (owner_id, name, currency) VALUES ('10000000-0000-4000-8000-000000000002', 'Евро', 'EUR')");
    await assert.rejects(client.exec("INSERT INTO finance_accounts (owner_id, name, currency) VALUES ('10000000-0000-4000-8000-000000000002', 'Плохой', 'eur')"));
  } finally {
    await client.close();
  }
});

test("draft message id column is added empty and accepts a Telegram message id", async () => {
  const client = new PGlite();
  try {
    await migrate(client);
    await client.exec(`
      INSERT INTO owner_settings (id, telegram_user_id) VALUES ('10000000-0000-4000-8000-000000000009', '999');
      INSERT INTO capture_drafts (id, owner_id, kind) VALUES ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000009', 'finance');
    `);
    const before = await client.query("SELECT telegram_message_id FROM capture_drafts");
    assert.deepEqual(before.rows, [{ telegram_message_id: null }]);
    await client.exec("UPDATE capture_drafts SET telegram_message_id = 4242");
    const after = await client.query("SELECT telegram_message_id FROM capture_drafts");
    assert.deepEqual(after.rows, [{ telegram_message_id: 4242 }]);
  } finally {
    await client.close();
  }
});

test("clarification history is owner-scoped JSON text with a separate expiry timestamp", async () => {
  const client = new PGlite();
  try {
    await migrate(client);
    const database = drizzle(client, { schema });
    await database.insert(schema.ownerSettings).values({ id: OWNER_UUID, telegramUserId: OWNER_ID });
    const updatedAt = new Date("2026-10-28T06:00:00.000Z");
    await database.update(schema.ownerSettings).set({
      aiClarificationHistory: [
        { role: "user", text: "у меня на счету 742р" },
        { role: "assistant", text: "Это доход или остаток?" },
      ],
      aiClarificationUpdatedAt: updatedAt,
    }).where(eq(schema.ownerSettings.id, OWNER_UUID));

    const [owner] = await database.select().from(schema.ownerSettings).where(eq(schema.ownerSettings.telegramUserId, OWNER_ID));
    assert.deepEqual(owner?.aiClarificationHistory, [
      { role: "user", text: "у меня на счету 742р" },
      { role: "assistant", text: "Это доход или остаток?" },
    ]);
    assert.equal(owner?.aiClarificationUpdatedAt?.toISOString(), updatedAt.toISOString());
  } finally {
    await client.close();
  }
});

test("уточнение категории меняет только категорию pending income-черновика и не записывает доход", async () => {
  const client = new PGlite();
  try {
    await migrate(client);
    const database = drizzle(client, { schema });
    const occurredAt = new Date("2026-10-28T06:04:00.000Z");
    await database.insert(schema.ownerSettings).values({ id: OWNER_UUID, telegramUserId: OWNER_ID });
    await database.insert(schema.financeAccounts).values({
      id: ACCOUNT_PRB_UUID,
      ownerId: OWNER_UUID,
      name: "Основной",
      currency: "PRB",
      isDefault: true,
    });
    await database.insert(schema.captureDrafts).values({
      id: CAPTURE_UUID,
      ownerId: OWNER_UUID,
      kind: "finance",
      status: "pending",
      messageText: "доход",
    });
    await database.insert(schema.moneyDrafts).values({
      ownerId: OWNER_UUID,
      captureDraftId: CAPTURE_UUID,
      accountId: ACCOUNT_PRB_UUID,
      proposedCategory: null,
      categoryId: null,
      entryType: "income",
      name: "Доход",
      amount: "742.0000",
      currency: "PRB",
      occurredAt,
    });

    await database.transaction((tx) => setPendingMoneyDraftCategory(
      tx as unknown as Transaction,
      OWNER_UUID,
      CAPTURE_UUID,
      "Зарплата",
    ));

    const [money] = await database.select().from(schema.moneyDrafts)
      .where(eq(schema.moneyDrafts.captureDraftId, CAPTURE_UUID));
    const [capture] = await database.select().from(schema.captureDrafts)
      .where(eq(schema.captureDrafts.id, CAPTURE_UUID));
    const [category] = await database.select().from(schema.financeCategories)
      .where(and(eq(schema.financeCategories.id, money!.categoryId!), eq(schema.financeCategories.ownerId, OWNER_UUID)));
    const entries = await database.select().from(schema.financeEntries)
      .where(eq(schema.financeEntries.captureDraftId, CAPTURE_UUID));

    assert.equal(category?.name, "Зарплата");
    assert.equal(category?.entryType, "income");
    assert.equal(money?.name, "Доход");
    assert.equal(money?.amount, "742.0000");
    assert.equal(money?.currency, "PRB");
    assert.equal(money?.entryType, "income");
    assert.equal(money?.accountId, ACCOUNT_PRB_UUID);
    assert.equal(money?.occurredAt.toISOString(), occurredAt.toISOString());
    assert.equal(capture?.status, "pending");
    assert.equal(entries.length, 0);
    await assert.rejects(
      database.transaction((tx) => setPendingMoneyDraftCategory(
        tx as unknown as Transaction,
        "20000000-0000-4000-8000-000000000099",
        CAPTURE_UUID,
        "Не владелец",
      )),
      /Черновик не найден/,
    );
    await database.update(schema.captureDrafts).set({ status: "cancelled" })
      .where(eq(schema.captureDrafts.id, CAPTURE_UUID));
    await assert.rejects(
      database.transaction((tx) => setPendingMoneyDraftCategory(
        tx as unknown as Transaction,
        OWNER_UUID,
        CAPTURE_UUID,
        "Другая категория",
      )),
      /Черновик уже отменён/,
    );
  } finally {
    await client.close();
  }
});

async function seed(database: ReturnType<typeof drizzle>) {
  await database.insert(schema.ownerSettings).values({
    id: OWNER_UUID,
    telegramUserId: OWNER_ID,
    editingCaptureId: CAPTURE_UUID,
    timezone: "Europe/Chisinau",
    dateOfBirth: "1996-08-09",
    heightCm: "181.75",
    activityLevel: "moderate",
    goalType: "gain_mass",
    financeConfirmationRequired: true,
  });
  await database.insert(schema.telegramUpdates).values({
    id: UPDATE_UUID,
    ownerId: OWNER_UUID,
    telegramUpdateId: 77,
    payload: { type: "message", text: "ephemeral" },
    status: "processed",
    attemptCount: 1,
  });
  await database.insert(schema.notificationDeliveries).values({ ownerId: OWNER_UUID, key: "daily:2026-10-27" });
  await database.insert(schema.captureDrafts).values({
    id: CAPTURE_UUID,
    ownerId: OWNER_UUID,
    telegramUpdateRowId: UPDATE_UUID,
    kind: "combined",
    status: "confirmed",
    messageText: "гречка и обед за 80 рублей",
    expiresAt: new Date("2026-10-27T16:00:00.123Z"),
    confirmedAt: new Date("2026-10-27T15:30:00.456Z"),
  });
  await database.insert(schema.captureDrafts).values([
    {
      id: DEBT_CAPTURE_UUID,
      ownerId: OWNER_UUID,
      kind: "debt",
      status: "pending",
      messageText: "старый долг Ивану 100",
    },
    {
      id: REPAYMENT_CAPTURE_UUID,
      ownerId: OWNER_UUID,
      kind: "debt",
      status: "pending",
      messageText: "вернул Ивану 25",
    },
  ]);
  await database.insert(schema.nutritionTargets).values({
    ownerId: OWNER_UUID,
    effectiveFrom: "2026-10-01",
    calories: "2650.25",
    proteinGrams: "140.125",
    fatGrams: "75.500",
    carbsGrams: "350.375",
    source: "manual",
  });
  await database.insert(schema.foodTemplates).values({
    id: TEMPLATE_UUID,
    ownerId: OWNER_UUID,
    name: "Гречка с говядиной",
    composition: "гречка, говядина",
    portionLabel: "обычная тарелка",
    calories: "650.25",
    proteinGrams: "35.125",
    fatGrams: "22.250",
    carbsGrams: "78.875",
  });
  await database.insert(schema.nutritionEntries).values({
    id: FOOD_UUID,
    ownerId: OWNER_UUID,
    captureDraftId: CAPTURE_UUID,
    templateId: TEMPLATE_UUID,
    name: "Гречка с говядиной",
    composition: "гречка, говядина",
    portionLabel: "обычная тарелка",
    calories: "650.25",
    proteinGrams: "35.125",
    fatGrams: "22.250",
    carbsGrams: "78.875",
    occurredAt: new Date("2026-10-27T12:34:56.789Z"),
    source: "template",
    estimated: true,
  });
  await database.insert(schema.nutritionDrafts).values({
    ownerId: OWNER_UUID,
    captureDraftId: CAPTURE_UUID,
    name: "Удон",
    composition: "лапша, соус",
    portionLabel: "миска",
    calories: "480.75",
    proteinGrams: "16.500",
    fatGrams: "12.250",
    carbsGrams: "70.125",
    occurredAt: new Date("2026-10-27T13:00:00.123Z"),
    estimated: true,
  });
  await database.insert(schema.weightEntries).values({
    ownerId: OWNER_UUID,
    weightKg: "80.125",
    occurredAt: new Date("2026-10-27T07:10:11.222Z"),
    note: "утро",
  });
  await database.insert(schema.financeAccounts).values([
    { id: ACCOUNT_PRB_UUID, ownerId: OWNER_UUID, name: "Основной", openingBalance: "1234.56", currency: "PRB", isDefault: true },
    { id: ACCOUNT_USD_UUID, ownerId: OWNER_UUID, name: "USD", openingBalance: "25.10", currency: "USD" },
  ]);
  await database.insert(schema.financeCategories).values({ id: CATEGORY_UUID, ownerId: OWNER_UUID, name: "Еда", entryType: "expense" });
  await database.insert(schema.exchangeRates).values({
    ownerId: OWNER_UUID,
    currency: "USD", rateToBase: "36.123456",
    effectiveAt: new Date("2026-10-27T10:00:00.654Z"),
  });
  await database.insert(schema.recurringPayments).values({
    id: RECURRING_UUID,
    ownerId: OWNER_UUID,
    accountId: ACCOUNT_PRB_UUID,
    categoryId: CATEGORY_UUID,
    name: "Телефон",
    amount: "125.0000",
    currency: "PRB",
    nextDueOn: "2026-11-01",
    anchorDay: 1,
    anchorMonth: 11,
    intervalUnit: "month",
    intervalCount: 1,
  });
  await database.insert(schema.moneyDrafts).values({
    ownerId: OWNER_UUID,
    captureDraftId: CAPTURE_UUID,
    accountId: ACCOUNT_USD_UUID,
    categoryId: CATEGORY_UUID,
    proposedCategory: "Еда",
    entryType: "expense",
    name: "Кафе",
    amount: "4.2500",
    currency: "USD",
    rateToBase: "36.123456",
    occurredAt: new Date("2026-10-27T14:00:00.111Z"),
  });
  await database.insert(schema.financeEntries).values({
    ownerId: OWNER_UUID,
    captureDraftId: CAPTURE_UUID,
    accountId: ACCOUNT_PRB_UUID,
    categoryId: CATEGORY_UUID,
    recurringPaymentId: RECURRING_UUID,
    entryType: "expense",
    name: "Телефон",
    amount: "125.0000",
    currency: "PRB",
    rateToBase: null,
    occurredAt: new Date("2026-10-27T14:10:12.333Z"),
    source: "recurring",
  });
  await database.insert(schema.financeDebts).values({
    id: DEBT_UUID,
    ownerId: OWNER_UUID,
    personName: "Ивану",
    direction: "i_owe",
    originalAmount: "100.0000",
    openedAs: "opening_balance",
    dueOn: "2026-11-15",
    note: "старый долг",
  });
  await database.insert(schema.financeEntries).values({
    id: DEBT_REPAYMENT_ENTRY_UUID,
    ownerId: OWNER_UUID,
    accountId: ACCOUNT_PRB_UUID,
    categoryId: CATEGORY_UUID,
    entryType: "expense",
    name: "Вернул Ивану",
    amount: "25.0000",
    currency: "PRB",
    rateToBase: null,
    occurredAt: new Date("2026-10-28T14:00:00.000Z"),
    source: "mini_app",
  });
  await database.insert(schema.financeDebtRepayments).values({
    ownerId: OWNER_UUID,
    debtId: DEBT_UUID,
    financeEntryId: DEBT_REPAYMENT_ENTRY_UUID,
    amount: "25.0000",
    occurredAt: new Date("2026-10-28T14:00:00.000Z"),
  });
  await database.insert(schema.financeDebtDrafts).values([
    {
      ownerId: OWNER_UUID,
      captureDraftId: DEBT_CAPTURE_UUID,
      operation: "create",
      personName: "Ивану",
      direction: "i_owe",
      amount: "100.0000",
      openedAs: "opening_balance",
      debtId: null,
      accountId: null,
      dueOn: "2026-11-15",
      note: "старый долг",
      occurredAt: new Date("2026-10-27T14:00:00.000Z"),
    },
    {
      ownerId: OWNER_UUID,
      captureDraftId: REPAYMENT_CAPTURE_UUID,
      operation: "repayment",
      personName: "Ивану",
      direction: "i_owe",
      amount: "10.0000",
      openedAs: null,
      debtId: DEBT_UUID,
      accountId: ACCOUNT_PRB_UUID,
      dueOn: null,
      note: null,
      occurredAt: new Date("2026-10-29T09:00:00.000Z"),
    },
  ]);
  await database.insert(schema.exercises).values({ id: EXERCISE_UUID, ownerId: OWNER_UUID, name: "Жим лёжа", muscleGroup: "грудь", equipment: "штанга" });
  await database.insert(schema.workoutDays).values({ id: DAY_UUID, ownerId: OWNER_UUID, name: "Верх тела", weekday: 1, position: 0 });
  await database.insert(schema.workoutDayExercises).values({
    id: DAY_EXERCISE_UUID,
    ownerId: OWNER_UUID,
    workoutDayId: DAY_UUID,
    exerciseId: EXERCISE_UUID,
    position: 0,
    plannedSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    restSeconds: 120,
  });
  await database.insert(schema.workoutSessions).values({
    id: SESSION_UUID,
    ownerId: OWNER_UUID,
    workoutDayId: DAY_UUID,
    name: "Верх тела",
    status: "completed",
    startedAt: new Date("2026-10-26T15:00:00.111Z"),
    completedAt: new Date("2026-10-26T16:00:00.222Z"),
    notes: "хорошая тренировка",
  });
  await database.insert(schema.workoutSessionExercises).values({
    id: SESSION_EXERCISE_UUID,
    ownerId: OWNER_UUID,
    sessionId: SESSION_UUID,
    workoutDayExerciseId: DAY_EXERCISE_UUID,
    exerciseId: EXERCISE_UUID,
    exerciseName: "Жим лёжа",
    position: 0,
  });
  await database.insert(schema.workoutSets).values({
    ownerId: OWNER_UUID,
    sessionExerciseId: SESSION_EXERCISE_UUID,
    setNumber: 1,
    weightKg: "75.500",
    repetitions: 8,
    durationSeconds: null,
    distanceMeters: null,
    isCompleted: true,
    completedAt: new Date("2026-10-26T15:10:00.999Z"),
  });
}

test("backup round-trips all persistent tables and leaves ephemeral references clean", async () => {
  const sourceClient = new PGlite();
  const source = drizzle(sourceClient, { schema });
  const targetClient = new PGlite();
  const target = drizzle(targetClient, { schema });

  try {
    await migrate(sourceClient);
    await migrate(targetClient);
    await seed(source);

    const backup = await createBackup(asBackupDatabase(source), OWNER_ID);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.equal(backup.ownerTelegramId, OWNER_ID);
    assert.equal(backup.tables.ownerSettings[0].editingCaptureId, null);
    assert.equal(backup.tables.captureDrafts[0].telegramUpdateRowId, null);
    assert.equal(backup.tables.ownerSettings[0].dateOfBirth, "1996-08-09");
    assert.equal(backup.tables.ownerSettings[0].heightCm, "181.75");
    assert.equal(backup.tables.nutritionEntries[0].calories, "650.25");
    assert.equal(backup.tables.weightEntries[0].weightKg, "80.125");
    assert.equal(backup.tables.exchangeRates[0].effectiveAt, "2026-10-27T10:00:00.654Z");
    assert.equal(backup.tables.recurringPayments[0].anchorDay, 1);
    assert.equal(backup.tables.recurringPayments[0].anchorMonth, 11);
    assert.equal(backup.tables.workoutSets[0].weightKg, "75.500");
    assert.equal(backup.tables.financeDebts[0].originalAmount, "100.0000");
    assert.equal(backup.tables.financeDebtRepayments[0].amount, "25.0000");
    assert.equal(backup.tables.financeDebtDrafts.length, 2);
    assert.equal("telegramUpdates" in backup.tables, false);
    assert.equal("notificationDeliveries" in backup.tables, false);

    await restoreBackup(asBackupDatabase(target), backup, OWNER_ID);
    const restored = await createBackup(asBackupDatabase(target), OWNER_ID);
    assert.deepEqual(restored.tables, backup.tables);
    const ephemeral = await target.select().from(schema.telegramUpdates);
    const notifications = await target.select().from(schema.notificationDeliveries);
    assert.equal(ephemeral.length, 0);
    assert.equal(notifications.length, 0);

    const legacyTables = { ...backup.tables } as Record<string, unknown>;
    delete legacyTables.financeDebts;
    delete legacyTables.financeDebtRepayments;
    delete legacyTables.financeDebtDrafts;
    const legacyV2 = validateBackup({
      ...backup,
      version: 2,
      tables: legacyTables,
    });
    assert.equal(legacyV2.version, BACKUP_VERSION);
    assert.deepEqual(legacyV2.tables.financeDebts, []);
    assert.deepEqual(legacyV2.tables.financeDebtRepayments, []);
    assert.deepEqual(legacyV2.tables.financeDebtDrafts, []);

    await assert.rejects(restoreBackup(asBackupDatabase(target), backup, OWNER_ID), /пустую базу/);
    const ownersAfterRejectedRestore = await target.select().from(schema.ownerSettings);
    assert.equal(ownersAfterRejectedRestore.length, 1);

    const emptyClient = new PGlite();
    const empty = drizzle(emptyClient, { schema });
    try {
      await migrate(emptyClient);
      await assert.rejects(restoreBackup(asBackupDatabase(empty), backup, "987654321"), /другому владельцу/);
      const ownersAfterWrongOwner = await empty.select().from(schema.ownerSettings);
      assert.equal(ownersAfterWrongOwner.length, 0);
    } finally {
      await emptyClient.close();
    }

    const tampered = structuredClone(backup);
    (tampered.tables.ownerSettings[0] as Record<string, unknown>).unexpected = "column";
    assert.throws(() => validateBackup(tampered), /не совпадает со схемой/);
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
});
