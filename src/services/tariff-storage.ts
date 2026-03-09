import knex from "#postgres/knex.js";
import { getLogger } from "#config/logger.js";
import type { WbWarehouseTariff, TariffRow } from "#types/tariff.js";

const logger = getLogger("tariff-storage");

/**
 * Сохраняет тарифы в PostgreSQL (upsert по `date + warehouse_name`).
 * При конфликте обновляет все поля и сбрасывает `fetched_at`.
 * Бросает ошибку если warehouse list пуст.
 */
export async function saveTariffs(
    date: string,
    warehouseList: WbWarehouseTariff[],
    meta: { dtNextBox: string; dtTillMax: string }
): Promise<void> {
    if (warehouseList.length === 0) {
        throw new Error(`WB API вернул 0 складов за ${date} — возможно ошибка API`);
    }

    const rows: Omit<TariffRow, "id" | "fetched_at">[] = warehouseList.map((w) => ({
        date,
        warehouse_name: w.warehouseName,
        geo_name: w.geoName,
        box_delivery_base: w.boxDeliveryBase,
        box_delivery_coef_expr: w.boxDeliveryCoefExpr,
        box_delivery_liter: w.boxDeliveryLiter,
        box_delivery_marketplace_base: w.boxDeliveryMarketplaceBase,
        box_delivery_marketplace_coef_expr: w.boxDeliveryMarketplaceCoefExpr,
        box_delivery_marketplace_liter: w.boxDeliveryMarketplaceLiter,
        box_storage_base: w.boxStorageBase,
        box_storage_coef_expr: w.boxStorageCoefExpr,
        box_storage_liter: w.boxStorageLiter,
        dt_next_box: meta.dtNextBox,
        dt_till_max: meta.dtTillMax,
    }));

    await knex("tariffs")
        .insert(rows)
        .onConflict(["date", "warehouse_name"])
        .merge({
            geo_name: knex.raw("EXCLUDED.geo_name"),
            box_delivery_base: knex.raw("EXCLUDED.box_delivery_base"),
            box_delivery_coef_expr: knex.raw("EXCLUDED.box_delivery_coef_expr"),
            box_delivery_liter: knex.raw("EXCLUDED.box_delivery_liter"),
            box_delivery_marketplace_base: knex.raw("EXCLUDED.box_delivery_marketplace_base"),
            box_delivery_marketplace_coef_expr: knex.raw("EXCLUDED.box_delivery_marketplace_coef_expr"),
            box_delivery_marketplace_liter: knex.raw("EXCLUDED.box_delivery_marketplace_liter"),
            box_storage_base: knex.raw("EXCLUDED.box_storage_base"),
            box_storage_coef_expr: knex.raw("EXCLUDED.box_storage_coef_expr"),
            box_storage_liter: knex.raw("EXCLUDED.box_storage_liter"),
            dt_next_box: knex.raw("EXCLUDED.dt_next_box"),
            dt_till_max: knex.raw("EXCLUDED.dt_till_max"),
            fetched_at: knex.fn.now(),
        });

    logger.info(`Сохранено ${rows.length} записей тарифов за ${date}`);
}

/** Возвращает все тарифы за указанную дату. */
export async function getLatestTariffs(date: string): Promise<TariffRow[]> {
    return knex("tariffs").where({ date }).select("*");
}
