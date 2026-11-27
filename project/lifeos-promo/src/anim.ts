import { Easing, interpolate, spring } from "remotion";
import { EASE, FPS, MOTION, SPRING, type SpringKind } from "./tokens";

export const sec = (s: number) => Math.round(s * FPS);
export const bez = (b: readonly [number, number, number, number]) => Easing.bezier(b[0], b[1], b[2], b[3]);

/** Пружина 0..1, стартует в момент `at` (секунды). */
export function sp(frame: number, at: number, kind: SpringKind = "gentle"): number {
  const f = frame - sec(at);
  if (f <= 0) return 0;
  return spring({ frame: f, fps: FPS, config: SPRING[kind] });
}

/** Линейный/кривой прогресс 0..1 между секундами a и b. */
export function tw(frame: number, a: number, b: number, easing: readonly [number, number, number, number] = EASE.out): number {
  return interpolate(frame, [sec(a), sec(b)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: bez(easing) });
}

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const springNum = (frame: number, at: number, from: number, to: number, kind: SpringKind = "gentle") => lerp(from, to, sp(frame, at, kind));

/** Появление: opacity + сдвиг по Y (4–8 px по духу приложения; в px кадра масштабируется). */
export function appear(frame: number, at: number, dy = 14, dur: number = MOTION.enter) {
  const p = tw(frame, at, at + dur, EASE.out);
  return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` } as const;
}

/** Нажатие: сжатие ~150 мс, возврат ~110 мс. Возвращает scale и силу кольца 0..1. */
export function press(frame: number, at: number) {
  const f = (frame - sec(at)) / FPS;
  let scale = 1;
  if (f > 0 && f < MOTION.press) scale = lerp(1, 0.94, f / MOTION.press);
  else if (f >= MOTION.press && f < MOTION.press + MOTION.release) scale = lerp(0.94, 1, (f - MOTION.press) / MOTION.release);
  const ring = f > 0 && f < 0.6 ? f / 0.6 : -1;
  return { scale, ring };
}

/** Посимвольный набор с неравномерным ритмом. Возвращает число видимых символов. */
export function typedCount(frame: number, start: number, text: string, cps = 11): number {
  const t = (frame - sec(start)) / FPS;
  if (t <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < text.length; i++) {
    const r = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
    let d = (0.55 + r * 0.9) / cps;
    if (text[i] === " ") d *= 1.35;
    if (text[i] === ",") d *= 2.2;
    acc += d;
    if (acc > t) return i;
  }
  return text.length;
}
export function typingDuration(text: string, cps = 11): number {
  let acc = 0;
  for (let i = 0; i < text.length; i++) {
    const r = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
    let d = (0.55 + r * 0.9) / cps;
    if (text[i] === " ") d *= 1.35;
    if (text[i] === ",") d *= 2.2;
    acc += d;
  }
  return acc;
}

export type CamKey = { t: number; x: number; y: number; z: number; dur?: number };
/** Виртуальная камера: ключи достигаются плавно (inOut) за dur секунд, начиная с t. */
export function camera(frame: number, keys: CamKey[]) {
  let cur = { x: keys[0].x, y: keys[0].y, z: keys[0].z };
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    const p = tw(frame, k.t, k.t + (k.dur ?? 0.9), [0.45, 0, 0.2, 1]);
    cur = { x: lerp(cur.x, k.x, p), y: lerp(cur.y, k.y, p), z: lerp(cur.z, k.z, p) };
  }
  return cur;
}
