/** Возвращает текущую дату UTC в формате YYYY-MM-DD. */
export function getTodayDateUTC(): string {
    return new Date().toISOString().slice(0, 10);
}
