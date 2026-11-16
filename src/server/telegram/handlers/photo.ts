import type { Context } from "grammy";
import { AppError } from "@/server/http";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TELEGRAM_FILE_TIMEOUT_MS = 20_000;

async function handlePhotoMessage(
  ctx: Context,
  fileId: string,
): Promise<{ mimeType: string; dataBase64: string }> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new AppError(400, "Не удалось получить фотографию из Telegram.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new AppError(503, "Telegram ещё не настроен.");

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(503, "Фотография временно недоступна. Попробуй ещё раз.");
  }
  if (!response.ok || !response.body) throw new AppError(503, "Фотография временно недоступна. Попробуй ещё раз.");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PHOTO_BYTES) throw new AppError(413, "Фотография больше 8 МБ. Отправь снимок меньшего размера.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new AppError(413, "Фотография больше 8 МБ. Отправь снимок меньшего размера.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new AppError(400, "Фотография пустая.");
  return { mimeType: "image/jpeg", dataBase64: Buffer.concat(chunks).toString("base64") };
}

export async function downloadTelegramPhoto(ctx: Context, fileId: string) {
  try {
    return await handlePhotoMessage(ctx, fileId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "Фотографию не удалось обработать. Попробуй отправить её ещё раз.");
  }
}
