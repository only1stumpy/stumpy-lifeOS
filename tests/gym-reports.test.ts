import assert from "node:assert/strict";
import test from "node:test";
import { buildGymReports, indexGymHistory, type GymExercise, type GymSession, type GymSessionItem, type GymSet } from "../src/server/gym-reports";

// Deterministic pseudo-random generator so the comparison is reproducible.
function random(seed: number) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
}

function dataset(seed: number) {
  const next = random(seed);
  const exercises: GymExercise[] = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, name: `Упражнение ${i}` }));
  const sessions: GymSession[] = [];
  const items: GymSessionItem[] = [];
  const sets: GymSet[] = [];
  for (let i = 0; i < 25; i += 1) {
    const status = next() < 0.15 ? "active" : "completed";
    sessions.push({ id: `s${i}`, name: `День ${i % 3}`, status, completedAt: status === "completed" ? new Date(Date.UTC(2026, 0, 1 + (25 - i))) : null });
    const itemCount = 1 + Math.floor(next() * 4);
    for (let j = 0; j < itemCount; j += 1) {
      // The same exercise may appear twice in a session, which exercises tie-breaking.
      const exerciseId = `e${Math.floor(next() * 6)}`;
      const id = `s${i}-i${j}`;
      items.push({ id, sessionId: `s${i}`, exerciseId });
      for (let k = 1; k <= 1 + Math.floor(next() * 4); k += 1) {
        const weight = next() < 0.2 ? null : String(Math.round(next() * 8) * 5);
        sets.push({ id: `${id}-k${k}`, sessionExerciseId: id, setNumber: k, isCompleted: next() < 0.85, weightKg: weight, repetitions: next() < 0.1 ? null : 1 + Math.floor(next() * 12) });
      }
    }
  }
  return { exercises, sessions, items, sets };
}

/** The original nested-loop implementation, kept verbatim as the reference. */
function reference({ exercises, sessions, items, sets }: ReturnType<typeof dataset>, dateOf: (d: Date) => string) {
  return {
    workoutHistory: sessions.filter((v) => v.status === "completed").map((session) => {
      const rows = sets.filter((set) => set.isCompleted && items.some((item) => item.sessionId === session.id && item.id === set.sessionExerciseId));
      return { id: session.id, name: session.name, completedAt: session.completedAt!.toISOString(), completedSets: rows.length, volumeKg: rows.reduce((sum, set) => sum + Number(set.weightKg ?? 0) * (set.repetitions ?? 0), 0) };
    }),
    exerciseProgress: exercises.map((exercise) => ({ id: exercise.id, name: exercise.name, points: sessions.filter((v) => v.status === "completed").reverse().flatMap((session) => {
      const rows = sets.filter((set) => set.isCompleted && set.weightKg !== null && items.some((item) => item.sessionId === session.id && item.exerciseId === exercise.id && item.id === set.sessionExerciseId));
      if (!rows.length) return [];
      const best = rows.reduce((a, b) => Number(a.weightKg) >= Number(b.weightKg) ? a : b);
      return [{ date: dateOf(session.completedAt!), weightKg: Number(best.weightKg), repetitions: best.repetitions }];
    }) })).filter((v) => v.points.length > 0),
  };
}

function referencePrevious({ sessions, items, sets }: ReturnType<typeof dataset>, exerciseId: string) {
  const previousItem = items.filter((i) => i.exerciseId === exerciseId && sessions.some((session) => session.id === i.sessionId && session.status === "completed"))
    .sort((a, b) => sessions.findIndex((x) => x.id === a.sessionId) - sessions.findIndex((x) => x.id === b.sessionId))[0];
  const previousSets = sets.filter((v) => v.sessionExerciseId === previousItem?.id && v.isCompleted).sort((a, b) => a.setNumber - b.setNumber);
  return { itemId: previousItem?.id, setIds: previousSets.map((set) => set.id) };
}

test("отчёты зала с индексами совпадают с исходной реализацией на случайных данных", () => {
  const dateOf = (date: Date) => date.toISOString().slice(0, 10);
  for (let seed = 1; seed <= 40; seed += 1) {
    const data = dataset(seed);
    const fast = buildGymReports({ sessions: data.sessions, items: data.items, sets: data.sets, exercises: data.exercises }, dateOf);
    assert.deepEqual(fast, reference(data, dateOf), `seed ${seed}`);
  }
});

test("предыдущая тренировка по упражнению совпадает с исходным поиском", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const data = dataset(seed);
    const index = indexGymHistory(data.sessions, data.items, data.sets);
    for (const exercise of data.exercises) {
      const expected = referencePrevious(data, exercise.id);
      const item = index.previousItemByExercise.get(exercise.id);
      assert.equal(item?.id, expected.itemId, `seed ${seed} ${exercise.id}`);
      const sets = (item ? index.setsByItem.get(item.id) ?? [] : []).filter((set) => set.isCompleted).sort((a, b) => a.setNumber - b.setNumber);
      assert.deepEqual(sets.map((set) => set.id), expected.setIds, `seed ${seed} ${exercise.id}`);
    }
  }
});

test("на большой истории индексы работают за доли секунды", () => {
  const sessions: GymSession[] = [];
  const items: GymSessionItem[] = [];
  const sets: GymSet[] = [];
  const exercises: GymExercise[] = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, name: `E${i}` }));
  for (let i = 0; i < 400; i += 1) {
    sessions.push({ id: `s${i}`, name: "Д", status: "completed", completedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000) });
    for (let j = 0; j < 8; j += 1) {
      const id = `s${i}-i${j}`;
      items.push({ id, sessionId: `s${i}`, exerciseId: `e${(i + j) % 30}` });
      for (let k = 1; k <= 4; k += 1) sets.push({ id: `${id}-k${k}`, sessionExerciseId: id, setNumber: k, isCompleted: true, weightKg: String(40 + k), repetitions: 8 });
    }
  }
  const started = performance.now();
  const result = buildGymReports({ sessions, items, sets, exercises }, (d) => d.toISOString().slice(0, 10));
  const elapsed = performance.now() - started;
  assert.equal(result.workoutHistory.length, 400);
  assert.ok(elapsed < 1000, `слишком медленно: ${Math.round(elapsed)} мс`);
});
