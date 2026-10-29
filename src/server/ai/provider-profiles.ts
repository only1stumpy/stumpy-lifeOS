import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { AppError } from "@/server/http";
import { validateAiProviderEndpoint } from "./safe-fetch";

const KEY_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PROFILES_PER_USER = 12;

const profileInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().min(1).max(8_192).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type AiProviderProfileInput = z.input<typeof profileInputSchema>;

/** Safe client DTO. The key and ciphertext are intentionally excluded. */
export type AiProviderProfileDto = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  enabled: boolean;
  sortOrder: number;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Cleartext provider config for server-side model calls only. */
export type AiProviderConfig = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  sortOrder: number;
  /** Present for managed provider accounts; absent on legacy profiles and env keys. */
  accountId?: string;
  providerId?: string;
  providerName?: string;
  authHeaderName?: "authorization" | "x-goog-api-key";
  supportsImages?: boolean;
};

export { validateAiProviderEndpoint };

/** Return only profiles belonging to the supplied LifeOS owner. */
export async function listAiProviderProfiles(ownerId: string): Promise<AiProviderProfileDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.aiProviderProfiles)
    .where(eq(schema.aiProviderProfiles.ownerId, ownerId))
    .orderBy(asc(schema.aiProviderProfiles.sortOrder), asc(schema.aiProviderProfiles.createdAt));
  return rows.map(toAiProviderProfileDto);
}

/** Create or update one provider profile while keeping existing keys on metadata-only edits. */
export async function saveAiProviderProfile(
  ownerId: string,
  rawInput: AiProviderProfileInput,
): Promise<AiProviderProfileDto> {
  const input = profileInputSchema.parse(rawInput);
  const validatedEndpoint = await validateAiProviderEndpoint(input.endpoint);
  const db = getDb();
  const now = new Date();

  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.aiProviderProfiles)
      .where(and(
        eq(schema.aiProviderProfiles.id, input.id),
        eq(schema.aiProviderProfiles.ownerId, ownerId),
      ))
      .limit(1);
    if (!existing) throw new AppError(404, "Профиль ИИ-провайдера не найден.");

    const encryptedApiKey = input.apiKey
      ? encryptProviderApiKey(input.apiKey)
      : existing.encryptedApiKey;
    const [updated] = await db
      .update(schema.aiProviderProfiles)
      .set({
        name: input.name,
        endpoint: validatedEndpoint.endpoint,
        model: input.model,
        encryptedApiKey,
        enabled: input.enabled ?? existing.enabled,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: now,
      })
      .where(and(
        eq(schema.aiProviderProfiles.id, input.id),
        eq(schema.aiProviderProfiles.ownerId, ownerId),
      ))
      .returning();
    if (!updated) throw new AppError(404, "Профиль ИИ-провайдера не найден.");
    return toAiProviderProfileDto(updated);
  }

  if (!input.apiKey) throw new AppError(400, "Для нового профиля укажите API-ключ.");
  const existingProfiles = await db
    .select({ id: schema.aiProviderProfiles.id })
    .from(schema.aiProviderProfiles)
    .where(eq(schema.aiProviderProfiles.ownerId, ownerId))
    .limit(MAX_PROFILES_PER_USER);
  if (existingProfiles.length >= MAX_PROFILES_PER_USER) {
    throw new AppError(400, "Достигнут лимит профилей ИИ-провайдеров.");
  }

  const [created] = await db
    .insert(schema.aiProviderProfiles)
    .values({
      ownerId,
      name: input.name,
      endpoint: validatedEndpoint.endpoint,
      model: input.model,
      encryptedApiKey: encryptProviderApiKey(input.apiKey),
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? existingProfiles.length,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new AppError(500, "Не удалось сохранить профиль ИИ-провайдера.");
  return toAiProviderProfileDto(created);
}

/** Delete only a profile owned by this user. */
export async function deleteAiProviderProfile(ownerId: string, id: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.aiProviderProfiles)
    .where(and(
      eq(schema.aiProviderProfiles.id, id),
      eq(schema.aiProviderProfiles.ownerId, ownerId),
    ))
    .returning({ id: schema.aiProviderProfiles.id });
  if (deleted.length === 0) throw new AppError(404, "Профиль ИИ-провайдера не найден.");
}

/** Load enabled profiles in fallback order. Plaintext keys never leave this server-only module. */
export async function loadAiProviderConfigs(ownerId: string): Promise<AiProviderConfig[]> {
  const rows = await getDb()
    .select()
    .from(schema.aiProviderProfiles)
    .where(and(
      eq(schema.aiProviderProfiles.ownerId, ownerId),
      eq(schema.aiProviderProfiles.enabled, true),
    ))
    .orderBy(asc(schema.aiProviderProfiles.sortOrder), asc(schema.aiProviderProfiles.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    apiKey: decryptProviderApiKey(row.encryptedApiKey),
    sortOrder: row.sortOrder,
  }));
}

/** AES-256-GCM; the versioned envelope contains only IV, auth tag and ciphertext. */
export function encryptProviderApiKey(apiKey: string, encodedKey = process.env.AI_PROVIDER_ENCRYPTION_KEY): string {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [KEY_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptProviderApiKey(envelope: string, encodedKey = process.env.AI_PROVIDER_ENCRYPTION_KEY): string {
  const key = decodeEncryptionKey(encodedKey);
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split(":");
  if (
    version !== KEY_VERSION ||
    !ivText ||
    !tagText ||
    ciphertextText === undefined ||
    extra !== undefined
  ) {
    throw new Error("Stored provider key cannot be decrypted.");
  }

  try {
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Never include the envelope, original key or crypto error in the message.
    throw new Error("Stored provider key cannot be decrypted.");
  }
}

/** Public DTO conversion is exported for focused security tests and API reuse. */
export function toAiProviderProfileDto(row: typeof schema.aiProviderProfiles.$inferSelect): AiProviderProfileDto {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    hasApiKey: row.encryptedApiKey.length > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decodeEncryptionKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) throw new AppError(503, "Секрет шифрования API-ключей не настроен.");
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) {
    throw new AppError(503, "Секрет шифрования API-ключей имеет неверный формат.");
  }
  return key;
}
