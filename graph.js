"use strict";

const { filenameOrigin } = require("./filename");
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
    let maxLevel = 0;
    for (const { line, level } of headings) {
        if (!Number.isInteger(line) || !Number.isInteger(level) || level < 1 || level > 6) continue;
        if (ordered.length && line <= ordered[ordered.length - 1].line) continue;
        let previous;
        while (ancestors.length && ancestors[ancestors.length - 1].level >= level) {
            previous = ancestors.pop();
        }
        const parent = ancestors[ancestors.length - 1];
        const source = previous?.level === level ? previous : parent;
        const node = { line, level, index: ordered.length,
            source, fork: source === parent ? parent : null };
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
    return { byLine, ordered, runs, maxLevel };
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

function forkGeometry(node, y, visible, ordered, step) {
    const span = (node.level - node.fork.level) * step;
    const previous = ordered[node.index - 1];
    const previousY = previous && visible.get(previous.line);
    const desiredRise = 10 + Math.min(38, 16 + span * 0.6);
    const rise = Number.isFinite(previousY)
        ? Math.min(desiredRise, Math.max(0, y - previousY - 4))
        : desiredRise;
    const start = y - rise;
    const landing = y - Math.min(10, rise * 0.41);
    const handle = (landing - start) * 0.54;
    const fromX = laneX(node.fork.level, step);
    const x = laneX(node.level, step);
    const curve = `C${fromX} ${round(start + handle)} ${x} ${round(landing - handle)} ${x} ${round(landing)}`;
    return { start, landing, fromX, curve };
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
        this.plane.appendChild(this.svg);
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

    draw({ mount = this.host, left, top, width, height, headings, startLine, endLine, activeLine = startLine,
        visible, folds, labels, maxLevel = null, filenameY = null, firstY = 0, lastY = height }) {
        this.attach(mount);
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
        const { byLine, ordered, runs } = this.index;
        const current = headingAt(ordered, activeLine);
        let currentEdge = "";
        // The filename occupies slot zero. Each other path belongs to one heading level.
        const paths = Array(7).fill("");
        const forkStarts = new Map();
        const dots = [];
        let firstLine = startLine;
        let lastLine = endLine;
        for (const [line, y] of visible) {
            const node = byLine.get(line);
            if (!node || !Number.isFinite(y)) continue;
            firstLine = Math.min(firstLine, line);
            lastLine = Math.max(lastLine, line);
            const x = laneX(node.level, step);
            if (node.fork) {
                const fork = forkGeometry(node, y, visible, ordered, step);
                if (y >= topY && fork.start <= bottomY) {
                    if (node === current) {
                        const begin = Math.max(topY, fork.landing);
                        const end = Math.min(bottomY, y);
                        if (end > begin) currentEdge = `M${x} ${round(begin)}V${round(end)}`;
                    } else {
                        fork.curve += `V${round(y)}`;
                    }
                    paths[node.level] += `M${fork.fromX} ${round(fork.start)}${fork.curve}`;
                    forkStarts.set(line, fork.start);
                }
            } else if (node === current && node.source) {
                // A shared rail can span many sections. Highlight only the
                // short approach to this sibling, bounded by its actual source.
                const sourceY = visible.get(node.source.line);
                if (Number.isFinite(sourceY) || node.source.line <= startLine) {
                    const begin = Math.max(topY, y - 10, sourceY ?? topY);
                    const end = Math.min(bottomY, y);
                    if (end > begin) currentEdge = `M${x} ${round(begin)}V${round(end)}`;
                }
            }
            if (y >= topY - 12 && y <= bottomY + 12) {
                const folded = this.onToggle && folds?.get(line);
                const label = typeof folded === "boolean" ? labels?.get(line) : undefined;
                dots.push({ level: node.level, line, x, y: round(y), folded, label });
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
                let y1 = visible.get(start.line);
                let y2 = visible.get(end.line);
                if (!Number.isFinite(y1)) {
                    if (start.line > startLine) continue;
                    y1 = topY;
                }
                if (Number.isFinite(y2)) {
                    if (end.fork?.level === level) {
                        y2 = forkStarts.get(end.line) ?? forkGeometry(end, y2, visible, ordered, step).start;
                    }
                } else {
                    // A wrapped heading or the nearest section in the bottom
                    // scroll padding may still be the viewport's first line.
                    // Its unmeasured endpoint is already above the viewport.
                    if (end.line <= startLine || end.line < endLine) continue;
                    y2 = bottomY;
                }
                y1 = Math.max(topY, y1);
                y2 = Math.min(bottomY, y2);
                if (y2 > y1) {
                    paths[level] += `M${x} ${round(y1)}V${round(y2)}`;
                }
            }
        }
        const origin = filenameOrigin({ filenameY, first: ordered[0], visible, firstLine: startLine,
            top: topY, bottom: bottomY, step });
        paths[0] = origin.path;
        const signature = paths.join("|") + `;${origin.markerY};${current?.line};${currentEdge};` + JSON.stringify(dots);
        if (signature === this.signature) return false;
        this.signature = signature;
        const fragment = this.doc.createDocumentFragment();
        for (let level = 0; level < paths.length; level++) {
            if (!paths[level]) continue;
            fragment.appendChild(svgElement(this.doc, "path", {
                class: "hbg-edge hbg-network" + (level ? ` hbg-level-${level}` : ""),
                d: paths[level], stroke: "var(--hbg-rail)",
                fill: "none", "stroke-width": 1.5, "stroke-linecap": "butt", "stroke-linejoin": "round",
                "aria-hidden": "true",
            }));
        }
        if (currentEdge) {
            fragment.appendChild(svgElement(this.doc, "path", {
                class: `hbg-edge hbg-current-edge hbg-level-${current.level}`, d: currentEdge, "data-line": current.line,
                stroke: "var(--hbg-node-border)", fill: "none", "stroke-linecap": "butt", "stroke-width": 1.5,
                "aria-hidden": "true",
            }));
        }
        if (Number.isFinite(origin.markerY)) {
            fragment.appendChild(svgElement(this.doc, "circle", {
                class: "hbg-origin", cx: 9, cy: origin.markerY, r: 5.2, "aria-hidden": "true",
            }));
            fragment.appendChild(svgElement(this.doc, "circle", {
                class: "hbg-origin-center", cx: 9, cy: origin.markerY, r: 2, "aria-hidden": "true",
            }));
        }
        const focused = this.doc.activeElement;
        const focusedLine = focused?.matches(".hbg-toggle") && this.svg.contains(focused)
            ? Number(focused.dataset.line) : null;
        let focusTarget = null;
        for (const dot of dots) {
            const marker = this.marker(dot, dot.line === current?.line);
            fragment.appendChild(marker);
            if (focusedLine !== null && typeof dot.folded === "boolean"
                && (!focusTarget || Math.abs(dot.line - focusedLine) < Math.abs(Number(focusTarget.dataset.line) - focusedLine))) {
                focusTarget = marker;
            }
        }
        this.svg.replaceChildren(fragment);
        focusTarget?.focus({ preventScroll: true });
        return false;
    }

    marker({ line, level, x, y, folded, label }, current) {
        const interactive = typeof folded === "boolean";
        const state = ` hbg-level-${level}` + (current ? " is-current" : "") + (folded ? " is-folded" : "");
        const group = svgElement(this.doc, "g", {
            class: (interactive ? "hbg-toggle" : "hbg-marker") + state,
            "data-line": line, "data-level": level,
            "pointer-events": interactive ? "all" : "none",
        });
        if (interactive) {
            const name = `${folded ? "展开" : "收起"}第 ${level} 级标题${label ? "「" + label + "」" : "（第 " + (line + 1) + " 行）"}`;
            group.setAttribute("role", "button");
            group.setAttribute("tabindex", "0");
            group.setAttribute("aria-expanded", String(!folded));
            group.setAttribute("aria-label", name);
            const title = svgElement(this.doc, "title", {});
            title.textContent = name;
            group.appendChild(title);
            group.appendChild(svgElement(this.doc, "rect", {
                class: "hbg-hit", x: Math.max(0, x - 12), y: y - 12,
                width: 24, height: 24, fill: "transparent", "aria-hidden": "true",
            }));
        } else {
            group.setAttribute("aria-hidden", "true");
        }
        group.appendChild(svgElement(this.doc, "circle", {
            class: "hbg-node" + state, "data-line": line, "data-level": level, cx: x, cy: y,
            r: folded ? 4.6 : current ? 4.2 : 3.8,
            fill: "var(--hbg-node-bg)", stroke: "var(--hbg-node-border)",
            "stroke-width": 1.5, "aria-hidden": "true",
        }));
        const digit = svgElement(this.doc, "text", {
            class: "hbg-depth" + state, x: x + 12.5, y: y + 0.15, "aria-hidden": "true",
            "text-anchor": "middle", "dominant-baseline": "central",
        });
        digit.textContent = String(level);
        group.appendChild(digit);
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
        this.signature = null;
        if (this.svg.firstChild) this.svg.replaceChildren();
    }

    destroy() {
        for (const name of this.events) this.svg.removeEventListener(name, this.onInput);
        this.detach();
        this.host.style.removeProperty("--hbg-gutter");
        this.host.style.removeProperty("--hbg-step");
        this.headings = null;
        this.index = null;
    }
}

module.exports = { GraphLayer };
