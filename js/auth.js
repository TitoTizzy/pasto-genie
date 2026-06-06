// ================================================================
//  PASTO GENIE - Auth utilities Supabase
// ================================================================
import { supabase, T, ROLES } from "./supabase-config.js";

let _user = null;
let _role = null;
let _profile = null;

export const getCurrentUser = () => _user;
export const getCurrentRole = () => _role;
export const getCurrentProfile = () => _profile;
export const isSuperAdmin = () => _role === ROLES.SUPERADMIN;
export const isJuryOrAdmin = () => [ROLES.JURY, ROLES.ADMIN, ROLES.SUPERADMIN].includes(_role);

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from(T.USERS)
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function initAuth({ allowedRoles = [], redirectTo = "login.html" } = {}) {
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error) console.error(error);

  const user = sessionData?.session?.user || null;
  if (!user) {
    _user = null;
    _role = ROLES.PUBLIC;
    _profile = null;
    if (allowedRoles.length > 0) {
      window.location.href = redirectTo;
      return new Promise(() => {});
    }
    return { user: null, role: ROLES.PUBLIC, profile: null };
  }

  try {
    const profile = await loadProfile(user.id);
    const role = profile?.role || ROLES.PUBLIC;
    _user = user;
    _role = role;
    _profile = profile;

    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      await supabase.auth.signOut();
      window.location.href = redirectTo;
      return new Promise(() => {});
    }

    return { user, role, profile };
  } catch (err) {
    console.error(err);
    if (allowedRoles.length > 0) {
      window.location.href = redirectTo;
      return new Promise(() => {});
    }
    return { user, role: ROLES.PUBLIC, profile: null };
  }
}

export async function logout(redirectTo = "login.html") {
  await supabase.auth.signOut();
  window.location.href = redirectTo;
}

export function redirectByRole(role) {
  const map = {
    [ROLES.SUPERADMIN]: "admin.html",
    [ROLES.ADMIN]: "admin.html",
    [ROLES.JURY]: "jury.html",
    [ROLES.PUBLIC]: "index.html",
  };
  window.location.href = map[role] || "index.html";
}
