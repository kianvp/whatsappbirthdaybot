async function init() {
  if (!requireLogin()) return;
  const user = getUser();
  if (!user?.is_admin) {
    window.location.href = '/dashboard.html';
    return;
  }
  await loadStats();
}

function showTab(name, btn) {
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = 'none');
  document.getElementById('tab-' + name).style.display = 'block';
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'users') loadUsers();
  if (name === 'logs') loadLogs();
}

async function loadStats() {
  try {
    const s = await API.get('/admin/stats');
    const grid = document.getElementById('statsGrid');
    const items = [
      { value: s.total_users, label: 'Total Users' },
      { value: s.active_users, label: 'Active Users' },
      { value: s.paying_customers, label: 'Paying Customers' },
      { value: s.connected_sessions, label: 'Live Sessions' },
      { value: s.total_groups, label: 'Total Groups' },
      { value: s.total_birthdays, label: 'Total Birthdays' },
      { value: s.messages_today, label: 'Messages Today' },
    ];
    grid.innerHTML = items.map(i =>
      `<div class="stat-card"><div class="stat-value">${i.value}</div><div class="stat-label">${i.label}</div></div>`
    ).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadUsers() {
  try {
    const users = await API.get('/admin/users');
    const tbody = document.getElementById('usersBody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray)">No users yet</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => {
      const joined = new Date(u.created_at * 1000).toLocaleDateString();
      const planBadge = u.plan === 'business' ? 'blue' : u.plan === 'pro' ? 'green' : 'gray';
      const statusBadge = u.is_active ? 'badge-green' : 'badge-red';
      const statusText = u.is_active ? 'Active' : 'Suspended';
      const waBadge = u.whatsapp_connected ? 'badge-green' : 'badge-gray';
      const waText = u.whatsapp_connected ? 'Connected' : 'Off';
      return `<tr>
        <td>
          <div style="font-weight:600">${u.name}</div>
          <div style="font-size:12px;color:var(--gray)">${u.email}</div>
        </td>
        <td><span class="badge badge-${planBadge}">${u.plan.toUpperCase()}</span></td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td><span class="badge ${waBadge}">${waText}</span></td>
        <td>${u.group_count}</td>
        <td>${u.birthday_count}</td>
        <td style="font-size:13px;color:var(--gray)">${joined}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}"
              onclick="toggleUser(${u.id}, ${u.is_active})">
              ${u.is_active ? 'Suspend' : 'Activate'}
            </button>
            ${u.whatsapp_connected ? `<button class="btn btn-sm btn-secondary" onclick="disconnectUser(${u.id})">Disconnect WA</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleUser(id, currentlyActive) {
  const action = currentlyActive ? 'suspend' : 'activate';
  if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this user?`)) return;
  try {
    const result = await API.post(`/admin/users/${id}/toggle`);
    toast(`User ${result.is_active ? 'activated' : 'suspended'}`, result.is_active ? 'success' : '');
    await loadUsers();
    await loadStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function disconnectUser(id) {
  if (!confirm('Disconnect this user\'s WhatsApp?')) return;
  try {
    await API.post(`/admin/users/${id}/disconnect`);
    toast('WhatsApp disconnected', '');
    await loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadLogs() {
  try {
    const logs = await API.get('/admin/logs');
    const tbody = document.getElementById('logsBody');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray)">No messages sent yet</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const time = new Date(l.sent_at * 1000).toLocaleString();
      const statusBadge = l.success ? 'badge-green' : 'badge-red';
      const statusText = l.success ? 'Sent ✓' : 'Failed ✗';
      return `<tr>
        <td style="font-size:13px;color:var(--gray)">${time}</td>
        <td style="font-size:13px">${l.name}<br/><span style="color:var(--gray);font-size:12px">${l.email}</span></td>
        <td style="font-size:13px">${l.group_name}</td>
        <td style="font-size:13px">${l.person_name}</td>
        <td><span class="badge ${statusBadge}">${statusText}</span>${l.error ? `<br/><span style="font-size:11px;color:var(--red)">${l.error}</span>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

init();
