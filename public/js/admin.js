// Super admin SPA
let S = null; // platform settings
const SA = {};
const NAV = [['dash', '📊', 'Dashboard'], ['tenants', '🏪', 'Restaurants'], ['payments', '💳', 'Payments'], ['plan', '📦', 'Package & pricing'], ['landing', '🌐', 'Landing page'],
  ['brand', '🎨', 'Brand & contact'], ['announce', '📢', 'Announcements'], ['admins', '🛡️', 'Super admins'], ['logins', '🔐', 'Login activity'], ['backup', '💾', 'Backup']];

async function boot() {
  try { SA.me = await GET('/api/super/me', { noRedirect: true }); }
  catch (e) { return loginView(); }
  S = await GET('/api/super/settings'); CUR = S.brand.currency || '৳';
  $('#root').innerHTML = `<div class="shell"><aside class="side" id="side"><div class="brand"><div class="logo">${S.brand.logo_id ? `<img src="/f/${S.brand.logo_id}">` : 'B'}</div><div><div>${esc(S.brand.name)}</div><div class="tn">Super admin</div></div></div>
    <nav class="nav">${NAV.map(([k, i, l]) => `<a href="#/${k}" data-k="${k}"><span class="ic">${i}</span>${l}<span class="cnt" id="cnt-${k}" style="display:none"></span></a>`).join('')}
    <div class="grp">Account</div><a href="/" target="_blank"><span class="ic">↗</span>View website</a><a href="#" id="logout"><span class="ic">⎋</span>Log out</a></nav></aside>
    <div class="main"><div class="top"><button class="btn ghost icon burger" id="burger">☰</button><div class="title" id="ttl"></div><span class="muted small">${esc(SA.me.email)}</span></div><div class="page" id="page"></div></div></div>`;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async e => { e.preventDefault(); await POST('/api/super/logout'); location.reload(); };
  window.addEventListener('hashchange', route); route();
  refreshCounts(); setInterval(refreshCounts, 60000);
}
async function refreshCounts() { try { const p = await GET('/api/super/payments?status=pending'); const c = $('#cnt-payments'); c.textContent = p.length; c.style.display = p.length ? '' : 'none'; } catch (e) { } }
function loginView() {
  $('#root').innerHTML = `<div class="pub"><div class="auth"><div class="logo"><div class="m">B</div> Super Admin</div><div class="card"><form id="lf">
    <label class="f"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
    <label class="f"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn primary lg block">Log in</button></form></div></div></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); try { await POST('/api/super/login', Object.fromEntries(new FormData(e.target)), { noRedirect: true }); location.reload(); } catch (err) { errToast(err); } };
}
function route() {
  const [k, qs] = (location.hash.slice(2) || 'dash').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === k.split('/')[0]));
  $('#side').classList.remove('open');
  const item = NAV.find(n => n[0] === k.split('/')[0]); $('#ttl').textContent = item ? item[2] : '';
  const fn = PAGES[k.split('/')[0]] || PAGES.dash;
  $('#page').innerHTML = '<div class="loading"><span class="spin"></span></div>';
  Promise.resolve(fn($('#page'), params, k.split('/')[1])).catch(errToast);
}
async function saveSettings(patch) { S = await PUT('/api/super/settings', patch); toast('Saved', 'ok'); }

const PAGES = {
  async dash(el) {
    const d = await GET('/api/super/stats');
    el.innerHTML = `<div class="grid g4">
      <div class="card kpi"><div class="l">Restaurants</div><div class="v">${d.tenants.total}</div><div class="s muted">+${d.tenants.new30} in 30 days</div></div>
      <div class="card kpi"><div class="l">Paying (active)</div><div class="v" style="color:var(--ok)">${d.tenants.active}</div><div class="s muted">${d.tenants.trial} on trial</div></div>
      <div class="card kpi"><div class="l">Revenue this month</div><div class="v">${fmt.money(d.payments.month_revenue)}</div><div class="s muted">All time ${fmt.money(d.payments.revenue)}</div></div>
      <div class="card kpi"><div class="l">Pending payments</div><div class="v" style="color:var(--warn)">${d.payments.pending}</div><div class="s"><a href="#/payments">Review →</a></div></div></div>
    <div class="grid g4 mt">
      <div class="card kpi"><div class="l">Expired</div><div class="v" style="color:var(--bad)">${d.tenants.expired}</div></div>
      <div class="card kpi"><div class="l">Suspended</div><div class="v">${d.tenants.suspended}</div></div>
      <div class="card kpi"><div class="l">Expiring in 7 days</div><div class="v" style="color:var(--warn)">${d.tenants.expiring7}</div></div>
      <div class="card kpi"><div class="l">Orders today (all)</div><div class="v">${d.orders.orders_today}</div><div class="s muted">${fmt.money(d.orders.gmv_today)} GMV</div></div></div>
    <div class="grid g2 mt"><div class="card"><h3>Signups — last 30 days</h3>${barChart(d.signups.map(x => x.day.slice(8)), d.signups.map(x => x.n), { money: false, h: 200 })}</div>
    <div class="card"><h3>Newest restaurants</h3>${table([{ key: 'name', label: 'Name' }, { key: 'slug', label: 'ID' }, { key: 'status', label: 'Status', html: r => badge(r.status) }, { key: 'created_at', label: 'Joined', fmt: fmt.date }], d.recent, { onRow: 1 })}</div></div>`;
    bindRows(el.lastElementChild.lastElementChild, d.recent, r => location.hash = '#/tenants/' + r.id);
  },
  async tenants(el, params, id) {
    if (id) return tenantDetail(el, +id);
    el.innerHTML = `<div class="page-h"><div class="row"><input type="search" id="q" placeholder="Search name, ID, phone…" style="width:260px" value="${esc(params.q || '')}">
      <select id="st" style="width:auto"><option value="">All statuses</option>${['trial', 'active', 'expired', 'suspended'].map(s => `<option ${params.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <button class="btn primary" id="add">+ Add restaurant</button></div><div class="card p0" id="list"></div>`;
    const load = async () => {
      const rows = await GET(`/api/super/tenants?q=${encodeURIComponent($('#q').value)}&status=${$('#st').value}`);
      $('#list').innerHTML = table([{ key: 'name', label: 'Restaurant', html: r => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.slug)}</div>` }, { key: 'owner_name', label: 'Owner', html: r => `${esc(r.owner_name || '')}<div class="small muted">${esc(r.phone || '')}</div>` },
        { key: 'status', label: 'Status', html: r => badge(r.status !== 'suspended' && r.expires_at && new Date(r.expires_at) < new Date() ? 'expired' : r.status) },
        { key: 'expires_at', label: 'Expires', fmt: fmt.date }, { key: 'branches', label: 'Branches', num: 1 }, { key: 'users', label: 'Staff', num: 1 }, { key: 'orders', label: 'Orders', num: 1 }, { key: 'last_active', label: 'Last active', fmt: fmt.ago }], rows, { onRow: 1, empty: 'No restaurants yet' });
      bindRows($('#list'), rows, r => location.hash = '#/tenants/' + r.id);
    };
    $('#q').oninput = debounce(load); $('#st').onchange = load; load();
    $('#add').onclick = () => modal({ title: 'Add restaurant', body: `<form class="fgrid" id="nf">
      <label class="f full"><span>Restaurant name *</span><input name="name" required></label><label class="f"><span>Login ID *</span><input name="slug" required></label>
      <label class="f"><span>Owner name</span><input name="owner_name"></label><label class="f"><span>Phone</span><input name="phone"></label><label class="f"><span>Email</span><input name="email"></label>
      <label class="f"><span>Owner username *</span><input name="username" value="owner"></label><label class="f"><span>Password *</span><input name="password" value="${Math.random().toString(36).slice(2, 10)}"></label>
      <label class="f"><span>Days of access</span><input name="days" type="number" value="${S.plan.trial_days}"></label>
      <label class="f"><span>Status</span><select name="status"><option>trial</option><option>active</option></select></label>
      <label class="check full"><input type="checkbox" name="demo" checked> Add sample menu & tables</label></form>`,
      actions: [{ label: 'Cancel' }, { label: 'Create', cls: 'primary', onClick: async () => { const d = Object.fromEntries(new FormData($('#nf'))); d.demo = !!d.demo; const t = await POST('/api/super/tenants', d); toast(`Created. Login: ${t.slug} / ${d.username} / ${d.password}`, 'ok'); location.hash = '#/tenants/' + t.id; } }] });
  },
  async payments(el, params) {
    const st = params.status ?? 'pending';
    el.innerHTML = `<div class="page-h"><div class="tabs" style="margin:0;border:none">${['pending', 'approved', 'rejected', ''].map(s => `<a href="#/payments?status=${s}" class="${st === s ? 'on' : ''}">${s ? fmt.label(s) : 'All'}</a>`).join('')}</div>
      <button class="btn primary" id="manual">+ Record manual payment</button></div><div class="card p0" id="list"></div>`;
    const rows = await GET('/api/super/payments?status=' + st);
    $('#list').innerHTML = table([{ key: 'created_at', label: 'Date', fmt: fmt.dt }, { key: 'tenant_name', label: 'Restaurant', html: r => `<a href="#/tenants/${r.tenant_id}">${esc(r.tenant_name)}</a><div class="small muted">${esc(r.slug)}</div>` },
      { key: 'amount', label: 'Amount', num: 1, fmt: fmt.money }, { key: 'method', label: 'Method' }, { key: 'trx_id', label: 'TrxID', html: r => `<b>${esc(r.trx_id || '')}</b><div class="small muted">${esc(r.sender || '')}</div>` },
      { key: 'days', label: 'Days', num: 1 }, { key: 'status', label: 'Status', html: r => badge(r.status) },
      { key: 'x', label: '', html: r => r.status === 'pending' ? `<button class="btn sm success" data-a="approve" data-id="${r.id}">Approve</button> <button class="btn sm danger" data-a="reject" data-id="${r.id}">Reject</button>` : esc(r.note || '') }], rows, { empty: 'No payments' });
    $$('[data-a]', el).forEach(b => b.onclick = async () => {
      const p = rows.find(x => x.id == b.dataset.id);
      if (b.dataset.a === 'approve') {
        const days = await askText('Approve payment', { label: 'Extend subscription by (days)', value: p.days || S.plan.duration_days, type: 'number' }); if (!days) return;
        await POST(`/api/super/payments/${p.id}/approve`, { days: +days });
      } else { const note = await askText('Reject payment', { label: 'Reason (shown to restaurant)', required: false }); if (note === null) return; await POST(`/api/super/payments/${p.id}/reject`, { note }); }
      toast('Done', 'ok'); route(); refreshCounts();
    });
    $('#manual').onclick = async () => {
      const ts = await GET('/api/super/tenants');
      modal({ title: 'Record manual payment', body: `<form id="mf"><label class="f"><span>Restaurant</span><select name="tenant_id">${ts.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.slug)})</option>`).join('')}</select></label>
        <div class="fgrid"><label class="f"><span>Amount</span><input name="amount" type="number" value="${S.plan.price}"></label><label class="f"><span>Days</span><input name="days" type="number" value="${S.plan.duration_days}"></label>
        <label class="f"><span>Method</span><input name="method" value="Cash"></label><label class="f"><span>Reference</span><input name="trx_id"></label></div><label class="f"><span>Note</span><input name="note"></label></form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save & extend', cls: 'primary', onClick: async () => { await POST('/api/super/payments', Object.fromEntries(new FormData($('#mf')))); toast('Recorded', 'ok'); route(); } }] });
    };
  },
  async plan(el) {
    const P = S.plan, PM = S.payment;
    el.innerHTML = `<div class="grid g2"><div class="card"><h3>Package (one plan, all features)</h3><form id="pf">
      <label class="f"><span>Package name</span><input name="name" value="${esc(P.name)}"></label>
      <div class="fgrid"><label class="f"><span>Price (${esc(CUR)})</span><input name="price" type="number" value="${P.price}"></label><label class="f"><span>Billing period (days)</span><input name="duration_days" type="number" value="${P.duration_days}"></label>
      <label class="f"><span>Yearly price (0 = off)</span><input name="yearly_price" type="number" value="${P.yearly_price || 0}"></label><label class="f"><span>Free trial days</span><input name="trial_days" type="number" value="${P.trial_days}"></label></div>
      <label class="f"><span>Short note</span><input name="note" value="${esc(P.note || '')}"></label>
      <label class="f"><span>Feature list (one per line)</span><textarea name="features" rows="10">${esc((P.features || []).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" name="signup" ${S.signup_enabled !== false ? 'checked' : ''}> Allow new restaurants to sign up</label>
      <button class="btn primary">Save package</button></form></div>
      <div class="card"><h3>How restaurants pay you</h3><form id="mf"><label class="f"><span>Instructions</span><textarea name="instructions">${esc(PM.instructions || '')}</textarea></label>
      <div id="methods"></div><button type="button" class="btn sm" id="addm">+ Add method</button><hr><button class="btn primary">Save payment methods</button></form></div></div>`;
    $('#pf').onsubmit = async e => { e.preventDefault(); const f = e.target;
      await saveSettings({ plan: { name: f.name.value, price: +f.price.value, duration_days: +f.duration_days.value || 30, yearly_price: +f.yearly_price.value, trial_days: +f.trial_days.value, note: f.note.value, features: f.features.value.split('\n').map(s => s.trim()).filter(Boolean) }, signup_enabled: f.signup.checked }); };
    const ms = (PM.methods || []).slice();
    const draw = () => { $('#methods').innerHTML = ms.map((m, i) => `<div class="row mb"><input placeholder="bKash" value="${esc(m.name)}" data-i="${i}" data-k="name" style="flex:1"><input placeholder="01XXXXXXXXX" value="${esc(m.number)}" data-i="${i}" data-k="number" style="flex:1.3"><input placeholder="Personal / Merchant" value="${esc(m.type || '')}" data-i="${i}" data-k="type" style="flex:1"><button type="button" class="btn icon danger" data-del="${i}">✕</button></div>`).join('');
      $$('#methods input').forEach(x => x.oninput = () => { ms[x.dataset.i][x.dataset.k] = x.value; }); $$('#methods [data-del]').forEach(b => b.onclick = () => { ms.splice(+b.dataset.del, 1); draw(); }); };
    draw(); $('#addm').onclick = () => { ms.push({ name: '', number: '', type: '' }); draw(); };
    $('#mf').onsubmit = async e => { e.preventDefault(); await saveSettings({ payment: { instructions: e.target.instructions.value, methods: ms.filter(m => m.name) } }); };
  },
  async landing(el) {
    const L = JSON.parse(JSON.stringify(S.landing)); L.features = L.features || []; L.faq = L.faq || [];
    el.innerHTML = `<div class="card"><form id="lf"><div class="fgrid"><label class="f full"><span>Hero title</span><input name="hero_title" value="${esc(L.hero_title)}"></label>
      <label class="f full"><span>Hero sub-text</span><textarea name="hero_sub">${esc(L.hero_sub)}</textarea></label><label class="f"><span>Button text</span><input name="cta" value="${esc(L.cta || '')}"></label>
      <label class="f"><span>SEO title</span><input name="seo_title" value="${esc((S.seo || {}).title || '')}"></label><label class="f full"><span>SEO description</span><input name="seo_desc" value="${esc((S.seo || {}).description || '')}"></label></div>
      <h3 class="mt">Feature boxes</h3><div id="fl"></div><button type="button" class="btn sm" id="addf">+ Add feature</button>
      <h3 class="mt">FAQ</h3><div id="ql"></div><button type="button" class="btn sm" id="addq">+ Add question</button><hr>
      <div class="row"><button class="btn primary">Save landing page</button><a class="btn" href="/" target="_blank">Preview ↗</a></div></form></div>`;
    const drawF = () => { $('#fl').innerHTML = L.features.map((f, i) => `<div class="row mb"><input value="${esc(f.icon)}" data-i="${i}" data-k="icon" style="width:60px"><input value="${esc(f.title)}" placeholder="Title" data-i="${i}" data-k="title" style="flex:1"><input value="${esc(f.text)}" placeholder="Text" data-i="${i}" data-k="text" style="flex:2.5"><button type="button" class="btn icon danger" data-del="${i}">✕</button></div>`).join('');
      $$('#fl input').forEach(x => x.oninput = () => { L.features[x.dataset.i][x.dataset.k] = x.value; }); $$('#fl [data-del]').forEach(b => b.onclick = () => { L.features.splice(+b.dataset.del, 1); drawF(); }); };
    const drawQ = () => { $('#ql').innerHTML = L.faq.map((f, i) => `<div class="row mb"><input value="${esc(f.q)}" placeholder="Question" data-i="${i}" data-k="q" style="flex:1"><input value="${esc(f.a)}" placeholder="Answer" data-i="${i}" data-k="a" style="flex:2"><button type="button" class="btn icon danger" data-del="${i}">✕</button></div>`).join('');
      $$('#ql input').forEach(x => x.oninput = () => { L.faq[x.dataset.i][x.dataset.k] = x.value; }); $$('#ql [data-del]').forEach(b => b.onclick = () => { L.faq.splice(+b.dataset.del, 1); drawQ(); }); };
    drawF(); drawQ();
    $('#addf').onclick = () => { L.features.push({ icon: '✨', title: '', text: '' }); drawF(); }; $('#addq').onclick = () => { L.faq.push({ q: '', a: '' }); drawQ(); };
    $('#lf').onsubmit = async e => { e.preventDefault(); const f = e.target; Object.assign(L, { hero_title: f.hero_title.value, hero_sub: f.hero_sub.value, cta: f.cta.value });
      await saveSettings({ landing: L, seo: { title: f.seo_title.value, description: f.seo_desc.value } }); };
  },
  async brand(el) {
    const B = Object.assign({}, S.brand);
    el.innerHTML = `<div class="card" style="max-width:720px"><form id="bf" class="fgrid">
      <div class="full img-up mb"><img id="lgimg" src="${B.logo_id ? '/f/' + B.logo_id : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}"><div><input type="file" accept="image/*" id="lgf"><div class="small muted">Square logo works best</div></div></div>
      <label class="f"><span>Brand / platform name</span><input name="name" value="${esc(B.name)}"></label><label class="f"><span>Brand color</span><input name="color" type="color" value="${esc(B.color || '#0f766e')}" style="height:40px"></label>
      <label class="f full"><span>Tagline</span><input name="tagline" value="${esc(B.tagline || '')}"></label>
      <label class="f"><span>Support phone</span><input name="phone" value="${esc(B.phone || '')}"></label><label class="f"><span>Support email</span><input name="email" value="${esc(B.email || '')}"></label>
      <label class="f"><span>Website</span><input name="website" value="${esc(B.website || '')}"></label><label class="f"><span>Currency symbol</span><input name="currency" value="${esc(B.currency || '৳')}"></label>
      <label class="f full"><span>Footer text</span><input name="footer" value="${esc(B.footer || '')}"></label>
      <div class="full"><button class="btn primary">Save brand</button></div></form></div>`;
    $('#lgf').onchange = async e => { const f = e.target.files[0]; if (!f) return; const d = await imageToDataURL(f, 400); const r = await POST('/api/super/upload', { data: d }); B.logo_id = r.id; $('#lgimg').src = '/f/' + r.id; };
    $('#bf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await saveSettings({ brand: Object.assign(B, f) }); };
  },
  async announce(el) {
    const rows = await GET('/api/super/announcements');
    el.innerHTML = `<div class="page-h"><p class="muted mt0">Messages shown on every restaurant's dashboard and on your website.</p><button class="btn primary" id="add">+ New announcement</button></div><div class="card p0" id="list"></div>`;
    $('#list').innerHTML = table([{ key: 'title', label: 'Title' }, { key: 'body', label: 'Message' }, { key: 'level', label: 'Type', html: r => badge(r.level) }, { key: 'active', label: 'Active', fmt: v => v ? 'Yes' : 'No' }, { key: 'created_at', label: 'Created', fmt: fmt.date }], rows, { onRow: 1 });
    const edit = a => modal({ title: a ? 'Edit announcement' : 'New announcement', body: `<form id="af"><label class="f"><span>Title</span><input name="title" value="${esc(a ? a.title : '')}"></label><label class="f"><span>Message</span><textarea name="body">${esc(a ? a.body : '')}</textarea></label>
      <label class="f"><span>Type</span><select name="level">${['info', 'warn', 'bad'].map(l => `<option ${a && a.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="active" ${!a || a.active ? 'checked' : ''}> Active</label></form>`,
      actions: [...(a ? [{ label: 'Delete', cls: 'danger', onClick: async () => { await DEL('/api/super/announcements/' + a.id); route(); } }] : []), { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { const d = Object.fromEntries(new FormData($('#af'))); d.active = !!d.active; a ? await PUT('/api/super/announcements/' + a.id, d) : await POST('/api/super/announcements', d); route(); } }] });
    $('#add').onclick = () => edit(null); bindRows($('#list'), rows, edit);
  },
  async admins(el) {
    const rows = await GET('/api/super/admins');
    el.innerHTML = `<div class="page-h"><div></div><button class="btn primary" id="add">+ Add super admin</button></div><div class="card p0" id="list"></div>`;
    $('#list').innerHTML = table([{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'active', label: 'Active', fmt: v => v ? 'Yes' : 'No' }, { key: 'last_login', label: 'Last login', fmt: fmt.dt }], rows, { onRow: 1 });
    const edit = a => modal({ title: a ? 'Edit admin' : 'Add super admin', body: `<form id="af"><label class="f"><span>Name</span><input name="name" value="${esc(a ? a.name : '')}"></label><label class="f"><span>Email</span><input name="email" type="email" value="${esc(a ? a.email : '')}"></label>
      <label class="f"><span>${a ? 'New password (leave empty to keep)' : 'Password'}</span><input name="password" type="password"></label>${a ? `<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active</label>` : ''}</form>`,
      actions: [...(a && a.id !== SA.me.id ? [{ label: 'Delete', cls: 'danger', onClick: async () => { if (await confirmBox('Delete this admin?', { danger: true })) { await DEL('/api/super/admins/' + a.id); route(); } } }] : []), { label: 'Cancel' },
        { label: 'Save', cls: 'primary', onClick: async () => { const d = Object.fromEntries(new FormData($('#af'))); if (a) { d.active = !!d.active; await PUT('/api/super/admins/' + a.id, d); } else await POST('/api/super/admins', d); toast('Saved', 'ok'); route(); } }] });
    $('#add').onclick = () => edit(null); bindRows($('#list'), rows, edit);
  },
  async logins(el) {
    const rows = await GET('/api/super/logins');
    el.innerHTML = `<div class="card p0">${table([{ key: 'created_at', label: 'Time', fmt: fmt.dt }, { key: 'kind', label: 'Type' }, { key: 'tenant_name', label: 'Restaurant', fmt: v => v || '—' }, { key: 'username', label: 'User' }, { key: 'success', label: 'Result', html: r => r.success ? badge('ok') : '<span class="badge bad">Failed</span>' }, { key: 'ip', label: 'IP' }], rows)}</div>`;
  },
  async backup(el) {
    el.innerHTML = `<div class="card" style="max-width:720px"><h3>Full platform backup</h3><p class="muted">Download every restaurant's data as one JSON file. The server also writes an automatic daily backup to <code>data/backups/</code> (last 7 days kept).</p>
      <a class="btn primary" href="/api/super/backup">⬇ Download full backup</a>
      <hr><h3>Database-level backup (recommended)</h3><p class="muted">In Coolify, open your PostgreSQL resource → <b>Backups</b> and enable scheduled backups (to S3 or local). That gives you point-in-time copies of everything.</p></div>`;
  }
};

async function tenantDetail(el, id) {
  const d = await GET('/api/super/tenants/' + id); const t = d.tenant;
  const exp = t.status !== 'suspended' && t.expires_at && new Date(t.expires_at) < new Date();
  el.innerHTML = `<div class="page-h"><div><a href="#/tenants">← Restaurants</a><h1 class="mt">${esc(t.name)} ${badge(exp ? 'expired' : t.status)}</h1><div class="muted">Login ID: <b>${esc(t.slug)}</b> · Joined ${fmt.date(t.created_at)} · Expires ${fmt.date(t.expires_at)}</div></div>
    <div class="row"><button class="btn primary" id="imp">Log in as owner ↗</button><button class="btn" id="ext">+ Extend</button><button class="btn" id="pw">Reset password</button>
      <button class="btn ${t.status === 'suspended' ? 'success' : 'danger'}" id="sus">${t.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button></div></div>
    <div class="grid g4"><div class="card kpi"><div class="l">Total orders</div><div class="v">${d.usage.orders}</div></div><div class="card kpi"><div class="l">Total sales</div><div class="v">${fmt.money(d.usage.sales)}</div></div>
      <div class="card kpi"><div class="l">Branches / products</div><div class="v">${d.usage.branches} / ${d.usage.products}</div></div><div class="card kpi"><div class="l">Last order</div><div class="v small">${fmt.ago(d.usage.last_order)}</div></div></div>
    <div class="grid g2 mt"><div class="card"><h3>Details</h3><form id="tf" class="fgrid">
      <label class="f"><span>Name</span><input name="name" value="${esc(t.name)}"></label><label class="f"><span>Login ID</span><input name="slug" value="${esc(t.slug)}"></label>
      <label class="f"><span>Owner</span><input name="owner_name" value="${esc(t.owner_name || '')}"></label><label class="f"><span>Phone</span><input name="phone" value="${esc(t.phone || '')}"></label>
      <label class="f"><span>Email</span><input name="email" value="${esc(t.email || '')}"></label><label class="f"><span>Status</span><select name="status">${['trial', 'active', 'expired', 'suspended'].map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f"><span>Expires on</span><input name="expires_at" type="date" value="${t.expires_at ? t.expires_at.slice(0, 10) : ''}"></label><label class="f"><span>Address</span><input name="address" value="${esc(t.address || '')}"></label>
      <label class="f full"><span>Private notes</span><textarea name="notes">${esc(t.notes || '')}</textarea></label>
      <div class="full row between"><button class="btn primary">Save</button><div class="row"><a class="btn sm" href="/api/super/tenants/${t.id}/export">⬇ Export data</a><button type="button" class="btn sm danger" id="delt">Delete</button></div></div></form></div>
    <div><div class="card p0"><div style="padding:14px 16px 0"><h3>Staff logins</h3></div>${table([{ key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'role', label: 'Role' }, { key: 'last_login', label: 'Last login', fmt: fmt.ago }, { key: 'x', label: '', html: u => `<button class="btn sm" data-pw="${u.id}">Reset</button>` }], d.users)}</div>
    <div class="card p0 mt"><div style="padding:14px 16px 0"><h3>Payments</h3></div>${table([{ key: 'created_at', label: 'Date', fmt: fmt.date }, { key: 'amount', label: 'Amount', num: 1, fmt: fmt.money }, { key: 'method', label: 'Method' }, { key: 'trx_id', label: 'TrxID' }, { key: 'status', label: 'Status', html: r => badge(r.status) }], d.payments, { empty: 'No payments yet' })}</div></div></div>`;
  $('#tf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (f.expires_at) f.expires_at += 'T23:59:59'; await PUT('/api/super/tenants/' + id, f); toast('Saved', 'ok'); route(); };
  $('#imp').onclick = async () => { await POST(`/api/super/tenants/${id}/impersonate`); window.open('/app', '_blank'); };
  $('#ext').onclick = async () => { const days = await askText('Extend subscription', { label: 'Add days', value: S.plan.duration_days, type: 'number' }); if (!days) return; await POST(`/api/super/tenants/${id}/extend`, { days: +days }); toast('Extended', 'ok'); route(); };
  const reset = async uid => { const pw = await askText('Reset password', { label: 'New password (6+ characters)', value: Math.random().toString(36).slice(2, 10) }); if (!pw) return; const u = await POST(`/api/super/tenants/${id}/reset-password`, { user_id: uid, password: pw }); toast(`Password for ${u.username} is now: ${pw}`, 'ok'); };
  $('#pw').onclick = () => reset(null); $$('[data-pw]', el).forEach(b => b.onclick = () => reset(+b.dataset.pw));
  $('#sus').onclick = async () => { await PUT('/api/super/tenants/' + id, { status: t.status === 'suspended' ? (exp ? 'expired' : 'active') : 'suspended', owner_name: t.owner_name, phone: t.phone, email: t.email, address: t.address, notes: t.notes }); route(); };
  $('#delt').onclick = async () => { const c = await askText('Delete restaurant permanently', { label: `This deletes ALL data. Type "${t.slug}" to confirm` }); if (c === null) return; await DEL('/api/super/tenants/' + id, { confirm: c }); toast('Deleted', 'ok'); location.hash = '#/tenants'; };
}
boot();
