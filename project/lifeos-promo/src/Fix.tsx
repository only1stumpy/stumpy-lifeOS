// Ролик 3: «Исправить». Бот понял не так → «Исправить» → правка словами → новый черновик → «Записать» → дневник.
// Тексты: formatDraft() (drafts.ts), formatConfirmedRecords() (confirmation.ts),
// подсказка по «Исправить» — handlers/callbacks.ts (action === "edit"): сообщение черновика заменяется ею.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { sec, sp, tw, typingDuration } from "./anim";
import { fix, FOOD, type FoodEntry } from "./config";
import { Background, Caption, FontFaces } from "./ui";
import { CHAT_W, CHAT_X, Draft, OutBubble } from "./chat";
import { AppWindow, NutritionScreen, type Macros } from "./app";
import { FinalCard, Hook, linkLayout, windowIn } from "./parts";

const CPS = 26;
const sum = (list: FoodEntry[]): Macros => list.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, f: a.f + e.f, c: a.c + e.c }), { kcal: 0, p: 0, f: 0, c: 0 });
const BASE = [FOOD.curd, FOOD.yogurt, FOOD.omelet];
const FIXED: FoodEntry = { time: "13:42", label: "Гречка с курицей", portion: "2 тарелки", kcal: 580, p: 38, f: 8, c: 88, est: true };
const M0 = sum(BASE);
const M1 = sum([...BASE, FIXED]);
const mix = (a: Macros, b: Macros, p: number): Macros => ({ kcal: a.kcal + (b.kcal - a.kcal) * p, p: a.p + (b.p - a.p) * p, f: a.f + (b.f - a.f) * p, c: a.c + (b.c - a.c) * p });

/** Опорные моменты ролика (секунды). Те же формулы повторяет scripts/make-audio.mjs. */
export function fixTimes() {
  const typeA = 2.3;
  const sendA = typeA + typingDuration(fix.texts.first, CPS) + 0.1;
  const draftA = sendA + 0.35;
  const tapEdit = draftA + 1.4;
  const editSwap = tapEdit + 0.22;
  const typeB = editSwap + 0.9;
  const sendB = typeB + typingDuration(fix.texts.fix, CPS) + 0.1;
  const draftB = sendB + 0.35;
  const tapRec = draftB + 1.4;
  const recSwap = tapRec + 0.22;
  const link = recSwap + 0.9;
  const insert = link + 0.75;
  const camMove = insert + 1.0;
  const final = camMove + 2.6;
  return { typeA, sendA, draftA, tapEdit, editSwap, typeB, sendB, draftB, tapRec, recSwap, link, insert, camMove, final, end: final + 3.6 };
}
export const FIX_SECONDS = fixTimes().end;

const head = (time: string) => `Проверь, пожалуйста · 16 нояб. 2026 г., ${time}`;
const kbju = (e: { kcal: number; p: number; f: number; c: number }) => `КБЖУ: ${e.kcal} ккал · Б ${e.p} · Ж ${e.f} · У ${e.c} г`;

export const Fix: React.FC = () => {
  const f = useCurrentFrame();
  const T = fixTimes();
  const cap = fix.captions;
  const first = { time: "13:42", kcal: 420, p: 38, f: 8, c: 48 };
  const out = 1 - tw(f, T.final - 0.1, T.final + 0.25);
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={fix.badge} line1={fix.hook.line1} line2={fix.hook.line2} until={2.0} />

      <Caption text={cap.wrong} at={2.4} until={T.tapEdit - 0.1} top={240} size={52} />
      <Caption text={cap.edit} at={T.tapEdit + 0.05} until={T.draftB - 0.2} top={240} size={52} />
      <Caption text={cap.confirm} at={T.draftB + 0.15} until={T.link - 0.1} top={240} size={52} />
      <Caption text={cap.link} at={T.link + 0.25} until={T.final - 0.1} top={240} size={52} />

      <div style={{ position: "absolute", left: CHAT_X, top: 440, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, opacity: out, ...linkLayout(f, T.link, 440, 400, 0.62) }}>
        <OutBubble frame={f} text={fix.texts.first} typeStart={T.typeA} sendAt={T.sendA} cps={CPS} />
        <Draft
          frame={f} at={T.draftA} kbDelay={0.2}
          lines={[head("13:42"), "Еда: Гречка с курицей · 1 порция", kbju(first), "КБЖУ оценены примерно."]}
          confirmLines={["Напиши следующим сообщением, что поправить —", "например, «гречки две тарелки, мяса вдвое", "меньше». Если передумал, отправь /cancel."]}
          tapAt={T.tapEdit} tapLabel="Исправить" confirmAt={T.editSwap}
        />
        <OutBubble frame={f} text={fix.texts.fix} typeStart={T.typeB} sendAt={T.sendB} cps={CPS} />
        <Draft
          frame={f} at={T.draftB} kbDelay={0.2}
          lines={[head("13:42"), "Еда: Гречка с курицей · 2 тарелки", kbju(FIXED), "КБЖУ оценены примерно."]}
          confirmLines={["Записал еду: Гречка с курицей · 2 тарелки", kbju(FIXED)]}
          tapAt={T.tapRec} confirmAt={T.recSwap}
        />
      </div>

      {f >= sec(T.link) && (
        <AppWindow
          f={f} w={960} h={780}
          style={{ left: 60, top: 400, ...windowIn(f, T.link + 0.1), opacity: windowIn(f, T.link + 0.1).opacity * out }}
          segments={[{
            t: 0,
            render: (ff) => <NutritionScreen f={ff} at={-5} m={mix(M0, M1, sp(ff, T.insert))} grow={1} entries={BASE} newEntry={FIXED} insertP={sp(ff, T.insert, "smooth")} />,
            cam: [{ t: 0, x: 0, y: 214, z: 1.08 }, { t: T.camMove, x: 0, y: 590, z: 1.08, dur: 1.1 }],
          }]}
        />
      )}

      <FinalCard f={f} start={T.final} {...fix.final} />
      {fix.audio.enabled && <Audio src={staticFile(fix.audio.file)} volume={fix.audio.volume} />}
    </AbsoluteFill>
  );
};
