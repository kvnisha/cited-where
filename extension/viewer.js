/*
 * viewer.js — a PDF.js viewer that can jump to every place a reference is cited.
 *
 * Numbered papers ([1], [115–120], [3, 7]) are handled entirely from the PDF text.
 * Author–year papers are searched by author name (+ year). The LaTeX source is only
 * downloaded, into memory, when an arXiv ID has to be matched to an author–year entry,
 * or when an arXiv ID can't be found in the PDF's own reference list.
 */
import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
globalThis.pdfjsLib = pdfjsLib; // pdf_viewer.mjs reads it from here
const { PDFViewer, EventBus, PDFLinkService, PDFFindController } = await import('./lib/pdf_viewer.mjs');

const $ = id => document.getElementById(id);
const HIGHLIGHT_MS = 2400; // plus a 0.6 s fade = 3 s in total

/* ------------------------------------------------------------------ *
 * Viewer setup
 * ------------------------------------------------------------------ */

const container = $('viewerContainer');
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2 /* new tab */ });
const findController = new PDFFindController({ eventBus, linkService });
const viewer = new PDFViewer({ container, viewer: $('viewer'), eventBus, linkService, findController });
linkService.setViewer(viewer);
eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; });

// Keep the page area below the toolbar, whose height changes.
new ResizeObserver(() => { container.style.top = $('toolbar').offsetHeight + 'px'; }).observe($('toolbar'));

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let arxivId = null;
let pdfDoc = null;
let idx = null;        // { text, items }
let outline = [];      // [{ page, y, label }]
let refs = null;       // see detectReferences()
let latexPromise = null;
let mode = 'cite';
let hits = [], cur = -1, lastQuery = null;

/* ------------------------------------------------------------------ *
 * Status line
 * ------------------------------------------------------------------ */

function setStatus(msg, isError = false) {
  const s = $('status');
  s.classList.toggle('error', isError);
  if (msg instanceof Node) s.replaceChildren(msg); else s.textContent = msg || '';
}

function setRefLine(text) {
  $('refLine').textContent = text || '';
  $('refLine').title = text || '';
  $('refLine').hidden = !text;
}

/* ------------------------------------------------------------------ *
 * 1. Loading the paper
 * ------------------------------------------------------------------ */

const ID_SRC = '(\\d{4}\\.\\d{4,5}(?:v\\d+)?|[a-z][a-z.-]*(?:\\.[A-Z]{2})?\\/\\d{7}(?:v\\d+)?)';
function parseId(s) {
  if (!s) return null;
  s = s.trim();
  let m = new RegExp(`arxiv\\.org\\/(?:abs|pdf|html|format)\\/${ID_SRC}`, 'i').exec(s);
  if (m) return m[1];
  m = new RegExp(`^(?:arxiv:\\s*)?${ID_SRC}$`, 'i').exec(s);
  return m ? m[1] : null;
}

async function openPaper(id) {
  arxivId = id;
  document.title = `arXiv:${id}`;
  $('original').href = `https://arxiv.org/pdf/${id}#original`;
  $('abstract').href = `https://arxiv.org/abs/${id}`;
  $('abstract').hidden = $('original').hidden = false;
  $('idForm').hidden = true;
  try {
    setStatus('Loading the PDF…');
    const res = await fetch(`https://arxiv.org/pdf/${id}`);
    if (!res.ok) throw new Error(`arXiv answered ${res.status} for ${id}. Check the ID.`);
    const data = new Uint8Array(await res.arrayBuffer());
    pdfDoc = await pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: new URL('./lib/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./lib/standard_fonts/', import.meta.url).href
    }).promise;
    viewer.setDocument(pdfDoc);
    linkService.setDocument(pdfDoc);

    const meta = await pdfDoc.getMetadata().catch(() => null);
    const title = meta?.info?.Title;
    if (title && title.trim()) document.title = `${title.trim()} (arXiv:${id})`;

    idx = await buildIndex(pdfDoc, p => setStatus(`Reading page ${p} of ${pdfDoc.numPages}…`));
    outline = await buildOutline(pdfDoc).catch(() => []);
    refs = detectReferences(idx.text);
    setStatus(refs.numeric
      ? `${refs.count} numbered references. Type a number, an author or an arXiv ID.`
      : 'References are author–year. Type an author (optionally with a year) or an arXiv ID.');
    $('query').focus();
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  }
}

/* ------------------------------------------------------------------ *
 * 2. Text index: the whole PDF as one string, mapped back to text items
 * ------------------------------------------------------------------ */

// Fonts with metrics close to what papers use, for estimating positions inside a line.
const FAMILIES = {
  'serif': '"Latin Modern Roman", "LM Roman 10", "CMU Serif", "Computer Modern", "Times New Roman", Times, serif',
  'sans-serif': 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif',
  'monospace': '"Latin Modern Mono", "Courier New", Courier, monospace'
};

async function buildIndex(pdf, progress) {
  let text = '';
  const pageMid = {};
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    if (p % 5 === 1) progress(p);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const start = text.length;
      text += it.str;
      const family = FAMILIES[tc.styles?.[it.fontName]?.fontFamily] || FAMILIES['sans-serif'];
      items.push({ page: p, start, end: text.length, str: it.str, tf: it.transform, w: it.width, h: it.height, family, eol: !!it.hasEOL });
      if (it.hasEOL) text += '\n';
    }
    if (items.length) items[items.length - 1].eol = true;
    text += '\n';
    pageMid[p] = (page.view[0] + page.view[2]) / 2;
  }
  return { text, items, pageMid };
}

function itemAt(pos) {
  const a = idx.items;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid].start <= pos) lo = mid; else hi = mid - 1; }
  return lo;
}

/* Section titles from the PDF's bookmarks (most arXiv PDFs have them). */
async function buildOutline(pdf) {
  const top = await pdf.getOutline();
  if (!top) return [];
  const out = [];
  async function walk(list, path) {
    for (const o of list) {
      let dest = o.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest).catch(() => null);
      const label = [...path, o.title.trim()];
      if (Array.isArray(dest) && dest[0] != null) {
        const pageIndex = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]).catch(() => -1) : dest[0];
        const kind = dest[1]?.name;
        const y = kind === 'XYZ' ? dest[3] : (kind === 'FitH' || kind === 'FitBH') ? dest[2] : null;
        if (pageIndex >= 0) out.push({ page: pageIndex + 1, y: y ?? 1e6, label: label.join(' › ') });
      }
      if (o.items?.length) await walk(o.items, label);
    }
  }
  await walk(top, []);
  return out.sort((a, b) => a.page - b.page || b.y - a.y);
}

function sectionAt(page, y) {
  let found = null;
  for (const o of outline) {
    if (o.page < page || (o.page === page && o.y >= y)) found = o; else break;
  }
  return found ? found.label : '';
}

/* ------------------------------------------------------------------ *
 * 3. Reference list and citation markers
 * ------------------------------------------------------------------ */

const DASH = '–—\\-−‐';
const MARKER = new RegExp(`\\[\\s*(\\d{1,4}(?:\\s*[,;${DASH}]\\s*\\d{1,4})*)\\s*\\]`, 'g');

function expandMarker(inner) {
  const nums = new Set();
  for (const part of inner.split(/[,;]/)) {
    const r = new RegExp(`^\\s*(\\d+)\\s*[${DASH}]\\s*(\\d+)\\s*$`).exec(part);
    if (r) {
      const a = +r[1], b = +r[2];
      if (b > a && b - a < 400) for (let k = a; k <= b; k++) nums.add(k);
      else { nums.add(a); nums.add(b); }
    } else if (/^\s*\d+\s*$/.test(part)) nums.add(+part);
  }
  return nums;
}

function detectReferences(text) {
  // Numbered list: the longest run [1], [2], [3], ... with each entry following closely.
  const byN = new Map();
  for (const m of text.matchAll(/\[(\d{1,4})\]/g)) {
    const n = +m[1];
    if (!byN.has(n)) byN.set(n, []);
    byN.get(n).push({ n, pos: m.index });
  }
  const chainFrom = s => {
    const chain = [s];
    for (let c = s; ;) {
      const nx = (byN.get(c.n + 1) || []).find(x => x.pos > c.pos && x.pos - c.pos < 4000);
      if (!nx) break;
      chain.push(nx);
      c = nx;
    }
    return chain;
  };
  const chains = (byN.get(1) || []).map(chainFrom);
  const maxLen = Math.max(0, ...chains.map(c => c.length));

  if (maxLen >= 5) {
    const best = chains.filter(c => c.length >= 0.8 * maxLen).pop(); // the last one is the bibliography
    const entries = new Map();
    best.forEach((s, k) => {
      const end = k + 1 < best.length ? best[k + 1].pos : Math.min(text.length, s.pos + 600);
      entries.set(s.n, { n: s.n, pos: s.pos, text: text.slice(s.pos, end).replace(/\s+/g, ' ').trim() });
    });
    const refStart = best[0].pos;
    const refEnd = best[best.length - 1].pos + Math.min(600, entries.get(best[best.length - 1].n).text.length + 2);
    const inRefs = p => p >= refStart && p < refEnd;
    const markers = [];
    for (const m of text.matchAll(MARKER)) {
      if (inRefs(m.index)) continue;
      markers.push({ pos: m.index, end: m.index + m[0].length, nums: expandMarker(m[1]) });
    }
    return { numeric: true, count: best.length, entries, refStart, refEnd, inRefs, markers };
  }

  // Author–year: the bibliography starts at the last "References" heading.
  let refStart = text.length;
  for (const m of text.matchAll(/(?:^|\n)\s*(?:[A-Z\d]{1,4}\.?\s*)?(References|REFERENCES|Bibliography|BIBLIOGRAPHY)\s*(?=\n)/g)) refStart = m.index;
  const refEnd = text.length;
  return { numeric: false, refStart, refEnd, inRefs: p => p >= refStart && p < refEnd };
}

/* ------------------------------------------------------------------ *
 * 4. Searching
 * ------------------------------------------------------------------ */

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ARXIV_IN_QUERY = /^(?:arxiv:\s*)?(\d{4}\.\d{4,5}|[a-z][a-z.-]*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;

async function runCitationSearch(q) {
  clearChoices();
  if (!refs) return;
  const query = q.trim();
  if (!query) return;

  // A bare number: citation number.
  if (/^\d{1,4}$/.test(query)) {
    if (!refs.numeric) return fail('This paper uses author–year citations. Search by author or arXiv ID instead.');
    return goToNumber(+query);
  }

  // An arXiv ID.
  const ax = ARXIV_IN_QUERY.exec(query);
  if (ax) {
    const id = ax[1];
    if (refs.numeric) {
      const found = [...refs.entries.values()].filter(e => e.text.includes(id));
      if (found.length) return found.length === 1 ? goToNumber(found[0].n) : showChoices(found);
    }
    return resolveViaLatex(id);
  }

  // Text: author name, optionally with a year.
  if (refs.numeric) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = [...refs.entries.values()].filter(e => words.every(w => e.text.toLowerCase().includes(w)));
    if (!found.length) return fail(`No reference in the bibliography mentions “${query}”.`);
    return found.length === 1 ? goToNumber(found[0].n) : showChoices(found);
  }
  return goToAuthor(query);
}

function goToNumber(n) {
  const entry = refs.entries.get(n);
  if (!entry) return fail(`This paper has ${refs.count} references, so there is no [${n}].`);
  setRefLine(entry.text);
  const found = refs.markers.filter(m => m.nums.has(n));
  if (!found.length) return fail(`[${n}] is in the bibliography but no [${n}] marker was found in the text.`);
  showHits(found.map(m => ({ marker: [m.pos, m.end], sentence: sentenceRange(m.pos, m.end) })));
}

function goToAuthor(query) {
  // Written the way the bibliography writes it ("Louis, T., La Posta, A., et al. 2025")?
  // Reduce it to what appears in the text ("Louis 2025").
  if (query.includes(',')) query = queryFromEntry(query) || query;
  const yearM = /\b((?:1[89]|20)\d\d)([a-z]?)\b/.exec(query);
  const year = yearM ? yearM[1] : null;
  const suffix = yearM ? yearM[2] : '';
  const words = query.replace(yearM ? yearM[0] : '', ' ')
    .split(/[\s,&;()]+/)
    .filter(w => w && !/^(et|al\.?|and|in|prep\.?)$/i.test(w))
    .filter(w => !/^(?:\p{Lu}\.-?)+$/u.test(w) && !/^\p{Lu}$/u.test(w));  // drop initials like "T." or "A.-L."; keep "DESI"
  if (!words.length) return fail('Type an author’s surname, e.g. “Torrado” or “Torrado 2021”.');
  const [first, ...others] = words;
  const re = new RegExp(`(?<![\\p{L}])${escapeRe(first)}(?![\\p{L}])`, 'giu');
  const text = idx.text;
  const found = [];
  for (const m of text.matchAll(re)) {
    if (refs.inRefs(m.index)) continue;
    const win = text.slice(m.index, m.index + 120);
    if (!others.every(w => win.toLowerCase().includes(w.toLowerCase()))) continue;
    let end = m.index + m[0].length;
    if (year) {
      const y = new RegExp(`\\b${year}${suffix || '[a-z]?'}\\b`).exec(win);
      if (!y) continue;
      end = m.index + y.index + y[0].length;
    }
    found.push({ marker: [m.index, end], sentence: sentenceRange(m.index, end) });
  }
  // Show the bibliography entry, if we can spot it.
  const refText = text.slice(refs.refStart);
  const r = new RegExp(`${escapeRe(first)}[^\\n]{0,160}`, 'i').exec(refText);
  setRefLine(r ? r[0].replace(/\s+/g, ' ') : '');
  // "Planck (Planck Collaboration VI 2020)" matches twice, ending on the same year: keep the closer one.
  const byEnd = new Map();
  for (const f of found) if (!byEnd.has(f.marker[1]) || byEnd.get(f.marker[1]).marker[0] < f.marker[0]) byEnd.set(f.marker[1], f);
  const unique = [...byEnd.values()];
  if (!unique.length) return fail(`“${query}” doesn’t appear as a citation in the text.`);
  showHits(unique);
}

async function resolveViaLatex(id) {
  try {
    setStatus('Looking up that arXiv ID in the LaTeX source (downloaded to memory only)…');
    const latex = await getLatex();
    const k = latex.refs.findIndex(r => r.preview.includes(id) || r.key.includes(id));
    if (k < 0) return fail(`No reference with arXiv ID ${id} was found in this paper.`);
    const ref = latex.refs[k];
    if (refs.numeric) {
      const n = /^\[(\d+)\]$/.exec(ref.label) ? +/^\[(\d+)\]$/.exec(ref.label)[1] : k + 1;
      return goToNumber(n);
    }
    const surname = (ref.short || '').split(/\s+(?:&|and|et)\s+/)[0].replace(/[{}]/g, '').trim().split(/\s+/).pop();
    if (!surname) return fail(`Found ${ref.key} in the LaTeX, but couldn’t tell its author.`);
    $('query').value = `${surname} ${ref.year || ''}`.trim();
    lastQuery = $('query').value;
    return goToAuthor($('query').value);
  } catch (err) {
    console.error(err);
    fail(`Couldn’t use the LaTeX source: ${err.message}`);
  }
}

function getLatex() {
  if (!latexPromise) {
    latexPromise = (async () => {
      const res = await fetch(`https://arxiv.org/e-print/${arxivId}`);
      if (!res.ok) throw new Error(`arXiv answered ${res.status}`);
      const files = await ArxivCite.extractSource(new Uint8Array(await res.arrayBuffer()));
      return ArxivCite.analyze(files); // the downloaded files are dropped here; only the small result is kept
    })();
    latexPromise.catch(() => { latexPromise = null; });
  }
  return latexPromise;
}

/* The sentence around a citation, found in the PDF's own text. */
const ABBR = /(?:\bet al|\be\.g|\bi\.e|\bcf|\bvs|\bFigs?|\bEqs?|\bSecs?|\bRefs?|\bTabs?|\bApp|\bapprox|\bresp|\bNo|\bal|(?:^|[\s(])[A-Z])$/;
function sentenceRange(pos, end) {
  const text = idx.text;
  const lo = Math.max(0, pos - 500);
  const back = text.slice(lo, pos);
  let start = 0, m;
  const re = /[.!?]["”’)]*\s+(?=[A-Z0-9“"(\[])/g;
  while ((m = re.exec(back))) if (!ABBR.test(back.slice(0, m.index))) start = m.index + m[0].length;
  const hi = Math.min(text.length, end + 500);
  const fwd = text.slice(end, hi);
  let stop = fwd.length;
  const re2 = /[.!?]["”’)]*(?=\s|$)/g;
  while ((m = re2.exec(fwd))) if (!ABBR.test(fwd.slice(0, m.index))) { stop = m.index + m[0].length; break; }
  return [lo + start, end + stop];
}

/* ------------------------------------------------------------------ *
 * 5. Showing results: scroll, highlight for a few seconds, next/previous
 * ------------------------------------------------------------------ */

function fail(msg) {
  clearHighlight();
  hits = []; cur = -1;
  updateNav();
  setStatus(msg, true);
}

function showHits(list) {
  hits = list.sort((a, b) => a.marker[0] - b.marker[0]);
  cur = 0;
  goTo(0);
}

function updateNav() {
  $('prevBtn').disabled = $('nextBtn').disabled = hits.length < 2 && mode === 'cite';
}

function goTo(i) {
  if (!hits.length) return;
  cur = (i + hits.length) % hits.length;
  const h = hits[cur];
  const markRects = rectsFor(h.marker[0], h.marker[1]);
  const sentRects = rectsFor(h.sentence[0], h.sentence[1]);
  if (!markRects.length) return;
  const anchor = markRects[0];

  const st = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = `${cur + 1} of ${hits.length}`;
  const section = sectionAt(anchor.page, anchor.rect[3]);
  st.append(b, `, page ${anchor.page}` + (section ? `, ${section}` : ''));
  setStatus(st);
  updateNav();

  const pv = viewer.getPageView(anchor.page - 1);
  const scale = pv.viewport.scale;
  const top = anchor.rect[3] + (container.clientHeight * 0.35) / scale;
  viewer.scrollPageIntoView({
    pageNumber: anchor.page,
    destArray: [null, { name: 'XYZ' }, null, Math.min(top, pv.viewport.viewBox[3]), null],
    allowNegativeOffset: true
  });
  highlight(sentRects, markRects);
}

// Where character k falls along a text item, as a fraction of its width.
// Measured with a similar font, which is far closer than counting characters.
const measureCtx = document.createElement('canvas').getContext('2d');
function frac(it, k) {
  if (k <= 0) return 0;
  if (k >= it.str.length) return 1;
  measureCtx.font = `100px ${it.family}`;
  const total = measureCtx.measureText(it.str).width;
  return total ? measureCtx.measureText(it.str.slice(0, k)).width / total : k / it.str.length;
}

// Character range -> rectangles in PDF page coordinates, merged per line.
function rectsFor(a, b) {
  const out = [];
  for (let i = itemAt(a); i < idx.items.length && idx.items[i].start < b; i++) {
    const it = idx.items[i];
    if (it.end <= a || !it.str.trim()) continue;
    const s = Math.max(a, it.start) - it.start, e = Math.min(b, it.end) - it.start;
    const [, , c, d, x, y] = it.tf;
    const fh = Math.hypot(c, d) || it.h || 10;
    const r = [x + it.w * frac(it, s), y - 0.22 * fh, x + it.w * frac(it, e), y + 0.8 * fh];
    const last = out[out.length - 1];
    if (last && last.page === it.page && Math.abs(last.rect[1] - r[1]) < fh * 0.4 && r[0] - last.rect[2] < fh * 2 && r[0] >= last.rect[0] - 1) {
      last.rect[2] = Math.max(last.rect[2], r[2]);
      last.rect[3] = Math.max(last.rect[3], r[3]);
    } else out.push({ page: it.page, rect: r });
  }
  return out;
}

let active = null, timers = [];

function highlight(sentRects, markRects) {
  clearHighlight();
  active = { rects: [...sentRects.map(r => ({ ...r, cls: 'sentence' })), ...markRects.map(r => ({ ...r, cls: 'mark' }))] };
  paintAll();
  timers.push(setTimeout(() => document.querySelectorAll('.cw-layer').forEach(l => l.classList.add('fade')), HIGHLIGHT_MS));
  timers.push(setTimeout(clearHighlight, HIGHLIGHT_MS + 600));
}

function paintAll() {
  if (!active) return;
  for (const p of new Set(active.rects.map(r => r.page))) paintPage(p);
}

function paintPage(page) {
  if (!active) return;
  const pv = viewer.getPageView(page - 1);
  if (!pv?.div) return;
  pv.div.querySelector('.cw-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'cw-layer';
  for (const r of active.rects.filter(r => r.page === page)) {
    const [x1, y1, x2, y2] = pv.viewport.convertToViewportRectangle(r.rect);
    const d = document.createElement('div');
    d.className = r.cls;
    const pad = r.cls === 'mark' ? 2 : 0.5;
    Object.assign(d.style, {
      left: Math.min(x1, x2) - pad + 'px', top: Math.min(y1, y2) - pad + 'px',
      width: Math.abs(x2 - x1) + 2 * pad + 'px', height: Math.abs(y2 - y1) + 2 * pad + 'px'
    });
    layer.append(d);
  }
  pv.div.append(layer);
}

function clearHighlight() {
  timers.forEach(clearTimeout);
  timers = [];
  active = null;
  document.querySelectorAll('.cw-layer').forEach(l => l.remove());
}

// PDF.js rebuilds a page when it renders it, so put the highlight back.
eventBus.on('pagerendered', e => { if (active) paintPage(e.pageNumber); });
eventBus.on('scalechanging', () => setTimeout(paintAll, 0));

/* ------------------------------------------------------------------ *
 * 6. Several references match: let the user pick
 * ------------------------------------------------------------------ */

function showChoices(entries) {
  const ol = $('choices');
  ol.replaceChildren();
  for (const e of entries.slice(0, 40)) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `[${e.n}]`;
    li.append(n, e.text.replace(/^\[\d+\]\s*/, '').slice(0, 220));
    const pick = () => { clearChoices(); $('query').value = String(e.n); lastQuery = String(e.n); goToNumber(e.n); };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', ev => { if (ev.key === 'Enter') pick(); });
    ol.append(li);
  }
  ol.hidden = false;
  clearHighlight();
  setRefLine('');
  hits = []; cur = -1; updateNav();
  setStatus(`${entries.length} references match. Pick one.`);
}

function clearChoices() { $('choices').hidden = true; $('choices').replaceChildren(); }

/* ------------------------------------------------------------------ *
 * 7. Plain text search (PDF.js's own find), for when you need Ctrl+F
 * ------------------------------------------------------------------ */

function textFind(query, again, previous) {
  eventBus.dispatch('find', {
    source: window, type: again ? 'again' : '', query,
    caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: !!previous, matchDiacritics: false
  });
}
eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
  if (mode !== 'text') return;
  const { current, total } = matchesCount || {};
  setStatus(total ? `${current} of ${total}` : 'No matches');
});
eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
  if (mode !== 'text') return;
  if (state === 1 /* NOT_FOUND */) setStatus('No matches', true);
  else if (matchesCount?.total) setStatus(`${matchesCount.current} of ${matchesCount.total}`);
});

/* ------------------------------------------------------------------ *
 * 8. Controls
 * ------------------------------------------------------------------ */

function setMode(m) {
  mode = m;
  $('modeCite').classList.toggle('on', m === 'cite');
  $('modeText').classList.toggle('on', m === 'text');
  $('modeCite').setAttribute('aria-checked', m === 'cite');
  $('modeText').setAttribute('aria-checked', m === 'text');
  $('query').placeholder = m === 'cite' ? 'Citation number, author or arXiv ID' : 'Find text in the PDF';
  lastQuery = null; hits = []; cur = -1;
  clearHighlight(); clearChoices(); setRefLine('');
  eventBus.dispatch('findbarclose', { source: window });
  $('prevBtn').disabled = $('nextBtn').disabled = m === 'cite';
  setStatus('');
  $('query').focus();
}
$('modeCite').addEventListener('click', () => setMode('cite'));
$('modeText').addEventListener('click', () => setMode('text'));

function submit(previous) {
  const q = $('query').value;
  if (!q.trim() || !pdfDoc) return;
  if (mode === 'text') { textFind(q, q === lastQuery, previous); lastQuery = q; return; }
  if (q === lastQuery && hits.length) { goTo(cur + (previous ? -1 : 1)); return; }
  lastQuery = q;
  runCitationSearch(q);
}

$('query').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submit(e.shiftKey); }
  if (e.key === 'Escape') { $('query').value = ''; lastQuery = null; clearHighlight(); clearChoices(); }
});
$('nextBtn').addEventListener('click', () => (mode === 'text' ? submit(false) : goTo(cur + 1)));
$('prevBtn').addEventListener('click', () => (mode === 'text' ? submit(true) : goTo(cur - 1)));
$('zoomIn').addEventListener('click', () => viewer.increaseScale());
$('settings').addEventListener('click', e => {
  e.preventDefault();
  (globalThis.browser ?? globalThis.chrome)?.runtime?.openOptionsPage?.();
});
$('zoomOut').addEventListener('click', () => viewer.decreaseScale());

// Ctrl+F behaves like the browser's find: text search, as you type, over the whole PDF.
window.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (mode !== 'text') setMode('text');
    $('query').focus();
    $('query').select();
  } else if (e.key === 'F3' || (mod && e.key.toLowerCase() === 'g')) {
    e.preventDefault();
    if (mode === 'text' && $('query').value.trim()) submit(e.shiftKey);
  }
});

$('query').addEventListener('input', () => {
  if (mode !== 'text' || !pdfDoc) return;
  const q = $('query').value;
  lastQuery = q;
  if (q.trim()) textFind(q, false, false);
  else { eventBus.dispatch('findbarclose', { source: window }); setStatus(''); }
});

$('idForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = parseId($('idInput').value);
  if (!id) { setStatus('That doesn’t look like an arXiv ID, e.g. 2503.14738.', true); return; }
  history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
  openPaper(id);
});

/* ------------------------------------------------------------------ *
 * 9. Right-click a reference in the bibliography -> find where it is cited
 * ------------------------------------------------------------------ */

// The text item under a click, as a character position in the index.
function charAtClick(e) {
  const pageDiv = e.target.closest?.('.page');
  if (!pageDiv || !idx) return null;
  const page = +pageDiv.dataset.pageNumber;
  const pv = viewer.getPageView(page - 1);
  const box = pageDiv.getBoundingClientRect();
  const [px, py] = pv.viewport.convertToPdfPoint(e.clientX - box.left - pageDiv.clientLeft, e.clientY - box.top - pageDiv.clientTop);
  let best = null, bestD = Infinity;
  for (let i = itemAt(0); i < idx.items.length; i++) {
    const it = idx.items[i];
    if (it.page < page) continue;
    if (it.page > page) break;
    if (!it.str.trim()) continue;
    const fh = Math.hypot(it.tf[2], it.tf[3]) || it.h || 10;
    const x0 = it.tf[4], x1 = x0 + it.w, y0 = it.tf[5] - 0.25 * fh, y1 = it.tf[5] + 0.85 * fh;
    const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
    const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
    const d = dx + 4 * dy;
    if (d < bestD) { bestD = d; best = it; }
  }
  return best && bestD < 30 ? best.start : null;
}

// Lines of the bibliography (author–year papers), with their left edge, to find entry starts.
let refLines = null;
function bibliographyLines() {
  if (refLines) return refLines;
  refLines = [];
  let line = null;
  for (let i = itemAt(refs.refStart); i < idx.items.length; i++) {
    const it = idx.items[i];
    if (it.start < refs.refStart) continue;
    if (!line) line = { page: it.page, x: null, y: it.tf[5], start: it.start, end: it.end };
    if (line.x === null && it.str.trim()) line.x = it.tf[4];
    line.end = it.end;
    if (it.eol) { if (line.x !== null) refLines.push(line); line = null; }
  }
  if (line && line.x !== null) refLines.push(line);
  // Left margin of each column on each page; a line at the margin starts an entry
  // (bibliographies use a hanging indent for the following lines).
  const margin = {};
  const col = l => `${l.page}:${l.x < idx.pageMid[l.page] ? 'L' : 'R'}`;
  for (const l of refLines) margin[col(l)] = Math.min(margin[col(l)] ?? Infinity, l.x);
  for (const l of refLines) l.isStart = Math.abs(l.x - margin[col(l)]) < 2;
  const starts = refLines.filter(l => l.isStart).length;
  if (starts > 0.85 * refLines.length) refLines.forEach(l => { l.isStart = true; l.noIndent = true; });
  return refLines;
}

function authorYearEntryAt(pos) {
  const lines = bibliographyLines();
  let i = lines.findIndex(l => pos >= l.start && pos <= l.end);
  if (i < 0) return null;
  let a = i;
  while (a > 0 && !lines[a].isStart) a--;
  let b = i + 1;
  while (b < lines.length && !lines[b].isStart) b++;
  return idx.text.slice(lines[a].start, lines[b - 1].end).replace(/\s+/g, ' ').trim();
}

// "Louis, T., Posta, A. L., et al. 2025, JCAP …" -> "Louis 2025"
// "Prince, H., & Dunkley, J. 2019, PRD …"       -> "Prince Dunkley 2019"
function queryFromEntry(entry) {
  const y = /\b((?:1[89]|20)\d\d[a-z]?)\b/.exec(entry);
  const authors = (y ? entry.slice(0, y.index) : entry.slice(0, 120));
  const names = authors.split(/,|&|\band\b|;/)
    .map(p => p.replace(/(?:\s*\p{Lu}\.-?)+\s*$/u, '').replace(/^\s*(?:\p{Lu}\.-?\s*)+/u, '').trim())
    .filter(p => p && !/^et al\.?$/i.test(p) && !/^\p{Lu}\.?$/u.test(p) && /\p{L}{2}/u.test(p));
  if (!names.length) return null;
  const first = names[0].replace(/\bet al\.?$/i, '').trim();
  const twoAuthors = names.length === 2 && !/et al/i.test(authors);
  return [first, twoAuthors ? names[1] : '', y ? y[1] : ''].filter(Boolean).join(' ');
}

let menu = null;
function closeMenu() { menu?.remove(); menu = null; }

function openMenu(e, label, entryText, action) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'cw-menu';
  menu.setAttribute('role', 'menu');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  btn.textContent = label;
  btn.addEventListener('click', () => { closeMenu(); action(); });
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.textContent = entryText;
  menu.append(btn, entry);
  document.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(e.clientX, innerWidth - w - 8) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - h - 8) + 'px';
  btn.focus();
}

container.addEventListener('contextmenu', e => {
  closeMenu();
  if (!refs) return;
  const pos = charAtClick(e);
  if (pos == null || pos < refs.refStart || pos >= refs.refEnd) return; // normal browser menu elsewhere

  if (refs.numeric) {
    let entry = null;
    for (const en of refs.entries.values()) if (en.pos <= pos && (!entry || en.pos > entry.pos)) entry = en;
    if (!entry) return;
    e.preventDefault();
    openMenu(e, `Find where [${entry.n}] is cited`, entry.text, () => {
      if (mode !== 'cite') setMode('cite');
      clearChoices();
      $('query').value = String(entry.n);
      lastQuery = $('query').value;
      goToNumber(entry.n);
    });
    return;
  }

  const entry = authorYearEntryAt(pos);
  const q = entry && queryFromEntry(entry);
  if (!q) return;
  e.preventDefault();
  openMenu(e, 'Find where this is cited', entry, () => {
    if (mode !== 'cite') setMode('cite');
    clearChoices();
    $('query').value = q;
    lastQuery = q;
    goToAuthor(q);
    setRefLine(entry);
  });
});
document.addEventListener('mousedown', e => { if (menu && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
container.addEventListener('scroll', closeMenu, { passive: true });

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

const startId = parseId(new URLSearchParams(location.search).get('id') || '');
if (startId) openPaper(startId);
else {
  $('idForm').hidden = false;
  $('original').hidden = true;
  $('abstract').hidden = true;
  setStatus('Open an arXiv paper, or type its ID.');
  $('idInput').focus();
}
