"use client";

import { useState } from "react";
import type { AppSnapshot } from "@/domain/app";
import { DELETE_CONFIRMATION_WORD, PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION, SOURCE_CODE_URL, TERMS_URL } from "@/domain/privacy";
import styles from "./settings.module.css";

/** Data and privacy: where the policy lives, a copy of the data, and permanent deletion. */
/** Copy of the data and permanent deletion. Shared with the consent screen: these rights never depend on consent. */
export function DataRightsSections({ pending, onSendExport, onDelete }: { pending: boolean; onSendExport(): Promise<boolean>; onDelete(): Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const canDelete = typed.trim().toUpperCase() === DELETE_CONFIRMATION_WORD && !pending;

  return (
    <>
      <section className={styles.section} aria-labelledby="export-heading">
        <h2 id="export-heading">Копия данных</h2>
        <p className={styles.hint}>Бот пришлёт в чат файл JSON со всеми твоими записями: питание, финансы, зал и настройки. Ключи ИИ в файл не попадают. Отправка возможна не чаще пяти раз в час.</p>
        <button type="button" className={styles.save} disabled={pending} onClick={() => void onSendExport()}>Отправить копию в чат</button>
      </section>

      <section className={styles.section} aria-labelledby="delete-heading">
        <h2 id="delete-heading">Удаление данных</h2>
        {!confirming ? (
          <>
            <p className={styles.hint}>Все твои записи, настройки и подключённые ключи ИИ будут удалены навсегда. Восстановить их будет нельзя.</p>
            <button type="button" className={styles.danger} disabled={pending} onClick={() => setConfirming(true)}>Удалить все данные</button>
          </>
        ) : (
          <>
            <p className={styles.hint} role="alert">Это действие необратимо: будут удалены питание, финансы, долги, тренировки, настройки и ключи ИИ. Сохрани копию данных заранее. Для подтверждения введи слово {DELETE_CONFIRMATION_WORD}.</p>
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
    </>
  );
}

/** Data and privacy: where the policy lives, the health-data consent, a copy of the data, and permanent deletion. */
export function PrivacyPage({ snapshot, pending, onSendExport, onDelete, onRevokeHealth }: {
  snapshot: AppSnapshot;
  pending: boolean;
  onSendExport(): Promise<boolean>;
  onDelete(): Promise<boolean>;
  onRevokeHealth(): Promise<boolean>;
}) {
  const accepted = snapshot.settings.privacyAcceptedVersion;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Данные и приватность</h1>
      <p className={styles.hint}>
        Ты принял политику конфиденциальности версии {accepted ?? "—"}. Текущая версия: {PRIVACY_POLICY_VERSION}.{" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">Открыть политику</a>,{" "}
        <a href={TERMS_URL} target="_blank" rel="noreferrer">условия использования</a>.
      </p>

      <section className={styles.section} aria-labelledby="health-heading">
        <h2 id="health-heading">Согласие на данные о здоровье</h2>
        <p className={styles.hint}>Вес, питание (КБЖУ) и тренировки считаются данными о здоровье. Ты согласился на их обработку (версия {snapshot.settings.healthConsentVersion ?? "—"}). После отзыва LifeOS перестанет с ними работать, пока ты не согласишься снова. Записи останутся: их можно выгрузить или удалить.</p>
        <button type="button" className={styles.danger} disabled={pending} onClick={() => void onRevokeHealth()}>Отозвать согласие</button>
      </section>

      <DataRightsSections pending={pending} onSendExport={onSendExport} onDelete={onDelete} />

      <section className={styles.section} aria-labelledby="source-heading">
        <h2 id="source-heading">Исходный код</h2>
        <p className={styles.hint}>LifeOS распространяется по лицензии AGPL-3.0. <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">Исходный код (AGPL-3.0)</a>.</p>
      </section>
    </div>
  );
}
