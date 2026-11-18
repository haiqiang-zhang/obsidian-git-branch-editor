var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// interaction.js
var require_interaction = __commonJS({
  "interaction.js"(exports2, module2) {
    "use strict";
    var GraphInteraction = class {
      constructor(svg, onChange) {
        this.svg = svg;
        this.doc = svg.ownerDocument;
        this.window = this.doc.defaultView;
        this.onChange = onChange;
        this.pointerLine = null;
        this.focusLine = null;
        this.preferred = "pointer";
        this.paintedLine = null;
        this.visibleLines = null;
        this.pointer = null;
        this.restoreFocus = null;
        this.checkPointer = false;
        this.restoring = false;
        this.frame = null;
        this.destroyed = false;
        this.listeners = {
          pointerover: (event) => this.onPointer(event),
          pointermove: (event) => this.onPointer(event),
          pointerout: (event) => this.onPointerOut(event),
          pointercancel: (event) => this.onPointerOut(event, true),
          focusin: (event) => this.onFocus(event),
          focusout: (event) => this.onFocusOut(event)
        };
        for (const [type, listener] of Object.entries(this.listeners)) {
          svg.addEventListener(type, listener);
        }
        this.onWindowBlur = () => {
          this.pointerLine = null;
          this.pointer = null;
          this.schedule();
        };
        this.window.addEventListener("blur", this.onWindowBlur);
      }
      get previewLine() {
        if (this.preferred === "focus" && this.focusLine !== null) return this.focusLine;
        return this.pointerLine ?? this.focusLine;
      }
      activeElement() {
        return this.svg.getRootNode?.().activeElement ?? this.doc.activeElement;
      }
      elementFromPoint(x, y) {
        const root = this.svg.getRootNode?.();
        return typeof root?.elementFromPoint === "function" ? root.elementFromPoint(x, y) : this.doc.elementFromPoint(x, y);
      }
      marker(target) {
        const element = target?.closest?.("g.hbg-toggle[data-line], g.hbg-marker[data-line]");
        return element && this.svg.contains(element) ? element : null;
      }
      line(target) {
        const marker = this.marker(target);
        if (!marker) return null;
        const line = Number(marker.dataset.line);
        return Number.isInteger(line) && line >= 0 ? line : null;
      }
      canHover(event) {
        return event.pointerType !== "touch" && (event.pointerType !== "pen" || !event.buttons);
      }
      onPointer(event) {
        if (!this.canHover(event)) return;
        const line = this.line(event.target);
        if (line === null || this.visibleLines && !this.visibleLines.has(line)) return;
        this.pointer = { x: event.clientX, y: event.clientY };
        if (this.pointerLine === line) return;
        this.pointerLine = line;
        this.preferred = "pointer";
        this.schedule();
      }
      onPointerOut(event, cancelled = false) {
        if (!this.canHover(event)) return;
        const from = this.line(event.target);
        if (from !== null && this.visibleLines && !this.visibleLines.has(from)) return;
        const next = cancelled ? null : this.line(event.relatedTarget);
        if (next === from && !cancelled) return;
        this.pointerLine = next;
        if (next === null) this.pointer = null;
        else {
          this.pointer = { x: event.clientX, y: event.clientY };
          this.preferred = "pointer";
        }
        this.schedule();
      }
      onFocus(event) {
        if (this.restoring) return;
        const line = this.line(event.target);
        if (line === null) return;
        this.focusLine = line;
        this.preferred = "focus";
        this.restoreFocus = null;
        this.schedule();
      }
      onFocusOut(event) {
        if (this.restoring) return;
        const from = this.line(event.target);
        if (from !== null && this.visibleLines && !this.visibleLines.has(from)) return;
        this.focusLine = this.line(event.relatedTarget);
        this.restoreFocus = null;
        this.schedule();
      }
      // Called before the renderer chooses its highlighted path. This is silent:
      // the caller is already drawing, so it must never recursively request a draw.
      sync(visibleLines, parentOf) {
        if (this.destroyed) return;
        this.visibleLines = visibleLines;
        const visibleAncestor = (line) => {
          const visited = /* @__PURE__ */ new Set();
          while (line !== null && !visibleLines.has(line)) {
            if (visited.has(line)) return null;
            visited.add(line);
            const parent = parentOf?.(line);
            line = Number.isInteger(parent) && parent >= 0 ? parent : null;
          }
          return line;
        };
        const pointerLine = visibleAncestor(this.pointerLine);
        const focusLine = visibleAncestor(this.focusLine);
        if (pointerLine !== this.pointerLine && this.pointer) {
          this.checkPointer = true;
          this.schedule();
        }
        if (focusLine !== this.focusLine) {
          const active = this.activeElement();
          if (focusLine !== null && this.marker(active)) {
            this.restoreFocus = { from: active, line: focusLine };
            this.schedule();
          }
        }
        this.pointerLine = pointerLine;
        this.focusLine = focusLine;
        this.paintedLine = this.previewLine;
      }
      schedule() {
        if (this.destroyed || this.frame !== null) return;
        this.frame = this.window.requestAnimationFrame(() => {
          this.frame = null;
          if (this.destroyed) return;
          const restore = this.restoreFocus;
          this.restoreFocus = null;
          if (restore) {
            const root = this.svg.getRootNode?.();
            const active = this.activeElement();
            if (active === restore.from || !active || active === this.doc.body || active === this.doc.documentElement || !active.isConnected || active === root?.host && !root.activeElement) {
              const target = this.svg.querySelector(`g[data-line="${restore.line}"]`);
              if (target) {
                this.restoring = true;
                try {
                  target.focus({ preventScroll: true });
                } finally {
                  this.restoring = false;
                }
              }
            }
            this.focusLine = this.line(this.activeElement());
          }
          if (this.checkPointer) {
            this.checkPointer = false;
            const point = this.pointer;
            this.pointerLine = point && Number.isFinite(point.x + point.y) ? this.line(this.elementFromPoint(point.x, point.y)) : null;
            if (this.pointerLine === null) this.pointer = null;
          }
          const next = this.previewLine;
          if (next === this.paintedLine) return;
          this.paintedLine = next;
          this.onChange(next);
        });
      }
      clear() {
        if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
        this.frame = null;
        this.pointerLine = null;
        this.focusLine = null;
        this.paintedLine = null;
        this.visibleLines = null;
        this.pointer = null;
        this.restoreFocus = null;
        this.checkPointer = false;
      }
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.clear();
        for (const [type, listener] of Object.entries(this.listeners)) {
          this.svg.removeEventListener(type, listener);
        }
        this.window.removeEventListener("blur", this.onWindowBlur);
      }
    };
    module2.exports = { GraphInteraction };
  }
});

// graph.js
var require_graph = __commonJS({
  "graph.js"(exports2, module2) {
    "use strict";
    var { GraphInteraction } = require_interaction();
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
      const rise = Number.isFinite(previousY) ? Math.min(desiredRise, Math.max(0, y - previousY - 4)) : desiredRise;
      const start = y - rise;
      const landing = y - Math.min(10, rise * 0.41);
      const handle = (landing - start) * 0.54;
      const fromX = laneX(fromLevel, step);
      const x = laneX(level, step);
      const curve = `C${fromX} ${round(start + handle)} ${x} ${round(landing - handle)} ${x} ${round(landing)}`;
      return { start, landing, fromX, x, curve };
    }
    var PathSlice = class {
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
    };
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
        this.background = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.highlight = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.origins = svgElement(this.doc, "g", { "aria-hidden": "true" });
        this.markers = svgElement(this.doc, "g", {});
        this.markerByLine = /* @__PURE__ */ new Map();
        this.svg.append(this.background, this.highlight, this.origins, this.markers);
        this.interaction = new GraphInteraction(this.svg, () => {
          if (this.lastDraw) this.draw(this.lastDraw);
        });
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
        this.focusObserver = new this.doc.defaultView.MutationObserver((records) => this.noteGraphRemoval(records));
        this.onFocus = () => {
          this.blurredFocus = this.pendingFocus = null;
          this.focusObserver.observe(this.host, { childList: true, subtree: true });
        };
        this.onBlur = (event) => this.trackReparentedFocus(event);
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
      draw(args) {
        if (this.lastDraw === args && this.layout) {
          this.paintRoute();
          return false;
        }
        this.lastDraw = args;
        this.layout = null;
        const {
          mount = this.host,
          left,
          top,
          width,
          height,
          headings,
          startLine,
          endLine,
          visible,
          folds,
          labels,
          maxLevel = null,
          filenameY = null,
          firstY = 0,
          lastY = height
        } = args;
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
        const { byLine, ordered, runs, roots } = this.index;
        if (!ordered.length) {
          this.clear();
          return false;
        }
        const paths = Array(7).fill("");
        const forks = /* @__PURE__ */ new Map();
        const dots = [];
        const hasFilename = Number.isFinite(filenameY);
        const yOf = (node) => visible.get(node.line) ?? (node.line <= startLine ? -Infinity : Infinity);
        const originY = hasFilename ? filenameY : yOf(ordered[0]);
        const rootConnectors = hasFilename || roots.length > 1;
        const forkOf = (node) => {
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
        const visibleLines = new Set(dots.map((dot) => dot.line));
        this.interaction.sync(visibleLines, (line) => {
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
              d: paths[level],
              stroke: "var(--hbg-rail)",
              fill: "none",
              "stroke-width": 1.5,
              "stroke-linecap": "butt",
              "stroke-linejoin": "round"
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
        const current = this.index.byLine.get(this.interaction.previewLine) ?? headingAt(this.index.ordered, activeLine);
        const chain = [];
        for (let at = current; at; at = at.parent) chain.push(at);
        chain.reverse();
        const ancestors = new Set(chain.slice(0, -1).map((node) => node.line));
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
            fill: "none",
            stroke: "var(--hbg-node-border)",
            "stroke-width": 2.25,
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
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
        const title = `\u7B2C ${level} \u7EA7\u6807\u9898${label ? "\u300C" + label + "\u300D" : "\uFF08\u7B2C " + (line + 1) + " \u884C\uFF09"}`;
        const name = interactive ? (folded ? "\u5C55\u5F00" : "\u6536\u8D77") + title : title;
        group.setAttribute("role", interactive ? "button" : "img");
        group.setAttribute("aria-label", name);
        if (interactive) group.setAttribute("aria-expanded", String(!folded));
        else group.removeAttribute("aria-expanded");
        const tooltip = svgElement(this.doc, "title", {});
        tooltip.textContent = name;
        group.appendChild(tooltip);
        group.appendChild(svgElement(this.doc, "rect", {
          class: "hbg-hit",
          x: Math.max(0, x - 12),
          y: y - 12,
          width: 24,
          height: 24,
          fill: "transparent",
          "aria-hidden": "true"
        }));
        group.dot = group.appendChild(svgElement(this.doc, "circle", {
          class: "hbg-node" + state,
          "data-line": line,
          "data-level": level,
          cx: x,
          cy: y,
          r: folded ? 4.6 : 3.8,
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
        group.digit = group.appendChild(digit);
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
    };
    module2.exports = { GraphLayer };
  }
});

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
    module2.exports = { measureFilename };
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
      constructor(view, plugin) {
        this.view = view;
        this.plugin = plugin;
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
        this.unbindPalette = this.plugin.bindPalette(host);
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
        this.unbindPalette();
        this.host.style.removeProperty("--hbg-line-area");
        this.host.classList.remove("hbg-editor");
      }
    };
    function editorExtension2(plugin) {
      return ViewPlugin.define((view) => new EditorGraph(view, plugin));
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
      constructor(view, host, scroller, plugin) {
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
        this.unbindPalette = plugin.bindPalette(host);
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
        this.unbindPalette();
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
            instance = new ReadingGraph(view, host, scroller, plugin);
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

// settings.js
var require_settings = __commonJS({
  "settings.js"(exports2, module2) {
    "use strict";
    var { PluginSettingTab, Setting } = require("obsidian");
    var DEFAULT_PALETTE2 = "theme";
    var PALETTES = {
      theme: "Theme (default)",
      flexoki: "Flexoki",
      primer: "GitHub Primer"
    };
    function validPalette2(value) {
      return typeof value === "string" && Object.prototype.hasOwnProperty.call(PALETTES, value);
    }
    var BranchSettingsTab2 = class extends PluginSettingTab {
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
          render: (setting) => this.renderPalette(setting)
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
        setting.addDropdown((dropdown) => {
          this.dropdown = dropdown;
          dropdown.selectEl.setAttribute("aria-label", "Color palette");
          dropdown.addOptions(PALETTES).onChange((value) => this.plugin.setPalette(value));
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
    };
    module2.exports = { BranchSettingsTab: BranchSettingsTab2, DEFAULT_PALETTE: DEFAULT_PALETTE2, validPalette: validPalette2 };
  }
});

// plugin.js
var { Notice, Plugin } = require("obsidian");
var { editorExtension } = require_editor();
var { registerReading } = require_reading();
var { BranchSettingsTab, DEFAULT_PALETTE, validPalette } = require_settings();
module.exports = class GitBranchEditor extends Plugin {
  async onload() {
    this.paletteHosts = /* @__PURE__ */ new Set();
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
