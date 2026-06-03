// ================================================================
//  PASTO GENIE - Public scoreboard Supabase
// ================================================================
import { supabase, T, CATEGORIES } from "./supabase-config.js";
import { formatTime, pulsify, renderCatTrack } from "./utils.js";

const $ = id => document.getElementById(id);
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

let channels = [];
let chronoInterval = null;
let publicPlayersById = new Map();

function showMain() {
  $("loading-screen").classList.add("hidden");
  $("main-content").classList.remove("hidden");
  $("empty-state").classList.add("hidden");
}

function showEmpty() {
  $("loading-screen").classList.add("hidden");
  $("empty-state").classList.remove("hidden");
  $("main-content").classList.add("hidden");
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
  try {
    const { data, error } = await supabase.from(T.MATCHES).select("*").order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    const sel = $("match-selector");
    while (sel.options.length > 1) sel.remove(1);
    let autoMatch = null;
    (data || []).forEach(row => {
      const m = normalizeMatch(row);
      sel.appendChild(new Option(`${m.equipeA?.nom || "A"} vs ${m.equipeB?.nom || "B"} - ${m.statut}`, m.id));
      if (m.statut === "en_cours" && !autoMatch) autoMatch = m.id;
    });
    if (autoMatch) {
      sel.value = autoMatch;
      subscribeMatch(autoMatch);
    } else {
      showEmpty();
    }
  } catch (err) {
    console.error(err);
    showEmpty();
  }
}

async function subscribeMatch(matchId) {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels = [];
  clearInterval(chronoInterval);
  const grid = $("pub-players-grid");
  if (grid) delete grid.dataset.built;
  $("pub-feed").innerHTML = '<p class="text-muted text-xs text-center" style="padding:var(--space-4);">Chargement...</p>';

  const { data: match, error: matchError } = await supabase.from(T.MATCHES).select("*").eq("id", matchId).single();
  if (!matchError) renderMatchInfo(normalizeMatch(match));

  const { data: score, error: scoreError } = await supabase.from(T.MATCH_EN_COURS).select("*").eq("id", matchId).maybeSingle();
  if (!scoreError && score) {
    const normalized = normalizeScore(score);
    renderScores(normalized);
    renderPlayerScores(normalized);
    renderCatScores(normalized);
  }

  const { data: events } = await supabase
    .from(T.EVENEMENTS)
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(50);
  (events || []).reverse().forEach(prependEvent);

  const matchChannel = supabase
    .channel(`public-match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: T.MATCHES, filter: `id=eq.${matchId}` }, payload => renderMatchInfo(normalizeMatch(payload.new)))
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
  showMain();
}

async function loadPublicRankings() {
  await Promise.all([loadPublicTeamRanking(), loadPublicPlayerRanking()]);
}

async function loadPublicTeamRanking() {
  const wrap = $("public-team-ranking");
  if (!wrap) return;
  wrap.innerHTML = '<p class="text-muted text-center">Chargement...</p>';
  try {
    const { data, error } = await supabase
      .from(T.CLASSEMENT_EQUIPES)
      .select("*")
      .order("points_classement", { ascending: false })
      .order("points_marques", { ascending: false })
      .limit(10);
    if (error) throw error;
    wrap.innerHTML = "";
    if (!data?.length) {
      wrap.innerHTML = '<p class="text-muted text-center">Aucun classement pour le moment.</p>';
      return;
    }
    data.forEach((team, index) => {
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
      wrap.appendChild(row);
    });
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
    const { data, error } = await supabase
      .from(T.CLASSEMENT_JOUEURS)
      .select("*")
      .order("points", { ascending: false })
      .order("bonnes", { ascending: false })
      .limit(10);
    if (error) throw error;
    wrap.innerHTML = "";
    publicPlayersById = new Map();
    if (!data?.length) {
      wrap.innerHTML = '<p class="text-muted text-center">Aucun classement pour le moment.</p>';
      return;
    }
    data.forEach((player, index) => {
      if (player.joueur_id) publicPlayersById.set(player.joueur_id, player);
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
      wrap.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="text-muted text-center">Classement joueurs indisponible.</p>';
  }
}

function renderMatchInfo(m) {
  $("pub-match-title").textContent = `${m.equipeA?.nom || "A"} - ${m.equipeB?.nom || "B"}`;
  $("pub-tournoi-label").textContent = m.tournamentName || "Tournoi PASTO GENIE";
  $("pub-name-a").textContent = m.equipeA?.nom || "Equipe A";
  $("pub-name-b").textContent = m.equipeB?.nom || "Equipe B";
  $("pub-parish-a").textContent = m.equipeA?.paroisse || "";
  $("pub-parish-b").textContent = m.equipeB?.paroisse || "";
  renderTeamCrest($("pub-crest-a"), m.equipeA, "A");
  renderTeamCrest($("pub-crest-b"), m.equipeB, "B");

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
    badge.textContent = m.statut;
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
    el.innerHTML = `<div class="cat-score-icon"><i class="${cat.icon}"></i></div><div class="cat-score-name"></div><div class="cat-score-vs"><span>${s.A}</span> - <span>${s.B}</span></div>`;
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
    title.style.color = idx === 0 ? "#6ab0f5" : "var(--red)";
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
  $("profile-note").textContent = "Classement all time base sur les matchs valides.";
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

  $("pub-last-action").innerHTML = `<div class="flex items-center justify-center gap-3"><i class="${m.icon}" style="font-size:1.3rem;color:${m.cls === "bonne" ? "var(--green)" : m.cls === "mauvaise" ? "var(--red)" : "var(--gold)"}"></i><div class="text-left"><div class="font-bold text-sm last-name"></div><div class="text-xs text-muted last-meta"></div></div></div>`;
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

$("match-selector").addEventListener("change", e => {
  if (e.target.value) subscribeMatch(e.target.value);
});

$("close-player-profile")?.addEventListener("click", () => $("player-profile-overlay")?.classList.add("hidden"));
$("player-profile-overlay")?.addEventListener("click", e => {
  if (e.target.id === "player-profile-overlay") e.currentTarget.classList.add("hidden");
});

$("refresh-public-rankings")?.addEventListener("click", loadPublicRankings);

loadMatchList();
loadPublicRankings();
setInterval(loadMatchList, 30000);
setInterval(loadPublicRankings, 60000);
