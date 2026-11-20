"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * "Лёгкое оформление": no SVG refraction and no backdrop blur on large layers, for weak devices.
 * The choice lives in localStorage of this device only (it is a display preference, not user data), so it needs no database column.
 * Auto = on when the device looks weak: Telegram on Android (WebView), 4 GB of memory or less, 4 cores or less, reduced motion.
 */
export type LightPreference = "auto" | "on" | "off";

export const LIGHT_PREFERENCES: readonly LightPreference[] = ["auto", "on", "off"];
export const LIGHT_MODE_ATTRIBUTE = "data-lifeos-light";

const STORAGE_KEY = "lifeos:light-mode";
const listeners = new Set<() => void>();
let cachedPreference: LightPreference | null = null;

type DeviceProbe = {
  platform?: string | null;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  reducedMotion?: boolean;
};

/** Pure decision, so it can be tested without a browser. */
export function isWeakDevice(probe: DeviceProbe): boolean {
  if (probe.reducedMotion) return true;
  if (probe.platform === "android") return true;
  if (typeof probe.deviceMemory === "number" && probe.deviceMemory <= 4) return true;
  if (typeof probe.hardwareConcurrency === "number" && probe.hardwareConcurrency <= 4) return true;
  return false;
}

export function resolveLightMode(preference: LightPreference, weak: boolean): boolean {
  return preference === "on" || (preference === "auto" && weak);
}

function probeDevice(): DeviceProbe {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const telegram = (window as Window & { Telegram?: { WebApp?: { platform?: string } } }).Telegram;
  return {
    platform: telegram?.WebApp?.platform ?? null,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}

function readPreference(): LightPreference {
  if (cachedPreference) return cachedPreference;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { /* storage may be blocked: Auto */ }
  cachedPreference = stored === "on" || stored === "off" ? stored : "auto";
  return cachedPreference;
}

export function setLightPreference(preference: LightPreference): void {
  cachedPreference = preference;
  try {
    if (preference === "auto") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* the choice then lasts until the page is closed */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  reducedMotion?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    reducedMotion?.removeEventListener("change", listener);
  };
}

const serverPreference = (): LightPreference => "auto";
const serverActive = (): boolean => false;
const clientActive = (): boolean => resolveLightMode(readPreference(), isWeakDevice(probeDevice()));

export function useLightPreference(): LightPreference {
  return useSyncExternalStore(subscribe, readPreference, serverPreference);
}

/** True when the light look is in effect right now (the preference resolved against the device). */
export function useLightMode(): boolean {
  return useSyncExternalStore(subscribe, clientActive, serverActive);
}

/** Mounted once at the root: mirrors the state onto <html>, where the stylesheets switch their heavy effects off. */
export function LightModeSync(): null {
  const active = useLightMode();
  useEffect(() => {
    const root = document.documentElement;
    if (active) root.setAttribute(LIGHT_MODE_ATTRIBUTE, "1");
    else root.removeAttribute(LIGHT_MODE_ATTRIBUTE);
  }, [active]);
  return null;
}
