"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppSnapshot } from "@/domain/app";
import { commandSchema, type AppCommand } from "@/domain/commands";
import { currencyUnit } from "@/domain/currencies";
import { parseMinor } from "@/domain/math";
import { ALL_MODULES, LIFE_MODULES, type LifeModule } from "@/domain/modules";
import { ACTIVITY_LEVELS, GOALS, profileSchema, suggestTargets, type NutritionProfile } from "@/domain/nutrition";
import { USAGE_MODES, type UsageMode } from "@/domain/notifications";
import { CurrencyPicker } from "@/components/finance/currency-picker";
import styles from "./onboarding-flow.module.css";

/** Zone of the device, sent once at the first meeting; invalid or missing values are left for the server default. */
function detectTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

export type OnboardingCommand = Extract<AppCommand, { type: "onboarding.complete" }>;

type Step = "modules" | "usage" | "profile" | "currency" | "balance" | "ai";
type ProfileForm = { sex: string; age: string; heightCm: string; weightKg: string; activityLevel: string; goalType: string };
type Props = {
  snapshot: AppSnapshot;
  pending: boolean;
  error: string | null;
  /** Saves the answers. The AI step follows only when this resolves to true. */
  onSubmit(command: OnboardingCommand): Promise<boolean>;
  /** Telegram insets, so the first line never sits under the Telegram header. */
  /** The last step: connecting an AI key. It ends the onboarding itself. */
  renderAiStep(): ReactNode;
  /**
   * Setup of sections switched on later in «Персонализация»: only their questions, no module/usage/AI steps,
   * and the answers go through the ordinary profile and account commands instead of `onboarding.complete`.
   */
  sectionSetup?: {
    modules: LifeModule[];
    onSubmit(commands: AppCommand[]): Promise<boolean>;
    onDone(): void;
  };
};

function num(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value.replace(",", "."));
}

function parseProfile(form: ProfileForm): NutritionProfile | null {
  const parsed = profileSchema.safeParse({
    sex: form.sex,
    age: num(form.age),
    heightCm: num(form.heightCm),
    weightKg: num(form.weightKg),
    activityLevel: form.activityLevel,
    goalType: form.goalType,
  });
  return parsed.success ? parsed.data : null;
}

export function OnboardingFlow({ snapshot, pending, error, onSubmit, renderAiStep, sectionSetup }: Props) {
  const [modules, setModules] = useState<LifeModule[]>(() => sectionSetup ? sectionSetup.modules : (snapshot.settings.enabledModules.length ? [...snapshot.settings.enabledModules] : [...ALL_MODULES]));
  const [usage, setUsage] = useState<UsageMode>("daily");
  const [profile, setProfile] = useState<ProfileForm>(() => {
    const saved = snapshot.settings.profile;
    const weight = snapshot.nutrition.bodyWeightKg;
    return {
      sex: saved.sex ?? "",
      age: saved.age != null ? String(saved.age) : "",
      heightCm: saved.heightCm != null ? String(saved.heightCm) : "",
      weightKg: weight != null ? String(weight) : "",
      activityLevel: saved.activityLevel ?? "",
      goalType: saved.goalType ?? "",
    };
  });
  const [skipProfile, setSkipProfile] = useState(false);
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [skipAccount, setSkipAccount] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  // After a tap on "Далее" with unfilled fields, the missing ones are marked.
  const [attemptedAt, setAttemptedAt] = useState(-1);
  const rootRef = useRef<HTMLElement>(null);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = sectionSetup ? [] : ["modules", "usage"];
    if (modules.includes("nutrition")) list.push("profile");
    if (modules.includes("finance")) {
      list.push("currency");
      if (!skipAccount) list.push("balance");
    }
    if (!sectionSetup) list.push("ai");
    return list;
  }, [modules, skipAccount, sectionSetup]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  // The step before the AI one is where the answers are saved.
  const isLastDataStep = stepIndex >= steps.length - (sectionSetup ? 1 : 2);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    rootRef.current?.scrollIntoView({ block: "start" });
    // Move focus to the new step's title so screen readers announce the step change.
    const title = rootRef.current?.querySelector("h1");
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }, [stepIndex]);

  const attempted = attemptedAt === stepIndex;
  const parsedProfile = parseProfile(profile);
  const norm = parsedProfile ? suggestTargets(parsedProfile) : null;
  const invalid = {
    age: profile.age !== "" && !(Number.isInteger(num(profile.age)) && num(profile.age) >= 18 && num(profile.age) <= 90),
    heightCm: profile.heightCm !== "" && !(num(profile.heightCm) >= 100 && num(profile.heightCm) <= 250),
    weightKg: profile.weightKg !== "" && !(num(profile.weightKg) >= 30 && num(profile.weightKg) <= 350),
  };

  const missing = {
    sex: attempted && profile.sex === "",
    age: invalid.age || (attempted && profile.age === ""),
    heightCm: invalid.heightCm || (attempted && profile.heightCm === ""),
    weightKg: invalid.weightKg || (attempted && profile.weightKg === ""),
    activityLevel: attempted && profile.activityLevel === "",
    goalType: attempted && profile.goalType === "",
  };

  function changeProfile(patch: Partial<ProfileForm>) {
    setProfile({ ...profile, ...patch });
  }

  function toggleModule(module: LifeModule) {
    setModules((current) => {
      if (current.includes(module)) return current.length > 1 ? current.filter((item) => item !== module) : current;
      return ALL_MODULES.filter((item) => item === module || current.includes(item));
    });
  }

  // The step's own validity gates "Далее" (the button stays disabled, no explanatory text); skipping is a separate action.
  const stepBlocked: boolean = (() => {
    if (step === "modules") return modules.length < 1;
    if (step === "profile") return !skipProfile && !parsedProfile;
    if (step === "currency") return currency === "";
    if (step === "balance" && amount.trim() !== "") {
      try { parseMinor(amount); } catch { return true; }
    }
    return false;
  })();

  function build(skip: { profile?: boolean; account?: boolean }): OnboardingCommand | string {
    const useProfile = modules.includes("nutrition") && !(skip.profile ?? skipProfile) && !!parsedProfile;
    const account = (() => {
      if (!modules.includes("finance") || (skip.account ?? skipAccount) || currency === "") return null;
      const openingBalanceMinor = amount.trim() === "" ? 0 : parseMinor(amount);
      return { currency, openingBalanceMinor };
    })();
    const candidate = {
      type: "onboarding.complete",
      modules,
      usage,
      timeZone: detectTimeZone(),
      profile: useProfile ? parsedProfile : null,
      target: useProfile && norm ? norm : null,
      account,
    };
    const parsed = commandSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.type !== "onboarding.complete") return "Не удалось проверить данные. Проверь поля и попробуй ещё раз.";
    return parsed.data;
  }

  async function finishSection(skip: { profile?: boolean; account?: boolean }) {
    if (!sectionSetup) return;
    const commands: AppCommand[] = [];
    if (modules.includes("nutrition") && !(skip.profile ?? skipProfile) && parsedProfile && norm) commands.push({ type: "profile.save", profile: parsedProfile, target: norm });
    if (modules.includes("finance") && !(skip.account ?? skipAccount) && currency !== "") {
      let openingBalanceMinor = 0;
      try { openingBalanceMinor = amount.trim() === "" ? 0 : parseMinor(amount); } catch { setLocalError("Введи сумму числом, например 1500,50"); return; }
      commands.push({ type: "account.save", name: "Основной", currency, openingBalanceMinor, isDefault: true });
    }
    for (const command of commands) {
      if (!(await sectionSetup.onSubmit([command]))) return;
    }
    sectionSetup.onDone();
  }

  async function finish(skip: { profile?: boolean; account?: boolean }) {
    setLocalError(null);
    if (sectionSetup) { await finishSection(skip); return; }
    let command: OnboardingCommand | string;
    try { command = build(skip); } catch (e) { command = e instanceof Error ? e.message : "Проверь введённые данные."; }
    if (typeof command === "string") { setLocalError(command); return; }
    // Answers are saved first; the AI step is shown only after that, and it cannot be walked back from.
    if (await onSubmit(command)) setStepIndex(steps.length - 1);
  }

  function next() {
    if (stepBlocked) {
      // The button stays pressable: instead of silently doing nothing, show what is missing and scroll to it.
      setAttemptedAt(stepIndex);
      window.requestAnimationFrame(() => rootRef.current?.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    if (step === "currency") setSkipAccount(false);
    if (isLastDataStep && !(step === "currency" && skipAccount)) void finish({});
    else { setLocalError(null); setStepIndex((i) => i + 1); }
  }

  function skip() {
    if (step === "profile") setSkipProfile(true);
    if (step === "currency") setSkipAccount(true);
    // The currency step is always the last data step, and skipping it drops the balance step.
    if (isLastDataStep || step === "currency") void finish(step === "profile" ? { profile: true } : { account: true });
    else { setLocalError(null); setStepIndex((i) => i + 1); }
  }

  function back() {
    setLocalError(null);
    if (step === "profile") setSkipProfile(false);
    if (step === "currency") setSkipAccount(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const shownError = localError ?? error;
  const canSkip = step === "profile" || step === "currency";

  return (
    <main className={styles.page} ref={rootRef}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.progress}>Шаг {Math.min(stepIndex, steps.length - 1) + 1} из {steps.length}</p>
          <div className={styles.bar} aria-hidden="true"><span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
        </header>

        {step === "modules" && (
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Чем ты будешь пользоваться?</h1>
            <div className={styles.cards}>
              {ALL_MODULES.map((module) => {
                const on = modules.includes(module);
                return (
                  <label key={module} className={`${styles.card} ${on ? styles.selected : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleModule(module)} />
                    <span className={styles.cardTitle}>{LIFE_MODULES[module].label}</span>
                    <span className={styles.cardText}>{LIFE_MODULES[module].description}</span>
                  </label>
                );
              })}
            </div>
            <p className={styles.note}>Выключенные разделы не показываются и не передаются ИИ. Включить их можно позже в настройках.</p>
          </section>
        )}

        {step === "usage" && (
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Как часто ты будешь заходить?</h1>
            <fieldset className={styles.cards}>
              <legend className={styles.srOnly}>Частота использования</legend>
              {(Object.keys(USAGE_MODES) as UsageMode[]).map((mode) => (
                <label key={mode} className={`${styles.card} ${usage === mode ? styles.selected : ""}`}>
                  <input type="radio" name="usage" checked={usage === mode} onChange={() => setUsage(mode)} />
                  <span className={styles.cardTitle}>{USAGE_MODES[mode].label}</span>
                  <span className={styles.cardText}>{USAGE_MODES[mode].hint}</span>
                </label>
              ))}
            </fieldset>
          </section>
        )}

        {step === "profile" && (
          <section className={`${styles.step} ${styles.compact}`} aria-labelledby="ob-title">
            <h1 id="ob-title">Расскажи о себе</h1>
            <div className={styles.fieldsTwo}>
              <label className={styles.field}>Пол
                <select value={profile.sex} onChange={(e) => changeProfile({ sex: e.target.value })} aria-invalid={missing.sex}>
                  <option value="" disabled>Выбери</option>
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
                {missing.sex && <small className={styles.fieldError}>Выбери пол</small>}
              </label>
              <label className={styles.field}>Возраст
                <input inputMode="numeric" value={profile.age} onChange={(e) => changeProfile({ age: e.target.value })} aria-invalid={missing.age} />
                {missing.age && <small className={styles.fieldError}>{profile.age === "" ? "Укажи возраст" : "От 18 до 90"}</small>}
              </label>
              <label className={styles.field}>Рост, см
                <input inputMode="decimal" value={profile.heightCm} onChange={(e) => changeProfile({ heightCm: e.target.value })} aria-invalid={missing.heightCm} />
                {missing.heightCm && <small className={styles.fieldError}>{profile.heightCm === "" ? "Укажи рост" : "От 100 до 250"}</small>}
              </label>
              <label className={styles.field}>Вес, кг
                <input inputMode="decimal" value={profile.weightKg} onChange={(e) => changeProfile({ weightKg: e.target.value })} aria-invalid={missing.weightKg} />
                {missing.weightKg && <small className={styles.fieldError}>{profile.weightKg === "" ? "Укажи вес" : "От 30 до 350"}</small>}
              </label>
              <label className={`${styles.field} ${styles.wide}`}>Активность
                <select value={profile.activityLevel} onChange={(e) => changeProfile({ activityLevel: e.target.value })} aria-invalid={missing.activityLevel}>
                  <option value="" disabled>Выбери</option>
                  {Object.entries(ACTIVITY_LEVELS).map(([key, level]) => <option key={key} value={key}>{level.label}</option>)}
                </select>
                {missing.activityLevel && <small className={styles.fieldError}>Выбери активность</small>}
              </label>
              <label className={`${styles.field} ${styles.wide}`}>Цель
                <select value={profile.goalType} onChange={(e) => changeProfile({ goalType: e.target.value })} aria-invalid={missing.goalType}>
                  <option value="" disabled>Выбери</option>
                  {Object.entries(GOALS).map(([key, goal]) => <option key={key} value={key}>{goal.label}</option>)}
                </select>
                {missing.goalType && <small className={styles.fieldError}>Выбери цель</small>}
              </label>
            </div>
            <p className={styles.norm} aria-live="polite">
              {norm
                ? <>Норма на день: <strong>{norm.calories.toLocaleString("ru-RU")} ккал</strong> · Б {norm.proteinGrams} · Ж {norm.fatGrams} · У {norm.carbsGrams}. Её можно поправить позже.</>
                : "Заполни поля, и я посчитаю норму на день."}
            </p>
          </section>
        )}

        {step === "currency" && (
          <section className={`${styles.step} ${styles.compact}`} aria-labelledby="ob-title">
            <h1 id="ob-title">Твоя валюта</h1>
            <CurrencyPicker value={currency} onChange={setCurrency} legend="Валюта основного счёта" />
          </section>
        )}

        {step === "balance" && (
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Сколько сейчас на счёте?</h1>
            <label className={styles.field}>Сумма, {currencyUnit(currency)}
              <input inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={attempted && stepBlocked} />
              {attempted && stepBlocked && <small className={styles.fieldError}>Введи сумму числом, например 1500,50</small>}
            </label>
            <p className={styles.note}>Счёт назовём «Основной», переименовать можно в Финансах.</p>
          </section>
        )}

        {/* Mounted from the start (hidden) so the providers are already loaded when the step opens. */}
        <section className={styles.aiStep} aria-label="Подключение ИИ" hidden={step !== "ai"}>{renderAiStep()}</section>

        {step !== "ai" && (
          <div className={styles.actions}>
            {step === "modules" && modules.length < 1 && <p className={styles.hint}>Оставь включённым хотя бы один раздел.</p>}
            {step === "currency" && attempted && currency === "" && <p className={styles.hint} role="alert">Выбери валюту из списка или введи свой код.</p>}
            {shownError && <p className={styles.error} role="alert">{shownError}</p>}
            <button type="button" className={styles.primary} onClick={next} disabled={pending} aria-busy={pending}>{pending ? <><span className={styles.spinner} aria-hidden="true" />Сохраняю…</> : "Далее"}</button>
            <div className={styles.secondaryRow}>
              {stepIndex > 0 && <button type="button" className={styles.secondary} onClick={back} disabled={pending}>Назад</button>}
              {canSkip && <button type="button" className={styles.secondary} onClick={skip} disabled={pending}>Пропустить</button>}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
