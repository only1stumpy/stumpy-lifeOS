// Ролик 4: «Куда ушли деньги». Вопрос боту → ответ (только чтение, ничего не записывается) → обзор финансов.
// Ответ: reference.ts → «За этот месяц записано расходов на <сумма>.»
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { appear, sec, sp, tw, typingDuration } from "./anim";
import { FIN, money } from "./config";
import { Background, Caption, FontFaces } from "./ui";
import { CHAT_W, CHAT_X, InBubble, Lines, OutBubble } from "./chat";
import { AppWindow, FinanceDebts, FinanceOperations, FinanceOverview, FinancePlans } from "./app";
import { FinalCard, Hook } from "./parts";

const CPS = 26;
const t = money.t;
export const MONEY_SECONDS = t.end;
export function moneyTimes() {
  const send = t.type + typingDuration(money.question, CPS) + 0.1;
  return { send, reply: send + 0.35 };
}

export const Money: React.FC = () => {
  const f = useCurrentFrame();
  const { send, reply } = moneyTimes();
  const cap = money.captions;
  const chatOut = 1 - tw(f, t.window - 0.1, t.window + 0.3);
  const win = sp(f, t.window, "gentle");
  const winOut = 1 - tw(f, t.final - 0.1, t.final + 0.25);
  const botIn = f >= sec(reply) ? appear(f, reply, 14, 0.3) : null;
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={money.badge} line1={money.hook.line1} line2={money.hook.line2} until={2.0} />

      <Caption text={cap.ask} at={2.4} until={t.window - 0.1} top={240} size={52} />
      <Caption text={cap.overview} at={t.window + 0.2} until={t.ops - 0.1} top={240} size={52} />
      <Caption text={cap.ops} at={t.ops + 0.1} until={t.plans - 0.1} top={240} size={52} />
      <Caption text={cap.plans} at={t.plans + 0.1} until={t.debts - 0.1} top={240} size={52} />
      <Caption text={cap.debts} at={t.debts + 0.1} until={t.final - 0.1} top={240} size={52} />

      {chatOut > 0.001 && (
        <div style={{ position: "absolute", left: CHAT_X, top: 440, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, opacity: chatOut }}>
          <OutBubble frame={f} text={money.question} typeStart={t.type} sendAt={send} cps={CPS} />
          {botIn && (
            <div style={{ display: "flex", ...botIn }}>
              <InBubble><Lines lines={["За этот месяц записано расходов", "на 62 250,00 руб."]} /></InBubble>
            </div>
          )}
        </div>
      )}

      {f >= sec(t.window) && (
        <AppWindow
          f={f} w={960} h={1130}
          style={{ left: 60, top: 440, opacity: Math.min(1, win * 1.5) * winOut, transform: `translateY(${(1 - win) * 90}px)` }}
          dock={[{ t: 0, tab: "finance" }]}
          segments={[
            {
              t: 0,
              render: (ff) => <FinanceOverview f={ff} at={t.window - 0.1} balance={FIN.balanceAfter} spent={FIN.todayAfter} month={FIN.month} />,
              cam: [{ t: t.window, x: 0, y: 128, z: 1.0 }, { t: t.window + 1.8, x: 0, y: 290, z: 1.0, dur: 0.8 }, { t: t.window + 3.3, x: 0, y: 540, z: 1.0, dur: 0.9 }],
            },
            { t: t.ops, render: (ff) => <FinanceOperations f={ff} at={t.ops - 0.14} balance={FIN.balanceAfter} newRow tapAt={t.ops} />, cam: [{ t: t.ops, x: 0, y: 128, z: 1.0 }, { t: t.ops + 1.0, x: 0, y: 330, z: 1.0, dur: 0.8 }] },
            { t: t.plans, render: (ff) => <FinancePlans f={ff} at={t.plans - 0.14} tapAt={t.plans} />, cam: [{ t: t.plans, x: 0, y: 128, z: 1.06 }] },
            { t: t.debts, render: (ff) => <FinanceDebts f={ff} at={t.debts - 0.14} tapAt={t.debts} />, cam: [{ t: t.debts, x: 0, y: 128, z: 1.06 }] },
          ]}
        />
      )}

      <FinalCard f={f} start={t.final} {...money.final} />
      {money.audio.enabled && <Audio src={staticFile(money.audio.file)} volume={money.audio.volume} />}
    </AbsoluteFill>
  );
};
