// Management: menu, inventory, recipes, purchases & suppliers, customers, offers, staff & payroll, accounting, reports

// ================= menu =================
const MENU_TABS = [{ k: 'products', l: 'Products' }, { k: 'categories', l: 'Categories' }, { k: 'stations', l: 'Kitchen stations' }];
APP.pages.menu = async (el, params) => {
  const tab = pickTab(MENU_TABS, params);
  el.innerHTML = tabsHTML('menu', MENU_TABS, tab) + '<div id="mb"></div>'; const box = $('#mb');
  if (tab === 'categories') return crudPage(box, 'categories', { addLabel: 'Add category', note: 'Each category can send its items to a kitchen station (grill, drinks…).' });
  if (tab === 'stations') return crudPage(box, 'stations', { addLabel: 'Add station', importable: false, note: 'Stations are separate kitchen screens. Open Kitchen display and choose a station on each screen.' });
  await refList('categories', true);
  const cats = APP.refs.categories;
  return crudPage(box, 'products', {
    addLabel: 'Add product', filtersHTML: `<select id="pcat" data-filter style="width:auto"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`,
    params: () => ($('#pcat') && $('#pcat').value ? 'category_id=' + $('#pcat').value : ''),
    cols: [{ key: 'image_id', label: '', html: r => r.image_id ? `<img class="thumb" src="/f/${r.image_id}">` : `<span class="thumb" style="display:inline-grid;place-items:center;font-weight:700;color:var(--brand)">${esc(initials(r.name))}</span>` },
      { key: 'name', label: 'Product', html: r => `<b>${esc(r.name)}</b>${(r.variants || []).length ? `<div class="small muted">${r.variants.map(v => esc(v.name) + ' ' + fmt.money(v.price)).join(' · ')}</div>` : ''}${r.happy_price ? '<span class="badge warn">happy hour</span> ' : ''}${r.avail_from ? `<span class="badge info">${esc(r.avail_from)}–${esc(r.avail_to)}</span> ` : ''}${(r.branch_ids || []).length ? '<span class="badge">branch only</span>' : ''}` },
      { key: 'category_id', label: 'Category', fmt: v => refName('categories', v) }, { key: 'price', label: 'Price', num: 1, fmt: fmt.money },
      { key: 'available', label: 'Available', html: r => `<button class="btn sm ${r.available ? 'success' : ''}" data-av="${r.id}" data-v="${r.available ? 0 : 1}">${r.available ? 'Yes' : 'No'}</button>` }, { key: 'active', label: 'Active', html: r => r.active ? '✓' : '—' }],
    afterLoad: rows => $$('[data-av]', box).forEach(b => b.onclick = async e => { e.stopPropagation(); await PUT('/api/r/products/' + b.dataset.av, { available: b.dataset.v === '1' }); const r = rows.find(x => x.id === +b.dataset.av); r.available = b.dataset.v === '1'; b.className = 'btn sm ' + (r.available ? 'success' : ''); b.textContent = r.available ? 'Yes' : 'No'; b.dataset.v = r.available ? '0' : '1'; }),
    rowActions: r => can('recipes') ? [{ label: '🧪 Recipe', onClick: () => { APP.go('#/recipes?product=' + r.id); } }] : []
  });
};

// ================= inventory =================
const INV_TABS = [{ k: 'stock', l: 'Stock' }, { k: 'ingredients', l: 'Ingredients' }, { k: 'moves', l: 'Stock history' }, { k: 'count', l: 'Physical count' }, { k: 'transfer', l: 'Branch transfer' }, { k: 'expiry', l: 'Expiry' }, { k: 'variance', l: 'Expected vs actual' }];
APP.pages.inventory = async (el, params) => {
  const tab = pickTab(INV_TABS, params);
  el.innerHTML = tabsHTML('inventory', INV_TABS, tab) + '<div id="ib"></div>'; const box = $('#ib');
  if (tab === 'ingredients') return crudPage(box, 'ingredients', { addLabel: 'Add ingredient', note: 'Set the stock unit (e.g. g) and, under More options, a purchase unit (e.g. kg) with conversion (1000) so you can buy in kg and use in grams.',
    rowActions: r => [{ label: '📈 Price history', onClick: async () => { const h = await GET(`/api/app/ingredients/${r.id}/price-history`); modal({ title: 'Supplier price history — ' + r.name, body: table([{ key: 'date', label: 'Date', fmt: fmt.date }, { key: 'supplier', label: 'Supplier' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'qty', label: 'Qty', num: 1, fmt: v => fmt.num(v) }, { key: 'unit_cost', label: 'Cost / ' + r.unit, num: 1, fmt: v => fmt.money(v) }], h, { empty: 'No purchases yet' }) }); return false; } }] });
  const all = params.branch === 'all';
  if (tab === 'stock') {
    const d = await GET('/api/app/stock' + (all ? '?branch=all' : ''));
    el.querySelector('#ib').innerHTML = `<div class="page-h"><div class="row"><input type="search" id="sq" placeholder="Search ingredient…" style="max-width:240px"><label class="check" style="margin:0"><input type="checkbox" id="slow"> Low stock only</label>
      ${!APP.me.branch_locked && APP.me.branches.length > 1 ? `<a class="btn sm" href="#/inventory?tab=stock${all ? '' : '&branch=all'}">${all ? 'This branch' : 'All branches (central view)'}</a>` : ''}</div>
      <div class="row"><button class="btn" data-mv="in">+ Stock in</button><button class="btn" data-mv="waste">🗑 Wastage</button><button class="btn" data-mv="adjust">± Adjust</button>${can('purchases') ? '<a class="btn primary" href="#/purchases?tab=new">+ New purchase</a>' : ''}</div></div>
      ${!all ? `<div class="grid g3 mb"><div class="card kpi"><div class="l">Stock value</div><div class="v">${fmt.money(d.total_value)}</div></div><div class="card kpi"><div class="l">Items</div><div class="v">${d.items.length}</div></div><div class="card kpi"><div class="l">Low stock</div><div class="v" style="color:${d.low ? 'var(--bad)' : 'var(--ok)'}">${d.low}</div></div></div>` : ''}
      <div class="card p0" id="sl"></div>`;
    const draw = () => {
      const q = $('#sq').value.toLowerCase(), low = $('#slow').checked;
      const rows = d.items.filter(i => (!q || i.name.toLowerCase().includes(q)) && (!low || i.low));
      const cols = [{ key: 'name', label: 'Ingredient', html: i => `<b>${esc(i.name)}</b>${i.category ? `<div class="small muted">${esc(i.category)}</div>` : ''}` }];
      if (all) d.branches.forEach(b => cols.push({ key: 'b' + b.id, label: b.name, num: 1, html: i => fmt.num((i.by_branch || {})[b.id] || 0) + ' ' + esc(i.unit) }));
      cols.push({ key: 'qty', label: all ? 'Total' : 'In stock', num: 1, html: i => `<b style="color:${i.low ? 'var(--bad)' : 'inherit'}">${fmt.num(i.qty)} ${esc(i.unit)}</b>${i.purchase_unit && n2(i.conversion) > 1 ? `<div class="small muted">${fmt.num(n2(i.qty) / n2(i.conversion))} ${esc(i.purchase_unit)}</div>` : ''}` },
        { key: 'min_stock', label: 'Min', num: 1, fmt: v => fmt.num(v) }, { key: 'cost', label: 'Cost/unit', num: 1, fmt: v => fmt.money(v) }, { key: 'value', label: 'Value', num: 1, fmt: fmt.money }, { key: 'low', label: '', html: i => i.low ? '<span class="badge bad">Low</span>' : '' });
      $('#sl').innerHTML = table(cols, rows, { onRow: !all, empty: 'No ingredients. Add them in the Ingredients tab.' });
      if (!all) bindRows($('#sl'), rows, i => moveModal('in', i, d.items));
    };
    $('#sq').oninput = draw; $('#slow').onchange = draw; draw();
    $$('[data-mv]', box).forEach(b => b.onclick = () => moveModal(b.dataset.mv, null, d.items));
    return;
  }
  if (tab === 'moves') {
    await refList('ingredients');
    box.innerHTML = `<div class="row mb">${rangeBar(params)}<select id="mt" style="width:auto"><option value="">All types</option>${['purchase', 'sale', 'in', 'out', 'waste', 'damage', 'adjust', 'count', 'transfer_in', 'transfer_out', 'return', 'return_supplier', 'staff_meal'].map(t => `<option ${params.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="card p0" id="ml"></div>`;
    wireRange('inventory', Object.assign({}, params, { tab: 'moves' })); $('#mt').onchange = e => APP.go(`#/inventory?${new URLSearchParams(Object.assign({}, params, { tab: 'moves', type: e.target.value }))}`);
    const rows = await GET(`/api/app/stock/moves?${qstr(Object.assign({ from: params.from || addDays(todayStr(), -6), to: params.to || todayStr() }, params))}${params.type ? '&type=' + params.type : ''}`);
    $('#ml').innerHTML = table([{ key: 'created_at', label: 'Time', fmt: fmt.dt }, { key: 'ingredient', label: 'Ingredient' }, { key: 'type', label: 'Type', html: r => badge(r.type) }, { key: 'qty', label: 'Qty', num: 1, html: r => `<b style="color:${n2(r.qty) < 0 ? 'var(--bad)' : 'var(--ok)'}">${n2(r.qty) > 0 ? '+' : ''}${fmt.num(r.qty)} ${esc(r.unit)}</b>` },
      { key: 'system_qty', label: 'Before', num: 1, fmt: v => fmt.num(v) }, { key: 'ref', label: 'Reference' }, { key: 'batch', label: 'Batch / expiry', html: r => r.batch || r.expiry ? `${esc(r.batch || '')} ${r.expiry ? fmt.date(r.expiry) : ''}` : '' }, { key: 'note', label: 'Note' }, { key: 'user_name', label: 'By' }], rows, { empty: 'No stock movement in this period' });
    return;
  }
  if (tab === 'count') {
    const d = await GET('/api/app/stock');
    box.innerHTML = `<div class="page-h"><p class="muted mt0">Count what you physically have and type it in. Only the items you fill are updated; differences are recorded as "count" adjustments.</p><div class="row"><button class="btn" id="cprint">🖨 Print count sheet</button><button class="btn primary" id="csave">Save count</button></div></div>
      <div class="card p0">${table([{ key: 'name', label: 'Ingredient' }, { key: 'qty', label: 'System qty', num: 1, html: i => fmt.num(i.qty) + ' ' + esc(i.unit) }, { key: 'x', label: 'Counted qty', html: i => `<input type="number" step="any" data-c="${i.id}" style="max-width:140px" placeholder="${esc(i.unit)}">` }], d.items.filter(i => i.active))}</div>`;
    $('#csave').onclick = async () => { const items = $$('[data-c]', box).filter(x => x.value !== '').map(x => ({ ingredient_id: +x.dataset.c, counted: x.value })); if (!items.length) return toast('Enter at least one count', 'err'); const r = await POST('/api/app/stock/count', { items }); toast(`Saved — ${r.changed} item(s) adjusted`, 'ok'); APP.go('#/inventory?tab=variance'); };
    $('#cprint').onclick = () => printHTML(`<h2>${esc(APP.me.tenant.name)} — Stock count sheet</h2><p>${fmt.date(todayStr())}</p><table class="tbl"><tr><th>Ingredient</th><th>Unit</th><th>System</th><th>Counted</th></tr>${d.items.filter(i => i.active).map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td>${fmt.num(i.qty)}</td><td></td></tr>`).join('')}</table>`);
    return;
  }
  if (tab === 'transfer') {
    const d = await GET('/api/app/stock'); const others = APP.me.branches.filter(b => b.id !== APP.me.branch_id && b.active);
    if (!others.length) { box.innerHTML = '<div class="empty">You need at least two branches to transfer stock. Add one in Branches.</div>'; return; }
    box.innerHTML = `<div class="card" style="max-width:760px"><h3>Send stock from this branch</h3><label class="f"><span>Send to branch</span><select id="tb">${others.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      ${table([{ key: 'name', label: 'Ingredient' }, { key: 'qty', label: 'Available', num: 1, html: i => fmt.num(i.qty) + ' ' + esc(i.unit) }, { key: 'x', label: 'Send qty', html: i => `<input type="number" step="any" data-t="${i.id}" style="max-width:130px">` }], d.items.filter(i => i.active))}
      <label class="f mt"><span>Note</span><input id="tn"></label><button class="btn primary" id="tgo">Transfer</button></div>`;
    $('#tgo').onclick = async () => { const items = $$('[data-t]', box).filter(x => n2(x.value) > 0).map(x => ({ ingredient_id: +x.dataset.t, qty: n2(x.value) })); await POST('/api/app/stock/transfer', { to_branch: +$('#tb').value, items, note: $('#tn').value }); toast('Transferred ✓', 'ok'); APP.go('#/inventory'); };
    return;
  }
  if (tab === 'expiry') {
    const days = +(params.days || 7); const rows = await GET('/api/app/stock/expiring?days=' + days);
    box.innerHTML = `<div class="row mb"><span>Expiring within</span><select id="ed" style="width:auto">${[3, 7, 15, 30, 60].map(x => `<option ${x === days ? 'selected' : ''}>${x}</option>`).join('')}</select><span>days</span></div><div class="card p0">${table([{ key: 'name', label: 'Ingredient' }, { key: 'batch', label: 'Batch / lot' }, { key: 'expiry', label: 'Expires', html: r => `<b style="color:${r.expiry <= todayStr() ? 'var(--bad)' : 'var(--warn)'}">${fmt.date(r.expiry)}</b>` }, { key: 'qty', label: 'Received qty', num: 1, html: r => fmt.num(r.qty) + ' ' + esc(r.unit) }, { key: 'ref', label: 'From' }], rows, { empty: 'Nothing expiring soon ✓ (add expiry dates when receiving purchases)' })}</div>`;
    $('#ed').onchange = e => APP.go('#/inventory?tab=expiry&days=' + e.target.value);
    return;
  }
  if (tab === 'variance') {
    box.innerHTML = `<div class="mb">${rangeBar(params)}</div><p class="muted">Expected use = what recipes say your sales consumed. Actual = expected + waste + count differences. A big gap means theft, over-portioning or unrecorded waste.</p><div class="card p0" id="vl"></div>`;
    wireRange('inventory', Object.assign({}, params, { tab: 'variance' }));
    const rows = await GET('/api/app/stock/variance?' + qstr(Object.assign({ from: params.from || addDays(todayStr(), -29), to: params.to || todayStr() }, params)));
    $('#vl').innerHTML = table([{ key: 'name', label: 'Ingredient' }, { key: 'theoretical', label: 'Expected use', num: 1, html: r => fmt.num(r.theoretical) + ' ' + esc(r.unit) }, { key: 'actual', label: 'Actual use', num: 1, html: r => fmt.num(r.actual) + ' ' + esc(r.unit) },
      { key: 'wasted', label: 'Wasted', num: 1, fmt: v => fmt.num(v) }, { key: 'count_diff', label: 'Count difference', num: 1, fmt: v => fmt.num(v) },
      { key: 'x', label: 'Variance value', num: 1, html: r => { const v = (n2(r.actual) - n2(r.theoretical)) * n2(r.cost); return `<b style="color:${v > 0.5 ? 'var(--bad)' : 'var(--ok)'}">${fmt.money(v)}</b>`; } }], rows, { empty: 'No data for this period' });
  }
};
function moveModal(type, ing, items) {
  const L = { in: 'Stock in', out: 'Stock out', waste: 'Record wastage', damage: 'Damaged goods', adjust: 'Adjust stock (+/-)', staff_meal: 'Staff meal', opening: 'Opening stock' };
  modal({ title: L[type] || 'Stock movement', body: `<div class="fgrid"><label class="f full"><span>Ingredient</span><select id="mi">${items.filter(i => i.active).map(i => `<option value="${i.id}" ${ing && ing.id === i.id ? 'selected' : ''}>${esc(i.name)} (${fmt.num(i.qty)} ${esc(i.unit)})</option>`).join('')}</select></label>
    <label class="f"><span>Type</span><select id="mty">${Object.entries(L).map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Quantity ${type === 'adjust' ? '(use minus for less)' : ''}</span><input type="number" step="any" id="mq"></label>
    <label class="f"><span>Unit</span><select id="mu"><option value="stock">Stock unit</option><option value="purchase">Purchase unit</option></select></label>
    <label class="f"><span>Batch / lot</span><input id="mb2"></label><label class="f"><span>Expiry date</span><input type="date" id="me"></label>
    <label class="f full"><span>Note / reason</span><input id="mn" placeholder="e.g. spoiled, burnt, dropped"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { await POST('/api/app/stock/move', { ingredient_id: +$('#mi').value, type: $('#mty').value, qty: $('#mq').value, unit_mode: $('#mu').value, batch: $('#mb2').value, expiry: $('#me').value || null, note: $('#mn').value }); toast('Stock updated', 'ok'); APP.route(); } }] });
}

// ================= recipes & food cost =================
APP.pages.recipes = async (el, params) => {
  const rows = await GET('/api/app/recipes');
  if (params.product) return recipeEditor(+params.product);
  el.innerHTML = `<div class="page-h"><div class="row"><input type="search" id="rq" placeholder="Search dish…" style="max-width:240px"><label class="check" style="margin:0"><input type="checkbox" id="rno"> Only dishes without a recipe</label></div><button class="btn" id="sub">⇄ Substitute ingredient</button></div>
    <div class="grid g4 mb"><div class="card kpi"><div class="l">Dishes with recipe</div><div class="v">${rows.filter(r => r.ingredients).length} / ${rows.length}</div></div>
      <div class="card kpi"><div class="l">Average food cost</div><div class="v">${fmt.num(avg(rows.filter(r => r.ingredients).map(r => r.food_cost_pct)), 1)}%</div><div class="s muted">Healthy: 25–35%</div></div>
      <div class="card kpi"><div class="l">High cost dishes (>40%)</div><div class="v" style="color:var(--bad)">${rows.filter(r => r.food_cost_pct > 40).length}</div></div></div><div class="card p0" id="rl"></div>`;
  const draw = () => {
    const q = $('#rq').value.toLowerCase(), no = $('#rno').checked;
    const list = rows.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!no || !r.ingredients));
    $('#rl').innerHTML = table([{ key: 'name', label: 'Dish', html: r => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.category || '')}</div>` }, { key: 'ingredients', label: 'Ingredients', num: 1, html: r => r.ingredients ? r.ingredients : '<span class="badge warn">No recipe</span>' },
      { key: 'cost', label: 'Cost / portion', num: 1, fmt: fmt.money }, { key: 'price', label: 'Selling price', num: 1, fmt: fmt.money }, { key: 'profit', label: 'Profit / dish', num: 1, fmt: fmt.money },
      { key: 'food_cost_pct', label: 'Food cost %', num: 1, html: r => r.ingredients ? `<b style="color:${r.food_cost_pct > 40 ? 'var(--bad)' : r.food_cost_pct > 33 ? 'var(--warn)' : 'var(--ok)'}">${fmt.num(r.food_cost_pct, 1)}%</b>` : '—' }], list, { onRow: 1 });
    bindRows($('#rl'), list, r => recipeEditor(r.id));
  };
  $('#rq').oninput = draw; $('#rno').onchange = draw; draw();
  $('#sub').onclick = async () => { const ings = await refList('ingredients', true); const opts = ings.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');
    modal({ title: 'Substitute an ingredient in all recipes', body: `<label class="f"><span>Replace</span><select id="sf">${opts}</select></label><label class="f"><span>With</span><select id="st2">${opts}</select></label><label class="f"><span>Quantity factor (1 = same amount)</span><input type="number" step="any" id="sx" value="1"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Replace everywhere', cls: 'primary', onClick: async () => { const r = await POST('/api/app/recipes/substitute', { from_id: +$('#sf').value, to_id: +$('#st2').value, factor: n2($('#sx').value) || 1 }); toast(`Updated ${r.updated} recipe lines`, 'ok'); APP.route(); } }] }); };
};
const avg = a => a.length ? a.reduce((s, x) => s + n2(x), 0) / a.length : 0;
async function recipeEditor(pid) {
  const [d, ings] = await Promise.all([GET('/api/app/recipes/' + pid), refList('ingredients', true)]);
  const items = d.items.map(i => ({ ingredient_id: i.ingredient_id, qty: n2(i.qty) }));
  const ing = id => ings.find(i => i.id === id) || {};
  const m = modal({ title: 'Recipe — ' + d.product.name, size: 'wide', body: `<p class="muted mt0">${L('Quantity of each ingredient for <b>one portion</b>. Stock is deducted automatically when this dish is sold.', '<b>এক পোর্শনের</b> জন্য প্রতিটি উপকরণের পরিমাণ। ডিশটি বিক্রি হলে স্টক নিজে থেকেই কমে যাবে।')}</p><div id="rr"></div>
      <button class="btn sm" id="radd">+ Add ingredient</button><div class="card mt" style="background:var(--soft)" id="rsum"></div>
      <label class="f mt"><span>Change note (for version history)</span><input id="rnote" placeholder="e.g. reduced chicken to 180g"></label>
      ${d.versions.length ? `<details><summary style="cursor:pointer;font-weight:600">Version history (${d.versions.length})</summary>${d.versions.map(v => `<div class="row between small" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>${fmt.dt(v.created_at)} · ${esc(v.user_name || '')} · ${esc(v.note || '')}<br><span class="muted">${(v.items || []).map(i => esc(i.name) + ' ' + fmt.num(i.qty) + esc(i.unit)).join(', ')}</span></span><button class="btn sm" data-rv="${v.id}">Restore</button></div>`).join('')}</details>` : ''}`,
    actions: [{ label: 'Close' }, { label: 'Save recipe', cls: 'primary', onClick: async () => { const r = await PUT('/api/app/recipes/' + pid, { items, note: $('#rnote').value }); toast(`Saved — cost ${fmt.money(r.cost)} per portion`, 'ok'); if (location.hash.includes('recipes')) APP.go('#/recipes'); } }] });
  const draw = () => {
    $('#rr', m.el).innerHTML = items.map((it, i) => { const g = ing(it.ingredient_id); const cost = n2(it.qty) / ((n2(g.yield_pct) || 100) / 100) * n2(g.cost);
      return `<div class="row mb"><select data-i="${i}" style="flex:2">${ings.map(x => `<option value="${x.id}" ${x.id === it.ingredient_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <input type="number" step="any" data-q="${i}" value="${it.qty}" style="width:110px"><span style="width:44px">${esc(g.unit || '')}</span><span style="width:90px" class="right">${fmt.money(cost)}</span><button class="btn icon danger" data-x="${i}">✕</button></div>`; }).join('') || '<div class="muted">No ingredients yet</div>';
    const total = items.reduce((s, it) => { const g = ing(it.ingredient_id); return s + n2(it.qty) / ((n2(g.yield_pct) || 100) / 100) * n2(g.cost); }, 0);
    const price = n2(d.product.price);
    $('#rsum', m.el).innerHTML = `<div class="grid g4"><div><div class="small muted">Cost / portion</div><b class="big">${fmt.money(total)}</b></div><div><div class="small muted">Selling price</div><b class="big">${fmt.money(price)}</b></div>
      <div><div class="small muted">Profit / dish</div><b class="big" style="color:var(--ok)">${fmt.money(price - total)}</b></div><div><div class="small muted">Food cost</div><b class="big" style="color:${price && total / price > .4 ? 'var(--bad)' : 'var(--ok)'}">${price ? fmt.num(total / price * 100, 1) : 0}%</b></div></div>
      <div class="small muted mt">To reach 30% food cost, sell at about <b>${fmt.money(Math.ceil(total / 0.3))}</b>.</div>`;
    $$('[data-i]', m.el).forEach(s => s.onchange = () => { items[+s.dataset.i].ingredient_id = +s.value; draw(); });
    $$('[data-q]', m.el).forEach(s => s.oninput = debounce(() => { items[+s.dataset.q].qty = n2(s.value); draw(); }, 400));
    $$('[data-x]', m.el).forEach(b => b.onclick = () => { items.splice(+b.dataset.x, 1); draw(); });
  };
  $('#radd', m.el).onclick = () => { if (!ings.length) return toast('Add ingredients in Inventory first', 'err'); items.push({ ingredient_id: ings[0].id, qty: 0 }); draw(); };
  $$('[data-rv]', m.el).forEach(b => b.onclick = async () => { await POST(`/api/app/recipes/${pid}/restore/${b.dataset.rv}`); toast('Restored', 'ok'); m.close(); recipeEditor(pid); });
  draw();
}

// ================= purchases & suppliers =================
const PUR_TABS = [{ k: 'list', l: 'Purchases', p: 'purchases' }, { k: 'new', l: '+ New purchase', p: 'purchases' }, { k: 'suppliers', l: 'Suppliers' }, { k: 'dues', l: 'Supplier dues' }];
APP.pages.purchases = async (el, params) => {
  const tab = pickTab(PUR_TABS, params);
  el.innerHTML = tabsHTML('purchases', PUR_TABS, tab) + '<div id="pb"></div>'; const box = $('#pb');
  if (tab === 'new') return purchaseForm(box, params);
  if (tab === 'suppliers') {
    const sum = await GET('/api/app/suppliers/summary');
    return crudPage(box, 'suppliers', { addLabel: 'Add supplier', extraCols: [{ key: 'bal', label: 'Balance due', num: 1, html: r => { const s = sum.find(x => x.id === r.id); return s ? `<b style="color:${s.balance > 0 ? 'var(--bad)' : 'inherit'}">${fmt.money(s.balance)}</b>` : '—'; } }],
      rowActions: r => [{ label: '📒 Ledger', onClick: () => { supplierLedger(r.id); return false; } }] });
  }
  if (tab === 'dues') {
    const d = await GET('/api/app/accounting/dues');
    box.innerHTML = `<div class="card p0">${table([{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'oldest', label: 'Oldest unpaid', fmt: fmt.date }, { key: 'due', label: 'Due', num: 1, fmt: fmt.money }, { key: 'x', label: '', html: r => `<button class="btn sm primary" data-p="${r.id}">Pay</button> <button class="btn sm" data-l="${r.id}">Ledger</button>` }], d.suppliers, { foot: { name: 'Total', due: fmt.money(d.payable) }, empty: 'You owe no supplier 👍' })}</div>`;
    $$('[data-p]', box).forEach(b => b.onclick = () => paySupplier(+b.dataset.p)); $$('[data-l]', box).forEach(b => b.onclick = () => supplierLedger(+b.dataset.l));
    return;
  }
  await refList('suppliers', true);
  box.innerHTML = `<div class="row mb">${rangeBar(params)}<select id="ps" style="width:auto"><option value="">All suppliers</option>${APP.refs.suppliers.map(s => `<option value="${s.id}" ${+params.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select id="pst" style="width:auto"><option value="">Any status</option><option value="ordered" ${params.status === 'ordered' ? 'selected' : ''}>Purchase orders (not received)</option><option value="received" ${params.status === 'received' ? 'selected' : ''}>Received</option></select></div><div class="card p0" id="pl"></div>`;
  wireRange('purchases', Object.assign({}, params, { tab: 'list' }));
  const nav = (k, v) => APP.go(`#/purchases?${new URLSearchParams(Object.assign({}, params, { tab: 'list', [k]: v }))}`);
  $('#ps').onchange = e => nav('supplier_id', e.target.value); $('#pst').onchange = e => nav('status', e.target.value);
  const rows = await GET(`/api/app/purchases?${qstr(Object.assign({ from: params.from || addDays(todayStr(), -29), to: params.to || todayStr() }, params))}${params.supplier_id ? '&supplier_id=' + params.supplier_id : ''}${params.status ? '&status=' + params.status : ''}`);
  $('#pl').innerHTML = table([{ key: 'date', label: 'Date', fmt: fmt.date }, { key: 'ref_no', label: 'Ref', html: r => `<b>${esc(r.ref_no)}</b><div class="small muted">${esc(r.invoice_no || '')}</div>` }, { key: 'supplier_name', label: 'Supplier' },
    { key: 'type', label: 'Type', html: r => badge(r.type) + ' ' + badge(r.status) + (r.approved_by ? '' : ' <span class="badge warn">needs approval</span>') }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }, { key: 'paid', label: 'Paid', num: 1, fmt: fmt.money }, { key: 'due', label: 'Due', num: 1, html: r => r.type === 'purchase' && n2(r.due) > 0 ? `<b style="color:var(--bad)">${fmt.money(r.due)}</b>` : '—' }],
    rows, { onRow: 1, empty: 'No purchases in this period' });
  bindRows($('#pl'), rows, r => purchaseDetail(r.id));
};
async function purchaseForm(box, params) {
  const [sups, stock] = await Promise.all([refList('suppliers', true), GET('/api/app/stock')]);
  const ings = stock.items.filter(i => i.active);
  const lines = [];
  if (params.low) ings.filter(i => i.low).forEach(i => lines.push({ ingredient_id: i.id, qty: '', unit_cost: '', unit_mode: i.purchase_unit && n2(i.conversion) > 1 ? 'purchase' : 'stock' }));
  box.innerHTML = `<div class="card"><div class="fgrid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <label class="f"><span>Supplier *</span><select id="fs"><option value="">Choose…</option>${sups.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Type</span><select id="ft"><option value="received">Purchase — goods received now (GRN)</option><option value="ordered">Purchase order (receive later)</option><option value="return">Return goods to supplier</option></select></label>
      <label class="f"><span>Date</span><input type="date" id="fd" value="${todayStr()}"></label><label class="f"><span>Supplier invoice no.</span><input id="fi"></label></div>
    <div class="row between"><h3>Items</h3><div class="row"><button class="btn sm" id="flow">+ Add all low-stock items</button><button class="btn sm primary" id="fadd">+ Add item</button></div></div>
    <div id="fl"></div><hr><div class="fgrid" style="grid-template-columns:repeat(4,minmax(0,1fr))"><label class="f"><span>Discount</span><input type="number" id="fdisc" value="0"></label>
      <label class="f"><span>Paid now</span><input type="number" id="fpaid" value="0"></label><label class="f"><span>Paid by</span><select id="fm"><option>Cash</option><option>Bank</option><option>bKash</option><option>Nagad</option></select></label>
      <div><div class="small muted">Total</div><div class="bigtotal" style="text-align:left;margin:0" id="ftot">${CUR}0</div></div></div>
    <label class="f"><span>Note</span><input id="fn"></label><button class="btn primary lg" id="fsave">Save purchase</button></div>`;
  const ing = id => ings.find(i => i.id === id) || {};
  const draw = () => {
    $('#fl').innerHTML = lines.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ingredient</th><th>Unit</th><th>Qty</th><th>Unit price</th><th>Batch</th><th>Expiry</th><th class="num">Line total</th><th></th></tr></thead><tbody>${lines.map((l, i) => { const g = ing(l.ingredient_id);
      return `<tr><td><select data-k="ingredient_id" data-i="${i}">${ings.map(x => `<option value="${x.id}" ${x.id === l.ingredient_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
      <td><select data-k="unit_mode" data-i="${i}" style="min-width:90px"><option value="stock" ${l.unit_mode === 'stock' ? 'selected' : ''}>${esc(g.unit || '')}</option>${g.purchase_unit && n2(g.conversion) !== 1 ? `<option value="purchase" ${l.unit_mode === 'purchase' ? 'selected' : ''}>${esc(g.purchase_unit)}</option>` : ''}</select></td>
      <td><input type="number" step="any" data-k="qty" data-i="${i}" value="${l.qty}" style="width:90px"></td><td><input type="number" step="any" data-k="unit_cost" data-i="${i}" value="${l.unit_cost}" style="width:100px" placeholder="${fmt.num(l.unit_mode === 'purchase' ? n2(g.cost) * n2(g.conversion) : g.cost)}"></td>
      <td><input data-k="batch" data-i="${i}" value="${esc(l.batch || '')}" style="width:90px"></td><td><input type="date" data-k="expiry" data-i="${i}" value="${l.expiry || ''}"></td>
      <td class="num"><b>${fmt.money(n2(l.qty) * n2(l.unit_cost))}</b></td><td><button class="btn icon danger" data-x="${i}">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Add the items you are buying</div>';
    const sub = lines.reduce((s, l) => s + n2(l.qty) * n2(l.unit_cost), 0); $('#ftot').textContent = fmt.money(sub - n2($('#fdisc').value));
    $$('[data-k]', box).forEach(x => x.onchange = () => { const l = lines[+x.dataset.i]; l[x.dataset.k] = x.dataset.k === 'ingredient_id' ? +x.value : x.value; if (x.dataset.k === 'ingredient_id') { const g = ing(+x.value); l.unit_mode = g.purchase_unit && n2(g.conversion) > 1 ? 'purchase' : 'stock'; } draw(); });
    $$('[data-x]', box).forEach(b => b.onclick = () => { lines.splice(+b.dataset.x, 1); draw(); });
  };
  $('#fadd').onclick = () => { if (!ings.length) return toast('Add ingredients first (Inventory → Ingredients)', 'err'); const g = ings[0]; lines.push({ ingredient_id: g.id, qty: '', unit_cost: '', unit_mode: g.purchase_unit && n2(g.conversion) > 1 ? 'purchase' : 'stock' }); draw(); };
  $('#flow').onclick = () => { ings.filter(i => i.low && !lines.some(l => l.ingredient_id === i.id)).forEach(i => lines.push({ ingredient_id: i.id, qty: '', unit_cost: '', unit_mode: i.purchase_unit && n2(i.conversion) > 1 ? 'purchase' : 'stock' })); draw(); };
  $('#fdisc').oninput = draw;
  $('#fsave').onclick = async () => {
    const t = $('#ft').value;
    const p = await POST('/api/app/purchases', { supplier_id: +$('#fs').value, type: t === 'return' ? 'return' : 'purchase', status: t === 'ordered' ? 'ordered' : 'received', date: $('#fd').value, invoice_no: $('#fi').value,
      items: lines.map(l => ({ ingredient_id: l.ingredient_id, qty: l.qty, unit_cost: l.unit_cost, unit_mode: l.unit_mode, batch: l.batch, expiry: l.expiry || null })), discount: n2($('#fdisc').value), paid: n2($('#fpaid').value), method: $('#fm').value, note: $('#fn').value });
    toast(`${p.ref_no} saved ✓${p.status === 'received' ? ' — stock updated' : ''}`, 'ok'); APP.go('#/purchases?tab=list'); setTimeout(() => purchaseDetail(p.id), 300);
  };
  draw();
}
async function purchaseDetail(id) {
  const p = await GET('/api/app/purchases/' + id);
  const html = `<div class="row between"><div><h2 class="mt0">${esc(p.ref_no)} ${badge(p.type)} ${badge(p.status)}</h2><div class="muted">${esc(p.supplier_name)} · ${fmt.date(p.date)}${p.invoice_no ? ' · Inv ' + esc(p.invoice_no) : ''} · ${esc(p.branch_name || '')}</div></div><div class="right small">By ${esc(p.user_name || '')}<br>${p.approved_name ? 'Approved by ' + esc(p.approved_name) : '<span class="badge warn">Not approved</span>'}</div></div>
    ${table([{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', num: 1, html: i => fmt.num(i.qty) + ' ' + esc(i.unit) }, { key: 'unit_cost', label: 'Cost / unit', num: 1, fmt: v => fmt.money(v) }, { key: 'batch', label: 'Batch' }, { key: 'expiry', label: 'Expiry', fmt: fmt.date }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }], p.items)}
    <div class="row between mt"><div>${p.payments.map(x => `<div class="small">${fmt.date(x.date)} · ${esc(x.method)} · ${fmt.money(x.amount)}</div>`).join('')}</div><div class="right"><div>Subtotal ${fmt.money(p.subtotal)}</div>${n2(p.discount) ? `<div>Discount -${fmt.money(p.discount)}</div>` : ''}<div class="big bold">Total ${fmt.money(p.total)}</div><div>Paid ${fmt.money(p.paid)}</div>${p.type === 'purchase' && n2(p.total) - n2(p.paid) > 0 ? `<div class="bold" style="color:var(--bad)">Due ${fmt.money(n2(p.total) - n2(p.paid))}</div>` : ''}</div></div>
    ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}`;
  const acts = [];
  if (p.status === 'ordered') acts.push({ label: '📥 Receive goods (GRN)', cls: 'success', onClick: async () => { await POST(`/api/app/purchases/${id}/receive`); toast('Received — stock updated', 'ok'); APP.route(); } }, { label: 'Delete PO', cls: 'danger', onClick: async () => { await DEL('/api/app/purchases/' + id); APP.route(); } });
  if (!p.approved_by && can(['accounting', 'settings'])) acts.push({ label: '✓ Approve', onClick: async () => { await POST(`/api/app/purchases/${id}/approve`); toast('Approved', 'ok'); APP.route(); } });
  if (p.type === 'purchase' && n2(p.total) > n2(p.paid) && p.status === 'received') acts.push({ label: 'Pay supplier', cls: 'primary', onClick: async () => { const a = await askText('Pay against ' + p.ref_no, { label: 'Amount', type: 'number', value: n2(p.total) - n2(p.paid) }); if (!a) return false; await POST(`/api/app/purchases/${id}/pay`, { amount: n2(a) }); toast('Paid', 'ok'); APP.route(); } });
  acts.push({ label: '🖨 Print', onClick: () => { printHTML(`<h2>${esc(APP.me.tenant.name)}</h2>` + html); return false; } }, { label: 'Close' });
  modal({ title: p.status === 'ordered' ? 'Purchase order' : p.type === 'return' ? 'Purchase return' : 'Goods received note', size: 'wide', body: html, actions: acts });
}
async function supplierLedger(id) {
  const d = await GET(`/api/app/suppliers/${id}/ledger`);
  modal({ title: 'Supplier ledger — ' + d.supplier.name, size: 'wide', body: `<div class="row between mb"><span class="muted">${esc(d.supplier.phone || '')}</span><b class="big">Balance due: ${fmt.money(d.balance)}</b></div>
    ${table([{ key: 'date', label: 'Date', fmt: fmt.date }, { key: 'particulars', label: 'Particulars' }, { key: 'debit', label: 'Purchase', num: 1, fmt: v => n2(v) ? fmt.money(v) : '' }, { key: 'credit', label: 'Paid / return', num: 1, fmt: v => n2(v) ? fmt.money(v) : '' }, { key: 'balance', label: 'Balance', num: 1, fmt: fmt.money }], d.ledger, { empty: 'No transactions yet' })}
    <h4 class="mt">Items bought from this supplier</h4>${table([{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', num: 1, html: r => fmt.num(r.qty) + ' ' + esc(r.unit) }, { key: 'avg_cost', label: 'Avg cost', num: 1, fmt: v => fmt.money(v) }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }], d.items)}`,
    actions: [{ label: 'Pay supplier', cls: 'primary', onClick: () => { paySupplier(id); } }, { label: 'Close' }] });
}
function paySupplier(id) {
  modal({ title: 'Pay supplier', body: `<div class="fgrid"><label class="f"><span>Amount</span><input type="number" id="sa"></label><label class="f"><span>Method</span><select id="sm"><option>Cash</option><option>Bank</option><option>bKash</option><option>Nagad</option></select></label><label class="f"><span>Date</span><input type="date" id="sd" value="${todayStr()}"></label><label class="f"><span>Note</span><input id="sn"></label></div><p class="small muted">Payment is applied to the oldest unpaid bills first.</p>`,
    actions: [{ label: 'Cancel' }, { label: 'Pay', cls: 'primary', onClick: async () => { await POST(`/api/app/suppliers/${id}/pay`, { amount: n2($('#sa').value), method: $('#sm').value, date: $('#sd').value, note: $('#sn').value }); toast('Payment saved', 'ok'); APP.route(); } }] });
}

// ================= customers & CRM =================
const CUS_TABS = [{ k: 'list', l: 'Customers' }, { k: 'feedback', l: 'Feedback & complaints' }, { k: 'dues', l: 'Customer dues' }];
APP.pages.customers = async (el, params) => {
  const tab = pickTab(CUS_TABS, params);
  el.innerHTML = tabsHTML('customers', CUS_TABS, tab) + '<div id="cb"></div>'; const box = $('#cb');
  if (tab === 'feedback') return crudPage(box, 'feedback', { addLabel: 'Log feedback', note: `Guests can also send feedback from your online menu (${location.origin}/m/${APP.me.tenant.slug}).`, cols: [{ key: 'created_at', label: 'Date', fmt: fmt.date }, { key: 'type', label: 'Type', html: r => `<span class="badge ${r.type === 'complaint' ? 'bad' : 'info'}">${esc(r.type)}</span>` }, { key: 'customer_name', label: 'Customer', html: r => `${esc(r.customer_name || '—')}<div class="small muted">${esc(r.phone || '')}</div>` }, { key: 'rating', label: 'Rating', html: r => r.rating ? '⭐'.repeat(r.rating) : '—' }, { key: 'message', label: 'Message' }, { key: 'status', label: 'Status', html: r => badge(r.status) }] });
  if (tab === 'dues') {
    const d = await GET('/api/app/accounting/dues');
    box.innerHTML = `<div class="card p0">${table([{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'last_visit', label: 'Last visit', fmt: fmt.date }, { key: 'credit_limit', label: 'Limit', num: 1, fmt: v => n2(v) ? fmt.money(v) : '—' }, { key: 'due', label: 'Due', num: 1, fmt: fmt.money }, { key: 'x', label: '', html: r => `<button class="btn sm primary" data-c="${r.id}">Receive payment</button>` }], d.customers, { foot: { name: 'Total', due: fmt.money(d.receivable) }, empty: 'No customer owes you 👍' })}</div>`;
    $$('[data-c]', box).forEach(b => b.onclick = () => receiveDue(+b.dataset.c));
    return;
  }
  const seg = params.seg || '';
  return crudPage(box, 'customers', {
    addLabel: 'Add customer', filtersHTML: `<select id="seg" style="width:auto"><option value="">All segments</option><option value="loyal" ${seg === 'loyal' ? 'selected' : ''}>Loyal (10+ visits)</option><option value="regular" ${seg === 'regular' ? 'selected' : ''}>Regular (3-9)</option><option value="new" ${seg === 'new' ? 'selected' : ''}>New (1-2)</option><option value="lost" ${seg === 'lost' ? 'selected' : ''}>Not seen 60+ days</option><option value="due" ${seg === 'due' ? 'selected' : ''}>Has due</option><option value="blocked" ${seg === 'blocked' ? 'selected' : ''}>Restricted</option></select>`,
    filter: r => !seg || (seg === 'loyal' && r.visits >= 10) || (seg === 'regular' && r.visits >= 3 && r.visits < 10) || (seg === 'new' && r.visits < 3) || (seg === 'lost' && r.last_visit && Date.now() - new Date(r.last_visit) > 60 * 86400000) || (seg === 'due' && n2(r.due) > 0) || (seg === 'blocked' && r.blocked),
    cols: [{ key: 'name', label: 'Customer', html: r => `<b>${esc(r.name)}</b> ${r.blocked ? '<span class="badge bad">restricted</span>' : ''}${r.visits >= 10 ? ' <span class="badge ok">loyal</span>' : ''}<div class="small muted">${esc(r.phone || '')}${r.tags ? ' · ' + esc(r.tags) : ''}</div>` },
      { key: 'visits', label: 'Visits', num: 1 }, { key: 'total_spent', label: 'Lifetime spend', num: 1, fmt: fmt.money }, { key: 'points', label: 'Points', num: 1, fmt: v => fmt.num(v, 0) }, { key: 'due', label: 'Due', num: 1, html: r => n2(r.due) ? `<b style="color:var(--bad)">${fmt.money(r.due)}</b>` : '—' }, { key: 'last_visit', label: 'Last visit', fmt: fmt.ago }],
    onRow: r => customerProfile(r.id)
  }).then(() => { $('#seg').onchange = e => APP.go('#/customers' + (e.target.value ? '?seg=' + e.target.value : '')); });
};
async function customerProfile(id) {
  const d = await GET(`/api/app/customers/${id}/profile`); const c = d.customer;
  const m = modal({ title: c.name, size: 'wide', body: `<div class="grid g4 mb"><div class="card kpi"><div class="l">Visits</div><div class="v">${c.visits}</div></div><div class="card kpi"><div class="l">Lifetime spend</div><div class="v">${fmt.money(c.total_spent)}</div></div><div class="card kpi"><div class="l">Points</div><div class="v">${fmt.num(c.points, 0)}</div></div><div class="card kpi"><div class="l">Due</div><div class="v" style="color:${n2(c.due) ? 'var(--bad)' : 'inherit'}">${fmt.money(c.due)}</div></div></div>
    <div class="grid g2 small"><div>📞 ${esc(c.phone || '—')}<br>✉️ ${esc(c.email || '—')}<br>📍 ${esc(c.address || '—')}<br>🎂 ${fmt.date(c.birthday)} · 💍 ${fmt.date(c.anniversary)}</div><div><b>Preferences:</b> ${esc(c.preferences || '—')}<br><b>Notes:</b> ${esc(c.notes || '—')}<br><b>Favourites:</b> ${d.favourites.map(f => esc(f.name) + ' ×' + fmt.num(f.qty, 0)).join(', ') || '—'}</div></div>
    <h4 class="mt">Order history</h4><div id="ch"></div>${d.feedback.length ? `<h4 class="mt">Feedback</h4>${d.feedback.map(f => `<div class="small">${fmt.date(f.created_at)} · ${f.rating ? '⭐'.repeat(f.rating) : ''} ${esc(f.message || '')}</div>`).join('')}` : ''}`,
    actions: [{ label: '✎ Edit', onClick: async () => { await editRecord('customers', c, { onSaved: () => APP.route() }); } }, ...(n2(c.due) ? [{ label: 'Receive due', cls: 'primary', onClick: () => { receiveDue(id); } }] : []), { label: '⭐ Adjust points', onClick: async () => { const p = await askText('Add or remove points', { label: 'Points (use minus to remove)', type: 'number' }); if (p) { await POST(`/api/app/customers/${id}/points`, { points: n2(p) }); toast('Updated', 'ok'); APP.route(); } } }, { label: 'Close' }] });
  $('#ch', m.el).innerHTML = table([{ key: 'order_no', label: '#', fmt: v => '#' + v }, { key: 'created_at', label: 'Date', fmt: fmt.dt }, { key: 'type', label: 'Type', fmt: fmt.label }, { key: 'status', label: 'Status', html: r => badge(r.status) }, { key: 'total', label: 'Total', num: 1, fmt: fmt.money }], d.orders, { onRow: 1, empty: 'No orders yet' });
  bindRows($('#ch', m.el), d.orders, o => showOrder(o.id));
}
function receiveDue(id) {
  modal({ title: 'Receive customer due', body: `<div class="fgrid"><label class="f"><span>Amount</span><input type="number" id="da2"></label><label class="f"><span>Method</span><select id="dm">${(APP.me.tenant.settings.payment_methods || ['Cash']).filter(x => x !== 'Due').map(x => `<option>${esc(x)}</option>`).join('')}</select></label></div><label class="f"><span>Note</span><input id="dn"></label>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { await POST(`/api/app/customers/${id}/pay-due`, { amount: n2($('#da2').value), method: $('#dm').value, note: $('#dn').value }); toast('Payment received', 'ok'); APP.route(); } }] });
}

// ================= offers & loyalty =================
APP.pages.offers = async el => {
  const s = APP.me.tenant.settings;
  await refList('products');
  await crudPage(el, 'coupons', { addLabel: 'Create offer', note: L(`Types: <b>percent</b> (e.g. 10% off), <b>fixed</b> (e.g. ${CUR}50 off), <b>bogo</b> (buy one get one on a chosen product). Use "First order only" for welcome offers. Loyalty: ${s.loyalty_enabled ? `1 point per ${fmt.money(s.points_per_amount)} spent, 1 point = ${fmt.money(s.point_value)}` : 'off'} — change in Settings → VAT, charges & payments. Happy-hour prices are set per product (Menu → product → More options).`, `ধরন: <b>শতাংশ</b> (যেমন ১০% ছাড়), <b>নির্দিষ্ট টাকা</b> (যেমন ${CUR}50 ছাড়), <b>BOGO</b> (নির্দিষ্ট প্রোডাক্টে ১টি কিনলে ১টি ফ্রি)। স্বাগত অফারের জন্য "শুধু প্রথম অর্ডারে" ব্যবহার করুন। লয়্যালটি: ${s.loyalty_enabled ? `প্রতি ${fmt.money(s.points_per_amount)} খরচে ১ পয়েন্ট, ১ পয়েন্ট = ${fmt.money(s.point_value)}` : 'বন্ধ'} — পরিবর্তন করুন সেটিংস → ভ্যাট, চার্জ ও পেমেন্ট থেকে। হ্যাপি আওয়ারের দাম প্রতিটি প্রোডাক্টে দেওয়া হয় (মেনু → প্রোডাক্ট → আরও অপশন)।`),
    cols: [{ key: 'code', label: 'Code', html: r => `<b>${esc(r.code)}</b><div class="small muted">${esc(r.note || '')}</div>` }, { key: 'type', label: 'Type', html: r => badge(r.type) }, { key: 'value', label: 'Value', num: 1, html: r => r.type === 'percent' ? r.value + '%' : r.type === 'bogo' ? esc(refName('products', r.bogo_product_id)) : fmt.money(r.value) },
      { key: 'min_order', label: 'Min order', num: 1, fmt: fmt.money }, { key: 'used', label: 'Used', num: 1, html: r => `${r.used}${r.max_uses ? ' / ' + r.max_uses : ''}` }, { key: 'ends', label: 'Ends', fmt: fmt.date }, { key: 'active', label: 'Active', html: r => r.active ? badge('active') : '—' }] });
};

// ================= staff & payroll =================
const STAFF_TABS = [{ k: 'attendance', l: 'Attendance today' }, { k: 'summary', l: 'Monthly summary' }, { k: 'payroll', l: 'Salary & advances' }, { k: 'leaves', l: 'Leaves' }, { k: 'schedule', l: 'Shift schedule' }, { k: 'list', l: 'Staff list', p: 'settings' }];
APP.pages.staff = async (el, params) => {
  const tab = pickTab(STAFF_TABS, params);
  el.innerHTML = tabsHTML('staff', STAFF_TABS, tab) + '<div id="sb"></div>'; const box = $('#sb');
  await refList('users', true);
  if (tab === 'payroll') return crudPage(box, 'salary_payments', { addLabel: 'Pay salary / advance', note: 'Advances are deducted in the Monthly summary. Overtime hours are calculated from clock-in/out (over 8 hours a day).' });
  if (tab === 'leaves') return crudPage(box, 'leaves', { addLabel: 'Add leave' });
  if (tab === 'schedule') return crudPage(box, 'shift_schedules', { addLabel: 'Schedule a shift', params: () => 'from=' + addDays(todayStr(), -7) });
  if (tab === 'list') return usersPage(box);
  if (tab === 'summary') {
    const month = params.month || todayStr().slice(0, 7);
    const rows = await GET('/api/app/attendance/summary?month=' + month);
    box.innerHTML = `<div class="row mb"><input type="month" id="mm" value="${month}" style="width:auto"><button class="btn" id="mp">🖨 Print</button></div><div class="card p0" id="ms"></div>`;
    $('#ms').innerHTML = table([{ key: 'name', label: 'Staff', html: r => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.designation || '')}</div>` }, { key: 'days_present', label: 'Days present', num: 1 }, { key: 'leave_days', label: 'Leave days', num: 1 }, { key: 'hours', label: 'Hours', num: 1, fmt: v => fmt.num(v, 1) }, { key: 'overtime_hours', label: 'Overtime h', num: 1, fmt: v => fmt.num(v, 1) },
      { key: 'salary', label: 'Monthly salary', num: 1, fmt: fmt.money }, { key: 'advances', label: 'Advances / deductions', num: 1, fmt: fmt.money }, { key: 'paid', label: 'Paid', num: 1, fmt: fmt.money }, { key: 'x', label: 'Balance to pay', num: 1, html: r => `<b>${fmt.money(n2(r.salary) - n2(r.advances) - n2(r.paid))}</b>` }], rows);
    $('#mm').onchange = e => APP.go('#/staff?tab=summary&month=' + e.target.value);
    $('#mp').onclick = () => printHTML(`<h2>${esc(APP.me.tenant.name)} — Payroll ${month}</h2>` + $('#ms').innerHTML);
    return;
  }
  const date = params.date || todayStr();
  const d = await GET('/api/app/attendance?date=' + date);
  box.innerHTML = `<div class="row mb"><input type="date" id="ad" value="${date}" style="width:auto"></div><div class="card p0">${table([{ key: 'name', label: 'Staff', html: r => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.designation || '')}</div>` },
    { key: 'schedule', label: 'Duty', html: r => r.on_leave ? `<span class="badge warn">On ${esc(r.on_leave)} leave</span>` : r.schedule ? `${esc(r.schedule.start)}–${esc(r.schedule.end)}` : '—' }, { key: 'clock_in', label: 'In', fmt: fmt.time }, { key: 'clock_out', label: 'Out', fmt: fmt.time },
    { key: 'h', label: 'Hours', num: 1, html: r => r.clock_in ? fmt.num(((r.clock_out ? new Date(r.clock_out) : new Date()) - new Date(r.clock_in)) / 3600000, 1) : '—' },
    { key: 'x', label: '', html: r => date === todayStr() && !r.clock_out ? `<button class="btn sm ${r.clock_in ? 'danger' : 'primary'}" data-u="${r.user_id}">${r.clock_in ? 'Clock out' : 'Clock in'}</button>` : r.id ? `<button class="btn sm" data-e="${r.id}">Edit</button>` : '' }], d.rows)}</div>`;
  $('#ad').onchange = e => APP.go('#/staff?tab=attendance&date=' + e.target.value);
  $$('[data-u]', box).forEach(b => b.onclick = async () => { await POST('/api/app/attendance/clock', { user_id: +b.dataset.u }); APP.route(); });
  $$('[data-e]', box).forEach(b => b.onclick = () => { const r = d.rows.find(x => x.id === +b.dataset.e); const loc = v => v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    modal({ title: 'Edit attendance — ' + r.name, body: `<label class="f"><span>Clock in</span><input type="datetime-local" id="ei" value="${loc(r.clock_in)}"></label><label class="f"><span>Clock out</span><input type="datetime-local" id="eo" value="${loc(r.clock_out)}"></label><label class="f"><span>Note</span><input id="en" value="${esc(r.note || '')}"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => { await PUT('/api/app/attendance/' + r.id, { clock_in: $('#ei').value ? new Date($('#ei').value).toISOString() : null, clock_out: $('#eo').value ? new Date($('#eo').value).toISOString() : null, note: $('#en').value }); APP.route(); } }] }); });
};

// ================= accounting =================
const ACC_TABS = [{ k: 'pnl', l: 'Profit & loss' }, { k: 'cashbook', l: 'Cashbook' }, { k: 'expenses', l: 'Expenses' }, { k: 'income', l: 'Other income' }, { k: 'balance', l: 'Accounts & balance' }, { k: 'vat', l: 'VAT / tax' }, { k: 'dues', l: 'Receivable & payable' }, { k: 'shifts', l: 'Cash closings' }, { k: 'journal', l: 'Journal' }, { k: 'closing', l: 'Period closing' }, { k: 'categories', l: 'Expense categories' }];
APP.pages.accounting = async (el, params) => {
  const tab = pickTab(ACC_TABS, params);
  el.innerHTML = tabsHTML('accounting', ACC_TABS, tab) + '<div id="ab"></div>'; const box = $('#ab');
  const rp = Object.assign({}, params, { tab });
  if (tab === 'expenses') return crudPage(box, 'expenses', { addLabel: 'Add expense', params: () => `from=${params.from || todayStr().slice(0, 8) + '01'}&to=${params.to || todayStr()}`, header: rangeBar(params, { branchAll: false }), afterLoad: () => wireRange('accounting', rp) });
  if (tab === 'income') return crudPage(box, 'incomes', { addLabel: 'Add income', note: 'Income outside food sales: event hall rent, catering advance, scrap sale, etc.' });
  if (tab === 'journal') return crudPage(box, 'journals', { addLabel: 'Add journal entry', note: 'Manual adjustments to an account (e.g. owner investment, bank deposit, loan).' });
  if (tab === 'categories') return crudPage(box, 'expense_categories', { addLabel: 'Add category', importable: false });
  if (tab === 'shifts') { const rows = await GET('/api/app/shifts'); box.innerHTML = `<div class="card p0">${table([{ key: 'opened_at', label: 'Opened', fmt: fmt.dt }, { key: 'closed_at', label: 'Closed', fmt: fmt.dt }, { key: 'user_name', label: 'Cashier' }, { key: 'opening_cash', label: 'Opening', num: 1, fmt: fmt.money }, { key: 'expected_cash', label: 'Expected', num: 1, fmt: v => v === null ? '—' : fmt.money(v) }, { key: 'closing_cash', label: 'Counted', num: 1, fmt: v => v === null ? '—' : fmt.money(v) }, { key: 'difference', label: 'Short / extra', num: 1, html: r => r.difference === null ? '—' : `<b style="color:${Math.abs(r.difference) < 1 ? 'var(--ok)' : 'var(--bad)'}">${fmt.money(r.difference)}</b>` }, { key: 'status', label: '', html: r => badge(r.status) }], rows, { onRow: 1 })}</div>`; bindRows(box, rows, async r => { const s = await GET('/api/app/shifts/' + r.id); modal({ title: 'Shift — ' + r.user_name, body: `${hbars(s.payments.map(p => ({ label: p.method, value: p.amount })))}<hr><div class="row between"><span>Opening</span><b>${fmt.money(s.shift.opening_cash)}</b></div><div class="row between"><span>Cash sales</span><b>${fmt.money(s.cash_sales)}</b></div><div class="row between"><span>Refunds (cash)</span><b>-${fmt.money(s.refunds.cash)}</b></div><div class="row between"><span>Cash in / out</span><b>${fmt.money(s.cash_in - s.cash_out)}</b></div><div class="row between"><span>Expected</span><b>${fmt.money(s.expected_cash)}</b></div>` }); }); return; }
  if (tab === 'closing') {
    const rows = await GET('/api/app/accounting/closings');
    box.innerHTML = `<div class="card mb"><h3>Close a period</h3><p class="muted">Saves a permanent snapshot of the profit & loss for the period (e.g. month end).</p>${rangeBar(params, { branchAll: false })}<button class="btn primary mt" id="cp">Close this period</button></div><div class="card p0">${table([{ key: 'period', label: 'Period' }, { key: 'from_date', label: 'From', fmt: fmt.date }, { key: 'to_date', label: 'To', fmt: fmt.date }, { key: 'x', label: 'Net sales', num: 1, html: r => fmt.money(r.summary.net_sales) }, { key: 'y', label: 'Net profit', num: 1, html: r => `<b>${fmt.money(r.summary.net_profit)}</b>` }, { key: 'user_name', label: 'Closed by' }, { key: 'created_at', label: 'On', fmt: fmt.date }], rows, { empty: 'No closed periods yet' })}</div>`;
    wireRange('accounting', rp);
    $('#cp').onclick = async () => { const f = $('#rf').value, t = $('#rt').value; const name = await askText('Period name', { value: f.slice(0, 7) }); if (!name) return; await POST(`/api/app/accounting/close-period?from=${f}&to=${t}`, { period: name }); toast('Period closed', 'ok'); APP.route(); };
    return;
  }
  if (tab === 'balance') {
    const d = await GET('/api/app/accounting/balance');
    box.innerHTML = `<div class="grid g2"><div class="card p0"><div style="padding:14px 16px 0" class="row between"><h3>Cash & bank accounts</h3><a class="btn sm" href="#" id="acm">Manage accounts</a></div>${table([{ key: 'name', label: 'Account' }, { key: 'type', label: 'Type', html: r => badge(r.type) }, { key: 'opening_balance', label: 'Opening', num: 1, fmt: fmt.money }, { key: 'income', label: 'In', num: 1, fmt: fmt.money }, { key: 'expense', label: 'Out', num: 1, fmt: fmt.money }, { key: 'balance', label: 'Balance', num: 1, html: r => `<b>${fmt.money(r.balance)}</b>` }], d.accounts)}</div>
      <div class="card"><h3>Sales collected by method (all time, after refunds)</h3>${hbars(Object.entries(d.collected_by_method).map(([k, v]) => ({ label: k, value: v })))}<hr>
      <h3>Simple balance sheet</h3><div class="row between"><span>Stock value (assets)</span><b>${fmt.money(d.assets.stock_value)}</b></div><div class="row between"><span>Customer dues (assets)</span><b>${fmt.money(d.assets.receivables)}</b></div><div class="row between"><span>Supplier dues (liabilities)</span><b>-${fmt.money(d.liabilities.payables)}</b></div></div></div>`;
    $('#acm').onclick = e => { e.preventDefault(); crudPage(box, 'accounts', { addLabel: 'Add account' }); };
    return;
  }
  box.innerHTML = `<div class="page-h">${rangeBar(params)}<button class="btn noprint" onclick="window.print()">🖨 Print</button></div><div id="ar"><div class="loading"><span class="spin"></span></div></div>`;
  wireRange('accounting', rp);
  const q = qstr(Object.assign({ from: params.from || todayStr().slice(0, 8) + '01', to: params.to || todayStr() }, params));
  const ar = $('#ar');
  if (tab === 'pnl') {
    const p = await GET('/api/app/accounting/summary?' + q);
    const line = (l, v, b, neg) => `<div class="row between" style="padding:7px 0;border-bottom:1px dashed var(--line)${b ? ';font-weight:800;font-size:16px' : ''}"><span>${l}</span><span>${neg ? '−' : ''}${fmt.money(v)}</span></div>`;
    ar.innerHTML = `<div class="grid g4 mb"><div class="card kpi"><div class="l">Net sales</div><div class="v">${fmt.money(p.net_sales)}</div><div class="s muted">${p.sales.orders} orders</div></div><div class="card kpi"><div class="l">Gross profit</div><div class="v">${fmt.money(p.gross_profit)}</div></div>
      <div class="card kpi"><div class="l">Food cost %</div><div class="v">${fmt.num(p.food_cost_pct, 1)}%</div></div><div class="card kpi"><div class="l">Net profit</div><div class="v" style="color:${p.net_profit >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmt.money(p.net_profit)}</div></div></div>
      <div class="grid g2"><div class="card"><h3>Profit & loss statement</h3><div class="muted small mb">${fmt.date(p.from)} – ${fmt.date(p.to)}</div>
        ${line('Gross sales (menu price)', p.sales.gross)}${line('Discounts', p.sales.discounts, 0, 1)}${line('Service charge', p.sales.service)}${line('Delivery charges', p.sales.delivery)}${line('Total billed', p.sales.total, 1)}
        ${line('VAT collected (payable to govt.)', p.sales.vat, 0, 1)}${line('Refunds', p.refunds, 0, 1)}${line('Net sales', p.net_sales, 1)}
        ${line('Cost of food sold (recipes)', p.cogs, 0, 1)}${line('Wastage', p.wastage, 0, 1)}${line('Gross profit', p.gross_profit, 1)}
        ${line('Other income', p.other_income)}${p.expenses.map(e => line('Expense: ' + esc(e.category), e.amount, 0, 1)).join('')}${line('Salaries', p.salary, 0, 1)}${line('Net profit', p.net_profit, 1)}</div>
      <div class="card"><h3>Expenses by category</h3>${hbars(p.expenses.map(e => ({ label: e.category, value: e.amount })))}<hr><div class="row between"><span>Purchases (stock bought)</span><b>${fmt.money(p.purchases)}</b></div><p class="small muted">Cost of food is calculated from recipes at the time of each sale, so dishes without a recipe count as zero cost. Add recipes for an accurate gross profit.</p></div></div>`;
  }
  if (tab === 'cashbook') {
    const d = await GET('/api/app/accounting/cashbook?' + q);
    ar.innerHTML = `<div class="grid g3 mb"><div class="card kpi"><div class="l">Money in</div><div class="v" style="color:var(--ok)">${fmt.money(d.total_in)}</div></div><div class="card kpi"><div class="l">Money out</div><div class="v" style="color:var(--bad)">${fmt.money(d.total_out)}</div></div><div class="card kpi"><div class="l">Net</div><div class="v">${fmt.money(d.total_in - d.total_out)}</div></div></div>
      <div class="card mb"><h3>By method</h3>${table([{ key: 'm', label: 'Method' }, { key: 'in', label: 'In', num: 1, fmt: fmt.money }, { key: 'out', label: 'Out', num: 1, fmt: fmt.money }, { key: 'net', label: 'Net', num: 1, fmt: fmt.money }], Object.entries(d.by_method).map(([m, v]) => ({ m, in: v.in, out: v.out, net: v.in - v.out })))}</div>
      <div class="card p0">${table([{ key: 'date', label: 'Date', fmt: fmt.date }, { key: 'particulars', label: 'Particulars' }, { key: 'method', label: 'Method' }, { key: 'money_in', label: 'In', num: 1, fmt: v => n2(v) ? fmt.money(v) : '' }, { key: 'money_out', label: 'Out', num: 1, fmt: v => n2(v) ? fmt.money(v) : '' }, { key: 'balance', label: 'Running', num: 1, fmt: fmt.money }], d.rows, { empty: 'No transactions' })}</div>`;
  }
  if (tab === 'vat') {
    const d = await GET('/api/app/accounting/vat?' + q);
    ar.innerHTML = `<div class="card mb"><div class="row between"><div>VAT rate <b>${d.vat_pct}%</b> ${d.inclusive ? '(prices include VAT)' : ''} · BIN <b>${esc(d.bin || 'not set')}</b></div><div class="big">VAT payable: <b>${fmt.money(d.total_vat)}</b></div></div></div><div class="card p0">${autoTable(d.rows)}</div>`;
  }
  if (tab === 'dues') {
    const d = await GET('/api/app/accounting/dues');
    ar.innerHTML = `<div class="grid g2"><div class="card p0"><div style="padding:14px 16px 0"><h3>Customers owe you: ${fmt.money(d.receivable)}</h3></div>${table([{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'due', label: 'Due', num: 1, fmt: fmt.money }], d.customers, { empty: 'None' })}</div>
      <div class="card p0"><div style="padding:14px 16px 0"><h3>You owe suppliers: ${fmt.money(d.payable)}</h3></div>${table([{ key: 'name', label: 'Supplier' }, { key: 'oldest', label: 'Since', fmt: fmt.date }, { key: 'due', label: 'Due', num: 1, fmt: fmt.money }], d.suppliers, { empty: 'None' })}</div></div>`;
  }
};

// ================= reports =================
const REPORTS = [
  ['Sales', [['sales', 'Daily sales'], ['monthly', 'Monthly sales'], ['hourly', 'Sales by hour (peak hours)'], ['weekday', 'Sales by weekday'], ['types', 'Order types & sources'], ['payments', 'Payment methods'], ['branches', 'Branch comparison']]],
  ['Menu', [['products', 'Item-wise sales & profit'], ['categories', 'Category-wise sales'], ['menu_engineering', 'Menu engineering (stars & dogs)']]],
  ['People', [['waiters', 'Waiter performance'], ['cashiers', 'Cashier summary'], ['staff', 'Staff activity'], ['customers', 'Top customers'], ['retention', 'Customer retention']]],
  ['Operations', [['kitchen', 'Kitchen preparation time'], ['tables', 'Table utilization'], ['delivery', 'Delivery by zone'], ['cancellations', 'Cancelled / voided orders'], ['refunds', 'Refunds'], ['discounts', 'Discounts given']]],
  ['Stock & money', [['wastage', 'Wastage'], ['stock_movement', 'Stock movement'], ['low_stock', 'Low stock'], ['purchases', 'Purchases by supplier'], ['expenses', 'Expenses']]],
  ['Forecast', [['forecast', 'Sales forecast — next 7 days']]]
];
APP.pages.reports = async (el, params) => {
  const kind = params.r;
  if (!kind) {
    el.innerHTML = `<div class="grid g3">${REPORTS.map(([g, list]) => `<div class="card"><h3>${g}</h3>${list.map(([k, l]) => `<a href="#/reports?r=${k}" style="display:block;padding:7px 0;border-bottom:1px dashed var(--line)">${l} →</a>`).join('')}</div>`).join('')}</div>`;
    return;
  }
  const label = REPORTS.flatMap(r => r[1]).find(r => r[0] === kind);
  el.innerHTML = `<div class="page-h"><div><a href="#/reports" class="noprint">← All reports</a><h1 class="mt">${esc(label ? label[1] : kind)}</h1></div><div class="row noprint"><button class="btn" id="rcsv">⬇ CSV</button><button class="btn" onclick="window.print()">🖨 Print</button></div></div>
    ${['monthly', 'retention', 'forecast', 'low_stock'].includes(kind) ? '' : `<div class="mb">${rangeBar(params)}</div>`}<div id="rc"></div><div class="card p0" id="rt2"><div class="loading"><span class="spin"></span></div></div>`;
  if ($('#rgo')) wireRange('reports', params);
  const d = await GET(`/api/app/reports/${kind}?${qstr(Object.assign({ from: params.from || (['sales', 'products', 'categories', 'menu_engineering', 'customers', 'waiters', 'cashiers', 'staff', 'kitchen', 'tables', 'delivery', 'purchases', 'expenses', 'wastage', 'stock_movement', 'weekday', 'hourly', 'types', 'payments', 'branches'].includes(kind) ? addDays(todayStr(), -29) : todayStr()), to: params.to || todayStr() }, params))}`);
  $('#rt2').innerHTML = autoTable(d.rows, { totals: !['menu_engineering', 'forecast', 'retention', 'low_stock', 'kitchen'].includes(kind) });
  const chartable = { sales: ['date', 'total'], monthly: ['month', 'total'], hourly: ['hour', 'total'], weekday: ['weekday', 'total'], forecast: ['weekday', 'expected_sales'], branches: ['branch', 'total'], categories: ['category', 'revenue'], payments: ['method', 'amount'] };
  if (chartable[kind] && d.rows.length) {
    const [lk, vk] = chartable[kind]; const rows = kind === 'monthly' ? d.rows.slice().reverse() : d.rows;
    $('#rc').innerHTML = `<div class="card mb">${barChart(rows.map(r => String(r[lk]).replace(/^\d+ /, '').slice(kind === 'sales' ? 5 : 0, kind === 'sales' ? 10 : 12)), rows.map(r => r[vk]))}</div>`;
  }
  if (['products', 'waiters', 'customers'].includes(kind) && d.rows.length) $('#rc').innerHTML = `<div class="card mb">${hbars(d.rows.slice(0, 10).map(r => ({ label: r.name || r.waiter, value: r.revenue || r.total || r.spent })))}</div>`;
  $('#rcsv').onclick = () => download(`${kind}-${d.from}-${d.to}.csv`, toCSV(d.rows));
};
