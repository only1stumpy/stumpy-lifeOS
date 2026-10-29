"use client";

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import { motion } from "motion/react";
import { ProviderProfilesSkeleton } from "@/components/loading/loading-skeletons";
import { useMotionVariants } from "@/components/motion/motion-system";
import { ProviderBrandMark } from "./provider-brand-mark";
import styles from "./ai-providers-panel.module.css";

type ProviderId = "gemini" | "groq" | "cerebras" | "openrouter" | "custom";
type StandardProviderId = Exclude<ProviderId, "custom">;

type ProviderAccount = {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  hasApiKey: boolean;
};

type ProviderModel = {
  id: string;
  name: string;
  selected: boolean;
  supportsImages: boolean;
  contextLength: number | null;
  accountIds: string[];
  queueOrder: number | null;
};

type AiProvider = {
  id: ProviderId;
  name: string;
  supportsImages: boolean;
  connectable: boolean;
  connectionBlockReason: string | null;
  accounts: ProviderAccount[];
  models: ProviderModel[];
};

type QueueItem = { providerId: ProviderId; modelId: string };
type ConnectForm = { name: string; apiKey: string };
type CustomForm = { name: string; endpoint: string; model: string; apiKey: string };
type LoadState = "loading" | "ready" | "error";
type Screen = "providers" | "provider" | "models" | "queue";
type ProviderActionPayload =
  | { action: "connect"; providerId: StandardProviderId; name: string; apiKey: string; freeTierConfirmed: true }
  | { action: "connect"; providerId: "custom"; name: string; endpoint: string; model: string; apiKey: string; freeTierConfirmed: true }
  | { action: "set-model-queue"; models: QueueItem[] }
  | { action: "complete-onboarding" }
  | { action: "reorder-account"; accountId: string; position: number }
  | { action: "toggle-account"; accountId: string; enabled: boolean }
  | { action: "refresh-models"; accountId: string };

type AiProvidersPanelProps = {
  initData: string;
  onClose(): void;
  onOpenQuotas?(): void;
  guidedOnboarding?: boolean;
};

const providerOrder: ProviderId[] = ["gemini", "groq", "cerebras", "openrouter", "custom"];
const providerCopy: Record<ProviderId, { mark: string | null; description: string }> = {
  gemini: { mark: null, description: "Google AI Studio · проверь, что ключ использует Free Tier." },
  groq: { mark: null, description: "Быстрые модели с бесплатной квотой." },
  cerebras: { mark: null, description: "Каталог моделей Cerebras." },
  openrouter: { mark: null, description: "Каталог бесплатных моделей с суффиксом :free." },
  custom: { mark: "API", description: "Свой OpenAI-compatible endpoint. Подключай только модель с нулевой стоимостью." },
};

const providerApiKeyPages: Record<StandardProviderId, string> = {
  gemini: "https://aistudio.google.com/app/apikey",
  groq: "https://console.groq.com/keys",
  cerebras: "https://cloud.cerebras.ai/",
  openrouter: "https://openrouter.ai/settings/keys",
};

const providerBrandClasses: Record<StandardProviderId, string> = {
  gemini: styles.brandGemini,
  groq: styles.brandGroq,
  cerebras: styles.brandCerebras,
  openrouter: styles.brandOpenrouter,
};

const emptyConnect: ConnectForm = { name: "", apiKey: "" };
const emptyCustom: CustomForm = { name: "", endpoint: "", model: "", apiKey: "" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && providerOrder.includes(value as ProviderId);
}

function isAccount(value: unknown): value is ProviderAccount {
  if (!isObject(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.enabled === "boolean"
    && typeof value.sortOrder === "number"
    && typeof value.hasApiKey === "boolean";
}

function isModel(value: unknown): value is ProviderModel {
  if (!isObject(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.selected === "boolean"
    && typeof value.supportsImages === "boolean"
    && (typeof value.contextLength === "number" || value.contextLength === null)
    && Array.isArray(value.accountIds)
    && value.accountIds.every((accountId) => typeof accountId === "string")
    && (typeof value.queueOrder === "number" || value.queueOrder === null);
}

function isProvider(value: unknown): value is AiProvider {
  if (!isObject(value)) return false;
  return isProviderId(value.id)
    && typeof value.name === "string"
    && typeof value.supportsImages === "boolean"
    && typeof value.connectable === "boolean"
    && (typeof value.connectionBlockReason === "string" || value.connectionBlockReason === null)
    && Array.isArray(value.accounts)
    && value.accounts.every(isAccount)
    && Array.isArray(value.models)
    && value.models.every(isModel);
}

function isQueueItem(value: unknown): value is QueueItem {
  return isObject(value) && isProviderId(value.providerId) && typeof value.modelId === "string";
}

function isStandardProvider(provider: AiProvider): provider is AiProvider & { id: StandardProviderId } {
  return provider.id !== "custom";
}

function errorMessage(value: unknown, fallback: string): string {
  if (isObject(value) && typeof value.error === "string" && value.error.trim()) return value.error;
  if (isObject(value) && typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function requestError(response: Response, body: unknown): string {
  if (response.status === 401 || response.status === 403) {
    return "Не удалось подтвердить Telegram-сессию. Закрой Mini App и открой его снова из бота.";
  }
  if (response.status === 429) return errorMessage(body, "Слишком много запросов подряд. Попробуй ещё раз чуть позже.");
  if (response.status >= 500) return errorMessage(body, "Сервис провайдера или сервер LifeOS временно недоступен. Попробуй ещё раз позже.");
  return errorMessage(body, "Не удалось выполнить запрос. Проверь данные и попробуй ещё раз.");
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "Не удалось связаться с сервером. Проверь подключение и попробуй ещё раз.";
  return error instanceof Error ? error.message : fallback;
}

function accountCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} аккаунтов`;
  if (last === 1) return `${count} аккаунт`;
  if (last >= 2 && last <= 4) return `${count} аккаунта`;
  return `${count} аккаунтов`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function openProviderLink(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const webApp = (window as Window & {
    Telegram?: { WebApp?: { openLink?: (url: string) => void } };
  }).Telegram?.WebApp;
  if (!webApp?.openLink) return;

  try {
    webApp.openLink(href);
    event.preventDefault();
  } catch {
    // Keep the anchor's normal navigation as a fallback if Telegram cannot open it.
  }
}

function modelKey(item: QueueItem): string {
  return `${item.providerId}:${item.modelId}`;
}

function applyQueue(providers: AiProvider[], queue: QueueItem[]): AiProvider[] {
  const order = new Map(queue.map((item, index) => [modelKey(item), index]));
  return providers.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => {
      const queueOrder = order.get(modelKey({ providerId: provider.id, modelId: model.id }));
      return { ...model, selected: queueOrder !== undefined, queueOrder: queueOrder ?? null };
    }),
  }));
}

function availableAccountNames(provider: AiProvider, model: ProviderModel): string {
  const names = model.accountIds
    .map((accountId) => provider.accounts.find((account) => account.id === accountId)?.name)
    .filter((name): name is string => typeof name === "string");
  return names.length ? names.join(" · ") : "Нет доступного аккаунта";
}

function getGlobalAccountOrder(providers: AiProvider[]): ProviderAccount[] {
  return providers
    .filter((provider) => provider.connectable)
    .flatMap((provider) => provider.accounts)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function providerStatus(provider: AiProvider): string {
  if (!provider.connectable) return "Недоступен";
  if (provider.accounts.length === 0) return "Не подключён";
  if (provider.accounts.some((account) => account.enabled && account.hasApiKey)) return "Подключён";
  return "Выключен";
}

export function AiProvidersPanel({ initData, onClose, onOpenQuotas, guidedOnboarding = false }: AiProvidersPanelProps) {
  const motionVariants = useMotionVariants();
  const connectRef = useRef<HTMLFormElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [legacyProfileCount, setLegacyProfileCount] = useState(0);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [screen, setScreen] = useState<Screen>("providers");
  const [activeProviderId, setActiveProviderId] = useState<ProviderId | null>(null);
  const [connectProviderId, setConnectProviderId] = useState<ProviderId | null>(null);
  const [connectForm, setConnectForm] = useState<ConnectForm>(emptyConnect);
  const [customForm, setCustomForm] = useState<CustomForm>(emptyCustom);
  const [providerFreeTierConfirmed, setProviderFreeTierConfirmed] = useState(false);
  const [customFreeConfirmed, setCustomFreeConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [customError, setCustomError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ providerId: ProviderId; account: ProviderAccount } | null>(null);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);

  const authorization = `tma ${initData}`;
  const guidedRun = guidedOnboarding && !onboardingCompleted;

  const reloadProviders = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/ai-providers", {
        headers: { Authorization: authorization },
        cache: "no-store",
        signal,
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      if (!isObject(body)
        || !Array.isArray(body.providers)
        || !body.providers.every(isProvider)
        || typeof body.legacyProfileCount !== "number"
        || typeof body.onboardingCompleted !== "boolean"
        || !Array.isArray(body.queue)
        || !body.queue.every(isQueueItem)) {
        throw new Error("Сервер вернул список провайдеров в неожиданном формате.");
      }
      const sorted = body.providers.slice().sort((left, right) => providerOrder.indexOf(left.id) - providerOrder.indexOf(right.id));
      const orderedQueue = body.queue.slice();
      setProviders(applyQueue(sorted, orderedQueue));
      setQueue(orderedQueue);
      setLegacyProfileCount(body.legacyProfileCount);
      setOnboardingCompleted(body.onboardingCompleted);
      setLoadState("ready");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      setLoadError(readableError(error, "Не удалось загрузить каталог ИИ. Попробуй ещё раз."));
      setLoadState("error");
      return false;
    }
  }, [authorization, setLegacyProfileCount, setLoadError, setLoadState, setOnboardingCompleted, setProviders, setQueue]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => reloadProviders(controller.signal));
    return () => controller.abort();
  }, [reloadProviders]);

  const postAction = async (payload: ProviderActionPayload): Promise<unknown> => {
    const response = await fetch("/api/ai-providers", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(requestError(response, body));
    return body;
  };

  const openProvider = (providerId: ProviderId) => {
    setActiveProviderId(providerId);
    setConnectProviderId(null);
    setFormError("");
    setCustomError("");
    setNotice("");
    setScreen("provider");
  };

  const beginConnect = (providerId: ProviderId) => {
    setConnectProviderId(providerId);
    setConnectForm(emptyConnect);
    setCustomForm(emptyCustom);
    setProviderFreeTierConfirmed(false);
    setCustomFreeConfirmed(false);
    setFormError("");
    setCustomError("");
    setNotice("");
    requestAnimationFrame(() => connectRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
  };

  const finishConnection = async (providerId: ProviderId, accountName: string) => {
    setConnectProviderId(null);
    setConnectForm(emptyConnect);
    setCustomForm(emptyCustom);
    setProviderFreeTierConfirmed(false);
    setCustomFreeConfirmed(false);
    setActiveProviderId(providerId);
    setNotice(`Аккаунт «${accountName}» проверен и подключён. Ключ сохранён и больше не отображается.`);
    setScreen("models");
    const refreshed = await reloadProviders();
    if (!refreshed) setNotice(`Аккаунт «${accountName}» подключён, но список моделей не обновился. Нажми «Повторить».`);
  };

  const submitConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectProviderId || connectProviderId === "custom" || busyAction) return;
    const name = connectForm.name.trim();
    const apiKey = connectForm.apiKey.trim();
    if (!name || !apiKey) {
      setFormError("Укажи название аккаунта и API-ключ.");
      return;
    }
    if (!providerFreeTierConfirmed) {
      setFormError("Подтверди условия бесплатного доступа и проверь настройки оплаты аккаунта.");
      return;
    }

    setBusyAction(`connect:${connectProviderId}`);
    setFormError("");
    setNotice("");
    try {
      await postAction({
        action: "connect",
        providerId: connectProviderId,
        name,
        apiKey,
        freeTierConfirmed: true,
      });
      await finishConnection(connectProviderId, name);
    } catch (error) {
      setFormError(readableError(error, "Не удалось проверить и подключить аккаунт."));
    } finally {
      setBusyAction(null);
    }
  };

  const submitCustom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyAction || providers.some((provider) => provider.id === "custom" && !provider.connectable)) return;
    const name = customForm.name.trim();
    const endpoint = customForm.endpoint.trim();
    const model = customForm.model.trim();
    const apiKey = customForm.apiKey.trim();
    if (!name || !endpoint || !model || !apiKey) {
      setCustomError("Заполни название аккаунта, endpoint, модель и API-ключ.");
      return;
    }
    try {
      if (new URL(endpoint).protocol !== "https:") {
        setCustomError("Endpoint должен использовать HTTPS.");
        return;
      }
    } catch {
      setCustomError("Укажи корректный URL endpoint.");
      return;
    }
    if (!customFreeConfirmed) {
      setCustomError("Подтверди нулевую стоимость endpoint/модели после проверки условий провайдера.");
      return;
    }

    setBusyAction("connect:custom");
    setCustomError("");
    setNotice("");
    try {
      await postAction({
        action: "connect",
        providerId: "custom",
        name,
        endpoint,
        model,
        apiKey,
        freeTierConfirmed: true,
      });
      await finishConnection("custom", name);
    } catch (error) {
      setCustomError(readableError(error, "Не удалось проверить и подключить совместимый API."));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleAccount = async (providerId: ProviderId, account: ProviderAccount) => {
    if (busyAction) return;
    const enabled = !account.enabled;
    setBusyAction(`toggle:${account.id}`);
    setLoadError("");
    setNotice("");
    setProviders((current) => current.map((provider) => provider.id === providerId
      ? { ...provider, accounts: provider.accounts.map((item) => item.id === account.id ? { ...item, enabled } : item) }
      : provider));
    try {
      await postAction({ action: "toggle-account", accountId: account.id, enabled });
      setNotice(`${account.name} ${enabled ? "включён" : "выключен"}.`);
      await reloadProviders();
    } catch (error) {
      await reloadProviders();
      setLoadError(readableError(error, "Не удалось изменить состояние аккаунта."));
    } finally {
      setBusyAction(null);
    }
  };

  const reorderAccount = async (account: ProviderAccount, direction: -1 | 1) => {
    if (busyAction) return;
    const ordered = getGlobalAccountOrder(providers);
    const currentIndex = ordered.findIndex((entry) => entry.id === account.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const next = ordered.slice();
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];

    setBusyAction(`reorder:${account.id}`);
    setNotice("");
    setProviders((current) => current.map((provider) => ({
      ...provider,
      accounts: provider.accounts.map((entry) => ({
        ...entry,
        sortOrder: next.findIndex((candidate) => candidate.id === entry.id),
      })),
    })));
    try {
      await postAction({ action: "reorder-account", accountId: account.id, position: targetIndex });
      await reloadProviders();
      setNotice(`Приоритет аккаунта «${account.name}» обновлён.`);
    } catch (error) {
      await reloadProviders();
      setLoadError(readableError(error, "Не удалось изменить приоритет аккаунтов."));
    } finally {
      setBusyAction(null);
    }
  };

  const persistQueue = async (nextQueue: QueueItem[], successMessage: string) => {
    if (busyAction) return;
    const uniqueQueue = nextQueue.filter((item, index, items) => items.findIndex((entry) => modelKey(entry) === modelKey(item)) === index);
    setBusyAction("queue");
    setQueue(uniqueQueue);
    setProviders((current) => applyQueue(current, uniqueQueue));
    setLoadError("");
    setNotice("");
    try {
      await postAction({ action: "set-model-queue", models: uniqueQueue });
      setNotice(successMessage);
    } catch (error) {
      await reloadProviders();
      setLoadError(readableError(error, "Не удалось сохранить настройки моделей."));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleModel = (provider: AiProvider, model: ProviderModel) => {
    if (busyAction || !provider.connectable) return;
    const item = { providerId: provider.id, modelId: model.id } satisfies QueueItem;
    const existingIndex = queue.findIndex((entry) => modelKey(entry) === modelKey(item));
    const nextQueue = queue.slice();
    if (existingIndex >= 0) nextQueue.splice(existingIndex, 1);
    else nextQueue.push(item);
    void persistQueue(nextQueue, `Настройки модели «${model.name}» сохранены.`);
  };

  const moveQueueItem = (fromIndex: number, toIndex: number) => {
    if (busyAction || fromIndex === toIndex || toIndex < 0 || toIndex >= queue.length) return;
    const next = queue.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    void persistQueue(next, "Порядок использования моделей сохранён.");
  };

  const onQueueDragStart = (event: DragEvent<HTMLLIElement>, index: number) => {
    setDraggedQueueIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const onQueueDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    const sourceIndex = draggedQueueIndex ?? Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(sourceIndex)) moveQueueItem(sourceIndex, index);
    setDraggedQueueIndex(null);
  };

  const refreshModels = async (provider: AiProvider, account: ProviderAccount) => {
    if (busyAction || !provider.connectable) return;
    setBusyAction(`refresh:${account.id}`);
    setLoadError("");
    setNotice("");
    try {
      await postAction({ action: "refresh-models", accountId: account.id });
      const refreshed = await reloadProviders();
      if (refreshed) setNotice(`Каталог ${provider.name} обновлён для аккаунта «${account.name}».`);
      else setNotice(`Каталог обновлён для аккаунта «${account.name}», но список моделей не загрузился. Нажми «Повторить».`);
    } catch (error) {
      setLoadError(readableError(error, "Не удалось обновить каталог моделей."));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteAccount = async (providerId: ProviderId, account: ProviderAccount) => {
    if (busyAction) return;
    setBusyAction(`delete:${account.id}`);
    setNotice("");
    setLoadError("");
    try {
      const response = await fetch(`/api/ai-providers?id=${encodeURIComponent(account.id)}`, {
        method: "DELETE",
        headers: { Authorization: authorization },
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      setConfirmDelete(null);
      await reloadProviders();
      setNotice(`Аккаунт «${account.name}» удалён.`);
    } catch (error) {
      setLoadError(readableError(error, `Не удалось удалить аккаунт провайдера ${providerId}.`));
    } finally {
      setBusyAction(null);
    }
  };

  const completeOnboarding = async (shouldClose: boolean) => {
    if (!guidedRun || busyAction) {
      if (shouldClose) onClose();
      return;
    }
    setBusyAction("complete-onboarding");
    setLoadError("");
    try {
      await postAction({ action: "complete-onboarding" });
      setOnboardingCompleted(true);
      if (shouldClose) onClose();
    } catch (error) {
      setLoadError(readableError(error, "Не удалось завершить настройку."));
    } finally {
      setBusyAction(null);
    }
  };

  const sortedProviders = providers.slice().sort((left, right) => providerOrder.indexOf(left.id) - providerOrder.indexOf(right.id));
  const activeProvider = sortedProviders.find((provider) => provider.id === activeProviderId) ?? null;
  const globalAccounts = getGlobalAccountOrder(sortedProviders);
  const activeProviderApiUrl = activeProvider && isStandardProvider(activeProvider) ? safeHttpsUrl(providerApiKeyPages[activeProvider.id]) : null;
  const screenTitle = screen === "providers"
    ? "Провайдеры ИИ"
    : screen === "provider"
      ? activeProvider?.name ?? "Провайдер"
      : screen === "models"
        ? "Выбор моделей"
        : "Порядок моделей";

  const renderAccountList = (provider: AiProvider) => {
    const accounts = provider.accounts.slice().sort((left, right) => left.sortOrder - right.sortOrder);
    if (accounts.length === 0) {
      return <p className={styles.empty}>{provider.connectable ? "Пока нет подключённых аккаунтов. Добавь ключ, чтобы получить доступ к моделям." : "Подключение аккаунтов недоступно для этого провайдера."}</p>;
    }

    return (
      <ul className={styles.accountList} aria-label={`Аккаунты ${provider.name}`}>
        {accounts.map((account) => {
          const deleting = confirmDelete?.account.id === account.id;
          const globalIndex = globalAccounts.findIndex((entry) => entry.id === account.id);
          const accountBusy = busyAction === `toggle:${account.id}` || busyAction === `reorder:${account.id}` || busyAction === `delete:${account.id}` || busyAction === `refresh:${account.id}`;
          return (
            <li key={account.id} className={styles.account}>
              <div className={styles.accountIdentity}>
                <span className={styles.priority} aria-label={!provider.connectable ? "Аккаунт не используется LifeOS" : `Приоритет ${globalIndex + 1}`}>{provider.connectable ? globalIndex + 1 : "—"}</span>
                <div className={styles.accountCopy}>
                  <strong>{account.name}</strong>
                  <span className={!provider.connectable || !account.hasApiKey ? styles.keyMissing : styles.keyState}>{!provider.connectable ? "Не используется LifeOS" : account.hasApiKey ? "API-ключ сохранён" : "Ключ не задан"}</span>
                </div>
              </div>
              <div className={styles.accountActions}>
                <button type="button" className={styles.iconAction} aria-label={`Поднять ${account.name} выше в общем списке резервов`} title="Поднять в общем списке" onClick={() => void reorderAccount(account, -1)} disabled={busyAction !== null || !provider.connectable || globalIndex <= 0}>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 14 5-5 5 5" /></svg>
                </button>
                <button type="button" className={styles.iconAction} aria-label={`Опустить ${account.name} ниже в общем списке резервов`} title="Опустить в общем списке" onClick={() => void reorderAccount(account, 1)} disabled={busyAction !== null || !provider.connectable || globalIndex < 0 || globalIndex === globalAccounts.length - 1}>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
                </button>
                <button type="button" className={styles.iconAction} aria-label={`Обновить список моделей для ${account.name}`} title="Обновить модели" onClick={() => void refreshModels(provider, account)} disabled={busyAction !== null || !provider.connectable}>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg>
                </button>
                <button type="button" role="switch" aria-checked={account.enabled} aria-label={`${account.enabled ? "Выключить" : "Включить"} аккаунт ${account.name}`} className={`${styles.switch} ${account.enabled ? styles.switchOn : ""}`} onClick={() => void toggleAccount(provider.id, account)} disabled={busyAction !== null || !provider.connectable}><span /></button>
                <button type="button" className={styles.iconAction} aria-label={`Удалить аккаунт ${account.name}`} title="Удалить аккаунт" onClick={() => setConfirmDelete(deleting ? null : { providerId: provider.id, account })} disabled={busyAction !== null}>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 3v6m4-6v6" /></svg>
                </button>
              </div>
              {deleting && (
                <div className={styles.deleteConfirm} role="group" aria-label={`Подтверждение удаления аккаунта ${account.name}`}>
                  <p>Удалить аккаунт и сохранённый ключ?</p>
                  <div>
                    <button type="button" className={styles.dangerAction} onClick={() => void deleteAccount(provider.id, account)} disabled={busyAction !== null}>Удалить</button>
                    <button type="button" className={styles.textButton} onClick={() => setConfirmDelete(null)} disabled={busyAction !== null}>Отмена</button>
                  </div>
                </div>
              )}
              {accountBusy && <span className="visually-hidden" role="status">Обновляю аккаунт {account.name}.</span>}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderModel = (provider: AiProvider, model: ProviderModel) => (
    <li key={model.id} className={styles.modelRow}>
      <label className={styles.modelChoice}>
        <input type="checkbox" checked={model.selected} onChange={() => toggleModel(provider, model)} disabled={busyAction !== null || !provider.connectable} />
        <span className={styles.modelCopy}>
          <strong>{model.name}</strong>
          <span className={styles.modelId}>{model.id}</span>
          <span className={styles.modelAvailability}>{availableAccountNames(provider, model)}</span>
        </span>
      </label>
      <span className={styles.modelBadges}>
        {model.supportsImages ? <span className={styles.capabilityAvailable}>Текст + фото</span> : <span className={styles.capabilityLimited}>Только текст</span>}
        {model.contextLength !== null && <span className={styles.contextLength}>{compactNumber(model.contextLength)} конт.</span>}
        {activeProviderApiUrl && provider.id === activeProvider?.id && (
          <a className={styles.modelApiLink} href={activeProviderApiUrl} target="_blank" rel="noreferrer noopener" onClick={(event) => openProviderLink(event, activeProviderApiUrl)} aria-label={`Открыть API-ключи ${provider.name} в новой вкладке`} title={`Страница API-ключей ${provider.name}`}>
            API-ключи <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10M8 2h6v6M14 2 7 9" /></svg>
          </a>
        )}
      </span>
    </li>
  );

  const backToProviders = () => {
    setScreen("providers");
    setNotice("");
    setLoadError("");
  };

  return (
    <section
      className={styles.sheet}
      aria-labelledby={`${id}-title`}
      data-lg-role="stage"
    >
      <div className={styles.panelContent}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            {screen !== "providers" && <button className={styles.backButton} type="button" onClick={backToProviders} aria-label="Назад к списку провайдеров"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h13" /></svg>Назад</button>}
            <p className={styles.eyebrow}>{screen === "providers" ? "ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ ИИ" : screen === "queue" ? "ОБЩИЙ ПОРЯДОК ИСПОЛЬЗОВАНИЯ" : "НАСТРОЙКА ПРОВАЙДЕРА"}</p>
            <h1 id={`${id}-title`}>{screenTitle}</h1>
          </div>
        </header>

        <div className={styles.scrollArea} aria-busy={loadState === "loading"}>
          {loadState === "ready" && legacyProfileCount > 0 && (
            <p className={styles.legacyWarning} role="status">
              Есть {legacyProfileCount} сохранённых профилей старого формата. Они не участвуют в выборе моделей, пока не будут переподключены с подтверждением бесплатного режима.
            </p>
          )}

          {loadState === "loading" && (
            <div className={styles.loadingState}>
              <span className="visually-hidden" role="status">Загружаю каталог провайдеров.</span>
              <ProviderProfilesSkeleton />
            </div>
          )}
          {loadState === "error" && (
            <div className={styles.state} role="alert">
              <p>{loadError || "Не удалось загрузить каталог ИИ."}</p>
              <button type="button" className={styles.secondaryAction} onClick={() => void reloadProviders()} disabled={busyAction !== null}>Повторить</button>
            </div>
          )}

          {loadState === "ready" && screen === "providers" && (
            <motion.div className={styles.screenContent} variants={motionVariants.screen} initial="initial" animate="animate">
              <div className={styles.introRow}>
                <p className={styles.intro}>{guidedRun ? "Выбери провайдера и подключи ключ. LifeOS проверит его, после чего покажет доступные модели." : "Выбери провайдера, чтобы управлять аккаунтами и моделями. Ключи хранятся зашифрованно и после сохранения не отображаются."} Вернуться сюда позже можно по шестерёнке в нижней панели.</p>
                {onOpenQuotas && <button className={styles.quotasLink} type="button" onClick={onOpenQuotas}>Лимиты ИИ</button>}
              </div>
              <div className={styles.providerList} aria-label="Провайдеры ИИ">
                {sortedProviders.map((provider) => {
                  const selectedCount = provider.models.filter((model) => model.selected).length;
                  const status = providerStatus(provider);
                  return (
                    <motion.button
                      key={provider.id}
                      className={styles.providerRow}
                      type="button"
                      variants={motionVariants.listItem}
                      whileTap={{ scale: 0.992 }}
                      onClick={() => openProvider(provider.id)}
                      aria-label={`${provider.name}, ${status}, ${accountCountLabel(provider.accounts.length)}, ${selectedCount} моделей выбрано. Открыть настройки`}
                    >
                      <span className={`${styles.providerMark} ${provider.id === "custom" ? "" : providerBrandClasses[provider.id]}`} aria-hidden="true">
                        {provider.id === "custom" ? providerCopy.custom.mark : <ProviderBrandMark provider={provider.id} />}
                      </span>
                      <span className={styles.providerRowCopy}>
                        <strong>{provider.name}</strong>
                        <span>{accountCountLabel(provider.accounts.length)} · {selectedCount} моделей</span>
                      </span>
                      <span className={`${styles.providerRowStatus} ${status === "Подключён" ? styles.statusConnected : status === "Недоступен" ? styles.statusUnavailable : ""}`}>{status}</span>
                      <svg className={styles.rowChevron} aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
                    </motion.button>
                  );
                })}
              </div>
              {sortedProviders.length === 0 && <p className={styles.empty}>Каталог провайдеров пуст.</p>}
            </motion.div>
          )}

          {loadState === "ready" && screen === "provider" && activeProvider && (
            <motion.div className={styles.screenContent} variants={motionVariants.screen} initial="initial" animate="animate">
              <section className={styles.providerDetails} aria-labelledby={`${id}-provider-name`}>
                <div className={styles.providerHeader}>
                  <div className={`${styles.providerMark} ${activeProvider.id === "custom" ? "" : providerBrandClasses[activeProvider.id]}`} aria-hidden="true">
                    {activeProvider.id === "custom" ? providerCopy.custom.mark : <ProviderBrandMark provider={activeProvider.id} />}
                  </div>
                  <div className={styles.providerTitle}>
                    <h3 id={`${id}-provider-name`}>{activeProvider.name}</h3>
                    <p>{!activeProvider.connectable ? activeProvider.connectionBlockReason || "Подключение этого провайдера сейчас недоступно." : providerCopy[activeProvider.id].description}</p>
                    {activeProviderApiUrl && (
                      <a className={styles.providerApiLink} href={activeProviderApiUrl} target="_blank" rel="noreferrer noopener" onClick={(event) => openProviderLink(event, activeProviderApiUrl)} aria-label={`Получить API-ключ ${activeProvider.name} в новой вкладке`}>
                        Получить API-ключ
                        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10M8 2h6v6M14 2 7 9" /></svg>
                      </a>
                    )}
                  </div>
                  <span className={`${styles.providerRowStatus} ${providerStatus(activeProvider) === "Подключён" ? styles.statusConnected : ""}`}>{providerStatus(activeProvider)}</span>
                </div>
                <div className={styles.providerMeta}>
                  <span className={activeProvider.supportsImages ? styles.capabilityAvailable : styles.capabilityLimited}>{activeProvider.supportsImages ? "Есть модели с фото" : "Только текст"}</span>
                  <span>{accountCountLabel(activeProvider.accounts.length)}</span>
                  <span>{activeProvider.models.filter((model) => model.selected).length} моделей в очереди</span>
                </div>

                <div className={styles.detailSection}>
                  <div className={styles.sectionHeading}>
                    <div><p className={styles.eyebrow}>АККАУНТЫ</p><h4>Подключения</h4></div>
                    <button className={styles.secondaryAction} type="button" onClick={() => beginConnect(activeProvider.id)} disabled={busyAction !== null || !activeProvider.connectable}><span aria-hidden="true">+</span> Добавить</button>
                  </div>
                  {renderAccountList(activeProvider)}
                </div>

                <div className={styles.detailSection}>
                  <div className={styles.sectionHeading}>
                    <div><p className={styles.eyebrow}>КАТАЛОГ</p><h4>Модели провайдера</h4></div>
                    <span className={styles.modelsCount}>{activeProvider.models.filter((model) => model.selected).length} из {activeProvider.models.length} выбрано</span>
                  </div>
                  <p className={styles.modelsIntro}>{activeProvider.models.length ? "Нажми, чтобы настроить доступные модели и перейти к общему порядку." : "Подключи аккаунт, чтобы получить список моделей."}</p>
                  {activeProvider.models.length > 0 && <button className={styles.primaryAction} type="button" onClick={() => { setModelQuery((current) => ({ ...current, [activeProvider.id]: "" })); setScreen("models"); }} disabled={!activeProvider.connectable}>Выбрать модели</button>}
                </div>

                {connectProviderId === activeProvider.id && activeProvider.id !== "custom" && activeProvider.connectable && (
                  <form ref={connectRef} className={styles.connectForm} onSubmit={submitConnect}>
                    <div className={styles.formHeading}>
                      <div><p className={styles.eyebrow}>НОВЫЙ АККАУНТ</p><h4>Проверить и подключить</h4></div>
                      <button type="button" className={styles.textButton} onClick={() => { setConnectProviderId(null); setFormError(""); }} disabled={busyAction !== null}>Отмена</button>
                    </div>
                    <label className={styles.field}><span>Название аккаунта</span><input autoComplete="organization" name="accountName" value={connectForm.name} onChange={(event) => setConnectForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, личный аккаунт" maxLength={80} required /></label>
                    <label className={styles.field}><span>API-ключ</span><input autoComplete="new-password" name="apiKey" type="password" value={connectForm.apiKey} onChange={(event) => setConnectForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Вставь ключ провайдера" required /></label>
                    <label className={styles.confirmation}>
                      <input type="checkbox" checked={providerFreeTierConfirmed} onChange={(event) => setProviderFreeTierConfirmed(event.target.checked)} />
                      <span>{activeProvider.id === "gemini" ? "Подтверждаю Free Tier. LifeOS не может проверить настройки биллинга проекта." : "Подтверждаю бесплатный план. LifeOS не может проверить подписку или настройки оплаты аккаунта."}</span>
                    </label>
                    <p className={styles.securityNote}>Перед сохранением LifeOS проверит ключ коротким тестовым запросом. Он может использовать одну бесплатную квоту. Сам ключ после подключения не показывается.</p>
                    {formError && <p className={styles.error} role="alert">{formError}</p>}
                    <button className={styles.primaryAction} type="submit" disabled={busyAction !== null || !providerFreeTierConfirmed}>{busyAction === `connect:${activeProvider.id}` ? "Проверяю ключ…" : "Проверить и подключить"}</button>
                  </form>
                )}

                {activeProvider.id === "custom" && activeProvider.connectable && connectProviderId === "custom" && (
                  <form ref={connectRef} className={styles.connectForm} onSubmit={submitCustom}>
                    <div className={styles.formHeading}>
                      <div><p className={styles.eyebrow}>РАСШИРЕННОЕ ПОДКЛЮЧЕНИЕ</p><h4>Свой endpoint</h4></div>
                      <button type="button" className={styles.textButton} onClick={() => { setConnectProviderId(null); setCustomError(""); }} disabled={busyAction !== null}>Отмена</button>
                    </div>
                    <p className={styles.modelsIntro}>Используй OpenAI-compatible Chat Completions. LifeOS не может проверить тариф модели или риск списаний.</p>
                    <label className={styles.field}><span>Название аккаунта</span><input autoComplete="organization" value={customForm.name} onChange={(event) => setCustomForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, личный endpoint" maxLength={80} required /></label>
                    <label className={styles.field}><span>Endpoint</span><input autoComplete="url" type="url" value={customForm.endpoint} onChange={(event) => setCustomForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://api.example.com/v1" required /><small>Только HTTPS.</small></label>
                    <label className={styles.field}><span>Модель</span><input autoComplete="off" value={customForm.model} onChange={(event) => setCustomForm((current) => ({ ...current, model: event.target.value }))} placeholder="Идентификатор модели" maxLength={160} required /></label>
                    <label className={styles.field}><span>API-ключ</span><input autoComplete="new-password" type="password" value={customForm.apiKey} onChange={(event) => setCustomForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Вставь ключ провайдера" required /></label>
                    <label className={styles.confirmation}><input type="checkbox" checked={customFreeConfirmed} onChange={(event) => setCustomFreeConfirmed(event.target.checked)} /><span>Подтверждаю нулевую стоимость endpoint/модели.</span></label>
                    <p className={styles.securityNote}>Ключ и endpoint будут проверены коротким тестовым запросом до сохранения.</p>
                    {customError && <p className={styles.error} role="alert">{customError}</p>}
                    <button className={styles.primaryAction} type="submit" disabled={busyAction !== null || !customFreeConfirmed}>{busyAction === "connect:custom" ? "Проверяю endpoint…" : "Проверить и подключить"}</button>
                  </form>
                )}
              </section>
            </motion.div>
          )}

          {loadState === "ready" && screen === "models" && activeProvider && (
            <motion.div className={styles.screenContent} variants={motionVariants.screen} initial="initial" animate="animate">
              <div className={styles.introRow}><p className={styles.intro}>Модели провайдера {activeProvider.name}. После выбора откроется общий порядок использования для всех провайдеров.</p></div>
              <label className={`${styles.field} ${styles.modelSearch}`}>
                <span className="visually-hidden">Поиск модели провайдера {activeProvider.name}</span>
                <input type="search" value={modelQuery[activeProvider.id] ?? ""} onChange={(event) => setModelQuery((current) => ({ ...current, [activeProvider.id]: event.target.value }))} placeholder="Найти модель по названию" />
              </label>
              {activeProvider.models.length === 0 ? (
                <p className={styles.empty}>Для этого провайдера пока нет доступных моделей. Обнови список моделей на странице провайдера.</p>
              ) : (() => {
                const query = (modelQuery[activeProvider.id] ?? "").toLocaleLowerCase("ru-RU");
                const visibleModels = activeProvider.models.filter((model) => `${model.name} ${model.id}`.toLocaleLowerCase("ru-RU").includes(query));
                return visibleModels.length ? (
                  <ul className={styles.modelList} aria-label={`Модели ${activeProvider.name}`}>
                    {visibleModels.map((model) => renderModel(activeProvider, model))}
                  </ul>
                ) : <p className={styles.empty}>Модели по этому запросу не найдены.</p>;
              })()}
            </motion.div>
          )}

          {loadState === "ready" && screen === "queue" && (
            <motion.div className={styles.screenContent} variants={motionVariants.screen} initial="initial" animate="animate">
              <div className={styles.introRow}><p className={styles.intro}>Модели со всех провайдеров в порядке, в котором LifeOS будет пробовать их использовать.</p></div>
              {queue.length === 0 ? <p className={styles.empty}>Пока нет выбранных моделей. Подключи аккаунт и отметь модели на странице провайдера.</p> : (
                <ol className={styles.queueList} aria-label="Общий порядок использования моделей">
                  {queue.map((item, index) => {
                    const provider = sortedProviders.find((entry) => entry.id === item.providerId);
                    const model = provider?.models.find((entry) => entry.id === item.modelId);
                    if (!provider || !model) return null;
                    return (
                      <li
                        key={modelKey(item)}
                        className={`${styles.queueItem} ${draggedQueueIndex === index ? styles.queueItemDragging : ""}`}
                        draggable={busyAction === null}
                        onDragStart={(event) => onQueueDragStart(event, index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onQueueDrop(event, index)}
                        onDragEnd={() => setDraggedQueueIndex(null)}
                      >
                        <span className={styles.queuePosition} aria-label={`Позиция ${index + 1}`}>{index + 1}</span>
                        <span className={styles.queueCopy}>
                          <strong>{model.name}</strong>
                          <span>{provider.name} · {availableAccountNames(provider, model)}</span>
                          <small>{model.id}</small>
                        </span>
                        <span className={styles.queueControls}>
                          <button type="button" className={styles.iconAction} aria-label={`Поднять модель ${model.name} выше`} title="Поднять выше" onClick={() => moveQueueItem(index, index - 1)} disabled={busyAction !== null || index === 0}>
                            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 14 5-5 5 5" /></svg>
                          </button>
                          <button type="button" className={styles.iconAction} aria-label={`Опустить модель ${model.name} ниже`} title="Опустить ниже" onClick={() => moveQueueItem(index, index + 1)} disabled={busyAction !== null || index === queue.length - 1}>
                            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
                          </button>
                          <span className={styles.dragHandle} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg></span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </motion.div>
          )}

          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {loadError && loadState === "ready" && <p className={styles.error} role="alert">{loadError}</p>}
        </div>

        {loadState === "ready" && screen === "providers" && (
          <footer className={styles.screenFooter} data-lg-role="dock">
            {!guidedRun && <button className={styles.primaryAction} type="button" onClick={() => { setNotice(""); setLoadError(""); setScreen("queue"); }}>Порядок использования моделей <span aria-hidden="true">→</span></button>}
            {guidedRun && queue.length > 0 && <button className={styles.primaryAction} type="button" onClick={() => { setNotice(""); setLoadError(""); setScreen("queue"); }}>Порядок использования моделей <span aria-hidden="true">→</span></button>}
            {guidedRun && <button className={styles.textButton} type="button" onClick={() => void completeOnboarding(true)} disabled={busyAction !== null}>{busyAction === "complete-onboarding" ? "Сохраняю…" : "Пропустить настройку"}</button>}
          </footer>
        )}

        {loadState === "ready" && screen === "models" && (
          <footer className={styles.screenFooter} data-lg-role="dock">
            <p className={styles.guidance}>Для продвинутых пользователей. Если вы не знаете, какую модель выбрать, ничего менять не нужно. LifeOS уже настроил доступные модели автоматически. Просто нажмите «Готово».</p>
            <button className={styles.primaryAction} type="button" onClick={() => { setNotice(""); setLoadError(""); setScreen("queue"); }} disabled={busyAction !== null}>Готово</button>
          </footer>
        )}

        {loadState === "ready" && screen === "queue" && (
          <footer className={styles.screenFooter} data-lg-role="dock">
            <p className={styles.guidance}>LifeOS автоматически настроил порядок использования моделей. Если вы не знаете, что это означает, оставьте настройки без изменений и нажмите «Готово». Вернуться к настройке можно по шестерёнке в нижней панели.</p>
            <button className={styles.primaryAction} type="button" onClick={() => void completeOnboarding(true)} disabled={busyAction !== null}>{busyAction === "complete-onboarding" ? "Сохраняю…" : "Готово"}</button>
          </footer>
        )}
      </div>
    </section>
  );
}
