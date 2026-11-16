"use client";

import { formatMoney } from "@/domain/currencies";
import styles from "./finance-debts-view.module.css";

export type FinanceDebtViewItem = {
  id: string;
  personName: string;
  direction: "i_owe" | "owed_to_me";
  originalAmountMinor: number;
  remainingAmountMinor: number;
  dueOn: string | null;
  note: string | null;
  createdAt: string;
  repayments: { id: string; amountMinor: number; occurredAt: string }[];
};

type FinanceDebtsViewProps = {
  debts: FinanceDebtViewItem[];
  /** The base currency: debts are always kept in it. */
  currency: string;
  onAdd(): void;
  onRepay(debt: FinanceDebtViewItem): void;
  onDelete(debt: FinanceDebtViewItem): void;
  onDeleteRepayment(id: string): void;
};


function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function DebtGroup({
  title,
  description,
  direction,
  debts,
  currency,
  onRepay,
  onDelete,
  onDeleteRepayment,
}: {
  title: string;
  description: string;
  direction: FinanceDebtViewItem["direction"] | "closed";
  debts: FinanceDebtViewItem[];
  currency: string;
  onRepay(debt: FinanceDebtViewItem): void;
  onDelete(debt: FinanceDebtViewItem): void;
  onDeleteRepayment(id: string): void;
}) {
  const total = debts.reduce((sum, debt) => sum + debt.remainingAmountMinor, 0);

  return (
    <section className={styles.group} aria-label={title}>
      <header className={styles.groupHeader}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <strong className={styles.groupTotal}>{formatMoney(total, currency)}</strong>
      </header>
      {debts.length ? (
        <ul className={styles.debtList}>
          {debts.map((debt) => (
            <li className={styles.debtRow} key={debt.id}>
              <div className={styles.debtHeading}>
                <div className={styles.debtIdentity}>
                  <strong>{debt.personName}</strong>
                  <span>{debt.direction === "i_owe" ? "Я должен" : "Мне должны"}</span>
                </div>
                <div className={styles.amounts}>
                  <strong className={styles.remaining}>{formatMoney(debt.remainingAmountMinor, currency)}</strong>
                  <span className={styles.original}>из {formatMoney(debt.originalAmountMinor, currency)}</span>
                </div>
              </div>
              <div className={styles.debtMeta}>
                {debt.dueOn && <span>Срок · {dateLabel(debt.dueOn)}</span>}
                {debt.note && <p>{debt.note}</p>}
              </div>
              {debt.repayments.length > 0 && (
                <ul className={styles.repaymentList} aria-label="Возвраты">
                  {debt.repayments.map((repayment) => (
                    <li key={repayment.id}>
                      <span>{dateLabel(repayment.occurredAt)} · {formatMoney(repayment.amountMinor, currency)}</span>
                      <button type="button" className={styles.linkButton} aria-label={`Удалить возврат ${formatMoney(repayment.amountMinor, currency)}`} onClick={() => onDeleteRepayment(repayment.id)}>Удалить</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.rowActions}>
                {debt.remainingAmountMinor > 0 && (
                  <button type="button" className={styles.repayButton} onClick={() => onRepay(debt)}>
                    {debt.direction === "i_owe" ? "Записать возврат" : "Записать получение"}
                  </button>
                )}
                <button type="button" className={styles.linkButton} aria-label={`Удалить долг: ${debt.personName}`} onClick={() => onDelete(debt)}>Удалить долг</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.groupEmpty}>{direction === "i_owe" ? "Ты никому не должен." : "Открытых долгов в твою пользу пока нет."}</p>
      )}
    </section>
  );
}

export default function FinanceDebtsView({ debts, currency, onAdd, onRepay, onDelete, onDeleteRepayment }: FinanceDebtsViewProps) {
  const owedByMe = debts.filter((debt) => debt.direction === "i_owe" && debt.remainingAmountMinor > 0);
  const owedToMe = debts.filter((debt) => debt.direction === "owed_to_me" && debt.remainingAmountMinor > 0);
  const closed = debts.filter((debt) => debt.remainingAmountMinor <= 0);
  const totalOwedByMe = owedByMe.reduce((sum, debt) => sum + debt.remainingAmountMinor, 0);
  const totalOwedToMe = owedToMe.reduce((sum, debt) => sum + debt.remainingAmountMinor, 0);

  return (
    <section className={styles.debtsView} aria-labelledby="finance-debts-heading">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Личные обязательства</span>
          <h2 id="finance-debts-heading">Долги</h2>
        </div>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Добавить долг
        </button>
      </header>

      <div className={styles.totals} aria-label="Итоги по долгам">
        <div className={styles.totalCard}>
          <span>Я должен</span>
          <strong>{formatMoney(totalOwedByMe, currency)}</strong>
        </div>
        <div className={styles.totalCard}>
          <span>Мне должны</span>
          <strong>{formatMoney(totalOwedToMe, currency)}</strong>
        </div>
      </div>

      <DebtGroup title="Я должен" description="Мои долги другим людям" direction="i_owe" debts={owedByMe} currency={currency} onRepay={onRepay} onDelete={onDelete} onDeleteRepayment={onDeleteRepayment} />
      <DebtGroup title="Мне должны" description="Деньги, которые должны вернуть мне" direction="owed_to_me" debts={owedToMe} currency={currency} onRepay={onRepay} onDelete={onDelete} onDeleteRepayment={onDeleteRepayment} />
      {closed.length > 0 && <DebtGroup title="Закрытые" description="Полностью возвращённые долги" direction="closed" debts={closed} currency={currency} onRepay={onRepay} onDelete={onDelete} onDeleteRepayment={onDeleteRepayment} />}
    </section>
  );
}
