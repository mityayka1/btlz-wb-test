import knex from "#postgres/knex.js";
import { DuplicateError } from "#types/errors.js";

export interface SpreadsheetRow {
    spreadsheet_id: string;
}

export async function getSpreadsheetIds(): Promise<string[]> {
    const rows = await knex("spreadsheets").select("spreadsheet_id");
    return rows.map((r: SpreadsheetRow) => r.spreadsheet_id);
}

export async function getAllSpreadsheets(): Promise<SpreadsheetRow[]> {
    return knex("spreadsheets").select("*");
}

/** Добавляет таблицу. Бросает DuplicateError при дубликате (PG 23505). */
export async function addSpreadsheet(spreadsheetId: string): Promise<SpreadsheetRow> {
    try {
        const [row] = await knex("spreadsheets")
            .insert({ spreadsheet_id: spreadsheetId })
            .returning("*");
        if (!row) {
            throw new Error(`Insert вернул пустой результат для ${spreadsheetId}`);
        }
        return row;
    } catch (error: unknown) {
        if (error instanceof Error && "code" in error && (error as { code: string }).code === "23505") {
            throw new DuplicateError("Таблица уже зарегистрирована");
        }
        throw error;
    }
}

export async function deleteSpreadsheet(spreadsheetId: string): Promise<boolean> {
    const deleted = await knex("spreadsheets").where({ spreadsheet_id: spreadsheetId }).del();
    return deleted > 0;
}
