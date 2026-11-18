"use strict";

// Keep input on the SVG root: graph paths and marker contents can change without
// adding listeners or interrupting the editor's own pointer/keyboard handling.
class GraphInteraction {
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
            pointerover: event => this.onPointer(event),
            pointermove: event => this.onPointer(event),
            pointerout: event => this.onPointerOut(event),
            pointercancel: event => this.onPointerOut(event, true),
            focusin: event => this.onFocus(event),
            focusout: event => this.onFocusOut(event),
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
        // Touch pointerover is a contact event, not a hover preview. A hovering
        // pen is allowed, but its pressed tip must behave like normal input.
        return event.pointerType !== "touch"
            && (event.pointerType !== "pen" || !event.buttons);
    }

    onPointer(event) {
        if (!this.canHover(event)) return;
        const line = this.line(event.target);
        if (line === null || (this.visibleLines && !this.visibleLines.has(line))) return;
        this.pointer = { x: event.clientX, y: event.clientY };
        // Moving within one marker should not override a later keyboard focus.
        if (this.pointerLine === line) return;
        this.pointerLine = line;
        this.preferred = "pointer";
        this.schedule();
    }

    onPointerOut(event, cancelled = false) {
        if (!this.canHover(event)) return;
        const from = this.line(event.target);
        // Removing an obsolete marker can emit boundary events during a draw.
        // sync() already remapped it; a post-paint hit test resolves the pointer.
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
        const visibleAncestor = line => {
            const visited = new Set();
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
            const active = this.doc.activeElement;
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
                const active = this.doc.activeElement;
                // Never take focus back from an input the user has moved into.
                if (active === restore.from || !active || active === this.doc.body
                    || active === this.doc.documentElement || !active.isConnected) {
                    const target = this.svg.querySelector(`g[data-line="${restore.line}"]`);
                    if (target) {
                        this.restoring = true;
                        try { target.focus({ preventScroll: true }); }
                        finally { this.restoring = false; }
                    }
                }
                this.focusLine = this.line(this.doc.activeElement);
            }
            if (this.checkPointer) {
                this.checkPointer = false;
                const point = this.pointer;
                this.pointerLine = point && Number.isFinite(point.x + point.y)
                    ? this.line(this.doc.elementFromPoint(point.x, point.y)) : null;
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
}

module.exports = { GraphInteraction };
