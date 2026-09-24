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
  title.textContent = registerMode ? "注册社员账号" : "登录我的空间";
  description.textContent = registerMode ? "加入社团，开启你的空间。" : "使用社员账号继续。";
  submit.textContent = registerMode ? "注册账号" : "登录";
  switchButton.textContent = registerMode ? "返回登录" : "注册社员账号";
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
      error.textContent = "账号已创建，请登录进入我的空间。";
      return;
    }
    window.location.href = "/space";
  } catch (authError) {
    error.textContent = authError instanceof TypeError ? "网络连接失败，请稍后重试。" : authError.message || "操作失败，请稍后重试。";
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

async function redirectSignedInUser() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.ok) {
      window.location.replace("/space");
    }
  } catch {
    // Keep the login form available if session lookup fails.
  }
}

redirectSignedInUser();