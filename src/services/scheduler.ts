import cron from "node-cron";
import { getLogger } from "#config/logger.js";
import env from "#config/env/env.js";
import { fetchBoxTariffs } from "#services/wb-api.js";
import { saveTariffs, getLatestTariffs } from "#services/tariff-storage.js";
import { getSpreadsheetIds } from "#services/spreadsheet-repository.js";
import { updateAllSpreadsheets } from "#services/google-sheets.js";
import { withRetry } from "#utils/with-retry.js";
import { setLastUpdateAt, recordUpdateFailure } from "#utils/app-state.js";
import { getTodayDateUTC } from "#utils/date.js";

const logger = getLogger("scheduler");

let isRunning = false;

/**
 * Полный цикл обновления: WB API → PostgreSQL → Google Sheets.
 * Защищён от параллельного запуска через флаг `isRunning`.
 * Отслеживает провалы через app-state для health endpoint.
 */
export async function runTariffUpdate(): Promise<void> {
    if (isRunning) {
        logger.warn("Предыдущее обновление ещё выполняется, пропуск");
        return;
    }

    isRunning = true;
    const date = getTodayDateUTC();
    logger.info(`=== Запуск обновления тарифов за ${date} ===`);

    try {
        const { warehouseList, dtNextBox, dtTillMax } = await withRetry(
            () => fetchBoxTariffs(date),
            { maxAttempts: 3, baseDelayMs: 2000 },
        );
        await saveTariffs(date, warehouseList, { dtNextBox, dtTillMax });

        const tariffs = await getLatestTariffs(date);
        const spreadsheetIds = await getSpreadsheetIds();

        if (spreadsheetIds.length > 0) {
            logger.info(`Обновление ${spreadsheetIds.length} Google таблиц...`);
            const result = await updateAllSpreadsheets(spreadsheetIds, tariffs);
            logger.info(`Sheets sync: ${result.succeeded.length} ok, ${result.failed.length} failed`);
        } else {
            logger.warn("Нет Google таблиц для обновления (таблица spreadsheets пуста)");
        }

        setLastUpdateAt(date);
        logger.info(`=== Обновление тарифов за ${date} завершено ===`);
    } catch (error) {
        recordUpdateFailure(error);
        logger.error(`Ошибка обновления тарифов: ${error}`);
    } finally {
        isRunning = false;
    }
}

/** Запускает cron-задачу по расписанию из env.CRON_SCHEDULE. */
export function startScheduler(): cron.ScheduledTask {
    const schedule = env.CRON_SCHEDULE;
    logger.info(`Планировщик запущен: "${schedule}"`);

    return cron.schedule(schedule, async () => {
        await runTariffUpdate();
    });
}
