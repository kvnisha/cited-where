# Cited where?

**Jump to every place a reference is cited in an arXiv paper.**

Papers link from a citation to the bibliography, but not back. Cited where? does the
reverse: pick a reference and it scrolls the PDF to each place that reference is cited
and briefly highlights the sentence.

- Type a **citation number** (`118`). It also finds the number inside compressed
  ranges like `[115–120]` or lists like `[112, 118]`, which plain Ctrl+F misses.
- Type an **author**, written either way: `Louis et al. 2025` (as cited) or
  `Louis, T., et al. 2025` (as in the bibliography).
- Type the cited paper's **arXiv ID** (`2005.05290`).
- Or **right-click any entry in the bibliography** → *Find where this is cited*.

Each place shows its page and section; press Enter (or ›) for the next one.

Works with Firefox, Chrome, Edge and Brave, for numbered and author–year citation styles.

## Install

**Firefox:** from Firefox Add-ons *(link coming once it's published)*.

**Chrome, Edge, Brave (from source):**
1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

**Firefox (from source, for testing):** go to `about:debugging#/runtime/this-firefox`,
click **Load Temporary Add-on…** and select `extension/manifest.json`. Temporary add-ons
are removed when Firefox restarts.

## Use

- Open any arXiv PDF (`arxiv.org/pdf/…`). It opens in the Cited where? viewer
  automatically. From an abstract or HTML page, click the toolbar icon.
- Type in the search box and press Enter. Enter again goes to the next place,
  Shift+Enter to the previous one.
- If several references match, pick one from the list.
- **Text** switches to ordinary text search; Ctrl+F (⌘F) jumps to the search box.
- **Abstract page** opens the arXiv abstract page in a new tab. Use it to save the paper
  with Zotero or other extensions, which browsers don't allow to work inside another
  extension's viewer.
- **Original PDF** opens the browser's normal PDF viewer.

## How it works

The viewer is built on Mozilla's [PDF.js](https://mozilla.github.io/pdf.js/). When a
paper loads, it reads the PDF's text and finds the bibliography:

- **Numbered styles:** it detects the `[1] [2] [3] …` sequence of the reference list,
  then finds every `[…]` citation in the text and expands ranges and lists.
- **Author–year styles:** it searches the text for the first author's surname followed by
  the year, ignoring initials and extra co-authors. For right-click, it identifies the
  entry from the bibliography's hanging indent.
- **arXiv IDs** are looked up in the reference list. If that fails (mostly in author–year
  papers), it downloads the paper's LaTeX source into memory, matches the ID there,
  and discards the source.

Section names come from the PDF's bookmarks.

| File | What it does |
| --- | --- |
| `extension/manifest.json` | Extension name, version and permissions |
| `extension/background.js` | Opens arXiv PDFs in the viewer; handles the toolbar button |
| `extension/viewer.html`, `viewer.css`, `viewer.js` | The viewer, search and highlighting |
| `extension/parser.js` | Reads LaTeX source (used for arXiv-ID lookups) |
| `extension/lib/` | PDF.js 4.10.38, unmodified, from the `pdfjs-dist` npm package |

## Privacy

No data is collected or sent anywhere. The extension only talks to arxiv.org.
See [PRIVACY.md](PRIVACY.md).

## Known limitations

- Numbered citations must be in square brackets; superscript numbers aren't recognised.
- Author–year matching uses the first author and the year, so collaboration papers from
  the same year (e.g. several "Planck Collaboration 2020" papers) can't be told apart.
- Highlight positions within a line are estimated from font metrics and can be a few
  pixels off.
- Only arXiv papers are supported.

## Contributing

Bug reports and suggestions are welcome: open an **Issue** with the arXiv ID of the paper
and what you searched for. Pull requests are welcome too.

To try a change, edit the files in `extension/` and reload the extension
(`about:debugging` → **Reload** in Firefox, or the reload arrow on `chrome://extensions`).

## License

[MIT](LICENSE). The bundled PDF.js library is © Mozilla and contributors, under the
Apache License 2.0 ([extension/lib/LICENSE-pdfjs.txt](extension/lib/LICENSE-pdfjs.txt)).
