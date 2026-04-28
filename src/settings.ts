import { App, PluginSettingTab, Setting } from "obsidian";
import type EbbinghausPlugin from "./main";
import { DEFAULT_INTERVALS } from "./ebbinghaus";

export interface EbbinghausSettings {
    intervals: number[];
    showStartupNotice: boolean;
    /** key: `${file.path}::${repetition}` → true if completed */
    completedReviews: Record<string, boolean>;
    /** key: file.path → true if user chose 'never review' */
    neverReview: Record<string, boolean>;
    /**
     * Frozen modification date per note (ms timestamp).
     * Set on first scan from file.stat.mtime; only updated when user clicks "Reset".
     * Subsequent edits to the note do NOT change this value.
     */
    pinnedDates: Record<string, number>;
}

export const DEFAULT_SETTINGS: EbbinghausSettings = {
    intervals: DEFAULT_INTERVALS,
    showStartupNotice: true,
    completedReviews: {},
    neverReview: {},
    pinnedDates: {},
};

/** Build the persistence key for a completed review */
export function reviewKey(filePath: string, repetition: number): string {
    return `${filePath}::${repetition}`;
}

export class EbbinghausSettingTab extends PluginSettingTab {
    plugin: EbbinghausPlugin;

    constructor(app: App, plugin: EbbinghausPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "艾宾浩斯复习设置" });

        new Setting(containerEl)
            .setName("复习间隔（天）")
            .setDesc("用英文逗号分隔的天数列表，例如：1,2,4,7,15,30,60,120")
            .addText((text) => {
                text
                    .setPlaceholder("1,2,4,7,15,30,60,120")
                    .setValue(this.plugin.settings.intervals.join(","))
                    .onChange(async (value) => {
                        const parsed = value
                            .split(",")
                            .map((s) => parseInt(s.trim(), 10))
                            .filter((n) => !isNaN(n) && n > 0);
                        if (parsed.length > 0) {
                            this.plugin.settings.intervals = parsed;
                            await this.plugin.saveSettings();
                        }
                    });
                text.inputEl.style.width = "300px";
            });

        new Setting(containerEl)
            .setName("启动时显示今日待复习数量")
            .setDesc("每次打开 Obsidian 时，在通知栏提示今天有多少笔记需要复习。")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showStartupNotice)
                    .onChange(async (value) => {
                        this.plugin.settings.showStartupNotice = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("重置所有复习记录")
            .setDesc("清除所有已完成的复习记录，笔记将重新出现在日历上。")
            .addButton((btn) =>
                btn
                    .setButtonText("重置")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.completedReviews = {};
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("重置永不复习名单")
            .setDesc("清除所有标记为'永不复习'的笔记，使其重新出现在日历中。")
            .addButton((btn) =>
                btn
                    .setButtonText("重置")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.neverReview = {};
                        await this.plugin.saveSettings();
                    })
            );

        // Interval preview
        containerEl.createEl("h3", { text: "当前复习间隔预览" });
        const preview = containerEl.createEl("div", { cls: "eb-intervals-preview" });
        this.plugin.settings.intervals.forEach((days, i) => {
            preview.createEl("span", {
                cls: "eb-interval-badge",
                text: `第${i + 1}次: +${days}天`,
            });
        });
    }
}
