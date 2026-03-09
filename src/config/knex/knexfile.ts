import env from "#config/env/env.js";
import type { Knex } from "knex";
import { z } from "zod";

const connectionSchema = z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
});

const NODE_ENV = env.NODE_ENV ?? "development";

const defaultPool = {
    min: 2,
    max: 10,
    acquireTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    propagateCreateError: false,
};

const devConnection = () =>
    connectionSchema.parse({
        host: env.POSTGRES_HOST ?? "localhost",
        port: env.POSTGRES_PORT ?? 5432,
        database: env.POSTGRES_DB ?? "postgres",
        user: env.POSTGRES_USER ?? "postgres",
        password: env.POSTGRES_PASSWORD ?? "postgres",
    });

const devConfig: Knex.Config = {
    client: "pg",
    connection: devConnection,
    pool: defaultPool,
    migrations: {
        stub: "src/config/knex/migration.stub.js",
        directory: "./src/postgres/migrations",
        tableName: "migrations",
        extension: "ts",
    },
    seeds: {
        stub: "src/config/knex/seed.stub.js",
        directory: "./src/postgres/seeds",
        extension: "js",
    },
};

const knexConfigs: Record<string, Knex.Config> = {
    development: devConfig,
    test: devConfig,
    production: {
        client: "pg",
        connection: () =>
            connectionSchema.parse({
                host: env.POSTGRES_HOST,
                port: env.POSTGRES_PORT,
                database: env.POSTGRES_DB,
                user: env.POSTGRES_USER,
                password: env.POSTGRES_PASSWORD,
            }),
        pool: defaultPool,
        migrations: {
            directory: "./dist/postgres/migrations",
            tableName: "migrations",
            extension: "js",
        },
        seeds: {
            directory: "./dist/postgres/seeds",
            extension: "js",
        },
    },
};

const config = knexConfigs[NODE_ENV];
if (!config) {
    throw new Error(`Unsupported NODE_ENV: "${NODE_ENV}". Expected: development, production, test`);
}

export default config;
