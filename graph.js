"use strict";

const { GraphInteraction } = require("./interaction");
const SVG_NS = "http://www.w3.org/2000/svg";
const laneX = (level, step) => 9 + (level - 1) * step;
const round = (value) => Math.round(value * 10) / 10;

function svgElement(doc, name, attrs) {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, String(value));
    }
    return element;
}

// A rail runs from one real heading to its next sibling or its first child.
function indexHeadings(headings) {
    const byLine = new Map();
    const ordered = [];
    const runs = Array.from({ length: 7 }, () => []);
    const ancestors = [];
    const roots = [];
    let maxLevel = 0;
    for (const { line, level } of headings) {
        if (!Number.isInteger(line) || !Number.isInteger(level) || level < 1 || level > 6) continue;
        if (ordered.length && line <= ordered[ordered.length - 1].line) continue;
        let previous;
        while (ancestors.length && ancestors[ancestors.length - 1].level >= level) {
            previous = ancestors.pop();
        }
        const parent = ancestors[ancestors.length - 1];
        const sibling = previous?.level === level ? previous : null;
        const source = sibling || parent;
        const node = { line, level, index: ordered.length, parent, fork: sibling ? null : parent };
        // One pointer skips an arbitrary number of earlier siblings on this rail.
        node.entry = sibling ? sibling.entry : node;
        if (!source) roots.push(node);
        if (source) {
            const lane = runs[source.level];
            const tail = lane[lane.length - 1];
            if (tail && source.line <= tail.end.line) {
                tail.end = node;
            } else {
                lane.push({ start: source, end: node });
            }
        }
        ancestors.push(node);
        ordered.push(node);
        byLine.set(line, node);
        maxLevel = Math.max(maxLevel, level);
    }
    return { byLine, ordered, runs, roots, maxLevel };
}

function firstRunAt(runs, line) {
    let low = 0;
    let high = runs.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (runs[mid].end.line < line) low = mid + 1;
        else high = mid;
    }
    return low;
}

function headingAt(ordered, line) {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ordered[mid].line <= line) low = mid + 1;
        else high = mid;
    }
    return ordered[Math.max(0, low - 1)];
}

function forkGeometry(fromLevel, level, y, previousY, step) {
    const span = (level - fromLevel) * step;
    const desiredRise = 10 + Math.min(38, 16 + span * 0.6);
    const rise = Number.isFinite(previousY)
        ? Math.min(desiredRise, Math.max(0, y - previousY - 4))
        : desiredRise;
    const start = y - rise;
    const landing = y - Math.min(10, rise * 0.41);
    const handle = (landing - start) * 0.54;
    const fromX = laneX(fromLevel, step);
    const x = laneX(level, step);
    const curve = `C${fromX} ${round(start + handle)} ${x} ${round(landing - handle)} ${x} ${round(landing)}`;
    return { start, landing, fromX, x, curve };
}

// Emit one continuous subpath through the painted window. Off-screen headings
// have infinite y coordinates; only their intersecting straight rails are emitted.
class PathSlice {
    constructor(top, bottom) {
        this.top = top;
        this.bottom = bottom;
        this.d = "";
    }

    move(x, y) {
        if (x !== this.x || y !== this.y) this.d += `M${x} ${round(y)}`;
    }

    vertical(x, from, to) {
        const start = Math.max(this.top, from);
        const end = Math.min(this.bottom, to);
        if (start >= end) return;
        this.move(x, start);
        this.d += `V${round(end)}`;
        this.x = x;
        this.y = end;
    }

    fork(segment) {
        if (!segment || segment.landing < this.top || segment.start > this.bottom) return;
        this.move(segment.fromX, segment.start);
        this.d += segment.curve;
        this.x = segment.x;
        this.y = segment.landing;
    }
}

class GraphLayer {
    constructor(host, scroller, onToggle) {
        this.host = host;
        this.scroller = scroller;
        this.onToggle = onToggle;
        this.doc = host.ownerDocument;
        this.mount = null;
        this.plane = this.doc.createElement("div");
        this.plane.className = "hbg-plane";
        // Size strictly to the note. Even a stale slice below a freshly folded
        // section cannot increase the scroller's scrollHeight or scrollWidth.
        this.plane.style.cssText = "position:absolute;inset:0;overflow:clip;contain:strict;pointer-events:none;overflow-anchor:none;z-index:1";
        this.svg = svgElement(this.doc, "svg", {
            class: "hbg-graph", role: "group", "aria-label": "标题分支", focusable: "false",
        });
        this.svg.style.cssText = "position:absolute;pointer-events:none;overflow:hidden;user-select:none";
        this.background = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.highlight = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.origins = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.markers = svgElement(this.doc, "g", {});
        this.markerByLine = new Map();
        this.svg.append(this.background, this.highlight, this.origins, this.markers);
        this.interaction = new GraphInteraction(this.svg, () => {
            if (this.lastDraw) this.draw(this.lastDraw);
        });
        this.onInput = (event) => {
            const button = event.target.closest?.(".hbg-toggle");
            if (!button || !this.svg.contains(button)) return;
            if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
            if ("button" in event && event.button !== 0) return;
            // Keep a pointer action in the gutter from moving the editing caret.
            event.preventDefault();
            event.stopPropagation();
            if (event.type === "click" || (event.type === "keydown" && !event.repeat)) {
                this.onToggle(Number(button.dataset.line));
            }
        };
        this.events = ["pointerdown", "mousedown", "click", "keydown"];
        for (const name of this.events) this.svg.addEventListener(name, this.onInput);
        this.focusObserver = new this.doc.defaultView.MutationObserver(records => this.noteGraphRemoval(records));
        this.onFocus = () => {
            this.blurredFocus = this.pendingFocus = null;
            this.focusObserver.observe(this.host, { childList: true, subtree: true });
        };
        this.onBlur = event => this.trackReparentedFocus(event);
        this.svg.addEventListener("focusin", this.onFocus);
        this.svg.addEventListener("focusout", this.onBlur);
        this.plane.appendChild(this.svg);
    }

    noteGraphRemoval(records) {
        if (!this.blurredFocus) return;
        for (const record of records) {
            for (const element of record.removedNodes) {
                if (element === this.plane || element.contains(this.plane)) this.blurredFocus.removed = true;
            }
        }
    }

    trackReparentedFocus(event) {
        const marker = event.target.closest?.("g[data-line]");
        if (event.relatedTarget || !marker || !this.index) {
            this.focusObserver.disconnect();
            return;
        }
        // A renderer reparent blurs its focused marker before removing the
        // subtree. Keep keyboard focus only when the DOM mutation confirms it.
        const lineage = [];
        for (let node = this.index.byLine.get(Number(marker.dataset.line)); node; node = node.parent) {
            lineage.push(node.line);
        }
        const lost = { root: marker.getRootNode(), lineage, removed: false };
        this.blurredFocus = lost;
        this.doc.defaultView.queueMicrotask(() => {
            if (this.blurredFocus !== lost) return;
            this.noteGraphRemoval(this.focusObserver.takeRecords());
            this.focusObserver.disconnect();
            this.blurredFocus = null;
            if (!lost.removed || !this.lastDraw || !this.host.isConnected) return;
            this.pendingFocus = lost;
            this.restoreReparentedFocus();
        });
    }

    restoreReparentedFocus() {
        if (!this.pendingFocus || !this.plane.isConnected) return;
        const { root, lineage } = this.pendingFocus;
        this.pendingFocus = null;
        // Leave the user's new focus alone, including a control in another pane.
        const active = root.activeElement || this.doc.activeElement;
        if (active && active !== this.doc.body && active !== this.doc.documentElement) return;
        for (const line of lineage) {
            const marker = this.markerByLine.get(line);
            if (marker?.isConnected) {
                marker.focus({ preventScroll: true });
                break;
            }
        }
    }

    measureWindow(mount) {
        const rect = mount.getBoundingClientRect();
        const scroller = this.scroller;
        const viewport = scroller.getBoundingClientRect();
        const host = this.host.getBoundingClientRect();
        // offsetWidth/Height are integers, so fractional CSS layout can look
        // like a tiny transform. Avoid multiplying that error over long notes.
        const scale = (measured, layout) => {
            const value = layout && measured / layout;
            return value && Math.abs(1 - value) > 0.002 ? value : 1;
        };
        const scaleX = scale(viewport.width, scroller.offsetWidth);
        const scaleY = scale(viewport.height, scroller.offsetHeight);
        const borderTop = viewport.top + scroller.clientTop * scaleY;
        const viewportClientTop = Math.max(host.top, borderTop);
        const viewportClientBottom = Math.min(host.bottom, borderTop + scroller.clientHeight * scaleY);
        const contentTop = rect.top + mount.clientTop * scaleY;
        const contentLeft = rect.left + mount.clientLeft * scaleX;
        // Snap the paint window to content coordinates. Small wheel deltas move
        // the existing SVG with the text without replacing its paths and buttons.
        const band = Math.ceil(Math.min(384, Math.max(128, scroller.clientHeight / 3)));
        const firstBand = Math.floor((viewportClientTop - contentTop) / scaleY / band) - 1;
        const lastBand = Math.ceil((viewportClientBottom - contentTop) / scaleY / band) + 1;
        const top = Math.min(mount.clientHeight, Math.max(0, firstBand * band));
        const bottom = Math.max(top, Math.min(mount.clientHeight, lastBand * band));
        return {
            top, height: bottom - top, viewportClientTop, viewportClientBottom, scaleX, scaleY,
            originClientTop: contentTop + top * scaleY,
            limitClientBottom: contentTop + bottom * scaleY,
            localX: (clientX) => (clientX - contentLeft) / scaleX,
        };
    }

    attach(mount) {
        if (this.mount !== mount) {
            this.detach();
            this.mount = mount;
            this.previousPosition = null;
            if (this.doc.defaultView.getComputedStyle(mount).position === "static") {
                this.previousPosition = mount.style.position;
                mount.style.position = "relative";
            }
        }
        if (this.plane.parentNode !== mount) mount.appendChild(this.plane);
    }

    detach() {
        this.plane.remove();
        if (this.mount && this.previousPosition !== null && this.mount.style.position === "relative") {
            this.mount.style.position = this.previousPosition;
        }
        this.mount = null;
    }

    draw(args) {
        if (this.lastDraw === args && this.layout) {
            this.paintRoute();
            return false;
        }
        this.lastDraw = args;
        this.layout = null;
        const { mount = this.host, left, top, width, height, headings, startLine, endLine,
            visible, folds, labels, maxLevel = null, filenameY = null, firstY = 0, lastY = height } = args;
        this.attach(mount);
        const previousIndex = this.index;
        if (this.headings !== headings) {
            this.headings = headings;
            this.index = indexHeadings(headings);
        }
        const step = this.scroller.clientWidth < 540 ? 8.5 : 11;
        const depth = maxLevel ?? this.index.maxLevel;
        const gutter = depth ? laneX(depth, step) + 27 : 0;
        if (gutter !== this.gutter || step !== this.step) {
            this.gutter = gutter;
            this.step = step;
            this.host.style.setProperty("--hbg-gutter", `${gutter}px`);
            this.host.style.setProperty("--hbg-step", `${step}px`);
            if (!gutter) this.clear();
            return true; // The text column has moved. Schedule a fresh measurement.
        }
        if (!(width > 0 && height > 0 && gutter) || !Number.isFinite(left + top)) {
            this.clear();
            return false;
        }
        const bounds = [round(left), round(top), round(width), round(height)];
        const placement = bounds.join(",");
        if (this.placement !== placement) {
            this.placement = placement;
            this.svg.style.left = `${bounds[0]}px`;
            this.svg.style.top = `${bounds[1]}px`;
            this.svg.setAttribute("width", bounds[2]);
            this.svg.setAttribute("height", bounds[3]);
        }
        const topY = Math.max(0, firstY);
        const bottomY = Math.min(height, lastY);
        if (bottomY < topY) {
            this.clear();
            return false;
        }
        const { byLine, ordered, runs, roots } = this.index;
        if (!ordered.length) {
            this.clear();
            return false;
        }
        const paths = Array(7).fill("");
        const forks = new Map();
        const dots = [];
        const hasFilename = Number.isFinite(filenameY);
        const yOf = node => visible.get(node.line) ?? (node.line <= startLine ? -Infinity : Infinity);
        const originY = hasFilename ? filenameY : yOf(ordered[0]);
        // A note may begin with H3, then H2, then H1. All three have the
        // filename as their logical root. Their forks share one physical trunk.
        const rootConnectors = hasFilename || roots.length > 1;
        const forkOf = node => {
            if (forks.has(node)) return forks.get(node);
            const y = visible.get(node.line);
            const fromLevel = node.parent?.level ?? 1;
            let segment = null;
            if (Number.isFinite(y) && node.level !== fromLevel) {
                const previous = ordered[node.index - 1];
                const previousY = previous ? visible.get(previous.line) : originY;
                segment = forkGeometry(fromLevel, node.level, y, previousY, step);
            }
            forks.set(node, segment);
            return segment;
        };
        let firstLine = startLine;
        let lastLine = endLine;
        for (const [line, y] of visible) {
            const node = byLine.get(line);
            if (!node || !Number.isFinite(y)) continue;
            firstLine = Math.min(firstLine, line);
            lastLine = Math.max(lastLine, line);
            const x = laneX(node.level, step);
            if (node.fork) {
                const fork = forkOf(node);
                const ink = new PathSlice(topY, bottomY);
                ink.fork(fork);
                ink.vertical(x, fork.landing, y);
                paths[node.level] += ink.d;
            }
            if (y >= topY - 12 && y <= bottomY + 12) {
                const folded = this.onToggle && folds?.get(line);
                dots.push({ level: node.level, line, x, y: round(y), folded, label: labels?.get(line) });
            }
        }
        // Only inspect rail intervals intersecting the viewport. Their endpoints
        // can be many screens away, including on both sides of a long paragraph.
        for (let level = 1; level <= this.index.maxLevel; level++) {
            const lane = runs[level];
            const x = laneX(level, step);
            for (let i = firstRunAt(lane, firstLine); i < lane.length; i++) {
                const { start, end } = lane[i];
                if (start.line > lastLine) break;
                if (!visible.has(end.line) && end.line > startLine && end.line < endLine) continue;
                const endY = end.fork?.level === level ? forkOf(end)?.start ?? yOf(end) : yOf(end);
                const ink = new PathSlice(topY, bottomY);
                ink.vertical(x, yOf(start), endY);
                paths[level] += ink.d;
            }
        }
        if (rootConnectors) {
            const trunk = new PathSlice(topY, bottomY);
            const last = roots[roots.length - 1];
            trunk.vertical(laneX(1, step), originY, forkOf(last)?.start ?? yOf(last));
            paths[0] = trunk.d;
            for (const root of roots) {
                const fork = forkOf(root);
                if (!fork) continue;
                const ink = new PathSlice(topY, bottomY);
                ink.fork(fork);
                ink.vertical(fork.x, fork.landing, yOf(root));
                paths[root === roots[0] ? 0 : root.level] += ink.d;
            }
        }
        const markerY = hasFilename && filenameY >= topY - 6 && filenameY <= bottomY + 6 ? filenameY : null;
        this.layout = { topY, bottomY, yOf, originY, rootConnectors, forkOf, step };
        const visibleLines = new Set(dots.map(dot => dot.line));
        this.interaction.sync(visibleLines, line => {
            const node = byLine.get(line) ?? previousIndex?.byLine.get(line);
            return node?.parent?.line ?? null;
        });
        this.paintNetwork(paths, markerY);
        this.paintMarkers(dots, visibleLines);
        this.paintRoute();
        this.restoreReparentedFocus();
        return false;
    }

    paintNetwork(paths, markerY) {
        const signature = paths.join("|");
        if (signature !== this.networkSignature) {
            this.networkSignature = signature;
            const fragment = this.doc.createDocumentFragment();
            for (let level = 0; level < paths.length; level++) {
                if (!paths[level]) continue;
                fragment.appendChild(svgElement(this.doc, "path", {
                    class: "hbg-edge hbg-network" + (level ? ` hbg-level-${level}` : ""),
                    d: paths[level], stroke: "var(--hbg-rail)",
                    fill: "none", "stroke-width": 1.5, "stroke-linecap": "butt", "stroke-linejoin": "round",
                }));
            }
            this.background.replaceChildren(fragment);
        }
        if (this.filenameMarkerY !== markerY) {
            this.filenameMarkerY = markerY;
            this.origins.replaceChildren();
            if (markerY !== null) {
                this.origins.append(
                    svgElement(this.doc, "circle", { class: "hbg-origin", cx: 9, cy: markerY, r: 5.2 }),
                    svgElement(this.doc, "circle", { class: "hbg-origin-center", cx: 9, cy: markerY, r: 2 })
                );
            }
        }
    }

    paintMarkers(dots, visibleLines) {
        for (const [line, marker] of this.markerByLine) {
            if (!visibleLines.has(line)) {
                marker.remove();
                this.markerByLine.delete(line);
            }
        }
        let before = this.markers.firstChild;
        for (const dot of dots) {
            let marker = this.markerByLine.get(dot.line);
            const signature = JSON.stringify(dot);
            if (!marker || marker.signature !== signature) {
                // Retain the focused/hovered group when its fold status or geometry changes.
                marker = this.marker(dot, marker);
                marker.signature = signature;
            }
            this.markerByLine.set(dot.line, marker);
            if (marker !== before) this.markers.insertBefore(marker, before);
            before = marker.nextSibling;
        }
    }

    paintRoute() {
        const { activeLine = this.lastDraw.startLine } = this.lastDraw;
        const { topY, bottomY, yOf, originY, rootConnectors, forkOf, step } = this.layout;
        const current = this.index.byLine.get(this.interaction.previewLine)
            ?? headingAt(this.index.ordered, activeLine);
        const chain = [];
        for (let at = current; at; at = at.parent) chain.push(at);
        chain.reverse();
        const ancestors = new Set(chain.slice(0, -1).map(node => node.line));
        const ink = new PathSlice(topY, bottomY);
        let previousY = originY;
        for (const node of chain) {
            const entry = node.entry;
            const x = laneX(node.level, step);
            let start = yOf(entry);
            if (node.parent || rootConnectors) {
                const fork = forkOf(entry);
                ink.vertical(laneX(node.parent?.level ?? 1, step), previousY, fork?.start ?? start);
                ink.fork(fork);
                start = fork?.landing ?? start;
            }
            previousY = yOf(node);
            ink.vertical(x, start, previousY);
        }
        const active = this.highlight.firstChild;
        if (ink.d) {
            const path = active || svgElement(this.doc, "path", {
                fill: "none", stroke: "var(--hbg-node-border)", "stroke-width": 2.25,
                "stroke-linecap": "round", "stroke-linejoin": "round",
            });
            if (!active) this.highlight.append(path);
            if (path.dataset.line !== String(current.line) || !path.classList.contains(`hbg-level-${current.level}`)) {
                path.setAttribute("class", `hbg-edge hbg-active-path hbg-level-${current.level}`);
                path.dataset.line = current.line;
            }
            if (path.getAttribute("d") !== ink.d) path.setAttribute("d", ink.d);
        } else {
            active?.remove();
        }
        this.svg.classList.toggle("has-active-path", Boolean(ink.d));
        for (const origin of this.origins.children) origin.classList.toggle("is-path-ancestor", Boolean(ink.d));
        for (const [line, marker] of this.markerByLine) {
            const target = line === current.line;
            const ancestor = ancestors.has(line);
            if (marker.current === target && marker.ancestor === ancestor) continue;
            marker.current = target;
            marker.ancestor = ancestor;
            for (const element of [marker, marker.dot, marker.digit]) {
                element.classList.toggle("is-current", target);
                element.classList.toggle("is-path-ancestor", ancestor);
            }
            marker.dot.setAttribute("r", marker.classList.contains("is-folded") ? 4.6 : target ? 4.2 : 3.8);
        }
    }

    marker({ line, level, x, y, folded, label }, existing) {
        const interactive = typeof folded === "boolean";
        const state = ` hbg-level-${level}` + (folded ? " is-folded" : "");
        const group = existing || svgElement(this.doc, "g", { "data-line": line, tabindex: 0, "pointer-events": "all" });
        group.replaceChildren();
        group.current = group.ancestor = null;
        group.setAttribute("class", (interactive ? "hbg-toggle" : "hbg-marker") + state);
        group.setAttribute("data-level", level);
        const title = `第 ${level} 级标题${label ? "「" + label + "」" : "（第 " + (line + 1) + " 行）"}`;
        const name = interactive ? (folded ? "展开" : "收起") + title : title;
        group.setAttribute("role", interactive ? "button" : "img");
        group.setAttribute("aria-label", name);
        if (interactive) group.setAttribute("aria-expanded", String(!folded));
        else group.removeAttribute("aria-expanded");
        const tooltip = svgElement(this.doc, "title", {});
        tooltip.textContent = name;
        group.appendChild(tooltip);
        group.appendChild(svgElement(this.doc, "rect", {
            class: "hbg-hit", x: Math.max(0, x - 12), y: y - 12,
            width: 24, height: 24, fill: "transparent", "aria-hidden": "true",
        }));
        group.dot = group.appendChild(svgElement(this.doc, "circle", {
            class: "hbg-node" + state, "data-line": line, "data-level": level, cx: x, cy: y,
            r: folded ? 4.6 : 3.8,
            fill: "var(--hbg-node-bg)", stroke: "var(--hbg-node-border)",
            "stroke-width": 1.5, "aria-hidden": "true",
        }));
        const digit = svgElement(this.doc, "text", {
            class: "hbg-depth" + state, x: x + 12.5, y: y + 0.15, "aria-hidden": "true",
            "text-anchor": "middle", "dominant-baseline": "central",
        });
        digit.textContent = String(level);
        group.digit = group.appendChild(digit);
        if (interactive) {
            const symbol = `M${x - 2} ${y}h4` + (folded ? `M${x} ${y - 2}v4` : "");
            group.appendChild(svgElement(this.doc, "path", {
                class: "hbg-action-glyph", d: symbol, display: folded ? "inline" : "none", fill: "none",
                stroke: "currentColor", "stroke-width": 1, "stroke-linecap": "round", "aria-hidden": "true",
            }));
        }
        return group;
    }

    clear() {
        this.interaction.clear();
        this.pendingFocus = null;
        this.layout = null;
        this.networkSignature = null;
        this.filenameMarkerY = null;
        this.svg.classList.remove("has-active-path");
        for (const group of [this.background, this.highlight, this.origins, this.markers]) {
            if (group.firstChild) group.replaceChildren();
        }
        this.markerByLine.clear();
    }

    destroy() {
        this.interaction.destroy();
        this.lastDraw = this.layout = null;
        this.blurredFocus = this.pendingFocus = null;
        this.focusObserver.disconnect();
        this.svg.removeEventListener("focusin", this.onFocus);
        this.svg.removeEventListener("focusout", this.onBlur);
        this.markerByLine.clear();
        for (const name of this.events) this.svg.removeEventListener(name, this.onInput);
        this.detach();
        this.host.style.removeProperty("--hbg-gutter");
        this.host.style.removeProperty("--hbg-step");
        this.headings = null;
        this.index = null;
    }
}

module.exports = { GraphLayer };
