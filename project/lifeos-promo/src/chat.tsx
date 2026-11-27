import React from "react";
import { C, FONT_MONO, FONT_SANS } from "./tokens";
import { appear, lerp, press, sec, sp, tw, typedCount } from "./anim";
import { Glass, TapRing } from "./ui";

export const CHAT_X = 60;
export const CHAT_W = 960;
const FS = 36;
const LH = 1.34;

const textStyle: React.CSSProperties = { fontFamily: FONT_SANS, fontSize: FS, lineHeight: LH, fontWeight: 440, letterSpacing: "-0.005em" };

/** Исходящий пузырь (бордовый, белый текст). Набор посимвольно с кареткой. */
export const OutBubble: React.FC<{ frame: number; text: string; typeStart: number; sendAt: number; cps?: number }> = ({ frame, text, typeStart, sendAt, cps = 11 }) => {
  const n = typedCount(frame, typeStart, text, cps);
  if (frame < sec(typeStart - 0.15)) return <div style={{ height: 0 }} />;
  const a = appear(frame, typeStart - 0.15, 10, 0.2);
  const sending = frame < sec(sendAt);
  const caretOn = sending && (n < text.length || Math.floor(frame / 15) % 2 === 0);
  const pop = sp(frame, sendAt, "bouncy");
  const scale = frame >= sec(sendAt) ? 1 + 0.035 * Math.sin(pop * Math.PI) : 1;
  const shown = text.slice(0, n);
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", ...a }}>
      <div style={{ ...textStyle, maxWidth: 840, color: "#fff", background: C.accent, padding: "24px 38px", borderRadius: "46px 46px 12px 46px", transform: `scale(${scale})`, transformOrigin: "100% 100%", boxShadow: "0 14px 34px rgba(116,43,69,.28)", minWidth: 90 }}>
        <span style={{ visibility: "hidden", position: "absolute" }}>{text}</span>
        {shown}
        <span style={{ display: "inline-block", width: 3, height: FS * 1.05, marginLeft: 3, verticalAlign: "-6px", background: caretOn ? "rgba(255,255,255,.95)" : "transparent" }} />
      </div>
    </div>
  );
};

/** Входящий стеклянный пузырь. */
export const InBubble: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <Glass radius={46} style={{ borderBottomLeftRadius: 12, padding: "24px 38px", maxWidth: 940, ...textStyle, color: C.text, ...style }}>{children}</Glass>
);

export const Lines: React.FC<{ lines: string[]; dimFirst?: boolean }> = ({ lines, dimFirst }) => (
  <>
    {lines.map((l, i) => (
      <div key={i} style={{ color: dimFirst && i === 0 ? C.text2 : C.text }}>{l}</div>
    ))}
  </>
);

const BTN_H = 76;
const BTN_GAP = 12;
export const keyboardHeight = (rows: number) => rows * BTN_H + (rows - 1) * BTN_GAP;

type Btn = { label: string; primary?: boolean };

/** Inline-кнопки: стеклянные капсулы, «Записать» сплошным бордовым. */
export const Keyboard: React.FC<{ frame: number; rows: Btn[][]; at: number; tap?: { label: string; at: number }; collapseAt?: number }> = ({ frame, rows, at, tap, collapseAt }) => {
  const a = appear(frame, at, 10, 0.3);
  const col = collapseAt === undefined ? 0 : tw(frame, collapseAt, collapseAt + 0.38, [0.77, 0, 0.175, 1]);
  const full = keyboardHeight(rows.length);
  const h = (1 - col) * (full + 14);
  const pr = tap ? press(frame, tap.at) : { scale: 1, ring: -1 };
  return (
    <div style={{ height: h, overflow: "hidden", opacity: a.opacity * (1 - col), transform: a.transform }}>
      <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: BTN_GAP }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: BTN_GAP }}>
            {row.map((b) => {
              const isTap = tap?.label === b.label;
              const base: React.CSSProperties = { flex: 1, height: BTN_H, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_SANS, fontWeight: 540, fontSize: 36, transform: isTap ? `scale(${pr.scale})` : undefined, position: "relative" };
              const hl = isTap && pr.ring >= 0 ? 1 - pr.ring : 0;
              return b.primary ? (
                <div key={b.label} style={{ ...base, background: C.accent, color: "#fff", boxShadow: `0 10px 26px rgba(116,43,69,.30), 0 0 0 ${8 + hl * 12}px rgba(116,43,69,${hl * 0.16})` }}>{b.label}</div>
              ) : (
                <Glass key={b.label} radius={999} style={{ ...base, color: C.text }}>{b.label}</Glass>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Черновик бота: текстовый пузырь + клавиатура. После `confirmAt` текст сменяется подтверждением
 * (как в боте, где сообщение редактируется), клавиатура схлопывается.
 */
export const Draft: React.FC<{
  frame: number;
  at: number;
  lines: string[];
  confirmLines?: string[];
  confirmAt?: number;
  tapAt?: number;
  rows?: Btn[][];
  kbDelay?: number;
  tapLabel?: string;
}> = ({ frame, at, lines, confirmLines, confirmAt, tapAt, rows = [[{ label: "Записать", primary: true }, { label: "Исправить" }], [{ label: "Отменить" }]], kbDelay = 0.25, tapLabel = "Записать" }) => {
  if (frame < sec(at)) return <div style={{ height: 0 }} />;
  const a = appear(frame, at, 14, 0.32);
  const sw = confirmAt === undefined ? 0 : tw(frame, confirmAt, confirmAt + 0.22);
  // Сообщение редактируется: высота плавно переходит к числу строк подтверждения (строки однострочные).
  const lineH = FS * LH;
  const h = confirmLines ? lineH * (lines.length + (confirmLines.length - lines.length) * tw(frame, confirmAt ?? 0, (confirmAt ?? 0) + 0.38, [0.77, 0, 0.175, 1])) : undefined;
  return (
    <div style={{ ...a, alignSelf: "flex-start", width: "fit-content", maxWidth: 940 }}>
      <div style={{ display: "flex" }}>
        <InBubble style={{ width: "100%" }}>
          <div style={{ display: "grid", height: h, overflow: "hidden" }}>
            <div style={{ gridArea: "1 / 1", opacity: 1 - sw }}><Lines lines={lines} dimFirst /></div>
            {confirmLines && <div style={{ gridArea: "1 / 1", opacity: sw, transform: `translateY(${(1 - sw) * 8}px)` }}><Lines lines={confirmLines} /></div>}
          </div>
        </InBubble>
      </div>
      <Keyboard frame={frame} rows={rows} at={at + kbDelay} tap={tapAt === undefined ? undefined : { label: tapLabel, at: tapAt }} collapseAt={confirmAt} />
    </div>
  );
};

/** Положение центра кнопки «Записать» не нужно: кольцо рисуется на самой кнопке через glow. */
export const StatusBubble: React.FC<{ frame: number; items: { at: number; text: string }[] }> = ({ frame, items }) => {
  const cur = [...items].reverse().find((i) => frame >= sec(i.at));
  if (!cur) return <div style={{ height: 0 }} />;
  const a = appear(frame, items[0].at, 10, 0.25);
  return (
    <div style={a}>
      <InBubble style={{ color: C.text2 }}>{cur.text}</InBubble>
    </div>
  );
};

/** Стилизованный чек без реальных брендов. */
export const Receipt: React.FC<{ rows: [string, string][]; total: string; height?: number }> = ({ rows, total, height }) => (
  <div style={{ width: 400, height, background: "#fbf8f2", borderRadius: 14, padding: "26px 28px", fontFamily: FONT_MONO, fontSize: 26, color: "#3d3236", boxShadow: "0 16px 38px rgba(53,39,44,.22)", transform: "rotate(-2.2deg)" }}>
    <div style={{ textAlign: "center", fontFamily: FONT_SANS, fontSize: 28, fontWeight: 560, marginBottom: 10 }}>Продуктовый магазин</div>
    <div style={{ borderTop: "2px dashed rgba(53,39,44,.35)", margin: "6px 0 12px" }} />
    {rows.map(([n, v]) => (
      <div key={n} style={{ display: "flex", justifyContent: "space-between", lineHeight: 1.5 }}><span>{n}</span><span>{v}</span></div>
    ))}
    <div style={{ borderTop: "2px dashed rgba(53,39,44,.35)", margin: "12px 0 8px" }} />
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Итого</span><span>{total}</span></div>
  </div>
);

export { lerp, TapRing };
