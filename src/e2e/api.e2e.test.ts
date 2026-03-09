import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import _knex from "knex";
import request from "supertest";
import express from "express";

// Мокаем только googleapis (внешний сервис) и env
vi.mock("googleapis", () => ({
    google: {
        auth: {
            GoogleAuth: vi.fn().mockImplementation(() => ({})),
        },
        sheets: vi.fn().mockReturnValue({
            spreadsheets: {
                get: vi.fn().mockResolvedValue({ data: { spreadsheetId: "test" } }),
                batchUpdate: vi.fn().mockResolvedValue({
                    data: {
                        replies: [{ addSheet: { properties: { sheetId: 1 } } }],
                    },
                }),
            },
        }),
    },
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("#config/env/env.js", () => ({
    default: {
        POSTGRES_HOST: process.env.POSTGRES_HOST ?? "localhost",
        POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT ?? "5434"),
        POSTGRES_DB: process.env.POSTGRES_DB ?? "postgres",
        POSTGRES_USER: process.env.POSTGRES_USER ?? "postgres",
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "postgres",
        API_KEY: "e2e-test-key",
        GOOGLE_SERVICE_ACCOUNT_PATH: "/fake/path.json",
        APP_PORT: 0,
        CRON_SCHEDULE: "0 * * * *",
    },
}));

// Создаём реальный knex для e2e (тот же конфиг что мок env)
const knex = _knex({
    client: "pg",
    connection: {
        host: process.env.POSTGRES_HOST ?? "localhost",
        port: parseInt(process.env.POSTGRES_PORT ?? "5434"),
        database: process.env.POSTGRES_DB ?? "postgres",
        user: process.env.POSTGRES_USER ?? "postgres",
        password: process.env.POSTGRES_PASSWORD ?? "postgres",
    },
});

// Подменяем модуль knex реальным инстансом
vi.mock("#postgres/knex.js", () => ({
    default: knex,
}));

vi.mock("#utils/with-retry.js", () => ({
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { createApp } from "#app-factory.js";
import { saveTariffs, getLatestTariffs } from "#services/tariff-storage.js";

const API_KEY = "e2e-test-key";

function getApp() {
    return createApp();
}

describe("E2E API tests", () => {
    beforeAll(async () => {
        // Убедимся что таблицы существуют
        await knex.migrate.latest({
            directory: "./src/postgres/migrations",
            extension: "js",
        });
    });

    afterAll(async () => {
        await knex.destroy();
    });

    beforeEach(async () => {
        // Очищаем таблицы перед каждым тестом
        await knex("tariffs").del();
        await knex("spreadsheets").del();
    });

    describe("CRUD spreadsheets", () => {
        it("полный цикл: POST → GET → DELETE → GET (пусто)", async () => {
            const app = getApp();

            // POST — создаём
            const createRes = await request(app)
                .post("/spreadsheets")
                .set("x-api-key", API_KEY)
                .send({ spreadsheetId: "e2e-test-sheet-1" });

            expect(createRes.status).toBe(201);
            expect(createRes.body.spreadsheet_id).toBe("e2e-test-sheet-1");

            // GET — проверяем что есть
            const listRes = await request(app)
                .get("/spreadsheets")
                .set("x-api-key", API_KEY);

            expect(listRes.status).toBe(200);
            expect(listRes.body).toHaveLength(1);
            expect(listRes.body[0].spreadsheet_id).toBe("e2e-test-sheet-1");

            // DELETE — удаляем
            const deleteRes = await request(app)
                .delete("/spreadsheets/e2e-test-sheet-1")
                .set("x-api-key", API_KEY);

            expect(deleteRes.status).toBe(204);

            // GET — пусто
            const emptyRes = await request(app)
                .get("/spreadsheets")
                .set("x-api-key", API_KEY);

            expect(emptyRes.status).toBe(200);
            expect(emptyRes.body).toHaveLength(0);
        });

        it("409 при дупликате spreadsheetId", async () => {
            const app = getApp();

            await request(app)
                .post("/spreadsheets")
                .set("x-api-key", API_KEY)
                .send({ spreadsheetId: "dup-test" });

            const dupRes = await request(app)
                .post("/spreadsheets")
                .set("x-api-key", API_KEY)
                .send({ spreadsheetId: "dup-test" });

            expect(dupRes.status).toBe(409);
        });

        it("404 при удалении несуществующей таблицы", async () => {
            const app = getApp();

            const res = await request(app)
                .delete("/spreadsheets/nonexistent")
                .set("x-api-key", API_KEY);

            expect(res.status).toBe(404);
        });
    });

    describe("Tariff storage", () => {
        it("saveTariffs + getLatestTariffs — сохраняет и читает данные", async () => {
            await saveTariffs(
                "2025-03-01",
                [
                    {
                        warehouseName: "Склад 1",
                        geoName: "Москва",
                        boxDeliveryBase: "100",
                        boxDeliveryCoefExpr: "1.5",
                        boxDeliveryLiter: "10",
                        boxDeliveryMarketplaceBase: "50",
                        boxDeliveryMarketplaceCoefExpr: "2",
                        boxDeliveryMarketplaceLiter: "5",
                        boxStorageBase: "30",
                        boxStorageCoefExpr: "0.5",
                        boxStorageLiter: "3",
                    },
                ],
                { dtNextBox: "2025-03-02", dtTillMax: "2025-03-10" },
            );

            const tariffs = await getLatestTariffs("2025-03-01");
            expect(tariffs).toHaveLength(1);
            expect(tariffs[0].warehouse_name).toBe("Склад 1");
            expect(tariffs[0].box_delivery_coef_expr).toBe("1.5");
        });

        it("upsert — обновляет при повторном insert с тем же date+warehouse", async () => {
            const warehouse = {
                warehouseName: "Upsert Склад",
                geoName: "Москва",
                boxDeliveryBase: "100",
                boxDeliveryCoefExpr: "1.0",
                boxDeliveryLiter: "10",
                boxDeliveryMarketplaceBase: "50",
                boxDeliveryMarketplaceCoefExpr: "2",
                boxDeliveryMarketplaceLiter: "5",
                boxStorageBase: "30",
                boxStorageCoefExpr: "0.5",
                boxStorageLiter: "3",
            };

            await saveTariffs("2025-03-01", [warehouse], {
                dtNextBox: "2025-03-02",
                dtTillMax: "2025-03-10",
            });

            // Второй вызов с обновлёнными данными
            await saveTariffs(
                "2025-03-01",
                [{ ...warehouse, boxDeliveryCoefExpr: "5.0" }],
                { dtNextBox: "2025-03-02", dtTillMax: "2025-03-10" },
            );

            const tariffs = await getLatestTariffs("2025-03-01");
            expect(tariffs).toHaveLength(1); // не дубль
            expect(tariffs[0].box_delivery_coef_expr).toBe("5.0"); // обновлено
        });
    });

    describe("Health endpoint", () => {
        it("200 с реальной БД", async () => {
            const app = getApp();

            const res = await request(app).get("/health");

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
            expect(res.body.db).toBe("connected");
        });
    });

    describe("Export flow", () => {
        it("404 если нет тарифов за сегодня", async () => {
            const app = getApp();

            // Сначала добавим таблицу
            await request(app)
                .post("/spreadsheets")
                .set("x-api-key", API_KEY)
                .send({ spreadsheetId: "export-test" });

            const res = await request(app)
                .post("/spreadsheets/export-test/export")
                .set("x-api-key", API_KEY);

            expect(res.status).toBe(404);
        });

        it("200 при наличии тарифов", async () => {
            const app = getApp();
            const today = new Date().toISOString().slice(0, 10);

            // Добавим тарифы за сегодня
            await saveTariffs(
                today,
                [
                    {
                        warehouseName: "Export Склад",
                        geoName: "МО",
                        boxDeliveryBase: "100",
                        boxDeliveryCoefExpr: "1",
                        boxDeliveryLiter: "10",
                        boxDeliveryMarketplaceBase: "50",
                        boxDeliveryMarketplaceCoefExpr: "2",
                        boxDeliveryMarketplaceLiter: "5",
                        boxStorageBase: "30",
                        boxStorageCoefExpr: "0.5",
                        boxStorageLiter: "3",
                    },
                ],
                { dtNextBox: "2025-03-02", dtTillMax: "2025-03-10" },
            );

            // Добавим таблицу
            await request(app)
                .post("/spreadsheets")
                .set("x-api-key", API_KEY)
                .send({ spreadsheetId: "export-full-test" });

            const res = await request(app)
                .post("/spreadsheets/export-full-test/export")
                .set("x-api-key", API_KEY);

            expect(res.status).toBe(200);
            expect(res.body.count).toBe(1);
        });
    });
});
