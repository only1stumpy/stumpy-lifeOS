import { z } from "zod";

/** Life areas a user can switch on or off; disabled ones are hidden and never reach AI or summaries. */
export const LIFE_MODULES = {
  nutrition: { label: "Питание", description: "КБЖУ еды, вес и норма калорий под твою цель. Еду можно записывать сообщением боту или вручную." },
  finance: { label: "Финансы", description: "Счета в любых валютах, расходы и доходы, подписки, долги и планы покупок." },
  gym: { label: "Зал", description: "Программа тренировок, упражнения, подходы и таймер отдыха. Ведётся в Mini App." },
} as const;
export type LifeModule = keyof typeof LIFE_MODULES;
export const ALL_MODULES = Object.keys(LIFE_MODULES) as LifeModule[];

export const lifeModuleSchema = z.enum(ALL_MODULES as [LifeModule, ...LifeModule[]]);
export const enabledModulesSchema = z.array(lifeModuleSchema).min(1, "Оставь хотя бы один раздел.").max(ALL_MODULES.length)
  .refine((modules) => new Set(modules).size === modules.length, "Разделы повторяются.");

/** Normalizes a stored value to known modules in canonical order; an empty or broken value means everything is on. */
export function normalizeModules(value: readonly string[] | null | undefined): LifeModule[] {
  const known = ALL_MODULES.filter((module) => value?.includes(module));
  return known.length ? known : [...ALL_MODULES];
}

/**
 * Drops AI-parsed food or money parts that belong to disabled modules.
 * `blocked` lists the modules whose data was removed, so the caller can explain why nothing was recorded.
 */
export function filterEntriesByModules<T extends { food: unknown; money: unknown }>(entries: readonly T[], modules: readonly LifeModule[]): { entries: T[]; blocked: LifeModule[] } {
  const blocked = new Set<LifeModule>();
  const kept: T[] = [];
  for (const entry of entries) {
    const food = entry.food && !modules.includes("nutrition") ? (blocked.add("nutrition"), null) : entry.food;
    const money = entry.money && !modules.includes("finance") ? (blocked.add("finance"), null) : entry.money;
    if (food || money) kept.push({ ...entry, food, money });
  }
  return { entries: kept, blocked: ALL_MODULES.filter((module) => blocked.has(module)) };
}

/** Reply for a message that only touched disabled modules. */
export function disabledModulesMessage(blocked: readonly LifeModule[]): string {
  const names = blocked.map((module) => `«${LIFE_MODULES[module].label}»`).join(" и ");
  return `${blocked.length > 1 ? "Разделы" : "Раздел"} ${names} ${blocked.length > 1 ? "выключены" : "выключен"}, поэтому я ничего не записал. Включить можно в LifeOS: шестерёнка → «Персонализация».`;
}

/** Parts of a module that can be switched off on their own; they work only while their module is on. */
export const LIFE_FEATURES = {
  "finance.debts": { module: "finance", label: "Долги", description: "Кому ты должен и кто должен тебе, частичные возвраты и напоминания о сроке." },
  "finance.plans": { module: "finance", label: "Планы покупок", description: "Что хочешь купить. План не расход, пока ты не отметишь покупку." },
  "finance.subscriptions": { module: "finance", label: "Подписки и платежи", description: "Регулярные списания и напоминания. Расходом становятся после твоего подтверждения." },
  "nutrition.weight": { module: "nutrition", label: "Вес", description: "Замеры массы тела, график с трендом, напоминание взвеситься и пересчёт нормы по среднему весу." },
} as const satisfies Record<string, { module: LifeModule; label: string; description: string }>;
export type LifeFeature = keyof typeof LIFE_FEATURES;
export const ALL_FEATURES = Object.keys(LIFE_FEATURES) as LifeFeature[];

export const lifeFeatureSchema = z.enum(ALL_FEATURES as [LifeFeature, ...LifeFeature[]]);
export const disabledFeaturesSchema = z.array(lifeFeatureSchema).max(ALL_FEATURES.length)
  .refine((features) => new Set(features).size === features.length, "Функции повторяются.");

/** Known disabled features from storage, in canonical order. */
export function normalizeDisabledFeatures(value: readonly string[] | null | undefined): LifeFeature[] {
  return ALL_FEATURES.filter((feature) => value?.includes(feature));
}

/** Features that are actually usable: their module is on and the user did not switch them off. */
export function resolveFeatures(modules: readonly LifeModule[], disabled: readonly string[] | null | undefined): LifeFeature[] {
  const off = normalizeDisabledFeatures(disabled);
  return ALL_FEATURES.filter((feature) => modules.includes(LIFE_FEATURES[feature].module) && !off.includes(feature));
}

/** Reply for a chat message that needs a switched-off feature. */
export function disabledFeatureMessage(feature: LifeFeature): string {
  return `Функция «${LIFE_FEATURES[feature].label}» выключена, поэтому я ничего не записал. Включить можно в LifeOS: шестерёнка → «Персонализация».`;
}
