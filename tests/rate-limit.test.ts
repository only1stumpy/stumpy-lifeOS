import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { consumeRateLimit, type RateLimitRule } from "@/server/rate-limit";

const RULE: RateLimitRule = { bucket: "test", limit: 3, windowSeconds: 60, message: "limit" };

async function database(applyMigrations = true) {
  const client = new PGlite();
  if (applyMigrations) {
    const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
    const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) {
      const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await client.exec(statement);
    }
  }
  return { client, db: drizzle(client) as unknown as Parameters<typeof consumeRateLimit>[0] };
}

test("лимитер пропускает запросы до порога и отклоняет сверх него", async () => {
  const { client, db } = await database();
  try {
    const now = new Date("2026-11-15T10:00:10.000Z");
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await consumeRateLimit(db, RULE, "user-1", now));
    assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false, false]);
    assert.equal(results[3].retryAfterSeconds, 50);
  } finally {
    await client.close();
  }
});

test("счётчики разных пользователей и разных окон независимы", async () => {
  const { client, db } = await database();
  try {
    const now = new Date("2026-11-15T10:00:10.000Z");
    for (let i = 0; i < 4; i += 1) await consumeRateLimit(db, RULE, "user-1", now);
    assert.equal((await consumeRateLimit(db, RULE, "user-2", now)).allowed, true);
    const nextWindow = new Date("2026-11-15T10:01:05.000Z");
    assert.equal((await consumeRateLimit(db, RULE, "user-1", nextWindow)).allowed, true);
  } finally {
    await client.close();
  }
});

test("если таблицы счётчиков нет, лимитер пропускает запрос и не падает", async () => {
  const { client, db } = await database(false);
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await consumeRateLimit(db, RULE, "user-1");
    assert.equal(result.allowed, true);
  } finally {
    console.error = originalError;
    await client.close();
  }
});
