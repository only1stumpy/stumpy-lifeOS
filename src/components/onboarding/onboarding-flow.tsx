"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot } from "@/domain/app";
import { commandSchema, type AppCommand } from "@/domain/commands";
import { parseMinor } from "@/domain/math";
import { ALL_MODULES, LIFE_MODULES, type LifeModule } from "@/domain/modules";
import { ACTIVITY_LEVELS, GOALS, profileSchema, suggestTargets, type NutritionProfile } from "@/domain/nutrition";
import { USAGE_MODES, type UsageMode } from "@/domain/notifications";
import styles from "./onboarding-flow.module.css";

export type OnboardingCommand = Extract<AppCommand, { type: "onboarding.complete" }>;

type Step = "modules" | "usage" | "profile" | "account";
type ProfileForm = { sex: string; age: string; heightCm: string; weightKg: string; activityLevel: string; goalType: string };
type TargetForm = { calories: string; proteinGrams: string; fatGrams: string; carbsGrams: string };
type Props = { snapshot: AppSnapshot; pending: boolean; error: string | null; onSubmit(command: OnboardingCommand): Promise<boolean> };

const TARGET_FIELDS: { key: keyof TargetForm; label: string }[] = [
  { key: "calories", label: "Ккал" },
  { key: "proteinGrams", label: "Белки, г" },
  { key: "fatGrams", label: "Жиры, г" },
  { key: "carbsGrams", label: "Углеводы, г" },
];
const EMPTY_TARGET: TargetForm = { calories: "", proteinGrams: "", fatGrams: "", carbsGrams: "" };

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

function targetFor(profile: NutritionProfile | null): TargetForm {
  if (!profile) return EMPTY_TARGET;
  const t = suggestTargets(profile);
  return { calories: String(t.calories), proteinGrams: String(t.proteinGrams), fatGrams: String(t.fatGrams), carbsGrams: String(t.carbsGrams) };
}

export function OnboardingFlow({ snapshot, pending, error, onSubmit }: Props) {
  const [modules, setModules] = useState<LifeModule[]>(() => (snapshot.settings.enabledModules.length ? [...snapshot.settings.enabledModules] : [...ALL_MODULES]));
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
  const [target, setTarget] = useState<TargetForm>(() => targetFor(parseProfile({
    sex: snapshot.settings.profile.sex ?? "",
    age: snapshot.settings.profile.age != null ? String(snapshot.settings.profile.age) : "",
    heightCm: snapshot.settings.profile.heightCm != null ? String(snapshot.settings.profile.heightCm) : "",
    weightKg: snapshot.nutrition.bodyWeightKg != null ? String(snapshot.nutrition.bodyWeightKg) : "",
    activityLevel: snapshot.settings.profile.activityLevel ?? "",
    goalType: snapshot.settings.profile.goalType ?? "",
  })));
  const [skipProfile, setSkipProfile] = useState(false);
  const [currency, setCurrency] = useState<"PRB" | "USD">("PRB");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(snapshot.settings.usdToPrb ?? "");
  const [skipAccount, setSkipAccount] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = ["modules", "usage"];
    if (modules.includes("nutrition")) list.push("profile");
    if (modules.includes("finance")) list.push("account");
    return list;
  }, [modules]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    rootRef.current?.scrollIntoView({ block: "start" });
  }, [stepIndex]);

  const parsedProfile = parseProfile(profile);
  const profileErrors = {
    age: profile.age !== "" && !(Number.isInteger(num(profile.age)) && num(profile.age) >= 16 && num(profile.age) <= 90) ? "Возраст: от 16 до 90 лет." : null,
    heightCm: profile.heightCm !== "" && !(num(profile.heightCm) >= 100 && num(profile.heightCm) <= 250) ? "Рост: от 100 до 250 см." : null,
    weightKg: profile.weightKg !== "" && !(num(profile.weightKg) >= 30 && num(profile.weightKg) <= 350) ? "Вес: от 30 до 350 кг." : null,
  };

  const rateValid = /^\d{1,6}([.,]\d{1,6})?$/.test(rate.trim()) && Number(rate.replace(",", ".")) > 0;
  const rateError = currency === "USD" && rate.trim() !== "" && !rateValid ? "Курс: положительное число, до 6 знаков после запятой." : null;

  function changeProfile(patch: Partial<ProfileForm>) {
    const next = { ...profile, ...patch };
    setProfile(next);
    setTarget(targetFor(parseProfile(next)));
  }

  function toggleModule(module: LifeModule) {
    setModules((current) => {
      if (current.includes(module)) return current.length > 1 ? current.filter((item) => item !== module) : current;
      return ALL_MODULES.filter((item) => item === module || current.includes(item));
    });
  }

  const targetFilled = TARGET_FIELDS.every(({ key }) => target[key].trim() !== "" && Number.isFinite(num(target[key])) && num(target[key]) >= 0);
  // The step's own validity gates "Далее"; skipping is a separate explicit action.
  const stepBlocker: string | null = (() => {
    if (step === "modules" && modules.length < 1) return "Оставьте включённым хотя бы один раздел.";
    if (step === "profile" && !skipProfile && !(parsedProfile && targetFilled)) return "Заполните все поля профиля или нажмите «Пропустить».";
    if (step === "account" && !skipAccount) {
      if (amount.trim() !== "") {
        try { parseMinor(amount); } catch (e) { return e instanceof Error ? e.message : "Проверьте сумму."; }
      }
      if (currency === "USD" && !rateValid) return "Для долларового счёта нужен курс.";
    }
    return null;
  })();

  function build(skip: { profile?: boolean; account?: boolean }): OnboardingCommand | string {
    const useProfile = modules.includes("nutrition") && !(skip.profile ?? skipProfile) && !!parsedProfile;
    const account = (() => {
      if (!modules.includes("finance") || (skip.account ?? skipAccount)) return null;
      const openingBalanceMinor = amount.trim() === "" ? 0 : parseMinor(amount);
      return { currency, openingBalanceMinor, usdToPrb: currency === "USD" ? rate.trim().replace(",", ".") : null };
    })();
    const candidate = {
      type: "onboarding.complete",
      modules,
      usage,
      profile: useProfile ? parsedProfile : null,
      target: useProfile ? { calories: num(target.calories), proteinGrams: num(target.proteinGrams), fatGrams: num(target.fatGrams), carbsGrams: num(target.carbsGrams) } : null,
      account,
    };
    const parsed = commandSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.type !== "onboarding.complete") return "Не удалось проверить данные. Проверьте поля и попробуйте ещё раз.";
    return parsed.data;
  }

  async function finish(skip: { profile?: boolean; account?: boolean }) {
    setLocalError(null);
    let command: OnboardingCommand | string;
    try { command = build(skip); } catch (e) { command = e instanceof Error ? e.message : "Проверьте введённые данные."; }
    if (typeof command === "string") { setLocalError(command); return; }
    await onSubmit(command);
  }

  function next() {
    if (stepBlocker) { setLocalError(stepBlocker); return; }
    if (isLast) void finish({});
    else { setLocalError(null); setStepIndex((i) => i + 1); }
  }

  function skip() {
    if (step === "profile") setSkipProfile(true);
    if (step === "account") setSkipAccount(true);
    if (isLast) void finish(step === "profile" ? { profile: true } : { account: true });
    else { setLocalError(null); setStepIndex((i) => i + 1); }
  }

  function back() {
    setLocalError(null);
    if (step === "profile") setSkipProfile(false);
    if (step === "account") setSkipAccount(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const shownError = localError ?? error;
  const canSkip = step === "profile" || step === "account";

  return (
    <main className={styles.page} ref={rootRef}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.progress}>Шаг {Math.min(stepIndex, steps.length - 1) + 1} из {steps.length}</p>
          <div className={styles.bar} aria-hidden="true"><span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
        </header>

        {step === "modules" && (
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Чем вы будете пользоваться?</h1>
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
            <h1 id="ob-title">Как часто вы будете заходить?</h1>
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
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Расскажите о себе</h1>
            <p className={styles.lead}>По этим данным посчитаем стартовую норму на день. Её можно поправить.</p>
            <div className={styles.fields}>
              <label className={styles.field}>Пол
                <select value={profile.sex} onChange={(e) => changeProfile({ sex: e.target.value })}>
                  <option value="" disabled>Выберите</option>
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
              </label>
              <label className={styles.field}>Возраст
                <input inputMode="numeric" value={profile.age} onChange={(e) => changeProfile({ age: e.target.value })} aria-invalid={!!profileErrors.age} />
                {profileErrors.age && <small role="alert">{profileErrors.age}</small>}
              </label>
              <label className={styles.field}>Рост, см
                <input inputMode="decimal" value={profile.heightCm} onChange={(e) => changeProfile({ heightCm: e.target.value })} aria-invalid={!!profileErrors.heightCm} />
                {profileErrors.heightCm && <small role="alert">{profileErrors.heightCm}</small>}
              </label>
              <label className={styles.field}>Вес, кг
                <input inputMode="decimal" value={profile.weightKg} onChange={(e) => changeProfile({ weightKg: e.target.value })} aria-invalid={!!profileErrors.weightKg} />
                {profileErrors.weightKg && <small role="alert">{profileErrors.weightKg}</small>}
              </label>
              <label className={styles.field}>Активность
                <select value={profile.activityLevel} onChange={(e) => changeProfile({ activityLevel: e.target.value })}>
                  <option value="" disabled>Выберите</option>
                  {Object.entries(ACTIVITY_LEVELS).map(([key, level]) => <option key={key} value={key}>{level.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>Цель
                <select value={profile.goalType} onChange={(e) => changeProfile({ goalType: e.target.value })}>
                  <option value="" disabled>Выберите</option>
                  {Object.entries(GOALS).map(([key, goal]) => <option key={key} value={key}>{goal.label}</option>)}
                </select>
              </label>
            </div>
            {parsedProfile && (
              <fieldset className={styles.target}>
                <legend>Норма на день</legend>
                <div className={styles.targetGrid}>
                  {TARGET_FIELDS.map(({ key, label }) => (
                    <label key={key} className={styles.field}>{label}
                      <input inputMode="numeric" value={target[key]} onChange={(e) => setTarget({ ...target, [key]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </section>
        )}

        {step === "account" && (
          <section className={styles.step} aria-labelledby="ob-title">
            <h1 id="ob-title">Сколько сейчас на основном счёте?</h1>
            <fieldset className={styles.segmented}>
              <legend className={styles.srOnly}>Валюта счёта</legend>
              {([["PRB", "Рубли ПМР"], ["USD", "Доллары"]] as const).map(([value, label]) => (
                <label key={value} className={currency === value ? styles.segmentOn : ""}>
                  <input type="radio" name="currency" checked={currency === value} onChange={() => setCurrency(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <div className={styles.fields}>
              <label className={styles.field}>Сумма
                <input inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              {currency === "USD" && (
                <label className={styles.field}>Курс: 1 USD = … руб. ПМР
                  <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={!!rateError} />
                  {rateError && <small role="alert">{rateError}</small>}
                </label>
              )}
            </div>
            <p className={styles.note}>Счёт назовём «Основной», переименовать можно в Финансах.</p>
          </section>
        )}

        <div className={styles.actions}>
          {step === "modules" && modules.length < 1 && <p className={styles.hint}>Оставьте включённым хотя бы один раздел.</p>}
          {shownError && <p className={styles.error} role="alert">{shownError}</p>}
          <button type="button" className={styles.primary} onClick={next} disabled={pending || (step === "modules" && modules.length < 1)}>
            {isLast ? "Готово" : "Далее"}
          </button>
          <div className={styles.secondaryRow}>
            {stepIndex > 0 && <button type="button" className={styles.secondary} onClick={back} disabled={pending}>Назад</button>}
            {canSkip && <button type="button" className={styles.secondary} onClick={skip} disabled={pending}>Пропустить</button>}
          </div>
        </div>
      </div>
    </main>
  );
}
