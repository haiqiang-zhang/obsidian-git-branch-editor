"use strict";

// Both modes move the same native, editable filename into their own header.
// Pretty Properties can wrap it alongside an icon.
const TITLE_SELECTOR = [
    ":scope > .inline-title",
    ":scope > .title-wrapper > .inline-title",
    ":scope > .mod-header > .inline-title",
    ":scope > .mod-header > .title-wrapper > .inline-title",
].join(", ");

function measureFilename(sizer, originClientTop, scaleY = 1) {
    const title = sizer.querySelector(TITLE_SELECTOR);
    const firstBox = title?.getClientRects()[0];
    if (!firstBox || firstBox.height <= 0 || firstBox.width <= 0) return null;
    const style = title.ownerDocument.defaultView.getComputedStyle(title);
    if (style.visibility !== "visible") return null;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const center = style.display === "inline"
        ? firstBox.height / (2 * scaleY)
        : (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0) + lineHeight / 2;
    return (firstBox.top - originClientTop) / scaleY + center;
}

// Join the filename to the first real section, including notes starting at H2–H6.
// The source line tells us when to continue the trunk through a long introduction.
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

module.exports = { measureFilename, filenameOrigin };
