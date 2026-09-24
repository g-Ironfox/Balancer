const form = document.querySelector("#auth-form");
const username = document.querySelector("#auth-username");
const password = document.querySelector("#auth-password");
const title = document.querySelector("#auth-title");
const description = document.querySelector("#auth-description");
const submit = document.querySelector("#auth-submit");
const error = document.querySelector("#auth-error");
const switchButton = document.querySelector("#auth-switch");
let registerMode = false;

function updateMode() {
  title.textContent = registerMode ? "创建普通账号" : "登录管理后台";
  description.textContent = registerMode ? "普通账号暂不具备管理后台权限。" : "使用管理员账号继续。";
  submit.textContent = registerMode ? "注册账号" : "登录";
  switchButton.textContent = registerMode ? "返回登录" : "创建普通账号";
  password.autocomplete = registerMode ? "new-password" : "current-password";
  error.textContent = "";
}

async function submitAuth(event) {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch(registerMode ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join("；") : body.detail;
      throw new Error(detail || `请求失败 (${response.status})`);
    }
    if (registerMode) {
      registerMode = false;
      updateMode();
      password.value = "";
      error.textContent = "账号已创建，请使用管理员账号登录。";
      return;
    }
    if (body.role !== "admin") {
      await fetch("/api/auth/logout", { method: "POST" });
      throw new Error("该账号没有管理后台权限");
    }
    window.location.href = "/admin";
  } catch (authError) {
    error.textContent = authError.message || "操作失败，请稍后重试。";
  } finally {
    submit.disabled = false;
  }
}

switchButton.addEventListener("click", () => {
  registerMode = !registerMode;
  updateMode();
});
form.addEventListener("submit", submitAuth);
updateMode();

async function redirectSignedInAdmin() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.ok && (await response.json()).role === "admin") {
      window.location.replace("/admin");
    }
  } catch {
    // Keep the login form available if session lookup fails.
  }
}

redirectSignedInAdmin();