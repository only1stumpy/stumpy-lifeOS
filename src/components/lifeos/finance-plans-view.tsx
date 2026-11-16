"use client";

import { formatMoney } from "@/domain/currencies";
import styles from "./finance-plans-view.module.css";

export type FinancePlanViewItem = {
  id: string;
  name: string;
  amountMinor: number;
};

type FinancePlansViewProps = {
  plans: FinancePlanViewItem[];
  /** The base currency: plans are always kept in it. */
  currency: string;
  onAdd(): void;
  onEdit(plan: FinancePlanViewItem): void;
  onDelete(id: string): void;
  onPurchase(plan: FinancePlanViewItem): void;
};


function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function EditIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16.5-.7 4.2 4.2-.7L19.7 7.8a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.8 6.7 2.5 2.5" /></svg>;
}

function DeleteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" /></svg>;
}

export default function FinancePlansView({ plans, currency, onAdd, onEdit, onDelete, onPurchase }: FinancePlansViewProps) {
  const total = plans.reduce((sum, plan) => sum + Math.abs(plan.amountMinor), 0);

  return (
    <section className={styles.plansView} aria-labelledby="finance-plans-heading">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Будущие покупки</span>
          <h2 id="finance-plans-heading">Планы покупок</h2>
        </div>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          <PlusIcon />
          Добавить в план
        </button>
      </header>

      {plans.length ? (
        <div className={styles.planCollection}>
          <div className={styles.totalLine}>
            <span>Всего запланировано</span>
            <strong>{formatMoney(total, currency)}</strong>
          </div>
          <ul className={styles.planList}>
            {plans.map((plan) => (
              <li className={styles.planRow} key={plan.id}>
                <div className={styles.planDetails}>
                  <strong className={styles.planName}>{plan.name}</strong>
                  <span className={styles.planAmount}>{formatMoney(plan.amountMinor, currency)}</span>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.purchaseButton}
                    aria-label={`Записать расход: ${plan.name}`}
                    onClick={() => onPurchase(plan)}
                  >
                    Записать расход
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Изменить план: ${plan.name}`}
                    onClick={() => onEdit(plan)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Удалить план: ${plan.name}`}
                    onClick={() => onDelete(plan.id)}
                  >
                    <DeleteIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={styles.emptyState}>
          <h3>Пока ничего не запланировано</h3>
          <p>Добавь будущую покупку. Она не изменит баланс и расходы, пока ты отдельно не запишешь её как расход.</p>
        </div>
      )}
    </section>
  );
}
