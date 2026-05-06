export const BUDGET_LIMIT = 120;

let count = 0;

export function increment(): void {
    count++;
}

export function getCount(): number {
    return count;
}
