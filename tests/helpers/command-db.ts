import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { useDatabaseForTests as setTestDatabase } from "@/db/client";
import { commandSchema } from "@/domain/commands";
import { AppError } from "@/server/http";
import { executeCommand, loadSnapshot } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";

/** One in-memory PGlite with the real migrations, wired in as the command layer's database. */
export async function createCommandDb() {
  const client = new PGlite();
  const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
  const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of names) {
    const migration = await readFile(`${directory}${name}`, "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await client.exec(statement);
  }
  const db = drizzle(client, { schema });
  setTestDatabase(db);
  return { client, db };
}
export type CommandDb = Awaited<ReturnType<typeof createCommandDb>>["db"];

let nextTelegramId = 7_000_000_000;
/** A Telegram ID unique within the shared test process. */
export const newTelegramId = () => String(nextTelegramId += 1);

/** Parses a raw command through the real schema and runs it as the given Telegram user. */
export async function run(telegramId: string, command: Record<string, unknown>) {
  const parsed = commandSchema.parse(command);
  return withTelegramUser(telegramId, () => executeCommand(parsed));
}
export const snapshotOf = (telegramId: string, date?: string) => withTelegramUser(telegramId, () => loadSnapshot(date));

/** Creates the owner profile through the real code path and returns its row. */
export async function ownerOf(db: CommandDb, telegramId: string) {
  await withTelegramUser(telegramId, () => loadSnapshot());
  const [owner] = await db.select().from(schema.ownerSettings).where(eq(schema.ownerSettings.telegramUserId, telegramId));
  assert.ok(owner, "owner row must exist");
  return owner;
}

export async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.status === status, `expected AppError ${status}`);
}

export const uuid = () => randomUUID();
export const T = "2026-03-10T12:00:00.000Z";
