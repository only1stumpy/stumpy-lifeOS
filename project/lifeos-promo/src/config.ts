// ВСЁ, что правится без копания в сценах: тексты, тайминги, CTA, звук.
export const config = {
  audio: { enabled: true, volume: 1, file: "audio/sfx.wav" },

  // Промо перед релизом 1.0: подогреть аудиторию, позвать в бета-тест.
  hook: { badge: "Скоро релиз LifeOS 1.0", line1: "Просто напиши.", line2: "LifeOS всё посчитает." },

  captions: {
    confirm: "Ничего не пишется без твоего «Записать»",
    linkFood: "Запись уже в дневнике",
    split: "Еда и расход живут отдельно",
    linkMoney: "Баланс и траты обновились",
    multi: "Несколько приёмов за раз",
    receipt: "Чек превращается в расходы",
    today: "Весь день на одном экране",
    nutrition: "Дневник и история питания",
    finance: "Деньги: баланс, траты, планы и долги",
    gym: "Подходы, таймер отдыха и подсказка добавить вес",
    settings: "Включай только то, что нужно",
  },

  final: {
    title: "LifeOS 1.0",
    modules: ["Питание", "Финансы", "Зал"],
    release: "Скоро релиз",
    teaser: "Готовим выход LifeOS 1.0.\nСледи за обновлениями.",
    keys: "Свои бесплатные ключи ИИ, а без ИИ всё вносится руками",
    license: "Код открыт (AGPL-3.0)",
    cta: "Хочешь в бета-тест — пиши в личку",
  },


  // Секунды. Сцены A идут встык, блок приложения (B) одним непрерывным окном.
  timing: {
    food: { start: 0, end: 10 },
    split: { start: 10, end: 16.4 },
    multi: { start: 16.4, end: 20.2 },
    receipt: { start: 20.2, end: 24 },
    app: { start: 24, end: 46 },
    final: { start: 46, end: 52 },
  },
  crossfadeFrames: 6,
} as const;

export const totalSeconds = config.timing.final.end;

// Демонстрационные данные (не реальные данные пользователя).
export type FoodEntry = { time: string; label: string; portion: string; kcal: number; p: number; f: number; c: number; est?: boolean };
export const FOOD = {
  omelet: { time: "08:20", label: "Омлет с сыром", portion: "2 яйца", kcal: 340, p: 22, f: 24, c: 4 },
  yogurt: { time: "10:15", label: "Йогурт с мюсли", portion: "1 порция", kcal: 260, p: 9, f: 7, c: 40 },
  curd: { time: "11:40", label: "Творог с ягодами", portion: "200 г", kcal: 480, p: 38, f: 17, c: 44 },
  buckwheat: { time: "13:42", label: "Гречка с курицей", portion: "1 порция", kcal: 420, p: 38, f: 8, c: 48, est: true },
  udon: { time: "13:50", label: "Удон", portion: "1 порция", kcal: 340, p: 12, f: 6, c: 62, est: true },
} satisfies Record<string, FoodEntry>;
export const TARGET = { kcal: 2700, p: 150, f: 80, c: 340 };

export type MoneyRow = { time: string; label: string; category: string; amount: number; kind: "expense" | "income"; day: string };
export const MONEY = {
  taxi: { time: "08:40", label: "Такси", category: "Транспорт", amount: 600, kind: "expense", day: "понедельник, 16 ноября" },
  coffee: { time: "10:05", label: "Кофе", category: "Кафе и рестораны", amount: 900, kind: "expense", day: "понедельник, 16 ноября" },
  udon: { time: "13:50", label: "Удон", category: "Кафе и рестораны", amount: 425, kind: "expense", day: "понедельник, 16 ноября" },
  salary: { time: "09:00", label: "Зарплата", category: "Доход", amount: 75000, kind: "income", day: "воскресенье, 15 ноября" },
} satisfies Record<string, MoneyRow>;
export const FIN = { balanceBefore: 41075, balanceAfter: 40650, todayBefore: 1500, todayAfter: 1925, month: 62250 };

// ---------- Второй ролик: «Один день с LifeOS» (композиция Day, 30 с) ----------
export const day = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-day.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Один день.", line2: "Ноль форм." },
  // start — секунда начала шага; time — что показывают часы.
  steps: {
    weight: { start: 2.4, time: "08:10", caption: "Вес — одним сообщением", text: "вес 72" },
    breakfast: { start: 6.4, time: "09:00", caption: "Завтрак записан", text: "омлет из двух яиц" },
    salary: { start: 10.8, time: "13:30", caption: "Зарплата пришла — баланс вырос", text: "получил зарплату 75000" },
    plan: { start: 15.0, time: "16:00", caption: "План — ещё не расход", text: "запиши в планы кроссовки за 9000" },
    gym: { start: 18.8, time: "19:00", caption: "Тренировка под контролем", text: "" },
    question: { start: 23.0, time: "22:00", caption: "Спросил — ничего не записалось", text: "сколько я потратил сегодня?" },
  },
  final: { start: 26.8, end: 30, title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 3: «Исправить» (композиция Fix) ----------
export const fix = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-fix.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Бот ошибся?", line2: "Поправь словами." },
  captions: {
    wrong: "Бот понял не так?",
    edit: "Нажми «Исправить» и напиши, что поправить",
    confirm: "Ничего не пишется без твоего «Записать»",
    link: "В дневнике — то, что ты подтвердил",
  },
  texts: { first: "съел гречку с курицей", fix: "гречки две тарелки, мяса вдвое меньше" },
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 4: «Куда ушли деньги» (композиция Money) ----------
export const money = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-money.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Куда ушли", line2: "деньги?" },
  question: "сколько я потратил за месяц?",
  captions: {
    ask: "Один вопрос — сразу цифра",
    overview: "Баланс, траты и категории",
    ops: "Все операции на месте",
    plans: "План — ещё не расход",
    debts: "Долги под рукой",
  },
  // секунды начала блоков
  t: { type: 2.3, window: 5.0, ops: 11.2, plans: 13.4, debts: 15.4, final: 17.6, end: 21.2 },
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 5: «Я бросал вести учёт» (композиция Quit) ----------
export const quit = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-quit.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Я бросал учёт", line2: "три раза." },
  captions: {
    form: "Обычный трекер: 10 полей на одну гречку",
    quit: "Через неделю бросаешь",
    chat: "В LifeOS — просто напиши",
    done: "10 полей → одно сообщение",
  },
  text: "съел гречку с курицей",
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 6: «Бот против таблицы» (композиция Duel) ----------
export const duel = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-duel.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Бот", line2: "против таблицы" },
  captions: {
    task: "Внести обед и чек. Кто быстрее?",
    go: "Время пошло",
  },
  lunch: "съел удон",
  result: { slow: "40 секунд", vs: "против", fast: "4 секунды", note: "Бот быстрее в 10 раз" },
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 7: «Три приложения против одного» (композиция Apps) ----------
export const apps = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-apps.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Три приложения", line2: "или один чат?" },
  captions: {
    food: "Еда — в одном приложении",
    money: "Траты — в другом",
    gym: "Зал — в третьем",
    three: "Три приложения. Три входа. Три формы.",
    chat: "В LifeOS — просто напиши в Телеграме",
    split: "Еда и трата — два отдельных черновика",
    mini: "Зал — в Mini App, там же, в Телеграме",
  },
  text: "съел удон за 425",
  result: { old: "3 приложения", now: "1 чат", note: "Еда, траты и зал. Привычный Телеграм." },
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;

// ---------- Ролик 8: «Одолжил другу» (композиция Debt) ----------
// Тексты бота: drafts.ts (formatDraft), callbacks.ts (подтверждение долга и возврата). Разбор фраз: debt-message.ts.
export const debt = {
  audio: { enabled: true, volume: 1, file: "audio/sfx-debt.wav" },
  badge: "Скоро релиз LifeOS 1.0",
  hook: { line1: "Одолжил другу.", line2: "Сколько вернул?" },
  texts: { owed: "Али должен мне 3000", back: "Али вернул 1000" },
  captions: {
    owed: "Просто напиши, кто должен",
    saved: "Долг и операция — вместе",
    back: "Вернул часть? Тоже сообщением",
    rest: "Остаток считается сам",
    link: "Все долги — в одном разделе",
  },
  final: { title: "LifeOS 1.0", release: "Скоро релиз", ask: "Хочешь в бета-тест?", contact: "Telegram: @only1stumpy" },
} as const;
