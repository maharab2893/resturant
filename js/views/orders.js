/* Orders — searchable list, receipts, collect payment, cancel */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, esc } = RD;

  const O = { rows: [], wired: false, timer: null, seq: 0 };

  function wire() {
    if (O.wired) return;
    O.wired = true;
    ['#orders-status', '#orders-payment', '#orders-period'].forEach((s) =>
      $(s).addEventListener('change', () => load().catch(RD.fail)));
    $('#orders-search').addEventListener('input', () => {
      clearTimeout(O.timer);
      O.timer = setTimeout(() => load().catch(RD.fail), 250);
    });
    $('#orders-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'receipt') RD.openReceiptById(id);
      if (b.dataset.act === 'pay') collectPayment(id);
      if (b.dataset.act === 'cancel') cancelOrder(id);
    });
  }

  async function load() {
    const mine = ++O.seq;
    let q = RD.sb.from('orders')
      .select('id,tracking_no,order_type,table_name,customer_name,status,payment_status,payment_method,total,created_at')
      .order('created_at', { ascending: false }).limit(200);

    const status = $('#orders-status').value;
    const pay = $('#orders-payment').value;
    const period = $('#orders-period').value;
    const text = $('#orders-search').value.trim();

    if (status) q = q.eq('status', status);
    if (pay) q = q.eq('payment_status', pay);
    if (period !== 'all') {
      const days = period === 'today' ? 0 : Number(period) - 1;
      q = q.gte('created_at', RD.startOfDay(RD.addDays(new Date(), -days)).toISOString());
    }
    if (text) q = q.ilike('tracking_no', `%${RD.escLike(text)}%`);

    const { data, error } = await q;
    if (mine !== O.seq) return;
    if (error) throw error;
    O.rows = data;
    render();
  }

  function render() {
    $('#orders-count').textContent = `${O.rows.length} order${O.rows.length === 1 ? '' : 's'}${O.rows.length === 200 ? ' (showing latest 200)' : ''}`;
    $('#orders-body').innerHTML = O.rows.length
      ? O.rows.map((o) => {
          const cancellable = ['incoming', 'preparing', 'ready'].includes(o.status);
          const needsPay = o.payment_status === 'unpaid' && o.status !== 'cancelled';
          return `
          <tr class="hover:bg-slate-50/60">
            <td class="td font-semibold text-slate-900">${esc(o.tracking_no)}</td>
            <td class="td">${o.order_type === 'dine_in' ? esc(o.table_name || 'Dine-in') : 'Walk-in'}</td>
            <td class="td text-slate-500">${esc(o.customer_name || '—')}</td>
            <td class="td font-semibold">${RD.money(o.total)}</td>
            <td class="td">${RD.pill(o.status)}</td>
            <td class="td">${RD.pill(o.payment_status)}${o.payment_method && o.payment_status === 'paid' ? `<span class="ml-2 text-xs text-slate-400 capitalize">${esc(o.payment_method)}</span>` : ''}</td>
            <td class="td text-slate-500 whitespace-nowrap">${RD.fmtDateTime(o.created_at)}</td>
            <td class="td text-right whitespace-nowrap">
              <button data-act="receipt" data-id="${o.id}" class="btn btn-ghost btn-sm">Receipt</button>
              ${needsPay ? `<button data-act="pay" data-id="${o.id}" class="btn btn-soft btn-sm ml-1">Collect payment</button>` : ''}
              ${cancellable ? `<button data-act="cancel" data-id="${o.id}" class="btn btn-ghost btn-sm ml-1 !text-rose-600">Cancel</button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="8" class="td text-center text-slate-400 py-12">No orders match these filters.</td></tr>';
  }

  function collectPayment(id) {
    const o = O.rows.find((r) => r.id === id);
    if (!o) return;
    let method = 'cash';
    const m = RD.openModal({
      title: `Collect payment · ${o.tracking_no}`, size: 'max-w-sm',
      html: `
        <p class="text-sm text-slate-500">Amount due</p>
        <p class="text-3xl font-bold text-slate-900 mt-1">${RD.money(o.total)}</p>
        <div id="pay-method" class="seg seg-block mt-5">
          <button data-method="cash" class="active">Cash</button>
          <button data-method="card">Card</button>
          <button data-method="mobile">Mobile</button>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button data-close class="btn btn-ghost">Cancel</button>
          <button id="pay-confirm" class="btn btn-primary">Mark as paid</button>
        </div>`,
    });
    m.$('#pay-method').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-method]');
      if (!b) return;
      method = b.dataset.method;
      m.$$('#pay-method button').forEach((x) => x.classList.toggle('active', x === b));
    });
    m.$('#pay-confirm').addEventListener('click', (e) => RD.busy(e.currentTarget, async () => {
      const { error } = await RD.sb.from('orders').update({ payment_status: 'paid', payment_method: method }).eq('id', id);
      if (error) throw error;
      m.close();
      RD.toast(`${o.tracking_no} marked as paid`);
      await load();
    }));
  }

  async function cancelOrder(id) {
    const o = O.rows.find((r) => r.id === id);
    if (!o) return;
    const msg = o.payment_status === 'paid'
      ? `Cancel ${o.tracking_no}? It is already paid, so remember to refund the customer. Stock will be returned.`
      : `Cancel ${o.tracking_no}? Stock will be returned to inventory.`;
    if (!(await RD.confirm(msg, { title: 'Cancel this order?', confirmLabel: 'Cancel order' }))) return;
    try {
      const { error } = await RD.sb.from('orders').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      RD.toast(`${o.tracking_no} cancelled`);
      await load();
      await RD.loadInventory();
    } catch (e) { RD.fail(e); }
  }

  RD.views.orders = {
    async mount() { wire(); await load(); },
    async refresh() { await load(); },
  };
})();
