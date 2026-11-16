/** Remaining debt in minor units: the original amount minus every repayment, never below zero. */
export function debtRemainingMinor(originalMinor: number, repaymentsMinor: readonly number[]): number {
  return Math.max(0, originalMinor - repaymentsMinor.reduce((sum, value) => sum + value, 0));
}

/**
 * First line of a due-debt reminder, or null when nothing should be sent today: a debt is announced on its due date
 * and, once overdue, only repeated weekly and worded as overdue instead of «Сегодня срок возврата».
 */
export function debtReminderHeadline(
  direction: "i_owe" | "owed_to_me",
  personName: string,
  dueOn: string,
  localDate: string,
): string | null {
  if (dueOn > localDate) return null;
  if (dueOn === localDate) {
    return direction === "i_owe"
      ? `Сегодня срок возврата долга ${personName}`
      : `Сегодня срок, когда ${personName} должен вернуть долг`;
  }
  const daysLate = Math.round((Date.parse(localDate) - Date.parse(dueOn)) / 86_400_000);
  if (daysLate % 7 !== 0) return null;
  return direction === "i_owe" ? `Просрочен возврат долга ${personName}` : `Просрочен долг: ${personName} не вернул вовремя`;
}
