/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function seed(knex) {
    await knex("spreadsheets")
        .insert([{ spreadsheet_id: "1xmaG0vEVHdjTWE_7zcyLvyELdHqIZZMLD9yk6BZpiWw" }])
        .onConflict(["spreadsheet_id"])
        .ignore();
}
