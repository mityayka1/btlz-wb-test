import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("#config/env/env.js", () => ({
    default: {
        WB_API_KEY: "test-wb-key",
        GOOGLE_SERVICE_ACCOUNT_PATH: "/fake/path.json",
        API_KEY: "test-key",
    },
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

import { fetchBoxTariffs } from "#services/wb-api.js";

const mockFetch = vi.fn();

describe("fetchBoxTariffs", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const validResponse = {
        response: {
            data: {
                dtNextBox: "2025-03-10",
                dtTillMax: "2025-03-15",
                warehouseList: [
                    {
                        warehouseName: "Склад 1",
                        geoName: "Москва",
                        boxDeliveryBase: "50",
                        boxDeliveryCoefExpr: "1.2",
                        boxDeliveryLiter: "10",
                        boxDeliveryMarketplaceBase: "30",
                        boxDeliveryMarketplaceCoefExpr: "0.8",
                        boxDeliveryMarketplaceLiter: "5",
                        boxStorageBase: "20",
                        boxStorageCoefExpr: "1.0",
                        boxStorageLiter: "3",
                    },
                ],
            },
        },
    };

    it("возвращает warehouseList и мета-данные при успехе", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(validResponse),
        });

        const result = await fetchBoxTariffs("2025-03-09");

        expect(result.warehouseList).toHaveLength(1);
        expect(result.warehouseList[0].warehouseName).toBe("Склад 1");
        expect(result.dtNextBox).toBe("2025-03-10");
        expect(result.dtTillMax).toBe("2025-03-15");
    });

    it("передаёт Authorization заголовок и дату в URL", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(validResponse),
        });

        await fetchBoxTariffs("2025-03-09");

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("date=2025-03-09"),
            expect.objectContaining({
                headers: { Authorization: "test-wb-key" },
            }),
        );
    });

    it("бросает ошибку при HTTP ошибке", async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 403,
            text: () => Promise.resolve("Forbidden"),
        });

        await expect(fetchBoxTariffs("2025-03-09")).rejects.toThrow("WB API error 403: Forbidden");
    });

    it("обрабатывает недоступное тело ответа при HTTP ошибке", async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.reject(new Error("stream error")),
        });

        await expect(fetchBoxTariffs("2025-03-09")).rejects.toThrow(
            "WB API error 500: (не удалось прочитать тело ответа)",
        );
    });

    it("бросает ZodError при невалидном JSON ответе", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ unexpected: "shape" }),
        });

        await expect(fetchBoxTariffs("2025-03-09")).rejects.toThrow();
    });
});
