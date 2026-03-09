import { getLogger } from "#config/logger.js";
import env from "#config/env/env.js";
import knexInstance, { migrate, seed } from "#postgres/knex.js";
import { runTariffUpdate, startScheduler } from "#services/scheduler.js";
import { createApp } from "#app-factory.js";

const logger = getLogger("app");

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
    logger.info("Запуск приложения...");

    logger.info("Выполнение миграций...");
    await migrate.latest();

    if (env.NODE_ENV !== "production") {
        logger.info("Выполнение seeds...");
        await seed.run();
    }

    const app = createApp();

    const port = env.APP_PORT;
    const server = app.listen(port, () => {
        logger.info(`HTTP-сервер запущен на порту ${port}`);
    });

    logger.info("Первый запуск обновления тарифов...");
    await runTariffUpdate();

    const task = startScheduler();

    const shutdown = () => {
        logger.info("Завершение работы...");
        task.stop();

        const forceExit = setTimeout(() => {
            logger.error("Graceful shutdown timed out, forcing exit");
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();

        server.close(() => {
            logger.info("HTTP-сервер остановлен");
            knexInstance
                .destroy()
                .then(() => logger.info("Соединения с БД закрыты"))
                .catch((err: unknown) => logger.error("Ошибка закрытия соединений БД:", err))
                .finally(() => {
                    clearTimeout(forceExit);
                    process.exit(0);
                });
        });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((error) => {
    logger.error("Критическая ошибка:", error);
    process.exit(1);
});
