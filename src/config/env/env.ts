import dotenv from "dotenv";
import cron from "node-cron";
import { z } from "zod";
dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    POSTGRES_HOST: z.string().optional(),
    POSTGRES_PORT: z
        .string()
        .regex(/^[0-9]+$/)
        .transform((value) => parseInt(value))
        .default("5432"),
    POSTGRES_DB: z.string(),
    POSTGRES_USER: z.string(),
    POSTGRES_PASSWORD: z.string(),
    APP_PORT: z
        .string()
        .regex(/^[0-9]+$/)
        .transform((value) => parseInt(value))
        .default("5000"),
    WB_API_KEY: z.string().min(1),
    API_KEY: z.string().min(1),
    GOOGLE_SERVICE_ACCOUNT_PATH: z.string().min(1),
    CRON_SCHEDULE: z
        .string()
        .default("0 * * * *")
        .refine((val) => cron.validate(val), { message: "Invalid cron expression" }),
});

const env = envSchema.parse({
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_PORT: process.env.POSTGRES_PORT,
    POSTGRES_DB: process.env.POSTGRES_DB,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
    APP_PORT: process.env.APP_PORT,
    WB_API_KEY: process.env.WB_API_KEY,
    API_KEY: process.env.API_KEY,
    GOOGLE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    CRON_SCHEDULE: process.env.CRON_SCHEDULE,
});

export default env;
