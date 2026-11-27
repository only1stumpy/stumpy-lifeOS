// Общие куски коротких роликов: хук, финал, связка чат → приложение.
import React from "react";
import { C, FONT_SANS } from "./tokens";
import { appear, sec, sp, tw } from "./anim";
import { Glass } from "./ui";

export const Hook: React.FC<{ f: number; badge: string; line1: string; line2: string; until: number; top?: number }> = ({ f, badge, line1, line2, until, top = 560 }) => {
  const out = 1 - tw(f, until, until + 0.35);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, textAlign: "center", fontFamily: FONT_SANS, color: C.text, opacity: out }}>
      <div style={{ display: "flex", justifyContent: "center", ...appear(f, 0, 10, 0.35) }}>
        <Glass radius={999} strong style={{ padding: "16px 38px", fontSize: 42, fontWeight: 540, color: C.accent }}>{badge}</Glass>
      </div>
      <div style={{ ...appear(f, 0.15, 18, 0.45), fontSize: 124, fontWeight: 560, letterSpacing: "-0.035em", marginTop: 60 }}>{line1}</div>
      <div style={{ ...appear(f, 0.55, 18, 0.45), fontSize: 124, fontWeight: 560, letterSpacing: "-0.035em", color: C.accent }}>{line2}</div>
    </div>
  );
};

export const FinalCard: React.FC<{ f: number; start: number; title: string; release: string; ask: string; contact: string }> = ({ f, start, title, release, ask, contact }) => {
  if (f < sec(start - 0.1)) return null;
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: FONT_SANS, color: C.text, textAlign: "center" }}>
      <div style={{ position: "absolute", top: 420, left: 0, right: 0, fontSize: 80, fontWeight: 560, letterSpacing: "-0.03em", ...appear(f, start, 14, 0.4) }}>{title}</div>
      <div style={{ position: "absolute", top: 560, left: 0, right: 0, fontSize: 120, fontWeight: 580, letterSpacing: "-0.035em", color: C.accent, ...appear(f, start + 0.25, 18, 0.45) }}>{release}</div>
      <div style={{ position: "absolute", top: 860, left: 0, right: 0, fontSize: 64, fontWeight: 520, letterSpacing: "-0.02em", ...appear(f, start + 0.7, 14, 0.4) }}>{ask}</div>
      <div style={{ position: "absolute", top: 990, left: 40, right: 40, display: "flex", justifyContent: "center", ...appear(f, start + 0.95, 18, 0.4) }}>
        <div style={{ background: C.accent, color: "#fff", borderRadius: 999, padding: "34px 60px", fontSize: 50, fontWeight: 560, whiteSpace: "nowrap", boxShadow: "0 18px 44px rgba(116,43,69,.30)" }}>{contact}</div>
      </div>
    </div>
  );
};

/** Чат уезжает вниз и уменьшается, пока сверху выходит окно приложения. */
export const linkLayout = (f: number, at: number, chatTop: number, chatH: number, scale: number) => {
  const p = sp(f, at, "smooth");
  const targetTop = 1570 - chatH * scale;
  return { transform: `translateY(${(targetTop - chatTop) * p}px) scale(${1 - (1 - scale) * p})`, transformOrigin: "50% 0" } as const;
};
export const windowIn = (f: number, at: number) => {
  const p = sp(f, at, "gentle");
  return { opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * -60}px) scale(${0.96 + 0.04 * p})` } as const;
};
