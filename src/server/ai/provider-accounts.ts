import { and, asc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { AppError } from "@/server/http";
import { decryptProviderApiKey, encryptProviderApiKey, type AiProviderConfig } from "./provider-profiles";
import {
  AI_PROVIDER_IDS,
  assertAiProviderCanConnect,
  discoverFreeModels,
  getAiProviderDefinition,
  listAiProviderDefinitions,
  testProviderModel,
  type AiProviderCatalogModel,
  type AiProviderId,
} from "./provider-catalog";
import { validateAiProviderEndpoint } from "./safe-fetch";

const accountInputSchema = z.object({
  providerId: z.enum(AI_PROVIDER_IDS),
  name: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(1).max(8_192),
  endpoint: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  freeTierConfirmed: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.providerId === "custom" && !input.model) {
    context.addIssue({ code: "custom", message: "Для расширенного endpoint укажи модель для тестового запроса.", path: ["model"] });
  }
});

export type AiProviderAccountDto = {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  hasApiKey: true;
  createdAt: string;
};

export type AiProviderModelDto = AiProviderCatalogModel & {
  selected: boolean;
  accountIds: string[];
};

export type AiProviderCardDto = {
  id: AiProviderId;
  name: string;
  description: string;
  supportsImages: boolean;
  connectable: boolean;
  connectionBlockReason: string | null;
  accounts: AiProviderAccountDto[];
  models: AiProviderModelDto[];
};

export type ProviderAccountUsageDto = {
  accountId: string;
  providerId: AiProviderId;
  providerName: string;
  accountName: string;
  models: Array<{
    modelId: string;
    modelName: string;
    requestCount24h: number;
    knownRequestsPerDay: number | null;
    knownRequestsPerMinute: number | null;
    knownTokensPerMinute: number | null;
    source: "published_limit_and_lifeos_counter" | "lifeos_counter_only";
  }>;
};

const MAX_ACCOUNTS_PER_USER = 20;
const MAX_MODELS_PER_PROVIDER = 100;

export async function listAiProviderCards(ownerId: string): Promise<{ providers: AiProviderCardDto[]; legacyProfileCount: number }> {
  const db = getDb();
  const [accounts, selections, legacyProfiles] = await Promise.all([
    db.select().from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderAccounts.providerId), asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt)),
    db.select().from(schema.aiProviderModelSelections)
      .where(eq(schema.aiProviderModelSelections.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderModelSelections.providerId), asc(schema.aiProviderModelSelections.sortOrder)),
    db.select({ id: schema.aiProviderProfiles.id }).from(schema.aiProviderProfiles)
      .where(eq(schema.aiProviderProfiles.ownerId, ownerId)),
  ]);

  const providers: AiProviderCardDto[] = listAiProviderDefinitions().map((definition) => {
    const providerAccounts = accounts.filter((account) => account.providerId === definition.id);
    const providerSelections = selections.filter((selection) => selection.providerId === definition.id && selection.enabled);
    const modelMap = new Map<string, AiProviderModelDto>();
    for (const account of providerAccounts) {
      for (const model of account.models) {
        const existing = modelMap.get(model.id);
        if (existing) {
          if (!existing.accountIds.includes(account.id)) existing.accountIds.push(account.id);
          existing.supportsImages ||= model.supportsImages;
          existing.contextLength = maxNullable(existing.contextLength, model.contextLength);
          existing.freeRequestsPerDay = minNullable(existing.freeRequestsPerDay, model.freeRequestsPerDay);
          existing.freeRequestsPerMinute = minNullable(existing.freeRequestsPerMinute, model.freeRequestsPerMinute);
          existing.freeTokensPerMinute = minNullable(existing.freeTokensPerMinute, model.freeTokensPerMinute);
        } else {
          modelMap.set(model.id, {
            ...model,
            selected: providerSelections.some((selection) => selection.modelId === model.id),
            accountIds: [account.id],
          });
        }
      }
    }
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      supportsImages: definition.supportsImages,
      connectable: definition.connectable,
      connectionBlockReason: definition.connectionBlockReason,
      accounts: providerAccounts.map(toAccountDto),
      models: [...modelMap.values()].sort((left, right) => left.name.localeCompare(right.name, "ru")),
    };
  });

  return { providers, legacyProfileCount: legacyProfiles.length };
}

/** Validate discovery and spend one short free-tier request before persisting a key. */
export async function connectAiProviderAccount(ownerId: string, rawInput: unknown): Promise<{
  account: AiProviderAccountDto;
  models: AiProviderCatalogModel[];
}> {
  const input = accountInputSchema.parse(rawInput);
  const definition = getAiProviderDefinition(input.providerId);
  assertAiProviderCanConnect(definition);
  const db = getDb();
  const existing = await db.select({ id: schema.aiProviderAccounts.id })
    .from(schema.aiProviderAccounts)
    .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
    .limit(MAX_ACCOUNTS_PER_USER);
  if (existing.length >= MAX_ACCOUNTS_PER_USER) throw new AppError(400, "Достигнут лимит аккаунтов ИИ-провайдеров.");

  let endpoint = definition.endpoint;
  if (input.providerId === "custom") {
    if (!input.endpoint) throw new AppError(400, "Для совместимого endpoint нужен HTTPS URL.");
    endpoint = (await validateAiProviderEndpoint(input.endpoint)).endpoint;
  }

  const models = await discoverFreeModels(input.providerId, input.apiKey, endpoint);
  const requestedTestModel = input.providerId === "custom" ? input.model : undefined;
  const testModel = requestedTestModel
    ? models.find((model) => model.id === requestedTestModel)
    : models.find((model) => !model.supportsImages) ?? models[0];
  if (!testModel) throw new AppError(400, requestedTestModel
    ? "Модель для теста отсутствует в каталоге endpoint. Обнови список моделей и проверь идентификатор."
    : "Не найдено доступной модели для проверки.");
  await testProviderModel(input.providerId, testModel, input.apiKey, endpoint);

  const sortOrder = existing.length;
  const now = new Date();
  const [row] = await db.insert(schema.aiProviderAccounts).values({
    ownerId,
    providerId: input.providerId,
    name: input.name,
    endpoint,
    authHeaderName: definition.authHeaderName,
    encryptedApiKey: encryptProviderApiKey(input.apiKey),
    freeTierConfirmed: input.freeTierConfirmed,
    enabled: true,
    sortOrder,
    models,
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!row) throw new AppError(500, "Проверка прошла, но аккаунт не удалось сохранить.");
  await recordAiProviderUsage(ownerId, row.id, testModel.id, "success").catch(() => undefined);
  return { account: toAccountDto(row), models };
}

export async function refreshAiProviderAccountModels(ownerId: string, accountId: string): Promise<AiProviderCatalogModel[]> {
  const db = getDb();
  const [row] = await db.select().from(schema.aiProviderAccounts)
    .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new AppError(404, "Аккаунт ИИ-провайдера не найден.");

  const models = await discoverFreeModels(row.providerId as AiProviderId, decryptProviderApiKey(row.encryptedApiKey), row.endpoint);
  await db.update(schema.aiProviderAccounts)
    .set({ models, updatedAt: new Date() })
    .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)));
  return models;
}

export async function setAiProviderModels(ownerId: string, providerId: AiProviderId, rawModelIds: unknown): Promise<void> {
  assertAiProviderCanConnect(getAiProviderDefinition(providerId));
  const modelIds = z.array(z.string().min(1).max(200)).max(MAX_MODELS_PER_PROVIDER).parse(rawModelIds);
  const uniqueModelIds = [...new Set(modelIds)];
  const accounts = await getDb().select({ models: schema.aiProviderAccounts.models })
    .from(schema.aiProviderAccounts)
    .where(and(eq(schema.aiProviderAccounts.ownerId, ownerId), eq(schema.aiProviderAccounts.providerId, providerId)));
  const availableIds = new Set(accounts.flatMap((account) => account.models.map((model) => model.id)));
  if (uniqueModelIds.some((id) => !availableIds.has(id))) throw new AppError(400, "В списке есть модель, недоступная подключённым аккаунтам.");

  await getDb().transaction(async (tx) => {
    await tx.delete(schema.aiProviderModelSelections)
      .where(and(eq(schema.aiProviderModelSelections.ownerId, ownerId), eq(schema.aiProviderModelSelections.providerId, providerId)));
    if (uniqueModelIds.length > 0) {
      await tx.insert(schema.aiProviderModelSelections).values(uniqueModelIds.map((modelId, sortOrder) => ({
        ownerId,
        providerId,
        modelId,
        enabled: true,
        sortOrder,
      })));
    }
  });
}

export async function setAiProviderAccountEnabled(ownerId: string, accountId: string, enabled: boolean): Promise<void> {
  if (enabled) await assertAccountProviderCanConnect(ownerId, accountId);
  const updated = await getDb().update(schema.aiProviderAccounts)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)))
    .returning({ id: schema.aiProviderAccounts.id });
  if (updated.length === 0) throw new AppError(404, "Аккаунт ИИ-провайдера не найден.");
}

export async function reorderAiProviderAccount(ownerId: string, accountId: string, position: number): Promise<void> {
  const requestedPosition = z.number().int().min(0).max(MAX_ACCOUNTS_PER_USER - 1).parse(position);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [moving] = await tx.select().from(schema.aiProviderAccounts)
      .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)))
      .limit(1);
    if (!moving) throw new AppError(404, "Аккаунт ИИ-провайдера не найден.");
    assertAiProviderCanConnect(getAiProviderDefinition(moving.providerId as AiProviderId));
    const accounts = await tx.select({ id: schema.aiProviderAccounts.id, sortOrder: schema.aiProviderAccounts.sortOrder, createdAt: schema.aiProviderAccounts.createdAt })
      .from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt));
    const currentIndex = accounts.findIndex((account) => account.id === accountId);
    const [account] = accounts.splice(currentIndex, 1);
    accounts.splice(Math.min(requestedPosition, accounts.length), 0, account!);
    for (const [sortOrder, item] of accounts.entries()) {
      await tx.update(schema.aiProviderAccounts)
        .set({ sortOrder, updatedAt: new Date() })
        .where(and(eq(schema.aiProviderAccounts.id, item.id), eq(schema.aiProviderAccounts.ownerId, ownerId)));
    }
  });
}

export async function deleteAiProviderAccount(ownerId: string, accountId: string): Promise<void> {
  const deleted = await getDb().delete(schema.aiProviderAccounts)
    .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)))
    .returning({ id: schema.aiProviderAccounts.id });
  if (deleted.length === 0) throw new AppError(404, "Аккаунт ИИ-провайдера не найден.");
}

/** Expand selected shared models into account/model candidates in manual fallback order. */
export async function loadConfiguredAiProviderConfigs(ownerId: string): Promise<AiProviderConfig[]> {
  const [accounts, selections] = await Promise.all([
    getDb().select().from(schema.aiProviderAccounts)
      .where(and(eq(schema.aiProviderAccounts.ownerId, ownerId), eq(schema.aiProviderAccounts.enabled, true)))
      .orderBy(asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt)),
    getDb().select().from(schema.aiProviderModelSelections)
      .where(and(eq(schema.aiProviderModelSelections.ownerId, ownerId), eq(schema.aiProviderModelSelections.enabled, true)))
      .orderBy(asc(schema.aiProviderModelSelections.sortOrder)),
  ]);

  const configs: AiProviderConfig[] = [];
  for (const account of accounts) {
    const provider = getAiProviderDefinition(account.providerId as AiProviderId);
    if (!provider.connectable) continue;
    const selected = selections.filter((selection) => selection.providerId === account.providerId);
    for (const selection of selected) {
      const model = account.models.find((candidate) => candidate.id === selection.modelId);
      if (!model) continue;
      configs.push({
        id: account.id,
        accountId: account.id,
        providerId: account.providerId as AiProviderId,
        providerName: provider.name,
        name: account.name,
        endpoint: account.endpoint,
        model: model.id,
        apiKey: decryptProviderApiKey(account.encryptedApiKey),
        // Use the current adapter contract so accounts saved before the Gemini
        // OpenAI-compatible endpoint switched to Bearer auth keep working.
        authHeaderName: provider.authHeaderName,
        supportsImages: model.supportsImages,
        sortOrder: account.sortOrder * (MAX_MODELS_PER_PROVIDER + 1) + selection.sortOrder,
      });
    }
  }
  return configs;
}

export async function recordAiProviderUsage(ownerId: string, accountId: string, modelId: string, outcome: "success" | "failure"): Promise<void> {
  await getDb().insert(schema.aiProviderUsageEvents).values({ ownerId, accountId, modelId, outcome });
}

export async function getAiProviderUsage(ownerId: string): Promise<ProviderAccountUsageDto[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [accounts, usage] = await Promise.all([
    getDb().select().from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderAccounts.providerId), asc(schema.aiProviderAccounts.sortOrder)),
    getDb().select({
      accountId: schema.aiProviderUsageEvents.accountId,
      modelId: schema.aiProviderUsageEvents.modelId,
      requests: count(),
    }).from(schema.aiProviderUsageEvents)
      .where(and(eq(schema.aiProviderUsageEvents.ownerId, ownerId), gte(schema.aiProviderUsageEvents.occurredAt, since)))
      .groupBy(schema.aiProviderUsageEvents.accountId, schema.aiProviderUsageEvents.modelId),
  ]);
  return accounts.map((account) => {
    const definition = getAiProviderDefinition(account.providerId as AiProviderId);
    return {
      accountId: account.id,
      providerId: account.providerId as AiProviderId,
      providerName: definition.name,
      accountName: account.name,
      models: account.models.map((model) => {
        const row = usage.find((value) => value.accountId === account.id && value.modelId === model.id);
        return {
          modelId: model.id,
          modelName: model.name,
          requestCount24h: row?.requests ?? 0,
          knownRequestsPerDay: model.freeRequestsPerDay,
          knownRequestsPerMinute: model.freeRequestsPerMinute,
          knownTokensPerMinute: model.freeTokensPerMinute,
          source: model.freeRequestsPerDay !== null || model.freeRequestsPerMinute !== null || model.freeTokensPerMinute !== null
            ? "published_limit_and_lifeos_counter" as const
            : "lifeos_counter_only" as const,
        };
      }),
    };
  });
}

function toAccountDto(row: typeof schema.aiProviderAccounts.$inferSelect): AiProviderAccountDto {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    hasApiKey: true,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertAccountProviderCanConnect(ownerId: string, accountId: string): Promise<void> {
  const [account] = await getDb().select({ providerId: schema.aiProviderAccounts.providerId })
    .from(schema.aiProviderAccounts)
    .where(and(eq(schema.aiProviderAccounts.id, accountId), eq(schema.aiProviderAccounts.ownerId, ownerId)))
    .limit(1);
  if (!account) throw new AppError(404, "Аккаунт ИИ-провайдера не найден.");
  assertAiProviderCanConnect(getAiProviderDefinition(account.providerId as AiProviderId));
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function minNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}
