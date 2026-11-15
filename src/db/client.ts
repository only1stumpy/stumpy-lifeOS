import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { AppError } from "@/server/http";

let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new AppError(503, "Хранилище ещё не настроено.");
  if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
  return drizzle(new Pool({ connectionString, max: 2 }), { schema });
}
export function getDb() {
  return database ??= createDatabase();
}
export type Database = ReturnType<typeof getDb>;

/** Test seam: lets tests run the real command layer against an in-memory PGlite database. */
export function useDatabaseForTests(testDatabase: unknown): void {
  database = testDatabase as Database;
}
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

