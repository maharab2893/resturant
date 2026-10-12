/* Settings — restaurant details, dining tables, team access */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, esc, state } = RD;

  const S = { team: [], inUse: new Set(), wired: false };
  const ROLES = [
    ['admin', 'Admin: full access'],
    ['cashier', 'Cashier: POS, orders, kitchen, attendance'],
    ['kitchen', 'Kitchen: kitchen board, attendance'],
    ['staff', 'Staff: attendance, kitchen board'],
  ];

  function wire() {
    if (S.wired) return;
    S.wired = true;

    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      RD.busy(e.submitter || $('#settings-form button[type=submit]'), async () => {
        const payload = {
          restaurant_name: $('#set-name').value.trim() || 'My Restaurant',
          address: $('#set-address').value.trim(),
          phone: $('#set-phone').value.trim(),
          currency: $('#set-currency').value.trim() || '$',
          tax_rate: Math.min(100, Math.max(0, Number($('#set-tax').value) || 0)),
          receipt_footer: $('#set-footer').value.trim(),
        };
        const { error } = await RD.sb.from('settings').update(payload).eq('id', 1);
        if (error) throw error;
        Object.assign(state.settings, payload);
        $('#side-brand').textContent = payload.restaurant_name;
        RD.toast('Settings saved');
      });
    });

    $('#tables-add').addEventListener('click', () => openTableModal());
    $('#tables-body').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const t = state.tables.find((x) => x.id === b.dataset.id);
      if (!t) return;
      if (b.dataset.act === 'edit') openTableModal(t);
      if (b.dataset.act === 'delete') {
        if (!(await RD.confirm(`Delete ${t.name}? Past orders keep the table name.`, { title: 'Delete table?', confirmLabel: 'Delete table' }))) return;
        try {
          const { error } = await RD.sb.from('restaurant_tables').delete().eq('id', t.id);
          if (error) throw error;
          await RD.loadTables();
          renderTables();
          RD.toast(`${t.name} deleted`);
        } catch (err) { RD.fail(err); }
      }
    });

    $('#team-body').addEventListener('change', async (e) => {
      const el = e.target;
      const id = el.dataset.id;
      if (!id) return;
      const patch = el.matches('select[data-role]') ? { role: el.value } : el.matches('input[data-active]') ? { is_active: el.checked } : null;
      if (!patch) return;
      const { error } = await RD.sb.from('profiles').update(patch).eq('id', id);
      if (error) { RD.fail(error); return loadTeam(); }
      RD.toast('Team member updated');
      await loadTeam();
    });
  }

  function fillForm() {
    const s = state.settings;
    $('#set-name').value = s.restaurant_name;
    $('#set-address').value = s.address || '';
    $('#set-phone').value = s.phone || '';
    $('#set-currency').value = s.currency;
    $('#set-tax').value = s.tax_rate;
    $('#set-footer').value = s.receipt_footer || '';
  }

  /* ---------- dining tables ---------- */
  async function loadInUse() {
    const { data, error } = await RD.sb.from('orders').select('table_id').not('table_id', 'is', null)
      .neq('status', 'cancelled').or('payment_status.eq.unpaid,status.neq.completed');
    if (error) throw error;
    S.inUse = new Set(data.map((r) => r.table_id));
  }

  function renderTables() {
    $('#tables-body').innerHTML = state.tables.length
      ? state.tables.map((t) => `
        <tr>
          <td class="td font-semibold text-slate-900">${esc(t.name)}${t.is_active ? '' : ' <span class="pill bg-slate-100 text-slate-500 ml-2">Hidden</span>'}</td>
          <td class="td">${t.seats}</td>
          <td class="td">${S.inUse.has(t.id) ? '<span class="pill bg-amber-50 text-amber-700">Occupied</span>' : '<span class="pill bg-brand-50 text-brand-700">Free</span>'}</td>
          <td class="td text-right whitespace-nowrap">
            <button data-act="edit" data-id="${t.id}" class="btn btn-ghost btn-sm">Edit</button>
            <button data-act="delete" data-id="${t.id}" class="btn btn-ghost btn-sm ml-1 !text-rose-600">Delete</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="td text-center text-slate-400 py-10">No tables yet. Add one to take dine-in orders.</td></tr>';
  }

  function openTableModal(t) {
    const editing = !!t;
    const m = RD.openModal({
      title: editing ? 'Edit table' : 'Add table', size: 'max-w-sm',
      html: `
      <form id="t-form" class="space-y-4" novalidate>
        <div><label class="label" for="t-name">Name</label><input id="t-name" class="input" value="${esc(t?.name || '')}" placeholder="Table 11" required></div>
        <div><label class="label" for="t-seats">Seats</label><input id="t-seats" type="number" min="1" step="1" class="input" value="${t?.seats || 4}"></div>
        <label class="flex items-center gap-3 text-sm font-medium text-slate-700">${RD.toggleHTML('id="t-active"', t ? t.is_active : true)} Available for orders</label>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-close class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add table'}</button>
        </div>
      </form>`,
    });
    m.$('#t-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = m.$('#t-name').value.trim();
      if (!name) return RD.toast('Enter a table name', 'error');
      RD.busy(e.submitter || m.$('button[type=submit]'), async () => {
        const payload = { name, seats: Math.max(1, parseInt(m.$('#t-seats').value, 10) || 1), is_active: m.$('#t-active').checked };
        const q = editing ? RD.sb.from('restaurant_tables').update(payload).eq('id', t.id) : RD.sb.from('restaurant_tables').insert(payload);
        const { error } = await q;
        if (error) throw new Error(/duplicate/i.test(error.message) ? 'A table with that name already exists' : error.message);
        m.close();
        await RD.loadTables();
        renderTables();
        RD.toast(editing ? `${name} updated` : `${name} added`);
      });
    });
  }

  /* ---------- team ---------- */
  async function loadTeam() {
    const { data, error } = await RD.sb.from('profiles').select('*').order('created_at');
    if (error) throw error;
    S.team = data;
    $('#team-body').innerHTML = data.map((p) => {
      const me = p.id === state.user.id;
      return `
      <tr>
        <td class="td"><div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">${esc(RD.initials(p.full_name || p.email))}</div>
          <div class="font-semibold text-slate-900">${esc(p.full_name || '—')}${me ? ' <span class="pill bg-slate-100 text-slate-500 ml-1">You</span>' : ''}${!p.is_active ? ' <span class="pill bg-amber-50 text-amber-700 ml-1">Pending</span>' : ''}</div></div></td>
        <td class="td text-slate-500">${esc(p.email || '')}</td>
        <td class="td">
          <select data-role data-id="${p.id}" class="input !w-auto !py-2" ${me ? 'disabled' : ''}>
            ${ROLES.map(([v, l]) => `<option value="${v}" ${p.role === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </td>
        <td class="td">${RD.toggleHTML(`data-active data-id="${p.id}" aria-label="Active" ${me ? 'disabled' : ''}`, p.is_active)}</td>
      </tr>`;
    }).join('');
  }

  RD.views.settings = {
    async mount() {
      wire();
      fillForm();
      await Promise.all([RD.loadTables(), loadInUse(), loadTeam()]);
      renderTables();
    },
    async refresh(kind) {
      if (kind === 'orders') { await loadInUse(); renderTables(); }
    },
  };
})();
