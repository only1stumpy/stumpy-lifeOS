import "./load-env";

import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";
import {
  BACKUP_MAX_BYTES,
  createBackup,
  parseBackupJson,
  restoreBackup,
  type BackupDatabase,
} from "@/server/backup";
import { AppError } from "@/server/http";

async function main() {
  const [command, file, ...extra] = process.argv.slice(2);
  if ((command !== "export" && command !== "restore") || !file || extra.length > 0) {
    throw new Error("Использование: tsx scripts/backup.ts export <file> | restore <file>");
  }

  const ownerTelegramId = process.env.TELEGRAM_OWNER_ID;
  const databaseUrl = process.env.DATABASE_URL;
  if (!ownerTelegramId) throw new AppError(503, "TELEGRAM_OWNER_ID не настроен.");
  if (!databaseUrl) throw new AppError(503, "DATABASE_URL не настроен.");

  if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema }) as unknown as BackupDatabase;
  const path = resolve(file);

  try {
    if (command === "export") {
      const backup = await createBackup(database, ownerTelegramId);
      const contents = `${JSON.stringify(backup)}\n`;
      if (Buffer.byteLength(contents, "utf8") > BACKUP_MAX_BYTES) {
        throw new AppError(413, "Резервная копия превышает допустимый размер.");
      }
      await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
      process.stdout.write(`Резервная копия сохранена: ${path}\n`);
      return;
    }

    const fileInfo = await stat(path);
    if (fileInfo.size > BACKUP_MAX_BYTES) throw new AppError(413, "Файл резервной копии превышает допустимый размер.");
    const contents = await readFile(path, "utf8");
    const backup = parseBackupJson(contents);
    await restoreBackup(database, backup, ownerTelegramId);
    process.stdout.write("Резервная копия восстановлена.\n");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AppError) process.stderr.write(`${error.message}\n`);
  else process.stderr.write("Не удалось выполнить операцию резервного копирования.\n");
  process.exitCode = 1;
});
