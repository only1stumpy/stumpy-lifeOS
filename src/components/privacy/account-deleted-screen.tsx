import { Button } from "@/components/ui";
import styles from "./account-deleted-screen.module.css";

/** Shown after the account is deleted: a full reload resets every screen state and loads a fresh snapshot (consent screen next). */
export function AccountDeletedScreen({ onRestart }: { onRestart(): void }) {
  return (
    <main className={styles.page} role="status" aria-live="polite">
      <div className={styles.inner}>
        <h1 className={styles.title}>Все данные удалены</h1>
        <p className={styles.text}>Записи, настройки и ключи ИИ стёрты. Чтобы вернуться, начни знакомство заново: профиль создастся с нуля.</p>
        <Button variant="primary" size="lg" fullWidth onClick={onRestart}>Начать заново</Button>
      </div>
    </main>
  );
}
