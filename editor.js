const { ViewPlugin } = require('@codemirror/view');
const { StateEffect } = require('@codemirror/state');
const {
    codeFolding,
    ensureSyntaxTree,
    foldable,
    foldEffect,
    foldedRanges,
    foldState,
    language,
    syntaxTree,
    unfoldEffect,
} = require('@codemirror/language');
const { GraphLayer } = require('./graph');
const { measureFilename } = require('./filename');

function collectHeadings(tree, document) {
    const headings = [];
    const lines = new Set();

    tree.iterate({
        enter(node) {
            // Obsidian marks the title and underline of Setext headings separately.
            const match = node.name.match(/(?:^|_)HyperMD-header-([1-6])(?:_|$)/)
                || node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
            if (!match) return;

            const line = document.lineAt(node.from);
            if (!lines.has(line.number)) {
                headings.push({
                    line: line.number - 1,
                    level: Number(match[1]),
                    position: line.from,
                    sectionEnd: document.length,
                });
                lines.add(line.number);
            }
            return false;
        },
    });

    const ancestors = [];
    for (const heading of headings) {
        while (ancestors.length && ancestors[ancestors.length - 1].level >= heading.level) {
            ancestors.pop().sectionEnd = heading.position - 1;
        }
        ancestors.push(heading);
    }
    return headings;
}

function firstHeadingAt(headings, position) {
    let low = 0;
    let high = headings.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (headings[middle].position < position) low = middle + 1;
        else high = middle;
    }
    return low;
}

class EditorGraph {
    constructor(view) {
        this.view = view;
        this.destroyed = false;
        this.window = view.win;
        this.host = null;
        this.enabled = false;
        this.attachFrame = null;
        this.attach();
        if (!this.enabled) {
            this.attachFrame = this.window.requestAnimationFrame(() => {
                this.attachFrame = null;
                this.attach();
            });
        }
    }

    attach() {
        if (this.enabled || this.destroyed) return;
        const view = this.view;
        const host = view.dom.closest('.markdown-source-view');
        if (!host?.closest('.workspace-leaf-content[data-type="markdown"]')
            || view.dom.parentElement?.closest('.cm-editor')) return;

        this.host = host;
        this.enabled = true;
        if (this.attachFrame !== null) {
            this.window.cancelAnimationFrame(this.attachFrame);
            this.attachFrame = null;
        }
        this.parseTimer = null;
        this.headings = [];
        this.maxLevel = 0;
        this.document = null;
        this.observedTree = null;
        this.completeDocument = null;
        this.foldSource = null;
        this.foldRanges = null;
        this.unfoldedHeadings = [];
        this.host.classList.add('hbg-editor');
        this.layer = new GraphLayer(this.host, view.scrollDOM, (line) => this.toggleFold(line));
        this.measureRequest = {
            key: this,
            read: () => this.measure(),
            write: (geometry) => this.paint(geometry),
        };
        this.onScroll = () => this.scheduleMeasure();
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
        this.resizeObserver = new this.window.ResizeObserver(this.onScroll);
        this.resizeObserver.observe(this.host);
        this.resizeObserver.observe(view.contentDOM);
        this.refreshHeadings();
        this.scheduleMeasure();
    }

    update() {
        if (!this.enabled) this.attach();
        if (!this.enabled) return;
        this.refreshHeadings();
        // Folding and replacement decorations can change without changing the text.
        this.scheduleMeasure();
    }

    refreshHeadings(force = false) {
        const state = this.view.state;
        const currentTree = syntaxTree(state);
        const documentChanged = this.document !== state.doc;
        if (!force && !documentChanged && this.observedTree === currentTree) return;

        this.document = state.doc;
        this.observedTree = currentTree;
        if (!state.facet(language)) {
            this.headings = [];
            this.maxLevel = 0;
            return;
        }

        // Keep typing responsive and finish large documents in later small slices.
        const fullTree = ensureSyntaxTree(state, state.doc.length, 8);
        if (fullTree || documentChanged || this.completeDocument !== state.doc) {
            this.headings = collectHeadings(fullTree || currentTree, state.doc);
            this.maxLevel = this.headings.reduce((maximum, heading) => Math.max(maximum, heading.level), 0);
        }
        if (fullTree) {
            this.completeDocument = state.doc;
            this.cancelParse();
        } else {
            this.scheduleParse();
        }
    }

    scheduleParse() {
        if (this.parseTimer !== null || this.destroyed) return;
        this.parseTimer = this.window.setTimeout(() => {
            this.parseTimer = null;
            if (this.destroyed) return;
            this.refreshHeadings(true);
            this.scheduleMeasure();
        }, 60);
    }

    cancelParse() {
        if (this.parseTimer === null) return;
        this.window.clearTimeout(this.parseTimer);
        this.parseTimer = null;
    }

    scheduleMeasure() {
        if (this.enabled && !this.destroyed) this.view.requestMeasure(this.measureRequest);
    }

    expandedHeadings() {
        const ranges = foldedRanges(this.view.state);
        if (this.foldSource === this.headings && this.foldRanges === ranges) {
            return this.unfoldedHeadings;
        }
        this.foldSource = this.headings;
        this.foldRanges = ranges;
        if (!ranges.size) {
            this.unfoldedHeadings = this.headings;
            return this.unfoldedHeadings;
        }

        const folds = [];
        ranges.between(0, this.view.state.doc.length, (from, to) => {
            folds.push({ from, to });
        });
        let foldIndex = 0;
        this.unfoldedHeadings = this.headings.filter((heading) => {
            while (foldIndex < folds.length && folds[foldIndex].to <= heading.position) {
                foldIndex += 1;
            }
            const fold = folds[foldIndex];
            return !fold || heading.position < fold.from;
        });
        return this.unfoldedHeadings;
    }

    headingFold(heading) {
        const state = this.view.state;
        const line = state.doc.line(heading.line + 1);
        let lastTitleLine = line;
        if (!/^ {0,3}#{1,6}(?:\s|$)/.test(line.text) && line.number < state.doc.lines) {
            const nextLine = state.doc.line(line.number + 1);
            if (/^\s*(?:=+|-+)\s*$/.test(nextLine.text)) lastTitleLine = nextLine;
        }

        let existing = null;
        foldedRanges(state).between(line.from, lastTitleLine.to, (from, to) => {
            if (from >= line.from && from <= lastTitleLine.to && (!existing || from < existing.from)) {
                existing = { from, to };
            }
        });
        if (existing) return { range: existing, folded: true };

        const nativeRange = foldable(state, line.from, line.to);
        if (nativeRange && nativeRange.to > nativeRange.from) {
            return { range: nativeRange, folded: false };
        }

        // HyperMD's fold service can lack a cached result before its native control renders.
        // A complete parsed heading tree still gives the same section boundary.
        if (this.completeDocument !== state.doc || heading.sectionEnd <= lastTitleLine.to) return null;
        const bodyStart = Math.min(lastTitleLine.to + 1, heading.sectionEnd);
        const content = state.doc.iterRange(bodyStart, heading.sectionEnd);
        while (!content.next().done) {
            if (/\S/.test(content.value)) {
                return {
                    range: { from: lastTitleLine.to, to: heading.sectionEnd },
                    folded: false,
                };
            }
        }
        return null;
    }

    toggleFold(lineNumber) {
        if (this.destroyed || !this.enabled || !Number.isInteger(lineNumber)
            || lineNumber < 0 || lineNumber >= this.view.state.doc.lines) return;
        const position = this.view.state.doc.line(lineNumber + 1).from;
        const heading = this.headings[firstHeadingAt(this.headings, position)];
        if (!heading || heading.line !== lineNumber) return;
        const fold = this.headingFold(heading);
        if (!fold) return;

        const effects = [fold.folded ? unfoldEffect.of(fold.range) : foldEffect.of(fold.range)];
        if (!this.view.state.field(foldState, false)) {
            effects.push(StateEffect.appendConfig.of(codeFolding()));
        }
        this.view.dispatch({ effects });
    }

    measure() {
        const view = this.view;
        if (this.destroyed || !this.host.isConnected || !view.inView) return null;

        const sizer = view.contentDOM.closest('.cm-sizer');
        if (!sizer) return null;
        const frame = this.layer.measureWindow(sizer);
        const style = this.window.getComputedStyle(this.host);
        const width = parseFloat(style.getPropertyValue('--hbg-gutter')) || 0;
        const lineArea = Math.max(0, frame.localX(view.contentDOM.getBoundingClientRect().left) - width);
        const headings = this.expandedHeadings();
        const visible = new Map();
        const folds = new Map();
        const labels = new Map();

        for (const range of view.visibleRanges) {
            let index = firstHeadingAt(headings, range.from);
            while (index < headings.length && headings[index].position <= range.to) {
                const heading = headings[index];
                const coordinates = view.coordsAtPos(heading.position, 1);
                if (coordinates) {
                    visible.set(heading.line,
                        ((coordinates.top + coordinates.bottom) / 2 - frame.originClientTop) / frame.scaleY);
                    const fold = this.headingFold(heading);
                    if (fold) folds.set(heading.line, fold.folded);
                    const text = view.state.doc.line(heading.line + 1).text
                        .replace(/^ {0,3}#{1,6}(?:\s+|$)/, '')
                        .replace(/\s+#+\s*$/, '')
                        .trim();
                    labels.set(heading.line, text || `第 ${heading.line + 1} 行标题`);
                }
                index += 1;
            }
        }

        const firstBlock = view.lineBlockAtHeight(Math.max(0, (frame.originClientTop - view.documentTop) / frame.scaleY));
        const lastBlock = view.lineBlockAtHeight(Math.max(0, (frame.limitClientBottom - view.documentTop) / frame.scaleY));
        return {
            mount: sizer,
            left: lineArea,
            top: frame.top,
            width,
            height: frame.height,
            lineArea: Math.round(lineArea * 10) / 10,
            filenameY: measureFilename(sizer, frame.originClientTop, frame.scaleY),
            headings,
            maxLevel: this.maxLevel,
            startLine: view.state.doc.lineAt(Math.max(firstBlock.from, view.viewport.from)).number - 1,
            endLine: view.state.doc.lineAt(Math.min(lastBlock.to, view.viewport.to)).number - 1,
            activeLine: view.state.doc.lineAt(view.state.selection.main.head).number - 1,
            visible,
            folds,
            labels,
        };
    }

    paint(geometry) {
        if (this.destroyed || !geometry) return;
        if (geometry.lineArea !== this.lineArea) {
            this.lineArea = geometry.lineArea;
            this.host.style.setProperty('--hbg-line-area', `${this.lineArea}px`);
        }
        if (this.layer.draw(geometry)) this.scheduleMeasure();
    }

    destroy() {
        this.destroyed = true;
        if (this.attachFrame !== null) {
            this.window.cancelAnimationFrame(this.attachFrame);
            this.attachFrame = null;
        }
        if (!this.enabled) return;
        this.cancelParse();
        this.resizeObserver.disconnect();
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.layer.destroy();
        this.host.style.removeProperty('--hbg-line-area');
        this.host.classList.remove('hbg-editor');
    }
}

function editorExtension() {
    return ViewPlugin.fromClass(EditorGraph);
}

module.exports = { editorExtension };
