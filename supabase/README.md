# Scripts SQL — PASTO GENIE

Les scripts sont numérotés dans leur **ordre d'exécution**. Sur une base neuve,
on les passe de `001` à `020`, dans l'ordre. Sur une base existante, on ne rejoue
que ceux qui manquent.

Tous s'exécutent par copier-coller dans **Supabase → SQL Editor → Run**.

## Par où commencer

**`000-diagnostic-etat-base.sql`** est en lecture seule et ne modifie rien. Il
interroge la base et répond, pour chaque script, `OK` ou `>>> A EXECUTER`.
Lancez-le en premier : c'est lui qui dit où vous en êtes.

Cette étape est nécessaire parce que le projet n'a pas d'outil de migration.
Rien n'enregistre ce qui a déjà tourné, et une requête *enregistrée* dans
l'éditeur SQL ne prouve pas qu'elle ait été *exécutée*.

## L'ordre

| # | Script | Ce qu'il installe |
|---|---|---|
| 000 | `diagnostic-etat-base.sql` | *Lecture seule — l'état de la base* |
| 001 | `schema-and-policies.sql` | Tables de base, RLS, trigger de score, Realtime |
| 002 | `repair-missing-tables-and-grants.sql` | `regles_jeu`, `logs_match` et droits, si 001 est incomplet |
| 003 | `repair-service-role-grants.sql` | Droits du `service_role` (Edge Function de création de compte) |
| 004 | `update-replique-penalty.sql` | ⚠️ Ancien barème — **remplacé par 016** |
| 005 | `league-platform-upgrade.sql` | Équipes, joueurs, statistiques figées, classements |
| 006 | `storage-media-bucket.sql` | Bucket `pasto-media` (emblèmes, photos) |
| 007 | `add-competition-format.sql` | `format_type` et `regles` sur les tournois |
| 008 | `repair-tournois-rls-and-competition.sql` | RLS des tournois + compte superadmin initial |
| 009 | `add-team-pools.sql` | Poules d'équipes, vue de classement reconstruite |
| 010 | `repair-blog-and-competition-engine.sql` | Blog, inscriptions au tournoi, transferts |
| 011 | `repair-roles-and-user-permissions.sql` | Rôles officiels et permissions |
| 012 | `generate-tournament-matches.sql` | Générateur de calendrier côté serveur |
| 013 | `repair-admin-match-policies.sql` | Droits d'écriture des matchs pour le rôle `admin` |
| 014 | `repair-team-transfer-history.sql` | Transferts sans tournoi obligatoire |
| 015 | `repair-match-finalization.sql` | Débloque la fin de match |
| 016 | `bareme-2026.sql` | **Barème 2026** : 10 / 50 / 100, réplique de moitié, recalcul |
| 017 | `seed-pasto-genie-2026.sql` | ⚠️ **Efface tout** puis installe les 8 équipes et 12 matchs |
| 018 | `moteur-juges-et-chrono.sql` | 4 juges (2 par équipe), validation à deux, corrections, chrono |
| 019 | `type-de-match.sql` | Saison régulière et phases finales, classement de saison |
| 020 | `feuille-de-match-officielle.sql` | **Barème officiel /915** avec la catégorie KREYOL |

## À savoir

- **004 est périmé.** Il installe l'ancien barème (bonne = 3, maths = 4,
  éclair = 2). Le 016 le remplace intégralement. Ne le rejouez pas après le 016,
  vous reviendriez en arrière.
- **012 n'est pas utilisé par l'application.** Elle génère les calendriers en
  JavaScript depuis le panneau admin. La fonction `generer_matchs_competition`
  existe mais n'est jamais appelée.
- **016 avant 017.** Le 016 rejoue les matchs existants avec le nouveau barème ;
  le 017 les supprime. L'inverse n'a pas de sens.
- **017 est destructif.** Il ouvre sur une requête de revue à lancer seule, et
  tourne dans une transaction : le dernier `select` affiche les 12 matchs avant
  que vous décidiez `commit;` ou `rollback;`.

## Edge Function

`functions/admin-create-user/index.ts` — appelée par le panneau admin pour créer
les comptes Auth. Se déploie avec la CLI Supabase, pas par l'éditeur SQL
(voir `SETUP.md`).
