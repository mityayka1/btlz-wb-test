import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSheetsGet, mockSheetsBatchUpdate } = vi.hoisted(() => ({
    mockSheetsGet: vi.fn(),
    mockSheetsBatchUpdate: vi.fn(),
}));

vi.mock("#config/env/env.js", () => ({
    default: {
        GOOGLE_SERVICE_ACCOUNT_PATH: "/fake/path.json",
        API_KEY: "test",
    },
}));

vi.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: vi.fn() },
        sheets: vi.fn(() => ({
            spreadsheets: {
                get: mockSheetsGet,
                batchUpdate: mockSheetsBatchUpdate,
            },
        })),
    },
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("#utils/with-retry.js", () => ({
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import {
    parseCoef,
    formatTariffsForSheet,
    toSheetRows,
    updateSpreadsheet,
    checkAccess,
    updateAllSpreadsheets,
} from "#services/google-sheets.js";
import type { TariffRow } from "#types/tariff.js";

// ── parseCoef ──────────────────────────────────────────────

describe("parseCoef", () => {
    it("парсит обычное число", () => {
        expect(parseCoef("1.5")).toBe(1.5);
    });

    it("парсит целое число", () => {
        expect(parseCoef("100")).toBe(100);
    });

    it('заменяет запятую на точку ("1,5" → 1.5)', () => {
        expect(parseCoef("1,5")).toBe(1.5);
    });

    it('"-" → Infinity', () => {
        expect(parseCoef("-")).toBe(Infinity);
    });

    it("пустая строка → Infinity", () => {
        expect(parseCoef("")).toBe(Infinity);
    });

    it("нечисловая строка → Infinity", () => {
        expect(parseCoef("abc")).toBe(Infinity);
    });

    it("ноль", () => {
        expect(parseCoef("0")).toBe(0);
    });

    it("отрицательное число", () => {
        expect(parseCoef("-5")).toBe(-5);
    });

    it("число с несколькими запятыми — parseFloat берёт до второй точки", () => {
        // "1,234,567" → "1.234.567" → parseFloat("1.234.567") = 1.234
        expect(parseCoef("1,234,567")).toBe(1.234);
    });
});

// ── toSheetRows ────────────────────────────────────────────

describe("toSheetRows", () => {
    it("конвертирует строки в формат Google Sheets API", () => {
        const result = toSheetRows([["A", "B"], ["C", "D"]]);

        expect(result).toEqual([
            {
                values: [
                    { userEnteredValue: { stringValue: "A" } },
                    { userEnteredValue: { stringValue: "B" } },
                ],
            },
            {
                values: [
                    { userEnteredValue: { stringValue: "C" } },
                    { userEnteredValue: { stringValue: "D" } },
                ],
            },
        ]);
    });

    it("обрабатывает пустые ячейки (undefined → пустая строка)", () => {
        const data = [["ok", undefined as unknown as string]];
        const result = toSheetRows(data);

        expect(result[0].values[1]).toEqual({
            userEnteredValue: { stringValue: "" },
        });
    });

    it("преобразует null в пустую строку", () => {
        const data = [[null as unknown as string]];
        const result = toSheetRows(data);

        expect(result[0].values[0]).toEqual({
            userEnteredValue: { stringValue: "" },
        });
    });

    it("пустой массив → пустой массив", () => {
        expect(toSheetRows([])).toEqual([]);
    });
});

// ── formatTariffsForSheet ──────────────────────────────────

function makeTariffRow(overrides: Partial<TariffRow> = {}): TariffRow {
    return {
        date: "2025-03-01",
        warehouse_name: "Склад",
        geo_name: "Москва",
        box_delivery_base: "100",
        box_delivery_coef_expr: "1",
        box_delivery_liter: "10",
        box_delivery_marketplace_base: "50",
        box_delivery_marketplace_coef_expr: "2",
        box_delivery_marketplace_liter: "5",
        box_storage_base: "30",
        box_storage_coef_expr: "0.5",
        box_storage_liter: "3",
        dt_next_box: "2025-03-02",
        dt_till_max: "2025-03-10",
        ...overrides,
    };
}

describe("formatTariffsForSheet", () => {
    it("возвращает заголовки при пустом массиве", () => {
        const result = formatTariffsForSheet([]);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("Склад");
        expect(result[0]).toContain("Регион");
        expect(result[0]).toContain("Дата");
    });

    it("headers имеют 12 колонок", () => {
        const result = formatTariffsForSheet([]);
        expect(result[0]).toHaveLength(12);
    });

    it("формирует строки данных с правильным порядком полей", () => {
        const tariff = makeTariffRow({ warehouse_name: "Подольск", geo_name: "МО" });
        const result = formatTariffsForSheet([tariff]);

        expect(result).toHaveLength(2); // header + 1 row
        const row = result[1];
        expect(row[0]).toBe("Подольск");          // warehouse_name
        expect(row[1]).toBe("МО");                 // geo_name
        expect(row[2]).toBe("1");                  // box_delivery_coef_expr
        expect(row[3]).toBe("100");                // box_delivery_base
        expect(row[4]).toBe("10");                 // box_delivery_liter
        expect(row[5]).toBe("2");                  // box_delivery_marketplace_coef_expr
        expect(row[6]).toBe("50");                 // box_delivery_marketplace_base
        expect(row[7]).toBe("5");                  // box_delivery_marketplace_liter
        expect(row[8]).toBe("0.5");                // box_storage_coef_expr
        expect(row[9]).toBe("30");                 // box_storage_base
        expect(row[10]).toBe("3");                 // box_storage_liter
        expect(row[11]).toBe("2025-03-01");        // date
    });

    it("сортирует по коэффициенту доставки по возрастанию", () => {
        const tariffs = [
            makeTariffRow({ warehouse_name: "Дорогой", box_delivery_coef_expr: "10" }),
            makeTariffRow({ warehouse_name: "Дешёвый", box_delivery_coef_expr: "1" }),
            makeTariffRow({ warehouse_name: "Средний", box_delivery_coef_expr: "5" }),
        ];
        const result = formatTariffsForSheet(tariffs);

        expect(result[1][0]).toBe("Дешёвый");
        expect(result[2][0]).toBe("Средний");
        expect(result[3][0]).toBe("Дорогой");
    });

    it('"-" коэффициент ставится в конец (Infinity)', () => {
        const tariffs = [
            makeTariffRow({ warehouse_name: "Нет коэф", box_delivery_coef_expr: "-" }),
            makeTariffRow({ warehouse_name: "Есть коэф", box_delivery_coef_expr: "2" }),
        ];
        const result = formatTariffsForSheet(tariffs);

        expect(result[1][0]).toBe("Есть коэф");
        expect(result[2][0]).toBe("Нет коэф");
    });

    it("нормализует Date объект из PostgreSQL в строку YYYY-MM-DD", () => {
        const tariff = makeTariffRow({
            date: new Date("2026-03-08T00:00:00.000Z") as unknown as string,
        });
        const result = formatTariffsForSheet([tariff]);
        expect(result[1][11]).toBe("2026-03-08");
    });

    it("нормализует ISO timestamp строку в YYYY-MM-DD", () => {
        const tariff = makeTariffRow({
            date: "2026-03-08T00:00:00.000Z" as string,
        });
        const result = formatTariffsForSheet([tariff]);
        expect(result[1][11]).toBe("2026-03-08");
    });

    it("не мутирует исходный массив", () => {
        const tariffs = [
            makeTariffRow({ warehouse_name: "B", box_delivery_coef_expr: "10" }),
            makeTariffRow({ warehouse_name: "A", box_delivery_coef_expr: "1" }),
        ];
        const original = [...tariffs];
        formatTariffsForSheet(tariffs);
        expect(tariffs[0].warehouse_name).toBe(original[0].warehouse_name);
        expect(tariffs[1].warehouse_name).toBe(original[1].warehouse_name);
    });
});

// ── checkAccess ────────────────────────────────────────────

describe("checkAccess", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("не бросает при успешном доступе", async () => {
        mockSheetsGet.mockResolvedValue({ data: { spreadsheetId: "abc" } });
        await expect(checkAccess("abc")).resolves.toBeUndefined();
    });

    it("бросает при 403 (нет доступа)", async () => {
        const err = new Error("Forbidden") as Error & { code: number };
        err.code = 403;
        mockSheetsGet.mockRejectedValue(err);

        await expect(checkAccess("abc")).rejects.toThrow(/нет доступа/i);
    });

    it("бросает при 404 (не найдена)", async () => {
        const err = new Error("Not Found") as Error & { code: number };
        err.code = 404;
        mockSheetsGet.mockRejectedValue(err);

        await expect(checkAccess("abc")).rejects.toThrow(/не найдена/i);
    });

    it("пробрасывает неизвестную ошибку как есть", async () => {
        const err = new Error("Unknown");
        mockSheetsGet.mockRejectedValue(err);

        await expect(checkAccess("abc")).rejects.toThrow("Unknown");
    });
});

// ── updateSpreadsheet ──────────────────────────────────────

describe("updateSpreadsheet", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("пропускает обновление при пустом массиве тарифов", async () => {
        await updateSpreadsheet("test-id", []);
        expect(mockSheetsGet).not.toHaveBeenCalled();
        expect(mockSheetsBatchUpdate).not.toHaveBeenCalled();
    });

    it("отправляет данные в правильном формате (clear → write)", async () => {
        // Лист уже существует, 10 строк
        mockSheetsGet.mockResolvedValue({
            data: {
                sheets: [
                    {
                        properties: {
                            title: "stocks_coefs",
                            sheetId: 42,
                            gridProperties: { rowCount: 10 },
                        },
                    },
                ],
            },
        });
        mockSheetsBatchUpdate.mockResolvedValue({});

        const tariffs = [makeTariffRow({ warehouse_name: "Тест", box_delivery_coef_expr: "3" })];
        await updateSpreadsheet("sheet-123", tariffs);

        expect(mockSheetsBatchUpdate).toHaveBeenCalledOnce();
        const call = mockSheetsBatchUpdate.mock.calls[0][0];

        expect(call.spreadsheetId).toBe("sheet-123");
        const requests = call.requestBody.requests;

        // Первый request — clear (очистка всего листа)
        expect(requests[0]).toEqual({
            updateCells: {
                range: { sheetId: 42 },
                fields: "userEnteredValue",
            },
        });

        // Второй request — запись данных
        expect(requests[1].updateCells.start).toEqual({
            sheetId: 42,
            rowIndex: 0,
            columnIndex: 0,
        });

        const rows = requests[1].updateCells.rows;
        // header + 1 data row = 2 rows
        expect(rows).toHaveLength(2);

        // Проверяем header
        expect(rows[0].values[0].userEnteredValue.stringValue).toBe("Склад");
        expect(rows[0].values[1].userEnteredValue.stringValue).toBe("Регион");

        // Проверяем data row
        expect(rows[1].values[0].userEnteredValue.stringValue).toBe("Тест");
    });

    it("удаляет лишние строки когда старых строк больше", async () => {
        // Лист с 100 строками, пишем 3 (header + 2 data)
        mockSheetsGet.mockResolvedValue({
            data: {
                sheets: [
                    {
                        properties: {
                            title: "stocks_coefs",
                            sheetId: 7,
                            gridProperties: { rowCount: 100 },
                        },
                    },
                ],
            },
        });
        mockSheetsBatchUpdate.mockResolvedValue({});

        const tariffs = [
            makeTariffRow({ warehouse_name: "A" }),
            makeTariffRow({ warehouse_name: "B" }),
        ];
        await updateSpreadsheet("del-test", tariffs);

        const requests = mockSheetsBatchUpdate.mock.calls[0][0].requestBody.requests;

        // 3й request — deleteDimension
        expect(requests).toHaveLength(3);
        expect(requests[2]).toEqual({
            deleteDimension: {
                range: {
                    sheetId: 7,
                    dimension: "ROWS",
                    startIndex: 3,   // header + 2 rows
                    endIndex: 100,
                },
            },
        });
    });

    it("НЕ удаляет строки когда новых строк >= старых", async () => {
        mockSheetsGet.mockResolvedValue({
            data: {
                sheets: [
                    {
                        properties: {
                            title: "stocks_coefs",
                            sheetId: 1,
                            gridProperties: { rowCount: 2 },
                        },
                    },
                ],
            },
        });
        mockSheetsBatchUpdate.mockResolvedValue({});

        const tariffs = [
            makeTariffRow({ warehouse_name: "A" }),
            makeTariffRow({ warehouse_name: "B" }),
        ];
        await updateSpreadsheet("no-del-test", tariffs);

        const requests = mockSheetsBatchUpdate.mock.calls[0][0].requestBody.requests;
        // Только clear + write, без deleteDimension
        expect(requests).toHaveLength(2);
    });

    it("создаёт лист если его нет", async () => {
        // Нет листа stocks_coefs
        mockSheetsGet.mockResolvedValue({
            data: { sheets: [] },
        });
        mockSheetsBatchUpdate
            .mockResolvedValueOnce({
                data: {
                    replies: [{ addSheet: { properties: { sheetId: 99 } } }],
                },
            })
            .mockResolvedValueOnce({});

        const tariffs = [makeTariffRow()];
        await updateSpreadsheet("new-sheet", tariffs);

        // Первый batchUpdate — создание листа
        const createCall = mockSheetsBatchUpdate.mock.calls[0][0];
        expect(createCall.requestBody.requests[0].addSheet.properties.title).toBe("stocks_coefs");

        // Второй batchUpdate — запись данных
        const writeCall = mockSheetsBatchUpdate.mock.calls[1][0];
        expect(writeCall.requestBody.requests[1].updateCells.start.sheetId).toBe(99);
    });

    it("проверяет корректность всех 12 колонок в data row", async () => {
        mockSheetsGet.mockResolvedValue({
            data: {
                sheets: [{
                    properties: {
                        title: "stocks_coefs",
                        sheetId: 1,
                        gridProperties: { rowCount: 0 },
                    },
                }],
            },
        });
        mockSheetsBatchUpdate.mockResolvedValue({});

        const tariff = makeTariffRow();
        await updateSpreadsheet("cols-test", [tariff]);

        const rows = mockSheetsBatchUpdate.mock.calls[0][0].requestBody.requests[1].updateCells.rows;
        const dataRow = rows[1].values.map(
            (v: { userEnteredValue: { stringValue: string } }) => v.userEnteredValue.stringValue,
        );

        expect(dataRow).toEqual([
            "Склад",      // warehouse_name
            "Москва",     // geo_name
            "1",          // box_delivery_coef_expr
            "100",        // box_delivery_base
            "10",         // box_delivery_liter
            "2",          // box_delivery_marketplace_coef_expr
            "50",         // box_delivery_marketplace_base
            "5",          // box_delivery_marketplace_liter
            "0.5",        // box_storage_coef_expr
            "30",         // box_storage_base
            "3",          // box_storage_liter
            "2025-03-01", // date
        ]);
    });
});

// ── updateAllSpreadsheets ──────────────────────────────────

describe("updateAllSpreadsheets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("обрабатывает несколько таблиц, пропуская ошибочные", async () => {
        // checkAccess: первая OK, вторая fail, третья OK
        mockSheetsGet
            .mockResolvedValueOnce({ data: { spreadsheetId: "a" } }) // checkAccess OK
            .mockResolvedValueOnce({                                  // getOrCreateSheet
                data: {
                    sheets: [{
                        properties: { title: "stocks_coefs", sheetId: 1, gridProperties: { rowCount: 0 } },
                    }],
                },
            })
            .mockRejectedValueOnce((() => {                           // checkAccess FAIL
                const e = new Error("Forbidden") as Error & { code: number };
                e.code = 403;
                return e;
            })())
            .mockResolvedValueOnce({ data: { spreadsheetId: "c" } }) // checkAccess OK
            .mockResolvedValueOnce({                                  // getOrCreateSheet
                data: {
                    sheets: [{
                        properties: { title: "stocks_coefs", sheetId: 2, gridProperties: { rowCount: 0 } },
                    }],
                },
            });

        mockSheetsBatchUpdate.mockResolvedValue({});

        const tariffs = [makeTariffRow()];
        await updateAllSpreadsheets(["a", "b", "c"], tariffs);

        // batchUpdate вызван 2 раза (для "a" и "c", "b" пропущена)
        expect(mockSheetsBatchUpdate).toHaveBeenCalledTimes(2);
    });

    it("обрабатывает пустой список таблиц", async () => {
        await updateAllSpreadsheets([], [makeTariffRow()]);
        expect(mockSheetsGet).not.toHaveBeenCalled();
    });
});
