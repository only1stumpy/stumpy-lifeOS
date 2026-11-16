"use client";

import { useEffect } from "react";

const FIELD = "input, textarea, select, [contenteditable='true']";

/**
 * Keeps the focused field visible above the on-screen keyboard on every screen. The viewport meta asks the
 * browser to resize the layout; as a fallback (Telegram WebView does not always honor it) the keyboard height
 * is measured through visualViewport and added as bottom padding, and the field is scrolled into view.
 */
export function KeyboardAvoidance() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let timer = 0;

    const reveal = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches(FIELD)) active.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    const measure = () => {
      const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      root.style.setProperty("--lifeos-keyboard", keyboard > 80 ? `${Math.round(keyboard)}px` : "0px");
      if (keyboard > 80) { window.clearTimeout(timer); timer = window.setTimeout(reveal, 60); }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(FIELD)) {
        window.clearTimeout(timer);
        // The keyboard needs a moment to open; scroll again once the viewport settles.
        timer = window.setTimeout(reveal, 350);
      }
    };

    viewport?.addEventListener("resize", measure);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.clearTimeout(timer);
      viewport?.removeEventListener("resize", measure);
      document.removeEventListener("focusin", onFocus);
      root.style.removeProperty("--lifeos-keyboard");
    };
  }, []);

  return null;
}
