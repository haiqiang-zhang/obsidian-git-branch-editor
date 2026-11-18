const { Plugin } = require("obsidian");
const { editorExtension } = require("./editor");
const { registerReading } = require("./reading");

module.exports = class GitBranchEditor extends Plugin {
    onload() {
        this.registerEditorExtension(editorExtension());
        registerReading(this);
    }
};
