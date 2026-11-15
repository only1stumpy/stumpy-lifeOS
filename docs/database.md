# База данных

Neon Serverless PostgreSQL, доступ через Drizzle ORM (`@neondatabase/serverless`, пул из 2 соединений). Схема — `src/db/schema.ts`, SQL-миграции — `drizzle/`. На момент написания (версия 0.24.0): 30 таблиц и 15 миграций (`0000`–`0014`).

## Принцип изоляции

`owner_settings` — профиль пользователя; `owner_settings.telegram_user_id` уникален и берётся только из проверенной подписи Telegram (`initData`) или из Telegram update. Все остальные таблицы содержат `owner_id` с внешним ключом на `owner_settings.id` и `ON DELETE CASCADE`, поэтому удаление строки профиля каскадно удаляет данные пользователя (проверка каскада конкретной функцией удаления — на стороне тестов этой ветки, см. [CHANGELOG](../CHANGELOG.md)).

### Составные внешние ключи `(id, owner_id)`

Чтобы строка одного пользователя не могла сослаться на строку другого, у родительских таблиц есть уникальное ограничение `(id, owner_id)` (имена вида `<таблица>_id_owner_unique`), а дочерние таблицы ссылаются на пару, а не на один `id`. Примеры (имена ограничений из схемы):

- `nutrition_drafts`, `nutrition_entries`, `money_drafts`, `finance_entries`, `finance_debt_drafts` → `capture_drafts (id, owner_id)` (`*_capture_owner_fk`).
- `finance_entries`, `money_drafts`, `recurring_payments` → `finance_accounts (id, owner_id, currency)`: валюта операции обязана совпадать с валютой счёта (`*_account_owner_currency_fk`).
- `finance_entries`, `money_drafts` → `finance_categories (id, owner_id, entry_type)`: тип категории совпадает с типом операции; `recurring_payments` → `finance_categories (id, owner_id)`.
- `finance_entries` → `recurring_payments (id, owner_id)`.
- Зал: `workout_day_exercises` → `workout_days` и `exercises`; `workout_sessions` → `workout_days`; `workout_session_exercises` → `workout_sessions`, `workout_day_exercises`, `exercises`; `workout_sets` → `workout_session_exercises`, всё по `(id, owner_id)`.

Новая таблица, ссылающаяся на данные пользователя, должна повторять этот приём.

### Прочие ключевые ограничения

- Защита от повторной записи черновика: уникальные индексы `*_capture_unique` на `capture_draft_id` в `nutrition_drafts`, `nutrition_entries`, `money_drafts`, `finance_entries`, `finance_debt_drafts`.
- Идемпотентность webhook: уникальный индекс `telegram_updates_update_id_unique` по `telegram_update_id`.
- Дедупликация уведомлений: уникальный `(owner_id, key)` в `notification_deliveries`.
- Один основной счёт на владельца: частичный уникальный индекс `finance_accounts_one_default_per_owner`.
- Одна цель КБЖУ на дату начала действия: уникальный индекс в `nutrition_targets`. Правило «один замер веса в день» в базе не закреплено: его выполняет код команды `weight.save`.
- Допустимые значения статусов и типов закреплены `CHECK`-ограничениями (например, `telegram_updates_status_valid`, `capture_drafts_kind_valid`, `capture_drafts_status_valid`); всего в схеме 64 вызова `check(`.
- Деньги хранятся как `numeric`, арифметика выполняется кодом в минимальных единицах (`src/domain`), не SQL.

## Таблицы по модулям

### Профиль, ИИ, бот и служебные (9)

| Таблица | Назначение |
|---|---|
| `owner_settings` | Профиль: Telegram ID, часовой пояс (по умолчанию `Europe/Chisinau`), параметры профиля и цели, модули и функции, настройки уведомлений, основная валюта, флаги онбординга, версия политики и согласие, короткая история уточнения ИИ (30 минут) |
| `ai_provider_profiles` | Прежняя таблица профилей ИИ-ключей (создана в `0003`, шифрованный ключ) |
| `ai_provider_accounts` | Аккаунты провайдеров ИИ пользователя: endpoint, модель каталога, `encrypted_api_key` (AES-256-GCM) |
| `ai_provider_model_selections` | Выбранные пользователем модели и порядок очереди; уникально `(owner_id, provider_id, model_id)` |
| `ai_provider_usage_events` | События использования (аккаунт, модель, исход) для счётчиков за 24 часа; тексты запросов не хранятся |
| `telegram_updates` | Принятые update: статус `received`/`processing`/`processed`/`failed`, число попыток, `last_error`; payload после обработки очищается |
| `rate_limit_counters` | Счётчики rate limit: ключ `bucket:subject`, начало окна, число; PK `(key, window_start)`; записи старше двух суток удаляет cron |
| `notification_deliveries` | Журнал отправленных уведомлений для дедупликации |
| `capture_drafts` | Общая запись о черновике (тип `nutrition`/`finance`/`combined`/`debt`, статус, исходный текст сообщения, id сообщения бота, срок действия); `combined` остался только для старых записей |

### Питание (5)

`nutrition_targets` (цели КБЖУ с датой начала), `nutrition_drafts` (черновики еды), `food_templates` (обычные блюда и порции), `nutrition_entries` (записи дневника), `weight_entries` (масса тела).

### Финансы (10)

`finance_accounts` (счета, валюта, основной счёт), `finance_categories`, `exchange_rates` (ручные курсы к основной валюте с датой действия), `recurring_payments` (подписки и регулярные платежи), `money_drafts` (черновики расходов и доходов), `finance_entries` (операции; для неосновной валюты хранят курс на момент операции), `finance_plans` (планы покупок), `finance_debts`, `finance_debt_repayments`, `finance_debt_drafts`.

### Зал (6)

`exercises` (встроенные и пользовательские упражнения), `workout_days` (дни программы), `workout_day_exercises` (упражнения дня), `workout_sessions` (тренировки), `workout_session_exercises`, `workout_sets` (подходы и кардио).

Итого: 9 + 5 + 10 + 6 = 30.

## Миграции

| № | Файл | Что делает |
|---|---|---|
| 0000 | `0000_lifeos_initial` | Начальная схема: профиль, черновики, питание, финансы, зал, `telegram_updates`, `notification_deliveries` |
| 0001 | `0001_neat_dormammu` | Изменение `recurring_payments` |
| 0002 | `0002_watery_toad_men` | Изменение `owner_settings` |
| 0003 | `0003_nebulous_omega_red` | `ai_provider_profiles` |
| 0004 | `0004_dazzling_changeling` | `finance_plans` |
| 0005 | `0005_romantic_george_stacy` | `ai_provider_accounts`, `ai_provider_model_selections`, `ai_provider_usage_events` |
| 0006 | `0006_cooing_rawhide_kid` | Долги: `finance_debts`, `finance_debt_repayments`, `finance_debt_drafts`; тип `debt` в `capture_drafts` |
| 0007 | `0007_ai_setup_onboarding` | Флаги первичной настройки ИИ в `owner_settings` |
| 0008 | `0008_profile_onboarding` | Пол, флаг анкеты профиля |
| 0009 | `0009_notification_settings` | Настройки уведомлений, `last_seen_version` |
| 0010 | `0010_life_modules` | Включённые модули, флаг настройки модулей |
| 0011 | `0011_module_features` | `disabled_features` (функции внутри модулей) |
| 0012 | `0012_multi_currency` | Мультивалютность: основная валюта, курс к основной (`rate_to_base`), изменения счетов, операций, черновиков, платежей |
| 0013 | `0013_draft_message_id` | `capture_drafts.telegram_message_id` |
| 0014 | `0014_rate_limit_counters` | `rate_limit_counters` |
| 0015 | `0015_privacy_consent` | `owner_settings.privacy_accepted_at`, `owner_settings.privacy_policy_version` (согласие с политикой) |

Содержимое строк в таблице сверено по `CREATE`/`ALTER TABLE` в файлах `drizzle/`; точное содержимое смотрите в самих SQL-файлах. Миграции этой ветки (`feat/data-rights-0-25`), если они появятся, нумеруются следующими числами и описываются в [CHANGELOG](../CHANGELOG.md).

Журнал применённых миграций — таблица `drizzle.__drizzle_migrations` (`id`, `hash`, `created_at`); `hash` — SHA-256 содержимого SQL-файла, `created_at` — поле `when` из `drizzle/meta/_journal.json` (по исходному коду `drizzle-orm/migrator`).

## Как создать новую миграцию

1. Измените `src/db/schema.ts`. Для новой таблицы с данными пользователя добавьте `owner_id` (FK на `owner_settings.id`, `ON DELETE CASCADE`), индекс по `owner_id` и составные ключи по правилу выше.
2. `npm run db:generate` создаст `drizzle/NNNN_<имя>.sql` и обновит `drizzle/meta/`. Откройте SQL и проверьте его глазами: для существующих данных могут понадобиться значения по умолчанию и бэкфилл.
3. Если новая таблица относится к данным пользователя, добавьте её в экспорт/восстановление (`src/server/backup.ts`) и в тесты миграций.
4. Прогоните `npm run typecheck` и `npm test` (по плану релиза тесты на PGlite прогоняют миграции; точный состав тестов смотрите в `tests/`).
5. Выпускайте через PR: новое поведение поднимает `MINOR`, запись в [CHANGELOG](../CHANGELOG.md) обязательна.
6. Применение к production — по [руководству по развёртыванию](deployment.md): сначала резервная копия или ветка Neon, затем одна транзакция вместе с записью в журнал.

Откатов drizzle-kit не делает: возврат к прежней схеме — восстановлением Neon (ветка или point-in-time restore) либо отдельной обратной миграцией, написанной вручную.
