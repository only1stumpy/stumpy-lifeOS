# Развёртывание с нуля

Целевая схема: Telegram Bot + Vercel (Next.js) + Neon PostgreSQL + cron-job.org. Бесплатный запуск в пределах квот; автоматические платные расходы не допускаются. Переменные описаны в [конфигурации](configuration.md), эксплуатация — в [runbook](operations.md), структура БД — в [database.md](database.md).

Пометки в тексте: шаг со словами «не проверено» не подтверждён кодом или фактическим запуском в этом репозитории; проверьте его по актуальной документации сервиса.

## Что нужно заранее

- Аккаунты Telegram (BotFather), GitHub, Vercel, Neon и cron-job.org.
- Node.js 22 или новее и npm (`engines.node >=22` в `package.json`) для локальных команд.
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

Миграции применяются к базе до первого запуска приложения. Для этого проекта на практике применяется ручная процедура: `npm run db:migrate` (drizzle-kit) в этом проекте завершался без сообщения, поэтому SQL из `drizzle/` выполняют сами, транзакцией, и записывают применение в журнал `drizzle.__drizzle_migrations`. Это практика владельца проекта (см. [CHANGELOG](../CHANGELOG.md) и [database.md](database.md)); формат записи журнала сверен по исходному коду `drizzle-orm/migrator`.

Журнал, который ведёт drizzle: таблица `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)`; `hash` — SHA-256 SQL-файла, `created_at` — поле `when` соответствующей записи в `drizzle/meta/_journal.json`. Штатный мигратор применяет только те миграции, у которых `when` больше `created_at` последней записи журнала, поэтому применять и записывать нужно строго по порядку номеров.

Новая пустая база:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS drizzle' \
  -c 'CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)'
```

Затем для каждого файла по порядку (`0000` ... последний). Метка `--> statement-breakpoint` внутри файлов — обычный SQL-комментарий, поэтому файл можно подавать в `psql` целиком:

```bash
f=drizzle/0014_rate_limit_counters.sql
hash=$(sha256sum "$f" | cut -d' ' -f1)
when=$(node -e 'const t=process.argv[1];console.log(require("./drizzle/meta/_journal.json").entries.find(e=>e.tag===t).when)' 0014_rate_limit_counters)
{ echo "BEGIN;"; cat "$f"; echo; echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', $when);"; echo "COMMIT;"; } \
  | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

Существующая база: сначала посмотрите, что уже записано, и применяйте только недостающие миграции:

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
```

Перед миграцией production сделайте точку восстановления (ветка Neon или резервная копия, см. [runbook](operations.md)). Откатов drizzle-kit не делает. Проверка после применения: записи в журнале по числу миграций и ответ `/api/health`; запрос к таблицам новой миграции.

Вариант `npm run db:migrate` остаётся штатным в `package.json`; если он работает в вашем окружении, пользуйтесь им и убедитесь, что журнал содержит запись на каждую миграцию.

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

Создайте задание на `GET` или `POST` `<APP_URL>/api/cron` с заголовком `Authorization: Bearer <CRON_SECRET>`. Маршрут повторяет зависшие и неудачные Telegram updates, отправляет сводки и напоминания и очищает старые счётчики rate limit. Частота в коде не задана: зависшие updates повторяются только при вызове cron, а сводки отправляются при первом вызове после наступления времени пользователя (по минутам суток его часового пояса), поэтому интервал в несколько минут точнее суточного. Оптимальный интервал и фактическая доставка не проверены. Ответ `200` с `{"ok":true,...}` означает успех; `401` — неверный секрет; `503` — не настроен `CRON_SECRET` или ошибка выполнения; `"ok":false` с `failed > 0` — у части пользователей отправка не удалась (подробности в логах Vercel).

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
