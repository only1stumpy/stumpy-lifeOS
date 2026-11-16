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
  const ownerFlag = extra[0] === "--owner" ? extra[1] : undefined;
  const usage = "Использование: tsx scripts/backup.ts export|restore <file> [--owner <telegram id>]";
  if ((command !== "export" && command !== "restore") || !file || extra.length > 2 || (extra.length > 0 && !ownerFlag)) {
    throw new Error(usage);
  }

  // Which owner to export or restore: --owner, otherwise TELEGRAM_OWNER_ID from the environment.
  const ownerTelegramId = ownerFlag ?? process.env.TELEGRAM_OWNER_ID;
  const databaseUrl = process.env.DATABASE_URL;
  if (!ownerTelegramId) throw new AppError(400, "Укажите Telegram ID: --owner <id> или TELEGRAM_OWNER_ID.");
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
      await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
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
