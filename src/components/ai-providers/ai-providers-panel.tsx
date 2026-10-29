"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GlassRefraction } from "@/components/glass/glass-refraction";
import styles from "./ai-providers-panel.module.css";

type ProviderProfile = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  enabled: boolean;
  sortOrder: number;
  hasApiKey: boolean;
};

type ProviderForm = {
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
};

type AiProvidersPanelProps = {
  initData: string;
  onClose(): void;
  onOpenQuotas?(): void;
};

type LoadState = "loading" | "ready" | "error";

const emptyForm: ProviderForm = { name: "", endpoint: "", model: "", apiKey: "" };

function isProfile(value: unknown): value is ProviderProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<ProviderProfile>;
  return typeof profile.id === "string"
    && typeof profile.name === "string"
    && typeof profile.endpoint === "string"
    && typeof profile.model === "string"
    && typeof profile.enabled === "boolean"
    && typeof profile.sortOrder === "number"
    && typeof profile.hasApiKey === "boolean";
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" && value.error.trim()) {
    return value.error;
  }
  return fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function requestError(response: Response, body: unknown): string {
  if (response.status === 401 || response.status === 403) {
    return "Не удалось подтвердить Telegram-сессию. Закрой Mini App и открой его снова из бота.";
  }
  if (response.status === 429) return "Слишком много запросов подряд. Попробуй ещё раз чуть позже.";
  if (response.status >= 500) return "Сервер временно недоступен. Попробуй ещё раз.";
  return errorMessage(body, "Не удалось выполнить запрос. Проверь данные и попробуй ещё раз.");
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "Не удалось связаться с сервером. Проверь подключение и попробуй ещё раз.";
  return error instanceof Error ? error.message : fallback;
}

export function AiProvidersPanel({ initData, onClose, onOpenQuotas }: AiProvidersPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const filterId = `lifeos-provider-glass-${id}`;
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [legacyQuotaAvailable, setLegacyQuotaAvailable] = useState(false);

  const authorization = `tma ${initData}`;

  const reloadProfiles = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/ai-providers", {
        headers: { Authorization: authorization },
        cache: "no-store",
        signal,
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      if (typeof body !== "object" || body === null || !("profiles" in body) || !Array.isArray(body.profiles) || !body.profiles.every(isProfile)) {
        throw new Error("Сервер вернул список провайдеров в неожиданном формате.");
      }
      setProfiles(body.profiles.slice().sort((left, right) => left.sortOrder - right.sortOrder));
      setLegacyQuotaAvailable("legacyQuotaAvailable" in body && body.legacyQuotaAvailable === true);
      setLoadState("ready");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      setLoadError(readableError(error, "Не удалось загрузить провайдеры. Попробуй ещё раз."));
      setLoadState("error");
      return false;
    }
  }, [authorization]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => reloadProfiles(controller.signal));
    return () => controller.abort();
  }, [reloadProfiles]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError("");
  };

  const editProfile = (profile: ProviderProfile) => {
    setEditingId(profile.id);
    setForm({ name: profile.name, endpoint: profile.endpoint, model: profile.model, apiKey: "" });
    setFormError("");
    setNotice("");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyAction) return;
    const name = form.name.trim();
    const endpoint = form.endpoint.trim();
    const model = form.model.trim();
    const apiKey = form.apiKey.trim();
    if (!name || !endpoint || !model) {
      setFormError("Заполни название, endpoint и модель.");
      return;
    }
    try {
      if (new URL(endpoint).protocol !== "https:") {
        setFormError("Endpoint должен использовать HTTPS.");
        return;
      }
    } catch {
      setFormError("Укажи корректный URL endpoint.");
      return;
    }
    if (!editingId && !apiKey) {
      setFormError("Для нового провайдера нужен API-ключ.");
      return;
    }

    setBusyAction("save");
    setFormError("");
    setNotice("");
    try {
      const editingProfile = profiles.find((profile) => profile.id === editingId);
      const response = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          name,
          endpoint,
          model,
          ...(apiKey ? { apiKey } : {}),
          enabled: editingProfile?.enabled ?? true,
          sortOrder: editingProfile?.sortOrder ?? profiles.length,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      resetForm();
      setNotice("Профиль сохранён.");
      const refreshed = await reloadProfiles();
      if (!refreshed) setNotice("Профиль сохранён, но список не обновился. Нажми «Повторить».");
    } catch (error) {
      setFormError(readableError(error, "Не удалось сохранить профиль. Попробуй ещё раз."));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleProfile = async (profile: ProviderProfile) => {
    if (busyAction) return;
    const action = `toggle:${profile.id}`;
    setBusyAction(action);
    setLoadError("");
    setNotice("");
    try {
      const response = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profile.id,
          name: profile.name,
          endpoint: profile.endpoint,
          model: profile.model,
          enabled: !profile.enabled,
          sortOrder: profile.sortOrder,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      setProfiles((current) => current.map((item) => item.id === profile.id ? { ...item, enabled: !item.enabled } : item));
      setNotice(profile.enabled ? `${profile.name} выключен.` : `${profile.name} включён.`);
    } catch (error) {
      setLoadError(readableError(error, "Не удалось изменить состояние провайдера."));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteProfile = async (profile: ProviderProfile) => {
    if (busyAction) return;
    const action = `delete:${profile.id}`;
    setBusyAction(action);
    setLoadError("");
    setNotice("");
    try {
      const response = await fetch(`/api/ai-providers?id=${encodeURIComponent(profile.id)}`, {
        method: "DELETE",
        headers: { Authorization: authorization },
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (editingId === profile.id) resetForm();
      setConfirmDeleteId(null);
      setNotice(`${profile.name} удалён.`);
    } catch (error) {
      setLoadError(readableError(error, "Не удалось удалить профиль."));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={surfaceRef} className={styles.sheet} data-lg-role="focus">
        <GlassRefraction surfaceRef={surfaceRef} filterId={filterId} profile="soft" />
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ ИИ</p>
            <h2 id={`${id}-title`}>API-провайдеры</h2>
          </div>
          <button ref={closeRef} className={styles.close} type="button" aria-label="Закрыть настройки провайдеров" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className={styles.scrollArea} aria-busy={loadState === "loading"}>
          <p className={styles.intro}>Добавь любой endpoint, совместимый с OpenAI Chat Completions, и укажи модель из его каталога.</p>
          {onOpenQuotas && legacyQuotaAvailable && <button className={styles.quotasLink} type="button" onClick={onOpenQuotas}>Квоты Gemini</button>}

          <form ref={formRef} className={styles.form} onSubmit={submitForm}>
            <div className={styles.formHeading}>
              <h3>{editingId ? "Изменить провайдера" : "Новый провайдер"}</h3>
              {editingId && <button type="button" className={styles.textButton} onClick={resetForm}>Отмена</button>}
            </div>
            <label className={styles.field}>
              <span>Название</span>
              <input autoComplete="organization" name="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например, OpenRouter" maxLength={80} required />
            </label>
            <label className={styles.field}>
              <span>Endpoint</span>
              <input autoComplete="url" name="endpoint" type="url" value={form.endpoint} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://openrouter.ai/api/v1" required />
              <small>Базовый URL совместимого провайдера; LifeOS добавит путь Chat Completions. Используй HTTPS.</small>
            </label>
            <label className={styles.field}>
              <span>Модель</span>
              <input autoComplete="off" name="model" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="Например, gpt-4o-mini" maxLength={160} required />
            </label>
            <label className={styles.field}>
              <span>API-ключ</span>
              <input autoComplete="new-password" name="apiKey" type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={editingId ? "Оставь пустым, чтобы не менять ключ" : "Введи API-ключ"} required={!editingId} />
            </label>
            <p className={styles.securityNote}>Ключ хранится зашифрованно и никогда не отображается обратно. При редактировании оставь поле пустым, чтобы сохранить текущий ключ.</p>
            {formError && <p className={styles.error} role="alert">{formError}</p>}
            <button className={styles.primaryAction} type="submit" disabled={busyAction !== null}>
              {busyAction === "save" ? "Сохраняю…" : editingId ? "Сохранить изменения" : "Добавить провайдера"}
            </button>
          </form>

          <section className={styles.profilesSection} aria-labelledby={`${id}-saved-title`}>
            <div className={styles.listHeading}>
              <div>
                <p className={styles.eyebrow}>ТВОЯ ЦЕПОЧКА ИИ</p>
                <h3 id={`${id}-saved-title`}>Сохранённые профили</h3>
              </div>
              {loadState === "ready" && <span className={styles.count}>{profiles.length}</span>}
            </div>

            {loadState === "loading" && <p className={styles.message} role="status">Загружаю профили…</p>}
            {loadState === "error" && (
              <div className={styles.state} role="alert">
                <p>{loadError || "Не удалось загрузить профили."}</p>
                <button type="button" className={styles.secondaryAction} onClick={() => void reloadProfiles()} disabled={busyAction !== null}>Повторить</button>
              </div>
            )}
            {loadState === "ready" && profiles.length === 0 && <p className={styles.empty}>Пока нет профилей. Добавь первый — после этого LifeOS сможет обращаться к ИИ от твоего имени.</p>}
            {loadState === "ready" && profiles.length > 0 && (
              <ul className={styles.profileList}>
                {profiles.map((profile) => {
                  const deleting = confirmDeleteId === profile.id;
                  const toggling = busyAction === `toggle:${profile.id}`;
                  const deletingNow = busyAction === `delete:${profile.id}`;
                  return (
                    <li key={profile.id} className={styles.profile}>
                      <div className={styles.profileTop}>
                        <div className={styles.profileIdentity}>
                          <div className={styles.profileNameLine}>
                            <h4>{profile.name}</h4>
                            <span className={profile.enabled ? styles.statusEnabled : styles.statusDisabled}>{profile.enabled ? "Включён" : "Выключен"}</span>
                          </div>
                          <p className={styles.model}>{profile.model}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={profile.enabled}
                          aria-label={`${profile.enabled ? "Выключить" : "Включить"} ${profile.name}`}
                          className={`${styles.switch} ${profile.enabled ? styles.switchOn : ""}`}
                          onClick={() => void toggleProfile(profile)}
                          disabled={busyAction !== null}
                        >
                          <span />
                        </button>
                      </div>
                      <p className={styles.endpoint}>{profile.endpoint}</p>
                      <p className={styles.keyState}>{profile.hasApiKey ? "API-ключ сохранён" : "API-ключ не задан"}</p>
                      {deleting ? (
                        <div className={styles.deleteConfirm}>
                          <p>Удалить профиль и его ключ?</p>
                          <div>
                            <button type="button" className={styles.dangerAction} onClick={() => void deleteProfile(profile)} disabled={busyAction !== null}>{deletingNow ? "Удаляю…" : "Удалить"}</button>
                            <button type="button" className={styles.textButton} onClick={() => setConfirmDeleteId(null)} disabled={busyAction !== null}>Отмена</button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.profileActions}>
                          <button type="button" className={styles.secondaryAction} onClick={() => editProfile(profile)} disabled={busyAction !== null || toggling}>Изменить</button>
                          <button type="button" className={styles.textButton} onClick={() => { setConfirmDeleteId(profile.id); setNotice(""); }} disabled={busyAction !== null}>Удалить</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {loadError && loadState === "ready" && <p className={styles.error} role="alert">{loadError}</p>}
        </div>
      </section>
    </dialog>
  );
}
