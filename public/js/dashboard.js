let currentUser = null;
let groups = [];
let sseSource = null;

async function init() {
  if (!requireLogin()) return;
  try {
    currentUser = await API.get('/auth/me');
    localStorage.setItem('user', JSON.stringify(currentUser));
    document.getElementById('navName').textContent = currentUser.name;
    document.getElementById('navPlan').textContent = currentUser.plan.toUpperCase();

    // Handle post-payment redirect
    const params = new URLSearchParams(location.search);
    if (params.get('payment') === 'success') {
      toast('Subscription activated! Welcome to ' + currentUser.plan + ' plan.', 'success');
      history.replaceState({}, '', '/dashboard.html');
    }

    await loadOverview();
    await loadGroups();
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('token')) logout();
  }
}

// ── Pages ──────────────────────────────────────────────────────────────────

function showPage(name, btn) {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('page-' + name).style.display = 'block';
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  btn.classList.add('active');

  if (name === 'whatsapp') renderWhatsApp();
  if (name === 'groups') renderGroups();
  if (name === 'birthdays') renderBirthdayPage();
  if (name === 'billing') renderBilling();
}

// ── Overview ───────────────────────────────────────────────────────────────

async function loadOverview() {
  const [groupsData, upcoming] = await Promise.all([
    API.get('/groups'),
    API.get('/birthdays/upcoming'),
  ]);
  groups = groupsData;

  const totalBirthdays = groups.reduce((s, g) => s + (g.birthday_count || 0), 0);
  const statsEl = document.getElementById('overviewStats');
  statsEl.innerHTML = '';
  const stats = [
    { value: groups.length, label: 'Groups' },
    { value: totalBirthdays, label: 'Birthdays' },
    { value: currentUser.whatsapp_connected ? '✓' : '✗', label: 'WhatsApp' },
    { value: currentUser.plan.charAt(0).toUpperCase() + currentUser.plan.slice(1), label: 'Plan' },
  ];
  for (const s of stats) {
    statsEl.innerHTML += `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`;
  }

  const upcomingEl = document.getElementById('upcomingList');
  if (!upcoming.length) {
    upcomingEl.innerHTML = '<p style="color:var(--gray);font-size:14px">No upcoming birthdays. Add some in the Birthdays section.</p>';
    return;
  }
  upcomingEl.innerHTML = upcoming.map(b => {
    const today = new Date();
    const isToday = b.birth_day === today.getDate() && b.birth_month === (today.getMonth() + 1);
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <strong>${b.person_name}</strong>
        <span style="color:var(--gray);font-size:13px;margin-left:8px">${b.group_name}</span>
        ${isToday ? '<span class="badge badge-green" style="margin-left:8px">Today! 🎂</span>' : ''}
      </div>
      <span style="color:var(--gray);font-size:14px">${formatDate(b.birth_day, b.birth_month, b.birth_year)}</span>
    </div>`;
  }).join('');
}

// ── WhatsApp ───────────────────────────────────────────────────────────────

let pollTimer = null;

function renderWhatsApp() {
  const status = currentUser.whatsapp_connected ? 'connected' : 'disconnected';
  updateWAUI(status, null);
}

function updateWAUI(status, qr) {
  const statusEl = document.getElementById('waStatus');
  const qrEl = document.getElementById('waQR');
  const actionsEl = document.getElementById('waActions');

  if (status === 'connected') {
    qrEl.style.display = 'none';
    statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px">
      <span class="badge badge-green">● Connected</span>
      <span style="font-size:14px;color:var(--gray)">Your WhatsApp is linked and the bot is active.</span>
    </div>`;
    actionsEl.innerHTML = `
      <button class="btn btn-secondary" onclick="syncGroups()">🔄 Sync Groups</button>
      <button class="btn btn-danger" onclick="disconnectWA()">Disconnect</button>`;
  } else if (status === 'connecting') {
    statusEl.innerHTML = `<span class="badge badge-yellow">⏳ Connecting — waiting for QR scan...</span>`;
    if (qr) {
      document.getElementById('qrImage').src = qr;
      qrEl.style.display = 'block';
    }
    actionsEl.innerHTML = '';
  } else if (status === 'error') {
    qrEl.style.display = 'none';
    statusEl.innerHTML = `<span class="badge badge-red">Connection Error</span>`;
    actionsEl.innerHTML = `<button class="btn btn-primary" onclick="connectWA()">Retry</button>`;
  } else {
    qrEl.style.display = 'none';
    statusEl.innerHTML = `<div>
      <span class="badge badge-gray">● Disconnected</span>
      <p style="margin-top:12px;font-size:14px;color:var(--gray)">Connect your WhatsApp to start sending birthday messages.</p>
    </div>`;
    actionsEl.innerHTML = `<button class="btn btn-primary" onclick="connectWA()">📱 Connect WhatsApp</button>`;
  }
}

async function connectWA() {
  updateWAUI('connecting', null);
  stopPolling();
  await API.post('/whatsapp/start');
  startPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollQR, 2000);
  pollQR(); // immediate first check
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollQR() {
  try {
    const { state, qr } = await API.get('/whatsapp/qr');
    updateWAUI(state, qr);
    if (state === 'connected') {
      stopPolling();
      currentUser.whatsapp_connected = true;
      toast('WhatsApp connected!', 'success');
      await loadGroups();
    } else if (state === 'disconnected' && !qr) {
      // Session not started yet, don't stop polling
    }
  } catch (_) {}
}

async function disconnectWA() {
  if (!confirm('Disconnect WhatsApp? The bot will stop sending messages.')) return;
  stopPolling();
  await API.post('/whatsapp/disconnect');
  currentUser.whatsapp_connected = false;
  updateWAUI('disconnected', null);
  toast('WhatsApp disconnected', '');
}

async function syncGroups() {
  try {
    await API.post('/whatsapp/sync-groups');
    await loadGroups();
    toast('Groups synced!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Groups ─────────────────────────────────────────────────────────────────

async function loadGroups() {
  groups = await API.get('/groups');
  renderGroups();
  populateGroupSelect();
}

function renderGroups() {
  const el = document.getElementById('groupsList');
  if (!groups.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">👥</div><h3>No groups yet</h3><p>Connect WhatsApp first, then add your groups.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="card table-wrap"><table>
    <thead><tr><th>Group Name</th><th>Birthdays</th><th>Status</th><th>Custom Message</th><th></th></tr></thead>
    <tbody>${groups.map(g => `
      <tr>
        <td><strong>${g.group_name}</strong></td>
        <td>${g.birthday_count || 0}</td>
        <td>${g.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Paused</span>'}</td>
        <td style="color:var(--gray);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.custom_message || '<em>Default</em>'}</td>
        <td style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditGroup(${g.id}, \`${(g.custom_message||'').replace(/`/g,'\\`')}\`)">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="testGroup(${g.id}, '${g.group_name.replace(/'/g,"\\'")}')">🧪 Test</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGroup(${g.id})">Remove</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function openAddGroupModal() {
  if (!currentUser.whatsapp_connected) {
    toast('Connect WhatsApp first', 'error'); return;
  }
  const list = document.getElementById('groupPickerList');
  if (!groups.length) {
    list.innerHTML = '<p style="color:var(--gray);font-size:14px;text-align:center;padding:20px">No groups found. Sync groups from the WhatsApp page.</p>';
  } else {
    list.innerHTML = groups.map(g => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
        <span style="font-size:14px">${g.group_name}</span>
        <span class="badge badge-green">Added</span>
      </div>`).join('') + `<p style="font-size:13px;color:var(--gray);margin-top:8px">Groups are synced automatically when you connect WhatsApp. Use "Sync Groups" to refresh.</p>`;
  }
  document.getElementById('addGroupModal').style.display = 'flex';
}

function openEditGroup(id, message) {
  document.getElementById('editGroupId').value = id;
  document.getElementById('editGroupMessage').value = message;
  document.getElementById('editGroupModal').style.display = 'flex';
}

async function saveGroup() {
  const id = document.getElementById('editGroupId').value;
  const custom_message = document.getElementById('editGroupMessage').value.trim();
  try {
    await API.put('/groups/' + id, { custom_message: custom_message || null });
    await loadGroups();
    closeModal('editGroupModal');
    toast('Group updated', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteGroup(id) {
  if (!confirm('Remove this group? All its birthdays will be deleted.')) return;
  try {
    await API.delete('/groups/' + id);
    await loadGroups();
    toast('Group removed', '');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function testGroup(id, name) {
  if (!confirm(`Send a test birthday message to "${name}"?`)) return;
  try {
    await API.post('/whatsapp/test', { groupId: id });
    toast(`Test message sent to ${name}! 🎉`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Birthdays ──────────────────────────────────────────────────────────────

function renderBirthdayPage() {
  populateGroupSelect();
}

function populateGroupSelect() {
  const sel = document.getElementById('groupSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select group —</option>' +
    groups.map(g => `<option value="${g.id}">${g.group_name}</option>`).join('');
  if (current) sel.value = current;
}

async function loadBirthdays() {
  const groupId = document.getElementById('groupSelect').value;
  const el = document.getElementById('birthdaysList');
  if (!groupId) { el.innerHTML = ''; return; }

  const group = groups.find(g => g.id == groupId);
  document.getElementById('birthdayGroupLabel').textContent = group ? group.group_name : '';

  try {
    const birthdays = await API.get('/birthdays/group/' + groupId);
    if (!birthdays.length) {
      el.innerHTML = `<div class="empty-state"><div class="icon">🎂</div><h3>No birthdays yet</h3><p>Add birthdays for people in this group.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="card table-wrap"><table>
      <thead><tr><th>Name</th><th>Birthday</th><th></th></tr></thead>
      <tbody>${birthdays.map(b => `
        <tr>
          <td><strong>${b.person_name}</strong></td>
          <td>${formatDate(b.birth_day, b.birth_month, b.birth_year)}</td>
          <td style="text-align:right"><button class="btn btn-danger btn-sm" onclick="deleteBirthday(${b.id})">Remove</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openAddBirthdayModal() {
  const groupId = document.getElementById('groupSelect').value;
  if (!groupId) { toast('Select a group first', 'error'); return; }
  ['bdName','bdDay','bdYear'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('bdMonth').value = '';
  document.getElementById('addBirthdayModal').style.display = 'flex';
}

async function addBirthday() {
  const groupId = document.getElementById('groupSelect').value;
  const name = document.getElementById('bdName').value.trim();
  const day = parseInt(document.getElementById('bdDay').value);
  const month = parseInt(document.getElementById('bdMonth').value);
  const year = document.getElementById('bdYear').value ? parseInt(document.getElementById('bdYear').value) : null;

  if (!name || !day || !month) { toast('Name, day and month are required', 'error'); return; }

  try {
    await API.post('/birthdays/group/' + groupId, { person_name: name, birth_day: day, birth_month: month, birth_year: year });
    await loadBirthdays();
    await loadOverview();
    closeModal('addBirthdayModal');
    toast('Birthday added!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteBirthday(id) {
  if (!confirm('Remove this birthday?')) return;
  try {
    await API.delete('/birthdays/' + id);
    await loadBirthdays();
    await loadOverview();
    toast('Birthday removed', '');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Billing ────────────────────────────────────────────────────────────────

function renderBilling() {
  const el = document.getElementById('billingContent');
  const plan = currentUser.plan;

  if (plan === 'free') {
    el.innerHTML = `
      <div class="plan-banner" style="background:var(--dark)">
        <div><div class="plan-name">Free Plan</div><div class="plan-detail">2 groups · 15 birthdays</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px">
        ${planCard('Pro','$7/mo','10 groups · Unlimited birthdays · Custom messages','pro')}
        ${planCard('Business','$19/mo','Unlimited everything · Priority support','business')}
      </div>`;
  } else {
    const ends = currentUser.subscription_ends_at
      ? new Date(currentUser.subscription_ends_at * 1000).toLocaleDateString()
      : 'N/A';
    el.innerHTML = `
      <div class="plan-banner">
        <div>
          <div class="plan-name">${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan</div>
          <div class="plan-detail">Renews ${ends}</div>
        </div>
        <button class="btn btn-upgrade" onclick="openPortal()">Manage Subscription</button>
      </div>
      <p style="font-size:14px;color:var(--gray)">To cancel, change plan, or update payment details, click "Manage Subscription" above.</p>`;
  }
}

function planCard(name, price, desc, plan) {
  return `<div class="card" style="text-align:center">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">${name}</div>
    <div style="font-size:32px;font-weight:800;margin-bottom:4px">${price}</div>
    <div style="color:var(--gray);font-size:14px;margin-bottom:20px">${desc}</div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="checkout('${plan}')">Upgrade to ${name}</button>
  </div>`;
}

async function checkout(plan) {
  try {
    const { url } = await API.post('/billing/checkout', { plan });
    window.location.href = url;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openPortal() {
  try {
    const { url } = await API.post('/billing/portal');
    window.location.href = url;
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Utils ──────────────────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
});

init();
