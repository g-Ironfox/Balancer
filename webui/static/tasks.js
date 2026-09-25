const activitySelect = document.querySelector("#activity-select");
const taskRows = document.querySelector("#task-rows");
const taskCount = document.querySelector("#task-count");
const taskError = document.querySelector("#task-error");
const saveButton = document.querySelector("#save-tasks");
const addButton = document.querySelector("#add-task");
const toast = document.querySelector("#toast");
const editor = document.querySelector("#task-editor");
const editorForm = document.querySelector("#task-editor-form");
const editorTitle = document.querySelector("#editor-title");
const editorDescription = document.querySelector("#editor-description");
const editorImages = document.querySelector("#editor-images");
const editorUpload = document.querySelector("#editor-upload");
const editorError = document.querySelector("#editor-error");
let activities = [];
let tasks = [];
let selectedActivityId = "";
let savedTasks = "[]";
let toastTimer;
let uploading = false;
let editingIndex = -1;
let draft = null;

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...options.headers }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join("；") : body.detail;
    throw new Error(detail || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("dark", dark);
  const button = document.querySelector("#theme-toggle");
  button.textContent = dark ? "☀" : "☾";
  button.title = dark ? "切换浅色模式" : "切换暗色模式";
  button.setAttribute("aria-label", button.title);
}

function renderTasks() {
  taskRows.replaceChildren();
  tasks.forEach((task, index) => {
    const row = document.createElement("div");
    row.className = "task-page-row";
    const number = document.createElement("span");
    number.className = "task-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "task-overview";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const summary = document.createElement("span");
    summary.textContent = [task.description ? "有正文" : "", task.images?.length ? `${task.images.length} 张图片` : ""].filter(Boolean).join(" · ") || "点击编辑内容";
    open.append(title, summary);
    open.addEventListener("click", () => openEditor(index));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-remove";
    remove.textContent = "移除";
    remove.addEventListener("click", () => { tasks.splice(index, 1); renderTasks(); });
    row.append(number, open, remove);
    taskRows.append(row);
  });
  taskCount.textContent = `${tasks.length} / 50 个任务`;
}

function renderEditorImages() {
  editorImages.replaceChildren();
  draft.images.forEach((url, index) => {
    const preview = document.createElement("div");
    preview.className = "task-image";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `任务图片 ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除图片 ${index + 1}`);
    remove.disabled = uploading;
    remove.addEventListener("click", () => { draft.images.splice(index, 1); renderEditorImages(); });
    preview.append(image, remove);
    editorImages.append(preview);
  });
}

function openEditor(index) {
  editingIndex = index;
  const task = tasks[index];
  draft = task ? { ...task, images: [...(task.images || [])] } : { id: crypto.randomUUID(), title: "", description: "", images: [] };
  editorTitle.value = draft.title;
  editorDescription.value = draft.description || "";
  editorError.textContent = "";
  document.querySelector("#editor-heading").textContent = task ? "编辑任务" : "新建任务";
  renderEditorImages();
  editor.showModal();
  editorTitle.focus();
}

function closeEditor() {
  if (uploading) return;
  editor.close();
}

editor.addEventListener("cancel", (event) => { if (uploading) event.preventDefault(); });
document.querySelector("#close-editor").addEventListener("click", closeEditor);
document.querySelector("#cancel-editor").addEventListener("click", closeEditor);
editorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (uploading) return;
  draft.title = editorTitle.value.trim();
  draft.description = editorDescription.value.trim();
  if (!draft.title) { editorError.textContent = "任务名称不能为空。"; return; }
  if (editingIndex < 0) tasks.push(draft);
  else tasks[editingIndex] = draft;
  editor.close();
  renderTasks();
});

editorUpload.addEventListener("change", async () => {
  const files = [...editorUpload.files];
  if (!files.length) return;
  uploading = true;
  editorError.textContent = "";
  editorUpload.disabled = true;
  document.querySelector("#confirm-editor").disabled = true;
  renderEditorImages();
  try {
    for (const file of files) {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/uploads/image", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `上传失败 (${response.status})`);
      }
      const result = await response.json();
      draft.images.push(result.url);
      renderEditorImages();
    }
  } catch (error) {
    editorError.textContent = error.message || "图片上传失败";
  } finally {
    uploading = false;
    editorUpload.disabled = false;
    editorUpload.value = "";
    document.querySelector("#confirm-editor").disabled = false;
    renderEditorImages();
  }
});

function setSelectedActivity(activity) {
  tasks = (activity.tasks || []).map((task) => ({ ...task }));
  selectedActivityId = activity.id;
  savedTasks = JSON.stringify(tasks);
  document.querySelector("#selected-activity-title").textContent = activity.title;
  document.querySelector("#selected-activity-meta").textContent = `${activity.category} · ${activity.status} · ${activity.location}`;
  activitySelect.value = activity.id;
  taskError.textContent = "";
  saveButton.disabled = false;
  addButton.disabled = false;
  renderTasks();
}

async function loadActivities() {
  let page = 1;
  let total = 0;
  do {
    const result = await request(`/api/activities?page=${page}&page_size=100`);
    activities.push(...result.items);
    total = result.total;
    page += 1;
  } while (activities.length < total);
  activitySelect.replaceChildren();
  if (!activities.length) {
    activitySelect.add(new Option("暂无活动", ""));
    document.querySelector("#selected-activity-title").textContent = "暂无活动";
    document.querySelector("#selected-activity-meta").textContent = "请先在活动管理中创建活动。";
    return;
  }
  activities.forEach((activity) => activitySelect.add(new Option(activity.title, activity.id)));
  activitySelect.disabled = false;
  setSelectedActivity(activities[0]);
}

activitySelect.addEventListener("change", () => {
  if (JSON.stringify(tasks) !== savedTasks && !window.confirm("当前任务尚未保存，确定切换活动吗？")) {
    activitySelect.value = selectedActivityId;
    return;
  }
  const activity = activities.find((item) => item.id === activitySelect.value);
  if (activity) setSelectedActivity(activity);
});

addButton.addEventListener("click", () => {
  if (tasks.length >= 50) {
    taskError.textContent = "每个活动最多 50 个任务。";
    return;
  }
  openEditor(-1);
});

saveButton.addEventListener("click", async () => {
  if (tasks.some((task) => !task.title.trim())) {
    taskError.textContent = "任务名称不能为空。";
    return;
  }
  saveButton.disabled = true;
  taskError.textContent = "";
  try {
    const activityId = activitySelect.value;
    const payload = { tasks: tasks.map((task) => ({ ...task, title: task.title.trim() })) };
    const result = await request(`/api/activities/${activityId}/tasks`, { method: "PUT", body: JSON.stringify(payload) });
    const activity = activities.find((item) => item.id === activityId);
    activity.tasks = result.tasks;
    tasks = result.tasks.map((task) => ({ ...task }));
    savedTasks = JSON.stringify(tasks);
    renderTasks();
    showToast("活动任务已保存");
  } catch (error) {
    taskError.textContent = error.message || "任务保存失败";
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.replace("/");
});
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem("club-desk-theme", nextTheme);
  applyTheme(nextTheme);
});

async function boot() {
  try {
    const user = await request("/api/auth/me");
    if (user.role !== "admin") throw new Error("没有管理员权限");
    document.querySelector("#profile-avatar").textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector("#profile-username").textContent = user.username;
  } catch {
    window.location.replace("/login");
    return;
  }
  applyTheme(localStorage.getItem("club-desk-theme") || "light");
  try {
    await loadActivities();
  } catch (error) {
    taskError.textContent = error.message || "活动加载失败";
  }
}

boot();
