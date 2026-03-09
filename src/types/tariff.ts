/** Структура склада из ответа WB API `/api/v1/tariffs/box`. */
export interface WbWarehouseTariff {
    warehouseName: string;
    geoName: string;
    boxDeliveryBase: string;
    boxDeliveryCoefExpr: string;
    boxDeliveryLiter: string;
    boxDeliveryMarketplaceBase: string;
    boxDeliveryMarketplaceCoefExpr: string;
    boxDeliveryMarketplaceLiter: string;
    boxStorageBase: string;
    boxStorageCoefExpr: string;
    boxStorageLiter: string;
}

/** Строка таблицы `tariffs` в PostgreSQL. Ключ уникальности — `(date, warehouse_name)`. */
export interface TariffRow {
    id?: number;
    date: string;
    warehouse_name: string;
    geo_name: string;
    box_delivery_base: string;
    box_delivery_coef_expr: string;
    box_delivery_liter: string;
    box_delivery_marketplace_base: string;
    box_delivery_marketplace_coef_expr: string;
    box_delivery_marketplace_liter: string;
    box_storage_base: string;
    box_storage_coef_expr: string;
    box_storage_liter: string;
    dt_next_box: string;
    dt_till_max: string;
    fetched_at?: Date;
}
