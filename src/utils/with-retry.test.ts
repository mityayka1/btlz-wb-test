import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "#utils/with-retry.js";

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

describe("withRetry", () => {
    let originalRandom: () => number;

    beforeEach(() => {
        vi.restoreAllMocks();
        originalRandom = Math.random;
    });

    afterEach(() => {
        Math.random = originalRandom;
    });

    it("возвращает результат при успехе с первой попытки", async () => {
        const fn = vi.fn().mockResolvedValue("ok");
        const result = await withRetry(fn);
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("повторяет при неудаче и возвращает результат", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail 1"))
            .mockRejectedValueOnce(new Error("fail 2"))
            .mockResolvedValue("ok");

        const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("бросает последнюю ошибку при исчерпании попыток", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail 1"))
            .mockRejectedValueOnce(new Error("fail 2"))
            .mockRejectedValueOnce(new Error("fail 3"));

        await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow("fail 3");
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("использует дефолтные значения (3 попытки)", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail"))
            .mockRejectedValueOnce(new Error("fail"))
            .mockRejectedValueOnce(new Error("fail"));

        await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("fail");
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("maxAttempts: 1 — не повторяет", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("once"));
        await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow("once");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("delay увеличивается экспоненциально", async () => {
        Math.random = () => 0.5; // jitter = delay * (0.5 + 0.5) = delay * 1.0

        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail"))
            .mockRejectedValueOnce(new Error("fail"))
            .mockResolvedValue("ok");

        const start = Date.now();
        await withRetry(fn, { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 1000 });
        const elapsed = Date.now() - start;

        // С baseDelayMs=50: delay_0 = 50, delay_1 = 100 → ~150ms минимум
        expect(elapsed).toBeGreaterThanOrEqual(50);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("maxDelayMs ограничивает задержку", async () => {
        Math.random = () => 0.5; // jitter multiplier = 1.0

        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("fail"))
            .mockResolvedValue("ok");

        const start = Date.now();
        // baseDelayMs=10000, но maxDelayMs=10 — delay capped
        await withRetry(fn, { maxAttempts: 2, baseDelayMs: 10000, maxDelayMs: 10 });
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(500);
    });

    it("не повторяет если isRetryable возвращает false", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("not retryable"));

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 1,
                isRetryable: () => false,
            }),
        ).rejects.toThrow("not retryable");

        expect(fn).toHaveBeenCalledTimes(1);
    });
});
