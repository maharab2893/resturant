/* Dashboard — live KPIs, revenue chart, category donut, peak hours */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc, state } = RD;
  const sb = () => RD.sb;

  const D = { range: 7, metric: 'revenue', data: null, wired: false, loading: false };

  function wire() {
    if (D.wired) return;
    D.wired = true;
    $('#dash-range').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-range]');
      if (!b) return;
      D.range = Number(b.dataset.range);
      $$('#dash-range button').forEach((x) => x.classList.toggle('active', x === b));
      load().catch(RD.fail);
    });
    $('#dash-metric').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-metric]');
      if (!b) return;
      D.metric = b.dataset.metric;
      $$('#dash-metric button').forEach((x) => x.classList.toggle('active', x === b));
      drawRevenue();
    });
    $('#dash-recent').addEventListener('click', (e) => {
      const row = e.target.closest('[data-order]');
      if (row) RD.openReceiptById(row.dataset.order);
    });
  }

  const delta = (cur, prev, label) => {
    if (!prev) return `<span class="text-slate-400">${label}</span>`;
    const pct = ((cur - prev) / prev) * 100;
    const up = pct >= 0;
    return `<span class="${up ? 'text-brand-600' : 'text-rose-600'} font-semibold">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span> <span class="text-slate-400">${label}</span>`;
  };

  const kpi = (label, value, sub, icon, tint) => `
    <div class="card p-6">
      <div class="flex items-start justify-between">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-500">${esc(label)}</p>
          <p class="mt-2 text-3xl font-bold tracking-tight text-slate-900 truncate">${value}</p>
        </div>
        <div class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tint}">${RD.icon(icon, 'w-5 h-5')}</div>
      </div>
      <p class="mt-3 text-sm">${sub}</p>
    </div>`;

  async function load() {
    if (D.loading) return;
    D.loading = true;
    try {
      const since = RD.startOfDay(RD.addDays(new Date(), -(D.range - 1)));
      const iso = since.toISOString();

      const [orders, items, recent, shift, occupied] = await Promise.all([
        RD.fetchAll(() => sb().from('orders').select('id,created_at,total,status,payment_status')
          .gte('created_at', iso).neq('status', 'cancelled')
          .order('created_at', { ascending: false }).order('id')),
        RD.fetchAll(() => sb().from('order_items')
          .select('id,category,line_total,orders!inner(created_at,status,payment_status)')
          .gte('orders.created_at', iso).eq('orders.payment_status', 'paid').neq('orders.status', 'cancelled')
          .order('id')),
        sb().from('orders')
          .select('id,tracking_no,order_type,table_name,customer_name,total,status,payment_status,created_at')
          .order('created_at', { ascending: false }).limit(6),
        sb().from('employee_attendance').select('id,check_in,profiles(full_name,role)')
          .is('check_out', null).order('check_in'),
        sb().from('orders').select('table_id').not('table_id', 'is', null)
          .neq('status', 'cancelled').or('payment_status.eq.unpaid,status.neq.completed'),
      ]);

      // Bucket orders per local day and per hour of day
      const byDay = new Map();
      for (let i = 0; i < D.range; i++) byDay.set(RD.dayKey(RD.addDays(since, i)), { revenue: 0, orders: 0 });
      const byHour = Array(24).fill(0);
      for (const o of orders) {
        const d = new Date(o.created_at);
        const slot = byDay.get(RD.dayKey(d));
        if (slot) {
          slot.orders += 1;
          if (o.payment_status === 'paid') slot.revenue += Number(o.total);
        }
        byHour[d.getHours()] += 1;
      }

      const cats = new Map();
      for (const it of items) {
        const k = it.category || 'Other';
        cats.set(k, (cats.get(k) || 0) + Number(it.line_total));
      }

      D.data = {
        byDay, byHour,
        cats: Array.from(cats, ([label, value]) => ({ label, value })),
        paidToday: orders.filter((o) => o.payment_status === 'paid' && RD.dayKey(o.created_at) === RD.dayKey(new Date())).length,
        recent: RD.must(recent),
        shift: RD.must(shift),
        occupied: new Set(RD.must(occupied).map((r) => r.table_id)).size,
      };
      render();
    } finally {
      D.loading = false;
    }
  }

  function render() {
    const d = D.data;
    if (!d) return;
    const todayKey = RD.dayKey(new Date());
    const yKey = RD.dayKey(RD.addDays(new Date(), -1));
    const today = d.byDay.get(todayKey) || { revenue: 0, orders: 0 };
    const yest = d.byDay.get(yKey) || { revenue: 0, orders: 0 };
    const avg = d.paidToday ? today.revenue / d.paidToday : 0;
    const totalTables = state.tables.filter((t) => t.is_active).length;

    $('#dash-kpis').innerHTML =
      kpi('Revenue today', RD.money(today.revenue), delta(today.revenue, yest.revenue, 'vs yesterday'), 'trend', 'bg-brand-50 text-brand-600') +
      kpi('Orders today', today.orders, delta(today.orders, yest.orders, 'vs yesterday'), 'clipboard', 'bg-indigo-50 text-indigo-600') +
      kpi('Active tables', `${d.occupied}<span class="text-lg font-semibold text-slate-400"> / ${totalTables}</span>`, '<span class="text-slate-400">Open dine-in orders</span>', 'table', 'bg-amber-50 text-amber-600') +
      kpi('Average order', RD.money(avg), '<span class="text-slate-400">Paid orders today</span>', 'receipt', 'bg-cyan-50 text-cyan-600');

    drawRevenue();

    RD.donutChart('chart-category', d.cats, { legendId: 'chart-category-legend', centerId: 'chart-category-center' });

    RD.areaChart('chart-peak', Array.from({ length: 24 }, (_, h) => RD.hourLabel(h)), d.byHour,
      { color: '#6366f1', label: 'Orders', isMoney: false });
    const max = Math.max(...d.byHour);
    $('#dash-peak-sub').textContent = max > 0
      ? `Busiest hour: ${RD.hourLabel(d.byHour.indexOf(max))} with ${max} order${max === 1 ? '' : 's'} (last ${D.range} days)`
      : `No orders in the last ${D.range} days yet`;

    $('#dash-onshift').innerHTML = d.shift.length
      ? d.shift.map((s) => `
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">${esc(RD.initials(s.profiles?.full_name))}</div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-slate-800 truncate">${esc(s.profiles?.full_name || 'Unknown')}</div>
            <div class="text-xs text-slate-400 capitalize">${esc(s.profiles?.role || '')}</div>
          </div>
          <span class="text-xs text-slate-500">since ${RD.fmtTime(s.check_in)}</span>
        </div>`).join('')
      : '<p class="text-sm text-slate-400 py-4 text-center">Nobody has checked in yet.</p>';

    $('#dash-recent').innerHTML = d.recent.length
      ? d.recent.map((o) => `
        <div data-order="${o.id}" class="flex items-center gap-4 py-3 cursor-pointer hover:bg-slate-50 -mx-3 px-3 rounded-xl">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-slate-900">${esc(o.tracking_no)}</div>
            <div class="text-xs text-slate-400 truncate">${o.order_type === 'dine_in' ? esc(o.table_name || 'Dine-in') : 'Walk-in'}${o.customer_name ? ' · ' + esc(o.customer_name) : ''} · ${RD.fmtTime(o.created_at)}</div>
          </div>
          <div class="text-right space-y-1">
            <div class="text-sm font-semibold text-slate-800">${RD.money(o.total)}</div>
            ${RD.pill(o.status)}
          </div>
        </div>`).join('')
      : '<p class="text-sm text-slate-400 py-6 text-center">No orders yet. New orders appear here as they come in.</p>';

    const low = state.inventory
      .filter((i) => i.track_stock && i.stock_qty <= i.low_stock_threshold)
      .sort((a, b) => a.stock_qty - b.stock_qty).slice(0, 6);
    $('#dash-lowstock').innerHTML = low.length
      ? low.map((i) => `
        <div class="flex items-center justify-between py-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-slate-800 truncate">${esc(i.name)}</div>
            <div class="text-xs text-slate-400">${esc(i.category)}</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm text-slate-600">${i.stock_qty} ${esc(i.unit)}</span>
            <span class="pill ${i.stock_qty <= 0 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}">${i.stock_qty <= 0 ? 'Out' : 'Low'}</span>
          </div>
        </div>`).join('')
      : '<p class="text-sm text-slate-400 py-6 text-center">Everything is stocked above its alert level.</p>';
  }

  function drawRevenue() {
    const d = D.data;
    if (!d) return;
    const keys = Array.from(d.byDay.keys());
    const labels = keys.map((k) => RD.fmtDay(RD.parseDay(k)));
    const isRev = D.metric === 'revenue';
    const values = keys.map((k) => (isRev ? RD.round2(d.byDay.get(k).revenue) : d.byDay.get(k).orders));
    const total = values.reduce((s, v) => s + v, 0);
    RD.areaChart('chart-revenue', labels, values, {
      color: isRev ? '#12b76a' : '#6366f1', label: isRev ? 'Revenue' : 'Orders', isMoney: isRev,
    });
    $('#dash-rev-sub').textContent = isRev
      ? `${RD.money(total)} paid revenue in the last ${D.range} days`
      : `${total} orders in the last ${D.range} days`;
  }

  RD.views.dashboard = {
    async mount() { wire(); await load(); },
    async refresh() { await load(); },
  };
})();
