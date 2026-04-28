// Ebbinghaus Forgetting Curve review intervals (in days)
export const DEFAULT_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120];

/**
 * Given the last modified time of a note, compute all upcoming review dates.
 */
export function getReviewDates(mtime: Date, intervals: number[]): Date[] {
    return intervals.map((days) => {
        const d = new Date(mtime);
        d.setDate(d.getDate() + days);
        d.setHours(0, 0, 0, 0);
        return d;
    });
}

/**
 * Return a date-keyed string (YYYY-MM-DD) for easy lookup.
 */
export function toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * Check if a review is overdue (review date < today, not yet done).
 */
export function isOverdue(reviewDate: Date, today: Date): boolean {
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);
    return reviewDate < t;
}

/**
 * Given a date, return which repetition index this is (1-based),
 * or -1 if not found in the intervals.
 */
export function getRepetitionLabel(
    mtime: Date,
    reviewDate: Date,
    intervals: number[]
): number {
    const key = toDateKey(reviewDate);
    const dates = getReviewDates(mtime, intervals);
    const idx = dates.findIndex((d) => toDateKey(d) === key);
    return idx >= 0 ? idx + 1 : -1;
}
