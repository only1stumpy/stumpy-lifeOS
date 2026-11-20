"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { dismissLightNotice, useLightModeEffects, useLightNotice } from "./light-mode";
import styles from "./light-mode-sync.module.css";

const NOTICE_MS = 9000;

/** Mounted once at the root: applies the light look, runs the frame meter, and tells the user once if it switched itself on. */
export function LightModeSync() {
  useLightModeEffects();
  const notice = useLightNotice();
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(dismissLightNotice, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className={styles.notice} role="status">
      <p>Включил лёгкое оформление. Вернуть полное можно в «Персонализации».</p>
      <Button variant="secondary" size="sm" onClick={dismissLightNotice}>Понятно</Button>
    </div>
  );
}
