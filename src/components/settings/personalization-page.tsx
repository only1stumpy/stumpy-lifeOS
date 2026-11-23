"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, Radio, Select, TextField } from "@/components/ui";
import { setLightPreference, useLightMode, useLightPreference, type LightPreference } from "@/components/glass/light-mode";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import { ALL_FEATURES, ALL_MODULES, LIFE_FEATURES, LIFE_MODULES, type LifeFeature, type LifeModule } from "@/domain/modules";
import styles from "./settings.module.css";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Settings page: which life areas and features are on, and which summaries and reminders the bot sends.
 * One form, one save button; nothing opens in a popup.
 */
export function PersonalizationPage({ snapshot, pending, onSave }: {
  snapshot: AppSnapshot;
  pending: boolean;
  /** Sends the commands one after another and resolves to false as soon as one is rejected. */
  onSave(commands: AppCommand[]): Promise<boolean>;
}) {
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
  const dirty = !sameList(modules, enabledModules)
    || !sameList(features, ALL_FEATURES.filter((feature) => !disabledFeatures.includes(feature)))
    || dailySummary !== notifications.dailySummary
    || weeklySummary !== notifications.weeklySummary
    || weightReminder !== notifications.weightReminder
    || monthlySummary !== notifications.monthlySummary
    || dailyWeightReminder !== notifications.dailyWeightReminder
    || summaryTime !== (notifications.summaryTime ?? "19:30")
    || timeZone !== savedZone;

  const open = dirty || pending || error !== null;

  async function save() {
    if (pending) return;
    if (!modules.length) { setError("Оставь хотя бы один раздел."); return; }
    if (summaryTime && !TIME_PATTERN.test(summaryTime)) { setError("Время в формате ЧЧ:ММ."); return; }
    const ok = await onSave([
      ...(timeZone !== savedZone ? [{ type: "settings.save" as const, timeZone, target: null }] : []),
      { type: "personalization.save", modules: ALL_MODULES.filter((module) => modules.includes(module)), disabledFeatures: ALL_FEATURES.filter((feature) => !features.includes(feature)), settings: { dailySummary, weeklySummary, monthlySummary, weightReminder, dailyWeightReminder, summaryTime: summaryTime || null } },
    ]);
    if (!ok) setError("Не удалось сохранить. Проверь соединение и повтори.");
  }

  return (
    <div className={styles.page} data-no-scroll-anchor="true">
      <h1 className={styles.title}>Персонализация</h1>
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

      <section className={styles.section} aria-labelledby="notifications-heading">
        <h2 id="notifications-heading">Сводки и напоминания</h2>
        <Checkbox checked={dailySummary} onChange={(event) => { touch(); setDailySummary(event.target.checked); }} label={<strong>Дневная сводка</strong>} description={summaryText(modules, "day")} />
        <Checkbox checked={weeklySummary} onChange={(event) => { touch(); setWeeklySummary(event.target.checked); }} label={<strong>Недельная сводка</strong>} description={`По воскресеньям: ${summaryText(modules, "week")}`} />
        <Checkbox checked={monthlySummary} onChange={(event) => { touch(); setMonthlySummary(event.target.checked); }} label={<strong>Месячная сводка</strong>} description={`В последний день месяца: ${summaryText(modules, "month")}`} />
        {modules.includes("nutrition") && <Checkbox checked={dailyWeightReminder} onChange={(event) => { touch(); setDailyWeightReminder(event.target.checked); }} label={<strong>Взвешивание каждый день</strong>} description="Напоминание каждый день в выбранное время, если вес за день ещё не записан. Вместе с четверговым напоминанием придёт одно сообщение." />}
        {modules.includes("nutrition") && <Checkbox checked={weightReminder} onChange={(event) => { touch(); setWeightReminder(event.target.checked); }} label={<strong>Напоминание взвеситься</strong>} description="По четвергам, если за 7 дней меньше трёх замеров." />}
        <TextField
          type="time"
          className={styles.timeInput}
          label={<strong>Время сводок и напоминаний</strong>}
          hint="Сводки приходят в это время по твоему часовому поясу. Напоминания о платежах и долгах приходят всегда, пока включены их функции."
          value={summaryTime}
          onChange={(event) => { touch(); setSummaryTime(event.target.value); }}
        />
      </section>

      <section className={styles.section} aria-labelledby="timezone-heading">
        <h2 id="timezone-heading">Часовой пояс</h2>
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

      <LightModeSection />

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
