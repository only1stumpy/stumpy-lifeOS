"use client";

import styles from "./finance-plans-view.module.css";

export type FinancePlanViewItem = {
  id: string;
  name: string;
  amountMinor: number;
  targetMonth: string;
};

type FinancePlansViewProps = {
  plans: FinancePlanViewItem[];
  onAdd(): void;
  onEdit(plan: FinancePlanViewItem): void;
  onDelete(id: string): void;
  onPurchase(plan: FinancePlanViewItem): void;
};

type MonthGroup = {
  month: string;
  monthIndex: number | null;
  plans: FinancePlanViewItem[];
};

const planAmountFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

function monthDetails(value: string): { label: string; index: number } | null {
  const match = /^(\d{4})-(\d{2})-01$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const date = new Date(year, month - 1, 1, 12);
  return {
    label: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date),
    index: year * 12 + month - 1,
  };
}

function currentMonthIndex(): number {
  const now = new Date();
  return now.getFullYear() * 12 + now.getMonth();
}

function moneyLabel(amountMinor: number): string {
  return `${planAmountFormat.format(Math.abs(amountMinor) / 100)} р. ПМР`;
}

function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function EditIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16.5-.7 4.2 4.2-.7L19.7 7.8a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.8 6.7 2.5 2.5" /></svg>;
}

function DeleteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" /></svg>;
}

export default function FinancePlansView({ plans, onAdd, onEdit, onDelete, onPurchase }: FinancePlansViewProps) {
  const groupsByMonth = new Map<string, MonthGroup>();
  for (const plan of plans) {
    const group = groupsByMonth.get(plan.targetMonth);
    if (group) {
      group.plans.push(plan);
    } else {
      groupsByMonth.set(plan.targetMonth, {
        month: plan.targetMonth,
        monthIndex: monthDetails(plan.targetMonth)?.index ?? null,
        plans: [plan],
      });
    }
  }

  const thisMonth = currentMonthIndex();
  const groups = [...groupsByMonth.values()].sort((a, b) => {
    if (a.monthIndex === null) return b.monthIndex === null ? 0 : 1;
    if (b.monthIndex === null) return -1;

    const aIsUpcoming = a.monthIndex >= thisMonth;
    const bIsUpcoming = b.monthIndex >= thisMonth;
    if (aIsUpcoming !== bIsUpcoming) return aIsUpcoming ? -1 : 1;
    return aIsUpcoming ? a.monthIndex - b.monthIndex : b.monthIndex - a.monthIndex;
  });

  return (
    <section className={styles.plansView} aria-labelledby="finance-plans-heading">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>БУДУЩИЕ ПОКУПКИ</span>
          <h2 id="finance-plans-heading">Планы покупок</h2>
        </div>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          <PlusIcon />
          Добавить в план
        </button>
      </header>

      {groups.length ? (
        <div className={styles.monthList}>
          {groups.map((group) => {
            const details = monthDetails(group.month);
            const heading = details?.label ?? "Месяц не указан";
            const subtotal = group.plans.reduce((sum, plan) => sum + Math.abs(plan.amountMinor), 0);

            return (
              <section className={styles.monthGroup} key={group.month} aria-label={heading}>
                <div className={styles.monthHeading}>
                  <h3>{heading}</h3>
                  <p className={styles.subtotal}>Итого <strong>{moneyLabel(subtotal)}</strong></p>
                </div>
                <ul className={styles.planList}>
                  {group.plans.map((plan) => (
                    <li className={styles.planRow} key={plan.id}>
                      <div className={styles.planDetails}>
                        <strong className={styles.planName}>{plan.name}</strong>
                        <span className={styles.planAmount}>{moneyLabel(plan.amountMinor)}</span>
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
              </section>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <h3>Пока ничего не запланировано</h3>
          <p>Добавьте будущую покупку. Она не изменит баланс и расходы, пока вы отдельно не запишете её как расход.</p>
        </div>
      )}
    </section>
  );
}
