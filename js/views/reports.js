/* Reports & analytics — daily sales, monthly revenue, top sellers, wastage, CSV export */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc } = RD;

  const R = { data: null, wired: false, loading: false, seq: 0 };

  function setRange(from, to) {
    $('#rep-from').value = RD.dayKey(from);
    $('#rep-to').value = RD.dayKey(to);
  }

  function wire() {
    if (R.wired) return;
    R.wired = true;

    $('#rep-presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-preset]');
      if (!b) return;
      applyPreset(b.dataset.preset);
      load().catch(RD.fail);
    });
    ['#rep-from', '#rep-to'].forEach((s) => $(s).addEventListener('change', () => {
      $$('#rep-presets button').forEach((x) => x.classList.remove('active'));
      load().catch(RD.fail);
    }));
    $('#rep-export-daily').addEventListener('click', exportDaily);
    $('#rep-export-top').addEventListener('click', exportTop);
    $('#rep-export-waste').addEventListener('click', exportWaste);
  }

  function applyPreset(p) {
    const today = new Date();
    if (p === 'today') setRange(today, today);
    else if (p === 'month') setRange(new Date(today.getFullYear(), today.getMonth(), 1), today);
    else setRange(RD.addDays(today, -(Number(p) - 1)), today);
    $$('#rep-presets button').forEach((x) => x.classList.toggle('active', x.dataset.preset === p));
  }

  async function load() {
    const mine = ++R.seq;
    let from = RD.parseDay($('#rep-from').value);
    let to = RD.parseDay($('#rep-to').value);
    if (isNaN(from) || isNaN(to)) return;
    if (from > to) [from, to] = [to, from];
    const startISO = from.toISOString();
    const endISO = RD.addDays(to, 1).toISOString(); // exclusive upper bound
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);

    const [orders, items, waste, monthly] = await Promise.all([
      RD.fetchAll(() => RD.sb.from('orders')
        .select('id,created_at,total,tax_amount,status,payment_status,payment_method')
        .gte('created_at', startISO).lt('created_at', endISO).neq('status', 'cancelled')
        .order('created_at', { ascending: false }).order('id')),
      RD.fetchAll(() => RD.sb.from('order_items')
        .select('id,item_name,category,quantity,line_total,unit_cost,orders!inner(created_at,status,payment_status)')
        .gte('orders.created_at', startISO).lt('orders.created_at', endISO)
        .eq('orders.payment_status', 'paid').neq('orders.status', 'cancelled').order('id')),
      RD.fetchAll(() => RD.sb.from('food_wastage').select('*')
        .gte('created_at', startISO).lt('created_at', endISO)
        .order('created_at', { ascending: false }).order('id')),
      RD.fetchAll(() => RD.sb.from('orders').select('id,created_at,total')
        .gte('created_at', monthStart.toISOString()).eq('payment_status', 'paid').neq('status', 'cancelled')
        .order('created_at').order('id')),
    ]);
    if (mine !== R.seq) return; // a newer request replaced this one
    R.data = { from, to, orders, items, waste, monthly };
    render();
  }

  function compute() {
    const { from, to, orders, items, waste } = R.data;
    const paid = orders.filter((o) => o.payment_status === 'paid');
    const revenue = paid.reduce((s, o) => s + Number(o.total), 0);
    const tax = paid.reduce((s, o) => s + Number(o.tax_amount), 0);
    const cogs = items.reduce((s, i) => s + Number(i.unit_cost) * i.quantity, 0);
    const wasteCost = waste.reduce((s, w) => s + Number(w.total_cost), 0);

    const days = new Map();
    for (let d = new Date(from); d <= to; d = RD.addDays(d, 1)) days.set(RD.dayKey(d), { orders: 0, paidOrders: 0, revenue: 0, tax: 0 });
    for (const o of orders) {
      const s = days.get(RD.dayKey(o.created_at));
      if (!s) continue;
      s.orders += 1;
      if (o.payment_status === 'paid') { s.paidOrders += 1; s.revenue += Number(o.total); s.tax += Number(o.tax_amount); }
    }

    const top = new Map();
    const cats = new Map();
    for (const i of items) {
      const t = top.get(i.item_name) || { name: i.item_name, qty: 0, revenue: 0, cost: 0 };
      t.qty += i.quantity; t.revenue += Number(i.line_total); t.cost += Number(i.unit_cost) * i.quantity;
      top.set(i.item_name, t);
      const c = i.category || 'Other';
      cats.set(c, (cats.get(c) || 0) + Number(i.line_total));
    }

    const pay = new Map();
    for (const o of paid) {
      const k = o.payment_method ? o.payment_method[0].toUpperCase() + o.payment_method.slice(1) : 'Unknown';
      pay.set(k, (pay.get(k) || 0) + Number(o.total));
    }

    const wasteByItem = new Map();
    for (const w of waste) {
      const e = wasteByItem.get(w.item_name) || { name: w.item_name, qty: 0, cost: 0, reasons: new Map() };
      e.qty += Number(w.quantity); e.cost += Number(w.total_cost);
      const r = w.reason || 'Other';
      e.reasons.set(r, (e.reasons.get(r) || 0) + 1);
      wasteByItem.set(w.item_name, e);
    }

    // last 12 months, oldest → newest
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${RD.pad(d.getMonth() + 1)}`, label: d.toLocaleDateString([], { month: 'short', year: '2-digit' }), revenue: 0 });
    }
    for (const o of R.data.monthly) {
      const d = new Date(o.created_at);
      const m = months.find((x) => x.key === `${d.getFullYear()}-${RD.pad(d.getMonth() + 1)}`);
      if (m) m.revenue += Number(o.total);
    }

    return {
      paidCount: paid.length, orderCount: orders.length, revenue, tax, cogs, wasteCost, days, months,
      top: Array.from(top.values()).sort((a, b) => b.qty - a.qty),
      cats: Array.from(cats, ([label, value]) => ({ label, value })),
      pay: Array.from(pay, ([label, value]) => ({ label, value })),
      waste: Array.from(wasteByItem.values()).sort((a, b) => b.cost - a.cost),
    };
  }

  function render() {
    const c = (R.data.computed = compute());
    const grossProfit = c.revenue - c.tax - c.cogs;
    const kpi = (label, value, sub, tint) => `
      <div class="card p-5">
        <p class="text-sm font-medium text-slate-500">${label}</p>
        <p class="mt-2 text-2xl font-bold tracking-tight ${tint}">${value}</p>
        <p class="mt-1 text-xs text-slate-400">${sub}</p>
      </div>`;
    $('#rep-kpis').innerHTML =
      kpi('Revenue', RD.money(c.revenue), `${c.paidCount} paid orders`, 'text-slate-900') +
      kpi('Orders', c.orderCount, 'Excludes cancelled', 'text-slate-900') +
      kpi('Average order', RD.money(c.paidCount ? c.revenue / c.paidCount : 0), 'Paid orders only', 'text-slate-900') +
      kpi('Gross profit', RD.money(grossProfit), 'Revenue − tax − recipe cost', grossProfit >= 0 ? 'text-brand-600' : 'text-rose-600') +
      kpi('Wastage cost', RD.money(c.wasteCost), `${R.data.waste.length} entries`, c.wasteCost > 0 ? 'text-rose-600' : 'text-slate-900');

    const keys = Array.from(c.days.keys());
    RD.areaChart('chart-rep-daily', keys.map((k) => RD.fmtDay(RD.parseDay(k))), keys.map((k) => RD.round2(c.days.get(k).revenue)),
      { color: '#12b76a', label: 'Revenue' });
    RD.areaChart('chart-rep-monthly', c.months.map((m) => m.label), c.months.map((m) => RD.round2(m.revenue)),
      { color: '#6366f1', label: 'Revenue' });
    RD.donutChart('chart-rep-category', c.cats, { legendId: 'rep-category-legend', centerId: 'chart-rep-category-center' });
    RD.donutChart('chart-rep-payment', c.pay, { legendId: 'rep-payment-legend', centerId: 'chart-rep-payment-center' });

    $('#rep-daily-body').innerHTML = keys.slice().reverse().map((k) => {
      const s = c.days.get(k);
      return `<tr>
        <td class="td font-medium text-slate-800">${RD.fmtDate(RD.parseDay(k))}</td>
        <td class="td">${s.orders}</td>
        <td class="td font-semibold">${RD.money(s.revenue)}</td>
        <td class="td text-slate-500">${RD.money(s.tax)}</td>
        <td class="td text-slate-500">${RD.money(s.paidOrders ? s.revenue / s.paidOrders : 0)}</td>
      </tr>`;
    }).join('');

    $('#rep-top-body').innerHTML = c.top.length
      ? c.top.slice(0, 25).map((t, i) => `
        <tr>
          <td class="td"><span class="text-slate-400 text-xs mr-2 tabular-nums">${i + 1}</span><span class="font-semibold text-slate-900">${esc(t.name)}</span></td>
          <td class="td">${t.qty}</td>
          <td class="td font-semibold">${RD.money(t.revenue)}</td>
          <td class="td ${t.revenue - t.cost >= 0 ? 'text-brand-600' : 'text-rose-600'} font-semibold">${RD.money(t.revenue - t.cost)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="td text-center text-slate-400 py-10">No paid sales in this period.</td></tr>';

    $('#rep-waste-total').textContent = c.waste.length ? `${RD.money(c.wasteCost)} lost in this period` : 'No wastage recorded in this period';
    $('#rep-waste-body').innerHTML = c.waste.length
      ? c.waste.map((w) => {
          const reason = Array.from(w.reasons.entries()).sort((a, b) => b[1] - a[1])[0][0];
          return `<tr>
            <td class="td font-semibold text-slate-900">${esc(w.name)}</td>
            <td class="td">${w.qty}</td>
            <td class="td text-rose-600 font-semibold">${RD.money(w.cost)}</td>
            <td class="td text-slate-500">${esc(reason)}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="td text-center text-slate-400 py-10">Nothing wasted. Record wastage from Menu & Inventory.</td></tr>';
  }

  /* ---------- exports ---------- */
  const stamp = () => `${$('#rep-from').value}_to_${$('#rep-to').value}`;

  function exportDaily() {
    if (!R.data) return;
    const c = R.data.computed;
    RD.downloadCSV(`daily-sales_${stamp()}.csv`, ['Date', 'Orders', 'Paid orders', 'Revenue', 'Tax collected', 'Average order'],
      Array.from(c.days, ([k, s]) => [k, s.orders, s.paidOrders, s.revenue.toFixed(2), s.tax.toFixed(2), (s.paidOrders ? s.revenue / s.paidOrders : 0).toFixed(2)]));
  }
  function exportTop() {
    if (!R.data || !R.data.computed.top.length) return RD.toast('No sales to export for this period', 'info');
    RD.downloadCSV(`top-items_${stamp()}.csv`, ['Rank', 'Item', 'Quantity sold', 'Revenue', 'Recipe cost', 'Gross profit'],
      R.data.computed.top.map((t, i) => [i + 1, t.name, t.qty, t.revenue.toFixed(2), t.cost.toFixed(2), (t.revenue - t.cost).toFixed(2)]));
  }
  function exportWaste() {
    if (!R.data || !R.data.waste.length) return RD.toast('No wastage to export for this period', 'info');
    RD.downloadCSV(`food-wastage_${stamp()}.csv`, ['Date', 'Item', 'Quantity', 'Unit cost', 'Total cost', 'Reason'],
      R.data.waste.map((w) => [new Date(w.created_at).toLocaleString(), w.item_name, w.quantity, Number(w.unit_cost).toFixed(2), Number(w.total_cost).toFixed(2), w.reason || '']));
  }

  RD.views.reports = {
    async mount() {
      wire();
      if (!$('#rep-from').value) applyPreset('30');
      await load();
    },
    async refresh(kind) { if (kind === 'orders') await load(); },
  };
})();
