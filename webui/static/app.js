const PAGE_SIZE = 10;
const state = { page: 1, keyword: "", status: "", category: "", activities: [], categories: [], total: 0 };
const rows = document.querySelector("#activity-rows");
const loading = document.querySelector("#loading-state");
const empty = document.querySelector("#empty-state");
const dialog = document.querySelector("#activity-dialog");
const form = document.querySelector("#activity-form");
const toast = document.querySelector("#toast");
let searchTimer;
let toastTimer;

async function requireAdmin() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    window.location.href = "/login";
    throw new Error("未登录");
  }
  const user = await response.json();
  if (user.role !== "admin") {
    window.location.href = "/login";
    throw new Error("没有管理员权限");
  }
  const avatar = document.querySelector("#profile-avatar");
  if (avatar) avatar.textContent = user.username.slice(0, 1).toUpperCase();
  document.querySelector("#profile-username").textContent = user.username;
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("dark", dark);
  const button = document.querySelector("#theme-toggle");
  button.textContent = dark ? "☀" : "☾";
  button.title = dark ? "切换浅色模式" : "切换暗色模式";
  button.setAttribute("aria-label", button.title);
}

applyTheme(localStorage.getItem("club-desk-theme") || "light");

const dateTime = (value) => new Date(value);
const pad = (value) => String(value).padStart(2, "0");
const formatDate = (value) => {
  const date = dateTime(value);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};
const formatTime = (value) => {
  const date = dateTime(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const localInputValue = (value) => {
  const date = dateTime(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...options.headers }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join("；") : body.detail;
    throw new Error(detail || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

async function uploadImage(formData) {
  const response = await fetch("/api/uploads/image", { method: "POST", body: formData });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `上传失败 (${response.status})`);
  }
  return response.json();
}

let images = [];
let incentiveImages = [];

function renderImagePreview(selector, urls, label, onRemove) {
  const preview = document.querySelector(selector);
  preview.replaceChildren();
  preview.hidden = urls.length === 0;
  urls.forEach((url, index) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${label} ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除${label} ${index + 1}`);
    remove.addEventListener("click", () => onRemove(index));
    item.append(image, remove);
    preview.append(item);
  });
}

function setImagePreview(urls) {
  images = [...urls];
  renderImagePreview("#image-preview", images, "宣传图", (index) => {
    images.splice(index, 1);
    setImagePreview(images);
  });
}

function setIncentiveImagePreview(urls) {
  incentiveImages = [...urls];
  renderImagePreview("#incentive-image-preview", incentiveImages, "领取图片", (index) => {
    incentiveImages.splice(index, 1);
    setIncentiveImagePreview(incentiveImages);
  });
}

function updateMetrics(summary) {
  document.querySelector("#metric-total").textContent = summary.total;
  document.querySelector("#nav-count").textContent = summary.total;
  document.querySelector("#metric-open").textContent = summary.open;
  document.querySelector("#metric-upcoming").textContent = summary.upcoming;
  document.querySelector("#metric-month").textContent = summary.month;
}

function statusClass(value) {
  return ({ "报名中": "status-open", "进行中": "status-live", "草稿": "status-draft", "已结束": "status-done", "已取消": "status-cancelled" })[value] || "status-draft";
}

function renderRows() {
  const filtered = state.category ? state.activities.filter((item) => item.category === state.category) : state.activities;
  rows.innerHTML = filtered.map((item) => `
    <tr>
      <td><div class="activity-cell">${item.images?.[0] ? `<img class="activity-thumb" src="${escapeHtml(item.images[0])}" alt="">` : ""}<div><div class="activity-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><div class="activity-id">ACT-${escapeHtml(item.id.slice(-6).toUpperCase())}</div></div></div></td>
      <td><span class="category-tag">${escapeHtml(item.category)}</span></td>
      <td><div class="date-primary">${formatDate(item.start_time)}</div><div class="date-secondary">${formatTime(item.start_time)} - ${formatTime(item.end_time)}</div></td>
      <td><div class="location-cell" title="${escapeHtml(item.location)}">${escapeHtml(item.location)}</div></td>
      <td><span class="capacity-cell">${item.capacity} 人</span></td>
      <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td><div class="row-actions"><button class="row-action" data-action="edit" data-id="${item.id}" title="编辑活动" aria-label="编辑 ${escapeHtml(item.title)}">✎</button><button class="row-action delete" data-action="delete" data-id="${item.id}" title="删除活动" aria-label="删除 ${escapeHtml(item.title)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7"/></svg></button></div></td>
    </tr>`).join("");
  document.querySelector("#result-count").textContent = `共 ${state.total} 条`;
  const start = state.total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(state.page * PAGE_SIZE, state.total);
  document.querySelector("#page-summary").textContent = `显示 ${start}-${end} 条，共 ${state.total} 条`;
  document.querySelector("#page-number").textContent = state.page;
  document.querySelector("#previous-page").disabled = state.page <= 1;
  document.querySelector("#next-page").disabled = state.page * PAGE_SIZE >= state.total;
  loading.hidden = true;
  empty.hidden = state.total !== 0;
  document.querySelector(".table-wrap").classList.toggle("is-empty", state.total === 0);
}

function categoryError(message) {
  document.querySelector("#category-error").textContent = message;
}

function renderCategoryOptions() {
  const filter = document.querySelector("#category-filter");
  filter.innerHTML = `<option value="">全部类别</option>` + state.categories.map((item) => `<option>${escapeHtml(item.name)}</option>`).join("");
  if (state.categories.some((item) => item.name === state.category)) {
    filter.value = state.category;
  } else {
    filter.value = "";
    state.category = "";
  }
  document.querySelector("#category").innerHTML = state.categories.map((item) => `<option>${escapeHtml(item.name)}</option>`).join("");
}

function renderCategoryList() {
  document.querySelector("#category-list").innerHTML = state.categories.map((item) => `
    <li class="category-item" data-id="${item.id}">
      <span class="category-name">${escapeHtml(item.name)}</span>
      <span class="category-usage">${item.usage} 个活动</span>
      <button class="row-action" data-category-action="rename" title="重命名类别" aria-label="重命名 ${escapeHtml(item.name)}">✎</button>
      <button class="row-action delete" data-category-action="delete" title="删除类别" aria-label="删除 ${escapeHtml(item.name)}">⌫</button>
    </li>`).join("");
}

async function loadCategories() {
  state.categories = await request("/api/categories");
  renderCategoryOptions();
  renderCategoryList();
}

async function refreshAll() {
  try {
    await loadCategories();
  } catch (error) {
    showToast(error.message || "类别载入失败");
  }
  await loadActivities();
}

function openCategoryDialog() {
  categoryError("");
  document.querySelector("#category-name").value = "";
  renderCategoryList();
  document.querySelector("#category-dialog").showModal();
  document.querySelector("#category-name").focus();
}

function startRenameCategory(item) {
  const row = document.querySelector(`#category-list .category-item[data-id="${item.id}"]`);
  if (!row) return;
  const input = document.createElement("input");
  input.className = "category-rename";
  input.maxLength = 20;
  input.value = item.name;
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "text-button";
  saveButton.textContent = "保存";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "text-button";
  cancelButton.textContent = "取消";
  row.innerHTML = "";
  row.append(input, saveButton, cancelButton);
  input.focus();
  input.select();
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); saveButton.click(); }
    if (event.key === "Escape") renderCategoryList();
  });
  cancelButton.addEventListener("click", renderCategoryList);
  saveButton.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) { categoryError("类别名称不能为空。"); return; }
    try {
      await request(`/api/categories/${item.id}`, { method: "PUT", body: JSON.stringify({ name }) });
      categoryError("");
      showToast("类别已更新");
      await refreshAll();
    } catch (error) {
      categoryError(error.message || "重命名失败");
      renderCategoryList();
    }
  });
}

async function submitCategory() {
  const input = document.querySelector("#category-name");
  const name = input.value.trim();
  if (!name) { categoryError("类别名称不能为空。"); return; }
  try {
    await request("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
    input.value = "";
    categoryError("");
    showToast("类别已添加");
    await refreshAll();
  } catch (error) {
    categoryError(error.message || "添加失败");
  }
}

async function loadActivities() {
  loading.hidden = false;
  empty.hidden = true;
  const params = new URLSearchParams({ page: state.page, page_size: PAGE_SIZE, keyword: state.keyword, status: state.status });
  try {
    const result = await request(`/api/activities?${params}`);
    const summary = await request("/api/activities/summary");
    state.activities = result.items;
    state.total = result.total;
    updateMetrics(summary);
    renderRows();
  } catch (error) {
    loading.textContent = error.message || "活动载入失败，请稍后重试。";
    loading.hidden = false;
    showToast("活动列表载入失败");
  }
}

function openCreateDialog() {
  form.reset();
  document.querySelector("#activity-id").value = "";
  document.querySelector("#activity-status").value = "草稿";
  document.querySelector("#capacity").value = 30;
  setImagePreview([]);
  setIncentiveImagePreview([]);
  document.querySelector("#dialog-title").textContent = "创建活动";
  document.querySelector("#save-button").textContent = "保存活动";
  document.querySelector("#dialog-error").textContent = "";
  dialog.showModal();
  document.querySelector("#title").focus();
}

function openEditDialog(activity) {
  document.querySelector("#activity-id").value = activity.id;
  document.querySelector("#title").value = activity.title;
  document.querySelector("#category").value = activity.category;
  document.querySelector("#activity-status").value = activity.status;
  document.querySelector("#location").value = activity.location;
  document.querySelector("#start-time").value = localInputValue(activity.start_time);
  document.querySelector("#end-time").value = localInputValue(activity.end_time);
  document.querySelector("#capacity").value = activity.capacity;
  document.querySelector("#description").value = activity.description || "";
  document.querySelector("#incentive").value = activity.incentive || "";
  document.querySelector("#incentive-details").value = activity.incentive_details || "";
  document.querySelector("#image-file").value = "";
  setImagePreview(activity.images || []);
  document.querySelector("#incentive-image-file").value = "";
  setIncentiveImagePreview(activity.incentive_images || []);
  document.querySelector("#dialog-title").textContent = "编辑活动";
  document.querySelector("#save-button").textContent = "保存修改";
  document.querySelector("#dialog-error").textContent = "";
  dialog.showModal();
}

rows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const activity = state.activities.find((item) => item.id === button.dataset.id);
  if (!activity) return;
  if (button.dataset.action === "edit") {
    openEditDialog(activity);
    return;
  }
  if (!window.confirm(`确定删除“${activity.title}”吗？删除后无法恢复。`)) return;
  try {
    await request(`/api/activities/${activity.id}`, { method: "DELETE" });
    if (state.page > 1 && state.activities.length === 1) state.page -= 1;
    showToast("活动已删除");
    await loadActivities();
  } catch (error) {
    showToast(error.message || "删除失败");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = document.querySelector("#save-button");
  const activityId = document.querySelector("#activity-id").value;
  const payload = {
    title: document.querySelector("#title").value.trim(),
    category: document.querySelector("#category").value,
    status: document.querySelector("#activity-status").value,
    location: document.querySelector("#location").value.trim(),
    start_time: new Date(document.querySelector("#start-time").value).toISOString(),
    end_time: new Date(document.querySelector("#end-time").value).toISOString(),
    capacity: Number(document.querySelector("#capacity").value),
    description: document.querySelector("#description").value.trim(),
    incentive: document.querySelector("#incentive").value.trim(),
    incentive_details: document.querySelector("#incentive-details").value.trim(),
    incentive_images: incentiveImages,
    images,
  };
  if (new Date(payload.end_time) <= new Date(payload.start_time)) {
    document.querySelector("#dialog-error").textContent = "结束时间必须晚于开始时间。";
    return;
  }
  saveButton.disabled = true;
  document.querySelector("#dialog-error").textContent = "";
  try {
    await request(activityId ? `/api/activities/${activityId}` : "/api/activities", {
      method: activityId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    dialog.close();
    showToast(activityId ? "活动已更新" : "活动已创建");
    if (!activityId) state.page = 1;
    await loadActivities();
  } catch (error) {
    document.querySelector("#dialog-error").textContent = error.message || "保存失败，请重试。";
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector("#create-button").addEventListener("click", openCreateDialog);
document.querySelector("#empty-create").addEventListener("click", openCreateDialog);
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#refresh-button").addEventListener("click", refreshAll);
document.querySelector("#image-file").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    const urls = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("image", file);
      const result = await uploadImage(formData);
      urls.push(result.url);
    }
    setImagePreview([...images, ...urls]);
    document.querySelector("#dialog-error").textContent = "";
    showToast("宣传图已上传");
  } catch (error) {
    document.querySelector("#dialog-error").textContent = error.message || "上传失败";
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#incentive-image-file").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    const urls = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("image", file);
      const result = await uploadImage(formData);
      urls.push(result.url);
    }
    setIncentiveImagePreview([...incentiveImages, ...urls]);
    document.querySelector("#dialog-error").textContent = "";
    showToast("领取图片已上传");
  } catch (error) {
    document.querySelector("#dialog-error").textContent = error.message || "上传失败";
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#manage-categories").addEventListener("click", openCategoryDialog);
document.querySelector("#close-category").addEventListener("click", () => document.querySelector("#category-dialog").close());
document.querySelector("#category-form").addEventListener("submit", (event) => { event.preventDefault(); submitCategory(); });
document.querySelector("#category-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-category-action]");
  if (!button) return;
  const item = state.categories.find((category) => category.id === button.closest(".category-item").dataset.id);
  if (!item) return;
  if (button.dataset.categoryAction === "rename") { startRenameCategory(item); return; }
  if (!window.confirm(`确定删除类别“${item.name}”吗？`)) return;
  try {
    await request(`/api/categories/${item.id}`, { method: "DELETE" });
    categoryError("");
    showToast("类别已删除");
    await refreshAll();
  } catch (error) {
    categoryError(error.message || "删除失败");
  }
});
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const theme = document.body.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem("club-desk-theme", theme);
  applyTheme(theme);
});
document.querySelector("#logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});
document.querySelector("#previous-page").addEventListener("click", () => { state.page -= 1; loadActivities(); });
document.querySelector("#next-page").addEventListener("click", () => { state.page += 1; loadActivities(); });
document.querySelector("#status-filter").addEventListener("change", (event) => { state.status = event.target.value; state.page = 1; loadActivities(); });
document.querySelector("#category-filter").addEventListener("change", (event) => { state.category = event.target.value; renderRows(); });
const searchInput = document.querySelector("#search-input");
const searchClear = document.querySelector("#search-clear");
function clearSearch() {
  clearTimeout(searchTimer);
  searchInput.value = "";
  searchClear.hidden = true;
  state.keyword = "";
  state.page = 1;
  loadActivities();
  searchInput.focus();
}
searchInput.addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchClear.hidden = !event.target.value;
  searchTimer = setTimeout(() => { state.keyword = event.target.value.trim(); state.page = 1; loadActivities(); }, 250);
});
searchClear.addEventListener("click", clearSearch);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && searchInput.value) clearSearch();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector("#search-input").focus();
  }
});
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date());
requireAdmin().then(refreshAll).catch(() => {});
