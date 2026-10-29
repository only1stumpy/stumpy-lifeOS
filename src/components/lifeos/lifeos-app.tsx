"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode, RefObject, SVGProps } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type {
  ExerciseSet,
  LifeOSAction,
  LifeOSSnapshot,
  MacroValues,
  ModuleKey,
  MoneyEntry,
  WorkoutDay,
  WorkoutExercise,
} from "@/domain/types";
import { GlassRefraction } from "@/components/glass/glass-refraction";
import styles from "./lifeos-app.module.css";
import type { AppSnapshot } from "@/domain/app";
import { ModuleReports } from "@/components/reports/module-reports";
import { AnimatedNumber, motionDuration, motionSpring, useMotionVariants } from "@/components/motion/motion-system";

type LifeOSAppProps = {
  snapshot: AppSnapshot | null;
  onAction(action: LifeOSAction): void;
  onOpenAiProviders(): void;
  onHaptic?(kind: "selection" | "success" | "error"): void;
  onRegisterTelegramBackHandler?(handler: (() => void) | null): void;
  initialSection?: ModuleKey;
  onDateChange?(value: string): void;
  fullscreen?: boolean;
  safeAreaTop?: number;
  contentSafeAreaTop?: number;
};

type IconName = "today" | "nutrition" | "finance" | "gym" | "arrow" | "plus" | "edit" | "trash" | "close" | "back" | "check" | "clock" | "weight" | "list";
type SheetKey = "nutrition" | "finance" | "gym";
type RestTimerPhase = "ready" | "running" | "paused" | "finished";
type RestTimerState = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  durationSeconds: number;
  remainingSeconds: number;
  deadlineMs: number | null;
  phase: RestTimerPhase;
};

const NAV_ITEMS: { key: ModuleKey; label: string; icon: IconName }[] = [
  { key: "today", label: "Сегодня", icon: "today" },
  { key: "nutrition", label: "Питание", icon: "nutrition" },
  { key: "finance", label: "Финансы", icon: "finance" },
  { key: "gym", label: "Зал", icon: "gym" },
];

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.65,
  };

  const paths: Record<IconName, ReactNode> = {
    today: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    nutrition: <><path d="M7 3v6M4.5 3v3.5a2.5 2.5 0 0 0 5 0V3M7 9v12" /><path d="M16.5 3c-1.8 2.1-2.5 4.3-2.5 7v2.5h5V10c0-2.7-.7-4.9-2.5-7Z" /><path d="M16.5 12.5V21" /></>,
    finance: <><rect x="3" y="5.5" width="18" height="14" rx="2.4" /><path d="M3.5 8.5h17M15.5 14h3" /><circle cx="15" cy="14" r=".7" fill="currentColor" stroke="none" /></>,
    gym: <><path d="M5 9v6M8 6.5v11M16 6.5v11M19 9v6M8 12h8" /><path d="M3.5 9v6M20.5 9v6" /></>,
    arrow: <><path d="M5 19 19 5M8 5h11v11" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    edit: <><path d="m4 16.5-.7 4.2 4.2-.7L19.7 7.8a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.8 6.7 2.5 2.5" /></>,
    trash: <><path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    back: <><path d="m14.5 5-7 7 7 7M8 12h12" /></>,
    check: <><path d="m5 12.5 4.3 4.3L19 7" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    weight: <><path d="M6 5h12l2 16H4L6 5Z" /><path d="M9.5 9.5a2.5 2.5 0 1 1 5 0M12 9.5v2" /></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".7" fill="currentColor" /><circle cx="4.5" cy="12" r=".7" fill="currentColor" /><circle cx="4.5" cy="18" r=".7" fill="currentColor" /></>,
  };

  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common} {...props}>{paths[name]}</svg>;
}

function dateHeading(value: string): string {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "Сегодня";
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(parsed);
}

function timeLabel(value: string, timeZone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(parsed);
}

function moneyLabel(minor: number, currency: "PRB" | "USD", signed = false): string {
  const value = minor / 100;
  const prefix = minor < 0 ? "−" : signed && minor > 0 ? "+" : "";
  const amount = decimalFormat.format(Math.abs(value));
  return currency === "USD" ? `${prefix}${amount} $` : `${prefix}${amount} р. ПМР`;
}

function moneyAmountLabel(minor: number, currency: "PRB" | "USD"): string {
  return moneyLabel(minor, currency).replace(currency === "USD" ? " $" : " р. ПМР", "");
}

function macroValue(value: number): string {
  return numberFormat.format(value);
}

function timerText(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function nowMs(): number {
  return Date.now();
}

function remainingText(consumed: number, target: number): string {
  const remaining = target - consumed;
  return remaining >= 0 ? `Осталось ${numberFormat.format(remaining)}` : `Сверх цели ${numberFormat.format(Math.abs(remaining))}`;
}

function Stat({ value, unit, label, detail, tone }: { value: ReactNode; unit?: string; label: string; detail?: string; tone?: "sage" | "amber" | "plum" }) {
  return (
    <div className={`${styles.stat} ${tone ? styles[tone] : ""}`}>
      <span className={styles.statLabel}>{label}</span>
      {detail && <span className={styles.statDetail}>{detail}</span>}
      <span className={styles.statValue}>{value}{unit && <small>{unit}</small>}</span>
    </div>
  );
}

function GlassSurface({ children, className = "", focus = false, forceFallback = false, ...props }: { children: ReactNode; className?: string; focus?: boolean; forceFallback?: boolean } & HTMLAttributes<HTMLElement>) {
  const surfaceRef = useRef<HTMLElement>(null);
  const filterId = `lifeos-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <section ref={surfaceRef} data-lg-role={focus ? "focus" : undefined} className={`${styles.glassSurface} ${className}`} {...props}>
      <GlassRefraction surfaceRef={surfaceRef} filterId={filterId} profile="soft" forceFallback={forceFallback} />
      {children}
    </section>
  );
}

function ModuleHeading({
  title,
  meta,
  onOpen,
}: {
  title: string;
  meta?: string;
  onOpen?: () => void;
}) {
  return (
    <div className={styles.moduleHeading}>
      <div>
        <h2>{title}</h2>
        {meta && <p className={styles.moduleMeta}>{meta}</p>}
      </div>
      {onOpen && <button type="button" className={styles.textLink} onClick={onOpen}>{title === "Питание" ? "Дневник" : title === "Финансы" ? "Операции" : "План"}<Icon name="arrow" /></button>}
    </div>
  );
}

function MacroRows({ consumed, target, compact = false }: { consumed: MacroValues; target: MacroValues | null; compact?: boolean }) {
  const prefersReducedMotion = useReducedMotion() !== false;
  const rows = [
    { key: "proteinGrams" as const, label: "Б", title: "Белки", tone: styles.protein },
    { key: "fatGrams" as const, label: "Ж", title: "Жиры", tone: styles.fat },
    { key: "carbsGrams" as const, label: "У", title: "Углеводы", tone: styles.carbs },
  ];
  return (
    <div className={`${styles.macroRows} ${compact ? styles.compactMacros : ""}`}>
      {rows.map((row) => {
        const value = consumed[row.key];
        const goal = target?.[row.key] ?? null;
        const progress = goal && goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
        return (
          <div className={styles.macroRow} key={row.key}>
            <span className={`${styles.macroLetter} ${row.tone}`} aria-label={row.title}>{row.label}</span>
            <div className={styles.macroTrack} role="progressbar" aria-label={row.title} aria-valuemin={0} aria-valuemax={goal ?? undefined} aria-valuenow={value}>
              {goal !== null && <motion.span className={row.tone} initial={false} animate={{ transform: `scaleX(${progress / 100})` }} transition={prefersReducedMotion ? { duration: 0 } : motionSpring.gentle} style={{ transformOrigin: "left center" }} />}
            </div>
            <span className={styles.macroValue}><AnimatedNumber value={value} format={macroValue} ariaLabel={`${row.title}: ${macroValue(value)} граммов`} />{goal !== null && <em> / {macroValue(goal)} г</em>}</span>
          </div>
        );
      })}
    </div>
  );
}

function CalorieSummary({ nutrition, compact = false }: { nutrition: LifeOSSnapshot["nutrition"]; compact?: boolean }) {
  const prefersReducedMotion = useReducedMotion() !== false;
  const { consumed, target } = nutrition;
  const calorieTarget = target?.calories ?? null;
  const progress = calorieTarget && calorieTarget > 0 ? Math.min(100, (consumed.calories / calorieTarget) * 100) : 0;
  return (
    <>
      <div className={`${styles.calorieLine} ${compact ? styles.compactCalories : ""}`}>
        <strong><AnimatedNumber value={consumed.calories} format={numberFormat.format} ariaLabel={`${numberFormat.format(consumed.calories)} килокалорий`} /></strong>
        <span>{calorieTarget === null ? "ккал · цель не задана" : `из ${numberFormat.format(calorieTarget)} ккал`}</span>
      </div>
      {calorieTarget !== null && <div className={styles.calorieTrack} role="progressbar" aria-label="Калории от дневной цели" aria-valuemin={0} aria-valuemax={calorieTarget} aria-valuenow={consumed.calories}><motion.span initial={false} animate={{ transform: `scaleX(${progress / 100})` }} transition={prefersReducedMotion ? { duration: 0 } : motionSpring.gentle} style={{ transformOrigin: "left center" }} /></div>}
      <MacroRows consumed={consumed} target={target} compact={compact} />
      {calorieTarget !== null && <p className={styles.remainingLine}>{remainingText(consumed.calories, calorieTarget)} ккал <span>Цель на массу</span></p>}
    </>
  );
}

function FoodEntry({ entry, timeZone, onEdit, onDelete }: { entry: LifeOSSnapshot["nutrition"]["entries"][number]; timeZone: string; onEdit(): void; onDelete(): void }) {
  const motionVariants = useMotionVariants();
  return (
    <motion.li layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={motionSpring.gentle} className={styles.entryRow}>
      <div className={styles.entryTime}>{timeLabel(entry.occurredAt, timeZone)}</div>
      <div className={styles.entryBody}>
        <strong>{entry.label}</strong>
        <span>{entry.portionLabel} · {numberFormat.format(entry.calories)} ккал · Б {macroValue(entry.proteinGrams)} / Ж {macroValue(entry.fatGrams)} / У {macroValue(entry.carbsGrams)} г{entry.estimated ? " · оценка" : ""}</span>
      </div>
      <div className={styles.entryActions}>
        <button type="button" className={styles.iconAction} aria-label={`Исправить: ${entry.label}`} onClick={onEdit}><Icon name="edit" /></button>
        <button type="button" className={styles.iconAction} aria-label={`Удалить: ${entry.label}`} onClick={onDelete}><Icon name="trash" /></button>
      </div>
    </motion.li>
  );
}

function FinanceEntry({ entry, timeZone, onEdit, onDelete }: { entry: MoneyEntry; timeZone: string; onEdit(): void; onDelete(): void }) {
  const motionVariants = useMotionVariants();
  const signedAmountMinor = (entry.kind === "expense" ? -1 : 1) * Math.abs(entry.amountMinor);
  return (
    <motion.li layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={motionSpring.gentle} className={styles.entryRow}>
      <div className={styles.entryTime}>{timeLabel(entry.occurredAt, timeZone)}</div>
      <div className={styles.entryBody}>
        <strong>{entry.label}</strong>
        <span>{entry.category} · {entry.kind === "income" ? "Доход" : "Расход"}</span>
      </div>
      <div className={styles.moneyEntryAmount}>
        <strong className={entry.kind === "income" ? styles.income : ""}>{moneyLabel(signedAmountMinor, entry.currency, true)}</strong>
        <div className={styles.entryActions}>
          <button type="button" className={styles.iconAction} aria-label={`Исправить: ${entry.label}`} onClick={onEdit}><Icon name="edit" /></button>
          <button type="button" className={styles.iconAction} aria-label={`Удалить: ${entry.label}`} onClick={onDelete}><Icon name="trash" /></button>
        </div>
      </div>
    </motion.li>
  );
}

function WeightChart({ history }: { history: LifeOSSnapshot["nutrition"]["weightHistory"] }) {
  if (history.length === 0) return <p className={styles.emptyInline}>Истории веса пока нет.</p>;
  if (history.length === 1) return <p className={styles.singleWeightPoint}>{decimalFormat.format(history[0].weightKg)} <small>кг · {dateHeading(history[0].date)}</small></p>;
  const width = 300;
  const height = 90;
  const pad = 12;
  const values = history.map((point) => point.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = history.map((point, index) => {
    const x = pad + (index / (history.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.weightKg - min) / range) * (height - pad * 2);
    return { ...point, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <div className={styles.weightChart}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`График массы тела: от ${decimalFormat.format(values[0])} до ${decimalFormat.format(values[values.length - 1])} килограммов`}>
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => <circle key={`${point.date}-${point.weightKg}`} cx={point.x} cy={point.y} r="3.5" />)}
      </svg>
      <div className={styles.chartCaption}><span>{history[0].date}</span><strong>{decimalFormat.format(history[history.length - 1].weightKg)} кг</strong><span>{history[history.length - 1].date}</span></div>
    </div>
  );
}

function ExerciseMetrics({ set }: { set: ExerciseSet }) {
  const metrics = [
    set.weightKg !== null ? `${decimalFormat.format(set.weightKg)} кг` : null,
    set.repetitions !== null ? `${set.repetitions} повт.` : null,
    set.durationSeconds !== null ? `${Math.floor(set.durationSeconds / 60)}:${String(set.durationSeconds % 60).padStart(2, "0")}` : null,
    set.distanceMeters !== null ? `${decimalFormat.format(set.distanceMeters)} м` : null,
  ].filter(Boolean);
  return <span className={styles.setMetrics}>{metrics.length ? metrics.join(" · ") : "Данные подхода не заданы"}</span>;
}

function LifeOSApp({ snapshot, onAction, onOpenAiProviders, onHaptic, onRegisterTelegramBackHandler, initialSection = "today", onDateChange, fullscreen = false, safeAreaTop = 0, contentSafeAreaTop = 0 }: LifeOSAppProps) {
  const motionVariants = useMotionVariants();
  const [section, setSection] = useState<ModuleKey>(initialSection);
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(null);
  const [restTimerNow, setRestTimerNow] = useState(0);
  const previousCompletedSetsRef = useRef<Set<string> | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeSheetRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const dockFilterId = `lifeos-glass-dock-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const restDeadlineMs = restTimer?.deadlineMs ?? null;
  useEffect(() => {
    if (restDeadlineMs === null) return;
    const updateRemaining = () => {
      const now = Date.now();
      setRestTimerNow(now);
      if (now >= restDeadlineMs) {
        setRestTimer((current) => current?.deadlineMs === restDeadlineMs
          ? { ...current, deadlineMs: null, remainingSeconds: 0, phase: "finished" }
          : current);
      }
    };
    const interval = window.setInterval(updateRemaining, 1000);
    document.addEventListener("visibilitychange", updateRemaining);
    window.addEventListener("focus", updateRemaining);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateRemaining);
      window.removeEventListener("focus", updateRemaining);
    };
  }, [restDeadlineMs]);

  useEffect(() => {
    if (!sheet) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeSheetRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheet(null);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = sheetRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      (returnFocusRef.current ?? previousActive)?.focus();
      returnFocusRef.current = null;
    };
  }, [sheet]);

  const openSheet = (key: SheetKey, trigger?: HTMLElement) => {
    returnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    onHaptic?.("selection");
    setSheet(key);
  };

  const currentWorkout = useMemo<WorkoutDay | null>(() => {
    if (!snapshot) return null;
    return snapshot.gym.program.find((workout) => workout.id === selectedWorkoutId)
      ?? (snapshot.gym.nextWorkout?.id === selectedWorkoutId ? snapshot.gym.nextWorkout : null)
      ?? null;
  }, [snapshot, selectedWorkoutId]);
  const currentExercise = currentWorkout?.exercises.find((exercise) => exercise.id === selectedExerciseId) ?? null;

  useEffect(() => {
    if (!snapshot) return;
    const completedSets = new Set<string>();
    const newlyCompleted: { workout: WorkoutDay; exercise: WorkoutExercise }[] = [];
    const previousCompleted = previousCompletedSetsRef.current;
    const workouts = [...snapshot.gym.program];
    if (snapshot.gym.nextWorkout && !workouts.some((workout) => workout.id === snapshot.gym.nextWorkout?.id)) {
      workouts.push(snapshot.gym.nextWorkout);
    }
    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        if (exercise.sets.some((set) => set.completed && !previousCompleted?.has(`${workout.id}:${exercise.id}:${set.index}`))) {
          newlyCompleted.push({ workout, exercise });
        }
        for (const set of exercise.sets) {
          if (set.completed) completedSets.add(`${workout.id}:${exercise.id}:${set.index}`);
        }
      }
    }
    previousCompletedSetsRef.current = completedSets;
    if (!previousCompleted) return;

    const completion = newlyCompleted.find(({ workout, exercise }) => workout.id === selectedWorkoutId && exercise.id === selectedExerciseId);
    if (!completion || completion.exercise.restSeconds <= 0) return;
    const timer: RestTimerState = {
      workoutId: completion.workout.id,
      exerciseId: completion.exercise.id,
      exerciseName: completion.exercise.name,
      durationSeconds: completion.exercise.restSeconds,
      remainingSeconds: completion.exercise.restSeconds,
      deadlineMs: null,
      phase: "ready",
    };
    window.setTimeout(() => {
      const now = nowMs();
      setRestTimerNow(now);
      setRestTimer({ ...timer, deadlineMs: now + timer.durationSeconds * 1000, phase: "running" });
    }, 0);
  }, [snapshot, selectedWorkoutId, selectedExerciseId]);

  const timerForExercise = (workout: WorkoutDay, exercise: WorkoutExercise): RestTimerState => {
    if (restTimer?.workoutId === workout.id && (restTimer.phase !== "ready" || restTimer.exerciseId === exercise.id)) {
      return restTimer;
    }
    const durationSeconds = exercise.restSeconds;
    return {
      workoutId: workout.id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      durationSeconds,
      remainingSeconds: durationSeconds,
      deadlineMs: null,
      phase: "ready",
    };
  };

  const timerRemaining = (timer: RestTimerState, now = restTimerNow) => timer.deadlineMs === null
    ? timer.remainingSeconds
    : Math.max(0, Math.ceil((timer.deadlineMs - now) / 1000));

  const startRestTimer = (timer: RestTimerState) => {
    if (timer.durationSeconds <= 0) return;
    const now = nowMs();
    const remainingSeconds = timer.phase === "paused" ? timerRemaining(timer) : timer.durationSeconds;
    if (remainingSeconds <= 0) return;
    setRestTimerNow(now);
    setRestTimer({ ...timer, remainingSeconds, deadlineMs: now + remainingSeconds * 1000, phase: "running" });
  };

  const pauseRestTimer = (timer: RestTimerState) => {
    const now = nowMs();
    const remainingSeconds = timerRemaining(timer, now);
    const phase: RestTimerPhase = remainingSeconds === 0 ? "finished" : "paused";
    setRestTimerNow(now);
    setRestTimer({ ...timer, remainingSeconds, deadlineMs: null, phase });
  };

  const resetRestTimer = (timer: RestTimerState) => {
    setRestTimerNow(nowMs());
    setRestTimer({ ...timer, remainingSeconds: timer.durationSeconds, deadlineMs: null, phase: "ready" });
  };

  const renderRestTimer = (workout: WorkoutDay, exercise?: WorkoutExercise) => {
    const savedTimer = restTimer?.workoutId === workout.id && restTimer.phase !== "ready" ? restTimer : null;
    const timer = savedTimer ?? (exercise ? timerForExercise(workout, exercise) : null);
    if (!timer) return null;
    const remainingSeconds = timerRemaining(timer);
    const running = timer.phase === "running";
    const canStart = timer.durationSeconds > 0 && !running;
    return (
      <div className={styles.restTimerGroup}>
        <div className={styles.restTimer}>
          <div className={styles.restTimerCopy}>
            <span className={styles.restTimerTitle}><Icon name="clock" />Таймер отдыха</span>
            <span className={styles.restTimerDetail}>
              {timer.durationSeconds <= 0
                ? "Время отдыха не задано"
                : timer.exerciseId === exercise?.id
                  ? `Между подходами · ${timerText(timer.durationSeconds)}`
                  : `После упражнения · ${timer.exerciseName}`}
            </span>
          </div>
          <output className={styles.restTimerValue} role="timer" aria-live="off" aria-label={`Осталось ${timerText(remainingSeconds)}`}>
            {timerText(remainingSeconds)}
          </output>
        </div>
        <div className={styles.restTimerControls} role="group" aria-label="Управление таймером отдыха">
          <button type="button" className={`${styles.restTimerButton} ${styles.restTimerPrimary}`} onClick={() => startRestTimer(timer)} disabled={!canStart} aria-label={timer.phase === "paused" ? "Продолжить таймер отдыха" : "Запустить таймер отдыха"}>
            {timer.phase === "paused" ? "Продолжить" : "Старт"}
          </button>
          <button type="button" className={styles.restTimerButton} onClick={() => pauseRestTimer(timer)} disabled={!running} aria-label="Остановить таймер отдыха">
            Стоп
          </button>
          <button type="button" className={styles.restTimerButton} onClick={() => resetRestTimer(timer)} disabled={timer.phase === "ready" && remainingSeconds === timer.durationSeconds} aria-label="Сбросить таймер отдыха">
            Сбросить
          </button>
        </div>
      </div>
    );
  };

  const navigate = (key: ModuleKey) => {
    if (key !== section) onHaptic?.("selection");
    setSection(key);
    if (key !== "gym") {
      setSelectedExerciseId(null);
      setSelectedWorkoutId(null);
    }
  };

  const openExercise = (workout: WorkoutDay, exercise: WorkoutExercise) => {
    setSelectedWorkoutId(workout.id);
    setSelectedExerciseId(exercise.id);
    onAction({ type: "gym.open-exercise", workoutId: workout.id, exerciseId: exercise.id });
  };

  const startWorkout = (workout: WorkoutDay) => {
    setSelectedWorkoutId(workout.id);
    setSelectedExerciseId(workout.exercises[0]?.id ?? null);
    onAction({ type: "gym.start-workout", workoutId: workout.id });
  };

  const closeExercise = () => setSelectedExerciseId(null);

  const handleAppBack = useCallback(() => {
    if (sheet) {
      setSheet(null);
    } else if (selectedExerciseId) {
      setSelectedExerciseId(null);
    } else if (selectedWorkoutId) {
      setSelectedWorkoutId(null);
      setSelectedExerciseId(null);
    } else if (section !== "today") {
      setSection("today");
    }
  }, [section, selectedExerciseId, selectedWorkoutId, sheet]);

  useEffect(() => {
    const hasBackState = Boolean(sheet || selectedWorkoutId || selectedExerciseId || section !== "today");
    onRegisterTelegramBackHandler?.(hasBackState ? handleAppBack : null);
    return () => onRegisterTelegramBackHandler?.(null);
  }, [handleAppBack, onRegisterTelegramBackHandler, section, selectedExerciseId, selectedWorkoutId, sheet]);

  const renderToday = () => {
    if (!snapshot) return <SetupState onAction={onAction} />;
    const primaryAccount = snapshot.finance.accounts.find((account) => account.id === snapshot.settings.defaultAccountId)
      ?? snapshot.finance.accounts.find((account) => account.isDefault)
      ?? snapshot.finance.accounts[0];
    const workout = snapshot.gym.trainingDay ? snapshot.gym.nextWorkout : null;
    return (
      <GlassSurface className={styles.todaySurface} focus>
        <section className={`${styles.todaySection} ${styles.nutritionTone}`}>
          <ModuleHeading title="Питание" onOpen={() => navigate("nutrition")} />
          <CalorieSummary nutrition={snapshot.nutrition} compact />
          {snapshot.nutrition.target === null && <p className={styles.todayHint}>Добавьте параметры и настройте цель на массу.</p>}
          <button type="button" className={styles.inlineEntry} onClick={() => onAction({ type: "food.add" })}><Icon name="plus" />Записать еду</button>
        </section>
        <section className={`${styles.todaySection} ${styles.financeTone}`}>
          <ModuleHeading title="Финансы" onOpen={() => navigate("finance")} />
          <div className={styles.financeSummary}>
            <Stat
              value={primaryAccount ? <AnimatedNumber value={primaryAccount.balanceMinor} format={(minor) => moneyAmountLabel(Math.round(minor), primaryAccount.currency)} ariaLabel={moneyLabel(primaryAccount.balanceMinor, primaryAccount.currency)} /> : "—"}
              unit={primaryAccount ? primaryAccount.currency === "USD" ? "$" : "р. ПМР" : undefined}
              label="Основной счёт"
              detail={primaryAccount ? primaryAccount.name.trim() || "Основной счёт" : "Счёт не настроен"}
              tone="amber"
            />
            <Stat value={<AnimatedNumber value={snapshot.finance.spentTodayPrbMinor} format={(minor) => moneyAmountLabel(Math.round(minor), "PRB")} ariaLabel={moneyLabel(snapshot.finance.spentTodayPrbMinor, "PRB")} />} unit="р. ПМР" label="Потрачено сегодня" tone="amber" />
          </div>
          <div className={styles.financeActions}>
            {!primaryAccount && <button type="button" className={styles.inlineEntry} onClick={() => onAction({ type: "finance.manage-accounts" })}><Icon name="plus" />Настроить счёт</button>}
            <button type="button" className={styles.inlineEntry} onClick={() => onAction({ type: "finance.add" })}><Icon name="plus" />Записать операцию</button>
          </div>
        </section>
        <section className={`${styles.todaySection} ${styles.gymTone}`}>
          <ModuleHeading title="Зал" onOpen={() => navigate("gym")} />
          {workout ? (
            <div className={styles.workoutPreview}>
              <div><strong>{workout.name}</strong><span>{workout.exercises.length} {pluralize(workout.exercises.length, "упражнение", "упражнения", "упражнений")}</span></div>
              <button type="button" className={styles.textLink} onClick={() => startWorkout(workout)}>Начать <Icon name="arrow" /></button>
            </div>
          ) : snapshot.gym.lastWorkout ? (
            <div className={styles.workoutPreview}>
              <div><strong>{snapshot.gym.lastWorkout.name}</strong><span>{snapshot.gym.lastWorkout.summary}</span></div>
              <span className={styles.lastResultLabel}>Последний результат</span>
            </div>
          ) : (
            <div className={styles.workoutPreview}><div><strong>План пока не создан</strong><span>Соберите тренировочные дни и упражнения.</span></div><button type="button" className={styles.textLink} onClick={() => onAction({ type: "gym.edit-program" })}>План <Icon name="arrow" /></button></div>
          )}
        </section>
      </GlassSurface>
    );
  };

  const renderNutrition = () => {
    if (!snapshot) return <SetupState onAction={onAction} />;
    const entries = [...snapshot.nutrition.entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return (
      <div className={styles.screenStack}>
        <GlassSurface className={styles.moduleSurface} focus>
          <div className={styles.sectionTopline}><span className={styles.eyebrow}>ДНЕВНИК</span><span className={styles.dateChip}>{dateHeading(snapshot.localDate)}</span></div>
          <CalorieSummary nutrition={snapshot.nutrition} />
          <div className={styles.actionRow}>
            <button type="button" className={styles.primaryButton} onClick={(event) => openSheet("nutrition", event.currentTarget)}><Icon name="plus" /> Добавить запись</button>
            <button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "food.set-target" })}>Цель КБЖУ</button>
          </div>
        </GlassSurface>
        <GlassSurface className={styles.listSurface}>
          <div className={styles.listHeading}><div><span className={styles.eyebrow}>ПО ВРЕМЕНИ</span><h2>Записи</h2></div><span className={styles.countPill}>{entries.length}</span></div>
          <AnimatePresence mode="wait" initial={false}>{entries.length ? <motion.ul key="food-entries" layout className={styles.entryList} initial="initial" animate="animate" exit="exit" variants={motionVariants.state}>{entries.map((entry) => <FoodEntry key={entry.id} entry={entry} timeZone={snapshot.settings.timeZone} onEdit={() => onAction({ type: "food.edit", id: entry.id })} onDelete={() => onAction({ type: "food.delete", id: entry.id })} />)}</motion.ul> : <motion.p key="food-empty" className={styles.emptyInline} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">Записей за этот день пока нет.</motion.p>}</AnimatePresence>
        </GlassSurface>
        <GlassSurface className={styles.listSurface}>
          <div className={styles.listHeading}><div><span className={styles.eyebrow}>МАССА ТЕЛА</span><h2>Вес</h2></div><button type="button" className={styles.textLink} onClick={() => onAction({ type: "weight.add" })}><Icon name="plus" />Добавить</button></div>
          {snapshot.nutrition.bodyWeightKg !== null && <p className={styles.currentWeight}>{decimalFormat.format(snapshot.nutrition.bodyWeightKg)} <small>кг сейчас</small></p>}
          <WeightChart history={snapshot.nutrition.weightHistory} />
        </GlassSurface>
      </div>
    );
  };

  const renderFinance = () => {
    if (!snapshot) return <SetupState onAction={onAction} />;
    const entries = [...snapshot.finance.entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const primaryAccount = snapshot.finance.accounts.find((account) => account.id === snapshot.settings.defaultAccountId)
      ?? snapshot.finance.accounts.find((account) => account.isDefault)
      ?? snapshot.finance.accounts[0];
    return (
      <div className={`${styles.screenStack} ${styles.financeTone}`}>
        <GlassSurface className={styles.moduleSurface} focus>
          <div className={styles.sectionTopline}><span className={styles.eyebrow}>ОБЗОР</span><span className={styles.dateChip}>{dateHeading(snapshot.localDate)}</span></div>
          <div className={styles.financeOverview}>
            {primaryAccount ? (
              <div className={styles.financeBalance}>
                <span className={styles.financeBalanceLabel}>Текущий баланс</span>
                <strong className={styles.financeBalanceValue}>
                  <AnimatedNumber value={primaryAccount.balanceMinor} format={(minor) => moneyAmountLabel(Math.round(minor), primaryAccount.currency)} ariaLabel={moneyLabel(primaryAccount.balanceMinor, primaryAccount.currency)} />
                  <small>{primaryAccount.currency === "USD" ? "$" : "р. ПМР"}</small>
                </strong>
                <span className={styles.financeBalanceAccount}>{primaryAccount.name.trim() || "Основной счёт"} · {primaryAccount.currency === "USD" ? "доллары США" : "рубли ПМР"}</span>
              </div>
            ) : (
              <div className={styles.financeEmptyBalance}>
                <span className={styles.financeBalanceLabel}>Текущий баланс</span>
                <strong>Основной счёт не настроен</strong>
                <p>Добавьте счёт, чтобы видеть баланс здесь.</p>
              </div>
            )}
            <div className={styles.financeSummary}>
              <Stat value={<AnimatedNumber value={snapshot.finance.spentTodayPrbMinor} format={(minor) => moneyAmountLabel(Math.round(minor), "PRB")} ariaLabel={moneyLabel(snapshot.finance.spentTodayPrbMinor, "PRB")} />} unit="р. ПМР" label="Потрачено сегодня" tone="amber" />
              <Stat value={<AnimatedNumber value={snapshot.finance.spentMonthPrbMinor} format={(minor) => moneyAmountLabel(Math.round(minor), "PRB")} ariaLabel={moneyLabel(snapshot.finance.spentMonthPrbMinor, "PRB")} />} unit="р. ПМР" label="За месяц" tone="amber" />
            </div>
          </div>
          {!primaryAccount && <div className={styles.financeOverviewActions}>
            <button type="button" className={styles.textLink} onClick={() => onAction({ type: "finance.manage-accounts" })}>Настроить счёт <Icon name="plus" /></button>
          </div>}
          <div className={styles.actionRow}>
            <button type="button" className={styles.primaryButton} onClick={(event) => openSheet("finance", event.currentTarget)}><Icon name="plus" /> Добавить операцию</button>
          </div>
        </GlassSurface>
        <GlassSurface className={styles.listSurface}>
          <div className={styles.listHeading}><div><span className={styles.eyebrow}>СЧЕТА</span><h2>Мои счета</h2></div><button type="button" className={styles.textLink} onClick={() => onAction({ type: "finance.manage-accounts" })}>Управлять <Icon name="arrow" /></button></div>
          <AnimatePresence mode="wait" initial={false}>{snapshot.finance.accounts.length ? <motion.ul key="accounts" layout className={styles.accountList} initial="initial" animate="animate" exit="exit" variants={motionVariants.state}><AnimatePresence initial={false}>{snapshot.finance.accounts.map((account) => <motion.li layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={motionSpring.gentle} key={account.id} className={styles.accountRow}><div><strong>{account.name}</strong><span>{account.currency === "USD" ? "Доллары США" : "Рубли ПМР"}</span></div><strong><AnimatedNumber value={account.balanceMinor} format={(minor) => moneyLabel(Math.round(minor), account.currency)} ariaLabel={moneyLabel(account.balanceMinor, account.currency)} /></strong></motion.li>)}</AnimatePresence></motion.ul> : <motion.p key="accounts-empty" className={styles.emptyInline} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">Счета ещё не добавлены.</motion.p>}</AnimatePresence>
        </GlassSurface>
        <GlassSurface className={styles.listSurface}>
          <div className={styles.listHeading}><div><span className={styles.eyebrow}>ДВИЖЕНИЕ ДЕНЕГ</span><h2>Операции</h2></div><button type="button" className={styles.textLink} onClick={() => openSheet("finance")}><Icon name="plus" />Добавить</button></div>
          <AnimatePresence mode="wait" initial={false}>{entries.length ? <motion.ul key="money-entries" layout className={styles.entryList} initial="initial" animate="animate" exit="exit" variants={motionVariants.state}>{entries.map((entry) => <FinanceEntry key={entry.id} entry={entry} timeZone={snapshot.settings.timeZone} onEdit={() => onAction({ type: "finance.edit", id: entry.id })} onDelete={() => onAction({ type: "finance.delete", id: entry.id })} />)}</motion.ul> : <motion.p key="money-empty" className={styles.emptyInline} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">Операций пока нет.</motion.p>}</AnimatePresence>
        </GlassSurface>
      </div>
    );
  };

  const renderExercise = (workout: WorkoutDay, exercise: WorkoutExercise) => (
    <GlassSurface className={`${styles.moduleSurface} ${styles.exerciseSurface}`} focus>
      <button type="button" className={styles.backButton} onClick={closeExercise}><Icon name="back" />К тренировке</button>
      <div className={styles.exerciseHeader}>
        <span className={styles.eyebrow}>{workout.name}</span>
        <h2>{exercise.name}</h2>
        {exercise.previousPerformance && <p className={styles.previousPerformance}>В прошлый раз: {exercise.previousPerformance}</p>}
        {exercise.progressionHint && <p className={styles.previousPerformance}>{exercise.progressionHint}</p>}
      </div>
      <div className={styles.setHeader}><span>Подход</span><span>Результат</span><span>Статус</span></div>
      <ol className={styles.setList}>
        {exercise.sets.map((set) => (
          <li className={styles.setRow} key={set.id}>
            <strong>{numberFormat.format(set.index)}</strong>
            <ExerciseMetrics set={set} />
            <button type="button" className={`${styles.setButton} ${set.completed ? styles.completedSet : ""}`} aria-label={set.completed ? `Подход ${set.index} выполнен` : `Отметить подход ${set.index} выполненным`} onClick={() => onAction({ type: "gym.complete-set", workoutId: workout.id, exerciseId: exercise.id, setId: set.id })}>
              <Icon name="check" />{set.completed ? "Готово" : "Отметить"}
            </button>
          </li>
        ))}
      </ol>
      {exercise.sets.length === 0 && <p className={styles.emptyInline}>Подходы для этого упражнения ещё не заданы.</p>}
      {renderRestTimer(workout, exercise)}
      <div className={styles.exerciseFooter}><button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "gym.add-exercise", workoutId: workout.id })}>Следующее упражнение</button></div>
    </GlassSurface>
  );

  const renderWorkout = (workout: WorkoutDay) => (
    <GlassSurface className={styles.moduleSurface} focus>
      <button type="button" className={styles.backButton} onClick={() => { setSelectedWorkoutId(null); setSelectedExerciseId(null); }}><Icon name="back" />К плану</button>
      <div className={styles.listHeading}><div><span className={styles.eyebrow}>ТРЕНИРОВКА</span><h2>{workout.name}</h2></div><button type="button" className={styles.textLink} onClick={() => startWorkout(workout)}>Начать <Icon name="arrow" /></button></div>
      {renderRestTimer(workout)}
      {workout.exercises.length ? <ol className={styles.workoutList}>{workout.exercises.map((exercise, index) => (
        <li key={exercise.id} className={styles.workoutExercise}>
          <span className={styles.exerciseIndex}>{String(index + 1).padStart(2, "0")}</span>
          <button type="button" className={styles.exerciseOpen} onClick={() => openExercise(workout, exercise)}><strong>{exercise.name}</strong><span>{exercise.sets.length} {pluralize(exercise.sets.length, "подход", "подхода", "подходов")} {exercise.previousPerformance && `· Было ${exercise.previousPerformance}`}{exercise.progressionHint && " · Можно увеличить вес"}</span></button>
          <Icon name="arrow" className={styles.smallArrow} />
        </li>
      ))}</ol> : <p className={styles.emptyInline}>В этой тренировке пока нет упражнений.</p>}
      <button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "gym.add-exercise", workoutId: workout.id })}><Icon name="plus" />Добавить упражнение</button>
    </GlassSurface>
  );

  const renderGym = () => {
    if (!snapshot) return <SetupState onAction={onAction} />;
    if (currentWorkout && currentExercise) return renderExercise(currentWorkout, currentExercise);
    if (currentWorkout) return renderWorkout(currentWorkout);
    const workouts = snapshot.gym.program.length ? snapshot.gym.program : snapshot.gym.nextWorkout ? [snapshot.gym.nextWorkout] : [];
    return (
      <div className={`${styles.screenStack} ${styles.gymTone}`}>
        {snapshot.gym.trainingDay && snapshot.gym.nextWorkout && (
          <GlassSurface className={styles.moduleSurface} focus>
            <span className={styles.eyebrow}>СЕГОДНЯ</span>
            <div className={styles.nextWorkoutHeading}><h2>{snapshot.gym.nextWorkout.name}</h2><span>{snapshot.gym.nextWorkout.exercises.length} {pluralize(snapshot.gym.nextWorkout.exercises.length, "упражнение", "упражнения", "упражнений")}</span></div>
            <button type="button" className={styles.primaryButton} onClick={() => startWorkout(snapshot.gym.nextWorkout!)}>Начать тренировку <Icon name="arrow" /></button>
          </GlassSurface>
        )}
        {snapshot.gym.lastWorkout && !snapshot.gym.trainingDay && (
          <GlassSurface className={styles.moduleSurface}>
            <span className={styles.eyebrow}>ПОСЛЕДНИЙ РЕЗУЛЬТАТ</span>
            <div className={styles.lastWorkout}><h2>{snapshot.gym.lastWorkout.name}</h2><p>{snapshot.gym.lastWorkout.summary}</p><span>{dateHeading(snapshot.gym.lastWorkout.completedAt)}</span></div>
          </GlassSurface>
        )}
        <GlassSurface className={styles.listSurface}>
          <div className={styles.listHeading}><div><span className={styles.eyebrow}>МОЙ ПЛАН</span><h2>Тренировочные дни</h2></div><button type="button" className={styles.textLink} onClick={() => onAction({ type: "gym.edit-program" })}><Icon name="edit" />Изменить</button></div>
          <AnimatePresence mode="wait" initial={false}>{workouts.length ? <motion.ul key="program" layout className={styles.programList} initial="initial" animate="animate" exit="exit" variants={motionVariants.state}><AnimatePresence initial={false}>{workouts.map((workout) => <motion.li layout variants={motionVariants.listItem} initial="initial" animate="animate" exit="exit" transition={motionSpring.gentle} key={workout.id}><button type="button" className={styles.programButton} onClick={() => { setSelectedWorkoutId(workout.id); setSelectedExerciseId(null); }}><div><strong>{workout.name}</strong><span>{workout.exercises.length} {pluralize(workout.exercises.length, "упражнение", "упражнения", "упражнений")}</span></div><Icon name="arrow" /></button></motion.li>)}</AnimatePresence></motion.ul> : <motion.p key="program-empty" className={styles.emptyInline} variants={motionVariants.state} initial="initial" animate="animate" exit="exit">Тренировочный план пока пуст. Добавьте дни и упражнения.</motion.p>}</AnimatePresence>
          <button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "gym.edit-program" })}><Icon name="plus" />Собрать программу</button>
        </GlassSurface>
      </div>
    );
  };

  const titles: Record<ModuleKey, string> = { today: "Сегодня", nutrition: "Питание", finance: "Финансы", gym: "Зал" };
  const sectionContent: Record<ModuleKey, ReactNode> = {
    today: renderToday(),
    nutrition: renderNutrition(),
    finance: renderFinance(),
    gym: renderGym(),
  };
  const telegramSafeAreaStyle = {
    "--lifeos-telegram-safe-area-top": `${Math.max(0, safeAreaTop)}px`,
    "--lifeos-telegram-content-safe-area-top": `${Math.max(0, contentSafeAreaTop)}px`,
  } as CSSProperties;

  return (
    <div className={styles.stage} data-lg-role="stage" data-fullscreen={fullscreen ? "true" : undefined} style={telegramSafeAreaStyle}>
      <div className={styles.stageLight} aria-hidden="true" />
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {restTimer?.phase === "running" ? "Таймер отдыха запущен." : restTimer?.phase === "paused" ? "Таймер отдыха на паузе." : restTimer?.phase === "finished" ? "Отдых завершён." : ""}
      </span>
      <div className={styles.appFrame}>
        <header className={styles.appHeader}>
          <button type="button" className={styles.brand} aria-label="Открыть настройки ИИ" title="Настройки ИИ" onClick={() => { onHaptic?.("selection"); onOpenAiProviders(); }}>LifeOS</button>
          {snapshot && <label className={styles.dateChip} style={{ position: "relative" }}><time dateTime={snapshot.localDate}>{dateHeading(snapshot.localDate)}</time>{onDateChange && <input type="date" aria-label="Выбрать дату дневника" value={snapshot.localDate} onChange={(event) => onDateChange(event.target.value)} style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer" }} />}</label>}
        </header>
        <main className={styles.main}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${section}:${selectedWorkoutId ?? ""}:${selectedExerciseId ?? ""}`} className={styles.screenMotion} variants={motionVariants.screen} initial="initial" animate="animate" exit="exit" transition={{ duration: motionDuration.transition }}>
              <div className={styles.pageHeading}><h1>{titles[section]}</h1></div>
              {sectionContent[section]}
              {snapshot && <ModuleReports reports={snapshot.reports} section={section} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <nav ref={dockRef} className={styles.dock} data-lg-role="dock" aria-label="Разделы LifeOS">
          <GlassRefraction surfaceRef={dockRef} filterId={dockFilterId} profile="thin" shape="pill" />
          {NAV_ITEMS.map((item) => section === item.key ? <motion.span key={item.key} layoutId="lifeos-active-dock-lens" className={styles.dockLens} aria-hidden="true" transition={motionSpring.snappy} /> : null)}
          {NAV_ITEMS.map((item) => (
            <button key={item.key} type="button" className={styles.dockButton} aria-label={item.label} aria-current={section === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>
              <Icon name={item.icon} />
              <span className={styles.srOnly}>{item.label}</span>
            </button>
          ))}
        </nav>
        <AnimatePresence initial={false}>
          {sheet && <ActionSheet key={sheet} sheet={sheet} snapshot={snapshot} onClose={() => setSheet(null)} onAction={(action) => { setSheet(null); onAction(action); }} panelRef={sheetRef} closeRef={closeSheetRef} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SetupState({ onAction }: { onAction(action: LifeOSAction): void }) {
  return (
    <GlassSurface className={styles.setupSurface} focus>
      <span className={styles.eyebrow}>НАЧАЛО</span>
      <h2>Пока нет данных</h2>
      <p>Запишите еду, расход или тренировку. Здесь появятся ваши итоги и история.</p>
      <div className={styles.setupActions}>
        <button type="button" className={styles.primaryButton} onClick={() => onAction({ type: "food.add" })}><Icon name="nutrition" />Добавить еду</button>
        <button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "finance.add" })}><Icon name="finance" />Операция</button>
        <button type="button" className={styles.secondaryButton} onClick={() => onAction({ type: "gym.edit-program" })}><Icon name="gym" />План зала</button>
      </div>
    </GlassSurface>
  );
}

function ActionSheet({
  sheet,
  snapshot,
  onClose,
  onAction,
  panelRef,
  closeRef,
}: {
  sheet: SheetKey;
  snapshot: LifeOSSnapshot | null;
  onClose(): void;
  onAction(action: LifeOSAction): void;
  panelRef: RefObject<HTMLElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
}) {
  const motionVariants = useMotionVariants();
  const content: Record<SheetKey, { title: string; description: string; options: { label: string; detail: string; action: LifeOSAction }[] }> = {
    nutrition: {
      title: "Питание",
      description: "Записи можно добавлять сообщением или фотографией в чате с ботом.",
      options: [
        { label: "Записать еду", detail: "Текст или фото · КБЖУ", action: { type: "food.add" } },
        { label: "Внести массу тела", detail: "Запись попадёт в историю веса", action: { type: "weight.add" } },
        { label: "Настроить цель КБЖУ", detail: "Цель на набор массы", action: { type: "food.set-target" } },
      ],
    },
    finance: {
      title: "Финансы",
      description: "Операцию можно быстро записать обычным сообщением в чате.",
      options: [
        { label: "Добавить операцию", detail: "Расход или доход", action: { type: "finance.add" } },
        { label: "Управлять счетами", detail: "Рубли ПМР и доллары США", action: { type: "finance.manage-accounts" } },
        { label: "Регулярные платежи", detail: "Подписки и напоминания", action: { type: "finance.manage-recurring" } },
      ],
    },
    gym: {
      title: "Тренировка",
      description: "Упражнения и подходы ведутся в плане тренировки.",
      options: [
        { label: "Изменить программу", detail: "Дни, порядок и упражнения", action: { type: "gym.edit-program" } },
        ...(snapshot?.gym.program[0] ? [{ label: "Добавить упражнение", detail: snapshot.gym.program[0].name, action: { type: "gym.add-exercise" as const, workoutId: snapshot.gym.program[0].id } }] : []),
      ],
    },
  };
  const config = content[sheet];

  return (
    <motion.div className={styles.sheetBackdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} variants={motionVariants.backdrop} initial="initial" animate="animate" exit="exit">
      <motion.section ref={panelRef} className={styles.actionSheet} role="dialog" aria-modal="true" aria-labelledby="lifeos-sheet-title" aria-describedby="lifeos-sheet-description" tabIndex={-1} variants={motionVariants.bottomSheet} initial="initial" animate="animate" exit="exit" transition={motionSpring.gentle}>
        <div className={styles.sheetGrip} aria-hidden="true" />
        <div className={styles.sheetHeader}>
          <div><span className={styles.eyebrow}>БЫСТРОЕ ДЕЙСТВИЕ</span><h2 id="lifeos-sheet-title">{config.title}</h2></div>
          <button ref={closeRef} type="button" className={styles.iconAction} aria-label="Закрыть панель" onClick={onClose}><Icon name="close" /></button>
        </div>
        <p id="lifeos-sheet-description" className={styles.sheetDescription}>{config.description}</p>
        <div className={styles.sheetOptions}>
          {config.options.map(({ label, detail, action }) => <button type="button" className={styles.sheetOption} key={label} onClick={() => onAction(action)}><span><strong>{label}</strong><small>{detail}</small></span><Icon name="arrow" /></button>)}
        </div>
      </motion.section>
    </motion.div>
  );
}

function pluralize(value: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(value) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (last > 1 && last < 5) return few;
  return last === 1 ? one : many;
}

export { LifeOSApp };
export type { LifeOSAppProps };
export default LifeOSApp;
