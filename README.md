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

### Firefox (recommended: from the store)

Install from **[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/cited-where/)**.
This is the easiest way: it's one click, stays installed, and updates automatically.

### Chrome, Edge, Brave and other Chromium browsers

1. Download this repository: click the green **Code** button at the top of this page,
   then **Download ZIP**, and unzip it somewhere you'll keep it. The browser loads the
   extension from that folder, so don't delete or move it afterwards.
2. Open the extensions page: `chrome://extensions` (Chrome, Brave) or `edge://extensions` (Edge).
3. Turn on **Developer mode** (a switch in the top-right corner; on the left in Edge).
4. Click **Load unpacked** and select the `extension` folder inside the unzipped folder
   (the one containing `manifest.json`, not the top-level folder).
5. Optional: click the puzzle-piece icon in the toolbar and pin **Cited where?**.

It stays installed after restarts. Chrome may remind you at startup that a
developer-mode extension is installed; that's normal for extensions not from the
Chrome Web Store.

**Updating:** download the ZIP again, replace the old folder's contents with the new
ones, and click the reload arrow on the extension's card in `chrome://extensions`.

### Firefox from the downloaded files (without the store)

Regular Firefox only installs extensions permanently if Mozilla has signed them, and
signing happens through the store. Without the store you have two options.

**Option A: temporary install (any Firefox, good for trying it out or testing changes)**

1. Download and unzip this repository as in step 1 above.
2. Open `about:debugging#/runtime/this-firefox` (type it into the address bar).
3. Click **Load Temporary Add-on…** and select the `manifest.json` file inside the
   `extension` folder.
4. If arXiv PDFs don't open in the viewer, open `about:addons`, click **Cited where?**,
   go to the **Permissions** tab and allow access to arxiv.org.

Firefox removes temporary add-ons when it restarts, so you'll need to repeat step 3
after each restart.

**Option B: permanent install without signing (Firefox Developer Edition or Nightly only)**

These Firefox versions can be told to accept unsigned extensions. Regular Firefox
ignores this setting.

1. Open `about:config`, accept the warning, search for `xpinstall.signatures.required`
   and set it to **false** (double-click it).
2. Open the `extension` folder, select **everything inside it**, and compress those files
   into a ZIP (Windows: right-click → *Send to* → *Compressed (zipped) folder*;
   macOS: right-click → *Compress*). `manifest.json` must be at the top level of the
   ZIP, not inside a folder.
3. Open `about:addons`, click the gear icon, choose **Install Add-on From File…**, and
   select the ZIP.

Note that turning off signature checks applies to all extensions in that Firefox
profile, not just this one. If you later install the store version, remove this one first;
both use the same extension ID.

## Use

- Open an arXiv paper (PDF, abstract or HTML page) and click the **Cited where?** toolbar
  button, or press **Alt+Shift+C**. The paper opens in the Cited where? viewer.
  In Firefox the button may be inside the puzzle-piece menu at first; right-click it there and
  choose *Pin to Toolbar*.
- To open arXiv PDFs in the viewer automatically instead, turn it on under **Settings**
  (a link in the viewer's toolbar, or the extension's options in `about:addons` /
  `chrome://extensions`). It's off by default.
- The shortcut can be changed: Firefox `about:addons` → gear → *Manage Extension Shortcuts*;
  Chrome `chrome://extensions/shortcuts`.
- With **Citation** selected, type a citation number, an author or an arXiv ID in the search
  box and press Enter. Enter again goes to the next place, Shift+Enter to the previous one.
- Or **right-click any entry in the bibliography** and choose *Find where this is cited*.
  This works on any line of the entry and in either search mode; it switches to Citation
  by itself.
- If several references match, pick one from the list.
- **Ctrl+F** (⌘F) works like the browser's find: it switches to **Text** search, finds as you
  type, and highlights all matches across the whole PDF. Enter, F3 or Ctrl+G go to the next
  match; add Shift for the previous one. Click **Citation** to go back to citation search.
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

## License

[MIT](LICENSE). The bundled PDF.js library is © Mozilla and contributors, under the
Apache License 2.0 ([extension/lib/LICENSE-pdfjs.txt](extension/lib/LICENSE-pdfjs.txt)).
