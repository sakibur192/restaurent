// Operations: orders, tables & floor, kitchen display, delivery, reservations, cash shift, attendance

// ================= orders =================
const ORD_TABS = [{ k: 'running', l: 'Running' }, { k: 'online', l: 'Online & QR (to accept)' }, { k: 'today', l: 'Today' }, { k: 'all', l: 'Search all' }];
APP.pages.orders = async (el, params) => {
  const tab = pickTab(ORD_TABS, params);
  el.innerHTML = tabsHTML('orders', ORD_TABS, tab) + (tab === 'all' ? `<div class="row mb">${rangeBar(params)}<input type="search" id="oq" placeholder="Order #, name or phone" value="${esc(params.q || '')}" style="max-width:240px"></div>` : '') + '<div class="card p0" id="ol"></div>';
  if (tab === 'all') { wireRange('orders', Object.assign({}, params, { tab: 'all' })); $('#oq').onkeydown = e => { if (e.key === 'Enter') APP.go(`#/orders?${new URLSearchParams(Object.assign({}, params, { tab: 'all', q: e.target.value }))}`); }; }
  const load = async () => {
    let url = '/api/app/orders?';
    if (tab === 'running') url += 'status=open,held';
    if (tab === 'online') url += 'status=pending';
    if (tab === 'today') url += `from=${todayStr()}&to=${todayStr()}`;
    if (tab === 'all') url += qstr(params) + (params.q ? '&q=' + encodeURIComponent(params.q) : '') + (params.from ? '' : `&from=${todayStr()}&to=${todayStr()}`);
    if (params.branch === 'all') url += '&branch=all';
    const rows = await GET(url);
    $('#ol').innerHTML = table([{ key: 'order_no', label: '#', html: r => `<b>#${r.order_no}</b>${r.priority ? ' ⚡' : ''}` }, { key: 'created_at', label: 'Time', fmt: fmt.time },
      { key: 'type', label: 'Type', html: r => `${esc(fmt.label(r.type))}${r.table_name ? ' · <b>' + esc(r.table_name) + '</b>' : ''}<div class="small muted">${esc(r.source)}</div>` },
      { key: 'customer_name', label: 'Customer', html: r => `${esc(r.customer_name || '—')}<div class="small muted">${esc(r.customer_phone || '')}</div>` },
      { key: 'items', label: 'Items', html: r => `${r.items}${r.ready_items ? ` <span class="badge ok">${r.ready_items} ready</span>` : ''}` },
      { key: 'total', label: 'Total', num: 1, fmt: fmt.money }, { key: 'paid', label: 'Paid', num: 1, fmt: fmt.money }, { key: 'status', label: 'Status', html: r => badge(r.status) + (r.delivery_status ? ' ' + badge(r.delivery_status) : '') },
      { key: 'x', label: '', html: r => r.status === 'pending' ? `<button class="btn sm success" data-acc="${r.id}">Accept</button>` : ['open', 'held'].includes(r.status) && can('pos') ? `<a class="btn sm" href="#/pos?order=${r.id}">Open</a>` : '' }],
      rows, { onRow: 1, empty: tab === 'online' ? 'No online orders waiting 👍' : 'No orders' });
    bindRows($('#ol'), rows, r => showOrder(r.id));
    $$('[data-acc]', el).forEach(b => b.onclick = async e => { e.stopPropagation(); try { await POST(`/api/app/orders/${b.dataset.acc}/accept`); toast('Accepted — sent to kitchen', 'ok'); load(); } catch (err) { errToast(err); } });
  };
  await load();
  if (tab !== 'all') { const t = setInterval(load, 15000); APP.cleanup = () => clearInterval(t); }
};

// ================= tables & floor =================
const TBL_TABS = [{ k: 'floor', l: 'Floor plan' }, { k: 'setup', l: 'Tables setup', p: 'tables' }, { k: 'floors', l: 'Floors & sections', p: 'tables' }, { k: 'qr', l: 'QR codes', p: 'tables' }];
APP.pages.tables = async (el, params) => {
  const tab = pickTab(TBL_TABS, params);
  el.innerHTML = tabsHTML('tables', TBL_TABS, tab) + '<div id="tb"></div>';
  const box = $('#tb');
  if (tab === 'setup') return crudPage(box, 'tables', { addLabel: 'Add table', note: 'Tables belong to the current branch. Each table gets its own QR code for ordering.' });
  if (tab === 'floors') return crudPage(box, 'floors', { addLabel: 'Add floor / section', importable: false });
  if (tab === 'qr') {
    const rows = await GET('/api/app/qr/tables');
    box.innerHTML = `<div class="page-h"><p class="muted mt0">Print and place these on each table. Guests scan → see the menu → order. Orders arrive in Orders → Online & QR.</p><div class="row"><button class="btn" id="pq">🖨 Print all</button>${rows.length ? `<button class="btn primary" id="pqz">⬇ Download all (ZIP)</button>` : ''}</div></div>
      <div class="grid g4">${rows.map(r => `<div class="qrcard"><b style="font-size:18px">Table ${esc(r.name)}</b><div class="small muted">${esc(r.floor_name || '')}</div>${r.svg}<div class="small">Scan to see menu & order</div><div class="row mt noprint" style="justify-content:center;gap:6px"><button class="btn sm primary" data-qd="${r.id}" data-n="${esc(r.name)}">⬇ Download</button><button class="btn sm" data-rg="${r.id}">New code</button></div></div>`).join('')}</div>`;
    $('#pq').onclick = () => printHTML(`<div class="qrgrid">${rows.map(r => `<div class="qrcard"><h2>${esc(APP.me.tenant.name)}</h2><b style="font-size:22px">Table ${esc(r.name)}</b>${r.svg}<div>Scan to view menu & order</div></div>`).join('')}</div>`, { title: 'Table QR codes' });
    $$('[data-qd]', box).forEach(b => b.onclick = () => qrDownload({ id: b.dataset.qd, title: 'Download QR — Table ' + b.dataset.n }));
    if ($('#pqz')) $('#pqz').onclick = () => qrDownload({ id: 'all', previewId: rows[0].id, title: `Download all ${rows.length} table QR codes (ZIP)` });
    $$('[data-rg]', box).forEach(b => b.onclick = async () => { if (await confirmBox('Make a new QR code for this table? The old printed code will stop working.')) { await POST(`/api/app/tables/${b.dataset.rg}/regen-qr`); APP.route(); } });
    return;
  }
  const users = can(['settings', 'staff', 'tables', 'pos']) ? await refList('users') : [];
  let floor = +localStorage.getItem('bx_floor') || null;
  const load = async () => {
    const d = await GET('/api/app/tables/live');
    if (!d.floors.find(f => f.id === floor)) floor = d.floors[0] ? d.floors[0].id : null;
    const list = d.tables.filter(t => !d.floors.length || t.floor_id === floor || (!t.floor_id && floor === d.floors[0].id));
    const cnt = s => d.tables.filter(t => t.live_status === s).length;
    box.innerHTML = `<div class="page-h"><div class="chips">${d.floors.map(f => `<button class="chip ${f.id === floor ? 'on' : ''}" data-f="${f.id}">${esc(f.name)}</button>`).join('')}</div>
      <div class="legend"><span><i style="background:#86efac"></i>Free ${cnt('available')}</span><span><i style="background:#fca5a5"></i>Occupied ${cnt('occupied')}</span><span><i style="background:#93c5fd"></i>Reserved ${cnt('reserved')}</span><span><i style="background:#fcd34d"></i>Cleaning ${cnt('cleaning')}</span></div></div>
      <div class="floor">${list.map(t => { const o = t.orders || []; const tot = o.reduce((s, x) => s + n2(x.total), 0); const since = o.length ? o[0].created_at : t.status_since; const ready = o.reduce((s, x) => s + n2(x.ready), 0);
        return `<div class="tbl-tile ${t.live_status} ${t.shape === 'round' ? 'round' : ''}" data-t="${t.id}"><div><div class="tn">${esc(t.name)}</div><div class="ts">${t.seats} seats${t.waiter_name ? ' · ' + esc(t.waiter_name) : ''}</div></div>
          <div class="ts">${o.length ? `${fmt.money(tot)} · ${fmt.mins(since)} min${ready ? ` <span class="badge ok">${ready} ready</span>` : ''}` : t.reservation ? `📅 ${esc(t.reservation.time)} ${esc(t.reservation.customer_name)}` : fmt.label(t.live_status)}</div></div>`; }).join('') || `<div class="empty">No tables yet. <a href="#/tables?tab=setup">Add tables</a></div>`}</div>`;
    $$('[data-f]', box).forEach(b => b.onclick = () => { floor = +b.dataset.f; localStorage.setItem('bx_floor', floor); load(); });
    $$('[data-t]', box).forEach(x => x.onclick = () => tableActions(d.tables.find(t => t.id === +x.dataset.t), users, load));
  };
  await load(); const t = setInterval(load, 15000); APP.cleanup = () => clearInterval(t);
};
function tableActions(t, users, reload) {
  const o = t.orders || [];
  const m = modal({ title: `Table ${t.name}`, body: `<div class="row mb">${badge(t.live_status)} <span class="muted">${t.seats} seats</span></div>
    ${o.map(x => `<button class="opt mb" style="width:100%" data-o="${x.id}">Order #${x.order_no} — <b>${fmt.money(x.total)}</b> ${badge(x.status)}<small>since ${fmt.time(x.created_at)} (${fmt.mins(x.created_at)} min)${x.ready ? ' · ' + x.ready + ' item(s) ready to serve' : ''}</small></button>`).join('')}
    <div class="grid g2">${can('pos') ? `<button class="btn primary lg" data-a="new">+ New order</button>` : ''}
      ${t.live_status !== 'occupied' ? `<button class="btn" data-a="available">✓ Mark free</button><button class="btn" data-a="cleaning">🧹 Cleaning</button><button class="btn" data-a="reserved">📅 Reserved</button>` : ''}</div>
    <label class="f mt"><span>Assigned waiter</span><select id="tw"><option value="">—</option>${users.map(u => `<option value="${u.id}" ${t.waiter_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
    ${t.reservation ? `<div class="alert info small">Reserved today ${esc(t.reservation.time)} for ${esc(t.reservation.customer_name)} (${t.reservation.guests})</div>` : ''}` });
  $$('[data-o]', m.el).forEach(b => b.onclick = () => { m.close(); showOrder(+b.dataset.o); });
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    if (b.dataset.a === 'new') { m.close(); POS.cart = null; return APP.go('#/pos?table=' + t.id + '&new=1'); }
    await POST(`/api/app/tables/${t.id}/status`, { status: b.dataset.a }); m.close(); reload();
  });
  $('#tw', m.el).onchange = async e => { await POST(`/api/app/tables/${t.id}/waiter`, { waiter_id: +e.target.value || null }); toast('Waiter assigned', 'ok'); reload(); };
}

// ================= kitchen display =================
APP.pages.kitchen = async (el, params) => {
  let station = params.station || localStorage.getItem('bx_station') || '';
  let lastIds = null;
  el.innerHTML = `<div class="page-h noprint"><div class="row"><select id="ks" style="width:auto"><option value="">All stations</option></select><label class="check" style="margin:0"><input type="checkbox" id="ksnd" checked> Sound</label></div>
    <div class="row"><span class="muted small" id="kclock"></span><a class="btn" href="#/kitchen?full=${params.full === '1' ? '0' : '1'}${station ? '&station=' + station : ''}">${params.full === '1' ? '↙ Exit full screen' : '⛶ Full screen'}</a></div></div>
    <div id="kcan"></div><div class="kds" id="kb"><div class="loading"><span class="spin"></span></div></div>`;
  const load = async () => {
    const d = await GET('/api/app/kds' + (station ? '?station=' + station : ''));
    const sel = $('#ks'); if (sel && sel.options.length === 1) { sel.innerHTML += d.stations.map(s => `<option value="${s.id}" ${String(s.id) === String(station) ? 'selected' : ''}>${esc(s.name)}</option>`).join(''); }
    const byOrder = new Map();
    d.items.forEach(i => { if (!byOrder.has(i.order_id)) byOrder.set(i.order_id, { id: i.order_id, no: i.order_no, type: i.type, table: i.table_name, waiter: i.waiter_name, prio: i.priority, note: i.order_note, cust: i.customer_name, source: i.source, items: [] }); byOrder.get(i.order_id).items.push(i); });
    const orders = [...byOrder.values()];
    const ids = d.items.filter(i => i.kstatus === 'new').map(i => i.id);
    if (lastIds && ids.some(id => !lastIds.includes(id)) && $('#ksnd') && $('#ksnd').checked) beep(3);
    lastIds = ids;
    const delay = d.delay_min;
    $('#kb').innerHTML = orders.map(o => {
      const first = o.items.reduce((m, i) => (!m || i.sent_at < m ? i.sent_at : m), null); const mins = fmt.mins(first);
      const done = o.items.every(i => i.kstatus === 'ready');
      const cls = done ? 'done' : mins >= delay ? 'late' : mins >= delay / 2 ? 'warm' : '';
      return `<div class="kcard ${cls} ${o.prio ? 'prio' : ''}"><div class="kh"><div><b>#${o.no}</b> ${o.prio ? '⚡' : ''}<div class="small">${esc(fmt.label(o.type))}${o.table ? ' · T-' + esc(o.table) : ''}${o.cust && !o.table ? ' · ' + esc(o.cust) : ''}</div></div><div class="right"><div class="tm">${mins}m</div><div class="small">${esc(o.waiter || o.source)}</div></div></div>
        ${o.items.map(i => `<div class="ki ${i.kstatus}" data-i="${i.id}" data-s="${i.kstatus}"><span class="q">${fmt.num(i.qty, 3)}×</span><div class="nm">${esc(i.name)}${i.variant ? ' <b>(' + esc(i.variant) + ')</b>' : ''}${(i.addons || []).length ? '<div class="small">+ ' + i.addons.map(a => esc(a.name)).join(', ') + '</div>' : ''}${i.note ? `<div class="kn">» ${esc(i.note)}</div>` : ''}${!station && i.station_name ? `<div class="small muted">${esc(i.station_name)}</div>` : ''}</div><span class="small">${i.kstatus === 'new' ? '🆕' : i.kstatus === 'preparing' ? '🔥' : '✅'}</span></div>`).join('')}
        ${o.note ? `<div class="ki"><div class="kn">Note: ${esc(o.note)}</div></div>` : ''}
        <div class="kf">${done ? `<button class="btn block success" data-o="${o.id}" data-st="served">🍽 Served / bump</button>` : `<button class="btn grow" data-o="${o.id}" data-st="preparing">🔥 Start</button><button class="btn grow success" data-o="${o.id}" data-st="ready">✅ Ready</button>`}<button class="btn icon" data-pr="${o.id}" title="Priority">⚡</button></div></div>`;
    }).join('') || '<div class="empty" style="grid-column:1/-1;font-size:18px">🍳 No orders right now</div>';
    $('#kcan').innerHTML = d.cancelled.length ? `<div class="alert bad small">Cancelled: ${d.cancelled.map(c => `#${c.order_no} ${esc(c.name)} ×${fmt.num(c.qty)}`).join(' · ')}</div>` : '';
    $$('[data-i]', el).forEach(x => x.onclick = async () => { const next = { new: 'preparing', preparing: 'ready', ready: 'preparing' }[x.dataset.s]; await POST(`/api/app/kds/items/${x.dataset.i}`, { status: next }); load(); });
    $$('[data-o]', el).forEach(b => b.onclick = async () => { await POST(`/api/app/kds/orders/${b.dataset.o}`, { status: b.dataset.st, station: station || undefined }); load(); });
    $$('[data-pr]', el).forEach(b => b.onclick = async () => { await POST(`/api/app/orders/${b.dataset.pr}/priority`); load(); });
  };
  $('#ks').onchange = e => { station = e.target.value; localStorage.setItem('bx_station', station); lastIds = null; load(); };
  const clock = () => { const c = $('#kclock'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: TZ }); };
  await load(); clock();
  const t1 = setInterval(load, 6000), t2 = setInterval(clock, 1000);
  APP.cleanup = () => { clearInterval(t1); clearInterval(t2); document.body.classList.remove('kds-full'); };
};

// ================= delivery =================
const DEL_TABS = [{ k: 'board', l: 'Delivery board' }, { k: 'riders', l: 'Riders' }, { k: 'zones', l: 'Zones & charges' }, { k: 'pay', l: 'Rider payments' }, { k: 'report', l: 'Rider report' }];
APP.pages.delivery = async (el, params) => {
  const tab = pickTab(DEL_TABS, params);
  el.innerHTML = tabsHTML('delivery', DEL_TABS, tab) + '<div id="db"></div>'; const box = $('#db');
  if (tab === 'riders') return crudPage(box, 'riders', { addLabel: 'Add rider' });
  if (tab === 'zones') return crudPage(box, 'zones', { addLabel: 'Add zone', note: 'Delivery charge is added automatically when a zone is chosen (POS and online orders).' });
  if (tab === 'pay') return crudPage(box, 'rider_payments', { addLabel: 'Record payment', note: 'Record money paid to riders, and cash they deposit after deliveries.' });
  if (tab === 'report') {
    box.innerHTML = `<div class="mb">${rangeBar(params, { branchAll: false })}</div><div class="card p0" id="rr"></div>`; wireRange('delivery', Object.assign({}, params, { tab: 'report' }));
    const rows = await GET('/api/app/delivery/riders-report?' + qstr(params));
    $('#rr').innerHTML = autoTable(rows.map(r => ({ rider: r.name, phone: r.phone, delivered: r.delivered, failed: r.failed, order_value: r.order_value, cash_collected: r.cash_collected, cash_deposited: r.cash_deposited, cash_to_collect: n2(r.cash_collected) - n2(r.cash_deposited), earned: n2(r.per_delivery) * r.delivered, paid_to_rider: r.paid_to_rider, avg_minutes: r.avg_minutes || 0 })));
    return;
  }
  const load = async () => {
    const d = await GET('/api/app/delivery/board');
    const col = (title, list) => `<div><h3>${title} <span class="badge">${list.length}</span></h3>${list.map(o => `<div class="card mb" style="padding:12px"><div class="row between"><b>#${o.order_no}</b><span>${fmt.money(o.total)}</span></div>
      <div class="small">${esc(o.customer_name || '')} · <a href="tel:${esc(o.customer_phone || '')}">${esc(o.customer_phone || '')}</a></div><div class="small muted">${esc(o.address || '')}${o.zone_name ? ' · ' + esc(o.zone_name) : ''}</div>
      <div class="small">${o.cooking ? '🔥 Cooking' : '✅ Food ready'} · ${fmt.ago(o.created_at)} ${n2(o.paid) >= n2(o.total) ? '<span class="badge ok">Paid</span>' : '<span class="badge warn">Collect ' + fmt.money(n2(o.total) - n2(o.paid)) + '</span>'}</div>
      ${o.status === 'pending' ? `<button class="btn sm success mt" data-acc="${o.id}">Accept order</button>` : `<div class="row mt"><select data-r="${o.id}" style="flex:1;min-height:32px;padding:4px 8px"><option value="">Assign rider…</option>${d.riders.map(r => `<option value="${r.id}" ${o.rider_id === r.id ? 'selected' : ''}>${esc(r.name)}${r.active_jobs ? ' (' + r.active_jobs + ' jobs)' : ''}</option>`).join('')}</select>
        ${o.delivery_status === 'assigned' ? `<button class="btn sm" data-st="picked" data-o="${o.id}">Picked up</button>` : ''}${['assigned', 'picked'].includes(o.delivery_status) ? `<button class="btn sm success" data-st="delivered" data-o="${o.id}">Delivered</button><button class="btn sm danger" data-st="failed" data-o="${o.id}">Failed</button>` : ''}</div>`}
      <div class="row mt"><button class="btn sm ghost" data-v="${o.id}">Details</button>${n2(o.paid) < n2(o.total) && o.delivery_status === 'delivered' && can('pos') ? `<button class="btn sm primary" data-pay="${o.id}">Take payment</button>` : ''}</div></div>`).join('') || '<div class="muted small">—</div>'}</div>`;
    const os = d.orders;
    box.innerHTML = `<div class="row mb">${d.riders.map(r => `<span class="badge ${r.available ? 'ok' : 'warn'}">🛵 ${esc(r.name)} ${r.available ? 'free' : 'on delivery'}</span>`).join(' ') || '<span class="muted">No riders yet — add them in the Riders tab.</span>'}</div>
      <div class="grid g4">${col('New / to assign', os.filter(o => !o.delivery_status && !['completed'].includes(o.status) || o.status === 'pending'))}${col('Assigned', os.filter(o => o.delivery_status === 'assigned'))}${col('On the way', os.filter(o => o.delivery_status === 'picked'))}${col('Delivered / done', os.filter(o => ['delivered', 'failed'].includes(o.delivery_status) || (!o.delivery_status && o.status === 'completed')))}</div>`;
    $$('[data-r]', box).forEach(s => s.onchange = async () => { if (!s.value) return; await POST(`/api/app/orders/${s.dataset.r}/delivery`, { rider_id: +s.value }); toast('Rider assigned', 'ok'); load(); });
    $$('[data-st]', box).forEach(b => b.onclick = async () => { await POST(`/api/app/orders/${b.dataset.o}/delivery`, { status: b.dataset.st }); load(); });
    $$('[data-acc]', box).forEach(b => b.onclick = async () => { await POST(`/api/app/orders/${b.dataset.acc}/accept`); load(); });
    $$('[data-v]', box).forEach(b => b.onclick = () => showOrder(+b.dataset.v));
    $$('[data-pay]', box).forEach(b => b.onclick = () => APP.go('#/pos?order=' + b.dataset.pay));
  };
  await load(); const t = setInterval(load, 15000); APP.cleanup = () => clearInterval(t);
};

// ================= reservations =================
APP.pages.reservations = async (el, params) => {
  const date = params.date || todayStr();
  await refList('tables', true);
  const res = await crudPage(el, 'reservations', {
    addLabel: 'New booking', params: () => (params.all ? '' : 'date=' + ($('#rdate') ? $('#rdate').value : date)),
    filtersHTML: `<input type="date" id="rdate" value="${date}" style="width:auto" data-filter><label class="check" style="margin:0"><input type="checkbox" id="rall" ${params.all ? 'checked' : ''}> All dates</label>`,
    cols: [{ key: 'time', label: 'Time', html: r => `<b>${esc(r.time)}</b><div class="small muted">${fmt.date(r.date)}</div>` }, { key: 'customer_name', label: 'Guest', html: r => `${esc(r.customer_name)}<div class="small muted">${esc(r.phone || '')}</div>` },
      { key: 'guests', label: 'Guests', num: 1 }, { key: 'table_id', label: 'Table', fmt: v => refName('tables', v) }, { key: 'event_type', label: 'Type' }, { key: 'deposit', label: 'Deposit', num: 1, fmt: fmt.money },
      { key: 'status', label: 'Status', html: r => badge(r.status) }, { key: 'x', label: '', html: r => ['booked', 'confirmed', 'waitlist'].includes(r.status) ? `<button class="btn sm" data-rs="${r.id}" data-to="${r.status === 'booked' || r.status === 'waitlist' ? 'confirmed' : 'seated'}">${r.status === 'confirmed' ? 'Seat now' : 'Confirm'}</button> <button class="btn sm danger" data-rs="${r.id}" data-to="no_show">No-show</button>` : '' }],
    afterLoad: rows => $$('[data-rs]', el).forEach(b => b.onclick = async e => {
      e.stopPropagation(); const r = rows.find(x => x.id === +b.dataset.rs);
      await PUT('/api/r/reservations/' + r.id, { status: b.dataset.to });
      if (b.dataset.to === 'seated' && r.table_id) { await POST(`/api/app/tables/${r.table_id}/status`, { status: 'available' }).catch(() => {}); if (can('pos') && await confirmBox('Guest seated. Start an order for this table now?')) { POS.cart = null; return APP.go(`#/pos?table=${r.table_id}&new=1`); } }
      if (b.dataset.to === 'confirmed' && r.table_id && r.date === todayStr()) await POST(`/api/app/tables/${r.table_id}/status`, { status: 'reserved' }).catch(() => {});
      toast('Updated', 'ok'); res.reload();
    })
  });
  $('#rall').onchange = e => APP.go('#/reservations' + (e.target.checked ? '?all=1' : ''));
};

// ================= cash shift =================
APP.pages.shift = async el => {
  const cur = await GET('/api/app/shift/current');
  const hist = can(['accounting', 'reports']) || can('shifts') ? await GET('/api/app/shifts').catch(() => []) : [];
  if (!cur) {
    el.innerHTML = `<div class="card" style="max-width:520px"><h2>Open your cash shift</h2><p class="muted">Count the cash in the drawer and enter it. All your cash sales will be tracked until you close the shift.</p>
      <label class="f"><span>Opening cash in drawer</span><input type="number" id="oc" value="0" style="font-size:20px"></label><button class="btn primary lg block" id="go">Open shift</button></div>`;
    $('#go').onclick = async () => { await POST('/api/app/shift/open', { opening_cash: n2($('#oc').value) }); toast('Shift opened', 'ok'); APP.route(); };
  } else {
    const s = cur;
    el.innerHTML = `<div class="page-h"><div><h2 class="mt0">Shift open since ${fmt.dt(s.shift.opened_at)}</h2><div class="muted">${esc(s.shift.user_name)}</div></div><div class="row"><button class="btn" data-c="in">+ Cash in</button><button class="btn" data-c="out">− Cash out / petty</button><button class="btn danger" id="close">Close shift & count cash</button></div></div>
      <div class="grid g4"><div class="card kpi"><div class="l">Opening cash</div><div class="v">${fmt.money(s.shift.opening_cash)}</div></div><div class="card kpi"><div class="l">Cash sales</div><div class="v">${fmt.money(s.cash_sales)}</div></div>
        <div class="card kpi"><div class="l">Orders completed</div><div class="v">${s.orders.n}</div><div class="s muted">${fmt.money(s.orders.total)}</div></div><div class="card kpi"><div class="l">Expected cash in drawer</div><div class="v" style="color:var(--brand)">${fmt.money(s.expected_cash)}</div></div></div>
      <div class="grid g2 mt"><div class="card"><h3>Sales by payment method</h3>${hbars(s.payments.map(p => ({ label: `${p.method} (${p.n})`, value: p.amount })))}<hr>
        <div class="row between"><span>Due collected (cash)</span><b>${fmt.money(s.due_collected)}</b></div><div class="row between"><span>Cash refunds</span><b>-${fmt.money(s.refunds.cash)}</b></div><div class="row between"><span>Cash expenses</span><b>-${fmt.money(s.cash_expenses)}</b></div>
        <div class="row between"><span>Cash in</span><b>${fmt.money(s.cash_in)}</b></div><div class="row between"><span>Cash out</span><b>-${fmt.money(s.cash_out)}</b></div></div>
      <div class="card p0"><div style="padding:14px 16px 0"><h3>Drawer movements</h3></div>${table([{ key: 'created_at', label: 'Time', fmt: fmt.time }, { key: 'type', label: 'Type', html: r => badge(r.type === 'in' ? 'cash in' : 'cash out') }, { key: 'amount', label: 'Amount', num: 1, fmt: fmt.money }, { key: 'note', label: 'Note' }], s.moves, { empty: 'No cash in/out yet' })}</div></div>`;
    $$('[data-c]', el).forEach(b => b.onclick = () => modal({ title: b.dataset.c === 'in' ? 'Cash in (add to drawer)' : 'Cash out (petty cash / remove from drawer)', body: `<label class="f"><span>Amount</span><input type="number" id="ca"></label><label class="f"><span>Note</span><input id="cn" placeholder="e.g. change float, bought vegetables"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { await POST('/api/app/shift/cash', { type: b.dataset.c, amount: n2($('#ca').value), note: $('#cn').value }); APP.route(); } }] }));
    $('#close').onclick = () => modal({ title: 'Close shift', body: `<p>Expected cash in drawer: <b>${fmt.money(s.expected_cash)}</b></p><label class="f"><span>Cash you counted</span><input type="number" id="cc" style="font-size:20px"></label><label class="f"><span>Note</span><input id="cnote"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Close shift', cls: 'danger', onClick: async () => {
        const r = await POST('/api/app/shift/close', { closing_cash: n2($('#cc').value), note: $('#cnote').value });
        const diff = r.difference;
        modal({ title: 'Shift closed', body: `<div class="center"><div class="bigtotal" style="color:${Math.abs(diff) < 1 ? 'var(--ok)' : 'var(--bad)'}">${diff === 0 ? 'Cash matches ✓' : (diff > 0 ? 'Extra ' : 'Short ') + fmt.money(Math.abs(diff))}</div><p>Expected ${fmt.money(r.expected_cash)} · Counted ${fmt.money(r.closing_cash)}</p></div>`,
          actions: [{ label: '🖨 Print summary', onClick: () => { printHTML(`<div class="c b big">${esc(APP.me.tenant.name)}</div><div class="c">SHIFT CLOSING — ${esc(APP.me.user.name)}</div><div class="hr"></div><table><tr><td>Opened</td><td class="r">${fmt.dt(r.shift.opened_at)}</td></tr><tr><td>Closed</td><td class="r">${fmt.dt(new Date())}</td></tr><tr><td>Opening cash</td><td class="r">${fmt.money(r.shift.opening_cash)}</td></tr>${r.payments.map(p => `<tr><td>${esc(p.method)} (${p.n})</td><td class="r">${fmt.money(p.amount)}</td></tr>`).join('')}<tr><td>Cash refunds</td><td class="r">-${fmt.money(r.refunds.cash)}</td></tr><tr><td>Cash in/out</td><td class="r">${fmt.money(r.cash_in - r.cash_out)}</td></tr><tr class="b"><td>Expected</td><td class="r">${fmt.money(r.expected_cash)}</td></tr><tr class="b"><td>Counted</td><td class="r">${fmt.money(r.closing_cash)}</td></tr><tr class="b"><td>Difference</td><td class="r">${fmt.money(diff)}</td></tr></table>`, { width: 80 }); return false; } }, { label: 'Done', cls: 'primary' }], onClose: () => APP.route() });
      } }] });
  }
  if (hist.length) el.insertAdjacentHTML('beforeend', `<div class="card p0 mt"><div style="padding:14px 16px 0"><h3>Shift history</h3></div>${table([{ key: 'opened_at', label: 'Opened', fmt: fmt.dt }, { key: 'user_name', label: 'Cashier' }, { key: 'branch_name', label: 'Branch' }, { key: 'opening_cash', label: 'Opening', num: 1, fmt: fmt.money }, { key: 'expected_cash', label: 'Expected', num: 1, fmt: v => v === null ? '—' : fmt.money(v) }, { key: 'closing_cash', label: 'Counted', num: 1, fmt: v => v === null ? '—' : fmt.money(v) }, { key: 'difference', label: 'Difference', num: 1, html: r => r.difference === null ? '—' : `<b style="color:${Math.abs(r.difference) < 1 ? 'var(--ok)' : 'var(--bad)'}">${fmt.money(r.difference)}</b>` }, { key: 'status', label: 'Status', html: r => badge(r.status) }], hist)}</div>`);
};

// ================= attendance (self clock-in) =================
APP.pages.attendance = async el => {
  const d = await GET('/api/app/attendance');
  const me = d.rows.find(r => r.user_id === APP.me.user.id) || {};
  el.innerHTML = `<div class="card center" style="max-width:480px;margin:auto"><h2>${esc(APP.me.user.name)}</h2><div class="muted">${fmt.date(d.date)}</div>
    <div class="bigtotal mt">${new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}</div>
    <p>Clock in: <b>${fmt.time(me.clock_in)}</b> · Clock out: <b>${fmt.time(me.clock_out)}</b></p>
    ${me.schedule ? `<p class="muted">Today's duty: ${esc(me.schedule.start)} – ${esc(me.schedule.end)}</p>` : ''}
    ${!me.clock_out ? `<button class="btn ${me.clock_in ? 'danger' : 'primary'} lg block" id="clk">${me.clock_in ? '⏹ Clock out' : '▶ Clock in'}</button>` : '<div class="alert ok">Done for today ✓</div>'}</div>`;
  if ($('#clk')) $('#clk').onclick = async () => { await POST('/api/app/attendance/clock', {}); toast('Saved', 'ok'); APP.route(); };
};
