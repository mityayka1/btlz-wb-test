import { google } from "googleapis";
import { getLogger } from "#config/logger.js";
import env from "#config/env/env.js";
import { withRetry } from "#utils/with-retry.js";
import { AccessDeniedError, NotFoundError } from "#types/errors.js";
import type { TariffRow } from "#types/tariff.js";

const logger = getLogger("google-sheets");

const SHEET_NAME = "stocks_coefs";
const SHEETS_CONCURRENCY = 5;

const auth = new google.auth.GoogleAuth({
    keyFile: env.GOOGLE_SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

/** Проверяет, что сервисный аккаунт имеет доступ к таблице. Бросает типизированную ошибку при 403/404. */
export async function checkAccess(spreadsheetId: string): Promise<void> {
    const sheets = google.sheets({ version: "v4", auth });
    try {
        await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" });
    } catch (error: unknown) {
        if (error instanceof Error && "code" in error) {
            const code = (error as { code: number }).code;
            if (code === 403) {
                throw new AccessDeniedError(`Нет доступа к таблице ${spreadsheetId}. Предоставьте доступ сервисному аккаунту.`);
            }
            if (code === 404) {
                throw new NotFoundError(`Таблица ${spreadsheetId} не найдена. Проверьте ID.`);
            }
        }
        throw error;
    }
}

/** Парсит коэффициент из WB-формата: поддерживает запятую как разделитель, «-» → Infinity. */
export function parseCoef(value: string): number {
    if (!value || value === "-") return Infinity;
    const n = parseFloat(value.replace(/,/g, "."));
    if (Number.isNaN(n)) {
        logger.warn(`Нераспознанное значение коэффициента: "${value}", обработано как Infinity`);
        return Infinity;
    }
    return n;
}

/** Нормализует дату в формат YYYY-MM-DD. Обрабатывает как Date-объекты из pg, так и ISO-строки. */
function normalizeDate(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const s = String(value ?? "");
    if (!s || s === "undefined" || s === "null") {
        logger.warn(`normalizeDate получил некорректное значение: ${JSON.stringify(value)}`);
        return "";
    }
    return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Форматирует тарифы в двумерный массив для Google Sheets (headers + rows, сортировка по коэффициенту). */
export function formatTariffsForSheet(tariffs: TariffRow[]): string[][] {
    const headers = [
        "Склад",
        "Регион",
        "Коэф. доставки",
        "База доставки",
        "Литр доставки",
        "Коэф. МП доставки",
        "База МП доставки",
        "Литр МП доставки",
        "Коэф. хранения",
        "База хранения",
        "Литр хранения",
        "Дата",
    ];

    // Schwartzian transform: pre-compute sort key, avoid redundant parseCoef calls
    const sorted = [...tariffs]
        .map((t) => ({ t, key: parseCoef(t.box_delivery_coef_expr) }))
        .sort((a, b) => a.key - b.key)
        .map(({ t }) => t);

    const rows = sorted.map((t) => [
        t.warehouse_name,
        t.geo_name,
        t.box_delivery_coef_expr,
        t.box_delivery_base,
        t.box_delivery_liter,
        t.box_delivery_marketplace_coef_expr,
        t.box_delivery_marketplace_base,
        t.box_delivery_marketplace_liter,
        t.box_storage_coef_expr,
        t.box_storage_base,
        t.box_storage_liter,
        normalizeDate(t.date),
    ]);

    return [headers, ...rows];
}

type SheetRowData = {
    values: { userEnteredValue: { stringValue: string } }[];
};

export function toSheetRows(data: string[][]): SheetRowData[] {
    return data.map((row) => ({
        values: row.map((cell) => ({
            userEnteredValue: { stringValue: String(cell ?? "") },
        })),
    }));
}

async function getOrCreateSheet(
    sheets: ReturnType<typeof google.sheets>,
    spreadsheetId: string
): Promise<{ sheetId: number; rowCount: number }> {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = res.data.sheets?.find((s) => s.properties?.title === SHEET_NAME);

    if (existing) {
        const sheetId = existing.properties?.sheetId;
        if (sheetId == null) {
            throw new Error(`Лист "${SHEET_NAME}" найден в ${spreadsheetId}, но не содержит sheetId`);
        }
        return {
            sheetId,
            rowCount: existing.properties?.gridProperties?.rowCount ?? 0,
        };
    }

    const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
    });

    const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId == null) {
        throw new Error(`Не удалось получить sheetId после создания листа "${SHEET_NAME}" в ${spreadsheetId}`);
    }
    logger.info(`Создан лист "${SHEET_NAME}" в таблице ${spreadsheetId}`);

    return { sheetId: newSheetId, rowCount: 0 };
}

/** Обновляет лист `stocks_coefs` в указанной Google-таблице: очищает, записывает данные, удаляет лишние строки. */
export async function updateSpreadsheet(spreadsheetId: string, tariffs: TariffRow[]): Promise<void> {
    if (tariffs.length === 0) {
        logger.warn(`Пропуск обновления таблицы ${spreadsheetId}: нет данных`);
        return;
    }

    const sheets = google.sheets({ version: "v4", auth });
    const { sheetId, rowCount: oldRowCount } = await getOrCreateSheet(sheets, spreadsheetId);

    const data = formatTariffsForSheet(tariffs);
    const newRowCount = data.length;

    const requests: object[] = [
        {
            updateCells: {
                range: { sheetId },
                fields: "userEnteredValue",
            },
        },
        {
            updateCells: {
                start: { sheetId, rowIndex: 0, columnIndex: 0 },
                rows: toSheetRows(data),
                fields: "userEnteredValue",
            },
        },
    ];

    if (oldRowCount > newRowCount) {
        requests.push({
            deleteDimension: {
                range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: newRowCount,
                    endIndex: oldRowCount,
                },
            },
        });
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
    });

    logger.info(`Обновлена таблица ${spreadsheetId}: ${tariffs.length} записей`);
}

export interface SyncResult {
    succeeded: string[];
    failed: { id: string; error: string }[];
}

/**
 * Параллельно обновляет все зарегистрированные таблицы (до SHEETS_CONCURRENCY одновременно).
 * Ошибка в одной не блокирует остальные. Бросает ошибку при полном провале.
 */
export async function updateAllSpreadsheets(spreadsheetIds: string[], tariffs: TariffRow[]): Promise<SyncResult> {
    const result: SyncResult = { succeeded: [], failed: [] };

    // Простой concurrency limiter без внешней зависимости
    const queue = [...spreadsheetIds];
    const executing = new Set<Promise<void>>();

    const process = async (id: string) => {
        try {
            await withRetry(() => updateSpreadsheet(id, tariffs));
            result.succeeded.push(id);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Не удалось обновить таблицу ${id}: ${msg}`);
            result.failed.push({ id, error: msg });
        }
    };

    for (const id of queue) {
        const p = process(id).then(() => { executing.delete(p); });
        executing.add(p);
        if (executing.size >= SHEETS_CONCURRENCY) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    if (result.failed.length > 0) {
        logger.error(`Не удалось обновить ${result.failed.length} из ${spreadsheetIds.length} таблиц`);
    }
    if (result.succeeded.length === 0 && spreadsheetIds.length > 0) {
        throw new Error(`Все ${spreadsheetIds.length} таблиц не удалось обновить`);
    }

    return result;
}
