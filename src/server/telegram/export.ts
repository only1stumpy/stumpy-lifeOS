import { InputFile, type Api } from "grammy";
import { getDb } from "@/db/client";
import { AppError } from "@/server/http";
import { createBackup, type BackupDatabase } from "@/server/backup";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";

/** Sends the user's JSON data export into their private chat as a file. */
export async function sendExportWithApi(api: Api, telegramUserId: string): Promise<void> {
  if (!/^[1-9]\d{0,19}$/.test(telegramUserId)) throw new AppError(400, "Некорректный профиль Telegram.");
  await enforceRateLimit(RATE_LIMITS.export, telegramUserId);
  const backup = await createBackup(getDb() as unknown as BackupDatabase, telegramUserId);
  const date = new Date().toISOString().slice(0, 10);
  try {
    await api.sendDocument(Number(telegramUserId), new InputFile(Buffer.from(JSON.stringify(backup), "utf8"), `lifeos-backup-${date}.json`), {
      caption: "Копия твоих данных LifeOS (JSON). Храни файл в безопасном месте: в нём твои записи.",
    });
  } catch (error) {
    console.error("LifeOS export delivery failed", { error: error instanceof Error ? error.name : "unknown" });
    throw new AppError(502, "Не удалось отправить файл в чат. Открой диалог с ботом, нажми /start и повтори.");
  }
}
