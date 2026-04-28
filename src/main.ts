import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./CalendarView";
import { DEFAULT_SETTINGS, EbbinghausSettings, EbbinghausSettingTab, reviewKey } from "./settings";
import { scanNotes } from "./noteScanner";
import { toDateKey } from "./ebbinghaus";

export default class EbbinghausPlugin extends Plugin {
    settings: EbbinghausSettings;

    /** Track which MarkdownView instances already have our action button */
    private buttonizedViews = new WeakSet<MarkdownView>();

    async onload(): Promise<void> {
        await this.loadSettings();

        this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

        // Ribbon icon
        this.addRibbonIcon("brain", "打开艾宾浩斯复习日历", () => {
            this.activateView();
        });

        // Commands
        this.addCommand({
            id: "open-review-calendar",
            name: "打开复习日历",
            callback: () => this.activateView(),
        });

        this.addCommand({
            id: "reset-review-date",
            name: "重新规划当前笔记的复习计划（从今天开始）",
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view?.file) {
                    if (!checking) this.resetReviewDate(view.file);
                    return true;
                }
                return false;
            },
        });

        this.addSettingTab(new EbbinghausSettingTab(this.app, this));

        // Add editor action buttons to all open markdown views
        this.app.workspace.onLayoutReady(() => {
            this.addReviewButtonsToAllLeaves();
            if (this.settings.showStartupNotice) this.showTodayNotice();
        });

        // Re-check whenever layout changes (new tabs opened, splits, etc.)
        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                this.addReviewButtonsToAllLeaves();
            })
        );

        // Also catch active-leaf-change for quick response
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                this.addReviewButtonsToAllLeaves();
            })
        );
    }

    onunload(): void {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_CALENDAR);
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (!this.settings.completedReviews) this.settings.completedReviews = {};
        if (!this.settings.neverReview) this.settings.neverReview = {};
        if (!this.settings.pinnedDates) this.settings.pinnedDates = {};
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).forEach((leaf) => {
            (leaf.view as CalendarView).refresh();
        });
    }

    /** Open calendar as a main-area tab */
    async activateView(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
        workspace.revealLeaf(leaf);
    }

    // ─── Add action button to all MarkdownView instances ─────────────

    private addReviewButtonsToAllLeaves(): void {
        this.app.workspace.iterateAllLeaves((leaf) => {
            const view = leaf.view;
            if (view instanceof MarkdownView && !this.buttonizedViews.has(view)) {
                this.buttonizedViews.add(view);
                view.addAction(
                    "refresh-cw",
                    "重置复习计划（从今天重新开始）",
                    () => {
                        if (view.file) this.resetReviewDate(view.file);
                    }
                );
            }
        });
    }

    // ─── Reset review date for a note ────────────────────────────────

    async resetReviewDate(file: TFile): Promise<void> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = toDateKey(today);

        // Pin today as the new baseline date for this note
        this.settings.pinnedDates[file.path] = today.getTime();

        // Clear this note's completed review records so the calendar shows fresh
        const keysToDelete = Object.keys(this.settings.completedReviews).filter((k) =>
            k.startsWith(file.path + "::"),
        );
        keysToDelete.forEach((k) => delete this.settings.completedReviews[k]);

        await this.saveSettings();

        new Notice(
            `📅 《${file.basename}》的复习计划已重置！\n` +
            `从今天 (${todayStr}) 起按艾宾浩斯曲线重新提醒。`,
            6000,
        );
    }

    // ─── Startup notice ───────────────────────────────────────────────

    private showTodayNotice(): void {
        const todayKey = toDateKey(new Date());
        const { records } = scanNotes(this.app, this.settings.intervals, this.settings.pinnedDates);
        let count = 0;
        for (const record of records) {
            for (const rv of record.reviewDates) {
                if (rv.dateKey === todayKey) {
                    const key = reviewKey(record.file.path, rv.repetition);
                    if (!this.settings.completedReviews[key] && !this.settings.neverReview[record.file.path]) {
                        count++;
                    }
                }
            }
        }
        if (count > 0) {
            new Notice(`📅 今天有 ${count} 条笔记需要根据艾宾浩斯曲线复习！`, 6000);
        }
    }
}
