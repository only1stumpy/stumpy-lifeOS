import type { LifeModule } from "./modules";

/**
 * Sections that were just switched on in «Персонализация» and still have no data, so they get their own short setup.
 * "First enabling" is decided by missing data (no nutrition targets, no account), not by a stored flag.
 * The gym section needs nothing up front: the program is built by hand inside it.
 */
export function modulesNeedingSetup(
  before: readonly LifeModule[],
  after: readonly LifeModule[],
  data: { hasNutritionTarget: boolean; hasAccount: boolean },
): LifeModule[] {
  return after.filter((module) => {
    if (before.includes(module)) return false;
    if (module === "nutrition") return !data.hasNutritionTarget;
    if (module === "finance") return !data.hasAccount;
    return false;
  });
}
