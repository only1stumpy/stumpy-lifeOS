// Ролик 6: «Бот против таблицы». Экран пополам, два таймера: внести обед и чек.
// Таблица показана ускоренно ×5 (8 с в кадре = 40 с на таймере), LifeOS — в реальном темпе.
// Тексты бота: formatDraft(), formatDraftList() (drafts.ts), formatConfirmedRecords(), formatBulkSummary() (confirmation.ts).
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { appear, sec, tw, typingDuration } from "./anim";
import { duel, FOOD } from "./config";
import { Background, Caption, FontFaces, Glass } from "./ui";
import { Draft, OutBubble, Receipt } from "./chat";
import { FinalCard, Hook } from "./parts";
import { C, FONT_MONO, FONT_SANS } from "./tokens";

const CPS = 26;
const START = 3.4;
const SPEED = 5;
const TABLE_SECONDS = 8;
const S = 0.58;

export function duelTimes() {
  const typeA = START + 0.15;
  const sendA = typeA + typingDuration(duel.lunch, CPS) + 0.1;
  const draftA = sendA + 0.3;
  const tapA = draftA + 0.8;
  const swapA = tapA + 0.22;
  const photo = swapA + 0.15;
  const draftB = photo + 0.4;
  const tapB = draftB + 0.8;
  const swapB = tapB + 0.22;
  const stop = swapB + 0.1;
  const tableEnd = START + TABLE_SECONDS;
  const fade = tableEnd + 0.4;
  const result = fade + 0.5;
  const final = result + 3.4;
  return { typeA, sendA, draftA, tapA, swapA, photo, draftB, tapB, swapB, stop, tableEnd, fade, result, final, end: final + 3.6 };
}
export const DUEL_SECONDS = duelTimes().end;

// ---------- таблица (обобщённая, без чужих брендов) ----------
const ink = "#2b2b30", ink2 = "#8a8a92", line = "#dcdce0";
const COLS = [110, 100, 160, 90, 100, 70, 70, 70];
const HEAD1 = ["Дата", "Приём", "Продукт", "Вес", "Ккал", "Б", "Ж", "У"];
const LUNCH = ["16.11", "Обед", "Удон", "300", "340", "12", "6", "62"];
const RECEIPT: [string, string][] = [["Молоко", "160"], ["Хлеб", "72,5"], ["Яйца", "205"], ["Сыр", "287,5"], ["Кофе", "315"], ["Бананы", "190"]];
type Cell = { r: number; c: number; text: string };
const cells: Cell[] = [
  ...LUNCH.map((text, c) => ({ r: 1, c, text })),
  ...RECEIPT.flatMap(([n, v], i) => [{ r: 4 + i, c: 0, text: n }, { r: 4 + i, c: 1, text: v }, { r: 4 + i, c: 2, text: "Продукты" }]),
  { r: 10, c: 0, text: "Итого" },
  { r: 10, c: 1, text: "1230" },
];
const cellAt = (i: number) => START + 0.3 + (i * (TABLE_SECONDS - 0.7)) / cells.length;
export const tableCellTimes = () => cells.map((_, i) => cellAt(i));
const ROWH = 42;
const colX = (c: number) => 44 + COLS.slice(0, c).reduce((a, b) => a + b, 0);

const Sheet: React.FC<{ f: number }> = ({ f }) => {
  const done = cells.filter((_, i) => f >= sec(cellAt(i)));
  const last = done.length ? done[done.length - 1] : null;
  const rows = 11;
  const head2 = ["Позиция", "Сумма", "Категория"];
  return (
    <div style={{ position: "relative", fontFamily: FONT_SANS, color: ink, fontSize: 25 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ position: "absolute", left: 0, right: 0, top: r * ROWH, height: ROWH, borderBottom: `1.5px solid ${line}` }}>
          <div style={{ position: "absolute", left: 0, width: 44, textAlign: "center", lineHeight: `${ROWH}px`, color: ink2, fontSize: 20, background: "#f4f4f6", height: "100%" }}>{r + 1}</div>
        </div>
      ))}
      {HEAD1.map((h, c) => <div key={h} style={{ position: "absolute", left: colX(c) + 10, top: 0, lineHeight: `${ROWH}px`, fontWeight: 600, color: ink2 }}>{h}</div>)}
      {head2.map((h, c) => <div key={h} style={{ position: "absolute", left: colX(c) + 10, top: 3 * ROWH, lineHeight: `${ROWH}px`, fontWeight: 600, color: ink2 }}>{h}</div>)}
      {cells.map((cl, i) => f >= sec(cellAt(i)) && <div key={i} style={{ position: "absolute", left: colX(cl.c) + 10, top: cl.r * ROWH, lineHeight: `${ROWH}px`, fontWeight: cl.r === 10 ? 640 : 460 }}>{cl.text}</div>)}
      {last && <div style={{ position: "absolute", left: colX(last.c), top: last.r * ROWH, width: COLS[last.c], height: ROWH, border: `3px solid ${ink}`, borderRadius: 3, boxSizing: "border-box" }} />}
    </div>
  );
};

const clock = (s: number) => `0:${String(Math.max(0, Math.floor(s))).padStart(2, "0")}`;
const Timer: React.FC<{ label: string; value: string; note?: string; accent?: boolean; light?: boolean }> = ({ label, value, note, accent, light }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 84, padding: "0 34px", fontFamily: FONT_SANS }}>
    <div style={{ fontSize: 38, fontWeight: 580, color: accent ? C.accent : light ? ink : C.text }}>{label}{note && <span style={{ fontSize: 24, fontWeight: 440, marginLeft: 16, color: ink2 }}>{note}</span>}</div>
    <div style={{ fontFamily: FONT_MONO, fontSize: 64, fontWeight: 600, letterSpacing: "-0.02em", color: accent ? C.accent : ink }}>{value}</div>
  </div>
);

export const Duel: React.FC = () => {
  const f = useCurrentFrame();
  const T = duelTimes();
  const t = f / 30;
  const el = Math.max(0, t - START);
  const tableT = Math.min(40, el * SPEED);
  const lifeT = Math.min(T.stop - START, el);
  const lifeDone = t >= T.stop;
  const lifeShown = lifeDone ? 4 : Math.ceil(lifeT);
  const panels = appear(f, 2.2, 24, 0.45);
  const panelsOut = 1 - tw(f, T.fade, T.fade + 0.4);
  const ra = (at: number) => appear(f, at, 20, 0.45);
  const out = 1 - tw(f, T.final - 0.1, T.final + 0.25);
  const lines = [
    "Проверь, пожалуйста · позиций: 6",
    ...RECEIPT.map(([n, v], i) => `${i + 1}. ${n} · ${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 }).format(Number(v.replace(",", ".")))} руб. · Продукты`),
    "Итого: 1 230,00 руб.",
    "Каждая позиция запишется отдельной операцией.",
    "Отдельную позицию потом можно поправить",
    "или удалить в Mini App → Финансы.",
  ];
  const kb = (e: { kcal: number; p: number; f: number; c: number }) => `КБЖУ: ${e.kcal} ккал · Б ${e.p} · Ж ${e.f} · У ${e.c} г`;
  const step2 = f >= sec(T.photo - 0.05);
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={duel.badge} line1={duel.hook.line1} line2={duel.hook.line2} until={2.0} />
      <Caption text={duel.captions.task} at={2.3} until={START - 0.1} top={240} size={52} />
      <Caption text={duel.captions.go} at={START} until={T.fade - 0.1} top={240} size={52} />

      <div style={{ opacity: panels.opacity * panelsOut, transform: panels.transform }}>
        {/* верх: таблица */}
        <div style={{ position: "absolute", left: 60, top: 330, width: 960, height: 580, background: "#fff", borderRadius: 28, boxShadow: "0 12px 40px rgba(0,0,0,.12)", overflow: "hidden" }}>
          <Timer label="Таблица" note="ускорено ×5" value={clock(tableT)} light />
          <div style={{ borderTop: `1.5px solid ${line}`, margin: "0 0 0 0", padding: "16px 38px 0 38px" }}>
            <Sheet f={f} />
          </div>
        </div>
        {/* низ: LifeOS */}
        <Glass radius={32} strong style={{ position: "absolute", left: 60, top: 930, width: 960, height: 650, overflow: "hidden" }}>
          <Timer label="LifeOS" value={clock(lifeShown)} accent />
          <div style={{ position: "absolute", left: 28, top: 84, width: 1560, transform: `scale(${S})`, transformOrigin: "0 0", display: "flex", flexDirection: "column", gap: 20 }}>
            {!step2 ? (
              <>
                <OutBubble frame={f} text={duel.lunch} typeStart={T.typeA} sendAt={T.sendA} cps={CPS} />
                <Draft
                  frame={f} at={T.draftA} kbDelay={0.1}
                  lines={["Проверь, пожалуйста · 16 нояб. 2026 г., 13:50", "Еда: Удон · 1 порция", kb(FOOD.udon), "КБЖУ оценены примерно."]}
                  confirmLines={["Записал еду: Удон · 1 порция", kb(FOOD.udon)]}
                  tapAt={T.tapA} confirmAt={T.swapA}
                />
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", ...appear(f, T.photo, 16, 0.3) }}>
                  <div style={{ background: C.accent, padding: 12, borderRadius: "40px 40px 12px 40px" }}>
                    <div style={{ borderRadius: 28, overflow: "hidden", background: "linear-gradient(160deg,#d9cfc6,#c9bcb4)", padding: "12px 20px", height: 170 }}>
                      <div style={{ transform: "scale(.5)", transformOrigin: "50% 0" }}>
                        <Receipt rows={RECEIPT.map(([n, v]) => [n, v.includes(",") ? v + "0" : v + ",00"])} total="1 230,00" />
                      </div>
                    </div>
                  </div>
                </div>
                <Draft
                  frame={f} at={T.draftB} kbDelay={0.1}
                  lines={lines}
                  confirmLines={["Записано 6 из 6"]}
                  rows={[[{ label: "Записать все", primary: true }, { label: "Отменить все" }]]}
                  tapAt={T.tapB} tapLabel="Записать все" confirmAt={T.swapB}
                />
              </>
            )}
          </div>
          {lifeDone && <div style={{ position: "absolute", right: 34, bottom: 24, ...appear(f, T.stop, 10, 0.3), fontFamily: FONT_SANS, fontSize: 36, fontWeight: 580, color: C.accent }}>Готово</div>}
        </Glass>
      </div>

      {f >= sec(T.result - 0.1) && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 440, textAlign: "center", fontFamily: FONT_SANS, color: C.text, opacity: out }}>
          <div style={{ fontSize: 150, fontWeight: 560, letterSpacing: "-0.04em", color: C.text2, ...ra(T.result) }}>{duel.result.slow}</div>
          <div style={{ fontSize: 60, fontWeight: 480, margin: "10px 0", ...ra(T.result + 0.4) }}>{duel.result.vs}</div>
          <div style={{ fontSize: 190, fontWeight: 600, letterSpacing: "-0.045em", color: C.accent, ...ra(T.result + 0.75) }}>{duel.result.fast}</div>
          <div style={{ fontSize: 64, fontWeight: 520, marginTop: 70, ...ra(T.result + 1.5) }}>{duel.result.note}</div>
        </div>
      )}

      <FinalCard f={f} start={T.final} {...duel.final} />
      {duel.audio.enabled && <Audio src={staticFile(duel.audio.file)} volume={duel.audio.volume} />}
    </AbsoluteFill>
  );
};
