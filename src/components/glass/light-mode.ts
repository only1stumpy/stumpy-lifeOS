"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * "Лёгкое оформление": no SVG refraction and no backdrop blur, for weak devices.
 * Everything is kept in localStorage of this device (a display preference, not user data), so no database column is needed.
 *
 * Auto decides in this order:
 *  1. manual choice: "on" is always light, "off" is never light;
 *  2. the OS asks for reduced motion or reduced transparency: light;
 *  3. Telegram Android reports a performance class in the User-Agent: LOW is light, HIGH is full;
 *  4. AVERAGE and unknown (iOS, desktop, Web) are decided by a frame meter; a verdict "slow" is stored and never reverts by itself.
 */
export type LightPreference = "auto" | "on" | "off";
export type PerformanceClass = "LOW" | "AVERAGE" | "HIGH";

export const LIGHT_PREFERENCES: readonly LightPreference[] = ["auto", "on", "off"];
export const LIGHT_MODE_ATTRIBUTE = "data-lifeos-light";

export const PREFERENCE_KEY = "lifeos:light-mode";
export const AUTO_SLOW_KEY = "lifeos:light-mode-auto";
export const NOTICE_SEEN_KEY = "lifeos:light-mode-notice";

/** Frame meter: this many frames per window, this long a warm-up, two slow windows in a row. */
export const METER_WINDOW_FRAMES = 45;
export const METER_WARMUP_MS = 1500;
export const METER_WINDOWS_NEEDED = 2;
/** Above 33.3 ms on purpose: a 30 fps cap (battery saver) must not count as slow. About 27 fps and below is slow. */
export const SLOW_FRAME_MEDIAN_MS = 36;
const METER_GIVE_UP_MS = 180_000;

/** "Telegram-Android/11.3.3 (Google sdk_gphone64_arm64; Android 14; SDK 34; LOW)" (Mini Apps docs, "Additional Data in User-Agent"). */
const TELEGRAM_ANDROID_UA = /Telegram-Android\/[^\s(]+\s*\([^)]*;\s*(LOW|AVERAGE|HIGH)\s*\)/i;

export function parsePerformanceClass(userAgent: string): PerformanceClass | null {
  const match = TELEGRAM_ANDROID_UA.exec(userAgent);
  return match ? (match[1]!.toUpperCase() as PerformanceClass) : null;
}

export function isIosUserAgent(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

export type LightInputs = {
  preference: LightPreference;
  osReduced: boolean;
  performanceClass: PerformanceClass | null;
  /** The frame meter once decided "slow" on this device. */
  measuredSlow: boolean;
};

/** Pure decision: manual choice > OS settings > Telegram performance class > frame meter. */
export function decideLightMode(input: LightInputs): boolean {
  if (input.preference === "on") return true;
  if (input.preference === "off") return false;
  if (input.osReduced) return true;
  if (input.performanceClass === "LOW") return true;
  if (input.performanceClass === "HIGH") return false;
  return input.measuredSlow;
}

/** The meter runs only when nothing above has decided yet and iOS (no device data, fast enough in practice) is not involved. */
export function shouldMeasure(input: LightInputs & { userAgent: string }): boolean {
  if (input.preference !== "auto" || input.osReduced || input.measuredSlow) return false;
  if (input.performanceClass === "LOW" || input.performanceClass === "HIGH") return false;
  return !isIosUserAgent(input.userAgent);
}

/** Median frame interval of a window against the threshold. */
export function isSlowWindow(frames: readonly number[]): boolean {
  if (!frames.length) return false;
  const sorted = [...frames].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]! > SLOW_FRAME_MEDIAN_MS;
}

// ---- store (localStorage + subscriptions) ----

const listeners = new Set<() => void>();
let cachedPreference: LightPreference | null = null;
let cachedAutoSlow: boolean | null = null;
let noticePending = false;

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* the choice then lasts until the page is closed */ }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function readPreference(): LightPreference {
  if (cachedPreference) return cachedPreference;
  const stored = readStorage(PREFERENCE_KEY);
  cachedPreference = stored === "on" || stored === "off" ? stored : "auto";
  return cachedPreference;
}

function readAutoSlow(): boolean {
  if (cachedAutoSlow === null) cachedAutoSlow = readStorage(AUTO_SLOW_KEY) === "1";
  return cachedAutoSlow;
}

export function setLightPreference(preference: LightPreference): void {
  cachedPreference = preference;
  writeStorage(PREFERENCE_KEY, preference === "auto" ? null : preference);
  // Back to Auto starts over: the earlier verdict of the meter is forgotten.
  if (preference === "auto") { cachedAutoSlow = false; writeStorage(AUTO_SLOW_KEY, null); }
  notify();
}

function recordSlowVerdict(): void {
  cachedAutoSlow = true;
  writeStorage(AUTO_SLOW_KEY, "1");
  if (readStorage(NOTICE_SEEN_KEY) !== "1") noticePending = true;
  notify();
}

export function dismissLightNotice(): void {
  noticePending = false;
  writeStorage(NOTICE_SEEN_KEY, "1");
  notify();
}

const REDUCED_QUERIES = ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)"] as const;

function osReduced(): boolean {
  return REDUCED_QUERIES.some((query) => window.matchMedia?.(query).matches ?? false);
}

function currentInputs(): LightInputs {
  return {
    preference: readPreference(),
    osReduced: osReduced(),
    performanceClass: parsePerformanceClass(navigator.userAgent),
    measuredSlow: readAutoSlow(),
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const queries = REDUCED_QUERIES.map((query) => window.matchMedia?.(query));
  queries.forEach((query) => query?.addEventListener("change", listener));
  return () => {
    listeners.delete(listener);
    queries.forEach((query) => query?.removeEventListener("change", listener));
  };
}

const serverPreference = (): LightPreference => "auto";
const serverFalse = (): boolean => false;

export function useLightPreference(): LightPreference {
  return useSyncExternalStore(subscribe, readPreference, serverPreference);
}

/** True when the light look is in effect right now. */
export function useLightMode(): boolean {
  return useSyncExternalStore(subscribe, () => decideLightMode(currentInputs()), serverFalse);
}

/** True once, right after the meter switched the light look on by itself. */
export function useLightNotice(): boolean {
  return useSyncExternalStore(subscribe, () => noticePending, serverFalse);
}

const shouldMeasureNow = (): boolean => shouldMeasure({ ...currentInputs(), userAgent: navigator.userAgent });

/**
 * Rolling frame meter on requestAnimationFrame. Counts only while the page is visible, skips the first
 * second and a half after start or after coming back to the tab, and needs two slow windows in a row.
 * Stops by itself after the verdict, when the preference leaves Auto, or after a few minutes of a healthy page.
 */
function startFrameMeter(onSlow: () => void): () => void {
  let frameId = 0;
  let frames: number[] = [];
  let last = 0;
  let slowWindows = 0;
  let stopped = false;
  const started = performance.now();
  let holdUntil = started + METER_WARMUP_MS;

  const reset = () => { frames = []; last = 0; slowWindows = 0; };
  const tick = (now: number) => {
    if (stopped) return;
    frameId = requestAnimationFrame(tick);
    if (document.hidden || now < holdUntil) { reset(); return; }
    if (now - started > METER_GIVE_UP_MS) { stop(); return; }
    if (last && now - last < 1000) frames.push(now - last);
    last = now;
    if (frames.length < METER_WINDOW_FRAMES) return;
    slowWindows = isSlowWindow(frames) ? slowWindows + 1 : 0;
    frames = [];
    if (slowWindows >= METER_WINDOWS_NEEDED) { stop(); onSlow(); }
  };
  const onVisibility = () => { if (!document.hidden) { holdUntil = performance.now() + METER_WARMUP_MS; reset(); } };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  document.addEventListener("visibilitychange", onVisibility);
  frameId = requestAnimationFrame(tick);
  return stop;
}

/** Mounted once at the root: mirrors the state onto <html> and runs the meter when it is needed. */
export function useLightModeEffects(): void {
  const active = useLightMode();
  const measure = useSyncExternalStore(subscribe, shouldMeasureNow, serverFalse);
  useEffect(() => {
    if (!active) return undefined;
    // The boot script may have set it already; only a real switch back to full removes it.
    const root = document.documentElement;
    root.setAttribute(LIGHT_MODE_ATTRIBUTE, "1");
    return () => root.removeAttribute(LIGHT_MODE_ATTRIBUTE);
  }, [active]);
  useEffect(() => (measure ? startFrameMeter(recordSlowVerdict) : undefined), [measure]);
}

/**
 * Runs in <head> before the first paint, so a stored verdict, a manual "on" and a LOW class apply from the first frame.
 * Same rules as decideLightMode, only the stored part (the meter itself runs later in the app).
 */
export const LIGHT_MODE_BOOT_SCRIPT = `(function(){try{var s=window.localStorage,p=s.getItem(${JSON.stringify(PREFERENCE_KEY)}),m=window.matchMedia,ua=navigator.userAgent,c=/Telegram-Android\\/[^\\s(]+\\s*\\([^)]*;\\s*(LOW|AVERAGE|HIGH)\\s*\\)/i.exec(ua),k=c?c[1].toUpperCase():null,r=m&&(m("(prefers-reduced-motion: reduce)").matches||m("(prefers-reduced-transparency: reduce)").matches);var on=p==="on"||(p!=="off"&&(r||k==="LOW"||(k!=="HIGH"&&s.getItem(${JSON.stringify(AUTO_SLOW_KEY)})==="1")));if(on)document.documentElement.setAttribute(${JSON.stringify(LIGHT_MODE_ATTRIBUTE)},"1")}catch(e){}})();`;
