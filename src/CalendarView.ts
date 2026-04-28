import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type EbbinghausPlugin from "./main";
import { NoteRecord, buildDayMaps, scanNotes } from "./noteScanner";
import { toDateKey, isOverdue } from "./ebbinghaus";
import { reviewKey } from "./settings";
import { markReviewedInFrontmatter } from "./tagManager";

export const VIEW_TYPE_CALENDAR = "ebbinghaus-calendar-view";

type ViewMode = "month" | "week" | "day";

const WEEKDAYS_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_FULL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTH_NAMES = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
];

interface SelectedNoteItem {
    path: string;
    type: "created" | "review";
    repetition?: number;
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function startOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date: Date, n: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

export class CalendarView extends ItemView {
    plugin: EbbinghausPlugin;

    // Navigation state — everything derives from currentDate
    private currentDate: Date;
    private viewMode: ViewMode = "month";

    private createdMap: Map<string, NoteRecord[]> = new Map();
    private reviewMap: Map<string, { record: NoteRecord; repetition: number }[]> = new Map();

    // Drag-select state
    private selectionPopup: HTMLElement | null = null;
    private gridEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: EbbinghausPlugin) {
        super(leaf);
        this.plugin = plugin;
        const now = new Date();
        this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    getViewType(): string { return VIEW_TYPE_CALENDAR; }
    getDisplayText(): string { return "艾宾浩斯复习日历"; }
    getIcon(): string { return "brain"; }

    async onOpen(): Promise<void> {
        this.rebuildMaps();
        this.render();
        this.registerEvent(this.app.vault.on("modify", () => { this.rebuildMaps(); this.render(); }));
        this.registerEvent(this.app.vault.on("create", () => { this.rebuildMaps(); this.render(); }));
        this.registerEvent(this.app.vault.on("delete", () => { this.rebuildMaps(); this.render(); }));
        this.registerEvent(this.app.vault.on("rename", () => { this.rebuildMaps(); this.render(); }));
    }

    async onClose(): Promise<void> { this.clearSelectionPopup(); }

    private rebuildMaps(): void {
        const { records, newPinsAdded } = scanNotes(
            this.app,
            this.plugin.settings.intervals,
            this.plugin.settings.pinnedDates,
        );
        if (newPinsAdded) {
            // Persist newly pinned dates in the background.
            // saveSettings() will call refresh() again, but the second scan
            // finds all notes already pinned → newPinsAdded = false → no loop.
            this.plugin.saveSettings().catch(() => {});
        }
        const { createdMap, reviewMap } = buildDayMaps(records);
        this.createdMap = createdMap;
        this.reviewMap = reviewMap;
    }

    public refresh(): void { this.rebuildMaps(); this.render(); }

    // ─── Navigation helpers ───────────────────────────────────────────

    private navigate(dir: -1 | 1): void {
        if (this.viewMode === "day") {
            this.currentDate = addDays(this.currentDate, dir);
        } else if (this.viewMode === "week") {
            this.currentDate = addDays(this.currentDate, dir * 7);
        } else {
            // month: move to same day in prev/next month
            const d = new Date(this.currentDate);
            d.setMonth(d.getMonth() + dir);
            this.currentDate = d;
        }
        this.render();
    }

    private goToToday(): void {
        const now = new Date();
        this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this.render();
    }

    private navLabel(): string {
        const d = this.currentDate;
        if (this.viewMode === "day") {
            return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_FULL[d.getDay()]}`;
        } else if (this.viewMode === "week") {
            const ws = startOfWeek(d);
            const we = addDays(ws, 6);
            const sameMonth = ws.getMonth() === we.getMonth();
            if (sameMonth) {
                return `${ws.getFullYear()}年${ws.getMonth() + 1}月 ${ws.getDate()}–${we.getDate()}日`;
            }
            return `${ws.getMonth() + 1}月${ws.getDate()}日 – ${we.getMonth() + 1}月${we.getDate()}日`;
        } else {
            return `${d.getFullYear()}年 ${MONTH_NAMES[d.getMonth()]}`;
        }
    }

    // ─── Main Render ──────────────────────────────────────────────────

    private render(): void {
        this.clearSelectionPopup();
        const root = this.contentEl;
        root.empty();
        root.addClass("eb-main-root");

        this.renderHeader(root);

        if (this.viewMode === "day") {
            const container = root.createDiv({ cls: "eb-day-view" });
            this.gridEl = container;
            this.renderDayView(container);
            this.setupDragSelect(container);
        } else {
            this.renderWeekdayBar(root);
            const extraCls = this.viewMode === "week" ? "eb-cal-grid eb-cal-grid-week" : "eb-cal-grid";
            const grid = root.createDiv({ cls: extraCls });
            this.gridEl = grid;
            if (this.viewMode === "month") {
                this.renderMonthGrid(grid);
            } else {
                this.renderWeekGrid(grid);
            }
            this.setupDragSelect(grid);
        }

        this.renderLegend(root);
    }

    // ─── Header ───────────────────────────────────────────────────────

    private renderHeader(parent: HTMLElement): void {
        const header = parent.createDiv({ cls: "eb-main-header" });

        // Left: prev button
        const navLeft = header.createDiv({ cls: "eb-nav-group" });
        navLeft.createEl("button", { cls: "eb-btn eb-btn-nav", text: "◀" })
            .addEventListener("click", () => this.navigate(-1));

        // Center: title + view toggle
        const center = header.createDiv({ cls: "eb-header-center" });

        const titleBlock = center.createDiv({ cls: "eb-header-title" });
        titleBlock.createEl("h2", { cls: "eb-header-month", text: this.navLabel() });

        // Today pending badge
        const todayKey = toDateKey(new Date());
        const todayReviews = this.reviewMap.get(todayKey) ?? [];
        const pending = todayReviews.filter(
            (r) =>
                !this.plugin.settings.completedReviews[reviewKey(r.record.file.path, r.repetition)] &&
                !this.plugin.settings.neverReview[r.record.file.path]
        );
        if (pending.length > 0) {
            titleBlock.createEl("span", { cls: "eb-today-badge", text: `今日待复习 ${pending.length} 篇` });
        }

        // View mode toggle
        const toggle = center.createDiv({ cls: "eb-view-toggle" });
        (["day", "week", "month"] as ViewMode[]).forEach((mode) => {
            const labels: Record<ViewMode, string> = { day: "日", week: "周", month: "月" };
            const btn = toggle.createEl("button", {
                cls: `eb-toggle-btn ${this.viewMode === mode ? "eb-toggle-btn-active" : ""}`,
                text: labels[mode],
            });
            btn.addEventListener("click", () => {
                this.viewMode = mode;
                this.render();
            });
        });

        // Right: today + next
        const navRight = header.createDiv({ cls: "eb-nav-group" });
        navRight.createEl("button", { cls: "eb-btn eb-btn-today", text: "今天" })
            .addEventListener("click", () => this.goToToday());
        navRight.createEl("button", { cls: "eb-btn eb-btn-nav", text: "▶" })
            .addEventListener("click", () => this.navigate(1));
    }

    // ─── Weekday Bar ──────────────────────────────────────────────────

    private renderWeekdayBar(parent: HTMLElement): void {
        const bar = parent.createDiv({ cls: "eb-weekday-bar" });
        WEEKDAYS_SHORT.forEach((d) => bar.createDiv({ cls: "eb-weekday-label", text: `周${d}` }));
    }

    // ─── Month Grid ───────────────────────────────────────────────────

    private renderMonthGrid(grid: HTMLElement): void {
        const today = new Date();
        const todayKey = toDateKey(today);
        const y = this.currentDate.getFullYear();
        const m = this.currentDate.getMonth();

        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const startOffset = firstDay.getDay();

        for (let i = 0; i < startOffset; i++) grid.createDiv({ cls: "eb-cell eb-cell-filler" });

        for (let d = 1; d <= lastDay.getDate(); d++) {
            const date = new Date(y, m, d);
            const dateKey = toDateKey(date);
            const cell = this.renderCell(grid, dateKey, d, dateKey === todayKey, today, "month");
            // Click day number → go to day view
            cell.querySelector(".eb-cell-date-num")?.addEventListener("click", () => {
                this.currentDate = date;
                this.viewMode = "day";
                this.render();
            });
        }

        const total = startOffset + lastDay.getDate();
        const rem = total % 7;
        if (rem !== 0) for (let i = 0; i < 7 - rem; i++) grid.createDiv({ cls: "eb-cell eb-cell-filler" });
    }

    // ─── Week Grid ────────────────────────────────────────────────────

    private renderWeekGrid(grid: HTMLElement): void {
        const today = new Date();
        const todayKey = toDateKey(today);
        const ws = startOfWeek(this.currentDate);

        for (let i = 0; i < 7; i++) {
            const date = addDays(ws, i);
            const dateKey = toDateKey(date);
            const cell = this.renderCell(grid, dateKey, date.getDate(), dateKey === todayKey, today, "week");
            cell.querySelector(".eb-cell-date-num")?.addEventListener("click", () => {
                this.currentDate = date;
                this.viewMode = "day";
                this.render();
            });
        }
    }

    // ─── Day View ────────────────────────────────────────────────────

    private renderDayView(container: HTMLElement): void {
        const today = new Date();
        const dateKey = toDateKey(this.currentDate);

        // Modified notes
        const created = this.createdMap.get(dateKey) ?? [];
        const modSection = container.createDiv({ cls: "eb-day-section" });
        modSection.createEl("h3", {
            cls: "eb-day-section-title eb-day-section-title-mod",
            text: `📝 当日修改的笔记（${created.length}）`,
        });
        if (created.length === 0) {
            modSection.createEl("p", { cls: "eb-empty-hint", text: "当天没有修改笔记" });
        } else {
            created.forEach(({ file }) => {
                const item = modSection.createDiv({ cls: "eb-day-note-item eb-day-note-created" });
                item.dataset.notePath = file.path;
                item.dataset.noteType = "created";
                const link = item.createEl("a", { cls: "eb-day-note-link", text: file.basename });
                link.title = file.path;
                link.addEventListener("click", () => this.openFile(file));

                const actions = item.createDiv({ cls: "eb-day-note-actions" });
                const neverBtn = actions.createEl("button", { cls: "eb-never-btn", text: "✗ 永不复习" });
                neverBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.neverReviewSingle(file);
                });
            });
        }

        // Review notes
        const reviews = (this.reviewMap.get(dateKey) ?? []).filter(
            (r) =>
                !this.plugin.settings.completedReviews[reviewKey(r.record.file.path, r.repetition)] &&
                !this.plugin.settings.neverReview[r.record.file.path]
        );
        const rvSection = container.createDiv({ cls: "eb-day-section" });
        rvSection.createEl("h3", {
            cls: "eb-day-section-title eb-day-section-title-review",
            text: `🔔 待复习笔记（${reviews.length}）`,
        });
        if (reviews.length === 0) {
            rvSection.createEl("p", { cls: "eb-empty-hint", text: "当天没有复习任务 🎉" });
        } else {
            reviews.forEach(({ record, repetition }) => {
                const reviewDate = record.reviewDates.find((rv) => rv.repetition === repetition)!.date;
                const overdue = isOverdue(reviewDate, today);

                const item = rvSection.createDiv({
                    cls: `eb-day-note-item eb-day-note-review eb-rep-item-${repetition} ${overdue ? "eb-day-note-overdue" : ""}`,
                });
                item.dataset.notePath = record.file.path;
                item.dataset.noteType = "review";
                item.dataset.repetition = String(repetition);

                item.createEl("span", {
                    cls: `eb-rep-badge eb-rep-${repetition} ${overdue ? "eb-rep-overdue" : ""}`,
                    text: `第${repetition}次`,
                });

                const link = item.createEl("a", { cls: "eb-day-note-link eb-review-link", text: record.file.basename });
                link.title = `点击打开并完成第${repetition}次复习`;
                link.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    this.openFile(record.file);
                    await this.completeReview(record.file, repetition, item);
                });

                if (overdue) {
                    item.createEl("span", { cls: "eb-overdue-label", text: "逾期" });
                }

                const actions = item.createDiv({ cls: "eb-day-note-actions" });

                const doneBtn = actions.createEl("button", { cls: "eb-done-btn", text: "✓ 完成复习" });
                doneBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.completeReview(record.file, repetition, item);
                });

                const neverBtn = actions.createEl("button", { cls: "eb-never-btn", text: "✗ 永不复习" });
                neverBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.neverReviewSingle(record.file);
                });
            });
        }
    }

    // ─── Shared Cell (Month + Week) ───────────────────────────────────

    private renderCell(
        parent: HTMLElement,
        dateKey: string,
        dayNum: number,
        isToday: boolean,
        today: Date,
        mode: "month" | "week",
    ): HTMLElement {
        const cell = parent.createDiv({ cls: "eb-cell" });
        if (isToday) cell.addClass("eb-cell-today");

        const dateRow = cell.createDiv({ cls: "eb-cell-date-row" });
        dateRow.createDiv({
            cls: `eb-cell-date-num ${isToday ? "eb-date-today" : ""}`,
            text: String(dayNum),
        });

        const limit = mode === "week" ? 20 : 10;
        const rvLimit = mode === "week" ? 12 : 8;

        // Created notes
        const created = this.createdMap.get(dateKey) ?? [];
        if (created.length > 0) {
            const section = cell.createDiv({ cls: "eb-cell-section" });
            created.slice(0, limit).forEach(({ file }) => {
                const item = section.createDiv({ cls: "eb-cell-note eb-note-created" });
                item.dataset.notePath = file.path;
                item.dataset.noteType = "created";
                const link = item.createEl("a", { cls: "eb-note-name", text: file.basename });
                link.addEventListener("click", (e) => { e.stopPropagation(); this.openFile(file); });
            });
            if (created.length > limit) {
                section.createDiv({ cls: "eb-cell-more", text: `还有 ${created.length - limit} 条…` });
            }
        }

        // Review notes
        const reviews = (this.reviewMap.get(dateKey) ?? []).filter(
            (r) =>
                !this.plugin.settings.completedReviews[reviewKey(r.record.file.path, r.repetition)] &&
                !this.plugin.settings.neverReview[r.record.file.path]
        );

        if (reviews.length > 0) {
            if (created.length > 0) cell.createDiv({ cls: "eb-cell-divider" });
            const section = cell.createDiv({ cls: "eb-cell-section" });

            reviews.slice(0, rvLimit).forEach(({ record, repetition }) => {
                const reviewDate = record.reviewDates.find((rv) => rv.repetition === repetition)!.date;
                const overdue = isOverdue(reviewDate, today);

                const item = section.createDiv({
                    cls: `eb-cell-note eb-note-review eb-rep-item-${repetition} ${overdue ? "eb-note-overdue" : ""}`,
                });
                item.dataset.notePath = record.file.path;
                item.dataset.noteType = "review";
                item.dataset.repetition = String(repetition);

                item.createEl("span", {
                    cls: `eb-rep-badge eb-rep-${repetition} ${overdue ? "eb-rep-overdue" : ""}`,
                    text: `第${repetition}次`,
                });

                const link = item.createEl("a", { cls: "eb-note-name eb-review-link", text: record.file.basename });
                link.title = `点击打开并完成第${repetition}次复习`;
                link.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    this.openFile(record.file);
                    await this.completeReview(record.file, repetition, item);
                });

                // ✓ Complete button
                const doneBtn = item.createEl("button", { cls: "eb-done-btn", text: "✓" });
                doneBtn.title = `第${repetition}次复习完成`;
                doneBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.completeReview(record.file, repetition, item);
                });

                // ✗ Never button (individual, per-item)
                const neverBtn = item.createEl("button", { cls: "eb-never-btn eb-never-btn-sm", text: "✗" });
                neverBtn.title = "永不复习此笔记";
                neverBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.neverReviewSingle(record.file);
                });
            });

            if (reviews.length > rvLimit) {
                section.createDiv({ cls: "eb-cell-more", text: `还有 ${reviews.length - rvLimit} 条待复习…` });
            }
        }

        return cell;
    }

    // ─── Drag Select ──────────────────────────────────────────────────

    private setupDragSelect(gridEl: HTMLElement): void {
        let startX = 0, startY = 0;
        let isDragging = false;
        let overlayEl: HTMLElement | null = null;
        let rectEl: HTMLElement | null = null;

        const updateRect = (cx: number, cy: number) => {
            if (!rectEl) return;
            rectEl.style.left = `${Math.min(cx, startX)}px`;
            rectEl.style.top = `${Math.min(cy, startY)}px`;
            rectEl.style.width = `${Math.abs(cx - startX)}px`;
            rectEl.style.height = `${Math.abs(cy - startY)}px`;
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest("button, a")) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            this.clearSelectionPopup();
            this.clearNoteHighlights(gridEl);

            overlayEl = document.body.createDiv({ cls: "eb-drag-overlay" });
            rectEl = document.body.createDiv({ cls: "eb-select-rect" });
            updateRect(e.clientX, e.clientY);

            const onMove = (me: MouseEvent) => { if (isDragging) updateRect(me.clientX, me.clientY); };
            const onUp = (me: MouseEvent) => {
                if (!isDragging) return;
                isDragging = false;

                const selRect = rectEl!.getBoundingClientRect();
                overlayEl!.remove();
                rectEl!.remove();
                overlayEl = null;
                rectEl = null;

                if (selRect.width < 5 && selRect.height < 5) return;

                const noteEls = gridEl.querySelectorAll<HTMLElement>(".eb-cell-note[data-note-path], .eb-day-note-item[data-note-path]");
                const selected: SelectedNoteItem[] = [];
                noteEls.forEach((el) => {
                    if (rectsIntersect(selRect, el.getBoundingClientRect())) {
                        el.classList.add("eb-note-selected");
                        const { notePath, noteType, repetition } = el.dataset;
                        if (notePath) {
                            selected.push({
                                path: notePath,
                                type: (noteType ?? "created") as "created" | "review",
                                repetition: repetition ? parseInt(repetition) : undefined,
                            });
                        }
                    }
                });

                if (selected.length > 0) {
                    this.showSelectionPopup(me.clientX, me.clientY, selected, gridEl);
                }
            };

            overlayEl.addEventListener("mousemove", onMove);
            overlayEl.addEventListener("mouseup", onUp);
            e.preventDefault();
        };

        gridEl.addEventListener("mousedown", onMouseDown);
        this.register(() => gridEl.removeEventListener("mousedown", onMouseDown));
    }

    // ─── Selection Popup ──────────────────────────────────────────────

    private showSelectionPopup(
        clientX: number,
        clientY: number,
        selected: SelectedNoteItem[],
        gridEl: HTMLElement,
    ): void {
        this.clearSelectionPopup();

        const popup = document.body.createDiv({ cls: "eb-selection-popup" });
        this.selectionPopup = popup;

        const popupW = 260, popupH = 110;
        popup.style.left = `${Math.max(8, Math.min(clientX + 12, window.innerWidth - popupW - 8))}px`;
        popup.style.top = `${Math.max(8, Math.min(clientY - 12, window.innerHeight - popupH - 8))}px`;

        const reviewItems = selected.filter((s) => s.type === "review");
        popup.createEl("p", {
            cls: "eb-popup-count",
            text: `已选中 ${selected.length} 条笔记${reviewItems.length > 0 ? `（含 ${reviewItems.length} 条复习）` : ""}`,
        });

        const btnRow = popup.createDiv({ cls: "eb-popup-btn-row" });

        if (reviewItems.length > 0) {
            btnRow.createEl("button", { cls: "eb-popup-btn eb-popup-btn-done", text: "✓ 完成复习" })
                .addEventListener("click", async () => {
                    this.clearSelectionPopup();
                    this.clearNoteHighlights(gridEl);
                    await this.completeSelectedReviews(reviewItems);
                });
        }

        btnRow.createEl("button", { cls: "eb-popup-btn eb-popup-btn-never", text: "✗ 永不复习" })
            .addEventListener("click", async () => {
                this.clearSelectionPopup();
                this.clearNoteHighlights(gridEl);
                await this.neverReviewSelected(selected);
            });

        const closeOn = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node)) {
                this.clearSelectionPopup();
                this.clearNoteHighlights(gridEl);
                document.removeEventListener("mousedown", closeOn);
            }
        };
        setTimeout(() => document.addEventListener("mousedown", closeOn), 0);
    }

    private clearSelectionPopup(): void {
        this.selectionPopup?.remove();
        this.selectionPopup = null;
    }

    private clearNoteHighlights(gridEl: HTMLElement): void {
        gridEl.querySelectorAll(".eb-note-selected")
            .forEach((el) => el.classList.remove("eb-note-selected"));
    }

    // ─── Actions ──────────────────────────────────────────────────────

    private async completeReview(file: TFile, repetition: number, itemEl: HTMLElement): Promise<void> {
        itemEl.addClass("eb-done-animate");
        this.plugin.settings.completedReviews[reviewKey(file.path, repetition)] = true;
        await this.plugin.saveSettings();
        try {
            await markReviewedInFrontmatter(this.app, file, repetition);
            new Notice(`✅ 《${file.basename}》第${repetition}次复习完成！已添加标签 #eb-reviewed-${repetition}`);
        } catch (e) {
            new Notice(`⚠️ 复习已记录，但写入标签失败：${e}`);
        }
        setTimeout(() => this.render(), 350);
    }

    private async completeSelectedReviews(items: SelectedNoteItem[]): Promise<void> {
        let count = 0;
        for (const item of items) {
            if (item.type !== "review" || item.repetition == null) continue;
            const file = this.app.vault.getFileByPath(item.path);
            if (!file) continue;
            this.plugin.settings.completedReviews[reviewKey(item.path, item.repetition)] = true;
            count++;
            try { await markReviewedInFrontmatter(this.app, file, item.repetition); } catch { /* noop */ }
        }
        await this.plugin.saveSettings();
        new Notice(`✅ 已完成 ${count} 条笔记的复习，并写入标签。`);
        this.render();
    }

    private async neverReviewSingle(file: TFile): Promise<void> {
        this.plugin.settings.neverReview[file.path] = true;
        await this.plugin.saveSettings();
        new Notice(`🚫 《${file.basename}》已标记为"永不复习"。`);
        this.render();
    }

    private async neverReviewSelected(items: SelectedNoteItem[]): Promise<void> {
        const paths = [...new Set(items.map((i) => i.path))];
        for (const p of paths) this.plugin.settings.neverReview[p] = true;
        await this.plugin.saveSettings();
        new Notice(`🚫 已将 ${paths.length} 条笔记标记为"永不复习"。`);
        this.render();
    }

    // ─── Legend ───────────────────────────────────────────────────────

    private renderLegend(parent: HTMLElement): void {
        const legend = parent.createDiv({ cls: "eb-legend-bar" });
        const mk = (cls: string, label: string) => {
            const item = legend.createDiv({ cls: "eb-legend-item" });
            item.createDiv({ cls });
            item.createEl("span", { text: label });
        };
        mk("eb-dot-created-sm", "当天建立");
        mk("eb-dot-review-sm", "待复习");
        mk("eb-dot-overdue-sm", "已逾期");
        legend.createEl("span", { cls: "eb-legend-hint", text: "💡 拖动框选笔记可批量操作 | 点击日期数字切换到日视图" });
    }

    private openFile(file: TFile): void {
        this.app.workspace.getLeaf("tab").openFile(file);
    }
}
