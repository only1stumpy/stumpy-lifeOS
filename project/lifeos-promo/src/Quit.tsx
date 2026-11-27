// Ролик 5: «Я бросал вести учёт». Обычный трекер (10 полей) → LifeOS: одно сообщение → «Записать».
// Форма трекера нарочно нейтральная и безымянная: это обобщённый «обычный трекер», не чужое приложение.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { sec, tw, typedCount, typingDuration, appear } from "./anim";
import { quit } from "./config";
import { Background, Caption, FontFaces } from "./ui";
import { CHAT_W, CHAT_X, Draft, OutBubble } from "./chat";
import { FinalCard, Hook } from "./parts";
import { FONT_SANS } from "./tokens";

const CPS = 26;
const FORM = { start: 2.5, first: 2.9, step: 0.42, fadeAt: 8.0 };
export const fieldAt = (i: number) => FORM.first + i * FORM.step;
const SEARCH_I = 3;

export function quitTimes() {
  const typeA = 9.2;
  const sendA = typeA + typingDuration(quit.text, CPS) + 0.1;
  const draftA = sendA + 0.35;
  const tapRec = draftA + 1.4;
  const recSwap = tapRec + 0.22;
  const final = recSwap + 2.4;
  return { typeA, sendA, draftA, tapRec, recSwap, final, end: final + 3.6 };
}
export const QUIT_SECONDS = quitTimes().end;

const ink = "#2b2b30", ink2 = "#8a8a92", line = "#dcdce0";
const fields: { label: string; value: string }[] = [
  { label: "Дата", value: "16 нояб. 2026" },
  { label: "Время", value: "13:42" },
  { label: "Приём пищи", value: "" },
  { label: "Поиск продукта", value: "" },
  { label: "Продукт", value: "Гречка варёная" },
  { label: "Вес, г", value: "250" },
  { label: "Ккал", value: "310" },
  { label: "Белки, г", value: "11" },
  { label: "Жиры, г", value: "3" },
  { label: "Углеводы, г", value: "62" },
];
const meals = ["Завтрак", "Обед", "Ужин", "Перекус"];
const found = ["Гречка варёная, 100 г", "Гречка ядрица, сухая", "Гречка жареная"];
const ROW = 84;

const Form: React.FC<{ f: number }> = ({ f }) => {
  const filled = fields.filter((_, i) => f >= sec(fieldAt(i) + 0.2)).length;
  const search = "гречка";
  const typed = typedCount(f, fieldAt(SEARCH_I), search, 14);
  const dd = tw(f, fieldAt(SEARCH_I) + 0.55, fieldAt(SEARCH_I) + 0.75) * (1 - tw(f, fieldAt(SEARCH_I + 1) - 0.05, fieldAt(SEARCH_I + 1) + 0.1));
  const out = 1 - tw(f, FORM.fadeAt, FORM.fadeAt + 0.5);
  const a = appear(f, FORM.start, 24, 0.45);
  return (
    <div style={{ position: "absolute", left: 60, top: 420, width: 960, opacity: a.opacity * out, transform: `${a.transform} scale(${1 - (1 - out) * 0.04})`, fontFamily: FONT_SANS, background: "#fff", borderRadius: 24, boxShadow: "0 12px 40px rgba(0,0,0,.12)", color: ink, padding: "26px 36px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", height: 60 }}>
        <div style={{ fontSize: 40, fontWeight: 600 }}>Новая запись</div>
        <div style={{ fontSize: 30, color: ink2 }}>Заполнено {filled} из 10</div>
      </div>
      {fields.map((fd, i) => {
        const on = f >= sec(fieldAt(i));
        const val = f >= sec(fieldAt(i) + 0.2);
        const active = on && !val ? 1 : 0;
        return (
          <div key={fd.label} style={{ height: ROW, borderBottom: `1.5px solid ${line}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 34 }}>
            <div style={{ color: ink2, width: 300 }}>{fd.label}</div>
            <div style={{ flex: 1, textAlign: "right", color: ink, fontWeight: 520 }}>
              {i === 2 ? (
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  {meals.map((m) => {
                    const sel = m === "Обед" && val;
                    return <span key={m} style={{ fontSize: 28, padding: "8px 18px", borderRadius: 999, border: `1.5px solid ${sel ? ink : line}`, background: sel ? ink : "transparent", color: sel ? "#fff" : ink2 }}>{m}</span>;
                  })}
                </div>
              ) : i === SEARCH_I ? (
                <span style={{ color: on ? ink : ink2, fontWeight: on ? 520 : 400 }}>{on ? search.slice(0, typed) + (active ? "|" : "") : "Найти…"}</span>
              ) : (
                <span style={{ opacity: val ? 1 : 0 }}>{fd.value}</span>
              )}
            </div>
          </div>
        );
      })}
      {dd > 0.01 && (
        <div style={{ position: "absolute", left: 36 + 300, right: 36, top: 26 + 60 + ROW * (SEARCH_I + 1) + 6, background: "#fff", borderRadius: 16, boxShadow: "0 10px 30px rgba(0,0,0,.18)", border: `1.5px solid ${line}`, opacity: dd, transform: `translateY(${(1 - dd) * 8}px)`, overflow: "hidden" }}>
          {found.map((x, i) => (
            <div key={x} style={{ padding: "18px 24px", fontSize: 30, borderBottom: i < found.length - 1 ? `1.5px solid ${line}` : "none", color: i === 0 ? ink : ink2 }}>{x}</div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <div style={{ flex: 1, textAlign: "center", padding: "20px 0", borderRadius: 16, border: `1.5px solid ${ink2}`, color: ink2, fontSize: 32 }}>+ Добавить продукт</div>
        <div style={{ flex: 1, textAlign: "center", padding: "20px 0", borderRadius: 16, background: filled >= 10 ? ink : "#c9c9ce", color: "#fff", fontSize: 32, fontWeight: 560 }}>Сохранить</div>
      </div>
    </div>
  );
};

export const Quit: React.FC = () => {
  const f = useCurrentFrame();
  const T = quitTimes();
  const cap = quit.captions;
  const out = 1 - tw(f, T.final - 0.1, T.final + 0.25);
  const kbju = "КБЖУ: 420 ккал · Б 38 · Ж 8 · У 48 г";
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      <Hook f={f} badge={quit.badge} line1={quit.hook.line1} line2={quit.hook.line2} until={2.0} />

      <Caption text={cap.form} at={2.4} until={7.4} top={240} size={52} />
      <Caption text={cap.quit} at={7.5} until={8.9} top={240} size={52} />
      <Caption text={cap.chat} at={9.0} until={T.draftA + 0.1} top={240} size={52} />
      <Caption text={cap.done} at={T.draftA + 0.25} until={T.final - 0.1} top={240} size={52} />

      {f < sec(FORM.fadeAt + 0.6) && <Form f={f} />}

      {f >= sec(T.typeA - 0.2) && (
        <div style={{ position: "absolute", left: CHAT_X, top: 440, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, opacity: out }}>
          <OutBubble frame={f} text={quit.text} typeStart={T.typeA} sendAt={T.sendA} cps={CPS} />
          <Draft
            frame={f} at={T.draftA} kbDelay={0.2}
            lines={["Проверь, пожалуйста · 16 нояб. 2026 г., 13:42", "Еда: Гречка с курицей · 1 порция", kbju, "КБЖУ оценены примерно."]}
            confirmLines={["Записал еду: Гречка с курицей · 1 порция", kbju]}
            tapAt={T.tapRec} confirmAt={T.recSwap}
          />
        </div>
      )}

      <FinalCard f={f} start={T.final} {...quit.final} />
      {quit.audio.enabled && <Audio src={staticFile(quit.audio.file)} volume={quit.audio.volume} />}
    </AbsoluteFill>
  );
};
