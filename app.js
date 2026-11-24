import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, update, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Replace these placeholders with your own Firebase project settings
// (or inject them via your build/hosting environment rather than committing keys).
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

/* ---------- State ---------- */
let currentUser = null;
let excelRows = [];
let routineColumns = [];
let routineDateRows = [];
let userNotesList = [];
let jobRows = [];
let internshipRows = [];
let activeNoteId = null;
let isInitialLoad = true;
let chartInstance = null;
let appChartInstance = null;
let showArchivedHabits = false;

const $ = (id) => document.getElementById(id);
const sidebar = $('sidebar');
const backdrop = $('sidebar-backdrop');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- Helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = () => { if (window.lucide) lucide.createIcons(); };

function formatDateToDMY(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
}
function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toast-host').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Shell ---------- */
function openSidebar() {
  if (window.innerWidth < 1024) {
    sidebar.classList.add('open');
    backdrop.classList.remove('hidden');
  }
}
function closeSidebar() {
  if (window.innerWidth < 1024) {
    sidebar.classList.remove('open');
    backdrop.classList.add('hidden');
  }
}
$('sidebar-toggle-btn').addEventListener('click', openSidebar);
$('sidebar-close-btn').addEventListener('click', closeSidebar);
backdrop.addEventListener('click', closeSidebar);
window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) { sidebar.classList.remove('open'); backdrop.classList.add('hidden'); }
});

$('brand-logo-toggle').addEventListener('click', () => {
  if (window.innerWidth >= 1024) {
    sidebar.classList.toggle('sidebar-collapsed');
    const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
    const btn = $('brand-logo-toggle');
    const oldIcon = btn.querySelector('svg, i');
    const newIcon = document.createElement('i');
    newIcon.setAttribute('data-lucide', isCollapsed ? 'panel-left-open' : 'panel-left-close');
    if (oldIcon) oldIcon.replaceWith(newIcon); else btn.prepend(newIcon);
    const collapseText = btn.querySelector('.sidebar-text');
    if (collapseText) collapseText.textContent = isCollapsed ? 'Expand' : 'Collapse';
    btn.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    icons();
    if (chartInstance) chartInstance.resize();
    if (appChartInstance) appChartInstance.resize();
  }
});

$('firebase-login-btn').addEventListener('click', () => signInWithPopup(auth, provider).catch(() => toast('Sign-in was cancelled or failed. Please try again.')));
$('sign-out-btn').addEventListener('click', async () => {
  try { await Promise.race([flushSave(), new Promise(r => setTimeout(r, 3000))]); } catch (_) {}
  signOut(auth);
});

function showAppSkeleton() {
  $('main-content').innerHTML = `
    <div class="page" aria-hidden="true">
      <div class="skeleton" style="height:32px;width:220px"></div>
      <div class="grid-2"><div class="skeleton" style="height:260px"></div><div class="skeleton" style="height:260px"></div></div>
      <div class="grid-2"><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div></div>
    </div>`;
}

function clearAllUserData() {
  excelRows = []; routineColumns = []; routineDateRows = []; userNotesList = []; jobRows = []; internshipRows = [];
  activeNoteId = null;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (appChartInstance) { appChartInstance.destroy(); appChartInstance = null; }
  $('main-content').innerHTML = '';
}

/* ---------- Auth + realtime sync ---------- */
const SECTIONS = ['excelTasks', 'routineColumns', 'routineDateRows', 'userNotesList', 'jobRows', 'internshipRows'];
const getSection = (k) => ({ excelTasks: excelRows, routineColumns, routineDateRows, userNotesList, jobRows, internshipRows })[k];
const setSection = (k, v) => {
  if (k === 'excelTasks') excelRows = v;
  else if (k === 'routineColumns') routineColumns = v;
  else if (k === 'routineDateRows') routineDateRows = v;
  else if (k === 'userNotesList') userNotesList = v;
  else if (k === 'jobRows') jobRows = v;
  else if (k === 'internshipRows') internshipRows = v;
};

function canon(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.length ? '[' + v.map(x => canon(x) || 'null').join(',') + ']' : '';
  if (typeof v === 'object') {
    const parts = Object.keys(v).sort().map(k => { const c = canon(v[k]); return c ? JSON.stringify(k) + ':' + c : ''; }).filter(Boolean);
    return parts.length ? '{' + parts.join(',') + '}' : '';
  }
  return JSON.stringify(v);
}
const toArr = (v) => Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === 'object' ? Object.values(v).filter(Boolean) : []);

let unsubscribeData = null;
let lastSynced = {};
let saveDebounceTimer = null;
let writeChain = Promise.resolve();

function resetSession() {
  if (unsubscribeData) { unsubscribeData(); unsubscribeData = null; }
  clearTimeout(saveDebounceTimer); saveDebounceTimer = null;
  lastSynced = {};
  writeChain = Promise.resolve();
  isInitialLoad = true;
}

function processRemote(data) {
  const todayISO = getTodayISO();
  const out = {};
  SECTIONS.forEach(k => { out[k] = toArr(data[k]); });
  out.routineColumns.sort((a, b) => (!!a.archivedDate) - (!!b.archivedDate));
  const validIds = new Set(out.routineColumns.map(c => c.id));
  out.routineDateRows = out.routineDateRows.filter(r => r.date && r.date <= todayISO);
  out.routineDateRows.forEach(row => {
    if (row.checks) Object.keys(row.checks).forEach(k => { if (!validIds.has(k)) delete row.checks[k]; });
  });
  out.routineDateRows.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function startListening(user) {
  const uid = user.uid;
  unsubscribeData = onValue(ref(db, 'users/' + uid), (snapshot) => {
    if (!currentUser || currentUser.uid !== uid) return;
    const remote = processRemote(snapshot.val() || {});
    let changed = false;
    for (const k of SECTIONS) {
      const remoteC = canon(remote[k]);
      const localC = canon(getSection(k));
      if (remoteC === localC) { if (lastSynced[k] === undefined) lastSynced[k] = remoteC; continue; }
      if (lastSynced[k] !== undefined && localC !== lastSynced[k]) continue;
      setSection(k, remote[k]);
      lastSynced[k] = remoteC;
      changed = true;
    }
    if (isInitialLoad) { isInitialLoad = false; navigate(); }
    else if (changed) renderPage(window.location.hash.slice(2) || 'dashboard');
  }, (err) => {
    console.error('Firebase read error', err);
    unsubscribeData = null;
    if (isInitialLoad) {
      const denied = err && err.code === 'PERMISSION_DENIED';
      $('main-content').innerHTML = `<div class="page"><div class="card"><div class="empty-state">
        <h3>Couldn’t load your data</h3>
        <p>${denied ? 'The database rules denied access for this account.' : 'Check your connection and try again.'}</p>
        <button id="retry-load-btn" class="btn btn-primary" style="margin-top:14px">Try again</button>
      </div></div></div>`;
      $('retry-load-btn').addEventListener('click', () => {
        if (!currentUser) return;
        showAppSkeleton();
        startListening(currentUser);
      });
    } else {
      toast('Lost the connection to your data. Reload the page to reconnect.');
    }
  });
}

onAuthStateChanged(auth, (user) => {
  $('boot-splash')?.classList.add('hidden');
  resetSession();
  if (user) {
    clearAllUserData();
    currentUser = user;
    $('login-screen').classList.add('hidden');
    $('app-container').classList.remove('hidden');
    showAppSkeleton();
    const av = $('user-avatar');
    if (user.photoURL) av.src = user.photoURL; else av.removeAttribute('src');
    $('user-name').textContent = user.displayName || 'User';
    $('user-email').textContent = user.email || '';
    icons();
    startListening(user);
  } else {
    currentUser = null;
    clearAllUserData();
    $('app-container').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    icons();
  }
});

function setSyncPill(busy, text) {
  const pill = document.querySelector('.sync-pill');
  if (!pill) return;
  pill.classList.toggle('busy', busy);
  const t = $('sync-text'); if (t) t.textContent = text || (busy ? 'Saving…' : 'Synced');
}

function saveData() {
  if (!currentUser) return;
  setSyncPill(true);
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => { flushSave(); }, 500);
}

function flushSave() {
  clearTimeout(saveDebounceTimer); saveDebounceTimer = null;
  writeChain = writeChain.then(writeDirtySections);
  return writeChain;
}

async function writeDirtySections() {
  if (!currentUser || isInitialLoad) return;
  const uid = currentUser.uid;
  const updates = {}, sent = {};
  for (const k of SECTIONS) {
    const c = canon(getSection(k));
    if (c !== lastSynced[k]) { updates[k] = JSON.parse(JSON.stringify(getSection(k))); sent[k] = c; }
  }
  if (!Object.keys(updates).length) { if (!saveDebounceTimer) setSyncPill(false); return; }
  try {
    await update(ref(db, 'users/' + uid), updates);
    if (currentUser && currentUser.uid === uid) Object.assign(lastSynced, sent);
    if (!saveDebounceTimer) setSyncPill(false);
  } catch (err) {
    console.error('Firebase Sync Error', err);
    setSyncPill(true, 'Not saved');
    toast('Could not save your changes. Check your connection.');
  }
}

/* ---------- Router ---------- */
function renderPage(page) {
  if (!currentUser) return;
  const tpl = $('templates').querySelector(`#${page}-page`) || $('templates').querySelector('#dashboard-page');
  if (!$('templates').querySelector(`#${page}-page`)) page = 'dashboard';
  document.querySelectorAll('.nav-pill[data-page]').forEach(l => {
    l.classList.toggle('active-nav-pill', l.dataset.page === page);
    if (l.dataset.page === page) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
  });
  const main = $('main-content');
  main.innerHTML = tpl.innerHTML;
  main.scrollTop = 0;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (appChartInstance) { appChartInstance.destroy(); appChartInstance = null; }

  ({ dashboard: setupDashboardPage, excel: setupExcelPage, recurring: setupRecurringPage,
     notepad: setupNotepadPage, jobs: setupJobsPage, internships: setupInternshipsPage })[page]();

  icons();
  closeSidebar();
}
function navigate() {
  if (!currentUser) return;
  renderPage(window.location.hash.slice(2) || 'dashboard');
}
window.addEventListener('hashchange', navigate);

/* ---------- Overview ---------- */
function funnelBar(el, rows) {
  if (!el) return;
  const total = rows.length;
  if (!total) { el.innerHTML = ''; return; }
  const c = (s) => rows.filter(r => r.status === s).length;
  const parts = [
    [c('Offer'), 'var(--ok)'], [c('Interviewing'), 'var(--accent)'], [c('Rejected'), 'var(--bad)'],
    [total - c('Offer') - c('Interviewing') - c('Rejected'), 'var(--line-strong)']
  ];
  el.innerHTML = parts.map(([n, col]) => `<span style="width:${(n / total) * 100}%;background:${col}"></span>`).join('');
}

function setupDashboardPage() {
  if (!currentUser) return;
  const todayISO = getTodayISO();
  const todayRow = routineDateRows.find(r => r.date === todayISO);
  const set_ = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  const first = (currentUser.displayName || '').split(' ')[0];
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  set_('dash-greeting', first ? `${hello}, ${first}` : hello);
  set_('dash-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));

  const activeCols = routineColumns.filter(c => (!c.createdDate || c.createdDate <= todayISO) && (!c.archivedDate || c.archivedDate > todayISO));
  const totalR = activeCols.length;
  const doneR = (todayRow && todayRow.checks) ? activeCols.filter(c => todayRow.checks[c.id] === true).length : 0;
  const rateR = totalR ? Math.round((doneR / totalR) * 100) : 0;
  set_('stat-routine-completed', doneR);
  set_('stat-routine-pending', Math.max(0, totalR - doneR));
  set_('stat-routine-rate', rateR + '%');
  set_('stat-routine-total', totalR);
  $('habit-bar').style.width = rateR + '%';

  const totalT = excelRows.length;
  const doneT = excelRows.filter(r => r.status === 'Completed').length;
  const rateT = totalT ? Math.round((doneT / totalT) * 100) : 0;
  set_('stat-total', totalT); set_('stat-completed', doneT); set_('stat-pending', totalT - doneT); set_('stat-rate', rateT + '%');
  $('task-bar').style.width = rateT + '%';

  const fill = (prefix, rows) => {
    set_(`dash-${prefix}-applied`, rows.length);
    set_(`dash-${prefix}-interviewing`, rows.filter(r => r.status === 'Interviewing').length);
    set_(`dash-${prefix}-offers`, rows.filter(r => r.status === 'Offer').length);
    set_(`dash-${prefix}-rejected`, rows.filter(r => r.status === 'Rejected').length);
  };
  fill('jobs', jobRows); fill('interns', internshipRows);
  funnelBar($('jobs-bar'), jobRows); funnelBar($('interns-bar'), internshipRows);

  const pc = $('dashboard-pending-routines');
  if (!totalR) {
    pc.innerHTML = `<p class="empty-note">No habits yet. Add one in Daily habits.</p>`;
  } else if (!todayRow) {
    pc.innerHTML = `<p class="empty-note">Today isn't logged yet. <a href="#/recurring" style="color:var(--accent);font-weight:600">Log today</a> to start ticking habits.</p>`;
  } else {
    const unchecked = activeCols.filter(c => !(todayRow.checks && todayRow.checks[c.id]));
    if (!unchecked.length) {
      pc.innerHTML = `<p class="empty-note good">All habits done for today.</p>`;
    } else {
      pc.innerHTML = unchecked.map(c => `
        <div class="list-item" data-colid="${esc(c.id)}">
          <label><input type="checkbox" class="chk dash-routine-check"><span class="t">${esc(c.title)}</span></label>
          <span class="pill pill-pending">Pending</span>
        </div>`).join('');
      pc.onchange = (e) => {
        if (!e.target.classList.contains('dash-routine-check')) return;
        const colId = e.target.closest('[data-colid]').dataset.colid;
        if (!todayRow.checks) todayRow.checks = {};
        todayRow.checks[colId] = e.target.checked;
        saveData();
        setupDashboardPage();
        icons();
      };
    }
  }

  const tc = $('dashboard-active-tasks');
  const active = excelRows.filter(r => r.status !== 'Completed');
  tc.innerHTML = active.length ? active.map(r => {
    const overdue = r.dueDate && r.dueDate < todayISO;
    return `
    <div class="list-item">
      <div style="min-width:0">
        <p class="t">${esc(r.title) || 'Untitled task'}</p>
        <p class="m num">Created ${formatDateToDMY(r.dateCreated)} · ${r.dueDate ? 'Due ' + formatDateToDMY(r.dueDate) : 'No deadline'}</p>
      </div>
      <span class="pill ${overdue ? '' : 'pill-pending'}" ${overdue ? 'style="background:var(--bad-soft);color:var(--bad)"' : ''}>${overdue ? 'Overdue' : 'Pending'}</span>
    </div>`;
  }).join('') : `<p class="empty-note ${totalT ? 'good' : ''}">${totalT ? 'All tasks are done.' : 'No tasks yet. Add your first one.'}</p>`;

  const accent = cssVar('--accent'), teal = cssVar('--teal'), ink3 = cssVar('--ink-3'), line = cssVar('--line'), ink = cssVar('--ink'), surface = cssVar('--surface');
  const labelFor = (d) => `${DAYS[new Date(d + 'T00:00:00').getDay()]} ${formatDateToDMY(d).slice(0, 5)}`;
  const mkDataset = (label, data, color) => ({
    label, data, borderColor: color, backgroundColor: color + '22', borderWidth: 2.5, tension: .35, fill: true,
    pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: color
  });
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11, family: 'Manrope' }, color: ink3, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, border: { display: false }, ticks: { precision: 0, font: { size: 11, family: 'Manrope' }, color: ink3 }, grid: { color: line } }
    },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: ink, titleColor: surface, bodyColor: surface, padding: 10, cornerRadius: 8, boxPadding: 4 } }
  };

  const dates = new Set();
  routineDateRows.forEach(r => dates.add(r.date));
  excelRows.forEach(r => {
    if (r.dateCreated && r.dateCreated <= todayISO) dates.add(r.dateCreated);
    if (r.dateCompleted && r.dateCompleted <= todayISO) dates.add(r.dateCompleted);
  });
  if (!dates.size) dates.add(todayISO);
  const d1 = Array.from(dates).sort();
  const tasksDone = d1.map(d => excelRows.filter(r => r.status === 'Completed' && r.dateCompleted === d).length);
  const habitsDone = d1.map(d => {
    const row = routineDateRows.find(r => r.date === d);
    if (!row || !row.checks) return 0;
    const validColsForDay = routineColumns.filter(c => (!c.createdDate || c.createdDate <= d) && (!c.archivedDate || c.archivedDate > d));
    return validColsForDay.filter(c => row.checks[c.id] === true).length;
  });
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (appChartInstance) { appChartInstance.destroy(); appChartInstance = null; }
  const c1 = $('dailyCompletionChart');
  if (c1 && window.Chart) chartInstance = new Chart(c1, { type: 'line', data: { labels: d1.map(labelFor), datasets: [mkDataset('Tasks completed', tasksDone, accent), mkDataset('Habits completed', habitsDone, teal)] }, options: chartOpts });

  const ad = new Set();
  jobRows.forEach(a => a.dateApplied && ad.add(a.dateApplied));
  internshipRows.forEach(a => a.dateApplied && ad.add(a.dateApplied));
  if (!ad.size) ad.add(todayISO);
  const d2 = Array.from(ad).sort();
  const c2 = $('applicationsChart');
  if (c2 && window.Chart) appChartInstance = new Chart(c2, { type: 'line', data: { labels: d2.map(labelFor), datasets: [
    mkDataset('Jobs', d2.map(d => jobRows.filter(a => a.dateApplied === d).length), accent),
    mkDataset('Internships', d2.map(d => internshipRows.filter(a => a.dateApplied === d).length), teal)
  ] }, options: chartOpts });
}

/* ---------- Tasks ---------- */
function setupExcelPage() {
  if (!currentUser) return;
  const body = $('excel-grid-body');
  const mobileContainer = $('mobile-tasks-container');

  const render = () => {
    const today = getTodayISO();
    if (!excelRows.length) {
      const emptyHTML = `<div class="empty-state"><div class="ico"><i data-lucide="check-square"></i></div><h3>No tasks yet</h3><p>Click “Add task” to create your first one.</p></div>`;
      body.innerHTML = `<tr><td colspan="7">${emptyHTML}</td></tr>`;
      mobileContainer.innerHTML = emptyHTML;
      icons(); return;
    }

    body.innerHTML = excelRows.map((row) => {
      if (!row.dateCreated) row.dateCreated = today;
      const done = row.status === 'Completed';
      const overdue = !done && row.dueDate && row.dueDate < today;
      return `
      <tr data-id="${esc(row.id)}">
        <td class="center"><input type="checkbox" class="chk row-checkbox" aria-label="Mark complete" ${done ? 'checked' : ''}></td>
        <td><input type="text" class="cell cell-title ${done ? 'done' : ''}" value="${esc(row.title)}" placeholder="What needs to be done?"></td>
        <td><input type="text" class="cell num" value="${formatDateToDMY(row.dateCreated)}" readonly tabindex="-1"></td>
        <td><input type="date" class="cell cell-date num ${overdue ? 'overdue' : ''}" value="${esc(row.dueDate || '')}"></td>
        <td><input type="text" class="cell cell-completed num ${done ? 'ok' : ''}" value="${row.dateCompleted ? formatDateToDMY(row.dateCompleted) : ''}" readonly tabindex="-1" placeholder="–"></td>
        <td><span class="pill ${done ? 'pill-done' : 'pill-pending'}">${done ? 'Completed' : 'Pending'}</span></td>
        <td class="center"><button class="icon-btn danger delete-task-row-btn" title="Delete task" aria-label="Delete task"><i data-lucide="trash-2"></i></button></td>
      </tr>`;
    }).join('');

    mobileContainer.innerHTML = excelRows.map((row) => {
      if (!row.dateCreated) row.dateCreated = today;
      const done = row.status === 'Completed';
      const overdue = !done && row.dueDate && row.dueDate < today;
      return `
      <div class="notification-card" data-id="${esc(row.id)}">
        <div class="notification-card-header">
          <label style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
            <input type="checkbox" class="chk row-checkbox" ${done ? 'checked' : ''}>
            <input type="text" class="cell cell-title ${done ? 'done' : ''}" value="${esc(row.title)}" placeholder="What needs to be done?" style="font-size:15px;font-weight:700">
          </label>
          <button class="icon-btn danger delete-task-row-btn" title="Delete task" aria-label="Delete task"><i data-lucide="trash-2"></i></button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
          <div style="flex:1;min-width:130px;">
            <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:4px">Deadline</label>
            <input type="date" class="cell cell-date num ${overdue ? 'overdue' : ''}" value="${esc(row.dueDate || '')}" style="background:var(--surface-2)">
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:4px">Status</label>
            <span class="pill ${done ? 'pill-done' : 'pill-pending'}">${done ? 'Completed' : 'Pending'}</span>
          </div>
        </div>
        <div class="notification-card-footer">
          <span>Created ${formatDateToDMY(row.dateCreated)}</span>
          <span>${row.dateCompleted ? 'Done ' + formatDateToDMY(row.dateCompleted) : ''}</span>
        </div>
      </div>`;
    }).join('');

    icons();
  };
  render();

  const handleTaskChange = (containerEl) => {
    containerEl.addEventListener('input', (e) => {
      const card = e.target.closest('[data-id]'); if (!card) return;
      const row = excelRows.find(r => r.id === card.dataset.id); if (!row) return;
      if (e.target.classList.contains('cell-title')) row.title = e.target.value;
      if (e.target.classList.contains('cell-date')) row.dueDate = e.target.value;
      saveData();
    });

    containerEl.addEventListener('change', (e) => {
      const card = e.target.closest('[data-id]'); if (!card) return;
      const row = excelRows.find(r => r.id === card.dataset.id); if (!row) return;
      if (e.target.classList.contains('cell-date')) {
        row.dueDate = e.target.value;
        saveData(); render();
      } else if (e.target.classList.contains('row-checkbox')) {
        const done = e.target.checked;
        const today = getTodayISO();
        row.status = done ? 'Completed' : 'Not completed';
        row.dateCompleted = done ? today : '';
        saveData(); render();
      }
    });

    containerEl.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.delete-task-row-btn')) {
        excelRows = excelRows.filter(r => r.id !== id); saveData(); render();
      }
    });
  };

  handleTaskChange(body);
  handleTaskChange(mobileContainer);

  $('add-row-btn').addEventListener('click', () => {
    const today = getTodayISO();
    excelRows.unshift({ id: crypto.randomUUID(), title: '', dateCreated: today, dueDate: today, dateCompleted: '', status: 'Not completed' });
    saveData(); render();
    const inputs = document.querySelectorAll('.cell-title');
    inputs[0]?.focus();
  });
}

/* ---------- Habits ---------- */
function setupRecurringPage() {
  if (!currentUser) return;
  const headerRow = $('matrix-header-row');
  const bodyEl = $('matrix-body');
  const mobileContainer = $('mobile-habits-container');
  const activeCountEl = $('ritual-active-count');
  const daysCountEl = $('ritual-days-count');
  const todayISO = getTodayISO();

  const counts = () => {
    activeCountEl.textContent = `${routineColumns.filter(c => (!c.createdDate || c.createdDate <= todayISO) && (!c.archivedDate || c.archivedDate > todayISO)).length} Total`;
    daysCountEl.textContent = `${routineDateRows.length} Days`;
    const nArch = routineColumns.filter(c => c.archivedDate).length;
    const ac = $('archived-count'); if (ac) ac.textContent = nArch;
    const tg = $('show-archived-toggle'); if (tg) { tg.checked = showArchivedHabits; tg.disabled = !nArch && !showArchivedHabits; }
  };
  counts();

  const render = () => {
    const visibleCols = routineColumns.filter(c => showArchivedHabits || !c.archivedDate);
    headerRow.innerHTML = `<th style="min-width:180px">Date</th>` + visibleCols.map(col => `
      <th class="col" data-colid="${esc(col.id)}">
        <input type="text" class="cell cell-col-title ${col.archivedDate ? 'arch' : ''}" value="${esc(col.title)}" placeholder="Habit name" maxlength="80" style="font-weight:700;padding:4px 6px;">
        <div class="ctools">
          ${!col.archivedDate ? `
            <div style="display:flex;gap:2px;">
              <button class="icon-btn move-col-left" title="Move left" aria-label="Move left"><i data-lucide="arrow-left"></i></button>
              <button class="icon-btn move-col-right" title="Move right" aria-label="Move right"><i data-lucide="arrow-right"></i></button>
            </div>
            <button class="icon-btn danger archive-col-btn" title="Archive habit" aria-label="Archive habit"><i data-lucide="archive"></i></button>
          ` : `
            <span class="pill pill-plain">Archived</span>
            <button class="icon-btn ok unarchive-col-btn" title="Restore habit" aria-label="Restore habit"><i data-lucide="rotate-ccw"></i></button>
          `}
        </div>
      </th>`).join('');

    if (!routineDateRows.length) {
      const emptyHTML = `<div class="empty-state"><div class="ico"><i data-lucide="calendar-plus"></i></div><h3>Nothing logged yet</h3><p>Add a habit above, then click “Log today” to start tracking.</p></div>`;
      bodyEl.innerHTML = `<tr><td colspan="${visibleCols.length + 1}">${emptyHTML}</td></tr>`;
      mobileContainer.innerHTML = emptyHTML;
    } else {
      bodyEl.innerHTML = routineDateRows.map(r => {
        const dObj = new Date(r.date + 'T00:00:00');
        const label = `${DAYS[dObj.getDay()]}, ${formatDateToDMY(r.date)}`;
        const past = r.date < todayISO, isToday = r.date === todayISO;
        return `
        <tr data-rowid="${esc(r.id)}" class="${isToday ? 'is-today' : past ? 'is-past' : ''}">
          <td class="date num"><div class="wrap"><span class="d">${label}</span>${isToday ? '<span class="pill pill-today">Today</span>' : past ? '<span class="pill pill-locked">Locked</span>' : ''}</div></td>
          ${visibleCols.map(col => {
            const created = col.createdDate || '2026-01-01';
            if (r.date < created || (col.archivedDate && r.date >= col.archivedDate)) return `<td class="na">–</td>`;
            const on = r.checks && r.checks[col.id];
            return `<td class="center"><input type="checkbox" class="chk routine-grid-checkbox" aria-label="${esc(col.title)}" data-colid="${esc(col.id)}" ${on ? 'checked' : ''} ${past ? 'disabled' : ''}></td>`;
          }).join('')}
        </tr>`;
      }).join('');

      mobileContainer.innerHTML = routineDateRows.map(r => {
        const dObj = new Date(r.date + 'T00:00:00');
        const label = `${DAYS[dObj.getDay()]} (${formatDateToDMY(r.date)})`;
        const isToday = r.date === todayISO, past = r.date < todayISO;
        return `
        <div class="notification-card" data-rowid="${esc(r.id)}">
          <div class="notification-card-header">
            <span style="font-weight:700;font-size:15px">${label}</span>
            ${isToday ? '<span class="pill pill-today">Today</span>' : past ? '<span class="pill pill-locked">Locked</span>' : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
            ${visibleCols.length ? visibleCols.map(col => {
              const created = col.createdDate || '2026-01-01';
              if (r.date < created || (col.archivedDate && r.date >= col.archivedDate)) return '';
              const on = r.checks && r.checks[col.id];
              return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:var(--surface-2);border-radius:8px;">
                <input type="text" class="cell cell-col-title" data-colid="${esc(col.id)}" value="${esc(col.title)}" placeholder="Habit name" style="font-weight:600;min-width:0;flex:1;padding:2px 4px;">
                <div style="display:flex;align-items:center;gap:10px;flex:none;">
                  ${col.archivedDate ? `<button class="icon-btn ok unarchive-col-btn mobile-unarchive-col-btn" data-colid="${esc(col.id)}" title="Restore habit" aria-label="Restore habit" style="width:28px;height:28px;"><i data-lucide="rotate-ccw" style="width:14px;height:14px"></i></button>` : `<button class="icon-btn danger mobile-archive-col-btn" data-colid="${esc(col.id)}" title="Archive habit" aria-label="Archive habit" style="width:28px;height:28px;"><i data-lucide="archive" style="width:14px;height:14px"></i></button>`}
                  <input type="checkbox" class="chk routine-grid-checkbox" data-colid="${esc(col.id)}" ${on ? 'checked' : ''} ${past ? 'disabled' : ''}>
                </div>
              </div>`;
            }).join('') : '<p class="empty-note">No active habits.</p>'}
          </div>
        </div>`;
      }).join('');
    }
    icons();
  };
  render();

  const handleHabitCheck = (containerEl) => {
    containerEl.addEventListener('change', (e) => {
      if (!e.target.classList.contains('routine-grid-checkbox')) return;
      const rowEl = e.target.closest('[data-rowid]');
      if (!rowEl) return;
      const row = routineDateRows.find(r => r.id === rowEl.dataset.rowid);
      if (row && row.date === todayISO) {
        if (!row.checks) row.checks = {};
        row.checks[e.target.dataset.colid] = e.target.checked;
        saveData();
      }
    });
  };
  handleHabitCheck(bodyEl);
  handleHabitCheck(mobileContainer);

  const handleTitleInput = (e) => {
    const input = e.target.closest('.cell-col-title');
    if (!input) return;
    const colId = input.dataset.colid || input.closest('[data-colid]')?.dataset.colid;
    if (!colId) return;
    const col = routineColumns.find(c => c.id === colId);
    if (col) {
      col.title = input.value;
      saveData();
    }
  };

  headerRow.addEventListener('input', handleTitleInput);
  mobileContainer.addEventListener('input', handleTitleInput);

  const addHabit = () => {
    const input = $('new-column-title');
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    routineColumns.push({ id: 'col_' + Date.now(), title, createdDate: todayISO });
    input.value = '';
    saveData(); render(); counts();
  };
  $('add-column-btn').addEventListener('click', addHabit);
  $('show-archived-toggle').addEventListener('change', (e) => { showArchivedHabits = e.target.checked; render(); });
  $('new-column-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') addHabit(); });

  const handleColumnActions = (targetEl, colId) => {
    const col = routineColumns.find(c => c.id === colId); if (!col) return;
    const idx = routineColumns.findIndex(c => c.id === colId);

    if (targetEl.closest('.archive-col-btn') || targetEl.closest('.mobile-archive-col-btn')) {
      col.archivedDate = todayISO;
      routineColumns = routineColumns.filter(c => c.id !== colId); routineColumns.push(col);
    } else if (targetEl.closest('.unarchive-col-btn')) {
      col.archivedDate = null;
      routineColumns = routineColumns.filter(c => c.id !== colId);
      const firstArch = routineColumns.findIndex(c => c.archivedDate);
      if (firstArch === -1) routineColumns.push(col); else routineColumns.splice(firstArch, 0, col);
    } else if (targetEl.closest('.move-col-left')) {
      if (idx > 0 && !routineColumns[idx - 1].archivedDate) [routineColumns[idx - 1], routineColumns[idx]] = [routineColumns[idx], routineColumns[idx - 1]]; else return;
    } else if (targetEl.closest('.move-col-right')) {
      if (idx < routineColumns.length - 1 && !routineColumns[idx + 1].archivedDate) [routineColumns[idx + 1], routineColumns[idx]] = [routineColumns[idx], routineColumns[idx + 1]]; else return;
    } else return;
    saveData(); render(); counts();
  };

  headerRow.addEventListener('click', (e) => {
    const th = e.target.closest('[data-colid]'); if (!th) return;
    handleColumnActions(e.target, th.dataset.colid);
  });

  mobileContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.mobile-archive-col-btn, .mobile-unarchive-col-btn'); if (!btn) return;
    handleColumnActions(btn, btn.dataset.colid);
  });

  $('add-today-routine-row-btn').addEventListener('click', () => {
    if (routineDateRows.some(r => r.date === todayISO)) return toast(`Today (${formatDateToDMY(todayISO)}) is already logged.`);
    routineDateRows.unshift({ id: crypto.randomUUID(), date: todayISO, checks: {} });
    saveData(); render(); counts();
  });
}

/* ---------- Jobs & Internships ---------- */
function setupApplicationTable({ bodyId, mobileId, addBtnId, getRows, setRows, deleteClass, orgPlaceholder, emptyTitle }) {
  if (!currentUser) return;
  const body = $(bodyId);
  const mobileContainer = $(mobileId);
  const STATUSES = ['Applied', 'Interviewing', 'Offer', 'Rejected'];

  const render = () => {
    const rows = getRows();
    if (!rows.length) {
      const emptyHTML = `<div class="empty-state"><div class="ico"><i data-lucide="briefcase"></i></div><h3>${emptyTitle}</h3><p>Add an application to start tracking it.</p></div>`;
      body.innerHTML = `<tr><td colspan="6">${emptyHTML}</td></tr>`;
      mobileContainer.innerHTML = emptyHTML;
      icons(); return;
    }

    body.innerHTML = rows.map(row => `
      <tr data-id="${esc(row.id)}">
        <td><input type="text" class="cell cell-company strong" value="${esc(row.company)}" placeholder="${orgPlaceholder}"></td>
        <td><input type="text" class="cell cell-role" value="${esc(row.role)}" placeholder="Job title"></td>
        <td><select class="cell cell-status" data-s="${esc(row.status)}">${STATUSES.map(s => `<option value="${s}" ${row.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input type="date" class="cell cell-date num" value="${esc(row.dateApplied || '')}"></td>
        <td><input type="text" class="cell cell-notes" value="${esc(row.notes)}" placeholder="Add a note or link"></td>
        <td class="center"><button class="icon-btn danger ${deleteClass}" title="Delete application" aria-label="Delete application"><i data-lucide="trash-2"></i></button></td>
      </tr>`).join('');

    mobileContainer.innerHTML = rows.map(row => `
      <div class="notification-card" data-id="${esc(row.id)}">
        <div class="notification-card-header">
          <input type="text" class="cell cell-company strong" value="${esc(row.company)}" placeholder="${orgPlaceholder}" style="font-size:15px">
          <button class="icon-btn danger ${deleteClass}" title="Delete application" aria-label="Delete application"><i data-lucide="trash-2"></i></button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input type="text" class="cell cell-role" value="${esc(row.role)}" placeholder="Job title" style="background:var(--surface-2)">
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
            <div style="flex:1;min-width:140px">
              <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:4px">Status</label>
              <select class="cell cell-status" data-s="${esc(row.status)}" style="width:100%">${STATUSES.map(s => `<option value="${s}" ${row.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
            </div>
            <div style="flex:1;min-width:140px">
              <label style="font-size:11.5px;color:var(--ink-3);display:block;margin-bottom:4px">Date applied</label>
              <input type="date" class="cell cell-date num" value="${esc(row.dateApplied || '')}" style="background:var(--surface-2)">
            </div>
          </div>
          <input type="text" class="cell cell-notes" value="${esc(row.notes)}" placeholder="Add a note or link" style="background:var(--surface-2)">
        </div>
        <div class="notification-card-footer">
          <span>Applied on ${formatDateToDMY(row.dateApplied)}</span>
        </div>
      </div>`).join('');

    icons();
  };
  render();

  const findRow = (e) => { const card = e.target.closest('[data-id]'); return card ? getRows().find(r => r.id === card.dataset.id) : null; };

  const handleChanges = (containerEl) => {
    containerEl.addEventListener('input', (e) => {
      const row = findRow(e); if (!row) return;
      if (e.target.classList.contains('cell-company')) row.company = e.target.value;
      if (e.target.classList.contains('cell-role')) row.role = e.target.value;
      if (e.target.classList.contains('cell-notes')) row.notes = e.target.value;
      saveData();
    });
    containerEl.addEventListener('change', (e) => {
      const isDate = e.target.classList.contains('cell-date');
      const isStatus = e.target.classList.contains('cell-status');
      if (!isDate && !isStatus) return;
      const row = findRow(e); if (!row) return;
      if (isDate) row.dateApplied = e.target.value;
      if (isStatus) { row.status = e.target.value; e.target.dataset.s = row.status; }
      saveData(); render();
    });
    containerEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.' + deleteClass); if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      setRows(getRows().filter(r => r.id !== id)); saveData(); render();
    });
  };

  handleChanges(body);
  handleChanges(mobileContainer);

  $(addBtnId).addEventListener('click', () => {
    getRows().unshift({ id: crypto.randomUUID(), company: '', role: '', status: 'Applied', dateApplied: getTodayISO(), notes: '' });
    saveData(); render();
    const inputs = document.querySelectorAll('.cell-company');
    inputs[0]?.focus();
  });
}

function setupJobsPage() {
  setupApplicationTable({ bodyId: 'jobs-grid-body', mobileId: 'mobile-jobs-container', addBtnId: 'add-job-btn', getRows: () => jobRows, setRows: (r) => { jobRows = r; },
    deleteClass: 'delete-job-btn', orgPlaceholder: 'Company', emptyTitle: 'No job applications yet' });
}
function setupInternshipsPage() {
  setupApplicationTable({ bodyId: 'internships-grid-body', mobileId: 'mobile-internships-container', addBtnId: 'add-internship-btn', getRows: () => internshipRows, setRows: (r) => { internshipRows = r; },
    deleteClass: 'delete-internship-btn', orgPlaceholder: 'Organization', emptyTitle: 'No internship applications yet' });
}

/* ---------- Notes ---------- */
function setupNotepadPage() {
  if (!currentUser) return;
  const container = $('notes-list-container');
  const titleInput = $('note-title-input');
  const bodyTextarea = $('note-body-textarea');
  const statusBadge = $('note-status-badge');
  const mainLayout = $('notes-main-layout');
  const noNoteBox = $('no-note-selected');
  const editorWrapper = $('active-note-editor');

  const render = () => {
    $('notes-counter').textContent = userNotesList.length;
    container.innerHTML = userNotesList.length ? userNotesList.map(n => `
      <div class="card note-item ${n.id === activeNoteId ? 'active' : ''}" data-id="${esc(n.id)}" style="margin-bottom:12px;">
        <div class="row"><p class="note-title">${esc(n.title) || 'Untitled note'}</p><span class="note-date num">${esc(n.date)}</span></div>
        <p class="note-snip">${esc(n.body) || 'No content yet'}</p>
      </div>`).join('') : `<p class="empty-note">No notes available. Create one to begin.</p>`;

    const active = userNotesList.find(n => n.id === activeNoteId);

    if (active) {
      editorWrapper.classList.remove('hidden');
      noNoteBox.classList.add('hidden');
      titleInput.value = active.title || '';
      bodyTextarea.value = active.body || '';
      $('note-date-tag').textContent = active.date || formatDateToDMY(getTodayISO());
      mainLayout.classList.add('has-active-note');
    } else {
      editorWrapper.classList.add('hidden');
      noNoteBox.classList.remove('hidden');
      mainLayout.classList.remove('has-active-note');
    }
    icons();
  };
  render();

  let timer;
  const handleEdit = () => {
    const active = userNotesList.find(n => n.id === activeNoteId); if (!active) return;
    active.title = titleInput.value; active.body = bodyTextarea.value;
    const item = container.querySelector(`[data-id="${CSS.escape(activeNoteId)}"]`);
    if (item) {
      item.querySelector('.note-title').textContent = active.title || 'Untitled note';
      item.querySelector('.note-snip').textContent = active.body || 'No content yet';
    }
    statusBadge.textContent = 'Saving…'; statusBadge.classList.add('saving');
    saveData();
    clearTimeout(timer);
    timer = setTimeout(() => { statusBadge.textContent = 'Saved'; statusBadge.classList.remove('saving'); }, 700);
  };
  titleInput.addEventListener('input', handleEdit);
  bodyTextarea.addEventListener('input', handleEdit);

  const insertBullet = () => {
    const s = bodyTextarea.selectionStart, e = bodyTextarea.selectionEnd, v = bodyTextarea.value, b = '\n• ';
    bodyTextarea.value = v.slice(0, s) + b + v.slice(e);
    bodyTextarea.selectionStart = bodyTextarea.selectionEnd = s + b.length;
    handleEdit();
  };

  bodyTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      const start = bodyTextarea.selectionStart;
      const lines = bodyTextarea.value.substring(0, start).split('\n');
      const lastLine = lines[lines.length - 1];
      if (lastLine.trim().startsWith('•')) {
        e.preventDefault();
        insertBullet();
      }
    }
  });
  $('add-bullet-btn').addEventListener('click', () => { insertBullet(); bodyTextarea.focus(); });

  container.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (item) {
      activeNoteId = item.dataset.id;
      render();
    }
  });

  $('notes-back-btn').addEventListener('click', () => {
    activeNoteId = null;
    mainLayout.classList.remove('has-active-note');
    render();
  });

  $('create-new-note-btn').addEventListener('click', () => {
    const n = { id: crypto.randomUUID(), title: 'New note', body: '• ', date: formatDateToDMY(getTodayISO()) };
    userNotesList.unshift(n);
    activeNoteId = n.id;
    saveData();
    render();
    titleInput.focus();
    titleInput.select();
  });

  const noNoteCreateBtn = $('no-note-create-btn');
  if (noNoteCreateBtn) noNoteCreateBtn.addEventListener('click', () => {
    const n = { id: crypto.randomUUID(), title: 'New note', body: '• ', date: formatDateToDMY(getTodayISO()) };
    userNotesList.unshift(n);
    activeNoteId = n.id;
    saveData();
    render();
    titleInput.focus();
    titleInput.select();
  });

  $('delete-active-note-btn').addEventListener('click', () => {
    if (!activeNoteId) return;
    userNotesList = userNotesList.filter(n => n.id !== activeNoteId);
    activeNoteId = null;
    saveData();
    mainLayout.classList.remove('has-active-note');
    render();
    toast('Note deleted.');
  });

  $('download-pdf-btn').addEventListener('click', () => {
    const active = userNotesList.find(n => n.id === activeNoteId); if (!active) return;
    if (!window.html2pdf) return toast('PDF export is unavailable right now.');
    const title = active.title || '5Dots note';
    const el = document.createElement('div');
    el.style.cssText = "padding:32px;background:#fff;color:#101828;font-family:'Manrope',Arial,sans-serif";
    el.innerHTML = `
      <div style="border-bottom:2px solid #e4e7ec;padding-bottom:12px;margin-bottom:18px">
        <h1 style="font-size:22px;font-weight:800;margin:0">${esc(title)}</h1>
        <p style="font-size:12px;color:#667085;margin:6px 0 0">${esc(active.date || '')} · Exported from 5Dots</p>
      </div>
      <pre style="font-family:inherit;font-size:13px;line-height:1.7;white-space:pre-wrap;word-wrap:break-word;margin:0">${esc(active.body || '')}</pre>`;
    html2pdf().set({
      margin: 10, filename: `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.platform.pdf`,
      image: { type: 'jpeg', quality: .98 }, html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(el).save();
  });
}

icons();
