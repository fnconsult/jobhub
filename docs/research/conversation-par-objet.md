# Recherche #587 : pages du Candidate, In view / Focus et contexte IA par objet

Partie de la carte #585 (la conversation avec l'AI Coach comme surface principale, une Coach Conversation par objet). Constat du code au commit `eeed53da` (origin/main, 2026-10-30). Des faits, aucune décision.

Sources : `apps/web/src/coach/context.ts`, `coach/index.ts`, `coach/playbook-agents.ts`, `coach/conversation.ts`, `coach-conversations/index.ts`, `components/CoachPanel.tsx`, `components/CoachConversationList.tsx`, `components/sidebar-nav.ts`, `routes.ts`, les pages sous `app/`, `candidate-data/index.ts`, `ai-activity/index.ts`, `apps/worker/src/jobs.ts`, `docs/privacy/register.md`, `CONTEXT.md`.

## 1. Deux listes de kinds, pas une

| | Kinds | Où |
| --- | --- | --- |
| **In view** (`COACH_FOCUS_KINDS`) | `profile`, `application`, `job_offer`, `job_search`, `job_digest`, `agenda` | `coach/context.ts` ; validé par zod dans `coach/index.ts` et `coach-conversations/index.ts` (`sendSchema`) |
| **Focus** (`FOCUS_KINDS`) | `application`, `job_offer`, `profile` | `coach-conversations/index.ts` ; contrainte `CHECK` sur `coach_message.focus_kind` |

Écart : `job_search`, `job_digest` et `agenda` sont In view (le contexte IA les charge) mais ne sont jamais enregistrés comme Focus d'une réponse (`focusOf` renvoie `null`). AI Activity ne compte donc pas les réponses du coach sur les pages Recherches, Job Digest et Agenda. Le commentaire de `app/api/coach/route.ts` (ligne 15) liste encore cinq kinds, sans `agenda`. `CONTEXT.md` (**Focus**) est aligné sur les trois kinds.

## 2. Par entrée du Sidebar et par objet

Le Sidebar (`components/sidebar-nav.ts`) : Profile switcher, puis Mes candidatures, Agenda, Recherches et Job Digests (seulement si un Profile actif existe), Coachs, puis Espace coach (Human Coach) et Back Office (Administrator) ; Mon compte au pied.

| Entrée / objet | Route | `CoachInView` (kind, id, profileId) | Focus enregistré |
| --- | --- | --- | --- |
| Profile (switcher) | `/profils/[id]` et ses Sections (`ats-score`, `cv-de-reference`, `entreprises-cibles`, `gerer`, `propositions`, `telecharger`) via `(sections)/layout.tsx` | `profile`, id du Profile | `profile` |
| Profile, hors Sections | `/profils/[id]/cv`, `/profils/[id]/versions`, `/versions/[version]`, `/profils/nouveau` | aucun | aucun |
| Mes candidatures (liste) | `/candidatures` | aucun | aucun |
| Application | `/candidatures/[id]` et ses Sections (`offre`, `dossier`, `contacts`, `documents`, `correspondance`, `entretiens`, `propositions`, `avis`) via `[id]/layout.tsx` | `application`, id, `profileId` du Profile de la candidature | `application` |
| Job Offer | `/offres/[id]` (seulement connecté) | `job_offer`, id, sans `profileId` | `job_offer` |
| Agenda | `/agenda` (liste, calendrier, passés) | `agenda`, id fixe `"agenda"` | aucun |
| Recherches | `/recherches?profil=…` | `job_search` (dernière recherche du Profile choisi, `profileId`) ou, s'il n'y en a pas, `profile` | aucun (ou `profile` sans recherche) |
| Job Search | `/recherches/[id]` | `job_search`, id, `profileId` | aucun |
| Job Digests (liste) | `/job-digests` | aucun | aucun |
| Job Digest | `/job-digests/[id]` | `job_digest`, id, `profileId` | aucun |
| Coachs (Human Coach) | `/coachs` | aucun ; pas de kind Human Coach | aucun |
| Accueil | `/` | aucun | aucun |
| Mon compte, Abonnement, Nouveautés | `/compte/…`, `/abonnement`, `/nouveautes` | aucun | aucun |
| Espace coach | `/espace-coach/…` | aucun (côté Human Coach) | aucun |

Une Coaching Session (Human Coach) n'apparaît au coach IA que comme Agenda Item (nom du coach, durée, lien de visio, note), via l'Agenda In view ou les 3 prochains rendez-vous.

## 3. Ce que `coachContext` charge, et son coût

Toujours (`coach/context.ts`) : le Candidate summary (prénom, puis par Profile actif : nom, Search Criteria, séniorité) et la Coach Memory (≤ 30 items × 300 caractères). Puis l'item In view « en entier », puis des résumés : réponses d'onboarding par Profile actif (sauf celui In view), 3 prochains Agenda Items (sauf si l'Agenda est In view), 5 dernières candidatures, top 5 Job Offers (dernière Job Search et dernier Job Digest de chaque Profile actif). Tout ce que le Candidate n'a pas écrit est encadré `<donnees>`.

Plafond : `COACH_CONTEXT_MAX_TOKENS = 12 000` tokens estimés (1 token ≈ 4 caractères) pour **tout le prompt système** ; le contexte reçoit ce qui reste après les instructions + Core Digest et la réserve (2 Playbook Agents max × 825 + 800 de Sources). Rognage : résumés d'abord (offres, puis candidatures, agenda, onboarding), puis l'item In view coupé. Il n'existe pas de mesure par kind ; les chiffres ci-dessous sont des ordres de grandeur tirés de la forme du texte produit.

| Kind In view | Ce qui est chargé | Ordre de grandeur |
| --- | --- | --- |
| `profile` | Nom, Search Criteria, Master CV sans identité (titre, résumé, expériences avec descriptions, formation, compétences, langues) | 1 000 – 3 000 tokens (dépend du CV) |
| `application` | Profile, statut et dates, signalement « offre plus publiée », entretiens (+ notes), Match Score détaillé, Job Offer avec son texte intégral | 1 200 – 3 000 (le texte de l'offre domine) |
| `job_offer` | Job Offer : titre, employeur, contrat, salaire, compétences, expérience, texte intégral | 1 000 – 2 500 |
| `job_search` | Une ligne par résultat (titre, employeur, lieu, score), **tous** les résultats, non bornés | ~30 par résultat |
| `job_digest` | Une ligne par résultat, tous (`JOB_DIGEST_TARGET_COUNT` en réglage) | ~30 par résultat |
| `agenda` | Agenda Items des 30 jours (entretiens, séances avec lien de visio, notes) | ~40 par item |
| aucun | Phrase fixe « ne consulte aucun élément » | ~15 |
| Socle commun | Candidate summary (~60/Profile), Coach Memory (0 – 2 250), résumés (~150 + ~150 + ~120 + 100–300/Profile) | ~500 – 3 000 |

Coach cost target (`CONTEXT.md`) : 0,03 € par réponse, médiane et p90 quotidiennes du Coach Message Cost. Le contexte est recalculé à chaque réponse, et passé aussi à chaque Playbook Agent consulté (`consultPlaybookAgent`). Fenêtre de conversation : 40 derniers messages (`MAX_MESSAGES`), 5 000 caractères max par message.

## 4. Stockage et rattachement aujourd'hui

- Tables `coach_conversation` (id, `candidate_id` → candidate ON DELETE CASCADE, `profile_id` → profile ON DELETE CASCADE, nullable, `title`, `created_at`, `last_message_at`, `ai_disclosure`) et `coach_message` (`conversation_id` ON DELETE CASCADE, auteur, texte, coût, playbooks, consultations, `blocked`, `unchecked`, `job_offer_id` ON DELETE SET NULL, `provenance`, `focus_kind`, `focus_id`). Migration : `migrateCoachConversations`.
- **Rattachement de la conversation** : un seul lien, au Profile, fixé à la création : le Profile In view, ou le `profileId` de la page (Application, Job Search, Job Digest). Rien pour Job Offer ni Agenda. Jamais mis à jour ensuite.
- **Focus** : par réponse du coach, pas par conversation ; `focus_id` sans clé étrangère. Une même conversation peut donc porter des réponses de plusieurs Focus. Lu par `repliesAbout` pour AI Activity (pages Application, Job Offer, Profile).
- **Quelle conversation s'ouvre** : le Coach Panel rouvre la dernière conversation de ce navigateur (id dans `localStorage`, `panel.storageKey`), quelle que soit la page ; la liste (`CoachConversationList`) montre toutes les conversations, la plus récente d'abord, avec « commencée sur le profil … ». Aucune recherche « conversation de cet objet ».
- Un message part sans `conversationId` → nouvelle conversation, titrée par le début du premier message (80 caractères).
- Rétention : `purgeStaleCoachConversations`, 12 mois après le dernier message, job quotidien `coach-conversations.purge` (worker). Human Coaches : aucun accès.
- Le code n'a aucune suppression de Profile (seulement archiver/restaurer), ni de Candidature, Job Search ou Job Digest : les `ON DELETE CASCADE` sur `profile_id` ne jouent qu'à la suppression du compte.

## 5. Export de données et suppression du compte

- **Export** (`candidate-data/index.ts`, `exportCoachConversations`) : `coachConversations[]` avec id, titre, Profile (id, nom), dates, et chaque message (auteur, texte, `sentAt`, `blocked`, `jobOfferId`, Provenance, `focus` limité aux trois kinds). Jamais le coût. `EXPORTED_TABLES` mappe `coach_conversation` et `coach_message`. Coach Memory exportée à part (`coachMemory`).
- **Suppression du compte** : `DELETE FROM candidate` ; tout part en cascade (conversations, messages, Coach Memory). Le journal `ai_message_log` (30 jours, super-admins) contient aussi le contenu des conversations et part avec le compte.
- Ce qui en sort sans lien au Candidate : Unanswered Questions (question + motif de route, ADR-0041) ; un Signalement « Question » garde une copie de la question et de la réponse.

## 6. Écarts relevés

1. In view a six kinds, Focus trois : pas de Focus pour `job_search`, `job_digest`, `agenda`.
2. Pas de kind In view pour : listes Candidatures et Job Digests, Accueil, Coachs (Human Coach), Mon compte, pages CV/versions d'un Profile.
3. Une conversation n'est rattachée qu'à un Profile ; aucun lien conversation → Application, Job Search, Job Digest, Job Offer ou Agenda.
4. `focus_id` sans clé étrangère, `focus_kind` contraint par `CHECK` : ajouter un kind demande une migration.
5. Job Search et Job Digest In view chargent tous leurs résultats sans limite de nombre (seul le plafond global coupe).
6. `/recherches` déclare `profile` quand le Profile n'a pas encore de recherche, `job_search` sinon.
7. Le Coach Panel rouvre la dernière conversation du navigateur, pas celle de la page.
8. Commentaire de `app/api/coach/route.ts` en retard (pas `agenda`).
