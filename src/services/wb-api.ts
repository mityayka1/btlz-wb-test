import { z } from "zod";
import env from "#config/env/env.js";
import { getLogger } from "#config/logger.js";
import type { WbWarehouseTariff } from "#types/tariff.js";

const logger = getLogger("wb-api");

const WB_API_BASE = "https://common-api.wildberries.ru";
const REQUEST_TIMEOUT_MS = 30_000;

const wbWarehouseSchema = z.object({
    warehouseName: z.string(),
    geoName: z.string(),
    boxDeliveryBase: z.string(),
    boxDeliveryCoefExpr: z.string(),
    boxDeliveryLiter: z.string(),
    boxDeliveryMarketplaceBase: z.string(),
    boxDeliveryMarketplaceCoefExpr: z.string(),
    boxDeliveryMarketplaceLiter: z.string(),
    boxStorageBase: z.string(),
    boxStorageCoefExpr: z.string(),
    boxStorageLiter: z.string(),
});

const wbResponseSchema = z.object({
    response: z.object({
        data: z.object({
            dtNextBox: z.string(),
            dtTillMax: z.string(),
            warehouseList: z.array(wbWarehouseSchema),
        }),
    }),
});

/**
 * Запрашивает тарифы коробов из WB API за указанную дату.
 * Ответ валидируется через Zod-схему. Timeout — 30 секунд.
 */
export async function fetchBoxTariffs(date: string): Promise<{
    warehouseList: WbWarehouseTariff[];
    dtNextBox: string;
    dtTillMax: string;
}> {
    const url = `${WB_API_BASE}/api/v1/tariffs/box?date=${date}`;

    logger.info(`Запрос тарифов за ${date}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            headers: {
                Authorization: env.WB_API_KEY,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            let errorText: string;
            try {
                errorText = await response.text();
            } catch {
                errorText = "(не удалось прочитать тело ответа)";
            }
            throw new Error(`WB API error ${response.status}: ${errorText}`);
        }

        const json = await response.json();
        const parsed = wbResponseSchema.parse(json);

        const { warehouseList, dtNextBox, dtTillMax } = parsed.response.data;
        logger.info(`Получено ${warehouseList.length} складов`);

        return { warehouseList, dtNextBox, dtTillMax };
    } finally {
        clearTimeout(timeout);
    }
}
