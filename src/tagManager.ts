import { App, TFile } from "obsidian";

/**
 * Add (or update) an Ebbinghaus review tag in a note's frontmatter.
 * Tags added: eb-reviewed-N  (N = repetition number, 1-indexed)
 */
export async function markReviewedInFrontmatter(
    app: App,
    file: TFile,
    repetition: number
): Promise<void> {
    const tagValue = `eb-reviewed-${repetition}`;

    await (app.fileManager as any).processFrontMatter(
        file,
        (fm: Record<string, unknown>) => {
            // Handle both string and array tags
            let tags = fm["tags"];
            if (!tags) {
                tags = [];
            } else if (typeof tags === "string") {
                tags = [tags];
            } else if (!Array.isArray(tags)) {
                tags = [];
            }
            const arr = tags as string[];
            if (!arr.includes(tagValue)) {
                arr.push(tagValue);
            }
            fm["tags"] = arr;
        }
    );
}
