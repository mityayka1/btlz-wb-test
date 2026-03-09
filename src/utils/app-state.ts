let lastUpdateAt: string | null = null;
let consecutiveFailures = 0;
let lastError: string | null = null;

export function setLastUpdateAt(date: string): void {
    lastUpdateAt = date;
    consecutiveFailures = 0;
    lastError = null;
}

export function getLastUpdateAt(): string | null {
    return lastUpdateAt;
}

export function recordUpdateFailure(error: unknown): void {
    consecutiveFailures++;
    lastError = error instanceof Error ? error.message : String(error);
}

export function getUpdateHealth(): { consecutiveFailures: number; lastError: string | null } {
    return { consecutiveFailures, lastError };
}
