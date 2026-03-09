import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("#config/env/env.js", () => ({
    default: { API_KEY: "test-secret-key" },
}));

import { apiKeyGuard } from "#middleware/api-key.js";

function createMockReqRes(apiKey?: string) {
    const req = {
        headers: apiKey ? { "x-api-key": apiKey } : {},
    } as Request;

    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    return { req, res, next };
}

describe("apiKeyGuard", () => {
    it("вызывает next() при валидном ключе", () => {
        const { req, res, next } = createMockReqRes("test-secret-key");
        apiKeyGuard(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it("возвращает 401 без заголовка x-api-key", () => {
        const { req, res, next } = createMockReqRes();
        apiKeyGuard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: "Неверный или отсутствующий API-ключ",
        });
    });

    it("возвращает 401 при неверном ключе", () => {
        const { req, res, next } = createMockReqRes("wrong-key");
        apiKeyGuard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("возвращает 401 при пустой строке в ключе", () => {
        const { req, res, next } = createMockReqRes("");
        apiKeyGuard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
