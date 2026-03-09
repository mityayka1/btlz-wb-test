import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import env from "#config/env/env.js";

const expectedKey = Buffer.from(env.API_KEY);

/** Express middleware: проверяет заголовок `x-api-key`. Использует timing-safe сравнение. */
export function apiKeyGuard(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey || typeof apiKey !== "string") {
        res.status(401).json({ error: "Неверный или отсутствующий API-ключ" });
        return;
    }

    const provided = Buffer.from(apiKey);
    if (expectedKey.length !== provided.length || !timingSafeEqual(expectedKey, provided)) {
        res.status(401).json({ error: "Неверный или отсутствующий API-ключ" });
        return;
    }

    next();
}
