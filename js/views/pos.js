/* POS — walk-in and dine-in order entry */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc, state } = RD;

  const P = {
    cat: 'All', type: 'walk_in', method: 'cash',
    cart: new Map(),        // item id -> quantity
    results: null,          // Set of item ids matching the search box (null = no search)
    search: null, wired: false, placing: false,
  };

  const byId = (id) => state.inventory.find((i) => i.id === id);

  /* ---------- wiring ---------- */
  function wire() {
    if (P.wired) return;
    P.wired = true;

    P.search = RD.attachSmartSearch({
      input: $('#pos-search'), panel: $('#pos-search-panel'), availableOnly: true,
      onResults: (term, rows) => { P.results = rows ? new Set(rows.map((r) => r.id)) : null; renderGrid(); },
      onPick: (item) => { addToCart(item.id); },
    });

    $('#pos-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      P.cat = b.dataset.cat;
      renderCats(); renderGrid();
    });
    $('#pos-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (b && !b.disabled) addToCart(b.dataset.add);
    });
    $('#pos-cart').addEventListener('click', (e) => {
      const b = e.target.closest('[data-qty]');
      if (!b) return;
      changeQty(b.dataset.id, Number(b.dataset.qty));
    });
    $('#pos-clear').addEventListener('click', () => { P.cart.clear(); renderCart(); });

    $('#pos-type').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-type]');
      if (!b) return;
      P.type = b.dataset.type;
      $$('#pos-type button').forEach((x) => x.classList.toggle('active', x === b));
      $('#pos-table-wrap').classList.toggle('hidden', P.type !== 'dine_in');
    });
    $('#pos-method').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-method]');
      if (!b) return;
      P.method = b.dataset.method;
      $$('#pos-method button').forEach((x) => x.classList.toggle('active', x === b));
    });
    $('#pos-discount').addEventListener('input', renderTotals);
    $('#pos-pay-now').addEventListener('click', () => place(true));
    $('#pos-pay-later').addEventListener('click', () => place(false));
  }

  /* ---------- rendering ---------- */
  function renderTables() {
    const sel = $('#pos-table');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Select a table</option>' +
      state.tables.filter((t) => t.is_active)
        .map((t) => `<option value="${t.id}">${esc(t.name)} (${t.seats} seats)</option>`).join('');
    sel.value = cur;
  }

  function renderCats() {
    const cats = ['All', ...Array.from(new Set(state.inventory.filter((i) => i.is_available).map((i) => i.category))).sort()];
    if (!cats.includes(P.cat)) P.cat = 'All';
    $('#pos-cats').innerHTML = cats.map((c) =>
      `<button data-cat="${esc(c)}" class="chip ${c === P.cat ? 'active' : ''}">${esc(c)}</button>`).join('');
  }

  function renderGrid() {
    let items = state.inventory.filter((i) => i.is_available);
    if (P.results) items = items.filter((i) => P.results.has(i.id));
    else if (P.cat !== 'All') items = items.filter((i) => i.category === P.cat);

    if (!items.length) {
      $('#pos-grid').innerHTML = `<div class="col-span-full card p-10 text-center text-sm text-slate-400">${
        P.results ? 'No available items match your search.' : 'No items here yet. Add some under Menu & Inventory.'}</div>`;
      return;
    }
    $('#pos-grid').innerHTML = items.map((i) => {
      const out = i.track_stock && i.stock_qty <= 0;
      const low = i.track_stock && !out && i.stock_qty <= i.low_stock_threshold;
      const badge = out ? '<span class="pill bg-rose-50 text-rose-700">Sold out</span>'
        : low ? `<span class="pill bg-amber-50 text-amber-700">${i.stock_qty} left</span>` : '';
      const inCart = P.cart.get(i.id) || 0;
      return `
        <button data-add="${i.id}" ${out ? 'disabled' : ''}
          class="relative text-left bg-white rounded-2xl border ${inCart ? 'border-brand-300 ring-4 ring-brand-500/10' : 'border-slate-100'} shadow-sm p-4 hover:shadow-md hover:border-brand-200 transition disabled:opacity-50 disabled:cursor-not-allowed">
          <div class="flex items-start justify-between gap-2">
            <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 font-bold flex items-center justify-center">${esc(i.name.charAt(0).toUpperCase())}</div>
            ${inCart ? `<span class="pill bg-brand-600 text-white">${inCart} in order</span>` : badge}
          </div>
          <div class="mt-3 font-semibold text-slate-900 leading-snug">${esc(i.name)}</div>
          <div class="text-xs text-slate-400 mt-0.5">${esc(i.category)}</div>
          <div class="mt-2 text-brand-600 font-bold">${RD.money(i.price)}</div>
        </button>`;
    }).join('');
  }

  function totals() {
    let subtotal = 0;
    for (const [id, qty] of P.cart) { const it = byId(id); if (it) subtotal += it.price * qty; }
    const rawDiscount = Number($('#pos-discount').value) || 0;
    const discount = Math.min(Math.max(rawDiscount, 0), subtotal);
    const rate = Number(state.settings.tax_rate) || 0;
    const tax = RD.round2(((subtotal - discount) * rate) / 100);
    return { subtotal: RD.round2(subtotal), discount: RD.round2(discount), rate, tax, total: RD.round2(subtotal - discount + tax) };
  }

  function renderTotals() {
    const t = totals();
    const row = (l, v, cls = '') => `<div class="flex justify-between ${cls}"><span class="text-slate-500">${l}</span><span class="font-semibold text-slate-800">${v}</span></div>`;
    $('#pos-totals').innerHTML =
      row('Subtotal', RD.money(t.subtotal)) +
      (t.discount > 0 ? row('Discount', '-' + RD.money(t.discount)) : '') +
      row(`Tax (${t.rate}%)`, RD.money(t.tax)) +
      `<div class="flex justify-between pt-2 text-lg"><span class="font-bold text-slate-900">Total</span><span class="font-bold text-brand-600">${RD.money(t.total)}</span></div>`;
    const empty = P.cart.size === 0;
    $('#pos-pay-now').disabled = empty || P.placing;
    $('#pos-pay-later').disabled = empty || P.placing;
  }

  function renderCart() {
    // Drop lines whose item vanished and clamp quantities to current stock
    for (const [id, qty] of Array.from(P.cart)) {
      const it = byId(id);
      if (!it || !it.is_available) P.cart.delete(id);
      else if (it.track_stock && qty > it.stock_qty) {
        if (it.stock_qty <= 0) P.cart.delete(id); else P.cart.set(id, it.stock_qty);
      }
    }
    $('#pos-cart').innerHTML = P.cart.size
      ? Array.from(P.cart, ([id, qty]) => {
          const it = byId(id);
          return `
          <div class="flex items-center gap-3 py-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-slate-800 truncate">${esc(it.name)}</div>
              <div class="text-xs text-slate-400">${RD.money(it.price)} each</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button data-id="${id}" data-qty="-1" class="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center" aria-label="Decrease">${RD.icon('minus', 'w-3.5 h-3.5')}</button>
              <span class="w-6 text-center text-sm font-semibold tabular-nums">${qty}</span>
              <button data-id="${id}" data-qty="1" class="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center" aria-label="Increase">${RD.icon('plus', 'w-3.5 h-3.5')}</button>
            </div>
            <div class="w-16 text-right text-sm font-semibold text-slate-800">${RD.money(it.price * qty)}</div>
          </div>`;
        }).join('')
      : '<p class="py-8 text-center text-sm text-slate-400">Tap an item to start an order.</p>';
    renderTotals();
    renderGrid();
  }

  /* ---------- cart actions ---------- */
  function addToCart(id) {
    const it = byId(id);
    if (!it || !it.is_available) return;
    const next = (P.cart.get(id) || 0) + 1;
    if (it.track_stock && next > it.stock_qty) return RD.toast(`Only ${it.stock_qty} ${it.name} in stock`, 'error');
    P.cart.set(id, next);
    renderCart();
  }

  function changeQty(id, delta) {
    const it = byId(id);
    const next = (P.cart.get(id) || 0) + delta;
    if (next <= 0) P.cart.delete(id);
    else if (it && it.track_stock && next > it.stock_qty) return RD.toast(`Only ${it.stock_qty} ${it.name} in stock`, 'error');
    else P.cart.set(id, next);
    renderCart();
  }

  /* ---------- checkout ---------- */
  async function place(payNow) {
    if (P.placing || !P.cart.size) return;
    if (P.type === 'dine_in' && !$('#pos-table').value) return RD.toast('Select a table for this dine-in order', 'error');

    P.placing = true;
    renderTotals();
    try {
      const { data, error } = await RD.sb.rpc('create_order', {
        p_order_type: P.type,
        p_table_id: P.type === 'dine_in' ? $('#pos-table').value : null,
        p_customer_name: $('#pos-customer').value.trim() || null,
        p_notes: $('#pos-notes').value.trim() || null,
        p_discount: totals().discount,
        p_payment_method: payNow ? P.method : null,
        p_mark_paid: payNow,
        p_items: Array.from(P.cart, ([item_id, quantity]) => ({ item_id, quantity })),
      });
      if (error) throw error;

      const full = await RD.fetchOrderFull(data.id);
      P.cart.clear();
      $('#pos-customer').value = '';
      $('#pos-notes').value = '';
      $('#pos-discount').value = '0';
      await RD.loadInventory();
      RD.toast(`Order ${full.tracking_no} sent to the kitchen`);
      RD.showReceipt(full);
    } catch (e) {
      RD.fail(e);
      try { await RD.loadInventory(); } catch (_) { /* ignore */ }
    } finally {
      P.placing = false;
      renderCart();
    }
  }

  RD.views.pos = {
    async mount() {
      wire();
      renderTables();
      renderCats();
      renderCart();
    },
    refresh(kind) {
      if (kind === 'inventory') { renderCats(); renderCart(); }
    },
  };
})();
