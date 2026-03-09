import { Router } from "express";
import knex from "#postgres/knex.js";
import { getLogger } from "#config/logger.js";
import { getLastUpdateAt, getUpdateHealth } from "#utils/app-state.js";

const logger = getLogger("health");

const router = Router();

router.get("/", async (_req, res) => {
    let dbOk = false;
    let dbError: string | undefined;
    try {
        await knex.raw("SELECT 1");
        dbOk = true;
    } catch (error) {
        dbError = error instanceof Error ? error.message : String(error);
        logger.warn(`Health check: БД недоступна: ${dbError}`);
    }

    const { consecutiveFailures, lastError } = getUpdateHealth();
    const status = dbOk && consecutiveFailures === 0 ? "ok" : "degraded";

    res.status(dbOk ? 200 : 503).json({
        status,
        db: dbOk ? "connected" : "disconnected",
        ...(dbError && { dbError }),
        lastUpdateAt: getLastUpdateAt(),
        consecutiveFailures,
        ...(lastError && { lastError }),
        uptime: Math.round(process.uptime()),
    });
});

export default router;
