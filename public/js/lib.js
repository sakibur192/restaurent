// Baybex shared browser helpers (no framework)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(16).slice(2));
window.CUR = window.CUR || '৳';
window.TZ = window.TZ || 'Asia/Dhaka';

async function api(method, url, body, opts = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch (e) { const err = new Error('No internet connection. Please check your network.'); err.offline = true; throw err; }
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status; err.code = data && data.code;
    if (res.status === 401 && !opts.noRedirect) { location.href = opts.loginUrl || '/login'; }
    if (data && data.code === 'SETUP') location.href = '/setup';
    throw err;
  }
  return data;
}
const GET = (u, o) => api('GET', u, undefined, o), POST = (u, b, o) => api('POST', u, b || {}, o), PUT = (u, b, o) => api('PUT', u, b || {}, o), DEL = (u, b, o) => api('DELETE', u, b || {}, o);

// formatting
const n2 = v => (Number(v) || 0);
// pick the Bangla or English version of a sentence (for text built from several pieces)
const L = (en, bn) => (window.I18N && I18N.lang === 'bn' ? bn : en);
const fmt = {
  money: v => { const n = n2(v); return (n < 0 ? '-' : '') + CUR + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 }); },
  num: (v, d = 2) => n2(v).toLocaleString('en-IN', { maximumFractionDigits: d }),
  date: d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  dt: d => d ? new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
  time: d => d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
  ago: d => { if (!d) return '—'; const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'; },
  mins: d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 60000) : 0,
  label: s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
};
function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const STATUS_CLS = { completed: 'ok', paid: 'ok', active: 'ok', approved: 'ok', available: 'ok', delivered: 'ok', ready: 'ok', confirmed: 'ok', seated: 'ok', resolved: 'ok', received: 'ok',
  open: 'info', trial: 'info', preparing: 'warn', pending: 'warn', held: 'warn', assigned: 'info', picked: 'info', booked: 'info', ordered: 'warn', waitlist: 'warn', reserved: 'info', cleaning: 'warn', 'in progress': 'warn',
  cancelled: 'bad', rejected: 'bad', expired: 'bad', suspended: 'bad', failed: 'bad', no_show: 'bad', occupied: 'bad', merged: '', new: 'info' };
const badge = s => `<span class="badge ${STATUS_CLS[s] || ''}">${esc(fmt.label(s))}</span>`;

// toast
function toast(msg, type = '') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 5000 : 2800);
}
const errToast = e => toast(e.message || String(e), 'err');

// modal
function modal({ title = '', body = '', actions = [], size = '', onClose, noClose } = {}) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${size}" role="dialog"><div class="mh"><h3>${esc(title)}</h3><button class="btn ghost icon" data-x aria-label="Close">✕</button></div><div class="mb"></div>${actions.length ? '<div class="mf"></div>' : ''}</div>`;
  const mb = $('.mb', ov);
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape' && !noClose) close(); };
  document.addEventListener('keydown', onKey);
  $('[data-x]', ov).onclick = close;
  ov.addEventListener('mousedown', e => { if (e.target === ov && !noClose) close(); });
  const mf = $('.mf', ov);
  actions.forEach(a => {
    const b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    b.onclick = async () => {
      if (a.onClick) { b.disabled = true; try { const r = await a.onClick({ close, el: ov, body: mb }); if (r !== false && a.close !== false) close(); } catch (e) { errToast(e); } finally { b.disabled = false; } }
      else close();
    };
    mf.appendChild(b);
  });
  document.body.appendChild(ov);
  const f = $('input:not([type=hidden]):not([type=checkbox]),select,textarea', mb); if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 50);
  return { el: ov, body: mb, close };
}
function confirmBox(msg, { title = 'Please confirm', ok = 'Yes', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    modal({ title, body: `<p style="margin:0">${esc(msg)}</p>`, onClose: () => { if (!done) res(false); },
      actions: [{ label: 'Cancel', onClick: () => { done = true; res(false); } }, { label: ok, cls: danger ? 'danger' : 'primary', onClick: () => { done = true; res(true); } }] });
  });
}
function askText(title, { label = '', value = '', type = 'text', placeholder = '', required = true } = {}) {
  return new Promise(res => {
    let done = false;
    const m = modal({ title, body: `<label class="f"><span>${esc(label)}</span><input type="${type}" id="askv" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`, onClose: () => { if (!done) res(null); },
      actions: [{ label: 'Cancel' }, { label: 'OK', cls: 'primary', onClick: () => { const v = $('#askv').value.trim(); if (required && !v) { toast('Please fill this in', 'err'); return false; } done = true; res(v); } }] });
    $('#askv', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') $('.mf .primary', m.el).click(); });
  });
}
// manager approval PIN
function askPIN(title = 'Manager approval') {
  return new Promise(res => {
    let pin = '', done = false;
    const m = modal({ title, body: `<p class="muted center mt0">Ask a manager to enter their PIN</p><div class="pindots">${'<i></i>'.repeat(6)}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>`, onClose: () => { if (!done) res(null); } });
    const draw = () => $$('.pindots i', m.el).forEach((d, i) => d.classList.toggle('f', i < pin.length));
    $$('.pinpad button', m.el).forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'C') pin = ''; else if (k === 'OK') { if (pin.length >= 4) { done = true; m.close(); res(pin); } return; } else if (pin.length < 6) pin += k;
      draw();
    });
  });
}
// run an API call; if it needs approval, ask a manager PIN and retry
async function withApproval(fn) {
  try { return await fn(null); }
  catch (e) {
    if (e.code !== 'APPROVAL') throw e;
    const pin = await askPIN(e.message);
    if (!pin) throw new Error('Cancelled');
    return fn(pin);
  }
}

// tables
function table(cols, rows, { empty = 'Nothing here yet', onRow, foot, rowCls } = {}) {
  if (!rows || !rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => `<tr data-i="${i}" class="${onRow ? 'click' : ''} ${rowCls ? rowCls(r) : ''}">${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key])}</td>`).join('')}</tr>`).join('');
  const ft = foot ? `<tfoot><tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${foot[c.key] !== undefined ? esc(foot[c.key]) : ''}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${ft}</table></div>`;
}
function bindRows(el, rows, fn) { $$('tbody tr', el).forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('button,a,input,select')) return; fn(rows[+tr.dataset.i], e); })); }
// auto table from report rows
function autoTable(rows, opts = {}) {
  if (!rows || !rows.length) return `<div class="empty">No data for this period</div>`;
  const moneyKeys = /total|amount|revenue|cost|profit|sales|spent|vat|service|discount|gross|value|delivery|due|paid|refund|ticket|charges|purchased|returns|cash|price/i;
  const cols = Object.keys(rows[0]).map(k => ({ key: k, label: fmt.label(k), num: typeof rows[0][k] === 'number',
    fmt: v => typeof v === 'number' ? (moneyKeys.test(k) && !/pct|qty|orders|items|count|min|hours|days|guests|visits|points/i.test(k) ? fmt.money(v) : fmt.num(v)) : (v && /_at$|^date$/.test(k) ? (k === 'date' ? fmt.date(v) : fmt.dt(v)) : (v === null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)) }));
  let foot = null;
  if (opts.totals !== false) { foot = {}; cols.forEach((c, i) => { if (c.num && !/pct|avg|_min|price|per_/.test(c.key)) foot[c.key] = c.fmt(rows.reduce((s, r) => s + n2(r[c.key]), 0)); }); foot[cols[0].key] = foot[cols[0].key] || 'Total'; }
  return table(cols, rows, { foot });
}

// simple SVG charts
function barChart(labels, values, { h = 220, money = true } = {}) {
  const max = Math.max(1, ...values.map(n2)); const w = Math.max(320, labels.length * 34); const bw = (w - 40) / labels.length;
  const bars = values.map((v, i) => { const bh = (n2(v) / max) * (h - 40); return `<rect class="bar" x="${30 + i * bw + 3}" y="${h - 22 - bh}" width="${Math.max(4, bw - 6)}" height="${bh}" rx="4"><title>${esc(labels[i])}: ${money ? fmt.money(v) : fmt.num(v)}</title></rect>`; }).join('');
  const step = Math.ceil(labels.length / 14);
  const lbl = labels.map((l, i) => i % step === 0 ? `<text x="${30 + i * bw + bw / 2}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>` : '').join('');
  const grid = [0, .5, 1].map(f => `<line x1="28" x2="${w}" y1="${h - 22 - f * (h - 40)}" y2="${h - 22 - f * (h - 40)}" stroke="#eef1f4"/><text x="24" y="${h - 19 - f * (h - 40)}" text-anchor="end">${fmt.num(max * f, 0)}</text>`).join('');
  return `<svg class="chart bars" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px">${grid}${bars}${lbl}</svg>`;
}
function hbars(items, { money = true } = {}) {
  const max = Math.max(1, ...items.map(i => n2(i.value)));
  return items.map(i => `<div class="hbar"><div class="lb" title="${esc(i.label)}">${esc(i.label)}</div><div class="tr2"><div class="fl" style="width:${n2(i.value) / max * 100}%"></div></div><div class="vl">${money ? fmt.money(i.value) : fmt.num(i.value)}</div></div>`).join('') || '<div class="empty">No data</div>';
}

// CSV
function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const q = v => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [keys.join(','), ...rows.map(r => keys.map(k => q(r[k])).join(','))].join('\n');
}
function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// image: resize in browser then send as data URL
function imageToDataURL(file, max = 900) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/jpeg', .85)); }; img.onerror = () => rej(new Error('Not an image')); img.src = rd.result; };
    rd.onerror = rej; rd.readAsDataURL(file);
  });
}
// print an HTML snippet (receipts, QR sheets, reports)
function printHTML(html, { width = null, title = 'Print' } = {}) {
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const d = fr.contentWindow.document;
  d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{margin:${width ? '0' : '12mm'}${width ? ';size:' + width + 'mm auto' : ''}} body{font-family:${width ? "'Courier New',monospace" : 'Inter,Arial,sans-serif'};font-size:${width ? '12px' : '13px'};margin:${width ? '4mm' : '0'};color:#000}
    table{width:100%;border-collapse:collapse} td,th{padding:3px 4px;text-align:left;vertical-align:top} .r{text-align:right} .c{text-align:center} .b{font-weight:bold} .hr{border-top:1px dashed #000;margin:6px 0}
    .big{font-size:16px} .tbl th,.tbl td{border-bottom:1px solid #ddd;padding:6px} h1,h2,h3{margin:0 0 6px} .qrgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px} .qrcard{border:1px solid #999;border-radius:8px;padding:10px;text-align:center;break-inside:avoid} .qrcard svg{width:100%;max-width:180px;height:auto}
  </style></head><body>${html}</body></html>`);
  d.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 350);
}
// short beep for new orders
let _ac;
function beep(times = 2) {
  try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) { const o = _ac.createOscillator(), g = _ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(_ac.destination); g.gain.setValueAtTime(.25, _ac.currentTime + i * .25); g.gain.exponentialRampToValueAtTime(.001, _ac.currentTime + i * .25 + .2); o.start(_ac.currentTime + i * .25); o.stop(_ac.currentTime + i * .25 + .22); }
  } catch (e) { /* sound not available */ }
}
const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const imgUrl = id => id ? '/f/' + id : '';
