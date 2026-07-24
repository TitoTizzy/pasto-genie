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
//  Phases d'un match.
//
//  Une phase porte UNE valeur de question. Tout le reste s'en deduit :
//  une bonne reponse vaut `points`, une mauvaise vaut 0, et une replique
//  vaut la moitie de `points` en positif si elle est bonne, en negatif si
//  elle est mauvaise. Les valeurs doivent donc rester paires : le jeu ne
//  connait pas les demi-points.
//
//  `questions`  : nombre de questions posees a chaque equipe.
//  `cible`      : a qui la question est posee.
// ----------------------------------------------------------------
export const CATEGORIES = [
  { id: "francais", label: "Francais", icon: "ri-book-3-line", emoji: "FR", points: 10, questions: 6, cible: "joueur" },
  { id: "religion", label: "Religion", icon: "ri-heart-3-line", emoji: "RL", points: 10, questions: 6, cible: "joueur" },
  { id: "culture", label: "Culture Generale", icon: "ri-earth-line", emoji: "CG", points: 10, questions: 6, cible: "joueur" },
  { id: "maths", label: "Mathematiques", icon: "ri-calculator-line", emoji: "MA", points: 10, questions: 6, cible: "joueur" },
  { id: "sport", label: "Sport", icon: "ri-football-line", emoji: "SP", points: 10, questions: 6, cible: "joueur" },
  { id: "eclair", label: "Questions Eclair", icon: "ri-flashlight-line", emoji: "QE", points: 50, questions: 3, cible: "titulaire" },
  { id: "bonus", label: "Question Bonus", icon: "ri-star-smile-line", emoji: "QB", points: 100, questions: 1, cible: "equipe" },
];

export const PHASE_BY_ID = Object.fromEntries(CATEGORIES.map(p => [p.id, p]));

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
