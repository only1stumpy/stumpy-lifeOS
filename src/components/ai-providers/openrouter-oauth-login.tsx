"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import styles from "./openrouter-oauth-login.module.css";

type Props = {
  /** `tma <initData>` header value of the Mini App session. */
  authorization: string;
  accountName: string;
  /** The free-tier confirmation the host form already asks for. */
  confirmed: boolean;
  disabled?: boolean;
  /** Called once the server has saved the new OpenRouter account. */
  onConnected: () => void | Promise<void>;
};

const POLL_MS = 3000;
const ENDPOINT = "/api/ai/oauth/openrouter";
const FAILURE_COPY = {
  failed: "Не удалось завершить вход через OpenRouter.",
  cancelled: "Доступ не был предоставлен или вход отменён.",
  expired: "Время входа истекло.",
} as const;

type TelegramWebApp = {
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
};
const telegramWebApp = (): TelegramWebApp | undefined => (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/** Telegram has no in-app browser option for openLink (only Instant View), so the login opens externally. */
function openExternal(url: string): void {
  const webApp = telegramWebApp();
  try {
    if (webApp?.openLink) { webApp.openLink(url, { try_instant_view: false }); return; }
  } catch { /* fall through to a normal tab */ }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** «Войти через OpenRouter»: the key is created and stored on the server, the Mini App only waits for the result. */
export function OpenRouterLogin({ authorization, accountName, confirmed, disabled = false, onConnected }: Props) {
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting">("idle");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const attempt = useRef<{ id: string; expiresAt: number } | null>(null);
  const connected = useRef(onConnected);
  useEffect(() => { connected.current = onConnected; });

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    attempt.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const poll = useCallback(async () => {
    const current = attempt.current;
    if (!current) return;
    try {
      const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(current.id)}`, { headers: { Authorization: authorization }, cache: "no-store" });
      if (attempt.current?.id !== current.id) return;
      const body = await response.json().catch(() => null) as { status?: string; error?: string } | null;
      if (!response.ok || !body?.status) {
        if (Date.now() > current.expiresAt) { stop(); setPhase("idle"); setError(FAILURE_COPY.expired); }
        return;
      }
      if (body.status === "done") {
        stop();
        setPhase("idle");
        await connected.current();
      } else if (body.status === "failed" || body.status === "cancelled" || body.status === "expired") {
        stop();
        setPhase("idle");
        setError(body.error || FAILURE_COPY[body.status]);
      }
    } catch {
      // Network blip: keep waiting, the next tick retries.
    }
  }, [authorization, stop]);

  // Returning from the external browser is the moment the result is most likely ready.
  useEffect(() => {
    if (phase !== "waiting") return;
    const onReturn = () => { if (document.visibilityState === "visible") void poll(); };
    const webApp = telegramWebApp();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    try { webApp?.onEvent?.("activated", onReturn); } catch { /* older Telegram clients */ }
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      try { webApp?.offEvent?.("activated", onReturn); } catch { /* older Telegram clients */ }
    };
  }, [phase, poll]);

  const start = async () => {
    if (phase !== "idle" || disabled) return;
    const name = accountName.trim();
    if (!name) { setError("Укажи название аккаунта."); return; }
    if (!confirmed) { setError("Подтверди условия бесплатного доступа выше."); return; }
    setError("");
    setPhase("starting");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name, freeTierConfirmed: true }),
      });
      const body = await response.json().catch(() => null) as { id?: string; authUrl?: string; expiresAt?: string; error?: string } | null;
      if (!response.ok || !body?.id || !body.authUrl) throw new Error(body?.error || "Не удалось начать вход через OpenRouter. Можно вставить ключ вручную.");
      attempt.current = { id: body.id, expiresAt: Date.parse(body.expiresAt ?? "") || Date.now() + 10 * 60 * 1000 };
      timer.current = setInterval(() => void poll(), POLL_MS);
      setPhase("waiting");
      openExternal(body.authUrl);
    } catch (caught) {
      stop();
      setPhase("idle");
      setError(caught instanceof Error ? caught.message : "Не удалось начать вход через OpenRouter.");
    }
  };

  return (
    <div className={styles.root}>
      <Button variant="primary" size="lg" fullWidth onClick={() => void start()} disabled={disabled || phase !== "idle"}>
        {phase === "starting" ? "Открываю OpenRouter…" : phase === "waiting" ? "Жду подтверждения…" : "Войти через OpenRouter"}
      </Button>
      <p className={styles.note}>
        {phase === "waiting"
          ? "Войди в OpenRouter в браузере и разреши доступ: страница сама вернёт тебя в LifeOS. Если не вернула, переключись в Telegram, здесь всё обновится."
          : "Откроется сайт OpenRouter. LifeOS получит обычный API-ключ и сохранит его зашифрованным; пароль OpenRouter приложению не передаётся."}
      </p>
      {phase === "waiting" && <Button variant="text" onClick={() => { stop(); setPhase("idle"); }}>Отменить ожидание</Button>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
