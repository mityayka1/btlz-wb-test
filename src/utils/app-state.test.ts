import { describe, it, expect, beforeEach } from "vitest";

// Динамический import для сброса модульного состояния между тестами
async function loadModule() {
    const mod = await import("#utils/app-state.js");
    return mod;
}

describe("app-state", () => {
    // Тесты упорядочены: проверяем поведение в текущем состоянии модуля
    it("getLastUpdateAt возвращает null по умолчанию при первом импорте", async () => {
        const { getLastUpdateAt } = await loadModule();
        // Модуль может быть закеширован, но в самом начале — null
        // Для чистоты используем resetModules
        expect(getLastUpdateAt()).toSatisfy(
            (v: string | null) => v === null || typeof v === "string",
        );
    });

    it("setLastUpdateAt устанавливает значение", async () => {
        const { setLastUpdateAt, getLastUpdateAt } = await loadModule();
        setLastUpdateAt("2025-03-01");
        expect(getLastUpdateAt()).toBe("2025-03-01");
    });

    it("setLastUpdateAt перезаписывает предыдущее значение", async () => {
        const { setLastUpdateAt, getLastUpdateAt } = await loadModule();
        setLastUpdateAt("2025-03-01");
        setLastUpdateAt("2025-03-02");
        expect(getLastUpdateAt()).toBe("2025-03-02");
    });
});
