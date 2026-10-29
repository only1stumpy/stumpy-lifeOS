"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { motion } from "motion/react";
import { GlassRefraction } from "@/components/glass/glass-refraction";
import { ProviderProfilesSkeleton } from "@/components/loading/loading-skeletons";
import { motionDuration, motionEase, useMotionVariants } from "@/components/motion/motion-system";
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

type ConnectForm = { name: string; apiKey: string };
type CustomForm = { name: string; endpoint: string; model: string; apiKey: string };
type LoadState = "loading" | "ready" | "error";
type ProviderActionPayload =
  | { action: "connect"; providerId: StandardProviderId; name: string; apiKey: string; freeTierConfirmed: true }
  | { action: "connect"; providerId: "custom"; name: string; endpoint: string; model: string; apiKey: string; freeTierConfirmed: true }
  | { action: "set-models"; providerId: ProviderId; modelIds: string[] }
  | { action: "reorder-account"; accountId: string; position: number }
  | { action: "toggle-account"; accountId: string; enabled: boolean }
  | { action: "refresh-models"; accountId: string };
type LocatedAccount = { account: ProviderAccount };

type AiProvidersPanelProps = {
  initData: string;
  onClose(): void;
  onOpenQuotas?(): void;
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
    && value.accountIds.every((accountId) => typeof accountId === "string");
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

function availableAccountNames(provider: AiProvider, model: ProviderModel): string {
  const names = model.accountIds
    .map((accountId) => provider.accounts.find((account) => account.id === accountId)?.name)
    .filter((name): name is string => typeof name === "string");
  return names.length ? names.join(" · ") : "Нет доступного аккаунта";
}

function getGlobalAccountOrder(providers: AiProvider[]): LocatedAccount[] {
  return providers
    .filter((provider) => provider.connectable)
    .flatMap((provider) => provider.accounts.map((account) => ({ account })))
    .sort((left, right) => left.account.sortOrder - right.account.sortOrder);
}

export function AiProvidersPanel({ initData, onClose, onOpenQuotas }: AiProvidersPanelProps) {
  const motionVariants = useMotionVariants();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const connectRef = useRef<HTMLFormElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const filterId = `lifeos-provider-glass-${id}`;
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [legacyProfileCount, setLegacyProfileCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [connectProviderId, setConnectProviderId] = useState<StandardProviderId | null>(null);
  const [connectForm, setConnectForm] = useState<ConnectForm>(emptyConnect);
  const [customForm, setCustomForm] = useState<CustomForm>(emptyCustom);
  const [providerFreeTierConfirmed, setProviderFreeTierConfirmed] = useState(false);
  const [customFreeConfirmed, setCustomFreeConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [customError, setCustomError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [modelOpenProvider, setModelOpenProvider] = useState<ProviderId | null>(null);
  const [modelQuery, setModelQuery] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ providerId: ProviderId; account: ProviderAccount } | null>(null);

  const authorization = `tma ${initData}`;

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
      if (!isObject(body) || !Array.isArray(body.providers) || !body.providers.every(isProvider) || typeof body.legacyProfileCount !== "number") {
        throw new Error("Сервер вернул список провайдеров в неожиданном формате.");
      }
      const sorted = body.providers.slice().sort((left, right) => providerOrder.indexOf(left.id) - providerOrder.indexOf(right.id));
      setProviders(sorted);
      setLegacyProfileCount(body.legacyProfileCount);
      setLoadState("ready");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      setLoadError(readableError(error, "Не удалось загрузить каталог ИИ. Попробуй ещё раз."));
      setLoadState("error");
      return false;
    }
  }, [authorization]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => reloadProviders(controller.signal));
    return () => controller.abort();
  }, [reloadProviders]);

  const postAction = async (payload: ProviderActionPayload) => {
    const response = await fetch("/api/ai-providers", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(requestError(response, body));
    return body;
  };

  const beginConnect = (providerId: StandardProviderId) => {
    setConnectProviderId(providerId);
    setConnectForm(emptyConnect);
    setProviderFreeTierConfirmed(false);
    setFormError("");
    setNotice("");
    requestAnimationFrame(() => connectRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
  };

  const submitConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectProviderId || busyAction) return;
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
      setConnectForm(emptyConnect);
      setConnectProviderId(null);
      setProviderFreeTierConfirmed(false);
      setNotice(`Аккаунт «${name}» проверен и подключён. Ключ сохранён и больше не отображается.`);
      const refreshed = await reloadProviders();
      if (!refreshed) setNotice(`Аккаунт «${name}» подключён, но список не обновился. Нажми «Повторить».`);
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
      setCustomForm(emptyCustom);
      setCustomFreeConfirmed(false);
      setNotice(`Аккаунт «${name}» проверен и подключён. Ключ сохранён и больше не отображается.`);
      const refreshed = await reloadProviders();
      if (!refreshed) setNotice(`Аккаунт «${name}» подключён, но список не обновился. Нажми «Повторить».`);
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
    const currentIndex = ordered.findIndex((item) => item.account.id === account.id);
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
        sortOrder: next.findIndex((candidate) => candidate.account.id === entry.id),
      })),
    })));
    try {
      await postAction({ action: "reorder-account", accountId: account.id, position: targetIndex });
    } catch (error) {
      await reloadProviders();
      setLoadError(readableError(error, "Не удалось изменить приоритет аккаунтов."));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleModel = async (provider: AiProvider, model: ProviderModel) => {
    if (busyAction || !provider.connectable) return;
    const modelIds = provider.models.filter((item) => item.selected !== (item.id === model.id)).map((item) => item.id);
    setBusyAction(`model:${provider.id}`);
    setLoadError("");
    setNotice("");
    setProviders((current) => current.map((item) => item.id === provider.id
      ? { ...item, models: item.models.map((entry) => entry.id === model.id ? { ...entry, selected: !entry.selected } : entry) }
      : item));
    try {
      await postAction({ action: "set-models", providerId: provider.id, modelIds });
      setNotice(`Список моделей ${provider.name} обновлён.`);
    } catch (error) {
      await reloadProviders();
      setLoadError(readableError(error, "Не удалось сохранить список моделей."));
    } finally {
      setBusyAction(null);
    }
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
      setProviders((current) => current.map((provider) => provider.id === providerId
        ? { ...provider, accounts: provider.accounts.filter((item) => item.id !== account.id), models: provider.models.map((model) => ({ ...model, accountIds: model.accountIds.filter((id) => id !== account.id) })) }
        : provider));
      setConfirmDelete(null);
      setNotice(`Аккаунт «${account.name}» удалён.`);
    } catch (error) {
      setLoadError(readableError(error, "Не удалось удалить аккаунт."));
    } finally {
      setBusyAction(null);
    }
  };

  const sortedProviders = providers.slice().sort((left, right) => providerOrder.indexOf(left.id) - providerOrder.indexOf(right.id));
  const standardProviders = sortedProviders.filter(isStandardProvider);
  const customProvider = sortedProviders.find((provider) => provider.id === "custom");
  const globalAccounts = getGlobalAccountOrder(sortedProviders);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      data-lg-role="stage"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={surfaceRef} className={styles.sheet} data-lg-role="focus">
        <GlassRefraction surfaceRef={surfaceRef} filterId={filterId} profile="soft" />
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ ИИ</p>
            <h2 id={`${id}-title`}>Провайдеры и модели</h2>
          </div>
          <button ref={closeRef} className={styles.close} type="button" aria-label="Закрыть настройки провайдеров" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className={styles.scrollArea} aria-busy={loadState === "loading"}>
          <div className={styles.introRow}>
            <p className={styles.intro}>Каталог показывает модели, которые провайдер подтверждает как бесплатные. Подключённый ключ проходит короткий тест до сохранения. LifeOS не видит настройки биллинга аккаунта; резервный порядок общий для всех провайдеров.</p>
            {onOpenQuotas && <button className={styles.quotasLink} type="button" onClick={onOpenQuotas}>Лимиты ИИ</button>}
          </div>

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

          {loadState === "ready" && (
            <div className={styles.providerList}>
              {standardProviders.map((provider) => {
                const copy = providerCopy[provider.id];
                const accounts = provider.accounts.slice().sort((left, right) => left.sortOrder - right.sortOrder);
                const selectedCount = provider.models.filter((model) => model.selected).length;
                const query = modelQuery[provider.id] ?? "";
                const visibleModels = provider.models
                  .filter((model) => `${model.name} ${model.id}`.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU")))
                  .slice(0, query ? 100 : 40);
                const modelSectionOpen = modelOpenProvider === provider.id;
                const connecting = connectProviderId === provider.id;
                const connectingNow = busyAction === `connect:${provider.id}`;
                const providerUnavailable = !provider.connectable;
                const apiKeysUrl = safeHttpsUrl(providerApiKeyPages[provider.id]);

                return (
                  <motion.section
                    key={provider.id}
                    className={styles.providerCard}
                    variants={motionVariants.listItem}
                    initial="initial"
                    animate="animate"
                    transition={{ layout: { type: "tween", duration: motionDuration.enter, ease: motionEase.inOut } }}
                    aria-labelledby={`${id}-${provider.id}-heading`}
                  >
                    <div className={styles.providerHeader}>
                      <div className={`${styles.providerMark} ${providerBrandClasses[provider.id]}`} aria-hidden="true">
                        <ProviderBrandMark provider={provider.id} />
                      </div>
                      <div className={styles.providerTitle}>
                        <h3 id={`${id}-${provider.id}-heading`}>{provider.name}</h3>
                        <p>{providerUnavailable ? provider.connectionBlockReason || "Подключение этого провайдера сейчас недоступно." : copy.description}</p>
                        {apiKeysUrl && (
                          <a
                            className={styles.providerApiLink}
                            href={apiKeysUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(event) => openProviderLink(event, apiKeysUrl)}
                            aria-label={provider.id === "cerebras" ? `Открыть сайт провайдера ${provider.name} в новой вкладке` : `Получить API-ключ ${provider.name} в новой вкладке`}
                          >
                            {provider.id === "cerebras" ? "Сайт провайдера" : "Получить API-ключ"}
                            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10M8 2h6v6M14 2 7 9" /></svg>
                          </a>
                        )}
                      </div>
                      <div className={styles.providerMeta}>
                        <span className={provider.supportsImages ? styles.capabilityAvailable : styles.capabilityLimited}>
                          {provider.supportsImages ? "Есть модели с фото" : "Только текст"}
                        </span>
                        {!provider.connectable && <span className={styles.capabilityLimited}>Подключение недоступно</span>}
                        <span>{accountCountLabel(accounts.length)}</span>
                      </div>
                    </div>

                    <div className={styles.cardDivider} />
                    <div className={styles.sectionHeading}>
                      <div>
                        <p className={styles.eyebrow}>АККАУНТЫ</p>
                        <h4>Подключения</h4>
                      </div>
                      <button className={styles.secondaryAction} type="button" onClick={() => beginConnect(provider.id)} disabled={busyAction !== null || providerUnavailable}>
                        <span aria-hidden="true">+</span> Добавить
                      </button>
                    </div>

                    {accounts.length === 0 ? (
                      <p className={styles.empty}>{providerUnavailable ? "Подключение аккаунтов недоступно для этого провайдера." : "Пока нет подключённых аккаунтов. Добавь ключ, чтобы получить доступ к бесплатным моделям."}</p>
                    ) : (
                      <ul className={styles.accountList}>
                        {accounts.map((account) => {
                          const deleting = confirmDelete?.account.id === account.id;
                          const accountBusy = busyAction === `toggle:${account.id}` || busyAction === `reorder:${account.id}` || busyAction === `delete:${account.id}` || busyAction === `refresh:${account.id}`;
                          const globalIndex = globalAccounts.findIndex((item) => item.account.id === account.id);
                          return (
                            <li key={account.id} className={styles.account}>
                              <div className={styles.accountIdentity}>
                                <span className={styles.priority} aria-label={providerUnavailable ? "Аккаунт не используется LifeOS" : `Приоритет ${globalIndex + 1}`}>{providerUnavailable ? "—" : globalIndex + 1}</span>
                                <div className={styles.accountCopy}>
                                  <strong>{account.name}</strong>
                                  <span className={providerUnavailable ? styles.keyMissing : account.hasApiKey ? styles.keyState : styles.keyMissing}>{providerUnavailable ? "Не используется LifeOS" : account.hasApiKey ? "API-ключ сохранён" : "Ключ не задан"}</span>
                                </div>
                              </div>
                              <div className={styles.accountActions}>
                                <button type="button" className={styles.iconAction} aria-label={`Поднять ${account.name} выше в общем списке резервов`} title="Поднять в общем списке" onClick={() => void reorderAccount(account, -1)} disabled={busyAction !== null || providerUnavailable || globalIndex <= 0}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 14 5-5 5 5" /></svg>
                                </button>
                                <button type="button" className={styles.iconAction} aria-label={`Опустить ${account.name} ниже в общем списке резервов`} title="Опустить в общем списке" onClick={() => void reorderAccount(account, 1)} disabled={busyAction !== null || providerUnavailable || globalIndex < 0 || globalIndex === globalAccounts.length - 1}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
                                </button>
                                <button type="button" className={styles.iconAction} aria-label={`Обновить список моделей для ${account.name}`} title="Обновить модели" onClick={() => void refreshModels(provider, account)} disabled={busyAction !== null || providerUnavailable}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg>
                                </button>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={account.enabled}
                                  aria-label={`${account.enabled ? "Выключить" : "Включить"} аккаунт ${account.name}`}
                                  className={`${styles.switch} ${account.enabled ? styles.switchOn : ""}`}
                                  onClick={() => void toggleAccount(provider.id, account)}
                                  disabled={busyAction !== null || providerUnavailable}
                                ><span /></button>
                                <button type="button" className={styles.iconAction} aria-label={`Удалить аккаунт ${account.name}`} title="Удалить аккаунт" onClick={() => setConfirmDelete(deleting ? null : { providerId: provider.id, account })} disabled={busyAction !== null}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 3v6m4-6v6" /></svg>
                                </button>
                              </div>
                              {deleting && (
                                <div className={styles.deleteConfirm}>
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
                    )}

                    {connecting && !providerUnavailable && (
                      <form ref={connectRef} className={styles.connectForm} onSubmit={submitConnect}>
                        <div className={styles.formHeading}>
                          <div>
                            <p className={styles.eyebrow}>НОВЫЙ АККАУНТ</p>
                            <h4>Проверить и подключить</h4>
                          </div>
                          <button type="button" className={styles.textButton} onClick={() => { setConnectProviderId(null); setFormError(""); }} disabled={connectingNow}>Отмена</button>
                        </div>
                        <label className={styles.field}>
                          <span>Название аккаунта</span>
                          <input autoComplete="organization" name="accountName" value={connectForm.name} onChange={(event) => setConnectForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, личный аккаунт" maxLength={80} required />
                        </label>
                        <label className={styles.field}>
                          <span>API-ключ</span>
                          <input autoComplete="new-password" name="apiKey" type="password" value={connectForm.apiKey} onChange={(event) => setConnectForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Вставь ключ провайдера" required />
                        </label>
                        {provider.id === "gemini" && (
                          <label className={styles.confirmation}>
                            <input type="checkbox" checked={providerFreeTierConfirmed} onChange={(event) => setProviderFreeTierConfirmed(event.target.checked)} />
                            <span>Подтверждаю Free Tier. LifeOS не может проверить настройки биллинга проекта.</span>
                          </label>
                        )}
                        {provider.id !== "gemini" && (
                          <label className={styles.confirmation}>
                            <input type="checkbox" checked={providerFreeTierConfirmed} onChange={(event) => setProviderFreeTierConfirmed(event.target.checked)} />
                            <span>Подтверждаю бесплатный план. LifeOS не может проверить подписку или настройки оплаты аккаунта.</span>
                          </label>
                        )}
                        <p className={styles.securityNote}>Перед сохранением LifeOS проверит ключ и выполнит короткий тестовый запрос. Он может использовать одну бесплатную квоту. Сам ключ после подключения не показывается.</p>
                        {formError && <p className={styles.error} role="alert">{formError}</p>}
                          <button className={styles.primaryAction} type="submit" disabled={busyAction !== null || !providerFreeTierConfirmed}>
                          {connectingNow ? "Проверяю ключ…" : "Проверить и подключить"}
                        </button>
                      </form>
                    )}

                    {accounts.length > 0 && (
                      <section className={styles.modelsSection} aria-labelledby={`${id}-${provider.id}-models-title`}>
                        <button className={styles.modelsToggle} type="button" aria-expanded={modelSectionOpen} aria-controls={`${id}-${provider.id}-models`} onClick={() => setModelOpenProvider(modelSectionOpen ? null : provider.id)}>
                          <span>
                            <span className={styles.eyebrow}>ОБЩИЙ КАТАЛОГ</span>
                            <strong id={`${id}-${provider.id}-models-title`}>Бесплатные модели</strong>
                          </span>
                          <span className={styles.modelsCount}>{providerUnavailable ? "Провайдер недоступен" : `${selectedCount} из ${provider.models.length} выбрано`}</span>
                          <svg className={modelSectionOpen ? styles.chevronOpen : ""} aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                        {modelSectionOpen && (
                          <div className={styles.modelsPanel} id={`${id}-${provider.id}-models`}>
                            <p className={styles.modelsIntro}>{providerUnavailable ? "Каталог сохранён для справки. Этот провайдер сейчас не используется LifeOS." : "Отметь модели, которые LifeOS может использовать. Резервные аккаунты идут в указанном выше порядке."}</p>
                            <label className={`${styles.field} ${styles.modelSearch}`}>
                              <span className="visually-hidden">Поиск бесплатной модели провайдера {provider.name}</span>
                              <input type="search" value={query} onChange={(event) => setModelQuery((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder="Найти модель по названию" />
                            </label>
                            {provider.models.length === 0 ? (
                              <p className={styles.empty}>Для этого провайдера пока нет доступных бесплатных моделей. Подключи аккаунт заново или обнови список.</p>
                            ) : visibleModels.length === 0 ? (
                              <p className={styles.empty}>Модели по этому запросу не найдены.</p>
                            ) : (
                              <ul className={styles.modelList} aria-label={`Модели ${provider.name}`}>
                                {visibleModels.map((model) => (
                                  <li key={model.id} className={styles.modelRow}>
                                    <label className={styles.modelChoice}>
                                      <input type="checkbox" checked={model.selected} onChange={() => void toggleModel(provider, model)} disabled={busyAction !== null || providerUnavailable} />
                                      <span className={styles.modelCopy}>
                                        <strong>{model.name}</strong>
                                        <span className={styles.modelId}>{model.id}</span>
                                        <span className={styles.modelAvailability}>{availableAccountNames(provider, model)}</span>
                                      </span>
                                    </label>
                                    <span className={styles.modelBadges}>
                                      {model.supportsImages ? <span className={styles.capabilityAvailable}>Текст + фото</span> : <span className={styles.capabilityLimited}>Только текст</span>}
                                      {model.contextLength !== null && <span className={styles.contextLength}>{compactNumber(model.contextLength)} конт.</span>}
                                      {apiKeysUrl && (
                                        <a className={styles.modelApiLink} href={apiKeysUrl} target="_blank" rel="noreferrer noopener" onClick={(event) => openProviderLink(event, apiKeysUrl)} aria-label={`Открыть API-ключи ${provider.name} в новой вкладке`} title={`Страница API-ключей ${provider.name}`}>
                                          API-ключи <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10M8 2h6v6M14 2 7 9" /></svg>
                                        </a>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {provider.models.length > visibleModels.length && !query && <p className={styles.catalogHint}>Показано {visibleModels.length} моделей. Найди нужную через поиск выше.</p>}
                          </div>
                        )}
                      </section>
                    )}
                  </motion.section>
                );
              })}

              {standardProviders.length === 0 && <p className={styles.empty}>Каталог провайдеров пока не загрузился. Нажми «Повторить», чтобы обновить список.</p>}

              <details className={`${styles.providerCard} ${styles.customCard}`}>
                <summary className={styles.customSummary}>
                  <span className={styles.providerMark} aria-hidden="true">{providerCopy.custom.mark}</span>
                  <span className={styles.providerTitle}>
                    <strong>Другой OpenAI-compatible API</strong>
                    <span>Свой OpenAI-compatible endpoint. LifeOS не может проверить тариф модели или риск списаний.</span>
                    {customProvider && <span className={customProvider.supportsImages ? styles.capabilityAvailable : styles.capabilityLimited}>{customProvider.supportsImages ? "Есть модели с фото" : "Только текст"}</span>}
                    {customProvider && !customProvider.connectable && <span className={styles.capabilityLimited}>{customProvider.connectionBlockReason || "Подключение этого провайдера сейчас недоступно."}</span>}
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className={styles.customContent}>
                  {(() => {
                    const customProvider = sortedProviders.find((provider) => provider.id === "custom");
                    if (!customProvider) return <p className={styles.empty}>Пока нет подключённых совместимых API.</p>;
                    const providerUnavailable = !customProvider.connectable;
                    const accounts = customProvider.accounts.slice().sort((left, right) => left.sortOrder - right.sortOrder);
                    return accounts.length ? (
                      <ul className={styles.accountList}>
                        {accounts.map((account) => {
                          const globalIndex = globalAccounts.findIndex((item) => item.account.id === account.id);
                          return <li key={account.id} className={styles.account}>
                            <div className={styles.accountIdentity}>
                              <span className={styles.priority} aria-label={providerUnavailable ? "Аккаунт не используется LifeOS" : `Приоритет ${globalIndex + 1}`}>{providerUnavailable ? "—" : globalIndex + 1}</span>
                              <div className={styles.accountCopy}><strong>{account.name}</strong><span className={providerUnavailable ? styles.keyMissing : styles.keyState}>{providerUnavailable ? "Не используется LifeOS" : account.hasApiKey ? "API-ключ сохранён" : "Ключ не задан"}</span></div>
                            </div>
                            <div className={styles.accountActions}>
                              <button type="button" className={styles.iconAction} aria-label={`Поднять ${account.name} выше в общем списке резервов`} onClick={() => void reorderAccount(account, -1)} disabled={busyAction !== null || providerUnavailable || globalIndex <= 0}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 14 5-5 5 5" /></svg></button>
                              <button type="button" className={styles.iconAction} aria-label={`Опустить ${account.name} ниже в общем списке резервов`} onClick={() => void reorderAccount(account, 1)} disabled={busyAction !== null || providerUnavailable || globalIndex < 0 || globalIndex === globalAccounts.length - 1}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></button>
                              <button type="button" className={styles.iconAction} aria-label={`Обновить список моделей для ${account.name}`} onClick={() => void refreshModels(customProvider, account)} disabled={busyAction !== null || providerUnavailable}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg></button>
                              <button type="button" role="switch" aria-checked={account.enabled} aria-label={`${account.enabled ? "Выключить" : "Включить"} аккаунт ${account.name}`} className={`${styles.switch} ${account.enabled ? styles.switchOn : ""}`} onClick={() => void toggleAccount("custom", account)} disabled={busyAction !== null || providerUnavailable}><span /></button>
                              <button type="button" className={styles.iconAction} aria-label={`Удалить аккаунт ${account.name}`} onClick={() => setConfirmDelete({ providerId: "custom", account })} disabled={busyAction !== null}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 3v6m4-6v6" /></svg></button>
                            </div>
                            {confirmDelete?.account.id === account.id && <div className={styles.deleteConfirm}><p>Удалить аккаунт и сохранённый ключ?</p><div><button type="button" className={styles.dangerAction} onClick={() => void deleteAccount("custom", account)} disabled={busyAction !== null}>Удалить</button><button type="button" className={styles.textButton} onClick={() => setConfirmDelete(null)} disabled={busyAction !== null}>Отмена</button></div></div>}
                          </li>;
                        })}
                      </ul>
                    ) : <p className={styles.empty}>Пока нет подключённых совместимых API.</p>;
                  })()}

                  {(() => {
                    const customProvider = sortedProviders.find((provider) => provider.id === "custom");
                    if (!customProvider?.models.length) return null;
                    return (
                      <section className={styles.modelsSection} aria-labelledby={`${id}-custom-models-title`}>
                        <div className={styles.customModelsHeading}>
                          <div><p className={styles.eyebrow}>ОБЩИЙ КАТАЛОГ</p><h4 id={`${id}-custom-models-title`}>Подключённые модели</h4></div>
                          <span className={styles.modelsCount}>{customProvider.connectable ? `${customProvider.models.filter((model) => model.selected).length} из ${customProvider.models.length} выбрано` : "Провайдер недоступен"}</span>
                        </div>
                        <ul className={styles.modelList} aria-label="Модели совместимого API">
                          {customProvider.models.map((model) => (
                            <li key={model.id} className={styles.modelRow}>
                              <label className={styles.modelChoice}>
                                <input type="checkbox" checked={model.selected} onChange={() => void toggleModel(customProvider, model)} disabled={busyAction !== null || !customProvider.connectable} />
                                <span className={styles.modelCopy}><strong>{model.name}</strong><span className={styles.modelId}>{model.id}</span><span className={styles.modelAvailability}>{availableAccountNames(customProvider, model)}</span></span>
                              </label>
                              <span className={styles.modelBadges}>
                                {model.supportsImages ? <span className={styles.capabilityAvailable}>Текст + фото</span> : <span className={styles.capabilityLimited}>Только текст</span>}
                                {model.contextLength !== null && <span className={styles.contextLength}>{compactNumber(model.contextLength)} конт.</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })()}

                  {customProvider?.connectable !== false ? <form className={styles.connectForm} onSubmit={submitCustom}>
                    <div className={styles.formHeading}>
                      <div><p className={styles.eyebrow}>РАСШИРЕННОЕ ПОДКЛЮЧЕНИЕ</p><h4>Свой endpoint</h4></div>
                    </div>
                    <label className={styles.field}><span>Название аккаунта</span><input autoComplete="organization" value={customForm.name} onChange={(event) => setCustomForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, личный endpoint" maxLength={80} required /></label>
                    <label className={styles.field}><span>Endpoint</span><input autoComplete="url" type="url" value={customForm.endpoint} onChange={(event) => setCustomForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://api.example.com/v1" required /><small>LifeOS использует OpenAI-compatible Chat Completions. Только HTTPS.</small></label>
                    <label className={styles.field}><span>Модель</span><input autoComplete="off" value={customForm.model} onChange={(event) => setCustomForm((current) => ({ ...current, model: event.target.value }))} placeholder="Идентификатор модели" maxLength={160} required /></label>
                    <label className={styles.field}><span>API-ключ</span><input autoComplete="new-password" type="password" value={customForm.apiKey} onChange={(event) => setCustomForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Вставь ключ провайдера" required /></label>
                    <label className={styles.confirmation}><input type="checkbox" checked={customFreeConfirmed} onChange={(event) => setCustomFreeConfirmed(event.target.checked)} /><span>Подтверждаю нулевую стоимость endpoint/модели. LifeOS не может проверить тариф endpoint или риск списаний.</span></label>
                    <p className={styles.securityNote}>Ключ и endpoint будут проверены коротким тестовым запросом до сохранения. Провайдер должен поддерживать OpenAI-compatible Chat Completions.</p>
                    {customError && <p className={styles.error} role="alert">{customError}</p>}
                    <button className={styles.primaryAction} type="submit" disabled={busyAction !== null || !customFreeConfirmed}>{busyAction === "connect:custom" ? "Проверяю endpoint…" : "Проверить и подключить"}</button>
                  </form> : <p className={styles.empty}>{customProvider?.connectionBlockReason || "Подключение этого провайдера сейчас недоступно."}</p>}
                </div>
              </details>
            </div>
          )}

          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {loadError && loadState === "ready" && <p className={styles.error} role="alert">{loadError}</p>}
        </div>
      </section>
    </dialog>
  );
}
