const { GraphLayer } = require("./graph");
const { measureFilename } = require("./filename");

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const EMBED_SELECTOR = ".markdown-embed, .internal-embed, .markdown-embed-content";

function hasSourcePosition(section) {
    return Number.isInteger(section.start?.line)
        && Number.isInteger(section.end?.line);
}

function isHeadingSection(section) {
    return section.level >= 1 && section.level <= 6;
}

function stableOutline(previous, next) {
    return previous.length === next.length && next.every((item, index) =>
        item.line === previous[index].line && item.level === previous[index].level
    ) ? previous : next;
}

function findHeadingElement(section, sizer) {
    const elements = section.el.matches(HEADING_SELECTOR)
        ? [section.el]
        : section.el.querySelectorAll(HEADING_SELECTOR);

    for (const element of elements) {
        if (Number(element.tagName.slice(1)) !== section.level) continue;
        if (element.closest(".markdown-preview-sizer") !== sizer) continue;
        if (element.closest(EMBED_SELECTOR)) continue;
        return element;
    }
    return null;
}

function findFoldControl(heading, scroller) {
    if (!scroller.classList.contains("allow-fold-headings")) return null;
    return heading.querySelector(":scope > .heading-collapse-indicator");
}

class ReadingGraph {
    constructor(view, host, scroller) {
        this.view = view;
        this.host = host;
        this.scroller = scroller;
        this.window = host.ownerDocument.defaultView;
        this.sizer = null;
        this.headings = [];
        this.headingByLine = new Map();
        this.maxLevel = 0;
        this.cachedSections = null;
        this.sectionByElement = new WeakMap();
        this.sourceCacheDirty = true;
        this.firstLine = 0;
        this.lastLine = 0;
        this.frame = null;
        this.destroyed = false;
        this.schedule = this.schedule.bind(this);
        this.onMutations = this.onMutations.bind(this);
        this.onClick = this.onClick.bind(this);

        host.classList.add("hbg-reading");
        this.layer = new GraphLayer(host, scroller, line => this.toggleFold(line));
        this.mutations = new this.window.MutationObserver(this.onMutations);
        this.mutations.observe(scroller, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ["class", "style"],
        });
        this.mutations.observe(host, {
            attributes: true,
            attributeFilter: ["class", "style"],
        });
        this.resize = new this.window.ResizeObserver(this.schedule);
        this.resize.observe(host);
        this.resize.observe(scroller);
        scroller.addEventListener("scroll", this.schedule, { passive: true });
        scroller.addEventListener("click", this.onClick);
        this.schedule();
    }

    isReading() {
        return this.view.currentMode === this.view.previewMode
            || this.view.getState?.().mode === "preview";
    }

    onClick(event) {
        if (!event.target.closest?.(".heading-collapse-indicator")) return;
        this.sourceCacheDirty = true;
        this.schedule();
    }

    toggleFold(line) {
        if (this.destroyed || !this.isReading()) return;
        const renderer = this.view.previewMode?.renderer;
        const sizer = renderer?.sizerEl;
        if (!sizer || !this.scroller.contains(sizer)) return;
        this.updateSourceCache(renderer);
        const section = this.headingByLine.get(line);
        if (!section || section.shown === false || !section.el.isConnected) return;
        if (!sizer.contains(section.el)) return;
        const heading = findHeadingElement(section, sizer);
        if (!heading) return;
        const control = findFoldControl(heading, this.scroller);
        if (!control) return;

        // Use the native delegated handler so folding persistence, selection,
        // section visibility, and Obsidian's render queue stay in sync.
        control.dispatchEvent(new this.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
        }));
        this.sourceCacheDirty = true;
        this.schedule();
    }

    onMutations(records) {
        let changed = false;
        for (const record of records) {
            if (record.target.closest?.(".hbg-plane, .hbg-graph")) continue;
            if (record.type === "childList" && record.removedNodes.length === 0
                && record.addedNodes.length > 0
                && [...record.addedNodes].every(node => node.matches?.(".hbg-plane, .hbg-graph"))) continue;
            changed = true;
            if (record.type === "attributes" && record.attributeName === "class") {
                const previouslyCollapsed = (record.oldValue || "").split(/\s+/).includes("is-collapsed");
                if (previouslyCollapsed !== record.target.classList.contains("is-collapsed")) {
                    this.sourceCacheDirty = true;
                }
            }
            if (record.type !== "childList") continue;
            for (const node of [...record.addedNodes, ...record.removedNodes]) {
                const cached = this.sectionByElement.get(node);
                if (cached && cached.shown !== (cached.section.shown !== false)) {
                    this.sourceCacheDirty = true;
                }
            }
        }
        if (changed) this.schedule();
    }

    schedule() {
        if (this.destroyed) return;
        if (!this.isReading()) {
            if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
            this.frame = null;
            return;
        }
        if (this.frame !== null) return;
        this.frame = this.window.requestAnimationFrame(() => {
            this.frame = null;
            this.draw();
        });
    }

    updateSourceCache(renderer) {
        const sections = renderer.sections || [];
        if (!this.sourceCacheDirty && this.cachedSections === sections) return;

        this.cachedSections = sections;
        this.sourceCacheDirty = false;
        this.sectionByElement = new WeakMap();
        this.headingByLine = new Map();
        this.maxLevel = 0;
        this.firstLine = Infinity;
        this.lastLine = 0;
        const headings = [];
        for (const section of sections) {
            if (!hasSourcePosition(section)) continue;
            const shown = section.shown !== false;
            if (section.el) this.sectionByElement.set(section.el, { section, shown });
            if (isHeadingSection(section)) {
                this.maxLevel = Math.max(this.maxLevel, section.level);
                if (shown) {
                    headings.push({ level: section.level, line: section.start.line });
                    this.headingByLine.set(section.start.line, section);
                }
            }
            if (!shown) continue;
            this.firstLine = Math.min(this.firstLine, section.start.line);
            this.lastLine = Math.max(this.lastLine, section.end.line);
        }
        if (!Number.isFinite(this.firstLine)) this.firstLine = 0;
        this.headings = stableOutline(this.headings, headings);
    }

    draw() {
        if (this.destroyed || !this.host.isConnected || !this.isReading()) return;
        const renderer = this.view.previewMode?.renderer;
        const sizer = renderer?.sizerEl;
        if (!sizer || !this.scroller.contains(sizer)) return;

        if (sizer !== this.sizer) {
            if (this.sizer) this.resize.unobserve(this.sizer);
            this.sizer = sizer;
            this.resize.observe(sizer);
        }

        // The renderer owns both source positions and the current folded state.
        // Its section records survive virtual scrolling and duplicate headings.
        this.updateSourceCache(renderer);

        const frame = this.layer.measureWindow(sizer);
        if (!frame) return;
        const sizerRect = sizer.getBoundingClientRect();
        const style = this.window.getComputedStyle(this.host);
        const gutter = parseFloat(style.getPropertyValue("--hbg-gutter")) || 0;
        const step = parseFloat(style.getPropertyValue("--hbg-step")) || 0;
        const visible = new Map();
        const folds = new Map();
        const labels = new Map();
        let startLine = Infinity;
        let endLine = -1;
        let activeLine = Infinity;
        let nearestSection = null;
        let nearestDistance = Infinity;
        let activeSection = null;
        let activeDistance = Infinity;

        // Only mounted sections have geometry. Virtual scroll changes this child
        // list without invalidating the full document's source and lane indexes.
        for (const element of sizer.children) {
            const section = this.sectionByElement.get(element)?.section;
            if (!section || section.shown === false) continue;
            const rect = element.getBoundingClientRect();
            if (rect.height <= 0) continue;

            const distance = Math.max(frame.originClientTop - rect.bottom,
                rect.top - frame.limitClientBottom, 0);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestSection = section;
            }
            if (rect.bottom >= frame.originClientTop && rect.top <= frame.limitClientBottom) {
                startLine = Math.min(startLine, section.start.line);
                endLine = Math.max(endLine, section.end.line);
            }
            const viewportDistance = Math.max(frame.viewportClientTop - rect.bottom,
                rect.top - frame.viewportClientBottom, 0);
            if (viewportDistance < activeDistance) {
                activeDistance = viewportDistance;
                activeSection = section;
            }
            if (rect.bottom >= frame.viewportClientTop && rect.top <= frame.viewportClientBottom) {
                activeLine = Math.min(activeLine, section.start.line);
            }

            if (!isHeadingSection(section)) continue;
            if (rect.bottom < frame.originClientTop || rect.top > frame.limitClientBottom) continue;
            const heading = findHeadingElement(section, sizer);
            if (!heading) continue;
            const headingRect = heading.getBoundingClientRect();
            if (headingRect.height <= 0) continue;
            const headingStyle = this.window.getComputedStyle(heading);
            const lineHeight = parseFloat(headingStyle.lineHeight)
                || parseFloat(headingStyle.fontSize) * 1.4;
            const paddingTop = parseFloat(headingStyle.paddingTop) || 0;
            const borderTop = parseFloat(headingStyle.borderTopWidth) || 0;
            visible.set(section.start.line,
                (headingRect.top - frame.originClientTop) / frame.scaleY
                    + paddingTop + borderTop + lineHeight / 2
            );
            labels.set(section.start.line,
                heading.getAttribute("data-heading") ?? heading.textContent.trim()
            );
            if (findFoldControl(heading, this.scroller)) {
                folds.set(section.start.line, Boolean(section.headingCollapsed));
            }
        }

        if (!Number.isFinite(startLine)) {
            startLine = nearestSection?.start.line
                ?? (this.scroller.scrollTop > 0 ? this.lastLine : this.firstLine);
            endLine = nearestSection?.end.line ?? startLine;
        }
        if (!Number.isFinite(activeLine)) activeLine = activeSection?.start.line ?? startLine;

        const changed = this.layer.draw({
            mount: sizer,
            left: frame.localX(sizerRect.left),
            top: frame.top,
            width: gutter,
            height: frame.height,
            step,
            headings: this.headings,
            maxLevel: this.maxLevel,
            startLine,
            endLine,
            activeLine,
            visible,
            folds,
            labels,
            filenameY: measureFilename(sizer, frame.originClientTop, frame.scaleY),
        });
        // Column allocation changes the sizer width and can wrap headings.
        if (changed) this.schedule();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
        this.mutations.disconnect();
        this.resize.disconnect();
        this.scroller.removeEventListener("scroll", this.schedule);
        this.scroller.removeEventListener("click", this.onClick);
        this.layer.destroy();
        this.host.classList.remove("hbg-reading");
    }
}

function registerReading(plugin) {
    const instances = new Map();
    let disposed = false;

    function syncViews() {
        if (disposed) return;
        const current = new Set();
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            const host = view.previewMode?.containerEl;
            const scroller = view.previewMode?.renderer?.previewEl;
            if (!host?.isConnected || !scroller || !host.contains(scroller)) continue;
            if (!host.closest(".workspace-leaf-content[data-type=markdown]")) continue;
            if (host.closest(EMBED_SELECTOR) || host.closest(".hover-popover")) continue;
            current.add(view);

            let instance = instances.get(view);
            if (instance && (instance.host !== host || instance.scroller !== scroller)) {
                instance.destroy();
                instances.delete(view);
                instance = null;
            }
            if (!instance) {
                instance = new ReadingGraph(view, host, scroller);
                instances.set(view, instance);
            }
            instance.schedule();
        }

        for (const [view, instance] of instances) {
            if (current.has(view)) continue;
            instance.destroy();
            instances.delete(view);
        }
    }

    for (const event of ["layout-change", "active-leaf-change", "file-open", "resize", "css-change"]) {
        plugin.registerEvent(plugin.app.workspace.on(event, syncViews));
    }
    plugin.registerMarkdownPostProcessor((_element, context) => {
        for (const [view, instance] of instances) {
            if (view.file?.path === context.sourcePath) instance.schedule();
        }
    });
    plugin.register(() => {
        disposed = true;
        for (const instance of instances.values()) instance.destroy();
        instances.clear();
    });
    plugin.app.workspace.onLayoutReady(syncViews);
    syncViews();
}

module.exports = { registerReading };
