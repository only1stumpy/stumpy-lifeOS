import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";

export async function readKv<T>(key: string): Promise<{ value: T; updatedAt: Date } | null> {
  const [row] = await getDb().select().from(schema.adminKv).where(eq(schema.adminKv.key, key)).limit(1);
  return row ? { value: row.value as T, updatedAt: row.updatedAt } : null;
}

export async function writeKv(key: string, value: unknown): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.adminKv)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.adminKv.key, set: { value, updatedAt: now } });
}
