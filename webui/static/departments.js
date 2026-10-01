const rows = document.querySelector('#department-rows');
const status = document.querySelector('#department-status');
const dialog = document.querySelector('#department-dialog');
const form = document.querySelector('#department-form');
const roleLabels = { member: '会员', user: '普通成员', core: '核心成员', admin: '系统管理员' };
let departments = [];
let selectedImageUrl = '';

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const button = document.querySelector('#theme-toggle');
  button.textContent = dark ? '☀' : '☾';
  button.title = dark ? '切换浅色模式' : '切换暗色模式';
  button.setAttribute('aria-label', button.title);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || '操作失败，请重试');
  }
  return response.status === 204 ? null : response.json();
}

function render() {
  rows.replaceChildren();
  document.querySelector('#department-count').textContent = `共 ${departments.length} 个部门`;
  for (const department of departments) {
    const row = rows.insertRow();
    row.insertCell().textContent = department.name;
    row.insertCell().textContent = department.description || '暂无介绍';
    const imageCell = row.insertCell();
    imageCell.className = 'department-image-cell';
    if (department.image) {
      const image = document.createElement('img');
      image.src = department.image;
      image.alt = `${department.name}部门宣传图`;
      image.loading = 'lazy';
      imageCell.append(image);
    } else {
      imageCell.textContent = '未上传';
    }
    const actions = row.insertCell();
    actions.className = 'department-actions';
    const edit = document.createElement('button');
    edit.className = 'text-button';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openDialog(department));
    const remove = document.createElement('button');
    remove.className = 'text-button danger-button';
    remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`确定删除“${department.name}”部门吗？`)) return;
      try {
        await api(`/api/admin/departments/${department.id}`, { method: 'DELETE' });
        await loadDepartments();
      } catch (error) { window.alert(error.message); }
    });
    actions.append(edit, remove);
  }
  status.hidden = departments.length > 0;
  if (!departments.length) status.textContent = '还没有部门，添加第一个部门吧。';
}

function openDialog(department = null) {
  document.querySelector('#dialog-title').textContent = department ? '编辑部门' : '添加部门';
  document.querySelector('#department-id').value = department?.id || '';
  document.querySelector('#department-name').value = department?.name || '';
  document.querySelector('#department-description').value = department?.description || '';
  document.querySelector('#department-detail').value = department?.detail || '';
  document.querySelector('#department-image').value = '';
  selectedImageUrl = department?.image || '';
  renderImagePreview();
  document.querySelector('#dialog-error').textContent = '';
  dialog.showModal();
}

function renderImagePreview() {
  const preview = document.querySelector('#department-image-preview');
  preview.replaceChildren();
  preview.hidden = !selectedImageUrl;
  if (!selectedImageUrl) return;
  const image = document.createElement('img');
  image.src = selectedImageUrl;
  image.alt = '部门宣传图预览';
  preview.append(image);
}

document.querySelector('#department-image').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const error = document.querySelector('#dialog-error');
  if (file.size > 5 * 1024 * 1024) {
    error.textContent = '图片不能超过 5 MB';
    event.target.value = '';
    return;
  }
  error.textContent = '';
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const body = new FormData();
    body.append('image', file);
    const uploaded = await api('/api/uploads/image', { method: 'POST', body });
    selectedImageUrl = uploaded.url;
    renderImagePreview();
  } catch (uploadError) {
    error.textContent = uploadError.message;
    event.target.value = '';
  } finally { button.disabled = false; }
});

async function loadDepartments() {
  departments = await api('/api/admin/departments');
  render();
}

document.querySelector('#create-department').addEventListener('click', () => openDialog());
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#department-id').value;
  const payload = {
    name: document.querySelector('#department-name').value,
    description: document.querySelector('#department-description').value,
    detail: document.querySelector('#department-detail').value,
    image: selectedImageUrl,
  };
  try {
    await api(id ? `/api/admin/departments/${id}` : '/api/admin/departments', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    dialog.close();
    await loadDepartments();
  } catch (error) { document.querySelector('#dialog-error').textContent = error.message; }
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

async function boot() {
  applyTheme(localStorage.getItem('club-desk-theme') || 'light');
  try {
    const user = await api('/api/auth/me');
    if (!['user', 'core', 'admin'].includes(user.role)) throw new Error('没有后台权限');
    document.querySelector('#profile-avatar').textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector('#profile-username').textContent = user.username;
    document.querySelector('#profile-role').textContent = roleLabels[user.role];
    await loadDepartments();
  } catch (error) {
    if (error.message === '没有后台权限' || error.message.includes('登录') || error.message.includes('过期')) window.location.replace('/login');
    else status.textContent = error.message;
  }
}

boot();