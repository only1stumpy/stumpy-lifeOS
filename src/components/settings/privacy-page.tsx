"use client";

import { useState } from "react";
import type { AppSnapshot } from "@/domain/app";
import { DELETE_CONFIRMATION_WORD, PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
import styles from "./settings.module.css";

/** Data and privacy: where the policy lives, a copy of the data, and permanent deletion. */
export function PrivacyPage({ snapshot, pending, onSendExport, onDelete }: {
  snapshot: AppSnapshot;
  pending: boolean;
  onSendExport(): Promise<boolean>;
  onDelete(): Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const accepted = snapshot.settings.privacyAcceptedVersion;
  const canDelete = typed.trim().toUpperCase() === DELETE_CONFIRMATION_WORD && !pending;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Данные и приватность</h1>
      <p className={styles.hint}>
        Вы приняли политику конфиденциальности версии {accepted ?? "—"}. Текущая версия: {PRIVACY_POLICY_VERSION}.{" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">Открыть политику</a>.
      </p>

      <section className={styles.section} aria-labelledby="export-heading">
        <h2 id="export-heading">Копия данных</h2>
        <p className={styles.hint}>Бот пришлёт в чат файл JSON со всеми вашими записями: питание, финансы, зал и настройки. Ключи ИИ в файл не попадают. Отправка возможна не чаще пяти раз в час.</p>
        <button type="button" className={styles.save} disabled={pending} onClick={() => void onSendExport()}>Отправить копию в чат</button>
      </section>

      <section className={styles.section} aria-labelledby="delete-heading">
        <h2 id="delete-heading">Удаление данных</h2>
        {!confirming ? (
          <>
            <p className={styles.hint}>Все ваши записи, настройки и подключённые ключи ИИ будут удалены навсегда. Восстановить их будет нельзя.</p>
            <button type="button" className={styles.danger} disabled={pending} onClick={() => setConfirming(true)}>Удалить все данные</button>
          </>
        ) : (
          <>
            <p className={styles.hint} role="alert">Это действие необратимо: будут удалены питание, финансы, долги, тренировки, настройки и ключи ИИ. Сохраните копию данных заранее. Для подтверждения введите слово {DELETE_CONFIRMATION_WORD}.</p>
            <label className={styles.timeField}>
              <strong>Подтверждение</strong>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={DELETE_CONFIRMATION_WORD} />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.save} disabled={pending} onClick={() => { setConfirming(false); setTyped(""); }}>Отмена</button>
              <button type="button" className={styles.danger} disabled={!canDelete} onClick={() => void onDelete()}>Удалить навсегда</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
