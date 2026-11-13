/* background.js — sends arXiv PDFs to the extension's own viewer. */
const ext = globalThis.browser ?? globalThis.chrome;
const ORIGINS = ['https://arxiv.org/*', 'https://export.arxiv.org/*'];
const ID = '(\\d{4}\\.\\d{4,5}(?:v\\d+)?|[a-z][a-z.-]*(?:\\.[A-Z]{2})?\\/\\d{7}(?:v\\d+)?)';
const PDF_URL = new RegExp(`^https://(?:export\\.)?arxiv\\.org/pdf/${ID}(?:\\.pdf)?/?(?:\\?[^#]*)?(#.*)?$`, 'i');
const ANY_URL = new RegExp(`^https://(?:export\\.)?arxiv\\.org/(?:abs|pdf|html|format)/${ID}`, 'i');

const viewerUrl = id => ext.runtime.getURL('viewer.html') + '?id=' + encodeURIComponent(id);

// Opening an arXiv PDF goes straight to the viewer. "#original" opts out.
ext.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  const m = PDF_URL.exec(info.url);
  if (!m || (m[2] || '').includes('original')) return;
  ext.tabs.update(tabId, { url: viewerUrl(m[1]) });
});

// Toolbar button: open the current arXiv paper (abstract, PDF or HTML page) in the viewer.
ext.action.onClicked.addListener(async tab => {
  try {
    if (!(await ext.permissions.contains({ origins: ORIGINS }))) await ext.permissions.request({ origins: ORIGINS });
  } catch (_) { /* ignore */ }
  const m = ANY_URL.exec(tab.url || '');
  const url = m ? viewerUrl(m[1]) : ext.runtime.getURL('viewer.html');
  if (m) ext.tabs.update(tab.id, { url }); else ext.tabs.create({ url });
});
