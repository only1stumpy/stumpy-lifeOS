// Единственное место с дизайн-токенами (по DESIGN.md репозитория LifeOS).
export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const SAFE_TOP = 220;
export const SAFE_BOTTOM = 340;

export const C = {
  bg1: "#f6f2ec",
  bg2: "#f1e9eb",
  bg3: "#f7f1ec",
  text: "#35272c",
  text2: "#76666d",
  accent: "#742b45",
  divider: "rgba(96,45,62,.16)",
  protein: "#4f654f",
  fat: "#855c34",
  carbs: "#84605a",
  income: "#4f654f",
  track: "rgba(96,45,62,.12)",
} as const;

export const FONT_SANS = '"Medeo Sans", system-ui, sans-serif';
export const FONT_MONO = '"Medeo Mono", ui-monospace, monospace';

export const RADIUS = { surface: 28, panel: 27, pill: 999 } as const;

// Пружины приложения (motion-system.tsx): duration + bounce -> stiffness/damping (mass 1).
const fromMotion = (duration: number, bounce: number) => {
  const w = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  return { stiffness: w * w, damping: 2 * zeta * w, mass: 1 };
};
export const SPRING = {
  gentle: fromMotion(0.55, 0.2),
  snappy: fromMotion(0.5, 0.1),
  bouncy: fromMotion(0.62, 0.4),
  smooth: fromMotion(0.6, 0.05),
} as const;
export type SpringKind = keyof typeof SPRING;

export const EASE = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  sheet: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const MOTION = { press: 0.15, release: 0.11, enter: 0.26, stagger: 0.07, list: 0.055 } as const;
