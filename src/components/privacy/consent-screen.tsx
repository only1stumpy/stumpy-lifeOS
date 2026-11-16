"use client";

import { useState } from "react";
import { DataRightsSections } from "@/components/settings/privacy-page";
import { HEALTH_CONSENT_VERSION, PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION, TERMS_URL } from "@/domain/privacy";
import styles from "./consent.module.css";

/** Shown before anything else until the current policy, 18+ and the health-data consent are given. Export and deletion stay available. */
export function ConsentScreen({ pending, error, notice, onAccept, onSendExport, onDelete }: {
  pending: boolean;
  error: string | null;
  notice?: string | null;
  onAccept(): void;
  onSendExport(): Promise<boolean>;
  onDelete(): Promise<boolean>;
}) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [health, setHealth] = useState(false);
  const ready = adult && terms && health;

  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>Перед началом</h1>
      <p className={styles.lead}>LifeOS хранит твои данные, чтобы вести питание, финансы и тренировки. Коротко о главном:</p>
      <ul className={styles.list}>
        <li>Хранятся твои записи о питании, весе, деньгах, долгах и тренировках, а также ключи ИИ в зашифрованном виде.</li>
        <li>ИИ получает только то, что ты сам отправил боту или в форму, и работает по твоим собственным ключам.</li>
        <li>Данные видны только тебе. Копию или удаление можно получить в любой момент, даже без согласия.</li>
      </ul>
      <label className={styles.check}>
        <input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />
        <span>Мне исполнилось 18 лет.</span>
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
        <span>
          Я принимаю <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">политику конфиденциальности</a> (версия {PRIVACY_POLICY_VERSION}) и{" "}
          <a href={TERMS_URL} target="_blank" rel="noreferrer">условия использования</a>.
        </span>
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={health} onChange={(event) => setHealth(event.target.checked)} />
        <span>Я согласен на обработку данных о здоровье: вес, питание (КБЖУ) и тренировки (версия {HEALTH_CONSENT_VERSION}). Согласие можно отозвать в настройках.</span>
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.lead} role="status">{notice}</p>}
      <button type="button" className={styles.accept} disabled={pending || !ready} onClick={onAccept}>Принимаю</button>
      <div className={styles.rights}>
        <DataRightsSections pending={pending} onSendExport={onSendExport} onDelete={onDelete} />
      </div>
    </main>
  );
}
