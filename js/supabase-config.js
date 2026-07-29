// ================================================================
//  PASTO GENIE - Supabase Config + constantes
//  Remplacez ces valeurs par celles de votre projet Supabase.
// ================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://xtqinyqyrcmwerjanxjp.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0cWlueXF5cmNtd2VyamFueGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0ODk4OTEsImV4cCI6MjA5NjA2NTg5MX0.1x30U96UahPm1bzsjsPcH3AJwpremppwkgAd0Fv50hk";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export { supabase };

export const STORAGE_BUCKET = "pasto-media";

export const T = {
  USERS: "users",
  CONFIG_POINTS: "configuration_points",
  REGLES_JEU: "regles_jeu",
  TOURNOIS: "tournois",
  TOURNOI_EQUIPES: "tournoi_equipes",
  TOURNOI_JOUEURS: "tournoi_joueurs",
  TRANSFERTS: "transferts_joueurs",
  BLOG_ARTICLES: "blog_articles",
  EQUIPES: "equipes",
  JOUEURS: "joueurs",
  MATCHES: "matches",
  MATCH_EN_COURS: "match_en_cours",
  EVENEMENTS: "match_evenements",
  STATS_EQUIPES: "match_stats_equipes",
  STATS_JOUEURS: "match_stats_joueurs",
  CLASSEMENT_EQUIPES: "v_classement_equipes",
  CLASSEMENT_JOUEURS: "v_classement_joueurs",
  LOGS: "logs_match",
};

export const ROLES = {
  PUBLIC: "public",
  ADMIN: "admin",
  JURY: "jury",
  SUPERADMIN: "superadmin",
};

export const MANAGED_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.JURY];

// ----------------------------------------------------------------
//  Phases d'un match — Feuille de Match officielle PASTO GENIE 2026.
//
//  Une phase porte UNE valeur de question. Tout le reste s'en deduit :
//  une bonne reponse vaut `points`, une mauvaise vaut 0, et une replique
//  vaut la moitie de `points` en positif si elle est bonne, en negatif si
//  elle est mauvaise. Les valeurs doivent donc rester paires : le jeu ne
//  connait pas les demi-points.
//
//  L'ordre et les couleurs suivent la feuille de match papier, pour que
//  l'ecran et la feuille se lisent de la meme facon.
//
//  `questions`  : nombre de questions posees a chaque equipe.
//  `cible`      : a qui la question est posee.
//  Total maximum par equipe : 6 x (60 + 30) + (150 + 75) + (100 + 50) = 915.
// ----------------------------------------------------------------
export const CATEGORIES = [
  { id: "francais", label: "Francais", icon: "ri-chat-3-line", emoji: "FR", points: 10, questions: 6, cible: "joueur", couleur: "#1b2f63" },
  { id: "culture", label: "Culture Gnle", icon: "ri-earth-line", emoji: "CG", points: 10, questions: 6, cible: "joueur", couleur: "#0d5a2b" },
  { id: "maths", label: "Maths", icon: "ri-calculator-line", emoji: "MA", points: 10, questions: 6, cible: "joueur", couleur: "#5b2d8e" },
  { id: "kreyol", label: "Kreyol", icon: "ri-chat-smile-3-line", emoji: "KR", points: 10, questions: 6, cible: "joueur", couleur: "#e8620c" },
  { id: "religion", label: "Religion", icon: "ri-cross-line", emoji: "RL", points: 10, questions: 6, cible: "joueur", couleur: "#1b2f63" },
  { id: "sport", label: "Sports", icon: "ri-run-line", emoji: "SP", points: 10, questions: 6, cible: "joueur", couleur: "#0d5a2b" },
  { id: "eclair", label: "Eclaires", icon: "ri-flashlight-fill", emoji: "EC", points: 50, questions: 3, cible: "titulaire", couleur: "#9b1420" },
  { id: "bonus", label: "Question Bonus", icon: "ri-star-fill", emoji: "QB", points: 100, questions: 1, cible: "equipe", couleur: "#d4a017" },
];

export const PHASE_BY_ID = Object.fromEntries(CATEGORIES.map(p => [p.id, p]));

/** Total maximum qu'une equipe peut atteindre : le "/915" de la feuille. */
export const TOTAL_MAX = CATEGORIES.reduce(
  (t, p) => t + p.questions * (p.points + pointsReplique(p.points)),
  0
);

/** Une replique vaut la moitie de la question, en + si bonne, en - si mauvaise. */
export function pointsReplique(points) {
  return Math.trunc((Number(points) || 0) / 2);
}

/** Points marques par une action, selon la valeur de question de la phase. */
export function pointsPourAction(action, pointsQuestion) {
  const base = Number(pointsQuestion) || 0;
  switch (action) {
    case "bonne_reponse": return base;
    case "mauvaise_reponse": return 0;
    case "replique_bonne": return pointsReplique(base);
    case "replique_mauvaise": return -pointsReplique(base);
    default: return 0;
  }
}

export const BAREME_DEFAULT = Object.fromEntries(
  CATEGORIES.map(p => [p.id, { points: p.points, questions: p.questions }])
);

/** Duree par defaut, en secondes, du compte a rebours de reponse. */
export const CHRONO_REPONSE_SECONDES = 20;
