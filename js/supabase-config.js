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
  MEMBRE: "membre",
  JURY: "jury",
  SUPERADMIN: "superadmin",
};

export const CATEGORIES = [
  { id: "francais", label: "Francais", icon: "ri-book-3-line", emoji: "FR" },
  { id: "religion", label: "Religion", icon: "ri-heart-3-line", emoji: "RL" },
  { id: "culture", label: "Culture Generale", icon: "ri-earth-line", emoji: "CG" },
  { id: "maths", label: "Mathematiques", icon: "ri-calculator-line", emoji: "MA" },
  { id: "sport", label: "Sport", icon: "ri-football-line", emoji: "SP" },
  { id: "eclair", label: "Questions Eclair", icon: "ri-flashlight-line", emoji: "QE" },
];

export const BAREME_DEFAULT = {
  francais: { bonne: 3, mauvaise: 0, replique: 1, replique_penalite: 0 },
  religion: { bonne: 3, mauvaise: 0, replique: 1, replique_penalite: 0 },
  culture: { bonne: 3, mauvaise: 0, replique: 1, replique_penalite: 0 },
  maths: { bonne: 4, mauvaise: 0, replique: 2, replique_penalite: 0 },
  sport: { bonne: 3, mauvaise: 0, replique: 1, replique_penalite: 0 },
  eclair: { bonne: 2, mauvaise: 0, replique: 0, replique_penalite: 0 },
};
