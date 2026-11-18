"use strict";

const { PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_PALETTE = "theme";
const PALETTES = {
    theme: "Theme (default)",
    flexoki: "Flexoki",
    primer: "GitHub Primer",
};

function validPalette(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(PALETTES, value);
}

class BranchSettingsTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.icon = "git-branch";
    }

    getSettingDefinitions() {
        return [{
            name: "Color palette",
            desc: "Colors for headings and their branch paths.",
            aliases: ["heading colors", "Flexoki", "GitHub Primer"],
            render: setting => this.renderPalette(setting),
        }];
    }

    // Obsidian 1.12 uses display(); newer versions index and render the definition.
    display() {
        this.containerEl.empty();
        const [definition] = this.getSettingDefinitions();
        definition.render(new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc));
    }

    renderPalette(setting) {
        this.preview = setting.descEl.createDiv({ cls: "hbg-palette-preview" });
        this.preview.setAttribute("aria-hidden", "true");
        for (let level = 1; level <= 6; level++) {
            this.preview.createSpan({ cls: `hbg-level-${level}`, text: `H${level}` });
        }
        setting.addDropdown(dropdown => {
            this.dropdown = dropdown;
            dropdown.selectEl.setAttribute("aria-label", "Color palette");
            dropdown.addOptions(PALETTES).onChange(value => this.plugin.setPalette(value));
        });
        this.refreshPalette();
    }

    refreshPalette() {
        const { palette } = this.plugin.settings;
        if (this.preview) this.preview.dataset.hbgPalette = palette;
        this.dropdown?.setValue(palette);
    }

    hide() {
        super.hide();
        this.preview = null;
        this.dropdown = null;
    }
}

module.exports = { BranchSettingsTab, DEFAULT_PALETTE, validPalette };
