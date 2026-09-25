const recordList = document.querySelector('#record-list');
const recordPagination = document.querySelector('#record-pagination');
const recordDetail = document.querySelector('#record-detail');
let recordPage = 1;
const recordPageSize = 6;

function recordImage(url) {
  return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(url) ? url : '';
}

function recordText(parent, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function openRecord(item) {
  const content = document.querySelector('#record-detail-content');
  content.replaceChildren();
  recordText(content, 'span', 'activity-kicker', item.activity_title);
  recordText(content, 'h2', '', item.title).id = 'record-detail-title';
  recordText(content, 'p', 'detail-meta', new Date(item.created_at).toLocaleDateString('zh-CN'));
  if (item.description) recordText(content, 'p', 'detail-description', item.description);
  for (const url of item.images) {
    if (!recordImage(url)) continue;
    const image = document.createElement('img');
    image.src = url;
    image.alt = item.title;
    image.className = 'record-detail-image';
    content.append(image);
  }
  recordDetail.showModal();
}

async function loadRecords() {
  recordList.replaceChildren();
  recordText(recordList, 'p', 'activity-message', '正在加载记录…');
  recordPagination.hidden = true;
  try {
    const response = await fetch(`/api/public/records?page=${recordPage}&page_size=${recordPageSize}`);
    if (!response.ok) throw new Error('记录加载失败');
    const result = await response.json();
    recordList.replaceChildren();
    if (!result.items.length) recordText(recordList, 'p', 'activity-message', '暂无活动记录。');
    for (const item of result.items) {
      const card = document.createElement('article');
      card.className = 'activity-card';
      const cover = document.createElement('div');
      cover.className = 'activity-visual';
      const url = recordImage(item.images[0]);
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        image.loading = 'lazy';
        cover.append(image);
      } else recordText(cover, 'span', 'activity-visual-mark', 'm✳');
      const body = document.createElement('div');
      body.className = 'activity-body';
      recordText(body, 'span', 'activity-kicker', item.activity_title);
      recordText(body, 'h3', '', item.title);
      recordText(body, 'p', 'activity-time', new Date(item.created_at).toLocaleDateString('zh-CN'));
      const button = recordText(body, 'button', 'activity-open', '查看记录');
      button.type = 'button';
      button.addEventListener('click', () => openRecord(item));
      card.append(cover, body);
      recordList.append(card);
    }
    recordPagination.hidden = result.total <= recordPageSize;
    document.querySelector('#record-page').textContent = `${recordPage} / ${Math.ceil(result.total / recordPageSize)}`;
    document.querySelector('#record-prev').disabled = recordPage <= 1;
    document.querySelector('#record-next').disabled = recordPage * recordPageSize >= result.total;
    window.lucide?.createIcons();
  } catch {
    recordList.replaceChildren();
    recordText(recordList, 'p', 'activity-message', '记录加载失败，请稍后重试。');
    const retry = recordText(recordList, 'button', 'activity-retry', '重新加载');
    retry.type = 'button';
    retry.addEventListener('click', loadRecords);
  }
}

document.querySelector('#record-prev').addEventListener('click', () => { recordPage--; loadRecords(); });
document.querySelector('#record-next').addEventListener('click', () => { recordPage++; loadRecords(); });
document.querySelector('#record-detail-close').addEventListener('click', () => recordDetail.close());
recordDetail.addEventListener('click', (event) => { if (event.target === recordDetail) recordDetail.close(); });
loadRecords();