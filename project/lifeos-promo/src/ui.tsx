import React from "react";
import { staticFile, useCurrentFrame } from "remotion";
import { C, FONT_SANS, H, W } from "./tokens";
import { appear } from "./anim";

export const FontFaces: React.FC = () => (
  <style>{`
    @font-face{font-family:"Medeo Sans";src:url(${staticFile("fonts/MedeoSansVariable.woff2")}) format("woff2");font-weight:100 900;font-style:normal}
    @font-face{font-family:"Medeo Mono";src:url(${staticFile("fonts/MedeoMonoVariable.woff2")}) format("woff2");font-weight:100 900;font-style:normal}
    *{box-sizing:border-box}
    body{margin:0}
    .tnum{font-variant-numeric:tabular-nums}
  `}</style>
);

/** Фон: градиент + медленно дрейфующие мягкие поля (шалфей, роза, слива, крем). */
export const Background: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / 30;
  const fields = [
    { c: "rgba(142,168,136,.42)", x: 150 + Math.sin(t / 5) * 90, y: 420 + Math.cos(t / 6) * 120, r: 620 },
    { c: "rgba(214,150,160,.40)", x: 900 + Math.cos(t / 4.5) * 100, y: 780 + Math.sin(t / 5.5) * 140, r: 700 },
    { c: "rgba(116,43,69,.20)", x: 700 + Math.sin(t / 6.5) * 120, y: 1500 + Math.cos(t / 4) * 110, r: 760 },
    { c: "rgba(255,236,205,.85)", x: 220 + Math.cos(t / 5.2) * 110, y: 1350 + Math.sin(t / 6) * 120, r: 700 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(165deg, ${C.bg1} 0%, ${C.bg2} 52%, ${C.bg3} 100%)`, overflow: "hidden" }}>
      {fields.map((fl, i) => (
        <div key={i} style={{ position: "absolute", left: fl.x - fl.r, top: fl.y - fl.r, width: fl.r * 2, height: fl.r * 2, borderRadius: "50%", background: `radial-gradient(circle, ${fl.c} 0%, rgba(255,255,255,0) 68%)` }} />
      ))}
    </div>
  );
};

/** Стекло: прозрачный центр (белый ~8.5%), светлая кромка, внутренний кант, блик у края. */
export const glassStyle = (radius: number, opts: { strong?: boolean } = {}): React.CSSProperties => ({
  position: "relative",
  borderRadius: radius,
  background: `radial-gradient(120% 90% at 8% 0%, rgba(255,255,255,${opts.strong ? 0.5 : 0.38}) 0%, rgba(255,255,255,0) 42%), radial-gradient(90% 70% at 100% 100%, rgba(214,150,170,.16) 0%, rgba(255,255,255,0) 60%), rgba(255,255,255,.085)`,
  backdropFilter: "blur(9px) saturate(1.3)",
  WebkitBackdropFilter: "blur(9px) saturate(1.3)",
  border: "1.5px solid rgba(255,255,255,.78)",
  boxShadow: "inset 0 1.5px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(255,255,255,.28), inset 0 -10px 24px rgba(255,255,255,.12), 0 22px 56px rgba(116,43,69,.10), 0 2px 8px rgba(116,43,69,.05)",
});

export const Glass: React.FC<{ radius?: number; style?: React.CSSProperties; children?: React.ReactNode; strong?: boolean }> = ({ radius = 28, style, children, strong }) => (
  <div style={{ ...glassStyle(radius, { strong }), ...style }}>{children}</div>
);

/** Подпись сцены; всегда внутри безопасной зоны (верх >= 220 px). */
export const Caption: React.FC<{ text: string; at: number; until?: number; top?: number; size?: number }> = ({ text, at, until, top = 240, size = 56 }) => {
  const f = useCurrentFrame();
  const a = appear(f, at, 16, 0.4);
  const out = until === undefined ? 1 : 1 - Math.min(1, Math.max(0, (f / 30 - until) / 0.25));
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top, textAlign: "center", fontFamily: FONT_SANS, fontWeight: 520, fontSize: size, lineHeight: 1.12, letterSpacing: "-0.02em", color: C.text, opacity: a.opacity * out, transform: a.transform }}>{text}</div>
  );
};

/** Кольцо нажатия (в координатах родителя). */
export const TapRing: React.FC<{ ring: number; x: number; y: number }> = ({ ring, x, y }) => {
  if (ring < 0) return null;
  const s = 40 + ring * 120;
  return <div style={{ position: "absolute", left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: "50%", border: `4px solid rgba(116,43,69,${0.55 * (1 - ring)})`, background: `rgba(116,43,69,${0.14 * (1 - ring)})`, pointerEvents: "none" }} />;
};

export const SceneFade: React.FC<{ frame: number; total: number; ov: number; first?: boolean; last?: boolean; children: React.ReactNode }> = ({ frame, total, ov, first, last, children }) => {
  const inP = first ? 1 : Math.min(1, frame / ov);
  const outP = last ? 1 : Math.min(1, (total - frame) / ov);
  return <div style={{ position: "absolute", inset: 0, width: W, height: H, opacity: Math.min(inP, outP) }}>{children}</div>;
};
