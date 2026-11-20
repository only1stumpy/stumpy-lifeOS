"use client";

import { useMemo, useState } from "react";
import type { ExerciseCatalogEntry, ExerciseIllustration } from "@/domain/exercise-catalog";
import { Select, TextField } from "@/components/ui";
import styles from "./exercise-guide.module.css";

type ExerciseGuideProps = {
  entries: ExerciseCatalogEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
};

export function ExerciseGuide({ entries, selectedId, onSelect }: ExerciseGuideProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все группы");
  const categories = useMemo(() => ["Все группы", ...new Set(entries.map((entry) => entry.category))], [entries]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filtered = entries.filter((entry) => (category === "Все группы" || entry.category === category)
    && `${entry.name} ${entry.muscles} ${entry.equipment}`.toLocaleLowerCase("ru").includes(normalizedQuery));
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  return (
    <section className={styles.guide} aria-label="Каталог упражнений">
      <div className={styles.filters}>
        <TextField label="Поиск упражнения" type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Название, мышцы или инвентарь" />
        <Select label="Раздел" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</Select>
      </div>
      <div className={styles.list} role="group" aria-label="Найденные упражнения" tabIndex={0}>
        {filtered.map((entry) => {
          const isSelected = entry.id === selectedId;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${entry.name}; ${entry.muscles}; ${entry.equipment}`}
              onClick={() => onSelect(entry.id)}
              className={styles.item}
            >
              <ExerciseIllustration kind={entry.illustration} />
              <span className={styles.itemCopy}>
                <strong>{entry.name}</strong>
                <small>{entry.muscles} · {entry.equipment}</small>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && <p role="status">Ничего не нашлось. Попробуй другое название или выбери упражнение вручную.</p>}
      </div>
      {selected && (
        <p className={styles.details} aria-live="polite">
          <strong>{selected.category}</strong> · {selected.muscles}<br />
          <small>{selected.instructions}</small>
        </p>
      )}
    </section>
  );
}

function ExerciseIllustration({ kind }: { kind: ExerciseIllustration }) {
  return (
    <svg className={styles.illustration} width="62" height="54" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
      <path d="M9 61H87" stroke="#742b4530" strokeWidth="1.5" strokeLinecap="round" />
      <g fill="none" stroke="#742b45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {drawMovement(kind)}
      </g>
      <circle cx="48" cy="11" r="5" fill="#a9697d" />
    </svg>
  );
}

function drawMovement(kind: ExerciseIllustration) {
  switch (kind) {
    case "squat":
      return <><path d="M48 19v15l-12 9 7 9 9-7 8 8" /><path d="m48 25-13 3m13-3 13 3" /><path d="M29 22h38m-4-4v8m-30-8v8" stroke="#a9697d" /><path d="m52 45 10-8 8 9" /><path d="M70 46v7" stroke="#a9697d" /></>;
    case "hinge":
      return <><path d="m51 18 15 12-12 13-12-4-11 10" /><path d="m59 25-17 2-9 8" /><path d="m54 43 12 7 8-2" /><path d="M26 51h50" stroke="#a9697d" /><path d="M30 48v6m42-6v6" /></>;
    case "lunge":
      return <><path d="M48 18v17l-8 10 10 7 8-11 12 2 6 10" /><path d="m48 23-12 8m12-8 12 8" /><path d="M50 52 42 59m28-7 8 7" stroke="#a9697d" /><path d="M36 59h48" /></>;
    case "push":
      return <><path d="M48 18v22m0-13-15-8m15 8 15-8m-15 21-9 14m9-14 9 14" /><path d="M29 17h38m-5-4v8m-28-8v8" stroke="#a9697d" /><path d="m28 29 4 4 4-4m28-1 4 4 4-4" /></>;
    case "pull":
      return <><path d="m49 18-7 19 13 8-4 12m-9-20-13 1m13-1 15-5" /><path d="m56 45 14 6 7-3" /><path d="M27 28h45" stroke="#a9697d" /><path d="M33 25v6m32-6v6" /><path d="m54 31-4 4 5 2" stroke="#a9697d" /></>;
    case "core":
      return <><path d="m29 48 14-8 18 2 15 7m-43-9-7 10m53-3 6 6m-42-13-5 15m36-14-4 14" /><path d="M23 56h60" stroke="#a9697d" /><path d="m42 38 4-5 4 5" stroke="#a9697d" /></>;
    case "cardio":
      return <><path d="m47 19-5 15 12 6-8 10-13 4m21-14 11 7 8 1M42 34l-12 1-8 9m21-12 10-8" /><path d="m35 48 10 2m16-10 8 4" stroke="#a9697d" /><path d="M18 57c10-5 20-5 30 0s20 5 30 0" stroke="#a9697d" strokeDasharray="3 4" /></>;
  }
}
