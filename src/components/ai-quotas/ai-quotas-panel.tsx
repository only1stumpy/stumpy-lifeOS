"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AiQuotaMetric, AiQuotaSnapshot } from "@/domain/ai-quotas";
import { GlassRefraction } from "@/components/glass/glass-refraction";
import { AiQuotasSkeleton } from "@/components/loading/loading-skeletons";
import { motionDuration, motionEase, motionSpring, useMotionVariants } from "@/components/motion/motion-system";
import styles from "./ai-quotas-panel.module.css";

type AiQuotasPanelProps = {
  initData: string;
  onClose(): void;
};

type LoadState = "loading" | "ready" | "error";

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const windows: Record<NonNullable<AiQuotaMetric["window"]>, string> = {
  per_minute: "в минуту",
  per_hour: "в час",
  per_day: "в день",
  unknown: "период не определён",
};

function isQuotaSnapshot(value: unknown): value is AiQuotaSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Partial<AiQuotaSnapshot>;
  return snapshot.provider === "gemini"
    && typeof snapshot.model === "string"
    && ["ready", "not_configured", "permission_missing", "unavailable"].includes(String(snapshot.status))
    && Array.isArray(snapshot.metrics)
    && typeof snapshot.message === "string";
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function russianPlural(value: number, forms: [string, string, string]): string {
  const integer = Math.abs(Math.trunc(value));
  const lastTwo = integer % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return forms[2];
  const last = integer % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

function amount(value: number, unit: AiQuotaMetric["unit"]): string {
  const forms = unit === "tokens" ? ["токен", "токена", "токенов"] as [string, string, string] : ["запрос", "запроса", "запросов"] as [string, string, string];
  return `${numberFormat.format(value)} ${russianPlural(value, forms)}`;
}

function MetricRow({ metric }: { metric: AiQuotaMetric }) {
  const motionVariants = useMotionVariants();
  const prefersReducedMotion = useReducedMotion() !== false;
  const limit = metric.limit;
  const used = metric.used;
  const progress = limit !== null && limit > 0 && used !== null ? Math.min(100, (used / limit) * 100) : null;
  const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
  const headingId = `ai-quota-${metric.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <motion.section layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={{ layout: { type: "tween", duration: motionDuration.enter, ease: motionEase.inOut } }} className={styles.metric} aria-labelledby={headingId}>
      <div className={styles.metricHeading}>
        <h3 id={headingId}>{metric.label}</h3>
        {metric.window && <span>{windows[metric.window]}</span>}
      </div>
      {limit !== null ? (
        <>
          <div className={styles.metricValues}>
            <strong>{used === null ? "—" : amount(used, metric.unit)}</strong>
            <span>из {amount(limit, metric.unit)}</span>
          </div>
          {progress !== null && (
            <div className={styles.track} role="progressbar" aria-label={metric.label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used ?? 0}>
              <motion.span initial={false} animate={{ transform: `scaleX(${progress / 100})` }} transition={prefersReducedMotion ? { duration: 0 } : motionSpring.gentle} style={{ transformOrigin: "left center" }} />
            </div>
          )}
          {remaining !== null && <p className={styles.remaining}>Осталось {amount(remaining, metric.unit)}</p>}
        </>
      ) : (
        <p className={styles.emptyMetric}>{used === null ? "Данные пока не опубликованы Google." : `${amount(used, metric.unit)} использовано`}</p>
      )}
    </motion.section>
  );
}

function statusTitle(status: AiQuotaSnapshot["status"]): string {
  switch (status) {
    case "ready": return "Квоты Gemini";
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
  const [snapshot, setSnapshot] = useState<AiQuotaSnapshot | null>(null);
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
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai-quotas", {
      headers: { Authorization: `tma ${initData}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "Не удалось загрузить квоты. Попробуйте обновить.";
          throw new Error(message);
        }
        if (!isQuotaSnapshot(body)) throw new Error("Сервер вернул данные квот в неожиданном формате.");
        return body;
      })
      .then((data) => {
        setSnapshot(data);
        setLoadState("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSnapshot(null);
        setLoadState("error");
      });
    return () => controller.abort();
  }, [initData, revision]);

  const observedAt = formatTimestamp(snapshot?.observedAt ?? null);

  return (
    <motion.dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="ai-quotas-title"
      variants={motionVariants.dialog}
      initial="initial"
      animate="animate"
      exit="exit"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={surfaceRef} className={styles.sheet} data-lg-role="focus">
        <GlassRefraction surfaceRef={surfaceRef} filterId={filterId} profile="soft" />
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>СЛУЖЕБНЫЙ РАЗДЕЛ</p>
            <h2 id="ai-quotas-title">Лимиты ИИ</h2>
          </div>
          <button ref={closeRef} className={styles.close} type="button" aria-label="Закрыть панель лимитов" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className={styles.scrollArea} aria-live="polite" aria-busy={loadState === "loading"}>
          <AnimatePresence mode="wait" initial={false}>
            {loadState === "loading" && <motion.div key="loading" variants={motionVariants.state} initial="initial" animate="animate" exit="exit"><span className="visually-hidden" role="status">Загружаю данные квот Gemini.</span>{!snapshot && <AiQuotasSkeleton />}</motion.div>}
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
          {loadState === "error" && (
            <motion.div key="error" variants={motionVariants.state} initial="initial" animate="animate" exit="exit" className={styles.state} role="alert">
              <h3>Не удалось получить квоты</h3>
              <p>Проверь подключение Google Cloud и попробуй ещё раз.</p>
              <button type="button" className={styles.action} onClick={refresh}>Повторить</button>
            </motion.div>
          )}
          </AnimatePresence>
          {snapshot && (
            <>
              <div className={styles.modelLine}>
                <span>{statusTitle(snapshot.status)}</span>
                <strong>{snapshot.model}</strong>
              </div>
              <p className={styles.message}>{snapshot.message}</p>
              {snapshot.metrics.length > 0 && <motion.div className={styles.metrics} variants={motionVariants.staggerGroup} initial="initial" animate="animate"><AnimatePresence initial={false}>{snapshot.metrics.map((metric) => <MetricRow key={metric.id} metric={metric} />)}</AnimatePresence></motion.div>}
              {snapshot.status === "ready" && snapshot.metrics.length === 0 && <p className={styles.empty}>Google пока не опубликовал метрики для выбранной модели.</p>}
              <div className={styles.footer}>
                {observedAt && <span>Срез данных · {observedAt}</span>}
                <a href={snapshot.dashboardUrl} target="_blank" rel="noreferrer">Google AI Studio</a>
              </div>
              <p className={styles.note}>Данные Google могут обновляться с задержкой до нескольких минут.</p>
              {snapshot.status !== "ready" && <button type="button" className={styles.action} onClick={refresh}>Обновить</button>}
            </>
          )}
        </div>
        {loadState === "ready" && snapshot?.status === "ready" && <button type="button" className={styles.refresh} onClick={refresh}>Обновить данные</button>}
      </section>
    </motion.dialog>
  );
}
