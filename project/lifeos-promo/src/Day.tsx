// Второй ролик: «Один день с LifeOS». 30 с, часы ведут через утро, день и вечер.
// Тексты ответов бота взяты из кода Stumpy_LifeOS:
//   вес — saveWeightFromChat() в handlers/messages.ts (без ИИ, без кнопок);
//   план — handlers/messages.ts: «Запланировал «…» — <сумма>. Это пока не расход.» (без кнопок);
//   вопрос о тратах — reference.ts: «Сегодня записано расходов на <сумма>.» (только чтение);
//   еда и доход — formatDraft() / formatConfirmedRecords(), как в первом ролике.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_MONO, FONT_SANS } from "./tokens";
import { appear, lerp, sec, sp, springNum, tw, typingDuration } from "./anim";
import { day } from "./config";
import { Background, Caption, FontFaces, Glass } from "./ui";
import { CHAT_W, CHAT_X, Draft, InBubble, Lines, OutBubble } from "./chat";
import { AppWindow, FinanceOverview, FinancePlans, GymExercise, TodayScreen, WeightCard, type Macros } from "./app";

export const DAY_SECONDS = day.final.end;
const CPS = 26;
const S = day.steps;
type StepKey = keyof typeof S;
const ORDER: StepKey[] = ["weight", "breakfast", "salary", "plan", "gym", "question"];
const endOf = (k: StepKey) => {
  const i = ORDER.indexOf(k);
  return i < ORDER.length - 1 ? S[ORDER[i + 1]].start : day.final.start;
};

/** Опорные моменты шага: начало набора, отправка, ответ бота, тап «Записать», подтверждение. */
export function stepTimes(k: StepKey) {
  const st = S[k];
  const typeStart = st.start + 0.25;
  const send = st.text ? typeStart + typingDuration(st.text, CPS) + 0.08 : st.start;
  const reply = send + 0.35;
  const tap = send + 1.35;
  const confirm = tap + 0.22;
  return { typeStart, send, reply, tap, confirm, end: endOf(k) };
}

const head = (time: string) => `Проверь, пожалуйста · 16 нояб. 2026 г., ${time}`;
const OMELET = { label: "Омлет", portion: "2 яйца", kcal: 220, p: 14, f: 17, c: 2 };
const kbju = `КБЖУ: ${OMELET.kcal} ккал · Б ${OMELET.p} · Ж ${OMELET.f} · У ${OMELET.c} г`;
const WEIGHT_HISTORY = [
  { date: "2026-11-10", kg: 73.6 }, { date: "2026-11-11", kg: 73.4 }, { date: "2026-11-12", kg: 73.5 },
  { date: "2026-11-13", kg: 73.2 }, { date: "2026-11-14", kg: 73.3 }, { date: "2026-11-15", kg: 73 }, { date: "2026-11-16", kg: 72 },
];
const BALANCE = { morning: 12300, salary: 75000, evening: 86475 };
const SPENT = { day: 1100, evening: 1925 };

/** Часы-капсула: при смене времени старое уезжает вверх, новое приходит снизу. */
const Clock: React.FC<{ f: number }> = ({ f }) => {
  const a = appear(f, S.weight.start - 0.2, 12, 0.35);
  let i = 0;
  ORDER.forEach((k, idx) => { if (f >= sec(S[k].start)) i = idx; });
  const p = tw(f, S[ORDER[i]].start, S[ORDER[i]].start + 0.32);
  const prev = i > 0 ? S[ORDER[i - 1]].time : null;
  const out = 1 - tw(f, day.final.start - 0.1, day.final.start + 0.2);
  return (
    <div style={{ position: "absolute", top: 232, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: a.opacity * out, transform: a.transform }}>
      <Glass radius={999} strong style={{ width: 300, height: 96, overflow: "hidden", fontFamily: FONT_MONO, fontSize: 60, color: C.accent }}>
        {prev && p < 1 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 1 - p, transform: `translateY(${-p * 50}px)` }}>{prev}</div>}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: i === 0 ? 1 : p, transform: `translateY(${(1 - (i === 0 ? 1 : p)) * 50}px)` }}>{S[ORDER[i]].time}</div>
      </Glass>
    </div>
  );
};

/** Чат одного шага: появляется в начале шага, растворяется к концу. */
const StepChat: React.FC<{ f: number; k: StepKey; children: React.ReactNode }> = ({ f, k, children }) => {
  const { end } = stepTimes(k);
  const st = S[k].start;
  if (f < sec(st - 0.05) || f > sec(end + 0.3)) return null;
  const o = Math.min(tw(f, st - 0.05, st + 0.15), 1 - tw(f, end - 0.15, end + 0.1));
  return <div style={{ position: "absolute", left: CHAT_X, top: 460, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, opacity: o }}>{children}</div>;
};

const BotText: React.FC<{ f: number; at: number; lines: string[] }> = ({ f, at, lines }) => {
  if (f < sec(at)) return null;
  return <div style={{ display: "flex", ...appear(f, at, 14, 0.3) }}><InBubble><Lines lines={lines} /></InBubble></div>;
};

export const Day: React.FC = () => {
  const f = useCurrentFrame();
  const W = stepTimes("weight"), B = stepTimes("breakfast"), Sa = stepTimes("salary"), P = stepTimes("plan"), Q = stepTimes("question");

  // Окно приложения: снизу под чатом; на шаге «Зал» разворачивается на весь экран.
  const grow = sp(f, S.gym.start - 0.1, "smooth") - sp(f, S.question.start - 0.1, "smooth");
  const winTop = lerp(1010, 440, grow);
  const winH = lerp(560, 1130, grow);
  const winIn = sp(f, S.weight.start + 0.1, "gentle");
  const winOut = 1 - tw(f, day.final.start - 0.1, day.final.start + 0.25);

  const hookOut = 1 - tw(f, 2.1, 2.45);
  const breakfast: Macros = { kcal: OMELET.kcal, p: OMELET.p, f: OMELET.f, c: OMELET.c };
  const zero: Macros = { kcal: 0, p: 0, f: 0, c: 0 };
  const mixM = (a: Macros, b: Macros, p: number): Macros => ({ kcal: lerp(a.kcal, b.kcal, p), p: lerp(a.p, b.p, p), f: lerp(a.f, b.f, p), c: lerp(a.c, b.c, p) });
  const evening: Macros = { kcal: 1840, p: 119, f: 62, c: 198 };

  const fin = day.final;
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />

      {/* Хук */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 560, textAlign: "center", fontFamily: FONT_SANS, color: C.text, opacity: hookOut }}>
        <div style={{ display: "flex", justifyContent: "center", ...appear(f, 0, 10, 0.35) }}>
          <Glass radius={999} strong style={{ padding: "16px 38px", fontSize: 42, fontWeight: 540, color: C.accent }}>{day.badge}</Glass>
        </div>
        <div style={{ ...appear(f, 0.15, 18, 0.45), fontSize: 124, fontWeight: 560, letterSpacing: "-0.035em", marginTop: 60 }}>{day.hook.line1}</div>
        <div style={{ ...appear(f, 0.55, 18, 0.45), fontSize: 124, fontWeight: 560, letterSpacing: "-0.035em", color: C.accent }}>{day.hook.line2}</div>
      </div>

      <Clock f={f} />
      {ORDER.map((k) => <Caption key={k} text={S[k].caption} at={S[k].start + 0.1} until={endOf(k) - 0.15} top={350} size={52} />)}

      {/* 08:10 — вес без ИИ и без кнопок */}
      <StepChat f={f} k="weight">
        <OutBubble frame={f} text={S.weight.text} typeStart={W.typeStart} sendAt={W.send} cps={CPS} />
        <BotText f={f} at={W.reply} lines={["Записал вес 72 кг на сегодня.", "Прошлый замер 15.11: 73 кг (-1 кг).", "Ошибся — пришли правильный вес, он заменит сегодняшний."]} />
      </StepChat>

      {/* 09:00 — завтрак через черновик */}
      <StepChat f={f} k="breakfast">
        <OutBubble frame={f} text={S.breakfast.text} typeStart={B.typeStart} sendAt={B.send} cps={CPS} />
        <Draft frame={f} at={B.reply} lines={[head("09:00"), `Еда: ${OMELET.label} · ${OMELET.portion}`, kbju, "КБЖУ оценены примерно."]} confirmLines={[`Записал еду: ${OMELET.label} · ${OMELET.portion}`, kbju]} tapAt={B.tap} confirmAt={B.confirm} kbDelay={0.15} />
      </StepChat>

      {/* 13:30 — доход */}
      <StepChat f={f} k="salary">
        <OutBubble frame={f} text={S.salary.text} typeStart={Sa.typeStart} sendAt={Sa.send} cps={CPS} />
        <Draft frame={f} at={Sa.reply} lines={[head("13:30"), "Доход: Зарплата · 75 000,00 руб.", "Категория: Зарплата"]} confirmLines={["Записал доход: Зарплата · 75 000,00 руб."]} tapAt={Sa.tap} confirmAt={Sa.confirm} kbDelay={0.15} />
      </StepChat>

      {/* 16:00 — план покупки, без кнопок, баланс не меняется */}
      <StepChat f={f} k="plan">
        <OutBubble frame={f} text={S.plan.text} typeStart={P.typeStart} sendAt={P.send} cps={CPS} />
        <BotText f={f} at={P.reply} lines={["Запланировал «кроссовки» — 9 000,00 руб.", "Это пока не расход."]} />
      </StepChat>

      {/* 22:00 — справочный вопрос: ответ без кнопок, ничего не записывается */}
      <StepChat f={f} k="question">
        <OutBubble frame={f} text={S.question.text} typeStart={Q.typeStart} sendAt={Q.send} cps={CPS} />
        <BotText f={f} at={Q.reply} lines={["Сегодня записано расходов на 1 925,00 руб."]} />
      </StepChat>

      {f >= sec(S.weight.start) && (
        <AppWindow
          f={f} w={960} h={winH}
          style={{ left: 60, top: winTop, opacity: Math.min(1, winIn * 1.5) * winOut, transform: `translateY(${(1 - winIn) * 60}px)` }}
          segments={[
            {
              t: 0,
              render: (ff) => <div style={{ paddingTop: 8, fontFamily: FONT_SANS, color: C.text }}><WeightCard history={WEIGHT_HISTORY} newP={sp(ff, W.reply + 0.15, "gentle")} /></div>,
              cam: [{ t: 0, x: 0, y: 0, z: 0.86 }],
            },
            {
              t: S.breakfast.start,
              render: (ff) => <TodayScreen f={ff} at={S.breakfast.start - 0.14} m={mixM(zero, breakfast, sp(ff, B.confirm + 0.1))} grow={1} balance={BALANCE.morning} spent={0} />,
              cam: [{ t: 0, x: 0, y: 150, z: 0.95 }],
            },
            {
              t: S.salary.start,
              render: (ff) => <FinanceOverview f={ff} at={S.salary.start - 0.14} balance={springNum(ff, Sa.confirm + 0.1, BALANCE.morning, BALANCE.morning + BALANCE.salary)} spent={SPENT.day} month={62250} />,
              cam: [{ t: 0, x: 0, y: 236, z: 1.0 }],
            },
            {
              t: S.plan.start,
              render: (ff) => <FinancePlans f={ff} at={S.plan.start - 0.14} insertP={sp(ff, P.reply + 0.15, "smooth")} firstName="кроссовки" />,
              cam: [{ t: 0, x: 0, y: 250, z: 1.0 }],
            },
            {
              t: S.gym.start,
              render: (ff) => <GymExercise f={ff} at={S.gym.start - 0.14} doneAt={S.gym.start + 1.4} timerStart={S.gym.start + 1.55} hintAt={S.gym.start + 0.6} />,
              cam: [{ t: 0, x: 0, y: 128, z: 1.06 }, { t: S.gym.start + 1.8, x: 0, y: 250, z: 1.06, dur: 0.7 }],
            },
            {
              t: S.question.start,
              render: (ff) => <TodayScreen f={ff} at={S.question.start - 0.14} m={evening} grow={1} balance={BALANCE.evening} spent={SPENT.evening} />,
              cam: [{ t: 0, x: 0, y: 440, z: 1.0 }],
            },
          ]}
        />
      )}

      {/* Финал */}
      {f >= sec(fin.start - 0.1) && (
        <div style={{ position: "absolute", inset: 0, fontFamily: FONT_SANS, color: C.text, textAlign: "center" }}>
          <div style={{ position: "absolute", top: 420, left: 0, right: 0, fontSize: 80, fontWeight: 560, letterSpacing: "-0.03em", ...appear(f, fin.start, 14, 0.4) }}>{fin.title}</div>
          <div style={{ position: "absolute", top: 560, left: 0, right: 0, fontSize: 120, fontWeight: 580, letterSpacing: "-0.035em", color: C.accent, ...appear(f, fin.start + 0.25, 18, 0.45) }}>{fin.release}</div>
          <div style={{ position: "absolute", top: 860, left: 0, right: 0, fontSize: 64, fontWeight: 520, letterSpacing: "-0.02em", ...appear(f, fin.start + 0.7, 14, 0.4) }}>{fin.ask}</div>
          <div style={{ position: "absolute", top: 990, left: 40, right: 40, display: "flex", justifyContent: "center", ...appear(f, fin.start + 0.95, 18, 0.4) }}>
            <div style={{ background: C.accent, color: "#fff", borderRadius: 999, padding: "34px 60px", fontSize: 50, fontWeight: 560, whiteSpace: "nowrap", boxShadow: "0 18px 44px rgba(116,43,69,.30)" }}>{fin.contact}</div>
          </div>
        </div>
      )}

      {day.audio.enabled && <Audio src={staticFile(day.audio.file)} volume={day.audio.volume} />}
    </AbsoluteFill>
  );
};
