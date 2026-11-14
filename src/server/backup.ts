import { getTableColumns, sql, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { AppError } from "@/server/http";

const formatName = "stumpy-lifeos-backup";
export const BACKUP_VERSION = 3;
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;
export const BACKUP_MAX_ROWS = 100_000;

type PgSchemaTable = Parameters<typeof getTableConfig>[0];
type TableDescriptor = { key: string; table: PgSchemaTable; ownerProperty: string };
type BackupColumn = { name: string; notNull: boolean; getSQLType(): string };
type Row = Record<string, unknown>;

const backupTables = [
  { key: "ownerSettings", table: schema.ownerSettings, ownerProperty: "id" },
  { key: "captureDrafts", table: schema.captureDrafts, ownerProperty: "ownerId" },
  { key: "nutritionTargets", table: schema.nutritionTargets, ownerProperty: "ownerId" },
  { key: "foodTemplates", table: schema.foodTemplates, ownerProperty: "ownerId" },
  { key: "nutritionEntries", table: schema.nutritionEntries, ownerProperty: "ownerId" },
  { key: "weightEntries", table: schema.weightEntries, ownerProperty: "ownerId" },
  { key: "financeAccounts", table: schema.financeAccounts, ownerProperty: "ownerId" },
  { key: "financeCategories", table: schema.financeCategories, ownerProperty: "ownerId" },
  { key: "exchangeRates", table: schema.exchangeRates, ownerProperty: "ownerId" },
  { key: "recurringPayments", table: schema.recurringPayments, ownerProperty: "ownerId" },
  { key: "nutritionDrafts", table: schema.nutritionDrafts, ownerProperty: "ownerId" },
  { key: "moneyDrafts", table: schema.moneyDrafts, ownerProperty: "ownerId" },
  { key: "financeEntries", table: schema.financeEntries, ownerProperty: "ownerId" },
  { key: "financePlans", table: schema.financePlans, ownerProperty: "ownerId" },
  { key: "financeDebts", table: schema.financeDebts, ownerProperty: "ownerId" },
  { key: "financeDebtRepayments", table: schema.financeDebtRepayments, ownerProperty: "ownerId" },
  { key: "financeDebtDrafts", table: schema.financeDebtDrafts, ownerProperty: "ownerId" },
  { key: "exercises", table: schema.exercises, ownerProperty: "ownerId" },
  { key: "workoutDays", table: schema.workoutDays, ownerProperty: "ownerId" },
  { key: "workoutDayExercises", table: schema.workoutDayExercises, ownerProperty: "ownerId" },
  { key: "workoutSessions", table: schema.workoutSessions, ownerProperty: "ownerId" },
  { key: "workoutSessionExercises", table: schema.workoutSessionExercises, ownerProperty: "ownerId" },
  { key: "workoutSets", table: schema.workoutSets, ownerProperty: "ownerId" },
] as const satisfies readonly TableDescriptor[];

const backupV1TableKeys = [
  "ownerSettings",
  "captureDrafts",
  "nutritionTargets",
  "foodTemplates",
  "nutritionEntries",
  "weightEntries",
  "financeAccounts",
  "financeCategories",
  "exchangeRates",
  "recurringPayments",
  "nutritionDrafts",
  "moneyDrafts",
  "financeEntries",
  "exercises",
  "workoutDays",
  "workoutDayExercises",
  "workoutSessions",
  "workoutSessionExercises",
  "workoutSets",
] as const;

const backupV2TableKeys = [
  ...backupV1TableKeys.slice(0, 13),
  "financePlans",
  ...backupV1TableKeys.slice(13),
] as const;

export type BackupTableKey = (typeof backupTables)[number]["key"];
export type LifeOSBackup = {
  format: typeof formatName;
  version: typeof BACKUP_VERSION;
  ownerTelegramId: string;
  exportedAt: string;
  tables: Record<BackupTableKey, Row[]>;
};

/** Small query surface shared by Neon Drizzle and the PGlite round-trip test. */
export type BackupExecutor = {
  execute(query: SQL): Promise<{ rows: Row[] }>;
};

export type BackupDatabase = BackupExecutor & {
  transaction<T>(callback: (transaction: BackupExecutor) => Promise<T>): Promise<T>;
};

type TableMetadata = {
  schemaName: string;
  tableName: string;
  columns: Record<string, BackupColumn>;
  properties: string[];
};

function tableMetadata(descriptor: TableDescriptor): TableMetadata {
  const config = getTableConfig(descriptor.table);
  const columns = getTableColumns(descriptor.table) as Record<string, BackupColumn>;
  return {
    schemaName: config.schema ?? "public",
    tableName: config.name,
    columns,
    properties: Object.keys(columns),
  };
}

function qualifiedTable(metadata: TableMetadata): SQL {
  return sql`${sql.identifier(metadata.schemaName)}.${sql.identifier(metadata.tableName)}`;
}

function validOwnerId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function asTimestamp(value: unknown, property: string): Date {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new AppError(400, `Некорректная дата в поле ${property}.`);
  return date;
}

function asNumericString(value: unknown, property: string): string {
  const decimal = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof decimal !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) {
    throw new AppError(400, `Некорректное числовое значение в поле ${property}.`);
  }
  return decimal;
}

function normalizeColumnValue(column: BackupColumn, property: string, value: unknown, restoring: boolean): unknown {
  if (value === undefined) throw new AppError(400, `В резервной копии отсутствует поле ${property}.`);
  if (value === null) {
    if (column.notNull) throw new AppError(400, `Поле ${property} не может быть пустым.`);
    return null;
  }

  const type = column.getSQLType().toLowerCase();
  if (type.startsWith("timestamp")) {
    const date = asTimestamp(value, property);
    return restoring ? date : date.toISOString();
  }
  if (type === "date") {
    const dateValue = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    if (typeof dateValue !== "string" || !isDateOnly(dateValue)) throw new AppError(400, `Некорректная дата в поле ${property}.`);
    return dateValue;
  }
  if (type.startsWith("numeric")) return asNumericString(value, property);
  if (type === "uuid") {
    if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
      throw new AppError(400, `Некорректный идентификатор в поле ${property}.`);
    }
    return value;
  }
  if (type === "text") {
    if (typeof value !== "string") throw new AppError(400, `Некорректный текст в поле ${property}.`);
    return value;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new AppError(400, `Некорректное логическое значение в поле ${property}.`);
    return value;
  }
  if (["smallint", "integer", "bigint"].includes(type)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new AppError(400, `Некорректное целое число в поле ${property}.`);
    return value;
  }
  if (type === "text[]") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new AppError(400, `Некорректный список в поле ${property}.`);
    return [...value];
  }
  if (type === "jsonb") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      throw new AppError(400, `Некорректные данные в поле ${property}.`);
    }
  }

  throw new AppError(400, `Неподдерживаемый тип поля ${property}.`);
}

function normalizeRow(descriptor: TableDescriptor, input: unknown, restoring: boolean): Row {
  if (!isRecord(input)) throw new AppError(400, `Строка ${descriptor.key} должна быть объектом.`);
  const metadata = tableMetadata(descriptor);
  const actual = Object.keys(input).sort();
  const expected = [...metadata.properties].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AppError(400, `Набор полей таблицы ${descriptor.key} не совпадает со схемой.`);
  }

  const row: Row = {};
  for (const property of metadata.properties) {
    row[property] = normalizeColumnValue(metadata.columns[property], property, input[property], restoring);
  }
  return row;
}

function emptyTables(): LifeOSBackup["tables"] {
  const tables = {} as LifeOSBackup["tables"];
  for (const descriptor of backupTables) {
    (tables as Record<string, Row[]>)[descriptor.key] = [];
  }
  return tables;
}

function keysMatch(value: Row, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function parseBackupJson(raw: string): LifeOSBackup {
  if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES) throw new AppError(413, "Файл резервной копии превышает допустимый размер.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, "Файл резервной копии не является корректным JSON.");
  }
  return validateBackup(parsed);
}

export function validateBackup(input: unknown): LifeOSBackup {
  if (!isRecord(input) || !keysMatch(input, ["format", "version", "ownerTelegramId", "exportedAt", "tables"])) {
    throw new AppError(400, "Формат резервной копии не распознан.");
  }
  if (input.format !== formatName || ![1, 2, BACKUP_VERSION].includes(input.version as number) || !validOwnerId(input.ownerTelegramId)) {
    throw new AppError(400, "Версия или владелец резервной копии не поддерживается.");
  }
  if (typeof input.exportedAt !== "string" || !Number.isFinite(Date.parse(input.exportedAt))) {
    throw new AppError(400, "В резервной копии некорректна дата создания.");
  }
  const versionOne = input.version === 1;
  const versionTwo = input.version === 2;
  const expectedKeys = versionOne ? [...backupV1TableKeys] : versionTwo ? [...backupV2TableKeys] : backupTables.map((table) => table.key);
  if (!isRecord(input.tables) || !keysMatch(input.tables, expectedKeys)) {
    throw new AppError(400, "Список таблиц резервной копии не совпадает со схемой.");
  }

  const inputTables: Row = { ...input.tables };
  if (versionOne) inputTables.financePlans = [];
  if (versionOne || versionTwo) {
    inputTables.financeDebts = [];
    inputTables.financeDebtRepayments = [];
    inputTables.financeDebtDrafts = [];
  }
  const tables = emptyTables();
  let totalRows = 0;
  for (const descriptor of backupTables) {
    const values = inputTables[descriptor.key];
    if (!Array.isArray(values)) throw new AppError(400, `Таблица ${descriptor.key} должна содержать список строк.`);
    totalRows += values.length;
    if (totalRows > BACKUP_MAX_ROWS) throw new AppError(413, "В резервной копии слишком много строк.");
    (tables as Record<string, Row[]>)[descriptor.key] = values.map((row) => normalizeRow(descriptor, row, true));
  }

  const owners = tables.ownerSettings;
  if (owners.length !== 1 || owners[0].telegramUserId !== input.ownerTelegramId || owners[0].editingCaptureId !== null) {
    throw new AppError(400, "Профиль владельца в резервной копии повреждён.");
  }
  const ownerUuid = owners[0].id;
  for (const descriptor of backupTables) {
    if (descriptor.key === "ownerSettings") continue;
    const rows = tables[descriptor.key];
    if (rows.some((row) => row[descriptor.ownerProperty] !== ownerUuid)) {
      throw new AppError(400, `Таблица ${descriptor.key} содержит данные другого владельца.`);
    }
  }
  if (tables.captureDrafts.some((row) => row.telegramUpdateRowId !== null)) {
    throw new AppError(400, "Резервная копия содержит ссылку на исключённые данные Telegram.");
  }

  return {
    format: formatName,
    version: BACKUP_VERSION,
    ownerTelegramId: input.ownerTelegramId,
    exportedAt: input.exportedAt,
    tables,
  };
}

async function rowsForOwner(executor: BackupExecutor, descriptor: TableDescriptor, ownerId: string): Promise<Row[]> {
  const metadata = tableMetadata(descriptor);
  const ownerColumn = metadata.columns[descriptor.ownerProperty];
  if (!ownerColumn) throw new Error(`Backup schema is missing ${descriptor.key}.${descriptor.ownerProperty}`);
  const result = await executor.execute(sql`select * from ${qualifiedTable(metadata)} where ${sql.identifier(ownerColumn.name)} = ${ownerId}`);
  return result.rows.map((raw) => {
    const row: Row = {};
    for (const property of metadata.properties) {
      row[property] = normalizeColumnValue(metadata.columns[property], property, raw[metadata.columns[property].name], false);
    }
    if (descriptor.key === "ownerSettings") row.editingCaptureId = null;
    if (descriptor.key === "captureDrafts") row.telegramUpdateRowId = null;
    return row;
  });
}

export async function createBackup(database: BackupDatabase, ownerTelegramId: string): Promise<LifeOSBackup> {
  if (!validOwnerId(ownerTelegramId)) throw new AppError(503, "Telegram ID владельца не настроен.");
  return database.transaction(async (transaction) => {
    const ownerDescriptor = backupTables[0];
    const ownerMetadata = tableMetadata(ownerDescriptor);
    const telegramIdColumn = ownerMetadata.columns.telegramUserId;
    const ownerResult = await transaction.execute(sql`
      select * from ${qualifiedTable(ownerMetadata)}
      where ${sql.identifier(telegramIdColumn.name)} = ${ownerTelegramId}
      limit 2
    `);
    if (ownerResult.rows.length !== 1) throw new AppError(404, "Профиль владельца не найден.");

    const ownerId = String(ownerResult.rows[0][ownerMetadata.columns.id.name]);
    const tables = emptyTables();
    let totalRows = 0;
    for (const descriptor of backupTables) {
      const rows = await rowsForOwner(transaction, descriptor, ownerId);
      totalRows += rows.length;
      if (totalRows > BACKUP_MAX_ROWS) throw new AppError(413, "В резервной копии слишком много строк.");
      (tables as Record<string, Row[]>)[descriptor.key] = rows;
    }

    const backup: LifeOSBackup = {
      format: formatName,
      version: BACKUP_VERSION,
      ownerTelegramId,
      exportedAt: new Date().toISOString(),
      tables,
    };
    const json = JSON.stringify(backup);
    if (Buffer.byteLength(json, "utf8") > BACKUP_MAX_BYTES) throw new AppError(413, "Резервная копия превышает допустимый размер.");
    return backup;
  });
}

export async function restoreBackup(
  database: BackupDatabase,
  input: string | unknown,
  expectedOwnerTelegramId: string,
): Promise<void> {
  if (!validOwnerId(expectedOwnerTelegramId)) throw new AppError(503, "Telegram ID владельца не настроен.");
  const backup = typeof input === "string" ? parseBackupJson(input) : validateBackup(input);
  if (backup.ownerTelegramId !== expectedOwnerTelegramId) throw new AppError(400, "Резервная копия принадлежит другому владельцу.");

  await database.transaction(async (transaction) => {
    const ownerMetadata = tableMetadata(backupTables[0]);
    const countResult = await transaction.execute(sql`select count(*)::integer as count from ${qualifiedTable(ownerMetadata)}`);
    if (Number(countResult.rows[0]?.count ?? 0) !== 0) throw new AppError(409, "Восстановление разрешено только в пустую базу LifeOS.");

    for (const descriptor of backupTables) {
      const metadata = tableMetadata(descriptor);
      const properties = metadata.properties;
      const columnsSql = sql.join(properties.map((property) => sql.identifier(metadata.columns[property].name)), sql`, `);
      const tableSql = qualifiedTable(metadata);
      for (const row of backup.tables[descriptor.key]) {
        const values = properties.map((property) => sql.param(normalizeColumnValue(metadata.columns[property], property, row[property], true)));
        await transaction.execute(sql`insert into ${tableSql} (${columnsSql}) values (${sql.join(values, sql`, `)})`);
      }
    }
  });
}
