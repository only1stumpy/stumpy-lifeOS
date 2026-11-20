"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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
    || summaryTime !== (notifications.summaryTime ?? "19:30")
    || timeZone !== savedZone;

  const open = dirty || pending || error !== null;

  async function save() {
    if (pending) return;
    if (!modules.length) { setError("Оставь хотя бы один раздел."); return; }
    if (summaryTime && !TIME_PATTERN.test(summaryTime)) { setError("Время в формате ЧЧ:ММ."); return; }
    const ok = await onSave([
      ...(timeZone !== savedZone ? [{ type: "settings.save" as const, timeZone, target: null }] : []),
      { type: "personalization.save", modules: ALL_MODULES.filter((module) => modules.includes(module)), disabledFeatures: ALL_FEATURES.filter((feature) => !features.includes(feature)), settings: { dailySummary, weeklySummary, weightReminder, summaryTime: summaryTime || null } },
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
              <label className={styles.option}>
                <input type="checkbox" checked={moduleOn} onChange={(event) => toggle(modules, setModules, module, event.target.checked)} />
                <span><strong>{LIFE_MODULES[module].label}</strong><small>{LIFE_MODULES[module].description}</small></span>
              </label>
              {ALL_FEATURES.filter((feature) => LIFE_FEATURES[feature].module === module).map((feature) => (
                <label key={feature} className={styles.option} data-nested="true" data-dimmed={!moduleOn}>
                  <input type="checkbox" checked={features.includes(feature)} disabled={!moduleOn} onChange={(event) => toggle(features, setFeatures, feature, event.target.checked)} />
                  <span><strong>{LIFE_FEATURES[feature].label}</strong><small>{LIFE_FEATURES[feature].description}</small></span>
                </label>
              ))}
            </div>
          );
        })}
      </section>

      <section className={styles.section} aria-labelledby="notifications-heading">
        <h2 id="notifications-heading">Сводки и напоминания</h2>
        <label className={styles.option}>
          <input type="checkbox" checked={dailySummary} onChange={(event) => { touch(); setDailySummary(event.target.checked); }} />
          <span><strong>Дневная сводка</strong><small>{summaryText(modules, "day")}</small></span>
        </label>
        <label className={styles.option}>
          <input type="checkbox" checked={weeklySummary} onChange={(event) => { touch(); setWeeklySummary(event.target.checked); }} />
          <span><strong>Недельная сводка</strong><small>По воскресеньям: {summaryText(modules, "week")}</small></span>
        </label>
        {modules.includes("nutrition") && <label className={styles.option}>
          <input type="checkbox" checked={weightReminder} onChange={(event) => { touch(); setWeightReminder(event.target.checked); }} />
          <span><strong>Напоминание взвеситься</strong><small>По четвергам, если за 7 дней меньше трёх замеров.</small></span>
        </label>}
        <div className={styles.timeField}>
          <label htmlFor="summary-time"><strong>Время сводок и напоминаний</strong></label>
          <input id="summary-time" type="time" aria-describedby="summary-time-hint" value={summaryTime} onChange={(event) => { touch(); setSummaryTime(event.target.value); }} />
          <small id="summary-time-hint" className={styles.hint}>Сводки приходят в это время по твоему часовому поясу. Напоминания о платежах и долгах приходят всегда, пока включены их функции.</small>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="timezone-heading">
        <h2 id="timezone-heading">Часовой пояс</h2>
        <div className={styles.timeField}>
          <label htmlFor="time-zone"><strong>Твой пояс</strong></label>
          <select id="time-zone" aria-describedby="time-zone-hint" value={timeZone} onChange={(event) => { touch(); setTimeZone(event.target.value); }}>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <small id="time-zone-hint" className={styles.hint}>По нему считаются «сегодня», время записей, сводки и сроки. Уже сохранённые записи не пересчитываются: они остаются в тот же момент времени.</small>
        </div>
        {detectedZone() && detectedZone() !== timeZone ? <button type="button" className={styles.save} onClick={() => { touch(); setTimeZone(detectedZone() as string); }}>Определить по устройству: {detectedZone()}</button> : null}
      </section>

      {/* The bar is a portal: ancestors animated by framer-motion carry a transform, which would make them the containing block of position: fixed. */}
      <div className={styles.saveSpacer} data-open={open} aria-hidden="true" />
      {typeof document !== "undefined" ? createPortal(
      <div className={styles.saveBar} data-open={open} inert={!open}>
        {error ? <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p> : null}
        <button type="button" className={styles.save} disabled={pending || !dirty} aria-busy={pending} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить"}</button>
      </div>
        , document.body) : null}
    </div>
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

function summaryText(modules: readonly string[], period: "day" | "week"): string {
  const parts: string[] = [];
  if (modules.includes("nutrition")) parts.push(period === "day" ? "съеденное КБЖУ и остаток на день" : "питание и пересчёт нормы по среднему весу");
  if (modules.includes("finance")) parts.push(period === "day" ? "расходы за день" : "расходы за неделю");
  if (modules.includes("gym") && period === "week") parts.push("тренировки за неделю");
  if (!parts.length) return period === "day" ? "Дневная сводка считает питание и расходы: включи «Питание» или «Финансы»." : "Включи хотя бы один раздел, чтобы получать сводки.";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
