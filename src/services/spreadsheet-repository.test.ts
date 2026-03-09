import { describe, it, expect, vi, beforeEach } from "vitest";
import { DuplicateError } from "#types/errors.js";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockReturning = vi.fn();
const mockDel = vi.fn();
const mockWhere = vi.fn();

vi.mock("#postgres/knex.js", () => ({
    default: vi.fn((table: string) => {
        if (table === "spreadsheets") {
            return {
                select: mockSelect,
                insert: mockInsert,
                where: mockWhere,
            };
        }
        return {};
    }),
}));

vi.mock("#config/logger.js", () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }),
}));

import { getSpreadsheetIds, getAllSpreadsheets, addSpreadsheet, deleteSpreadsheet } from "#services/spreadsheet-repository.js";

describe("spreadsheet-repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInsert.mockReturnValue({ returning: mockReturning });
        mockWhere.mockReturnValue({ del: mockDel });
    });

    describe("getSpreadsheetIds", () => {
        it("возвращает массив ID таблиц", async () => {
            mockSelect.mockResolvedValue([
                { spreadsheet_id: "id1" },
                { spreadsheet_id: "id2" },
            ]);

            const ids = await getSpreadsheetIds();

            expect(ids).toEqual(["id1", "id2"]);
            expect(mockSelect).toHaveBeenCalledWith("spreadsheet_id");
        });

        it("возвращает пустой массив при отсутствии таблиц", async () => {
            mockSelect.mockResolvedValue([]);

            const ids = await getSpreadsheetIds();

            expect(ids).toEqual([]);
        });
    });

    describe("getAllSpreadsheets", () => {
        it("возвращает все строки", async () => {
            const rows = [{ spreadsheet_id: "id1" }, { spreadsheet_id: "id2" }];
            mockSelect.mockResolvedValue(rows);

            const result = await getAllSpreadsheets();

            expect(result).toEqual(rows);
            expect(mockSelect).toHaveBeenCalledWith("*");
        });
    });

    describe("addSpreadsheet", () => {
        it("возвращает добавленную строку", async () => {
            const row = { spreadsheet_id: "new-id" };
            mockReturning.mockResolvedValue([row]);

            const result = await addSpreadsheet("new-id");

            expect(result).toEqual(row);
            expect(mockInsert).toHaveBeenCalledWith({ spreadsheet_id: "new-id" });
            expect(mockReturning).toHaveBeenCalledWith("*");
        });

        it("бросает DuplicateError при PG коде 23505", async () => {
            const pgError = new Error("duplicate key") as Error & { code: string };
            pgError.code = "23505";
            mockReturning.mockRejectedValue(pgError);

            await expect(addSpreadsheet("dup-id")).rejects.toThrow(DuplicateError);
            await expect(addSpreadsheet("dup-id")).rejects.toThrow(/зарегистрирована/i);
        });

        it("пробрасывает прочие ошибки как есть", async () => {
            mockReturning.mockRejectedValue(new Error("connection lost"));

            await expect(addSpreadsheet("id")).rejects.toThrow("connection lost");
        });

        it("бросает при пустом результате insert", async () => {
            mockReturning.mockResolvedValue([]);

            await expect(addSpreadsheet("id")).rejects.toThrow(/пустой результат/i);
        });
    });

    describe("deleteSpreadsheet", () => {
        it("возвращает true при успешном удалении", async () => {
            mockDel.mockResolvedValue(1);

            const result = await deleteSpreadsheet("id");

            expect(result).toBe(true);
            expect(mockWhere).toHaveBeenCalledWith({ spreadsheet_id: "id" });
        });

        it("возвращает false если запись не найдена", async () => {
            mockDel.mockResolvedValue(0);

            const result = await deleteSpreadsheet("nonexistent");

            expect(result).toBe(false);
        });
    });
});
