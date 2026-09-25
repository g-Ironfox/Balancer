const memberRows = document.querySelector('#member-rows');
const memberStatus = document.querySelector('#member-status');
const roleLabels = { member: '会员', user: '普通成员', core: '核心成员', admin: '系统管理员' };

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const button = document.querySelector('#theme-toggle');
  button.textContent = dark ? '☀' : '☾';
  button.title = dark ? '切换浅色模式' : '切换暗色模式';
  button.setAttribute('aria-label', button.title);
}

function renderMembers(members, currentUser) {
  memberRows.replaceChildren();
  document.querySelector('#member-count').textContent = `共 ${members.length} 位成员`;
  for (const member of members) {
    const row = memberRows.insertRow();
    const account = row.insertCell();
    const label = document.createElement('span');
    label.className = 'member-account';
    const avatar = document.createElement('span');
    avatar.className = 'member-avatar';
    avatar.textContent = member.username.slice(0, 1).toUpperCase();
    const username = document.createElement('span');
    username.textContent = member.username;
    label.append(avatar, username);
    account.append(label);
    row.insertCell().textContent = member.real_name || '未填写';
    row.insertCell().textContent = member.student_id || '未填写';
    row.insertCell().textContent = member.college_major || '未填写';
    const roleCell = row.insertCell();
    if (currentUser.role !== 'admin') {
      roleCell.textContent = roleLabels[member.role] || member.role;
    } else {
      const select = document.createElement('select');
      select.className = 'member-role';
      select.setAttribute('aria-label', `${member.username} 的身份`);
      for (const [value, label] of Object.entries(roleLabels)) {
        select.add(new Option(label, value));
      }
      select.value = member.role;
      if (member.id === currentUser.id) select.disabled = true;
      const feedback = document.createElement('span');
      feedback.className = 'role-feedback';
      feedback.setAttribute('role', 'status');
      select.addEventListener('change', async () => {
        const previousRole = member.role;
        select.disabled = true;
        feedback.textContent = '保存中…';
        try {
          const response = await fetch(`/api/admin/members/${member.id}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: select.value }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '保存失败，请重试');
          }
          member.role = select.value;
          feedback.textContent = '已保存';
        } catch (error) {
          select.value = previousRole;
          feedback.textContent = error.message;
        } finally {
          select.disabled = member.id === currentUser.id;
        }
      });
      roleCell.append(select, feedback);
    }
    row.insertCell().textContent = member.created_at
      ? new Date(member.created_at).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
  }
  memberStatus.hidden = members.length > 0;
  if (!members.length) memberStatus.textContent = '暂无已注册成员';
}

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('club-desk-theme', theme);
  applyTheme(theme);
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});

async function boot() {
  applyTheme(localStorage.getItem('club-desk-theme') || 'light');
  let user;
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) throw new Error('请先登录');
    user = await response.json();
    if (!['user', 'core', 'admin'].includes(user.role)) throw new Error('没有后台权限');
    document.querySelector('#profile-avatar').textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector('#profile-username').textContent = user.username;
    document.querySelector('#profile-role').textContent = roleLabels[user.role];
  } catch { window.location.replace('/login'); return; }
  try {
    const response = await fetch('/api/admin/members');
    if (!response.ok) throw new Error('加载成员失败');
    renderMembers(await response.json(), user);
  } catch (error) { memberStatus.textContent = error.message; }
}

boot();