"use client";

import { useState } from "react";
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
  const [summaryTime, setSummaryTime] = useState(notifications.summaryTime ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const touch = () => { setSaved(false); setError(null); };
  const toggle = <T,>(list: T[], setList: (next: T[]) => void, value: T, on: boolean) => {
    touch();
    setList(on ? [...list, value] : list.filter((item) => item !== value));
  };

  async function save() {
    if (pending) return;
    if (!modules.length) { setError("Оставьте хотя бы один раздел."); return; }
    if (summaryTime && !TIME_PATTERN.test(summaryTime)) { setError("Время в формате ЧЧ:ММ."); return; }
    const ok = await onSave([
      { type: "modules.save", modules: ALL_MODULES.filter((module) => modules.includes(module)), disabledFeatures: ALL_FEATURES.filter((feature) => !features.includes(feature)) },
      { type: "notifications.save", settings: { dailySummary, weeklySummary, weightReminder, summaryTime: summaryTime || null } },
    ]);
    if (ok) setSaved(true);
    else setError("Не удалось сохранить. Проверьте соединение и повторите.");
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Персонализация</h1>
      <p className={styles.hint}>Выключенные разделы и функции пропадают из приложения, не попадают в сводки и напоминания и не передаются ИИ. Данные сохраняются: включите снова, и всё будет на месте.</p>

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
          <span><strong>Дневная сводка</strong><small>Съеденное КБЖУ и остаток на день.</small></span>
        </label>
        <label className={styles.option}>
          <input type="checkbox" checked={weeklySummary} onChange={(event) => { touch(); setWeeklySummary(event.target.checked); }} />
          <span><strong>Недельная сводка</strong><small>По воскресеньям: питание, расходы, тренировки и пересчёт нормы по среднему весу.</small></span>
        </label>
        <label className={styles.option}>
          <input type="checkbox" checked={weightReminder} onChange={(event) => { touch(); setWeightReminder(event.target.checked); }} />
          <span><strong>Напоминание взвеситься</strong><small>По четвергам, если за 7 дней меньше трёх замеров.</small></span>
        </label>
        <label className={styles.timeField}>
          <strong>Время сводок и напоминаний</strong>
          <input type="time" value={summaryTime} onChange={(event) => { touch(); setSummaryTime(event.target.value); }} />
          <small className={styles.hint}>Если не задано, сводки приходят в 19:30 по вашему часовому поясу. Напоминания о платежах и долгах приходят всегда, пока включены их функции.</small>
        </label>
      </section>

      <div className={styles.actions}>
        {error ? <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p> : null}
        {saved ? <p className={`${styles.status} ${styles.ok}`} role="status">Сохранено.</p> : null}
        <button type="button" className={styles.save} disabled={pending} onClick={() => void save()}>Сохранить</button>
      </div>
    </div>
  );
}
