const memberRows = document.querySelector('#member-rows');
const memberStatus = document.querySelector('#member-status');
const addMemberButton = document.querySelector('#add-member-button');
const memberDialog = document.querySelector('#member-dialog');
const memberForm = document.querySelector('#member-form');
const memberUsername = document.querySelector('#member-username');
const memberPassword = document.querySelector('#member-password');
const memberRole = document.querySelector('#member-role');
const memberDepartmentField = document.querySelector('#member-department-field');
const memberDepartment = document.querySelector('#member-department');
const memberFeedback = document.querySelector('#member-feedback');
const createMemberButton = document.querySelector('#create-member');
const passwordDialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#password-form');
const passwordTarget = document.querySelector('#password-target');
const newPassword = document.querySelector('#new-password');
const confirmPassword = document.querySelector('#confirm-password');
const passwordFeedback = document.querySelector('#password-feedback');
const savePassword = document.querySelector('#save-password');
const roleLabels = { member: '会员', user: '普通成员', core: '核心成员', admin: '系统管理员' };
let departments = [];

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
      roleCell.className = 'member-role-cell';
      const roleEditor = document.createElement('div');
      roleEditor.className = 'role-editor';
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
      roleEditor.append(select, feedback);
      roleCell.append(roleEditor);
    }
    const departmentCell = row.insertCell();
    if (currentUser.role === 'admin' && ['user', 'core'].includes(member.role)) {
      const select = document.createElement('select');
      select.className = 'member-department';
      select.setAttribute('aria-label', `${member.username} 的所属部门`);
      select.add(new Option('选择部门', ''));
      for (const department of departments) select.add(new Option(department.name, department.id));
      select.value = member.department_id || '';
      const feedback = document.createElement('span');
      feedback.className = 'role-feedback';
      const editor = document.createElement('div');
      editor.className = 'role-editor';
      select.addEventListener('change', async () => {
        select.disabled = true;
        feedback.textContent = '保存中…';
        try {
          if (!select.value) {
            const response = await fetch(`/api/admin/members/${member.id}/department`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ department_id: '' }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.detail || '保存失败，请重试');
            }
            member.department_id = '';
            feedback.textContent = '已清除';
            return;
          }
          const response = await fetch(`/api/admin/members/${member.id}/department`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ department_id: select.value }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '保存失败，请重试');
          }
          member.department_id = select.value;
          feedback.textContent = '已保存';
        } catch (error) {
          select.value = member.department_id || '';
          feedback.textContent = error.message;
        } finally { select.disabled = false; }
      });
      editor.append(select, feedback);
      departmentCell.append(editor);
    } else {
      departmentCell.textContent = departments.find((item) => item.id === member.department_id)?.name || '未分配';
    }
    row.insertCell().textContent = member.created_at
      ? new Date(member.created_at).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
    const actionCell = row.insertCell();
    if (currentUser.role === 'admin') {
      const button = document.createElement('button');
      button.className = 'text-button password-button';
      button.type = 'button';
      button.textContent = '修改密码';
      button.addEventListener('click', () => openPasswordDialog(member));
      actionCell.append(button);
    } else {
      actionCell.textContent = '—';
    }
  }
  memberStatus.hidden = members.length > 0;
  if (!members.length) memberStatus.textContent = '暂无已注册成员';
}

function openPasswordDialog(member) {
  passwordDialog.dataset.memberId = member.id;
  passwordTarget.textContent = `正在修改：${member.username}`;
  passwordForm.reset();
  passwordFeedback.textContent = '';
  passwordDialog.showModal();
  newPassword.focus();
}

function openMemberDialog() {
  memberForm.reset();
  memberFeedback.textContent = '';
  memberRole.value = 'member';
  updateDepartmentField();
  memberDialog.showModal();
  memberUsername.focus();
}

function updateDepartmentField() {
  const needsDepartment = ['user', 'core'].includes(memberRole.value);
  memberDepartmentField.hidden = !needsDepartment;
  memberDepartment.required = needsDepartment;
}

memberRole.addEventListener('change', updateDepartmentField);

addMemberButton.addEventListener('click', openMemberDialog);
memberForm.querySelectorAll('[value="cancel"]').forEach((button) => {
  button.addEventListener('click', () => memberDialog.close());
});

memberForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  createMemberButton.dataset.busy = 'true';
  createMemberButton.textContent = '创建中…';
  memberFeedback.textContent = '';
  try {
    const response = await fetch('/api/admin/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: memberUsername.value, password: memberPassword.value,
        role: memberRole.value, department_id: memberDepartment.value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || '创建失败，请重试');
    }
    memberDialog.close();
    await loadMembers();
  } catch (error) {
    memberFeedback.textContent = error.message;
  } finally {
    delete createMemberButton.dataset.busy;
    createMemberButton.textContent = '创建成员';
  }
});

passwordForm.querySelectorAll('[value="cancel"]').forEach((button) => {
  button.addEventListener('click', () => passwordDialog.close());
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (newPassword.value !== confirmPassword.value) {
    passwordFeedback.textContent = '两次输入的密码不一致';
    confirmPassword.focus();
    return;
  }
  savePassword.dataset.busy = 'true';
  savePassword.textContent = '保存中…';
  passwordFeedback.textContent = '';
  try {
    const response = await fetch(`/api/admin/members/${passwordDialog.dataset.memberId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword.value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || '保存失败，请重试');
    }
    passwordDialog.close();
  } catch (error) {
    passwordFeedback.textContent = error.message;
  } finally {
    delete savePassword.dataset.busy;
    savePassword.textContent = '保存密码';
  }
});

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('club-desk-theme', theme);
  applyTheme(theme);
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});

async function loadMembers() {
  const response = await fetch('/api/admin/members');
  if (!response.ok) throw new Error('加载成员失败');
  renderMembers(await response.json(), window.currentUser);
}

async function loadDepartments() {
  const response = await fetch('/api/admin/departments');
  if (!response.ok) throw new Error('加载部门失败');
  departments = await response.json();
  memberDepartment.replaceChildren(new Option('选择部门', ''), ...departments.map((department) => new Option(department.name, department.id)));
}

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
    window.currentUser = user;
    addMemberButton.hidden = user.role !== 'admin';
  } catch { window.location.replace('/login'); return; }
  try {
    await loadDepartments();
    await loadMembers();
  } catch (error) { memberStatus.textContent = error.message; }
}

boot();