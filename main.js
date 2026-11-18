var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// filename.js
var require_filename = __commonJS({
  "filename.js"(exports2, module2) {
    "use strict";
    var TITLE_SELECTOR = [
      ":scope > .inline-title",
      ":scope > .title-wrapper > .inline-title",
      ":scope > .mod-header > .inline-title",
      ":scope > .mod-header > .title-wrapper > .inline-title"
    ].join(", ");
    function measureFilename(sizer, originClientTop, scaleY = 1) {
      const title = sizer.querySelector(TITLE_SELECTOR);
      const firstBox = title?.getClientRects()[0];
      if (!firstBox || firstBox.height <= 0 || firstBox.width <= 0) return null;
      const style = title.ownerDocument.defaultView.getComputedStyle(title);
      if (style.visibility !== "visible") return null;
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const center = style.display === "inline" ? firstBox.height / (2 * scaleY) : (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0) + lineHeight / 2;
      return (firstBox.top - originClientTop) / scaleY + center;
    }
    function filenameOrigin({ filenameY, first, visible, firstLine, top, bottom, step }) {
      const result = { path: "", markerY: null };
      if (!first || !Number.isFinite(filenameY)) return result;
      if (filenameY >= top - 6 && filenameY <= bottom + 6) result.markerY = filenameY;
      const firstY = visible.get(first.line);
      const start = Math.max(top, filenameY);
      if (start >= bottom) return result;
      if (!Number.isFinite(firstY)) {
        if (firstLine < first.line || result.markerY !== null) result.path = `M9 ${start}V${bottom}`;
        return result;
      }
      if (firstY <= start) return result;
      const x = 9 + (first.level - 1) * step;
      if (first.level === 1) {
        result.path = `M9 ${start}V${Math.min(firstY, bottom)}`;
      } else {
        const rise = Math.min(firstY - filenameY, 28 + (x - 9) * 0.55);
        const fork = firstY - rise;
        if (fork >= bottom) {
          result.path = `M9 ${start}V${bottom}`;
        } else {
          const landing = firstY - Math.min(10, rise * 0.35);
          const handle = (landing - fork) * 0.54;
          result.path = `M9 ${Math.min(start, fork)}V${fork}C9 ${fork + handle} ${x} ${landing - handle} ${x} ${landing}V${firstY}`;
        }
      }
      return result;
    }
    module2.exports = { measureFilename, filenameOrigin };
  }
});

// graph.js
var require_graph = __commonJS({
  "graph.js"(exports2, module2) {
    "use strict";
    var { filenameOrigin } = require_filename();
    var SVG_NS = "http://www.w3.org/2000/svg";
    var laneX = (level, step) => 9 + (level - 1) * step;
    var round = (value) => Math.round(value * 10) / 10;
    function svgElement(doc, name, attrs) {
      const element = doc.createElementNS(SVG_NS, name);
      for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, String(value));
      }
      return element;
    }
    function indexHeadings(headings) {
      const byLine = /* @__PURE__ */ new Map();
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
        const node = {
          line,
          level,
          index: ordered.length,
          source,
          fork: source === parent ? parent : null
        };
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
      const rise = Number.isFinite(previousY) ? Math.min(desiredRise, Math.max(0, y - previousY - 4)) : desiredRise;
      const start = y - rise;
      const landing = y - Math.min(10, rise * 0.41);
      const handle = (landing - start) * 0.54;
      const fromX = laneX(node.fork.level, step);
      const x = laneX(node.level, step);
      const curve = `C${fromX} ${round(start + handle)} ${x} ${round(landing - handle)} ${x} ${round(landing)}`;
      return { start, landing, fromX, curve };
    }
    var GraphLayer = class {
      constructor(host, scroller, onToggle) {
        this.host = host;
        this.scroller = scroller;
        this.onToggle = onToggle;
        this.doc = host.ownerDocument;
        this.mount = null;
        this.plane = this.doc.createElement("div");
        this.plane.className = "hbg-plane";
        this.plane.style.cssText = "position:absolute;inset:0;overflow:clip;contain:strict;pointer-events:none;overflow-anchor:none;z-index:1";
        this.svg = svgElement(this.doc, "svg", {
          class: "hbg-graph",
          role: "group",
          "aria-label": "\u6807\u9898\u5206\u652F",
          focusable: "false"
        });
        this.svg.style.cssText = "position:absolute;pointer-events:none;overflow:hidden;user-select:none";
        this.onInput = (event) => {
          const button = event.target.closest?.(".hbg-toggle");
          if (!button || !this.svg.contains(button)) return;
          if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
          if ("button" in event && event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.type === "click" || event.type === "keydown" && !event.repeat) {
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
        const scale = (measured, layout) => {
          const value = layout && measured / layout;
          return value && Math.abs(1 - value) > 2e-3 ? value : 1;
        };
        const scaleX = scale(viewport.width, scroller.offsetWidth);
        const scaleY = scale(viewport.height, scroller.offsetHeight);
        const borderTop = viewport.top + scroller.clientTop * scaleY;
        const viewportClientTop = Math.max(host.top, borderTop);
        const viewportClientBottom = Math.min(host.bottom, borderTop + scroller.clientHeight * scaleY);
        const contentTop = rect.top + mount.clientTop * scaleY;
        const contentLeft = rect.left + mount.clientLeft * scaleX;
        const band = Math.ceil(Math.min(384, Math.max(128, scroller.clientHeight / 3)));
        const firstBand = Math.floor((viewportClientTop - contentTop) / scaleY / band) - 1;
        const lastBand = Math.ceil((viewportClientBottom - contentTop) / scaleY / band) + 1;
        const top = Math.min(mount.clientHeight, Math.max(0, firstBand * band));
        const bottom = Math.max(top, Math.min(mount.clientHeight, lastBand * band));
        return {
          top,
          height: bottom - top,
          viewportClientTop,
          viewportClientBottom,
          scaleX,
          scaleY,
          originClientTop: contentTop + top * scaleY,
          limitClientBottom: contentTop + bottom * scaleY,
          localX: (clientX) => (clientX - contentLeft) / scaleX
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
      draw({
        mount = this.host,
        left,
        top,
        width,
        height,
        headings,
        startLine,
        endLine,
        activeLine = startLine,
        visible,
        folds,
        labels,
        maxLevel = null,
        filenameY = null,
        firstY = 0,
        lastY = height
      }) {
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
          return true;
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
        const paths = Array(7).fill("");
        const forkStarts = /* @__PURE__ */ new Map();
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
            const sourceY = visible.get(node.source.line);
            if (Number.isFinite(sourceY) || node.source.line <= startLine) {
              const begin = Math.max(topY, y - 10, sourceY ?? topY);
              const end = Math.min(bottomY, y);
              if (end > begin) currentEdge = `M${x} ${round(begin)}V${round(end)}`;
            }
          }
          if (y >= topY - 12 && y <= bottomY + 12) {
            const folded = this.onToggle && folds?.get(line);
            const label = typeof folded === "boolean" ? labels?.get(line) : void 0;
            dots.push({ level: node.level, line, x, y: round(y), folded, label });
          }
        }
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
        const origin = filenameOrigin({
          filenameY,
          first: ordered[0],
          visible,
          firstLine: startLine,
          top: topY,
          bottom: bottomY,
          step
        });
        paths[0] = origin.path;
        const signature = paths.join("|") + `;${origin.markerY};${current?.line};${currentEdge};` + JSON.stringify(dots);
        if (signature === this.signature) return false;
        this.signature = signature;
        const fragment = this.doc.createDocumentFragment();
        for (let level = 0; level < paths.length; level++) {
          if (!paths[level]) continue;
          fragment.appendChild(svgElement(this.doc, "path", {
            class: "hbg-edge hbg-network" + (level ? ` hbg-level-${level}` : ""),
            d: paths[level],
            stroke: "var(--hbg-rail)",
            fill: "none",
            "stroke-width": 1.5,
            "stroke-linecap": "butt",
            "stroke-linejoin": "round",
            "aria-hidden": "true"
          }));
        }
        if (currentEdge) {
          fragment.appendChild(svgElement(this.doc, "path", {
            class: `hbg-edge hbg-current-edge hbg-level-${current.level}`,
            d: currentEdge,
            "data-line": current.line,
            stroke: "var(--hbg-node-border)",
            fill: "none",
            "stroke-linecap": "butt",
            "stroke-width": 1.5,
            "aria-hidden": "true"
          }));
        }
        if (Number.isFinite(origin.markerY)) {
          fragment.appendChild(svgElement(this.doc, "circle", {
            class: "hbg-origin",
            cx: 9,
            cy: origin.markerY,
            r: 5.2,
            "aria-hidden": "true"
          }));
          fragment.appendChild(svgElement(this.doc, "circle", {
            class: "hbg-origin-center",
            cx: 9,
            cy: origin.markerY,
            r: 2,
            "aria-hidden": "true"
          }));
        }
        const focused = this.doc.activeElement;
        const focusedLine = focused?.matches(".hbg-toggle") && this.svg.contains(focused) ? Number(focused.dataset.line) : null;
        let focusTarget = null;
        for (const dot of dots) {
          const marker = this.marker(dot, dot.line === current?.line);
          fragment.appendChild(marker);
          if (focusedLine !== null && typeof dot.folded === "boolean" && (!focusTarget || Math.abs(dot.line - focusedLine) < Math.abs(Number(focusTarget.dataset.line) - focusedLine))) {
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
          "data-line": line,
          "data-level": level,
          "pointer-events": interactive ? "all" : "none"
        });
        if (interactive) {
          const name = `${folded ? "\u5C55\u5F00" : "\u6536\u8D77"}\u7B2C ${level} \u7EA7\u6807\u9898${label ? "\u300C" + label + "\u300D" : "\uFF08\u7B2C " + (line + 1) + " \u884C\uFF09"}`;
          group.setAttribute("role", "button");
          group.setAttribute("tabindex", "0");
          group.setAttribute("aria-expanded", String(!folded));
          group.setAttribute("aria-label", name);
          const title = svgElement(this.doc, "title", {});
          title.textContent = name;
          group.appendChild(title);
          group.appendChild(svgElement(this.doc, "rect", {
            class: "hbg-hit",
            x: Math.max(0, x - 12),
            y: y - 12,
            width: 24,
            height: 24,
            fill: "transparent",
            "aria-hidden": "true"
          }));
        } else {
          group.setAttribute("aria-hidden", "true");
        }
        group.appendChild(svgElement(this.doc, "circle", {
          class: "hbg-node" + state,
          "data-line": line,
          "data-level": level,
          cx: x,
          cy: y,
          r: folded ? 4.6 : current ? 4.2 : 3.8,
          fill: "var(--hbg-node-bg)",
          stroke: "var(--hbg-node-border)",
          "stroke-width": 1.5,
          "aria-hidden": "true"
        }));
        const digit = svgElement(this.doc, "text", {
          class: "hbg-depth" + state,
          x: x + 12.5,
          y: y + 0.15,
          "aria-hidden": "true",
          "text-anchor": "middle",
          "dominant-baseline": "central"
        });
        digit.textContent = String(level);
        group.appendChild(digit);
        if (interactive) {
          const symbol = `M${x - 2} ${y}h4` + (folded ? `M${x} ${y - 2}v4` : "");
          group.appendChild(svgElement(this.doc, "path", {
            class: "hbg-action-glyph",
            d: symbol,
            display: folded ? "inline" : "none",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": 1,
            "stroke-linecap": "round",
            "aria-hidden": "true"
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
    };
    module2.exports = { GraphLayer };
  }
});

// editor.js
var require_editor = __commonJS({
  "editor.js"(exports2, module2) {
    var { ViewPlugin } = require("@codemirror/view");
    var { StateEffect } = require("@codemirror/state");
    var {
      codeFolding,
      ensureSyntaxTree,
      foldable,
      foldEffect,
      foldedRanges,
      foldState,
      language,
      syntaxTree,
      unfoldEffect
    } = require("@codemirror/language");
    var { GraphLayer } = require_graph();
    var { measureFilename } = require_filename();
    function collectHeadings(tree, document) {
      const headings = [];
      const lines = /* @__PURE__ */ new Set();
      tree.iterate({
        enter(node) {
          const match = node.name.match(/(?:^|_)HyperMD-header-([1-6])(?:_|$)/) || node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
          if (!match) return;
          const line = document.lineAt(node.from);
          if (!lines.has(line.number)) {
            headings.push({
              line: line.number - 1,
              level: Number(match[1]),
              position: line.from,
              sectionEnd: document.length
            });
            lines.add(line.number);
          }
          return false;
        }
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
    var EditorGraph = class {
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
        const host = view.dom.closest(".markdown-source-view");
        if (!host?.closest('.workspace-leaf-content[data-type="markdown"]') || view.dom.parentElement?.closest(".cm-editor")) return;
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
        this.host.classList.add("hbg-editor");
        this.layer = new GraphLayer(this.host, view.scrollDOM, (line) => this.toggleFold(line));
        this.measureRequest = {
          key: this,
          read: () => this.measure(),
          write: (geometry) => this.paint(geometry)
        };
        this.onScroll = () => this.scheduleMeasure();
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
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
        if (this.completeDocument !== state.doc || heading.sectionEnd <= lastTitleLine.to) return null;
        const bodyStart = Math.min(lastTitleLine.to + 1, heading.sectionEnd);
        const content = state.doc.iterRange(bodyStart, heading.sectionEnd);
        while (!content.next().done) {
          if (/\S/.test(content.value)) {
            return {
              range: { from: lastTitleLine.to, to: heading.sectionEnd },
              folded: false
            };
          }
        }
        return null;
      }
      toggleFold(lineNumber) {
        if (this.destroyed || !this.enabled || !Number.isInteger(lineNumber) || lineNumber < 0 || lineNumber >= this.view.state.doc.lines) return;
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
        const sizer = view.contentDOM.closest(".cm-sizer");
        if (!sizer) return null;
        const frame = this.layer.measureWindow(sizer);
        const style = this.window.getComputedStyle(this.host);
        const width = parseFloat(style.getPropertyValue("--hbg-gutter")) || 0;
        const lineArea = Math.max(0, frame.localX(view.contentDOM.getBoundingClientRect().left) - width);
        const headings = this.expandedHeadings();
        const visible = /* @__PURE__ */ new Map();
        const folds = /* @__PURE__ */ new Map();
        const labels = /* @__PURE__ */ new Map();
        for (const range of view.visibleRanges) {
          let index = firstHeadingAt(headings, range.from);
          while (index < headings.length && headings[index].position <= range.to) {
            const heading = headings[index];
            const coordinates = view.coordsAtPos(heading.position, 1);
            if (coordinates) {
              visible.set(
                heading.line,
                ((coordinates.top + coordinates.bottom) / 2 - frame.originClientTop) / frame.scaleY
              );
              const fold = this.headingFold(heading);
              if (fold) folds.set(heading.line, fold.folded);
              const text = view.state.doc.line(heading.line + 1).text.replace(/^ {0,3}#{1,6}(?:\s+|$)/, "").replace(/\s+#+\s*$/, "").trim();
              labels.set(heading.line, text || `\u7B2C ${heading.line + 1} \u884C\u6807\u9898`);
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
          labels
        };
      }
      paint(geometry) {
        if (this.destroyed || !geometry) return;
        if (geometry.lineArea !== this.lineArea) {
          this.lineArea = geometry.lineArea;
          this.host.style.setProperty("--hbg-line-area", `${this.lineArea}px`);
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
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.layer.destroy();
        this.host.style.removeProperty("--hbg-line-area");
        this.host.classList.remove("hbg-editor");
      }
    };
    function editorExtension2() {
      return ViewPlugin.fromClass(EditorGraph);
    }
    module2.exports = { editorExtension: editorExtension2 };
  }
});

// reading.js
var require_reading = __commonJS({
  "reading.js"(exports2, module2) {
    var { GraphLayer } = require_graph();
    var { measureFilename } = require_filename();
    var HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
    var EMBED_SELECTOR = ".markdown-embed, .internal-embed, .markdown-embed-content";
    function hasSourcePosition(section) {
      return Number.isInteger(section.start?.line) && Number.isInteger(section.end?.line);
    }
    function isHeadingSection(section) {
      return section.level >= 1 && section.level <= 6;
    }
    function stableOutline(previous, next) {
      return previous.length === next.length && next.every(
        (item, index) => item.line === previous[index].line && item.level === previous[index].level
      ) ? previous : next;
    }
    function findHeadingElement(section, sizer) {
      const elements = section.el.matches(HEADING_SELECTOR) ? [section.el] : section.el.querySelectorAll(HEADING_SELECTOR);
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
    var ReadingGraph = class {
      constructor(view, host, scroller) {
        this.view = view;
        this.host = host;
        this.scroller = scroller;
        this.window = host.ownerDocument.defaultView;
        this.sizer = null;
        this.headings = [];
        this.headingByLine = /* @__PURE__ */ new Map();
        this.maxLevel = 0;
        this.cachedSections = null;
        this.sectionByElement = /* @__PURE__ */ new WeakMap();
        this.sourceCacheDirty = true;
        this.firstLine = 0;
        this.lastLine = 0;
        this.frame = null;
        this.destroyed = false;
        this.schedule = this.schedule.bind(this);
        this.onMutations = this.onMutations.bind(this);
        this.onClick = this.onClick.bind(this);
        host.classList.add("hbg-reading");
        this.layer = new GraphLayer(host, scroller, (line) => this.toggleFold(line));
        this.mutations = new this.window.MutationObserver(this.onMutations);
        this.mutations.observe(scroller, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["class", "style"]
        });
        this.mutations.observe(host, {
          attributes: true,
          attributeFilter: ["class", "style"]
        });
        this.resize = new this.window.ResizeObserver(this.schedule);
        this.resize.observe(host);
        this.resize.observe(scroller);
        scroller.addEventListener("scroll", this.schedule, { passive: true });
        scroller.addEventListener("click", this.onClick);
        this.schedule();
      }
      isReading() {
        return this.view.currentMode === this.view.previewMode || this.view.getState?.().mode === "preview";
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
        control.dispatchEvent(new this.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0
        }));
        this.sourceCacheDirty = true;
        this.schedule();
      }
      onMutations(records) {
        let changed = false;
        for (const record of records) {
          if (record.target.closest?.(".hbg-plane, .hbg-graph")) continue;
          if (record.type === "childList" && record.removedNodes.length === 0 && record.addedNodes.length > 0 && [...record.addedNodes].every((node) => node.matches?.(".hbg-plane, .hbg-graph"))) continue;
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
        this.sectionByElement = /* @__PURE__ */ new WeakMap();
        this.headingByLine = /* @__PURE__ */ new Map();
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
        this.updateSourceCache(renderer);
        const frame = this.layer.measureWindow(sizer);
        if (!frame) return;
        const sizerRect = sizer.getBoundingClientRect();
        const style = this.window.getComputedStyle(this.host);
        const gutter = parseFloat(style.getPropertyValue("--hbg-gutter")) || 0;
        const step = parseFloat(style.getPropertyValue("--hbg-step")) || 0;
        const visible = /* @__PURE__ */ new Map();
        const folds = /* @__PURE__ */ new Map();
        const labels = /* @__PURE__ */ new Map();
        let startLine = Infinity;
        let endLine = -1;
        let activeLine = Infinity;
        let nearestSection = null;
        let nearestDistance = Infinity;
        let activeSection = null;
        let activeDistance = Infinity;
        for (const element of sizer.children) {
          const section = this.sectionByElement.get(element)?.section;
          if (!section || section.shown === false) continue;
          const rect = element.getBoundingClientRect();
          if (rect.height <= 0) continue;
          const distance = Math.max(
            frame.originClientTop - rect.bottom,
            rect.top - frame.limitClientBottom,
            0
          );
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestSection = section;
          }
          if (rect.bottom >= frame.originClientTop && rect.top <= frame.limitClientBottom) {
            startLine = Math.min(startLine, section.start.line);
            endLine = Math.max(endLine, section.end.line);
          }
          const viewportDistance = Math.max(
            frame.viewportClientTop - rect.bottom,
            rect.top - frame.viewportClientBottom,
            0
          );
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
          const lineHeight = parseFloat(headingStyle.lineHeight) || parseFloat(headingStyle.fontSize) * 1.4;
          const paddingTop = parseFloat(headingStyle.paddingTop) || 0;
          const borderTop = parseFloat(headingStyle.borderTopWidth) || 0;
          visible.set(
            section.start.line,
            (headingRect.top - frame.originClientTop) / frame.scaleY + paddingTop + borderTop + lineHeight / 2
          );
          labels.set(
            section.start.line,
            heading.getAttribute("data-heading") ?? heading.textContent.trim()
          );
          if (findFoldControl(heading, this.scroller)) {
            folds.set(section.start.line, Boolean(section.headingCollapsed));
          }
        }
        if (!Number.isFinite(startLine)) {
          startLine = nearestSection?.start.line ?? (this.scroller.scrollTop > 0 ? this.lastLine : this.firstLine);
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
          filenameY: measureFilename(sizer, frame.originClientTop, frame.scaleY)
        });
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
    };
    function registerReading2(plugin) {
      const instances = /* @__PURE__ */ new Map();
      let disposed = false;
      function syncViews() {
        if (disposed) return;
        const current = /* @__PURE__ */ new Set();
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
    module2.exports = { registerReading: registerReading2 };
  }
});

// plugin.js
var { Plugin } = require("obsidian");
var { editorExtension } = require_editor();
var { registerReading } = require_reading();
module.exports = class GitBranchEditor extends Plugin {
  onload() {
    this.registerEditorExtension(editorExtension());
    registerReading(this);
  }
};
