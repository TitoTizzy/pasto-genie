// Supabase Edge Function: admin-create-user
// Deploy apres installation/config Supabase CLI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const managedRoles = new Set(["superadmin", "admin", "jury"]);
const permissionPresets: Record<string, Record<string, boolean>> = {
  superadmin: {
    manage_tournaments: true,
    manage_teams: true,
    manage_matches: true,
    score_matches: true,
    manage_blog: true,
    manage_rules: true,
    view_stats: true,
    manage_users: true,
  },
  admin: {
    manage_tournaments: true,
    manage_teams: true,
    manage_matches: true,
    score_matches: false,
    manage_blog: true,
    manage_rules: false,
    view_stats: true,
    manage_users: false,
  },
  jury: {
    manage_tournaments: false,
    manage_teams: false,
    manage_matches: false,
    score_matches: true,
    manage_blog: false,
    manage_rules: false,
    view_stats: true,
    manage_users: false,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerData, error: callerError } = await userClient.auth.getUser();
    if (callerError || !callerData.user) throw new Error("Non authentifie.");

    const { data: callerProfile, error: profileError } = await adminClient
      .from("users")
      .select("role")
      .eq("id", callerData.user.id)
      .single();
    if (profileError) throw profileError;
    if (callerProfile.role !== "superadmin") throw new Error("Reserve au superadmin.");

    const { email, password, display_name, role, permissions } = await req.json();
    if (!email || !password || !role) throw new Error("email, password et role sont requis.");
    if (!managedRoles.has(role)) throw new Error("Profil invalide. Utilisez superadmin, admin ou jury.");

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name },
    });
    if (createError) throw createError;

    const { error: insertError } = await adminClient.from("users").insert({
      id: created.user.id,
      email,
      display_name,
      role,
      permissions: permissions || permissionPresets[role] || {},
    });
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ok: true, user_id: created.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
