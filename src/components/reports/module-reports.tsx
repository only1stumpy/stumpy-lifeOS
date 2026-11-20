"use client";

import { plural } from "@/domain/plural";
import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChipButton, IconButton, Select } from "@/components/ui";
import { formatMoney } from "@/domain/currencies";
import type { AppReports } from "@/domain/app";
import type { ModuleKey } from "@/domain/types";
import { motionSpring, useMotionVariants } from "@/components/motion/motion-system";
import styles from "./module-reports.module.css";

type ModuleReportsProps = { reports: AppReports; section: ModuleKey; /** The base currency that report amounts are expressed in. */ currency: string };
type NutritionMetric = "calories" | "proteinGrams" | "fatGrams" | "carbsGrams";
type Period = "week" | "month";
type TrendPoint = { date: string; value: number | null; detail: string };
type PositionedPoint = TrendPoint & { x: number; y: number | null };

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const calendarKcalFormat = new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumFractionDigits: 0 });
const metricLabels: Record<NutritionMetric, { label: string; unit: string }> = {
  calories: { label: "Калории", unit: "ккал" },
  proteinGrams: { label: "Белки", unit: "г" },
  fatGrams: { label: "Жиры", unit: "г" },
  carbsGrams: { label: "Углеводы", unit: "г" },
};

function dateValue(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
}

function dayLabel(value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const date = dateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(date);
}

function dateRangeLabel(first: string | undefined, last: string | undefined): string {
  if (!first || !last) return "За период";
  return first === last ? dayLabel(last, { day: "numeric", month: "long", year: "numeric" }) : `${dayLabel(first)} — ${dayLabel(last)}`;
}

function monthLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(dateValue(value));
}

function monthDates(value: string): { dates: string[]; leadingDays: number } {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const count = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return {
    leadingDays: (first.getUTCDay() + 6) % 7,
    dates: Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1, 12)).toISOString().slice(0, 10)),
  };
}

function shiftMonth(value: string, amount: number): string {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1, 12)).toISOString().slice(0, 7);
}

function datesEndingAt(value: string, length: number): string[] {
  const end = dateValue(value);
  return Array.from({ length }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - length + index + 1);
    return date.toISOString().slice(0, 10);
  });
}

function moneyLabel(currency: string, minor: number): string {
  return formatMoney(Math.abs(minor), currency);
}


function ChartTable({ label, points, formatValue }: { label: string; points: TrendPoint[]; formatValue(value: number): string }) {
  return (
    <details className={styles.tableDetails}>
      <summary>Открыть таблицу значений</summary>
      <div className={styles.tableScroll}>
        <table>
          <caption>{label}</caption>
          <thead><tr><th scope="col">Дата</th><th scope="col">Значение</th></tr></thead>
          <tbody>{points.map((point, index) => (
            <tr key={`${point.date}-${index}`}>
              <th scope="row">{dayLabel(point.date, { day: "numeric", month: "long", year: "numeric" })}</th>
              <td>{point.value === null ? "Нет записи" : `${formatValue(point.value)} · ${point.detail}`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

function LineChart({ title, points, formatValue, accent }: { title: string; points: TrendPoint[]; formatValue(value: number): string; accent: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 360;
  const height = 190;
  const left = 47;
  const right = 12;
  const top = 14;
  const bottom = 32;
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]);

  if (values.length === 0) {
    return <p className={styles.emptyChart}>За этот период нет записей. Отсутствие записи не означает нулевое значение.</p>;
  }

  const minValue = Math.min(0, ...values);
  const rawMaxValue = Math.max(0, ...values);
  const maxValue = rawMaxValue === minValue ? minValue + 1 : rawMaxValue;
  const range = maxValue - minValue;
  const xFor = (index: number) => left + (points.length < 2 ? (width - left - right) / 2 : (index / (points.length - 1)) * (width - left - right));
  const yFor = (value: number) => top + ((maxValue - value) / range) * (height - top - bottom);
  const chartPoints: PositionedPoint[] = points.map((point, index) => ({ ...point, x: xFor(index), y: point.value === null ? null : yFor(point.value) }));
  const segments: PositionedPoint[][] = [];
  let segment: PositionedPoint[] = [];
  for (const point of chartPoints) {
    if (point.value === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(point);
  }
  if (segment.length) segments.push(segment);

  const ticks = [...new Set([minValue, minValue + range / 2, maxValue])];
  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const dataLabel = points.length > 1 ? `${dayLabel(points[0].date)} — ${dayLabel(points[points.length - 1].date)}` : dayLabel(points[0].date);
  return (
    <div className={styles.chartFrame}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>{dataLabel}. Линия прерывается на днях без записи; это не нулевое значение.</desc>
        {ticks.map((tick) => {
          const y = yFor(tick);
          return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} className={styles.gridLine} /><text x={left - 7} y={y + 3} textAnchor="end" className={styles.axisLabel}>{formatValue(tick)}</text></g>;
        })}
        {segments.map((pointsInSegment, index) => pointsInSegment.length > 1 ? <polyline key={index} points={pointsInSegment.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null)}
        {chartPoints.map((point, index) => point.value === null ? null : (
          <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y ?? 0} r="3.5" fill={accent} stroke="rgba(255,255,255,.96)" strokeWidth="1.5">
            <title>{`${dayLabel(point.date, { day: "numeric", month: "long", year: "numeric" })}: ${formatValue(point.value!)} · ${point.detail}`}</title>
          </circle>
        ))}
        {tickIndexes.map((index) => <text key={index} x={xFor(index)} y={height - 9} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className={styles.axisLabel}>{dayLabel(points[index].date)}</text>)}
      </svg>
    </div>
  );
}

function NutritionReports({ reports }: { reports: AppReports }) {
  const motionVariants = useMotionVariants();
  const prefersReducedMotion = useReducedMotion() !== false;
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<NutritionMetric>("calories");
  const days = [...reports.nutritionDays].sort((left, right) => left.date.localeCompare(right.date));
  const latestDate = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const earliestDate = days.find((day) => day.entryCount > 0)?.date ?? latestDate;
  const earliestMonth = earliestDate.slice(0, 7);
  const latestMonth = latestDate.slice(0, 7);
  const [selectedDate, setSelectedDate] = useState(latestDate);
  const [displayedMonth, setDisplayedMonth] = useState(`${latestDate.slice(0, 7)}-01`);
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const selectedDay = dayByDate.get(selectedDate);
  const calendar = monthDates(displayedMonth);
  const periodDates = datesEndingAt(selectedDate, period === "week" ? 7 : 31);
  const metricInfo = metricLabels[metric];
  const chartPoints = periodDates.map((date) => {
    const day = dayByDate.get(date);
    return {
    date,
    value: day && day.entryCount > 0 ? day[metric] : null,
    detail: day && day.entryCount > 0 ? `${day.entryCount} ${plural(day.entryCount, "запись", "записи", "записей")}` : "нет записей",
  };
  });
  const formatValue = (value: number) => numberFormat.format(value);
  const monthBefore = shiftMonth(displayedMonth, -1);
  const monthAfter = shiftMonth(displayedMonth, 1);
  const canGoBack = monthBefore >= earliestMonth;
  const canGoForward = monthAfter <= latestMonth;
  const changeMonth = (month: string) => {
    setDisplayedMonth(`${month}-01`);
    const recordedDate = days.find((day) => day.date.startsWith(month) && day.entryCount > 0)?.date;
    setSelectedDate(recordedDate ?? `${month}-01`);
  };
  const metricValues: { key: NutritionMetric; label: string; unit: string }[] = [
    { key: "calories", label: "Калории", unit: "ккал" },
    { key: "proteinGrams", label: "Белки", unit: "г" },
    { key: "fatGrams", label: "Жиры", unit: "г" },
    { key: "carbsGrams", label: "Углеводы", unit: "г" },
  ];
  return (
    <section className={`${styles.reportSurface} ${styles.nutrition}`} data-lg-role="rail" aria-labelledby="lifeos-nutrition-reports-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>История питания</p><h2 id="lifeos-nutrition-reports-title">Динамика КБЖУ</h2></div>
        <span className={styles.periodLabel}>История записей</span>
      </div>
      <div className={styles.calendar}>
        <div className={styles.calendarHeader}>
          <IconButton size="sm" variant="text" label="Предыдущий месяц" disabled={!canGoBack} onClick={() => changeMonth(monthBefore)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></IconButton>
          <h3>{monthLabel(displayedMonth)}</h3>
          <IconButton size="sm" variant="text" label="Следующий месяц" disabled={!canGoForward} onClick={() => changeMonth(monthAfter)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></IconButton>
        </div>
        <div className={styles.calendarWeekdays} aria-hidden="true">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={displayedMonth} className={styles.calendarGrid} role="group" aria-label={`Календарь питания за ${monthLabel(displayedMonth)}`} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">
            {Array.from({ length: calendar.leadingDays }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
            {calendar.dates.map((date) => {
              const day = dayByDate.get(date);
              const hasEntries = Boolean(day && day.entryCount > 0);
              const isFuture = date > latestDate;
              const accessibleLabel = `${dayLabel(date, { day: "numeric", month: "long", year: "numeric" })}: ${hasEntries ? `${formatValue(day!.calories)} ккал, ${day!.entryCount} ${plural(day!.entryCount, "запись", "записи", "записей")}` : "нет записей"}`;
              return <motion.button
                key={date}
                type="button"
                className={`${styles.calendarDay} ${hasEntries ? styles.calendarDayRecorded : ""}`}
                aria-label={accessibleLabel}
                aria-pressed={date === selectedDate}
                disabled={isFuture}
                onClick={() => setSelectedDate(date)}
                animate={{ transform: `scale(${date === selectedDate && !prefersReducedMotion ? 1.035 : 1})` }}
                transition={prefersReducedMotion ? { duration: 0 } : motionSpring.snappy}
              >
                <span>{Number(date.slice(-2))}</span>
                {hasEntries && <small>{calendarKcalFormat.format(day!.calories)}</small>}
              </motion.button>;
            })}
          </motion.div>
        </AnimatePresence>
        <section className={styles.selectedDay} aria-live="polite" aria-labelledby="lifeos-nutrition-selected-day">
          <div className={styles.selectedDayHeading}>
            <div><p className={styles.eyebrow}>Дневник</p><h3 id="lifeos-nutrition-selected-day">{dayLabel(selectedDate, { day: "numeric", month: "long", year: "numeric" })}</h3></div>
            {selectedDay && selectedDay.entryCount > 0 && <span>{selectedDay.entryCount} {plural(selectedDay.entryCount, "запись", "записи", "записей")}</span>}
          </div>
          {selectedDay && selectedDay.entryCount > 0 ? <dl className={styles.macroValues}>
            {metricValues.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{formatValue(selectedDay[item.key])} {item.unit}</dd></div>)}
          </dl> : <p className={styles.emptyText}>За этот день записей нет. Это не нулевое потребление.</p>}
        </section>
      </div>
      <div className={styles.controlRow} role="group" aria-label="Период графика">
        <div className={styles.segmented}>
          <ChipButton className={styles.segmentButton} selected={period === "week"} onClick={() => setPeriod("week")}>Неделя</ChipButton>
          <ChipButton className={styles.segmentButton} selected={period === "month"} onClick={() => setPeriod("month")}>Месяц</ChipButton>
        </div>
        <span className={styles.periodHint}>{dateRangeLabel(periodDates[0], periodDates.at(-1))}</span>
      </div>
      <div className={styles.metricRow} role="group" aria-label="Показатель КБЖУ">
        {(Object.keys(metricLabels) as NutritionMetric[]).map((key) => (
          <ChipButton key={key} size="lg" className={styles.metricButton} selected={metric === key} onClick={() => setMetric(key)}>{metricLabels[key].label}</ChipButton>
        ))}
      </div>
      <p className={styles.chartTitle}>{metricInfo.label}, {metricInfo.unit}</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${metric}:${period}:${selectedDate}`} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">
          <LineChart title={`${metricInfo.label} по дням`} points={chartPoints} formatValue={formatValue} accent="var(--report-accent)" />
        </motion.div>
      </AnimatePresence>
      <p className={styles.dataNote}>Разрыв линии означает, что в этот день не было записей. Это не нулевое потребление.</p>
    </section>
  );
}

function ExpenseCategoryRows({ categories, currency }: { categories: AppReports["expenseCategories"]; currency: string }) {
  const prefersReducedMotion = useReducedMotion() !== false;
  if (categories.length === 0) return <p className={styles.emptyText}>За текущий месяц расходов по категориям пока нет.</p>;
  const rows = [...categories].sort((a, b) => b.amountMinor - a.amountMinor);
  const max = Math.max(...rows.map((row) => row.amountMinor));
  return (
    <ol className={styles.categoryList}>
      {rows.map((category) => (
        <li key={category.name}>
          <div className={styles.categoryLine}><span>{category.name}</span><strong>{moneyLabel(currency, category.amountMinor)}</strong></div>
          <div className={styles.barTrack} role="progressbar" aria-label={`Доля категории ${category.name}`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={category.amountMinor}><motion.span initial={{ transform: prefersReducedMotion ? "scaleX(1)" : "scaleX(0)" }} animate={{ transform: `scaleX(${Math.max(2, category.amountMinor / max * 100) / 100})` }} transition={prefersReducedMotion ? { duration: 0 } : motionSpring.gentle} style={{ transformOrigin: "left center" }} /></div>
        </li>
      ))}
    </ol>
  );
}

function expenseComparison(currency: string, current: number, previous: number, previousPeriodEnd: string): string {
  const difference = current - previous;
  const date = dayLabel(previousPeriodEnd, { day: "numeric", month: "long" });
  if (difference === 0) return `Столько же, сколько до ${date}.`;
  if (previous === 0) return difference > 0 ? `Расходы появились; до ${date} расходов не было.` : `Снижение на ${moneyLabel(currency, Math.abs(difference))} относительно периода до ${date}.`;
  const percent = Math.round(Math.abs(difference) / previous * 100);
  return `${difference > 0 ? "Больше" : "Меньше"} на ${moneyLabel(currency, Math.abs(difference))} (${percent}%) относительно периода до ${date}.`;
}

function FinanceReports({ reports, currency }: { reports: AppReports; currency: string }) {
  const selectedDate = reports.expenseDays.at(-1)?.date;
  const current = reports.monthComparison.currentMinor;
  const previous = reports.monthComparison.previousMinor;
  const difference = current - previous;
  const categoriesTotal = reports.expenseCategories.reduce((sum, item) => sum + item.amountMinor, 0);
  const largest = [...reports.largestPurchases].sort((a, b) => b.amountMinor - a.amountMinor);
  const repeats = [...reports.repeatPurchases].sort((a, b) => b.amountMinor - a.amountMinor);
  return (
    <div className={`${styles.reportStack} ${styles.finance}`} data-lg-role="rail">
      <section className={styles.reportSurface} aria-labelledby="lifeos-finance-comparison-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Расходы</p><h2 id="lifeos-finance-comparison-title">Сравнение периода</h2></div>{selectedDate && <span className={styles.periodLabel}>по {dayLabel(selectedDate, { day: "numeric", month: "short" })}</span>}</div>
        <div className={styles.comparisonValues}>
          <div><span>Текущий месяц · по {selectedDate ? dayLabel(selectedDate, { day: "numeric", month: "short" }) : "выбранную дату"}</span><strong>{moneyLabel(currency, current)}</strong></div>
          <span className={styles.comparisonMark} aria-hidden="true">к</span>
          <div><span>Прошлый месяц · по {dayLabel(reports.monthComparison.previousPeriodEnd, { day: "numeric", month: "short" })}</span><strong>{moneyLabel(currency, previous)}</strong></div>
        </div>
        <p className={`${styles.comparisonNote} ${difference > 0 ? styles.negative : difference < 0 ? styles.positive : ""}`}>{expenseComparison(currency, current, previous, reports.monthComparison.previousPeriodEnd)}</p>
      </section>
      <section className={styles.reportSurface} aria-labelledby="lifeos-expense-categories-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Текущий месяц</p><h2 id="lifeos-expense-categories-title">По категориям</h2></div>{categoriesTotal > 0 && <span className={styles.periodLabel}>{moneyLabel(currency, categoriesTotal)}</span>}</div>
        <ExpenseCategoryRows categories={reports.expenseCategories} currency={currency} />
      </section>
      <section className={styles.reportSurface} aria-labelledby="lifeos-purchases-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Покупки</p><h2 id="lifeos-purchases-title">Куда уходят деньги</h2></div></div>
        <div className={styles.purchaseGroup}>
          <h3>Крупнейшие покупки за месяц</h3>
          {largest.length ? <ol className={styles.purchaseList}>{largest.map((item, index) => <li key={`${item.occurredAt}-${item.name}-${index}`}><span><strong>{item.name}</strong><small>{dayLabel(item.occurredAt, { day: "numeric", month: "long" })}</small></span><strong>{moneyLabel(currency, item.amountMinor)}</strong></li>)}</ol> : <p className={styles.emptyText}>Пока нет покупок за этот месяц.</p>}
        </div>
        <div className={styles.purchaseGroup}>
          <h3>Повторяющиеся покупки</h3>
          {repeats.length ? <ol className={styles.purchaseList}>{repeats.map((item) => <li key={item.name}><span><strong>{item.name}</strong><small>{item.count} {plural(item.count, "раз", "раза", "раз")}</small></span><strong>{moneyLabel(currency, item.amountMinor)}</strong></li>)}</ol> : <p className={styles.emptyText}>Повторяющихся покупок пока нет.</p>}
        </div>
      </section>
    </div>
  );
}

function GymReports({ reports }: { reports: AppReports }) {
  const [requestedExerciseId, setRequestedExerciseId] = useState("");
  const exercises = reports.exerciseProgress;
  const selectedExercise = exercises.find((exercise) => exercise.id === requestedExerciseId) ?? exercises[0];
  const points: TrendPoint[] = (selectedExercise?.points ?? []).map((point) => ({
    date: point.date,
    value: point.weightKg,
    detail: point.repetitions === null ? "повторения не указаны" : `${point.repetitions} ${plural(point.repetitions, "повтор", "повтора", "повторов")}`,
  }));
  const sessions = [...reports.workoutHistory].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const formatWeight = (value: number) => `${numberFormat.format(value)} кг`;
  return (
    <div className={`${styles.reportStack} ${styles.gym}`} data-lg-role="rail">
      <section className={styles.reportSurface} aria-labelledby="lifeos-gym-progress-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Прогресс</p><h2 id="lifeos-gym-progress-title">Рабочий вес</h2></div></div>
        {exercises.length ? <>
          <Select className={styles.exerciseSelect} label="Упражнение" value={selectedExercise?.id ?? ""} onChange={(event) => setRequestedExerciseId(event.currentTarget.value)}>{exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</Select>
          <p className={styles.chartTitle}>{selectedExercise?.name} · лучший завершённый подход</p>
          <LineChart title={`Рабочий вес: ${selectedExercise?.name ?? "упражнение"}`} points={points} formatValue={(value) => numberFormat.format(value)} accent="var(--report-accent)" />
          <ChartTable label={`${selectedExercise?.name ?? "Упражнение"}: рабочий вес и повторы`} points={points.map((point) => ({ ...point, detail: point.detail }))} formatValue={formatWeight} />
        </> : <p className={styles.emptyText}>Истории рабочих весов пока нет. Она появится после сохранения завершённых подходов с весом.</p>}
      </section>
      <section className={styles.reportSurface} aria-labelledby="lifeos-workout-history-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Журнал</p><h2 id="lifeos-workout-history-title">Тренировки</h2></div><span className={styles.periodLabel}>{sessions.length} {plural(sessions.length, "тренировка", "тренировки", "тренировок")}</span></div>
        {sessions.length ? <ol className={styles.sessionList}>{sessions.map((session) => <li key={session.id}>
          <span className={styles.sessionDate}>{dayLabel(session.completedAt, { day: "numeric", month: "short", year: "numeric" })}</span>
          <div className={styles.sessionBody}><strong>{session.name}</strong><small>{session.completedSets} {plural(session.completedSets, "подход", "подхода", "подходов")} · объём {numberFormat.format(session.volumeKg)} кг×повторы</small></div>
        </li>)}</ol> : <p className={styles.emptyText}>Завершённых тренировок пока нет.</p>}
      </section>
    </div>
  );
}

export function ModuleReports({ reports, section, currency }: ModuleReportsProps) {
  if (section === "today") return null;
  if (section === "nutrition") return <NutritionReports reports={reports} />;
  if (section === "finance") return <FinanceReports reports={reports} currency={currency} />;
  return <GymReports reports={reports} />;
}
