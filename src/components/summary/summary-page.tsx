"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Link } from "@/components/ui";
import { formatMoney } from "@/domain/currencies";
import type { PeriodReport } from "@/domain/period-report";
import styles from "./summary-page.module.css";

type Period = PeriodReport["period"];
type SummaryResponse = {
  report: PeriodReport;
  advice: { items: string[] } | null;
  adviceError: string | null;
};
type TelegramInset = { top?: number; bottom?: number };
type TelegramEvent = "safeAreaChanged" | "contentSafeAreaChanged" | "fullscreenChanged" | "fullscreenFailed";
type TelegramWebApp = {
  initData?: string;
  isFullscreen?: boolean;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  ready?(): void;
  expand?(): void;
  requestFullscreen?(): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: TelegramEvent, handler: () => void): void;
  offEvent?(event: TelegramEvent, handler: () => void): void;
};
type Access = { status: "checking" } | { status: "outside" } | { status: "ready"; initData: string };
type Selection = { period: Period; start: string };
type ParsedSelection = { valid: true; selection: Selection } | { valid: false; error: string };
type LoadState = "waiting" | "loading" | "ready" | "error";

const periods: { value: Period; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function getTelegramWebApp(): TelegramWebApp | null {
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateValue(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function periodStart(value: string, period: Period): string {
  const date = dateValue(value);
  if (period === "month") return `${value.slice(0, 7)}-01`;
  if (period === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  }
  return dateKey(date);
}

function readSelection(search: string): ParsedSelection {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const periods = params.getAll("period");
  const starts = params.getAll("start");
  if (keys.length !== 2 || keys.some((key) => key !== "period" && key !== "start") || periods.length !== 1 || starts.length !== 1) {
    return { valid: false, error: "Ссылка должна содержать один параметр period и один параметр start." };
  }
  const requestedPeriod = periods[0];
  if (requestedPeriod !== "day" && requestedPeriod !== "week" && requestedPeriod !== "month") {
    return { valid: false, error: "Период должен быть day, week или month." };
  }
  const start = starts[0];
  if (!isDate(start)) return { valid: false, error: "Дата start должна быть существующей датой в формате YYYY-MM-DD." };
  const weekday = dateValue(start).getUTCDay();
  if (requestedPeriod === "week" && weekday !== 1) return { valid: false, error: "Для периода week дата start должна быть понедельником." };
  if (requestedPeriod === "month" && start.slice(-2) !== "01") return { valid: false, error: "Для периода month дата start должна быть первым числом месяца." };
  return { valid: true, selection: { period: requestedPeriod, start } };
}

function updateUrl({ period, start }: Selection): void {
  const params = new URLSearchParams({ period, start });
  window.history.replaceState(null, "", `/summary?${params}`);
}

function movePeriod(start: string, period: Period, amount: number): string {
  const date = dateValue(start);
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + amount, 1);
  else date.setUTCDate(date.getUTCDate() + amount * (period === "week" ? 7 : 1));
  return periodStart(dateKey(date), period);
}

function periodEnd(start: string, period: Period): string {
  if (period === "day") return start;
  const date = dateValue(start);
  if (period === "week") date.setUTCDate(date.getUTCDate() + 6);
  else return dateKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)));
  return dateKey(date);
}

function dateLabel(value: string, full = false): string {
  return (full ? fullDateFormat : dayFormat).format(dateValue(value));
}

function rangeLabel(start: string, end: string): string {
  if (start === end) return dateLabel(start, true);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${dateLabel(start, true)} — ${dateLabel(end, true)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${dateLabel(start)} — ${dateFormatDay(end)}`;
  return `${dateLabel(start)} — ${dateLabel(end)}`;
}

function dateFormatDay(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" }).format(dateValue(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): SummaryResponse {
  if (!isRecord(value) || !isRecord(value.report)) throw new Error("Сервер вернул некорректный отчёт.");
  const advice = isRecord(value.advice) && Array.isArray(value.advice.items)
    ? { items: value.advice.items.filter((item): item is string => typeof item === "string") }
    : null;
  return {
    report: value.report as unknown as PeriodReport,
    advice,
    adviceError: typeof value.adviceError === "string" ? value.adviceError : null,
  };
}

async function requestSummary(method: "GET" | "POST", selection: Selection, initData: string, signal?: AbortSignal): Promise<SummaryResponse> {
  const params = new URLSearchParams({ period: selection.period, start: selection.start });
  const response = await fetch(`/api/summary?${params}`, {
    method,
    cache: "no-store",
    headers: { Authorization: `tma ${initData}` },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : "Не удалось загрузить отчёт. Попробуй ещё раз.";
    throw new Error(message);
  }
  return parseResponse(body);
}

function safeInset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function MacroValue({ label, value, target }: { label: string; value: number; target?: number }) {
  return (
    <div className={styles.macroValue}>
      <dt>{label}</dt>
      <dd>{numberFormat.format(value)} <span>г</span></dd>
      {target !== undefined && <small>ориентир {numberFormat.format(target)} г</small>}
    </div>
  );
}

function CaloriesChart({ days }: { days: NonNullable<PeriodReport["nutrition"]>["days"] }) {
  const recordedDays = days.filter((day) => day.calories !== null);
  if (recordedDays.length === 0) return <p className={styles.chartEmpty}>Нет записей КБЖУ за этот период.</p>;

  const width = 360;
  const height = 132;
  const left = 8;
  const right = 8;
  const top = 12;
  const bottom = 26;
  const baseline = height - bottom;
  const max = Math.max(1, ...recordedDays.map((day) => day.calories ?? 0));
  const slot = (width - left - right) / days.length;
  const barWidth = Math.max(2, Math.min(13, slot * 0.58));
  const tickIndexes = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];

  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="calories-title calories-description">
        <title id="calories-title">Калории по дням</title>
        <desc id="calories-description">Столбцы показывают записанные калории. Пропуск означает отсутствие записи, а не нулевое потребление.</desc>
        <line x1={left} x2={width - right} y1={baseline} y2={baseline} className={styles.chartAxis} />
        {days.map((day, index) => {
          if (day.calories === null) return null;
          const barHeight = Math.max(2, (day.calories / max) * (baseline - top));
          const x = left + (index + 0.5) * slot - barWidth / 2;
          return <rect key={day.date} x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx={Math.min(4, barWidth / 2)} className={styles.bar}>
            <title>{`${dateLabel(day.date, true)}: ${numberFormat.format(day.calories)} ккал`}</title>
          </rect>;
        })}
        {tickIndexes.map((index) => <text key={index} x={left + (index + 0.5) * slot} y={height - 7} textAnchor="middle" className={styles.chartLabel}>{dateLabel(days[index].date)}</text>)}
      </svg>
      <ul className={styles.srOnly} aria-label="Значения калорий по дням">
        {days.map((day) => <li key={day.date}>{dateLabel(day.date, true)}: {day.calories === null ? "нет записи" : `${numberFormat.format(day.calories)} ккал`}</li>)}
      </ul>
    </div>
  );
}

function WeightChart({ points }: { points: NonNullable<PeriodReport["weight"]>["points"] }) {
  if (points.length === 0) return <p className={styles.chartEmpty}>За этот период нет замеров веса.</p>;

  const width = 360;
  const height = 132;
  const left = 16;
  const right = 16;
  const top = 15;
  const bottom = 27;
  const values = points.map((point) => point.weightKg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high === low ? 1 : high - low;
  const xFor = (index: number) => points.length < 2 ? width / 2 : left + (index / (points.length - 1)) * (width - left - right);
  const yFor = (value: number) => high === low
    ? (height - bottom + top) / 2
    : top + ((high - value) / range) * (height - top - bottom);
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const line = points.map((point, index) => `${xFor(index)},${yFor(point.weightKg)}`).join(" ");

  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="weight-title weight-description">
        <title id="weight-title">Изменение веса</title>
        <desc id="weight-description">Линия соединяет записанные замеры за период.</desc>
        {points.length > 1 && <polyline points={line} className={styles.line} />}
        {points.map((point, index) => <circle key={point.date} cx={xFor(index)} cy={yFor(point.weightKg)} r="4" className={styles.point}>
          <title>{`${dateLabel(point.date, true)}: ${numberFormat.format(point.weightKg)} кг`}</title>
        </circle>)}
        {ticks.map((index) => <text key={index} x={xFor(index)} y={height - 7} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className={styles.chartLabel}>{dateLabel(points[index].date)}</text>)}
      </svg>
      <ul className={styles.srOnly} aria-label="Значения веса по дням">
        {points.map((point) => <li key={point.date}>{dateLabel(point.date, true)}: {numberFormat.format(point.weightKg)} кг</li>)}
      </ul>
    </div>
  );
}

function NutritionSection({ nutrition }: { nutrition: NonNullable<PeriodReport["nutrition"]> }) {
  return (
    <section className={styles.section} data-module="nutrition" aria-labelledby="nutrition-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>Питание</p><h2 id="nutrition-heading">КБЖУ</h2></div>
        <span className={styles.sectionMeta}>{nutrition.loggedDays} {nutrition.loggedDays === 1 ? "день с записями" : "дн. с записями"}</span>
      </div>
      <div className={styles.nutritionSummary}>
        <div className={styles.calorieTotal}>
          <strong>{numberFormat.format(nutrition.total.calories)}</strong>
          <span>ккал за период</span>
          <small>В среднем {numberFormat.format(nutrition.average.calories)} ккал в день</small>
        </div>
        {nutrition.target && <p className={styles.targetNote}>Дневной ориентир: {numberFormat.format(nutrition.target.calories)} ккал</p>}
      </div>
      {nutrition.loggedDays === 0 && <p className={styles.emptyNote}>За период нет записей. Нулевой итог не означает, что питание было нулевым.</p>}
      <dl className={styles.macroGrid}>
        <MacroValue label="Белки" value={nutrition.total.proteinGrams} target={nutrition.target?.proteinGrams} />
        <MacroValue label="Жиры" value={nutrition.total.fatGrams} target={nutrition.target?.fatGrams} />
        <MacroValue label="Углеводы" value={nutrition.total.carbsGrams} target={nutrition.target?.carbsGrams} />
      </dl>
      <CaloriesChart days={nutrition.days} />
    </section>
  );
}

function WeightSection({ weight }: { weight: NonNullable<PeriodReport["weight"]> }) {
  const changeLabel = weight.change === null
    ? "Недостаточно замеров для сравнения"
    : `${weight.change > 0 ? "+" : weight.change < 0 ? "−" : ""}${numberFormat.format(Math.abs(weight.change))} кг за период`;
  return (
    <section className={styles.section} data-module="weight" aria-labelledby="weight-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>Питание</p><h2 id="weight-heading">Вес</h2></div>
        <span className={styles.sectionMeta}>{changeLabel}</span>
      </div>
      <div className={styles.weightSummary}>
        <p><span>В начале</span><strong>{weight.first === null ? "—" : `${numberFormat.format(weight.first)} кг`}</strong></p>
        <span className={styles.weightArrow} aria-hidden="true">→</span>
        <p><span>В конце</span><strong>{weight.last === null ? "—" : `${numberFormat.format(weight.last)} кг`}</strong></p>
      </div>
      <WeightChart points={weight.points} />
    </section>
  );
}

function FinanceList({ label, rows, income, currency }: {
  label: string;
  rows: { name: string; amountMinor: number }[];
  income: boolean;
  currency: string;
}) {
  return (
    <div className={styles.moneyList}>
      <h3>{label}</h3>
      {rows.length > 0 ? <ul>
        {rows.slice(0, 4).map((row) => <li key={row.name}>
          <span>{row.name}</span>
          <strong>{income ? "+" : "−"}{formatMoney(Math.abs(row.amountMinor), currency)}</strong>
        </li>)}
      </ul> : <p>Операций нет</p>}
    </div>
  );
}

function FinanceSection({ finance, currency }: { finance: NonNullable<PeriodReport["finance"]>; currency: string }) {
  return (
    <section className={styles.section} data-module="finance" aria-labelledby="finance-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>Финансы</p><h2 id="finance-heading">Движение денег</h2></div>
      </div>
      <div className={styles.moneyTotals}>
        <p><span>Расходы</span><strong>−{formatMoney(finance.expenseMinor, currency)}</strong></p>
        <p><span>Доходы</span><strong>+{formatMoney(finance.incomeMinor, currency)}</strong></p>
      </div>
      <div className={styles.moneyLists}>
        <FinanceList label="Крупные расходы" rows={finance.expenses} income={false} currency={currency} />
        <FinanceList label="Доходы" rows={finance.incomes} income currency={currency} />
      </div>
    </section>
  );
}

function GymSection({ gym }: { gym: NonNullable<PeriodReport["gym"]> }) {
  return (
    <section className={styles.section} data-module="gym" aria-labelledby="gym-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>Зал</p><h2 id="gym-heading">Тренировки</h2></div>
      </div>
      <dl className={styles.gymGrid}>
        <div><dt>Тренировок</dt><dd>{numberFormat.format(gym.workouts)}</dd></div>
        <div><dt>Подходов</dt><dd>{numberFormat.format(gym.sets)}</dd></div>
        <div><dt>Объём</dt><dd>{numberFormat.format(gym.volumeKg)} <span>кг</span></dd></div>
      </dl>
    </section>
  );
}

function AdviceSection({
  advice,
  error,
  loading,
  onRetry,
}: {
  advice: SummaryResponse["advice"];
  error: string | null;
  loading: boolean;
  onRetry(): void;
}) {
  return (
    <section className={`${styles.section} ${styles.adviceSection}`} data-module="advice" aria-labelledby="advice-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>Следующий шаг</p><h2 id="advice-heading">Советы</h2></div>
      </div>
      {advice?.items.length ? <ul className={styles.adviceList}>{advice.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : <p className={error ? styles.inlineError : styles.emptyNote} role={error ? "alert" : undefined}>{error ? `Советы недоступны: ${error}` : "Советы для этого периода ещё не подготовлены."}</p>}
      {advice?.items.length && error && <p className={styles.inlineError} role="alert">{`Советы недоступны: ${error}`}</p>}
      {(!advice?.items.length || error) && <Button variant="secondary" size="sm" loading={loading} onClick={onRetry}>
        {loading ? "Готовим советы…" : error ? "Повторить запрос" : "Получить советы"}
      </Button>}
    </section>
  );
}

function ReportBody({ data, adviceLoading, onRetryAdvice }: { data: SummaryResponse; adviceLoading: boolean; onRetryAdvice(): void }) {
  const { report } = data;
  const hasModules = Boolean(report.nutrition || report.weight || report.finance || report.gym);
  return (
    <article className={styles.reportSurface} data-lg-role="focus" aria-label="Личный отчёт">
      <header className={styles.reportHeader}>
        <p className={styles.kicker}>Итоги периода</p>
        <h2>{rangeLabel(report.start, report.end)}</h2>
      </header>
      {hasModules ? <div className={styles.sections}>
        {report.nutrition && <NutritionSection nutrition={report.nutrition} />}
        {report.weight && <WeightSection weight={report.weight} />}
        {report.finance && <FinanceSection finance={report.finance} currency={report.currency} />}
        {report.gym && <GymSection gym={report.gym} />}
      </div> : <p className={styles.emptyReport}>В этом периоде пока нет разделов для отчёта.</p>}
      <AdviceSection advice={data.advice} error={data.adviceError} loading={adviceLoading} onRetry={onRetryAdvice} />
    </article>
  );
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d={direction === "left" ? "M15 5 8 12l7 7" : "m9 5 7 7-7 7"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function SummaryPage() {
  const [access, setAccess] = useState<Access>({ status: "checking" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [urlError, setUrlError] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("waiting");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState("");
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const adviceAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const parsed = readSelection(window.location.search);
    if (parsed.valid) {
      setSelection(parsed.selection);
      updateUrl(parsed.selection);
    } else {
      setUrlError(parsed.error);
    }

    const webApp = getTelegramWebApp();
    if (!webApp) {
      setAccess({ status: "outside" });
      return;
    }

    const rootStyle = document.documentElement.style;
    const previousTop = rootStyle.getPropertyValue("--lifeos-inset-top");
    const previousBottom = rootStyle.getPropertyValue("--lifeos-inset-bottom");
    const syncInsets = () => {
      const top = safeInset(webApp.safeAreaInset?.top) + safeInset(webApp.contentSafeAreaInset?.top);
      const bottom = safeInset(webApp.safeAreaInset?.bottom) + safeInset(webApp.contentSafeAreaInset?.bottom);
      rootStyle.setProperty("--lifeos-inset-top", `${top}px`);
      rootStyle.setProperty("--lifeos-inset-bottom", `max(${bottom}px, env(safe-area-inset-bottom, 0px))`);
    };
    const onInsetsChanged = () => syncInsets();
    const onFullscreenChanged = () => {
      setFullscreen(webApp.isFullscreen === true);
      syncInsets();
    };
    // Same presentation as the main app: full screen where the client supports it, otherwise just expanded.
    const supportsFullscreen = typeof webApp.requestFullscreen === "function"
      && (typeof webApp.isVersionAtLeast !== "function" || webApp.isVersionAtLeast("8.0"));
    try {
      webApp.ready?.();
      webApp.onEvent?.("fullscreenChanged", onFullscreenChanged);
      webApp.onEvent?.("fullscreenFailed", onFullscreenChanged);
      if (supportsFullscreen) webApp.requestFullscreen?.();
      else webApp.expand?.();
      webApp.setHeaderColor?.("#f6f2ec");
      webApp.setBackgroundColor?.("#f6f2ec");
      webApp.setBottomBarColor?.("#f6f2ec");
    } catch {
      // Telegram presentation methods are best-effort; signed initData still controls access.
      try { webApp.expand?.(); } catch { /* nothing more to try */ }
    }
    setFullscreen(webApp.isFullscreen === true);
    syncInsets();
    webApp.onEvent?.("safeAreaChanged", onInsetsChanged);
    webApp.onEvent?.("contentSafeAreaChanged", onInsetsChanged);

    const initData = webApp.initData ?? "";
    setAccess(initData ? { status: "ready", initData } : { status: "outside" });
    return () => {
      webApp.offEvent?.("safeAreaChanged", onInsetsChanged);
      webApp.offEvent?.("contentSafeAreaChanged", onInsetsChanged);
      webApp.offEvent?.("fullscreenChanged", onFullscreenChanged);
      webApp.offEvent?.("fullscreenFailed", onFullscreenChanged);
      if (previousTop) rootStyle.setProperty("--lifeos-inset-top", previousTop);
      else rootStyle.removeProperty("--lifeos-inset-top");
      if (previousBottom) rootStyle.setProperty("--lifeos-inset-bottom", previousBottom);
      else rootStyle.removeProperty("--lifeos-inset-bottom");
    };
  }, []);

  useEffect(() => {
    if (access.status !== "ready" || !selection) return;
    const controller = new AbortController();
    setLoadState("loading");
    setData(null);
    setError("");
    void requestSummary("GET", selection, access.initData, controller.signal)
      .then((result) => {
        setData(result);
        setLoadState("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить отчёт.");
        setLoadState("error");
      });
    return () => controller.abort();
  }, [access, selection, reloadRevision]);

  useEffect(() => () => adviceAbortRef.current?.abort(), []);

  const changeSelection = (next: Selection) => {
    adviceAbortRef.current?.abort();
    adviceAbortRef.current = null;
    setAdviceLoading(false);
    setUrlError("");
    setSelection(next);
    updateUrl(next);
  };

  const retryAdvice = async () => {
    if (access.status !== "ready" || !selection || adviceLoading) return;
    const controller = new AbortController();
    adviceAbortRef.current = controller;
    setAdviceLoading(true);
    try {
      const result = await requestSummary("POST", selection, access.initData, controller.signal);
      if (!controller.signal.aborted) setData((current) => current ? { ...current, advice: result.advice, adviceError: result.adviceError } : current);
    } catch (reason) {
      if (!controller.signal.aborted) setData((current) => current ? { ...current, adviceError: reason instanceof Error ? reason.message : "Не удалось повторить запрос советов." } : current);
    } finally {
      if (adviceAbortRef.current === controller) {
        adviceAbortRef.current = null;
        setAdviceLoading(false);
      }
    }
  };

  const today = localToday();
  const todayStart = selection ? periodStart(today, selection.period) : today;
  const canGoForward = Boolean(selection && movePeriod(selection.start, selection.period, 1) <= todayStart);

  return (
    <main className={styles.stage} data-lg-role="stage" data-fullscreen={fullscreen ? "true" : undefined}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.brand}>LifeOS</p>
            <h1>Личный отчёт</h1>
          </div>
          <Link href="/" variant="plain" className={styles.homeLink}>LifeOS</Link>
        </header>

        {access.status === "checking" && !urlError && <p className={styles.accessStatus} role="status">Подключаем Telegram…</p>}
        {urlError && <section className={styles.invalidSurface} role="alert" aria-labelledby="invalid-url-heading">
          <p className={styles.kicker}>Некорректная ссылка</p>
          <h2 id="invalid-url-heading">Проверьте параметры отчёта</h2>
          <p>{urlError}</p>
          <p className={styles.invalidHint}>Нужны только period и start. Личные данные не запрашивались.</p>
        </section>}
        {access.status === "outside" && !urlError && <section className={styles.deniedSurface} aria-labelledby="telegram-required">
          <p className={styles.kicker}>Личные данные защищены</p>
          <h2 id="telegram-required">Откройте отчёт в Telegram</h2>
          <p>Для загрузки личного отчёта нужна подтверждённая сессия Telegram Mini App.</p>
          <Link href="/" variant="plain">Вернуться в LifeOS</Link>
        </section>}

        {access.status === "ready" && selection && <>
          <nav className={styles.periodNav} data-lg-role="dock" aria-label="Период отчёта">
            {periods.map((item) => <Button
              key={item.value}
              size="sm"
              variant={selection.period === item.value ? "primary" : "secondary"}
              aria-pressed={selection.period === item.value}
              onClick={() => changeSelection({ period: item.value, start: periodStart(selection.start, item.value) })}
            >{item.label}</Button>)}
          </nav>

          <div className={styles.dateControls}>
            <Button size="sm" className={styles.arrowButton} aria-label="Предыдущий период" onClick={() => changeSelection({ ...selection, start: movePeriod(selection.start, selection.period, -1) })}>
              <Arrow direction="left" />
            </Button>
            <p>{selection.start === todayStart ? "Текущий период" : rangeLabel(selection.start, periodEnd(selection.start, selection.period))}</p>
            <Button size="sm" className={styles.arrowButton} aria-label="Следующий период" disabled={!canGoForward} onClick={() => changeSelection({ ...selection, start: movePeriod(selection.start, selection.period, 1) })}>
              <Arrow direction="right" />
            </Button>
            {selection.start !== todayStart && <Button size="sm" variant="text" className={styles.todayButton} onClick={() => changeSelection({ ...selection, start: todayStart })}>Сегодня</Button>}
          </div>

          {loadState === "loading" && <section className={styles.reportSurface} role="status" aria-live="polite">
            <div className={styles.loadingTitle} />
            <div className={styles.loadingLine} />
            <div className={styles.loadingBlock} />
            <p className={styles.loadingText}>Загружаем отчёт…</p>
          </section>}
          {loadState === "error" && <section className={styles.errorSurface} role="alert">
            <p className={styles.kicker}>Не получилось загрузить</p>
            <h2>Отчёт пока недоступен</h2>
            <p>{error}</p>
            <Button variant="primary" onClick={() => { setError(""); setLoadState("loading"); setReloadRevision((value) => value + 1); }}>Повторить</Button>
          </section>}
          {loadState === "ready" && data && <ReportBody data={data} adviceLoading={adviceLoading} onRetryAdvice={() => void retryAdvice()} />}
        </>}
      </div>
    </main>
  );
}
