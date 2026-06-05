// ================================================================
//  PASTO GENIE - Admin panel Supabase
// ================================================================
import { supabase, T, ROLES, CATEGORIES, BAREME_DEFAULT, STORAGE_BUCKET } from "./supabase-config.js";
import { initAuth, logout } from "./auth.js";
import { toast, showSection, showAlert, hideAlert, nextPlayerId, openOverlay, closeOverlay } from "./utils.js";

const $ = id => document.getElementById(id);

let allUsers = [];
let allEquipes = [];
let allJoueurs = [];
let tournoisMap = {};
let teamA = { titulaires: [], remplacants: [] };
let teamB = { titulaires: [], remplacants: [] };
let catOrder = CATEGORIES.map(c => c.id);
let allBlogArticles = [];
let currentAdminUser = null;

(async () => {
  const { user } = await initAuth({ allowedRoles: [ROLES.SUPERADMIN], redirectTo: "login.html" });
  currentAdminUser = user;
  $("admin-email").textContent = user.email;
  bootstrap();
})();

function nowISO() {
  return new Date().toISOString();
}

function bind(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

function previewUpload(inputId, previewId) {
  bind(inputId, "change", e => {
    const file = e.target.files?.[0];
    const preview = $(previewId);
    if (!file || !preview) return;
    preview.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    preview.textContent = "";
    preview.innerHTML = "";
  });
}

async function uploadImage(inputId, folder) {
  const input = $(inputId);
  const file = input?.files?.[0];
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Le fichier doit etre une image.");
  if (file.size > 4 * 1024 * 1024) throw new Error("Image trop lourde. Maximum 4 MB.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${crypto.randomUUID()}.${ext || "jpg"}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function bootstrap() {
  wireNav();
  wireSidebar();
  wireMatchCreate();
  wireBareme();
  wireRegles();
  wireUsers();
  wireCreateUser();
  wireTournois();
  wireEquipes();
  wireJoueurs();
  wireStats();
  wireBlog();
  buildCatDragList();
  showSection("s-dashboard");
  loadDashboard();
  loadTournoisSelects();
  loadJurySelect();
  loadEquipes();
}

function wireNav() {
  bind("btn-logout", "click", () => logout("login.html"));
}

function wireSidebar() {
  document.querySelectorAll(".sidebar-link[data-section]").forEach(btn => {
    btn.addEventListener("click", () => {
      showSection(btn.dataset.section);
      if (btn.dataset.section === "s-dashboard") loadDashboard();
      if (btn.dataset.section === "s-tournois") loadTournoisList();
      if (btn.dataset.section === "s-matches") loadMatchesList();
      if (btn.dataset.section === "s-equipes") loadEquipes();
      if (btn.dataset.section === "s-joueurs") loadJoueurs();
      if (btn.dataset.section === "s-statistiques") loadStats();
      if (btn.dataset.section === "s-bareme") loadBareme();
      if (btn.dataset.section === "s-regles") loadRegles();
      if (btn.dataset.section === "s-blog") loadBlogArticles();
      if (btn.dataset.section === "s-users") loadUsers();
    });
  });

  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => showSection(btn.dataset.goto));
  });
}

async function fetchRows(table, options = {}) {
  let q = supabase.from(table).select(options.select || "*");
  if (options.eq) options.eq.forEach(([k, v]) => { q = q.eq(k, v); });
  if (options.order) q = q.order(options.order.column, { ascending: options.order.ascending ?? true });
  if (options.limit) q = q.limit(options.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function isMissingTableError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return msg.includes("could not find the table")
    || msg.includes("does not exist")
    || msg.includes("schema cache");
}

async function optionalDelete(query) {
  const { error } = await query;
  if (error && !isMissingTableError(error)) throw error;
}

async function loadDashboard() {
  try {
    const [tournois, matches, users] = await Promise.all([
      fetchRows(T.TOURNOIS),
      fetchRows(T.MATCHES),
      fetchRows(T.USERS),
    ]);

    $("stat-tournois").textContent = tournois.length;
    $("stat-matches").textContent = matches.length;
    $("stat-users").textContent = users.length;
    $("stat-live").textContent = matches.filter(m => m.statut === "en_cours").length;

    const recent = await fetchRows(T.MATCHES, { order: { column: "created_at", ascending: false }, limit: 5 });
    const wrap = $("dash-recent-matches");
    wrap.innerHTML = "";
    if (!recent.length) {
      wrap.innerHTML = '<p class="text-muted text-sm text-center" style="padding:var(--space-4);">Aucun match cree.</p>';
      return;
    }
    recent.forEach(m => wrap.appendChild(buildMatchCard(m.id, m, true)));
  } catch (err) {
    console.error(err);
    toast("Erreur chargement dashboard.", "error");
  }
}

function wireTournois() {
  bind("btn-new-tournoi", "click", () => openOverlay("tournoi-overlay"));
  bind("close-tournoi-modal", "click", () => closeOverlay("tournoi-overlay"));
  bind("btn-creer-tournoi", "click", creerTournoi);
  bind("engine-tournoi", "change", renderCompetitionEngine);
  bind("btn-register-team", "click", registerTeamToTournament);
  bind("btn-transfer-player", "click", transferPlayerInTournament);
}

async function loadTournoisList() {
  const wrap = $("tournois-list");
  wrap.innerHTML = '<div class="skeleton" style="height:60px;border-radius:var(--r-sm);"></div>';
  try {
    const rows = await fetchRows(T.TOURNOIS, { order: { column: "annee", ascending: false } });
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.innerHTML = '<p class="text-muted text-sm text-center" style="padding:var(--space-6);">Aucun tournoi.</p>';
      return;
    }
    rows.forEach(t => {
      tournoisMap[t.id] = t;
      wrap.appendChild(buildTournoiCard(t.id, t));
    });
    await populateCompetitionEngine(rows);
  } catch (err) {
    console.error(err);
    toast("Erreur chargement tournois.", "error");
  }
}

async function populateCompetitionEngine(tournois = null) {
  try {
    if (!allEquipes.length) allEquipes = await fetchRows(T.EQUIPES, { order: { column: "nom", ascending: true } });
    if (!allJoueurs.length) allJoueurs = await fetchRows(T.JOUEURS, { order: { column: "nom", ascending: true } });
    const rows = tournois || await fetchRows(T.TOURNOIS, { order: { column: "annee", ascending: false } });
    const tSel = $("engine-tournoi");
    const eSel = $("engine-equipe");
    const teSel = $("transfer-equipe");
    const jSel = $("transfer-joueur");
    if (tSel) {
      const current = tSel.value;
      while (tSel.options.length > 1) tSel.remove(1);
      rows.forEach(t => tSel.appendChild(new Option(t.nom, t.id)));
      tSel.value = current || rows.find(t => t.actif)?.id || rows[0]?.id || "";
    }
    [eSel, teSel].forEach(sel => {
      if (!sel) return;
      const current = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      allEquipes.forEach(eq => sel.appendChild(new Option(eq.nom, eq.id)));
      sel.value = current;
    });
    if (jSel) {
      const current = jSel.value;
      while (jSel.options.length > 1) jSel.remove(1);
      allJoueurs.forEach(j => jSel.appendChild(new Option(`${j.prenom || ""} ${j.nom || ""}`.trim(), j.id)));
      jSel.value = current;
    }
    await renderCompetitionEngine();
  } catch (err) {
    console.error(err);
  }
}

async function renderCompetitionEngine() {
  const wrap = $("engine-teams-list");
  const tournoiId = $("engine-tournoi")?.value;
  if (!wrap || !tournoiId) return;
  wrap.innerHTML = '<p class="text-muted text-center">Chargement des inscriptions...</p>';
  try {
    const { data, error } = await supabase
      .from(T.TOURNOI_EQUIPES)
      .select("*")
      .eq("tournoi_id", tournoiId)
      .order("poule", { ascending: true });
    if (error) throw error;
    wrap.innerHTML = "";
    if (!data?.length) {
      wrap.innerHTML = '<p class="text-muted text-center">Aucune equipe inscrite dans ce tournoi.</p>';
      return;
    }
    data.forEach(row => {
      const eq = allEquipes.find(item => item.id === row.equipe_id);
      const card = document.createElement("div");
      card.className = "entity-card";
      card.innerHTML = `
        <div class="entity-avatar"></div>
        <div class="entity-main">
          <div class="entity-title"></div>
          <div class="entity-meta"></div>
        </div>
        <span class="statut-badge en_cours">${row.poule || "Poule unique"}</span>`;
      const avatar = card.querySelector(".entity-avatar");
      if (eq?.embleme_url) {
        avatar.style.backgroundImage = `url("${eq.embleme_url}")`;
        avatar.textContent = "";
      } else {
        avatar.textContent = (eq?.nom || "?")[0].toUpperCase();
      }
      card.querySelector(".entity-title").textContent = eq?.nom || "Equipe inconnue";
      card.querySelector(".entity-meta").textContent = `${eq?.paroisse || "Sans paroisse"} - inscrite au tournoi`;
      wrap.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="text-muted text-center">Executez le script SQL du moteur de competition.</p>';
  }
}

async function registerTeamToTournament() {
  const tournoiId = $("engine-tournoi")?.value;
  const equipeId = $("engine-equipe")?.value;
  const poule = $("engine-poule")?.value.trim() || "Poule unique";
  if (!tournoiId || !equipeId) {
    toast("Choisissez un tournoi et une equipe.", "error");
    return;
  }
  try {
    if (await isTournamentLocked(tournoiId)) {
      toast("Tournoi verrouille : impossible d'inscrire une equipe apres le premier match.", "error");
      return;
    }
    const { error } = await supabase.from(T.TOURNOI_EQUIPES).upsert({
      tournoi_id: tournoiId,
      equipe_id: equipeId,
      poule,
      statut: "active",
      updated_at: nowISO(),
    }, { onConflict: "tournoi_id,equipe_id" });
    if (error) throw error;
    const joueurs = allJoueurs.filter(j => j.equipe_id === equipeId).map(j => ({
      tournoi_id: tournoiId,
      joueur_id: j.id,
      equipe_id: equipeId,
      statut: "active",
      date_debut: nowISO(),
      updated_at: nowISO(),
    }));
    if (joueurs.length) {
      const { error: joueursError } = await supabase.from(T.TOURNOI_JOUEURS).upsert(joueurs, { onConflict: "tournoi_id,joueur_id" });
      if (joueursError) throw joueursError;
    }
    toast("Equipe inscrite au tournoi.", "success");
    await renderCompetitionEngine();
  } catch (err) {
    console.error(err);
    if (isMissingTableError(err)) {
      toast("Moteur competition incomplet : executez le script SQL repair-blog-and-competition-engine.sql dans Supabase.", "error");
    } else {
      toast("Erreur inscription : " + err.message, "error");
    }
  }
}

async function transferPlayerInTournament() {
  const tournoiId = $("engine-tournoi")?.value;
  const joueurId = $("transfer-joueur")?.value;
  const toEquipeId = $("transfer-equipe")?.value;
  const note = $("transfer-note")?.value.trim() || "";
  if (!tournoiId || !joueurId || !toEquipeId) {
    toast("Choisissez un tournoi, un joueur et une equipe.", "error");
    return;
  }
  const current = allJoueurs.find(j => j.id === joueurId);
  try {
    if (await isTournamentLocked(tournoiId)) {
      toast("Tournoi verrouille : transfert interdit apres le premier match.", "error");
      return;
    }
    const { error: transferError } = await supabase.from(T.TRANSFERTS).insert({
      tournoi_id: tournoiId,
      joueur_id: joueurId,
      ancienne_equipe_id: current?.equipe_id || null,
      nouvelle_equipe_id: toEquipeId,
      note,
      created_at: nowISO(),
    });
    if (transferError) throw transferError;
    const { error: rosterError } = await supabase.from(T.TOURNOI_JOUEURS).upsert({
      tournoi_id: tournoiId,
      joueur_id: joueurId,
      equipe_id: toEquipeId,
      statut: "active",
      date_debut: nowISO(),
      updated_at: nowISO(),
    }, { onConflict: "tournoi_id,joueur_id" });
    if (rosterError) throw rosterError;
    toast("Transfert enregistre pour ce tournoi.", "success");
  } catch (err) {
    console.error(err);
    if (isMissingTableError(err)) {
      toast("Moteur competition incomplet : executez le script SQL repair-blog-and-competition-engine.sql dans Supabase.", "error");
    } else {
      toast("Erreur transfert : " + err.message, "error");
    }
  }
}

async function loadTournoisSelects() {
  try {
    const rows = await fetchRows(T.TOURNOIS, { order: { column: "annee", ascending: false } });
    const sel = $("match-tournoi");
    while (sel.options.length > 1) sel.remove(1);
    rows.forEach(t => {
      tournoisMap[t.id] = t;
      sel.appendChild(new Option(t.nom, t.id));
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadJurySelect() {
  try {
    const jurys = await fetchRows(T.USERS, { eq: [["role", ROLES.JURY]] });
    const admins = await fetchRows(T.USERS, { eq: [["role", ROLES.SUPERADMIN]] });
    const sel = $("match-jury");
    while (sel.options.length > 1) sel.remove(1);
    jurys.forEach(u => sel.appendChild(new Option(u.display_name || u.email, u.id)));
    admins.forEach(u => sel.appendChild(new Option(`${u.display_name || u.email} (admin)`, u.id)));
  } catch (err) {
    console.error(err);
  }
}

function buildTournoiCard(id, t) {
  const card = document.createElement("div");
  card.className = "glass item-card";
  card.innerHTML = `
    <div class="item-card-icon gold"><i class="ri-trophy-line"></i></div>
    <div class="item-card-body">
      <div class="item-card-title"></div>
      <div class="item-card-meta"><i class="ri-calendar-line"></i> <span class="meta"></span></div>
    </div>
    <div class="item-card-actions">
      <span class="statut-badge ${t.actif ? "en_cours" : "termine"}">${t.actif ? "Actif" : "Termine"}</span>
      <button class="btn btn-ghost btn-sm generate-tournoi-matches" title="Generer les matchs">
        <i class="ri-calendar-schedule-line"></i> Generer
      </button>
      <button class="btn btn-ghost btn-sm btn-icon toggle-tournoi" title="${t.actif ? "Cloturer" : "Activer"}">
        <i class="${t.actif ? "ri-stop-circle-line" : "ri-play-circle-line"}"></i>
      </button>
      <button class="btn btn-ghost btn-sm btn-icon delete-tournoi" title="Supprimer le tournoi">
        <i class="ri-delete-bin-line" style="color:var(--red);"></i>
      </button>
    </div>`;
  card.querySelector(".item-card-title").textContent = t.nom || "";
  card.querySelector(".meta").textContent = `${t.annee || ""} - ${t.description || "Pas de description"}`;
  card.querySelector(".toggle-tournoi").addEventListener("click", () => toggleTournoi(id, t.actif));
  card.querySelector(".generate-tournoi-matches").addEventListener("click", () => generateTournoiMatches(id, t.nom));
  card.querySelector(".delete-tournoi").addEventListener("click", () => deleteTournoi(id, t.nom));
  return card;
}

async function generateTournoiMatches(id, nom) {
  if (!confirm(`Generer automatiquement les matchs de poule pour "${nom}" ? Les doublons existants ne seront pas recrees.`)) return;
  try {
    if (await isTournamentLocked(id)) {
      toast("Tournoi verrouille : un match a deja demarre.", "error");
      return;
    }
    const { data, error } = await supabase.rpc("generer_matchs_competition", {
      p_tournoi_id: id,
      p_start_at: null,
      p_interval_minutes: 60,
    });
    if (error) throw error;
    toast(`${data || 0} match(s) genere(s).`, "success");
    await loadMatchesList();
  } catch (err) {
    console.error(err);
    toast("Erreur generation calendrier : " + err.message, "error");
  }
}

async function isTournamentLocked(tournoiId) {
  const { data, error } = await supabase
    .from(T.MATCHES)
    .select("id")
    .eq("tournoi_id", tournoiId)
    .or("statut.in.(en_cours,pause,termine),started_at.not.is.null")
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function getTournamentMatchIds(tournoiId) {
  const { data, error } = await supabase
    .from(T.MATCHES)
    .select("id")
    .eq("tournoi_id", tournoiId);
  if (error) throw error;
  return (data || []).map(row => row.id).filter(Boolean);
}

async function deleteTournoi(id, nom) {
  if (!confirm(`Supprimer definitivement le tournoi "${nom || "sans nom"}" ?`)) return;

  try {
    if (await isTournamentLocked(id)) {
      toast("Impossible de supprimer : un match de ce tournoi a deja commence. L'historique est protege.", "error");
      return;
    }

    const matchIds = await getTournamentMatchIds(id);
    if (matchIds.length && !confirm(`Ce tournoi contient ${matchIds.length} match(s) non joues. Supprimer aussi ce calendrier ?`)) {
      return;
    }

    if (matchIds.length) {
      const deletes = [
        supabase.from(T.MATCH_EN_COURS).delete().in("id", matchIds),
        supabase.from(T.EVENEMENTS).delete().in("match_id", matchIds),
        supabase.from(T.STATS_EQUIPES).delete().in("match_id", matchIds),
        supabase.from(T.STATS_JOUEURS).delete().in("match_id", matchIds),
      ];
      const deleteResults = await Promise.all(deletes);
      const deleteError = deleteResults.find(result => result.error)?.error;
      if (deleteError) throw deleteError;

      const { error: matchesError } = await supabase.from(T.MATCHES).delete().eq("tournoi_id", id);
      if (matchesError) throw matchesError;
    }

    const cleanupTables = [T.TRANSFERTS, T.TOURNOI_JOUEURS, T.TOURNOI_EQUIPES].filter(Boolean);
    for (const table of cleanupTables) {
      const { error } = await supabase.from(table).delete().eq("tournoi_id", id);
      if (error) throw error;
    }

    const { error } = await supabase.from(T.TOURNOIS).delete().eq("id", id);
    if (error) throw error;

    toast("Tournoi supprime.", "success");
    delete tournoisMap[id];
    await loadTournoisList();
    await loadTournoisSelects();
    await populateStatsTournois();
  } catch (err) {
    console.error(err);
    toast("Erreur suppression tournoi : " + err.message, "error");
  }
}

async function creerTournoi() {
  hideAlert("t-alert");
  const nom = $("t-nom").value.trim();
  const annee = parseInt($("t-annee").value, 10) || new Date().getFullYear();
  const description = $("t-desc").value.trim();
  const rules = {
    nombre_equipes: parseInt($("t-nb-equipes")?.value, 10) || null,
    nombre_poules: parseInt($("t-nb-poules")?.value, 10) || null,
    matchs_poule_par_equipe: parseInt($("t-matchs-poule")?.value, 10) || null,
    points_victoire: parseInt($("t-pts-victoire")?.value, 10) || 3,
    points_nul: parseInt($("t-pts-nul")?.value, 10) || 1,
    points_defaite: parseInt($("t-pts-defaite")?.value, 10) || 0,
  };
  if (!nom) {
    showAlert("t-alert-msg", "t-alert", "Nom requis.");
    return;
  }

  const btn = $("btn-creer-tournoi");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Creation...';
  try {
    const { error } = await supabase.from(T.TOURNOIS).insert({
      nom,
      annee,
      description,
      format_type: $("t-format")?.value || "Poules",
      regles: rules,
      actif: true,
      created_at: nowISO(),
    });
    if (error) throw error;
    toast("Tournoi cree !", "success");
    closeOverlay("tournoi-overlay");
    $("t-nom").value = "";
    $("t-desc").value = "";
    ["t-nb-equipes", "t-nb-poules", "t-matchs-poule"].forEach(id => { if ($(id)) $(id).value = ""; });
    loadTournoisSelects();
  } catch (err) {
    console.error(err);
    showAlert("t-alert-msg", "t-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-add-circle-line"></i> Creer';
  }
}

async function toggleTournoi(id, actif) {
  try {
    const { error } = await supabase.from(T.TOURNOIS).update({ actif: !actif }).eq("id", id);
    if (error) throw error;
    toast(`Tournoi ${!actif ? "active" : "cloture"}.`, "success");
    loadTournoisList();
  } catch (err) {
    console.error(err);
    toast("Erreur.", "error");
  }
}

function wireEquipes() {
  bind("btn-save-equipe", "click", saveEquipe);
  previewUpload("eq-embleme-file", "eq-embleme-preview");
  ["ea-equipe-id", "eb-equipe-id"].forEach(id => {
    bind(id, "change", e => applySelectedEquipe(id.startsWith("ea") ? "A" : "B", e.target.value));
  });
}

async function loadEquipes() {
  try {
    allEquipes = await fetchRows(T.EQUIPES, { order: { column: "nom", ascending: true } });
    try {
      allJoueurs = await fetchRows(T.JOUEURS, { order: { column: "nom", ascending: true } });
    } catch {
      allJoueurs = [];
    }
    renderEquipesList();
    populateEquipeSelects();
    populateMatchPlayerSelects();
  } catch (err) {
    console.error(err);
    const wrap = $("equipes-list");
    if (wrap) wrap.innerHTML = '<p class="text-muted text-center">Executez d abord le script SQL des effectifs.</p>';
  }
}

function renderEquipesList() {
  const wrap = $("equipes-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!allEquipes.length) {
    wrap.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-5);">Aucune equipe enregistree.</p>';
    return;
  }
  allEquipes.forEach(eq => {
    const card = document.createElement("div");
    card.className = "entity-card";
    const primary = eq.couleur_primaire || "#38bdf8";
    card.innerHTML = `
      <div class="entity-avatar" style="--entity-color:${primary};"></div>
      <div class="entity-main">
        <div class="entity-title"></div>
        <div class="entity-meta"></div>
      </div>
      <span class="color-swatch" style="background:${primary};"></span>
      <button class="btn btn-ghost btn-sm btn-icon delete-equipe" title="Supprimer l'equipe">
        <i class="ri-delete-bin-line" style="color:var(--red);"></i>
      </button>`;
    const avatar = card.querySelector(".entity-avatar");
    if (eq.embleme_url) {
      avatar.style.backgroundImage = `url("${eq.embleme_url}")`;
      avatar.textContent = "";
    } else {
      avatar.textContent = (eq.nom || "?")[0].toUpperCase();
    }
    card.querySelector(".entity-title").textContent = eq.nom || "-";
    card.querySelector(".entity-meta").textContent = `${eq.paroisse || "Sans paroisse"} - ${eq.poule || "Poule unique"}`;
    card.querySelector(".delete-equipe").addEventListener("click", () => deleteEquipe(eq));
    wrap.appendChild(card);
  });
}

function populateEquipeSelects() {
  ["ea-equipe-id", "eb-equipe-id", "j-equipe"].forEach(id => {
    const sel = $(id);
    if (!sel) return;
    const current = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    allEquipes.forEach(eq => sel.appendChild(new Option(eq.nom, eq.id)));
    sel.value = current;
  });
}

function applySelectedEquipe(side, equipeId) {
  const eq = allEquipes.find(item => item.id === equipeId);
  const prefix = side === "A" ? "ea" : "eb";
  if (!eq) return;
  $(`${prefix}-nom`).value = eq.nom || "";
  $(`${prefix}-paroisse`).value = eq.paroisse || "";
  populateMatchPlayerSelects(side);
}

function populateMatchPlayerSelects(side = null) {
  const sides = side ? [side] : ["A", "B"];
  sides.forEach(currentSide => {
    const prefix = currentSide === "A" ? "ea" : "eb";
    const equipeId = $(`${prefix}-equipe-id`)?.value;
    ["t", "r"].forEach(type => {
      const sel = $(`${prefix}-${type}-existing`);
      if (!sel) return;
      const current = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      allJoueurs
        .filter(j => !equipeId || j.equipe_id === equipeId)
        .forEach(j => sel.appendChild(new Option(`${j.prenom || ""} ${j.nom || ""}`.trim(), j.id)));
      sel.value = current;
    });
  });
}

async function saveEquipe() {
  hideAlert("eq-alert");
  const nom = $("eq-nom").value.trim();
  if (!nom) {
    showAlert("eq-alert-msg", "eq-alert", "Nom d equipe requis.");
    return;
  }
  const payload = {
    nom,
    paroisse: $("eq-paroisse").value.trim(),
    poule: $("eq-poule")?.value.trim() || "Poule unique",
    couleur_primaire: $("eq-couleur-1").value || "#38bdf8",
    couleur_secondaire: $("eq-couleur-2").value || "#f59e0b",
    updated_at: nowISO(),
  };
  const btn = $("btn-save-equipe");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Upload...';
  try {
    payload.embleme_url = await uploadImage("eq-embleme-file", "equipes");
    const { error } = await supabase.from(T.EQUIPES).insert({ ...payload, created_at: nowISO() });
    if (error) throw error;
    toast("Equipe enregistree.", "success");
    ["eq-nom", "eq-paroisse", "eq-poule", "eq-embleme-file"].forEach(id => { $(id).value = ""; });
    $("eq-embleme-preview").style.backgroundImage = "";
    $("eq-embleme-preview").innerHTML = '<i class="ri-image-add-line"></i>';
    await loadEquipes();
  } catch (err) {
    console.error(err);
    showAlert("eq-alert-msg", "eq-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-save-line"></i> Enregistrer l\'equipe';
  }
}

async function deleteEquipe(eq) {
  if (!confirm(`Supprimer definitivement l'equipe "${eq.nom || "sans nom"}" ?`)) return;

  try {
    const { data: matchRefs, error: matchError } = await supabase
      .from(T.MATCHES)
      .select("id")
      .or(`equipe_a_id.eq.${eq.id},equipe_b_id.eq.${eq.id}`)
      .limit(1);
    if (matchError) throw matchError;

    if ((matchRefs || []).length) {
      toast("Impossible de supprimer : cette equipe est deja rattachee a un match. Supprimez d'abord le calendrier non joue du tournoi.", "error");
      return;
    }

    await Promise.all([
      optionalDelete(supabase.from(T.TRANSFERTS).delete().or(`ancienne_equipe_id.eq.${eq.id},nouvelle_equipe_id.eq.${eq.id}`)),
      optionalDelete(supabase.from(T.TOURNOI_JOUEURS).delete().eq("equipe_id", eq.id)),
      optionalDelete(supabase.from(T.TOURNOI_EQUIPES).delete().eq("equipe_id", eq.id)),
    ]);

    const { error: detachPlayersError } = await supabase
      .from(T.JOUEURS)
      .update({ equipe_id: null, updated_at: nowISO() })
      .eq("equipe_id", eq.id);
    if (detachPlayersError) throw detachPlayersError;

    const { error } = await supabase.from(T.EQUIPES).delete().eq("id", eq.id);
    if (error) throw error;

    toast("Equipe supprimee.", "success");
    await loadEquipes();
    await loadJoueurs();
    await renderCompetitionEngine();
  } catch (err) {
    console.error(err);
    toast("Erreur suppression equipe : " + err.message, "error");
  }
}

function wireJoueurs() {
  bind("btn-save-joueur", "click", saveJoueur);
  previewUpload("j-photo-file", "j-photo-preview");
}

async function loadJoueurs() {
  try {
    if (!allEquipes.length) await loadEquipes();
    allJoueurs = await fetchRows(T.JOUEURS, { order: { column: "nom", ascending: true } });
    renderJoueursList();
  } catch (err) {
    console.error(err);
    const wrap = $("joueurs-list");
    if (wrap) wrap.innerHTML = '<p class="text-muted text-center">Executez d abord le script SQL des effectifs.</p>';
  }
}

function renderJoueursList() {
  const wrap = $("joueurs-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!allJoueurs.length) {
    wrap.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-5);">Aucun joueur enregistre.</p>';
    return;
  }
  allJoueurs.forEach(j => {
    const eq = allEquipes.find(item => item.id === j.equipe_id);
    const card = document.createElement("div");
    card.className = "entity-card entity-card-button";
    card.dataset.playerId = j.id;
    card.innerHTML = `
      <div class="entity-avatar"></div>
      <div class="entity-main">
        <div class="entity-title"></div>
        <div class="entity-meta"></div>
      </div>
      <button class="btn btn-ghost btn-sm btn-icon delete-joueur" title="Supprimer le joueur">
        <i class="ri-delete-bin-line" style="color:var(--red);"></i>
      </button>`;
    const avatar = card.querySelector(".entity-avatar");
    if (j.photo_url) {
      avatar.style.backgroundImage = `url("${j.photo_url}")`;
      avatar.textContent = "";
    } else {
      avatar.textContent = (j.prenom || j.nom || "?")[0].toUpperCase();
    }
    card.querySelector(".entity-title").textContent = `${j.prenom || ""} ${j.nom || ""}`.trim();
    card.querySelector(".entity-meta").textContent = eq?.nom || "Sans equipe";
    card.addEventListener("click", event => {
      if (event.target.closest(".delete-joueur")) return;
      toast("Profil detaille public a venir dans la prochaine etape.", "info");
    });
    card.querySelector(".delete-joueur").addEventListener("click", event => {
      event.stopPropagation();
      deleteJoueur(j);
    });
    wrap.appendChild(card);
  });
}

async function saveJoueur() {
  hideAlert("j-alert");
  const prenom = $("j-prenom").value.trim();
  const nom = $("j-nom").value.trim();
  const equipeId = $("j-equipe").value;
  if (!prenom && !nom) {
    showAlert("j-alert-msg", "j-alert", "Prenom ou nom requis.");
    return;
  }
  if (!equipeId) {
    showAlert("j-alert-msg", "j-alert", "Choisissez une equipe.");
    return;
  }
  const btn = $("btn-save-joueur");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Upload...';
  try {
    const photoUrl = await uploadImage("j-photo-file", "joueurs");
    const { error } = await supabase.from(T.JOUEURS).insert({
      prenom,
      nom,
      equipe_id: equipeId,
      photo_url: photoUrl,
      date_naissance: $("j-naissance").value || null,
      note: $("j-role").value.trim(),
      actif: true,
      created_at: nowISO(),
      updated_at: nowISO(),
    });
    if (error) throw error;
    toast("Joueur enregistre.", "success");
    ["j-prenom", "j-nom", "j-photo-file", "j-naissance", "j-role"].forEach(id => { $(id).value = ""; });
    $("j-photo-preview").style.backgroundImage = "";
    $("j-photo-preview").innerHTML = '<i class="ri-image-add-line"></i>';
    await loadJoueurs();
  } catch (err) {
    console.error(err);
    showAlert("j-alert-msg", "j-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-user-add-line"></i> Enregistrer le joueur';
  }
}

async function deleteJoueur(joueur) {
  const fullName = `${joueur.prenom || ""} ${joueur.nom || ""}`.trim() || "sans nom";
  if (!confirm(`Supprimer definitivement le joueur "${fullName}" ?`)) return;

  try {
    const checks = [
      supabase.from(T.EVENEMENTS).select("id").eq("joueur_id", joueur.id).limit(1),
      supabase.from(T.STATS_JOUEURS).select("id").eq("joueur_id", joueur.id).limit(1),
    ];
    const checkResults = await Promise.all(checks);
    const checkError = checkResults.find(result => result.error)?.error;
    if (checkError) throw checkError;

    if (checkResults.some(result => (result.data || []).length)) {
      toast("Impossible de supprimer : ce joueur a deja un historique de match.", "error");
      return;
    }

    await Promise.all([
      optionalDelete(supabase.from(T.TRANSFERTS).delete().eq("joueur_id", joueur.id)),
      optionalDelete(supabase.from(T.TOURNOI_JOUEURS).delete().eq("joueur_id", joueur.id)),
    ]);

    const { error } = await supabase.from(T.JOUEURS).delete().eq("id", joueur.id);
    if (error) throw error;

    toast("Joueur supprime.", "success");
    await loadJoueurs();
    await loadEquipes();
    await renderCompetitionEngine();
  } catch (err) {
    console.error(err);
    toast("Erreur suppression joueur : " + err.message, "error");
  }
}

function wireStats() {
  bind("btn-refresh-stats", "click", loadStats);
  ["stats-mode", "stats-tournoi", "stats-from", "stats-to"].forEach(id => bind(id, "change", loadStats));
}

async function loadStats() {
  try {
    if (!allEquipes.length) await loadEquipes();
    if (!allJoueurs.length) {
      try { allJoueurs = await fetchRows(T.JOUEURS, { order: { column: "nom", ascending: true } }); } catch { allJoueurs = []; }
    }
    await populateStatsTournois();
    const [teamStats, playerStats] = await Promise.all([fetchTeamStats(), fetchPlayerStats()]);
    renderTeamRanking(teamStats);
    renderPlayerRanking(playerStats);
  } catch (err) {
    console.error(err);
    $("ranking-equipes").innerHTML = '<p class="text-muted text-center">Statistiques indisponibles. Executez le script SQL de statistiques.</p>';
    $("ranking-joueurs").innerHTML = '<p class="text-muted text-center">Statistiques indisponibles. Executez le script SQL de statistiques.</p>';
  }
}

async function populateStatsTournois() {
  const sel = $("stats-tournoi");
  if (!sel || sel.dataset.ready === "1") return;
  const rows = await fetchRows(T.TOURNOIS, { order: { column: "annee", ascending: false } });
  rows.forEach(t => sel.appendChild(new Option(t.nom, t.id)));
  sel.dataset.ready = "1";
}

function applyStatsFilters(query) {
  const mode = $("stats-mode")?.value || "all";
  const tournoiId = $("stats-tournoi")?.value;
  const from = $("stats-from")?.value;
  const to = $("stats-to")?.value;
  if (mode === "tournoi" && tournoiId) query = query.eq("tournoi_id", tournoiId);
  if (mode === "dates") {
    if (from) query = query.gte("played_at", `${from}T00:00:00`);
    if (to) query = query.lte("played_at", `${to}T23:59:59`);
  }
  return query;
}

async function fetchTeamStats() {
  let q = supabase.from(T.STATS_EQUIPES).select("*");
  q = applyStatsFilters(q);
  const { data, error } = await q;
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(row => {
    const cur = map.get(row.equipe_id) || { equipe_id: row.equipe_id, matchs: 0, points: 0, pour: 0, contre: 0, victoires: 0, nuls: 0, defaites: 0 };
    cur.matchs += 1;
    cur.pour += row.score || 0;
    cur.contre += row.score_adverse || 0;
    if ((row.score || 0) > (row.score_adverse || 0)) { cur.victoires += 1; cur.points += 3; }
    else if ((row.score || 0) === (row.score_adverse || 0)) { cur.nuls += 1; cur.points += 1; }
    else cur.defaites += 1;
    map.set(row.equipe_id, cur);
  });
  return [...map.values()].sort((a, b) => b.points - a.points || (b.pour - b.contre) - (a.pour - a.contre) || b.pour - a.pour);
}

async function fetchPlayerStats() {
  let q = supabase.from(T.STATS_JOUEURS).select("*");
  q = applyStatsFilters(q);
  const { data, error } = await q;
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(row => {
    const cur = map.get(row.joueur_id) || { joueur_id: row.joueur_id, equipe_id: row.equipe_id, matchs: 0, points: 0, bonnes: 0, mauvaises: 0, repliques_bonnes: 0, repliques_mauvaises: 0 };
    cur.matchs += 1;
    cur.points += row.points || 0;
    cur.bonnes += row.bonnes || 0;
    cur.mauvaises += row.mauvaises || 0;
    cur.repliques_bonnes += row.repliques_bonnes || 0;
    cur.repliques_mauvaises += row.repliques_mauvaises || 0;
    map.set(row.joueur_id, cur);
  });
  return [...map.values()].sort((a, b) => b.points - a.points || b.bonnes - a.bonnes || a.mauvaises - b.mauvaises);
}

function renderTeamRanking(rows) {
  const wrap = $("ranking-equipes");
  wrap.innerHTML = "";
  if (!rows.length) {
    wrap.innerHTML = '<p class="text-muted text-center">Aucune statistique figee pour cette periode.</p>';
    return;
  }
  rows.forEach((row, index) => {
    const eq = allEquipes.find(item => item.id === row.equipe_id);
    const el = document.createElement("div");
    el.className = "ranking-row";
    el.innerHTML = `
      <div class="ranking-pos">${index + 1}</div>
      <div class="ranking-main">
        <div class="ranking-name"></div>
        <div class="ranking-meta">${row.matchs} match(s) - ${row.victoires}V ${row.nuls}N ${row.defaites}D - Diff ${row.pour - row.contre}</div>
      </div>
      <div class="ranking-points">${row.points}</div>`;
    el.querySelector(".ranking-name").textContent = eq?.nom || "Equipe inconnue";
    wrap.appendChild(el);
  });
}

function renderPlayerRanking(rows) {
  const wrap = $("ranking-joueurs");
  wrap.innerHTML = "";
  if (!rows.length) {
    wrap.innerHTML = '<p class="text-muted text-center">Aucune statistique figee pour cette periode.</p>';
    return;
  }
  rows.forEach((row, index) => {
    const joueur = allJoueurs.find(item => item.id === row.joueur_id);
    const eq = allEquipes.find(item => item.id === row.equipe_id);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ranking-row ranking-button";
    el.dataset.playerId = row.joueur_id;
    el.innerHTML = `
      <div class="ranking-pos">${index + 1}</div>
      <div class="ranking-main">
        <div class="ranking-name"></div>
        <div class="ranking-meta">${eq?.nom || "Equipe"} - ${row.matchs} match(s) - ${row.bonnes} bonnes - ${row.repliques_bonnes} repliques</div>
      </div>
      <div class="ranking-points">${row.points}</div>`;
    el.querySelector(".ranking-name").textContent = joueur ? `${joueur.prenom || ""} ${joueur.nom || ""}`.trim() : "Joueur inconnu";
    el.addEventListener("click", () => toast("Le profil complet du joueur arrive dans la prochaine etape.", "info"));
    wrap.appendChild(el);
  });
}

async function loadMatchesList() {
  const wrap = $("matches-list");
  wrap.innerHTML = '<div class="skeleton" style="height:60px;border-radius:var(--r-sm);"></div>';
  try {
    const rows = await fetchRows(T.MATCHES, { order: { column: "created_at", ascending: false } });
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.innerHTML = '<p class="text-muted text-sm text-center" style="padding:var(--space-6);">Aucun match.</p>';
      return;
    }
    rows.forEach(m => wrap.appendChild(buildMatchCard(m.id, m, false)));
  } catch (err) {
    console.error(err);
    toast("Erreur chargement matchs.", "error");
  }
}

function buildMatchCard(id, m, compact) {
  const card = document.createElement("div");
  card.className = "glass item-card";
  const labels = { planifie: "Planifie", en_cours: "En direct", pause: "Pause", termine: "Termine" };
  const statutCls = ["planifie", "en_cours", "termine"].includes(m.statut) ? m.statut : "planifie";
  card.innerHTML = `
    <div class="item-card-icon ${m.statut === "en_cours" ? "red" : "green"}">
      <i class="${m.statut === "en_cours" ? "ri-live-line" : "ri-football-line"}"></i>
    </div>
    <div class="item-card-body">
      <div class="item-card-title"></div>
      <div class="item-card-meta"><i class="ri-trophy-line"></i> <span class="match-meta"></span></div>
    </div>
    <div class="item-card-actions">
      <span class="statut-badge ${statutCls}">${labels[m.statut] || m.statut}</span>
      ${!compact ? buildMatchActions(m) : ""}
    </div>`;
  card.querySelector(".item-card-title").textContent = `${m.equipe_a?.nom || "A"} vs ${m.equipe_b?.nom || "B"}`;
  card.querySelector(".match-meta").textContent = `${m.tournament_name || "-"}${m.scheduled_at ? " - " + new Date(m.scheduled_at).toLocaleDateString("fr-FR") : ""}`;

  if (!compact) {
    card.querySelector(".btn-start-match")?.addEventListener("click", () => startMatch(id));
    card.querySelector(".btn-end-match")?.addEventListener("click", () => endMatch(id));
  }
  return card;
}

function buildMatchActions(m) {
  if (m.statut === "planifie") {
    return '<button class="btn btn-green btn-sm btn-start-match"><i class="ri-play-fill"></i> Demarrer</button>';
  }
  if (m.statut === "en_cours") {
    return '<button class="btn btn-red btn-sm btn-end-match"><i class="ri-stop-fill"></i> Terminer</button>';
  }
  return '<span class="text-muted text-xs">Termine</span>';
}

async function startMatch(id) {
  try {
    const { error } = await supabase.from(T.MATCHES).update({ statut: "en_cours", started_at: nowISO(), updated_at: nowISO() }).eq("id", id);
    if (error) throw error;
    toast("Match demarre !", "success");
    loadMatchesList();
    loadDashboard();
  } catch (err) {
    console.error(err);
    toast("Erreur demarrage.", "error");
  }
}

async function endMatch(id) {
  if (!confirm("Terminer ce match definitivement ?")) return;
  try {
    const { error } = await supabase.rpc("finalize_match_stats", { p_match_id: id });
    if (error) throw error;
    toast("Match termine et statistiques figees.", "success");
    loadMatchesList();
    loadDashboard();
  } catch (err) {
    console.error(err);
    toast("Erreur.", "error");
  }
}

function wireMatchCreate() {
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => addPlayer(btn.dataset.add));
  });
  bind("btn-save-match", "click", () => saveMatch(false));
  bind("btn-save-start-match", "click", () => saveMatch(true));
  [$("ea-nom"), $("eb-nom")].forEach(inp => {
    inp?.addEventListener("input", () => {
      $("btn-save-start-match").disabled = !($("ea-nom").value.trim() && $("eb-nom").value.trim());
    });
  });
}

function addPlayer(code) {
  const [equipe, type] = code.split("-");
  const team = equipe === "A" ? teamA : teamB;
  const prefix = equipe.toLowerCase();
  const shortType = type === "titulaire" ? "t" : "r";
  const typeProp = type === "titulaire" ? "titulaires" : "remplacants";
  if (team[typeProp].length >= 3) {
    toast(`Maximum 3 ${typeProp} par equipe.`, "error");
    return;
  }
  const existingId = `e${prefix}-${shortType}-existing`;
  const selectedPlayer = allJoueurs.find(j => j.id === $(existingId)?.value);
  const prenomId = `e${prefix}-${shortType}-prenom`;
  const nomId = `e${prefix}-${shortType}-nom`;
  const prenom = $(prenomId).value.trim();
  const nom = $(nomId).value.trim();
  if (selectedPlayer) {
    if (teamA.titulaires.concat(teamA.remplacants, teamB.titulaires, teamB.remplacants).some(p => p.id === selectedPlayer.id)) {
      toast("Ce joueur est deja ajoute au match.", "error");
      return;
    }
    team[typeProp].push({
      id: selectedPlayer.id,
      prenom: selectedPlayer.prenom || "",
      nom: selectedPlayer.nom || "",
      photo_url: selectedPlayer.photo_url || "",
      equipe_id: selectedPlayer.equipe_id || null,
    });
    $(existingId).value = "";
    renderPlayersList(`e${prefix}-${typeProp}`, team[typeProp]);
    return;
  }
  if (!prenom && !nom) {
    toast("Saisissez au moins un prenom ou nom.", "error");
    return;
  }
  team[typeProp].push({ id: nextPlayerId(), prenom, nom, equipe_id: $(`e${prefix}-equipe-id`)?.value || null });
  $(prenomId).value = "";
  $(nomId).value = "";
  renderPlayersList(`e${prefix}-${typeProp}`, team[typeProp]);
}

function renderPlayersList(containerId, players) {
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-list-row";
    row.innerHTML = `
      <div class="avatar sm"></div>
      <span class="player-label"></span>
      <button class="btn btn-ghost btn-sm btn-icon remove-player" title="Supprimer">
        <i class="ri-delete-bin-line"></i>
      </button>`;
    row.querySelector(".avatar").textContent = (p.prenom || p.nom || "?")[0].toUpperCase();
    row.querySelector(".player-label").textContent = `${p.prenom} ${p.nom}`;
    row.querySelector(".remove-player").addEventListener("click", () => {
      players.splice(i, 1);
      renderPlayersList(containerId, players);
    });
    wrap.appendChild(row);
  });
}

function buildCatDragList() {
  const list = $("cat-drag-list");
  list.innerHTML = "";
  catOrder = CATEGORIES.map(c => c.id);
  CATEGORIES.forEach(cat => {
    const item = document.createElement("div");
    item.className = "drag-item";
    item.draggable = true;
    item.dataset.id = cat.id;
    item.innerHTML = `<i class="ri-drag-move-2-line drag-handle"></i><i class="${cat.icon}"></i><span></span>`;
    item.querySelector("span").textContent = cat.label;
    list.appendChild(item);
  });
  enableDragSort(list);
}

function enableDragSort(list) {
  let dragged = null;
  list.addEventListener("dragstart", e => {
    dragged = e.target.closest(".drag-item");
    dragged?.classList.add("dragging");
  });
  list.addEventListener("dragend", () => {
    dragged?.classList.remove("dragging");
    dragged = null;
    catOrder = [...list.querySelectorAll(".drag-item")].map(el => el.dataset.id);
  });
  list.addEventListener("dragover", e => {
    e.preventDefault();
    const target = e.target.closest(".drag-item");
    if (target && target !== dragged) {
      const rect = target.getBoundingClientRect();
      list.insertBefore(dragged, e.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
    }
  });
}

async function saveMatch(autoStart) {
  hideAlert("match-alert");
  showAlert("match-alert-msg", "match-alert", "Les matchs sont generes automatiquement depuis le module Tournoi.");
  showSection("s-tournois");
  return;
  const nomA = $("ea-nom").value.trim();
  const nomB = $("eb-nom").value.trim();
  if (!nomA || !nomB) {
    showAlert("match-alert-msg", "match-alert", "Les noms des deux equipes sont requis.");
    return;
  }
  if (teamA.titulaires.length < 1 || teamB.titulaires.length < 1) {
    showAlert("match-alert-msg", "match-alert", "Chaque equipe doit avoir au moins 1 titulaire.");
    return;
  }

  const tournoiId = $("match-tournoi").value || null;
  if (!tournoiId) {
    showAlert("match-alert-msg", "match-alert", "Choisissez un tournoi. Un match ne peut pas etre independant.");
    return;
  }
  const juryId = $("match-jury").value || null;
  const scheduledAt = $("match-datetime").value ? new Date($("match-datetime").value).toISOString() : null;
  const tournamentName = tournoiId ? $("match-tournoi").options[$("match-tournoi").selectedIndex]?.text || "" : "";
  const equipeARef = allEquipes.find(eq => eq.id === $("ea-equipe-id")?.value);
  const equipeBRef = allEquipes.find(eq => eq.id === $("eb-equipe-id")?.value);
  const matchData = {
    equipe_a_id: equipeARef?.id || null,
    equipe_b_id: equipeBRef?.id || null,
    equipe_a: {
      id: equipeARef?.id || null,
      nom: nomA,
      paroisse: $("ea-paroisse").value.trim(),
      embleme_url: equipeARef?.embleme_url || "",
      couleur_primaire: equipeARef?.couleur_primaire || "#38bdf8",
      couleur_secondaire: equipeARef?.couleur_secondaire || "#f59e0b",
      titulaires: teamA.titulaires,
      remplacants: teamA.remplacants,
    },
    equipe_b: {
      id: equipeBRef?.id || null,
      nom: nomB,
      paroisse: $("eb-paroisse").value.trim(),
      embleme_url: equipeBRef?.embleme_url || "",
      couleur_primaire: equipeBRef?.couleur_primaire || "#f43f5e",
      couleur_secondaire: equipeBRef?.couleur_secondaire || "#8b5cf6",
      titulaires: teamB.titulaires,
      remplacants: teamB.remplacants,
    },
    categories_ordre: catOrder,
    categorie_actuelle: 0,
    statut: autoStart ? "en_cours" : "planifie",
    tournoi_id: tournoiId,
    tournament_name: tournamentName,
    jury_id: juryId,
    scheduled_at: scheduledAt,
    created_at: nowISO(),
    ...(autoStart ? { started_at: nowISO() } : {}),
  };

  const btn = autoStart ? $("btn-save-start-match") : $("btn-save-match");
  btn.disabled = true;
  try {
    const { data, error } = await supabase.from(T.MATCHES).insert(matchData).select("id").single();
    if (error) throw error;

    const { error: scoreError } = await supabase.from(T.MATCH_EN_COURS).insert({
      id: data.id,
      score_a: 0,
      score_b: 0,
      points_joueurs: {},
      score_par_categorie: Object.fromEntries(CATEGORIES.map(c => [c.id, { A: 0, B: 0 }])),
      updated_at: nowISO(),
    });
    if (scoreError) throw scoreError;

    toast(`Match ${autoStart ? "cree et demarre" : "cree"} !`, "success");
    resetMatchForm();
    showSection("s-matches");
    loadMatchesList();
  } catch (err) {
    console.error(err);
    showAlert("match-alert-msg", "match-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function resetMatchForm() {
  ["ea-nom", "ea-paroisse", "eb-nom", "eb-paroisse", "match-datetime"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });
  teamA = { titulaires: [], remplacants: [] };
  teamB = { titulaires: [], remplacants: [] };
  ["ea-titulaires", "ea-remplacants", "eb-titulaires", "eb-remplacants"].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = "";
  });
  buildCatDragList();
  $("btn-save-start-match").disabled = true;
}

function wireBareme() {
  bind("btn-save-bareme", "click", saveBareme);
}

async function loadBareme() {
  try {
    const { data, error } = await supabase.from(T.CONFIG_POINTS).select("bareme").eq("id", "bareme").maybeSingle();
    if (error) throw error;
    renderBaremeRows(data?.bareme || BAREME_DEFAULT);
  } catch (err) {
    console.error(err);
    renderBaremeRows(BAREME_DEFAULT);
  }
}

function renderBaremeRows(data) {
  const wrap = $("bareme-rows");
  wrap.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const pts = data[cat.id] || { bonne: 0, mauvaise: 0, replique: 0, replique_penalite: 0 };
    const row = document.createElement("div");
    row.className = "bareme-row";
    row.innerHTML = `
      <div class="bareme-cat"><i class="${cat.icon}"></i><span>${cat.label}</span></div>
      <input type="number" class="form-input bareme-input" min="0" max="20" step="1" data-cat="${cat.id}" data-field="bonne"/>
      <input type="number" class="form-input bareme-input" min="0" max="20" step="1" data-cat="${cat.id}" data-field="mauvaise"/>
      <input type="number" class="form-input bareme-input" min="0" max="20" step="1" data-cat="${cat.id}" data-field="replique" ${cat.id === "eclair" ? 'disabled title="Pas de replique pour les Questions Eclair"' : ""}/>
      <input type="number" class="form-input bareme-input" min="0" max="20" step="1" data-cat="${cat.id}" data-field="replique_penalite" ${cat.id === "eclair" ? 'disabled title="Pas de replique pour les Questions Eclair"' : ""}/>`;
    row.querySelector('[data-field="bonne"]').value = pts.bonne;
    row.querySelector('[data-field="mauvaise"]').value = pts.mauvaise;
    row.querySelector('[data-field="replique"]').value = pts.replique;
    row.querySelector('[data-field="replique_penalite"]').value = pts.replique_penalite ?? 0;
    wrap.appendChild(row);
  });
}

async function saveBareme() {
  hideAlert("bareme-alert");
  const bareme = {};
  $("bareme-rows").querySelectorAll(".bareme-input").forEach(inp => {
    bareme[inp.dataset.cat] ||= {};
    bareme[inp.dataset.cat][inp.dataset.field] = parseInt(inp.value, 10) || 0;
  });
  if (bareme.eclair) {
    bareme.eclair.replique = 0;
    bareme.eclair.replique_penalite = 0;
  }

  const btn = $("btn-save-bareme");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
  try {
    const { error } = await supabase.from(T.CONFIG_POINTS).upsert({ id: "bareme", bareme, updated_at: nowISO() });
    if (error) throw error;
    toast("Bareme enregistre !", "success");
  } catch (err) {
    console.error(err);
    showAlert("bareme-alert-msg", "bareme-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-save-line"></i> Enregistrer';
  }
}

function wireRegles() {
  bind("btn-save-regles", "click", saveRegles);
}

async function loadRegles() {
  try {
    const { data, error } = await supabase.from(T.REGLES_JEU).select("texte").eq("id", "regles_officielles").maybeSingle();
    if (error) throw error;
    $("regles-texte").value = data?.texte || "";
  } catch (err) {
    console.error(err);
  }
}

async function saveRegles() {
  hideAlert("regles-alert");
  const texte = $("regles-texte").value.trim();
  if (!texte) {
    showAlert("regles-alert-msg", "regles-alert", "Le texte ne peut pas etre vide.");
    return;
  }
  const btn = $("btn-save-regles");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
  try {
    const { error } = await supabase.from(T.REGLES_JEU).upsert({ id: "regles_officielles", texte, updated_at: nowISO() });
    if (error) throw error;
    toast("Regles enregistrees !", "success");
  } catch (err) {
    console.error(err);
    showAlert("regles-alert-msg", "regles-alert", "Erreur : " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-save-line"></i> Enregistrer';
  }
}

function wireBlog() {
  bind("btn-save-blog", "click", saveBlogArticle);
  previewUpload("blog-image-file", "blog-image-preview");
}

async function loadBlogArticles() {
  const wrap = $("blog-list");
  if (!wrap) return;
  wrap.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-5);">Chargement...</p>';
  try {
    allBlogArticles = await fetchRows(T.BLOG_ARTICLES, {
      order: { column: "created_at", ascending: false },
      limit: 40,
    });
    renderBlogArticles();
  } catch (err) {
    console.error(err);
    if (isMissingTableError(err)) {
      wrap.innerHTML = '<p class="text-muted text-center">Executez le script SQL repair-blog-and-competition-engine.sql.</p>';
    } else {
      wrap.innerHTML = '<p class="text-muted text-center">Erreur chargement blog.</p>';
    }
  }
}

function renderBlogArticles() {
  const wrap = $("blog-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!allBlogArticles.length) {
    wrap.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-5);">Aucun article.</p>';
    return;
  }

  allBlogArticles.forEach(article => {
    const card = document.createElement("div");
    card.className = "entity-card";
    card.innerHTML = `
      <div class="entity-avatar"><i class="ri-article-line"></i></div>
      <div class="entity-main">
        <div class="entity-title"></div>
        <div class="entity-meta"></div>
      </div>
      <span class="statut-badge ${article.statut === "published" ? "termine" : "planifie"}"></span>
      <button class="btn btn-ghost btn-sm btn-icon delete-blog" title="Supprimer l'article">
        <i class="ri-delete-bin-line" style="color:var(--red);"></i>
      </button>`;
    card.querySelector(".entity-title").textContent = article.titre || "-";
    card.querySelector(".entity-meta").textContent = `${article.categorie || "Actualites"} - ${article.resume || "Sans resume"}`;
    card.querySelector(".statut-badge").textContent = article.statut === "published" ? "Publie" : "Brouillon";
    const avatar = card.querySelector(".entity-avatar");
    if (article.image_url && avatar) {
      avatar.style.backgroundImage = `url("${article.image_url}")`;
      avatar.innerHTML = "";
    }
    card.querySelector(".delete-blog").addEventListener("click", () => deleteBlogArticle(article));
    wrap.appendChild(card);
  });
}

async function saveBlogArticle() {
  hideAlert("blog-alert");
  const titre = $("blog-title")?.value.trim();
  const categorie = $("blog-category")?.value.trim() || "Actualites";
  const resume = $("blog-excerpt")?.value.trim();
  const contenu = $("blog-content")?.value.trim();
  const statut = $("blog-status")?.value || "published";

  if (!titre) {
    showAlert("blog-alert-msg", "blog-alert", "Titre requis.");
    return;
  }

  const btn = $("btn-save-blog");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Publication...';
  try {
    const imageUrl = await uploadImage("blog-image-file", "blog");
    const { error } = await supabase.from(T.BLOG_ARTICLES).insert({
      titre,
      categorie,
      resume,
      contenu,
      image_url: imageUrl || null,
      statut,
      auteur_id: currentAdminUser?.id || null,
      published_at: statut === "published" ? nowISO() : null,
      created_at: nowISO(),
      updated_at: nowISO(),
    });
    if (error) throw error;
    toast(statut === "published" ? "Article publie." : "Brouillon enregistre.", "success");
    ["blog-title", "blog-category", "blog-excerpt", "blog-content"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    if ($("blog-status")) $("blog-status").value = "published";
    if ($("blog-image-file")) $("blog-image-file").value = "";
    if ($("blog-image-preview")) {
      $("blog-image-preview").style.backgroundImage = "";
      $("blog-image-preview").innerHTML = '<i class="ri-image-add-line"></i>';
    }
    await loadBlogArticles();
  } catch (err) {
    console.error(err);
    if (isMissingTableError(err)) {
      showAlert("blog-alert-msg", "blog-alert", "Executez le script SQL repair-blog-and-competition-engine.sql dans Supabase.");
    } else {
      showAlert("blog-alert-msg", "blog-alert", "Erreur : " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-send-plane-line"></i> Publier l\'article';
  }
}

async function deleteBlogArticle(article) {
  if (!confirm(`Supprimer l'article "${article.titre || "sans titre"}" ?`)) return;
  try {
    const { error } = await supabase.from(T.BLOG_ARTICLES).delete().eq("id", article.id);
    if (error) throw error;
    toast("Article supprime.", "success");
    await loadBlogArticles();
  } catch (err) {
    console.error(err);
    toast("Erreur suppression article : " + err.message, "error");
  }
}

function wireUsers() {
  bind("users-search", "input", () => renderUsersTable($("users-search").value.trim().toLowerCase()));
}

async function loadUsers() {
  $("users-tbody").innerHTML = '<tr><td colspan="4" class="text-muted text-center" style="padding:var(--space-6);">Chargement...</td></tr>';
  try {
    allUsers = await fetchRows(T.USERS, { order: { column: "email", ascending: true } });
    renderUsersTable("");
  } catch (err) {
    console.error(err);
    $("users-tbody").innerHTML = '<tr><td colspan="4" class="text-muted text-center">Erreur chargement.</td></tr>';
  }
}

function renderUsersTable(filter) {
  const tbody = $("users-tbody");
  tbody.innerHTML = "";
  const filtered = filter
    ? allUsers.filter(u => (u.email || "").toLowerCase().includes(filter) || (u.display_name || "").toLowerCase().includes(filter))
    : allUsers;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center" style="padding:var(--space-6);">Aucun resultat.</td></tr>';
    return;
  }

  filtered.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="text-sm user-email"></span></td>
      <td><span class="text-sm user-name"></span></td>
      <td><select class="form-select form-select-sm role-select"></select></td>
      <td style="text-align:right;"><button class="btn btn-ghost btn-sm btn-icon btn-delete-user" title="Supprimer"><i class="ri-delete-bin-line" style="color:var(--red);"></i></button></td>`;
    tr.querySelector(".user-email").textContent = u.email || "-";
    tr.querySelector(".user-name").textContent = u.display_name || "-";
    const select = tr.querySelector(".role-select");
    Object.values(ROLES).forEach(role => select.appendChild(new Option(role, role, role === u.role, role === u.role)));
    select.addEventListener("change", async e => {
      const newRole = e.target.value;
      try {
        const { error } = await supabase.from(T.USERS).update({ role: newRole }).eq("id", u.id);
        if (error) throw error;
        u.role = newRole;
        toast(`Role de ${u.email} mis a jour : ${newRole}`, "success");
      } catch (err) {
        console.error(err);
        toast("Erreur mise a jour role.", "error");
        e.target.value = u.role;
      }
    });
    tr.querySelector(".btn-delete-user").addEventListener("click", () => deleteUser(u.id, u.email));
    tbody.appendChild(tr);
  });
}

async function deleteUser(uid, email) {
  if (!confirm(`Supprimer le profil de ${email} ? Le compte Auth doit etre supprime via Supabase Auth ou une Edge Function admin.`)) return;
  try {
    const { error } = await supabase.from(T.USERS).delete().eq("id", uid);
    if (error) throw error;
    allUsers = allUsers.filter(u => u.id !== uid);
    renderUsersTable($("users-search").value.trim().toLowerCase());
    toast("Profil supprime.", "success");
  } catch (err) {
    console.error(err);
    toast("Erreur suppression.", "error");
  }
}

function wireCreateUser() {
  bind("btn-creer-user", "click", creerUser);
}

async function creerUser() {
  hideAlert("nu-alert");
  const email = $("nu-email").value.trim();
  const displayName = $("nu-displayname").value.trim();
  const password = $("nu-password").value;
  const role = $("nu-role").value;

  if (!email) {
    showAlert("nu-alert-msg", "nu-alert", "E-mail requis.");
    return;
  }
  if (password.length < 6) {
    showAlert("nu-alert-msg", "nu-alert", "Mot de passe min. 6 caracteres.");
    return;
  }

  const btn = $("btn-creer-user");
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Creation...';
  try {
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email, password, display_name: displayName, role },
    });
    if (error) {
      let functionMessage = "";
      try {
        const body = await error.context?.json?.();
        functionMessage = body?.error || body?.message || "";
      } catch {
        functionMessage = "";
      }
      throw new Error(functionMessage || error.message || "Edge Function refusee.");
    }
    if (data?.error) throw new Error(data.error);

    toast(`Compte cree : ${email} (${role})`, "success");
    ["nu-email", "nu-displayname", "nu-password"].forEach(id => {
      const el = $(id);
      if (el) el.value = "";
    });
    loadUsers();
    loadJurySelect();
  } catch (err) {
    console.error(err);
    const detail = err?.message || "requete impossible";
    showAlert(
      "nu-alert-msg",
      "nu-alert",
      `Creation impossible. Detail: ${detail}`
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-user-add-line"></i> Creer le compte';
  }
}
