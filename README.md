# Obsidian Git Branch Editor

An Obsidian plugin that connects headings with Git-style branch lines. Each of the six heading levels has its own color. Hover or focus a node to trace its path from the filename. Click it to fold or expand its section in the editor or Reading view.

<img src="examples/mlsys.webp" alt="Tracing the path to Pipeline Parallelism in MLSys, then folding and expanding the section" width="600">

Choose a color palette in **Settings → Git Branch Editor → Color palette**. Keep your theme colors or try a muted palette inspired by [Flexoki](https://stephango.com/flexoki) or [GitHub Primer](https://github.com/primer/primitives/tree/main/src/tokens/base/color).

## Install

1. In your vault, create `.obsidian/plugins/git-branch-editor/`.
2. Copy [main.js](main.js), [manifest.json](manifest.json), and [styles.css](styles.css) into that folder.
3. Reload Obsidian (1.12 or later), then enable **Git Branch Editor** under **Settings → Community plugins**.
