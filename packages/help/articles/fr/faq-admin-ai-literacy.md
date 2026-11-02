---
kind: faq
audience: administrator
topic: ia-et-conformite
title: "Maîtrise de l'IA (AI Act, art. 4) : ce que chaque administrateur doit savoir"
synonyms: [maîtrise de l'ia, ai literacy, ai act, article 4, formation ia, conformité, fournisseurs ia, anthropic, claude, mistral, openai, perplexity, hors ue, redaction, expurgé, eu ai consent, consentement ia ue, garde-fous, ce qu'il ne faut jamais faire]
---
L'article 4 de l'AI Act demande à Jobbbox de soutenir la maîtrise de l'IA de toute personne qui utilise ou règle ses systèmes d'IA pour son compte : vous, dès que vous avez un rôle du back office. Aucun niveau ni certificat n'est exigé. Cet article est la base de cette maîtrise ; lisez-le à votre prise de rôle, avec la note interne « hors Annexe III », et relisez-le quand il change.

**Ce que fait l'IA dans Jobbbox.** L'AI Coach et ses Playbook Agents, les documents rédigés (CV adapté, lettre de motivation, dossier d'entreprise, résumés d'offres), la lecture des CV et des offres, la lecture des emails d'offres, la recherche web et l'assistant du back office. Le Match Score et l'ATS Score reposent sur des règles, pas sur une IA. L'IA peut se tromper : elle aide le candidat, elle ne décide jamais à sa place, et elle ne classe jamais un candidat pour un employeur.

**Les fournisseurs.** Chaque tâche IA a son fournisseur et son modèle, réglés dans Paramètres, onglet « IA ». Claude (Anthropic) est joint par son API directe, hors de l'UE. Mistral AI est dans l'UE. OpenAI, quand il est configuré sans résidence des données dans l'UE, et Perplexity, pour la recherche web, sont hors de l'UE. Le back office marque « hors UE » chaque choix hors de l'UE. Les données de Jobbbox restent stockées dans l'UE ; ce qui peut sortir, c'est le texte d'un appel.

**La Redaction.** Avant qu'un appel parte chez un fournisseur, Jobbbox en retire chaque adresse e-mail et numéro de téléphone, et ce qu'il sait de l'identité du candidat : nom, nom de famille, adresse, e-mail, téléphone. Chacun devient un repère comme « [NOM] ». Le prénom reste, et le reste du CV part : employeurs, postes, dates, formations. Ce sont encore des données personnelles, pseudonymisées et non anonymes. Un nom que Jobbbox ne connaît pas passe, comme celui d'un référent. Ne dites jamais « anonymisé » ni « aucune donnée ne quitte l'UE ».

**La voie Mistral.** Un candidat peut donner son consentement IA UE, daté et retirable dans son compte. Ses appels qui portent son identité vont alors, non expurgés, à Mistral dans l'UE ; sans ce consentement, ils partent expurgés au fournisseur de la tâche. La lecture des emails d'offres reste toujours dans l'UE. Paramètres refuse (`data_residency`) d'envoyer hors de l'UE la voie d'identité ou une tâche réservée à l'UE.

**Les garde-fous.** Ils contrôlent les messages et les réponses de l'AI Coach, des Playbook Agents et de l'assistant, et les emails reçus, avec des règles fixes ou une IA. Ils ne bloquent que ce qu'ils détectent, et laissent passer quand le contrôle par IA est indisponible. En cas de détresse, le candidat reçoit le 3114 et personne n'est alerté. Seuls des playbooks et des messages validés par une personne sont servis en production.

**Ce que vous ne devez jamais faire.**
- Coller dans l'assistant du back office, ou dans un outil d'IA externe, l'e-mail, le message ou le CV d'un candidat.
- Ouvrir un appel dans Activité › Appels IA ou la recherche d'un candidat sans en avoir besoin : chaque ouverture est inscrite dans Actions des administrateurs.
- Valider une version que vous avez écrite, ou valider sur la seule foi d'un score ou d'un avis d'une IA.
- Activer un destinataire hors UE, ou passer une tâche hors de l'UE, sans la version de la politique de confidentialité qui le couvre.
- Écrire un secret ou une donnée personnelle dans un article d'aide, un playbook ou un message de garde-fou.
- Utiliser l'IA de Jobbbox pour classer, trier ou recommander des candidats à un recruteur : ce serait un système à haut risque (voir la note « hors Annexe III »).
- Promettre une sécurité garantie, « UE uniquement » ou « anonymisé ».

En cas de doute, demandez à un super-admin avant d'agir.
