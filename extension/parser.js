/*
 * parser.js
 * Turns an arXiv source download (https://arxiv.org/e-print/<id>) into a list of
 * references, each with every place it is cited: section, file, line and sentence.
 *
 * Uses only standard web APIs (DecompressionStream, TextDecoder), so the same file
 * runs in the extension popup and under Node 18+ for testing.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Unpacking the download (gzip -> tar -> text files)
   * ------------------------------------------------------------------ */

  const ascii = (b, s, n) => { let o = ''; for (let i = s; i < s + n && i < b.length; i++) o += String.fromCharCode(b[i]); return o; };
  const cstr = (b, s, n) => { let o = ''; for (let i = s; i < s + n && i < b.length && b[i] !== 0; i++) o += String.fromCharCode(b[i]); return o; };
  const isGzip = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  const isTar = b => b.length >= 512 && ascii(b, 257, 5) === 'ustar';
  const isPdf = b => ascii(b, 0, 5) === '%PDF-';

  async function gunzip(b) {
    const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function normPath(p) {
    const parts = [];
    for (const seg of p.replace(/\\/g, '/').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop(); else parts.push(seg);
    }
    return parts.join('/');
  }

  function untar(b) {
    const files = {};
    let off = 0, longName = null, paxPath = null;
    while (off + 512 <= b.length) {
      let name = cstr(b, off, 100);
      if (!name) break; // two empty blocks mark the end
      const size = parseInt(cstr(b, off + 124, 12).trim() || '0', 8) || 0;
      const type = b[off + 156] ? String.fromCharCode(b[off + 156]) : '0';
      if (ascii(b, off + 257, 5) === 'ustar') {
        const prefix = cstr(b, off + 345, 155);
        if (prefix) name = prefix + '/' + name;
      }
      const data = b.subarray(off + 512, off + 512 + size);
      off += 512 + Math.ceil(size / 512) * 512;
      if (type === 'L') { longName = cstr(data, 0, data.length); continue; }          // GNU long name
      if (type === 'x') {                                                            // pax header
        const m = /\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data));
        if (m) paxPath = m[1];
        continue;
      }
      if (longName) { name = longName; longName = null; }
      if (paxPath) { name = paxPath; paxPath = null; }
      if (type === '0' || type === '7') files[normPath(name)] = data;
    }
    return files;
  }

  function looksBinary(d) {
    const n = Math.min(d.length, 8000);
    for (let i = 0; i < n; i++) if (d[i] === 0) return true;
    return false;
  }

  async function extractSource(bytes) {
    let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < 3 && isGzip(b); i++) b = await gunzip(b);
    if (isPdf(b)) throw new Error('This paper was submitted to arXiv as a PDF only, so there is no LaTeX source to search.');
    const raw = isTar(b) ? untar(b) : { 'main.tex': b };
    const dec = new TextDecoder('utf-8');
    const files = {};
    for (const [name, data] of Object.entries(raw)) {
      if (/\.(png|jpe?g|gif|pdf|eps|ps|svg|tiff?)$/i.test(name)) continue;
      if (data.length > 8e6 || looksBinary(data)) continue;
      files[name] = dec.decode(data);
    }
    if (!Object.keys(files).length) throw new Error('The source archive contains no readable text files.');
    return files;
  }

  /* ------------------------------------------------------------------ *
   * 2. Small LaTeX text helpers
   * ------------------------------------------------------------------ */

  function stripComments(line) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '%') continue;
      let n = 0, k = i - 1;
      while (k >= 0 && line[k] === '\\') { n++; k--; }
      if (n % 2 === 0) return line.slice(0, i);
    }
    return line;
  }

  // s[i] must be `open`; returns the index just after the matching `close`, or -1.
  function readBalanced(s, i, open, close, max = 4000) {
    let depth = 0;
    for (let j = i; j < s.length && j - i < max; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  }

  const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

  const SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
    Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', sim: '~', approx: '≈',
    simeq: '≃', times: '×', pm: '±', leq: '≤', geq: '≥', lesssim: '≲', gtrsim: '≳', ell: 'ℓ',
    infty: '∞', odot: '⊙', ldots: '…', dots: '…', cdots: '…', S: '§', AA: 'Å', ae: 'æ', o: 'ø',
    ss: 'ß', textendash: '–', textemdash: '—', LaTeX: 'LaTeX', TeX: 'TeX', etal: 'et al.'
  };

  // Rough LaTeX -> readable text. Good enough to recognise the sentence in the PDF.
  function cleanPlain(s) {
    return s
      .replace(/\\texorpdfstring\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '$1')
      .replace(/\\(?:begin|end)\s*\{[^{}]*\}(?:\{[^{}]*\})?/g, ' ')
      .replace(/\\(?:label|index|vspace|hspace|phantom|hphantom|vphantom|bibliographystyle|bibliography)\*?\s*\{[^{}]*\}/g, '')
      .replace(/\\(?:ref|eqref|cref|Cref|autoref|pageref|nameref)\*?\s*\{[^{}]*\}/g, '[ref]')
      .replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\([^a-zA-Z])/g, (m, c) => ('%&$#_{}'.includes(c) ? c : '\\,; !'.includes(c) ? ' ' : ''))
      .replace(/\\([a-zA-Z]+)\*?/g, (m, n) => (SYMBOLS[n] !== undefined ? SYMBOLS[n] : ''))
      .replace(/[{}$]/g, '')
      .replace(/~/g, ' ')
      .replace(/``|''/g, '"')
      .replace(/---/g, '—')
      .replace(/--/g, '–')
      .replace(/\s+/g, ' ');
  }

  /* ------------------------------------------------------------------ *
   * 3. Finding the main file and flattening \input / \include
   * ------------------------------------------------------------------ */

  const withoutComments = t => t.split(/\r?\n/).map(stripComments).join('\n');

  function findMain(files) {
    const tex = Object.keys(files).filter(n => /\.(tex|ltx)$/i.test(n) || !/\.[A-Za-z0-9]+$/.test(n.split('/').pop()));
    const cands = tex.filter(n => /\\documentclass/.test(withoutComments(files[n])));
    if (!cands.length) return tex.sort((a, b) => files[b].length - files[a].length)[0] || null;
    const score = n => {
      const t = withoutComments(files[n]);
      return (/\\begin\s*\{document\}/.test(t) ? 1e9 : 0) - n.split('/').length * 1e7 + t.length;
    };
    return cands.sort((a, b) => score(b) - score(a))[0];
  }

  function resolveFile(files, path, mainDir) {
    path = path.trim().replace(/^"|"$/g, '');
    const p = normPath((mainDir ? mainDir + '/' : '') + path);
    for (const c of [p, p + '.tex', normPath(path), normPath(path) + '.tex']) if (c in files) return c;
    const want = path.split('/').pop().toLowerCase();
    for (const k of Object.keys(files)) {
      const base = k.split('/').pop().toLowerCase();
      if (base === want || base === want + '.tex') return k;
    }
    return null;
  }

  function findInclude(line) {
    const hits = [];
    let m;
    if ((m = /\\(?:input|include|subfile)\s*\{([^}]*)\}/.exec(line))) hits.push({ index: m.index, end: m.index + m[0].length, path: m[1] });
    if ((m = /\\(?:sub)?import\*?\s*\{([^}]*)\}\s*\{([^}]*)\}/.exec(line))) hits.push({ index: m.index, end: m.index + m[0].length, path: m[1].replace(/\/?$/, '/') + m[2] });
    if ((m = /\\input\s+([^\s{}\\%]+)/.exec(line))) hits.push({ index: m.index, end: m.index + m[0].length, path: m[1] });
    return hits.sort((a, b) => a.index - b.index)[0] || null;
  }

  function flatten(files, name, mainDir, out, stack, depth) {
    if (depth > 20 || stack.has(name)) return;
    stack.add(name);
    const src = files[name].split(/\r?\n/);
    let inCommentEnv = false, ifDepth = 0;
    for (let ln = 0; ln < src.length; ln++) {
      const orig = src[ln];
      const t = stripComments(orig).replace(/\s+$/, '');
      if (inCommentEnv) { if (/\\end\s*\{comment\}/.test(t)) inCommentEnv = false; continue; }
      if (/\\begin\s*\{comment\}/.test(t)) { inCommentEnv = true; continue; }
      if (ifDepth > 0) {
        ifDepth += (t.match(/\\if[a-zA-Z@]*/g) || []).length - (t.match(/\\fi(?![a-zA-Z@])/g) || []).length;
        continue;
      }
      const iff = t.search(/\\iffalse(?![a-zA-Z@])/);
      if (iff >= 0) {
        if (t.slice(0, iff).trim()) out.push({ text: t.slice(0, iff), file: name, line: ln + 1 });
        const after = t.slice(iff + 8);
        ifDepth = 1 + (after.match(/\\if[a-zA-Z@]*/g) || []).length - (after.match(/\\fi(?![a-zA-Z@])/g) || []).length;
        continue;
      }
      if (orig.trim() !== '' && t.trim() === '') continue; // comment-only line: not a paragraph break

      let rest = t, hadInclude = false, inc;
      while ((inc = findInclude(rest))) {
        hadInclude = true;
        if (rest.slice(0, inc.index).trim()) out.push({ text: rest.slice(0, inc.index), file: name, line: ln + 1 });
        const target = resolveFile(files, inc.path, mainDir);
        if (target) flatten(files, target, mainDir, out, stack, depth + 1);
        rest = rest.slice(inc.end);
      }
      if (!hadInclude || rest.trim()) out.push({ text: rest, file: name, line: ln + 1 });
      if (/\\end\s*\{document\}/.test(t)) break;
    }
    stack.delete(name);
  }

  /* ------------------------------------------------------------------ *
   * 4. Bibliography: \bibitem (natbib / numeric), biblatex .bbl, or .bib
   * ------------------------------------------------------------------ */

  function parseBibitems(src) {
    const s = withoutComments(src);
    const items = [];
    const re = /\\bibitem(?![a-zA-Z@])/g;
    let m;
    while ((m = re.exec(s))) {
      let i = skipWs(s, m.index + m[0].length), opt = null;
      if (s[i] === '[') {
        const e = readBalanced(s, i, '[', ']', 3000);
        if (e < 0) continue;
        opt = s.slice(i + 1, e - 1);
        i = skipWs(s, e);
      }
      if (s[i] !== '{') continue;
      const e = readBalanced(s, i, '{', '}', 500);
      if (e < 0) continue;
      items.push({ key: s.slice(i + 1, e - 1).trim(), opt, bodyStart: e });
    }
    items.forEach((it, k) => {
      const stop = k + 1 < items.length ? items[k + 1].bodyStart : s.length;
      let body = s.slice(it.bodyStart, stop).replace(/\\bibitem[\s\S]*$/, '');
      body = body.replace(/\\end\s*\{thebibliography\}[\s\S]*$/, '');
      it.body = body;
    });
    return items.map(({ key, opt, body }) => ({ key, opt, body }));
  }

  function parseBiblatexBbl(src) {
    const out = [];
    const re = /\\entry\{([^}]+)\}\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const end = src.indexOf('\\endentry', m.index);
      const body = src.slice(m.index, end < 0 ? undefined : end);
      const authorBlock = (/\\name\{author\}([\s\S]*?)(?:\\name\{|\\list\{|\\field\{|\\strng\{|$)/.exec(body) || [])[1] || '';
      const fam = [...authorBlock.matchAll(/family=\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(x => cleanPlain(x[1]).trim());
      const field = f => { const r = new RegExp('\\\\field\\{' + f + '\\}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}').exec(body); return r ? cleanPlain(r[1]).trim() : ''; };
      const year = field('year') || field('labelyear');
      const short = fam.length === 0 ? m[1] : fam.length === 1 ? fam[0] : fam.length === 2 ? `${fam[0]} & ${fam[1]}` : `${fam[0]} et al.`;
      const preview = [fam.slice(0, 3).join(', ') + (fam.length > 3 ? ' et al.' : ''), field('title'), field('journaltitle'), year].filter(Boolean).join('. ');
      out.push({ key: m[1].trim(), short, year, preview });
    }
    return out;
  }

  function parseBibFile(src) {
    const out = [];
    const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
    let m;
    while ((m = re.exec(src))) {
      if (/^(string|comment|preamble)$/i.test(m[1])) continue;
      const next = src.slice(m.index + 1).search(/\n\s*@\w+\s*\{/);
      const body = next < 0 ? src.slice(m.index) : src.slice(m.index, m.index + 1 + next);
      const field = f => {
        const r = new RegExp('\\b' + f + '\\s*=\\s*', 'i').exec(body);
        if (!r) return '';
        let i = r.index + r[0].length;
        if (body[i] === '{') { const e = readBalanced(body, i, '{', '}', 5000); return e < 0 ? '' : cleanPlain(body.slice(i + 1, e - 1)).trim(); }
        if (body[i] === '"') { const e = body.indexOf('"', i + 1); return e < 0 ? '' : cleanPlain(body.slice(i + 1, e)).trim(); }
        return (/^[^,\n}]+/.exec(body.slice(i)) || [''])[0].trim();
      };
      const authors = field('author').split(/\s+and\s+/i).filter(Boolean);
      const fam = authors.map(a => (a.includes(',') ? a.split(',')[0] : a.split(' ').pop()).trim());
      const year = field('year');
      const short = fam.length === 0 ? m[2] : fam.length === 1 ? fam[0] : fam.length === 2 ? `${fam[0]} & ${fam[1]}` : `${fam[0]} et al.`;
      const preview = [fam.slice(0, 3).join(', ') + (fam.length > 3 ? ' et al.' : ''), field('title'), field('journal'), year].filter(Boolean).join('. ');
      out.push({ key: m[2].trim(), short, year, preview });
    }
    return out;
  }

  function readBibliography(files, text, main) {
    let items = parseBibitems(text);
    if (!items.length) {
      const base = main.replace(/\.[^./]+$/, '');
      const bbls = Object.keys(files).filter(n => /\.bbl$/i.test(n))
        .sort((a, b) => (b.replace(/\.bbl$/i, '') === base) - (a.replace(/\.bbl$/i, '') === base));
      for (const n of bbls) {
        items = parseBibitems(files[n]);
        if (items.length) break;
        const bl = parseBiblatexBbl(files[n]);
        if (bl.length) return { kind: 'author-year', refs: bl, source: n };
      }
    }
    if (items.length) {
      const natbib = items.filter(it => it.opt && /\([^()]*\)/.test(it.opt)).length;
      const kind = natbib > items.length / 2 ? 'author-year' : items.some(it => it.opt) ? 'alpha' : 'numeric';
      const refs = items.map((it, k) => {
        let short = '', year = '', label;
        const m = it.opt && /^([\s\S]*?)\(([^()]*)\)([\s\S]*)$/.exec(it.opt);
        if (kind === 'author-year' && m) {
          short = cleanPlain(m[1]).trim();
          year = cleanPlain(m[2]).trim();
        }
        if (kind === 'author-year') label = short ? `${short} ${year}`.trim() : it.key;
        else if (kind === 'alpha') label = `[${it.opt ? cleanPlain(it.opt).trim() : k + 1}]`;
        else label = `[${k + 1}]`;
        const preview = cleanPlain(it.body.replace(/\\newblock/g, ' ')).trim();
        return { key: it.key, short, year, label, preview };
      });
      return { kind, refs, source: 'bibitems' };
    }
    const bibs = Object.keys(files).filter(n => /\.bib$/i.test(n));
    const refs = bibs.flatMap(n => parseBibFile(files[n]));
    return { kind: 'author-year', refs, source: refs.length ? 'bib' : 'none' };
  }

  /* ------------------------------------------------------------------ *
   * 5. Citation commands, including custom macros that wrap \cite
   * ------------------------------------------------------------------ */

  const CITE_SRC = '\\\\([A-Za-z]*cite[A-Za-z]*)\\*?';
  const NOT_CITES = /^(nocite|citestyle|citetext|citeindexfalse|citeindextrue|citation|bibliographystyle)$/i;

  function readCiteArgs(s, i, multi) {
    const keys = [];
    for (let guard = 0; guard < 20; guard++) {
      const j = skipWs(s, i);
      if (s[j] === '[') { const e = readBalanced(s, j, '[', ']', 600); if (e < 0) break; i = e; continue; }
      if (s[j] === '(' && multi) { const e = readBalanced(s, j, '(', ')', 600); if (e < 0) break; i = e; continue; }
      if (s[j] === '{') {
        const e = readBalanced(s, j, '{', '}', 2000);
        if (e < 0) break;
        keys.push(...s.slice(j + 1, e - 1).split(',').map(k => k.trim()).filter(Boolean));
        i = e;
        if (!multi) break;
        continue;
      }
      break;
    }
    return { end: i, keys };
  }

  function readArgs(s, i, n) {
    const args = [];
    while (args.length < n) {
      const j = skipWs(s, i);
      if (s[j] === '[') { const e = readBalanced(s, j, '[', ']', 600); if (e < 0) break; i = e; continue; }
      if (s[j] === '{') { const e = readBalanced(s, j, '{', '}', 2000); if (e < 0) break; args.push(s.slice(j + 1, e - 1)); i = e; continue; }
      break;
    }
    return { args, end: i };
  }

  function findCiteMacros(text) {
    const fixed = {}, wrappers = {}, spans = [];
    const re = /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand)\*?\s*\{?\s*\\([A-Za-z@]+)\s*\}?|\\[gex]?def\s*\\([A-Za-z@]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1] || m[2];
      let i = m.index + m[0].length, hasDefault = false;
      if (m[2]) {
        while (i < text.length && text[i] !== '{' && i - m.index < 80) i++;
      } else {
        for (let g = 0; g < 2; g++) {
          const j = skipWs(text, i);
          if (text[j] !== '[') break;
          const e = readBalanced(text, j, '[', ']', 300);
          if (e < 0) break;
          if (g === 1) hasDefault = true;
          i = e;
        }
        i = skipWs(text, i);
      }
      if (text[i] !== '{') continue;
      const end = readBalanced(text, i, '{', '}', 4000);
      if (end < 0) continue;
      spans.push([m.index, end]);
      const body = text.slice(i + 1, end - 1);
      const cre = new RegExp(CITE_SRC, 'g');
      let c;
      while ((c = cre.exec(body))) {
        if (NOT_CITES.test(c[1])) continue;
        const { keys } = readCiteArgs(body, c.index + c[0].length, /cites$/i.test(c[1]));
        if (!keys.length) continue;
        const param = keys.find(k => /^#\d$/.test(k));
        if (param) wrappers[name] = { arg: +param[1], hasDefault };
        else if (!keys.some(k => k.includes('#'))) fixed[name] = (fixed[name] || []).concat(keys);
      }
      re.lastIndex = end;
    }
    return { fixed, wrappers, spans };
  }

  function findAllCites(text, from, macros) {
    const found = new Map();
    const inSpan = p => macros.spans.some(([a, b]) => p >= a && p < b);
    const escape = n => n.replace(/[@]/g, '\\@');
    let m;

    for (const [name, w] of Object.entries(macros.wrappers)) {
      const r = new RegExp('\\\\' + escape(name) + '(?![A-Za-z@])\\*?', 'g');
      r.lastIndex = from;
      while ((m = r.exec(text))) {
        if (inSpan(m.index)) continue;
        const idx = w.hasDefault ? w.arg - 1 : w.arg;
        const { args, end } = readArgs(text, m.index + m[0].length, idx);
        const keys = (args[idx - 1] || '').split(',').map(k => k.trim()).filter(Boolean);
        if (keys.length) found.set(m.index, { pos: m.index, end, keys, cmd: name });
      }
    }
    for (const [name, keys] of Object.entries(macros.fixed)) {
      const r = new RegExp('\\\\' + escape(name) + '(?![A-Za-z@])', 'g');
      r.lastIndex = from;
      while ((m = r.exec(text))) {
        if (inSpan(m.index) || found.has(m.index)) continue;
        let end = m.index + m[0].length;
        const j = skipWs(text, end);
        if (text.startsWith('{}', j)) end = j + 2;
        found.set(m.index, { pos: m.index, end, keys, cmd: name });
      }
    }
    const re = new RegExp(CITE_SRC, 'g');
    re.lastIndex = from;
    while ((m = re.exec(text))) {
      const cmd = m[1];
      if (NOT_CITES.test(cmd) || inSpan(m.index) || found.has(m.index)) continue;
      const { end, keys } = readCiteArgs(text, m.index + m[0].length, /cites$/i.test(cmd));
      if (!keys.length || keys.some(k => k.includes('#'))) continue;
      found.set(m.index, { pos: m.index, end, keys, cmd });
      re.lastIndex = end;
    }
    return [...found.values()].sort((a, b) => a.pos - b.pos);
  }

  /* ------------------------------------------------------------------ *
   * 6. Where in the paper: section numbers, figures/tables, footnotes
   * ------------------------------------------------------------------ */

  function structure(text) {
    const events = [];
    const secRe = /\\(section|subsection|subsubsection)(\*?)\s*(?:\[[^\]]*\]\s*)?\{/g;
    let m;
    while ((m = secRe.exec(text))) {
      const open = m.index + m[0].length - 1;
      const end = readBalanced(text, open, '{', '}', 800);
      if (end < 0) continue;
      events.push({ pos: m.index, type: m[1], starred: !!m[2], title: cleanPlain(text.slice(open + 1, end - 1)).trim() });
    }
    const envRe = /\\(begin|end)\s*\{(abstract|acknowledg(?:e)?ments?|appendix|appendices)\}|\\appendix(?![a-zA-Z@])/g;
    while ((m = envRe.exec(text))) {
      if (!m[1]) events.push({ pos: m.index, type: 'appendix' });
      else if (/^append/.test(m[2])) { if (m[1] === 'begin') events.push({ pos: m.index, type: 'appendix' }); }
      else events.push({ pos: m.index, type: m[1] + ':' + (/^abs/.test(m[2]) ? 'abstract' : 'ack') });
    }
    events.sort((a, b) => a.pos - b.pos);

    const snaps = [];
    let n = [0, 0, 0], labels = ['', '', ''], appendix = false, special = '', secNum = '';
    const letter = k => String.fromCharCode(64 + k);
    for (const e of events) {
      if (e.type === 'appendix') { appendix = true; n = [0, 0, 0]; }
      else if (e.type === 'begin:abstract') special = 'Abstract';
      else if (e.type === 'begin:ack') special = 'Acknowledgements';
      else if (e.type === 'end:abstract' || e.type === 'end:ack') special = '';
      else {
        special = '';
        const lvl = { section: 0, subsection: 1, subsubsection: 2 }[e.type];
        let num = '';
        if (!e.starred) {
          n[lvl]++;
          for (let k = lvl + 1; k < 3; k++) n[k] = 0;
          if (lvl === 0) secNum = appendix ? letter(n[0]) : String(n[0]);
          num = [secNum, ...n.slice(1, lvl + 1)].join('.');
        }
        labels[lvl] = num ? `${num} ${e.title}` : e.title;
        for (let k = lvl + 1; k < 3; k++) labels[k] = '';
      }
      snaps.push({ pos: e.pos, section: special || labels.filter(Boolean).join(' › ') });
    }

    const intervals = [];
    const stack = [];
    const fl = /\\(begin|end)\s*\{(figure\*?|table\*?|sidewaysfigure|sidewaystable|wrapfigure|wraptable)\}/g;
    while ((m = fl.exec(text))) {
      if (m[1] === 'begin') stack.push({ pos: m.index, kind: /table/.test(m[2]) ? 'Table' : 'Figure' });
      else if (stack.length) { const b = stack.pop(); intervals.push([b.pos, m.index, b.kind]); }
    }
    const fn = /\\footnote(?:text)?\s*(?:\[[^\]]*\]\s*)?\{/g;
    while ((m = fn.exec(text))) {
      const open = m.index + m[0].length - 1;
      const end = readBalanced(text, open, '{', '}', 6000);
      if (end > 0) intervals.push([m.index, end, 'Footnote']);
    }

    return pos => {
      let lo = 0, hi = snaps.length - 1, s = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (snaps[mid].pos <= pos) { s = snaps[mid]; lo = mid + 1; } else hi = mid - 1; }
      const where = intervals.filter(([a, b]) => pos >= a && pos < b).map(x => x[2]);
      return { section: (s && s.section) || 'Before the first section', where: [...new Set(where)] };
    };
  }

  /* ------------------------------------------------------------------ *
   * 7. Putting it together
   * ------------------------------------------------------------------ */

  const ABBR = /(?:\bet al|\be\.g|\bi\.e|\bcf|\bvs|\bFigs?|\bEqs?|\bSecs?|\bRefs?|\bTabs?|\bApp|\bapprox|\bresp|\bNo|\bresp|(?:^|\s)[A-Z])$/;
  const STRUCT = /\\(?:section|subsection|subsubsection|paragraph|item|caption|footnote|begin\s*\{[^}]*\}|end\s*\{[^}]*\})\*?(?:\[[^\]]*\])?\s*\{?/g;

  function analyze(files) {
    const main = findMain(files);
    if (!main) throw new Error('Could not find the main .tex file in the source.');
    const mainDir = main.includes('/') ? main.slice(0, main.lastIndexOf('/')) : '';

    const lines = [];
    flatten(files, main, mainDir, lines, new Set(), 0);
    const text = lines.map(l => l.text).join('\n');
    const starts = [];
    { let a = 0; for (const l of lines) { starts.push(a); a += l.text.length + 1; } }
    const locate = pos => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lines[lo];
    };

    let docStart = text.search(/\\begin\s*\{document\}/);
    if (docStart < 0) docStart = 0;

    const bib = readBibliography(files, text, main);
    const macros = findCiteMacros(text);
    const cites = findAllCites(text, docStart, macros);
    const where = structure(text);

    // Reference table
    const refs = bib.refs.map(r => ({
      key: r.key, short: r.short || '', year: r.year || '',
      label: r.label || (r.short ? `${r.short} ${r.year}`.trim() : r.key),
      preview: (r.preview || '').slice(0, 400), hits: []
    }));
    const byKey = new Map(), byLower = new Map();
    refs.forEach(r => { byKey.set(r.key, r); byLower.set(r.key.toLowerCase(), r); });
    const lookup = k => byKey.get(k) || byLower.get(k.toLowerCase());

    const citeText = c => {
      const rs = c.keys.map(k => lookup(k));
      if (bib.kind === 'numeric' || bib.kind === 'alpha') {
        return '[' + rs.map((r, i) => (r ? r.label.replace(/^\[|\]$/g, '') : c.keys[i])).join(', ') + ']';
      }
      const sh = (r, i) => (r && r.short) || c.keys[i];
      const yr = r => (r && r.year) || '';
      const cmd = c.cmd.toLowerCase();
      if (/^(citet|textcite|citealt\*?t)/.test(cmd)) return rs.map((r, i) => `${sh(r, i)} (${yr(r)})`).join(', ');
      if (/^citeauthor/.test(cmd)) return rs.map(sh).join(', ');
      if (/^citeyearpar/.test(cmd)) return '(' + rs.map(yr).join(', ') + ')';
      if (/^citeyear/.test(cmd)) return rs.map(yr).join(', ');
      if (/^citeal[tp]/.test(cmd)) return rs.map((r, i) => `${sh(r, i)} ${yr(r)}`.trim()).join('; ');
      return '(' + rs.map((r, i) => `${sh(r, i)} ${yr(r)}`.trim()).join('; ') + ')';
    };

    const render = (a, b) => {
      let out = '', p = a;
      for (const c of cites) {
        if (c.pos < a || c.end > b) continue;
        out += cleanPlain(text.slice(p, c.pos)) + ' ' + citeText(c) + ' ';
        p = c.end;
      }
      out += cleanPlain(text.slice(p, b));
      return out.replace(/\s+/g, ' ').replace(/\s+([,.;:)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').trim();
    };

    const sentenceStart = pos => {
      const lo = Math.max(docStart, pos - 700);
      const para = text.lastIndexOf('\n\n', pos - 1);
      let s = Math.max(lo, para < 0 ? 0 : para + 2);
      const seg = text.slice(s, pos);
      let best = 0, m;
      const re = /[.!?]['")\]}$]*\s+/g;
      while ((m = re.exec(seg))) if (!ABBR.test(seg.slice(0, m.index))) best = m.index + m[0].length;
      STRUCT.lastIndex = 0;
      while ((m = STRUCT.exec(seg))) {
        let after = m.index + m[0].length;
        // Skip a heading's title; keep the text of captions and footnotes.
        if (m[0].endsWith('{') && /^\\(?:sub)*section|^\\paragraph/.test(m[0])) {
          const e = readBalanced(seg, after - 1, '{', '}', 800);
          if (e > 0) after = e;
        }
        best = Math.max(best, after);
      }
      return s + best;
    };
    const sentenceEnd = pos => {
      const hi = Math.min(text.length, pos + 700);
      const para = text.indexOf('\n\n', pos);
      const e = para < 0 || para > hi ? hi : para;
      const seg = text.slice(pos, e);
      let best = seg.length, m;
      const re = /[.!?]['")\]}$]*(?=\s|$)/g;
      while ((m = re.exec(seg))) if (!ABBR.test(seg.slice(0, m.index))) { best = m.index + m[0].length; break; }
      STRUCT.lastIndex = 0;
      if ((m = STRUCT.exec(seg)) && m.index < best) best = m.index;
      return pos + best;
    };

    const plainWord = t => /^[A-Za-z][A-Za-z'’-]*[,;:]?$/.test(t);
    const trimPunct = s => s.replace(/[,;:]$/, '');
    const phraseFrom = (before, after) => {
      const tb = before.split(' ').filter(Boolean);
      let run = [];
      for (let i = tb.length - 1; i >= 0; i--) {
        if (plainWord(tb[i])) run.unshift(tb[i]);
        else if (run.length >= 3) break;
        else run = [];
      }
      if (run.length >= 3) return trimPunct(run.slice(-5).join(' '));
      run = [];
      for (const t of after.split(' ').filter(Boolean)) {
        if (plainWord(t)) { run.push(t); if (run.length === 5) break; }
        else if (run.length >= 3) break;
        else run = [];
      }
      if (run.length >= 3) return trimPunct(run.join(' '));
      return trimPunct(tb.slice(-4).join(' '));
    };

    for (const c of cites) {
      const loc = locate(c.pos);
      const ctx = where(c.pos);
      const before = render(sentenceStart(c.pos), c.pos);
      const after = render(c.end, sentenceEnd(c.end));
      const hit = {
        section: ctx.section, where: ctx.where, file: loc.file, line: loc.line,
        before, cite: citeText(c), after, phrase: phraseFrom(before, after)
      };
      for (const k of new Set(c.keys)) {
        let r = lookup(k);
        if (!r) {
          r = { key: k, short: '', year: '', label: k, preview: 'Not found in the bibliography.', hits: [], missing: true };
          refs.push(r); byKey.set(k, r); byLower.set(k.toLowerCase(), r);
        }
        r.hits.push(hit);
      }
    }

    if (bib.source === 'bib') {
      // A raw .bib has no meaningful order: list references in order of first citation.
      const first = r => (r.hits.length ? cites.findIndex(c => c.keys.includes(r.key)) : 1e9);
      refs.sort((a, b) => first(a) - first(b));
    }

    return {
      mainFile: main,
      fileCount: Object.keys(files).length,
      style: bib.kind,
      bibSource: bib.source,
      citeCount: cites.length,
      refs
    };
  }

  const api = { extractSource, analyze, _internal: { untar, cleanPlain, parseBibitems, findCiteMacros } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArxivCite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
