/* ============================================================
   MINERVA HRIS — Global Config & Utilities
   ============================================================ */

const CONFIG = {
  API_BASE: '/api',
  TOKEN_KEY: 'hris_token',
  USER_KEY:  'hris_user',
};

/* ---- Date & formatting helpers ---- */

function getManilaDateISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function fmtDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function fmtDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

function fmtTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

function fmtPeso(val) {
  if (val == null || val === '') return '—';
  return '₱' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

function formatEmployeeName(row) {
  const last  = (row.last_name   || '').trim();
  const first = [row.first_name, row.middle_name].filter(Boolean).join(' ').trim();
  return last ? (first ? `${last}, ${first}` : last) : (first || '—');
}

/* ---- Cutoff helpers ---- */

function getCurrentCutoff() {
  const now   = new Date();
  const day   = now.getDate();
  const month = now.getMonth();
  const year  = now.getFullYear();
  if (day >= 11 && day <= 25) {
    return {
      label: `${now.toLocaleString('en-PH', { month: 'long' })} 11–25`,
      start: `${year}-${String(month + 1).padStart(2,'0')}-11`,
      end:   `${year}-${String(month + 1).padStart(2,'0')}-25`,
    };
  }
  if (day >= 26) {
    const nextMonth = new Date(year, month + 1, 10);
    return {
      label: `${now.toLocaleString('en-PH', { month: 'long' })} 26 – ${nextMonth.toLocaleString('en-PH', { month: 'long' })} 10`,
      start: `${year}-${String(month + 1).padStart(2,'0')}-26`,
      end:   `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2,'0')}-10`,
    };
  }
  /* day 1–10 = tail of previous period */
  const prevEnd   = new Date(year, month, 10);
  const prevStart = new Date(year, month - 1, 26);
  return {
    label: `${prevStart.toLocaleString('en-PH', { month: 'long' })} 26 – ${prevEnd.toLocaleString('en-PH', { month: 'long' })} 10`,
    start: `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2,'0')}-26`,
    end:   `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2,'0')}-10`,
  };
}

/* ---- API fetch wrapper ---- */

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem(CONFIG.TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(CONFIG.API_BASE + url, { ...options, headers });
  if (res.status === 401) {
    localStorage.clear();
    window.location.href = '/pages/login.html';
    return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ---- Toast ---- */

function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/* ---- Modal helpers ---- */

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* Close modal on overlay click */
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

/* ---- Dark mode ---- */

function applyTheme() {
  const saved = localStorage.getItem('hris_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : '');
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) toggle.checked = (saved === 'dark');
}

function toggleDarkMode(on) {
  const val = on ? 'dark' : 'light';
  localStorage.setItem('hris_theme', val);
  document.documentElement.setAttribute('data-theme', on ? 'dark' : '');
}

document.addEventListener('DOMContentLoaded', applyTheme);
