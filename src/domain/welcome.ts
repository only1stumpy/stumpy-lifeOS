import type { LifeFeature, LifeModule } from "./modules";

const h = (title: string) => `<b>${title}</b>`;

/**
 * Welcome and help text for the bot as Telegram HTML. It describes only the sections and features
 * the user has switched on, with examples the bot actually understands.
 */
export function buildWelcomeMessage(input: {
  modules: readonly LifeModule[];
  features: readonly LifeFeature[];
  /** The user has not finished the Mini App onboarding yet. */
  firstRun: boolean;
}): string {
  const { modules, features, firstRun } = input;
  const has = (feature: LifeFeature) => features.includes(feature);
  const parts: string[] = [];

  parts.push("Привет! Я Stumpy’s LifeOS — личный дневник питания, денег и тренировок. Пиши мне обычными сообщениями: я пойму, что это, и покажу черновик. Всё то же самое можно делать вручную в приложении.");
  if (firstRun) {
    parts.push("Начни с кнопки «Открыть LifeOS»: там короткое знакомство. Выберешь разделы, которыми будешь пользоваться, зададешь норму КБЖУ и стартовый счёт.");
  }
  parts.push([
    h("Как это работает"),
    "• Запишу только после кнопки «Записать».",
    "• Ошибся? Нажми «Исправить» и пришли правку следующим сообщением, или «Отменить».",
    "• Фото тоже подойдёт: еда, этикетка или чек.",
  ].join("\n"));

  if (modules.includes("nutrition")) {
    const lines = [
      h("Питание"),
      "• Напиши, что съел: «гречка с курицей и яблоко». Посчитаю калории, белки, жиры и углеводы.",
      "• Несколько приёмов пищи в одном сообщении подтверждаются отдельно.",
    ];
    if (has("nutrition.weight")) lines.push("• Вес: «вес 72,4» или «72,4 кг». Запишу замер на сегодня; повтор за день заменит прежний. Это работает без ИИ.");
    lines.push("• Норму и цель настраивай в приложении: «Питание» → «Цель КБЖУ».");
    parts.push(lines.join("\n"));
  }

  if (modules.includes("finance")) {
    const lines = [
      h("Финансы"),
      "• Расход или доход: «кофе 45», «такси 120», «получил зарплату 15000». Категорию подберу сам, а если не пойму, спрошу.",
      "• Чек на фото: разберу позиции по отдельности, подтвердишь одной кнопкой.",
    ];
    if (modules.includes("nutrition")) lines.push("• Еда и расход в одном сообщении («пообедал в кафе за 120») станут двумя отдельными черновиками.");
    if (has("finance.debts")) lines.push("• Долги: «я должен Ивану 500», «Иван должен мне 300», «занял 500 у Ивана», «Иван вернул мне 200». Без ИИ.");
    if (has("finance.plans")) lines.push("• Планы покупок: «запиши в планы шампунь за 220р». План не расход, пока не отметишь покупку. Без ИИ.");
    if (has("finance.subscriptions")) lines.push("• Подписки и регулярные платежи заводятся в приложении: «Финансы» → «Добавить операцию» → «Регулярные платежи». Напомню о сроке, а расходом платёж станет после «Оплата списана».");
    lines.push("• Счета в рублях ПМР и долларах и курс настраиваются в приложении.");
    parts.push(lines.join("\n"));
  }

  if (modules.includes("gym")) {
    parts.push([
      h("Зал"),
      "• Тренировки ведутся в приложении: составь программу, выбери упражнения, отмечай подходы и смотри таймер отдыха.",
      "• Команда /today покажет, какая тренировка следующая.",
    ].join("\n"));
  }

  const questions: string[] = [];
  if (modules.includes("finance")) questions.push("«сколько я потратил за неделю?»");
  if (modules.includes("nutrition")) questions.push("«сколько калорий мне осталось?»");
  if (questions.length) {
    parts.push([
      h("Вопросы"),
      `Спроси по своим данным: ${questions.join(", ")}. Отвечу и ничего не запишу.`,
    ].join("\n"));
  }

  parts.push([
    h("Команды"),
    "/today — что уже есть за сегодня",
    "/cancel — отменить исправление",
    "/help — эта справка",
  ].join("\n"));

  const noAi = [has("nutrition.weight") && "вес", has("finance.debts") && "долги", has("finance.plans") && "планы"].filter(Boolean);
  parts.push([
    h("Настройки"),
    "• Сводки и напоминания, разделы и функции: в приложении шестерёнка → «Персонализация».",
    "• Разбор текста и фото идёт через твой бесплатный ключ ИИ: подключи его в приложении, шестерёнка → «ИИ-провайдеры».",
    noAi.length
      ? `• Без ключа бот не разберёт свободный текст и фото, но ${noAi.join(", ")} и /today работают, а всё остальное можно ввести вручную в приложении.`
      : "• Без ключа бот не разберёт свободный текст и фото, но всё можно ввести вручную в приложении.",
  ].join("\n"));

  return parts.join("\n\n");
}
