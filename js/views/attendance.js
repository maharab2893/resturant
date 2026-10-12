/* Attendance — staff check-in/out, admin team overview and history */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, esc, state } = RD;

  const A = { mine: [], team: [], today: [], logs: [], clock: null, wired: false };

  const hoursOf = (r) => ((r.check_out ? new Date(r.check_out) : new Date()) - new Date(r.check_in)) / 36e5;
  const isAdmin = () => state.profile.role === 'admin';
  const openSession = () => A.mine.find((r) => !r.check_out);

  function wire() {
    if (A.wired) return;
    A.wired = true;
    $('#att-in').addEventListener('click', (e) => RD.busy(e.currentTarget, async () => {
      const { error } = await RD.sb.rpc('clock_in', { p_work_date: RD.dayKey(new Date()) });
      if (error) throw error;
      RD.toast('Checked in. Have a good shift!');
      await load();
    }));
    $('#att-out').addEventListener('click', (e) => RD.busy(e.currentTarget, async () => {
      const { error } = await RD.sb.rpc('clock_out');
      if (error) throw error;
      RD.toast('Checked out. See you next time!');
      await load();
    }));

    $('#att-from').addEventListener('change', () => loadAdmin().catch(RD.fail));
    $('#att-to').addEventListener('change', () => loadAdmin().catch(RD.fail));
    $('#att-export').addEventListener('click', exportCSV);
    $('#att-log-body').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-out]');
      if (!b) return;
      await RD.busy(b, async () => {
        const { error } = await RD.sb.from('employee_attendance')
          .update({ check_out: new Date().toISOString() }).eq('id', b.dataset.out);
        if (error) throw error;
        RD.toast('Session closed');
        await load();
      });
    });
  }

  /* ---------- clock ---------- */
  function tickClock() {
    const now = new Date();
    $('#att-clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#att-date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const open = openSession();
    $('#att-timer').textContent = open ? `On shift for ${RD.fmtHours(hoursOf(open))}` : '';
  }

  /* ---------- my attendance ---------- */
  async function loadMine() {
    const since = RD.dayKey(RD.addDays(new Date(), -29));
    const { data, error } = await RD.sb.from('employee_attendance').select('*')
      .eq('employee_id', state.user.id).gte('work_date', since)
      .order('check_in', { ascending: false });
    if (error) throw error;
    A.mine = data;
    renderMine();
  }

  function renderMine() {
    const open = openSession();
    $('#att-in').disabled = !!open;
    $('#att-out').disabled = !open;
    $('#att-status').innerHTML = open
      ? `<span class="pill bg-brand-50 text-brand-700">Checked in at ${RD.fmtTime(open.check_in)}</span>`
      : '<span class="pill bg-slate-100 text-slate-600">Not checked in</span>';
    tickClock();

    $('#att-mine-body').innerHTML = A.mine.length
      ? A.mine.map((r) => `
        <tr>
          <td class="td font-medium text-slate-800">${RD.fmtDate(r.check_in)}</td>
          <td class="td">${RD.fmtTime(r.check_in)}</td>
          <td class="td">${r.check_out ? RD.fmtTime(r.check_out) : '<span class="pill bg-brand-50 text-brand-700">On shift</span>'}</td>
          <td class="td font-semibold">${RD.fmtHours(hoursOf(r))}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="td text-center text-slate-400 py-10">No attendance yet. Tap Check in to start your shift.</td></tr>';
  }

  /* ---------- admin ---------- */
  async function loadAdmin() {
    const from = $('#att-from').value || RD.dayKey(new Date());
    const to = $('#att-to').value || RD.dayKey(new Date());
    const todayKey = RD.dayKey(new Date());

    const [people, today, logs] = await Promise.all([
      RD.sb.from('profiles').select('id,full_name,role,email').eq('is_active', true).order('full_name'),
      RD.sb.from('employee_attendance').select('*').eq('work_date', todayKey).order('check_in'),
      RD.fetchAll(() => RD.sb.from('employee_attendance').select('*, profiles(full_name,role)')
        .gte('work_date', from).lte('work_date', to)
        .order('check_in', { ascending: false }).order('id')),
    ]);
    A.team = RD.must(people);
    A.today = RD.must(today);
    A.logs = logs;
    renderAdmin();
  }

  function renderAdmin() {
    $('#att-today-body').innerHTML = A.team.length
      ? A.team.map((p) => {
          const rows = A.today.filter((r) => r.employee_id === p.id);
          const open = rows.some((r) => !r.check_out);
          const status = open ? '<span class="pill bg-brand-50 text-brand-700">On shift</span>'
            : rows.length ? '<span class="pill bg-slate-100 text-slate-600">Checked out</span>'
            : '<span class="pill bg-amber-50 text-amber-700">Not in yet</span>';
          const first = rows[0];
          const last = rows.filter((r) => r.check_out).pop();
          const hrs = rows.reduce((s, r) => s + hoursOf(r), 0);
          return `
          <tr>
            <td class="td"><div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">${esc(RD.initials(p.full_name))}</div>
              <div><div class="font-semibold text-slate-900">${esc(p.full_name || p.email)}</div></div></div></td>
            <td class="td capitalize text-slate-500">${esc(p.role)}</td>
            <td class="td">${status}</td>
            <td class="td">${first ? RD.fmtTime(first.check_in) : '—'}</td>
            <td class="td">${last ? RD.fmtTime(last.check_out) : '—'}</td>
            <td class="td font-semibold">${rows.length ? RD.fmtHours(hrs) : '—'}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="td text-center text-slate-400 py-10">No active employees yet.</td></tr>';

    // per-employee totals for the chosen range
    const sum = new Map();
    for (const r of A.logs) {
      const s = sum.get(r.employee_id) || { name: r.profiles?.full_name || 'Unknown', days: new Set(), hours: 0 };
      s.days.add(r.work_date);
      s.hours += hoursOf(r);
      sum.set(r.employee_id, s);
    }
    const sorted = Array.from(sum.values()).sort((a, b) => b.hours - a.hours);
    $('#att-summary-body').innerHTML = sorted.length
      ? sorted.map((s) => `
        <tr><td class="td font-semibold text-slate-900">${esc(s.name)}</td><td class="td">${s.days.size}</td><td class="td font-semibold">${RD.fmtHours(s.hours)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="td text-center text-slate-400 py-10">No attendance in this range.</td></tr>';

    $('#att-log-body').innerHTML = A.logs.length
      ? A.logs.map((r) => `
        <tr>
          <td class="td whitespace-nowrap">${RD.fmtDate(r.check_in)}</td>
          <td class="td font-medium text-slate-800">${esc(r.profiles?.full_name || 'Unknown')}</td>
          <td class="td">${RD.fmtTime(r.check_in)}</td>
          <td class="td">${r.check_out ? RD.fmtTime(r.check_out) : '<span class="pill bg-brand-50 text-brand-700">On shift</span>'}</td>
          <td class="td font-semibold">${RD.fmtHours(hoursOf(r))}</td>
          <td class="td text-right">${r.check_out ? '' : `<button data-out="${r.id}" class="btn btn-ghost btn-sm">Check out</button>`}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="td text-center text-slate-400 py-10">No attendance in this range.</td></tr>';
  }

  function exportCSV() {
    if (!A.logs.length) return RD.toast('Nothing to export for this range', 'info');
    RD.downloadCSV(
      `attendance_${$('#att-from').value}_to_${$('#att-to').value}.csv`,
      ['Date', 'Employee', 'Role', 'Check in', 'Check out', 'Hours'],
      A.logs.map((r) => [
        r.work_date, r.profiles?.full_name || '', r.profiles?.role || '',
        new Date(r.check_in).toLocaleString(), r.check_out ? new Date(r.check_out).toLocaleString() : 'On shift',
        hoursOf(r).toFixed(2),
      ]),
    );
  }

  async function load() {
    await loadMine();
    if (isAdmin()) await loadAdmin();
  }

  RD.views.attendance = {
    async mount() {
      wire();
      $('#att-admin').classList.toggle('hidden', !isAdmin());
      if (isAdmin()) {
        if (!$('#att-from').value) $('#att-from').value = RD.dayKey(RD.addDays(new Date(), -6));
        if (!$('#att-to').value) $('#att-to').value = RD.dayKey(new Date());
      }
      await load();
      clearInterval(A.clock);
      A.clock = setInterval(tickClock, 1000);
    },
    unmount() { clearInterval(A.clock); },
    async refresh() { await load(); },
  };
})();
