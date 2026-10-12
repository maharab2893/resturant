/* main.js — sign-in, routing, role-based navigation, realtime */
(() => {
  'use strict';
  const RD = window.RD;
  const { $, $$, esc, state } = RD;

  const ALL = ['admin', 'cashier', 'kitchen', 'staff'];
  const ROUTES = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home', roles: ['admin'] },
    { id: 'pos', label: 'POS', icon: 'cart', roles: ['admin', 'cashier'] },
    { id: 'orders', label: 'Orders', icon: 'clipboard', roles: ['admin', 'cashier'] },
    { id: 'kitchen', label: 'Kitchen', icon: 'board', roles: ALL },
    { id: 'menu', label: 'Menu & Inventory', icon: 'box', roles: ['admin'] },
    { id: 'attendance', label: 'Attendance', icon: 'clock', roles: ALL },
    { id: 'reports', label: 'Reports', icon: 'chart', roles: ['admin'] },
    { id: 'settings', label: 'Settings', icon: 'sliders', roles: ['admin'] },
  ];
  const HOME = { admin: 'dashboard', cashier: 'pos', kitchen: 'kitchen', staff: 'attendance' };

  /* ---------- screens ---------- */
  const show = (id) => {
    $('#boot').classList.add('hidden');
    $('#auth-screen').classList.toggle('hidden', id !== 'auth');
    $('#auth-screen').classList.toggle('flex', id === 'auth');
    $('#app').classList.toggle('hidden', id !== 'app');
  };

  const loginError = (msg) => {
    const el = $('#login-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  };

  /* ---------- sign-in ---------- */
  async function signIn(e) {
    e.preventDefault();
    loginError('');
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) return loginError('Enter your email and password.');

    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { data, error } = await RD.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await bootApp(data.user);
    } catch (err) {
      loginError(/invalid login/i.test(err.message) ? 'That email or password is incorrect.' : RD.errMsg(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  async function signOut() {
    try { await RD.sb.auth.signOut(); } catch (e) { /* ignore */ }
    location.hash = '';
    location.reload();
  }

  /* ---------- boot after authentication ---------- */
  async function bootApp(user) {
    const { data: profile, error } = await RD.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!profile) {
      await RD.sb.auth.signOut();
      throw new Error('No staff profile exists for this account. Ask an administrator.');
    }
    if (!profile.is_active) {
      await RD.sb.auth.signOut();
      show('auth');
      loginError('Your account is waiting for approval. Ask an administrator to activate it.');
      return;
    }

    state.user = user;
    state.profile = profile;
    await RD.loadSettings();
    await Promise.all([RD.loadInventory(), RD.loadTables()]);

    buildShell();
    show('app');
    subscribeRealtime();
    window.addEventListener('hashchange', route);
    route();
  }

  function buildShell() {
    const role = state.profile.role;
    $('#side-brand').textContent = state.settings.restaurant_name;
    $('#user-name').textContent = state.profile.full_name || state.profile.email;
    $('#user-role').textContent = role;
    $('#user-avatar').textContent = RD.initials(state.profile.full_name || state.profile.email);

    $('#nav').innerHTML = ROUTES.filter((r) => r.roles.includes(role)).map((r) => `
      <a href="#/${r.id}" data-route="${r.id}" class="nav-link">${RD.icon(r.icon)}<span>${esc(r.label)}</span></a>`).join('');

    const quick = $('#quick-order');
    if (['admin', 'cashier'].includes(role)) {
      quick.innerHTML = `${RD.icon('plus', 'w-4 h-4')}<span class="hidden sm:inline">New order</span>`;
      quick.classList.remove('hidden');
    }
    $('#page-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ---------- router ---------- */
  function route() {
    const role = state.profile.role;
    let id = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
    const def = ROUTES.find((r) => r.id === id);
    if (!def || !def.roles.includes(role)) {
      id = HOME[role];
      if (location.hash !== `#/${id}`) { location.hash = `#/${id}`; return; }
    }

    const prev = RD.views[state.route];
    if (prev && prev.unmount) prev.unmount();

    state.route = id;
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${id}`));
    $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
    $('#page-title').textContent = ROUTES.find((r) => r.id === id).label;
    closeSidebar();
    window.scrollTo({ top: 0 });

    const view = RD.views[id];
    if (view && view.mount) Promise.resolve(view.mount()).catch(RD.fail);
  }

  /* ---------- sidebar (mobile) ---------- */
  const openSidebar = () => {
    $('#sidebar').classList.remove('-translate-x-full');
    $('#sidebar-backdrop').classList.remove('hidden');
  };
  function closeSidebar() {
    $('#sidebar').classList.add('-translate-x-full');
    $('#sidebar-backdrop').classList.add('hidden');
  }

  /* ---------- realtime ---------- */
  let refreshTimer = null;
  const pending = new Set();
  function scheduleRefresh(kind) {
    pending.add(kind);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const kinds = Array.from(pending);
      pending.clear();
      const view = RD.views[state.route];
      if (!view || !view.refresh) return;
      try { for (const k of kinds) await view.refresh(k); } catch (e) { console.error(e); }
    }, 400);
  }

  function setLive(ok) {
    $('#live-dot').className = `w-2 h-2 rounded-full ${ok ? 'bg-brand-500' : 'bg-amber-400'}`;
    $('#live-text').textContent = ok ? 'Live' : 'Reconnecting';
  }

  function subscribeRealtime() {
    state.channel = RD.sb
      .channel('restodesk-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => scheduleRefresh('orders'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, async () => {
        try { await RD.loadInventory(); } catch (e) { console.error(e); }
        scheduleRefresh('inventory');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_attendance' }, () => scheduleRefresh('attendance'))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
  }

  /* ---------- start ---------- */
  async function init() {
    $('#auth-logo').innerHTML = RD.icon('utensils', 'w-6 h-6');
    $('#side-logo').innerHTML = RD.icon('utensils', 'w-5 h-5');
    $('#logout-btn').innerHTML = RD.icon('logout', 'w-5 h-5');
    $('#menu-toggle').innerHTML = RD.icon('menu', 'w-6 h-6');
    $('#pos-search-icon').innerHTML = RD.icon('search', 'w-4 h-4');
    $('#menu-search-icon').innerHTML = RD.icon('search', 'w-4 h-4');

    $('#login-form').addEventListener('submit', signIn);
    $('#logout-btn').addEventListener('click', signOut);
    $('#menu-toggle').addEventListener('click', openSidebar);
    $('#sidebar-backdrop').addEventListener('click', closeSidebar);

    if (!RD.configured) {
      show('auth');
      $('#config-warning').classList.remove('hidden');
      $('#login-btn').disabled = true;
      return;
    }

    RD.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && state.user) setTimeout(() => location.reload(), 0);
    });

    try {
      const { data } = await RD.sb.auth.getSession();
      if (data.session) await bootApp(data.session.user);
      else show('auth');
    } catch (e) {
      console.error(e);
      show('auth');
      loginError(RD.errMsg(e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
