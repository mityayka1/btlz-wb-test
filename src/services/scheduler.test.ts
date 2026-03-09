import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("#config/env/env.js", () => ({
    default: {
        CRON_SCHEDULE: "0 * * * *",
        WB_API_KEY: "test-key",
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

const mockFetchBoxTariffs = vi.fn();
vi.mock("#services/wb-api.js", () => ({
    fetchBoxTariffs: (...args: unknown[]) => mockFetchBoxTariffs(...args),
}));

const mockSaveTariffs = vi.fn();
const mockGetLatestTariffs = vi.fn();
vi.mock("#services/tariff-storage.js", () => ({
    saveTariffs: (...args: unknown[]) => mockSaveTariffs(...args),
    getLatestTariffs: (...args: unknown[]) => mockGetLatestTariffs(...args),
}));

const mockGetSpreadsheetIds = vi.fn();
vi.mock("#services/spreadsheet-repository.js", () => ({
    getSpreadsheetIds: (...args: unknown[]) => mockGetSpreadsheetIds(...args),
}));

const mockUpdateAllSpreadsheets = vi.fn();
vi.mock("#services/google-sheets.js", () => ({
    updateAllSpreadsheets: (...args: unknown[]) => mockUpdateAllSpreadsheets(...args),
}));

vi.mock("#utils/with-retry.js", () => ({
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockSetLastUpdateAt = vi.fn();
const mockRecordUpdateFailure = vi.fn();
vi.mock("#utils/app-state.js", () => ({
    setLastUpdateAt: (...args: unknown[]) => mockSetLastUpdateAt(...args),
    recordUpdateFailure: (...args: unknown[]) => mockRecordUpdateFailure(...args),
}));

vi.mock("#utils/date.js", () => ({
    getTodayDateUTC: () => "2025-03-09",
}));

vi.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: vi.fn() },
        sheets: vi.fn(),
    },
}));

vi.mock("#postgres/knex.js", () => ({
    default: { raw: vi.fn() },
}));

import { runTariffUpdate } from "#services/scheduler.js";

describe("runTariffUpdate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("полный успешный цикл: fetch → save → export", async () => {
        const warehouseList = [{ warehouseName: "Склад 1", geoName: "Москва" }];
        mockFetchBoxTariffs.mockResolvedValue({
            warehouseList,
            dtNextBox: "2025-03-10",
            dtTillMax: "2025-03-15",
        });
        mockSaveTariffs.mockResolvedValue(undefined);
        const tariffs = [{ id: 1, warehouse_name: "Склад 1" }];
        mockGetLatestTariffs.mockResolvedValue(tariffs);
        mockGetSpreadsheetIds.mockResolvedValue(["sheet1", "sheet2"]);
        mockUpdateAllSpreadsheets.mockResolvedValue({ succeeded: ["sheet1", "sheet2"], failed: [] });

        await runTariffUpdate();

        expect(mockFetchBoxTariffs).toHaveBeenCalledWith("2025-03-09");
        expect(mockSaveTariffs).toHaveBeenCalledWith("2025-03-09", warehouseList, {
            dtNextBox: "2025-03-10",
            dtTillMax: "2025-03-15",
        });
        expect(mockGetLatestTariffs).toHaveBeenCalledWith("2025-03-09");
        expect(mockUpdateAllSpreadsheets).toHaveBeenCalledWith(["sheet1", "sheet2"], tariffs);
        expect(mockSetLastUpdateAt).toHaveBeenCalledWith("2025-03-09");
        expect(mockRecordUpdateFailure).not.toHaveBeenCalled();
    });

    it("пропускает обновление sheets если нет зарегистрированных таблиц", async () => {
        mockFetchBoxTariffs.mockResolvedValue({
            warehouseList: [{ warehouseName: "Склад" }],
            dtNextBox: "2025-03-10",
            dtTillMax: "2025-03-15",
        });
        mockSaveTariffs.mockResolvedValue(undefined);
        mockGetLatestTariffs.mockResolvedValue([{ id: 1 }]);
        mockGetSpreadsheetIds.mockResolvedValue([]);

        await runTariffUpdate();

        expect(mockUpdateAllSpreadsheets).not.toHaveBeenCalled();
        expect(mockSetLastUpdateAt).toHaveBeenCalledWith("2025-03-09");
    });

    it("записывает ошибку в app-state при сбое", async () => {
        const error = new Error("WB API недоступен");
        mockFetchBoxTariffs.mockRejectedValue(error);

        await runTariffUpdate();

        expect(mockRecordUpdateFailure).toHaveBeenCalledWith(error);
        expect(mockSetLastUpdateAt).not.toHaveBeenCalled();
    });

    it("защита от параллельного запуска", async () => {
        let resolveFirst: () => void;
        const firstPromise = new Promise<void>((r) => {
            resolveFirst = r;
        });
        mockFetchBoxTariffs.mockImplementationOnce(() => firstPromise.then(() => ({
            warehouseList: [{ warehouseName: "Склад" }],
            dtNextBox: "2025-03-10",
            dtTillMax: "2025-03-15",
        })));
        mockSaveTariffs.mockResolvedValue(undefined);
        mockGetLatestTariffs.mockResolvedValue([]);
        mockGetSpreadsheetIds.mockResolvedValue([]);

        const run1 = runTariffUpdate();
        const run2 = runTariffUpdate();

        resolveFirst!();
        await run1;
        await run2;

        // fetchBoxTariffs должен быть вызван только один раз
        expect(mockFetchBoxTariffs).toHaveBeenCalledTimes(1);
    });
});
