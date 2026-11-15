# Аудит качества кода и читаемости

Ветка `docs/audit-release-prep`, срез на 2026-11-15. Только чтение кода, правок нет. Объём: `src/` и `tests/`, 89 файлов `.ts/.tsx/.css`, около 24,3 тыс. строк.

## Результаты запусков

| Команда | Результат |
|---|---|
| `npx tsc --noEmit` | 0 ошибок |
| `npx eslint src` | 0 замечаний |
| `npm test` | 109 тестов, 109 pass, 0 fail (около 10,5 с) |

Нет `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `TODO/FIXME` и `any` в `src` и `tests`. Prettier не настроен, стиль форматирования держится вручную (см. Q6).

## Краткая сводка и оценки (1-10)

| Подпункт | Оценка | Комментарий |
|---|---|---|
| Размеры файлов и функций | 4 | Четыре функции-монолита на 500-870 строк, строки до 1500 символов |
| Вложенность и читаемость | 5 | Плотные однострочники, длинные тернарные цепочки и JSX в одну строку |
| Дублирование | 5 | 4 копии `plural`, 3 `formatMoney`, 2 `moneyLabel`, десятки `Intl.*` |
| Мёртвый код и экспорты | 7 | Один неиспользуемый экспорт-функция, остальное типы |
| Нейминг | 7 | Предметный и последовательный; смесь `plural`/`pluralize` |
| Магические значения | 6 | Таймеры и пороги встречаются в тексте, цвета в CSS без токенов |
| Обработка ошибок | 6 | Много `.catch(() => undefined)`, диагностика потеряна в очереди Telegram |
| Типобезопасность | 8 | Нет `any`, `as unknown as` 7 раз (3 в тестах), около 10 `!` на серверных путях |
| Согласованность стиля | 6 | Нет форматтера, 120+ строк длиннее 200 символов |
| Комментарии | 6 | Почти нет (не проверено построчно); сложные места без пояснений |
| Тесты | 6 | Хорошо покрыта чистая логика; UI, `loadSnapshot`, `executeCommand`, бот не покрыты |
| Доступность | 8 | Диалоги, focus management, `aria-*` в 17 файлах, 12 правил reduced-motion |
| Производительность React | 6 | Крупные компоненты с 9-27 `useState`, `Intl` создаётся на каждый вызов |
| CSS | 5 | 53 раза `#742b45` в 11 файлах, 25 `!important`, CSS-модули по 1800 строк |

Общая оценка: 6/10. Типы, ESLint и тесты зелёные, но поддерживаемость проседает из-за нескольких гигантских функций и файлов.

## Размеры файлов и функций (проверено `wc`, `grep -n`)

| Файл | Строк | Самая крупная единица |
|---|---|---|
| `components/editor/editor.tsx` | 1101 | `EditorDialog`, строки 160-1030 (около 870) |
| `server/telegram/bot.ts` | 1163 | `getBot()`, строки 34-547 (около 510) |
| `components/lifeos/lifeos-app.tsx` | 1044 | `LifeOSApp`, строки 360-953 (около 590) |
| `app/lifeos-root.tsx` | 696 | `LifeOSRoot`, строки 200-696 (около 500) |
| `server/lifeos.ts` | 883 | `executeCommand` (549-883, около 335, 38 `case`), `loadSnapshot` (96-264, около 170) |
| `components/ai-providers/ai-providers-panel.tsx` | 1142 | 27 `useState` в файле |
| `server/ai/analyze.ts` | 965 | |
| CSS-модули | 1842 и 1788 | `ai-providers-panel.module.css`, `lifeos-app.module.css` |

## Таблица находок

| ID | Серьёзность | Файл:строка | Суть | Исправление | Труд |
|---|---|---|---|---|---|
| Q1 | high | `src/components/editor/editor.tsx:160-1030` | Один компонент `EditorDialog` около 870 строк, 19 `useState`, разные формы (еда, деньги, зал, вес, долги, планы) в одном теле. Сложно ревьюить и тестировать | Разнести по формам: один файл на вид редактора (`FoodForm`, `MoneyForm` и т.д.), общую обёртку диалога оставить в `EditorDialog` | L |
| Q2 | high | `src/server/telegram/bot.ts:34-547` | `getBot()` регистрирует все хендлеры внутри одной функции около 510 строк с замыканиями | Выделить регистраторы по темам (`registerCallbacks`, `registerMessages`, `registerCommands`), `getBot` только собирает | M |
| Q3 | high | `src/server/lifeos.ts:549-883` | `executeCommand`: огромный `switch` на 38 ветках внутри одной транзакции, ветки по 10-30 строк | Таблица обработчиков `Record<command.type, (tx, owner, cmd) => Promise<void>>`, каждый обработчик в своём модуле по домену | L |
| Q4 | high | `src/components/lifeos/lifeos-app.tsx:360-953` | `LifeOSApp` около 590 строк, 9 `useState`, 5 `useEffect`, внутри JSX строки по 1026 и 1036 символов (782, 891) | Вынести секции (`TodaySection`, `NutritionSection`, `FinanceSection`, `GymSection`) и хук `useRestTimer` | L |
| Q5 | high | `src/app/lifeos-root.tsx:200-696` | `LifeOSRoot` около 500 строк, 18 `useState`, 7 `useEffect` (загрузка, команды, уведомления, Telegram-кнопки) | Хуки `useSnapshot`, `useCommandRunner`, `useTelegramBack`; корень только композиция | M |
| Q6 | medium | `src/server/ai/analyze.ts:110`, `lifeos-app.tsx:782,891`, `lifeos.ts` (56 строк >200 симв., макс. 856) | Строки до 1563 символов, форматтера нет: читаемость и diff страдают | Подключить Prettier (printWidth 120) и один раз прогнать; закрепить в CI/lint-скрипте | S |
| Q7 | medium | `src/components/reports/module-reports.tsx:73`, `ai-quotas-panel.tsx:76`, `editor.tsx:1095`, `lifeos-app.tsx:1034` | Четыре копии склонения (`plural`/`pluralize`), у одной разная сигнатура (массив форм) | Один `pluralRu` в `src/domain` и импорт во все четыре | S |
| Q8 | medium | `src/domain/currencies.ts:60`, `server/telegram/confirmation.ts:82`, `server/telegram/bot.ts:731`, `lifeos-app.tsx:139`, `module-reports.tsx:69` | Пять независимых форматтеров денег с разной сигнатурой и порядком аргументов; риск расхождения отображения суммы в боте и Mini App | Использовать `formatMoney` из `domain/currencies.ts`, остальные удалить | M |
| Q9 | medium | `src/components/lifeos/lifeos-app.tsx:69-70,102-136`, `editor.tsx:55-57,125`, `finance-debts-view.tsx:28`, `module-reports.tsx:17-42` и др. (29 `new Intl.*` в `src`) | `Intl.DateTimeFormat` создаётся на каждый вызов `dayKey`, `todayIn`, `dateHeading`, `timeLabel` (дорого в списках); часть форматтеров продублирована между файлами | Общий модуль `format.ts` с модульными константами и кэшем по `timeZone`; `domain/math.ts:22` уже кэширует, использовать его | S |
| Q10 | medium | `src/server/telegram/bot.ts:796-824` | В `processStoredTelegramUpdate` `catch {}` без логирования, в БД пишется только `handler_failed`. Причину сбоя обработки потом не найти (в консоль ничего не уходит) | Логировать `error.name` и безопасный код причины (как в `http.ts:25`), в `lastError` писать короткий код вида ошибки | S |
| Q11 | medium | `src/server/telegram/bot.ts:89,101,144,155,184,352,353,410,497,501,507,511` и др., `provider-accounts.ts:218`, `analyze.ts:597`, `ai-providers-panel.tsx:466` | Около 15 `.catch(() => undefined)`. Для редактирования сообщений Telegram это оправдано, но нигде нет общего хелпера и комментария; в `ai-providers-panel.tsx:466` пользователю не показывается неудача завершения онбординга | Хелпер `ignoreTelegramError()` с комментарием «сообщение могло быть удалено»; в панели показать ошибку | S |
| Q12 | medium | `src/server/lifeos.ts:133,191,231,380,404` | Утверждения `!` (`exercises.find(...)!`, `completedAt!`, `debt!`) на серверных данных. При несогласованных данных будет падение `TypeError` вместо внятной ошибки | Явная проверка с `AppError(409)` или инвариант-хелпер `must(value, msg)` | S |
| Q13 | medium | `src/server/lifeos.ts:96-264` (`loadSnapshot`), особенно 130-135 | Вложенные `find`/`filter`/`some` по массивам внутри `map` дают O(n·m) на каждом запросе снимка (например `sessions.some` внутри `filter` внутри `map` на строке 135) | Предварительно построить `Map` по `id` и сгруппировать подходы по `sessionId`; не проверено на реальных объёмах | M |
| Q14 | medium | `src/components/lifeos/lifeos-app.tsx:485-489` | `window.setTimeout(..., 0)` внутри `useCallback` без очистки; при размонтировании или быстрой смене таймера возможен устаревший `setRestTimer` | Хранить id в `ref` и чистить в cleanup эффекта, либо `queueMicrotask` с проверкой актуальности | S |
| Q15 | medium | `src/components/lifeos/lifeos-app.tsx:288` | `div role="button"` с ручной обработкой Enter/Space; нативная `button` дала бы это бесплатно (внутри лежат вложенные кнопки, поэтому, возможно, оправдано; не проверено) | Если вложенных интерактивных элементов нет, заменить на `button`; иначе оставить с комментарием | S |
| Q16 | medium | `src/components/reports/module-reports.tsx:90,144,146,321` | Ключи по индексу и `date-index`. Для статических рядов безопасно, но `key={`${item.occurredAt}-${item.name}-${index}`}` (321) пересоздаёт узлы при сортировке | Использовать идентификатор покупки, если он есть в данных | S |
| Q17 | medium | CSS: `#742b45` 53 раза в 11 файлах, `#35272c` 37, `#76666d` 27; `rgba(255,255,255,.72/.78/.82/.88/.9)` в 10+ вариантах | Цвета и прозрачности захардкожены, дизайн-токенов для основных цветов нет (в `lifeos-app.module.css` 122 `var(--`, но акцент бордовый не токенизирован). Смена палитры = поиск по 11 файлам | Токены `--lifeos-accent`, `--lifeos-ink`, `--lifeos-ink-muted`, `--lifeos-glass-*` в `globals.css`, замена в модулях | M |
| Q18 | medium | CSS: `lifeos-app.module.css` (22 `!important`), `finance-debts-view.module.css` (3), `globals.css` (3) | 28 `!important`: борьба за специфичность, затрудняет переопределение | Снизить специфичность исходных правил, убрать `!important` по одному; оставить только для `prefers-reduced-motion` | M |
| Q19 | low | CSS-модули | Радиусы `14/12/17/16/15px` в 8-10 местах (17, 15, 16 почти совпадают), `999px` 21 раз | Шкала радиусов `--radius-sm/md/lg/pill` | S |
| Q20 | low | `src/server/http.ts:16` | `requireConfiguredOwner` экспортируется, но нигде не используется (проверено `grep`) | Удалить или подключить к `app/api/ai-quotas/route.ts`, если там нужна именно эта проверка | S |
| Q21 | low | Неиспользуемые внешние экспорты (по `grep`): `motionStagger` (motion-system.tsx), `macrosSchema` (commands.ts), `lifeModuleSchema`, `lifeFeatureSchema`, `summaryTimeSchema`, `EMPTY_MACROS`, `RELEASE_HISTORY`, `parseBackupJson`, `CLARIFICATION_TTL_MS`, `BACKUP_MAX_BYTES`, `BACKUP_MAX_ROWS` и около 20 типов | Лишняя публичная поверхность; часть (`parseBackupJson`, константы) может использоваться только внутри файла или в тестах без `grep`-совпадения | Убрать `export` у используемых только локально; `ts-prune`/`knip` в dev-зависимости для постоянного контроля | S |
| Q22 | low | `src/app/api/export/route.ts:11`, `bot.ts:814` | `getDb() as unknown as BackupDatabase` и `payload as unknown as Update` обходят типы на границе | Валидировать `Update` через Zod или узкий type guard; привести `BackupDatabase` к реальному типу Drizzle | M |
| Q23 | low | `src/components/ai-providers/ai-providers-panel.module.css:625` | `outline: none` (проверить, что на `:focus-visible` задан заменитель; не проверено) | Убедиться в наличии видимого `:focus-visible` для этого элемента | S |
| Q24 | low | `src/server/ai/analyze.ts:110,395-399` | Разбор ответа Gemini вручную через `asRecord`, `Array.isArray`, `filter` на 1563-символьной строке | Zod-схема ответа провайдера (как уже сделано для структуры ИИ-ответа) | M |
| Q25 | low | Тесты: нет `provider-accounts.ts` (538 строк, шифрование и профили), `exercise-catalog.ts` и UI | `provider-accounts` содержит работу с зашифрованными ключами, прямых тестов нет (по имени файла; логику частично закрывает `ai-provider-security.test.ts`) | Тесты на CRUD аккаунтов и маскирование ключа с фейковой БД, как в `backup.test.ts` | M |
| Q26 | low | `tests/` | Нет тестов компонентов и бота (`bot.ts` 1163 строки, только `confirmation.ts`); `loadSnapshot`/`executeCommand` покрыты минимально (один импорт `../src/server/lifeos`) | Добавить 3-5 интеграционных тестов `executeCommand` по критичным веткам (деньги, долги, подписка) на фейковой БД | L |
| Q27 | low | `src/components/lifeos/lifeos-app.tsx:69-70`, `ai-quotas-panel.tsx:31`, `module-reports.tsx:17` | Три разных `numberFormat` с одним именем и разными опциями в разных файлах: путаница при копировании | Общий `format.ts` (см. Q9) | S |

## Тесты

- Хорошо: чистая бизнес-логика (деньги, КБЖУ, повторения, долги, планы покупок, подтверждения Telegram, резервная копия, квоты, очередь моделей, SSRF-защита `safe-fetch` через `ai-provider-security`), тест на safe-area (`tests/safe-area.test.ts`) защищает договорённость о стилях.
- Слабо: компоненты React, `bot.ts`, `lifeos.ts` (запись в БД), `provider-accounts.ts`.
- Тесты-зеркала: явных не найдено, проверки идут по поведению (русские описания сценариев). Строка `tests/backup.test.ts` на 590 строк содержит самодельный фейк БД, который стоит вынести в общий помощник, если появятся новые интеграционные тесты. Не проверено построчно.
- `package.json`: `--test-isolation=none` ускоряет запуск, но общее состояние между файлами возможно; сейчас проблем не видно.

## Что сделано хорошо

- Строгая типизация: `tsc` и ESLint чистые, нет `any` и подавлений правил, небольшое число `as`-приведений в основном в тестах.
- Чёткое разделение слоёв: `domain/` (чистая логика), `server/` (БД, ИИ, Telegram), `components/` (UI). Доменные функции легко тестируются.
- Денежная арифметика в целых минорных единицах и `BigInt` (`clarification.ts`), согласованно с требованиями продукта.
- Единая обработка ошибок на HTTP-границе (`AppError`, `errorResponse`), логирование без утечки сообщения ошибки.
- Доступность: `role="dialog"`, `aria-modal`, возврат фокуса в листе (`lifeos-app.tsx:408-429`), `aria-label` у иконок, 12 правил `prefers-reduced-motion`, тест на safe-area.
- Кэш `Intl` в `domain/math.ts`, Zod-проверка команд и ИИ-ответов, идемпотентная обработка Telegram-update через статус и `WeakMap`.
- Сообщения пользователю, нейминг и тесты на русском предметном языке, единый стиль.

## Топ-10 первоочередных исправлений

1. Q6: подключить Prettier и отформатировать код (S, большой выигрыш читаемости, снимает 1500-символьные строки).
2. Q10: логировать причину сбоя в `processStoredTelegramUpdate` (S, прямая польза для отладки продакшена).
3. Q7 и Q8: один `plural` и один `formatMoney` вместо 4 и 5 копий (S/M, риск расхождения сумм бота и Mini App).
4. Q9: общий `format.ts` с кэшированными `Intl` (S).
5. Q12: заменить `!` на явные проверки в `lifeos.ts` (S).
6. Q17: токены цветов и стекла в `globals.css` (M).
7. Q1: разбить `EditorDialog` на формы (L, самый крупный долг читаемости).
8. Q3: таблица обработчиков вместо `switch` в `executeCommand` (L).
9. Q2 и Q5: разбить `getBot` и `LifeOSRoot` на регистраторы и хуки (M).
10. Q26 и Q25: интеграционные тесты `executeCommand` и `provider-accounts` (L/M).

## Ограничения аудита

Проверялось статическим чтением, `grep` и запуском `tsc`, ESLint и тестов. Рендеринг, реальная производительность React, видимость фокуса (Q23), необходимость `div role="button"` (Q15) и нагрузка `loadSnapshot` (Q13) на живых данных не измерялись. Список неиспользуемых экспортов получен эвристикой по `grep` и может содержать ложные срабатывания.
