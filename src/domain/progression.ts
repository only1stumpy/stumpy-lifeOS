type CompletedSet = { weightKg: string | number | null; repetitions: number | null };

export function shouldSuggestLoadIncrease(
  sets: CompletedSet[],
  plannedSets: number,
  targetRepsMax: number,
): boolean {
  return plannedSets > 0
    && sets.length >= plannedSets
    && sets.slice(0, plannedSets).every((set) => Number(set.weightKg) > 0
      && set.repetitions !== null
      && set.repetitions >= targetRepsMax);
}
