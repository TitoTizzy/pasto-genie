import { supabase, T, CATEGORIES, BAREME_DEFAULT } from "./supabase-config.js";

const $ = id => document.getElementById(id);
const page = document.body.dataset.publicPage;
const qs = new URLSearchParams(location.search);
let tournois = [];
let equipes = [];
let joueurs = [];
let teamStats = [];
let playerStats = [];
let tournamentTeams = [];

async function fetchRows(table, builder = q => q) {
  const { data, error } = await builder(supabase.from(table).select("*"));
  if (error) throw error;
  return data || [];
}

function normalizeMatch(row) {
  return {
    ...row,
    equipeA: row.equipe_a,
    equipeB: row.equipe_b,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

function matchDate(m) {
  return m.scheduledAt || m.createdAt || new Date(0);
}

function formatDateTime(date) {
  return date?.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) || "Date a definir";
}

function sanitizeArticleHtml(value = "") {
  const template = document.createElement("template");
  template.innerHTML = value;
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "H2", "H3", "BLOCKQUOTE", "A"]);
  const allowedAttrs = new Set(["href", "target", "rel"]);

  template.content.querySelectorAll("*").forEach(node => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach(attr => {
      if (!allowedAttrs.has(attr.name)) node.removeAttribute(attr.name);
    });
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) node.removeAttribute("href");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  return template.innerHTML;
}

function setFormattedArticleContent(el, html) {
  if (!el) return;
  el.innerHTML = sanitizeArticleHtml(html || "");
}

function statusLabel(status) {
  return ({ planifie: "Planifie", en_cours: "En direct", pause: "Pause", termine: "Termine" })[status] || status || "A definir";
}

function teamName(match, side) {
  return match?.[side]?.nom || (side === "equipeA" ? "Equipe A" : "Equipe B");
}

function teamMap() {
  return new Map(equipes.map(eq => [eq.id, eq]));
}

function playerMap() {
  return new Map(joueurs.map(j => [j.id, j]));
}

function fillTournamentSelect(id) {
  const sel = $(id);
  if (!sel) return;
  tournois.forEach(t => sel.appendChild(new Option(`${t.nom} ${t.annee || ""}`.trim(), t.id)));
}

async function loadBase() {
  [tournois, equipes, joueurs, teamStats, playerStats] = await Promise.all([
    fetchRows(T.TOURNOIS, q => q.order("actif", { ascending: false }).order("created_at", { ascending: false })),
    fetchRows(T.EQUIPES, q => q.order("nom", { ascending: true })).catch(() => []),
    fetchRows(T.JOUEURS, q => q.order("nom", { ascending: true })).catch(() => []),
    fetchRows(T.STATS_EQUIPES, q => q.order("played_at", { ascending: false }).limit(5000)).catch(() => []),
    fetchRows(T.STATS_JOUEURS, q => q.order("played_at", { ascending: false }).limit(5000)).catch(() => []),
  ]);
}

async function initMatchesPage() {
  await loadBase();
  fillTournamentSelect("filter-tournoi");
  $("apply-match-filters")?.addEventListener("click", renderMatchesHistory);
  await renderMatchesHistory();
}

async function renderMatchesHistory() {
  const wrap = $("matches-history-list");
  wrap.innerHTML = '<div class="neo-card placeholder-card">Chargement...</div>';
  const tournoiId = $("filter-tournoi")?.value;
  const exactDate = $("filter-date")?.value;
  const month = $("filter-month")?.value;
  const year = $("filter-year")?.value;
  let matches = await fetchRows(T.MATCHES, q => q.order("scheduled_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500));
  matches = matches.map(normalizeMatch).filter(m => {
    if (tournoiId && m.tournoi_id !== tournoiId) return false;
    const d = matchDate(m);
    if (exactDate && d.toISOString().slice(0, 10) !== exactDate) return false;
    if (month && d.toISOString().slice(0, 7) !== month) return false;
    if (year && String(d.getFullYear()) !== String(year)) return false;
    return true;
  });
  wrap.innerHTML = "";
  if (!matches.length) {
    wrap.innerHTML = '<div class="neo-card placeholder-card">Aucun match trouve.</div>';
    return;
  }
  matches.forEach(m => {
    const row = document.createElement("article");
    row.className = "calendar-match neo-card";
    row.innerHTML = `
      <div class="calendar-date"><strong>${formatDateTime(matchDate(m))}</strong><span>${m.tournament_name || tournois.find(t => t.id === m.tournoi_id)?.nom || "Tournoi"}</span></div>
      <div class="calendar-teams"><strong>${teamName(m, "equipeA")}</strong><span>contre</span><strong>${teamName(m, "equipeB")}</strong></div>
      <span class="status-pill ${m.statut === "en_cours" ? "is-live" : ""}">${statusLabel(m.statut)}</span>
      <a class="btn btn-outline btn-sm" href="index.html?match=${m.id}"><i class="ri-eye-line"></i> Suivre</a>`;
    wrap.appendChild(row);
  });
}

async function initCompetitionPage() {
  await loadBase();
  const id = qs.get("tournoi") || tournois.find(t => t.actif)?.id || tournois[0]?.id;
  const tournoi = tournois.find(t => t.id === id) || tournois[0];
  tournamentTeams = id
    ? await fetchRows(T.TOURNOI_EQUIPES, q => q.eq("tournoi_id", id)).catch(() => [])
    : [];
  renderCompetition(tournoi);
}

function aggregateTeamsForTournament(tournoiId) {
  const teams = teamMap();
  const map = new Map();
  teamStats.filter(s => !tournoiId || s.tournoi_id === tournoiId).forEach(row => {
    const team = teams.get(row.equipe_id) || {};
    const tournamentTeam = tournamentTeams.find(item => item.equipe_id === row.equipe_id) || {};
    const cur = map.get(row.equipe_id) || { nom: team.nom || "Equipe", poule: tournamentTeam.poule || team.poule || "Poule unique", matchs: 0, victoires: 0, nuls: 0, defaites: 0, points_marques: 0, points_classement: 0 };
    cur.matchs += 1;
    cur.victoires += row.gagne ? 1 : 0;
    cur.nuls += row.nul ? 1 : 0;
    cur.defaites += row.perdu ? 1 : 0;
    cur.points_marques += row.score || 0;
    cur.points_classement += row.gagne ? 3 : row.nul ? 1 : 0;
    map.set(row.equipe_id, cur);
  });
  if (!map.size) {
    const baseTeams = tournamentTeams.length
      ? tournamentTeams.map(row => ({ ...teamMap().get(row.equipe_id), poule: row.poule })).filter(team => team.id)
      : equipes;
    baseTeams.forEach(team => map.set(team.id, { nom: team.nom, poule: team.poule || "Poule unique", matchs: 0, victoires: 0, nuls: 0, defaites: 0, points_marques: 0, points_classement: 0 }));
  }
  return [...map.values()].sort((a, b) => (b.points_classement || 0) - (a.points_classement || 0) || (b.points_marques || 0) - (a.points_marques || 0));
}

function renderCompetition(tournoi) {
  const wrap = $("competition-detail");
  if (!tournoi) {
    wrap.innerHTML = '<div class="neo-card placeholder-card">Aucune competition disponible.</div>';
    return;
  }
  const rules = tournoi.regles || tournoi.rules || {};
  const rows = aggregateTeamsForTournament(tournoi.id);
  const grouped = rows.reduce((acc, row) => {
    const key = row.poule || "Poule unique";
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());
  wrap.innerHTML = `
    <section class="competition-summary neo-card">
      <div><span class="section-kicker"><i class="ri-trophy-line"></i> Competition</span><h1>${tournoi.nom}</h1><p>${tournoi.description || "Format et regles de la competition."}</p></div>
      <div class="competition-rule-grid">
        <div><strong>${rules.nombre_equipes ?? equipes.length}</strong><span>Equipes</span></div>
        <div><strong>${rules.nombre_poules ?? grouped.size}</strong><span>Poules</span></div>
        <div><strong>${rules.points_victoire ?? 3}</strong><span>Victoire</span></div>
        <div><strong>${rules.points_nul ?? 1}</strong><span>Nul</span></div>
        <div><strong>${rules.points_defaite ?? 0}</strong><span>Defaite</span></div>
        <div><strong>${rules.matchs_poule_par_equipe ?? "-"}</strong><span>Matchs/equipe</span></div>
        <div><strong>${tournoi.format_type || "Poules"}</strong><span>Format</span></div>
        <div><strong>${tournoi.annee || "-"}</strong><span>Annee</span></div>
      </div>
    </section>
    <section class="pool-standings-grid" id="competition-pools"></section>`;
  const target = $("competition-pools");
  grouped.forEach((teams, poule) => {
    const card = document.createElement("div");
    card.className = "glass glass-md pool-card neo-panel";
    card.innerHTML = `<div class="pool-title">${poule}</div><div class="public-ranking-list"></div>`;
    const list = card.querySelector(".public-ranking-list");
    teams.forEach((team, index) => list.appendChild(teamRow(team, index)));
    target.appendChild(card);
  });
}

async function initHistoriquesPage() {
  await loadBase();
  fillTournamentSelect("rank-tournoi");
  const cat = $("rank-category");
  CATEGORIES.forEach(c => cat?.appendChild(new Option(c.label, c.id)));
  $("apply-rank-filters")?.addEventListener("click", renderHistoricalRankings);
  await renderHistoricalRankings();
}

async function initBlogPage() {
  const wrap = $("blog-articles-list");
  if (!wrap) return;
  wrap.innerHTML = '<article class="blog-preview-item"><span>Chargement</span><strong>Chargement des articles...</strong></article>';
  try {
    const articles = await fetchRows(T.BLOG_ARTICLES, q => q
      .eq("statut", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(60));
    wrap.innerHTML = "";
    if (!articles.length) {
      wrap.innerHTML = '<article class="blog-preview-item"><span>A venir</span><strong>Aucun article publie pour le moment.</strong></article>';
      return;
    }
    articles.forEach(article => {
      const card = document.createElement("article");
      card.className = "blog-preview-item blog-full-item";
      card.innerHTML = `${article.image_url ? '<div class="blog-preview-image"></div>' : ''}<span></span><strong></strong><p></p><a class="blog-read-more" href="article.html?id=${encodeURIComponent(article.id)}"><i class="ri-arrow-right-line"></i> Lire plus</a>`;
      const image = card.querySelector(".blog-preview-image");
      if (image) image.style.backgroundImage = `url("${article.image_url}")`;
      card.querySelector("span").textContent = article.categorie || "Actualites";
      card.querySelector("strong").textContent = article.titre || "Article";
      card.querySelector("p").textContent = article.resume || "";
      wrap.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<article class="blog-preview-item"><span>Configuration</span><strong>Le blog sera disponible apres execution du script SQL.</strong></article>';
  }
}

async function initArticlePage() {
  const wrap = $("article-reader");
  const articleId = qs.get("id");
  if (!wrap) return;
  if (!articleId) {
    wrap.innerHTML = '<div class="placeholder-card">Article introuvable.</div>';
    return;
  }

  try {
    const { data: article, error } = await supabase
      .from(T.BLOG_ARTICLES)
      .select("*")
      .eq("id", articleId)
      .eq("statut", "published")
      .single();
    if (error) throw error;
    const date = article.published_at || article.created_at
      ? new Date(article.published_at || article.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : "";
    wrap.innerHTML = `
      ${article.image_url ? '<div class="article-hero-image"></div>' : ''}
      <div class="article-reader-meta">
        <span></span>
        <small></small>
      </div>
      <h1></h1>
      <p class="article-lead"></p>
      <div class="article-body"></div>`;
    const image = wrap.querySelector(".article-hero-image");
    if (image) image.style.backgroundImage = `url("${article.image_url}")`;
    wrap.querySelector(".article-reader-meta span").textContent = article.categorie || "Actualites";
    wrap.querySelector(".article-reader-meta small").textContent = date;
    wrap.querySelector("h1").textContent = article.titre || "Article";
    wrap.querySelector(".article-lead").textContent = article.resume || "";
    setFormattedArticleContent(wrap.querySelector(".article-body"), article.contenu || "");
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<div class="placeholder-card">Impossible de charger cet article.</div>';
  }
}

function filterStats(rows) {
  const tournoiId = $("rank-tournoi")?.value;
  const from = $("rank-from")?.value;
  const to = $("rank-to")?.value;
  return rows.filter(row => {
    if (tournoiId && row.tournoi_id !== tournoiId) return false;
    const d = row.played_at ? new Date(row.played_at) : null;
    if (from && d && d < new Date(`${from}T00:00:00`)) return false;
    if (to && d && d > new Date(`${to}T23:59:59`)) return false;
    return true;
  });
}

function aggregatePlayers(rows) {
  const players = playerMap();
  const teams = teamMap();
  const map = new Map();
  rows.forEach(row => {
    const p = players.get(row.joueur_id) || {};
    const t = teams.get(row.equipe_id) || {};
    const cur = map.get(row.joueur_id) || { prenom: p.prenom || "", nom: p.nom || "Joueur", equipe_nom: t.nom || "Equipe", matchs: 0, points: 0, bonnes: 0, repliques_bonnes: 0 };
    cur.matchs += 1;
    cur.points += row.points || 0;
    cur.bonnes += row.bonnes || 0;
    cur.repliques_bonnes += row.repliques_bonnes || 0;
    map.set(row.joueur_id, cur);
  });
  return [...map.values()].sort((a, b) => (b.points || 0) - (a.points || 0) || (b.bonnes || 0) - (a.bonnes || 0));
}

async function renderHistoricalRankings() {
  const teamWrap = $("history-team-ranking");
  const playerWrap = $("history-player-ranking");
  const category = $("rank-category")?.value || "all";
  teamWrap.innerHTML = "";
  playerWrap.innerHTML = "";
  aggregateTeamsFromRows(filterStats(teamStats)).forEach((team, i) => teamWrap.appendChild(teamRow(team, i)));
  const playerRows = category === "all" ? aggregatePlayers(filterStats(playerStats)) : await categoryPlayers(category);
  playerRows.forEach((p, i) => playerWrap.appendChild(playerRow(p, i)));
  if (!teamWrap.children.length) teamWrap.innerHTML = '<p class="text-muted text-center">Aucune donnee equipe.</p>';
  if (!playerWrap.children.length) playerWrap.innerHTML = '<p class="text-muted text-center">Aucune donnee joueur.</p>';
}

function aggregateTeamsFromRows(rows) {
  const teams = teamMap();
  const map = new Map();
  rows.forEach(row => {
    const team = teams.get(row.equipe_id) || {};
    const cur = map.get(row.equipe_id) || { nom: team.nom || "Equipe", matchs: 0, victoires: 0, nuls: 0, defaites: 0, points_marques: 0, points_classement: 0 };
    cur.matchs += 1;
    cur.victoires += row.gagne ? 1 : 0;
    cur.nuls += row.nul ? 1 : 0;
    cur.defaites += row.perdu ? 1 : 0;
    cur.points_marques += row.score || 0;
    cur.points_classement += row.gagne ? 3 : row.nul ? 1 : 0;
    map.set(row.equipe_id, cur);
  });
  return [...map.values()].sort((a, b) => (b.points_classement || 0) - (a.points_classement || 0));
}

async function categoryPlayers(category) {
  const from = $("rank-from")?.value;
  const to = $("rank-to")?.value;
  let query = supabase.from(T.EVENEMENTS).select("*").eq("categorie", category).limit(5000);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  const { data, error } = await query;
  if (error) throw error;
  const bareme = await loadBareme();
  const rule = bareme[category] || BAREME_DEFAULT[category] || {};
  const map = new Map();
  (data || []).forEach(ev => {
    const cur = map.get(ev.joueur_id) || { prenom: "", nom: ev.joueur_nom || "Joueur", equipe_nom: `Equipe ${ev.equipe}`, matchs: 0, points: 0, bonnes: 0, repliques_bonnes: 0 };
    if (ev.action === "bonne_reponse") { cur.bonnes += 1; cur.points += rule.bonne || 0; }
    if (ev.action === "replique_bonne") { cur.repliques_bonnes += 1; cur.points += rule.replique || 0; }
    if (ev.action === "replique_mauvaise") cur.points -= rule.replique_penalite || 0;
    map.set(ev.joueur_id, cur);
  });
  return [...map.values()].sort((a, b) => (b.points || 0) - (a.points || 0));
}

async function loadBareme() {
  const { data } = await supabase.from(T.CONFIG_POINTS).select("bareme").limit(1).maybeSingle();
  return data?.bareme || BAREME_DEFAULT;
}

function teamRow(team, index) {
  const row = document.createElement("div");
  row.className = "public-ranking-row";
  row.innerHTML = `<div class="public-ranking-pos">${index + 1}</div><div class="public-ranking-avatar">${(team.nom || "?")[0]}</div><div class="public-ranking-main"><div class="public-ranking-name">${team.nom || "Equipe"}</div><div class="public-ranking-meta">${team.matchs || 0} match(s) - ${team.victoires || 0}V ${team.nuls || 0}N ${team.defaites || 0}D</div></div><div class="public-ranking-score">${team.points_classement || 0}</div>`;
  return row;
}

function playerRow(player, index) {
  const row = document.createElement("div");
  row.className = "public-ranking-row";
  row.innerHTML = `<div class="public-ranking-pos">${index + 1}</div><div class="public-ranking-avatar">${(player.prenom || player.nom || "?")[0]}</div><div class="public-ranking-main"><div class="public-ranking-name">${`${player.prenom || ""} ${player.nom || ""}`.trim() || "Joueur"}</div><div class="public-ranking-meta">${player.equipe_nom || "Equipe"} - ${player.matchs || 0} match(s) - ${player.bonnes || 0} bonnes</div></div><div class="public-ranking-score">${player.points || 0}</div>`;
  return row;
}

if (page === "matches") initMatchesPage().catch(console.error);
if (page === "competition") initCompetitionPage().catch(console.error);
if (page === "historiques") initHistoriquesPage().catch(console.error);
if (page === "blog") initBlogPage().catch(console.error);
if (page === "article") initArticlePage().catch(console.error);
