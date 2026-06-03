// ================================================================
//  PASTO GENIE - Jury interface Supabase
// ================================================================
import { supabase, T, CATEGORIES, ROLES } from "./supabase-config.js";
import { initAuth, logout, isSuperAdmin, getCurrentUser } from "./auth.js";
import { toast, formatTime, openOverlay, closeOverlay, getActiveCat } from "./utils.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let matchId = null;
let matchData = null;
let scoreData = null;
let bareme = {};
let chronoInt = null;
let repliqueActive = false;
let repliqueEquipe = null;
let repliqueTimer = null;
let repliqueSeconds = 30;
let repliqueResolved = false;
let pendingAnswerBtnsAdded = false;
let channels = [];

(async () => {
  const { user, role } = await initAuth({ allowedRoles: [ROLES.JURY, ROLES.SUPERADMIN], redirectTo: "login.html" });
  currentUser = user;
  $("jury-name-chip").textContent = user.email.split("@")[0];
  $("btn-logout").addEventListener("click", () => logout("login.html"));
  if (role === ROLES.SUPERADMIN) {
    $("admin-controls").classList.remove("hidden");
    $("admin-controls").style.display = "flex";
    setupAdminControls();
  }
  await loadMatchList();
})();

function nowISO() {
  return new Date().toISOString();
}

function normalizeMatch(row) {
  if (!row) return row;
  return {
    ...row,
    equipeA: row.equipe_a,
    equipeB: row.equipe_b,
    categoriesOrdre: row.categories_ordre,
    categorieActuelle: row.categorie_actuelle,
    startedAt: row.started_at ? new Date(row.started_at) : null,
  };
}

function normalizeScore(row) {
  if (!row) return row;
  return {
    ...row,
    scoreA: row.score_a,
    scoreB: row.score_b,
    pointsJoueurs: row.points_joueurs,
    scoreParCategorie: row.score_par_categorie,
  };
}

async function loadMatchList() {
  const { data, error } = await supabase.from(T.MATCHES).select("*").order("created_at", { ascending: false }).limit(30);
  if (error) {
    console.error(error);
    toast("Erreur chargement matchs.", "error");
    return;
  }
  const sel = $("jury-match-select");
  while (sel.options.length > 1) sel.remove(1);
  (data || []).forEach(row => {
    const m = normalizeMatch(row);
    sel.appendChild(new Option(`${m.equipeA?.nom || "A"} vs ${m.equipeB?.nom || "B"} [${m.statut}]`, m.id));
  });
}

$("btn-join").addEventListener("click", () => {
  const id = $("jury-match-select").value;
  if (!id) {
    toast("Selectionnez un match.", "error");
    return;
  }
  joinMatch(id);
});

async function joinMatch(id) {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels = [];
  matchId = id;
  $("jury-start").classList.add("hidden");
  $("jury-arena-wrap").classList.remove("hidden");

  await Promise.all([loadMatch(), loadScore(), loadBareme()]);

  const matchChannel = supabase
    .channel(`jury-match-${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: T.MATCHES, filter: `id=eq.${id}` }, payload => {
      matchData = normalizeMatch(payload.new);
      renderMatchState();
    })
    .subscribe();
  const scoreChannel = supabase
    .channel(`jury-score-${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: T.MATCH_EN_COURS, filter: `id=eq.${id}` }, payload => {
      scoreData = normalizeScore(payload.new);
      renderScores();
      renderPlayerScores();
    })
    .subscribe();
  channels.push(matchChannel, scoreChannel);
}

async function loadMatch() {
  const { data, error } = await supabase.from(T.MATCHES).select("*").eq("id", matchId).single();
  if (error) throw error;
  matchData = normalizeMatch(data);
  renderMatchState();
}

async function loadScore() {
  const { data, error } = await supabase.from(T.MATCH_EN_COURS).select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  scoreData = normalizeScore(data);
  renderScores();
  renderPlayerScores();
}

async function loadBareme() {
  try {
    const { data, error } = await supabase.from(T.CONFIG_POINTS).select("bareme").eq("id", "bareme").maybeSingle();
    if (error) throw error;
    bareme = data?.bareme || {};
  } catch {
    bareme = {};
  }
}

function renderMatchState() {
  if (!matchData) return;
  const nomA = matchData.equipeA?.nom || "Equipe A";
  const nomB = matchData.equipeB?.nom || "Equipe B";
  $("jury-header-a").textContent = nomA;
  $("jury-header-b").textContent = nomB;
  $("jury-score-name-a").textContent = nomA;
  $("jury-score-name-b").textContent = nomB;
  $("cp-name-a").textContent = nomA;
  $("cp-name-b").textContent = nomB;

  const cat = getActiveCat(matchData, CATEGORIES);
  if (cat) {
    $("jury-cat-icon").className = `${cat.icon} text-gold`;
    $("jury-cat-label").textContent = cat.label;
    const total = (matchData.categoriesOrdre || []).length;
    const cur = (matchData.categorieActuelle ?? 0) + 1;
    $("jury-cat-num").textContent = `${cur}/${total}`;
    const b = bareme[cat.id] || { bonne: "?", replique: "?", replique_penalite: "?" };
    $("jury-bareme-chip").textContent = `Bonne : ${b.bonne} pts - Replique : ${b.replique} pts - Penalite replique : ${b.replique_penalite} pts`;
  }

  if (matchData.statut === "en_cours" && matchData.startedAt) startChrono(matchData.startedAt);
  buildPlayerCards("A", matchData.equipeA);
  buildPlayerCards("B", matchData.equipeB);
}

function buildPlayerCards(equipe, equipeData) {
  if (!equipeData) return;
  const panel = $(`panel-${equipe.toLowerCase()}`);
  if (panel.querySelectorAll(".player-card").length > 0) return;
  const all = [
    ...(equipeData.titulaires || []).map(p => ({ ...p, type: "titulaire" })),
    ...(equipeData.remplacants || []).map(p => ({ ...p, type: "remplacant" })),
  ];
  all.forEach(joueur => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.id = `jcard-${joueur.id}`;
    card.innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <div>
          <div class="player-name"></div>
          <div class="text-xs text-muted" style="margin-top:2px;">${joueur.type === "titulaire" ? '<i class="ri-user-star-line" style="color:var(--gold);"></i> Titulaire' : '<i class="ri-user-line"></i> Remplacant'}</div>
        </div>
        <div class="player-score-big" id="jpts-${joueur.id}">0</div>
      </div>
      <div class="player-btn-row">
        <button class="btn-jury-good" data-id="${joueur.id}" data-equipe="${equipe}"><i class="ri-checkbox-circle-line"></i> Bonne</button>
        <button class="btn-jury-bad" data-id="${joueur.id}" data-equipe="${equipe}"><i class="ri-close-circle-line"></i> Mauvaise</button>
      </div>`;
    const nom = `${joueur.prenom || ""} ${joueur.nom || ""}`.trim();
    card.querySelector(".player-name").textContent = nom;
    card.querySelector(".btn-jury-good").dataset.nom = nom;
    card.querySelector(".btn-jury-bad").dataset.nom = nom;
    panel.appendChild(card);
    card.querySelector(".btn-jury-good").addEventListener("click", onBonne);
    card.querySelector(".btn-jury-bad").addEventListener("click", onMauvaise);
  });
}

function renderScores() {
  if (!scoreData) return;
  $("jury-score-a").textContent = scoreData.scoreA ?? 0;
  $("jury-score-b").textContent = scoreData.scoreB ?? 0;
  $("cp-score-a").textContent = scoreData.scoreA ?? 0;
  $("cp-score-b").textContent = scoreData.scoreB ?? 0;
}

function renderPlayerScores() {
  if (!scoreData?.pointsJoueurs) return;
  Object.entries(scoreData.pointsJoueurs).forEach(([id, pts]) => {
    const el = $(`jpts-${id}`);
    if (el) el.textContent = pts;
  });
}

async function pushEvent(data) {
  const { error } = await supabase.from(T.EVENEMENTS).insert({
    ...data,
    match_id: matchId,
    jury_id: currentUser.id,
    created_at: nowISO(),
  });
  if (error) throw error;
}

function lockButtons(lock) {
  document.querySelectorAll(".btn-jury-good, .btn-jury-bad").forEach(b => { b.disabled = lock; });
}

async function onBonne(e) {
  if (repliqueActive) return;
  const { id, equipe, nom } = e.currentTarget.dataset;
  const cat = getActiveCat(matchData, CATEGORIES);
  lockButtons(true);
  try {
    await pushEvent({ joueur_id: id, joueur_nom: nom, equipe, action: "bonne_reponse", categorie: cat?.id || "" });
    addLog("bonne", `${nom} (Eq.${equipe}) - Bonne reponse`);
    toast("Bonne reponse enregistree", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    lockButtons(false);
  }
}

async function onMauvaise(e) {
  if (repliqueActive) return;
  const { id, equipe, nom } = e.currentTarget.dataset;
  const cat = getActiveCat(matchData, CATEGORIES);
  lockButtons(true);
  try {
    await pushEvent({ joueur_id: id, joueur_nom: nom, equipe, action: "mauvaise_reponse", categorie: cat?.id || "" });
    addLog("mauvaise", `${nom} (Eq.${equipe}) - Mauvaise reponse`);
    toast("Mauvaise reponse enregistree", "info");
    if (cat?.id !== "eclair") openReplique(equipe === "A" ? "B" : "A");
    else lockButtons(false);
  } catch (err) {
    toast(err.message, "error");
    lockButtons(false);
  }
}

function openReplique(advEquipe) {
  repliqueActive = true;
  repliqueEquipe = advEquipe;
  repliqueResolved = false;
  pendingAnswerBtnsAdded = false;
  const equipeData = advEquipe === "A" ? matchData.equipeA : matchData.equipeB;
  const nomEquipe = equipeData?.nom || `Equipe ${advEquipe}`;
  $("replique-team-name").textContent = `${nomEquipe} - a vous de repliquer !`;
  $("replique-result").classList.add("hidden");
  $("replique-instruction").classList.remove("hidden");
  $("replique-answer-btns").classList.add("hidden");
  $("btn-no-replique").disabled = false;

  const grid = $("replique-players");
  grid.innerHTML = "";
  const allP = [...(equipeData?.titulaires || []), ...(equipeData?.remplacants || [])];
  allP.forEach(p => {
    const btn = document.createElement("button");
    btn.className = "replique-player-btn";
    btn.innerHTML = '<div class="avatar"></div><div class="rpb-name"></div><div class="rpb-pts"></div>';
    btn.querySelector(".avatar").textContent = (p.prenom || p.nom || "?")[0].toUpperCase();
    btn.querySelector(".rpb-name").textContent = `${p.prenom || ""} ${(p.nom || "").split(" ")[0]}`;
    btn.querySelector(".rpb-pts").textContent = `${scoreData?.pointsJoueurs?.[p.id] || 0} pts`;
    btn.dataset.id = p.id;
    btn.dataset.nom = `${p.prenom || ""} ${p.nom || ""}`.trim();
    btn.addEventListener("click", onRepliqueJoueurClick);
    grid.appendChild(btn);
  });

  openOverlay("replique-overlay");
  repliqueSeconds = 30;
  updateCountdown();
  repliqueTimer = setInterval(() => {
    repliqueSeconds--;
    updateCountdown();
    if (repliqueSeconds <= 0) closeReplique();
  }, 1000);
}

function updateCountdown() {
  const el = $("replique-countdown");
  el.innerHTML = `${repliqueSeconds}<span class="cd-label">secondes pour repliquer</span>`;
  el.classList.toggle("urgent", repliqueSeconds <= 10);
}

function onRepliqueJoueurClick(e) {
  if (repliqueResolved || pendingAnswerBtnsAdded) return;
  const { id, nom } = e.currentTarget.dataset;
  pendingAnswerBtnsAdded = true;
  clearInterval(repliqueTimer);
  document.querySelectorAll(".replique-player-btn").forEach(b => { b.disabled = true; });
  $("replique-instruction").textContent = `${nom.trim()} - La reponse est :`;
  $("btn-no-replique").disabled = true;
  $("replique-answer-btns").classList.remove("hidden");
  $("r-btn-bonne").onclick = () => enregistreReplique(id, nom, "replique_bonne");
  $("r-btn-mauvaise").onclick = () => enregistreReplique(id, nom, "replique_mauvaise");
}

async function enregistreReplique(jId, nom, action) {
  if (repliqueResolved) return;
  repliqueResolved = true;
  clearInterval(repliqueTimer);
  $("replique-answer-btns").classList.add("hidden");
  const cat = getActiveCat(matchData, CATEGORIES);
  try {
    await pushEvent({ joueur_id: jId, joueur_nom: nom, equipe: repliqueEquipe, action, categorie: cat?.id || "" });
    const isGood = action === "replique_bonne";
    showRepliqueResult(isGood, nom);
    addLog("replique", `${nom} (Eq.${repliqueEquipe}) - ${isGood ? "Replique reussie" : "Replique manquee"}`);
    setTimeout(() => { closeReplique(); lockButtons(false); }, 2500);
  } catch (err) {
    toast(err.message, "error");
  }
}

function showRepliqueResult(isGood, nom) {
  const el = $("replique-result");
  el.className = `replique-result ${isGood ? "bonne" : "mauvaise"}`;
  el.textContent = isGood ? `${nom.trim()} - Replique reussie !` : `${nom.trim()} - Replique manquee.`;
  el.classList.remove("hidden");
}

function closeReplique() {
  clearInterval(repliqueTimer);
  closeOverlay("replique-overlay");
  repliqueActive = false;
  lockButtons(false);
}

$("btn-no-replique").addEventListener("click", () => {
  closeReplique();
  toast("Replique ignoree.", "info");
});

function addLog(type, text) {
  const log = $("jury-log");
  log.querySelector("p.text-muted")?.remove();
  const item = document.createElement("div");
  item.className = `jury-log-item ${type}`;
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = '<span class="jli-text"></span><span class="jli-time"></span>';
  item.querySelector(".jli-text").textContent = text;
  item.querySelector(".jli-time").textContent = time;
  log.prepend(item);
}

function startChrono(startDate) {
  clearInterval(chronoInt);
  chronoInt = setInterval(() => {
    if (matchData?.statut !== "en_cours") return;
    $("jury-clock").textContent = formatTime(Math.floor((Date.now() - startDate.getTime()) / 1000));
  }, 1000);
}

function setupAdminControls() {
  $("btn-next-cat").addEventListener("click", async () => {
    const total = (matchData?.categoriesOrdre || []).length;
    const next = (matchData?.categorieActuelle ?? 0) + 1;
    if (next >= total) {
      toast("Derniere categorie.", "info");
      return;
    }
    await supabase.from(T.MATCHES).update({ categorie_actuelle: next, updated_at: nowISO() }).eq("id", matchId);
  });
  $("btn-prev-cat").addEventListener("click", async () => {
    const prev = (matchData?.categorieActuelle ?? 0) - 1;
    if (prev < 0) return;
    await supabase.from(T.MATCHES).update({ categorie_actuelle: prev, updated_at: nowISO() }).eq("id", matchId);
  });
  $("btn-pause").addEventListener("click", async () => {
    const statut = matchData?.statut === "pause" ? "en_cours" : "pause";
    await supabase.from(T.MATCHES).update({ statut, updated_at: nowISO() }).eq("id", matchId);
    toast(statut === "pause" ? "Match en pause." : "Match repris.", "info");
  });
  $("btn-end-match").addEventListener("click", async () => {
    if (!confirm("Terminer ce match definitivement ?")) return;
    const { error } = await supabase.rpc("finalize_match_stats", { p_match_id: matchId });
    if (error) {
      toast("Erreur validation finale : " + error.message, "error");
      return;
    }
    toast("Match termine et statistiques figees.", "success");
  });
}

$("btn-undo").addEventListener("click", () => {
  if (!isSuperAdmin()) {
    toast("Reserve au superadmin.", "error");
    return;
  }
  toast("Pour annuler une action, utilisez le panneau admin.", "info");
});
