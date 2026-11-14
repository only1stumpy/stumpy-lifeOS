import { formatMoneyPlain as formatMoney } from "@/domain/currencies";
import type { AppSnapshot } from "@/domain/app";
import { ALL_FEATURES, normalizeModules, type LifeFeature } from "@/domain/modules";
import { dateKey } from "@/domain/math";

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
}


/** Handles personal facts locally so money and nutrition values never come from model arithmetic. */
export function answerKnownReferenceQuestion(question: string, snapshot: AppSnapshot): string | null {
  const query = normalize(question);

  const asksBalance = /сколько.*(баланс|счет|usd|доллар|mastercard|карт)|(?:баланс|остаток).*(сейчас|счет|на счет|карт|usd|доллар)|^мой баланс$|^баланс[?!. ]*$/.test(query);
  if (asksBalance) {
    const accountByName = snapshot.finance.accounts.find((account) => {
      const name = normalize(account.name);
      return name.length > 2 && query.includes(name);
    });
    const wantsUsd = /usd|доллар|mastercard/.test(query);
    const account = accountByName
      ?? (wantsUsd
        ? snapshot.finance.accounts.find((item) => item.currency === "USD")
        : snapshot.finance.accounts.find((item) => item.id === snapshot.settings.defaultAccountId)
          ?? snapshot.finance.accounts.find((item) => item.isDefault)
          ?? snapshot.finance.accounts[0]);

    if (!account) {
      return wantsUsd
        ? "Счёта в USD в LifeOS пока нет. Добавь его в разделе «Финансы» — тогда смогу назвать остаток."
        : "Счёт в LifeOS пока не добавлен, поэтому текущего баланса ещё нет.";
    }

    const label = account.isDefault && !accountByName && !wantsUsd ? "На основном счёте" : `На счёте «${account.name}»`;
    const amount = formatMoney(account.balanceMinor, account.currency);
    return `${label} сейчас ${amount} по записям LifeOS.`;
  }

  const isExpenseQuestion = /потрат|расход|трат|ушло|ушли/.test(query);
  if (isExpenseQuestion && /сегодня|сейчас/.test(query)) {
    return `Сегодня записано расходов на ${formatMoney(snapshot.finance.spentTodayMinor, snapshot.settings.baseCurrency)}.`;
  }
  if (isExpenseQuestion && /месяц/.test(query)) {
    return `За этот месяц записано расходов на ${formatMoney(snapshot.finance.spentMonthMinor, snapshot.settings.baseCurrency)}.`;
  }

  const asksMacros = /кбжу|калори|белк|жир|углевод/.test(query);
  const asksToday = /сегодня|за день|сейчас|остал|добрать/.test(query);
  if (asksMacros && asksToday) {
    const { consumed, target } = snapshot.nutrition;
    const lines = [
      `Сегодня: ${Math.round(consumed.calories)} ккал · Б ${Math.round(consumed.proteinGrams)} · Ж ${Math.round(consumed.fatGrams)} · У ${Math.round(consumed.carbsGrams)} г.`,
    ];
    if (target) {
      lines.push(`До цели осталось: ${Math.max(0, Math.round(target.calories - consumed.calories))} ккал · Б ${Math.max(0, Math.round(target.proteinGrams - consumed.proteinGrams))} · Ж ${Math.max(0, Math.round(target.fatGrams - consumed.fatGrams))} · У ${Math.max(0, Math.round(target.carbsGrams - consumed.carbsGrams))} г.`);
    } else {
      lines.push("Дневная цель КБЖУ пока не настроена.");
    }
    return lines.join("\n");
  }

  const asksWorkout = /зал|трениров|тренить|упражнен/.test(query);
  if (asksWorkout && /сегодня|сейчас|следующ|план/.test(query)) {
    if (snapshot.activeSession && snapshot.gym.nextWorkout) {
      return `Сейчас идёт тренировка «${snapshot.gym.nextWorkout.name}» · ${snapshot.gym.nextWorkout.exercises.length} упражнений.`;
    }
    if (snapshot.gym.trainingDay && snapshot.gym.nextWorkout) {
      return `По плану сегодня «${snapshot.gym.nextWorkout.name}» · ${snapshot.gym.nextWorkout.exercises.length} упражнений.`;
    }
    return snapshot.gym.nextWorkout
      ? `Ближайший тренировочный день — «${snapshot.gym.nextWorkout.name}» · ${snapshot.gym.nextWorkout.exercises.length} упражнений.`
      : "Тренировочный план пока не составлен. Можешь собрать дни и выбрать упражнения в разделе «Зал».";
  }

  return null;
}

/** Only an explicit question is eligible for AI reference mode; plain capture text stays in the logging flow. */
export function isReferenceQuestion(text: string): boolean {
  const query = normalize(text);
  if (!query) return false;
  if (/[?？]/u.test(query)) return true;
  return /^(?:сколько|какой|какая|какие|какое|что|когда|где|как|почему|зачем|чем|подскажи|объясни|расскажи|напомни)(?:$|[\s,.:!?])/.test(query)
    || /мой баланс|мои расходы|мое кбжу|мои тренировки/.test(query);
}

/** A bounded, read-only view of LifeOS data for grounded conversational answers. */
export function makeReferenceContext(snapshot: AppSnapshot): string {
  const monthStart = `${snapshot.localDate.slice(0, 7)}-01`;
  const recentFinance = snapshot.finance.entries
    .filter((entry) => dateKey(entry.occurredAt, snapshot.settings.timeZone) >= monthStart)
    .slice(0, 60)
    .map(({ label, occurredAt, amountMinor, currency, category, kind }) => ({
      label,
      date: dateKey(occurredAt, snapshot.settings.timeZone),
      amountMinor,
      currency,
      category,
      kind,
    }));

  const context = {
    date: snapshot.localDate,
    timezone: snapshot.settings.timeZone,
    finance: {
      accounts: snapshot.finance.accounts.map(({ name, currency, balanceMinor, isDefault }) => ({ name, currency, balanceMinor, isDefault })),
      spentTodayMinor: snapshot.finance.spentTodayMinor,
      spentMonthMinor: snapshot.finance.spentMonthMinor,
      recentMonthEntries: recentFinance.slice(0, 30),
      categories: snapshot.reports.expenseCategories.slice(0, 20),
      recurring: snapshot.recurring.slice(0, 30).map(({ name, amountMinor, currency, category, frequency, nextDueAt }) => ({ name, amountMinor, currency, category, frequency, nextDueAt: nextDueAt.slice(0, 10) })),
    },
    nutrition: {
      today: snapshot.nutrition.consumed,
      target: snapshot.nutrition.target,
      todayEntries: snapshot.nutrition.entries.slice(0, 20).map(({ label, portionLabel, calories, proteinGrams, fatGrams, carbsGrams }) => ({ label, portionLabel, calories, proteinGrams, fatGrams, carbsGrams })),
      recentDailyMacros: snapshot.reports.nutritionDays.slice(-21),
      latestWeightKg: snapshot.nutrition.bodyWeightKg,
      weightHistory: snapshot.nutrition.weightHistory.slice(-30),
      usualFoods: snapshot.templates.slice(0, 30),
    },
    gym: {
      trainingDay: snapshot.gym.trainingDay,
      nextWorkout: snapshot.gym.nextWorkout ? {
        name: snapshot.gym.nextWorkout.name,
        exercises: snapshot.gym.nextWorkout.exercises.map(({ name, sets }) => ({ name, targetSets: sets.length })),
      } : null,
      lastWorkout: snapshot.gym.lastWorkout,
      program: snapshot.gym.program.slice(0, 8).map((day) => ({ name: day.name, exercises: day.exercises.slice(0, 12).map(({ name }) => name) })),
      progress: snapshot.reports.exerciseProgress.slice(0, 12).map((exercise) => ({ name: exercise.name, latest: exercise.points.slice(-5) })),
    },
  };
  const serialized = JSON.stringify(withEnabledModules(context, snapshot.settings.enabledModules, snapshot.settings.enabledFeatures));
  if (serialized.length <= 7_500) return serialized;

  // Keep the aggregate facts needed for answers when a long personal history exceeds the prompt budget.
  return JSON.stringify(withEnabledModules({
    date: snapshot.localDate,
    timezone: snapshot.settings.timeZone,
    finance: {
      accounts: snapshot.finance.accounts.slice(0, 20).map(({ name, currency, balanceMinor, isDefault }) => ({ name: name.slice(0, 80), currency, balanceMinor, isDefault })),
      spentTodayMinor: snapshot.finance.spentTodayMinor,
      spentMonthMinor: snapshot.finance.spentMonthMinor,
    },
    nutrition: { today: snapshot.nutrition.consumed, target: snapshot.nutrition.target, latestWeightKg: snapshot.nutrition.bodyWeightKg },
    gym: {
      trainingDay: snapshot.gym.trainingDay,
      nextWorkout: snapshot.gym.nextWorkout ? { name: snapshot.gym.nextWorkout.name.slice(0, 80) } : null,
      lastWorkout: snapshot.gym.lastWorkout,
    },
  }, snapshot.settings.enabledModules, snapshot.settings.enabledFeatures));
}

/** Removes the data of disabled modules so it never reaches the AI. */
function withEnabledModules<T extends { finance?: unknown; nutrition?: unknown; gym?: unknown }>(context: T, stored: readonly string[] | undefined, features: readonly LifeFeature[] = ALL_FEATURES): T & { enabledModules: readonly string[] } {
  const enabled = normalizeModules(stored);
  const withoutKeys = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== "object") return value;
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of keys) delete copy[key];
    return copy;
  };
  const financeHidden = features.includes("finance.subscriptions") ? [] : ["recurring"];
  const nutritionHidden = features.includes("nutrition.weight") ? [] : ["latestWeightKg", "weightHistory"];
  return {
    ...context,
    enabledModules: enabled,
    finance: enabled.includes("finance") ? withoutKeys(context.finance, financeHidden) : undefined,
    nutrition: enabled.includes("nutrition") ? withoutKeys(context.nutrition, nutritionHidden) : undefined,
    gym: enabled.includes("gym") ? context.gym : undefined,
  };
}
