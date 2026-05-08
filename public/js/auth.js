/* ============================================================
   MINERVA HRIS — Auth, Role Guards, Shell Builder
   ============================================================ */

/* ---- Role display names ---- */
const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hr:          'HR Admin',
  coord:       'Coordinator',
  it:          'IT Admin',
  admin:       'Admin',
};

/* ---- Session management ---- */

function getUser() {
  const raw = localStorage.getItem(CONFIG.USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function checkSession() {
  const user = getUser();
  if (!user || !localStorage.getItem(CONFIG.TOKEN_KEY)) {
    window.location.href = '/pages/login.html';
    return null;
  }
  return user;
}

function requireRole(...allowedRoles) {
  const user = checkSession();
  if (!user) return null;
  if (!allowedRoles.includes(user.role)) {
    window.location.href = '/pages/login.html';
    return null;
  }
  return user;
}

function logout() {
  localStorage.removeItem(CONFIG.TOKEN_KEY);
  localStorage.removeItem(CONFIG.USER_KEY);
  window.location.href = '/pages/login.html';
}

/* ---- Sidebar nav definition (per role) ---- */
/* Format: { label, icon (SVG path string), href, activeOn (filename match) } */

const SVG = {
  dashboard:  `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
  employees:  `<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/>`,
  schedGrid:  `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`,
  schedOver:  `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M9 16l2 2 4-4"/>`,
  timekeep:   `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`,
  requests:   `<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>`,
  leave:      `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  devices:    `<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8M12 18v2"/>`,
  reports:    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
  audit:      `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  config:     `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  settings:   `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 8v4l3 3"/>`,
};

function dashboardHref(role) {
  const map = {
    super_admin: '/pages/sa_dashboard.html',
    hr:          '/pages/hr_dashboard.html',
    coord:       '/pages/coord_dashboard.html',
    it:          '/pages/it_dashboard.html',
    admin:       '/pages/admin_dashboard.html',
  };
  return map[role] || '/pages/login.html';
}

function configHref(role) {
  const map = {
    super_admin: '/pages/sa_configuration.html',
    hr:          '/pages/hr_configuration.html',
    it:          '/pages/it_configuration.html',
  };
  return map[role] || null;
}

function getNavItems(role) {
  const items = [];

  /* Dashboard — always first, role-specific page */
  items.push({ label: 'Dashboard', icon: SVG.dashboard, href: dashboardHref(role), key: 'dashboard', badge: null });

  /* Employees — all roles, read-only for coord/it/admin */
  items.push({ label: 'Employees', icon: SVG.employees, href: '/pages/employees.html', key: 'employees' });

  /* Schedule Grid (coord_schedule) — all except IT */
  if (['super_admin','hr','coord','admin'].includes(role)) {
    items.push({ label: 'Schedule Grid', icon: SVG.schedGrid, href: '/pages/coord_schedule.html', key: 'coord_schedule' });
  }

  /* Schedule Override (hr_schedule) — HR and Super Admin only */
  if (['super_admin','hr'].includes(role)) {
    items.push({ label: 'Schedule Override', icon: SVG.schedOver, href: '/pages/hr_schedule.html', key: 'hr_schedule' });
  }

  /* Timekeeping — all roles */
  items.push({ label: 'Timekeeping', icon: SVG.timekeep, href: '/pages/hr_timekeeping.html', key: 'timekeeping', badge: 'anomaly' });

  /* Requests — all roles (coord/it/admin = view or submit only) */
  items.push({ label: 'Requests', icon: SVG.requests, href: '/pages/hr_requests.html', key: 'requests', badge: 'pending' });

  /* Leave — all except IT */
  if (['super_admin','hr','coord','admin'].includes(role)) {
    items.push({ label: 'Leave', icon: SVG.leave, href: '/pages/hr_leave.html', key: 'leave' });
  }

  /* Operations section */
  const opsItems = [];

  /* Devices — super_admin + IT only */
  if (['super_admin','it'].includes(role)) {
    opsItems.push({ label: 'Devices', icon: SVG.devices, href: '/pages/devices.html', key: 'devices' });
  }

  /* Reports — all except IT */
  if (['super_admin','hr','coord','admin'].includes(role)) {
    opsItems.push({ label: 'Reports', icon: SVG.reports, href: '/pages/reports.html', key: 'reports' });
  }

  /* Audit Log — super_admin ONLY */
  if (role === 'super_admin') {
    opsItems.push({ label: 'Audit Log', icon: SVG.audit, href: '/pages/audit_log.html', key: 'audit_log' });
  }

  return { main: items, ops: opsItems };
}

/* ---- Build nav item HTML ---- */
function navItemHTML(item, activePage) {
  const isActive = item.key === activePage;
  return `
    <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${item.icon}</svg>
      <span class="nav-item-label">${item.label}</span>
      ${item.key === 'dashboard' ? '<span class="punch-dot" id="punch-dot"></span>' : ''}
      ${item.badge === 'anomaly'  ? '<span class="nav-badge" id="anomaly-badge-nav" style="display:none">0</span>' : ''}
      ${item.badge === 'pending'  ? '<span class="nav-badge" id="pending-badge-nav" style="display:none">0</span>' : ''}
    </a>`;
}

/* ---- Build full sidebar HTML ---- */
function buildSidebarHTML(user, activePage) {
  const { main, ops } = getNavItems(user.role);
  const cfgHref = configHref(user.role);

  return `
    <div class="sidebar-brand">
      <div class="sidebar-brand-mark"><span>MV</span></div>
      <span class="sidebar-brand-name">MINERVA</span>
    </div>
    <div class="nav-scroll">
      <div class="nav-section">
        <div class="nav-section-label">Main</div>
        ${main.map(i => navItemHTML(i, activePage)).join('')}
      </div>
      ${ops.length ? `
      <div class="nav-section">
        <div class="nav-section-label">Operations</div>
        ${ops.map(i => navItemHTML(i, activePage)).join('')}
      </div>` : ''}
    </div>
    <div class="sidebar-footer">
      ${cfgHref ? `<a href="${cfgHref}" class="nav-item${activePage === 'configuration' ? ' active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${SVG.config}</svg>
        <span class="nav-item-label">Configuration</span>
      </a>` : ''}
      <button class="nav-item" id="settings-btn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${SVG.settings}</svg>
        <span class="nav-item-label">Settings</span>
      </button>
    </div>`;
}

/* ---- Build topbar HTML ---- */
function buildTopbarHTML(user, breadcrumb) {
  const initials = ((user.username || '?').slice(0, 2)).toUpperCase();
  const roleLabel = ROLE_LABELS[user.role] || user.role;
  return `
    <button class="topbar-toggle" id="sidebar-toggle" title="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="topbar-breadcrumb" id="breadcrumb">
      <span class="crumb-sep">MINERVA</span>
      <span class="crumb-sep"> / </span>
      <span class="crumb-current">${breadcrumb}</span>
    </div>
    <div class="topbar-right">
      <button class="icon-btn" id="notif-btn" title="Notifications">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="icon-btn-badge" id="notif-badge" style="display:none"></span>
      </button>
      <div class="user-trigger" id="user-trigger">
        <div class="user-avatar">${initials}</div>
        <span style="font-size:13px;">${user.username || '—'}</span>
        <span class="user-role-badge">${roleLabel}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:12px;height:12px;stroke-width:2;color:var(--text-disabled)"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>`;
}

/* ---- Settings modal HTML ---- */
function buildSettingsModalHTML() {
  return `
  <div class="settings-modal-overlay" id="settings-modal-overlay">
    <div class="settings-modal">
      <div class="settings-modal-header">
        <span style="font-weight:600;font-size:15px;color:var(--text-display)">Settings</span>
        <button class="modal-close" id="settings-modal-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="toggle-row" style="padding: var(--space-sm) 0;">
        <div class="toggle-info">
          <div class="toggle-label">Dark Mode</div>
          <div class="toggle-hint">Toggle between light and dark theme</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="dark-mode-toggle" onchange="toggleDarkMode(this.checked)"/>
          <div class="toggle-track"></div>
        </label>
      </div>
    </div>
  </div>`;
}

/* ---- User & Notif dropdown HTML ---- */
function buildDropdownsHTML() {
  return `
  <div class="dropdown-panel user-dropdown" id="user-dropdown">
    <div class="user-dropdown-head">
      <div id="ud-name" style="font-size:14px;font-weight:500;color:var(--text-display)">—</div>
      <div class="t-caption" id="ud-role">—</div>
    </div>
    <div class="user-dropdown-item" id="ud-logout">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Log Out
    </div>
  </div>
  <div class="dropdown-panel notif-dropdown" id="notif-dropdown">
    <div class="notif-header">
      <span class="t-label">Notifications</span>
      <button class="btn btn-ghost btn-xs" id="notif-clear-all">Clear All</button>
    </div>
    <div id="notif-list">
      <div class="notif-empty">
        <div class="t-caption" style="margin-top:8px;">[ NO NOTIFICATIONS ]</div>
      </div>
    </div>
  </div>`;
}

/* ---- Wire up interactivity ---- */
function wireShell(user) {
  /* Sidebar toggle */
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  /* User dropdown */
  const userTrigger   = document.getElementById('user-trigger');
  const userDropdown  = document.getElementById('user-dropdown');
  const notifBtn      = document.getElementById('notif-btn');
  const notifDropdown = document.getElementById('notif-dropdown');

  if (userTrigger && userDropdown) {
    document.getElementById('ud-name').textContent = user.username || '—';
    document.getElementById('ud-role').textContent = ROLE_LABELS[user.role] || user.role;
    userTrigger.addEventListener('click', e => {
      e.stopPropagation();
      notifDropdown?.classList.remove('open');
      userDropdown.classList.toggle('open');
    });
  }

  /* Notif dropdown */
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', e => {
      e.stopPropagation();
      userDropdown?.classList.remove('open');
      notifDropdown.classList.toggle('open');
    });
    document.getElementById('notif-clear-all')?.addEventListener('click', () => {
      document.getElementById('notif-list').innerHTML =
        '<div class="notif-empty"><div class="t-caption" style="margin-top:8px;">[ NO NOTIFICATIONS ]</div></div>';
      document.getElementById('notif-badge').style.display = 'none';
    });
  }

  /* Logout */
  document.getElementById('ud-logout')?.addEventListener('click', logout);

  /* Settings modal */
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-modal-overlay')?.classList.add('open');
    /* sync toggle state */
    const saved = localStorage.getItem('hris_theme') || 'light';
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = (saved === 'dark');
  });
  document.getElementById('settings-modal-close')?.addEventListener('click', () => {
    document.getElementById('settings-modal-overlay')?.classList.remove('open');
  });
  document.getElementById('settings-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  /* Close dropdowns on outside click */
  document.addEventListener('click', () => {
    userDropdown?.classList.remove('open');
    notifDropdown?.classList.remove('open');
  });
}

/* ---- Main shell builder ---- */
function buildShell(user, activePage, breadcrumb) {
  const crumb = breadcrumb || (activePage.charAt(0).toUpperCase() + activePage.slice(1).replace(/_/g, ' '));

  /* Sidebar */
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.innerHTML = buildSidebarHTML(user, activePage);

  /* Topbar */
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.innerHTML = buildTopbarHTML(user, crumb);

  /* Dropdowns + settings modal */
  document.body.insertAdjacentHTML('beforeend', buildDropdownsHTML() + buildSettingsModalHTML());

  wireShell(user);
  applyTheme();
}
