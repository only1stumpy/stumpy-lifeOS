# Конфигурация

Все переменные окружения, которые читает код (`src/`, `scripts/`, `drizzle.config.ts`, `next.config.ts`). Таблица составлена по `process.env` в этих файлах; значения секретов в документации не приводятся. Шаблон для копирования — [`.env.example`](../.env.example).

## Где задаются переменные

- Локально: файл `.env` или `.env.local` в корне. `.env.local` приоритетнее (`scripts/load-env.ts`, тот же порядок использует Next.js). Эти файлы в `.gitignore`.
- Vercel: Project Settings, Environment Variables. Для Production задайте все обязательные переменные; для Preview — по необходимости (отдельная БД и бот предпочтительнее общих с Production; подтверждённого описания Preview в репозитории нет).
- Скрипты `npm run db:migrate`, `telegram:register`, `backup:*` читают тот же `.env`/`.env.local`.

## Переменные

| Переменная | Обязательна | По умолчанию | Где используется | Назначение |
|---|---|---|---|---|
| `DATABASE_URL` | да | нет | `src/db/client.ts`, `drizzle.config.ts`, `scripts/backup.ts`, `src/app/page.tsx` | Строка подключения Neon PostgreSQL. Без неё API отвечают 503, а главная страница показывает заглушку «не настроено». |
| `TELEGRAM_BOT_TOKEN` | да | нет | `src/server/http.ts` (проверка подписи `initData`), `src/server/telegram/bot.ts`, `src/app/page.tsx`, `scripts/register-webhook.ts` | Токен бота от BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | да | нет | `src/app/api/telegram/route.ts`, `scripts/register-webhook.ts` | Секрет заголовка `X-Telegram-Bot-Api-Secret-Token`. Скрипт регистрации принимает только символы `A-Za-z0-9_-` длиной до 256. Короче 32 символов — предупреждение в логе. |
| `CRON_SECRET` | да для плановых задач | нет | `src/app/api/cron/route.ts` | Секрет вызова `/api/cron` (`Authorization: Bearer ...`). Без него маршрут отвечает 503. Короче 32 символов — предупреждение в логе. |
| `ADMIN_BOT_TOKEN` | нет (для алертов и админ-панели) | нет | `src/server/admin/config.ts`, `src/server/admin/telegram.ts` | Токен отдельного админ-бота: им подписывается `initData` админ-панели и отправляются алерты. Токен основного бота не подходит. |
| `ADMIN_TELEGRAM_IDS` | нет | нет | `src/server/admin/config.ts` | Telegram ID администраторов через запятую: доступ к `/admin` и получатели алертов. |
| `ADMIN_WEBHOOK_SECRET` | нет (для webhook админ-бота) | нет | `src/app/api/admin-bot/route.ts` | Секрет заголовка webhook админ-бота, отдельный от `TELEGRAM_WEBHOOK_SECRET`. |
| `GITHUB_REPOSITORY` | нет | `only1stumpy/stumpy-lifeOS` | `src/server/admin/overview.ts` | Репозиторий, у которого админ-панель смотрит статус workflow бэкапа (публичный API без токена). |
| `AI_PROVIDER_ENCRYPTION_KEY` | да для сохранения ключей ИИ | нет | `src/server/ai/provider-profiles.ts` | Ключ AES-256-GCM: ровно 32 байта в base64 (`openssl rand -base64 32`). Без него сохранить ключ ИИ нельзя (503). Ротации в коде нет, см. [эксплуатацию](operations.md). |
| `APP_URL` | нет (нужна для регистрации webhook) | нет | `scripts/register-webhook.ts`, `src/server/telegram/bot.ts` | Публичный HTTPS-адрес развёртывания. Скрипт строит из него адрес `<APP_URL>/api/telegram`; бот — ссылку кнопки «Открыть LifeOS». Не HTTPS-значение игнорируется ботом. |
| `TELEGRAM_OWNER_ID` | нет | нет | `scripts/backup.ts`, `src/server/http.ts` (`requireConfiguredOwner`), `src/app/api/ai-quotas/route.ts` | Telegram ID владельца развёртывания. Для `backup:export`/`backup:restore` может заменяться флагом `--owner`; открывает метрики квот Gemini. Запасным владельцем при отсутствии профиля больше не служит. |
| `DAILY_SUMMARY_TIME` | нет | `19:30` | `src/server/cron.ts` | Время ежедневной сводки `HH:MM` по часовому поясу пользователя, если пользователь не задал своё. Неверный формат даёт ошибку 500 в cron. |
| `WEEKLY_SUMMARY_TIME` | нет | `19:30` | `src/server/cron.ts` | То же для недельной сводки (воскресенье) и напоминания взвеситься (четверг). |
| `SUMMARY_WINDOW_MINUTES` | нет | `30` | `src/server/cron.ts` | Длина окна после времени сводки, в котором cron её отправляет. 30 — под вызов каждые 30 минут; 1440 — под суточный вызов. Вне диапазона 1–1440 даёт ошибку 500 в cron. |
| `GEMINI_MODEL` | нет | `gemini-3.5-flash-lite` | `src/server/ai/quotas.ts` (и тестовый путь `analyze.ts`) | Модель, для которой панель квот владельца запрашивает метрики Google Cloud Monitoring. |
| `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` | нет | нет | `src/server/ai/quotas.ts` | JSON сервисного аккаунта (`roles/monitoring.viewer`) для метрик квот Gemini владельца. Только Production; без него панель показывает «не настроено». |
| `GOOGLE_CLOUD_PROJECT_ID` | нет | `project_id` из JSON | `src/server/ai/quotas.ts` | Идентификатор проекта Google Cloud для метрик. |
| `NEXT_PUBLIC_APP_VERSION` | выставляется автоматически | `version` из `package.json` | `next.config.ts`, `src/app/api/health/route.ts`, `src/domain/release.ts`, `src/components/lifeos/lifeos-app.tsx` | Версия приложения; вручную не задавать. |
| `NEXT_PUBLIC_RELEASE_HISTORY` | выставляется автоматически | разбор `CHANGELOG.md` | `next.config.ts`, `src/domain/release.ts` | История релизов для экрана «Что нового». Формат заголовков `CHANGELOG.md` (`## X.Y.Z`, пункты с `- `) читается при сборке, его нельзя менять произвольно. |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `LIFEOS_ALLOW_ENV_AI_KEYS` | нет, не задавать | нет | `src/server/ai/analyze.ts`, `tests/setup.ts` | Тестовый путь: ключи окружения применяются, только если `LIFEOS_ALLOW_ENV_AI_KEYS=1` (его выставляет `tests/setup.ts`). В работающем приложении ИИ использует только ключи пользователей из базы. |

## Значения в коде, не вынесенные в переменные

- Часовой пояс (`owner_settings.timezone`) определяется на знакомстве по `Intl.DateTimeFormat().resolvedOptions().timeZone` (`onboarding.complete`) и меняется в «Персонализации» (`settings.save`). Значение `Europe/Chisinau` в схеме осталось только как значение по умолчанию для уже существующих профилей: их пояс молча не меняется. Формы Mini App считают время в поясе владельца, а не устройства.
- Срок действия подписи `initData` — 24 часа (`src/server/telegram/auth.ts`).
- Лимиты запросов — в `src/server/rate-limit.ts` (см. [эксплуатацию](operations.md)).
- Предел попыток обработки Telegram update — 3 (`MAX_UPDATE_ATTEMPTS` в `src/server/telegram/bot.ts`).
- Размер тела webhook — не более 256 000 символов; резервная копия — не более 25 МБ и 100 000 строк.

## Проверка конфигурации

Валидации всех переменных при старте нет: пропущенная переменная проявляется ошибкой 503 при первом обращении. Исключение — предупреждение в логе при слабых `CRON_SECRET` и `TELEGRAM_WEBHOOK_SECRET` (`src/server/security-config.ts`). Быстрая проверка: `GET /api/health` отвечает `{"status":"ok","version":"..."}` без обращения к базе, то есть подтверждает только, что приложение запущено.
