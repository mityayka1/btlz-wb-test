import _knex from "knex";
import knexConfig from "#config/knex/knexfile.js";
import { getLogger } from "#config/logger.js";

const logger = getLogger("knex");

const knex = _knex(knexConfig);
export default knex;

function logMigrationResults(action: string, result: [number, string[]]) {
    if (result[1].length === 0) {
        logger.info(["latest", "up"].includes(action) ? "All migrations are up to date" : "All migrations have been rolled back");
        return;
    }
    logger.info(`Batch ${result[0]} ${["latest", "up"].includes(action) ? "ran" : "rolled back"} the following migrations:`);
    for (const migration of result[1]) {
        logger.info("- " + migration);
    }
}
function logMigrationList(list: [{ name: string }[], { file: string }[]]) {
    logger.info(`Found ${list[0].length} Completed Migration file/files.`);
    for (const migration of list[0]) {
        logger.info("- " + migration.name);
    }
    logger.info(`Found ${list[1].length} Pending Migration file/files.`);
    for (const migration of list[1]) {
        logger.info("- " + migration.file);
    }
}

function logSeedRun(result: [string[]]) {
    if (result[0].length === 0) {
        logger.info("No seeds to run");
        return;
    }
    logger.info(`Ran ${result[0].length} seed files`);
    for (const seed of result[0]) {
        logger.info("- " + seed?.split(/\/|\\/).pop());
    }
}

function logSeedMake(name: string) {
    logger.info(`Created seed: ${name.split(/\/|\\/).pop()}`);
}

export const migrate = {
    latest: async () => {
        logMigrationResults("latest", await knex.migrate.latest());
    },
    rollback: async () => {
        logMigrationResults("rollback", await knex.migrate.rollback());
    },
    down: async (name?: string) => {
        logMigrationResults("down", await knex.migrate.down({ name }));
    },
    up: async (name?: string) => {
        logMigrationResults("up", await knex.migrate.up({ name }));
    },
    list: async () => {
        logMigrationList(await knex.migrate.list());
    },
    make: async (name: string) => {
        if (!name) {
            logger.error("Please provide a migration name");
            process.exit(1);
        }
        logger.info(await knex.migrate.make(name, { extension: "js" }));
    },
};

export const seed = {
    run: async () => {
        logSeedRun(await knex.seed.run());
    },
    make: async (name: string) => {
        if (!name) {
            logger.error("Please provide a seed name");
            process.exit(1);
        }
        logSeedMake(await knex.seed.make(name));
    },
};
