/* core.js — shared state, helpers, UI primitives, charts, smart search, receipts */
(() => {
  'use strict';
  const RD = (window.RD = window.RD || {});
  const CFG = window.APP_CONFIG || {};

  /* ---------------- Supabase client ---------------- */
  RD.configured = !!(
    CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    !/YOUR-/i.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY) && window.supabase
  );
  RD.sb = RD.configured
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

  RD.views = {};
  RD.state = {
    user: null,
    profile: null,
    settings: {
      restaurant_name: 'RestoDesk', address: '', phone: '', currency: '$',
      tax_rate: 5, receipt_footer: 'Thank you for dining with us!',
    },
    inventory: [],
    tables: [],
    route: null,
    charts: {},
  };
  const state = RD.state;

  /* ---------------- DOM + formatting helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  RD.$ = $;
  RD.$$ = $$;
  RD.esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = RD.esc;

  RD.escLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
  RD.round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  RD.money = (n) =>
    state.settings.currency +
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  RD.compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const pad = (n) => String(n).padStart(2, '0');
  RD.pad = pad;
  RD.dayKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  RD.startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  RD.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  RD.parseDay = (s) => new Date(`${s}T00:00:00`);
  RD.fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  RD.fmtDate = (d) => new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  RD.fmtDay = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  RD.fmtDateTime = (d) =>
    new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  RD.fmtHours = (h) => {
    const m = Math.max(0, Math.round(h * 60));
    return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  };
  RD.hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  RD.initials = (name) =>
    String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

  /* ---------------- Icons ---------------- */
  const ICONS = {
    home: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10',
    cart: 'M3 3h2l.4 2M7 13h10l3-8H5.4M7 13L5.4 5M7 13l-2 5h13M9 21a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
    clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 12h6M9 16h4',
    board: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
    box: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    sliders: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
    logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    menu: 'M4 6h16M4 12h16M4 18h16',
    search: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    trash: 'M19 7l-.87 12.14A2 2 0 0116.14 21H7.86a2 2 0 01-1.99-1.86L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.6a2 2 0 112.8 2.8L11.8 15H9v-2.8l8.6-8.8z',
    printer: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    receipt: 'M9 14l6-6M9.5 8.5h.01M14.5 13.5h.01M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2z',
    x: 'M6 18L18 6M6 6l12 12',
    trend: 'M3 17l6-6 4 4 8-8M14 7h7v7',
    users: 'M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-5.13a3 3 0 11-6 0 3 3 0 016 0zm6 1a2.5 2.5 0 11-5 0m-12 0a2.5 2.5 0 105 0',
    table: 'M3 10h18M3 14h18M10 4v16M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    utensils: 'M7 3v7a2 2 0 002 2v9M11 3v7M9 3v9M17 3c-2.2 1.6-3 4.2-3 7h3v11',
  };
  RD.icon = (name, cls = 'w-5 h-5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

  /* ---------------- Toasts, modals, confirm ---------------- */
  RD.toast = (msg, type = 'success') => {
    const root = $('#toast-root');
    const el = document.createElement('div');
    const color = type === 'error' ? 'bg-rose-600' : type === 'info' ? 'bg-slate-800' : 'bg-brand-600';
    el.className = `toast ${color} text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg max-w-sm`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 260);
    }, type === 'error' ? 5200 : 3000);
  };

  RD.errMsg = (e) => (e && (e.message || e.error_description || e.details)) || 'Something went wrong. Try again.';
  RD.fail = (e) => { console.error(e); RD.toast(RD.errMsg(e), 'error'); };

  RD.openModal = ({ title, html, size = 'max-w-lg', onClose }) => {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 modal-fade';
    wrap.innerHTML = `
      <div class="bg-white w-full ${size} rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <h3 class="text-lg font-semibold text-slate-900">${esc(title)}</h3>
          <button data-close class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">${RD.icon('x', 'w-5 h-5')}</button>
        </div>
        <div class="px-6 pb-6 overflow-y-auto">${html}</div>
      </div>`;
    let closed = false;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (onClose) onClose();
    };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(wrap);
    const first = wrap.querySelector('input:not([type=hidden]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close, $: (s) => wrap.querySelector(s), $$: (s) => Array.from(wrap.querySelectorAll(s)) };
  };

  RD.confirm = (message, { title = 'Are you sure?', confirmLabel = 'Confirm', danger = true } = {}) =>
    new Promise((resolve) => {
      const m = RD.openModal({
        title, size: 'max-w-sm', onClose: () => resolve(false),
        html: `<p class="text-sm text-slate-600">${esc(message)}</p>
          <div class="mt-6 flex justify-end gap-2">
            <button data-close class="btn btn-ghost">Cancel</button>
            <button id="confirm-yes" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
          </div>`,
      });
      m.$('#confirm-yes').addEventListener('click', () => { resolve(true); m.close(); });
    });

  /* Disable a button while an async action runs */
  RD.busy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { RD.fail(e); }
    finally { if (btn) btn.disabled = false; }
  };

  RD.toggleHTML = (attrs = '', checked = false) => `
    <label class="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" class="sr-only peer" ${attrs} ${checked ? 'checked' : ''}>
      <span class="w-10 h-6 rounded-full bg-slate-200 transition peer-checked:bg-brand-500 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20
        after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"></span>
    </label>`;

  const STATUS = {
    incoming: ['Incoming', 'bg-amber-50 text-amber-700'],
    preparing: ['Preparing', 'bg-sky-50 text-sky-700'],
    ready: ['Ready', 'bg-brand-50 text-brand-700'],
    completed: ['Completed', 'bg-slate-100 text-slate-600'],
    cancelled: ['Cancelled', 'bg-rose-50 text-rose-700'],
    paid: ['Paid', 'bg-brand-50 text-brand-700'],
    unpaid: ['Unpaid', 'bg-amber-50 text-amber-700'],
  };
  RD.pill = (key) => {
    const [label, cls] = STATUS[key] || [key, 'bg-slate-100 text-slate-600'];
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  };

  /* ---------------- Data loaders ---------------- */
  RD.loadSettings = async () => {
    const { data, error } = await RD.sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (data) Object.assign(state.settings, data, { tax_rate: Number(data.tax_rate) });
  };
  RD.loadInventory = async () => {
    const { data, error } = await RD.sb.from('inventory').select('*').order('name');
    if (error) throw error;
    state.inventory = data.map((i) => ({
      ...i, price: Number(i.price), recipe_cost: Number(i.recipe_cost),
      stock_qty: Number(i.stock_qty), low_stock_threshold: Number(i.low_stock_threshold),
    }));
    return state.inventory;
  };
  RD.loadTables = async () => {
    const { data, error } = await RD.sb.from('restaurant_tables').select('*');
    if (error) throw error;
    state.tables = data.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return state.tables;
  };
  RD.categories = () => {
    const base = ['Starters', 'Mains', 'Sides', 'Desserts', 'Drinks'];
    const extra = state.inventory.map((i) => i.category).filter((c) => c && !base.includes(c));
    return [...base, ...Array.from(new Set(extra)).sort()];
  };

  /* PostgREST returns at most 1000 rows per request, so page through big result sets. */
  RD.fetchAll = async (build, pageSize = 1000, maxPages = 40) => {
    const out = [];
    for (let p = 0; p < maxPages; p++) {
      const { data, error } = await build().range(p * pageSize, (p + 1) * pageSize - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < pageSize) break;
    }
    return out;
  };
  RD.must = (res) => { if (res.error) throw res.error; return res.data; };

  RD.fetchOrderFull = async (id) => {
    const { data, error } = await RD.sb.from('orders').select('*, order_items(*)').eq('id', id).single();
    if (error) throw error;
    return data;
  };

  /* ---------------- CSV export ---------------- */
  RD.downloadCSV = (filename, header, rows) => {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ---------------- Charts ---------------- */
  const COLORS = ['#12b76a', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#84cc16'];
  RD.COLORS = COLORS;
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  if (window.Chart) {
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color = '#94a3b8';
  }
  RD.destroyChart = (id) => {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
  };

  RD.areaChart = (id, labels, data, { color = '#12b76a', label = 'Revenue', isMoney = true } = {}) => {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    RD.destroyChart(id);
    state.charts[id] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label, data,
          borderColor: color, borderWidth: 3, tension: 0.4, fill: true, cubicInterpolationMode: 'monotone',
          backgroundColor: (c) => {
            const { ctx, chartArea } = c.chart;
            if (!chartArea) return hexA(color, 0.15);
            const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, hexA(color, 0.3));
            g.addColorStop(1, hexA(color, 0));
            return g;
          },
          pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: color, pointHoverBorderWidth: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a', padding: 12, cornerRadius: 10, displayColors: false,
            titleColor: '#cbd5e1', bodyColor: '#fff', bodyFont: { weight: '600' },
            callbacks: { label: (c) => `${label}: ${isMoney ? RD.money(c.parsed.y) : c.parsed.y}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: {
            beginAtZero: true, border: { display: false }, grid: { color: '#f1f5f9' },
            ticks: { maxTicksLimit: 5, callback: (v) => (isMoney ? state.settings.currency : '') + RD.compact(v) },
          },
        },
      },
    });
  };

  /* rows: [{label, value}] — shows the top 6, folds the rest into "Other" */
  RD.donutChart = (id, rows, { legendId, centerId, isMoney = true, centerLabel = 'Total' } = {}) => {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    RD.destroyChart(id);

    const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((s, r) => s + r.value, 0);
    if (rest > 0) top.push({ label: 'Other', value: rest });
    const total = top.reduce((s, r) => s + r.value, 0);
    const has = total > 0;
    const fmt = (v) => (isMoney ? RD.money(v) : String(v));

    state.charts[id] = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: has ? top.map((r) => r.label) : ['No data'],
        datasets: [{
          data: has ? top.map((r) => r.value) : [1],
          backgroundColor: has ? top.map((_, i) => COLORS[i % COLORS.length]) : ['#e2e8f0'],
          borderWidth: 5, borderColor: '#ffffff', hoverOffset: 6, borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: has, backgroundColor: '#0f172a', padding: 10, cornerRadius: 10,
            callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` },
          },
        },
      },
    });

    if (legendId) {
      $('#' + legendId).innerHTML = has
        ? top.map((r, i) => `
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${COLORS[i % COLORS.length]}"></span>
              <span class="text-slate-600 truncate">${esc(r.label)}</span>
            </div>
            <span class="font-semibold text-slate-800 pl-3">${Math.round((r.value / total) * 100)}%</span>
          </div>`).join('')
        : '<p class="text-sm text-slate-400 text-center py-2">No sales in this period yet.</p>';
    }
    if (centerId) {
      $('#' + centerId).innerHTML = has
        ? `<div class="text-xs text-slate-400">${esc(centerLabel)}</div><div class="text-lg font-bold text-slate-900">${esc(isMoney ? RD.money(total) : total)}</div>`
        : '';
    }
  };

  /* ---------------- Smart search (auto-suggest, prefix match, queries Supabase) ---------------- */
  RD.attachSmartSearch = ({ input, panel, availableOnly = false, onResults, onPick }) => {
    let timer = null, seq = 0, active = -1, rows = [];

    const hide = () => { panel.classList.add('hidden'); active = -1; };
    const show = () => panel.classList.remove('hidden');
    const highlight = (name, term) =>
      `<b class="text-brand-700">${esc(name.slice(0, term.length))}</b>${esc(name.slice(term.length))}`;

    const render = (term) => {
      if (!rows.length) {
        panel.innerHTML = `<div class="px-3 py-4 text-sm text-slate-500">No items start with “${esc(term)}”.</div>`;
        show();
        return;
      }
      panel.innerHTML = rows.slice(0, 8).map((r, i) => `
        <div class="suggest-item ${i === active ? 'active' : ''}" data-i="${i}">
          <div class="min-w-0">
            <div class="font-medium text-slate-800 truncate">${highlight(r.name, term)}</div>
            <div class="text-xs text-slate-400">${esc(r.category)}${r.is_available ? '' : ' · unavailable'}</div>
          </div>
          <div class="text-sm font-semibold text-slate-700 shrink-0">${RD.money(r.price)}</div>
        </div>`).join('') +
        (rows.length > 8 ? `<div class="px-3 py-2 text-xs text-slate-400">+${rows.length - 8} more matches shown below</div>` : '');
      show();
    };

    const search = async () => {
      const term = input.value.trim();
      const mine = ++seq;
      if (!term) { rows = []; hide(); if (onResults) onResults('', null); return; }
      let q = RD.sb.from('inventory').select('*').ilike('name', RD.escLike(term) + '%').order('name').limit(60);
      if (availableOnly) q = q.eq('is_available', true);
      const { data, error } = await q;
      if (mine !== seq) return; // a newer keystroke superseded this request
      if (error) { RD.fail(error); return; }
      rows = data.map((i) => ({
        ...i, price: Number(i.price), recipe_cost: Number(i.recipe_cost),
        stock_qty: Number(i.stock_qty), low_stock_threshold: Number(i.low_stock_threshold),
      }));
      active = -1;
      render(term);
      if (onResults) onResults(term, rows);
    };

    const pick = (i) => {
      const item = rows[i];
      if (!item) return;
      hide();
      if (onPick) onPick(item);
    };

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 150); });
    input.addEventListener('focus', () => { if (rows.length && input.value.trim()) show(); });
    input.addEventListener('keydown', (e) => {
      const n = Math.min(rows.length, 8);
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); active = (active + 1) % n; render(input.value.trim()); }
      else if (e.key === 'ArrowUp' && n) { e.preventDefault(); active = (active - 1 + n) % n; render(input.value.trim()); }
      else if (e.key === 'Enter') { if (rows.length) { e.preventDefault(); pick(active >= 0 ? active : 0); } }
      else if (e.key === 'Escape') hide();
    });
    panel.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-i]');
      if (el) { e.preventDefault(); pick(Number(el.dataset.i)); }
    });
    document.addEventListener('click', (e) => { if (e.target !== input && !panel.contains(e.target)) hide(); });

    return { reset() { input.value = ''; rows = []; hide(); } };
  };

  /* ---------------- Receipt ---------------- */
  RD.receiptHTML = (o) => {
    const s = state.settings;
    const lines = (o.order_items || []).map((i) => `
      <tr>
        <td>${esc(i.item_name)}<div class="r-sub">${RD.money(i.unit_price)} each</div></td>
        <td>${i.quantity}</td>
        <td>${RD.money(i.line_total)}</td>
      </tr>`).join('');
    const paid = o.payment_status === 'paid';
    return `
    <div class="receipt">
      <div class="r-center">
        <div class="r-brand">${esc(s.restaurant_name)}</div>
        ${s.address ? `<div>${esc(s.address)}</div>` : ''}
        ${s.phone ? `<div>${esc(s.phone)}</div>` : ''}
      </div>
      <div class="r-rule"></div>
      <div class="r-row"><span>Order</span><b>${esc(o.tracking_no)}</b></div>
      <div class="r-row"><span>Date</span><span>${RD.fmtDateTime(o.created_at)}</span></div>
      <div class="r-row"><span>Type</span><span>${o.order_type === 'dine_in' ? 'Dine-in · ' + esc(o.table_name || '') : 'Walk-in'}</span></div>
      ${o.customer_name ? `<div class="r-row"><span>Customer</span><span>${esc(o.customer_name)}</span></div>` : ''}
      ${o.cashier_name ? `<div class="r-row"><span>Served by</span><span>${esc(o.cashier_name)}</span></div>` : ''}
      <div class="r-rule"></div>
      <table class="r-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
      <div class="r-rule"></div>
      <div class="r-row"><span>Subtotal</span><span>${RD.money(o.subtotal)}</span></div>
      ${Number(o.discount) > 0 ? `<div class="r-row"><span>Discount</span><span>-${RD.money(o.discount)}</span></div>` : ''}
      <div class="r-row"><span>Tax (${Number(o.tax_rate)}%)</span><span>${RD.money(o.tax_amount)}</span></div>
      <div class="r-rule"></div>
      <div class="r-row r-total"><span>TOTAL</span><span>${RD.money(o.total)}</span></div>
      <div class="r-rule"></div>
      <div class="r-row"><span>Payment</span><span>${paid ? 'PAID · ' + esc(o.payment_method || '') : 'UNPAID'}</span></div>
      ${o.notes ? `<div class="r-rule"></div><div class="r-sub">Note: ${esc(o.notes)}</div>` : ''}
      <div class="r-center r-foot">${esc(s.receipt_footer)}</div>
    </div>`;
  };

  RD.printReceipt = (order) => {
    $('#print-root').innerHTML = RD.receiptHTML(order);
    window.print();
  };

  RD.showReceipt = (order) => {
    const m = RD.openModal({
      title: `Receipt ${order.tracking_no}`, size: 'max-w-md',
      html: `<div class="bg-slate-50 rounded-xl p-4 overflow-x-auto">${RD.receiptHTML(order)}</div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-close class="btn btn-ghost">Close</button>
          <button id="rcpt-print" class="btn btn-primary">${RD.icon('printer', 'w-4 h-4')} Print receipt</button>
        </div>`,
    });
    m.$('#rcpt-print').addEventListener('click', () => RD.printReceipt(order));
  };

  RD.openReceiptById = async (id) => {
    try { RD.showReceipt(await RD.fetchOrderFull(id)); } catch (e) { RD.fail(e); }
  };
})();
