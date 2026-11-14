import { z } from "zod";

/** Life areas a user can switch on or off; disabled ones are hidden and never reach AI or summaries. */
export const LIFE_MODULES = {
  nutrition: { label: "Питание", description: "КБЖУ еды, вес и норма калорий под вашу цель. Еду можно записывать сообщением боту или вручную." },
  finance: { label: "Финансы", description: "Счета в рублях ПМР и долларах, расходы и доходы, подписки, долги и планы покупок." },
  gym: { label: "Зал", description: "Программа тренировок, упражнения, подходы и таймер отдыха. Ведётся в Mini App." },
} as const;
export type LifeModule = keyof typeof LIFE_MODULES;
export const ALL_MODULES = Object.keys(LIFE_MODULES) as LifeModule[];

export const lifeModuleSchema = z.enum(ALL_MODULES as [LifeModule, ...LifeModule[]]);
export const enabledModulesSchema = z.array(lifeModuleSchema).min(1, "Оставьте хотя бы один раздел.").max(ALL_MODULES.length)
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
  return `${blocked.length > 1 ? "Разделы" : "Раздел"} ${names} ${blocked.length > 1 ? "выключены" : "выключен"}, поэтому я ничего не записал. Включить можно в LifeOS: шестерёнка → «Разделы».`;
}
