"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AppSnapshot } from "@/domain/app";
import { commandSchema } from "@/domain/commands";
import type { AppCommand } from "@/domain/commands";
import { EditorDialog } from "@/components/editor/editor";
import type { EditorState } from "@/components/editor/editor";
import LifeOSApp from "@/components/lifeos/lifeos-app";
import { AiQuotasPanel } from "@/components/ai-quotas/ai-quotas-panel";
import { AiProvidersPanel } from "@/components/ai-providers/ai-providers-panel";
import { LifeOSBootSkeleton } from "@/components/loading/loading-skeletons";
import { MotionProvider, motionDuration, motionEase, useMotionVariants } from "@/components/motion/motion-system";
import type { LifeOSAction, WorkoutDay } from "@/domain/types";

type LifeOSRootProps = { configured: boolean };
type RootStatus = "checking" | "outside" | "setup" | "loading" | "ready" | "error";
type TelegramWebAppEvent = "fullscreenChanged" | "fullscreenFailed" | "safeAreaChanged" | "contentSafeAreaChanged";
type TelegramInset = { top?: number };
type TelegramBackButton = {
  show?(): void;
  hide?(): void;
  onClick?(handler: () => void): void;
  offClick?(handler: () => void): void;
};
type TelegramHapticFeedback = {
  selectionChanged?(): void;
  notificationOccurred?(type: "error" | "success" | "warning"): void;
};
type TelegramMiniApp = {
  initData?: string;
  isFullscreen?: boolean;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
  isVersionAtLeast?(version: string): boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  onEvent?(eventType: TelegramWebAppEvent, handler: () => void): void;
  offEvent?(eventType: TelegramWebAppEvent, handler: () => void): void;
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
    && isRecord(finance) && Array.isArray(finance.accounts) && Array.isArray(finance.entries) && Array.isArray(finance.plans) && Array.isArray(finance.debts)
    && isRecord(gym) && Array.isArray(gym.program)
    && isRecord(settings) && typeof settings.timeZone === "string" && typeof settings.aiOnboardingCompleted === "boolean"
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

function triggerTelegramHaptic(kind: "selection" | "success" | "error"): void {
  try {
    const feedback = getTelegramWebApp()?.HapticFeedback;
    if (kind === "selection") feedback?.selectionChanged?.();
    else feedback?.notificationOccurred?.(kind);
  } catch {
    // Haptic feedback is optional and must never block a LifeOS action.
  }
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
    case "finance-plan": return `finance-plan:${editor.plan?.id ?? "new"}`;
    case "finance-plan-purchase": return `finance-plan-purchase:${editor.plan.id}`;
    case "debt-create": return `debt-create:${editor.openedAs ?? "transfer"}`;
    case "debt-repayment": return `debt-repayment:${editor.debt.id}`;
    case "accounts": return `accounts:${editor.account?.id ?? "new"}`;
    case "recurring": return `recurring:${editor.item?.id ?? "new"}`;
    case "exercise": return `exercise:${editor.dayId}`;
    case "set": return `set:${editor.dayId}:${editor.exerciseId}:${editor.set.id}`;
    case "delete-food": return `delete-food:${editor.id}`;
    case "delete-money": return `delete-money:${editor.id}`;
    case "delete-finance-plan": return `delete-finance-plan:${editor.id}`;
    case "target":
    case "weight":
    case "program": return editor.kind;
  }
}

function LifeOSRoot({ configured }: LifeOSRootProps) {
  const motionVariants = useMotionVariants();
  const [status, setStatus] = useState<RootStatus>("checking");
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showAiQuotas, setShowAiQuotas] = useState(false);
  const [showAiProviders, setShowAiProviders] = useState(false);
  const [guidedAiOnboarding, setGuidedAiOnboarding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramFullscreen, setTelegramFullscreen] = useState(false);
  const [telegramSafeAreaTop, setTelegramSafeAreaTop] = useState(0);
  const [telegramContentSafeAreaTop, setTelegramContentSafeAreaTop] = useState(0);
  const [hasAppBackState, setHasAppBackState] = useState(false);
  const pendingRef = useRef(false);
  const telegramBackHandlerRef = useRef<() => void>(() => undefined);
  const appBackHandlerRef = useRef<(() => void) | null>(null);
  const editorBackHandlerRef = useRef<(() => void) | null>(null);

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
        const syncTelegramPresentation = () => {
          if (!mounted) return;
          setTelegramFullscreen(webApp.isFullscreen === true);
          setTelegramSafeAreaTop(Math.max(0, webApp.safeAreaInset?.top ?? 0));
          setTelegramContentSafeAreaTop(Math.max(0, webApp.contentSafeAreaInset?.top ?? 0));
        };
        syncTelegramPresentation();

        const supportsFullscreen = typeof webApp.requestFullscreen === "function"
          && (typeof webApp.isVersionAtLeast !== "function" || webApp.isVersionAtLeast("8.0"));
        if (webApp.onEvent && webApp.offEvent) {
          let active = true;
          const onFullscreenChanged = () => syncTelegramPresentation();
          const onSafeAreaChanged = () => syncTelegramPresentation();
          const onContentSafeAreaChanged = () => syncTelegramPresentation();
          const onFullscreenFailed = () => {
            syncTelegramPresentation();
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
            webApp.offEvent?.("safeAreaChanged", onSafeAreaChanged);
            webApp.offEvent?.("contentSafeAreaChanged", onContentSafeAreaChanged);
            cleanupTelegramFullscreen = null;
          };
          cleanupTelegramFullscreen = cleanup;
          try {
            webApp.onEvent("fullscreenChanged", onFullscreenChanged);
            webApp.onEvent("fullscreenFailed", onFullscreenFailed);
            webApp.onEvent("safeAreaChanged", onSafeAreaChanged);
            webApp.onEvent("contentSafeAreaChanged", onContentSafeAreaChanged);
            if (supportsFullscreen) webApp.requestFullscreen?.();
            else webApp.expand();
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
        if (!nextSnapshot.settings.aiOnboardingCompleted) {
          setGuidedAiOnboarding(true);
          setShowAiProviders(true);
        }
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

  const handleTelegramBack = useCallback(() => {
    if (pendingRef.current) return;
    if (showAiQuotas) {
      setShowAiQuotas(false);
      return;
    }
    if (showAiProviders) {
      setShowAiProviders(false);
      return;
    }
    if (editor) {
      if (editorBackHandlerRef.current) editorBackHandlerRef.current();
      else setEditor(null);
      return;
    }
    appBackHandlerRef.current?.();
  }, [editor, showAiProviders, showAiQuotas]);

  useEffect(() => {
    telegramBackHandlerRef.current = handleTelegramBack;
  }, [handleTelegramBack]);

  useEffect(() => {
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton?.onClick || !backButton.offClick) return;
    const onClick = () => telegramBackHandlerRef.current();
    backButton.onClick(onClick);
    return () => {
      backButton.offClick?.(onClick);
      try {
        backButton.hide?.();
      } catch {
        // BackButton teardown is best-effort on Telegram clients.
      }
    };
  }, []);

  useEffect(() => {
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton) return;
    try {
      if (status === "ready" && (showAiQuotas || showAiProviders || editor || hasAppBackState)) backButton.show?.();
      else backButton.hide?.();
    } catch {
      // Telegram BackButton support varies by client version.
    }
  }, [editor, hasAppBackState, showAiProviders, showAiQuotas, status]);

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
      triggerTelegramHaptic("success");

      if (!keepOpen) setEditor(null);
      try {
        setSnapshot(await fetchSnapshot(initData, selectedDate ?? snapshot?.localDate));
      } catch {
        setError("Изменение принято сервером, но обновить данные не удалось. Повторите загрузку.");
      }
      return true;
    } catch (cause) {
      triggerTelegramHaptic("error");
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [configured, initData, selectedDate, snapshot]);

  const openEditor = useCallback((nextEditor: EditorState) => {
    triggerTelegramHaptic("selection");
    setError(null);
    setEditor(nextEditor);
  }, []);

  const closeAiQuotas = useCallback(() => setShowAiQuotas(false), []);
  const closeAiProviders = useCallback(() => {
    setShowAiProviders(false);
    setGuidedAiOnboarding(false);
  }, []);
  const registerAppBackHandler = useCallback((handler: (() => void) | null) => {
    appBackHandlerRef.current = handler;
    setHasAppBackState(Boolean(handler));
  }, []);
  const registerEditorBackHandler = useCallback((handler: (() => void) | null) => {
    editorBackHandlerRef.current = handler;
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
      case "finance.plan.add": openEditor({ kind: "finance-plan" }); return;
      case "finance.plan.edit": {
        const plan = snapshot.finance.plans.find((item) => item.id === action.id);
        if (plan) openEditor({ kind: "finance-plan", plan });
        else setError("План уже изменился. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "finance.plan.delete": {
        const plan = snapshot.finance.plans.find((item) => item.id === action.id);
        if (plan) openEditor({ kind: "delete-finance-plan", id: plan.id, label: plan.name });
        else setError("План уже изменился. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "finance.plan.purchase": {
        const plan = snapshot.finance.plans.find((item) => item.id === action.id);
        if (plan) openEditor({ kind: "finance-plan-purchase", plan });
        else setError("План уже изменился. Обновите данные и попробуйте ещё раз.");
        return;
      }
      case "finance.debt.add": openEditor({ kind: "debt-create" }); return;
      case "finance.debt.repay": {
        const debt = snapshot.finance.debts.find((item) => item.id === action.id);
        if (debt) openEditor({ kind: "debt-repayment", debt });
        else setError("Долг уже изменился. Обновите данные и попробуйте ещё раз.");
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
    if (status === "checking" || status === "loading") {
      return (
        <MotionProvider>
          <main className="lifeos-boot-loading" aria-busy="true">
            <span className="visually-hidden" role="status" aria-live="polite">Загружаю LifeOS.</span>
            <LifeOSBootSkeleton fullscreen={telegramFullscreen} safeAreaTop={telegramSafeAreaTop} contentSafeAreaTop={telegramContentSafeAreaTop} />
          </main>
        </MotionProvider>
      );
    }

    const message = status === "outside"
      ? "Откройте Mini App через Telegram, чтобы войти в LifeOS."
      : status === "setup"
        ? "LifeOS ещё не настроен на сервере. Проверьте подключение базы данных и Telegram-бота."
        : status === "error"
          ? error ?? "Не удалось загрузить данные."
          : "LifeOS сейчас недоступен.";
    return (
      <MotionProvider>
        <main className="setup-notice" role={status === "error" ? "alert" : "status"} aria-live="polite">
          <p>{message}</p>
          {status === "error" && initData && <button type="button" onClick={() => void retryLoad()}>Повторить загрузку</button>}
        </main>
      </MotionProvider>
    );
  }

  const showGlobalError = error && !editor;
  return (
    <MotionProvider>
      <>
        <AnimatePresence initial={false}>
          {showGlobalError && <motion.p key="lifeos-error" className="app-notice" role="alert" variants={motionVariants.state} initial="initial" animate="animate" exit="exit">{error}</motion.p>}
        </AnimatePresence>
        <LifeOSApp
          snapshot={snapshot}
          onAction={handleAction}
          onOpenAiProviders={() => { setGuidedAiOnboarding(false); setShowAiProviders(true); }}
          onDateChange={(date) => void changeDate(date)}
          onHaptic={triggerTelegramHaptic}
          onRegisterTelegramBackHandler={registerAppBackHandler}
          fullscreen={telegramFullscreen}
          safeAreaTop={telegramSafeAreaTop}
          contentSafeAreaTop={telegramContentSafeAreaTop}
        />
        <AnimatePresence initial={false}>
          {showAiProviders && initData && <AiProvidersPanel key="ai-providers" initData={initData} guidedOnboarding={guidedAiOnboarding} onClose={closeAiProviders} onOpenQuotas={() => { setShowAiProviders(false); setGuidedAiOnboarding(false); setShowAiQuotas(true); }} />}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {showAiQuotas && initData && <AiQuotasPanel key="ai-quotas" initData={initData} onClose={closeAiQuotas} />}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {editor && <EditorDialog key={editorIdentity(editor)} editor={editor} snapshot={snapshot} pending={pending} error={error} onClose={() => setEditor(null)} onChange={openEditor} onCommand={sendCommand} onRegisterTelegramBackHandler={registerEditorBackHandler} />}
        </AnimatePresence>
        <AnimatePresence>
          {snapshot.activeSession && (
            <motion.button key="finish-session" type="button" className="finish-session-button" style={finishButtonStyle} disabled={pending} onClick={() => void sendCommand({ type: "session.finish", id: snapshot.activeSession!.id })} initial={{ opacity: 0, transform: "translate(-50%, 12px) scale(.98)" }} animate={{ opacity: 1, transform: "translate(-50%, 0px) scale(1)" }} exit={{ opacity: 0, transform: "translate(-50%, 12px) scale(.98)" }} transition={{ type: "tween", duration: motionDuration.enter, ease: motionEase.out }}>
              {pending ? "Сохраняю…" : "Завершить тренировку"}
            </motion.button>
          )}
        </AnimatePresence>
      </>
    </MotionProvider>
  );
}

export default LifeOSRoot;
