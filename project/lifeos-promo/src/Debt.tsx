// Ролик 8: «Одолжил другу». Фраза → черновик долга → «Записать» → возврат частью → остаток → раздел «Долги».
// Тексты: formatDraft() (handlers/drafts.ts), подтверждения в handlers/callbacks.ts; разбор — domain/debt-message.ts.
// Срок возврата в чате не задаётся (только в Mini App), поэтому напоминание о сроке в ролике не показано.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { sec, tw, typingDuration } from "./anim";
import { debt } from "./config";
import { Background, Caption, FontFaces } from "./ui";
import { CHAT_W, CHAT_X, Draft, OutBubble } from "./chat";
import { AppWindow, FinanceDebts } from "./app";
import { FinalCard, Hook, linkLayout, windowIn } from "./parts";

const CPS = 26;
const NB = "\u00a0";
const m = (v: string) => `${v} руб.`.replace(" ", NB);

/** Опорные моменты ролика (секунды). Те же формулы повторяет scripts/make-audio.mjs. */
export function debtTimes() {
  const typeA = 2.3;
  const sendA = typeA + typingDuration(debt.texts.owed, CPS) + 0.1;
  const draftA = sendA + 0.35;
  const tapA = draftA + 1.4;
  const swapA = tapA + 0.22;
  const typeB = swapA + 1.0;
  const sendB = typeB + typingDuration(debt.texts.back, CPS) + 0.1;
  const draftB = sendB + 0.35;
  const tapB = draftB + 1.4;
  const swapB = tapB + 0.22;
  const link = swapB + 0.9;
  const final = link + 3.4;
  return { typeA, sendA, draftA, tapA, swapA, typeB, sendB, draftB, tapB, swapB, link, final, end: final + 3.6 };
}
export const DEBT_SECONDS = debtTimes().end;

export const Debt: React.FC = () => {
  const f = useCurrentFrame();
  const T = debtTimes();
  const cap = debt.captions;
  const out = 1 - tw(f, T.final - 0.1, T.final + 0.25);
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={debt.badge} line1={debt.hook.line1} line2={debt.hook.line2} until={2.0} />

      <Caption text={cap.owed} at={2.4} until={T.tapA - 0.1} top={240} size={52} />
      <Caption text={cap.saved} at={T.tapA + 0.05} until={T.typeB + 0.4} top={240} size={52} />
      <Caption text={cap.back} at={T.typeB + 0.45} until={T.tapB - 0.1} top={240} size={52} />
      <Caption text={cap.rest} at={T.tapB + 0.05} until={T.link - 0.1} top={240} size={52} />
      <Caption text={cap.link} at={T.link + 0.25} until={T.final - 0.1} top={240} size={52} />

      <div style={{ position: "absolute", left: CHAT_X, top: 440, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, opacity: out, ...linkLayout(f, T.link, 440, 480, 0.62) }}>
        <OutBubble frame={f} text={debt.texts.owed} typeStart={T.typeA} sendAt={T.sendA} cps={CPS} />
        <Draft
          frame={f} at={T.draftA} kbDelay={0.2}
          lines={[
            "Проверь, пожалуйста · 16 нояб. 2026 г., 13:42",
            `Долг: Али должен тебе · ${m("3 000,00")}`,
            "Создам финансовую операцию на выбранном",
            "счёте в основной валюте.",
          ]}
          confirmLines={["Записал новый долг и финансовую операцию:", `Ты одолжил Али · ${m("3 000,00")}`]}
          tapAt={T.tapA} confirmAt={T.swapA}
        />
        <OutBubble frame={f} text={debt.texts.back} typeStart={T.typeB} sendAt={T.sendB} cps={CPS} />
        <Draft
          frame={f} at={T.draftB} kbDelay={0.2}
          lines={[
            "Проверь, пожалуйста · 23 нояб. 2026 г., 19:10",
            `Возврат от Али: ${m("1 000,00")}`,
            `Остаток после возврата: ${m("2 000,00")}`,
          ]}
          confirmLines={[`Записал: Али вернул тебе · ${m("1 000,00")}`, `Остаток долга: ${m("2 000,00")}`]}
          tapAt={T.tapB} confirmAt={T.swapB}
        />
      </div>

      {f >= sec(T.link) && (
        <AppWindow
          f={f} w={960} h={860}
          style={{ left: 60, top: 400, ...windowIn(f, T.link + 0.1), opacity: windowIn(f, T.link + 0.1).opacity * out }}
          dock={[{ t: 0, tab: "finance" }]}
          segments={[{
            t: 0,
            render: (ff) => <FinanceDebts f={ff} at={T.link - 0.1} groups={[["Я должен", "Мои долги другим людям", []], ["Мне должны", "Деньги, которые должны вернуть мне", [["Али", 2000, `Вернул 1${NB}000 из 3${NB}000`]]]]} />,
            cam: [{ t: 0, x: 0, y: 215, z: 1.06 }],
          }]}
        />
      )}

      <FinalCard f={f} start={T.final} {...debt.final} />
      {debt.audio.enabled && <Audio src={staticFile(debt.audio.file)} volume={debt.audio.volume} />}
    </AbsoluteFill>
  );
};
