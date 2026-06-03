// ================================================================
//  PASTO GENIE - Public tournament hub + live scoreboard
// ================================================================
import { supabase, T, CATEGORIES, BAREME_DEFAULT } from "./supabase-config.js";
import { formatTime, pulsify, renderCatTrack } from "./utils.js";

const $ = id => document.getElementById(id);
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const MS_DAY = 24 * 60 * 60 * 1000;

let channels = [];
let chronoInterval = null;
let countdownInterval = null;
let publicPlayersById = new Map();
let activeTournament = null;
let homeMatches = [];
let teamsById = new Map();
let playersById = new Map();
let allTeamStats = [];
let allPlayerStats = [];

function showMain() {
  $("loading-screen")?.classList.add("hidden");
  $("main-content")?.classList.remove("hidden");
  $("empty-state")?.classList.add("hidden");
}

function showEmpty() {
  $("loading-screen")?.classList.add("hidden");
  $("empty-state")?.classList.add("hidden");
  $("main-content")?.classList.add("hidden");
}

function hideLoadingOnly() {
  $("loading-screen")?.classList.add("hidden");
}

function normalizeMatch(row) {
  if (!row) return row;
  return {
    ...row,
    equipeA: row.equipe_a,
    equipeB: row.equipe_b,
    categoriesOrdre: row.categories_ordre,
    categorieActuelle: row.categorie_actuelle,
    tournamentName: row.tournament_name,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
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

function matchDate(m) {
  return m?.scheduledAt || m?.startedAt || m?.createdAt || new Date();
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatDateTime(date) {
  if (!date) return "Date a definir";
  return date.toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countdownText(date, status) {
  if (status === "en_cours") return "En direct maintenant";
  if (status === "termine") return "Match termine";
  if (!date) return "Horaire a definir";
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "Demarrage attendu";
  const days = Math.floor(diff / MS_DAY);
  const hours = Math.floor((diff % MS_DAY) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (days > 0) return `${days}j ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function statusLabel(status) {
  const labels = {
    planifie: "Planifie",
    en_cours: "En direct",
    pause: "Pause",
    termine: "Termine",
  };
  return labels[status] || status || "A definir";
}

function teamName(match, side) {
  return match?.[side]?.nom || (side === "equipeA" ? "Equipe A" : "Equipe B");
}

function teamRefFromMatch(match, side) {
  const id = side === "A" ? match.equipe_a_id : match.equipe_b_id;
  return teamsById.get(id) || (side === "A" ? match.equipeA : match.equipeB) || {};
}

async function fetchRows(table, builder = q => q) {
  const query = builder(supabase.from(table).select("*"));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadActiveTournament() {
  try {
    const rows = await fetchRows(T.TOURNOIS, q => q.order("actif", { ascending: false }).order("created_at", { ascending: false }).limit(1));
    activeTournament = rows[0] || null;
  } catch (err) {
    console.error(err);
    activeTournament = null;
  }
}

async function loadPublicHome() {
  try {
    await loadActiveTournament();
    const [matches, equipes, joueurs, teamStats, playerStats] = await Promise.all([
      fetchRows(T.MATCHES, q => q.order("scheduled_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(120)),
      fetchRows(T.EQUIPES, q => q.order("nom", { ascending: true })),
      fetchRows(T.JOUEURS, q => q.order("nom", { ascending: true })),
      fetchRows(T.STATS_EQUIPES, q => q.order("played_at", { ascending: false }).limit(2000)).catch(() => []),
      fetchRows(T.STATS_JOUEURS, q => q.order("played_at", { ascending: false }).limit(3000)).catch(() => []),
    ]);
    teamsById = new Map(equipes.map(eq => [eq.id, eq]));
    playersById = new Map(joueurs.map(j => [j.id, j]));
    allTeamStats = teamStats;
    allPlayerStats = playerStats;
    homeMatches = (matches || []).map(normalizeMatch);
    if (activeTournament) {
      const tournamentMatches = homeMatches.filter(m => m.tournoi_id === activeTournament.id);
      if (tournamentMatches.length) homeMatches = tournamentMatches;
    }
    renderTodayMatches();
    renderCalendar();
    renderPoolStandings();
    renderTournamentPlayerRanking();
    await loadPublicRankings();
    hideLoadingOnly();
  } catch (err) {
    console.error(err);
    hideLoadingOnly();
    renderEmptyBlock("today-matches", "Impossible de charger les donnees publiques.");
  }
}

function renderEmptyBlock(id, message) {
  const wrap = $(id);
  if (wrap) wrap.innerHTML = `<div class="neo-card placeholder-card">${message}</div>`;
}

function renderTodayMatches() {
  const wrap = $("today-matches");
  if (!wrap) return;
  const today = new Date();
  let matches = homeMatches.filter(m => m.statut === "en_cours" || sameLocalDay(matchDate(m), today));
  if (!matches.length) {
    matches = homeMatches
      .filter(m => m.statut !== "termine")
      .sort((a, b) => matchDate(a) - matchDate(b))
      .slice(0, 2);
  }
  wrap.innerHTML = "";
  if (!matches.length) {
    renderEmptyBlock("today-matches", "Aucun match programme pour le moment.");
    return;
  }
  matches.forEach(match => {
    const date = matchDate(match);
    const card = document.createElement("article");
    card.className = "today-match-card neo-card";
    card.innerHTML = `
      <div class="today-card-top">
        <span class="status-pill ${match.statut === "en_cours" ? "is-live" : ""}">${statusLabel(match.statut)}</span>
        <span class="today-date">${formatDateTime(date)}</span>
      </div>
      <div class="today-teams">
        <div class="mini-team" data-side="A"><div class="mini-crest"></div><strong></strong></div>
        <div class="versus-3d">VS</div>
        <div class="mini-team" data-side="B"><div class="mini-crest"></div><strong></strong></div>
      </div>
      <div class="countdown-box">
        <span>Compte a rebours</span>
        <strong data-countdown="${match.id}">${countdownText(date, match.statut)}</strong>
      </div>
      <button class="btn btn-gold watch-match-btn" data-watch-match="${match.id}">
        <i class="ri-live-line"></i> Regarder
      </button>`;
    const teamA = teamRefFromMatch(match, "A");
    const teamB = teamRefFromMatch(match, "B");
    const a = card.querySelector('[data-side="A"]');
    const b = card.querySelector('[data-side="B"]');
    a.querySelector("strong").textContent = teamName(match, "equipeA");
    b.querySelector("strong").textContent = teamName(match, "equipeB");
    renderMiniCrest(a.querySelector(".mini-crest"), teamA, "A");
    renderMiniCrest(b.querySelector(".mini-crest"), teamB, "B");
    wrap.appendChild(card);
  });
}

function renderMiniCrest(el, team, fallback) {
  if (!el) return;
  el.style.backgroundImage = "";
  el.style.borderColor = team?.couleur_primaire || "rgba(255,255,255,0.8)";
  if (team?.embleme_url) {
    el.style.backgroundImage = `url("${team.embleme_url}")`;
    el.textContent = "";
  } else {
    el.textContent = (team?.nom || fallback || "?")[0].toUpperCase();
  }
}

function updateCountdowns() {
  homeMatches.forEach(match => {
    const el = document.querySelector(`[data-countdown="${match.id}"]`);
    if (el) el.textContent = countdownText(matchDate(match), match.statut);
  });
}

function renderCalendar() {
  const wrap = $("public-calendar-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  const rows = [...homeMatches].sort((a, b) => matchDate(a) - matchDate(b)).slice(0, 30);
  if (!rows.length) {
    renderEmptyBlock("public-calendar-list", "Aucun match dans le calendrier.");
    return;
  }
  rows.forEach(match => {
    const row = document.createElement("article");
    row.className = "calendar-match neo-card";
    row.innerHTML = `
      <div class="calendar-date">
        <strong>${formatDateTime(matchDate(match))}</strong>
        <span>${activeTournament?.nom || match.tournamentName || "Tournoi"}</span>
      </div>
      <div class="calendar-teams">
        <strong>${teamName(match, "equipeA")}</strong>
        <span>contre</span>
        <strong>${teamName(match, "equipeB")}</strong>
      </div>
      <span class="status-pill ${match.statut === "en_cours" ? "is-live" : ""}">${statusLabel(match.statut)}</span>
      <button class="btn btn-outline btn-sm watch-match-btn" data-watch-match="${match.id}">
        <i class="ri-eye-line"></i> Regarder
      </button>`;
    wrap.appendChild(row);
  });
}

function aggregateTeamStats(stats) {
  const map = new Map();
  stats.forEach(row => {
    if (!row.equipe_id) return;
    const team = teamsById.get(row.equipe_id) || {};
    const item = map.get(row.equipe_id) || {
      equipe_id: row.equipe_id,
      nom: team.nom || "Equipe",
      paroisse: team.paroisse || "",
      embleme_url: team.embleme_url || "",
      couleur_primaire: team.couleur_primaire || "#38bdf8",
      poule: team.poule || "Poule unique",
      matchs: 0,
      victoires: 0,
      nuls: 0,
      defaites: 0,
      points_marques: 0,
      points_encaisses: 0,
      points_classement: 0,
    };
    item.matchs += 1;
    item.victoires += row.gagne ? 1 : 0;
    item.nuls += row.nul ? 1 : 0;
    item.defaites += row.perdu ? 1 : 0;
    item.points_marques += row.score || 0;
    item.points_encaisses += row.score_adverse || 0;
    item.points_classement += row.gagne ? 3 : row.nul ? 1 : 0;
    map.set(row.equipe_id, item);
  });
  return [...map.values()].sort(sortTeams);
}

function sortTeams(a, b) {
  return (b.points_classement || 0) - (a.points_classement || 0)
    || (b.points_marques || 0) - (a.points_marques || 0)
    || ((a.nom || "").localeCompare(b.nom || ""));
}

function renderPoolStandings() {
  const wrap = $("pool-standings");
  if (!wrap) return;
  const stats = activeTournament
    ? allTeamStats.filter(s => s.tournoi_id === activeTournament.id)
    : allTeamStats;
  let rows = aggregateTeamStats(stats);
  if (!rows.length) {
    rows = [...teamsById.values()].map(team => ({
      equipe_id: team.id,
      nom: team.nom,
      paroisse: team.paroisse,
      embleme_url: team.embleme_url,
      couleur_primaire: team.couleur_primaire,
      poule: team.poule || "Poule unique",
      matchs: 0,
      victoires: 0,
      nuls: 0,
      defaites: 0,
      points_marques: 0,
      points_classement: 0,
    }));
  }
  const grouped = rows.reduce((acc, row) => {
    const key = row.poule || "Poule unique";
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());
  wrap.innerHTML = "";
  if (!grouped.size) {
    renderEmptyBlock("pool-standings", "Aucune equipe enregistree.");
    return;
  }
  grouped.forEach((teams, poule) => {
    const card = document.createElement("div");
    card.className = "glass glass-md pool-card neo-panel";
    card.innerHTML = `<div class="pool-title">${poule}</div><div class="public-ranking-list"></div>`;
    const list = card.querySelector(".public-ranking-list");
    teams.sort(sortTeams).forEach((team, index) => list.appendChild(createTeamRankingRow(team, index)));
    wrap.appendChild(card);
  });
}

function aggregatePlayerStats(stats) {
  const map = new Map();
  stats.forEach(row => {
    if (!row.joueur_id) return;
    const player = playersById.get(row.joueur_id) || {};
    const team = teamsById.get(row.equipe_id) || {};
    const item = map.get(row.joueur_id) || {
      joueur_id: row.joueur_id,
      prenom: player.prenom || "",
      nom: player.nom || "Joueur",
      photo_url: player.photo_url || "",
      equipe_nom: team.nom || "Equipe",
      equipe_id: row.equipe_id,
      matchs: 0,
      points: 0,
      bonnes: 0,
      mauvaises: 0,
      repliques_bonnes: 0,
      repliques_mauvaises: 0,
    };
    item.matchs += 1;
    item.points += row.points || 0;
    item.bonnes += row.bonnes || 0;
    item.mauvaises += row.mauvaises || 0;
    item.repliques_bonnes += row.repliques_bonnes || 0;
    item.repliques_mauvaises += row.repliques_mauvaises || 0;
    map.set(row.joueur_id, item);
  });
  return [...map.values()].sort(sortPlayers);
}

function sortPlayers(a, b) {
  return (b.points || 0) - (a.points || 0)
    || (b.bonnes || 0) - (a.bonnes || 0)
    || (`${a.prenom || ""} ${a.nom || ""}`).localeCompare(`${b.prenom || ""} ${b.nom || ""}`);
}

function renderTournamentPlayerRanking() {
  const wrap = $("tournament-player-ranking");
  if (!wrap) return;
  const stats = activeTournament
    ? allPlayerStats.filter(s => s.tournoi_id === activeTournament.id)
    : allPlayerStats;
  const players = aggregatePlayerStats(stats).slice(0, 20);
  wrap.innerHTML = "";
  if (!players.length) {
    wrap.innerHTML = '<p class="text-muted text-center">Aucune statistique individuelle pour le tournoi actif.</p>';
    return;
  }
  publicPlayersById = new Map(players.map(p => [p.joueur_id, p]));
  players.forEach((player, index) => wrap.appendChild(createPlayerRankingRow(player, index)));
}

async function loadMatchList() {
  try {
    const { data, error } = await supabase.from(T.MATCHES).select("*").order("scheduled_at", { ascending: true, nullsFirst: false }).limit(50);
    if (error) throw error;
    const sel = $("match-selector");
    while (sel.options.length > 1) sel.remove(1);
    let autoMatch = null;
    (data || []).map(normalizeMatch).forEach(m => {
      sel.appendChild(new Option(`${teamName(m, "equipeA")} vs ${teamName(m, "equipeB")} - ${statusLabel(m.statut)}`, m.id));
      if (m.statut === "en_cours" && !autoMatch) autoMatch = m.id;
    });
    if (autoMatch) {
      sel.value = autoMatch;
      subscribeMatch(autoMatch, false);
    } else {
      showEmpty();
    }
  } catch (err) {
    console.error(err);
    showEmpty();
  }
}

async function subscribeMatch(matchId, scrollIntoView = true) {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels = [];
  clearInterval(chronoInterval);
  const grid = $("pub-players-grid");
  if (grid) delete grid.dataset.built;
  $("pub-feed").innerHTML = '<p class="text-muted text-xs text-center" style="padding:var(--space-4);">Chargement...</p>';

  const { data: match, error: matchError } = await supabase.from(T.MATCHES).select("*").eq("id", matchId).single();
  if (!matchError && match) renderMatchInfo(normalizeMatch(match));

  const { data: score, error: scoreError } = await supabase.from(T.MATCH_EN_COURS).select("*").eq("id", matchId).maybeSingle();
  if (!scoreError && score) {
    const normalized = normalizeScore(score);
    renderScores(normalized);
    renderPlayerScores(normalized);
    renderCatScores(normalized);
  } else {
    renderScores({ scoreA: 0, scoreB: 0 });
    renderCatScores({ scoreParCategorie: {} });
  }

  const { data: events } = await supabase
    .from(T.EVENEMENTS)
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(50);
  $("pub-feed").innerHTML = "";
  (events || []).reverse().forEach(prependEvent);
  if (!events?.length) {
    $("pub-feed").innerHTML = '<p class="text-muted text-xs text-center" style="padding:var(--space-4);">Les actions apparaitront ici...</p>';
  }

  const matchChannel = supabase
    .channel(`public-match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: T.MATCHES, filter: `id=eq.${matchId}` }, payload => {
      renderMatchInfo(normalizeMatch(payload.new));
      loadPublicHome();
    })
    .subscribe();
  const scoreChannel = supabase
    .channel(`public-score-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: T.MATCH_EN_COURS, filter: `id=eq.${matchId}` }, payload => {
      const data = normalizeScore(payload.new);
      renderScores(data);
      renderPlayerScores(data);
      renderCatScores(data);
    })
    .subscribe();
  const eventChannel = supabase
    .channel(`public-events-${matchId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: T.EVENEMENTS, filter: `match_id=eq.${matchId}` }, payload => prependEvent(payload.new))
    .subscribe();
  channels.push(matchChannel, scoreChannel, eventChannel);
  $("match-selector").value = matchId;
  showMain();
  if (scrollIntoView) $("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadPublicRankings() {
  await Promise.all([loadPublicTeamRanking(), loadPublicPlayerRanking()]);
}

function filterByDates(rows, dateKey = "played_at") {
  const from = $("alltime-from")?.value;
  const to = $("alltime-to")?.value;
  return rows.filter(row => {
    const raw = row[dateKey] || row.created_at;
    if (!raw) return true;
    const ts = new Date(raw).getTime();
    if (from && ts < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && ts > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  });
}

async function loadPublicTeamRanking() {
  const wrap = $("public-team-ranking");
  if (!wrap) return;
  wrap.innerHTML = '<p class="text-muted text-center">Chargement...</p>';
  try {
    const rows = aggregateTeamStats(filterByDates(allTeamStats)).slice(0, 12);
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.innerHTML = '<p class="text-muted text-center">Aucun classement equipe pour le moment.</p>';
      return;
    }
    rows.forEach((team, index) => wrap.appendChild(createTeamRankingRow(team, index)));
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="text-muted text-center">Classement equipes indisponible.</p>';
  }
}

async function loadPublicPlayerRanking() {
  const wrap = $("public-player-ranking");
  if (!wrap) return;
  wrap.innerHTML = '<p class="text-muted text-center">Chargement...</p>';
  try {
    const category = $("alltime-category")?.value || "all";
    const rows = category === "all"
      ? aggregatePlayerStats(filterByDates(allPlayerStats)).slice(0, 12)
      : (await loadCategoryPlayerRanking(category)).slice(0, 12);
    wrap.innerHTML = "";
    publicPlayersById = new Map();
    if (!rows.length) {
      wrap.innerHTML = '<p class="text-muted text-center">Aucun classement joueur pour le moment.</p>';
      return;
    }
    rows.forEach((player, index) => {
      if (player.joueur_id) publicPlayersById.set(player.joueur_id, player);
      wrap.appendChild(createPlayerRankingRow(player, index));
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="text-muted text-center">Classement joueurs indisponible.</p>';
  }
}

async function loadCategoryPlayerRanking(category) {
  let query = supabase.from(T.EVENEMENTS).select("*").eq("categorie", category).limit(3000);
  const from = $("alltime-from")?.value;
  const to = $("alltime-to")?.value;
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  const { data, error } = await query;
  if (error) throw error;
  const bareme = await loadBareme();
  const rule = bareme[category] || BAREME_DEFAULT[category] || {};
  const map = new Map();
  (data || []).forEach(ev => {
    const player = playersById.get(ev.joueur_id) || {};
    const item = map.get(ev.joueur_id) || {
      joueur_id: ev.joueur_id,
      prenom: player.prenom || "",
      nom: player.nom || ev.joueur_nom || "Joueur",
      photo_url: player.photo_url || "",
      equipe_nom: ev.equipe ? `Equipe ${ev.equipe}` : "Equipe",
      matchs: 0,
      points: 0,
      bonnes: 0,
      mauvaises: 0,
      repliques_bonnes: 0,
      repliques_mauvaises: 0,
    };
    if (ev.action === "bonne_reponse") {
      item.bonnes += 1;
      item.points += rule.bonne || 0;
    } else if (ev.action === "mauvaise_reponse") {
      item.mauvaises += 1;
      item.points += rule.mauvaise || 0;
    } else if (ev.action === "replique_bonne") {
      item.repliques_bonnes += 1;
      item.points += rule.replique || 0;
    } else if (ev.action === "replique_mauvaise") {
      item.repliques_mauvaises += 1;
      item.points -= rule.replique_penalite || 0;
    }
    map.set(ev.joueur_id, item);
  });
  return [...map.values()].sort(sortPlayers);
}

async function loadBareme() {
  try {
    const { data, error } = await supabase.from(T.CONFIG_POINTS).select("bareme").limit(1).maybeSingle();
    if (error) throw error;
    return data?.bareme || BAREME_DEFAULT;
  } catch {
    return BAREME_DEFAULT;
  }
}

function createTeamRankingRow(team, index) {
  const row = document.createElement("div");
  row.className = "public-ranking-row";
  row.innerHTML = `
    <div class="public-ranking-pos">${index + 1}</div>
    <div class="public-ranking-avatar"></div>
    <div class="public-ranking-main">
      <div class="public-ranking-name"></div>
      <div class="public-ranking-meta">${team.matchs || 0} match(s) - ${team.victoires || 0}V ${team.nuls || 0}N ${team.defaites || 0}D</div>
    </div>
    <div class="public-ranking-score">${team.points_classement || 0}</div>`;
  const avatar = row.querySelector(".public-ranking-avatar");
  if (team.embleme_url) {
    avatar.style.backgroundImage = `url("${team.embleme_url}")`;
    avatar.textContent = "";
  } else {
    avatar.textContent = (team.nom || "?")[0].toUpperCase();
  }
  row.querySelector(".public-ranking-name").textContent = team.nom || "Equipe";
  return row;
}

function createPlayerRankingRow(player, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "public-ranking-row public-ranking-button";
  row.innerHTML = `
    <div class="public-ranking-pos">${index + 1}</div>
    <div class="public-ranking-avatar"></div>
    <div class="public-ranking-main">
      <div class="public-ranking-name"></div>
      <div class="public-ranking-meta">${player.equipe_nom || "Equipe"} - ${player.matchs || 0} match(s) - ${player.bonnes || 0} bonnes</div>
    </div>
    <div class="public-ranking-score">${player.points || 0}</div>`;
  const avatar = row.querySelector(".public-ranking-avatar");
  if (player.photo_url) {
    avatar.style.backgroundImage = `url("${player.photo_url}")`;
    avatar.textContent = "";
  } else {
    avatar.textContent = (player.prenom || player.nom || "?")[0].toUpperCase();
  }
  row.querySelector(".public-ranking-name").textContent = `${player.prenom || ""} ${player.nom || ""}`.trim() || "Joueur";
  row.addEventListener("click", () => openPlayerProfileFromRanking(player));
  return row;
}

function renderMatchInfo(m) {
  $("pub-match-title").textContent = `${teamName(m, "equipeA")} - ${teamName(m, "equipeB")}`;
  $("pub-tournoi-label").textContent = m.tournamentName || activeTournament?.nom || "Tournoi PASTO GENIE";
  $("pub-name-a").textContent = teamName(m, "equipeA");
  $("pub-name-b").textContent = teamName(m, "equipeB");
  const teamA = teamRefFromMatch(m, "A");
  const teamB = teamRefFromMatch(m, "B");
  $("pub-parish-a").textContent = teamA?.paroisse || m.equipeA?.paroisse || "";
  $("pub-parish-b").textContent = teamB?.paroisse || m.equipeB?.paroisse || "";
  renderTeamCrest($("pub-crest-a"), teamA, "A");
  renderTeamCrest($("pub-crest-b"), teamB, "B");

  const badge = $("pub-status-badge");
  if (m.statut === "en_cours") {
    badge.className = "badge badge-live";
    badge.innerHTML = '<span class="live-dot"></span> En Direct';
    $("live-badge").classList.remove("hidden");
    startChrono(m.startedAt);
  } else if (m.statut === "termine") {
    badge.className = "badge badge-green";
    badge.innerHTML = '<i class="ri-check-line"></i> Termine';
    $("live-badge").classList.add("hidden");
    clearInterval(chronoInterval);
  } else {
    badge.className = "badge badge-gold";
    badge.textContent = statusLabel(m.statut);
    $("live-badge").classList.add("hidden");
  }

  renderCatTrack("pub-cat-track", m.categoriesOrdre || [], m.categorieActuelle ?? 0, CATEGORIES);
  const total = (m.categoriesOrdre || []).length;
  const cur = m.categorieActuelle ?? 0;
  $("pub-progress").style.width = total ? `${Math.round((cur / total) * 100)}%` : "0%";
  const catMeta = CAT[(m.categoriesOrdre || [])[cur]];
  if (catMeta) {
    $("pub-cat-active").innerHTML = `<i class="${catMeta.icon}"></i> ${catMeta.label}`;
    $("pub-chrono-cat").textContent = catMeta.label;
  }
  renderPlayers(m.equipeA, m.equipeB);
}

function renderTeamCrest(el, equipe, fallback) {
  if (!el) return;
  el.style.backgroundImage = "";
  el.style.borderColor = equipe?.couleur_primaire || "";
  if (equipe?.embleme_url) {
    el.textContent = "";
    el.style.backgroundImage = `url("${equipe.embleme_url}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  } else {
    el.textContent = (equipe?.nom || fallback)[0].toUpperCase();
  }
}

function renderScores(data) {
  const sa = $("pub-score-a");
  const sb = $("pub-score-b");
  const prevA = parseInt(sa.textContent, 10) || 0;
  const prevB = parseInt(sb.textContent, 10) || 0;
  sa.textContent = data.scoreA ?? 0;
  sb.textContent = data.scoreB ?? 0;
  if ((data.scoreA ?? 0) !== prevA) pulsify(sa);
  if ((data.scoreB ?? 0) !== prevB) pulsify(sb);
}

function renderPlayerScores(data) {
  if (!data.pointsJoueurs) return;
  Object.entries(data.pointsJoueurs).forEach(([jId, pts]) => {
    const el = document.getElementById(`pub-pts-${jId}`);
    if (el) el.textContent = pts;
  });
}

function renderCatScores(data) {
  const grid = $("pub-cat-scores");
  if (!grid) return;
  const scores = data.scoreParCategorie || {};
  grid.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const s = scores[cat.id] || { A: 0, B: 0 };
    const el = document.createElement("div");
    el.className = "cat-score-cell";
    el.innerHTML = `<div class="cat-score-icon"><i class="${cat.icon}"></i></div><div class="cat-score-name"></div><div class="cat-score-vs"><span>${s.A || 0}</span> - <span>${s.B || 0}</span></div>`;
    el.querySelector(".cat-score-name").textContent = cat.label;
    grid.appendChild(el);
  });
}

function renderPlayers(eA, eB) {
  const grid = $("pub-players-grid");
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = "1";
  grid.innerHTML = "";
  [eA, eB].forEach((equipe, idx) => {
    if (!equipe) return;
    const col = document.createElement("div");
    const title = document.createElement("div");
    title.className = "players-team-title";
    title.style.color = idx === 0 ? "#0369a1" : "var(--red)";
    title.textContent = equipe.nom || `Equipe ${idx === 0 ? "A" : "B"}`;
    col.appendChild(title);
    const all = [
      ...(equipe.titulaires || []).map(p => ({ ...p, type: "titulaire" })),
      ...(equipe.remplacants || []).map(p => ({ ...p, type: "remplacant" })),
    ];
    all.forEach(p => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "player-row";
      row.innerHTML = '<div class="avatar"></div><div class="player-row-name"></div><div class="player-row-pts">0</div>';
      const avatar = row.querySelector(".avatar");
      if (p.photo_url) {
        avatar.style.backgroundImage = `url("${p.photo_url}")`;
        avatar.textContent = "";
      } else {
        avatar.textContent = (p.prenom || p.nom || "?")[0].toUpperCase();
      }
      row.querySelector(".player-row-name").textContent = `${p.prenom || ""} ${p.nom || ""} (${p.type === "titulaire" ? "Tit." : "Rem."})`;
      row.querySelector(".player-row-pts").id = `pub-pts-${p.id}`;
      row.addEventListener("click", () => openPlayerProfile(p, equipe));
      col.appendChild(row);
    });
    grid.appendChild(col);
  });
}

async function openPlayerProfile(player, equipe) {
  const overlay = $("player-profile-overlay");
  if (!overlay) return;
  $("profile-name").textContent = `${player.prenom || ""} ${player.nom || ""}`.trim() || "Joueur";
  $("profile-team").textContent = equipe?.nom || "Equipe";
  $("profile-note").textContent = "Historique fige apres validation finale des matchs.";
  const photo = $("profile-photo");
  photo.style.backgroundImage = "";
  if (player.photo_url) {
    photo.style.backgroundImage = `url("${player.photo_url}")`;
    photo.textContent = "";
  } else {
    photo.textContent = (player.prenom || player.nom || "?")[0].toUpperCase();
  }
  ["profile-points", "profile-matches", "profile-good", "profile-replique"].forEach(id => { $(id).textContent = "0"; });
  overlay.classList.remove("hidden");

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player.id || "");
  if (!isUuid) {
    $("profile-note").textContent = "Ce joueur a ete saisi rapidement pour ce match. Creez-le dans Joueurs pour conserver son historique.";
    return;
  }

  try {
    const { data, error } = await supabase.from(T.STATS_JOUEURS).select("*").eq("joueur_id", player.id);
    if (error) throw error;
    const stats = (data || []).reduce((acc, row) => {
      acc.matches += 1;
      acc.points += row.points || 0;
      acc.good += row.bonnes || 0;
      acc.replique += row.repliques_bonnes || 0;
      return acc;
    }, { matches: 0, points: 0, good: 0, replique: 0 });
    $("profile-points").textContent = stats.points;
    $("profile-matches").textContent = stats.matches;
    $("profile-good").textContent = stats.good;
    $("profile-replique").textContent = stats.replique;
  } catch (err) {
    console.error(err);
    $("profile-note").textContent = "Statistiques indisponibles pour le moment.";
  }
}

function openPlayerProfileFromRanking(player) {
  const overlay = $("player-profile-overlay");
  if (!overlay) return;
  $("profile-name").textContent = `${player.prenom || ""} ${player.nom || ""}`.trim() || "Joueur";
  $("profile-team").textContent = player.equipe_nom || "Equipe";
  $("profile-note").textContent = "Classement base sur les historiques figes et les filtres publics.";
  const photo = $("profile-photo");
  photo.style.backgroundImage = "";
  if (player.photo_url) {
    photo.style.backgroundImage = `url("${player.photo_url}")`;
    photo.textContent = "";
  } else {
    photo.textContent = (player.prenom || player.nom || "?")[0].toUpperCase();
  }
  $("profile-points").textContent = player.points || 0;
  $("profile-matches").textContent = player.matchs || 0;
  $("profile-good").textContent = player.bonnes || 0;
  $("profile-replique").textContent = player.repliques_bonnes || 0;
  overlay.classList.remove("hidden");
}

function prependEvent(ev) {
  const feed = $("pub-feed");
  feed.querySelector("p")?.remove();
  const cat = CAT[ev.categorie] || { label: ev.categorie, icon: "ri-question-line" };
  const ts = ev.created_at ? new Date(ev.created_at) : new Date();
  const time = ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const map = {
    bonne_reponse: { icon: "ri-checkbox-circle-fill", cls: "bonne", txt: "Bonne reponse" },
    mauvaise_reponse: { icon: "ri-close-circle-fill", cls: "mauvaise", txt: "Mauvaise reponse" },
    replique_bonne: { icon: "ri-refresh-fill", cls: "replique", txt: "Replique reussie" },
    replique_mauvaise: { icon: "ri-refresh-line", cls: "replique", txt: "Replique manquee" },
  };
  const m = map[ev.action] || { icon: "ri-information-line", cls: "", txt: ev.action };
  const item = document.createElement("div");
  item.className = `event-item ${m.cls}`;
  item.innerHTML = `<i class="${m.icon} event-icon"></i><div class="event-body"><div><strong></strong> - <span class="event-text"></span></div><div class="event-meta"><i class="${cat.icon}"></i> <span class="event-meta-text"></span></div></div><span class="event-time"></span>`;
  item.querySelector("strong").textContent = ev.joueur_nom || ev.joueur_id;
  item.querySelector(".event-text").textContent = m.txt;
  item.querySelector(".event-meta-text").textContent = `${cat.label} - Eq.${ev.equipe}`;
  item.querySelector(".event-time").textContent = time;
  feed.prepend(item);
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);

  $("pub-last-action").innerHTML = `<div class="flex items-center justify-center gap-3"><i class="${m.icon}" style="font-size:1.3rem;color:${m.cls === "bonne" ? "var(--green)" : m.cls === "mauvaise" ? "var(--red)" : "var(--orange)"}"></i><div class="text-left"><div class="font-bold text-sm last-name"></div><div class="text-xs text-muted last-meta"></div></div></div>`;
  $("pub-last-action").querySelector(".last-name").textContent = ev.joueur_nom || ev.joueur_id;
  $("pub-last-action").querySelector(".last-meta").textContent = `${m.txt} - ${cat.label}`;
}

function startChrono(startDate) {
  clearInterval(chronoInterval);
  if (!startDate) return;
  chronoInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startDate.getTime()) / 1000);
    const el = $("pub-chrono");
    if (el) {
      el.textContent = formatTime(elapsed);
      el.classList.toggle("warning", elapsed > 3600);
    }
  }, 1000);
}

function wireEvents() {
  $("match-selector")?.addEventListener("change", e => {
    if (e.target.value) subscribeMatch(e.target.value);
  });
  document.addEventListener("click", e => {
    const watch = e.target.closest("[data-watch-match]");
    if (watch?.dataset.watchMatch) subscribeMatch(watch.dataset.watchMatch);
  });
  $("close-player-profile")?.addEventListener("click", () => $("player-profile-overlay")?.classList.add("hidden"));
  $("player-profile-overlay")?.addEventListener("click", e => {
    if (e.target.id === "player-profile-overlay") e.currentTarget.classList.add("hidden");
  });
  $("refresh-public-home")?.addEventListener("click", () => {
    loadPublicHome();
    loadMatchList();
  });
  $("alltime-apply")?.addEventListener("click", loadPublicRankings);
  const categorySelect = $("alltime-category");
  CATEGORIES.forEach(cat => categorySelect?.appendChild(new Option(cat.label, cat.id)));
}

wireEvents();
loadPublicHome();
loadMatchList();
countdownInterval = setInterval(updateCountdowns, 1000);
setInterval(loadMatchList, 30000);
setInterval(loadPublicHome, 60000);
