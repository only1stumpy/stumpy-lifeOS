"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import { exerciseCatalog } from "@/domain/exercise-catalog";
import { parseMinor } from "@/domain/math";
import { suggestTargets } from "@/domain/nutrition";
import { ExerciseGuide } from "./exercise-guide";
import type { ExerciseSet, FoodLogEntry, MacroValues, MoneyAccount, MoneyEntry } from "@/domain/types";

export type EditorState =
  | { kind: "food"; entry?: FoodLogEntry }
  | { kind: "finance"; entry?: MoneyEntry }
  | { kind: "target" }
  | { kind: "weight" }
  | { kind: "accounts"; account?: MoneyAccount }
  | { kind: "recurring"; item?: AppSnapshot["recurring"][number] }
  | { kind: "program" }
  | { kind: "exercise"; dayId: string }
  | { kind: "set"; dayId: string; exerciseId: string; set: ExerciseSet }
  | { kind: "delete-food"; id: string; label: string }
  | { kind: "delete-money"; id: string; label: string };

type EditorDialogProps = {
  editor: EditorState;
  snapshot: AppSnapshot;
  pending: boolean;
  error: string | null;
  onClose(): void;
  onChange(editor: EditorState): void;
  onCommand(command: AppCommand, keepOpen?: boolean): Promise<boolean>;
};

const moneyDecimal = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function recordValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredNumber(form: FormData, name: string, label: string): number {
  const value = recordValue(form, name).replace(",", ".");
  if (!value) throw new Error(`Заполните поле «${label}».`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Проверьте поле «${label}».`);
  return parsed;
}

function optionalNumber(form: FormData, name: string, label: string): number | null {
  const value = recordValue(form, name).replace(",", ".");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Проверьте поле «${label}».`);
  return parsed;
}

function requiredText(form: FormData, name: string, label: string): string {
  const value = recordValue(form, name);
  if (!value) throw new Error(`Заполните поле «${label}».`);
  return value;
}

function localTimestamp(value: string): string {
  if (!value) throw new Error("Укажите дату и время.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Проверьте дату и время.");
  return date.toISOString();
}

function dateTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Укажите дату.");
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Проверьте дату.");
  return date.toISOString();
}

function localInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultDateTime(date: string): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = today === date
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "12:00";
  return `${date}T${time}:00`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function amountLabel(amountMinor: number, currency: "PRB" | "USD"): string {
  const amount = moneyDecimal.format(Math.abs(amountMinor) / 100);
  return currency === "USD" ? `${amount} $` : `${amount} р. ПМР`;
}

function signedAmountLabel(amountMinor: number, currency: "PRB" | "USD"): string {
  return `${amountMinor < 0 ? "−" : ""}${amountLabel(amountMinor, currency)}`;
}

function signedMinor(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error("Введите остаток с точностью до двух знаков.");
  const negative = normalized.startsWith("-");
  const magnitude = parseMinor(negative ? normalized.slice(1) : normalized);
  return negative ? -magnitude : magnitude;
}

function amountInput(amountMinor: number): string {
  const value = moneyDecimal.format(Math.abs(amountMinor) / 100);
  return amountMinor < 0 ? `-${value}` : value;
}

function MacroFields({ values }: { values?: { calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number } | null }) {
  return (
    <div className="fields-row">
      <label>Калории, ккал<input name="calories" type="number" min="0" max="100000" step="0.1" required defaultValue={values?.calories ?? ""} /></label>
      <label>Белки, г<input name="proteinGrams" type="number" min="0" max="100000" step="0.1" required defaultValue={values?.proteinGrams ?? ""} /></label>
      <label>Жиры, г<input name="fatGrams" type="number" min="0" max="100000" step="0.1" required defaultValue={values?.fatGrams ?? ""} /></label>
      <label>Углеводы, г<input name="carbsGrams" type="number" min="0" max="100000" step="0.1" required defaultValue={values?.carbsGrams ?? ""} /></label>
    </div>
  );
}

export function EditorDialog({ editor, snapshot, pending, error, onClose, onChange, onCommand }: EditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [suggestedTarget, setSuggestedTarget] = useState<MacroValues | null>(null);
  const [targetRevision, setTargetRevision] = useState(0);
  const [exerciseMode, setExerciseMode] = useState<"catalog" | "custom">("catalog");
  const [selectedCatalogId, setSelectedCatalogId] = useState(exerciseCatalog[0]?.id ?? "");
  const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => returnFocus?.focus());
    };
  }, []);

  const title = editorTitle(editor);
  const activeError = formError ?? error;
  const canGoBack = editor.kind === "program" && selectedDayId !== null;
  const backLabel = selectedReplacementId ? "Назад к упражнениям дня" : "Назад к тренировочным дням";

  function goBack() {
    if (!canGoBack) return;
    if (selectedReplacementId) {
      setSelectedReplacementId(null);
      return;
    }
    setSelectedDayId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>, build: (form: FormData) => AppCommand, keepOpen = false): Promise<boolean> {
    event.preventDefault();
    if (pending) return false;
    const formElement = event.currentTarget;
    setFormError(null);
    try {
      const succeeded = await onCommand(build(new FormData(formElement)), keepOpen);
      if (succeeded && keepOpen) formElement.reset();
      return succeeded;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Проверьте введённые данные.");
      return false;
    }
  }

  async function runCommand(command: AppCommand, keepOpen = false) {
    if (pending) return;
    setFormError(null);
    await onCommand(command, keepOpen);
  }

  function renderFoodForm(entry?: FoodLogEntry) {
    return (
      <>
        {!entry && (
          <>
            <form onSubmit={(event) => submitForm(event, (form) => ({ type: "analyze", text: requiredText(form, "text", "Что съели") }))}>
              <label>Запись сообщением<textarea name="text" rows={3} maxLength={10000} placeholder="Например: тарелка гречки с говядиной" required /></label>
              <div className="actions"><small>Оценка попадёт в черновики. Запись сохранится после подтверждения.</small><button className="submit" type="submit" disabled={pending}>Разобрать</button></div>
            </form>
            <hr />
          </>
        )}
        <form key={entry?.id ?? "new"} onSubmit={(event) => submitForm(event, (form) => ({
          type: "food.save",
          ...(entry ? { id: entry.id } : {}),
          label: requiredText(form, "label", "Название блюда"),
          portionLabel: requiredText(form, "portionLabel", "Порция"),
          occurredAt: localTimestamp(recordValue(form, "occurredAt")),
          estimated: form.get("estimated") === "on",
          calories: requiredNumber(form, "calories", "Калории"),
          proteinGrams: requiredNumber(form, "proteinGrams", "Белки"),
          fatGrams: requiredNumber(form, "fatGrams", "Жиры"),
          carbsGrams: requiredNumber(form, "carbsGrams", "Углеводы"),
        }))}>
          <label>Блюдо<input name="label" maxLength={300} required defaultValue={entry?.label ?? ""} placeholder="Например, гречка с говядиной" /></label>
          <label>Обычная порция<input name="portionLabel" maxLength={300} required defaultValue={entry?.portionLabel ?? ""} placeholder="Тарелка, два бутерброда, половина упаковки" /></label>
          <div className="fields-row">
            <label>Дата и время<input name="occurredAt" type="datetime-local" required defaultValue={localInputValue(entry?.occurredAt ?? defaultDateTime(snapshot.localDate))} /></label>
          </div>
          <MacroFields values={entry} />
          <label className="checkbox-row"><input name="estimated" type="checkbox" defaultChecked={entry?.estimated ?? false} /><span>КБЖУ указаны приблизительно</span></label>
          <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>{entry ? "Сохранить" : "Записать"}</button></div>
        </form>
        {entry && (
          <form className="template-save" onSubmit={(event) => submitForm(event, (form) => ({ type: "template.save", foodEntryId: entry.id, name: requiredText(form, "templateName", "Название обычного блюда") }), true)}>
            <hr />
            <label>Сохранить как обычное блюдо<input name="templateName" maxLength={300} defaultValue={entry.label} required /></label>
            <button type="submit" disabled={pending}>Сохранить блюдо</button>
          </form>
        )}
      </>
    );
  }

  function renderFinanceForm(entry?: MoneyEntry) {
    const accountForEntry = snapshot.finance.accounts.find((account) => account.id === entry?.accountId)
      ?? snapshot.finance.accounts.find((account) => account.id === snapshot.settings.defaultAccountId && account.currency === entry?.currency)
      ?? snapshot.finance.accounts.find((account) => account.currency === entry?.currency)
      ?? snapshot.finance.accounts.find((account) => account.id === snapshot.settings.defaultAccountId)
      ?? snapshot.finance.accounts[0];
    const initialAccountId = accountForEntry?.id ?? snapshot.settings.defaultAccountId ?? "";
    const entryAccountExists = !entry || snapshot.finance.accounts.some((account) => account.id === entry.accountId);
    return (
      <>
        {!entry && (
          <>
            <form onSubmit={(event) => submitForm(event, (form) => ({ type: "analyze", text: requiredText(form, "text", "Покупка или доход") }))}>
              <label>Быстрая запись<textarea name="text" rows={2} maxLength={10000} placeholder="Например: обед 80 рублей" required /></label>
              <div className="actions"><small>Сначала проверьте распознанную операцию.</small><button className="submit" type="submit" disabled={pending}>Разобрать</button></div>
            </form>
            <hr />
          </>
        )}
        {snapshot.finance.accounts.length === 0 ? (
          <div><p>Сначала добавьте счёт. Тогда можно будет сохранить операцию в нужной валюте.</p><button type="button" onClick={() => onChange({ kind: "accounts" })}>Добавить счёт</button></div>
        ) : !entryAccountExists ? (
          <p role="alert">Счёт этой операции не найден. Операцию нельзя безопасно изменить, пока счёт отсутствует.</p>
        ) : (
          <form key={entry?.id ?? "new"} onSubmit={(event) => submitForm(event, (form) => ({
            type: "money.save",
            ...(entry ? { id: entry.id } : {}),
            label: requiredText(form, "label", "Описание"),
            occurredAt: localTimestamp(recordValue(form, "occurredAt")),
            amountMinor: parseMinor(requiredText(form, "amount", "Сумма")),
            accountId: requiredText(form, "accountId", "Счёт"),
            category: requiredText(form, "category", "Категория"),
            kind: requiredText(form, "kind", "Тип операции") as "expense" | "income",
          }))}>
            <label>Описание<input name="label" maxLength={300} required defaultValue={entry?.label ?? ""} placeholder="Обед, зарплата, телефон" /></label>
            <div className="fields-row">
              <label>Сумма<input name="amount" type="text" inputMode="decimal" required defaultValue={entry ? moneyDecimal.format(entry.amountMinor / 100) : ""} placeholder="80,00" /></label>
              <label>Тип<select name="kind" defaultValue={entry?.kind ?? "expense"}><option value="expense">Расход</option><option value="income">Доход</option></select></label>
            </div>
            <label>Счёт<select name="accountId" defaultValue={initialAccountId}>{snapshot.finance.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency === "USD" ? "USD" : "руб. ПМР"}</option>)}</select></label>
            <label>Категория<input name="category" maxLength={300} required defaultValue={entry?.category ?? ""} placeholder="Еда, транспорт, подписки" /></label>
            <label>Дата и время<input name="occurredAt" type="datetime-local" required defaultValue={localInputValue(entry?.occurredAt ?? defaultDateTime(snapshot.localDate))} /></label>
            <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>{entry ? "Сохранить" : "Записать"}</button></div>
          </form>
        )}
      </>
    );
  }

  function renderTargetForm() {
    const target = snapshot.nutrition.target;
    function calculateTarget(event: MouseEvent<HTMLButtonElement>) {
      const form = event.currentTarget.form;
      if (!form) return;
      try {
        const values = new FormData(form);
        const nextTarget = suggestTargets({
          age: requiredNumber(values, "age", "Возраст"),
          heightCm: requiredNumber(values, "heightCm", "Рост"),
          weightKg: requiredNumber(values, "profileWeightKg", "Масса тела"),
          sex: requiredText(values, "sex", "Пол при расчёте") as "male" | "female",
          activityMultiplier: requiredNumber(values, "activityMultiplier", "Уровень активности"),
        });
        setFormError(null);
        setSuggestedTarget(nextTarget);
        setTargetRevision((revision) => revision + 1);
      } catch (cause) {
        setFormError(cause instanceof Error ? cause.message : "Проверьте параметры расчёта.");
      }
    }
    return (
      <form onSubmit={(event) => submitForm(event, (form) => ({
        type: "settings.save",
        timeZone: snapshot.settings.timeZone,
        target: {
          calories: requiredNumber(form, "calories", "Калории"),
          proteinGrams: requiredNumber(form, "proteinGrams", "Белки"),
          fatGrams: requiredNumber(form, "fatGrams", "Жиры"),
          carbsGrams: requiredNumber(form, "carbsGrams", "Углеводы"),
        },
      }))}>
        <p>Укажите дневную цель КБЖУ для набора массы. Значения можно изменить позже.</p>
        <details>
          <summary>Рассчитать стартовую цель по параметрам</summary>
          <p>Это редактируемая оценка с профицитом 10%. Параметры не сохраняются.</p>
          <div className="fields-row">
            <label>Возраст<input name="age" type="number" min="19" max="78" step="1" /></label>
            <label>Рост, см<input name="heightCm" type="number" min="100" max="250" step="0.1" /></label>
            <label>Масса тела, кг<input name="profileWeightKg" type="number" min="30" max="350" step="0.1" /></label>
            <label>Пол<select name="sex" defaultValue=""><option value="" disabled>Выберите</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>
          </div>
          <label>Активность<select name="activityMultiplier" defaultValue=""><option value="" disabled>Выберите уровень</option><option value="1.2">Минимальная — почти без активности</option><option value="1.375">Низкая — лёгкая активность</option><option value="1.55">Средняя — тренировки несколько раз в неделю</option><option value="1.725">Высокая — интенсивные тренировки</option><option value="1.9">Очень высокая — тяжёлая нагрузка</option></select></label>
          <button type="button" onClick={calculateTarget}>Рассчитать и заполнить КБЖУ</button>
        </details>
        <MacroFields key={targetRevision} values={suggestedTarget ?? target} />
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Сохранить цель</button></div>
      </form>
    );
  }

  function renderWeightForm() {
    return (
      <form onSubmit={(event) => submitForm(event, (form) => ({
        type: "weight.save",
        date: requiredText(form, "date", "Дата"),
        weightKg: requiredNumber(form, "weightKg", "Масса тела"),
      }))}>
        <div className="fields-row">
          <label>Дата<input name="date" type="date" required defaultValue={snapshot.localDate} /></label>
          <label>Масса тела, кг<input name="weightKg" type="number" min="1" max="700" step="0.1" required /></label>
        </div>
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Записать вес</button></div>
      </form>
    );
  }

  function renderAccountsForm(account?: MoneyAccount) {
    return (
      <>
        <section>
          <h3>Счета</h3>
          {snapshot.finance.accounts.length ? <ul>{snapshot.finance.accounts.map((item) => <li key={item.id}><strong>{item.name}</strong> · {item.currency === "USD" ? "USD" : "руб. ПМР"} · {signedAmountLabel(item.balanceMinor, item.currency)}{item.isDefault ? " · основной" : ""} <button type="button" onClick={() => onChange({ kind: "accounts", account: item })}>Изменить</button></li>)}</ul> : <p>Счетов пока нет. Создайте основной счёт, чтобы начать вести операции.</p>}
        </section>
        <hr />
        <h3>{account ? "Изменить счёт" : "Добавить счёт"}</h3>
        <form key={account?.id ?? "new"} onSubmit={async (event) => {
          const saved = await submitForm(event, (form) => {
            const isDefault = form.get("isDefault") === "on";
            if (account?.isDefault && !isDefault) throw new Error("Сначала сделайте основным другой счёт.");
            return {
              type: "account.save",
              ...(account ? { id: account.id } : {}),
              name: requiredText(form, "name", "Название счёта"),
              currency: requiredText(form, "currency", "Валюта") as "PRB" | "USD",
              openingBalanceMinor: recordValue(form, "openingBalance") ? signedMinor(recordValue(form, "openingBalance")) : 0,
              isDefault,
            };
          }, true);
          if (saved && account) onChange({ kind: "accounts" });
        }}>
          <label>Название<input name="name" maxLength={300} required defaultValue={account?.name ?? ""} placeholder="Основная карта" /></label>
          <div className="fields-row">
            {account ? <label>Валюта<input value={account.currency === "PRB" ? "Рубли ПМР" : "Доллары США"} readOnly /><input type="hidden" name="currency" value={account.currency} /></label> : <label>Валюта<select name="currency" defaultValue="PRB"><option value="PRB">Рубли ПМР</option><option value="USD">Доллары США</option></select></label>}
            <label>Начальный остаток<input name="openingBalance" type="text" inputMode="decimal" defaultValue={account ? amountInput(account.openingBalanceMinor) : ""} placeholder="0,00" /></label>
          </div>
          <label className="check-field"><input name="isDefault" type="checkbox" defaultChecked={account?.isDefault ?? snapshot.finance.accounts.length === 0} />Сделать основным счётом</label>
          <div className="actions"><button type="button" disabled={pending} onClick={() => onChange({ kind: "accounts" })}>Отмена</button><button className="submit" type="submit" disabled={pending}>{account ? "Сохранить счёт" : "Добавить счёт"}</button></div>
        </form>
        <hr />
        <h3>Курс для общего итога</h3>
        <p>Курс используется для операций в USD с указанной даты. Для операций задним числом можно добавить курс, который действовал тогда.</p>
        <form key={snapshot.settings.usdToPrb ?? "unset"} onSubmit={(event) => submitForm(event, (form) => ({
          type: "rate.save",
          usdToPrb: requiredText(form, "usdToPrb", "Курс").replace(",", "."),
          effectiveAt: localTimestamp(requiredText(form, "effectiveAt", "Дата начала действия")),
        }), true)}>
          <label>1 USD = рублей ПМР<input name="usdToPrb" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" required defaultValue={snapshot.settings.usdToPrb ?? ""} placeholder="Укажите курс" /></label>
          <label>Действует с<input name="effectiveAt" type="datetime-local" required defaultValue={localInputValue(defaultDateTime(snapshot.localDate))} /></label>
          <div className="actions"><button className="submit" type="submit" disabled={pending}>Сохранить курс</button></div>
        </form>
      </>
    );
  }

  function renderRecurringForm(item?: AppSnapshot["recurring"][number]) {
    return (
      <>
        <section>
          <h3>Регулярные платежи</h3>
          {snapshot.recurring.length ? <ul>{snapshot.recurring.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> · {amountLabel(item.amountMinor, item.currency)} · {item.category} · {frequencyLabel(item.frequency)} · следующее списание {dateLabel(item.nextDueAt)}
              <button type="button" onClick={() => onChange({ kind: "recurring", item })}>Изменить</button>
              {item.nextDueAt.slice(0, 10) <= snapshot.localDate
                ? <button type="button" disabled={pending} onClick={() => runCommand({ type: "recurring.confirm", id: item.id }, true)}>Подтвердить списание</button>
                : <small>Подтверждение будет доступно в дату списания.</small>}
            </li>
          ))}</ul> : <p>Платежей пока нет.</p>}
        </section>
        <hr />
        <h3>Добавить напоминание</h3>
        {snapshot.finance.accounts.length === 0 ? <p>Сначала добавьте счёт в разделе счетов.</p> : (
          <form key={item?.id ?? "new"} onSubmit={async (event) => {
            const saved = await submitForm(event, (form) => ({
              type: "recurring.save",
              ...(item ? { id: item.id } : {}),
              name: requiredText(form, "name", "Название платежа"),
              amountMinor: parseMinor(requiredText(form, "amount", "Сумма")),
              accountId: requiredText(form, "accountId", "Счёт"),
              category: requiredText(form, "category", "Категория"),
              frequency: requiredText(form, "frequency", "Периодичность") as "weekly" | "monthly" | "yearly",
              nextDueAt: dateTimestamp(requiredText(form, "nextDueAt", "Дата следующего списания")),
            }), true);
            if (saved && item) onChange({ kind: "recurring" });
          }}>
            <label>Название<input name="name" maxLength={300} required defaultValue={item?.name ?? ""} placeholder="Телефон, Spotify" /></label>
            <div className="fields-row">
              <label>Сумма<input name="amount" type="text" inputMode="decimal" required defaultValue={item ? moneyDecimal.format(item.amountMinor / 100) : ""} placeholder="10,00" /></label>
              <label>Период<select name="frequency" defaultValue={item?.frequency ?? "monthly"}><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option></select></label>
            </div>
            <label>Счёт<select name="accountId" defaultValue={item?.accountId ?? snapshot.settings.defaultAccountId ?? snapshot.finance.accounts[0]?.id}>{snapshot.finance.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency === "USD" ? "USD" : "руб. ПМР"}</option>)}</select></label>
            <label>Категория<input name="category" maxLength={300} required defaultValue={item?.category ?? "Подписки"} /></label>
            <label>Следующее списание<input name="nextDueAt" type="date" required defaultValue={item?.nextDueAt.slice(0, 10) ?? ""} /></label>
            <div className="actions"><button className="submit" type="submit" disabled={pending}>{item ? "Сохранить изменения" : "Сохранить напоминание"}</button></div>
          </form>
        )}
      </>
    );
  }

  function renderProgramForm() {
    const days = snapshot.gym.program;
    const selectedDay = days.find((day) => day.id === selectedDayId) ?? null;
    if (selectedDay) {
      const replacing = selectedDay.exercises.find((exercise) => exercise.id === selectedReplacementId) ?? null;
      if (replacing) return (
        <>
          <h3>Заменить «{replacing.name}»</h3>
          <p>Количество подходов, целевые повторы и отдых останутся прежними. История уже проведённых тренировок сохранится.</p>
          {renderExerciseForm(selectedDay.id, replacing.id)}
        </>
      );
      return (
        <>
          <h3>{selectedDay.name}</h3>
          {selectedDay.exercises.length ? <ol>{selectedDay.exercises.map((exercise, index) => <li key={exercise.id}>
            <strong>{exercise.name}</strong> · {exercise.sets.length} подходов
            <span role="group" aria-label={`Порядок и замена: ${exercise.name}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <MoveButton direction="up" label={`Переместить «${exercise.name}» выше`} disabled={pending || index === 0} onClick={() => void runCommand({ type: "exercise.move", dayId: selectedDay.id, dayExerciseId: exercise.id, direction: "up" }, true)} />
              <MoveButton direction="down" label={`Переместить «${exercise.name}» ниже`} disabled={pending || index === selectedDay.exercises.length - 1} onClick={() => void runCommand({ type: "exercise.move", dayId: selectedDay.id, dayExerciseId: exercise.id, direction: "down" }, true)} />
              <button type="button" disabled={pending} onClick={() => setSelectedReplacementId(exercise.id)}>Заменить</button>
            </span>
          </li>)}</ol> : <p>Упражнений пока нет.</p>}
          {renderExerciseForm(selectedDay.id)}
        </>
      );
    }
    return (
      <>
        <section>
          <h3>Тренировочные дни</h3>
          {days.length ? <ol>{days.map((day, index) => <li key={day.id}>
            <strong>{day.name}</strong> · {day.exercises.length} упражнений
            <span role="group" aria-label={`Порядок дня: ${day.name}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <MoveButton direction="up" label={`Переместить день «${day.name}» выше`} disabled={pending || index === 0} onClick={() => void runCommand({ type: "day.move", dayId: day.id, direction: "up" }, true)} />
              <MoveButton direction="down" label={`Переместить день «${day.name}» ниже`} disabled={pending || index === days.length - 1} onClick={() => void runCommand({ type: "day.move", dayId: day.id, direction: "down" }, true)} />
              <button type="button" onClick={() => { setSelectedReplacementId(null); setSelectedDayId(day.id); }}>Открыть</button>
            </span>
          </li>)}</ol> : <p>План пуст. Создайте день, затем добавьте выбранные упражнения.</p>}
        </section>
        <hr />
        <h3>Новый тренировочный день</h3>
        <form onSubmit={(event) => submitForm(event, (form) => ({
          type: "day.save",
          name: requiredText(form, "name", "Название дня"),
          weekday: recordValue(form, "weekday") ? requiredNumber(form, "weekday", "День недели") : null,
        }), true)}>
          <label>Название дня<input name="name" maxLength={300} required placeholder="Верх тела A" /></label>
          <label>День недели<select name="weekday" defaultValue=""><option value="">Не задан</option><option value="1">Понедельник</option><option value="2">Вторник</option><option value="3">Среда</option><option value="4">Четверг</option><option value="5">Пятница</option><option value="6">Суббота</option><option value="0">Воскресенье</option></select></label>
          <div className="actions"><button className="submit" type="submit" disabled={pending}>Добавить день</button></div>
        </form>
      </>
    );
  }

  function renderExerciseForm(dayId: string, dayExerciseId?: string) {
    const replacing = dayExerciseId ? snapshot.gym.program.find((day) => day.id === dayId)?.exercises.find((exercise) => exercise.id === dayExerciseId) : null;
    const selectedCatalog = exerciseCatalog.find((entry) => entry.id === selectedCatalogId) ?? null;
    return (
      <>
        {!replacing && <><hr /><h3>Добавить упражнение</h3></>}
        <div role="group" aria-label="Источник упражнения" className="actions">
          <button type="button" aria-pressed={exerciseMode === "catalog"} className={exerciseMode === "catalog" ? "submit" : undefined} onClick={() => setExerciseMode("catalog")}>Каталог</button>
          <button type="button" aria-pressed={exerciseMode === "custom"} className={exerciseMode === "custom" ? "submit" : undefined} onClick={() => setExerciseMode("custom")}>Своё упражнение</button>
        </div>
        <form onSubmit={(event) => submitForm(event, (form) => {
          const name = exerciseMode === "custom" ? requiredText(form, "name", "Упражнение") : selectedCatalog?.name;
          if (!name) throw new Error("Выберите упражнение из каталога.");
          const details = {
            name,
            muscleGroup: exerciseMode === "catalog" ? selectedCatalog?.muscles ?? "" : recordValue(form, "muscleGroup"),
            equipment: exerciseMode === "catalog" ? selectedCatalog?.equipment ?? "" : recordValue(form, "equipment"),
            instructions: exerciseMode === "catalog" ? selectedCatalog?.instructions ?? "" : recordValue(form, "instructions"),
          };
          if (replacing) return { type: "exercise.replace", dayId, dayExerciseId: replacing.id, ...details };
          return {
            type: "exercise.add",
            dayId,
            ...details,
            targetSets: requiredNumber(form, "targetSets", "Количество подходов"),
            targetRepetitions: requiredNumber(form, "targetRepetitions", "Повторения"),
            restSeconds: recordValue(form, "restSeconds") ? requiredNumber(form, "restSeconds", "Отдых") : 90,
          };
        }, true)}>
          {exerciseMode === "catalog" ? (
            <ExerciseGuide entries={exerciseCatalog} selectedId={selectedCatalogId} onSelect={setSelectedCatalogId} />
          ) : (
            <>
              <label>Название упражнения<input name="name" maxLength={300} required placeholder="Например, тяга гантели одной рукой" /></label>
              <div className="fields-row">
                <label>Целевые мышцы<input name="muscleGroup" maxLength={200} placeholder="Например, широчайшие" /></label>
                <label>Инвентарь<input name="equipment" maxLength={200} placeholder="Например, гантель и скамья" /></label>
              </div>
              <label>Подсказка по технике<textarea name="instructions" maxLength={5000} rows={2} placeholder="Личная заметка к упражнению" /></label>
            </>
          )}
          {!replacing && <>
            <div className="fields-row">
              <label>Подходы<input name="targetSets" type="number" min="1" max="30" step="1" defaultValue="3" required /></label>
              <label>Повторения<input name="targetRepetitions" type="number" min="1" max="1000" step="1" defaultValue="8" required /></label>
            </div>
            <label>Отдых, секунд<input name="restSeconds" type="number" min="0" max="3600" step="1" defaultValue="90" /></label>
          </>}
          <div className="actions"><button className="submit" type="submit" disabled={pending}>{replacing ? "Заменить упражнение" : "Добавить упражнение"}</button></div>
        </form>
      </>
    );
  }

  function renderSetForm(dayId: string, exerciseId: string, set: ExerciseSet) {
    return (
      <>
        <p>Введите фактический результат подхода {set.index}. Пустые показатели останутся незаданными.</p>
        <form onSubmit={(event) => submitForm(event, (form) => {
          const weightKg = optionalNumber(form, "weightKg", "Вес");
          const repetitions = optionalNumber(form, "repetitions", "Повторения");
          const durationSeconds = optionalNumber(form, "durationSeconds", "Время");
          const distanceMeters = optionalNumber(form, "distanceMeters", "Дистанция");
          if (![repetitions, durationSeconds, distanceMeters].some((value) => value !== null && value > 0)) throw new Error("Укажите положительное значение повторений, времени или дистанции.");
          return { type: "set.save", dayId, exerciseId, setIndex: set.index, weightKg, repetitions, durationSeconds, distanceMeters };
        })}>
          <div className="fields-row">
            <label>Вес, кг<input name="weightKg" type="number" min="0" max="2000" step="0.1" defaultValue={set.weightKg ?? ""} /></label>
            <label>Повторения<input name="repetitions" type="number" min="1" max="10000" step="1" defaultValue={set.repetitions ?? ""} /></label>
            <label>Время, секунд<input name="durationSeconds" type="number" min="1" max="86400" step="1" defaultValue={set.durationSeconds ?? ""} /></label>
            <label>Дистанция, м<input name="distanceMeters" type="number" min="0.01" max="1000000" step="0.01" defaultValue={set.distanceMeters ?? ""} /></label>
          </div>
          <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Сохранить результат</button></div>
        </form>
      </>
    );
  }

  function renderEditorContent(): ReactNode {
    switch (editor.kind) {
      case "food": return renderFoodForm(editor.entry);
      case "finance": return renderFinanceForm(editor.entry);
      case "target": return renderTargetForm();
      case "weight": return renderWeightForm();
      case "accounts": return renderAccountsForm(editor.account);
      case "recurring": return renderRecurringForm(editor.item);
      case "program": return renderProgramForm();
      case "exercise": return renderExerciseForm(editor.dayId);
      case "set": return renderSetForm(editor.dayId, editor.exerciseId, editor.set);
      case "delete-food": return <ConfirmDelete label={editor.label} pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "food.delete", id: editor.id })} />;
      case "delete-money": return <ConfirmDelete label={editor.label} pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "money.delete", id: editor.id })} />;
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`editor${editor.kind === "program" || editor.kind === "exercise" || editor.kind === "set" ? " editor--workout" : ""}`}
      aria-labelledby="lifeos-editor-title"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current && !pending) onClose(); }}
    >
      <header className="editor-header">
        {canGoBack && (
          <button className="editor-icon-button" type="button" aria-label={backLabel} title={backLabel} disabled={pending} onClick={goBack}>
            <EditorIcon kind="back" />
          </button>
        )}
        <div className="editor-header__title"><small>LifeOS</small><h2 id="lifeos-editor-title">{title}</h2></div>
        <button className="editor-icon-button" type="button" aria-label="Закрыть панель" title="Закрыть" disabled={pending} onClick={onClose}>
          <EditorIcon kind="close" />
        </button>
      </header>
      {activeError && <p className="error" role="alert">{activeError}</p>}
      {pending && <p role="status" aria-live="polite">Сохраняю…</p>}
      {renderEditorContent()}
    </dialog>
  );
}

function ConfirmDelete({ label, pending, onCancel, onConfirm }: { label: string; pending: boolean; onCancel(): void; onConfirm(): void }) {
  return <div><p>Удалить «{label}»? Это действие нельзя отменить.</p><div className="actions"><button type="button" disabled={pending} onClick={onCancel}>Оставить</button><button className="submit" type="button" disabled={pending} onClick={onConfirm}>Удалить</button></div></div>;
}

function MoveButton({ direction, label, disabled, onClick }: { direction: "up" | "down"; label: string; disabled: boolean; onClick(): void }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{direction === "up" ? "↑" : "↓"}</button>;
}

function EditorIcon({ kind }: { kind: "back" | "close" }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {kind === "back" ? <path d="M19 12H5m0 0 7-7m-7 7 7 7" /> : <path d="m18 6-12 12M6 6l12 12" />}
    </svg>
  );
}

function editorTitle(editor: EditorState): string {
  switch (editor.kind) {
    case "food": return editor.entry ? "Исправить еду" : "Добавить еду";
    case "finance": return editor.entry ? "Исправить операцию" : "Добавить операцию";
    case "target": return "Цель КБЖУ";
    case "weight": return "Масса тела";
    case "accounts": return "Счета и курс";
    case "recurring": return editor.item ? "Изменить платёж" : "Подписки и платежи";
    case "program": return "Тренировочный план";
    case "exercise": return "Новое упражнение";
    case "set": return "Результат подхода";
    case "delete-food": return "Удалить запись еды";
    case "delete-money": return "Удалить операцию";
  }
}

function frequencyLabel(frequency: "weekly" | "monthly" | "yearly"): string {
  if (frequency === "weekly") return "еженедельно";
  if (frequency === "yearly") return "ежегодно";
  return "ежемесячно";
}
