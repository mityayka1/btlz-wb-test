import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getLogger } from "#config/logger.js";
import { apiKeyGuard } from "#middleware/api-key.js";
import { getAllSpreadsheets, addSpreadsheet, deleteSpreadsheet } from "#services/spreadsheet-repository.js";
import { checkAccess, updateSpreadsheet } from "#services/google-sheets.js";
import { getLatestTariffs } from "#services/tariff-storage.js";
import { withRetry } from "#utils/with-retry.js";
import { getTodayDateUTC } from "#utils/date.js";
import { AppError, DuplicateError } from "#types/errors.js";

const logger = getLogger("spreadsheets");

const SPREADSHEET_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;

const router = Router();

router.use(apiKeyGuard);

router.get("/", async (_req, res) => {
    try {
        const spreadsheets = await getAllSpreadsheets();
        res.json(spreadsheets);
    } catch (error) {
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка получения списка таблиц:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
    }
});

router.post("/", async (req, res) => {
    const { spreadsheetId } = req.body;

    if (!spreadsheetId || typeof spreadsheetId !== "string" || !SPREADSHEET_ID_RE.test(spreadsheetId)) {
        res.status(400).json({ error: "Поле spreadsheetId обязательно (строка, 20-80 символов, [a-zA-Z0-9_-])" });
        return;
    }

    try {
        await checkAccess(spreadsheetId);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка проверки доступа к таблице:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
        return;
    }

    try {
        const row = await addSpreadsheet(spreadsheetId);
        res.status(201).json(row);
    } catch (error: unknown) {
        if (error instanceof DuplicateError) {
            res.status(409).json({ error: error.message });
            return;
        }
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка добавления таблицы:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
    }
});

router.delete("/:spreadsheetId", async (req, res) => {
    try {
        const deleted = await deleteSpreadsheet(req.params.spreadsheetId);
        if (!deleted) {
            res.status(404).json({ error: "Таблица не найдена" });
            return;
        }
        res.status(204).end();
    } catch (error) {
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка удаления таблицы:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
    }
});

router.post("/:spreadsheetId/export", async (req, res) => {
    const { spreadsheetId } = req.params;

    try {
        await checkAccess(spreadsheetId);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка проверки доступа:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
        return;
    }

    try {
        const date = getTodayDateUTC();
        const tariffs = await getLatestTariffs(date);

        if (tariffs.length === 0) {
            res.status(404).json({ error: "Нет тарифов за сегодня" });
            return;
        }

        await withRetry(() => updateSpreadsheet(spreadsheetId, tariffs));
        res.json({ message: "Экспорт выполнен", count: tariffs.length });
    } catch (error) {
        const errorId = randomUUID();
        logger.error(`[${errorId}] Ошибка экспорта в таблицу:`, error);
        res.status(500).json({ error: "Внутренняя ошибка сервера", errorId });
    }
});

export default router;
