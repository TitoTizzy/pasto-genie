# PASTO GENIE - Guide Supabase

## Structure

```
pasto-genie/
├── index.html              -> Scoreboard public
├── login.html              -> Connexion Supabase Auth
├── jury.html               -> Interface jury
├── admin.html              -> Panneau superadmin
├── js/supabase-config.js   -> Client Supabase + constantes
└── js/                     -> Logique applicative
```

## 1. Creer le projet Supabase

1. Creez un projet sur Supabase.
2. Activez l'authentification Email/Password.
3. Copiez l'URL du projet et la cle anon public.
4. Remplacez les valeurs dans `js/supabase-config.js`.

## 2. Tables attendues

Les scripts utilisent ces tables:

```sql
create table public.users (
  id uuid primary key,
  email text not null,
  display_name text,
  role text not null default 'public',
  created_at timestamptz default now()
);

create table public.tournois (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  annee int,
  description text,
  actif boolean default true,
  created_at timestamptz default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  equipe_a jsonb not null,
  equipe_b jsonb not null,
  categories_ordre jsonb not null,
  categorie_actuelle int default 0,
  statut text not null default 'planifie',
  tournoi_id uuid,
  tournament_name text,
  jury_id uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table public.match_en_cours (
  id uuid primary key references public.matches(id) on delete cascade,
  score_a int default 0,
  score_b int default 0,
  points_joueurs jsonb default '{}'::jsonb,
  score_par_categorie jsonb default '{}'::jsonb,
  updated_at timestamptz
);

create table public.match_evenements (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  joueur_id text not null,
  joueur_nom text,
  equipe text not null,
  action text not null,
  categorie text not null,
  jury_id uuid not null,
  created_at timestamptz default now()
);

create table public.configuration_points (
  id text primary key,
  bareme jsonb not null,
  updated_at timestamptz
);

create table public.regles_jeu (
  id text primary key,
  texte text not null,
  updated_at timestamptz
);
```

## 3. Temps reel

Activez Realtime sur:

- `matches`
- `match_en_cours`
- `match_evenements`

## 4. Creation des utilisateurs

Le panneau admin appelle une Edge Function nommee `admin-create-user`. Cette fonction doit utiliser la service role key cote serveur pour creer le compte Auth, puis inserer le profil dans `public.users`.

### Deployer la fonction `admin-create-user`

Dans PowerShell, depuis le dossier du projet:

```powershell
cd "C:\Users\ouhha\OneDrive\Desktop\Platform Nesmy"
npx supabase login
npx supabase functions deploy admin-create-user --project-ref xtqinyqyrcmwerjanxjp
```

Si Supabase demande un token, ouvrez:

```text
https://supabase.com/dashboard/account/tokens
```

Copiez un nouveau token personnel, collez-le dans PowerShell, puis relancez:

```powershell
npx supabase functions deploy admin-create-user --project-ref xtqinyqyrcmwerjanxjp
```

Ensuite rechargez `admin.html` avec `Ctrl + F5` et recreez le compte depuis la console superadmin.

## 5. Calcul du score

Les jurys inserent uniquement des lignes dans `match_evenements`. Le trigger SQL recalcule `match_en_cours` apres chaque evenement.

Le bareme contient maintenant:

```json
{
  "bonne": 3,
  "mauvaise": 0,
  "replique": 1,
  "replique_penalite": 0
}
```

`replique_penalite` est soustrait quand l'action est `replique_mauvaise`.

## 6. Effectifs, profils et statistiques

Apres le schema principal, executez aussi:

```text
supabase/league-platform-upgrade.sql
supabase/storage-media-bucket.sql
```

Ce script ajoute:

- `equipes` pour les emblemes, couleurs et paroisses.
- `joueurs` pour les photos et profils durables.
- `match_stats_equipes` et `match_stats_joueurs` pour figer les statistiques apres validation finale.
- `finalize_match_stats(match_id)` pour terminer un match et creer son historique.
- Les vues `v_classement_equipes` et `v_classement_joueurs`.

Important: les nouveaux matchs doivent appartenir a un tournoi. Pour conserver un historique joueur, ajoutez les joueurs dans l'onglet `Joueurs`, puis selectionnez-les dans la creation du match.

Le script `storage-media-bucket.sql` cree le bucket public `pasto-media` pour uploader les emblemes d'equipes et les photos des joueurs depuis l'admin.
