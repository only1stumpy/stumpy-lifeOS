import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { getDb, useDatabaseForTests as setTestDatabase } from "@/db/client";
import { HEALTH_CONSENT_VERSION, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
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
/** Unwires the test database so later test files see the same "no database" state they would on their own. */
export const releaseCommandDb = () => setTestDatabase(undefined);
export type CommandDb = Awaited<ReturnType<typeof createCommandDb>>["db"];

let nextTelegramId = 7_000_000_000;
/** A Telegram ID unique within the shared test process. */
export const newTelegramId = () => String(nextTelegramId += 1);

/** Gives the user current consent so that command tests exercise the commands, not the consent gate. */
export async function grantConsent(telegramId: string) {
  await withTelegramUser(telegramId, () => loadSnapshot());
  const now = new Date();
  await getDb().update(schema.ownerSettings)
    .set({ privacyPolicyVersion: PRIVACY_POLICY_VERSION, privacyAcceptedAt: now, healthConsentVersion: HEALTH_CONSENT_VERSION, healthConsentAt: now })
    .where(eq(schema.ownerSettings.telegramUserId, telegramId));
}

/** Parses a raw command through the real schema and runs it as the given Telegram user (with consent, unless `consent: false`). */
export async function run(telegramId: string, command: Record<string, unknown>, options: { consent?: boolean } = {}) {
  const parsed = commandSchema.parse(command);
  if (options.consent !== false) await grantConsent(telegramId);
  return withTelegramUser(telegramId, () => executeCommand(parsed));
}
export const snapshotOf = (telegramId: string, date?: string) => withTelegramUser(telegramId, () => loadSnapshot(date));

/** Creates the owner profile through the real code path and returns its row. */
export async function ownerOf(db: CommandDb, telegramId: string) {
  await grantConsent(telegramId);
  const [owner] = await db.select().from(schema.ownerSettings).where(eq(schema.ownerSettings.telegramUserId, telegramId));
  assert.ok(owner, "owner row must exist");
  return owner;
}

export async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.status === status, `expected AppError ${status}`);
}

export const uuid = () => randomUUID();
export const T = "2026-03-10T12:00:00.000Z";
