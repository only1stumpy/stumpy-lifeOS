"use client";

import { PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
import styles from "./consent.module.css";

/** Shown before anything else until the current privacy policy is accepted. */
export function ConsentScreen({ pending, error, onAccept }: { pending: boolean; error: string | null; onAccept(): void }) {
  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>Перед началом</h1>
      <p className={styles.lead}>LifeOS хранит ваши данные, чтобы вести питание, финансы и тренировки. Коротко о главном:</p>
      <ul className={styles.list}>
        <li>Хранятся ваши записи о питании, весе, деньгах, долгах и тренировках, а также ключи ИИ в зашифрованном виде.</li>
        <li>ИИ получает только то, что вы сами отправили боту или в форму, и работает по вашим собственным ключам.</li>
        <li>Данные видны только вам. Вы можете получить копию или удалить всё в любой момент: Настройки, Данные и приватность.</li>
      </ul>
      <p className={styles.lead}>
        Продолжая, вы принимаете <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">политику конфиденциальности</a> (версия {PRIVACY_POLICY_VERSION}).
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="button" className={styles.accept} disabled={pending} onClick={onAccept}>Принимаю</button>
    </main>
  );
}
