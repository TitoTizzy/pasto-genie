// ================================================================
//  PASTO GENIE - Pupitre des juges
//
//  Regles (interview 23/07/2026) :
//  - 2 juges par equipe : les deux doivent donner le meme avis pour
//    que le point soit officiel (RPC soumettre_avis + trigger SQL).
//  - L'avis d'un superadmin est toujours decisif.
//  - Un juge peut corriger son avis a tout moment : le score est
//    rejoue depuis le journal cote serveur.
//  - Replique : l'equipe adverse, en tant qu'equipe, pour la moitie
//    des points de la question (+ si bonne, - si mauvaise).
//  - Chrono de reponse lance a la main par le superadmin ; son sur
//    les 5 dernieres secondes.
// ================================================================
import { supabase, T, CATEGORIES, PHASE_BY_ID, ROLES, pointsReplique, pointsPourAction, CHRONO_REPONSE_SECONDES } from "./supabase-config.js";
import { initAuth, logout } from "./auth.js";
import { toast } from "./utils.js";

const $ = id => document.getElementById(id);

let me = null;
let myRole = null;
let matchId = null;
let match = null;          // ligne brute de public.matches
let live = null;           // ligne de match_en_cours
let bareme = {};           // configuration_points
let rosters = { A: [], B: [] };   // tous les joueurs des deux equipes
let juges = { A: [], B: [] };     // match_juges par equipe
let juryUsers = [];        // comptes jury (pour l'assignation, superadmin)
let channels = [];
let chronoTimer = null;
let lastBeep = null;
let audioCtx = null;

const isAdminRole = () => myRole === ROLES.ADMIN || myRole === ROLES.SUPERADMIN;

// ----------------------------------------------------------------
//  Demarrage
// ----------------------------------------------------------------
(async () => {
  const { user, role } = await initAuth({
    allowedRoles: [ROLES.JURY, ROLES.ADMIN, ROLES.SUPERADMIN],
    redirectTo: "login.html",
  });
  me = user;
  myRole = role;
  $("jury-user-chip").innerHTML = `<i class="ri-user-line"></i> ${""}`;
  $("jury-user-chip").append(user.email.split("@")[0]);
  $("btn-logout").addEventListener("click", () => logout("login.html"));

  if (isAdminRole()) {
    $("match-controls").classList.remove("hidden");
    $("chrono-controls").classList.remove("hidden");
  }

  wireArena();
  await loadMatchList();
})();

// ----------------------------------------------------------------
//  Liste des matchs
// ----------------------------------------------------------------
async function loadMatchList() {
  const { data, error } = await supabase
    .from(T.MATCHES)
    .select("*")
    .neq("statut", "termine")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(40);
  if (error) {
    console.error(error);
    toast("Erreur chargement matchs : " + error.message, "error");
    return;
  }
  const sel = $("jury-match-select");
  while (sel.options.length > 1) sel.remove(1);
  const labels = { planifie: "Planifie", en_cours: "EN DIRECT", pause: "Pause" };
  (data || []).forEach(m => {
    const quand = m.scheduled_at
      ? new Date(m.scheduled_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    sel.appendChild(new Option(
      `${m.equipe_a?.nom || "A"} vs ${m.equipe_b?.nom || "B"} — ${quand} [${labels[m.statut] || m.statut}]`,
      m.id
    ));
  });
}

$("btn-join").addEventListener("click", () => {
  const id = $("jury-match-select").value;
  if (!id) { toast("Selectionnez un match.", "error"); return; }
  joinMatch(id);
});

// ----------------------------------------------------------------
//  Entree dans l'arene
// ----------------------------------------------------------------
async function joinMatch(id) {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels = [];
  matchId = id;

  try {
    await loadMatch();
    await Promise.all([loadBareme(), loadLive(), loadRosters(), loadJuges(), loadJournal()]);
  } catch (err) {
    console.error(err);
    toast("Erreur chargement : " + (err.message || err), "error");
    return;
  }

  $("jury-start").classList.add("hidden");
  $("jury-arena-wrap").classList.remove("hidden");

  channels = [
    supabase.channel(`j-match-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: T.MATCHES, filter: `id=eq.${id}` }, p => {
        if (p.new?.id) { match = p.new; renderAll(); }
      }).subscribe(),
    supabase.channel(`j-live-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: T.MATCH_EN_COURS, filter: `id=eq.${id}` }, p => {
        live = p.new?.id ? p.new : null;
        renderScores();
      }).subscribe(),
    supabase.channel(`j-avis-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "avis_juges", filter: `match_id=eq.${id}` }, () => {
        renderAvisStatus();
      }).subscribe(),
    supabase.channel(`j-ev-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: T.EVENEMENTS, filter: `match_id=eq.${id}` }, () => {
        loadJournal().catch(console.error);
        renderAvisStatus();
      }).subscribe(),
    supabase.channel(`j-juges-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_juges", filter: `match_id=eq.${id}` }, () => {
        loadJuges().then(renderAvisStatus).catch(console.error);
      }).subscribe(),
  ];

  renderAll();

  // Pas encore de joueurs en lice -> composer l'equipe d'abord
  if (!titulaires("A").length && !titulaires("B").length && rosters.A.length + rosters.B.length > 0) {
    openLineup();
  }
}

async function loadMatch() {
  const { data, error } = await supabase.from(T.MATCHES).select("*").eq("id", matchId).single();
  if (error) throw error;
  match = data;
}

async function loadLive() {
  const { data, error } = await supabase.from(T.MATCH_EN_COURS).select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  live = data || null;
}

async function loadBareme() {
  const { data } = await supabase.from(T.CONFIG_POINTS).select("bareme").eq("id", "bareme").maybeSingle();
  bareme = data?.bareme || {};
}

async function loadRosters() {
  rosters = { A: [], B: [] };
  const ids = [match.equipe_a_id, match.equipe_b_id].filter(Boolean);
  if (ids.length) {
    const { data, error } = await supabase.from(T.JOUEURS).select("*").in("equipe_id", ids).eq("actif", true);
    if (!error && data) {
      data.forEach(j => {
        const item = { id: j.id, nom: `${j.prenom || ""} ${j.nom || ""}`.trim() || "Joueur", photo_url: j.photo_url || "" };
        if (j.equipe_id === match.equipe_a_id) rosters.A.push(item);
        else rosters.B.push(item);
      });
    }
  }
  // Secours : anciens matchs sans equipe_x_id -> effectif fige dans le match
  if (!rosters.A.length) rosters.A = (match.equipe_a?.titulaires || []).concat(match.equipe_a?.remplacants || []);
  if (!rosters.B.length) rosters.B = (match.equipe_b?.titulaires || []).concat(match.equipe_b?.remplacants || []);
}

async function loadJuges() {
  juges = { A: [], B: [] };
  const { data, error } = await supabase.from("match_juges").select("*").eq("match_id", matchId);
  if (!error && data) data.forEach(r => juges[r.equipe]?.push(r));
}

// ----------------------------------------------------------------
//  Etat du jeu
// ----------------------------------------------------------------
function ordre() { return match?.categories_ordre || []; }
function phaseId() { return ordre()[match?.categorie_actuelle ?? 0] || null; }
function phaseMeta() { return PHASE_BY_ID[phaseId()] || { label: phaseId() || "—", icon: "ri-question-line", points: 10, questions: 6, cible: "joueur" }; }
function phaseConf() {
  const meta = phaseMeta();
  const conf = bareme[phaseId()] || {};
  return {
    ...meta,
    points: Number(conf.points ?? conf.bonne ?? meta.points) || 0,
    questions: Number(conf.questions ?? meta.questions) || 1,
  };
}
function questionNum() { return match?.question_num ?? 1; }
function questionKey() { return `${phaseId()}-q${questionNum()}`; }
function titulaires(side) { return (side === "A" ? match?.equipe_a : match?.equipe_b)?.titulaires || []; }
function teamName(side) { return (side === "A" ? match?.equipe_a : match?.equipe_b)?.nom || `Equipe ${side}`; }

// ----------------------------------------------------------------
//  Rendus
// ----------------------------------------------------------------
function renderAll() {
  if (!match) return;
  renderHead();
  renderPhaseTrack();
  renderTeams();
  renderReplique();
  renderScores();
  renderAvisStatus();
  renderChrono();
}

function renderHead() {
  const conf = phaseConf();
  $("ph-icon").className = conf.icon;
  $("ph-label").textContent = conf.label;
  $("ph-qnum").textContent = `Question ${questionNum()}/${conf.questions}`;
  const demi = pointsReplique(conf.points);
  $("ph-bareme").textContent = `Bonne ${conf.points} · Mauvaise 0 · Replique +${demi}/−${demi}`;

  $("sb-name-a").textContent = teamName("A");
  $("sb-name-b").textContent = teamName("B");
  $("team-head-a").textContent = teamName("A");
  $("team-head-b").textContent = teamName("B");

  const pauseBtn = $("btn-pause-match");
  if (pauseBtn) {
    pauseBtn.innerHTML = match.statut === "pause"
      ? '<i class="ri-play-fill"></i>'
      : '<i class="ri-pause-line"></i>';
    pauseBtn.title = match.statut === "pause" ? "Reprendre" : "Pause";
  }
}

function renderPhaseTrack() {
  const wrap = $("phase-track");
  wrap.innerHTML = "";
  const cur = match.categorie_actuelle ?? 0;
  ordre().forEach((id, i) => {
    const meta = PHASE_BY_ID[id] || { emoji: "?", label: id };
    const chip = document.createElement("div");
    chip.className = "j-phase-chip" + (i === cur ? " active" : i < cur ? " done" : "");
    chip.textContent = `${meta.emoji} ${meta.label}`;
    wrap.appendChild(chip);
  });
}

function renderTeams() {
  const conf = phaseConf();
  ["A", "B"].forEach(side => {
    const wrap = $(side === "A" ? "players-a" : "players-b");
    wrap.innerHTML = "";
    const enJeu = match.statut === "en_cours";

    if (conf.cible === "equipe") {
      wrap.appendChild(buildTeamCard(side, conf, enJeu));
      return;
    }

    const list = titulaires(side);
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "j-muted j-empty";
      p.textContent = "Aucun joueur en lice. Ouvrez la composition (bouton equipe en haut).";
      wrap.appendChild(p);
      return;
    }
    list.forEach(j => wrap.appendChild(buildPlayerCard(side, j, conf, enJeu)));
  });
}

function buildPlayerCard(side, joueur, conf, enJeu) {
  const card = document.createElement("div");
  card.className = "j-player";

  const head = document.createElement("div");
  head.className = "j-player-head";

  const avatar = document.createElement("div");
  avatar.className = "j-player-avatar";
  if (joueur.photo_url) {
    avatar.style.backgroundImage = `url("${joueur.photo_url}")`;
  } else {
    avatar.textContent = (joueur.nom || "?").trim()[0]?.toUpperCase() || "?";
  }

  const name = document.createElement("div");
  name.className = "j-player-name";
  name.textContent = joueur.nom || "Joueur";

  const pts = document.createElement("div");
  pts.className = "j-player-pts";
  pts.textContent = `${live?.points_joueurs?.[joueur.id] ?? 0} pts`;

  head.append(avatar, name, pts);

  const actions = document.createElement("div");
  actions.className = "j-player-actions";

  const good = document.createElement("button");
  good.className = "btn btn-green j-btn-good";
  good.innerHTML = `<i class="ri-check-line"></i> Bonne +${conf.points}`;
  good.disabled = !enJeu;
  good.addEventListener("click", () => soumettre("bonne_reponse", side, joueur.id, joueur.nom));

  const bad = document.createElement("button");
  bad.className = "btn btn-red j-btn-bad";
  bad.innerHTML = '<i class="ri-close-line"></i> Mauvaise';
  bad.disabled = !enJeu;
  bad.addEventListener("click", () => soumettre("mauvaise_reponse", side, joueur.id, joueur.nom));

  actions.append(good, bad);
  card.append(head, actions);
  return card;
}

function buildTeamCard(side, conf, enJeu) {
  const card = document.createElement("div");
  card.className = "j-player j-teamcard";

  const head = document.createElement("div");
  head.className = "j-player-head";
  const name = document.createElement("div");
  name.className = "j-player-name";
  name.textContent = `Toute l'equipe — ${teamName(side)}`;
  head.appendChild(name);

  const actions = document.createElement("div");
  actions.className = "j-player-actions";

  const good = document.createElement("button");
  good.className = "btn btn-green j-btn-good";
  good.innerHTML = `<i class="ri-check-line"></i> Bonne +${conf.points}`;
  good.disabled = !enJeu;
  good.addEventListener("click", () => soumettre("bonne_reponse", side, `equipe-${side.toLowerCase()}`, teamName(side)));

  const bad = document.createElement("button");
  bad.className = "btn btn-red j-btn-bad";
  bad.innerHTML = '<i class="ri-close-line"></i> Mauvaise';
  bad.disabled = !enJeu;
  bad.addEventListener("click", () => soumettre("mauvaise_reponse", side, `equipe-${side.toLowerCase()}`, teamName(side)));

  actions.append(good, bad);
  card.append(head, actions);
  return card;
}

function renderReplique() {
  const conf = phaseConf();
  const demi = pointsReplique(conf.points);
  $("rep-points").textContent = `+${demi} / −${demi}`;
  const sel = $("rep-equipe");
  sel.options[0].textContent = teamName("A");
  sel.options[1].textContent = teamName("B");
  const enJeu = match.statut === "en_cours";
  $("btn-rep-bonne").disabled = !enJeu;
  $("btn-rep-mauvaise").disabled = !enJeu;
}

function renderScores() {
  $("sb-score-a").textContent = live?.score_a ?? 0;
  $("sb-score-b").textContent = live?.score_b ?? 0;
  // rafraichit les points des joueurs sans reconstruire les cartes
  renderTeams();
}

async function renderAvisStatus() {
  const box = $("avis-status");
  if (!match) return;
  const key = questionKey();
  const { data, error } = await supabase
    .from("avis_juges")
    .select("*")
    .eq("match_id", matchId)
    .in("question_key", [key, `${key}-r`]);
  if (error) { box.classList.add("hidden"); return; }

  const rows = data || [];
  if (!rows.length) { box.classList.add("hidden"); return; }

  const parts = [];
  [[key, "Question"], [`${key}-r`, "Replique"]].forEach(([k, label]) => {
    const forKey = rows.filter(r => r.question_key === k);
    if (!forKey.length) return;
    const equipe = forKey[0].equipe;
    const requis = Math.max(juges[equipe]?.length || 0, 1);
    const distinct = new Set(forKey.map(r => r.action)).size;
    if (distinct > 1) {
      parts.push(`<span class="j-avis-bad"><i class="ri-alert-line"></i> ${label} : DESACCORD entre juges (${teamName(equipe)}) — corrigez vos avis</span>`);
    } else if (forKey.length >= requis) {
      parts.push(`<span class="j-avis-ok"><i class="ri-checkbox-circle-line"></i> ${label} : validee (${teamName(equipe)})</span>`);
    } else {
      parts.push(`<span class="j-avis-wait"><i class="ri-time-line"></i> ${label} : ${forKey.length}/${requis} avis (${teamName(equipe)})</span>`);
    }
  });

  box.innerHTML = parts.join(" ");
  box.classList.remove("hidden");
}

async function loadJournal() {
  const { data, error } = await supabase
    .from(T.EVENEMENTS)
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return;
  const wrap = $("jury-log");
  wrap.innerHTML = "";
  if (!data?.length) {
    const p = document.createElement("p");
    p.className = "j-muted";
    p.textContent = "Aucune action validee.";
    wrap.appendChild(p);
    return;
  }
  data.forEach(ev => {
    const conf = bareme[ev.categorie] || {};
    const pts = pointsPourAction(ev.action, conf.points ?? conf.bonne ?? PHASE_BY_ID[ev.categorie]?.points ?? 0);
    const meta = PHASE_BY_ID[ev.categorie] || { label: ev.categorie };
    const line = document.createElement("div");
    line.className = "j-log-row " + (pts > 0 ? "pos" : pts < 0 ? "neg" : "zero");

    const who = document.createElement("span");
    who.className = "j-log-who";
    who.textContent = `${ev.joueur_nom || "Joueur"} (${teamName(ev.equipe)})`;

    const what = document.createElement("span");
    what.className = "j-log-what";
    const labels = {
      bonne_reponse: "Bonne reponse",
      mauvaise_reponse: "Mauvaise reponse",
      replique_bonne: "Replique reussie",
      replique_mauvaise: "Replique manquee",
    };
    what.textContent = `${labels[ev.action] || ev.action} — ${meta.label}`;

    const delta = document.createElement("span");
    delta.className = "j-log-pts";
    delta.textContent = pts > 0 ? `+${pts}` : `${pts}`;

    line.append(who, what, delta);
    wrap.appendChild(line);
  });
}

// ----------------------------------------------------------------
//  Soumission des avis
// ----------------------------------------------------------------
async function soumettre(action, equipe, joueurId, joueurNom, replique = false) {
  const key = replique ? `${questionKey()}-r` : questionKey();
  try {
    const { data, error } = await supabase.rpc("soumettre_avis", {
      p_match_id: matchId,
      p_question_key: key,
      p_equipe: equipe,
      p_joueur_id: joueurId,
      p_joueur_nom: joueurNom,
      p_categorie: phaseId(),
      p_action: action,
    });
    if (error) throw error;
    const s = data?.statut;
    if (s === "valide") toast("Avis enregistre — point officiel.", "success");
    else if (s === "desaccord") toast("Desaccord entre juges : le point est suspendu.", "error");
    else toast(`Avis enregistre (${data?.recus}/${data?.requis}). En attente de l'autre juge.`, "info");
  } catch (err) {
    console.error(err);
    const msg = String(err.message || err);
    if (msg.includes("soumettre_avis")) {
      toast("Base non a jour : executez supabase/018-moteur-juges-et-chrono.sql.", "error");
    } else {
      toast("Erreur : " + msg, "error");
    }
  }
}

$("btn-rep-bonne")?.addEventListener("click", () => {
  const side = $("rep-equipe").value;
  soumettre("replique_bonne", side, `equipe-${side.toLowerCase()}`, teamName(side), true);
});
$("btn-rep-mauvaise")?.addEventListener("click", () => {
  const side = $("rep-equipe").value;
  soumettre("replique_mauvaise", side, `equipe-${side.toLowerCase()}`, teamName(side), true);
});

$("btn-undo")?.addEventListener("click", async () => {
  try {
    const key = questionKey();
    await supabase.rpc("annuler_avis", { p_match_id: matchId, p_question_key: key });
    await supabase.rpc("annuler_avis", { p_match_id: matchId, p_question_key: `${key}-r` });
    toast("Avis retire.", "info");
    renderAvisStatus();
  } catch (err) {
    toast("Erreur : " + (err.message || err), "error");
  }
});

// ----------------------------------------------------------------
//  Navigation des questions et etats du match (admin/superadmin)
// ----------------------------------------------------------------
function wireArena() {
  $("btn-next-q").addEventListener("click", () => shiftQuestion(1));
  $("btn-prev-q").addEventListener("click", () => shiftQuestion(-1));
  $("btn-pause-match").addEventListener("click", togglePause);
  $("btn-end-match").addEventListener("click", endMatch);
  $("btn-lineup").addEventListener("click", openLineup);
  $("close-lineup").addEventListener("click", () => $("lineup-overlay").classList.remove("open"));
  $("btn-save-lineup").addEventListener("click", saveLineup);
  $("btn-chrono-go").addEventListener("click", () => setChrono(parseInt($("chrono-secs").value, 10) || CHRONO_REPONSE_SECONDES));
  $("btn-chrono-stop").addEventListener("click", () => setChrono(null));
}

async function shiftQuestion(delta) {
  if (!isAdminRole()) { toast("Reserve a l'organisateur.", "error"); return; }
  const conf = phaseConf();
  let cat = match.categorie_actuelle ?? 0;
  let num = questionNum() + delta;

  if (num > conf.questions) {
    if (cat >= ordre().length - 1) { toast("C'etait la derniere question du match.", "info"); return; }
    cat += 1;
    num = 1;
  } else if (num < 1) {
    if (cat <= 0) return;
    cat -= 1;
    const prevConf = bareme[ordre()[cat]] || PHASE_BY_ID[ordre()[cat]] || {};
    num = Number(prevConf.questions ?? PHASE_BY_ID[ordre()[cat]]?.questions ?? 6) || 6;
  }

  const { error } = await supabase
    .from(T.MATCHES)
    .update({ categorie_actuelle: cat, question_num: num, chrono: null, updated_at: new Date().toISOString() })
    .eq("id", matchId);
  if (error) toast("Erreur navigation : " + error.message, "error");
}

async function togglePause() {
  if (!isAdminRole()) return;
  const statut = match.statut === "pause" ? "en_cours" : "pause";
  const { error } = await supabase
    .from(T.MATCHES)
    .update({ statut, updated_at: new Date().toISOString() })
    .eq("id", matchId);
  if (error) toast("Erreur : " + error.message, "error");
  else toast(statut === "pause" ? "Match en pause." : "Match repris.", "info");
}

async function endMatch() {
  if (!isAdminRole()) { toast("Reserve a l'organisateur.", "error"); return; }
  if (!confirm("Terminer ce match definitivement ?")) return;
  try {
    const { error } = await supabase.rpc("finalize_match_stats", { p_match_id: matchId });
    if (error) throw error;
    toast("Match termine et statistiques figees.", "success");
    channels.forEach(ch => supabase.removeChannel(ch));
    channels = [];
    clearInterval(chronoTimer);
    $("jury-arena-wrap").classList.add("hidden");
    $("jury-start").classList.remove("hidden");
    await loadMatchList();
  } catch (err) {
    toast("Erreur fin de match : " + (err.message || err), "error");
  }
}

// ----------------------------------------------------------------
//  Chrono de reponse
// ----------------------------------------------------------------
async function setChrono(secondes) {
  if (!isAdminRole()) return;
  try {
    const { error } = await supabase.rpc("regler_chrono", { p_match_id: matchId, p_secondes: secondes });
    if (error) throw error;
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("regler_chrono")) toast("Base non a jour : executez supabase/018-moteur-juges-et-chrono.sql.", "error");
    else toast("Erreur chrono : " + msg, "error");
  }
}

function renderChrono() {
  clearInterval(chronoTimer);
  chronoTimer = null;
  const el = $("chrono-display");
  const c = match?.chrono;

  if (!c?.fin) {
    el.textContent = "--";
    el.classList.remove("urgent", "done");
    lastBeep = null;
    return;
  }

  const fin = new Date(c.fin).getTime();
  const tick = () => {
    const rest = Math.ceil((fin - Date.now()) / 1000);
    if (rest <= 0) {
      el.textContent = "0";
      el.classList.remove("urgent");
      el.classList.add("done");
      if (lastBeep !== 0) { beep(220, 0.7); lastBeep = 0; }
      clearInterval(chronoTimer);
      return;
    }
    el.textContent = String(rest);
    el.classList.toggle("urgent", rest <= 5);
    el.classList.remove("done");
    if (rest <= 5 && lastBeep !== rest) {
      beep(880, 0.12);
      lastBeep = rest;
    }
  };
  tick();
  chronoTimer = setInterval(tick, 200);
}

function beep(freq, duration) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.28, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch { /* audio bloque tant que l'utilisateur n'a pas interagi */ }
}

// ----------------------------------------------------------------
//  Composition : joueurs en lice + juges
// ----------------------------------------------------------------
async function openLineup() {
  $("lineup-title-a").textContent = teamName("A");
  $("lineup-title-b").textContent = teamName("B");

  ["A", "B"].forEach(side => {
    const wrap = $(side === "A" ? "lineup-a" : "lineup-b");
    wrap.innerHTML = "";
    const actifs = new Set(titulaires(side).map(j => j.id));
    if (!rosters[side].length) {
      const p = document.createElement("p");
      p.className = "j-muted";
      p.textContent = "Aucun joueur enregistre. Ajoutez-les dans Admin > Joueurs.";
      wrap.appendChild(p);
      return;
    }
    rosters[side].forEach(j => {
      const row = document.createElement("label");
      row.className = "j-lineup-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = j.id;
      cb.checked = actifs.has(j.id);
      cb.dataset.side = side;
      const span = document.createElement("span");
      span.textContent = j.nom;
      row.append(cb, span);
      wrap.appendChild(row);
    });
  });

  if (myRole === ROLES.SUPERADMIN) {
    $("judges-block").classList.remove("hidden");
    await renderJudgesBlock();
  }

  $("lineup-overlay").classList.add("open");
}

async function renderJudgesBlock() {
  if (!juryUsers.length) {
    const { data } = await supabase.from(T.USERS).select("id, email, display_name, role").eq("role", "jury");
    juryUsers = data || [];
  }
  const wrap = $("judges-list");
  wrap.innerHTML = "";
  if (!juryUsers.length) {
    const p = document.createElement("p");
    p.className = "j-muted";
    p.textContent = "Aucun compte jury. Creez-les dans Admin > Creer un compte.";
    wrap.appendChild(p);
    return;
  }
  const assigned = new Map();
  [...juges.A, ...juges.B].forEach(r => assigned.set(r.juge_id, r.equipe));
  juryUsers.forEach(u => {
    const row = document.createElement("div");
    row.className = "j-judge-row";
    const name = document.createElement("span");
    name.textContent = u.display_name || u.email;
    const sel = document.createElement("select");
    sel.className = "form-select j-judge-select";
    sel.dataset.jugeId = u.id;
    ["", "A", "B"].forEach(v => {
      const opt = new Option(v === "" ? "—" : `Equipe ${v} (${teamName(v)})`, v);
      sel.appendChild(opt);
    });
    sel.value = assigned.get(u.id) || "";
    row.append(name, sel);
    wrap.appendChild(row);
  });
}

async function saveLineup() {
  try {
    for (const side of ["A", "B"]) {
      const wrap = $(side === "A" ? "lineup-a" : "lineup-b");
      const cocheIds = [...wrap.querySelectorAll("input:checked")].map(cb => cb.value);
      if (!rosters[side].length) continue;
      if (cocheIds.length > 3) {
        toast(`${teamName(side)} : 3 joueurs en lice maximum.`, "error");
        return;
      }
      const tit = rosters[side].filter(j => cocheIds.includes(j.id));
      const remp = rosters[side].filter(j => !cocheIds.includes(j.id));
      const { error } = await supabase.rpc("definir_titulaires", {
        p_match_id: matchId,
        p_equipe: side,
        p_titulaires: tit,
        p_remplacants: remp,
      });
      if (error) throw error;
    }

    if (myRole === ROLES.SUPERADMIN && !$("judges-block").classList.contains("hidden")) {
      const rows = [...$("judges-list").querySelectorAll("select")];
      const nouveaux = rows
        .filter(s => s.value)
        .map(s => ({ match_id: matchId, juge_id: s.dataset.jugeId, equipe: s.value }));
      const { error: delErr } = await supabase.from("match_juges").delete().eq("match_id", matchId);
      if (delErr) throw delErr;
      if (nouveaux.length) {
        const { error: insErr } = await supabase.from("match_juges").insert(nouveaux);
        if (insErr) throw insErr;
      }
    }

    toast("Composition enregistree.", "success");
    $("lineup-overlay").classList.remove("open");
    await Promise.all([loadMatch(), loadJuges()]);
    renderAll();
  } catch (err) {
    console.error(err);
    const msg = String(err.message || err);
    if (msg.includes("definir_titulaires") || msg.includes("match_juges")) {
      toast("Base non a jour : executez supabase/018-moteur-juges-et-chrono.sql.", "error");
    } else {
      toast("Erreur : " + msg, "error");
    }
  }
}
