"use client";

import { useEffect } from "react";

/** Slice of Telegram.WebApp used to pause the vertical close-swipe while a sheet is open (Bot API 7.7+). */
type SwipeControl = {
  isVersionAtLeast?(version: string): boolean;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
};

const KEYS = ["position", "top", "left", "right", "width", "overflow"] as const;
type StyleKey = (typeof KEYS)[number];

type LockEnv = {
  body: { style: Record<StyleKey, string> };
  getScrollY(): number;
  scrollTo(y: number): void;
  telegram?(): SwipeControl | undefined;
};

/**
 * Reference-counted body scroll lock. On iOS `overflow: hidden` does not stop the page scrolling under a sheet,
 * so the body is pinned with `position: fixed` and the scroll position is restored on the last release.
 */
export function createScrollLock(env: LockEnv) {
  let count = 0;
  let savedY = 0;
  let saved: Partial<Record<StyleKey, string>> = {};
  let swipesDisabled = false;

  const swipeApi = () => {
    try {
      const webApp = env.telegram?.();
      if (!webApp || typeof webApp.disableVerticalSwipes !== "function" || typeof webApp.enableVerticalSwipes !== "function") return undefined;
      if (typeof webApp.isVersionAtLeast === "function" && !webApp.isVersionAtLeast("7.7")) return undefined;
      return webApp;
    } catch {
      return undefined;
    }
  };

  return {
    lock() {
      count += 1;
      if (count > 1) return;
      savedY = env.getScrollY();
      const style = env.body.style;
      saved = Object.fromEntries(KEYS.map((key) => [key, style[key]]));
      style.position = "fixed";
      style.top = `-${savedY}px`;
      style.left = "0";
      style.right = "0";
      style.width = "100%";
      style.overflow = "hidden";
      try {
        const api = swipeApi();
        if (api) {
          api.disableVerticalSwipes!();
          swipesDisabled = true;
        }
      } catch { /* client without the method: nothing to pause */ }
    },
    unlock() {
      if (count === 0) return;
      count -= 1;
      if (count > 0) return;
      for (const key of KEYS) env.body.style[key] = saved[key] ?? "";
      env.scrollTo(savedY);
      if (swipesDisabled) {
        swipesDisabled = false;
        try {
          swipeApi()?.enableVerticalSwipes!();
        } catch { /* ignore */ }
      }
    },
  };
}

let browserLock: ReturnType<typeof createScrollLock> | undefined;
function getBrowserLock() {
  browserLock ??= createScrollLock({
    body: document.body,
    getScrollY: () => window.scrollY,
    scrollTo: (y) => window.scrollTo(0, y),
    telegram: () => (window as unknown as { Telegram?: { WebApp?: SwipeControl } }).Telegram?.WebApp,
  });
  return browserLock;
}

/** Freezes the page behind a sheet while `active` is true; releases on close and on unmount. */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const lock = getBrowserLock();
    lock.lock();
    return () => lock.unlock();
  }, [active]);
}
