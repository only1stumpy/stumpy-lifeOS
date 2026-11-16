# Документация Stumpy LifeOS

Принцип: факты «проверено / не проверено» живут только в [status.md](status.md); остальные документы описывают требования, устройство и процедуры. Если документ расходится с кодом, верить нужно коду и сообщить о расхождении.

## Пользователь и продукт

| Документ | Что внутри |
|---|---|
| [../README.md](../README.md) | Что это, быстрый старт, навигация |
| [product.md](product.md) | Бизнес-сценарии, границы продукта, поведение бота |
| [privacy-policy.md](privacy-policy.md) | Проект политики конфиденциальности |
| [../CHANGELOG.md](../CHANGELOG.md) | Изменения по выпускам |

## Разработчик

| Документ | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Стек, компоненты, маршруты API, ограничения |
| [database.md](database.md) | Таблицы по модулям, ограничения, составные ключи |
| [configuration.md](configuration.md) | Все переменные окружения |
| [../DESIGN.md](../DESIGN.md) | Визуальная спецификация Liquid Glass |
| [reference/README.md](reference/README.md) | Исторический визуальный эталон |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Правила вклада |
| [../AGENTS.md](../AGENTS.md) | Правила работы для ИИ-агентов и контрибьюторов |
| [../SECURITY.md](../SECURITY.md) | Как сообщить об уязвимости |

## Оператор развёртывания

| Документ | Что внутри |
|---|---|
| [deployment.md](deployment.md) | Развёртывание с нуля: бот, Neon, Vercel, миграции, webhook, cron |
| [operations.md](operations.md) | Runbook: бэкап, ключ шифрования, зависшие updates, rate limit, логи |
| [status.md](status.md) | Что проверено на реальных сервисах и что нет |

## Выпуск

| Документ | Что внутри |
|---|---|
| [release-plan.md](release-plan.md) | План до `1.0.0`: что осталось после `rc.2`, пост-релизный техдолг |
| [release-checklist.md](release-checklist.md) | Ручной чек-лист перед выпуском |
