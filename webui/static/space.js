async function loadSpace() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.status === 401) {
      window.location.replace("/login");
      return;
    }
    if (!response.ok) throw new Error("空间暂时无法加载，请稍后刷新重试。");
    const user = await response.json();
    document.querySelector("#username").textContent = user.username;
    document.querySelector("#avatar").textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector("#admin-link").hidden = user.role !== "admin";
    document.querySelector(".workspace").hidden = false;
    await loadRegisteredActivities();
    window.lucide?.createIcons();
  } catch {
    document.querySelector(".workspace").hidden = false;
    document.querySelector("#status").textContent = "空间暂时无法加载，请稍后刷新重试。";
    for (const list of document.querySelectorAll(".member-list")) {
      list.replaceChildren();
    }
    document.querySelector("#todo-groups").textContent = "任务加载失败，请刷新重试。";
  }
}

function showTaskDetail(activity, task) {
  const dialog = document.querySelector("#task-detail");
  document.querySelector("#task-detail-activity").textContent = activity.title;
  document.querySelector("#task-detail-title").textContent = task.title;
  const description = document.querySelector("#task-detail-description");
  description.textContent = task.description || "";
  description.hidden = !task.description;
  const images = document.querySelector("#task-detail-images");
  images.replaceChildren();
  for (const [index, url] of (task.images || []).entries()) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${task.title} 图片 ${index + 1}`;
    link.append(image);
    images.append(link);
  }
  dialog.showModal();
}

document.querySelector("#close-task-detail").addEventListener("click", () => document.querySelector("#task-detail").close());

function renderTasks(activities) {
  const target = document.querySelector("#todo-groups");
  target.replaceChildren();
  const now = Date.now();
  const groups = activities.filter((activity) => activity.status !== "已取消" && activity.status !== "已结束"
    && new Date(activity.end_time).getTime() > now && activity.tasks?.length);
  const tasks = groups.flatMap((activity) => activity.tasks);
  document.querySelector("#todo-summary").textContent = `${tasks.filter((task) => task.completed).length} / ${tasks.length} 已完成`;
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "todo-empty";
    empty.textContent = "当前没有待完成的活动任务。";
    target.append(empty);
    return;
  }
  groups.forEach((activity, index) => {
    const group = document.createElement("details");
    group.className = "todo-group";
    group.open = index === 0;
    const heading = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const count = document.createElement("span");
    count.textContent = `${activity.tasks.filter((task) => task.completed).length} / ${activity.tasks.length}`;
    heading.append(title, count);
    const list = document.createElement("ul");
    for (const task of activity.tasks) {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.completed;
      const text = document.createElement("button");
      text.type = "button";
      text.className = "todo-task-open";
      text.textContent = task.title;
      text.addEventListener("click", () => showTaskDetail(activity, task));
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          const response = await fetch(`/api/auth/activities/${activity.id}/tasks/${task.id}?completed=${checkbox.checked}`, { method: "PUT" });
          if (!response.ok) throw new Error("任务状态保存失败");
          task.completed = checkbox.checked;
          item.classList.toggle("done", task.completed);
          count.textContent = `${activity.tasks.filter((entry) => entry.completed).length} / ${activity.tasks.length}`;
          document.querySelector("#todo-summary").textContent = `${tasks.filter((entry) => entry.completed).length} / ${tasks.length} 已完成`;
          document.querySelector("#status").textContent = "";
        } catch {
          checkbox.checked = task.completed;
          document.querySelector("#status").textContent = "任务状态保存失败，请重试。";
        } finally {
          checkbox.disabled = false;
        }
      });
      label.append(checkbox);
      item.classList.toggle("done", task.completed);
      item.append(label, text);
      list.append(item);
    }
    group.append(heading, list);
    target.append(group);
  });
}

function renderActivityList(target, activities, emptyText) {
  target.replaceChildren();
  if (!activities.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = emptyText;
    target.append(empty);
    return;
  }
  for (const activity of activities) {
    const item = document.createElement("li");
    const date = document.createElement("time");
    date.dateTime = activity.start_time;
    date.textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(activity.start_time));
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const location = document.createElement("span");
    location.textContent = `${activity.location} · ${activity.status}`;
    details.append(title, location);
    item.append(date, details);
    target.append(item);
  }
}

async function loadRegisteredActivities() {
  const response = await fetch("/api/auth/activities");
  if (!response.ok) throw new Error("已报名活动加载失败，请稍后刷新重试。");
  const activities = await response.json();
  renderTasks(activities);
  const now = Date.now();
  const upcoming = activities.filter((activity) => activity.status !== "已取消" && new Date(activity.start_time).getTime() > now)
    .sort((left, right) => new Date(left.start_time) - new Date(right.start_time));
  const ongoing = activities.filter((activity) => activity.status !== "已取消"
      && new Date(activity.start_time).getTime() <= now && new Date(activity.end_time).getTime() > now)
    .sort((left, right) => new Date(left.start_time) - new Date(right.start_time));
  const past = activities.filter((activity) => activity.status === "已结束"
      || (activity.status !== "已取消" && new Date(activity.end_time).getTime() <= now))
    .sort((left, right) => new Date(right.end_time) - new Date(left.end_time));
  renderActivityList(document.querySelector("#upcoming-activities"), upcoming,
    "目前没有即将举行的已报名活动。");
  renderActivityList(document.querySelector("#ongoing-activities"), ongoing,
    "目前没有正在进行的已报名活动。");
  renderActivityList(document.querySelector("#past-activities"), past,
    "目前没有已结束的报名活动。");
}

document.querySelector("#past-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const list = document.querySelector("#past-activities");
  list.hidden = !list.hidden;
  button.setAttribute("aria-expanded", String(!list.hidden));
  button.title = list.hidden ? "展开已结束活动" : "折叠已结束活动";
  button.querySelector("span").textContent = list.hidden ? "展开" : "折叠";
  button.querySelector("svg")?.setAttribute("data-lucide", list.hidden ? "chevron-down" : "chevron-up");
  button.querySelector("i")?.setAttribute("data-lucide", list.hidden ? "chevron-down" : "chevron-up");
  window.lucide?.createIcons();
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("退出未完成，请重试。");
    window.location.replace("/");
  } catch {
    document.querySelector("#status").textContent = "退出未完成，请重试。";
  }
});

loadSpace();