# Развёртывание с нуля

Целевая схема: Telegram Bot + Vercel (Next.js) + Neon PostgreSQL + cron-job.org. Бесплатный запуск в пределах квот; автоматические платные расходы не допускаются. Переменные описаны в [конфигурации](configuration.md), эксплуатация — в [runbook](operations.md), структура БД — в [database.md](database.md).

Пометки в тексте: шаг со словами «не проверено» не подтверждён кодом или фактическим запуском в этом репозитории; проверьте его по актуальной документации сервиса.

## Что нужно заранее

- Аккаунты Telegram (BotFather), GitHub, Vercel, Neon и cron-job.org.
- Node.js 24 или новее и npm (`engines.node >=24` в `package.json`) для локальных команд.
- Клон репозитория и `npm ci`.
- Для применения миграций вручную — клиент `psql` (или SQL-консоль Neon).

## 1. Бот в Telegram

1. В BotFather создайте бота командой `/newbot`; сохраните токен как `TELEGRAM_BOT_TOKEN`.
2. Укажите адрес Mini App в настройках бота у BotFather (Mini App/меню бота). Точные шаги интерфейса BotFather не проверялись; кнопка «Открыть LifeOS» в ответах бота строится из переменной `APP_URL` (только HTTPS).

## 2. База Neon

1. Создайте проект Neon и скопируйте строку подключения в `DATABASE_URL`.
2. Клиент использует `@neondatabase/serverless` (WebSocket-пул). Какой вариант строки Neon (pooled или direct) предпочтительнее, не проверялось.
3. Рекомендуется заранее проверить возможности восстановления в вашем тарифе Neon (ветки, point-in-time restore): они нужны для отката миграций, см. [runbook](operations.md).

## 3. Секреты

Сгенерируйте и сохраните в менеджере секретов (в репозиторий и чаты не передавать):

```bash
openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32      # CRON_SECRET
openssl rand -base64 32   # AI_PROVIDER_ENCRYPTION_KEY (32 байта в base64)
```

`AI_PROVIDER_ENCRYPTION_KEY` нельзя потерять и нельзя менять после того, как пользователи сохранили ключи ИИ: ротации в коде нет (см. [runbook](operations.md)). Сервер пишет предупреждение в лог, если `CRON_SECRET` или `TELEGRAM_WEBHOOK_SECRET` короче 32 символов.

## 4. Миграции

**Правило: сначала SQL миграции в production, потом merge PR.** Код, который читает колонку раньше, чем она появилась, роняет маршруты до применения миграции. Новую миграцию применяют к production, проверяют `/api/ready` (ниже) и только затем сливают PR; вместе с кодом миграция в Vercel не выкатывается.

Один рабочий путь — `npm run db:migrate` (drizzle-kit) с production-переменными и системным прокси:

```bash
vercel env pull .env.vercel.local --environment=production   # файл в .gitignore, не коммитить
NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--env-file=.env.vercel.local npm run db:migrate
```

- `NODE_USE_ENV_PROXY=1` нужен за корпоративным HTTPS-прокси: без него Node не доходит до Neon (`ETIMEDOUT`), вероятная причина прежнего «молчания» `db:migrate` (на машине владельца причина не воспроизводилась, к production не подключались).
- `.env.local` обычно без `DATABASE_URL`; `--env-file` подставляет production-значение, не перезаписывая то, что уже есть в окружении.
- Перед миграцией production сделайте точку восстановления (ветка Neon или резервная копия, см. [runbook](operations.md)). Откатов drizzle-kit не делает.

Если `db:migrate` всё равно завершился без вывода, не считайте миграцию применённой: проверьте журнал запросом ниже. Резервный способ — выполнить SQL файла и запись в журнал одной транзакцией:

```bash
f=drizzle/0017_command_requests.sql
hash=$(sha256sum "$f" | cut -d' ' -f1)
when=$(node -e 'const t=process.argv[1];console.log(require("./drizzle/meta/_journal.json").entries.find(e=>e.tag===t).when)' 0017_command_requests)
{ echo "BEGIN;"; cat "$f"; echo; echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', $when);"; echo "COMMIT;"; } \
  | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

Журнал drizzle: `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)`; `hash` — SHA-256 SQL-файла, `created_at` — поле `when` записи в `drizzle/meta/_journal.json`. Мигратор применяет только миграции с `when` больше `created_at` последней записи, поэтому применять нужно строго по порядку номеров. Метка `--> statement-breakpoint` внутри файлов — обычный SQL-комментарий. Для пустой базы перед первой миграцией нужны `CREATE SCHEMA IF NOT EXISTS drizzle` и таблица журнала с колонками выше.

Проверка после применения:

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
```

и `GET /api/ready` с `Authorization: Bearer $CRON_SECRET`: `200 {"status":"ready"}` значит, что база отвечает, а последняя запись журнала совпадает с последней миграцией в `drizzle/meta/_journal.json`; `503` с `migrations_pending` — миграция не применена, `database_unavailable` — база недоступна или журнала нет. Тело ответа не содержит секретов.

CI проверяет, что `src/db/schema.ts` и `drizzle/` согласованы (`drizzle-kit check` и `generate` без изменений); если схему меняли, выполните `npm run db:generate` и закоммитьте результат.

## 5. Vercel

1. Импортируйте репозиторий GitHub в Vercel. Сборка — `next build`; файла `vercel.json` в репозитории нет (настройки по умолчанию для Next.js).
2. В Settings, Environment Variables задайте для Production обязательные переменные из [конфигурации](configuration.md): `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `AI_PROVIDER_ENCRYPTION_KEY`, а также `APP_URL` (публичный HTTPS-адрес развёртывания).
3. Preview-деплои по умолчанию не получают Telegram- и Neon-переменных, поэтому Mini App API там без них не проверить; использовать для Preview отдельные базу и бота предпочтительнее, чем общие с Production (подтверждённого описания Preview в репозитории нет).
4. Выпускайте изменения через ветку, PR, проверки CI (`.github/workflows/ci.yml`: `lint`, `typecheck`, `test`, `build`) и Vercel Preview, затем слияние в `main`. Production должен развернуть именно merge commit.
5. Проверка: `GET <APP_URL>/api/health` отвечает `200` и `{"status":"ok","version":"..."}`. Это проверка запуска без обращения к базе.

## 6. Webhook Telegram

С заполненными `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` и `APP_URL` выполните:

```bash
npm run telegram:register
```

Скрипт вызывает Telegram `setWebhook` с адресом `<APP_URL>/api/telegram`, секретом и `allowed_updates: ["message", "callback_query"]`. Если команда не достигает Telegram API (например, из-за сети рабочей станции), webhook можно зарегистрировать тем же запросом `setWebhook` с другого хоста; ранее для production это было сделано вызовом из Vercel. Состояние webhook проверяется методом Bot API `getWebhookInfo` (поля `url`, `pending_update_count`, `last_error_message`).

## 7. Планировщик cron-job.org

Создайте задание на `GET` или `POST` `<APP_URL>/api/cron` с заголовком `Authorization: Bearer <CRON_SECRET>`. Маршрут повторяет зависшие и неудачные Telegram updates, отправляет сводки и напоминания и очищает старые счётчики rate limit. **Интервал — каждые 30 минут** (`*/30 * * * *`). Сводка отправляется в окне `[время пользователя, +30 минут)`, повторы зависших updates идут при каждом вызове. Чаще не ставьте: Neon Free засыпает после 5 минут простоя, вызов чаще 5–15 минут держит базу активной постоянно и выжигает лимит около 100 CU-часов в месяц, после чего база останавливается до конца месяца (при вызове раз в 30 минут оценка около 30 CU-часов). Если оставить суточный вызов, задайте `SUMMARY_WINDOW_MINUTES=1440`, иначе сводки вне получасового окна вызова не придут. Расход Neon проверьте через неделю после смены расписания; фактическая доставка не проверена. Ответ `200` с `{"ok":true,...}` означает успех; `401` — неверный секрет; `503` — не настроен `CRON_SECRET` или ошибка выполнения; `"ok":false` с `failed > 0` — у части пользователей отправка не удалась (подробности в логах Vercel).

## 8. Проверка после развёртывания

1. `GET /api/health` отвечает `200`.
2. Откройте бота, отправьте `/start`: приходит приветствие с кнопкой «Открыть LifeOS».
3. Откройте Mini App из бота: проходит знакомство, профиль создаётся в `owner_settings`.
4. Отправьте боту `/help` и `/today`.
5. Вызовите `/api/cron` с секретом (например, `curl -H "Authorization: Bearer $CRON_SECRET" <APP_URL>/api/cron`): ответ `{"ok":true,...}`.
6. Подключите ключ ИИ в настройках и отправьте боту описание еды: приходит черновик с кнопкой «Записать». Без ИИ тот же ввод выполняется вручную в Mini App.

Эти шаги составлены по коду; полный прогон на реальных аккаунтах отмечен в [статусе](status.md) как не завершённый.

## Откат

- Код: откат merge commit в `main` через GitHub и повторный деплой Vercel (или Promote предыдущего деплоя в Vercel; не проверялось).
- База: Neon point-in-time restore или ветка, созданная перед миграцией; журнал `drizzle.__drizzle_migrations` откатывается вместе с базой.
- Секреты: смена `TELEGRAM_WEBHOOK_SECRET` требует повторного `npm run telegram:register`; смена `AI_PROVIDER_ENCRYPTION_KEY` делает сохранённые ключи ИИ нечитаемыми.

## Регион функций Vercel

`vercel.json` задаёт регион серверных функций `fra1` (Франкфурт), чтобы они работали рядом с базой Neon (`eu-central-1`, Франкфурт). Без этого Vercel использует `iad1` (Вашингтон), и каждый запрос к базе пересекает Атлантику. При создании нового развёртывания выбирайте для базы и для функций один регион или соседние.
