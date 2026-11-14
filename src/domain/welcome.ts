import type { LifeFeature, LifeModule } from "./modules";

const h = (title: string) => `<b>${title}</b>`;

export type WelcomeInput = {
  modules: readonly LifeModule[];
  features: readonly LifeFeature[];
};

/**
 * Short greeting for /start: what the bot is, what it can do, and where to begin. The detailed
 * walkthrough lives in the Mini App onboarding and in /help, so this stays readable in seconds.
 * Telegram HTML; only enabled sections are named.
 */
export function buildStartMessage({ modules, features, firstRun }: WelcomeInput & { firstRun: boolean }): string {
  const has = (feature: LifeFeature) => features.includes(feature);
  const abilities: string[] = [];
  if (modules.includes("nutrition")) abilities.push(`• ${h("Питание")} — считаю калории и КБЖУ${has("nutrition.weight") ? ", веду вес" : ""}.`);
  if (modules.includes("finance")) abilities.push(`• ${h("Финансы")} — записываю расходы и доходы${has("finance.debts") ? ", веду долги" : ""}.`);
  if (modules.includes("gym")) abilities.push(`• ${h("Зал")} — помогаю следить за тренировками через приложение.`);
  abilities.push(`• ${h("Сводки")} — показываю итоги дня и недели.`);

  const example = modules.includes("nutrition") && modules.includes("finance")
    ? "напиши мне «съел гречку с курицей» или «кофе 45»"
    : modules.includes("nutrition") ? "напиши мне «съел гречку с курицей»"
    : modules.includes("finance") ? "напиши мне «кофе 45»"
    : "открой приложение";
  const howItWorks = modules.includes("nutrition") || modules.includes("finance")
    ? `Здесь всё просто: ${example}, и я помогу внести запись в дневник.`
    : "Здесь всё просто: открой приложение и веди тренировки.";

  const begin = firstRun
    ? [h("С чего начать?"), "Нажми «Открыть LifeOS» и пройди короткое знакомство: выберешь нужные разделы, настроишь профиль и подключишь ИИ. Всё можно поменять позже."]
    : [h("Где приложение?"), "Кнопка «Открыть LifeOS» под этим сообщением. Разделы и сводки настраиваются там: шестерёнка → «Персонализация»."];

  return [
    "Привет! Я Stumpy’s LifeOS — твой личный помощник для питания, финансов и тренировок.",
    howItWorks,
    [h("Что я умею"), ...abilities].join("\n"),
    begin.join("\n"),
    "Понадобится помощь — отправь /help.",
  ].join("\n\n");
}

export type HelpSectionId = "nutrition" | "finance" | "gym" | "digest" | "ai" | "commands";

export const HELP_MENU_TEXT = `${h("Справка LifeOS")}\nЧто хочешь узнать? Выбери раздел, и я покажу примеры сообщений и возможности.`;

/** Sections offered in the /help menu: the user's enabled modules first, then the general ones. */
export function helpSections({ modules }: WelcomeInput): { id: HelpSectionId; label: string }[] {
  const sections: { id: HelpSectionId; label: string }[] = [];
  if (modules.includes("nutrition")) sections.push({ id: "nutrition", label: "Питание" });
  if (modules.includes("finance")) sections.push({ id: "finance", label: "Финансы" });
  if (modules.includes("gym")) sections.push({ id: "gym", label: "Зал" });
  sections.push({ id: "digest", label: "Сводки" }, { id: "ai", label: "ИИ и ключи" }, { id: "commands", label: "Команды" });
  return sections;
}

export function isHelpSectionId(value: string): value is HelpSectionId {
  return ["nutrition", "finance", "gym", "digest", "ai", "commands"].includes(value);
}

/** Detailed text of one help section, or null when its module is switched off. */
export function buildHelpSection(id: HelpSectionId, { modules, features }: WelcomeInput): string | null {
  const has = (feature: LifeFeature) => features.includes(feature);

  if (id === "nutrition") {
    if (!modules.includes("nutrition")) return null;
    const lines = [
      h("Питание"),
      "• Напиши, что съел: «гречка с курицей и яблоко». Я посчитаю калории, белки, жиры и углеводы. То же по фото еды или этикетки.",
      "• В приложении у тебя дневная норма под цель: похудеть, держать вес или набрать массу. В /today и вечерних итогах видно, сколько уже съедено и сколько ещё осталось.",
    ];
    if (has("nutrition.weight")) lines.push("• Вес: «вес 72,4» или «72,4 кг». Замер запишется на сегодня, а повторный в тот же день его заменит. Это работает даже без ИИ. В приложении есть график веса с линией среднего за неделю, а по воскресеньям я предложу пересчитать норму по среднему весу.");
    return lines.join("\n");
  }

  if (id === "finance") {
    if (!modules.includes("finance")) return null;
    const lines = [
      h("Финансы"),
      "• Расход или доход: «кофе 45», «такси 120», «получил зарплату 15000». Я разложу по категориям, а если не пойму, спрошу. С фото чека разберу все позиции.",
      "• В приложении видно баланс по счетам (рубли ПМР и доллары, курс ты задаёшь сам), историю операций и траты за день и месяц.",
    ];
    if (has("finance.debts")) lines.push("• Долги: «я должен Ивану 500», «Иван должен мне 300», «занял 500 у Ивана», «Иван вернул мне 200». Я помню, кто кому и сколько должен, учитываю частичные возвраты и напомню о сроке. Это работает без ИИ.");
    if (has("finance.plans")) lines.push("• Планы покупок: «запиши в планы шампунь за 220р». План не считается расходом, пока ты не отметишь, что купил. Это тоже без ИИ.");
    if (has("finance.subscriptions")) lines.push("• Подписки и регулярные платежи заводятся в приложении: «Финансы» → «Добавить операцию» → «Регулярные платежи». Я напомню, когда подходит списание, а расходом оно станет только после твоего «Оплата списана».");
    return lines.join("\n");
  }

  if (id === "gym") {
    if (!modules.includes("gym")) return null;
    return [
      h("Зал"),
      "• Тренировки ведутся в приложении: составь программу, выбери упражнения, отмечай подходы и следи за таймером отдыха.",
      "• Приложение запоминает прошлые результаты и подскажет, когда пора добавить вес. Команда /today скажет, какая тренировка следующая.",
    ].join("\n");
  }

  if (id === "digest") {
    const questions: string[] = [];
    if (modules.includes("finance")) questions.push("«сколько я потратил за неделю?»");
    if (modules.includes("nutrition")) questions.push("«сколько калорий мне осталось?»");
    return [
      h("Сводки и вопросы"),
      "• Вечером я присылаю итоги дня, а по воскресеньям недельный обзор. Что и когда присылать, решаешь ты: в приложении шестерёнка → «Персонализация».",
      ...(questions.length ? [`• Можно просто спросить про свои данные: ${questions.join(", ")}. Я отвечу и ничего не запишу.`] : []),
    ].join("\n");
  }

  if (id === "ai") {
    const noAi = [has("nutrition.weight") && "вес", has("finance.debts") && "долги", has("finance.plans") && "планы"].filter(Boolean);
    return [
      h("ИИ и ключи"),
      "Чтобы я понимал обычный текст и фото, нужен твой бесплатный ключ ИИ. Подключается в приложении: шестерёнка → «ИИ-провайдеры».",
      noAi.length
        ? `Без ключа ${noAi.join(", ")} и /today всё равно работают, а остальное можно вносить вручную в приложении.`
        : "Без ключа всё можно вносить вручную в приложении.",
    ].join("\n");
  }

  return [
    h("Команды"),
    "• Пиши обычными словами, как другу. Перед записью я покажу, что понял: жми «Записать», либо «Исправить» и напиши, что поправить, либо «Отменить».",
    "• Фото тоже подойдёт: еда, этикетка или чек.",
    "/today — что уже есть за сегодня",
    "/cancel — отменить исправление",
    "/help — эта справка",
  ].join("\n");
}
