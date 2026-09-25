const recordList = document.querySelector('#record-list');
const editor = document.querySelector('#record-editor');
const form = document.querySelector('#record-form');
const errorBox = document.querySelector('#editor-error');
let activities = [];
let records = [];
let images = [];
let editingId = '';
let page = 1;
let total = 0;
let uploading = false;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join('；') : body.detail;
    throw new Error(detail || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2600);
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const button = document.querySelector('#theme-toggle');
  button.textContent = dark ? '☀' : '☾';
  button.title = dark ? '切换浅色模式' : '切换暗色模式';
  button.setAttribute('aria-label', button.title);
}

function renderImages() {
  const container = document.querySelector('#record-images');
  container.replaceChildren();
  images.forEach((url, index) => {
    const preview = document.createElement('div');
    preview.className = 'record-image';
    const image = document.createElement('img');
    image.src = url;
    image.alt = `记录图片 ${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '移除图片';
    remove.setAttribute('aria-label', `移除图片 ${index + 1}`);
    remove.disabled = uploading;
    remove.addEventListener('click', () => { images.splice(index, 1); renderImages(); });
    preview.append(image, remove);
    container.append(preview);
  });
}

function openEditor(record = null) {
  form.reset();
  editingId = record?.id || '';
  images = [...(record?.images || [])];
  document.querySelector('#editor-heading').textContent = record ? '编辑记录' : '新建记录';
  document.querySelector('#record-activity').value = record?.activity_id || activities[0]?.id || '';
  document.querySelector('#record-title').value = record?.title || '';
  document.querySelector('#record-description').value = record?.description || '';
  document.querySelector('#record-published').checked = record?.published || false;
  errorBox.textContent = '';
  renderImages();
  editor.showModal();
  document.querySelector('#record-title').focus();
}

function renderRecords() {
  recordList.replaceChildren();
  document.querySelector('#record-count').textContent = `共 ${total} 条`;
  if (!records.length) recordList.textContent = '暂无记录。选择“新建记录”开始整理活动资料。';
  for (const record of records) {
    const article = document.createElement('article');
    article.className = 'record-row';
    const cover = document.createElement('div');
    cover.className = 'record-cover';
    if (record.images.length) {
      const image = document.createElement('img');
      image.src = record.images[0];
      image.alt = '';
      cover.append(image);
    } else cover.textContent = 'M';
    const details = document.createElement('div');
    details.className = 'record-info';
    const title = document.createElement('strong');
    title.textContent = record.title;
    const meta = document.createElement('span');
    meta.textContent = `${record.activity_title} · ${new Date(record.created_at).toLocaleDateString('zh-CN')} · ${record.published ? '已发布' : '草稿'}`;
    details.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const edit = document.createElement('button');
    edit.className = 'text-button';
    edit.type = 'button';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openEditor(record));
    const remove = document.createElement('button');
    remove.className = 'text-button';
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      if (!confirm(`确定删除“${record.title}”吗？`)) return;
      try {
        await request(`/api/records/${record.id}`, { method: 'DELETE' });
        if (records.length === 1 && page > 1) page--;
        await loadRecords();
        showToast('记录已删除');
      } catch (error) { showToast(error.message); }
    });
    actions.append(edit, remove);
    article.append(cover, details, actions);
    recordList.append(article);
  }
  const pagination = document.querySelector('#records-pagination');
  pagination.hidden = total <= 20;
  document.querySelector('#page-number').textContent = `${page} / ${Math.ceil(total / 20)}`;
  document.querySelector('#previous-page').disabled = page === 1;
  document.querySelector('#next-page').disabled = page * 20 >= total;
}

async function loadRecords() {
  recordList.textContent = '正在加载记录…';
  document.querySelector('#records-pagination').hidden = true;
  try {
    const result = await request(`/api/records?page=${page}&page_size=20`);
    records = result.items;
    total = result.total;
    renderRecords();
  } catch (error) { recordList.textContent = error.message; }
}

document.querySelector('#record-upload').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  if (images.length + files.length > 30) {
    errorBox.textContent = '每条记录最多 30 张图片。';
    event.target.value = '';
    return;
  }
  uploading = true;
  errorBox.textContent = '';
  event.target.disabled = true;
  document.querySelector('#save-record').disabled = true;
  renderImages();
  try {
    for (const file of files) {
      const data = new FormData();
      data.append('image', file);
      const result = await request('/api/uploads/image', { method: 'POST', body: data });
      images.push(result.url);
      renderImages();
    }
  } catch (error) { errorBox.textContent = error.message; }
  finally {
    uploading = false;
    event.target.disabled = false;
    event.target.value = '';
    document.querySelector('#save-record').disabled = false;
    renderImages();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (uploading) return;
  const button = document.querySelector('#save-record');
  button.disabled = true;
  errorBox.textContent = '';
  const payload = {
    activity_id: document.querySelector('#record-activity').value,
    title: document.querySelector('#record-title').value.trim(),
    description: document.querySelector('#record-description').value.trim(),
    images,
    published: document.querySelector('#record-published').checked,
  };
  try {
    await request(editingId ? `/api/records/${editingId}` : '/api/records', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    editor.close();
    page = 1;
    await loadRecords();
    showToast('记录已保存');
  } catch (error) { errorBox.textContent = error.message; }
  finally { button.disabled = false; }
});

editor.addEventListener('cancel', (event) => { if (uploading) event.preventDefault(); });
document.querySelector('#close-editor').addEventListener('click', () => { if (!uploading) editor.close(); });
document.querySelector('#cancel-editor').addEventListener('click', () => { if (!uploading) editor.close(); });
document.querySelector('#new-record').addEventListener('click', () => openEditor());
document.querySelector('#previous-page').addEventListener('click', () => { page--; loadRecords(); });
document.querySelector('#next-page').addEventListener('click', () => { page++; loadRecords(); });
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('club-desk-theme', theme);
  applyTheme(theme);
});

async function boot() {
  applyTheme(localStorage.getItem('club-desk-theme') || 'light');
  try {
    const user = await request('/api/auth/me');
    if (!['user', 'core', 'admin'].includes(user.role)) throw new Error('没有后台权限');
    document.querySelector('#profile-avatar').textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector('#profile-username').textContent = user.username;
    document.querySelector('#profile-role').textContent = { user: '普通成员', core: '核心成员', admin: '系统管理员' }[user.role];
  } catch { window.location.replace('/login'); return; }
  try {
    let activityPage = 1;
    let activityTotal;
    do {
      const result = await request(`/api/activities?page=${activityPage}&page_size=100`);
      activities.push(...result.items);
      activityTotal = result.total;
      activityPage++;
    } while (activities.length < activityTotal);
    const select = document.querySelector('#record-activity');
    for (const activity of activities) select.add(new Option(activity.title, activity.id));
    if (!activities.length) {
      select.add(new Option('请先创建活动', ''));
      document.querySelector('#new-record').disabled = true;
    }
    await loadRecords();
  } catch (error) { recordList.textContent = error.message; }
}

boot();