// Bangla / English switch for the whole app. Translates the page as it is drawn (text, placeholders, titles),
// so every screen works in both languages without changing each page. Dictionary: /js/bn.js (window.BN_DICT, window.BN_PATTERNS).
(function () {
  const KEY = document.documentElement.getAttribute('data-langkey') || 'bx_lang';
  let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
  const D = window.BN_DICT || {}, LOWER = {};
  Object.keys(D).forEach(k => { const l = k.toLowerCase(); if (!(l in LOWER)) LOWER[l] = D[k]; });
  const PATS = (window.BN_PATTERNS || []).map(p => [new RegExp('^' + p[0] + '$', p[2] || ''), p[1]]);
  const cache = new Map(), SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, SVG: 1, svg: 1 };
  const ORIG = new WeakMap(), DONE = new WeakMap();
  const SPLIT = /^([^A-Za-z0-9(“"'#৳%]*)([\s\S]*?)([\s:*…→↗▾▼▲?!.·]*)$/u;
  function exact(s) { if (s in D) return D[s]; const l = s.toLowerCase(); return l in LOWER ? LOWER[l] : null; }
  function pat(s) { for (const [re, rep] of PATS) { if (re.test(s)) return s.replace(re, (...m) => rep.replace(/\$(\d)/g, (_, i) => { const x = m[+i] || ''; return tr(x) || x; })); } return null; }
  function tr(s) {
    if (!s || !/[A-Za-z]/.test(s)) return null;
    if (cache.has(s)) return cache.get(s);
    cache.set(s, null);   // guards against recursion
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], t = s.trim();
    const m = SPLIT.exec(t); const core = m && m[2] && m[2] !== t ? m[2] : null;
    const wrap = c => m[1] + c + (m[3] === '.' && /।$/.test(c) ? '' : m[3].replace(/^\.$/, '।'));
    let v = exact(t);
    if (v === null && core) { const c = exact(core); if (c !== null) v = wrap(c); }
    if (v === null) v = pat(t);
    if (v === null && core) { const c = pat(core); if (c !== null) v = wrap(c); }
    if (v === null) for (const sep of [' · ', ' — ', ', ', ' / ']) { if (!t.includes(sep)) continue; let any = false; const r = t.split(sep).map(p => { const x = tr(p); if (x !== null) { any = true; return x.trim(); } return p; }); if (any) { v = r.join(sep); break; } }
    const out = v !== null ? lead + v + trail : null;
    cache.set(s, out); return out;
  }
  function textNode(n) {
    const prev = DONE.get(n); if (prev !== undefined && prev === n.data) return;
    const r = tr(n.data); if (r !== null && r !== n.data) { ORIG.set(n, n.data); n.data = r; DONE.set(n, r); } else DONE.set(n, n.data);
  }
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function element(el) {
    if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent);
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && el['_tr_' + a] !== v) { const r = tr(v); const nv = r !== null ? r : v; el['_tr_' + a] = nv; if (nv !== v) el.setAttribute(a, nv); } }
    if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value && !el._trv) { el._trv = 1; const r = tr(el.value); if (r) el.value = r; }
  }
  function skip(el) { for (let e = el; e && e.nodeType === 1; e = e.parentNode) { if (SKIP[e.tagName] || (e.hasAttribute && (e.hasAttribute('data-notr') || e.isContentEditable))) return true; } return false; }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skip(root.parentNode)) textNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skip(root)) return; element(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && (SKIP[n.tagName] || n.hasAttribute('data-notr')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else element(n); }
  }
  let obs = null;
  function start() {
    walk(document.body); if (document.title) { const r = tr(document.title); if (r) document.title = r; }
    obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') { if (!skip(m.target.parentNode)) textNode(m.target); } else if (m.type === 'attributes') { const el = m.target; if (el['_tr_' + m.attributeName] !== el.getAttribute(m.attributeName) && !skip(el)) element(el); } else m.addedNodes.forEach(walk); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  const I18N = window.I18N = {
    lang: 'en', key: KEY,
    t: s => (I18N.lang === 'bn' ? (tr(String(s)) || s) : s),
    // default comes from the restaurant / platform setting; the person's own choice (saved on this device) wins
    init(def) { const l = saved || def || 'en'; I18N.lang = l === 'bn' ? 'bn' : 'en'; document.documentElement.lang = I18N.lang; if (I18N.lang === 'bn') { document.documentElement.classList.add('lang-bn'); if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); } return I18N.lang; },
    set(l, reload = true) { try { localStorage.setItem(KEY, l); } catch (e) { } if (reload) location.reload(); else I18N.lang = l; },
    toggleHTML(cls = '') { return `<span class="langtg ${cls}" data-notr><button type="button" data-setlang="bn" class="${I18N.lang === 'bn' ? 'on' : ''}">বাং</button><button type="button" data-setlang="en" class="${I18N.lang === 'en' ? 'on' : ''}">EN</button></span>`; }
  };
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-setlang]'); if (b) { e.preventDefault(); if (b.dataset.setlang !== I18N.lang) I18N.set(b.dataset.setlang); } });
  const oc = window.confirm.bind(window), oa = window.alert.bind(window), op = window.prompt.bind(window);
  window.confirm = m => oc(I18N.t(m)); window.alert = m => oa(I18N.t(m)); window.prompt = (m, d) => op(I18N.t(m), d);
})();
