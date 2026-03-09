/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    return knex.schema.createTable("tariffs", (table) => {
        table.increments("id").primary();
        table.date("date").notNullable();
        table.string("warehouse_name", 255).notNullable();
        table.string("geo_name", 255).defaultTo("");
        table.string("box_delivery_base", 50);
        table.string("box_delivery_coef_expr", 50);
        table.string("box_delivery_liter", 50);
        table.string("box_delivery_marketplace_base", 50);
        table.string("box_delivery_marketplace_coef_expr", 50);
        table.string("box_delivery_marketplace_liter", 50);
        table.string("box_storage_base", 50);
        table.string("box_storage_coef_expr", 50);
        table.string("box_storage_liter", 50);
        table.string("dt_next_box", 50);
        table.string("dt_till_max", 50);
        table.timestamp("fetched_at").defaultTo(knex.fn.now());

        table.unique(["date", "warehouse_name"]);
    });
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
    return knex.schema.dropTable("tariffs");
}
