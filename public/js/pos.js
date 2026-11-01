// POS: fast billing, tables, customers, discounts, split payments, receipts, KOT, offline queue, customer display
const POS = { B: null, cat: 'all', q: '', cart: null, coupon: null };
const cfd = (() => { try { return new BroadcastChannel('bx-cfd'); } catch (e) { return null; } })();
const OFFQ = 'bx_offline_orders';

function newCart(type) {
  return { orderId: null, order_no: null, type: type || (POS.cart && POS.cart.type) || 'takeaway', table_id: null, table_name: null, customer: null, items: [], discount_type: null, discount_value: 0,
    coupon_code: null, redeem_points: 0, zone_id: null, delivery_charge: null, address: '', vehicle_no: '', guests: null, waiter_id: null, source: '', note: '', paid: 0, priority: false };
}
const prod = id => POS.B.products.find(p => p.id === id);
function lineUnit(l) { return n2(l.unit_price); }
function cartTotals(c) {
  const s = POS.B.settings; const items = c.items.filter(i => i.kstatus !== 'cancelled');
  const subtotal = items.reduce((a, i) => a + lineUnit(i) * n2(i.qty), 0);
  const itemDisc = items.reduce((a, i) => a + n2(i.discount), 0);
  const lineNet = subtotal - itemDisc;
  const taxable = items.filter(i => !i.tax_exempt).reduce((a, i) => a + lineUnit(i) * n2(i.qty) - n2(i.discount), 0);
  let disc = c.discount_type === 'percent' ? lineNet * Math.min(100, n2(c.discount_value)) / 100 : c.discount_type === 'fixed' ? n2(c.discount_value) : 0;
  if (!c.discount_type && c.customer && n2(c.customer.special_discount) > 0) disc = lineNet * n2(c.customer.special_discount) / 100;
  disc += (POS.coupon && POS.coupon.code === c.coupon_code ? n2(POS.coupon.discount) : 0) + n2(c.redeem_points) * n2(s.point_value || 1);
  disc = Math.min(Math.max(0, disc), lineNet);
  const net = lineNet - disc;
  const svc = (!s.service_dine_in_only || c.type === 'dine_in') ? net * n2(s.service_pct) / 100 : 0;
  const ratio = lineNet > 0 ? taxable / lineNet : 0; const base = net * ratio + svc; const pct = n2(s.vat_pct);
  const del = c.type === 'delivery' ? (c.delivery_charge !== null && c.delivery_charge !== '' ? n2(c.delivery_charge) : n2((POS.B.zones.find(z => z.id === c.zone_id) || {}).charge)) : 0;
  let vat, total;
  if (s.vat_inclusive) { vat = base - base / (1 + pct / 100); total = net + svc + del; } else { vat = base * pct / 100; total = net + svc + vat + del; }
  if (s.round_total) total = Math.round(total);
  return { subtotal, itemDisc, disc, svc, vat, del, total: Math.round(total * 100) / 100 };
}
function cartPayload(c, action, payments, extra = {}) {
  return Object.assign({
    type: c.type, table_id: c.table_id, customer_id: c.customer && c.customer.id, items: c.items.filter(i => i.kstatus !== 'cancelled').map(i => ({ id: i.id, product_id: i.product_id, name: i.name, price: i.unit_price, variant: i.variant, addons: (i.addons || []).map(a => a.name), qty: i.qty, note: i.note, discount: i.discount })),
    discount_type: c.discount_type, discount_value: c.discount_value, coupon_code: c.coupon_code || null, redeem_points: c.redeem_points || 0, zone_id: c.zone_id, delivery_charge: c.delivery_charge,
    address: c.address, vehicle_no: c.vehicle_no, guests: c.guests, waiter_id: c.waiter_id, source: c.source || undefined, note: c.note, priority: c.priority, action, payments
  }, extra);
}

APP.pages.pos = async (el, params) => {
  POS.B = await GET('/api/app/pos/bootstrap');
  if (!POS.cart || params.new) POS.cart = newCart(params.type);
  if (params.table) { const t = POS.B.tables.find(x => x.id === +params.table); if (t) { POS.cart = newCart('dine_in'); POS.cart.table_id = t.id; POS.cart.table_name = t.name; } }
  if (params.order) await loadOrder(+params.order);
  el.innerHTML = `<div class="pos"><div class="lp">
      <div class="posbar"><input type="search" id="pq" placeholder="🔍 Search item or scan barcode…" style="flex:1"><button class="btn" id="prun" title="Running orders">🗂 Running <span class="badge" id="runc">…</span></button>${POS.B.shift ? '' : (can('shifts') ? '<a class="btn warn" href="#/shift" title="Open a cash shift">Open shift</a>' : '')}</div>
      <div class="cats" id="pcats"></div><div class="pgrid" id="pgrid"></div></div>
    <div class="rp" id="prp"><button type="button" class="cartbar" id="cartbar"></button><div class="rp-in">
      <div class="otype" id="otype">${[['dine_in', '🍽 Dine-in'], ['takeaway', '🥡 Takeaway'], ['delivery', '🛵 Delivery'], ['drive_thru', '🚗 Drive']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div>
      <div class="cartmeta" id="cmeta"></div>
      <div class="cart" id="cart"></div>
      <div class="totals" id="ctot"></div>
      <div class="pos-actions"><button class="btn" id="bhold">⏸ Hold</button><button class="btn dark" id="bkot">🔥 Kitchen</button><button class="btn primary" id="bpay">💳 Pay</button></div>
    </div></div></div>`;
  $('#pq').oninput = debounce(e => { POS.q = e.target.value.trim().toLowerCase(); drawProducts(); }, 120);
  $('#pq').onkeydown = e => { if (e.key === 'Enter') { const v = e.target.value.trim(); const p = POS.B.products.find(x => (x.barcode && x.barcode === v) || (x.sku && x.sku.toLowerCase() === v.toLowerCase())); if (p) { addProduct(p); e.target.value = ''; POS.q = ''; drawProducts(); } } };
  $$('#otype button').forEach(b => b.onclick = () => { POS.cart.type = b.dataset.t; if (b.dataset.t !== 'dine_in') { POS.cart.table_id = null; POS.cart.table_name = null; } if (b.dataset.t === 'dine_in' && !POS.cart.table_id) pickTable(); drawCart(); });
  $('#bhold').onclick = () => saveCart('hold'); $('#bkot').onclick = () => saveCart('kitchen'); $('#bpay').onclick = () => payModal();
  $('#prun').onclick = runningOrders;
  $('#cartbar').onclick = () => $('#prp').classList.toggle('open');
  drawCats(); drawProducts(); drawCart(); refreshRunning();
  const kh = e => { if (e.key === 'F2') { e.preventDefault(); $('#pq').focus(); } if (e.key === 'F9') { e.preventDefault(); payModal(); } if (e.key === 'F8') { e.preventDefault(); saveCart('kitchen'); } };
  document.addEventListener('keydown', kh);
  const t = setInterval(() => { syncOffline(); refreshRunning(); }, 20000);
  APP.cleanup = () => { document.removeEventListener('keydown', kh); clearInterval(t); };
  syncOffline();
};
async function refreshRunning() { try { const r = await GET('/api/app/orders?status=open,held,pending&limit=300'); const c = $('#runc'); if (c) c.textContent = r.length; POS.running = r; } catch (e) { } }
function drawCats() {
  const cats = [{ id: 'all', name: 'All' }, ...POS.B.categories];
  $('#pcats').innerHTML = cats.map(c => `<button class="chip ${String(POS.cat) === String(c.id) ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`).join('');
  $$('#pcats .chip').forEach(b => b.onclick = () => { POS.cat = b.dataset.c; drawCats(); drawProducts(); });
}
function drawProducts() {
  let list = POS.B.products;
  if (POS.cat !== 'all') list = list.filter(p => String(p.category_id) === String(POS.cat));
  if (POS.q) list = POS.B.products.filter(p => p.name.toLowerCase().includes(POS.q) || (p.sku || '').toLowerCase().includes(POS.q) || (p.barcode || '') === POS.q);
  $('#pgrid').innerHTML = list.map(p => `<div class="pcard ${p.available ? '' : 'na'}" data-p="${p.id}">${p.happy ? '<span class="tag">HAPPY HOUR</span>' : ''}${!p.available ? '<span class="tag" style="background:#64748b">N/A</span>' : ''}
      <div class="im">${p.image_id ? `<img src="/f/${p.image_id}" loading="lazy">` : esc(initials(p.name))}</div><div class="nm">${esc(p.name)}</div>
      <div class="pr">${fmt.money(p.variants && p.variants.length ? Math.min(...p.variants.map(v => n2(v.price))) : p.price)}${p.by_weight ? '<span class="small muted">/kg</span>' : ''}${p.variants && p.variants.length ? '<span class="small muted"> +</span>' : ''}</div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No items found</div>';
  $$('#pgrid .pcard').forEach(c => c.onclick = () => { const p = prod(+c.dataset.p); if (!p.available && !confirm(`${p.name} is marked unavailable right now. Add anyway?`)) return; addProduct(p); });
}
function addProduct(p) {
  if ((p.variants && p.variants.length) || (p.addons && p.addons.length) || p.by_weight) return optionsModal(p);
  pushLine({ product_id: p.id, name: p.name, variant: null, addons: [], qty: 1, unit_price: p.price, note: '' });
}
function pushLine(l) {
  const same = POS.cart.items.find(i => (!i.kstatus || i.kstatus === 'draft') && i.product_id === l.product_id && i.variant === l.variant && JSON.stringify(i.addons) === JSON.stringify(l.addons) && !i.note && !l.note && !i.by_weight && !l.by_weight);
  if (same) same.qty = n2(same.qty) + n2(l.qty); else POS.cart.items.push(Object.assign({ kstatus: 'draft', discount: 0 }, l));
  drawCart();
  const g = $('#cart'); if (g) g.scrollTop = g.scrollHeight;
}
function optionsModal(p, edit) {
  let variant = edit ? edit.variant : (p.variants && p.variants[0] ? p.variants[0].name : null);
  const addons = new Set(edit ? (edit.addons || []).map(a => a.name) : []);
  let qty = edit ? edit.qty : (p.by_weight ? '' : 1);
  const m = modal({ title: p.name, body: `${p.variants && p.variants.length ? `<h4>Choose size / option</h4><div class="opt-list" id="ov">${p.variants.map(v => `<button class="opt" data-v="${esc(v.name)}">${esc(v.name)}<small>${fmt.money(v.price)}</small></button>`).join('')}</div>` : ''}
      ${p.addons && p.addons.length ? `<h4 class="mt">Add-ons</h4><div class="opt-list" id="oa">${p.addons.map(a => `<button class="opt" data-a="${esc(a.name)}">${esc(a.name)}<small>+${fmt.money(a.price)}</small></button>`).join('')}</div>` : ''}
      <div class="fgrid mt"><label class="f"><span>${p.by_weight ? 'Weight (kg) — e.g. 0.75' : 'Quantity'}</span><input type="number" step="${p.by_weight ? '0.001' : '1'}" min="0" id="oq" value="${qty}"></label>
      <label class="f"><span>Special instruction</span><input id="on" value="${esc(edit ? edit.note || '' : '')}" placeholder="e.g. less spicy"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: edit ? 'Update' : 'Add to order', cls: 'primary', onClick: () => {
      const q = n2($('#oq').value); if (!(q > 0)) { toast('Enter quantity / weight', 'err'); return false; }
      const v = (p.variants || []).find(x => x.name === variant); const ads = (p.addons || []).filter(a => addons.has(a.name));
      const unit = (v ? n2(v.price) : n2(p.price)) + ads.reduce((s, a) => s + n2(a.price), 0);
      const line = { product_id: p.id, name: p.name, variant: v ? v.name : null, addons: ads.map(a => ({ name: a.name, price: n2(a.price) })), qty: q, unit_price: unit, note: $('#on').value.trim(), by_weight: p.by_weight };
      if (edit) { Object.assign(edit, line); drawCart(); } else pushLine(line);
    } }] });
  const draw = () => { $$('[data-v]', m.el).forEach(b => b.classList.toggle('on', b.dataset.v === variant)); $$('[data-a]', m.el).forEach(b => b.classList.toggle('on', addons.has(b.dataset.a))); };
  $$('[data-v]', m.el).forEach(b => b.onclick = () => { variant = b.dataset.v; draw(); });
  $$('[data-a]', m.el).forEach(b => b.onclick = () => { addons.has(b.dataset.a) ? addons.delete(b.dataset.a) : addons.add(b.dataset.a); draw(); });
  draw();
}
function drawCart() {
  const c = POS.cart; if (!$('#cart')) return;
  $$('#otype button').forEach(b => b.classList.toggle('on', b.dataset.t === c.type));
  const metaBtns = [];
  if (c.type === 'dine_in') metaBtns.push(`<button class="btn sm" id="mtable">🍽 ${c.table_name ? 'Table ' + esc(c.table_name) : 'Choose table'}</button>`);
  metaBtns.push(`<button class="btn sm" id="mcust">👤 ${c.customer ? esc(c.customer.name) + (c.customer.phone ? ' · ' + esc(c.customer.phone) : '') : 'Customer'}</button>`);
  if (c.type === 'delivery') metaBtns.push(`<button class="btn sm" id="mdel">📍 ${c.address ? esc(c.address.slice(0, 22)) : 'Address & zone'}</button>`);
  if (c.type === 'drive_thru') metaBtns.push(`<button class="btn sm" id="mveh">🚗 ${c.vehicle_no ? esc(c.vehicle_no) : 'Vehicle no.'}</button>`);
  metaBtns.push(`<button class="btn sm" id="mmore" style="flex:0;min-width:auto">⋯ More</button>`);
  $('#cmeta').innerHTML = (c.orderId ? `<div class="small" style="width:100%;font-weight:700">Editing order #${c.order_no} ${c.paid ? '· paid ' + fmt.money(c.paid) : ''} <a href="#" id="mnew" style="float:right">✕ New order</a></div>` : '') + metaBtns.join('');
  $('#cart').innerHTML = c.items.length ? c.items.map((i, idx) => i.kstatus === 'cancelled' ? '' : `<div class="citem ${i.kstatus && i.kstatus !== 'draft' ? 'sent' : ''}">
      <div><div class="n">${esc(i.name)}${i.variant ? ` <span class="muted">(${esc(i.variant)})</span>` : ''}</div>
        <div class="d">${(i.addons || []).map(a => '+ ' + esc(a.name)).join(', ')}${i.note ? ` <i>“${esc(i.note)}”</i>` : ''}${n2(i.discount) ? ` · disc ${fmt.money(i.discount)}` : ''} · ${fmt.money(i.unit_price)}${i.by_weight ? '/kg' : ''}</div></div>
      <div class="p">${fmt.money(lineUnit(i) * n2(i.qty) - n2(i.discount))}</div>
      <div class="row" style="gap:6px"><div class="qty"><button data-dec="${idx}">−</button><span>${fmt.num(i.qty, 3)}</span><button data-inc="${idx}">+</button></div>
        <button class="btn sm ghost" data-edit="${idx}" title="Edit">✎</button></div>
      <div style="text-align:right"><button class="btn sm ghost" data-del="${idx}" title="Remove" style="color:var(--bad)">🗑</button></div></div>`).join('') : '<div class="empty">Tap items to add them<br><span class="small">F2 search · F8 kitchen · F9 pay</span></div>';
  const t = cartTotals(c);
  { const cnt = c.items.filter(i => i.kstatus !== 'cancelled').reduce((a, i) => a + (i.by_weight ? 1 : n2(i.qty)), 0); const cb = $('#cartbar');
    if (cb) { cb.innerHTML = `<span class="cb-l">🛒 <b>${fmt.num(cnt, 0)}</b> item${cnt === 1 ? '' : 's'}${c.table_name ? ' · Table ' + esc(c.table_name) : ''}</span><span class="cb-r"><b>${fmt.money(cartTotals(c).total)}</b> <span class="cb-ch">▲</span></span>`; cb.classList.toggle('has', cnt > 0);
      if (cnt > (POS._lastCnt || 0)) { cb.classList.remove('bump'); void cb.offsetWidth; cb.classList.add('bump'); } POS._lastCnt = cnt; } }
  $('#ctot').innerHTML = `<div class="tr"><span>Subtotal</span><span>${fmt.money(t.subtotal)}</span></div>
    ${t.itemDisc + t.disc > 0 ? `<div class="tr" style="color:var(--ok)"><span>Discount${c.coupon_code ? ' (' + esc(c.coupon_code) + ')' : ''}</span><span>-${fmt.money(t.itemDisc + t.disc)}</span></div>` : ''}
    ${t.svc ? `<div class="tr"><span>Service charge</span><span>${fmt.money(t.svc)}</span></div>` : ''}
    ${t.vat ? `<div class="tr"><span>VAT ${POS.B.settings.vat_pct}%${POS.B.settings.vat_inclusive ? ' (incl.)' : ''}</span><span>${fmt.money(t.vat)}</span></div>` : ''}
    ${t.del ? `<div class="tr"><span>Delivery</span><span>${fmt.money(t.del)}</span></div>` : ''}
    <div class="tr grand"><span>Total</span><span>${fmt.money(t.total)}</span></div>
    <div class="row mt" style="gap:6px"><button class="btn sm" id="mdisc">🏷 Discount</button>${c.customer && n2(c.customer.points) > 0 && POS.B.settings.loyalty_enabled ? `<button class="btn sm" id="mpts">⭐ ${fmt.num(c.customer.points, 0)} pts</button>` : ''}<button class="btn sm ghost" id="mclear" style="margin-left:auto">Clear</button></div>`;
  $$('[data-inc]').forEach(b => b.onclick = () => { const i = c.items[+b.dataset.inc]; if (i.kstatus && i.kstatus !== 'draft') return pushLine(Object.assign({}, i, { id: undefined, kstatus: 'draft', qty: 1 })); i.qty = n2(i.qty) + 1; drawCart(); });
  $$('[data-dec]').forEach(b => b.onclick = () => { const i = c.items[+b.dataset.dec]; if (i.kstatus && i.kstatus !== 'draft') return toast('Already sent to kitchen — use 🗑 to cancel it (needs approval)', 'err'); if (n2(i.qty) > 1) i.qty = n2(i.qty) - 1; else c.items.splice(+b.dataset.dec, 1); drawCart(); });
  $$('[data-del]').forEach(b => b.onclick = async () => { const i = c.items[+b.dataset.del]; if (i.kstatus && i.kstatus !== 'draft') { if (!(await confirmBox(`Cancel "${i.name}"? It was already sent to the kitchen.`, { danger: true }))) return; i.kstatus = 'cancelled'; } else c.items.splice(+b.dataset.del, 1); drawCart(); });
  $$('[data-edit]').forEach(b => b.onclick = () => { const i = c.items[+b.dataset.edit]; if (i.kstatus && i.kstatus !== 'draft') return lineDiscount(i); const p = prod(i.product_id); if (p) optionsModal(p, i); else lineDiscount(i); });
  if ($('#mtable')) $('#mtable').onclick = pickTable;
  $('#mcust').onclick = pickCustomer;
  if ($('#mdel')) $('#mdel').onclick = deliveryModal;
  if ($('#mveh')) $('#mveh').onclick = async () => { const v = await askText('Vehicle number', { value: c.vehicle_no }); if (v !== null) { c.vehicle_no = v; drawCart(); } };
  $('#mmore').onclick = moreMenu;
  $('#mdisc').onclick = discountModal;
  if ($('#mpts')) $('#mpts').onclick = async () => { const v = await askText('Redeem loyalty points', { label: `Customer has ${c.customer.points} points (1 point = ${fmt.money(POS.B.settings.point_value)})`, type: 'number', value: c.redeem_points || c.customer.points }); if (v !== null) { c.redeem_points = Math.min(n2(v), n2(c.customer.points)); drawCart(); } };
  $('#mclear').onclick = async () => { if (c.items.length && !c.orderId && !(await confirmBox('Clear this order?'))) return; POS.cart = newCart(c.type); POS.coupon = null; drawCart(); };
  if ($('#mnew')) $('#mnew').onclick = e => { e.preventDefault(); POS.cart = newCart(); POS.coupon = null; drawCart(); };
  // customer facing display
  const msg = { name: APP.me.tenant.name, logo: APP.me.tenant.settings.logo_id, currency: CUR, items: c.items.filter(i => i.kstatus !== 'cancelled').map(i => ({ name: i.name + (i.variant ? ` (${i.variant})` : ''), qty: i.qty, total: lineUnit(i) * n2(i.qty) - n2(i.discount) })), totals: t, ts: Date.now() };
  try { cfd && cfd.postMessage(msg); localStorage.setItem('bx-cfd', JSON.stringify(msg)); } catch (e) { }
}
function lineDiscount(i) {
  modal({ title: 'Item discount — ' + i.name, body: `<label class="f"><span>Discount amount on this line (${CUR})</span><input type="number" id="ld" value="${n2(i.discount) || ''}"></label>${!i.kstatus || i.kstatus === 'draft' ? `<label class="f"><span>Instruction</span><input id="ln" value="${esc(i.note || '')}"></label>` : ''}`,
    actions: [{ label: 'Cancel' }, { label: 'Apply', cls: 'primary', onClick: () => { i.discount = Math.min(n2($('#ld').value), lineUnit(i) * n2(i.qty)); if ($('#ln')) i.note = $('#ln').value; drawCart(); } }] });
}
function discountModal() {
  const c = POS.cart; const t = cartTotals(c);
  const m = modal({ title: 'Discount & coupon', body: `<div class="chips mb" id="dq">${[5, 10, 15, 20, 25, 50].map(p => `<button class="chip" data-p="${p}">${p}%</button>`).join('')}</div>
      <div class="fgrid"><label class="f"><span>Discount type</span><select id="dt"><option value="">No discount</option><option value="percent" ${c.discount_type === 'percent' ? 'selected' : ''}>Percent %</option><option value="fixed" ${c.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></label>
      <label class="f"><span>Value</span><input type="number" id="dv" value="${c.discount_value || ''}"></label></div>
      <label class="f"><span>Coupon code</span><div class="row"><input id="dc" value="${esc(c.coupon_code || '')}" style="flex:1;text-transform:uppercase"><button class="btn" id="dcc">Check</button></div></label><div id="dcm" class="small"></div>`,
    actions: [{ label: 'Remove all', onClick: () => { c.discount_type = null; c.discount_value = 0; c.coupon_code = null; POS.coupon = null; drawCart(); } }, { label: 'Apply', cls: 'primary', onClick: async () => {
      c.discount_type = $('#dt').value || null; c.discount_value = n2($('#dv').value);
      const code = $('#dc').value.trim().toUpperCase();
      if (code && (!POS.coupon || POS.coupon.code !== code)) { POS.coupon = await POST('/api/app/coupon-check', { code, subtotal: t.subtotal - t.itemDisc, customer_id: c.customer && c.customer.id, items: c.items }); }
      c.coupon_code = code || null; if (!code) POS.coupon = null; drawCart();
    } }] });
  $$('#dq .chip', m.el).forEach(b => b.onclick = () => { $('#dt').value = 'percent'; $('#dv').value = b.dataset.p; });
  $('#dcc').onclick = async () => { try { const r = await POST('/api/app/coupon-check', { code: $('#dc').value, subtotal: t.subtotal - t.itemDisc, customer_id: c.customer && c.customer.id, items: c.items }); POS.coupon = r; $('#dcm').innerHTML = `<span style="color:var(--ok)">✓ Valid — saves ${fmt.money(r.discount)}</span>`; } catch (e) { $('#dcm').innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; } };
}
function pickTable() {
  const B = POS.B; let floor = (B.floors[0] || {}).id;
  const m = modal({ title: 'Choose a table', size: 'wide', body: `<div class="chips mb" id="tf">${B.floors.map(f => `<button class="chip" data-f="${f.id}">${esc(f.name)}</button>`).join('')}</div><div class="floor" id="tg"></div>
    <div class="legend mt"><span><i style="background:#86efac"></i>Free</span><span><i style="background:#fca5a5"></i>Occupied</span><span><i style="background:#93c5fd"></i>Reserved</span><span><i style="background:#fcd34d"></i>Cleaning</span></div>` });
  const draw = () => {
    $$('#tf .chip', m.el).forEach(b => b.classList.toggle('on', +b.dataset.f === floor));
    const list = B.tables.filter(t => !B.floors.length || t.floor_id === floor || (!t.floor_id && floor === B.floors[0].id));
    $('#tg', m.el).innerHTML = list.map(t => { const st = t.open_orders ? 'occupied' : (t.status === 'occupied' ? 'available' : t.status); return `<div class="tbl-tile ${st}" data-t="${t.id}"><div class="tn">${esc(t.name)}</div><div class="ts">${t.seats} seats · ${fmt.label(st)}${t.open_orders ? ` (${t.open_orders})` : ''}</div></div>`; }).join('') || '<div class="empty">No tables on this floor. Add them in Tables → Setup.</div>';
    $$('[data-t]', m.el).forEach(x => x.onclick = async () => {
      const t = B.tables.find(y => y.id === +x.dataset.t); m.close();
      if (t.open_orders && !POS.cart.orderId) {
        const ords = (POS.running || []).filter(o => o.table_name === t.name && ['open', 'held'].includes(o.status));
        if (ords.length) {
          const mm = modal({ title: `Table ${t.name} has an open bill`, body: ords.map(o => `<button class="opt mb" style="width:100%" data-o="${o.id}">Add to order #${o.order_no} — ${fmt.money(o.total)} <small>${o.items} items · since ${fmt.time(o.created_at)}</small></button>`).join('') + `<button class="opt" style="width:100%" data-o="new">Start a separate new bill on this table</button>` });
          $$('[data-o]', mm.el).forEach(b => b.onclick = async () => { mm.close(); if (b.dataset.o !== 'new') { await loadOrder(+b.dataset.o); drawCart(); } else { POS.cart.table_id = t.id; POS.cart.table_name = t.name; POS.cart.type = 'dine_in'; drawCart(); } });
          return;
        }
      }
      POS.cart.table_id = t.id; POS.cart.table_name = t.name; POS.cart.type = 'dine_in'; if (t.waiter_id && !POS.cart.waiter_id) POS.cart.waiter_id = t.waiter_id; drawCart();
    });
  };
  $$('#tf .chip', m.el).forEach(b => b.onclick = () => { floor = +b.dataset.f; draw(); });
  draw();
}
function pickCustomer() {
  const c = POS.cart;
  const m = modal({ title: 'Customer', body: `<input type="search" id="cs" placeholder="Search by phone or name…"><div id="cr" class="mt"></div><hr>
      <h4>New customer</h4><div class="fgrid"><label class="f"><span>Phone</span><input id="nphone" type="tel"></label><label class="f"><span>Name</span><input id="nname"></label><label class="f full"><span>Address</span><input id="naddr"></label></div>`,
    actions: [...(c.customer ? [{ label: 'Remove customer', onClick: () => { c.customer = null; c.redeem_points = 0; drawCart(); } }] : []), { label: 'Cancel' }, { label: 'Save new customer', cls: 'primary', onClick: async () => {
      const phone = $('#nphone').value.trim(), name = $('#nname').value.trim(); if (!phone && !name) { toast('Enter phone or name', 'err'); return false; }
      const r = await POST('/api/r/customers', { name: name || 'Customer', phone, address: $('#naddr').value }); c.customer = r; if (c.type === 'delivery' && r.address) c.address = r.address; drawCart();
    } }] });
  const search = debounce(async () => {
    const q = $('#cs', m.el).value.trim(); if (!q) { $('#cr', m.el).innerHTML = ''; return; }
    const rows = await GET('/api/app/customers/search?q=' + encodeURIComponent(q));
    if (/^\d{5,}$/.test(q)) $('#nphone', m.el).value = q;
    $('#cr', m.el).innerHTML = rows.map(r => `<button class="opt mb" style="width:100%" data-c="${r.id}">${esc(r.name)} · ${esc(r.phone || '')} ${r.blocked ? '<span class="badge bad">restricted</span>' : ''}<small>${r.visits} visits · ${fmt.num(r.points, 0)} pts${n2(r.due) ? ' · due ' + fmt.money(r.due) : ''}${r.preferences ? ' · ' + esc(r.preferences) : ''}</small></button>`).join('') || '<div class="muted small">No match — add as new customer below.</div>';
    $$('[data-c]', m.el).forEach(b => b.onclick = () => { const r = rows.find(x => x.id === +b.dataset.c); if (r.blocked) return toast('This customer is restricted', 'err'); c.customer = r; if (c.type === 'delivery' && r.address && !c.address) c.address = r.address; m.close(); drawCart(); });
  }, 250);
  $('#cs', m.el).oninput = search;
}
function deliveryModal() {
  const c = POS.cart;
  modal({ title: 'Delivery details', body: `<label class="f"><span>Delivery address</span><textarea id="da">${esc(c.address || (c.customer && c.customer.address) || '')}</textarea></label>
    <div class="fgrid"><label class="f"><span>Zone</span><select id="dz"><option value="">— Select zone —</option>${POS.B.zones.map(z => `<option value="${z.id}" ${c.zone_id === z.id ? 'selected' : ''}>${esc(z.name)} (${fmt.money(z.charge)})</option>`).join('')}</select></label>
    <label class="f"><span>Delivery charge (override)</span><input type="number" id="dc2" value="${c.delivery_charge ?? ''}" placeholder="auto from zone"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => { c.address = $('#da').value.trim(); c.zone_id = +$('#dz').value || null; c.delivery_charge = $('#dc2').value === '' ? null : n2($('#dc2').value); drawCart(); } }] });
}
function moreMenu() {
  const c = POS.cart, B = POS.B;
  const m = modal({ title: 'Order options', size: 'wide', body: `<div class="fgrid">
      <label class="f"><span>Order source</span><select id="os"><option value="">Walk-in / POS</option>${(B.settings.order_sources || []).map(s => `<option ${c.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="f"><span>Waiter</span><select id="ow"><option value="">—</option>${B.waiters.map(w => `<option value="${w.id}" ${c.waiter_id === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Guests</span><input type="number" id="og" value="${c.guests || ''}"></label><label class="check" style="margin-top:28px"><input type="checkbox" id="op" ${c.priority ? 'checked' : ''}> ⚡ Priority order (kitchen sees it first)</label>
      <label class="f full"><span>Order note (shown to kitchen)</span><input id="ono" value="${esc(c.note || '')}"></label>
      <label class="f full"><span>Custom / open item (not on the menu)</span><div class="row"><input id="cin" placeholder="Item name" style="flex:2"><input id="cip" type="number" placeholder="Price" style="flex:1"><button type="button" class="btn" id="cia">Add</button></div></label></div>
    <hr><div class="row">${c.orderId ? `<button class="btn" data-a="kot">🖨 Print KOT</button><button class="btn" data-a="bill">🖨 Print bill</button><button class="btn" data-a="split">✂ Split bill</button><button class="btn" data-a="transfer">⇄ Move table</button>` : ''}
      <button class="btn" data-a="merge">⊕ Merge bills</button>${c.orderId ? '<button class="btn danger" data-a="void">✕ Cancel / void order</button>' : ''}<a class="btn" href="/display" target="_blank">👀 Customer display</a></div>`,
    actions: [{ label: 'Done', cls: 'primary', onClick: () => { c.source = $('#os').value; c.waiter_id = +$('#ow').value || null; c.guests = +$('#og').value || null; c.note = $('#ono').value; c.priority = $('#op').checked; drawCart(); } }] });
  $('#cia', m.el).onclick = () => { const n = $('#cin').value.trim(), p = n2($('#cip').value); if (!n) return toast('Enter item name', 'err'); pushLine({ product_id: null, name: n, variant: null, addons: [], qty: 1, unit_price: p, note: '' }); $('#cin').value = ''; $('#cip').value = ''; toast('Added', 'ok'); };
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    try {
      if (a === 'kot' || a === 'bill') { const o = await GET('/api/app/orders/' + c.orderId); a === 'kot' ? printKOT(o, o.items.filter(i => i.kstatus !== 'cancelled')) : printReceipt(o, true); }
      if (a === 'split') { m.close(); splitModal(c.orderId); }
      if (a === 'transfer') { m.close(); transferModal(c.orderId); }
      if (a === 'merge') { m.close(); mergeModal(c.orderId); }
      if (a === 'void') { m.close(); if (await voidOrder(c.orderId)) { POS.cart = newCart(); drawCart(); refreshRunning(); } }
    } catch (e) { errToast(e); }
  });
}
async function loadOrder(id) {
  const o = await GET('/api/app/orders/' + id);
  if (!['open', 'held', 'pending'].includes(o.status)) { toast(`Order #${o.order_no} is ${o.status}`, 'err'); return showOrder(id); }
  POS.cart = Object.assign(newCart(o.type), { orderId: o.id, order_no: o.order_no, type: o.type, table_id: o.table_id, table_name: o.table_name, customer: o.customer || (o.customer_name ? { name: o.customer_name, phone: o.customer_phone } : null),
    items: o.items.filter(i => i.kstatus !== 'cancelled').map(i => ({ id: i.id, product_id: i.product_id, name: i.name, variant: i.variant, addons: i.addons || [], qty: n2(i.qty), unit_price: n2(i.unit_price), note: i.note, discount: n2(i.discount), kstatus: i.kstatus, tax_exempt: i.tax_exempt })),
    discount_type: o.discount_type, discount_value: n2(o.discount_value), coupon_code: o.coupon_code, redeem_points: n2(o.points_redeemed), zone_id: o.zone_id, delivery_charge: o.type === 'delivery' ? n2(o.delivery_charge) : null,
    address: o.address, vehicle_no: o.vehicle_no, guests: o.guests, waiter_id: o.waiter_id, source: ['pos', 'qr', 'online', 'kiosk'].includes(o.source) ? '' : o.source, note: o.note, paid: n2(o.paid), priority: o.priority });
  if (o.coupon_code) POS.coupon = { code: o.coupon_code, discount: Math.max(0, n2(o.discount) - (o.discount_type === 'percent' ? (n2(o.subtotal) - n2(o.item_discount)) * n2(o.discount_value) / 100 : n2(o.discount_value)) - n2(o.points_redeemed) * n2(POS.B.settings.point_value)) };
}
async function saveCart(action, payments) {
  const c = POS.cart;
  if (!c.items.filter(i => i.kstatus !== 'cancelled').length) { toast('Add items first', 'err'); return null; }
  if (c.type === 'dine_in' && !c.table_id && action !== 'pay') { pickTable(); return null; }
  if (c.type === 'delivery' && !c.address) { deliveryModal(); toast('Add the delivery address', 'err'); return null; }
  const hadDraft = c.items.filter(i => !i.kstatus || i.kstatus === 'draft');
  let payload = cartPayload(c, action, payments);
  if (!c.orderId) payload.client_uuid = c.client_uuid = c.client_uuid || uuid();
  try {
    const o = await withApproval(pin => (c.orderId ? PUT('/api/app/orders/' + c.orderId, Object.assign({}, payload, pin ? { approver_pin: pin } : {})) : POST('/api/app/orders', Object.assign({}, payload, pin ? { approver_pin: pin } : {}))));
    if (action === 'hold') { toast(`Order #${o.order_no} on hold`, 'ok'); POS.cart = newCart(c.type); POS.coupon = null; }
    else if (action === 'kitchen') {
      toast(`Order #${o.order_no} sent to kitchen 🔥`, 'ok');
      if (hadDraft.length && localStorage.getItem('bx_autokot') === '1') printKOT(o, o.items.filter(i => i.kstatus !== 'cancelled' && hadDraft.some(h => h.product_id === i.product_id)));
      POS.cart = newCart(c.type); POS.coupon = null;
    }
    drawCart(); refreshRunning(); if (action !== 'pay' && $('#prp')) $('#prp').classList.remove('open');
    return o;
  } catch (e) {
    if (e.offline && action === 'pay' && !c.orderId) return queueOffline(payload, c);
    if (e.message !== 'Cancelled') errToast(e);
    return null;
  }
}
function payModal() {
  const c = POS.cart;
  if (!c.items.filter(i => i.kstatus !== 'cancelled').length) return toast('Add items first', 'err');
  if (c.type === 'delivery' && !c.address) { deliveryModal(); return toast('Add the delivery address', 'err'); }
  const t = cartTotals(c); const due = Math.max(0, Math.round((t.total - n2(c.paid)) * 100) / 100);
  const methods = POS.B.settings.payment_methods || ['Cash'];
  let method = methods[0]; const pays = [];
  const m = modal({ title: 'Take payment', size: 'wide', body: `<div class="grid g2"><div>
      <div class="muted center">Amount to pay</div><div class="bigtotal" id="pdue">${fmt.money(due)}</div>
      <div class="paym" id="pm">${methods.map(x => `<button data-m="${esc(x)}">${esc(x === 'Due' ? 'Due (credit)' : x)}</button>`).join('')}</div>
      <label class="f mt"><span>Amount received</span><input type="number" step="any" id="pa" style="font-size:22px;font-weight:700;min-height:52px"></label>
      <div class="keys" id="pk"></div><label class="f mt"><span>Reference (card last 4 / TrxID)</span><input id="pr"></label>
      <button class="btn block" id="padd">+ Add this payment (split between methods)</button></div>
    <div><h4 class="mt0">Payments</h4><div id="pl" class="mb"></div><div class="card" style="background:var(--soft)"><div class="row between"><span>Paying now</span><b id="psum">0</b></div><div class="row between"><span>Remaining</span><b id="prem">0</b></div><div class="row between big"><span>Change to return</span><b id="pch" style="color:var(--ok)">0</b></div></div>
      <label class="check mt"><input type="checkbox" id="pprint" ${localStorage.getItem('bx_autoprint') !== '0' ? 'checked' : ''}> Print receipt</label></div></div>`,
    actions: [{ label: 'Cancel' }, { label: '✓ Complete payment', cls: 'success lg', onClick: async () => {
      const cur = n2($('#pa').value); const all = pays.slice(); if (cur > 0) all.push({ method, amount: cur, ref: $('#pr').value });
      const sum = all.reduce((s, p) => s + n2(p.amount), 0);
      if (sum <= 0) { toast('Enter the amount received', 'err'); return false; }
      if (sum < due - 0.009 && !(await confirmBox(`Only ${fmt.money(sum)} of ${fmt.money(due)} is being paid. Save as partial payment? The order stays open.`))) return false;
      if (all.some(p => p.method === 'Due') && !c.customer) { toast('Choose a customer for due/credit sales', 'err'); return false; }
      localStorage.setItem('bx_autoprint', $('#pprint').checked ? '1' : '0');
      const print = $('#pprint').checked;
      const o = await saveCart('pay', all);
      if (!o) return false;
      if (o.status === 'completed' || o.offline) {
        if (print) printReceipt(o);
        doneModal(o);
        POS.cart = newCart(c.type); POS.coupon = null; drawCart(); refreshRunning();
      } else { toast(`Partial payment saved. ${fmt.money(n2(o.total) - n2(o.paid))} still due.`, 'ok'); await loadOrder(o.id); drawCart(); }
    } }] });
  const draw = () => {
    $$('#pm button', m.el).forEach(b => b.classList.toggle('on', b.dataset.m === method));
    const cur = n2($('#pa').value); const sum = pays.reduce((s, p) => s + n2(p.amount), 0) + cur;
    $('#psum').textContent = fmt.money(sum); $('#prem').textContent = fmt.money(Math.max(0, due - sum));
    const cashPart = pays.filter(p => p.method === 'Cash').reduce((s, p) => s + n2(p.amount), 0) + (method === 'Cash' ? cur : 0);
    $('#pch').textContent = fmt.money(sum > due && cashPart > 0 ? Math.min(cashPart, sum - due) : 0);
    $('#pl').innerHTML = pays.map((p, i) => `<div class="row between" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>${esc(p.method)} ${p.ref ? '<span class="small muted">' + esc(p.ref) + '</span>' : ''}</span><span><b>${fmt.money(p.amount)}</b> <button class="btn sm ghost" data-rp="${i}">✕</button></span></div>`).join('') || '<div class="muted small">Single payment — or add several to split between cash, card, bKash…</div>';
    $$('[data-rp]', m.el).forEach(b => b.onclick = () => { pays.splice(+b.dataset.rp, 1); draw(); });
    const remaining = Math.max(0, due - pays.reduce((s, p) => s + n2(p.amount), 0));
    const keys = [['Exact', remaining], ...[100, 200, 500, 1000, 2000].filter(v => v >= remaining).slice(0, 3).map(v => [fmt.money(v), v]), ['+50', null, 50], ['+100', null, 100], ['Clear', 0]];
    $('#pk').innerHTML = keys.map(([l, v, add]) => `<button data-v="${v ?? ''}" data-add="${add || ''}">${esc(l)}</button>`).join('');
    $$('#pk button', m.el).forEach(b => b.onclick = () => { $('#pa').value = b.dataset.add ? n2($('#pa').value) + n2(b.dataset.add) : b.dataset.v; draw(); });
  };
  $$('#pm button', m.el).forEach(b => b.onclick = () => { method = b.dataset.m; if (method !== 'Cash' && !n2($('#pa').value)) $('#pa').value = Math.max(0, due - pays.reduce((s, p) => s + n2(p.amount), 0)); draw(); });
  $('#pa').oninput = draw;
  $('#padd').onclick = () => { const v = n2($('#pa').value); if (!(v > 0)) return toast('Enter amount', 'err'); pays.push({ method, amount: v, ref: $('#pr').value }); $('#pa').value = ''; $('#pr').value = ''; draw(); };
  $('#pa').value = due; draw();
  $('#pa').addEventListener('keydown', e => { if (e.key === 'Enter') $('.mf .success', m.el).click(); });
  setTimeout(() => { $('#pa').select(); }, 80);
}
function doneModal(o) {
  modal({ title: o.offline ? 'Saved offline' : `Order #${o.order_no} completed`, body: `<div class="center"><div style="font-size:52px">✅</div>
    ${n2(o.change_due) ? `<div class="muted">Change to return</div><div class="bigtotal" style="color:var(--ok)">${fmt.money(o.change_due)}</div>` : `<div class="bigtotal">${fmt.money(o.total)}</div>`}
    ${o.offline ? '<p class="small muted">No internet — this sale is stored on this device and will sync automatically.</p>' : ''}</div>`,
    actions: [...(o.offline ? [] : [{ label: '🖨 Print receipt', onClick: () => { printReceipt(o); return false; } }]), { label: 'New order', cls: 'primary' }] });
}

// ---------- receipts ----------
function receiptHTML(o, preBill) {
  const s = POS.B ? POS.B.settings : APP.me.tenant.settings; const R = POS.B ? POS.B.restaurant : { name: APP.me.tenant.name, phone: APP.me.tenant.phone, address: APP.me.tenant.address };
  const items = (o.items || []).filter(i => i.kstatus !== 'cancelled');
  const logo = s.logo_id ? `<div class="c"><img src="${location.origin}/f/${s.logo_id}" style="max-width:60px;max-height:60px"></div>` : '';
  return `${logo}<div class="c b big">${esc(R.name)}</div><div class="c">${esc(R.branch && R.branch !== 'Main Branch' ? R.branch + ' · ' : '')}${esc(R.address || '')}</div><div class="c">${esc(R.phone || '')}</div>
    ${s.receipt_header ? `<div class="c">${esc(s.receipt_header)}</div>` : ''}${s.bin ? `<div class="c">BIN: ${esc(s.bin)}</div>` : ''}<div class="hr"></div>
    <div class="c b">${preBill ? 'BILL (not paid)' : o.offline ? 'RECEIPT (offline)' : 'RECEIPT'}</div>
    <table><tr><td>Order #${esc(o.order_no || '—')}</td><td class="r">${fmt.dt(o.completed_at || o.created_at || new Date())}</td></tr>
    <tr><td>${esc(fmt.label(o.type))}${o.table_name ? ' · Table ' + esc(o.table_name) : ''}</td><td class="r">${esc(o.cashier_name || APP.me.user.name)}</td></tr>
    ${o.customer_name ? `<tr><td colspan="2">Customer: ${esc(o.customer_name)} ${esc(o.customer_phone || '')}</td></tr>` : ''}${o.address ? `<tr><td colspan="2">Address: ${esc(o.address)}</td></tr>` : ''}</table><div class="hr"></div>
    <table>${items.map(i => `<tr><td>${esc(i.name)}${i.variant ? ' (' + esc(i.variant) + ')' : ''}${(i.addons || []).length ? '<br><small>+ ' + i.addons.map(a => esc(a.name)).join(', ') + '</small>' : ''}<br><small>${fmt.num(i.qty, 3)} × ${fmt.money(i.unit_price)}</small></td><td class="r">${fmt.money(n2(i.total) || n2(i.unit_price) * n2(i.qty) - n2(i.discount))}</td></tr>`).join('')}</table><div class="hr"></div>
    <table><tr><td>Subtotal</td><td class="r">${fmt.money(o.subtotal)}</td></tr>
    ${n2(o.item_discount) + n2(o.discount) ? `<tr><td>Discount${o.coupon_code ? ' (' + esc(o.coupon_code) + ')' : ''}</td><td class="r">-${fmt.money(n2(o.item_discount) + n2(o.discount))}</td></tr>` : ''}
    ${n2(o.service_charge) ? `<tr><td>Service charge</td><td class="r">${fmt.money(o.service_charge)}</td></tr>` : ''}${n2(o.vat) ? `<tr><td>VAT ${s.vat_pct}%${s.vat_inclusive ? ' (incl.)' : ''}</td><td class="r">${fmt.money(o.vat)}</td></tr>` : ''}
    ${n2(o.delivery_charge) ? `<tr><td>Delivery</td><td class="r">${fmt.money(o.delivery_charge)}</td></tr>` : ''}
    <tr class="b big"><td>TOTAL</td><td class="r">${fmt.money(o.total)}</td></tr>
    ${(o.payments || []).map(p => `<tr><td>Paid · ${esc(p.method)}</td><td class="r">${fmt.money(p.amount)}</td></tr>`).join('')}
    ${n2(o.change_due) ? `<tr><td>Change</td><td class="r">${fmt.money(o.change_due)}</td></tr>` : ''}${!preBill && n2(o.total) - n2(o.paid) > 0.01 ? `<tr class="b"><td>Due</td><td class="r">${fmt.money(n2(o.total) - n2(o.paid))}</td></tr>` : ''}</table>
    <div class="hr"></div><div class="c">${esc(s.receipt_footer || '').replace(/\n/g, '<br>')}</div><div class="c" style="font-size:10px;margin-top:6px">Powered by ${esc(APP.me.brand.name)}</div>`;
}
function printReceipt(o, preBill) { const s = POS.B ? POS.B.settings : APP.me.tenant.settings; printHTML(receiptHTML(o, preBill), { width: n2(s.receipt_width) || 80, title: 'Receipt ' + o.order_no }); }
function printKOT(o, items) {
  printHTML(`<div class="c b big">KITCHEN ORDER</div><div class="c b" style="font-size:22px">#${esc(o.order_no)}</div><div class="c">${esc(fmt.label(o.type))}${o.table_name ? ' · TABLE ' + esc(o.table_name) : ''}</div>
    <div class="c">${fmt.dt(new Date())}${o.waiter_name ? ' · ' + esc(o.waiter_name) : ''}</div>${o.priority ? '<div class="c b">*** PRIORITY ***</div>' : ''}<div class="hr"></div>
    <table>${items.map(i => `<tr><td class="b big">${fmt.num(i.qty, 3)} ×</td><td class="big">${esc(i.name)}${i.variant ? ' (' + esc(i.variant) + ')' : ''}${(i.addons || []).length ? '<br><small>+ ' + i.addons.map(a => esc(a.name)).join(', ') + '</small>' : ''}${i.note ? '<br><b>» ' + esc(i.note) + '</b>' : ''}</td></tr>`).join('')}</table>
    ${o.note ? `<div class="hr"></div><b>Note: ${esc(o.note)}</b>` : ''}`, { width: 80, title: 'KOT' });
}

// ---------- offline queue ----------
function queueOffline(payload, c) {
  const q = JSON.parse(localStorage.getItem(OFFQ) || '[]'); q.push({ payload, at: Date.now() }); localStorage.setItem(OFFQ, JSON.stringify(q));
  const t = cartTotals(c);
  toast('No internet — sale saved on this device. It will sync automatically.', 'err');
  return { offline: true, status: 'completed', order_no: 'OFF-' + q.length, type: c.type, table_name: c.table_name, customer_name: c.customer && c.customer.name,
    items: c.items.map(i => ({ name: i.name, variant: i.variant, addons: i.addons, qty: i.qty, unit_price: i.unit_price, total: lineUnit(i) * n2(i.qty) - n2(i.discount) })),
    subtotal: t.subtotal, item_discount: t.itemDisc, discount: t.disc, service_charge: t.svc, vat: t.vat, delivery_charge: t.del, total: t.total,
    payments: payload.payments, paid: (payload.payments || []).reduce((s, p) => s + n2(p.amount), 0), change_due: Math.max(0, (payload.payments || []).reduce((s, p) => s + n2(p.amount), 0) - t.total), created_at: new Date().toISOString() };
}
let syncing = false;
async function syncOffline() {
  if (syncing) return; const q = JSON.parse(localStorage.getItem(OFFQ) || '[]'); if (!q.length) return;
  syncing = true; let done = 0;
  const left = [];
  for (const item of q) {
    try { await POST('/api/app/orders', item.payload); done++; }
    catch (e) { if (e.offline) { left.push(item); } else { left.push(Object.assign(item, { error: e.message })); } }
  }
  localStorage.setItem(OFFQ, JSON.stringify(left.filter(x => !x.error || Date.now() - x.at < 7 * 86400000)));
  syncing = false;
  if (done) toast(`${done} offline sale(s) synced ✓`, 'ok');
  if (left.some(x => x.error)) toast(`${left.filter(x => x.error).length} offline sale(s) could not sync: ${left.find(x => x.error).error}`, 'err');
}
window.addEventListener('online', syncOffline);

// ---------- running orders, split, merge, transfer, void ----------
async function runningOrders() {
  await refreshRunning(); const rows = POS.running || [];
  const m = modal({ title: 'Running orders', size: 'wide', body: table([{ key: 'order_no', label: '#', html: r => `<b>#${r.order_no}</b>${r.priority ? ' ⚡' : ''}` }, { key: 'status', label: 'Status', html: r => badge(r.status) }, { key: 'type', label: 'Type', html: r => esc(fmt.label(r.type)) + (r.table_name ? ' · <b>' + esc(r.table_name) + '</b>' : '') },
    { key: 'customer_name', label: 'Customer', fmt: v => v || '—' }, { key: 'items', label: 'Items', num: 1 }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }, { key: 'created_at', label: 'Since', fmt: fmt.ago }], rows, { onRow: 1, empty: 'No running orders' }) });
  bindRows(m.body, rows, async r => { m.close(); if (r.status === 'pending') return showOrder(r.id); await loadOrder(r.id); drawCart(); });
}
async function splitModal(orderId) {
  const o = await GET('/api/app/orders/' + orderId); const items = o.items.filter(i => i.kstatus !== 'cancelled');
  modal({ title: `Split bill #${o.order_no}`, body: `<p class="muted mt0">Choose items (and quantity) to move to a new separate bill.</p>${items.map(i => `<div class="row between mb"><label class="check" style="margin:0"><input type="checkbox" data-i="${i.id}"> ${esc(i.name)}${i.variant ? ' (' + esc(i.variant) + ')' : ''} — ${fmt.money(i.total)}</label><input type="number" data-q="${i.id}" value="${n2(i.qty)}" min="0" max="${n2(i.qty)}" step="any" style="width:80px"></div>`).join('')}`,
    actions: [{ label: 'Cancel' }, { label: 'Split into new bill', cls: 'primary', onClick: async ({ el }) => {
      const parts = $$('[data-i]:checked', el).map(x => ({ id: +x.dataset.i, qty: n2($(`[data-q="${x.dataset.i}"]`, el).value) }));
      if (!parts.length) { toast('Select items', 'err'); return false; }
      const r = await POST(`/api/app/orders/${orderId}/split`, { items: parts }); toast('Bill split ✓', 'ok');
      if (POS.B && $('#cart')) { await loadOrder(r.new_id); drawCart(); refreshRunning(); } else APP.route();
    } }] });
}
async function mergeModal(targetId) {
  const rows = (await GET('/api/app/orders?status=open,held&limit=300'));
  modal({ title: 'Merge bills', body: `<label class="f"><span>Keep this bill</span><select id="mt">${rows.map(r => `<option value="${r.id}" ${r.id === targetId ? 'selected' : ''}>#${r.order_no} ${r.table_name ? '· ' + esc(r.table_name) : ''} · ${fmt.money(r.total)}</option>`).join('')}</select></label>
    <p class="small muted">Move all items from these bills into it:</p>${rows.map(r => `<label class="check"><input type="checkbox" value="${r.id}"> #${r.order_no} ${r.table_name ? '· Table ' + esc(r.table_name) : ''} · ${fmt.money(r.total)}</label>`).join('') || '<div class="muted">No other open bills</div>'}`,
    actions: [{ label: 'Cancel' }, { label: 'Merge', cls: 'primary', onClick: async ({ el }) => {
      const t = +$('#mt', el).value; const src = $$('input[type=checkbox]:checked', el).map(x => +x.value).filter(x => x !== t);
      if (!src.length) { toast('Select bills to merge', 'err'); return false; }
      await POST('/api/app/orders/merge', { target_id: t, source_ids: src }); toast('Merged ✓', 'ok');
      if (POS.B && $('#cart')) { await loadOrder(t); drawCart(); refreshRunning(); } else APP.route();
    } }] });
}
async function transferModal(orderId) {
  const live = await GET('/api/app/tables/live');
  const m = modal({ title: 'Move order to another table', size: 'wide', body: `<div class="floor">${live.tables.map(t => `<div class="tbl-tile ${t.live_status}" data-t="${t.id}"><div class="tn">${esc(t.name)}</div><div class="ts">${fmt.label(t.live_status)}</div></div>`).join('')}</div>` });
  $$('[data-t]', m.el).forEach(x => x.onclick = async () => { await POST(`/api/app/orders/${orderId}/transfer`, { table_id: +x.dataset.t }); m.close(); toast('Moved ✓', 'ok'); if (POS.B && $('#cart')) { await loadOrder(orderId); drawCart(); } else APP.route(); });
}
async function voidOrder(id) {
  const reason = await askText('Cancel / void order', { label: 'Reason (required)', placeholder: 'e.g. customer left, wrong order' });
  if (!reason) return false;
  await withApproval(pin => POST(`/api/app/orders/${id}/void`, { reason, approver_pin: pin }));
  toast('Order cancelled', 'ok'); return true;
}
async function refundOrder(o) {
  const max = n2(o.total) - n2(o.refunded);
  const m = modal({ title: `Refund order #${o.order_no}`, body: `<div class="fgrid"><label class="f"><span>Amount (max ${fmt.money(max)})</span><input type="number" id="ra" value="${max}"></label>
    <label class="f"><span>Refund by</span><select id="rm">${(APP.me.tenant.settings.payment_methods || ['Cash']).filter(x => x !== 'Due').map(x => `<option>${esc(x)}</option>`).join('')}</select></label></div>
    <label class="f"><span>Reason</span><input id="rr" placeholder="e.g. food quality issue, returned item"></label><label class="check"><input type="checkbox" id="rs"> Put ingredients back into stock (item was not made / returned unused)</label>`,
    actions: [{ label: 'Cancel' }, { label: 'Refund', cls: 'danger', onClick: async ({ el }) => {
      const body = { amount: n2($('#ra', el).value), method: $('#rm', el).value, reason: $('#rr', el).value, restock: $('#rs', el).checked };
      if (!body.reason) { toast('Please write a reason', 'err'); return false; }
      await withApproval(pin => POST(`/api/app/orders/${o.id}/refund`, Object.assign({}, body, { approver_pin: pin }))); toast('Refunded', 'ok'); APP.route();
    } }] });
}

// ---------- order detail (used by Orders, Tables, Delivery, Customers) ----------
async function showOrder(id) {
  const o = await GET('/api/app/orders/' + id);
  const isOpen = ['open', 'held'].includes(o.status);
  const m = modal({ title: `Order #${o.order_no}`, size: 'wide', body: `<div class="row between mb"><div>${badge(o.status)} <span class="badge">${esc(fmt.label(o.type))}</span> <span class="badge">${esc(o.source)}</span> ${o.priority ? '<span class="badge warn">priority</span>' : ''}${o.delivery_status ? ' ' + badge(o.delivery_status) : ''}</div><div class="muted small">${fmt.dt(o.created_at)}${o.branch_name ? ' · ' + esc(o.branch_name) : ''}</div></div>
    <div class="grid g3 small mb"><div><b>Table:</b> ${esc(o.table_name || '—')}<br><b>Waiter:</b> ${esc(o.waiter_name || '—')}<br><b>Cashier:</b> ${esc(o.cashier_name || '—')}</div>
      <div><b>Customer:</b> ${esc(o.customer_name || '—')}<br>${esc(o.customer_phone || '')}${o.address ? '<br><b>Address:</b> ' + esc(o.address) : ''}</div>
      <div>${o.note ? '<b>Note:</b> ' + esc(o.note) + '<br>' : ''}${o.payment_note ? '<b>Payment:</b> ' + esc(o.payment_note) + '<br>' : ''}${o.rider_name ? '<b>Rider:</b> ' + esc(o.rider_name) + '<br>' : ''}${o.cancel_reason ? '<b>Reason:</b> ' + esc(o.cancel_reason) : ''}</div></div>
    ${table([{ key: 'name', label: 'Item', html: i => `${esc(i.name)}${i.variant ? ' <span class="muted">(' + esc(i.variant) + ')</span>' : ''}${(i.addons || []).length ? '<div class="small muted">+ ' + i.addons.map(a => esc(a.name)).join(', ') + '</div>' : ''}${i.note ? '<div class="small"><i>' + esc(i.note) + '</i></div>' : ''}` },
      { key: 'kstatus', label: 'Kitchen', html: i => badge(i.kstatus) }, { key: 'qty', label: 'Qty', num: 1, fmt: v => fmt.num(v, 3) }, { key: 'unit_price', label: 'Price', num: 1, fmt: fmt.money }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }], o.items)}
    <div class="grid g2 mt"><div>${o.payments.length ? '<h4>Payments</h4>' + o.payments.map(p => `<div class="row between small"><span>${esc(p.method)} ${p.ref ? '· ' + esc(p.ref) : ''} · ${fmt.time(p.created_at)}</span><b>${fmt.money(p.amount)}</b></div>`).join('') : ''}
      ${o.refunds.length ? '<h4 class="mt">Refunds</h4>' + o.refunds.map(p => `<div class="row between small"><span>${esc(p.method)} · ${esc(p.reason || '')}</span><b>-${fmt.money(p.amount)}</b></div>`).join('') : ''}</div>
      <div class="card" style="background:var(--soft)"><div class="row between"><span>Subtotal</span><span>${fmt.money(o.subtotal)}</span></div>${n2(o.item_discount) + n2(o.discount) ? `<div class="row between"><span>Discount</span><span>-${fmt.money(n2(o.item_discount) + n2(o.discount))}</span></div>` : ''}
        ${n2(o.service_charge) ? `<div class="row between"><span>Service</span><span>${fmt.money(o.service_charge)}</span></div>` : ''}${n2(o.vat) ? `<div class="row between"><span>VAT</span><span>${fmt.money(o.vat)}</span></div>` : ''}${n2(o.delivery_charge) ? `<div class="row between"><span>Delivery</span><span>${fmt.money(o.delivery_charge)}</span></div>` : ''}
        <div class="row between big bold"><span>Total</span><span>${fmt.money(o.total)}</span></div><div class="row between"><span>Paid</span><span>${fmt.money(o.paid)}</span></div>${n2(o.total) - n2(o.paid) > 0.01 && o.status !== 'cancelled' ? `<div class="row between bold" style="color:var(--bad)"><span>Due</span><span>${fmt.money(n2(o.total) - n2(o.paid))}</span></div>` : ''}</div></div>
    <div class="row mt" id="oa"></div>` });
  const A = [];
  if (o.status === 'pending' && can(['pos', 'orders'])) A.push(['✓ Accept', 'success', async () => { const r = await POST(`/api/app/orders/${o.id}/accept`); toast(r.merged_into ? 'Accepted and added to the table bill' : 'Accepted — sent to kitchen', 'ok'); }], ['✕ Reject', 'danger', async () => { const why = await askText('Reject order', { label: 'Reason', required: false }); if (why === null) return; await POST(`/api/app/orders/${o.id}/reject`, { reason: why }); }]);
  if (isOpen && can('pos')) A.push(['Open in POS', 'primary', () => APP.go('#/pos?order=' + o.id)], ['✂ Split', '', () => splitModal(o.id)], ['⊕ Merge', '', () => mergeModal(o.id)], ['⇄ Move table', '', () => transferModal(o.id)]);
  if (o.items.some(i => i.kstatus === 'ready')) A.push(['🍽 Mark served', '', async () => { await POST(`/api/app/orders/${o.id}/serve`); toast('Marked as served', 'ok'); }]);
  A.push(['🖨 Print', '', () => { POS.B ? printReceipt(o, o.status !== 'completed') : printHTML(receiptHTML(o, o.status !== 'completed'), { width: 80 }); }]);
  A.push(['🖨 KOT', '', () => printKOT(o, o.items.filter(i => i.kstatus !== 'cancelled'))]);
  if (['open', 'held', 'pending'].includes(o.status) && can(['pos', 'orders'])) A.push(['Void', 'danger', async () => { if (await voidOrder(o.id)) { } }]);
  if (o.status === 'completed' && can(['pos', 'orders']) && n2(o.refunded) < n2(o.total)) A.push(['↩ Refund', 'danger', () => refundOrder(o)]);
  if (o.track_token && ['online', 'qr', 'kiosk'].includes(o.source)) A.push(['🔗 Tracking link', '', () => { navigator.clipboard && navigator.clipboard.writeText(location.origin + '/track/' + o.track_token); toast('Tracking link copied', 'ok'); return 'keep'; }]);
  $('#oa', m.el).innerHTML = A.map((a, i) => `<button class="btn ${a[1]}" data-a="${i}">${a[0]}</button>`).join('');
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => { try { const r = await A[+b.dataset.a][2](); if (r !== 'keep') { m.close(); if (!location.hash.startsWith('#/pos')) APP.route(); } } catch (e) { if (e.message !== 'Cancelled') errToast(e); } });
  if (!POS.B) GET('/api/app/pos/bootstrap').then(b => { POS.B = POS.B || b; }).catch(() => { });
}
