"use client";

import { useBodyScrollLock } from "@/components/scroll-lock";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import { exerciseCatalog } from "@/domain/exercise-catalog";
import { currencyName, currencyUnit, formatMoney } from "@/domain/currencies";
import { instantToZonedLocal, parseMinor, zonedLocalToInstant } from "@/domain/math";
import { ACTIVITY_LEVELS, GOALS, MIN_WEEKLY_WEIGH_INS, profileSchema, suggestTargets, targetFromAverage, weeklyAverageWeight } from "@/domain/nutrition";
import type { NutritionProfile } from "@/domain/nutrition";
import { APP_VERSION, releasesSince } from "@/domain/release";
import { plural } from "@/domain/plural";
import { ExerciseGuide } from "./exercise-guide";
import type { ExerciseSet, FinanceDebt, FinancePlan, FoodLogEntry, MacroValues, MoneyAccount, MoneyEntry } from "@/domain/types";
import { CurrencyPicker } from "@/components/finance/currency-picker";
import { useMotionVariants } from "@/components/motion/motion-system";

export type FormValues = Record<string, string[]>;

const IDEMPOTENT_COMMANDS = new Set(["food.save", "money.save", "debt.create", "debt.repayment.create"]);

/** A repeated press of the same unsaved form reuses one request id, so the server records the entry once. */
function withClientRequestId(command: AppCommand, ref: { current: { key: string; id: string } | null }): AppCommand {
  if (!IDEMPOTENT_COMMANDS.has(command.type) || ("id" in command && command.type !== "debt.repayment.create" && command.id)) return command;
  const key = JSON.stringify(command);
  if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() };
  return { ...command, clientRequestId: ref.current.id } as AppCommand;
}

export type EditorState =
  | { kind: "food"; entry?: FoodLogEntry }
  | { kind: "finance"; entry?: MoneyEntry }
  | { kind: "finance-plan"; plan?: FinancePlan }
  | { kind: "finance-plan-purchase"; plan: FinancePlan }
  | { kind: "debt-create"; openedAs?: "transfer" | "opening_balance" }
  | { kind: "debt-repayment"; debt: FinanceDebt }
  | { kind: "target"; firstRun?: boolean }
  | { kind: "whats-new" }
  | { kind: "weight" }
  | { kind: "accounts"; account?: MoneyAccount }
  | { kind: "recurring"; item?: AppSnapshot["recurring"][number] }
  | { kind: "program" }
  | { kind: "exercise"; dayId: string }
  | { kind: "set"; dayId: string; exerciseId: string; set: ExerciseSet }
  | { kind: "delete-food"; id: string; label: string }
  | { kind: "delete-money"; id: string; label: string }
  | { kind: "delete-finance-plan"; id: string; label: string }
  | { kind: "delete-debt"; id: string; label: string }
  | { kind: "delete-debt-repayment"; id: string; label: string }
  | { kind: "finish-session"; sessionId: string; done: number; total: number };

type EditorDialogProps = {
  editor: EditorState;
  snapshot: AppSnapshot;
  pending: boolean;
  error: string | null;
  onClose(): void;
  onChange(editor: EditorState): void;
  onCommand(command: AppCommand, keepOpen?: boolean): Promise<boolean>;
  /** Form values to put back after a failed save, so nothing typed is lost. */
  restoreValues?: FormValues | null;
  onRememberForm?(values: FormValues): void;
  onRegisterTelegramBackHandler?(handler: (() => void) | null): void;
  /** Opens the AI provider settings; offered next to the «ИИ пока не настроен» message. */
  onConnectAi?(): void;
};

const moneyDecimal = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Form fields get plain «5913,34»: grouping spaces would make the prefilled value look different from what the user types.
const moneyField = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

function recordValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredNumber(form: FormData, name: string, label: string): number {
  const value = recordValue(form, name).replace(",", ".");
  if (!value) throw new Error(`Заполни поле «${label}».`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Проверь поле «${label}».`);
  return parsed;
}

function optionalNumber(form: FormData, name: string, label: string): number | null {
  const value = recordValue(form, name).replace(",", ".");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Проверь поле «${label}».`);
  return parsed;
}

function requiredText(form: FormData, name: string, label: string): string {
  const value = recordValue(form, name);
  if (!value) throw new Error(`Заполни поле «${label}».`);
  return value;
}

function localTimestamp(value: string, timeZone: string): string {
  if (!value) throw new Error("Укажи дату и время.");
  const date = zonedLocalToInstant(value, timeZone);
  if (!date) throw new Error("Проверь дату и время.");
  return date.toISOString();
}

function dateTimestamp(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Укажи дату.");
  const date = zonedLocalToInstant(`${value}T12:00`, timeZone);
  if (!date) throw new Error("Проверь дату.");
  return date.toISOString();
}

function localInputValue(value: string, timeZone: string): string {
  return instantToZonedLocal(value, timeZone);
}

/** Now when the selected day is today in the owner's zone, otherwise noon of that day. */
function defaultDateTime(date: string, timeZone: string): string {
  const now = instantToZonedLocal(new Date(), timeZone);
  return now.slice(0, 10) === date ? now : `${date}T12:00`;
}

function positiveMinor(value: string, label: string): number {
  const amount = parseMinor(value);
  if (amount < 1) throw new Error(`Сумма в поле «${label}» должна быть больше нуля.`);
  return amount;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function amountLabel(amountMinor: number, currency: string): string {
  return formatMoney(Math.abs(amountMinor), currency);
}

function signedAmountLabel(amountMinor: number, currency: string): string {
  return `${amountMinor < 0 ? "−" : ""}${amountLabel(amountMinor, currency)}`;
}

function signedMinor(value: string): number {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error("Введи сумму числом, например 1500,50.");
  const negative = normalized.startsWith("-");
  const magnitude = parseMinor(negative ? normalized.slice(1) : normalized);
  return negative ? -magnitude : magnitude;
}

function amountInput(amountMinor: number): string {
  const value = moneyField.format(Math.abs(amountMinor) / 100);
  return amountMinor < 0 ? `-${value}` : value;
}

function MacroFields({ values }: { values?: { calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number } | null }) {
  return (
    <div className="fields-row">
      <label>Калории, ккал<input name="calories" type="number" inputMode="decimal" min="0" max="100000" step="0.1" required defaultValue={values?.calories ?? ""} /></label>
      <label>Белки, г<input name="proteinGrams" type="number" inputMode="decimal" min="0" max="100000" step="0.1" required defaultValue={values?.proteinGrams ?? ""} /></label>
      <label>Жиры, г<input name="fatGrams" type="number" inputMode="decimal" min="0" max="100000" step="0.1" required defaultValue={values?.fatGrams ?? ""} /></label>
      <label>Углеводы, г<input name="carbsGrams" type="number" inputMode="decimal" min="0" max="100000" step="0.1" required defaultValue={values?.carbsGrams ?? ""} /></label>
    </div>
  );
}

export function EditorDialog({ editor, snapshot, pending, error, onClose: closeNow, onChange, onCommand, onRegisterTelegramBackHandler, restoreValues, onRememberForm, onConnectAi }: EditorDialogProps) {
  const motionVariants = useMotionVariants();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useBodyScrollLock();
  /** The browser reports every invalid field of a form; only the first one is shown and focused. */
  const invalidHandledRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  /** Set once a form field was edited; closing then asks before the typed values are thrown away. */
  const dirtyRef = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const onClose = useCallback(() => {
    if (dirtyRef.current) { setConfirmClose(true); return; }
    closeNow();
  }, [closeNow]);
  const [saved, setSaved] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [suggestedTarget, setSuggestedTarget] = useState<MacroValues | null>(null);
  const [targetRevision, setTargetRevision] = useState(0);
  const [exerciseMode, setExerciseMode] = useState<"catalog" | "custom">("catalog");
  const [selectedCatalogId, setSelectedCatalogId] = useState(exerciseCatalog[0]?.id ?? "");
  const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null);
  const [debtDirection, setDebtDirection] = useState<"i_owe" | "owed_to_me">("i_owe");
  const [foodPrefill, setFoodPrefill] = useState<AppSnapshot["templates"][number] | null>(null);
  const [weightDate, setWeightDate] = useState(snapshot.localDate);
  const [weightValue, setWeightValue] = useState("");
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<string | null>(null);
  const [newAccountCurrency, setNewAccountCurrency] = useState("");
  const [pickedFinanceAccount, setPickedFinanceAccount] = useState<{ form: string; id: string } | null>(null);
  const baseCurrency = snapshot.settings.baseCurrency;
  const tz = snapshot.settings.timeZone;
  const baseUnit = baseCurrency ? currencyUnit(baseCurrency) : "";
  const baseAmountLabel = (prefix: string) => (baseUnit ? `${prefix}, ${baseUnit}` : prefix);
  const baseAccountsFor = () => {
    const accounts = snapshot.finance.accounts.filter((account) => account.currency === baseCurrency);
    const preferred = accounts.find((account) => account.id === snapshot.settings.defaultAccountId) ?? accounts.find((account) => account.isDefault) ?? accounts[0];
    return { accounts, preferred };
  };
  const [debtOpenedAs, setDebtOpenedAs] = useState<"transfer" | "opening_balance">(editor.kind === "debt-create" ? editor.openedAs ?? "transfer" : "transfer");

  useEffect(() => {
    // Reopened after a failed save: put the typed values back into the form fields.
    if (!restoreValues) return;
    for (const field of dialogRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("form [name]") ?? []) {
      const values = restoreValues[field.name];
      if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) field.checked = (values ?? []).includes(field.value || "on");
      else if (values) field.value = values[0] ?? "";
    }
  }, [restoreValues]);

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
  const backLabel = selectedReplacementId || editingExerciseId ? "Назад к упражнениям дня" : "Назад к тренировочным дням";

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    setConfirmRemoval(null);
    if (selectedReplacementId || editingExerciseId) {
      setSelectedReplacementId(null);
      setEditingExerciseId(null);
      return;
    }
    setSelectedDayId(null);
  }, [canGoBack, selectedReplacementId, editingExerciseId]);

  useEffect(() => {
    onRegisterTelegramBackHandler?.(canGoBack ? goBack : null);
    return () => onRegisterTelegramBackHandler?.(null);
  }, [canGoBack, goBack, onRegisterTelegramBackHandler]);

  const requestIdRef = useRef<{ key: string; id: string } | null>(null);

  async function submitForm(event: FormEvent<HTMLFormElement>, build: (form: FormData) => AppCommand, keepOpen = false): Promise<boolean> {
    event.preventDefault();
    if (pending) return false;
    const formElement = event.currentTarget;
    setFormError(null);
    setSaved(false);
    try {
      const data = new FormData(formElement);
      const command = withClientRequestId(build(data), requestIdRef);
      const values: FormValues = {};
      for (const [name, value] of data.entries()) if (typeof value === "string") (values[name] ??= []).push(value);
      onRememberForm?.(values);
      const succeeded = await onCommand(command, keepOpen);
      if (succeeded) requestIdRef.current = null;
      if (succeeded && keepOpen) {
        formElement.reset();
        dirtyRef.current = false;
        setSaved(true);
      }
      return succeeded;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Проверь введённые данные.");
      return false;
    }
  }

  async function runCommand(command: AppCommand, keepOpen = false): Promise<boolean> {
    if (pending) return false;
    setFormError(null);
    setSaved(false);
    const succeeded = await onCommand(command, keepOpen);
    if (succeeded && keepOpen) setSaved(true);
    return succeeded;
  }

  function renderFoodForm(entry?: FoodLogEntry) {
    return (
      <>
        {!entry && snapshot.templates.length > 0 && (
          <section aria-label="Мои блюда">
            <h3>Мои блюда</h3>
            {snapshot.templates.length > 8 && <label>Поиск по блюдам<input type="search" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} autoComplete="off" /></label>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: "11rem", overflowY: "auto" }}>
              {snapshot.templates.filter((template) => template.name.toLowerCase().includes(templateQuery.trim().toLowerCase())).map((template) => <button key={template.id} type="button" aria-pressed={foodPrefill?.id === template.id} onClick={() => setFoodPrefill(template)}>{template.name}</button>)}
            </div>
          </section>
        )}
        <form key={entry?.id ?? `new-${foodPrefill?.id ?? ""}`} onSubmit={(event) => submitForm(event, (form) => ({
          type: "food.save",
          ...(entry ? { id: entry.id } : {}),
          label: requiredText(form, "label", "Название блюда"),
          portionLabel: requiredText(form, "portionLabel", "Порция"),
          occurredAt: localTimestamp(recordValue(form, "occurredAt"), tz),
          estimated: form.get("estimated") === "on",
          calories: requiredNumber(form, "calories", "Калории"),
          proteinGrams: requiredNumber(form, "proteinGrams", "Белки"),
          fatGrams: requiredNumber(form, "fatGrams", "Жиры"),
          carbsGrams: requiredNumber(form, "carbsGrams", "Углеводы"),
        }))}>
          <label>Блюдо<input name="label" maxLength={300} required defaultValue={entry?.label ?? foodPrefill?.name ?? ""} placeholder="Например, гречка с говядиной" /></label>
          <label>Обычная порция<input name="portionLabel" maxLength={300} required defaultValue={entry?.portionLabel ?? foodPrefill?.portionLabel ?? ""} placeholder="Тарелка, два бутерброда, половина упаковки" /></label>
          <div className="fields-row">
            <label>Дата и время<input name="occurredAt" type="datetime-local" required defaultValue={entry ? localInputValue(entry.occurredAt, tz) : defaultDateTime(snapshot.localDate, tz)} /></label>
          </div>
          <MacroFields values={entry ?? foodPrefill} />
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
    const formId = entry?.id ?? "new";
    const pickedId = pickedFinanceAccount?.form === formId ? pickedFinanceAccount.id : initialAccountId;
    const pickedAccount = snapshot.finance.accounts.find((account) => account.id === pickedId);
    const missingRate = pickedAccount && baseCurrency && pickedAccount.currency !== baseCurrency && !snapshot.settings.rates[pickedAccount.currency];
    const entryAccountExists = !entry || snapshot.finance.accounts.some((account) => account.id === entry.accountId);
    return (
      <>
        {snapshot.finance.accounts.length === 0 ? (
          <div><p>Сначала добавь счёт. Тогда можно будет сохранить операцию в нужной валюте.</p><button type="button" onClick={() => onChange({ kind: "accounts" })}>Добавить счёт</button></div>
        ) : !entryAccountExists ? (
          <p role="alert">Счёт этой операции не найден. Операцию нельзя безопасно изменить, пока счёт отсутствует.</p>
        ) : (
          <form key={entry?.id ?? "new"} onSubmit={(event) => submitForm(event, (form) => ({
            type: "money.save",
            ...(entry ? { id: entry.id } : {}),
            label: requiredText(form, "label", "Описание"),
            occurredAt: localTimestamp(recordValue(form, "occurredAt"), tz),
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
            <label>Счёт<select name="accountId" defaultValue={initialAccountId} onChange={(event) => setPickedFinanceAccount({ form: formId, id: event.target.value })}>{snapshot.finance.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({currencyUnit(account.currency)})</option>)}</select></label>
            {missingRate && pickedAccount && (
              <div>
                <p role="alert">Сначала задай курс {pickedAccount.currency} к {baseCurrency}.</p>
                <button type="button" onClick={() => onChange({ kind: "accounts" })}>Задать курс</button>
              </div>
            )}
            {pickedAccount && baseCurrency && pickedAccount.currency !== baseCurrency && snapshot.settings.rates[pickedAccount.currency] && (
              <p>Курс: 1 {pickedAccount.currency} = {snapshot.settings.rates[pickedAccount.currency].replace(".", ",").replace(/,?0+$/, "")} {baseUnit}. Для операции раньше первого курса берётся ближайший заданный.</p>
            )}
            <label>Категория<input name="category" maxLength={300} required defaultValue={entry?.category ?? ""} placeholder="Еда, транспорт, подписки" /></label>
            <label>Дата и время<input name="occurredAt" type="datetime-local" required defaultValue={entry ? localInputValue(entry.occurredAt, tz) : defaultDateTime(snapshot.localDate, tz)} /></label>
            <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>{entry ? "Сохранить" : "Записать"}</button></div>
          </form>
        )}
      </>
    );
  }

  function renderFinancePlanForm(plan?: FinancePlan) {
    return (
      <form key={plan?.id ?? "new-finance-plan"} onSubmit={(event) => submitForm(event, (form) => ({
        type: "finance-plan.save",
        ...(plan ? { id: plan.id } : {}),
        name: requiredText(form, "name", "Название покупки"),
        amountMinor: positiveMinor(requiredText(form, "amount", "Сумма"), "Сумма"),
      }))}>
        <label>Покупка<input name="name" maxLength={300} required defaultValue={plan?.name ?? ""} placeholder="Например, шампунь" /></label>
        <label>{baseAmountLabel("Сумма")}<input name="amount" type="text" inputMode="decimal" required defaultValue={plan ? moneyDecimal.format(plan.amountMinor / 100) : ""} placeholder="220" /></label>
        <p>План не меняет баланс и расходы. Сумму можно поправить при фактической покупке.</p>
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>{plan ? "Сохранить план" : "Добавить в план"}</button></div>
      </form>
    );
  }

  function renderFinancePlanPurchaseForm(plan: FinancePlan) {
    const { accounts: baseAccounts, preferred: defaultBaseAccount } = baseAccountsFor();

    if (!baseAccounts.length) {
      return (
        <div>
          <p role="alert">Для записи расхода нужен активный счёт в основной валюте ({baseCurrency}).</p>
          <div className="actions">
            <button type="button" disabled={pending} onClick={onClose}>Закрыть</button>
            <button className="submit" type="button" disabled={pending} onClick={() => onChange({ kind: "accounts" })}>Добавить счёт</button>
          </div>
        </div>
      );
    }

    return (
      <form key={`purchase-${plan.id}`} onSubmit={(event) => submitForm(event, (form) => ({
        type: "finance-plan.purchase",
        id: plan.id,
        label: plan.name,
        actualAmountMinor: positiveMinor(requiredText(form, "actualAmount", "Фактическая сумма"), "Фактическая сумма"),
        occurredAt: new Date().toISOString(),
        accountId: requiredText(form, "accountId", "Счёт в основной валюте"),
        category: "Плановая покупка",
      }))}>
        <p>Покупка: <strong>{plan.name}</strong></p>
        <label>{baseAmountLabel("Фактическая сумма")}<input name="actualAmount" type="text" inputMode="decimal" required defaultValue={moneyDecimal.format(plan.amountMinor / 100)} placeholder="220" /></label>
        <label>Счёт в основной валюте<select name="accountId" defaultValue={defaultBaseAccount?.id ?? ""} required>{baseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? " · основной" : ""}</option>)}</select></label>
        <p>После подтверждения расход запишется сейчас, а план будет закрыт.</p>
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Записать расход и закрыть план</button></div>
      </form>
    );
  }

  function renderDebtCreateForm() {
    const { accounts: baseAccounts, preferred: defaultBaseAccount } = baseAccountsFor();
    const hasTransferAccount = debtOpenedAs !== "transfer" || baseAccounts.length > 0;

    return (
      <form key="debt-create" onSubmit={(event) => submitForm(event, (form) => ({
        type: "debt.create",
        personName: requiredText(form, "personName", "Имя человека"),
        direction: requiredText(form, "direction", "Кому должен") as "i_owe" | "owed_to_me",
        amountMinor: positiveMinor(requiredText(form, "amount", "Сумма долга"), "Сумма долга"),
        openedAs: debtOpenedAs,
        ...(debtOpenedAs === "transfer" ? {
          accountId: requiredText(form, "accountId", "Счёт в основной валюте"),
          occurredAt: localTimestamp(recordValue(form, "occurredAt"), tz),
        } : {}),
        dueOn: recordValue(form, "dueOn") || null,
        note: recordValue(form, "note") || null,
      }))}>
        <label>Имя человека<input name="personName" maxLength={300} required placeholder="Например, Андрей" /></label>
        <div role="group" aria-label="Кто кому должен" className="actions">
          <button type="button" aria-pressed={debtDirection === "i_owe"} className={debtDirection === "i_owe" ? "submit" : undefined} onClick={() => setDebtDirection("i_owe")}>Я должен</button>
          <button type="button" aria-pressed={debtDirection === "owed_to_me"} className={debtDirection === "owed_to_me" ? "submit" : undefined} onClick={() => setDebtDirection("owed_to_me")}>Мне должны</button>
        </div>
        <input type="hidden" name="direction" value={debtDirection} />
        <div className="fields-row">
          <label>{baseAmountLabel("Сумма")}<input name="amount" type="text" inputMode="decimal" required placeholder="500" /></label>
        </div>
        <label>Откуда этот долг<select value={debtOpenedAs} onChange={(event) => setDebtOpenedAs(event.target.value as "transfer" | "opening_balance")}>
          <option value="transfer">Деньги сейчас</option>
          <option value="opening_balance">Долг уже был до LifeOS</option>
        </select></label>
        <p>{debtOpenedAs === "transfer" ? "Деньги передаются или получаются сейчас: создастся операция по выбранному счёту, баланс изменится." : "Запишет только остаток долга: баланс счетов не изменится."}</p>
        {debtOpenedAs === "transfer" && (baseAccounts.length ? (
          <>
            <label>Счёт в основной валюте<select name="accountId" defaultValue={defaultBaseAccount?.id ?? ""} required>{baseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? " · основной" : ""}</option>)}</select></label>
            <label>Дата и время передачи<input name="occurredAt" type="datetime-local" required defaultValue={defaultDateTime(snapshot.localDate, tz)} /></label>
          </>
        ) : (
          <div>
            <p role="alert">Для новой передачи денег нужен счёт в основной валюте ({baseCurrency}).</p>
            <button type="button" onClick={() => onChange({ kind: "accounts" })}>Добавить счёт</button>
          </div>
        ))}
        <div className="fields-row">
          <label>Срок возврата<input name="dueOn" type="date" /></label>
        </div>
        <label>Заметка<textarea name="note" rows={3} maxLength={2000} placeholder="Необязательно" /></label>
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending || !hasTransferAccount}>Записать долг</button></div>
      </form>
    );
  }

  function renderDebtRepaymentForm(debt: FinanceDebt) {
    const { accounts: baseAccounts, preferred: defaultBaseAccount } = baseAccountsFor();

    if (!baseAccounts.length) {
      return (
        <div>
          <p role="alert">Для записи возврата нужен счёт в основной валюте ({baseCurrency}).</p>
          <div className="actions">
            <button type="button" disabled={pending} onClick={onClose}>Закрыть</button>
            <button className="submit" type="button" disabled={pending} onClick={() => onChange({ kind: "accounts" })}>Добавить счёт</button>
          </div>
        </div>
      );
    }

    const repaymentVerb = debt.direction === "i_owe" ? "возврат" : "получение";
    return (
      <form key={`debt-repayment-${debt.id}`} onSubmit={(event) => submitForm(event, (form) => {
        const amountMinor = positiveMinor(requiredText(form, "amount", "Сумма возврата"), "Сумма возврата");
        if (amountMinor > debt.remainingAmountMinor) throw new Error("Сумма не может быть больше остатка долга.");
        return {
          type: "debt.repayment.create",
          id: debt.id,
          amountMinor,
          accountId: requiredText(form, "accountId", "Счёт в основной валюте"),
          occurredAt: localTimestamp(recordValue(form, "occurredAt"), tz),
        };
      })}>
        <p>{debt.direction === "i_owe" ? "Возврат долга человеку" : "Получение возврата от человека"} · <strong>{debt.personName}</strong></p>
        <p>Остаток: <strong>{amountLabel(debt.remainingAmountMinor, baseCurrency)}</strong></p>
        <label>{baseAmountLabel(`Сумма ${repaymentVerb}`)}<input name="amount" type="text" inputMode="decimal" max={debt.remainingAmountMinor / 100} required placeholder={moneyDecimal.format(debt.remainingAmountMinor / 100)} /></label>
        <label>Счёт в основной валюте<select name="accountId" defaultValue={defaultBaseAccount?.id ?? ""} required>{baseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isDefault ? " · основной" : ""}</option>)}</select></label>
        <label>Дата и время<input name="occurredAt" type="datetime-local" required defaultValue={defaultDateTime(snapshot.localDate, tz)} /></label>
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Записать {repaymentVerb}</button></div>
      </form>
    );
  }

  function renderTargetForm() {
    const target = snapshot.nutrition.target;
    const firstRun = editor.kind === "target" && editor.firstRun === true;
    const saved = { ...snapshot.settings.profile, weightKg: snapshot.nutrition.bodyWeightKg ?? undefined };
    const savedProfile = profileSchema.safeParse(saved);
    const initialTarget = target ?? (savedProfile.success ? suggestTargets(savedProfile.data) : null);
    const profileFields = ["sex", "age", "heightCm", "profileWeightKg", "activityLevel", "goalType"];
    const week = weeklyAverageWeight(snapshot.nutrition.weightHistory, snapshot.localDate);
    const weightOn = snapshot.settings.enabledFeatures.includes("nutrition.weight");
    const averageTarget = weightOn && !firstRun && week.averageKg !== null && week.weighIns >= MIN_WEEKLY_WEIGH_INS
      ? targetFromAverage(snapshot.settings.profile, week.averageKg, target)
      : null;

    function readProfile(form: FormData): NutritionProfile | null {
      const filled = profileFields.filter((name) => recordValue(form, name)).length;
      if (filled === 0) return null;
      if (filled < profileFields.length) throw new Error("Заполни все параметры профиля или оставь их пустыми.");
      const parsed = profileSchema.safeParse({
        sex: recordValue(form, "sex"),
        age: requiredNumber(form, "age", "Возраст"),
        heightCm: requiredNumber(form, "heightCm", "Рост"),
        weightKg: requiredNumber(form, "profileWeightKg", "Вес"),
        activityLevel: recordValue(form, "activityLevel"),
        goalType: recordValue(form, "goalType"),
      });
      if (!parsed.success) throw new Error("Проверь профиль: возраст 16–90 лет, рост 100–250 см, вес 30–350 кг.");
      return parsed.data;
    }

    function recalculate(event: FormEvent<HTMLFormElement>) {
      const field = event.target as HTMLInputElement | HTMLSelectElement;
      if (!profileFields.includes(field.name)) return;
      try {
        const profile = readProfile(new FormData(event.currentTarget));
        if (!profile) return;
        setFormError(null);
        setSuggestedTarget(suggestTargets(profile));
        setTargetRevision((revision) => revision + 1);
      } catch {
        // Incomplete profile while typing: keep the current numbers.
      }
    }

    return (
      <form onChange={recalculate} onSubmit={(event) => submitForm(event, (form) => {
        const targetValues = {
          calories: requiredNumber(form, "calories", "Калории"),
          proteinGrams: requiredNumber(form, "proteinGrams", "Белки"),
          fatGrams: requiredNumber(form, "fatGrams", "Жиры"),
          carbsGrams: requiredNumber(form, "carbsGrams", "Углеводы"),
        };
        const profile = readProfile(form);
        return profile
          ? { type: "profile.save", profile, target: targetValues }
          : { type: "settings.save", timeZone: snapshot.settings.timeZone, target: targetValues };
      })}>
        <p>{firstRun
          ? "Ответь на шесть вопросов — посчитаем дневную норму калорий и КБЖУ. Всё можно поменять позже."
          : "Норма пересчитывается при изменении профиля. Цифры можно поправить вручную."}</p>
        <div className="fields-row">
          <label>Пол<select name="sex" defaultValue={saved.sex ?? ""}><option value="" disabled>Выбери</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>
          <label>Возраст, лет<input name="age" type="number" inputMode="numeric" min="16" max="90" step="1" defaultValue={saved.age ?? ""} /></label>
          <label>Рост, см<input name="heightCm" type="number" inputMode="decimal" min="100" max="250" step="0.1" defaultValue={saved.heightCm ?? ""} /></label>
          <label>Вес, кг<input name="profileWeightKg" type="number" inputMode="decimal" min="30" max="350" step="0.1" defaultValue={saved.weightKg ?? ""} /></label>
        </div>
        <label>Активность<select name="activityLevel" defaultValue={saved.activityLevel ?? ""}><option value="" disabled>Выбери уровень</option>{Object.entries(ACTIVITY_LEVELS).map(([value, level]) => <option key={value} value={value}>{level.label}</option>)}</select></label>
        <label>Цель<select name="goalType" defaultValue={savedProfile.success || !firstRun ? saved.goalType ?? "" : ""}><option value="" disabled>Выбери цель</option>{Object.entries(GOALS).map(([value, goal]) => <option key={value} value={value}>{goal.label}</option>)}</select></label>
        {averageTarget && week.averageKg !== null ? (
          <p>
            Средний вес за 7 дней — {week.averageKg.toLocaleString("ru-RU")} кг, замеров: {week.weighIns}. По профилю норма теперь {averageTarget.calories} ккал · Б {averageTarget.proteinGrams} · Ж {averageTarget.fatGrams} · У {averageTarget.carbsGrams} г.{" "}
            <button type="button" onClick={() => { setSuggestedTarget(averageTarget); setTargetRevision((revision) => revision + 1); }}>Подставить</button>
          </p>
        ) : null}
        <h3>Норма в день</h3>
        <MacroFields key={targetRevision} values={suggestedTarget ?? initialTarget} />
        <p>Оценка по формуле Миффлина — Сан Жеора с учётом активности и цели. Вес из профиля попадёт в историю веса.</p>
        <div className="actions">
          {firstRun
            ? <button type="button" disabled={pending} onClick={() => void onCommand({ type: "profile.skip" })}>Позже</button>
            : <button type="button" disabled={pending} onClick={onClose}>Отмена</button>}
          <button className="submit" type="submit" disabled={pending}>Сохранить</button>
        </div>
      </form>
    );
  }

  function renderWhatsNew() {
    return (
      <>
        {releasesSince(snapshot.settings.lastSeenVersion).map((release, index, all) => (
          <section key={release.version}>
            {all.length > 1 ? <h3>Версия {release.version}</h3> : null}
            <ul>{release.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </section>
        ))}
        <div className="actions"><button className="submit" type="button" disabled={pending} onClick={() => void onCommand({ type: "version.seen", version: APP_VERSION })}>Понятно</button></div>
      </>
    );
  }

  function renderWeightForm() {
    const history = [...snapshot.nutrition.weightHistory].reverse().slice(0, 14);
    const existing = snapshot.nutrition.weightHistory.find((entry) => entry.date === weightDate);
    return (
      <>
        <form onSubmit={(event) => submitForm(event, (form) => ({
          type: "weight.save",
          date: requiredText(form, "date", "Дата"),
          weightKg: requiredNumber(form, "weightKg", "Масса тела"),
        }))}>
          <div className="fields-row">
            <label>Дата<input name="date" type="date" required value={weightDate} max={snapshot.localDate} onChange={(event) => setWeightDate(event.target.value)} /></label>
            <label>Масса тела, кг<input name="weightKg" type="number" inputMode="decimal" min="1" max="700" step="0.1" required value={weightValue} onChange={(event) => setWeightValue(event.target.value)} /></label>
          </div>
          {existing && <p>За эту дату уже есть {String(existing.weightKg).replace(".", ",")} кг — запись будет заменена.</p>}
          <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Записать вес</button></div>
        </form>
        {history.length > 0 && <>
          <hr />
          <h3>История замеров</h3>
          <ul>{history.map((entry) => <li key={entry.date}>
            <strong>{entry.date.split("-").reverse().join(".")}</strong> · {String(entry.weightKg).replace(".", ",")} кг
            <span style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <button type="button" disabled={pending} onClick={() => { setWeightDate(entry.date); setWeightValue(String(entry.weightKg)); }}>Изменить</button>
              <button type="button" className="danger" disabled={pending} onClick={() => void runCommand({ type: "weight.delete", date: entry.date }, true)}>Удалить</button>
            </span>
          </li>)}</ul>
        </>}
      </>
    );
  }

  function renderAccountsForm(account?: MoneyAccount) {
    const rateCurrencies = [...new Set(snapshot.finance.accounts.map((item) => item.currency))].filter((code) => code !== baseCurrency);
    return (
      <>
        <section>
          <h3>Счета</h3>
          {snapshot.finance.accounts.length ? <ul>{snapshot.finance.accounts.map((item) => <li key={item.id}><strong>{item.name}</strong> · {signedAmountLabel(item.balanceMinor, item.currency)}{item.isDefault ? " · основной" : ""} <button type="button" onClick={() => onChange({ kind: "accounts", account: item })}>Изменить</button></li>)}</ul> : <p>Счетов пока нет. Создай основной счёт, чтобы начать вести операции.</p>}
        </section>
        <hr />
        <h3>{account ? "Изменить счёт" : "Добавить счёт"}</h3>
        <form key={account?.id ?? "new"} onSubmit={async (event) => {
          const saved = await submitForm(event, (form) => {
            const isDefault = form.get("isDefault") === "on";
            if (account?.isDefault && !isDefault) throw new Error("Сначала сделай основным другой счёт.");
            return {
              type: "account.save",
              ...(account ? { id: account.id } : {}),
              name: requiredText(form, "name", "Название счёта"),
              currency: account ? account.currency : newAccountCurrency || (() => { throw new Error("Выбери валюту счёта."); })(),
              openingBalanceMinor: account
                // The field shows what is on the account now; the opening balance is shifted by the difference.
                ? account.openingBalanceMinor + (signedMinor(recordValue(form, "currentBalance") || "0") - account.balanceMinor)
                : recordValue(form, "openingBalance") ? signedMinor(recordValue(form, "openingBalance")) : 0,
              isDefault,
            };
          }, true);
          if (saved && account) onChange({ kind: "accounts" });
          if (saved && !account) setNewAccountCurrency("");
        }}>
          <label>Название<input name="name" maxLength={300} required defaultValue={account?.name ?? ""} placeholder="Основная карта" /></label>
          <div className="fields-row">
            {account && <label>Валюта<input value={`${currencyName(account.currency)} (${account.currency})`} readOnly /></label>}
            {account
              ? <label>Сейчас на счёте, {currencyUnit(account.currency)}<input name="currentBalance" type="text" inputMode="decimal" defaultValue={amountInput(account.balanceMinor)} placeholder="0,00" /></label>
              : <label>Сколько сейчас на счёте<input name="openingBalance" type="text" inputMode="decimal" placeholder="0,00" /></label>}
          </div>
          {account && <p>Остаток складывается из начального {amountLabel(account.openingBalanceMinor, account.currency)} и операций {signedAmountLabel(account.balanceMinor - account.openingBalanceMinor, account.currency)}. Если поправишь сумму, начальный остаток пересчитается сам.</p>}
          {!account && <CurrencyPicker value={newAccountCurrency} onChange={setNewAccountCurrency} legend="Валюта счёта" />}
          {!account && snapshot.finance.accounts.length === 0 && <p>Валюта первого счёта становится основной: в ней считаются итоги, планы и долги.</p>}
          <label className="checkbox-row"><input name="isDefault" type="checkbox" defaultChecked={account?.isDefault ?? snapshot.finance.accounts.length === 0} />Сделать основным счётом</label>
          <div className="actions"><button type="button" disabled={pending} onClick={() => onChange({ kind: "accounts" })}>Отмена</button><button className="submit" type="submit" disabled={pending}>{account ? "Сохранить счёт" : "Добавить счёт"}</button></div>
        </form>
        <hr />
        {rateCurrencies.length > 0 && (
          <>
            <h3>Курс для общего итога</h3>
            <p>Курс используется для операций в этой валюте с указанной даты. Для операций задним числом можно добавить курс, который действовал тогда.</p>
            {rateCurrencies.map((code) => (
              <form key={`${code}-${snapshot.settings.rates[code] ?? "unset"}`} onSubmit={(event) => submitForm(event, (form) => ({
                type: "rate.save",
                currency: code,
                rateToBase: requiredText(form, "rate", "Курс").replace(",", "."),
                effectiveAt: localTimestamp(requiredText(form, "effectiveAt", "Дата начала действия"), tz),
              }), true)}>
                <label>1 {code} = … {baseUnit}<input name="rate" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" required defaultValue={snapshot.settings.rates[code] ?? ""} placeholder="Укажи курс" /></label>
                <label>Действует с<input name="effectiveAt" type="datetime-local" required defaultValue={defaultDateTime(snapshot.localDate, tz)} /></label>
                <div className="actions"><button className="submit" type="submit" disabled={pending}>Сохранить курс {code}</button></div>
              </form>
            ))}
          </>
        )}
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
                ? <button type="button" disabled={pending} onClick={() => runCommand({ type: "recurring.confirm", id: item.id, dueOn: item.nextDueAt.slice(0, 10) }, true)}>Подтвердить списание</button>
                : <small>Подтверждение будет доступно в дату списания.</small>}
            </li>
          ))}</ul> : <p>Платежей пока нет.</p>}
        </section>
        <hr />
        <h3>Добавить напоминание</h3>
        {snapshot.finance.accounts.length === 0 ? <p>Сначала добавь счёт в разделе счетов.</p> : (
          <form key={item?.id ?? "new"} onSubmit={async (event) => {
            const saved = await submitForm(event, (form) => ({
              type: "recurring.save",
              ...(item ? { id: item.id } : {}),
              name: requiredText(form, "name", "Название платежа"),
              amountMinor: parseMinor(requiredText(form, "amount", "Сумма")),
              accountId: requiredText(form, "accountId", "Счёт"),
              category: requiredText(form, "category", "Категория"),
              frequency: requiredText(form, "frequency", "Периодичность") as "weekly" | "monthly" | "yearly",
              nextDueAt: dateTimestamp(requiredText(form, "nextDueAt", "Дата следующего списания"), tz),
            }), true);
            if (saved && item) onChange({ kind: "recurring" });
          }}>
            <label>Название<input name="name" maxLength={300} required defaultValue={item?.name ?? ""} placeholder="Телефон, Spotify" /></label>
            <div className="fields-row">
              <label>Сумма<input name="amount" type="text" inputMode="decimal" required defaultValue={item ? moneyDecimal.format(item.amountMinor / 100) : ""} placeholder="10,00" /></label>
              <label>Период<select name="frequency" defaultValue={item?.frequency ?? "monthly"}><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option></select></label>
            </div>
            <label>Счёт<select name="accountId" defaultValue={item?.accountId ?? snapshot.settings.defaultAccountId ?? snapshot.finance.accounts[0]?.id}>{snapshot.finance.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({currencyUnit(account.currency)})</option>)}</select></label>
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
      const editing = selectedDay.exercises.find((exercise) => exercise.id === editingExerciseId) ?? null;
      if (editing) return (
        <>
          <h3>{editing.name}</h3>
          <form onSubmit={(event) => submitForm(event, (form) => ({
            type: "exercise.update",
            dayId: selectedDay.id,
            dayExerciseId: editing.id,
            targetSets: requiredNumber(form, "targetSets", "Подходы"),
            targetRepetitions: requiredNumber(form, "targetRepetitions", "Повторения"),
            restSeconds: recordValue(form, "restSeconds") ? requiredNumber(form, "restSeconds", "Отдых") : 0,
          }), true)}>
            <div className="fields-row">
              <label>Подходы<input name="targetSets" type="number" inputMode="numeric" min="1" max="30" step="1" defaultValue={editing.sets.length} required /></label>
              <label>Повторения<input name="targetRepetitions" type="number" inputMode="numeric" min="1" max="1000" step="1" defaultValue={editing.targetRepetitions ?? 8} required /></label>
            </div>
            <label>Отдых, секунд<input name="restSeconds" type="number" inputMode="numeric" min="0" max="3600" step="1" defaultValue={editing.restSeconds} /></label>
            <div className="actions"><button className="submit" type="submit" disabled={pending}>Сохранить</button></div>
          </form>
          <hr />
          {confirmRemoval === editing.id ? (
            <>
              <p>Убрать «{editing.name}» из дня? История выполненных тренировок сохранится.</p>
              <div className="actions">
                <button type="button" disabled={pending} onClick={() => setConfirmRemoval(null)}>Оставить</button>
                <button type="button" className="danger" disabled={pending} onClick={() => void runCommand({ type: "exercise.remove", dayId: selectedDay.id, dayExerciseId: editing.id }, true).then((ok) => { if (ok) { setConfirmRemoval(null); setEditingExerciseId(null); } })}>Убрать</button>
              </div>
            </>
          ) : <div className="actions"><button type="button" className="danger" disabled={pending} onClick={() => setConfirmRemoval(editing.id)}>Убрать из дня</button></div>}
        </>
      );
      return (
        <>
          <h3>{selectedDay.name}</h3>
          <form onSubmit={(event) => submitForm(event, (form) => ({
            type: "day.save",
            id: selectedDay.id,
            name: requiredText(form, "name", "Название дня"),
            weekday: recordValue(form, "weekday") ? requiredNumber(form, "weekday", "День недели") : null,
          }), true)}>
            <label>Название дня<input name="name" maxLength={300} required defaultValue={selectedDay.name} /></label>
            <label>День недели<select name="weekday" defaultValue={selectedDay.weekday === null ? "" : String(selectedDay.weekday)}><option value="">Не задан</option><option value="1">Понедельник</option><option value="2">Вторник</option><option value="3">Среда</option><option value="4">Четверг</option><option value="5">Пятница</option><option value="6">Суббота</option><option value="0">Воскресенье</option></select></label>
            <div className="actions"><button className="submit" type="submit" disabled={pending}>Сохранить день</button></div>
          </form>
          {confirmRemoval === selectedDay.id ? (
            <>
              <p>Удалить день «{selectedDay.name}»? Он пропадёт из плана, история тренировок сохранится.</p>
              <div className="actions">
                <button type="button" disabled={pending} onClick={() => setConfirmRemoval(null)}>Оставить</button>
                <button type="button" className="danger" disabled={pending} onClick={() => void runCommand({ type: "day.delete", id: selectedDay.id }, true).then((ok) => { if (ok) { setConfirmRemoval(null); setSelectedDayId(null); } })}>Удалить день</button>
              </div>
            </>
          ) : <div className="actions"><button type="button" className="danger" disabled={pending} onClick={() => setConfirmRemoval(selectedDay.id)}>Удалить день</button></div>}
          <hr />
          <h3>Упражнения</h3>
          {selectedDay.exercises.length ? <ol>{selectedDay.exercises.map((exercise, index) => <li key={exercise.id}>
            <strong>{exercise.name}</strong> · {exercise.sets.length} {plural(exercise.sets.length, "подход", "подхода", "подходов")}
            <span role="group" aria-label={`Порядок и замена: ${exercise.name}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <MoveButton direction="up" label={`Переместить «${exercise.name}» выше`} disabled={pending || index === 0} onClick={() => void runCommand({ type: "exercise.move", dayId: selectedDay.id, dayExerciseId: exercise.id, direction: "up" }, true)} />
              <MoveButton direction="down" label={`Переместить «${exercise.name}» ниже`} disabled={pending || index === selectedDay.exercises.length - 1} onClick={() => void runCommand({ type: "exercise.move", dayId: selectedDay.id, dayExerciseId: exercise.id, direction: "down" }, true)} />
              <button type="button" disabled={pending} onClick={() => { setConfirmRemoval(null); setEditingExerciseId(exercise.id); }}>Изменить</button>
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
            <strong>{day.name}</strong> · {day.exercises.length} {plural(day.exercises.length, "упражнение", "упражнения", "упражнений")}
            <span role="group" aria-label={`Порядок дня: ${day.name}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <MoveButton direction="up" label={`Переместить день «${day.name}» выше`} disabled={pending || index === 0} onClick={() => void runCommand({ type: "day.move", dayId: day.id, direction: "up" }, true)} />
              <MoveButton direction="down" label={`Переместить день «${day.name}» ниже`} disabled={pending || index === days.length - 1} onClick={() => void runCommand({ type: "day.move", dayId: day.id, direction: "down" }, true)} />
              <button type="button" onClick={() => { setSelectedReplacementId(null); setEditingExerciseId(null); setConfirmRemoval(null); setSelectedDayId(day.id); }}>Открыть</button>
            </span>
          </li>)}</ol> : <p>План пуст. Создай день, затем добавь выбранные упражнения.</p>}
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
          if (!name) throw new Error("Выбери упражнение из каталога.");
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
              <label>Подходы<input name="targetSets" type="number" inputMode="decimal" min="1" max="30" step="1" defaultValue="3" required /></label>
              <label>Повторения<input name="targetRepetitions" type="number" inputMode="decimal" min="1" max="1000" step="1" defaultValue="8" required /></label>
            </div>
            <label>Отдых, секунд<input name="restSeconds" type="number" inputMode="decimal" min="0" max="3600" step="1" defaultValue="90" /></label>
          </>}
          <div className="actions"><button className="submit" type="submit" disabled={pending}>{replacing ? "Заменить упражнение" : "Добавить упражнение"}</button></div>
        </form>
      </>
    );
  }

  function renderSetForm(dayId: string, exerciseId: string, set: ExerciseSet) {
    // A fresh set starts from the previous completed set of the same exercise, so repeating a weight is one tap.
    const sets = snapshot.gym.program.find((day) => day.id === dayId)?.exercises.find((exercise) => exercise.id === exerciseId)?.sets ?? [];
    const previous = [...sets].reverse().find((item) => item.index < set.index && item.completed);
    const weightStart = set.weightKg ?? (set.completed ? null : previous?.weightKg ?? null);
    const repsStart = set.repetitions ?? (set.completed ? null : previous?.repetitions ?? null);
    const extraFilled = set.durationSeconds !== null || set.distanceMeters !== null;
    return (
      <>
        <p>Результат подхода {set.index}.{previous && !set.completed ? ` Подставлено из подхода ${previous.index}.` : ""}</p>
        <form onSubmit={(event) => submitForm(event, (form) => {
          const weightKg = optionalNumber(form, "weightKg", "Вес");
          const repetitions = optionalNumber(form, "repetitions", "Повторения");
          const durationSeconds = optionalNumber(form, "durationSeconds", "Время");
          const distanceMeters = optionalNumber(form, "distanceMeters", "Дистанция");
          if (![repetitions, durationSeconds, distanceMeters].some((value) => value !== null && value > 0)) throw new Error("Укажи положительное значение повторений, времени или дистанции.");
          return { type: "set.save", dayId, exerciseId, setIndex: set.index, weightKg, repetitions, durationSeconds, distanceMeters };
        })}>
          <div className="fields-row">
            <StepField label="Вес, кг" name="weightKg" start={weightStart} step={2.5} min={0} max={2000} />
            <StepField label="Повторения" name="repetitions" start={repsStart} step={1} min={0} max={10000} />
          </div>
          <details open={extraFilled}>
            <summary>Время и дистанция</summary>
            <div className="fields-row">
              <label>Время, секунд<input name="durationSeconds" type="number" inputMode="numeric" min="1" max="86400" step="1" defaultValue={set.durationSeconds ?? ""} /></label>
              <label>Дистанция, м<input name="distanceMeters" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" defaultValue={set.distanceMeters ?? ""} /></label>
            </div>
          </details>
          <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button className="submit" type="submit" disabled={pending}>Сохранить результат</button></div>
        </form>
      </>
    );
  }

  function renderEditorContent(): ReactNode {
    switch (editor.kind) {
      case "food": return renderFoodForm(editor.entry);
      case "finance": return renderFinanceForm(editor.entry);
      case "finance-plan": return renderFinancePlanForm(editor.plan);
      case "finance-plan-purchase": return renderFinancePlanPurchaseForm(editor.plan);
      case "debt-create": return renderDebtCreateForm();
      case "debt-repayment": return renderDebtRepaymentForm(editor.debt);
      case "target": return renderTargetForm();
      case "whats-new": return renderWhatsNew();
      case "weight": return renderWeightForm();
      case "accounts": return renderAccountsForm(editor.account);
      case "recurring": return renderRecurringForm(editor.item);
      case "program": return renderProgramForm();
      case "exercise": return renderExerciseForm(editor.dayId);
      case "set": return renderSetForm(editor.dayId, editor.exerciseId, editor.set);
      case "delete-food": return <ConfirmDelete label={editor.label} pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "food.delete", id: editor.id })} />;
      case "delete-money": return <ConfirmDelete label={editor.label} pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "money.delete", id: editor.id })} />;
      case "delete-finance-plan": return <ConfirmDelete label={editor.label} pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "finance-plan.delete", id: editor.id })} />;
      case "delete-debt": return <ConfirmDelete label={editor.label} note="Вместе с долгом удалятся его возвраты и связанные операции: балансы счетов пересчитаются." pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "debt.delete", id: editor.id })} />;
      case "delete-debt-repayment": return <ConfirmDelete label={editor.label} note="Связанная операция тоже удалится, остаток долга вернётся." pending={pending} onCancel={onClose} onConfirm={() => runCommand({ type: "debt.repayment.delete", id: editor.id })} />;
      case "finish-session": return (
        <div>
          <p>{editor.total === 0 ? "В этой тренировке не было подходов." : editor.done >= editor.total ? `Все подходы выполнены: ${editor.total}.` : `Выполнено подходов: ${editor.done} из ${editor.total}. Остальные не попадут в журнал.`} Завершить тренировку?</p>
          <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Продолжить тренировку</button><button className="submit" type="button" disabled={pending} onClick={() => runCommand({ type: "session.finish", id: editor.sessionId })}>Завершить</button></div>
        </div>
      );
    }
  }

  return (
    <motion.dialog
      ref={dialogRef}
      className={`editor${editor.kind === "program" || editor.kind === "exercise" || editor.kind === "set" ? " editor--workout" : ""}`}
      aria-labelledby="lifeos-editor-title"
      aria-busy={pending}
      variants={motionVariants.dialog}
      initial="initial"
      animate="animate"
      exit="exit"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current && !pending) onClose(); }}
      onInput={(event) => { setSaved(false); const target = event.target; if (target instanceof HTMLElement && target.closest("form")) dirtyRef.current = true; if (target instanceof HTMLElement && target.getAttribute("aria-invalid")) { target.removeAttribute("aria-invalid"); setFormError(null); } }}
      onInvalidCapture={(event) => {
        event.preventDefault();
        if (invalidHandledRef.current) return;
        invalidHandledRef.current = true;
        window.setTimeout(() => { invalidHandledRef.current = false; }, 0);
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
        const label = (field.closest("label")?.firstChild?.textContent ?? field.getAttribute("aria-label") ?? "Поле").trim();
        const { validity } = field;
        setFormError(validity.valueMissing ? `Заполни поле «${label}».` : validity.rangeOverflow || validity.rangeUnderflow ? `Значение в поле «${label}» вне допустимого диапазона.` : validity.stepMismatch || validity.badInput ? `В поле «${label}» нужно число в верном формате.` : `Проверь поле «${label}».`);
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }}
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
      <AnimatePresence initial={false} mode="wait">{activeError && <motion.p key="editor-error" className="error" role="alert" variants={motionVariants.state} initial="initial" animate="animate" exit="exit">{activeError}</motion.p>}</AnimatePresence>
      {onConnectAi && activeError?.includes("ИИ пока не настроен") && <div className="actions"><button type="button" onClick={onConnectAi}>Подключить ИИ</button></div>}
      <AnimatePresence initial={false} mode="wait">
        {saved ? <motion.p key="editor-saved" role="status" aria-live="polite" variants={motionVariants.state} initial="initial" animate="animate" exit="exit">Сохранено.</motion.p> : null}
      </AnimatePresence>
      {confirmClose && (
        <div role="alertdialog" aria-labelledby="lifeos-editor-discard">
          <p id="lifeos-editor-discard">Есть несохранённые изменения. Закрыть без сохранения?</p>
          <div className="actions">
            <button type="button" autoFocus onClick={() => setConfirmClose(false)}>Продолжить ввод</button>
            <button type="button" className="danger" onClick={closeNow}>Закрыть без сохранения</button>
          </div>
        </div>
      )}
      {renderEditorContent()}
    </motion.dialog>
  );
}

/** A number field with − / + buttons: weight and repetitions change by one tap instead of typing. */
function StepField({ label, name, start, step, min, max }: { label: string; name: string; start: number | null; step: number; min: number; max: number }) {
  const [value, setValue] = useState(start === null ? "" : String(start).replace(".", ","));
  const bump = (delta: number) => {
    const current = Number(value.replace(",", "."));
    const base = value.trim() !== "" && Number.isFinite(current) ? current : 0;
    const next = Math.min(max, Math.max(min, Math.round((base + delta) * 100) / 100));
    setValue(String(next).replace(".", ","));
  };
  return (
    <div className="step-field">
      <label htmlFor={`step-${name}`}>{label}</label>
      <div className="stepper">
        <button type="button" aria-label={`${label}: меньше`} onClick={() => bump(-step)}>−</button>
        <input id={`step-${name}`} name={name} type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
        <button type="button" aria-label={`${label}: больше`} onClick={() => bump(step)}>+</button>
      </div>
    </div>
  );
}

function ConfirmDelete({ label, note, pending, onCancel, onConfirm }: { label: string; note?: string; pending: boolean; onCancel(): void; onConfirm(): void }) {
  return <div><p>Удалить «{label}»? Это действие нельзя отменить.</p>{note && <p>{note}</p>}<div className="actions"><button type="button" disabled={pending} onClick={onCancel}>Оставить</button><button className="submit" type="button" disabled={pending} onClick={onConfirm}>Удалить</button></div></div>;
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
    case "finance-plan": return editor.plan ? "Изменить план" : "План покупки";
    case "finance-plan-purchase": return "Записать покупку";
    case "debt-create": return "Новый долг";
    case "debt-repayment": return editor.debt.direction === "i_owe" ? "Возврат долга" : "Получение возврата";
    case "target": return editor.firstRun ? "Расскажи о себе" : "Профиль и цель КБЖУ";
    case "whats-new": return "Что нового";
    case "weight": return "Масса тела";
    case "accounts": return "Счета и курс";
    case "recurring": return editor.item ? "Изменить платёж" : "Подписки и платежи";
    case "program": return "Тренировочный план";
    case "exercise": return "Новое упражнение";
    case "set": return "Результат подхода";
    case "delete-food": return "Удалить запись еды";
    case "delete-money": return "Удалить операцию";
    case "delete-finance-plan": return "Удалить план";
    case "delete-debt": return "Удалить долг";
    case "delete-debt-repayment": return "Удалить возврат";
    case "finish-session": return "Завершить тренировку";
  }
}

function frequencyLabel(frequency: "weekly" | "monthly" | "yearly"): string {
  if (frequency === "weekly") return "еженедельно";
  if (frequency === "yearly") return "ежегодно";
  return "ежемесячно";
}

