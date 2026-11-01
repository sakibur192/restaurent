// Public QR / online menu, ordering, kiosk mode
const slug = location.pathname.split('/')[2];
const qs = new URLSearchParams(location.search);
const KIOSK = qs.get('kiosk') === '1';
const M = { d: null, cart: JSON.parse(sessionStorage.getItem('cart_' + slug) || '[]'), cat: null };
const save = () => sessionStorage.setItem('cart_' + slug, JSON.stringify(M.cart));
if (KIOSK) document.body.classList.add('kiosk');

const PREVIEW = qs.get('preview') === '1';
let THEME = null;
function setTheme(t) { THEME = resolveTheme(t); applyTheme(THEME); }
window.addEventListener('message', e => { if (e.origin !== location.origin || !e.data || e.data.type !== 'bx-theme') return; setTheme(e.data.theme); if (M.d) render(); });
async function load() {
  try { M.d = await GET(`/api/public/menu/${slug}?${qs.get('t') ? 't=' + encodeURIComponent(qs.get('t')) : ''}${qs.get('branch') ? '&branch=' + qs.get('branch') : ''}`); }
  catch (e) { $('#app').innerHTML = `<div class="empty"><h2>Menu not found</h2><p>${esc(e.message)}</p></div>`; return; }
  const d = M.d, R = d.restaurant; CUR = d.settings.currency || '৳';
  if (!I18N._did) { I18N._did = 1; I18N.init(R.lang); }
  let t = R.theme || {}; if (!t.primary && R.color && (!t.preset || t.preset === 'classic')) t = Object.assign({}, t, { primary: R.color });
  if (PREVIEW && location.hash.length > 1) { try { t = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (e) { } }
  if (!THEME) setTheme(t);
  document.title = R.name + ' — Menu';
  render();
  if (PREVIEW) try { parent.postMessage({ type: 'bx-preview-ready' }, location.origin); } catch (e) { }
}
function render() {
  const d = M.d, R = d.restaurant, T = THEME;
  const cats = d.categories.filter(c => d.products.some(p => p.category_id === c.id));
  const uncategorised = d.products.filter(p => !cats.some(c => c.id === p.category_id));
  if (uncategorised.length) cats.push({ id: 0, name: 'More' });
  const cover = T.cover_id ? `style="background-image:url('/f/${T.cover_id}')"` : '';
  const lang = window.I18N ? I18N.lang : 'en';
  $('#app').innerHTML = `<div class="hd ${T.cover_id ? 'cover' : ''}" ${cover}>${window.I18N ? `<div class="lsw" data-notr><button data-lg="bn" class="${lang === 'bn' ? 'on' : ''}">বাংলা</button><button data-lg="en" class="${lang === 'en' ? 'on' : ''}">EN</button></div>` : ''}
      <div class="row" style="padding-right:90px"><div class="lg">${R.logo_id ? `<img src="/f/${R.logo_id}" alt="">` : esc(initials(R.name))}</div><div style="min-width:0"><h1 data-notr>${esc(R.name)}</h1><div class="s" data-notr>${[R.address, R.phone].filter(Boolean).map(esc).join(' · ')}</div></div></div>
      ${d.table ? `<div class="pill">🍽 You are at table <span data-notr>${esc(d.table.name)}</span></div>` : ''}${KIOSK ? '<div class="pill">Touch to order · Pay at the counter</div>' : ''}
      ${!d.table && !KIOSK && d.branches.length > 1 ? `<select id="brs" style="margin-top:12px;max-width:280px" data-notr>${d.branches.map(b => `<option value="${b.id}" ${b.id === d.branch_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}</div>
    ${R.banner ? `<div class="ban" data-notr>🎉 ${esc(R.banner)}</div>` : ''}${!d.ordering ? '<div class="ban" style="background:#fee2e2;color:#7f1d1d">Online ordering is closed right now — you can still browse the menu.</div>' : ''}
    <div class="cbar">${cats.map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-c="${c.id}" ${c.id ? 'data-notr' : ''}>${esc(c.name)}</button>`).join('')}</div>
    ${cats.map(c => { const items = c.id === 0 ? uncategorised : d.products.filter(p => p.category_id === c.id);
      return `<div class="sec" id="cat-${c.id}"><h2 ${c.id ? 'data-notr' : ''}>${esc(c.name)}</h2><div class="items">${items.map(p => { const sale = n2(p.regular_price) > n2(p.price) && !(p.variants || []).length;
        return `<div class="item" data-p="${p.id}">${sale && T.show_images && T.layout !== 'compact' && T.layout !== 'list' ? `<span class="tag">−${Math.round((1 - n2(p.price) / n2(p.regular_price)) * 100)}%</span>` : ''}<div class="im">${p.image_id ? `<img src="/f/${p.image_id}" loading="lazy" alt="">` : esc(initials(p.name))}</div>
        <div class="bd"><div class="nm" data-notr>${esc(p.name)}</div>${p.description ? `<div class="ds" data-notr>${esc(p.description)}</div>` : ''}
        <div class="ft"><span class="pr">${p.variants && p.variants.length ? 'from ' + fmt.money(Math.min(...p.variants.map(v => n2(v.price)))) : fmt.money(p.price)}${p.by_weight ? '/kg' : ''}${sale ? `<span class="strike">${fmt.money(p.regular_price)}</span>` : ''}</span>${d.ordering ? '<button class="btn sm add">+ Add</button>' : ''}</div></div></div>`; }).join('')}</div></div>`; }).join('')}
    <div class="center mt foot"><button class="btn ghost" id="fbk">💬 Send feedback</button>${!KIOSK ? ' <button class="btn ghost" id="myo">🧾 My orders</button>' : ''}</div>
    <div class="center small mt mb foot">Powered by <span data-notr>Baybex</span></div>
    <button class="fab" id="fab" style="display:none"></button>`;
  $$('.cbar .chip').forEach(b => b.onclick = () => { $$('.cbar .chip').forEach(x => x.classList.toggle('on', x === b)); b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); const s = $('#cat-' + b.dataset.c); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - 58, behavior: 'smooth' }); });
  if (d.ordering) $$('.item').forEach(x => x.onclick = () => addModal(d.products.find(p => p.id === +x.dataset.p)));
  if ($('#brs')) $('#brs').onchange = e => { location.search = '?branch=' + e.target.value; };
  $$('[data-lg]').forEach(b => b.onclick = () => { I18N.set(b.dataset.lg); render(); });
  $('#fab').onclick = cartSheet; $('#fbk').onclick = feedback; if ($('#myo')) $('#myo').onclick = myOrders;
  drawFab();
}
function unitPrice(l) { const p = M.d.products.find(x => x.id === l.product_id); if (!p) return 0; const v = (p.variants || []).find(x => x.name === l.variant); return (v ? n2(v.price) : n2(p.price)) + (p.addons || []).filter(a => (l.addons || []).includes(a.name)).reduce((s, a) => s + n2(a.price), 0); }
function drawFab() {
  M.cart = M.cart.filter(l => M.d.products.some(p => p.id === l.product_id)); save();
  const n = M.cart.reduce((s, l) => s + n2(l.qty), 0), t = M.cart.reduce((s, l) => s + unitPrice(l) * n2(l.qty), 0);
  const f = $('#fab'); f.style.display = n ? '' : 'none'; f.innerHTML = `<span>🛒 ${fmt.num(n, 2)} item${n === 1 ? '' : 's'}</span><span>View cart · ${fmt.money(t)}</span>`;
}
function addModal(p) {
  let variant = (p.variants || [])[0] ? p.variants[0].name : null; const addons = new Set(); let qty = p.by_weight ? 0.5 : 1;
  const m = modal({ title: p.name, body: `${p.image_id ? `<img src="/f/${p.image_id}" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-bottom:10px">` : ''}<p class="muted mt0">${esc(p.description || '')}</p>
    ${(p.variants || []).length ? `<h4>Choose one</h4><div class="opt-list">${p.variants.map(v => `<button class="opt" data-v="${esc(v.name)}">${esc(v.name)}<small>${fmt.money(v.price)}</small></button>`).join('')}</div>` : ''}
    ${(p.addons || []).length ? `<h4 class="mt">Extras</h4><div class="opt-list">${p.addons.map(a => `<button class="opt" data-a="${esc(a.name)}">${esc(a.name)}<small>+${fmt.money(a.price)}</small></button>`).join('')}</div>` : ''}
    <label class="f mt"><span>Special request</span><input id="nt" placeholder="e.g. less spicy, no onion"></label>
    <div class="row between mt"><div class="qty"><button id="qm">−</button><span id="qv"></span><button id="qp">+</button></div><b class="big" id="lt"></b></div>`,
    actions: [{ label: 'Add to cart', cls: 'primary lg block', onClick: () => {
      M.cart.push({ product_id: p.id, variant, addons: [...addons], qty, note: $('#nt').value.trim() }); save(); drawFab(); toast('Added to cart ✓', 'ok');
    } }] });
  const step = p.by_weight ? 0.25 : 1;
  const draw = () => { $$('[data-v]', m.el).forEach(b => b.classList.toggle('on', b.dataset.v === variant)); $$('[data-a]', m.el).forEach(b => b.classList.toggle('on', addons.has(b.dataset.a)));
    $('#qv').textContent = p.by_weight ? qty + ' kg' : qty; $('#lt').textContent = fmt.money(unitPrice({ product_id: p.id, variant, addons: [...addons] }) * qty); };
  $$('[data-v]', m.el).forEach(b => b.onclick = () => { variant = b.dataset.v; draw(); });
  $$('[data-a]', m.el).forEach(b => b.onclick = () => { addons.has(b.dataset.a) ? addons.delete(b.dataset.a) : addons.add(b.dataset.a); draw(); });
  $('#qm').onclick = () => { qty = Math.max(step, qty - step); draw(); }; $('#qp').onclick = () => { qty += step; draw(); };
  draw();
}
function estimate(type, zoneId) {
  const s = M.d.settings; const sub = M.cart.reduce((a, l) => a + unitPrice(l) * n2(l.qty), 0);
  const svc = (!s.service_dine_in_only || type === 'dine_in') ? sub * n2(s.service_pct) / 100 : 0;
  const vat = s.vat_inclusive ? 0 : (sub + svc) * n2(s.vat_pct) / 100;
  const del = type === 'delivery' ? n2((M.d.zones.find(z => z.id === zoneId) || {}).charge) : 0;
  let total = sub + svc + vat + del; if (s.round_total) total = Math.round(total);
  return { sub, svc, vat, del, total };
}
function cartSheet() {
  const d = M.d; const dine = !!d.table;
  let type = dine ? 'dine_in' : 'takeaway', zone = d.zones[0] ? d.zones[0].id : null;
  const saved = JSON.parse(localStorage.getItem('bx_guest') || '{}');
  const m = modal({ title: 'Your order', size: 'wide', body: `<div id="cl"></div>
    ${!dine && !KIOSK ? `<div class="chips mt mb" id="ty"><button class="chip" data-t="takeaway">🥡 Pickup</button>${d.zones.length ? '<button class="chip" data-t="delivery">🛵 Delivery</button>' : ''}</div>` : ''}
    <div class="fgrid">${KIOSK ? '<label class="f full"><span>Your name (optional, we call it out)</span><input id="cn"></label>' : `<label class="f"><span>Your name ${dine ? '(optional)' : '*'}</span><input id="cn" value="${esc(saved.name || '')}"></label><label class="f"><span>Mobile ${dine ? '(optional)' : '*'}</span><input id="cp" type="tel" value="${esc(saved.phone || '')}"></label>`}
      <div class="full" id="delbox" style="display:none"><div class="fgrid"><label class="f"><span>Area / zone</span><select id="cz">${d.zones.map(z => `<option value="${z.id}">${esc(z.name)} — ${fmt.money(z.charge)}</option>`).join('')}</select></label><label class="f"><span>Full address *</span><input id="ca" value="${esc(saved.address || '')}"></label></div></div>
      ${!dine && !KIOSK ? `<label class="f"><span>Order for later (optional)</span><input type="datetime-local" id="cs"></label>` : ''}
      ${!dine && !KIOSK ? `<label class="f"><span>Payment</span><select id="cpm"><option value="Cash">Cash on delivery / pickup</option>${(d.settings.payment_methods || []).filter(x => !['Cash', 'Card', 'Due'].includes(x)).map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label class="f" id="trxb" style="display:none"><span>Transaction ID</span><input id="ctrx"></label>` : ''}
      <label class="f ${KIOSK ? 'full' : ''}"><span>Coupon code</span><input id="cc" style="text-transform:uppercase"></label><label class="f full"><span>Note for the kitchen</span><input id="cnote"></label></div>
    ${!dine && !KIOSK && d.settings.online_payment_note ? `<p class="small muted">${esc(d.settings.online_payment_note)}</p>` : ''}<div class="card" style="background:var(--soft)" id="ct"></div>`,
    actions: [{ label: 'Add more' }, { label: 'Place order', cls: 'primary lg', onClick: async () => {
      if (!M.cart.length) { toast('Your cart is empty', 'err'); return false; }
      const body = { table_token: qs.get('t') || undefined, kiosk: KIOSK || undefined, branch_id: d.branch_id, type, items: M.cart, customer_name: $('#cn') ? $('#cn').value.trim() : '', customer_phone: $('#cp') ? $('#cp').value.trim() : '',
        address: type === 'delivery' ? $('#ca').value.trim() : undefined, zone_id: type === 'delivery' ? +$('#cz').value : undefined, coupon_code: $('#cc').value.trim() || undefined, note: $('#cnote').value.trim(),
        scheduled_at: $('#cs') && $('#cs').value ? new Date($('#cs').value).toISOString() : undefined, payment_method: $('#cpm') ? $('#cpm').value : undefined, trx_id: $('#ctrx') ? $('#ctrx').value.trim() : undefined };
      if (!KIOSK) localStorage.setItem('bx_guest', JSON.stringify({ name: body.customer_name, phone: body.customer_phone, address: body.address || saved.address }));
      const r = await POST(`/api/public/order/${slug}`, body);
      M.cart = []; save(); drawFab();
      const hist = JSON.parse(localStorage.getItem('bx_orders_' + slug) || '[]'); hist.unshift({ no: r.order_no, track: r.track, total: r.total, at: Date.now() }); localStorage.setItem('bx_orders_' + slug, JSON.stringify(hist.slice(0, 20)));
      if (KIOSK) { const k = modal({ title: 'Thank you!', noClose: true, body: `<div class="center"><div class="muted">Your order number</div><div style="font-size:72px;font-weight:900;color:var(--brand)">${r.order_no}</div><p class="big">Please pay <b>${fmt.money(r.total)}</b> at the counter.</p></div>` }); setTimeout(() => { k.close(); window.scrollTo(0, 0); }, 9000); }
      else location.href = '/track/' + r.track;
    } }] });
  const draw = () => {
    $('#cl', m.el).innerHTML = M.cart.map((l, i) => { const p = d.products.find(x => x.id === l.product_id); return `<div class="row between" style="padding:9px 0;border-bottom:1px dashed var(--line)"><div style="flex:1"><b>${esc(p.name)}</b>${l.variant ? ' (' + esc(l.variant) + ')' : ''}<div class="small muted">${(l.addons || []).map(esc).join(', ')}${l.note ? ' · ' + esc(l.note) : ''}</div></div>
      <div class="qty"><button data-m="${i}">−</button><span>${l.qty}</span><button data-p="${i}">+</button></div><b style="width:80px;text-align:right">${fmt.money(unitPrice(l) * n2(l.qty))}</b></div>`; }).join('') || '<div class="empty">Cart is empty</div>';
    const e = estimate(type, zone);
    $('#ct', m.el).innerHTML = `<div class="row between"><span>Subtotal</span><span>${fmt.money(e.sub)}</span></div>${e.svc ? `<div class="row between"><span>Service</span><span>${fmt.money(e.svc)}</span></div>` : ''}${e.vat ? `<div class="row between"><span>VAT</span><span>${fmt.money(e.vat)}</span></div>` : ''}${e.del ? `<div class="row between"><span>Delivery</span><span>${fmt.money(e.del)}</span></div>` : ''}<div class="row between big bold"><span>Estimated total</span><span>${fmt.money(e.total)}</span></div>${n2(d.settings.min_order) && !dine && !KIOSK ? `<div class="small muted">Minimum order ${fmt.money(d.settings.min_order)}</div>` : ''}`;
    $$('[data-m]', m.el).forEach(b => b.onclick = () => { const l = M.cart[+b.dataset.m]; l.qty = n2(l.qty) - 1; if (l.qty <= 0) M.cart.splice(+b.dataset.m, 1); save(); drawFab(); draw(); });
    $$('[data-p]', m.el).forEach(b => b.onclick = () => { M.cart[+b.dataset.p].qty = n2(M.cart[+b.dataset.p].qty) + 1; save(); drawFab(); draw(); });
    $$('#ty .chip', m.el).forEach(b => b.classList.toggle('on', b.dataset.t === type)); if ($('#delbox', m.el)) $('#delbox', m.el).style.display = type === 'delivery' ? '' : 'none';
  };
  $$('#ty .chip', m.el).forEach(b => b.onclick = () => { type = b.dataset.t; draw(); });
  if ($('#cz', m.el)) $('#cz', m.el).onchange = e => { zone = +e.target.value; draw(); };
  if ($('#cpm', m.el)) $('#cpm', m.el).onchange = e => { $('#trxb').style.display = e.target.value === 'Cash' ? 'none' : ''; };
  draw();
}
function feedback() {
  let rating = 5;
  const m = modal({ title: 'Tell us how we did', body: `<div class="row" id="stars" style="font-size:30px;cursor:pointer">${[1, 2, 3, 4, 5].map(i => `<span data-r="${i}">⭐</span>`).join('')}</div>
    <div class="chips mt"><button class="chip on" data-ty="feedback">Feedback</button><button class="chip" data-ty="complaint">Complaint</button></div>
    <div class="fgrid mt"><label class="f"><span>Name</span><input id="fn"></label><label class="f"><span>Phone</span><input id="fp"></label></div><label class="f"><span>Message</span><textarea id="fm"></textarea></label>`,
    actions: [{ label: 'Send', cls: 'primary', onClick: async () => { await POST(`/api/public/feedback/${slug}`, { rating, type: $('.chip.on[data-ty]', m.el).dataset.ty, name: $('#fn').value, phone: $('#fp').value, message: $('#fm').value }); toast('Thank you for your feedback! 🙏', 'ok'); } }] });
  const draw = () => $$('[data-r]', m.el).forEach(s => { s.style.opacity = +s.dataset.r <= rating ? 1 : .25; });
  $$('[data-r]', m.el).forEach(s => s.onclick = () => { rating = +s.dataset.r; draw(); });
  $$('[data-ty]', m.el).forEach(b => b.onclick = () => $$('[data-ty]', m.el).forEach(x => x.classList.toggle('on', x === b)));
  draw();
}
function myOrders() {
  const h = JSON.parse(localStorage.getItem('bx_orders_' + slug) || '[]');
  modal({ title: 'My orders on this phone', body: h.map(o => `<a class="opt mb" style="display:block" href="/track/${esc(o.track)}">Order #${esc(o.no)} — ${fmt.money(o.total)}<small>${new Date(o.at).toLocaleString()}</small></a>`).join('') || '<div class="empty">No orders yet</div>' });
}
load();
