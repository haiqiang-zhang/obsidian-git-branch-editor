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

module.exports = { measureFilename };
