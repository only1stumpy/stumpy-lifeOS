"use client";

import { plural as pluralWord } from "@/domain/plural";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AiQuotaMetric, AiQuotaSnapshot } from "@/domain/ai-quotas";
import { Button, IconButton, Link } from "@/components/ui";
import { GlassRefraction } from "@/components/glass/glass-refraction";
import { AiQuotasSkeleton } from "@/components/loading/loading-skeletons";
import { motionDuration, motionEase, motionSpring, useMotionVariants } from "@/components/motion/motion-system";
import styles from "./ai-quotas-panel.module.css";

type AiQuotasPanelProps = { initData: string; onClose(): void };
type LoadState = "loading" | "ready" | "error";
type ProviderUsageModel = {
  modelId: string;
  modelName: string;
  requestCount24h: number;
  knownRequestsPerDay: number | null;
  knownRequestsPerMinute: number | null;
  knownTokensPerMinute: number | null;
  source: "published_limit_and_lifeos_counter" | "lifeos_counter_only";
};
type ProviderUsage = {
  accountId: string;
  providerId: string;
  providerName: string;
  accountName: string;
  models: ProviderUsageModel[];
};
type QuotaResponse = { providers: ProviderUsage[]; legacyGemini: AiQuotaSnapshot | null };

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const windows: Record<NonNullable<AiQuotaMetric["window"]>, string> = {
  per_minute: "в минуту",
  per_hour: "в час",
  per_day: "в день",
  unknown: "период не определён",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuotaSnapshot(value: unknown): value is AiQuotaSnapshot {
  if (!isObject(value)) return false;
  return value.provider === "gemini"
    && typeof value.model === "string"
    && ["ready", "not_configured", "permission_missing", "unavailable"].includes(String(value.status))
    && Array.isArray(value.metrics)
    && typeof value.message === "string";
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (!isObject(value) || typeof value.accountId !== "string" || typeof value.providerId !== "string" || typeof value.providerName !== "string" || typeof value.accountName !== "string" || !Array.isArray(value.models)) return false;
  return value.models.every((model) => isObject(model)
    && typeof model.modelId === "string"
    && typeof model.modelName === "string"
    && typeof model.requestCount24h === "number"
    && ["published_limit_and_lifeos_counter", "lifeos_counter_only"].includes(String(model.source))
    && ["knownRequestsPerDay", "knownRequestsPerMinute", "knownTokensPerMinute"].every((key) => model[key] === null || typeof model[key] === "number"));
}

function isQuotaResponse(value: unknown): value is QuotaResponse {
  return isObject(value)
    && Array.isArray(value.providers)
    && value.providers.every(isProviderUsage)
    && (value.legacyGemini === null || isQuotaSnapshot(value.legacyGemini));
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function plural(value: number, forms: [string, string, string]): string {
  return pluralWord(value, forms[0], forms[1], forms[2]);
}

function amount(value: number, unit: AiQuotaMetric["unit"]): string {
  const forms = unit === "tokens" ? ["токен", "токена", "токенов"] as [string, string, string] : ["запрос", "запроса", "запросов"] as [string, string, string];
  return `${numberFormat.format(value)} ${plural(value, forms)}`;
}

function ProviderUsageCard({ provider }: { provider: ProviderUsage }) {
  return (
    <section className={styles.usageCard} aria-label={`${provider.providerName}, ${provider.accountName}`}>
      <div className={styles.usageHeading}>
        <div><span>{provider.providerName}</span><h3>{provider.accountName}</h3></div>
        <span className={styles.usageBadge}>Лимиты и запросы</span>
      </div>
      {provider.models.length ? (
        <ul className={styles.usageModels}>
          {provider.models.map((model) => (
            <li key={model.modelId} className={styles.usageModel}>
              <strong>{model.modelName}</strong>
              <span className={styles.modelId}>{model.modelId}</span>
              <div className={styles.usageStats}>
                <div><span>LifeOS за 24 часа</span><b>{amount(model.requestCount24h, "requests")}</b></div>
                {model.knownRequestsPerDay !== null && <div><span>Бесплатная квота</span><b>{amount(model.knownRequestsPerDay, "requests")} в день</b></div>}
                {model.knownRequestsPerMinute !== null && <div><span>Опубликованный максимум</span><b>{amount(model.knownRequestsPerMinute, "requests")} в минуту</b></div>}
                {model.knownTokensPerMinute !== null && <div><span>Ограничение по токенам</span><b>{amount(model.knownTokensPerMinute, "tokens")} в минуту</b></div>}
              </div>
              <p className={styles.usageNote}>
                {model.source === "published_limit_and_lifeos_counter"
                  ? "Квота опубликована провайдером; счётчик LifeOS учитывает только запросы этого приложения. Остаток на стороне провайдера отдельно не читается."
                  : "Точную квоту API-ключа прочитать нельзя. Показан счётчик запросов LifeOS за последние 24 часа, это не остаток квоты."}
              </p>
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>Для аккаунта пока нет сохранённых моделей.</p>}
    </section>
  );
}

function MetricRow({ metric }: { metric: AiQuotaMetric }) {
  const motionVariants = useMotionVariants();
  const prefersReducedMotion = useReducedMotion() !== false;
  const progress = metric.limit !== null && metric.limit > 0 && metric.used !== null ? Math.min(100, (metric.used / metric.limit) * 100) : null;
  const remaining = metric.limit !== null && metric.used !== null ? Math.max(0, metric.limit - metric.used) : null;
  const headingId = `ai-quota-${metric.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <motion.section layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={{ layout: { type: "tween", duration: motionDuration.enter, ease: motionEase.inOut } }} className={styles.metric} aria-labelledby={headingId}>
      <div className={styles.metricHeading}><h3 id={headingId}>{metric.label}</h3>{metric.window && <span>{windows[metric.window]}</span>}</div>
      {metric.limit !== null ? <>
        <div className={styles.metricValues}><strong>{metric.used === null ? "—" : amount(metric.used, metric.unit)}</strong><span>из {amount(metric.limit, metric.unit)}</span></div>
        {progress !== null && <div className={styles.track} role="progressbar" aria-label={metric.label} aria-valuemin={0} aria-valuemax={metric.limit} aria-valuenow={metric.used ?? 0}><motion.span initial={false} animate={{ transform: `scaleX(${progress / 100})` }} transition={prefersReducedMotion ? { duration: 0 } : motionSpring.gentle} style={{ transformOrigin: "left center" }} /></div>}
        {remaining !== null && <p className={styles.remaining}>Осталось {amount(remaining, metric.unit)}</p>}
      </> : <p className={styles.emptyMetric}>{metric.used === null ? "Данные пока не опубликованы Google." : `${amount(metric.used, metric.unit)} использовано`}</p>}
    </motion.section>
  );
}

function statusTitle(status: AiQuotaSnapshot["status"]): string {
  switch (status) {
    case "ready": return "Квоты Gemini по Google Cloud";
    case "not_configured": return "Доступ к квотам не настроен";
    case "permission_missing": return "Google Cloud не дал доступ к метрикам";
    case "unavailable": return "Метрики Gemini сейчас недоступны";
  }
}

export function AiQuotasPanel({ initData, onClose }: AiQuotasPanelProps) {
  const motionVariants = useMotionVariants();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const filterId = `lifeos-quota-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setLoadState("loading");
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", cancel);
    return () => { dialog.removeEventListener("cancel", cancel); if (dialog.open) dialog.close(); };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai-quotas", { headers: { Authorization: `tma ${initData}` }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = isObject(body) && typeof body.error === "string" ? body.error : "Не удалось загрузить квоты. Попробуй обновить.";
          throw new Error(message);
        }
        if (!isQuotaResponse(body)) throw new Error("Сервер вернул данные лимитов в неожиданном формате.");
        return body;
      })
      .then((response) => { setData(response); setLoadState("ready"); })
      .catch(() => { if (!controller.signal.aborted) { setData(null); setLoadState("error"); } });
    return () => controller.abort();
  }, [initData, revision]);

  const snapshot = data?.legacyGemini ?? null;
  const observedAt = formatTimestamp(snapshot?.observedAt ?? null);

  return (
    <motion.dialog ref={dialogRef} className={styles.dialog} aria-labelledby="ai-quotas-title" variants={motionVariants.dialog} initial="initial" animate="animate" exit="exit" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={surfaceRef} className={styles.sheet} data-lg-role="focus">
        <GlassRefraction surfaceRef={surfaceRef} filterId={filterId} profile="soft" />
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>Служебный раздел</p><h2 id="ai-quotas-title">Лимиты ИИ</h2></div>
          <IconButton ref={closeRef} className={styles.close} label="Закрыть панель лимитов" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></IconButton>
        </header>

        <div className={styles.scrollArea} aria-live="polite" aria-busy={loadState === "loading"}>
          {loadState === "loading" && !data && <><span className="visually-hidden" role="status">Загружаю лимиты ИИ.</span><AiQuotasSkeleton /></>}
          <AnimatePresence mode="wait" initial={false}>
            {loadState === "error" && <motion.div key="error" variants={motionVariants.state} initial="initial" animate="animate" exit="exit" className={styles.state} role="alert"><h3>Не удалось загрузить лимиты</h3><p>Проверь подключение и попробуй ещё раз.</p><Button onClick={refresh}>Повторить</Button></motion.div>}
          </AnimatePresence>
          {data && <>
            <section className={styles.providerUsageSection}>
              <div className={styles.usageSectionHeading}><h3>Подключённые аккаунты</h3><span>Последние 24 часа</span></div>
              {data.providers.length ? <div className={styles.providerUsageList}>{data.providers.map((provider) => <ProviderUsageCard key={provider.accountId} provider={provider} />)}</div> : <p className={styles.empty}>Провайдеры ещё не подключены. Добавь аккаунт в настройках ИИ.</p>}
            </section>
            {snapshot && <section className={styles.legacyQuotaSection}>
              <div className={styles.modelLine}><span>{statusTitle(snapshot.status)}</span><strong>{snapshot.model}</strong></div>
              <p className={styles.message}>{snapshot.message}</p>
              {snapshot.metrics.length > 0 && <motion.div className={styles.metrics} variants={motionVariants.staggerGroup} initial="initial" animate="animate"><AnimatePresence initial={false}>{snapshot.metrics.map((metric) => <MetricRow key={metric.id} metric={metric} />)}</AnimatePresence></motion.div>}
              {snapshot.status === "ready" && snapshot.metrics.length === 0 && <p className={styles.empty}>Google пока не опубликовал метрики для выбранной модели.</p>}
              <div className={styles.footer}>{observedAt && <span>Срез данных · {observedAt}</span>}<Link className={styles.footerLink} href={snapshot.dashboardUrl} external>Google AI Studio</Link></div>
              <p className={styles.note}>Квоты Google могут обновляться с задержкой до нескольких минут.</p>
            </section>}
            <p className={styles.note}>LifeOS считает собственные обращения, но не видит чужое использование этого же API-ключа. Если провайдер не публикует лимит, счётчик LifeOS — ориентир, а не квота.</p>
          </>}
        </div>
        {loadState === "ready" && <Button variant="primary" size="lg" fullWidth className={styles.refresh} onClick={refresh}>Обновить данные</Button>}
      </section>
    </motion.dialog>
  );
}
