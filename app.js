const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginMessage = document.getElementById("loginMessage");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginMessage.textContent = "Memproses login...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: loginUsername.value.trim(),
        password: loginPassword.value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      loginMessage.textContent = data.message || "Login gagal.";
      return;
    }

    localStorage.setItem("sidotiAuth", JSON.stringify(data));
    window.sidotiAuth = data;

    document.body.classList.remove("auth-pending");
    document.getElementById("loginScreen")?.classList.add("hidden");

    window.dispatchEvent(new Event("sidoti:auth-change"));
  } catch (error) {
    loginMessage.textContent = "Gagal menghubungi server login.";
  }
});