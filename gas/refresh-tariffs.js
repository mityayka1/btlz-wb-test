/**
 * Google Apps Script: кнопка обновления тарифов WB в Google Sheets.
 *
 * Установка:
 * 1. Откройте Google Sheets → Расширения → Apps Script
 * 2. Вставьте этот код
 * 3. Замените SERVER_URL и API_KEY на реальные значения
 * 4. Сохраните и обновите страницу таблицы — появится меню "Тарифы WB"
 */

const SERVER_URL = "http://your-server:5000";
const API_KEY = "your_api_key_here";

function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu("Тарифы WB")
        .addItem("Обновить тарифы", "refreshTariffs")
        .addToUi();
}

function refreshTariffs() {
    const spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
    const ui = SpreadsheetApp.getUi();

    try {
        const response = UrlFetchApp.fetch(
            `${SERVER_URL}/spreadsheets/${spreadsheetId}/export`,
            {
                method: "post",
                headers: { "x-api-key": API_KEY },
                muteHttpExceptions: true,
            },
        );

        const code = response.getResponseCode();
        const body = JSON.parse(response.getContentText());

        if (code === 200) {
            ui.alert("Готово", `Обновлено ${body.count} записей тарифов.`, ui.ButtonSet.OK);
        } else {
            ui.alert("Ошибка", body.error || `HTTP ${code}`, ui.ButtonSet.OK);
        }
    } catch (e) {
        ui.alert("Ошибка", e.message, ui.ButtonSet.OK);
    }
}
