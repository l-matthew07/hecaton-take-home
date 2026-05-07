export const BUDGET_LIMIT = 160;

let count = 0;

export function increment(): void {
    count++;
}

export function getCount(): number {
    return count;
}

export function isOverBudget(): boolean {
    return count >= BUDGET_LIMIT;
}

export function resetBudget(): void {
    count = 0;
}
