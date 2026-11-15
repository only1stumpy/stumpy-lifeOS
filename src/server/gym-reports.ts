/**
 * Workout history reports and the "previous performance" lookup, built with indexes so the cost grows
 * linearly with the amount of history (the naive nested scans grew with sessions x sets x items x exercises).
 * The results are identical to the original nested-loop implementation, which tests/gym-reports.test.ts keeps as a reference.
 */
export type GymSession = { id: string; name: string; status: string; completedAt: Date | null };
export type GymSessionItem = { id: string; sessionId: string; exerciseId: string };
export type GymSet = { id: string; sessionExerciseId: string; setNumber: number; isCompleted: boolean; weightKg: string | null; repetitions: number | null };
export type GymExercise = { id: string; name: string };

export type WorkoutHistoryEntry = { id: string; name: string; completedAt: string; completedSets: number; volumeKg: number };
export type ExerciseProgress = { id: string; name: string; points: { date: string; weightKg: number; repetitions: number | null }[] };

export type GymHistoryIndex<I extends GymSessionItem = GymSessionItem, S extends GymSet = GymSet> = {
  /** The most recent completed-session item of every exercise (sessions are ordered newest first). */
  previousItemByExercise: Map<string, I>;
  /** Sets of an item in their original order. */
  setsByItem: Map<string, S[]>;
};

export function indexGymHistory<I extends GymSessionItem, S extends GymSet>(sessions: readonly GymSession[], items: readonly I[], sets: readonly S[]): GymHistoryIndex<I, S> {
  const sessionIndex = new Map<string, number>();
  sessions.forEach((session, index) => { if (!sessionIndex.has(session.id)) sessionIndex.set(session.id, index); });
  const completed = new Set(sessions.filter((session) => session.status === "completed").map((session) => session.id));

  const previousItemByExercise = new Map<string, I>();
  for (const item of items) {
    if (!completed.has(item.sessionId)) continue;
    const current = previousItemByExercise.get(item.exerciseId);
    if (!current || sessionIndex.get(item.sessionId)! < sessionIndex.get(current.sessionId)!) previousItemByExercise.set(item.exerciseId, item);
  }

  const setsByItem = new Map<string, S[]>();
  for (const set of sets) {
    const list = setsByItem.get(set.sessionExerciseId);
    if (list) list.push(set);
    else setsByItem.set(set.sessionExerciseId, [set]);
  }
  return { previousItemByExercise, setsByItem };
}

export function buildGymReports(
  input: { sessions: readonly GymSession[]; items: readonly GymSessionItem[]; sets: readonly GymSet[]; exercises: readonly GymExercise[] },
  dateOf: (date: Date) => string,
): { workoutHistory: WorkoutHistoryEntry[]; exerciseProgress: ExerciseProgress[] } {
  const { sessions, items, sets, exercises } = input;
  const completedSessions = sessions.filter((session) => session.status === "completed");
  const itemById = new Map(items.map((item) => [item.id, item]));

  // Completed sets grouped by session and by (session, exercise), keeping the original set order.
  const bySession = new Map<string, GymSet[]>();
  const bySessionExercise = new Map<string, GymSet[]>();
  for (const set of sets) {
    if (!set.isCompleted) continue;
    const item = itemById.get(set.sessionExerciseId);
    if (!item) continue;
    const sessionRows = bySession.get(item.sessionId);
    if (sessionRows) sessionRows.push(set);
    else bySession.set(item.sessionId, [set]);
    if (set.weightKg === null) continue;
    const key = `${item.sessionId}\u0000${item.exerciseId}`;
    const rows = bySessionExercise.get(key);
    if (rows) rows.push(set);
    else bySessionExercise.set(key, [set]);
  }

  const workoutHistory = completedSessions.map((session) => {
    const rows = bySession.get(session.id) ?? [];
    return {
      id: session.id,
      name: session.name,
      completedAt: session.completedAt!.toISOString(),
      completedSets: rows.length,
      volumeKg: rows.reduce((sum, set) => sum + Number(set.weightKg ?? 0) * (set.repetitions ?? 0), 0),
    };
  });

  const oldestFirst = [...completedSessions].reverse();
  const exerciseProgress = exercises
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      points: oldestFirst.flatMap((session) => {
        const rows = bySessionExercise.get(`${session.id}\u0000${exercise.id}`);
        if (!rows?.length) return [];
        const best = rows.reduce((a, b) => (Number(a.weightKg) >= Number(b.weightKg) ? a : b));
        return [{ date: dateOf(session.completedAt!), weightKg: Number(best.weightKg), repetitions: best.repetitions }];
      }),
    }))
    .filter((entry) => entry.points.length > 0);

  return { workoutHistory, exerciseProgress };
}
