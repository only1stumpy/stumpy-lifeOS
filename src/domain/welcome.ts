import type { LifeFeature, LifeModule } from "./modules";

const h = (title: string) => `<b>${title}</b>`;

type WelcomeInput = {
  modules: readonly LifeModule[];
  features: readonly LifeFeature[];
  /** The user has not finished the Mini App onboarding yet. */
  firstRun: boolean;
};

/** What the bot is for and how it differs from the app. */
function whyBlock(): string {
  return [
    h("Зачем я нужен"),
    "Вести дневник должно быть так же просто, как написать сообщение. Поэтому есть я: напиши «съел гречку с курицей» или «кофе 45», и я сам всё пойму и внесу в твой дневник. Никаких форм и списков.",
    "Приложение (кнопка «Открыть LifeOS») — это весь дневник целиком: история, графики, настройки и всё, что неудобно делать текстом. Оно работает и без меня, так что любую запись можно внести руками.",
    "А ещё я сам пишу тебе: вечерние итоги дня, недельный обзор и напоминания, чтобы ничего не забыть.",
  ].join("\n");
}

/** Friendly step-by-step description of the first-run onboarding in the Mini App. */
function onboardingBlock(modules: readonly LifeModule[]): string {
  const steps = [
    "Нажми кнопку «Открыть LifeOS» под этим сообщением.",
    "Отметь, чем будешь пользоваться: питанием, финансами, залом. Всё ненужное можно выключить.",
    "Скажи, как часто собираешься заходить. По этому я решу, присылать ли тебе сводки и напоминания.",
  ];
  if (modules.includes("nutrition")) steps.push("Расскажи о себе: пол, возраст, рост, вес, как ты двигаешься и чего хочешь добиться. Я сам посчитаю, сколько тебе нужно калорий, белков, жиров и углеводов в день.");
  if (modules.includes("finance")) steps.push("Укажи, сколько сейчас на основном счёте и в какой валюте. Тогда финансы сразу покажут твой баланс.");
  steps.push("Подключи бесплатный ключ ИИ. Приложение шаг за шагом подскажет, где его взять, это пара минут. Без него я не пойму свободный текст и фото.");
  const skippable = [modules.includes("nutrition") && "про себя", modules.includes("finance") && "про счёт"].filter(Boolean);
  return [
    h("Давай начнём со знакомства"),
    "Оно занимает пару минут и проходится один раз. Вот что тебя ждёт:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    `${skippable.length ? `Можно ничего не рассказывать ${skippable.join(" и ")}, эти шаги пропускаются. ` : ""}Всё, что выберешь, потом легко поменять в настройках.`,
  ].join("\n");
}

/** What to write to the bot and what each enabled section can do. */
function guideBlock({ modules, features }: WelcomeInput): string {
  const has = (feature: LifeFeature) => features.includes(feature);
  const parts: string[] = [];

  parts.push([
    h("Как со мной общаться"),
    "• Пиши обычными словами, как другу. Перед записью я покажу, что понял: жми «Записать», либо «Исправить» и напиши, что поправить, либо «Отменить».",
    "• Фото тоже подойдёт: еда, этикетка или чек.",
  ].join("\n"));

  if (modules.includes("nutrition")) {
    const lines = [
      h("Питание"),
      "• Напиши, что съел: «гречка с курицей и яблоко». Я посчитаю калории, белки, жиры и углеводы. То же по фото еды или этикетки.",
      "• В приложении у тебя дневная норма под цель: похудеть, держать вес или набрать массу. В /today и вечерних итогах видно, сколько уже съедено и сколько ещё осталось.",
    ];
    if (has("nutrition.weight")) lines.push("• Вес: «вес 72,4» или «72,4 кг». Замер запишется на сегодня, а повторный в тот же день его заменит. Это работает даже без ИИ. В приложении есть график веса с линией среднего за неделю, а по воскресеньям я предложу пересчитать норму по среднему весу.");
    parts.push(lines.join("\n"));
  }

  if (modules.includes("finance")) {
    const lines = [
      h("Финансы"),
      "• Расход или доход: «кофе 45», «такси 120», «получил зарплату 15000». Я разложу по категориям, а если не пойму, спрошу. С фото чека разберу все позиции.",
      "• В приложении видно баланс по счетам (рубли ПМР и доллары, курс ты задаёшь сам), историю операций и траты за день и месяц.",
    ];
    if (has("finance.debts")) lines.push("• Долги: «я должен Ивану 500», «Иван должен мне 300», «занял 500 у Ивана», «Иван вернул мне 200». Я помню, кто кому и сколько должен, учитываю частичные возвраты и напомню о сроке. Это работает без ИИ.");
    if (has("finance.plans")) lines.push("• Планы покупок: «запиши в планы шампунь за 220р». План не считается расходом, пока ты не отметишь, что купил. Это тоже без ИИ.");
    if (has("finance.subscriptions")) lines.push("• Подписки и регулярные платежи заводятся в приложении: «Финансы» → «Добавить операцию» → «Регулярные платежи». Я напомню, когда подходит списание, а расходом оно станет только после твоего «Оплата списана».");
    parts.push(lines.join("\n"));
  }

  if (modules.includes("gym")) {
    parts.push([
      h("Зал"),
      "• Тренировки ведутся в приложении: составь программу, выбери упражнения, отмечай подходы и следи за таймером отдыха.",
      "• Приложение запоминает прошлые результаты и подскажет, когда пора добавить вес. Команда /today скажет, какая тренировка следующая.",
    ].join("\n"));
  }

  const questions: string[] = [];
  if (modules.includes("finance")) questions.push("«сколько я потратил за неделю?»");
  if (modules.includes("nutrition")) questions.push("«сколько калорий мне осталось?»");
  if (questions.length) {
    parts.push([
      h("Вопросы"),
      `Можно просто спросить про свои данные: ${questions.join(", ")}. Я отвечу и ничего не запишу.`,
    ].join("\n"));
  }

  parts.push([
    h("Сводки и напоминания"),
    "Вечером я присылаю итоги дня, а по воскресеньям недельный обзор. Что и когда присылать, решаешь ты: в приложении шестерёнка → «Персонализация».",
  ].join("\n"));

  parts.push([
    h("Команды"),
    "/today — что уже есть за сегодня",
    "/cancel — отменить исправление",
    "/help — эта справка",
  ].join("\n"));

  const noAi = [has("nutrition.weight") && "вес", has("finance.debts") && "долги", has("finance.plans") && "планы"].filter(Boolean);
  parts.push([
    h("Про ключ ИИ"),
    "Чтобы я понимал обычный текст и фото, нужен твой бесплатный ключ ИИ. Подключается в приложении: шестерёнка → «ИИ-провайдеры».",
    noAi.length
      ? `Без ключа ${noAi.join(", ")} и /today всё равно работают, а остальное можно вносить вручную в приложении.`
      : "Без ключа всё можно вносить вручную в приложении.",
  ].join("\n"));

  return parts.join("\n\n");
}

/**
 * Welcome and help text for the bot as Telegram HTML, split into messages that each fit Telegram's
 * limit. A newcomer gets two: why the bot exists with the first-run steps, then the guide. Everyone
 * else gets one. Only enabled sections and features are described, with examples the bot parses.
 */
export function buildWelcomeMessages(input: WelcomeInput): string[] {
  const greeting = "Привет! Я Stumpy’s LifeOS — личный дневник питания, денег и тренировок в Telegram.";
  if (input.firstRun) {
    return [
      [greeting, whyBlock(), onboardingBlock(input.modules), "Готов? Нажми «Открыть LifeOS» ниже, и начнём!"].join("\n\n"),
      guideBlock(input),
    ];
  }
  return [[greeting, whyBlock(), guideBlock(input)].join("\n\n")];
}
