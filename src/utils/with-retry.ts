import { getLogger } from "#config/logger.js";

const logger = getLogger("with-retry");

export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** Предикат: возвращает false для ошибок, которые не стоит повторять (4xx, валидация). */
    isRetryable?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Повторяет асинхронную операцию при ошибке с exponential backoff + jitter.
 * Бросает последнюю ошибку, если все попытки исчерпаны или ошибка не retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
    const maxAttempts = opts?.maxAttempts ?? 3;
    const baseDelayMs = opts?.baseDelayMs ?? 1000;
    const maxDelayMs = opts?.maxDelayMs ?? 30_000;
    const isRetryable = opts?.isRetryable ?? (() => true);

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (!isRetryable(error) || attempt + 1 >= maxAttempts) break;

            const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
            const jitter = delay * (0.5 + Math.random());

            logger.warn(`Попытка ${attempt + 1}/${maxAttempts} не удалась, повтор через ${Math.round(jitter)}ms: ${error}`);
            await sleep(jitter);
        }
    }

    throw lastError;
}
