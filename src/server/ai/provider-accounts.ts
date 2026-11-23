import { and, asc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { defaultPreselection, rankAiModels } from "@/domain/ai-model-ranking";
import { expandAiModelQueue, initializeAiModelQueue as buildInitialAiModelQueue } from "@/domain/ai-model-queue";
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
import { getObservedLimits, getOpenRouterKeyInfo, type KeyCreditInfo, type ObservedLimitsEntry } from "./provider-limits";

const accountInputSchema = z.object({
  providerId: z.enum(AI_PROVIDER_IDS),
  name: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(1).max(8_192),
  endpoint: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  freeTierConfirmed: z.literal(true).optional(),
}).strict().superRefine((input, context) => {
  // OpenRouter is safe without the checkbox: its model list is filtered to zero-priced `:free` models only.
  // Every other provider keeps the explicit confirmation (their keys do not reveal billing).
  if (input.providerId !== "openrouter" && input.freeTierConfirmed !== true) {
    context.addIssue({ code: "custom", message: "Подтверди бесплатный тариф.", path: ["freeTierConfirmed"] });
  }
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
  queueOrder: number | null;
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
  /** Real key-level limits from the provider (OpenRouter `/key`); null = provider does not expose them. */
  keyLimits: KeyCreditInfo | null;
  models: Array<{
    /** Real limits from provider response headers of recent LifeOS requests; null = not reported / not seen yet. */
    providerLimits: ObservedLimitsEntry | null;
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
const MAX_MODEL_QUEUE_LENGTH = MAX_MODELS_PER_PROVIDER * AI_PROVIDER_IDS.length;

export async function listAiProviderCards(ownerId: string): Promise<{
  providers: AiProviderCardDto[];
  legacyProfileCount: number;
  onboardingCompleted: boolean;
  queue: { providerId: AiProviderId; modelId: string }[];
}> {
  const db = getDb();
  await initializeAiModelQueue(ownerId);
  const [accounts, selections, legacyProfiles] = await Promise.all([
    db.select().from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt)),
    db.select().from(schema.aiProviderModelSelections)
      .where(eq(schema.aiProviderModelSelections.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderModelSelections.providerId), asc(schema.aiProviderModelSelections.sortOrder)),
    db.select({ id: schema.aiProviderProfiles.id }).from(schema.aiProviderProfiles)
      .where(eq(schema.aiProviderProfiles.ownerId, ownerId)),
  ]);

  const providers: AiProviderCardDto[] = listAiProviderDefinitions().map((definition) => {
    const providerAccounts = accounts.filter((account) => account.providerId === definition.id);
    const providerSelections = selections.filter((selection) => selection.providerId === definition.id);
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
            selected: providerSelections.some((selection) => selection.modelId === model.id && selection.enabled),
            queueOrder: providerSelections.find((selection) => selection.modelId === model.id && selection.enabled)?.sortOrder ?? null,
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
      // Display order of the catalog only; the user's queue and saved selection are never reordered here.
      models: rankAiModels(definition.id, [...modelMap.values()]),
    };
  });

  const [owner] = await db.select({ aiOnboardingCompleted: schema.ownerSettings.aiOnboardingCompleted })
    .from(schema.ownerSettings)
    .where(eq(schema.ownerSettings.id, ownerId))
    .limit(1);
  const queue = providers.flatMap((provider) => provider.models
    .filter((model) => model.selected)
    .map((model) => ({ providerId: provider.id, modelId: model.id, queueOrder: model.queueOrder })))
    .sort((left, right) => (left.queueOrder ?? Number.MAX_SAFE_INTEGER) - (right.queueOrder ?? Number.MAX_SAFE_INTEGER)
      || left.providerId.localeCompare(right.providerId)
      || left.modelId.localeCompare(right.modelId))
    .map(({ providerId, modelId }) => ({ providerId, modelId }));

  return { providers, legacyProfileCount: legacyProfiles.length, onboardingCompleted: owner?.aiOnboardingCompleted ?? false, queue };
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
  await initializeAiModelQueue(ownerId);
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
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.aiProviderAccounts).values({
      ownerId,
      providerId: input.providerId,
      name: input.name,
      endpoint,
      authHeaderName: definition.authHeaderName,
      encryptedApiKey: encryptProviderApiKey(input.apiKey),
      freeTierConfirmed: input.providerId === "openrouter" || input.freeTierConfirmed === true,
      enabled: true,
      sortOrder,
      models,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new AppError(500, "Проверка прошла, но аккаунт не удалось сохранить.");

    const existingSelections = await tx.select({ providerId: schema.aiProviderModelSelections.providerId, modelId: schema.aiProviderModelSelections.modelId, enabled: schema.aiProviderModelSelections.enabled, sortOrder: schema.aiProviderModelSelections.sortOrder })
      .from(schema.aiProviderModelSelections)
      .where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
    const knownModels = new Set(existingSelections.filter((selection) => selection.providerId === input.providerId).map((selection) => selection.modelId));
    let nextOrder = Math.max(-1, ...existingSelections.filter((selection) => selection.enabled).map((selection) => selection.sortOrder)) + 1;
    const newModels = rankAiModels(input.providerId, models.filter((model, index) => models.findIndex((item) => item.id === model.id) === index && !knownModels.has(model.id)));
    if (newModels.length > 0) {
      // A new provider starts with its best few models enabled; the rest are saved as known but off, so a later
      // refresh does not switch them on. Rows that already exist (the user's choice and order) are never touched.
      const preselected = new Set(defaultPreselection(newModels));
      let disabledOrder = nextOrder + preselected.size;
      await tx.insert(schema.aiProviderModelSelections).values(newModels.map((model) => {
        const enabled = preselected.has(model.id);
        return { ownerId, providerId: input.providerId, modelId: model.id, enabled, sortOrder: enabled ? nextOrder++ : disabledOrder++ };
      }));
    }
    return created;
  });
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
  await appendNewModelSelections(ownerId, row.providerId as AiProviderId, models);
  await pruneUnavailableModelSelections(ownerId);
  return models;
}

export async function setAiProviderModelQueue(
  ownerId: string,
  rawQueue: unknown,
): Promise<void> {
  const queue = z.array(z.object({
    providerId: z.enum(AI_PROVIDER_IDS),
    modelId: z.string().trim().min(1).max(200),
  }).strict()).max(MAX_MODEL_QUEUE_LENGTH).parse(rawQueue);
  const queueKeys = queue.map(modelQueueKey);
  if (new Set(queueKeys).size !== queueKeys.length) throw new AppError(400, "В очереди есть повторяющиеся модели.");

  const db = getDb();
  const accounts = await db.select({ providerId: schema.aiProviderAccounts.providerId, models: schema.aiProviderAccounts.models })
    .from(schema.aiProviderAccounts)
    .where(eq(schema.aiProviderAccounts.ownerId, ownerId));
  const availableModels = uniqueAccountModels(accounts);
  const availableKeys = new Set(availableModels.map((model) => modelQueueKey(model)));
  if (queue.some((model) => !availableKeys.has(modelQueueKey(model)))) {
    throw new AppError(400, "Очередь содержит модель, недоступную подключённым аккаунтам.");
  }
  if (availableModels.length > 0 && queue.length === 0) {
    throw new AppError(400, "Оставь включённой хотя бы одну модель, чтобы ИИ LifeOS мог работать.");
  }

  const selectedOrder = new Map(queueKeys.map((key, index) => [key, index]));
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
    if (availableModels.length > 0) {
      await tx.insert(schema.aiProviderModelSelections).values(availableModels.map((model, index) => {
        const key = modelQueueKey(model);
        const order = selectedOrder.get(key);
        return {
          ownerId,
          providerId: model.providerId,
          modelId: model.modelId,
          enabled: order !== undefined,
          sortOrder: order ?? queue.length + index,
          updatedAt: now,
        };
      }));
    }
    await tx.update(schema.ownerSettings)
      .set({ aiModelQueueInitialized: true, updatedAt: now })
      .where(eq(schema.ownerSettings.id, ownerId));
  });
}

export async function completeAiProviderOnboarding(ownerId: string): Promise<void> {
  await getDb().update(schema.ownerSettings)
    .set({ aiOnboardingCompleted: true, updatedAt: new Date() })
    .where(eq(schema.ownerSettings.id, ownerId));
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
  await pruneUnavailableModelSelections(ownerId);
}

/** Expand selected shared models into account/model candidates in manual fallback order. */
export async function loadConfiguredAiProviderConfigs(ownerId: string): Promise<AiProviderConfig[]> {
  await initializeAiModelQueue(ownerId);
  const [accounts, selections] = await Promise.all([
    getDb().select().from(schema.aiProviderAccounts)
      .where(and(eq(schema.aiProviderAccounts.ownerId, ownerId), eq(schema.aiProviderAccounts.enabled, true)))
      .orderBy(asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt)),
    getDb().select().from(schema.aiProviderModelSelections)
      .where(and(eq(schema.aiProviderModelSelections.ownerId, ownerId), eq(schema.aiProviderModelSelections.enabled, true)))
      .orderBy(asc(schema.aiProviderModelSelections.sortOrder)),
  ]);

  return expandAiModelQueue(selections, accounts).flatMap(({ account, modelId, queueOrder, accountOrder }) => {
    const provider = getAiProviderDefinition(account.providerId as AiProviderId);
    if (!provider.connectable) return [];
    const model = account.models.find((candidate) => candidate.id === modelId);
    if (!model) return [];
    return [{
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
      sortOrder: queueOrder * (MAX_ACCOUNTS_PER_USER + 1) + accountOrder,
    } satisfies AiProviderConfig];
  });
}

export async function recordAiProviderUsage(ownerId: string, accountId: string, modelId: string, outcome: "success" | "failure", failureKind?: string): Promise<void> {
  await getDb().insert(schema.aiProviderUsageEvents).values({ ownerId, accountId, modelId, outcome, failureKind: outcome === "failure" ? failureKind ?? "other" : null });
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
  const keyLimits = await Promise.all(accounts.map(async (account) => {
    if (account.providerId !== "openrouter") return null;
    try {
      return await getOpenRouterKeyInfo(account.id, decryptProviderApiKey(account.encryptedApiKey));
    } catch {
      return null;
    }
  }));
  return accounts.map((account, accountIndex) => {
    const definition = getAiProviderDefinition(account.providerId as AiProviderId);
    return {
      accountId: account.id,
      providerId: account.providerId as AiProviderId,
      providerName: definition.name,
      accountName: account.name,
      keyLimits: keyLimits[accountIndex] ?? null,
      models: account.models.map((model) => {
        const row = usage.find((value) => value.accountId === account.id && value.modelId === model.id);
        return {
          providerLimits: getObservedLimits(account.id, model.id),
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

async function initializeAiModelQueue(ownerId: string): Promise<void> {
  const db = getDb();
  const [owner] = await db.select({ initialized: schema.ownerSettings.aiModelQueueInitialized })
    .from(schema.ownerSettings)
    .where(eq(schema.ownerSettings.id, ownerId))
    .limit(1);
  if (!owner || owner.initialized) return;

  const [accounts, previousSelections] = await Promise.all([
    db.select({ providerId: schema.aiProviderAccounts.providerId, sortOrder: schema.aiProviderAccounts.sortOrder, createdAt: schema.aiProviderAccounts.createdAt, models: schema.aiProviderAccounts.models })
    .from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId))
      .orderBy(asc(schema.aiProviderAccounts.sortOrder), asc(schema.aiProviderAccounts.createdAt)),
    db.select({ providerId: schema.aiProviderModelSelections.providerId, modelId: schema.aiProviderModelSelections.modelId, enabled: schema.aiProviderModelSelections.enabled, sortOrder: schema.aiProviderModelSelections.sortOrder })
      .from(schema.aiProviderModelSelections)
      .where(eq(schema.aiProviderModelSelections.ownerId, ownerId)),
  ]);
  const models = uniqueAccountModels(accounts);
  const initialQueue = buildInitialAiModelQueue(models, previousSelections);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
    if (initialQueue.length > 0) {
      await tx.insert(schema.aiProviderModelSelections).values(initialQueue.map((model) => ({
        ownerId,
        providerId: model.providerId,
        modelId: model.modelId,
        enabled: model.enabled,
        sortOrder: model.sortOrder,
        updatedAt: now,
      })));
    }
    await tx.update(schema.ownerSettings)
      .set({ aiModelQueueInitialized: true, updatedAt: now })
      .where(eq(schema.ownerSettings.id, ownerId));
  });
}

async function appendNewModelSelections(ownerId: string, providerId: AiProviderId, models: AiProviderCatalogModel[]): Promise<void> {
  const db = getDb();
  const existing = await db.select({ providerId: schema.aiProviderModelSelections.providerId, modelId: schema.aiProviderModelSelections.modelId, enabled: schema.aiProviderModelSelections.enabled, sortOrder: schema.aiProviderModelSelections.sortOrder })
    .from(schema.aiProviderModelSelections)
    .where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
  const knownModels = new Set(existing.filter((selection) => selection.providerId === providerId).map((selection) => selection.modelId));
  const freshModels = rankAiModels(providerId, models.filter((model, index) => models.findIndex((item) => item.id === model.id) === index && !knownModels.has(model.id)));
  if (freshModels.length === 0) return;

  let nextOrder = Math.max(-1, ...existing.filter((selection) => selection.enabled).map((selection) => selection.sortOrder)) + 1;
  await db.insert(schema.aiProviderModelSelections).values(freshModels.map((model) => ({
    ownerId,
    providerId,
    modelId: model.id,
    enabled: true,
    sortOrder: nextOrder++,
  }))).onConflictDoNothing();
}

async function pruneUnavailableModelSelections(ownerId: string): Promise<void> {
  const db = getDb();
  const [accounts, selections] = await Promise.all([
    db.select({ providerId: schema.aiProviderAccounts.providerId, models: schema.aiProviderAccounts.models })
      .from(schema.aiProviderAccounts)
      .where(eq(schema.aiProviderAccounts.ownerId, ownerId)),
    db.select({ id: schema.aiProviderModelSelections.id, providerId: schema.aiProviderModelSelections.providerId, modelId: schema.aiProviderModelSelections.modelId })
      .from(schema.aiProviderModelSelections)
      .where(eq(schema.aiProviderModelSelections.ownerId, ownerId)),
  ]);
  const available = new Set(uniqueAccountModels(accounts).map(modelQueueKey));
  const stale = selections.filter((selection) => !available.has(modelQueueKey({ providerId: selection.providerId as AiProviderId, modelId: selection.modelId })));
  if (stale.length === 0) return;
  await db.transaction(async (tx) => {
    for (const selection of stale) {
      await tx.delete(schema.aiProviderModelSelections)
        .where(and(eq(schema.aiProviderModelSelections.id, selection.id), eq(schema.aiProviderModelSelections.ownerId, ownerId)));
    }
  });
}

function uniqueAccountModels(accounts: { providerId: string; models: AiProviderCatalogModel[] }[]): { providerId: AiProviderId; modelId: string }[] {
  const seen = new Set<string>();
  const models: { providerId: AiProviderId; modelId: string }[] = [];
  for (const account of accounts) {
    for (const model of account.models) {
      const entry = { providerId: account.providerId as AiProviderId, modelId: model.id };
      const key = modelQueueKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      models.push(entry);
    }
  }
  return models;
}

function modelQueueKey(model: { providerId: string; modelId: string }): string {
  return `${model.providerId}:${model.modelId}`;
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
