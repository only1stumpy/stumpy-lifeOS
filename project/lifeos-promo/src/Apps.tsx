// Ролик 7: три отдельных приложения (еда, траты, зал) против одного чата в Телеграме.
// Карточки «обычных» приложений нейтральные и безымянные, это не чужие бренды.
// Тексты бота: formatDraft() (drafts.ts), formatConfirmedRecords() (confirmation.ts).
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { appear, sec, sp, springNum, tw, typingDuration } from "./anim";
import { apps, FOOD, FIN, MONEY } from "./config";
import { Background, Caption, FontFaces } from "./ui";
import { CHAT_W, CHAT_X, Draft, OutBubble } from "./chat";
import { AppWindow, FinanceOverview, GymExercise } from "./app";
import { FinalCard, Hook, linkLayout, windowIn } from "./parts";
import { C, FONT_SANS } from "./tokens";

const CPS = 26;
export const CARD_T = [2.4, 4.6, 6.8];
export const cardField = (card: number, j: number) => CARD_T[card] + 0.3 + j * 0.35;
export const cardSaved = (card: number) => CARD_T[card] + 1.6;

export function appsTimes() {
  const oldEnd = 10.3;
  const typeA = oldEnd + 0.8;
  const sendA = typeA + typingDuration(apps.text, CPS) + 0.1;
  const draftF = sendA + 0.4;
  const draftM = sendA + 0.7;
  const tapF = draftM + 1.1;
  const tapM = tapF + 0.55;
  const link = tapM + 0.7;
  const done = link + 1.4;
  const timer = link + 1.55;
  const resFade = link + 3.6;
  const result = resFade + 0.5;
  const final = result + 3.2;
  return { oldEnd, typeA, sendA, draftF, draftM, tapF, tapM, link, done, timer, resFade, result, final, end: final + 3.6 };
}
export const APPS_SECONDS = appsTimes().end;

const ink = "#2b2b30", ink2 = "#8a8a92", line = "#dcdce0";
const CARDS = [
  { name: "Калории", tone: "#5f7f6a", rows: [["Продукт", "Удон"], ["Приём пищи", "Обед"], ["Ккал", "340"]] },
  { name: "Бюджет", tone: "#5d7390", rows: [["Сумма", "425"], ["Категория", "Кафе"], ["Счёт", "Наличные"]] },
  { name: "Тренировки", tone: "#9a7a55", rows: [["Упражнение", "Жим лёжа"], ["Подходы", "3"], ["Вес, кг", "60"]] },
] as const;

const OldApps: React.FC<{ f: number; out: number }> = ({ f, out }) => (
  <div style={{ opacity: out }}>
    {CARDS.map((cd, i) => {
      const on = tw(f, CARD_T[i] - 0.15, CARD_T[i] + 0.1) * (1 - tw(f, CARD_T[i] + 2.0, CARD_T[i] + 2.25));
      const saved = f >= sec(cardSaved(i));
      const a = appear(f, 2.1 + i * 0.12, 24, 0.45);
      return (
        <div key={cd.name} style={{ position: "absolute", left: 60, top: 350 + i * 400, width: 960, height: 370, background: "#fff", borderRadius: 28, boxShadow: `0 ${10 + on * 14}px ${30 + on * 20}px rgba(0,0,0,${0.1 + on * 0.06})`, fontFamily: FONT_SANS, color: ink, overflow: "hidden", opacity: a.opacity * (0.5 + 0.5 * Math.max(on, saved ? 1 : 0)), transform: `${a.transform} scale(${1 + on * 0.015})` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, height: 92, padding: "0 34px", borderBottom: `1.5px solid ${line}` }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: cd.tone }} />
            <div style={{ fontSize: 40, fontWeight: 600, flex: 1 }}>{cd.name}</div>
            <div style={{ fontSize: 28, color: saved ? cd.tone : ink2, fontWeight: saved ? 600 : 440 }}>{saved ? "Сохранено" : on > 0.5 ? "Заполняю…" : "Ждёт"}</div>
          </div>
          {cd.rows.map(([k, v], j) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 86, padding: "0 34px", borderBottom: j < 2 ? `1.5px solid ${line}` : "none", fontSize: 34 }}>
              <span style={{ color: ink2 }}>{k}</span>
              <span style={{ fontWeight: 520, opacity: f >= sec(cardField(i, j)) ? 1 : 0 }}>{v}</span>
            </div>
          ))}
        </div>
      );
    })}
  </div>
);

export const Apps: React.FC = () => {
  const f = useCurrentFrame();
  const T = appsTimes();
  const cap = apps.captions;
  const oldOut = 1 - tw(f, T.oldEnd - 0.4, T.oldEnd);
  const out = 1 - tw(f, T.resFade, T.resFade + 0.4);
  const fin = 1 - tw(f, T.final - 0.1, T.final + 0.25);
  const head = (time: string) => `Проверь, пожалуйста · 16 нояб. 2026 г., ${time}`;
  const kb = `КБЖУ: ${FOOD.udon.kcal} ккал · Б ${FOOD.udon.p} · Ж ${FOOD.udon.f} · У ${FOOD.udon.c} г`;
  const ra = (at: number) => appear(f, at, 20, 0.45);
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={apps.badge} line1={apps.hook.line1} line2={apps.hook.line2} until={2.0} />

      <Caption text={cap.food} at={CARD_T[0]} until={CARD_T[1] - 0.1} top={240} size={52} />
      <Caption text={cap.money} at={CARD_T[1]} until={CARD_T[2] - 0.1} top={240} size={52} />
      <Caption text={cap.gym} at={CARD_T[2]} until={9.0} top={240} size={52} />
      <Caption text={cap.three} at={9.1} until={T.oldEnd - 0.2} top={240} size={52} />
      <Caption text={cap.chat} at={T.oldEnd + 0.2} until={T.draftF} top={240} size={52} />
      <Caption text={cap.split} at={T.draftF + 0.15} until={T.link - 0.1} top={240} size={52} />
      <Caption text={cap.mini} at={T.link + 0.25} until={T.resFade - 0.1} top={240} size={52} />

      {f < sec(T.oldEnd + 0.1) && <OldApps f={f} out={oldOut} />}

      {f >= sec(T.oldEnd + 0.6) && (
        <div style={{ position: "absolute", left: CHAT_X, top: 400, width: CHAT_W, display: "flex", flexDirection: "column", gap: 22, opacity: out, ...linkLayout(f, T.link, 400, 600, 0.5) }}>
          <OutBubble frame={f} text={apps.text} typeStart={T.typeA} sendAt={T.sendA} cps={CPS} />
          <Draft frame={f} at={T.draftF} lines={[head("13:50"), "Еда: Удон · 1 порция", kb, "КБЖУ оценены примерно."]} confirmLines={["Записал еду: Удон · 1 порция", kb]} tapAt={T.tapF} confirmAt={T.tapF + 0.22} />
          <Draft frame={f} at={T.draftM} lines={[head("13:50"), "Расход: Удон · 425,00 руб.", "Категория: Кафе и рестораны"]} confirmLines={["Записал расход: Удон · 425,00 руб."]} tapAt={T.tapM} confirmAt={T.tapM + 0.22} />
        </div>
      )}

      {f >= sec(T.link) && (
        <AppWindow
          f={f} w={960} h={940}
          style={{ left: 60, top: 320, ...windowIn(f, T.link + 0.1), opacity: windowIn(f, T.link + 0.1).opacity * out }}
          dock={[{ t: 0, tab: "gym" }]}
          segments={[{ t: 0, render: (ff) => <GymExercise f={ff} at={T.link - 0.14} doneAt={T.done} timerStart={T.timer} hintAt={T.link + 0.6} />, cam: [{ t: 0, x: 0, y: 128, z: 1.0 }, { t: T.link + 1.8, x: 0, y: 245, z: 1.0, dur: 0.7 }] }]}
        />
      )}

      {f >= sec(T.result - 0.1) && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 440, textAlign: "center", fontFamily: FONT_SANS, color: C.text, opacity: fin }}>
          <div style={{ position: "relative", display: "inline-block", fontSize: 130, fontWeight: 560, letterSpacing: "-0.04em", color: C.text2, ...ra(T.result) }}>
            {apps.result.old}
            <div style={{ position: "absolute", left: -10, right: -10, top: "56%", height: 8, background: C.accent, borderRadius: 4, transformOrigin: "0 50%", transform: `scaleX(${tw(f, T.result + 0.5, T.result + 0.85)})` }} />
          </div>
          <div style={{ fontSize: 60, fontWeight: 480, margin: "26px 0 8px", ...ra(T.result + 0.9) }}>вместо этого</div>
          <div style={{ fontSize: 230, fontWeight: 600, letterSpacing: "-0.05em", color: C.accent, ...ra(T.result + 1.2) }}>{apps.result.now}</div>
          <div style={{ fontSize: 56, fontWeight: 520, marginTop: 60, padding: "0 60px", ...ra(T.result + 1.8) }}>{apps.result.note}</div>
        </div>
      )}

      <FinalCard f={f} start={T.final} {...apps.final} />
      {apps.audio.enabled && <Audio src={staticFile(apps.audio.file)} volume={apps.audio.volume} />}
    </AbsoluteFill>
  );
};
