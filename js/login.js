// ================================================================
//  PASTO GENIE - Login page logic Supabase
// ================================================================
import { supabase, T, ROLES } from "./supabase-config.js";
import { redirectByRole } from "./auth.js";
import { authErrMsg } from "./utils.js";

const $ = id => document.getElementById(id);

async function loadUserRole(userId) {
  const { data, error } = await supabase
    .from(T.USERS)
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role || ROLES.PUBLIC;
}

async function redirectIfAlreadyLoggedIn() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) return;
  redirectByRole(await loadUserRole(user.id));
}

function showError(msg) {
  $("login-error-msg").textContent = msg;
  $("login-error").classList.remove("hidden");
}

function hideError() {
  $("login-error").classList.add("hidden");
}

function setLoading(on) {
  $("btn-login").disabled = on;
  $("btn-text").textContent = on ? "Connexion..." : "Se connecter";
  $("btn-spin").classList.toggle("hidden", !on);
}

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  hideError();
  setLoading(true);

  const email = $("email").value.trim();
  const password = $("password").value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const role = await loadUserRole(data.user.id);
    if (role === ROLES.PUBLIC) {
      await supabase.auth.signOut();
      showError("Compte non configure. Contactez l'administrateur.");
      setLoading(false);
      return;
    }

    redirectByRole(role);
  } catch (err) {
    setLoading(false);
    showError(authErrMsg(err.message || err.code));
  }
});

$("pwd-toggle").addEventListener("click", () => {
  const input = $("password");
  const icon = $("pwd-eye");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  icon.className = show ? "ri-eye-off-line" : "ri-eye-line";
});

redirectIfAlreadyLoggedIn();
