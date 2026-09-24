const activityList = document.querySelector('#activity-list');
const activityDetail = document.querySelector('#activity-detail');
const pagination = document.querySelector('#activity-pagination');
const tabs = document.querySelectorAll('.activity-tabs button');
const activityState = { view: 'upcoming', page: 1, total: 0 };
const pageSize = 6;
let isInitialLoad = true;

function activityDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function safeImage(value) {
  return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(value) ? value : '';
}

function showDetail(item) {
  const content = document.querySelector('#detail-content');
  content.replaceChildren();
  for (const imageUrl of item.images || []) {
    if (!safeImage(imageUrl)) continue;
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.className = 'detail-image';
    content.append(image);
  }
  addText(content, 'span', 'activity-kicker', `${item.category} / ${item.status}`);
  addText(content, 'h2', '', item.title).id = 'detail-title';
  addText(content, 'p', 'detail-meta', `${activityDate(item.start_time)} — ${activityDate(item.end_time)}`);
  addText(content, 'p', 'detail-meta', `${item.location} · 名额 ${item.capacity} 人`);
  addText(content, 'p', 'detail-description', item.description || '暂无活动介绍。');
  if (item.incentive) {
    addText(content, 'h3', 'detail-incentive-title', '活动激励');
    addText(content, 'p', 'detail-description detail-incentive', item.incentive);
  }
  const canRegister = item.status === '报名中' && new Date(item.end_time).getTime() > Date.now();
  const isExpiredRegistration = item.status === '报名中' && !canRegister;
  const registerButton = addText(content, 'button', 'registration-submit registration-entry',
    isExpiredRegistration ? '活动已结束' : canRegister ? '报名' : '无法报名');
  registerButton.type = 'button';
  registerButton.disabled = !canRegister;
  if (!canRegister) {
    fetch('/api/auth/activities').then((response) => response.ok ? response.json() : []).then((activities) => {
      if (registerButton.isConnected && activities.some((activity) => activity.id === item.id)) {
        registerButton.textContent = '已报名';
      }
    }).catch(() => {});
  }
  if (canRegister) {
    const message = addText(content, 'p', 'registration-message', '');
    const link = document.createElement('a');
    link.className = 'registration-submit registration-entry';
    link.textContent = '报名';
    link.href = '/login';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const showLoginLink = () => {
      registerButton.replaceWith(link);
    };
    showLoginLink();
    const checkSession = async () => {
      try {
        const session = await fetch('/api/auth/me');
        if (session.status === 401) {
          if (registerButton.isConnected) showLoginLink();
          return;
        }
        if (!session.ok) return;
        const response = await fetch('/api/auth/activities');
        if (!response.ok) return;
        const activities = await response.json();
        if (!link.isConnected && !registerButton.isConnected) return;
        const registered = activities.some((activity) => activity.id === item.id);
        registerButton.textContent = registered ? '已报名' : '报名';
        registerButton.disabled = registered;
        if (link.isConnected) link.replaceWith(registerButton);
      } catch {
      }
    };
    checkSession();
    const onFocus = () => { if (activityDetail.open) checkSession(); };
    window.addEventListener('focus', onFocus);
    activityDetail.addEventListener('close', () => window.removeEventListener('focus', onFocus), { once: true });
    registerButton.addEventListener('click', async () => {
      registerButton.disabled = true;
      message.textContent = '';
      try {
        const session = await fetch('/api/auth/me');
        if (session.status === 401) {
          showLoginLink();
          message.textContent = '请点击报名登录后重试。';
          return;
        }
        if (!session.ok) throw new Error('登录状态获取失败，请重试。');
        const response = await fetch(`/api/public/activities/${item.id}/register`, {
          method: 'POST',
        });
        if (response.status === 401) {
          showLoginLink();
          message.textContent = '登录已过期，请点击报名重新登录。';
          return;
        }
        const result = response.headers.get('content-type')?.includes('application/json')
          ? await response.json() : {};
        if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '报名失败，请重试。');
        registerButton.textContent = '已报名';
        registerButton.disabled = true;
        message.textContent = '报名成功';
        if (result.incentive_details) {
          addText(content, 'h3', 'detail-incentive-title', '领取激励');
          addText(content, 'p', 'detail-description detail-incentive', result.incentive_details);
        }
        const incentiveImages = (result.incentive_images || []).filter(safeImage);
        if (incentiveImages.length && !result.incentive_details) addText(content, 'h3', 'detail-incentive-title', '领取激励');
        for (const incentiveImageUrl of incentiveImages) {
          const incentiveImage = document.createElement('img');
          incentiveImage.src = incentiveImageUrl;
          incentiveImage.alt = '领取激励图片';
          incentiveImage.className = 'detail-incentive-image';
          content.append(incentiveImage);
        }
      } catch (error) {
        message.textContent = error.message;
      } finally {
        if (registerButton.textContent !== '已报名') registerButton.disabled = false;
      }
    });
  }
  activityDetail.showModal();
}

function renderActivities(items) {
  activityList.replaceChildren();
  if (!items.length) {
    addText(activityList, 'p', 'activity-message', activityState.view === 'upcoming' ? '近期暂无活动，过些时候再来看看。' : '还没有往期活动。');
    return;
  }
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'activity-card';
    const imageUrl = safeImage(item.images?.[0]);
    const visual = document.createElement('div');
    visual.className = 'activity-visual';
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      visual.append(image);
    } else {
      addText(visual, 'span', 'activity-visual-mark', 'm✳');
    }
    card.append(visual);
    const body = document.createElement('div');
    body.className = 'activity-body';
    addText(body, 'span', 'activity-kicker', `${item.category} / ${item.status}`);
    addText(body, 'h3', '', item.title);
    addText(body, 'p', 'activity-time', activityDate(item.start_time));
    addText(body, 'p', 'activity-place', item.location);
    const button = addText(body, 'button', 'activity-open', '查看详情');
    button.type = 'button';
    button.addEventListener('click', () => showDetail(item));
    card.append(body);
    activityList.append(card);
  }
}

async function loadActivities() {
  activityList.replaceChildren();
  addText(activityList, 'p', 'activity-message', '正在加载活动…');
  pagination.hidden = true;
  try {
    const params = new URLSearchParams({ view: activityState.view, page: activityState.page, page_size: pageSize });
    const response = await fetch(`/api/public/activities?${params}`);
    if (!response.ok) throw new Error('请求失败');
    const result = await response.json();
    if (isInitialLoad && activityState.view === 'upcoming' && result.total === 0) {
      isInitialLoad = false;
      document.querySelector('.activity-tabs [data-view="past"]').click();
      return;
    }
    isInitialLoad = false;
    activityState.total = result.total;
    renderActivities(result.items);
    pagination.hidden = result.total <= pageSize;
    document.querySelector('#activity-page').textContent = `${activityState.page} / ${Math.ceil(result.total / pageSize)}`;
    document.querySelector('#activity-prev').disabled = activityState.page === 1;
    document.querySelector('#activity-next').disabled = activityState.page * pageSize >= result.total;
    window.lucide?.createIcons();
  } catch {
    activityList.replaceChildren();
    addText(activityList, 'p', 'activity-message', '活动加载失败，请稍后重试。');
    const retry = addText(activityList, 'button', 'activity-retry', '重新加载');
    retry.type = 'button';
    retry.addEventListener('click', loadActivities);
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
  if (activityState.view === tab.dataset.view) return;
  activityState.view = tab.dataset.view;
  activityState.page = 1;
  tabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  loadActivities();
}));
document.querySelector('#activity-prev').addEventListener('click', () => { activityState.page--; loadActivities(); });
document.querySelector('#activity-next').addEventListener('click', () => { activityState.page++; loadActivities(); });
document.querySelector('#detail-close').addEventListener('click', () => activityDetail.close());
activityDetail.addEventListener('click', (event) => { if (event.target === activityDetail) activityDetail.close(); });
loadActivities();