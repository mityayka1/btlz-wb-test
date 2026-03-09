# WB Tariffs Service

Сервис для автоматического сбора тарифов коробов Wildberries, хранения в PostgreSQL и синхронизации с Google Sheets.

## Возможности

- Автоматический сбор тарифов через WB API (`/api/v1/tariffs/box`) по cron-расписанию
- Хранение в PostgreSQL с upsert-логикой (без дубликатов по дате + складу)
- Параллельная синхронизация с Google-таблицами (sliding window, 5 concurrent)
- REST API для управления таблицами и ручного экспорта
- Кнопка обновления прямо из Google Sheets (Google Apps Script)
- Retry с exponential backoff + jitter для внешних вызовов
- Безопасность: helmet, rate-limit, timing-safe сравнение API-ключей
- Доменные ошибки (AccessDeniedError, DuplicateError, NotFoundError и др.)
- Валидация всех входных данных (Zod, regex для spreadsheetId)
- Health endpoint с отслеживанием сбоев (consecutiveFailures, lastError)
- Graceful shutdown с таймаутом
- Полностью контейнеризовано (Docker Compose, memory limit 512M)

## Быстрый старт

### 1. Переменные окружения

```bash
cp example.env .env
```

Заполните `.env`:

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `WB_API_KEY` | API-ключ Wildberries | `eyJhbG...` |
| `API_KEY` | Ключ защиты REST API (любая строка) | `my_secret_key` |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Путь к JSON-ключу сервисного аккаунта | `./credentials/sa_credentials.json` |
| `POSTGRES_DB` | Имя базы данных | `postgres` |
| `POSTGRES_USER` | Пользователь БД | `postgres` |
| `POSTGRES_PASSWORD` | Пароль БД | `postgres` |
| `POSTGRES_PORT` | Порт PostgreSQL | `5432` |
| `APP_PORT` | Порт HTTP-сервера | `5000` |
| `CRON_SCHEDULE` | Расписание обновления (cron) | `0 * * * *` |

### 2. Google Service Account

1. Создайте сервисный аккаунт в [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Включите **Google Sheets API** в проекте
3. Скачайте JSON-ключ → `credentials/sa_credentials.json`
4. Предоставьте сервисному аккаунту доступ к Google-таблицам (по email аккаунта, роль "Редактор")

### 3. Запуск

```bash
docker compose up --build
```

При старте сервис автоматически:
1. Выполнит миграции БД
2. Запустит HTTP-сервер
3. Получит текущие тарифы из WB API
4. Обновит все подключённые Google-таблицы
5. Запустит cron по расписанию

### Чистый запуск (сброс данных)

```bash
docker compose down --rmi local --volumes
docker compose up --build
```

## REST API

Все эндпоинты (кроме `/health`) требуют заголовок `x-api-key`.

| Метод | URL | Описание | Коды ответа |
|-------|-----|----------|-------------|
| `GET` | `/health` | Статус сервиса | 200, 503 |
| `GET` | `/spreadsheets` | Список таблиц | 200, 500 |
| `POST` | `/spreadsheets` | Добавить таблицу | 201, 400, 403, 409, 500 |
| `DELETE` | `/spreadsheets/:id` | Удалить таблицу | 204, 404, 500 |
| `POST` | `/spreadsheets/:id/export` | Экспорт тарифов | 200, 403, 404, 500 |

### Примеры

```bash
# Health check
curl http://localhost:5000/health

# Список таблиц
curl -H 'x-api-key: YOUR_KEY' http://localhost:5000/spreadsheets

# Добавить таблицу (проверяет доступ сервисного аккаунта)
curl -X POST \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "1xmaG0vEVHdjTWE_7zcyLvyELdHqIZZMLD9yk6BZpiWw"}' \
  http://localhost:5000/spreadsheets

# Удалить таблицу
curl -X DELETE \
  -H 'x-api-key: YOUR_KEY' \
  http://localhost:5000/spreadsheets/1xmaG0vEVHdjTWE_7zcyLvyELdHqIZZMLD9yk6BZpiWw

# Ручной экспорт тарифов в таблицу
curl -X POST \
  -H 'x-api-key: YOUR_KEY' \
  http://localhost:5000/spreadsheets/1xmaG0vEVHdjTWE_7zcyLvyELdHqIZZMLD9yk6BZpiWw/export
```

### Health endpoint

```json
{
  "status": "ok",
  "db": "connected",
  "lastUpdateAt": "2026-03-09",
  "consecutiveFailures": 0,
  "uptime": 3600
}
```

При недоступности БД или сбоях обновления возвращает `503` и `"status": "degraded"` с полями `dbError`, `lastError`, `consecutiveFailures`.

## Проверка функционирования

После запуска (`docker compose up --build`) можно проверить работу сервиса:

```bash
# 1. Health check — сервис запущен, БД доступна
curl http://localhost:5000/health
# Ожидается: {"status":"ok","db":"connected","lastUpdateAt":"2026-03-09",...}

# 2. Список таблиц (пока пуст)
curl -H 'x-api-key: YOUR_KEY' http://localhost:5000/spreadsheets
# Ожидается: []

# 3. Добавить Google-таблицу (SA должен иметь доступ)
curl -X POST \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "YOUR_SPREADSHEET_ID"}' \
  http://localhost:5000/spreadsheets
# Ожидается: 201 {"spreadsheet_id":"..."}

# 4. Экспортировать тарифы в таблицу
curl -X POST \
  -H 'x-api-key: YOUR_KEY' \
  http://localhost:5000/spreadsheets/YOUR_SPREADSHEET_ID/export
# Ожидается: 200 {"message":"Экспорт выполнен","count":N}

# 5. Открыть Google-таблицу — лист "stocks_coefs" заполнен тарифами
```

Тарифы автоматически обновляются по cron-расписанию (по умолчанию каждый час).

## Google Apps Script

Для обновления тарифов кнопкой прямо из Google Sheets:

### Вариант 1: через clasp (рекомендуется)

```bash
cd gas
npm install -g @google/clasp
clasp login
# Отредактируйте .clasp.json — укажите scriptId вашего скрипта
# Отредактируйте refresh-tariffs.js — укажите SERVER_URL и API_KEY
clasp push
```

### Вариант 2: вручную

1. Откройте таблицу → **Расширения** → **Apps Script**
2. Вставьте содержимое `gas/refresh-tariffs.js`
3. Замените `SERVER_URL` и `API_KEY` на реальные значения
4. Сохраните и обновите страницу

В меню таблицы появится **Тарифы WB** → **Обновить тарифы**.

> При первом нажатии потребуется авторизация (доступ к внешним сервисам).

## Разработка

### Локальный запуск

```bash
# Только PostgreSQL
docker compose up -d postgres

# Миграции
npm run knex:dev migrate latest

# Seeds
npm run knex:dev seed run

# Dev-режим с hot-reload
npm run dev
```

### Тестирование

```bash
# Unit + integration тесты (90 тестов, без БД)
npm test

# E2E тесты (требуют запущенный PostgreSQL)
docker compose up -d postgres
npm run test:e2e

# Watch-режим
npm run test:watch
```

### Проверка типов

```bash
npx tsc --noEmit
```

## Структура проекта

```
src/
├── app.ts                          # Точка входа: миграции → сервер → cron
├── app-factory.ts                  # Фабрика Express (для тестов через supertest)
├── config/
│   ├── env/env.ts                  # Zod-валидация переменных окружения
│   ├── logger.ts                   # Логирование (log4js)
│   └── knex/knexfile.ts            # Конфигурация Knex
├── postgres/
│   ├── knex.ts                     # Инстанс Knex + утилиты миграций/seeds
│   ├── migrations/                 # SQL-миграции (spreadsheets, tariffs)
│   └── seeds/                      # Начальные данные
├── routes/
│   ├── health.ts                   # GET /health — проверка БД, uptime
│   └── spreadsheets.ts             # CRUD таблиц + экспорт тарифов
├── middleware/
│   └── api-key.ts                  # Проверка x-api-key
├── services/
│   ├── wb-api.ts                   # Клиент WB API (Zod-валидация ответа)
│   ├── tariff-storage.ts           # CRUD тарифов в PostgreSQL (upsert)
│   ├── google-sheets.ts            # Обновление Google Sheets (batchUpdate)
│   ├── spreadsheet-repository.ts   # CRUD реестра Google-таблиц
│   └── scheduler.ts                # Cron: WB API → PostgreSQL → Google Sheets
├── types/
│   ├── tariff.ts                   # TypeScript-типы (WbWarehouseTariff, TariffRow)
│   └── errors.ts                   # Доменные ошибки (AppError → NotFound, Duplicate, ...)
├── utils/
│   ├── with-retry.ts               # Retry с exponential backoff + jitter + isRetryable
│   ├── app-state.ts                # In-memory состояние (lastUpdateAt, failures)
│   ├── date.ts                     # Утилита getTodayDateUTC()
│   └── knex.ts                     # CLI для миграций (commander)
└── e2e/
    └── api.e2e.test.ts             # E2E тесты с реальной PostgreSQL
gas/
├── .clasp.json                     # Привязка к Google Apps Script проекту
├── appsscript.json                 # Манифест (V8, Moscow timezone)
└── refresh-tariffs.js              # Скрипт кнопки обновления
```

## Стек

| Категория | Технология |
|-----------|-----------|
| Runtime | Node.js 20 (Alpine) |
| Язык | TypeScript (ESM) |
| HTTP | Express 5 |
| БД | PostgreSQL 16 |
| Query builder | Knex.js |
| Google Sheets | googleapis |
| Валидация | Zod |
| Cron | node-cron |
| Безопасность | helmet, express-rate-limit |
| Тесты | Vitest, supertest |
| Деплой | Docker, Docker Compose |

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  WB API     │────→│  Сервис      │────→│ PostgreSQL │
│  (тарифы)   │     │  (Node.js)   │     │ (tariffs)  │
└─────────────┘     └──────┬───────┘     └────────────┘
                           │
                    ┌──────┴───────┐
                    │ Google Sheets│
                    │ (N таблиц)   │
                    └──────────────┘
                           ▲
                    ┌──────┴───────┐
                    │  GAS-кнопка  │
                    │ (в таблице)  │
                    └──────────────┘
```

**Поток данных:**
1. Cron (или GAS-кнопка) инициирует обновление
2. Сервис получает тарифы из WB API
3. Данные сохраняются в PostgreSQL (upsert)
4. Из PostgreSQL данные экспортируются во все подключённые Google Sheets
