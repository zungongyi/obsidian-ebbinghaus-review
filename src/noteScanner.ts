import { App, TFile } from "obsidian";
import { getReviewDates, toDateKey } from "./ebbinghaus";

export interface NoteRecord {
    file: TFile;
    /**
     * Frozen baseline date for review scheduling.
     * Source: pinnedDates[file.path] (set once from file.stat.mtime on first scan,
     * then never changed by ordinary edits — only by the user's "Reset" action).
     */
    baseDate: Date;
    /** date key → repetition index (1-based) */
    reviewDates: { dateKey: string; repetition: number; date: Date }[];
}

/**
 * Scan all markdown files and build NoteRecord array.
 *
 * Baseline date logic:
 *   - If pinnedDates[file.path] is set → use that timestamp (frozen).
 *   - Otherwise → use file.stat.mtime, store it in pinnedDates, and set newPinsAdded = true
 *     so the caller knows to persist the updated pinnedDates.
 *
 * @param pinnedDates  Mutable map from the plugin settings (will be mutated for new notes).
 * @returns            { records, newPinsAdded }
 */
export function scanNotes(
    app: App,
    intervals: number[],
    pinnedDates: Record<string, number>,
): { records: NoteRecord[]; newPinsAdded: boolean } {
    let newPinsAdded = false;
    const files = app.vault.getMarkdownFiles();

    const records: NoteRecord[] = files.map((file) => {
        let baseTs: number;

        if (pinnedDates[file.path] !== undefined) {
            // Already pinned — use stored date (ignores any subsequent edits)
            baseTs = pinnedDates[file.path];
        } else {
            // First encounter — pin the current mtime
            baseTs = file.stat.mtime;
            pinnedDates[file.path] = baseTs;
            newPinsAdded = true;
        }

        const baseDate = new Date(baseTs);
        baseDate.setHours(0, 0, 0, 0);

        const reviewDates = getReviewDates(baseDate, intervals).map((date, idx) => ({
            dateKey: toDateKey(date),
            repetition: idx + 1,
            date,
        }));

        return { file, baseDate, reviewDates };
    });

    return { records, newPinsAdded };
}

/**
 * Build two lookup maps from a list of NoteRecords:
 * - createdMap: dateKey → NoteRecord[]  (notes whose baseline date is that day)
 * - reviewMap:  dateKey → { record, repetition }[]  (reviews due on that day)
 */
export function buildDayMaps(records: NoteRecord[]): {
    createdMap: Map<string, NoteRecord[]>;
    reviewMap: Map<string, { record: NoteRecord; repetition: number }[]>;
} {
    const createdMap = new Map<string, NoteRecord[]>();
    const reviewMap = new Map<
        string,
        { record: NoteRecord; repetition: number }[]
    >();

    for (const record of records) {
        const ck = toDateKey(record.baseDate);
        if (!createdMap.has(ck)) createdMap.set(ck, []);
        createdMap.get(ck)!.push(record);

        for (const rv of record.reviewDates) {
            if (!reviewMap.has(rv.dateKey)) reviewMap.set(rv.dateKey, []);
            reviewMap.get(rv.dateKey)!.push({
                record,
                repetition: rv.repetition,
            });
        }
    }

    return { createdMap, reviewMap };
}
