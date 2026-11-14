"use client";

import type { ReactNode } from "react";
import styles from "./settings.module.css";

export type SettingsPage = "menu" | "ai" | "personalization";

const ITEMS: { page: Exclude<SettingsPage, "menu">; title: string; description: string }[] = [
  { page: "personalization", title: "Персонализация", description: "Разделы и функции, сводки и напоминания." },
  { page: "ai", title: "ИИ-провайдеры", description: "Ключи и модели, которыми бот разбирает сообщения." },
];

export function SettingsMenu({ onOpen }: { onOpen(page: Exclude<SettingsPage, "menu">): void }) {
  return (
    <nav className={styles.menu} aria-label="Настройки">
      {ITEMS.map((item) => (
        <button key={item.page} type="button" className={styles.menuItem} onClick={() => onOpen(item.page)}>
          <strong>{item.title}</strong>
          <span>{item.description}</span>
        </button>
      ))}
    </nav>
  );
}

/** A settings page opened from the menu, with a way back. */
export function SettingsSubpage({ onBack, children }: { onBack(): void; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <button type="button" className={styles.backButton} onClick={onBack}>‹ Настройки</button>
      {children}
    </div>
  );
}
