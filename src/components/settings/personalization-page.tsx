"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, Radio, Select, TextField } from "@/components/ui";
import { setLightPreference, useLightMode, useLightPreference, type LightPreference } from "@/components/glass/light-mode";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import { ALL_FEATURES, ALL_MODULES, LIFE_FEATURES, LIFE_MODULES, type LifeFeature, type LifeModule } from "@/domain/modules";
import styles from "./settings.module.css";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type PersonalizationSection = "menu" | "modules" | "notifications" | "time" | "appearance";
const SECTIONS: { page: Exclude<PersonalizationSection, "menu">; title: string; description: string }[] = [
  { page: "modules", title: "Разделы и функции", description: "Что видно в приложении и доступно боту." },
  { page: "notifications", title: "Уведомления и сводки", description: "Сводки, напоминания и время отправки." },
  { page: "time", title: "Время и часовой пояс", description: "Локальное время записей и отчётов." },
  { page: "appearance", title: "Оформление", description: "Лёгкое оформление на этом устройстве." },
];

export function PersonalizationPage({ snapshot, pending, onSave, navigationRef }: {
  snapshot: AppSnapshot;
  pending: boolean;
  onSave(commands: AppCommand[]): Promise<boolean>;
  navigationRef: RefObject<{ back(): boolean; canLeave(): boolean } | null>;
}) {
  const [section, setSection] = useState<PersonalizationSection>("menu");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { enabledModules, disabledFeatures, notifications } = snapshot.settings;
  const [modules, setModules] = useState<LifeModule[]>(enabledModules);
  const [features, setFeatures] = useState<LifeFeature[]>(ALL_FEATURES.filter((feature) => !disabledFeatures.includes(feature)));
  const [dailySummary, setDailySummary] = useState(notifications.dailySummary);
  const [weeklySummary, setWeeklySummary] = useState(notifications.weeklySummary);
  const [weightReminder, setWeightReminder] = useState(notifications.weightReminder);
  const [monthlySummary, setMonthlySummary] = useState(notifications.monthlySummary);
  const [dailyWeightReminder, setDailyWeightReminder] = useState(notifications.dailyWeightReminder);
  const [summaryTime, setSummaryTime] = useState(notifications.summaryTime ?? "19:30");
  const savedZone = snapshot.settings.timeZone;
  const [timeZone, setTimeZone] = useState(savedZone);
  const zones = timeZoneList(savedZone);
  const [error, setError] = useState<string | null>(null);

  const touch = () => setError(null);
  const toggle = <T,>(list: T[], setList: (next: T[]) => void, value: T, on: boolean) => {
    touch();
    setList(on ? [...list, value] : list.filter((item) => item !== value));
  };

  const sameList = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((item) => right.includes(item));
  const modulesDirty = !sameList(modules, enabledModules)
    || !sameList(features, ALL_FEATURES.filter((feature) => !disabledFeatures.includes(feature)));
  const notificationsDirty = dailySummary !== notifications.dailySummary
    || weeklySummary !== notifications.weeklySummary
    || weightReminder !== notifications.weightReminder
    || monthlySummary !== notifications.monthlySummary
    || dailyWeightReminder !== notifications.dailyWeightReminder
    || summaryTime !== (notifications.summaryTime ?? "19:30");
  const dirty = section === "modules" ? modulesDirty : section === "notifications" ? notificationsDirty : section === "time" && timeZone !== savedZone;

  const open = section !== "menu" && section !== "appearance" && (dirty || pending || error !== null);
  const canLeave = () => !pending && (!dirty || window.confirm("Изменения не сохранены. Выйти без сохранения?"));
  useEffect(() => {
    navigationRef.current = {
      canLeave,
      back: () => {
        if (section === "menu") return false;
        if (canLeave()) {
          if (dirty && section === "modules") {
            setModules(enabledModules);
            setFeatures(ALL_FEATURES.filter((feature) => !disabledFeatures.includes(feature)));
          }
          if (dirty && section === "notifications") {
            setDailySummary(notifications.dailySummary);
            setWeeklySummary(notifications.weeklySummary);
            setMonthlySummary(notifications.monthlySummary);
            setWeightReminder(notifications.weightReminder);
            setDailyWeightReminder(notifications.dailyWeightReminder);
            setSummaryTime(notifications.summaryTime ?? "19:30");
          }
          if (dirty && section === "time") setTimeZone(savedZone);
          setError(null);
          setSection("menu");
        }
        return true;
      },
    };
    return () => { navigationRef.current = null; };
  });
  useEffect(() => {
    if (section !== "menu") titleRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [section]);

  async function save() {
    if (pending || !dirty) return;
    if (section === "modules" && !modules.length) { setError("Оставь хотя бы один раздел."); return; }
    if (section === "notifications" && summaryTime && !TIME_PATTERN.test(summaryTime)) { setError("Время в формате ЧЧ:ММ."); return; }
    const settings = { dailySummary, weeklySummary, monthlySummary, weightReminder, dailyWeightReminder, summaryTime: summaryTime || null };
    const commands: AppCommand[] = section === "modules"
      ? [{ type: "modules.save", modules: ALL_MODULES.filter((module) => modules.includes(module)), disabledFeatures: ALL_FEATURES.filter((feature) => !features.includes(feature)) }]
      : section === "notifications" ? [{ type: "notifications.save", settings }]
        : section === "time" ? [{ type: "settings.save", timeZone, target: null }] : [];
    const ok = await onSave(commands);
    if (!ok) setError("Не удалось сохранить. Проверь соединение и повтори.");
  }

  return (
    <div className={styles.page} data-no-scroll-anchor="true">
      {section === "menu" ? <>
        <h1 className={styles.title}>Персонализация</h1>
        <nav className={styles.menu} aria-label="Разделы персонализации">
          {SECTIONS.map((item) => (
            // eslint-disable-next-line no-restricted-syntax -- строка-карточка пункта меню
            <button key={item.page} type="button" className={styles.menuItem} onClick={() => { setError(null); setSection(item.page); }}>
              <strong>{item.title}</strong><span>{item.description}</span>
            </button>
          ))}
        </nav>
      </> : <>
      <h1 ref={titleRef} tabIndex={-1} className={styles.title}>{SECTIONS.find((item) => item.page === section)?.title}</h1>
      {section === "modules" && <>
      <p className={styles.hint}>Выключенные разделы и функции пропадают из приложения, не попадают в сводки и напоминания и не передаются ИИ. Данные сохраняются: включи снова, и всё будет на месте.</p>

      <section className={styles.section} aria-labelledby="modules-heading">
        <h2 id="modules-heading">Разделы и функции</h2>
        {ALL_MODULES.map((module) => {
          const moduleOn = modules.includes(module);
          return (
            <div key={module}>
              <Checkbox checked={moduleOn} onChange={(event) => toggle(modules, setModules, module, event.target.checked)} label={<strong>{LIFE_MODULES[module].label}</strong>} description={LIFE_MODULES[module].description} />
              {ALL_FEATURES.filter((feature) => LIFE_FEATURES[feature].module === module).map((feature) => (
                <div key={feature} className={styles.nested} data-dimmed={!moduleOn}>
                  <Checkbox checked={features.includes(feature)} disabled={!moduleOn} onChange={(event) => toggle(features, setFeatures, feature, event.target.checked)} label={<strong>{LIFE_FEATURES[feature].label}</strong>} description={LIFE_FEATURES[feature].description} />
                </div>
              ))}
            </div>
          );
        })}
      </section>
      </>}

      {section === "notifications" && (
      <section className={styles.section} aria-labelledby="notifications-heading">
        <Checkbox checked={dailySummary} onChange={(event) => { touch(); setDailySummary(event.target.checked); }} label={<strong>Дневная сводка</strong>} description={summaryText(enabledModules, "day")} />
        <Checkbox checked={weeklySummary} onChange={(event) => { touch(); setWeeklySummary(event.target.checked); }} label={<strong>Недельная сводка</strong>} description={`По воскресеньям: ${summaryText(enabledModules, "week")}`} />
        <Checkbox checked={monthlySummary} onChange={(event) => { touch(); setMonthlySummary(event.target.checked); }} label={<strong>Месячная сводка</strong>} description={`В последний день месяца: ${summaryText(enabledModules, "month")}`} />
        {enabledModules.includes("nutrition") && <Checkbox checked={dailyWeightReminder} onChange={(event) => { touch(); setDailyWeightReminder(event.target.checked); }} label={<strong>Взвешивание каждый день</strong>} description="Напоминание каждый день в выбранное время, если вес за день ещё не записан. Вместе с четверговым напоминанием придёт одно сообщение." />}
        {enabledModules.includes("nutrition") && <Checkbox checked={weightReminder} onChange={(event) => { touch(); setWeightReminder(event.target.checked); }} label={<strong>Напоминание взвеситься</strong>} description="По четвергам, если за 7 дней меньше трёх замеров." />}
        <TextField
          type="time"
          className={styles.timeInput}
          label={<strong>Время сводок и напоминаний</strong>}
          hint="Сводки приходят в это время по твоему часовому поясу. Напоминания о платежах и долгах приходят всегда, пока включены их функции."
          value={summaryTime}
          onChange={(event) => { touch(); setSummaryTime(event.target.value); }}
        />
      </section>
      )}

      {section === "time" && (
      <section className={styles.section} aria-labelledby="timezone-heading">
        <Select
          label={<strong>Твой пояс</strong>}
          hint="По нему считаются «сегодня», время записей, сводки и сроки. Уже сохранённые записи не пересчитываются: они остаются в тот же момент времени."
          value={timeZone}
          onChange={(event) => { touch(); setTimeZone(event.target.value); }}
        >
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </Select>
        {detectedZone() && detectedZone() !== timeZone ? <Button variant="secondary" onClick={() => { touch(); setTimeZone(detectedZone() as string); }}>Определить по устройству: {detectedZone()}</Button> : null}
      </section>
      )}

      {section === "appearance" && <LightModeSection />}
      </>}

      {/* The bar is a portal: ancestors animated by framer-motion carry a transform, which would make them the containing block of position: fixed. */}
      <div className={styles.saveSpacer} data-open={open} aria-hidden="true" />
      {typeof document !== "undefined" ? createPortal(
      <div className={styles.saveBar} data-open={open} inert={!open}>
        {error ? <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p> : null}
        <Button variant="primary" size="lg" fullWidth disabled={!dirty} loading={pending} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить"}</Button>
      </div>
        , document.body) : null}
    </div>
  );
}

const LIGHT_OPTIONS: { value: LightPreference; label: string; description: string }[] = [
  { value: "auto", label: "Авто", description: "Включается само на слабых устройствах (по классу устройства в Telegram для Android и по плавности кадров) и при настройках ОС «уменьшить анимацию / прозрачность». Само назад не выключается." },
  { value: "on", label: "Вкл", description: "Без преломления и размытия: плавнее на медленных телефонах." },
  { value: "off", label: "Выкл", description: "Полное стеклянное оформление." },
];

/** Applies at once and is kept on this device only (not in the account), so it has nothing to do with the Save button. */
function LightModeSection() {
  const preference = useLightPreference();
  const active = useLightMode();
  return (
    <section className={styles.section} role="radiogroup" aria-labelledby="light-heading">
      <h2 id="light-heading">Лёгкое оформление</h2>
      <p className={styles.hint}>Настройка хранится только на этом устройстве. Сейчас: {active ? "лёгкое оформление" : "полное оформление"}.</p>
      {LIGHT_OPTIONS.map((option) => (
        <Radio key={option.value} name="light-mode" checked={preference === option.value} onChange={() => setLightPreference(option.value)} label={<strong>{option.label}</strong>} description={option.description} />
      ))}
    </section>
  );
}

function detectedZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

function timeZoneList(current: string): string[] {
  let zones: string[] = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { /* older engines: only the current zone */ }
  return zones.includes(current) ? zones : [current, ...zones];
}

function summaryText(modules: readonly string[], period: "day" | "week" | "month"): string {
  const parts: string[] = [];
  if (modules.includes("nutrition")) parts.push(period === "day" ? "съеденное КБЖУ и остаток на день" : period === "week" ? "питание и пересчёт нормы по среднему весу" : "питание за месяц");
  if (modules.includes("finance")) parts.push(period === "day" ? "расходы за день" : period === "week" ? "расходы за неделю" : "расходы за месяц");
  if (modules.includes("gym") && period !== "day") parts.push(period === "week" ? "тренировки за неделю" : "тренировки за месяц");
  if (!parts.length) return period === "day" ? "Дневная сводка считает питание и расходы: включи «Питание» или «Финансы»." : "Включи хотя бы один раздел, чтобы получать сводки.";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
