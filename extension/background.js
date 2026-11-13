/* background.js — opens arXiv papers in the extension's viewer. */
const ext = globalThis.browser ?? globalThis.chrome;
const ORIGINS = ['https://arxiv.org/*', 'https://export.arxiv.org/*'];
const ID = '(\\d{4}\\.\\d{4,5}(?:v\\d+)?|[a-z][a-z.-]*(?:\\.[A-Z]{2})?\\/\\d{7}(?:v\\d+)?)';
const PDF_URL = new RegExp(`^https://(?:export\\.)?arxiv\\.org/pdf/${ID}(?:\\.pdf)?/?(?:\\?[^#]*)?(#.*)?$`, 'i');
const ANY_URL = new RegExp(`^https://(?:export\\.)?arxiv\\.org/(?:abs|pdf|html|format)/${ID}`, 'i');

const viewerUrl = id => ext.runtime.getURL('viewer.html') + '?id=' + encodeURIComponent(id);

async function autoOpenEnabled() {
  try { return !!(await ext.storage.local.get({ autoOpen: false })).autoOpen; } catch (_) { return false; }
}

// Only if switched on in the settings: arXiv PDFs open in the viewer automatically.
// "#original" (the viewer's "Original PDF" link) always opts out.
ext.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const m = PDF_URL.exec(info.url);
  if (!m || (m[2] || '').includes('original')) return;
  if (!(await autoOpenEnabled())) return;
  ext.tabs.update(tabId, { url: viewerUrl(m[1]) });
});

// Toolbar button (and its keyboard shortcut): open the current arXiv paper in the viewer.
ext.action.onClicked.addListener(async tab => {
  try {
    if (!(await ext.permissions.contains({ origins: ORIGINS }))) await ext.permissions.request({ origins: ORIGINS });
  } catch (_) { /* ignore */ }
  const m = ANY_URL.exec(tab.url || '');
  if (m) ext.tabs.update(tab.id, { url: viewerUrl(m[1]) });
  else ext.tabs.create({ url: ext.runtime.getURL('viewer.html') });
});
