export const BUDGET_LIMIT = 400; //raising budget since detail pages are the whole point of scoring, is still well within free tier limits of 1000/month

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
