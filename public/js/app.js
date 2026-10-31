// Restaurant app: shell, router, generic forms & CRUD, dashboard, settings, billing
const APP = { me: null, meta: null, refs: {}, pages: {}, poll: { last: 0 } };
const can = p => APP.me && [].concat(p).some(x => APP.me.user.perms.includes(x));
const NAV = [
  { g: 'Operations' },
  { k: 'dashboard', i: '📊', l: 'Dashboard' },
  { k: 'pos', i: '🧾', l: 'POS · New order', p: 'pos' },
  { k: 'orders', i: '📋', l: 'Orders', p: ['orders', 'pos'], cnt: 'pending' },
  { k: 'tables', i: '🍽️', l: 'Tables & floor', p: 'tables' },
  { k: 'kitchen', i: '👨‍🍳', l: 'Kitchen display', p: 'kitchen' },
  { k: 'delivery', i: '🛵', l: 'Delivery', p: 'delivery' },
  { k: 'reservations', i: '📅', l: 'Reservations', p: 'reservations' },
  { k: 'shift', i: '💵', l: 'My cash shift', p: 'shifts' },
  { k: 'attendance', i: '⏱️', l: 'Clock in / out', p: 'attendance', hideIf: 'staff' },
  { g: 'Manage' },
  { k: 'menu', i: '🍔', l: 'Menu & products', p: 'menu' },
  { k: 'inventory', i: '📦', l: 'Inventory', p: 'inventory' },
  { k: 'recipes', i: '🧪', l: 'Recipes & food cost', p: 'recipes' },
  { k: 'purchases', i: '🚚', l: 'Purchases & suppliers', p: ['purchases', 'suppliers'] },
  { k: 'customers', i: '👥', l: 'Customers & CRM', p: 'customers' },
  { k: 'offers', i: '🎁', l: 'Offers & loyalty', p: 'coupons' },
  { k: 'staff', i: '🧑‍🍳', l: 'Staff & payroll', p: 'staff' },
  { g: 'Finance' },
  { k: 'accounting', i: '💰', l: 'Accounting', p: 'accounting' },
  { k: 'reports', i: '📈', l: 'Reports', p: 'reports' },
  { g: 'Setup' },
  { k: 'branches', i: '🏬', l: 'Branches', p: 'branches' },
  { k: 'settings', i: '⚙️', l: 'Settings', p: 'settings' },
  { k: 'billing', i: '💳', l: 'Subscription', owner: true }
];

APP.boot = async function () {
  try { APP.me = await GET('/api/app/me'); } catch (e) { return; }
  const me = APP.me, s = me.tenant.settings;
  CUR = s.currency || '৳'; TZ = s.timezone || 'Asia/Dhaka';
  if (s.color) document.documentElement.style.setProperty('--brand', s.color);
  document.title = me.tenant.name;
  APP.meta = await GET('/api/app/meta').catch(() => ({ resources: {}, perms: {} }));
  const inactive = ['expired', 'suspended'].includes(me.tenant.status);
  const navHtml = NAV.filter(n => n.g || (n.owner ? (me.user.is_owner || can('settings')) : (!n.p || can(n.p)) && !(n.hideIf && can(n.hideIf))))
    .reduce((a, n, i, arr) => { if (n.g && (!arr[i + 1] || arr[i + 1].g)) return a; a.push(n); return a; }, [])
    .map(n => n.g ? `<div class="grp">${n.g}</div>` : `<a href="#/${n.k}" data-k="${n.k}"><span class="ic">${n.i}</span>${n.l}${n.cnt ? `<span class="cnt" id="cnt-${n.cnt}" style="display:none"></span>` : ''}</a>`).join('');
  const daysLeft = me.tenant.expires_at ? Math.ceil((new Date(me.tenant.expires_at) - Date.now()) / 86400000) : null;
  let banner = '';
  if (me.tenant.status === 'suspended') banner = `<div class="banner bad">Your account is suspended. Please contact ${esc(me.brand.phone || 'support')}.</div>`;
  else if (me.tenant.status === 'expired') banner = `<div class="banner bad">Your subscription has expired. <a href="#/billing">Renew now</a> to continue — your data is safe.</div>`;
  else if (daysLeft !== null && daysLeft <= 5) banner = `<div class="banner warn">${me.tenant.status === 'trial' ? 'Free trial' : 'Subscription'} ends in ${Math.max(0, daysLeft)} day(s). <a href="#/billing">Renew / pay now</a></div>`;
  if (me.user.impersonated) banner += `<div class="banner info">Support mode — you are logged in as this restaurant's owner from the super admin panel.</div>`;
  banner += (me.announcements || []).map(a => `<div class="banner ${a.level === 'bad' ? 'bad' : a.level === 'warn' ? 'warn' : 'info'}">📢 ${esc(a.title)}${a.body ? ' — ' + esc(a.body) : ''}</div>`).join('');
  const brs = me.branches.filter(b => b.active || b.id === me.branch_id);
  $('#root').innerHTML = `<div class="shell"><aside class="side" id="side">
      <div class="brand"><div class="logo">${s.logo_id ? `<img src="/f/${s.logo_id}">` : esc(initials(me.tenant.name))}</div><div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(me.tenant.name)}</div><div class="tn">${esc(me.user.name)} · ${esc(me.user.role || '')}</div></div></div>
      <nav class="nav">${navHtml}</nav></aside>
    <div class="main">${banner}<div class="top noprint"><button class="btn ghost icon burger" id="burger">☰</button><div class="title" id="ttl"></div>
      ${brs.length > 1 || !me.branch_locked ? `<select id="brsel" ${me.branch_locked ? 'disabled' : ''} title="Branch">${brs.map(b => `<option value="${b.id}" ${b.id === me.branch_id ? 'selected' : ''}>🏬 ${esc(b.name)}</option>`).join('')}</select>` : ''}
      <button class="btn ghost icon bell" id="bell" title="Notifications">🔔<span class="dot" id="bdot" style="display:none"></span></button>
      <div style="position:relative"><button class="btn ghost" id="um">${esc(initials(me.user.name))} ▾</button><div class="menu-pop" id="umenu" style="display:none">
        <div class="small muted" style="padding:8px 12px">${esc(me.user.name)} · @${esc(me.user.username)}<br>Restaurant ID: <b>${esc(me.tenant.slug)}</b></div>
        <button id="mpw">Change password</button><button id="mpin">Set my quick PIN</button><button id="mlock">Lock / switch user</button><button id="mout">Log out</button></div></div>
    </div><div class="page" id="page"></div></div></div>`;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  if ($('#brsel')) $('#brsel').onchange = async e => { await POST('/api/app/switch-branch', { branch_id: +e.target.value }); location.reload(); };
  $('#um').onclick = e => { e.stopPropagation(); const m = $('#umenu'); m.style.display = m.style.display === 'none' ? '' : 'none'; };
  document.addEventListener('click', () => { $('#umenu').style.display = 'none'; });
  $('#mout').onclick = async () => { await POST('/api/auth/logout'); location.href = '/login'; };
  $('#mlock').onclick = async () => { await POST('/api/auth/logout'); location.href = '/login?r=' + me.tenant.slug; };
  $('#mpw').onclick = () => modal({ title: 'Change password', body: `<label class="f"><span>Current password</span><input type="password" id="cp1"></label><label class="f"><span>New password</span><input type="password" id="cp2"></label>`,
    actions: [{ label: 'Cancel' }, { label: 'Change', cls: 'primary', onClick: async () => { await POST('/api/app/change-password', { current: $('#cp1').value, password: $('#cp2').value }); toast('Password changed', 'ok'); } }] });
  $('#mpin').onclick = async () => { const pin = await askText('Quick PIN', { label: 'Choose a 4-6 digit PIN for fast login & approvals', type: 'password' }); if (pin) { await POST('/api/app/my-pin', { pin }); toast('PIN saved', 'ok'); } };
  $('#bell').onclick = () => location.hash = '#/notifications';
  if (inactive && !location.hash.startsWith('#/billing')) location.hash = '#/billing';
  window.addEventListener('hashchange', APP.route); APP.route();
  APP.startPoll();
};
APP.route = function () {
  const raw = location.hash.slice(2) || (can('pos') && !can('reports') ? 'pos' : can('kitchen') && !can('pos') ? 'kitchen' : 'dashboard');
  const [path, qs] = raw.split('?'); const parts = path.split('/'); const k = parts[0];
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  if (['expired', 'suspended'].includes(APP.me.tenant.status) && !['billing', 'notifications'].includes(k)) { location.hash = '#/billing'; return; }
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === k));
  $('#side').classList.remove('open');
  const n = NAV.find(x => x.k === k); $('#ttl').textContent = n ? n.l : fmt.label(k);
  document.body.classList.toggle('kds-full', k === 'kitchen' && params.full === '1');
  if (APP.cleanup) { try { APP.cleanup(); } catch (e) { } APP.cleanup = null; }
  const page = $('#page'); page.style.padding = ['pos'].includes(k) ? '0' : '';
  page.innerHTML = '<div class="loading"><span class="spin"></span></div>';
  const fn = APP.pages[k];
  if (!fn) { page.innerHTML = '<div class="empty">Page not found</div>'; return; }
  Promise.resolve(fn(page, params, parts.slice(1))).catch(e => { page.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; });
};
APP.go = h => { if (location.hash === h) APP.route(); else location.hash = h; };
APP.startPoll = function () {
  const tick = async () => {
    try {
      const r = await GET('/api/app/poll?since=' + APP.poll.last, { noRedirect: true });
      const d = $('#bdot'); d.textContent = r.unread; d.style.display = r.unread ? '' : 'none';
      const c = $('#cnt-pending'); if (c) { c.textContent = r.pending_online; c.style.display = r.pending_online ? '' : 'none'; }
      if (APP.poll.last && r.items.length) {
        const fresh = r.items.filter(i => i.id > APP.poll.last).reverse();
        fresh.slice(-3).forEach(i => toast(`${i.title}${i.body ? ' — ' + i.body : ''}`, i.type === 'stock' ? 'err' : ''));
        if (fresh.some(i => ['online', 'ready'].includes(i.type))) beep(2);
        if (APP.onPoll) APP.onPoll(fresh);
      }
      APP.poll.last = Math.max(APP.poll.last, r.last_id || 0);
    } catch (e) { /* offline */ }
  };
  tick(); setInterval(tick, 12000);
};

// ---------- refs (dropdown data) ----------
async function refList(res, force) {
  if (!APP.refs[res] || force) APP.refs[res] = await GET(`/api/r/${res}?limit=2000`).catch(() => []);
  return APP.refs[res];
}
const refName = (res, id) => { const r = (APP.refs[res] || []).find(x => x.id === id); return r ? (r.name || r.code || r.customer_name || '#' + r.id) : (id ? '#' + id : '—'); };

// ---------- schema-driven forms ----------
function fieldHTML(k, f, v) {
  const lab = `<span>${esc(f.label)}${f.req ? ' <b class="req">*</b>' : ''}</span>`;
  const val = v === undefined || v === null ? (f.def !== undefined && !['today', 'month'].includes(f.def) ? f.def : f.def === 'today' ? todayStr() : f.def === 'month' ? todayStr().slice(0, 7) : '') : v;
  switch (f.t) {
    case 'bool': return `<label class="check full"><input type="checkbox" name="${k}" data-t="bool" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'textarea': return `<label class="f full">${lab}<textarea name="${k}">${esc(val)}</textarea></label>`;
    case 'num': case 'int': return `<label class="f">${lab}<input type="number" step="${f.t === 'int' ? 1 : 'any'}" name="${k}" value="${esc(val)}" ${f.ro ? 'disabled' : ''}></label>`;
    case 'date': return `<label class="f">${lab}<input type="date" name="${k}" value="${esc(val ? String(val).slice(0, 10) : '')}"></label>`;
    case 'time': return `<label class="f">${lab}<input type="time" name="${k}" value="${esc(val)}"></label>`;
    case 'select': return `<label class="f">${lab}<select name="${k}">${f.options.map(o => `<option value="${esc(o)}" ${String(val) === o ? 'selected' : ''}>${esc(o === '' ? '—' : fmt.label(o))}</option>`).join('')}</select></label>`;
    case 'ref': { const list = APP.refs[f.ref] || []; return `<label class="f">${lab}<select name="${k}" data-t="int"><option value="">— None —</option>${list.filter(x => x.active !== false || x.id === val).map(x => `<option value="${x.id}" ${x.id === val ? 'selected' : ''}>${esc(x.name || x.code || x.customer_name)}</option>`).join('')}</select></label>`; }
    case 'image': return `<div class="f full"><span style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">${esc(f.label)}</span><div class="img-up"><img src="${val ? '/f/' + val : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" data-img="${k}"><input type="hidden" name="${k}" data-t="int" value="${esc(val)}"><input type="file" accept="image/*" data-up="${k}"><button type="button" class="btn sm" data-rmimg="${k}">Remove</button></div></div>`;
    case 'json':
      if (f.kind === 'priced') { const rows = Array.isArray(val) ? val : []; return `<div class="f full"><span style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">${esc(f.label)}</span><div class="pricerows" data-json="${k}">${rows.map(r => priceRow(r)).join('')}</div><button type="button" class="btn sm" data-addrow="${k}">+ Add</button></div>`; }
      if (f.kind === 'branches') { const sel = (Array.isArray(val) ? val : []).map(String); return `<div class="f full"><span style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">${esc(f.label)}</span><div class="row" data-json="${k}" data-kind="branches">${APP.me.branches.map(b => `<label class="check" style="margin:0 10px 0 0"><input type="checkbox" value="${b.id}" ${sel.includes(String(b.id)) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div></div>`; }
      if (f.kind === 'branchprices') { const o = val && typeof val === 'object' ? val : {}; return `<div class="f full"><span style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">${esc(f.label)} <span class="muted">(leave empty = normal price)</span></span><div class="grid g3" data-json="${k}" data-kind="branchprices">${APP.me.branches.map(b => `<label class="f"><span>${esc(b.name)}</span><input type="number" step="any" data-b="${b.id}" value="${esc(o[b.id] ?? '')}"></label>`).join('')}</div></div>`; }
      return '';
    default: return `<label class="f">${lab}<input type="${f.t === 'email' ? 'email' : f.t === 'phone' ? 'tel' : 'text'}" name="${k}" value="${esc(val)}" ${f.ro ? 'disabled' : ''}></label>`;
  }
}
const priceRow = r => `<div class="pr-row"><input placeholder="Name (e.g. Large)" value="${esc(r && r.name || '')}" data-pn><input type="number" step="any" placeholder="Price" value="${esc(r && r.price !== undefined ? r.price : '')}" data-pp><button type="button" class="btn icon danger" data-rmrow>✕</button></div>`;
async function buildForm(resName, values = {}, { only, skip = [] } = {}) {
  const d = APP.meta.resources[resName];
  for (const f of Object.values(d.fields)) if (f.t === 'ref') await refList(f.ref);
  const entries = Object.entries(d.fields).filter(([k, f]) => !f.ro && !skip.includes(k) && (!only || only.includes(k)));
  const main = entries.filter(([, f]) => !f.hide).map(([k, f]) => fieldHTML(k, f, values[k])).join('');
  const more = entries.filter(([, f]) => f.hide).map(([k, f]) => fieldHTML(k, f, values[k])).join('');
  const el = document.createElement('form'); el.className = 'fgrid'; el.autocomplete = 'off';
  el.innerHTML = main + (more ? `<details class="full"><summary style="cursor:pointer;font-weight:700;color:var(--brand);margin:6px 0 12px">More options</summary><div class="fgrid">${more}</div></details>` : '');
  wireForm(el);
  return el;
}
function wireForm(el) {
  $$('[data-addrow]', el).forEach(b => b.onclick = () => { $(`[data-json="${b.dataset.addrow}"]`, el).insertAdjacentHTML('beforeend', priceRow({})); });
  el.addEventListener('click', e => { if (e.target.matches('[data-rmrow]')) e.target.closest('.pr-row').remove(); if (e.target.matches('[data-rmimg]')) { const k = e.target.dataset.rmimg; $(`[name="${k}"]`, el).value = ''; $(`[data-img="${k}"]`, el).src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; } });
  $$('[data-up]', el).forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const r = await POST('/api/app/upload', { data: await imageToDataURL(f) }); const k = inp.dataset.up; $(`[name="${k}"]`, el).value = r.id; $(`[data-img="${k}"]`, el).src = '/f/' + r.id; } catch (e) { errToast(e); }
  });
}
function readForm(el) {
  const out = {};
  $$('[name]', el).forEach(i => { if (i.disabled) return; if (i.dataset.t === 'bool') out[i.name] = i.checked; else out[i.name] = i.value; });
  $$('[data-json]', el).forEach(c => {
    const k = c.dataset.json;
    if (c.dataset.kind === 'branches') out[k] = $$('input:checked', c).map(x => +x.value);
    else if (c.dataset.kind === 'branchprices') { out[k] = {}; $$('input', c).forEach(x => { if (x.value !== '') out[k][x.dataset.b] = x.value; }); }
    else out[k] = $$('.pr-row', c).map(r => ({ name: $('[data-pn]', r).value.trim(), price: $('[data-pp]', r).value })).filter(r => r.name);
  });
  return out;
}
async function editRecord(resName, row, { title, defaults = {}, onSaved, only, skip, extraActions = [] } = {}) {
  const d = APP.meta.resources[resName];
  const form = await buildForm(resName, Object.assign({}, defaults, row || {}), { only, skip });
  const actions = [];
  if (row && row.id) actions.push({ label: 'Delete', cls: 'danger', onClick: async () => { if (!(await confirmBox('Delete this record? This cannot be undone.', { danger: true, ok: 'Delete' }))) return false; await DEL(`/api/r/${resName}/${row.id}`); toast('Deleted', 'ok'); APP.refs[resName] = null; onSaved && onSaved(); } });
  actions.push(...extraActions, { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => {
    const data = Object.assign({}, defaults, readForm(form));
    const r = row && row.id ? await PUT(`/api/r/${resName}/${row.id}`, data) : await POST(`/api/r/${resName}`, data);
    toast('Saved', 'ok'); APP.refs[resName] = null; onSaved && onSaved(r);
  } });
  return modal({ title: title || ((row && row.id ? 'Edit ' : 'Add ') + d.title.replace(/s$/, '').toLowerCase()), body: form, actions, size: Object.keys(d.fields).length > 8 ? 'wide' : '' });
}
// full CRUD list page for a resource
async function crudPage(el, resName, opts = {}) {
  const d = APP.meta.resources[resName];
  for (const f of Object.values(d.fields)) if (f.t === 'ref') await refList(f.ref);
  const cols = opts.cols || Object.entries(d.fields).filter(([, f]) => !f.hide && f.t !== 'json').map(([k, f]) => ({
    key: k, label: f.label.replace(/\(.*\)/, '').trim(), num: ['num', 'int'].includes(f.t),
    html: f.t === 'image' ? (r => r[k] ? `<img class="thumb" src="/f/${r[k]}">` : `<span class="thumb" style="display:inline-grid;place-items:center;font-weight:700;color:var(--brand)">${esc(initials(r.name))}</span>`)
      : f.t === 'bool' ? (r => r[k] ? '✓' : '<span class="muted">—</span>') : f.t === 'ref' ? (r => esc(refName(f.ref, r[k]))) : f.t === 'select' && ['status', 'type'].includes(k) ? (r => badge(r[k])) : null,
    fmt: f.t === 'date' ? fmt.date : f.t === 'num' && /price|amount|charge|cost|spent|due|deposit|balance|order|discount|value/i.test(k) && !/pct|%/i.test(f.label) ? fmt.money : undefined
  }));
  if (opts.extraCols) cols.push(...opts.extraCols);
  el.innerHTML = `<div class="page-h">${opts.header || ''}<div class="row grow">${d.fields && (opts.search !== false) ? `<input type="search" placeholder="Search…" id="cq" style="max-width:280px">` : ''}${opts.filtersHTML || ''}</div>
    <div class="row">${opts.tools || ''}${opts.importable !== false ? `<button class="btn" id="cexp" title="Export CSV">⬇ CSV</button><label class="btn" title="Import CSV">⬆ Import<input type="file" accept=".csv" id="cimp" hidden></label>` : ''}${opts.readonly ? '' : `<button class="btn primary" id="cadd">+ ${esc(opts.addLabel || 'Add')}</button>`}</div></div>
    ${opts.note ? `<p class="muted mt0">${opts.note}</p>` : ''}<div class="card p0" id="clist"><div class="loading"><span class="spin"></span></div></div>`;
  let rows = [];
  const load = async () => {
    const q = $('#cq') ? $('#cq').value : '';
    const extra = opts.params ? '&' + opts.params() : '';
    rows = await GET(`/api/r/${resName}?q=${encodeURIComponent(q)}${extra}`);
    if (opts.filter) rows = rows.filter(opts.filter);
    $('#clist').innerHTML = table(cols, rows, { onRow: !opts.readonly, empty: opts.empty || `No ${d.title.toLowerCase()} yet. Click "+ ${opts.addLabel || 'Add'}" to create one.` });
    if (!opts.readonly) bindRows($('#clist'), rows, r => (opts.onRow ? opts.onRow(r, load) : editRecord(resName, r, { onSaved: load, defaults: opts.defaults, extraActions: opts.rowActions ? opts.rowActions(r, load) : [] })));
    opts.afterLoad && opts.afterLoad(rows);
  };
  if ($('#cq')) $('#cq').oninput = debounce(load);
  $$('[data-filter]', el).forEach(x => x.onchange = load);
  if ($('#cadd')) $('#cadd').onclick = () => (opts.onAdd ? opts.onAdd(load) : editRecord(resName, null, { onSaved: load, defaults: opts.defaults }));
  if ($('#cexp')) $('#cexp').onclick = () => download(`${resName}.csv`, toCSV(rows.map(r => { const o = {}; Object.keys(d.fields).forEach(k => { o[k] = d.fields[k].t === 'ref' ? refName(d.fields[k].ref, r[k]) : r[k]; }); return o; })));
  if ($('#cimp')) $('#cimp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const data = parseCSV(await f.text());
    if (!data.length) return toast('The file is empty', 'err');
    if (!(await confirmBox(`Import ${data.length} rows into ${d.title}? Columns must match the CSV export (e.g. name, price, category_id).`))) return;
    const r = await POST(`/api/r/${resName}/import`, { rows: data });
    toast(`Imported ${r.imported} rows${r.errors.length ? ', ' + r.errors.length + ' failed' : ''}`, r.errors.length ? 'err' : 'ok');
    if (r.errors.length) modal({ title: 'Import problems', body: `<pre class="small">${esc(r.errors.join('\n'))}</pre>` });
    APP.refs[resName] = null; load();
  };
  await load();
  return { reload: load };
}
// tabs helper
function tabsHTML(base, tabs, cur) { return `<div class="tabs noprint">${tabs.filter(t => !t.p || can(t.p)).map(t => `<a href="#/${base}?tab=${t.k}" class="${cur === t.k ? 'on' : ''}">${t.l}</a>`).join('')}</div>`; }
function pickTab(tabs, params) { const ok = tabs.filter(t => !t.p || can(t.p)); return (ok.find(t => t.k === params.tab) || ok[0] || {}).k; }
// date range bar
function rangeBar(params, { branchAll = true } = {}) {
  const from = params.from || todayStr(), to = params.to || from;
  return `<div class="row noprint"><select id="rq" style="width:auto"><option value="">Quick range</option><option value="0">Today</option><option value="1">Yesterday</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="m">This month</option><option value="pm">Last month</option><option value="y">This year</option></select>
    <input type="date" id="rf" value="${from}" style="width:auto"><span>to</span><input type="date" id="rt" value="${to}" style="width:auto">
    ${branchAll && !APP.me.branch_locked && APP.me.branches.length > 1 ? `<select id="rb" style="width:auto"><option value="">This branch</option><option value="all" ${params.branch === 'all' ? 'selected' : ''}>All branches</option></select>` : ''}
    <button class="btn" id="rgo">Show</button></div>`;
}
function wireRange(base, params) {
  const go = () => { const p = Object.assign({}, params, { from: $('#rf').value, to: $('#rt').value }); if ($('#rb')) p.branch = $('#rb').value; Object.keys(p).forEach(k => { if (!p[k]) delete p[k]; }); APP.go(`#/${base}?${new URLSearchParams(p)}`); };
  $('#rgo').onclick = go;
  $('#rq').onchange = e => { const t = todayStr(), v = e.target.value; let f = t, to = t;
    if (v === '1') f = to = addDays(t, -1); else if (v === '7') f = addDays(t, -6); else if (v === '30') f = addDays(t, -29); else if (v === 'm') f = t.slice(0, 8) + '01';
    else if (v === 'pm') { const d = new Date(t.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0); to = d.toISOString().slice(0, 10); f = to.slice(0, 8) + '01'; } else if (v === 'y') f = t.slice(0, 5) + '01-01';
    $('#rf').value = f; $('#rt').value = to; go(); };
}
const qstr = params => new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([k, v]) => v && ['from', 'to', 'branch'].includes(k)))).toString();

// ================= pages: dashboard / welcome / notifications =================
APP.pages.dashboard = async (el, params) => {
  if (!can('reports') && !APP.me.user.is_owner) {
    const go = can('pos') ? 'pos' : can('kitchen') ? 'kitchen' : can('tables') ? 'tables' : can('attendance') ? 'attendance' : null;
    if (go) return APP.go('#/' + go);
  }
  const d = await GET('/api/app/dashboard?' + qstr(params));
  const k = d.kpi, chg = k.sales_yesterday ? Math.round((k.sales_today - k.sales_yesterday) / k.sales_yesterday * 100) : null;
  el.innerHTML = `<div class="page-h"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${esc(APP.me.user.name.split(' ')[0])} 👋</h1><div class="muted">${fmt.date(d.today)}</div></div>
    <div class="row">${!APP.me.branch_locked && APP.me.branches.length > 1 ? `<select id="db" style="width:auto"><option value="">This branch</option><option value="all" ${params.branch === 'all' ? 'selected' : ''}>All branches</option></select>` : ''}${can('pos') ? '<a class="btn primary lg" href="#/pos">🧾 New order</a>' : ''}</div></div>
    <div class="grid g4">
      <div class="card kpi"><div class="l">Today's sales</div><div class="v">${fmt.money(k.sales_today)}</div><div class="s ${chg >= 0 ? '' : ''}" style="color:${chg === null ? 'var(--muted)' : chg >= 0 ? 'var(--ok)' : 'var(--bad)'}">${chg === null ? 'No sales yesterday' : (chg >= 0 ? '▲ ' : '▼ ') + Math.abs(chg) + '% vs yesterday'}</div></div>
      <div class="card kpi"><div class="l">Orders today</div><div class="v">${k.orders_today}</div><div class="s muted">Avg ${fmt.money(k.orders_today ? k.sales_today / k.orders_today : 0)} / order</div></div>
      <div class="card kpi"><div class="l">Running orders</div><div class="v">${d.live.open_orders}</div><div class="s muted">${fmt.money(d.live.open_value)} not yet paid</div></div>
      <div class="card kpi"><div class="l">This month</div><div class="v">${fmt.money(k.sales_month)}</div><div class="s muted">Last 7 days ${fmt.money(k.sales_7d)}</div></div></div>
    ${d.live.pending_online ? `<div class="alert warn mt">🔔 <b>${d.live.pending_online}</b> online / QR order(s) waiting for you to accept. <a href="#/orders?tab=online">Open now →</a></div>` : ''}
    <div class="grid mt" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div class="card"><h3>Sales — last 14 days</h3>${barChart(d.trend.map(x => x.day.slice(5)), d.trend.map(x => x.total))}</div>
      <div class="card"><h3>Top items (7 days)</h3>${hbars(d.top.map(t => ({ label: `${t.name} ×${fmt.num(t.qty, 0)}`, value: t.total })))}</div></div>
    <div class="grid g3 mt">
      <div class="card"><h3>Payments today</h3>${hbars(d.methods.map(m => ({ label: m.method, value: m.amount })))}</div>
      <div class="card"><h3>Low stock</h3>${d.low_stock.length ? d.low_stock.map(s => `<div class="row between" style="padding:5px 0;border-bottom:1px dashed var(--line)"><span>${esc(s.name)}</span><span class="badge bad">${fmt.num(s.qty)} ${esc(s.unit)}</span></div>`).join('') + (can('purchases') ? '<a class="btn sm mt" href="#/purchases?tab=new">Create purchase →</a>' : '') : '<div class="empty">All good ✓</div>'}</div>
      <div class="card"><h3>Today's reservations</h3>${d.reservations.length ? d.reservations.map(r => `<div class="row between" style="padding:5px 0;border-bottom:1px dashed var(--line)"><span><b>${esc(r.time)}</b> ${esc(r.customer_name)} · ${r.guests} guests</span><span class="small muted">${esc(r.table_name || '')}</span></div>`).join('') : '<div class="empty">No bookings today</div>'}
        ${d.birthdays.length ? `<h3 class="mt">🎂 Birthdays / anniversaries</h3>${d.birthdays.map(b => `<div>${esc(b.name)} <span class="muted small">${esc(b.phone || '')}</span></div>`).join('')}` : ''}</div></div>
    ${can('accounting') ? `<div class="grid g2 mt"><div class="card kpi"><div class="l">Customers owe you (receivable)</div><div class="v">${fmt.money(d.dues.receivable)}</div></div><div class="card kpi"><div class="l">You owe suppliers (payable)</div><div class="v">${fmt.money(d.dues.payable)}</div></div></div>` : ''}
    <div class="card mt"><h3>Sales by hour today</h3>${barChart(Array.from({ length: 24 }, (_, i) => String(i)), Array.from({ length: 24 }, (_, i) => (d.hourly.find(h => h.h === i) || {}).total || 0), { h: 160 })}</div>`;
  if ($('#db')) $('#db').onchange = e => APP.go('#/dashboard' + (e.target.value ? '?branch=all' : ''));
};
APP.pages.welcome = async el => {
  const slug = APP.me.tenant.slug;
  el.innerHTML = `<div class="card" style="max-width:860px;margin:auto"><h1>🎉 Welcome to ${esc(APP.me.tenant.name)}!</h1>
    <p class="muted">Your restaurant is ready. Staff log in at <b>${location.origin}/login</b> with Restaurant ID <b>${esc(slug)}</b>.</p>
    <div class="grid g2 mt">${[
      ['🧾', 'Take your first order', 'Open the POS, tap items, and press Pay.', '#/pos'],
      ['🍔', 'Set up your menu', 'Add categories, products, sizes and add-ons with photos.', '#/menu'],
      ['🍽️', 'Arrange tables & print QR codes', 'Guests scan to see the menu and order.', '#/tables?tab=setup'],
      ['👥', 'Add your staff', 'Give each person a login or a quick PIN and a role.', '#/settings?tab=users'],
      ['📦', 'Add ingredients & recipes', 'Stock reduces automatically on every sale.', '#/inventory'],
      ['⚙️', 'VAT, service charge & receipt', 'Set your VAT %, BIN and receipt footer.', '#/settings']].map(([i, t, s, h]) => `<a class="card" href="${h}" style="text-decoration:none;color:inherit"><div class="big">${i} <b>${t}</b></div><div class="muted mt">${s}</div></a>`).join('')}</div></div>`;
};
APP.pages.notifications = async el => {
  const rows = await GET('/api/app/notifications');
  el.innerHTML = `<div class="page-h"><div></div><button class="btn" id="rd">Mark all as read</button></div><div class="card p0">${table([{ key: 'created_at', label: 'When', fmt: fmt.ago }, { key: 'title', label: 'Notification', html: r => `<b>${esc(r.title)}</b><div class="small muted">${esc(r.body || '')}</div>` }, { key: 'read', label: '', html: r => r.read ? '' : '<span class="badge info">new</span>' }], rows, { onRow: 1, empty: 'No notifications' })}</div>`;
  bindRows(el, rows, r => { if (r.link) location.hash = r.link; });
  $('#rd').onclick = async () => { await POST('/api/app/notifications/read'); $('#bdot').style.display = 'none'; APP.route(); };
};

// ================= billing =================
APP.pages.billing = async el => {
  const b = await GET('/api/app/billing');
  const days = b.expires_at ? Math.ceil((new Date(b.expires_at) - Date.now()) / 86400000) : null;
  el.innerHTML = `<div class="grid g2"><div class="card"><h3>Your subscription</h3>
      <div class="row between"><span>Status</span>${badge(b.status)}</div><div class="row between mt"><span>Valid until</span><b>${fmt.date(b.expires_at)}${days !== null ? ` (${days >= 0 ? days + ' days left' : 'expired'})` : ''}</b></div>
      <hr><div class="badge brand">${esc(b.plan.name)}</div><div style="font-size:30px;font-weight:800;margin:8px 0">${fmt.money(b.plan.price)} <span class="muted" style="font-size:14px">/ ${b.plan.duration_days} days</span></div>
      ${b.plan.yearly_price ? `<div class="muted">Yearly: ${fmt.money(b.plan.yearly_price)}</div>` : ''}<ul class="small">${(b.plan.features || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
    <div class="card"><h3>Pay & renew</h3><p class="muted">${esc(b.payment.instructions || '')}</p>
      ${(b.payment.methods || []).map(m => `<div class="alert info"><b>${esc(m.name)}</b> ${esc(m.type || '')}: <b style="font-size:16px">${esc(m.number)}</b></div>`).join('')}
      <form id="pf"><div class="fgrid"><label class="f"><span>Paid with</span><select name="method">${(b.payment.methods || []).map(m => `<option>${esc(m.name)}</option>`).join('')}<option>Bank</option><option>Cash</option></select></label>
      <label class="f"><span>Period</span><select name="period"><option value="monthly">${b.plan.duration_days} days — ${fmt.money(b.plan.price)}</option>${b.plan.yearly_price ? `<option value="yearly">1 year — ${fmt.money(b.plan.yearly_price)}</option>` : ''}</select></label>
      <label class="f"><span>Transaction ID (TrxID)</span><input name="trx_id" required></label><label class="f"><span>Sent from number</span><input name="sender"></label></div>
      <button class="btn primary block">Submit payment</button></form><p class="small muted">Need help? Call ${esc(b.brand.phone || '')} ${b.brand.email ? '· ' + esc(b.brand.email) : ''}</p></div></div>
    <div class="card p0 mt"><div style="padding:14px 16px 0"><h3>Payment history</h3></div>${table([{ key: 'created_at', label: 'Date', fmt: fmt.dt }, { key: 'amount', label: 'Amount', num: 1, fmt: fmt.money }, { key: 'method', label: 'Method' }, { key: 'trx_id', label: 'TrxID' }, { key: 'days', label: 'Days', num: 1 }, { key: 'status', label: 'Status', html: r => badge(r.status) }, { key: 'note', label: 'Note' }], b.payments, { empty: 'No payments yet' })}</div>`;
  $('#pf').onsubmit = async e => { e.preventDefault(); await POST('/api/app/billing/pay', Object.fromEntries(new FormData(e.target))); toast('Payment submitted. We will verify it shortly.', 'ok'); APP.route(); };
};

// ================= branches =================
APP.pages.branches = el => crudPage(el, 'branches', { note: 'Each branch has its own tables, stock, orders and cash. Staff can be locked to one branch in Settings → Staff.', addLabel: 'Add branch', onRow: (r, load) => editRecord('branches', r, { onSaved: () => { load(); setTimeout(() => location.reload(), 600); } }) });

// ================= settings =================
const SET_TABS = [{ k: 'general', l: 'Restaurant' }, { k: 'billing', l: 'VAT, charges & payments' }, { k: 'receipt', l: 'Receipt' }, { k: 'ordering', l: 'QR & online ordering' }, { k: 'users', l: 'Staff logins' }, { k: 'roles', l: 'Roles & permissions' }, { k: 'security', l: 'Security & logs' }, { k: 'backup', l: 'Backup & import' }];
APP.pages.settings = async (el, params) => {
  const tab = pickTab(SET_TABS, params);
  el.innerHTML = tabsHTML('settings', SET_TABS, tab) + '<div id="st"></div>';
  const box = $('#st');
  if (['general', 'billing', 'receipt', 'ordering'].includes(tab)) return settingsForm(box, tab);
  if (tab === 'users') return usersPage(box);
  if (tab === 'roles') return rolesPage(box);
  if (tab === 'security') {
    const [sess, logins, audit] = await Promise.all([GET('/api/app/sessions'), GET('/api/app/logins'), GET('/api/app/audit')]);
    box.innerHTML = `<div class="card p0"><div style="padding:14px 16px 0"><h3>Logged-in devices</h3></div>${table([{ key: 'name', label: 'User' }, { key: 'last_seen', label: 'Last active', fmt: fmt.ago }, { key: 'ip', label: 'IP' }, { key: 'ua', label: 'Device', fmt: v => String(v || '').slice(0, 60) }, { key: 'x', label: '', html: r => `<button class="btn sm danger" data-s="${esc(r.id)}">Log out</button>` }], sess)}</div>
      <div class="card p0 mt"><div style="padding:14px 16px 0" class="row between"><h3>Activity log (audit)</h3><input type="search" id="aq" placeholder="Search…" style="max-width:240px"></div><div id="al"></div></div>
      <div class="card p0 mt"><div style="padding:14px 16px 0"><h3>Login history</h3></div>${table([{ key: 'created_at', label: 'Time', fmt: fmt.dt }, { key: 'username', label: 'User' }, { key: 'kind', label: 'Method' }, { key: 'success', label: 'Result', html: r => r.success ? badge('ok') : '<span class="badge bad">Failed</span>' }, { key: 'ip', label: 'IP' }], logins)}</div>`;
    const drawA = rows => { $('#al').innerHTML = table([{ key: 'created_at', label: 'Time', fmt: fmt.dt }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action', html: r => badge(r.action) }, { key: 'entity', label: 'What', fmt: (v, r) => `${fmt.label(v)}${r.entity_id ? ' #' + r.entity_id : ''}` }, { key: 'details', label: 'Details', fmt: v => v ? JSON.stringify(v).slice(0, 120) : '' }], rows); };
    drawA(audit); $('#aq').oninput = debounce(async e => drawA(await GET('/api/app/audit?q=' + encodeURIComponent(e.target.value))));
    $$('[data-s]', box).forEach(b => b.onclick = async () => { await DEL('/api/app/sessions/' + b.dataset.s); APP.route(); });
    return;
  }
  if (tab === 'backup') {
    box.innerHTML = `<div class="grid g2"><div class="card"><h3>Download a backup</h3><p class="muted">All your restaurant data (menu, orders, stock, customers, accounts) in one file.</p><a class="btn primary" href="/api/app/export">⬇ Download backup (JSON)</a></div>
      <div class="card"><h3>Import from Excel / CSV</h3><p class="muted">Use the <b>⬆ Import</b> button on Products, Customers, Ingredients and Suppliers pages. Tip: export first to get the right column names.</p>
      <div class="row"><a class="btn" href="#/menu?tab=products">Products</a><a class="btn" href="#/customers">Customers</a><a class="btn" href="#/inventory?tab=ingredients">Ingredients</a><a class="btn" href="#/purchases?tab=suppliers">Suppliers</a></div></div></div>`;
  }
};
async function settingsForm(box, tab) {
  const d = await GET('/api/app/settings'); const s = d.settings, t = d.tenant;
  const F = {
    general: `<div class="fgrid"><div class="full img-up mb"><img id="lg" src="${s.logo_id ? '/f/' + s.logo_id : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}"><input type="file" accept="image/*" id="lgf"><span class="small muted">Logo (shown on receipts, menu, sidebar)</span></div>
      <label class="f"><span>Restaurant name</span><input data-t name="name" value="${esc(t.name)}"></label><label class="f"><span>Owner name</span><input data-t name="owner_name" value="${esc(t.owner_name || '')}"></label>
      <label class="f"><span>Phone</span><input data-t name="phone" value="${esc(t.phone || '')}"></label><label class="f"><span>Email</span><input data-t name="email" value="${esc(t.email || '')}"></label>
      <label class="f full"><span>Address</span><input data-t name="address" value="${esc(t.address || '')}"></label>
      <label class="f"><span>Currency symbol</span><input name="currency" value="${esc(s.currency)}"></label><label class="f"><span>Time zone</span><input name="timezone" value="${esc(s.timezone)}"></label>
      <label class="f"><span>Theme color</span><input type="color" name="color" value="${esc(s.color || '#0f766e')}" style="height:40px"></label>
      <label class="f"><span>Kitchen: mark order "late" after (minutes)</span><input type="number" name="kds_delay_min" value="${s.kds_delay_min}"></label>
      <label class="check full"><input type="checkbox" name="kds_enabled" ${s.kds_enabled !== false ? 'checked' : ''}> Use kitchen display (send items to kitchen screens)</label>
      <label class="check full"><input type="checkbox" name="table_cleaning" ${s.table_cleaning ? 'checked' : ''}> Mark tables as "cleaning" after the bill is paid</label></div>`,
    billing: `<div class="fgrid"><label class="f"><span>VAT %</span><input type="number" step="any" name="vat_pct" value="${s.vat_pct}"></label><label class="f"><span>VAT registration (BIN)</span><input name="bin" value="${esc(s.bin || '')}"></label>
      <label class="check full"><input type="checkbox" name="vat_inclusive" ${s.vat_inclusive ? 'checked' : ''}> Menu prices already include VAT</label>
      <label class="f"><span>Service charge %</span><input type="number" step="any" name="service_pct" value="${s.service_pct}"></label><div></div>
      <label class="check full"><input type="checkbox" name="service_dine_in_only" ${s.service_dine_in_only ? 'checked' : ''}> Service charge only for dine-in</label>
      <label class="check full"><input type="checkbox" name="round_total" ${s.round_total ? 'checked' : ''}> Round bill total to whole taka</label>
      <label class="f full"><span>Payment methods (comma separated). Keep "Due" to allow customer credit.</span><input name="payment_methods" value="${esc((s.payment_methods || []).join(', '))}"></label>
      <label class="f full"><span>Order sources (comma separated, e.g. Foodpanda, Pathao)</span><input name="order_sources" value="${esc((s.order_sources || []).join(', '))}"></label>
      <div class="fsec">Loyalty points</div><label class="check full"><input type="checkbox" name="loyalty_enabled" ${s.loyalty_enabled ? 'checked' : ''}> Give loyalty points</label>
      <label class="f"><span>1 point for every (amount spent)</span><input type="number" name="points_per_amount" value="${s.points_per_amount}"></label><label class="f"><span>1 point is worth (when redeemed)</span><input type="number" step="any" name="point_value" value="${s.point_value}"></label></div>`,
    receipt: `<div class="fgrid"><label class="f full"><span>Receipt header (extra line under name)</span><input name="receipt_header" value="${esc(s.receipt_header || '')}"></label>
      <label class="f full"><span>Receipt footer</span><textarea name="receipt_footer">${esc(s.receipt_footer || '')}</textarea></label>
      <label class="f"><span>Paper width</span><select name="receipt_width"><option value="80" ${s.receipt_width == 80 ? 'selected' : ''}>80 mm</option><option value="58" ${s.receipt_width == 58 ? 'selected' : ''}>58 mm</option></select></label></div>`,
    ordering: `<div class="fgrid"><label class="check full"><input type="checkbox" name="online_ordering" ${s.online_ordering !== false ? 'checked' : ''}> Accept QR table and online orders</label>
      <label class="check full"><input type="checkbox" name="auto_accept_online" ${s.auto_accept_online ? 'checked' : ''}> Auto-accept online orders (send straight to kitchen)</label>
      <label class="f"><span>Minimum online order</span><input type="number" name="min_order" value="${s.min_order}"></label><div></div>
      <label class="f full"><span>Promotional banner on online menu</span><input name="banner" value="${esc(s.banner || '')}" placeholder="e.g. 10% off with code WELCOME10"></label>
      <label class="f full"><span>Payment note shown at checkout</span><input name="online_payment_note" value="${esc(s.online_payment_note || '')}"></label>
      <div class="fsec">SMS notifications (optional)</div>
      <label class="f full"><span>SMS gateway URL — use {to} and {msg}. Example: https://bulksmsbd.net/api/smsapi?api_key=KEY&senderid=ID&number={to}&message={msg}</span><input name="sms_url" value="${esc(s.sms_url || '')}"></label>
      <label class="check"><input type="checkbox" data-sms="online_accept" ${s.sms_events && s.sms_events.online_accept ? 'checked' : ''}> Order accepted</label><label class="check"><input type="checkbox" data-sms="ready" ${s.sms_events && s.sms_events.ready ? 'checked' : ''}> Order ready</label><label class="check"><input type="checkbox" data-sms="reservation" ${s.sms_events && s.sms_events.reservation ? 'checked' : ''}> Reservations</label>
      <div class="fsec">Your links</div>
      <div class="full"><div class="alert info small">🌐 Online menu & ordering: <a href="${esc(d.menu_url)}" target="_blank">${esc(d.menu_url)}</a><br>🖥️ Self-service kiosk: <a href="${esc(d.kiosk_url)}" target="_blank">${esc(d.kiosk_url)}</a><br>📺 Digital menu board (TV): <a href="${esc(d.board_url)}" target="_blank">${esc(d.board_url)}</a><br>👀 Customer-facing display (2nd screen at the cashier): <a href="${esc(d.display_url)}" target="_blank">${esc(d.display_url)}</a></div>
      <div class="row"><img src="/api/app/qr/menu" style="width:130px;border:1px solid var(--line);border-radius:10px"><div class="muted small">QR for your online menu — print it for flyers, Facebook page or takeaway bags. Table QR codes are in Tables → QR codes.</div></div></div></div>`
  };
  box.innerHTML = `<div class="card" style="max-width:860px"><form id="sf">${F[tab]}<hr><button class="btn primary">Save settings</button></form></div>`;
  let logo = s.logo_id;
  if ($('#lgf')) $('#lgf').onchange = async e => { const f = e.target.files[0]; if (!f) return; const r = await POST('/api/app/upload', { data: await imageToDataURL(f, 500) }); logo = r.id; $('#lg').src = '/f/' + r.id; };
  $('#sf').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const ns = {}, nt = {};
    $$('[name]', f).forEach(i => { const v = i.type === 'checkbox' ? i.checked : i.value; if (i.hasAttribute('data-t')) nt[i.name] = v; else ns[i.name] = v; });
    if ('payment_methods' in ns) ns.payment_methods = ns.payment_methods.split(',').map(x => x.trim()).filter(Boolean);
    if ('order_sources' in ns) ns.order_sources = ns.order_sources.split(',').map(x => x.trim()).filter(Boolean);
    if ($('[data-sms]', f)) { ns.sms_events = {}; $$('[data-sms]', f).forEach(i => { ns.sms_events[i.dataset.sms] = i.checked; }); }
    if (tab === 'general') ns.logo_id = logo;
    await PUT('/api/app/settings', { settings: ns, tenant: nt }); toast('Settings saved', 'ok');
    if (tab === 'general') setTimeout(() => location.reload(), 500);
  };
}
async function usersPage(box) {
  const [users, roles] = await Promise.all([GET('/api/app/users'), GET('/api/app/roles')]);
  box.innerHTML = `<div class="page-h"><p class="muted mt0">Each staff member logs in with Restaurant ID <b>${esc(APP.me.tenant.slug)}</b> + username/password, or just a quick PIN.</p><button class="btn primary" id="ua">+ Add staff login</button></div>
    <div class="card p0">${table([{ key: 'name', label: 'Name', html: u => `<b>${esc(u.name)}</b><div class="small muted">@${esc(u.username)}</div>` }, { key: 'role_name', label: 'Role', html: u => badge(u.role_name || '—') }, { key: 'branch_name', label: 'Branch', fmt: v => v || 'All branches' },
      { key: 'has_pin', label: 'PIN', fmt: v => v ? '✓' : '—' }, { key: 'phone', label: 'Phone' }, { key: 'last_login', label: 'Last login', fmt: fmt.ago }, { key: 'active', label: 'Status', html: u => u.active ? badge('active') : '<span class="badge bad">Disabled</span>' }], users, { onRow: 1 })}</div>`;
  const edit = u => modal({ title: u ? 'Edit staff' : 'Add staff login', size: 'wide', body: `<form id="uf" class="fgrid">
      <label class="f"><span>Full name *</span><input name="name" value="${esc(u ? u.name : '')}"></label><label class="f"><span>Username *</span><input name="username" value="${esc(u ? u.username : '')}" autocapitalize="none"></label>
      <label class="f"><span>Role *</span><select name="role_id">${roles.map(r => `<option value="${r.id}" ${u && u.role_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Branch</span><select name="branch_id"><option value="">All branches</option>${APP.me.branches.map(b => `<option value="${b.id}" ${u && u.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label class="f"><span>${u ? 'New password (leave empty to keep)' : 'Password (6+)'}</span><input name="password" type="password" autocomplete="new-password"></label>
      <label class="f"><span>${u && u.has_pin ? 'New PIN (leave empty to keep)' : 'Quick PIN (4-6 digits)'}</span><input name="pin" inputmode="numeric" maxlength="6" autocomplete="off"></label>
      <label class="f"><span>Phone</span><input name="phone" value="${esc(u ? u.phone || '' : '')}"></label><label class="f"><span>Designation</span><input name="designation" value="${esc(u ? u.designation || '' : '')}"></label>
      <label class="f"><span>Monthly salary</span><input type="number" name="salary" value="${u ? u.salary : 0}"></label><label class="f"><span>Joined on</span><input type="date" name="joined_at" value="${u && u.joined_at ? u.joined_at : todayStr()}"></label>
      <label class="f full"><span>Address</span><input name="address" value="${esc(u ? u.address || '' : '')}"></label>
      <label class="check"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''}> Active (can log in)</label>${u && u.has_pin ? '<label class="check"><input type="checkbox" name="remove_pin"> Remove PIN</label>' : ''}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { const d = readForm($('#uf')); d.active = $('#uf [name=active]').checked; if ($('#uf [name=remove_pin]')) d.remove_pin = $('#uf [name=remove_pin]').checked; u ? await PUT('/api/app/users/' + u.id, d) : await POST('/api/app/users', d); toast('Saved', 'ok'); APP.refs.users = null; APP.route(); } }] });
  $('#ua').onclick = () => edit(null); bindRows(box, users, edit);
}
async function rolesPage(box) {
  const roles = await GET('/api/app/roles'); const P = APP.me.perm_labels;
  box.innerHTML = `<div class="page-h"><p class="muted mt0">Choose exactly what each role can see and do. Changes apply on the next page load.</p><button class="btn primary" id="ra">+ New role</button></div>
    <div class="grid g3">${roles.map(r => `<div class="card"><div class="row between"><h3 class="mt0">${esc(r.name)}</h3><span class="badge">${r.users} staff</span></div>
      <div class="small muted">${r.is_owner ? 'Full access to everything' : (r.perms || []).map(p => P[p] || p).join(' · ') || 'No permissions'}</div>${r.is_owner ? '' : `<button class="btn sm mt" data-r="${r.id}">Edit permissions</button>`}</div>`).join('')}</div>`;
  const edit = r => modal({ title: r ? 'Edit role' : 'New role', size: 'wide', body: `<label class="f"><span>Role name</span><input id="rn" value="${esc(r ? r.name : '')}"></label>
      <div class="grid g3">${Object.entries(P).map(([k, l]) => `<label class="check" style="margin:2px 0"><input type="checkbox" value="${k}" ${r && (r.perms || []).includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`,
    actions: [...(r ? [{ label: 'Delete', cls: 'danger', onClick: async () => { await DEL('/api/app/roles/' + r.id); APP.route(); } }] : []), { label: 'Cancel' },
      { label: 'Save', cls: 'primary', onClick: async ({ el }) => { const d = { name: $('#rn', el).value, perms: $$('input[type=checkbox]:checked', el).map(x => x.value) }; r ? await PUT('/api/app/roles/' + r.id, d) : await POST('/api/app/roles', d); toast('Saved', 'ok'); APP.route(); } }] });
  $('#ra').onclick = () => edit(null); $$('[data-r]', box).forEach(b => b.onclick = () => edit(roles.find(x => x.id == b.dataset.r)));
}
