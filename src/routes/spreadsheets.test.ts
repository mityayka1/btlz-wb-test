import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { AccessDeniedError, DuplicateError } from "#types/errors.js";

vi.mock("#config/env/env.js", () => ({
    default: {
        API_KEY: "test-secret-key",
        GOOGLE_SERVICE_ACCOUNT_PATH: "/fake/path.json",
    },
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: vi.fn() },
        sheets: vi.fn(),
    },
}));

const mockGetAllSpreadsheets = vi.fn();
const mockAddSpreadsheet = vi.fn();
const mockDeleteSpreadsheet = vi.fn();
vi.mock("#services/spreadsheet-repository.js", () => ({
    getAllSpreadsheets: (...args: unknown[]) => mockGetAllSpreadsheets(...args),
    addSpreadsheet: (...args: unknown[]) => mockAddSpreadsheet(...args),
    deleteSpreadsheet: (...args: unknown[]) => mockDeleteSpreadsheet(...args),
}));

const mockCheckAccess = vi.fn();
const mockUpdateSpreadsheet = vi.fn();
vi.mock("#services/google-sheets.js", () => ({
    checkAccess: (...args: unknown[]) => mockCheckAccess(...args),
    updateSpreadsheet: (...args: unknown[]) => mockUpdateSpreadsheet(...args),
    parseCoef: vi.fn(),
    formatTariffsForSheet: vi.fn(),
}));

const mockGetLatestTariffs = vi.fn();
vi.mock("#services/tariff-storage.js", () => ({
    getLatestTariffs: (...args: unknown[]) => mockGetLatestTariffs(...args),
}));

vi.mock("#utils/with-retry.js", () => ({
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("#utils/date.js", () => ({
    getTodayDateUTC: () => "2025-03-09",
}));

vi.mock("#postgres/knex.js", () => ({
    default: { raw: vi.fn() },
}));

import spreadsheetRouter from "#routes/spreadsheets.js";

function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use("/spreadsheets", spreadsheetRouter);
    return app;
}

const API_KEY = "test-secret-key";
/** Валидный spreadsheetId (>= 20 символов, [a-zA-Z0-9_-]) */
const VALID_ID = "abc123_test_spreadsheet_01";

describe("GET /spreadsheets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("401 без api-key", async () => {
        const res = await request(createTestApp()).get("/spreadsheets");
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/API/i);
    });

    it("401 с неверным api-key", async () => {
        const res = await request(createTestApp())
            .get("/spreadsheets")
            .set("x-api-key", "wrong");
        expect(res.status).toBe(401);
    });

    it("200 возвращает список таблиц", async () => {
        mockGetAllSpreadsheets.mockResolvedValue([
            { spreadsheet_id: "abc123" },
            { spreadsheet_id: "def456" },
        ]);

        const res = await request(createTestApp())
            .get("/spreadsheets")
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].spreadsheet_id).toBe("abc123");
    });

    it("200 возвращает пустой массив если нет таблиц", async () => {
        mockGetAllSpreadsheets.mockResolvedValue([]);

        const res = await request(createTestApp())
            .get("/spreadsheets")
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it("500 при ошибке БД", async () => {
        mockGetAllSpreadsheets.mockRejectedValue(new Error("DB error"));

        const res = await request(createTestApp())
            .get("/spreadsheets")
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(500);
    });
});

describe("POST /spreadsheets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("400 без spreadsheetId в body", async () => {
        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({});

        expect(res.status).toBe(400);
    });

    it("400 spreadsheetId не string (number)", async () => {
        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: 123 });

        expect(res.status).toBe(400);
    });

    it("400 spreadsheetId слишком короткий", async () => {
        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: "short" });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/spreadsheetId/i);
    });

    it("403 checkAccess не прошёл (нет доступа)", async () => {
        mockCheckAccess.mockRejectedValue(new AccessDeniedError("Нет доступа к таблице"));

        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: VALID_ID });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/доступ/i);
    });

    it("409 дупликат (DuplicateError из repository)", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockAddSpreadsheet.mockRejectedValue(new DuplicateError("Таблица уже зарегистрирована"));

        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: VALID_ID });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/зарегистрирована/i);
    });

    it("201 успешное добавление", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockAddSpreadsheet.mockResolvedValue({ spreadsheet_id: VALID_ID });

        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: VALID_ID });

        expect(res.status).toBe(201);
        expect(res.body.spreadsheet_id).toBe(VALID_ID);
        expect(mockAddSpreadsheet).toHaveBeenCalledWith(VALID_ID);
    });

    it("500 при неожиданной ошибке БД", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockAddSpreadsheet.mockRejectedValue(new Error("unexpected"));

        const res = await request(createTestApp())
            .post("/spreadsheets")
            .set("x-api-key", API_KEY)
            .send({ spreadsheetId: VALID_ID });

        expect(res.status).toBe(500);
    });
});

describe("DELETE /spreadsheets/:spreadsheetId", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("404 таблица не найдена", async () => {
        mockDeleteSpreadsheet.mockResolvedValue(false);

        const res = await request(createTestApp())
            .delete("/spreadsheets/nonexistent")
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(404);
    });

    it("204 успешное удаление", async () => {
        mockDeleteSpreadsheet.mockResolvedValue(true);

        const res = await request(createTestApp())
            .delete(`/spreadsheets/${VALID_ID}`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(204);
        expect(mockDeleteSpreadsheet).toHaveBeenCalledWith(VALID_ID);
    });

    it("500 при ошибке БД", async () => {
        mockDeleteSpreadsheet.mockRejectedValue(new Error("DB error"));

        const res = await request(createTestApp())
            .delete(`/spreadsheets/${VALID_ID}`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(500);
    });
});

describe("POST /spreadsheets/:spreadsheetId/export", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("403 нет доступа к таблице", async () => {
        mockCheckAccess.mockRejectedValue(new AccessDeniedError("Нет доступа к таблице"));

        const res = await request(createTestApp())
            .post(`/spreadsheets/${VALID_ID}/export`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/доступ/i);
    });

    it("404 нет тарифов за сегодня", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockGetLatestTariffs.mockResolvedValue([]);

        const res = await request(createTestApp())
            .post(`/spreadsheets/${VALID_ID}/export`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/тарифов/i);
    });

    it("200 успешный экспорт", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockGetLatestTariffs.mockResolvedValue([
            { id: 1, warehouse_name: "Склад 1" },
            { id: 2, warehouse_name: "Склад 2" },
        ]);
        mockUpdateSpreadsheet.mockResolvedValue(undefined);

        const res = await request(createTestApp())
            .post(`/spreadsheets/${VALID_ID}/export`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.message).toMatch(/экспорт/i);
    });

    it("500 ошибка при обновлении таблицы", async () => {
        mockCheckAccess.mockResolvedValue(undefined);
        mockGetLatestTariffs.mockResolvedValue([{ id: 1, warehouse_name: "Склад" }]);
        mockUpdateSpreadsheet.mockRejectedValue(new Error("Google API error"));

        const res = await request(createTestApp())
            .post(`/spreadsheets/${VALID_ID}/export`)
            .set("x-api-key", API_KEY);

        expect(res.status).toBe(500);
    });
});
