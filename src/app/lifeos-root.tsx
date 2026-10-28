"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AppSnapshot } from "@/domain/app";
import { commandSchema } from "@/domain/commands";
import type { AppCommand } from "@/domain/commands";
import { EditorDialog } from "@/components/editor/editor";
import type { EditorState } from "@/components/editor/editor";
import LifeOSApp from "@/components/lifeos/lifeos-app";
import type { LifeOSAction, WorkoutDay } from "@/domain/types";

type LifeOSRootProps = { configured: boolean };
type RootStatus = "checking" | "outside" | "setup" | "loading" | "ready" | "error";
type TelegramFullscreenEvent = "fullscreenChanged" | "fullscreenFailed";
type TelegramMiniApp = {
  initData?: string;
  isVersionAtLeast?(version: string): boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  onEvent?(eventType: TelegramFullscreenEvent, handler: () => void): void;
  offEvent?(eventType: TelegramFullscreenEvent, handler: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
};

const finishButtonStyle: CSSProperties = {
  position: "fixed",
  zIndex: 20,
  bottom: "calc(94px + max(env(safe-area-inset-bottom, 0px), var(--tg-safe-area-inset-bottom, 0px), var(--tg-content-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))",
  left: "50%",
  transform: "translateX(-50%)",
  minHeight: 44,
  padding: "10px 16px",
  border: "1px solid rgba(255,255,255,.86)",
  borderRadius: 16,
  background: "rgba(116,43,69,.94)",
  color: "#fffaf9",
  boxShadow: "0 8px 24px rgba(70,45,63,.18)",
  whiteSpace: "nowrap",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppSnapshot(value: unknown): value is AppSnapshot {
  if (!isRecord(value)) return false;
  const nutrition = value.nutrition;
  const finance = value.finance;
  const gym = value.gym;
  const settings = value.settings;
  return typeof value.localDate === "string"
    && isRecord(nutrition) && isRecord(nutrition.consumed) && Array.isArray(nutrition.entries) && Array.isArray(nutrition.weightHistory)
    && isRecord(finance) && Array.isArray(finance.accounts) && Array.isArray(finance.entries)
    && isRecord(gym) && Array.isArray(gym.program)
    && isRecord(settings) && typeof settings.timeZone === "string"
    && Array.isArray(value.recurring) && Array.isArray(value.drafts) && Array.isArray(value.templates);
}

function responseSnapshot(payload: unknown): AppSnapshot {
  const candidate = isRecord(payload) && "snapshot" in payload ? payload.snapshot : payload;
  if (!isAppSnapshot(candidate)) throw new Error("Сервер вернул данные в неожиданном формате.");
  return candidate;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Сервер вернул некорректный ответ.");
  }
}

function responseError(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === "string") return payload.error;
  if (status === 401) return "Сессия Telegram недействительна. Откройте Mini App заново.";
  if (status === 503) return "Сервер LifeOS ещё не настроен.";
  return "Не удалось связаться с LifeOS. Попробуйте ещё раз.";
}

function isErrorPayload(payload: unknown): payload is { error: string } {
  return isRecord(payload) && typeof payload.error === "string";
}

function getTelegramWebApp(): TelegramMiniApp | null {
  const telegram = (window as Window & { Telegram?: { WebApp?: TelegramMiniApp } }).Telegram;
  return telegram?.WebApp ?? null;
}

async function fetchSnapshot(initData: string, date?: string): Promise<AppSnapshot> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`/api/snapshot${query}`, {
    method: "GET",
    headers: { Authorization: `tma ${initData}` },
    cache: "no-store",
  });
  const payload = await responseBody(response);
  if (!response.ok || isErrorPayload(payload)) throw new Error(responseError(payload, response.status));
  return responseSnapshot(payload);
}

function findWorkout(snapshot: AppSnapshot, workoutId: string): WorkoutDay | null {
  return snapshot.gym.program.find((workout) => workout.id === workoutId)
    ?? (snapshot.gym.nextWorkout?.id === workoutId ? snapshot.gym.nextWorkout : null);
}

function editorIdentity(editor: EditorState): string {
  switch (editor.kind) {
    case "food": return `food:${editor.entry?.id ?? "new"}`;
    case "finance": return `finance:${editor.entry?.id ?? "new"}`;
    case "accounts": return `accounts:${editor.account?.id ?? "new"}`;
    case "recurring": return `recurring:${editor.item?.id ?? "new"}`;
    case "exercise": return `exercise:${editor.dayId}`;
    case "set": return `set:${editor.dayId}:${editor.exerciseId}:${editor.set.id}`;
    case "delete-food": return `delete-food:${editor.id}`;
    case "delete-money": return `delete-money:${editor.id}`;
    case "target":
    case "weight":
    case "program": return editor.kind;
  }
}

function LifeOSRoot({ configured }: LifeOSRootProps) {
  const [status, setStatus] = useState<RootStatus>("checking");
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let cleanupTelegramFullscreen: (() => void) | null = null;
    const initialize = async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!mounted) return;

      const webApp = getTelegramWebApp();
      if (!webApp) {
        setStatus("outside");
        return;
      }

      try {
        webApp.ready();
        const supportsFullscreen = typeof webApp.requestFullscreen === "function"
          && (typeof webApp.isVersionAtLeast !== "function" || webApp.isVersionAtLeast("8.0"));
        if (supportsFullscreen && webApp.onEvent && webApp.offEvent) {
          let active = true;
          const onFullscreenChanged = () => cleanup();
          const onFullscreenFailed = () => {
            cleanup();
            if (mounted) {
              try {
                webApp.expand();
              } catch {
                // Fullscreen fallback is best-effort on Telegram clients.
              }
            }
          };
          const cleanup = () => {
            if (!active) return;
            active = false;
            webApp.offEvent?.("fullscreenChanged", onFullscreenChanged);
            webApp.offEvent?.("fullscreenFailed", onFullscreenFailed);
            cleanupTelegramFullscreen = null;
          };
          cleanupTelegramFullscreen = cleanup;
          try {
            webApp.onEvent("fullscreenChanged", onFullscreenChanged);
            webApp.onEvent("fullscreenFailed", onFullscreenFailed);
            webApp.requestFullscreen?.();
          } catch {
            cleanup();
            webApp.expand();
          }
        } else {
          webApp.expand();
        }
        webApp.setHeaderColor?.("#f6f2ec");
        webApp.setBackgroundColor?.("#f6f2ec");
      } catch {
        // Telegram presentation methods vary by client version; auth remains server-verified.
      }

      if (!configured) {
        setStatus("setup");
        return;
      }

      const rawInitData = webApp.initData ?? "";
      if (!rawInitData) {
        setStatus("outside");
        return;
      }

      setInitData(rawInitData);
      setStatus("loading");
      try {
        const nextSnapshot = await fetchSnapshot(rawInitData);
        if (!mounted) return;
        setSnapshot(nextSnapshot);
        setSelectedDate(nextSnapshot.localDate);
        setError(null);
        setStatus("ready");
      } catch (cause: unknown) {
        if (!mounted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные.");
        setStatus("error");
      }
    };

    void initialize();
    return () => {
      mounted = false;
      cleanupTelegramFullscreen?.();
    };
  }, [configured]);

  const retryLoad = useCallback(async () => {
    if (!initData || !configured) return;
    setStatus("loading");
    setError(null);
    try {
      const nextSnapshot = await fetchSnapshot(initData, selectedDate ?? undefined);
      setSnapshot(nextSnapshot);
      setSelectedDate(nextSnapshot.localDate);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные.");
      setStatus("error");
    }
  }, [configured, initData, selectedDate]);

  const changeDate = useCallback(async (date: string) => {
    if (!configured || !initData || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSelectedDate(date);
    setStatus("loading");
    setError(null);
    try {
      const nextSnapshot = await fetchSnapshot(initData, date);
      setSnapshot(nextSnapshot);
      setSelectedDate(nextSnapshot.localDate);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить выбранный день.");
      setStatus("error");
    }
  }, [configured, initData]);

  const sendCommand = useCallback(async (command: AppCommand, keepOpen = false): Promise<boolean> => {
    if (!configured || !initData) {
      setError("Откройте Mini App через Telegram, чтобы изменить данные.");
      return false;
    }
    if (pendingRef.current) return false;
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) {
      setError("Проверьте введённые значения.");
      return false;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: {
          Authorization: `tma ${initData}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(parsed.data),
      });
      const payload = await responseBody(response);
      if (!response.ok || isErrorPayload(payload)) throw new Error(responseError(payload, response.status));

      if (!keepOpen) setEditor(null);
      try {
        setSnapshot(await fetchSnapshot(initData, selectedDate ?? snapshot?.localDate));
      } catch {
        setError("Изменение принято сервером, но обновить данные не удалось. Повторите загрузку.");
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [configured, initData, selectedDate, snapshot]);

  const openEditor = useCallback((nextEditor: EditorState) => {
    setError(null);
    setEditor(nextEditor);
  }, []);

  const handleAction = useCallback((action: LifeOSAction) => {
    if (!snapshot || !configured || !initData) return;
    setError(null);
    switch (action.type) {
      case "food.add": openEditor({ kind: "food" }); return;
      case "food.edit": {
        const entry = snapshot.nutrition.entries.find((item) => item.id === action.id);
        if (entry) openEditor({ kind: "food", entry });
        else setError("Запись еды уже изменилась. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "food.delete": {
        const entry = snapshot.nutrition.entries.find((item) => item.id === action.id);
        if (entry) openEditor({ kind: "delete-food", id: entry.id, label: entry.label });
        else setError("Запись еды уже изменилась. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "food.set-target": openEditor({ kind: "target" }); return;
      case "weight.add": openEditor({ kind: "weight" }); return;
      case "finance.add": openEditor({ kind: "finance" }); return;
      case "finance.edit": {
        const entry = snapshot.finance.entries.find((item) => item.id === action.id);
        if (entry) openEditor({ kind: "finance", entry });
        else setError("Операция уже изменилась. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "finance.delete": {
        const entry = snapshot.finance.entries.find((item) => item.id === action.id);
        if (entry) openEditor({ kind: "delete-money", id: entry.id, label: entry.label });
        else setError("Операция уже изменилась. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "finance.manage-accounts": openEditor({ kind: "accounts" }); return;
      case "finance.manage-recurring": openEditor({ kind: "recurring" }); return;
      case "gym.edit-program": openEditor({ kind: "program" }); return;
      case "gym.start-workout": void sendCommand({ type: "session.start", dayId: action.workoutId }); return;
      case "gym.open-exercise": return;
      case "gym.complete-set": {
        const workout = findWorkout(snapshot, action.workoutId);
        const exercise = workout?.exercises.find((item) => item.id === action.exerciseId);
        const set = exercise?.sets.find((item) => item.id === action.setId);
        if (workout && exercise && set) openEditor({ kind: "set", dayId: workout.id, exerciseId: exercise.id, set });
        else setError("Подход уже изменился. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "gym.add-exercise": openEditor({ kind: "exercise", dayId: action.workoutId }); return;
    }
  }, [configured, initData, openEditor, sendCommand, snapshot]);

  if (status !== "ready" || !snapshot) {
    const message = status === "outside"
      ? "Откройте Mini App через Telegram, чтобы войти в LifeOS."
      : status === "setup"
        ? "LifeOS ещё не настроен на сервере. Проверьте подключение базы данных и Telegram-бота."
        : status === "error"
          ? error ?? "Не удалось загрузить данные."
          : status === "loading"
            ? "Подключаюсь к Telegram и загружаю данные…"
            : "Проверяю доступ к LifeOS…";
    return (
      <main className="setup-notice" role={status === "error" ? "alert" : "status"} aria-live="polite">
        <p>{message}</p>
        {status === "error" && initData && <button type="button" onClick={() => void retryLoad()}>Повторить загрузку</button>}
      </main>
    );
  }

  const showGlobalError = error && !editor;
  return (
    <>
      {showGlobalError && <p className="app-notice" role="alert">{error}</p>}
      <LifeOSApp snapshot={snapshot} onAction={handleAction} onDateChange={(date) => void changeDate(date)} />
      {snapshot.activeSession && (
        <button type="button" style={finishButtonStyle} disabled={pending} onClick={() => void sendCommand({ type: "session.finish", id: snapshot.activeSession!.id })}>
          {pending ? "Сохраняю…" : "Завершить тренировку"}
        </button>
      )}
      {editor && <EditorDialog key={editorIdentity(editor)} editor={editor} snapshot={snapshot} pending={pending} error={error} onClose={() => setEditor(null)} onChange={openEditor} onCommand={sendCommand} />}
    </>
  );
}

export default LifeOSRoot;
