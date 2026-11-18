const { Notice, Plugin } = require("obsidian");
const { editorExtension } = require("./editor");
const { registerReading } = require("./reading");
const { BranchSettingsTab, DEFAULT_PALETTE, validPalette } = require("./settings");

module.exports = class GitBranchEditor extends Plugin {
    async onload() {
        this.paletteHosts = new Set();
        this.saveQueue = Promise.resolve();
        await this.loadSettings();
        this.paletteTab = new BranchSettingsTab(this.app, this);
        this.addSettingTab(this.paletteTab);
        this.registerEditorExtension(editorExtension(this));
        registerReading(this);
    }

    async loadSettings() {
        const before = this.settings;
        const data = await this.loadData();
        if (before !== this.settings) return;
        const palette = validPalette(data?.palette) ? data.palette : DEFAULT_PALETTE;
        this.savedSettings = { ...data, palette };
        this.applySettings(this.savedSettings);
    }

    bindPalette(host) {
        this.paletteHosts.add(host);
        host.dataset.hbgPalette = this.settings.palette;
        return () => {
            this.paletteHosts.delete(host);
            delete host.dataset.hbgPalette;
        };
    }

    applySettings(settings) {
        this.settings = settings;
        for (const host of this.paletteHosts) host.dataset.hbgPalette = settings.palette;
        this.paletteTab?.refreshPalette();
    }

    setPalette(palette) {
        if (!validPalette(palette) || palette === this.settings.palette) return this.saveQueue;
        const settings = { ...this.settings, palette };
        this.applySettings(settings);
        // Apply immediately, then persist in selection order even on slow adapters.
        this.saveQueue = this.saveQueue.then(async () => {
            try {
                await this.saveData(settings);
                this.savedSettings = settings;
            } catch (error) {
                if (this.settings === settings) this.applySettings(this.savedSettings);
                new Notice("Git Branch Editor couldn't save the color palette.");
                console.error("Git Branch Editor could not save the color palette.", error);
            }
        });
        return this.saveQueue;
    }

    async onExternalSettingsChange() {
        await this.saveQueue;
        await this.loadSettings();
    }
};
