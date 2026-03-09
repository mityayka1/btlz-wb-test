import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockKnexRaw } = vi.hoisted(() => ({
    mockKnexRaw: vi.fn(),
}));

vi.mock("#config/env/env.js", () => ({
    default: {
        GOOGLE_SERVICE_ACCOUNT_PATH: "/fake/path.json",
        API_KEY: "test-key",
    },
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("#postgres/knex.js", () => ({
    default: { raw: mockKnexRaw },
}));

let appStateValue: string | null = null;
let mockHealth = { consecutiveFailures: 0, lastError: null as string | null };

vi.mock("#utils/app-state.js", () => ({
    getLastUpdateAt: () => appStateValue,
    setLastUpdateAt: (d: string) => {
        appStateValue = d;
    },
    getUpdateHealth: () => mockHealth,
}));

import healthRouter from "#routes/health.js";

function createTestApp() {
    const app = express();
    app.use("/health", healthRouter);
    return app;
}

describe("GET /health", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appStateValue = null;
        mockHealth = { consecutiveFailures: 0, lastError: null };
    });

    it("возвращает 200 и status ok при доступной БД", async () => {
        mockKnexRaw.mockResolvedValue(undefined);

        const res = await request(createTestApp()).get("/health");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(res.body.db).toBe("connected");
        expect(typeof res.body.uptime).toBe("number");
    });

    it("возвращает 503 и status degraded при недоступной БД", async () => {
        mockKnexRaw.mockRejectedValue(new Error("Connection refused"));

        const res = await request(createTestApp()).get("/health");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("degraded");
        expect(res.body.db).toBe("disconnected");
    });

    it("возвращает lastUpdateAt: null если обновлений не было", async () => {
        mockKnexRaw.mockResolvedValue(undefined);

        const res = await request(createTestApp()).get("/health");

        expect(res.body.lastUpdateAt).toBeNull();
    });

    it("возвращает lastUpdateAt после setLastUpdateAt", async () => {
        mockKnexRaw.mockResolvedValue(undefined);
        appStateValue = "2025-03-09";

        const res = await request(createTestApp()).get("/health");

        expect(res.body.lastUpdateAt).toBe("2025-03-09");
    });

    it("не требует API-ключ", async () => {
        mockKnexRaw.mockResolvedValue(undefined);

        const res = await request(createTestApp()).get("/health");

        expect(res.status).toBe(200);
    });
});
