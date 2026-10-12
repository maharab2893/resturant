/* Kitchen Display System — Incoming → Preparing → Ready → Completed */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc } = RD;

  const STAGES = [
    { id: 'incoming', title: 'Incoming', dot: 'bg-amber-400', next: 'preparing', cta: 'Start preparing' },
    { id: 'preparing', title: 'Preparing', dot: 'bg-sky-500', next: 'ready', cta: 'Mark ready' },
    { id: 'ready', title: 'Ready', dot: 'bg-brand-500', next: 'completed', cta: 'Complete order' },
    { id: 'completed', title: 'Completed today', dot: 'bg-slate-400', next: null, cta: '' },
  ];

  const K = { orders: [], wired: false, timer: null, loading: false };

  function wire() {
    if (K.wired) return;
    K.wired = true;
    const board = $('#kds-board');

    board.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'advance') move(id, b.dataset.next);
      if (b.dataset.act === 'cancel') cancel(id);
      if (b.dataset.act === 'receipt') RD.openReceiptById(id);
    });

    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.kds-card');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    board.addEventListener('dragend', (e) => {
      const card = e.target.closest('.kds-card');
      if (card) card.classList.remove('dragging');
      $$('.kds-col', board).forEach((c) => c.classList.remove('drag-over'));
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.kds-col');
      if (!col) return;
      e.preventDefault();
      $$('.kds-col', board).forEach((c) => c.classList.toggle('drag-over', c === col));
    });
    board.addEventListener('drop', (e) => {
      const col = e.target.closest('.kds-col');
      if (!col) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      col.classList.remove('drag-over');
      if (id) move(id, col.dataset.status);
    });

    $('#kds-refresh').addEventListener('click', () => load().catch(RD.fail));
  }

  async function load() {
    if (K.loading) return;
    K.loading = true;
    try {
      const sel = '*, order_items(item_name, quantity)';
      const [active, done] = await Promise.all([
        RD.sb.from('orders').select(sel).in('status', ['incoming', 'preparing', 'ready']).order('created_at'),
        RD.sb.from('orders').select(sel).eq('status', 'completed')
          .gte('completed_at', RD.startOfDay().toISOString()).order('completed_at', { ascending: false }).limit(30),
      ]);
      K.orders = [...RD.must(active), ...RD.must(done)];
      render();
    } finally {
      K.loading = false;
    }
  }

  function cardHTML(o, stage) {
    const items = (o.order_items || []).map((i) => `
      <li class="flex gap-2 text-sm">
        <span class="font-bold text-brand-700 w-7 shrink-0">${i.quantity}×</span>
        <span class="text-slate-700">${esc(i.item_name)}</span>
      </li>`).join('');
    const where = o.order_type === 'dine_in' ? esc(o.table_name || 'Dine-in') : 'Walk-in';
    const time = stage.id === 'completed'
      ? `<span class="pill bg-slate-100 text-slate-500">Done ${RD.fmtTime(o.completed_at || o.updated_at)}</span>`
      : `<span class="pill elapsed" data-since="${o.created_at}"></span>`;
    const canCancel = stage.id !== 'completed';
    return `
      <div class="kds-card bg-white rounded-2xl border border-slate-100 shadow-sm p-4" draggable="true" data-id="${o.id}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-base font-bold text-slate-900">${esc(o.tracking_no)}</div>
            <div class="text-xs text-slate-500 truncate">${where}${o.customer_name ? ' · ' + esc(o.customer_name) : ''}</div>
          </div>
          ${time}
        </div>
        <ul class="mt-3 space-y-1.5">${items}</ul>
        ${o.notes ? `<div class="mt-3 rounded-xl bg-amber-50 text-amber-800 text-xs px-3 py-2">${esc(o.notes)}</div>` : ''}
        <div class="mt-4 flex items-center gap-2">
          ${stage.next
            ? `<button data-act="advance" data-id="${o.id}" data-next="${stage.next}" class="btn btn-primary btn-sm flex-1">${stage.cta}</button>`
            : `<button data-act="receipt" data-id="${o.id}" class="btn btn-ghost btn-sm flex-1">Receipt</button>`}
          ${canCancel ? `<button data-act="cancel" data-id="${o.id}" class="btn btn-ghost btn-sm !px-2.5 !text-rose-600" title="Cancel order" aria-label="Cancel order">${RD.icon('x', 'w-4 h-4')}</button>` : ''}
        </div>
      </div>`;
  }

  function render() {
    $('#kds-board').innerHTML = STAGES.map((s) => {
      const list = K.orders.filter((o) => o.status === s.id);
      return `
        <div class="kds-col" data-status="${s.id}">
          <div class="flex items-center justify-between px-1 pb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full ${s.dot}"></span>
              <h3 class="font-semibold text-slate-800">${s.title}</h3>
            </div>
            <span class="pill bg-white text-slate-600 shadow-sm">${list.length}</span>
          </div>
          <div class="space-y-3">
            ${list.length ? list.map((o) => cardHTML(o, s)).join('') : '<p class="text-center text-sm text-slate-400 py-8">No orders</p>'}
          </div>
        </div>`;
    }).join('');
    tick();
  }

  /* Elapsed-time badges: amber after 10 min, red after 20 min */
  function tick() {
    $$('.elapsed').forEach((el) => {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.since).getTime()) / 60000));
      el.textContent = mins < 1 ? 'Just now' : `${mins} min`;
      el.className = 'pill elapsed ' + (mins >= 20 ? 'bg-rose-50 text-rose-700' : mins >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600');
    });
  }

  async function move(id, status) {
    const o = K.orders.find((x) => x.id === id);
    if (!o || o.status === status) return;
    const before = o.status;
    o.status = status;
    if (status === 'completed') o.completed_at = new Date().toISOString();
    render();
    const { error } = await RD.sb.from('orders').update({ status }).eq('id', id);
    if (error) {
      o.status = before;
      render();
      RD.fail(error);
    }
  }

  async function cancel(id) {
    const o = K.orders.find((x) => x.id === id);
    if (!o) return;
    if (!(await RD.confirm(`Cancel ${o.tracking_no}? Stock will be returned to inventory.`, { title: 'Cancel this order?', confirmLabel: 'Cancel order' }))) return;
    const { error } = await RD.sb.from('orders').update({ status: 'cancelled' }).eq('id', id);
    if (error) return RD.fail(error);
    K.orders = K.orders.filter((x) => x.id !== id);
    render();
    RD.toast(`${o.tracking_no} cancelled`);
  }

  RD.views.kitchen = {
    async mount() {
      wire();
      await load();
      clearInterval(K.timer);
      K.timer = setInterval(tick, 30000);
    },
    unmount() { clearInterval(K.timer); },
    async refresh() { await load(); },
  };
})();
