# Firefox Add-ons listing (copy into the submission form)

## Name
Cited where?

## Summary (max 250 characters)
Jump to every place a reference is cited in an arXiv paper. Type a citation number, author or arXiv ID, or right-click a bibliography entry, and it scrolls to each citation and highlights it, even inside ranges like [115–120].

## Description
Papers link from a citation to the bibliography, but not back. Cited where? does the reverse.

Open any arXiv PDF and it loads in a built-in viewer (based on Mozilla's PDF.js) with a citation search box:

• Type a citation number like 118. It also finds it inside compressed ranges such as [115–120] and lists such as [112, 118], which Ctrl+F can't.
• Type an author, as cited ("Louis et al. 2025") or as written in the bibliography ("Louis, T., et al. 2025").
• Type the cited paper's arXiv ID, e.g. 2005.05290.
• Or right-click any entry in the bibliography and choose "Find where this is cited".

The viewer scrolls to each place the reference is cited and highlights the sentence for a few seconds, with its page and section. Press Enter for the next place.

Works with numbered and author–year citation styles. Ordinary text search, an "Abstract page" link (handy for saving with Zotero) and the original PDF are one click away.

Privacy: no data collection. The extension only talks to arxiv.org, and everything is processed in your browser.

Open source (MIT): GITHUB LINK

## Categories
Search Tools (and Other, if a second is allowed)

## Tags
arxiv, citations, references, research, pdf, academic

## Support / homepage
Homepage and support: your GitHub repository link (Issues page for bug reports)

## License
MIT

## Privacy policy
Not needed (no data collected). If asked, paste the text of PRIVACY.md.

---

## Notes to reviewer (paste into "Notes for Reviewers")

extension/lib/ contains PDF.js 4.10.38, unmodified, from the pdfjs-dist npm package
(build/pdf.min.mjs, build/pdf.worker.min.mjs, web/pdf_viewer.mjs, web/pdf_viewer.css,
web/images, cmaps, standard_fonts). All other code is unminified and written for this extension.
The linter's eval/innerHTML warnings all come from these PDF.js files; the viewer loads
PDF.js with isEvalSupported: false.

How to test:
1. Open https://arxiv.org/pdf/2503.14738 — it opens in the extension's viewer.
2. Type 118 in the search box and press Enter: it scrolls to the citation and highlights it.
   Press Enter again for the next place.
3. Scroll to the references and right-click any entry → "Find where this is cited".

Network access is limited to arxiv.org: the PDF (/pdf/) and, only when an arXiv ID can't be
matched from the PDF, the LaTeX source (/e-print/). Nothing is stored or sent elsewhere.
background.js only redirects arxiv.org/pdf/ tabs to the bundled viewer and handles the
toolbar button.
