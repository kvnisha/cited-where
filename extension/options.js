const ext = globalThis.browser ?? globalThis.chrome;
const box = document.getElementById('autoOpen');
const saved = document.getElementById('saved');
ext.storage.local.get({ autoOpen: false }).then(v => { box.checked = !!v.autoOpen; });
box.addEventListener('change', async () => {
  await ext.storage.local.set({ autoOpen: box.checked });
  saved.textContent = box.checked ? 'Saved. arXiv PDFs will open in Cited where?.' : 'Saved. arXiv PDFs will open normally.';
});
