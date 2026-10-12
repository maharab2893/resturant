/* Menu & Inventory — smart search, add/edit/delete, availability, wastage */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc, state } = RD;

  const M = { cat: 'All', results: null, term: '', wired: false };

  const WASTE_REASONS = ['Spoiled', 'Expired', 'Dropped or spilled', 'Overcooked or burnt', 'Customer return', 'Prep error', 'Other'];

  function wire() {
    if (M.wired) return;
    M.wired = true;

    RD.attachSmartSearch({
      input: $('#menu-search'), panel: $('#menu-search-panel'),
      onResults: (term, rows) => { M.term = term; M.results = rows; renderTable(); },
      onPick: (item) => {
        $('#menu-search').value = item.name;
        M.results = [item];
        renderTable();
      },
    });

    $('#menu-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      M.cat = b.dataset.cat;
      renderCats(); renderTable();
    });
    $('#menu-add').addEventListener('click', () => openItemModal());
    $('#menu-waste').addEventListener('click', () => openWasteModal());

    $('#menu-body').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const item = state.inventory.find((i) => i.id === b.dataset.id);
      if (!item) return;
      if (b.dataset.act === 'edit') openItemModal(item);
      if (b.dataset.act === 'delete') {
        if (!(await RD.confirm(`Delete “${item.name}”? Past orders keep their history.`, { title: 'Delete item?', confirmLabel: 'Delete item' }))) return;
        try {
          const { error } = await RD.sb.from('inventory').delete().eq('id', item.id);
          if (error) throw error;
          await refreshAll();
          RD.toast(`${item.name} deleted`);
        } catch (err) { RD.fail(err); }
      }
    });

    $('#menu-body').addEventListener('change', async (e) => {
      const t = e.target.closest('input[data-toggle]');
      if (!t) return;
      const item = state.inventory.find((i) => i.id === t.dataset.toggle);
      if (!item) return;
      const value = t.checked;
      const { error } = await RD.sb.from('inventory').update({ is_available: value }).eq('id', item.id);
      if (error) { t.checked = !value; return RD.fail(error); }
      item.is_available = value;
      RD.toast(`${item.name} is now ${value ? 'available' : 'unavailable'}`);
    });
  }

  async function refreshAll() {
    await RD.loadInventory();
    // keep an active search in sync with edits
    if (M.results) {
      const ids = new Set(M.results.map((r) => r.id));
      M.results = state.inventory.filter((i) => ids.has(i.id));
    }
    renderCats();
    renderTable();
  }

  function renderCats() {
    const counts = new Map();
    state.inventory.forEach((i) => counts.set(i.category, (counts.get(i.category) || 0) + 1));
    const cats = ['All', ...Array.from(counts.keys()).sort()];
    if (!cats.includes(M.cat)) M.cat = 'All';
    $('#menu-cats').innerHTML = cats.map((c) =>
      `<button data-cat="${esc(c)}" class="chip ${c === M.cat ? 'active' : ''}">${esc(c)}${c === 'All' ? ` · ${state.inventory.length}` : ` · ${counts.get(c)}`}</button>`).join('');
  }

  function renderTable() {
    let rows = M.results ?? state.inventory;
    if (M.cat !== 'All') rows = rows.filter((i) => i.category === M.cat);

    $('#menu-count').textContent = M.term
      ? `${rows.length} item${rows.length === 1 ? '' : 's'} starting with “${M.term}”`
      : `${rows.length} item${rows.length === 1 ? '' : 's'}`;

    $('#menu-body').innerHTML = rows.length
      ? rows.map((i) => {
          const margin = i.price > 0 ? ((i.price - i.recipe_cost) / i.price) * 100 : 0;
          const out = i.track_stock && i.stock_qty <= 0;
          const low = i.track_stock && !out && i.stock_qty <= i.low_stock_threshold;
          const stock = !i.track_stock
            ? '<span class="text-slate-400">Not tracked</span>'
            : `<span class="font-medium">${i.stock_qty} ${esc(i.unit)}</span> ${out ? '<span class="pill bg-rose-50 text-rose-700 ml-1">Out</span>' : low ? '<span class="pill bg-amber-50 text-amber-700 ml-1">Low</span>' : ''}`;
          return `
          <tr class="hover:bg-slate-50/60">
            <td class="td"><div class="font-semibold text-slate-900">${esc(i.name)}</div>${i.description ? `<div class="text-xs text-slate-400 truncate max-w-[240px]">${esc(i.description)}</div>` : ''}</td>
            <td class="td"><span class="pill bg-slate-100 text-slate-600">${esc(i.category)}</span></td>
            <td class="td font-semibold">${RD.money(i.price)}</td>
            <td class="td text-slate-500">${RD.money(i.recipe_cost)}</td>
            <td class="td"><span class="${margin >= 60 ? 'text-brand-600' : margin >= 40 ? 'text-slate-700' : 'text-rose-600'} font-semibold">${margin.toFixed(0)}%</span></td>
            <td class="td">${stock}</td>
            <td class="td">${RD.toggleHTML(`data-toggle="${i.id}" aria-label="Available"`, i.is_available)}</td>
            <td class="td text-right whitespace-nowrap">
              <button data-act="edit" data-id="${i.id}" class="btn btn-ghost btn-sm">Edit</button>
              <button data-act="delete" data-id="${i.id}" class="btn btn-ghost btn-sm ml-1 !text-rose-600">Delete</button>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="8" class="td text-center text-slate-400 py-12">${M.term ? `No items start with “${esc(M.term)}”.` : 'No items yet. Add your first menu item.'}</td></tr>`;
  }

  /* ---------- add / edit ---------- */
  function openItemModal(item) {
    const editing = !!item;
    const v = item || { name: '', category: 'Mains', description: '', price: '', recipe_cost: '', stock_qty: 0, unit: 'pcs', low_stock_threshold: 5, track_stock: true, is_available: true };
    let category = v.category;

    const m = RD.openModal({
      title: editing ? 'Edit item' : 'Add item', size: 'max-w-xl',
      html: `
      <form id="f-form" class="space-y-4" novalidate>
        <div><label class="label" for="f-name">Item name</label><input id="f-name" class="input" value="${esc(v.name)}" required></div>
        <div>
          <label class="label">Category</label>
          <div id="f-cats" class="flex flex-wrap gap-2"></div>
          <input id="f-newcat" class="input mt-2" placeholder="Or type a new category">
        </div>
        <div><label class="label" for="f-desc">Description (optional)</label><input id="f-desc" class="input" value="${esc(v.description || '')}"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="f-price">Selling price</label><input id="f-price" type="number" min="0" step="0.01" class="input" value="${v.price}" required></div>
          <div><label class="label" for="f-cost">Recipe cost</label><input id="f-cost" type="number" min="0" step="0.01" class="input" value="${v.recipe_cost}"></div>
        </div>
        <p id="f-margin" class="text-xs text-slate-500 -mt-1"></p>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="label" for="f-stock">Stock on hand</label><input id="f-stock" type="number" min="0" step="0.01" class="input" value="${v.stock_qty}"></div>
          <div><label class="label" for="f-unit">Unit</label><input id="f-unit" class="input" value="${esc(v.unit)}"></div>
          <div><label class="label" for="f-low">Low-stock alert at</label><input id="f-low" type="number" min="0" step="0.01" class="input" value="${v.low_stock_threshold}"></div>
        </div>
        <div class="flex flex-wrap gap-x-8 gap-y-3 pt-1">
          <label class="flex items-center gap-3 text-sm font-medium text-slate-700">${RD.toggleHTML('id="f-track"', v.track_stock)} Track stock</label>
          <label class="flex items-center gap-3 text-sm font-medium text-slate-700">${RD.toggleHTML('id="f-avail"', v.is_available)} Available to order</label>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" data-close class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add item'}</button>
        </div>
      </form>`,
    });

    const drawCats = () => {
      m.$('#f-cats').innerHTML = RD.categories().map((c) =>
        `<button type="button" data-cat="${esc(c)}" class="chip ${c === category && !m.$('#f-newcat').value.trim() ? 'active' : ''}">${esc(c)}</button>`).join('');
    };
    const drawMargin = () => {
      const p = Number(m.$('#f-price').value), c = Number(m.$('#f-cost').value) || 0;
      m.$('#f-margin').textContent = p > 0 ? `Gross margin ${(((p - c) / p) * 100).toFixed(0)}% · profit ${RD.money(p - c)} per item` : '';
    };
    drawCats(); drawMargin();

    m.$('#f-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      category = b.dataset.cat;
      m.$('#f-newcat').value = '';
      drawCats();
    });
    m.$('#f-newcat').addEventListener('input', drawCats);
    m.$('#f-price').addEventListener('input', drawMargin);
    m.$('#f-cost').addEventListener('input', drawMargin);

    m.$('#f-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = m.$('#f-name').value.trim();
      const price = Number(m.$('#f-price').value);
      if (!name) return RD.toast('Enter an item name', 'error');
      if (!(price >= 0) || m.$('#f-price').value === '') return RD.toast('Enter a selling price', 'error');

      const payload = {
        name,
        category: m.$('#f-newcat').value.trim() || category,
        description: m.$('#f-desc').value.trim() || null,
        price,
        recipe_cost: Number(m.$('#f-cost').value) || 0,
        stock_qty: Number(m.$('#f-stock').value) || 0,
        unit: m.$('#f-unit').value.trim() || 'pcs',
        low_stock_threshold: Number(m.$('#f-low').value) || 0,
        track_stock: m.$('#f-track').checked,
        is_available: m.$('#f-avail').checked,
      };
      await RD.busy(e.submitter || m.$('button[type=submit]'), async () => {
        const q = editing
          ? RD.sb.from('inventory').update(payload).eq('id', item.id)
          : RD.sb.from('inventory').insert(payload);
        const { error } = await q;
        if (error) throw error;
        m.close();
        await refreshAll();
        RD.toast(editing ? `${name} updated` : `${name} added`);
      });
    });
  }

  /* ---------- wastage ---------- */
  function openWasteModal() {
    if (!state.inventory.length) return RD.toast('Add menu items before recording wastage', 'error');
    const m = RD.openModal({
      title: 'Record food wastage', size: 'max-w-md',
      html: `
      <form id="w-form" class="space-y-4" novalidate>
        <div><label class="label" for="w-item">Item</label>
          <select id="w-item" class="input">${state.inventory.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="w-qty">Quantity wasted</label><input id="w-qty" type="number" min="0.01" step="0.01" class="input" value="1"></div>
          <div><label class="label" for="w-reason">Reason</label>
            <select id="w-reason" class="input">${WASTE_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
        </div>
        <p class="text-xs text-slate-500">The cost is taken from the item's recipe cost, and stock is reduced automatically.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-close class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">Record wastage</button>
        </div>
      </form>`,
    });
    m.$('#w-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const qty = Number(m.$('#w-qty').value);
      if (!(qty > 0)) return RD.toast('Enter a quantity above zero', 'error');
      const itemId = m.$('#w-item').value;
      const it = state.inventory.find((i) => i.id === itemId);
      await RD.busy(e.submitter || m.$('button[type=submit]'), async () => {
        const { error } = await RD.sb.from('food_wastage').insert({
          item_id: itemId, item_name: it ? it.name : 'Item', quantity: qty, reason: m.$('#w-reason').value,
        });
        if (error) throw error;
        m.close();
        await refreshAll();
        RD.toast('Wastage recorded');
      });
    });
  }

  RD.views.menu = {
    async mount() {
      wire();
      await RD.loadInventory();
      renderCats();
      renderTable();
    },
    refresh(kind) {
      if (kind !== 'inventory') return;
      if (M.results) {
        const ids = new Set(M.results.map((r) => r.id));
        M.results = state.inventory.filter((i) => ids.has(i.id));
      }
      renderCats();
      renderTable();
    },
  };
})();
