import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import spreadsheetRoutes from "#routes/spreadsheets.js";
import healthRoutes from "#routes/health.js";
import { getLogger } from "#config/logger.js";
import { AppError } from "#types/errors.js";

const logger = getLogger("app");

/** Создаёт и конфигурирует Express-приложение. Вынесено из app.ts для тестов (supertest). */
export function createApp(): Express {
    const app = express();

    app.use(helmet());
    app.use(express.json({ limit: "1kb" }));
    app.use(
        rateLimit({
            windowMs: 60_000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
        }),
    );

    app.use("/health", healthRoutes);
    app.use("/spreadsheets", spreadsheetRoutes);

    // Global error handler — ловит всё, что не поймали роуты
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        logger.error("Unhandled error:", err);
        res.status(500).json({ error: "Внутренняя ошибка сервера" });
    });

    return app;
}
