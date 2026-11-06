# Recherche #847 : RGPD et AI Act de l'enregistrement, de la transcription et du résumé d'une Coaching Session

Carte : #841. Lu le 2026-11-06 sur `main`. Suite de #842 (l'existant : rien n'existe pendant ni après la séance) et de #843 (UX).

**Ce n'est pas un avis juridique.** Chaque position marquée **[LR]** est à faire valider par la Legal Review (#507) ; celles marquées **[Juriste]** relèvent d'un déclencheur d'avocat au sens de #507. Les termes « Enregistrement de séance », « Transcription » et « Résumé de séance » ne sont pas encore dans `CONTEXT.md` : ils sont employés ici au sens courant et devront être posés par `/domain-modeling` au cadrage (#851).

## Question

À quelles conditions Jobbbox peut-il enregistrer, transcrire et résumer une Coaching Session, et que faut-il demander, dire et garder ?

## Réponse courte

1. **Faisable, sur consentement des deux parties, séance par séance**, avec un signal visible pendant tout l'enregistrement et un arrêt possible à tout moment par l'un ou l'autre. Le consentement est à la fois la condition pénale (C. pén. 226-1) et la base RGPD (art. 6(1)(a)), et, parce qu'une séance de carrière fait presque toujours surgir de la santé, une situation familiale ou syndicale, un **consentement explicite** au sens de l'art. 9(2)(a). Le contrat (art. 6(1)(b)) ne tient pas : une séance se tient très bien sans enregistrement.
2. **Jobbbox est responsable de traitement** de l'enregistrement, de la transcription et du résumé (il choisit l'outil, la durée de conservation, l'IA). Position recommandée pour #518 : **le Human Coach est sous-traitant** (art. 28) pour tout ce qu'il fait dans Jobbbox, et il lui est interdit d'enregistrer ou de garder des notes hors de Jobbbox ; à défaut, il devient responsable distinct de ses propres notes. **[LR]**
3. **AIPD obligatoire avant l'ouverture** : au moins trois critères du CEPD sont réunis (données sensibles ou hautement personnelles, personnes en situation de dépendance, usage innovant de l'IA), et la CNIL inscrit l'accompagnement social sur sa liste.
4. **AI Act** : Jobbbox est fournisseur du résumé. Il doit le **marquer lisiblement par machine** (art. 50(2)), dès sa mise sur le marché (pas de délai jusqu'au 2 décembre 2026 pour un système nouveau). **Aucune émotion ne doit être déduite de la voix ni du visage** : c'est interdit pour le Human Coach, dont la séance est le lieu de travail (art. 5(1)(f)), et haut risque pour le Candidate (annexe III, point 1(c)). Le résumé reste à l'usage du Candidate : hors annexe III, point 4, tant qu'il n'est transmis à aucun employeur ni à une Organisation qui évaluerait.
5. **Transferts** : la transcription et le résumé portent des données que la Redaction ne sait pas retirer (noms prononcés, santé). Position recommandée : **tâches `euOnly`** (ADR-0055), comme la lecture des emails (ADR-0052), visio et transcription dans l'UE. Tout destinataire hors UE de plus est une version substantielle de la politique de confidentialité (ADR-0064), annoncée 30 jours avant (ADR-0072).
6. **Conservation courte, par couche** : audio supprimé dès la transcription faite (7 jours au plus), transcription 30 jours, résumé avec la Coaching Session tant que le Candidate le garde. **[LR]**

## Méthode et limites

- **Le réseau de la session a refusé l'ouverture directe** de `www.legifrance.gouv.fr`, `eur-lex.europa.eu`, `www.cnil.fr` et `artificialintelligenceact.eu` (refus du proxy constaté le 2026-11-06, `connect_rejected` puis `ENOTFOUND`). Conformément à la consigne de la session, aucun autre site n'a été ouvert après ces échecs. Il faut autoriser ces hôtes dans les réglages réseau de l'environnement pour vérifier les textes.
- En conséquence, chaque source est marquée :
  - **[extrait]** : lu le 2026-11-06 dans les extraits renvoyés par le moteur de recherche, page officielle quand c'était possible ;
  - **[repris]** : lu dans une recherche antérieure du dépôt (`issue-318.md`, branche `research/issue-497`, `issue-496.md`), avec la date de cette lecture ;
  - **[non ouvert]** : cité de connaissance, page officielle non ouverte, **à vérifier avant toute publication**.
- Rien n'a été lu dans le texte officiel du Journal officiel ni sur Légifrance aujourd'hui. Les citations d'articles sont des paraphrases fidèles, pas des citations littérales.

## Sources

| # | Texte | URL | Statut (2026-11-06) |
|---|---|---|---|
| S1 | Code pénal, art. 226-1 (atteinte à l'intimité de la vie privée) | https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006070719 (Code pénal ; lien direct vers l'article non vérifié) | [non ouvert] ; contenu confirmé par [extrait] : https://www.assemblee-nationale.fr/dyn/13/questions/QANR5L13QE17430.pdf, https://www.lagbd.org/Enregistrement_d%27une_personne_%C3%A0_son_insu_et_violation_de_la_vie_priv%C3%A9e:_est-ce_l%C3%A9gal_%3F_(fr) |
| S2 | Code pénal, art. 226-2 (conservation, divulgation, utilisation) et 226-19 (données sensibles sans consentement exprès) | https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006070719 (Code pénal) | [non ouvert] |
| S3 | RGPD, règlement (UE) 2016/679 : art. 4(11), 4(14), 5, 6, 7, 9, 12 à 22, 26, 28, 30, 35, 44 à 49 ; cons. 51 | https://eur-lex.europa.eu/eli/reg/2016/679/oj/fra | [non ouvert] (EUR-Lex refusé ; déjà vide pour notre outil le 2026-10-29, `issue-497`) |
| S4 | AI Act, règlement (UE) 2024/1689 : art. 3(39), 4, 5(1)(f), 50, annexe III points 1(c) et 4 ; Omnibus 2026/1744 | https://eur-lex.europa.eu/eli/reg/2024/1689/oj/fra | [repris] d'`issue-497` (lu le 2026-10-29 sur artificialintelligenceact.eu, miroir du JO) ; [non ouvert] aujourd'hui |
| S5 | Commission, lignes directrices sur les pratiques interdites, C(2025) 5052, 29 juillet 2025 (« LD5 ») | https://ai-act-service-desk.ec.europa.eu/sites/default/files/2025-08/guidelines_on_prohibited_artificial_intelligence_practices_established_by_regulation_eu_20241689_ai_act_english_ied3r5nwo50xggpcfmwckm3nuc_112367-1.PDF | [repris] d'`issue-497` (lu en entier le 2026-10-29) pour LD5 250-251 ; [extrait] pour le recrutement : https://www.twobirds.com/en/insights/2025/global/ai-and-the-workplace-navigating-prohibited-ai-practices-in-the-eu, https://www.paulhastings.com/insights/client-alerts/european-commission-and-ai-guidelines-on-prohibited-practices, https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/ |
| S6 | Commission, lignes directrices art. 50, C(2026) 5054, 20 juillet 2026 (« LD50 ») | https://ec.europa.eu/newsroom/dae/redirection/document/131215 | [repris] d'`issue-318` (2026-10-23) et `issue-497` ; exception « édition standard » : [extrait] https://www.paulweiss.com/media/204bwi3d/eu_finalises_transparency_rules_for_ai_generated_content.pdf |
| S7 | Commission, projet de lignes directrices sur la classification haut risque (19 mai 2026), exemples emploi | https://ai-act-service-desk.ec.europa.eu/en/employment-0 | [repris] d'`issue-318` et `issue-497` |
| S8 | CNIL, liste des traitements pour lesquels une AIPD est requise (délibération 2018-327 du 11 octobre 2018) | https://www.cnil.fr/fr/liste-traitements-aipd-requise ; PDF : https://www.cnil.fr/sites/default/files/atoms/files/liste-traitements-avec-aipd-requise-v2.pdf | [extrait] (entrée « accompagnement social ou médico-social des personnes » confirmée par l'extrait du PDF) |
| S9 | CNIL, « Gérer les risques » (critères du CEPD, seuil de deux critères) | https://www.cnil.fr/fr/gerer-les-risques | [extrait] |
| S10 | CEPD (ex-G29), lignes directrices AIPD WP248 rév. 01 | https://ec.europa.eu/newsroom/article29/items/611236 | [non ouvert] |
| S11 | CNIL, « L'écoute et l'enregistrement des appels sur le lieu de travail » (repères : 6 mois pour l'enregistrement, 1 an pour les comptes rendus) | https://www.cnil.fr/fr/lecoute-et-lenregistrement-des-appels-sur-le-lieu-de-travail | [extrait] |
| S12 | CEPD, lignes directrices 07/2020 sur responsable de traitement et sous-traitant (v2, 7 juillet 2021) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_fr | [non ouvert] ; teneur : [extrait] https://www.hunton.com/privacy-and-cybersecurity-law-blog/edpb-publishes-guidelines-on-the-concepts-of-controller-and-processor-in-the-gdpr |
| S13 | CJUE C-210/16 *Wirtschaftsakademie*, C-25/17 *Jehovan todistajat*, C-40/17 *Fashion ID* (responsabilité conjointe sans accès aux données) | https://curia.europa.eu/juris/liste.jsf?num=C-40/17 | [non ouvert] ; teneur : [extrait] https://www.europeanlawblog.eu/pub/fashion-id-introducing-a-phase-oriented-approach-to-data-protection |
| S14 | CJUE C-184/20 *OT* (1er août 2022) et C-21/23 *Lindenapotheke* (4 octobre 2024) : données révélant indirectement une donnée sensible | https://curia.europa.eu/juris/liste.jsf?num=C-184/20 | [non ouvert] |
| S15 | CEPD, lignes directrices 05/2020 sur le consentement et 2/2019 sur l'art. 6(1)(b) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_fr | [non ouvert] |
| S16 | Décision d'adéquation UE–États-Unis (DPF) 2023/1795 ; Tribunal UE, T-553/23 *Latombe*, 3 septembre 2025 (recours rejeté) | https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj | [non ouvert] ; arrêt : [extrait] https://www.lewissilkin.com/en/insights/2025/09/03/transatlantic-trouble-not-this-time-latombes-challenge-to-eu-us-data-transfers-fails |
| S17 | Clauses contractuelles types, décision 2021/914 ; CEPD, recommandations 01/2020 (mesures supplémentaires) | https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj | [non ouvert] |
| S18 | CNIL, visioconférence et IA dans les réunions (pas d'activation à l'insu) | https://tpeactu.fr/2026/08/11/ia-reunion-teams-rgpd-ai-act/ | [extrait] **tiers**, la fiche CNIL elle-même n'a pas été trouvée |
| S19 | Code civil, art. 9 (vie privée, image et voix) | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419288 | [non ouvert] |

Dépôt lu : #847, #518, #507, #337 (`gh api`), `CONTEXT.md` (**EU AI Consent**, **Redaction**, **AI disclosure**, **Human Coach**, **Coaching Session**, **Coach Access**, **Coach space**, **Data export**, **Legal Review**, **Recipient list**), ADR-0007 (et ses amendements du 2026-10-20 et du 2026-10-28), ADR-0064, `docs/privacy/register.md` (« Human Coaches and Coaching Sessions », « AI Message Log », « Coach Conversations »), `docs/research/issue-318.md`, `issue-843.md`, branches `research/issue-497`, `research/issue-496` (§7, point juriste n° 8), `research/issue-842`, `research/issue-848`. `packages/help/legal/*` ne contient encore aucune version publiée.

## 1. Ce que l'on veut faire, et ce qui existe

| Couche | Donnée | Personnes | Aujourd'hui |
|---|---|---|---|
| Visio | Image, voix, échanges en direct | Candidate, Human Coach | Hors Jobbbox : `video_link` libre (Zoom, Meet…), choisi au cas par cas (#842) |
| Enregistrement | Fichier audio (voire vidéo) | Les deux, et les tiers cités | Rien |
| Transcription | Texte intégral, horodaté, par locuteur | Idem | Rien |
| Résumé de séance | Texte généré par IA : points abordés, pistes, actions | Idem, surtout le Candidate | Rien |
| Notes du coach | Texte libre du Human Coach | Candidate | Rien ; la note de séance existante est au Candidate seul (`CONTEXT.md`, **Coaching Session**) |

Conséquence d'architecture : **on ne peut enregistrer qu'une séance qui se tient dans un outil que Jobbbox choisit** (salle visio intégrée, ou robot d'enregistrement qui rejoint la salle). Un lien Zoom quelconque saisi par le coach ne permet ni le recueil du consentement, ni le signal visible, ni la maîtrise de la conservation. Cela amende ADR-0016 et ADR-0027 (le lien visio libre) : **à signaler au cadrage**.

## 2. Consentement à l'enregistrement

### 2.1 Code pénal

- **226-1, 1°** punit d'un an d'emprisonnement et de 45 000 € d'amende le fait de capter, enregistrer ou transmettre, **sans le consentement de leur auteur**, des paroles prononcées à titre privé ou confidentiel ; le 2° vise l'image d'une personne dans un lieu privé. Une séance de coaching individuelle est à l'évidence un échange **confidentiel** (S1).
- **Consentement présumé** (226-1, dernier alinéa) : quand l'enregistrement est fait « au vu et au su » des intéressés sans qu'ils s'y soient opposés alors qu'ils le pouvaient. La réponse ministérielle citée en S1 précise qu'il ne peut être présumé si la personne **ne pouvait pas refuser**. Jobbbox ne doit pas s'appuyer sur cette présomption : le RGPD exige de toute façon un acte positif (art. 4(11)), et un coach prestataire de Jobbbox peut se sentir contraint (voir 2.3).
- **226-2** punit en outre la conservation, la divulgation ou l'utilisation d'un enregistrement obtenu ainsi : un enregistrement sans consentement est fautif **à chaque étape**, transcription et résumé compris (S2).
- **226-19** punit le traitement de données sensibles **sans consentement exprès** (5 ans, 300 000 €) hors des cas prévus par la loi : c'est le pendant pénal de l'art. 9 RGPD (S2, [non ouvert]).
- **Les participants eux-mêmes** : le Candidate qui enregistre le coach avec son téléphone, ou l'inverse, tombe sous 226-1. Les CGU et le contrat B2B doivent l'interdire (§9).

### 2.2 Ce que le parcours doit faire

| Exigence | Source | Traduction produit |
|---|---|---|
| Consentement de **chaque** participant, avant que la captation ne commence | 226-1 ; RGPD art. 4(11), 7 | Deux accords distincts, Candidate et Human Coach, recueillis dans Jobbbox **pour cette séance** ; l'enregistrement ne démarre qu'après les deux |
| Libre : refuser ne coûte rien | RGPD art. 7(4) ; S15 | Même prix, même durée, même séance sans enregistrement ; la case n'est jamais cochée d'avance ; pas de relance insistante |
| Éclairé, par couche | RGPD art. 12, 13 | Au moment du choix : ce qui est enregistré (audio seul ou vidéo), ce qui en est fait (transcription, résumé par IA), qui le lit, combien de temps, où (UE ou non), comment retirer ; lien vers la politique de confidentialité |
| Spécifique et explicite pour les données sensibles | RGPD art. 9(2)(a) | Une phrase dédiée : « la séance peut aborder votre santé ou votre vie familiale ; le résumé pourra en garder trace » ; consentement par un geste distinct, pas noyé dans l'Acceptance des CGU |
| Révocable à tout moment, aussi simplement que donné | RGPD art. 7(3) | Bouton « Arrêter l'enregistrement » visible des deux côtés pendant toute la séance ; le retrait arrête la captation pour les deux |
| Visible pendant l'enregistrement | 226-1 (« au vu et au su ») ; loyauté art. 5(1)(a) ; S18 | Témoin permanent « Enregistrement en cours » (point rouge + texte, pas la couleur seule : ADR-0009), annonce au démarrage et à l'arrêt |
| Preuve | RGPD art. 7(1) | Garder, par séance et par participant : version du texte d'information, date et heure de l'accord, du retrait éventuel ; sans IP brute (même logique que les Acceptances, ADR-0073) |

**Positions à valider [LR]** :

- **P1.** Consentement **par séance**, pas une fois pour toutes : la séance suivante peut porter sur un sujet plus intime. Un réglage « me proposer l'enregistrement par défaut » reste possible s'il ne coche rien d'avance.
- **P2.** Le sort de ce qui a déjà été enregistré quand l'un retire son accord en cours de séance. Proposition : la captation s'arrête ; la partie enregistrée n'est transcrite et résumée que si le Candidate le confirme à la fin, et elle est **supprimée si c'est le Human Coach qui a retiré** son accord. Le retrait n'a pas d'effet rétroactif sur la licéité (art. 7(3)) mais ouvre l'effacement (art. 17(1)(b)).
- **P3.** Audio seul plutôt que vidéo : l'image n'apporte rien à un résumé (minimisation, art. 5(1)(c)) et ajoute le 2° de 226-1 et le droit à l'image (C. civ. art. 9, S19).

### 2.3 Le consentement du Human Coach

Le Human Coach est un prestataire de Jobbbox : son consentement peut être jugé **non libre** s'il craint de perdre des séances en refusant (CEPD 05/2020 sur les rapports de dépendance, S15). D'où :

- **P4 [LR]** : le contrat B2B (#518) dit expressément que refuser l'enregistrement n'a **aucune conséquence** (ni rémunération, ni classement, ni sélection), et Jobbbox ne mesure pas le taux d'acceptation par coach. Sans cela, la base de l'intérêt légitime (art. 6(1)(f)) pour la part du coach pourrait être discutée, mais elle ne lève pas l'exigence pénale de 226-1, qui reste un consentement.

## 3. RGPD

### 3.1 Base légale, par couche

| Traitement | Base proposée | Pourquoi pas une autre |
|---|---|---|
| Enregistrement, transcription, résumé | **Consentement** (art. 6(1)(a)) **explicite** (art. 9(2)(a)) de chaque participant | Le contrat (6(1)(b)) suppose que le traitement soit **nécessaire** à la séance vendue (CEPD 2/2019, S15) : il ne l'est pas. L'intérêt légitime ne couvre pas les données sensibles (art. 9 n'en fait pas une exception) |
| Preuve du consentement | Obligation légale (art. 6(1)(c), art. 7(1)) | |
| Notes du coach dans Jobbbox | Contrat (6(1)(b)) avec le Candidate, si la prise de notes fait partie de la prestation vendue ; consentement explicite si elles peuvent porter des données sensibles | **[LR]** : à trancher avec P8 |

### 3.2 Données sensibles (art. 9)

- Une séance de carrière d'un public de plus de 40 ans fait souvent surgir : un arrêt maladie, un burn-out, un handicap (RQTH), une grossesse, un divorce, un proche aidé, un mandat syndical, une religion (contraintes d'horaires), une procédure aux prud'hommes. Toutes relèvent de l'art. 9(1) (santé, appartenance syndicale, convictions) ou sont **hautement personnelles**.
- La CJUE juge qu'une donnée qui **révèle indirectement** une donnée sensible est sensible (C-184/20 *OT*), et qu'un traitement mêlant des données sensibles à d'autres tombe sous l'art. 9 sans qu'il faille les trier (C-21/23 *Lindenapotheke*) (S14, [non ouvert]). **Une transcription et un résumé de séance sont donc à traiter comme sensibles par défaut.**
- **La voix n'est pas une donnée biométrique** au sens de l'art. 4(14) tant qu'elle n'est pas traitée par un moyen technique spécifique pour identifier la personne de façon unique (cons. 51, S3). Une **diarisation** (séparer « coach » et « candidat ») ne doit donc **pas** reposer sur une empreinte vocale : deux pistes audio séparées par participant suffisent et évitent la biométrie. **P5 [LR]**.

### 3.3 Minimisation (art. 5(1)(c), 25)

- Audio seul (P3) ; pas d'enregistrement de la vidéo, ni du partage d'écran.
- Le résumé ne garde que ce qui sert au Candidate : thèmes, conseils, actions convenues. Les consignes de la tâche (Task Playbook, ADR-0026) lui interdisent de reprendre un diagnostic, un état de santé, une émotion ou un jugement sur la personne, sauf si le Candidate le demande explicitement. **P6 [LR]**.
- Les tiers nommés (ancien manager, recruteur, conjoint) : les remplacer dans le résumé par leur rôle (« votre ancien manager »). C'est aussi la limite connue de la Redaction (les noms que Jobbbox ne connaît pas passent, ADR-0007).
- **AI Message Log** : il garde 30 jours ce qui a été envoyé à l'IA (ADR-0007, addendum #218). Pour la transcription, ce serait une **seconde copie intégrale** de la séance, lisible par les super-admins. Proposition : ne pas y garder le texte des tâches de séance, seulement leurs métadonnées. **P7 [LR]**.

### 3.4 Conservation (art. 5(1)(e))

Aucun texte ne fixe de durée pour un enregistrement de coaching. Le seul repère CNIL proche est celui de l'enregistrement des appels au travail : **6 mois** pour l'enregistrement, **1 an** pour les comptes rendus (ancienne norme NS 57, sans valeur juridique depuis 2018, toujours citée, S11). Jobbbox n'a besoin de l'audio que pour produire la transcription.

| Objet | Proposition **[LR]** | Justification |
|---|---|---|
| Audio | Supprimé dès que la transcription est faite, **7 jours au plus** après la séance (en cas d'échec de la transcription) | Seule finalité : transcrire. Le plus risqué (voix, ton, tout ce qui a été dit) |
| Transcription | **30 jours**, pour que le Candidate relise et corrige le résumé ; puis supprimée. Le Candidate peut la supprimer plus tôt | Texte intégral, sensible ; utile seulement pour vérifier le résumé |
| Résumé de séance | Avec la Coaching Session, **tant que le Candidate le garde** ; supprimé avec le compte ; supprimable à tout moment | C'est l'objet que le Candidate veut garder ; même logique que ses autres documents |
| Notes du coach | Le temps de la relation de coaching ; au plus **12 mois** après la dernière séance (comme une Coach Conversation) ; supprimées avec le compte du Candidate | Durée de l'accompagnement |
| Preuve des consentements | Durée de prescription de l'action utile (5 ans, comme l'Acceptance des CGU, ADR-0073) | Prouver la licéité |

Un Retired Human Coach perd tout accès (comme aujourd'hui), y compris à ses notes.

### 3.5 Droits

- **Information** (art. 13) : au point de collecte (2.2) et dans la politique de confidentialité (§9).
- **Accès et portabilité** (art. 15, 20) : l'audio encore conservé, la transcription et le résumé entrent dans le **Data export** (« Every table tied to a Candidate must land in it », `CONTEXT.md`). L'audio, volumineux, peut y figurer par un lien de téléchargement temporaire. **Art. 15(4)** : la voix et les propos du Human Coach sont aussi ses données ; leur remise au Candidate qui y a participé ne porte pas atteinte à ses droits, mais **les notes du coach** peuvent contenir son appréciation professionnelle : **[LR]** sur leur inclusion dans le Data export du Candidate (position par défaut : oui, ce sont des données sur le Candidate).
- **Rectification** (art. 16) : le Candidate peut corriger ou annoter le résumé ; une IA peut se tromper.
- **Effacement** (art. 17) : par séance et en bloc ; automatique au retrait du consentement (P2) et à l'Account deletion.
- **Le Human Coach** a les mêmes droits sur sa voix et ses propos : accès sur demande au support, effacement de **sa** piste audio au retrait de son accord.
- **Pas de décision automatisée** (art. 22) : le résumé ne décide rien.

### 3.6 Registre et AIPD

**Registre** (`docs/privacy/register.md`) : une nouvelle entrée « Enregistrement, transcription et résumé des Coaching Sessions », distincte de « Human Coaches and Coaching Sessions », et une ligne par nouveau destinataire dans la table « Recipients and their entries » (le test `privacy-register.test.ts` l'exige). L'entrée « Human Coaches and Coaching Sessions » doit être reprise pour la qualification du coach (#518).

**AIPD (art. 35)** : **obligatoire avant la mise en production.**

- **Critères du CEPD** (WP248, S10, repris par la CNIL, S9 : deux critères justifient vivement une AIPD) :
  - données sensibles ou à caractère hautement personnel : **oui** (3.2) ;
  - personnes vulnérables ou en situation de déséquilibre : **probablement oui** (demandeurs d'emploi de plus de 40 ans, parfois en détresse ; le Guardrail de détresse d'ADR-0022 l'atteste) ;
  - usage innovant : **oui** (transcription et résumé par IA générative) ;
  - croisement de données : **possible** si le résumé alimente le Coach context ou la Coach Memory ;
  - grande échelle : non au lancement.
- **Liste CNIL** (délibération 2018-327, S8) : elle vise les traitements « ayant pour finalité l'accompagnement social ou médico-social des personnes ». Un coaching de retour à l'emploi n'est pas un accompagnement social au sens strict, mais il s'en approche. **[LR]**, sans enjeu pratique puisque les critères suffisent.
- L'AIPD doit couvrir aussi la visio si elle devient un outil de Jobbbox. Elle peut s'appuyer sur celle de la lecture des emails (#453), même structure.

## 4. Qui est responsable : Jobbbox, le Human Coach (#518)

### 4.1 Les critères

- Le responsable détermine les **finalités et les moyens essentiels** (art. 4(7)) : quelles données, combien de temps, qui y accède. Le sous-traitant traite **pour le compte** du responsable, sur instruction documentée (art. 28(3)), et peut choisir des moyens non essentiels (S12).
- La **responsabilité conjointe** (art. 26) naît d'une décision commune ou de décisions convergentes sur les finalités et les moyens ; elle n'exige pas que chacun accède aux données, et elle peut ne couvrir qu'une **phase** du traitement (*Wirtschaftsakademie*, *Jehovan todistajat*, *Fashion ID*, S13).
- Un sous-traitant qui traite les données **pour ses propres finalités** devient responsable de ce traitement (art. 28(10)).

### 4.2 Application

| Traitement | Qui fixe finalités et moyens | Qualification proposée |
|---|---|---|
| Enregistrement, transcription, résumé | Jobbbox (outil, IA, durées, accès) | **Jobbbox responsable** ; le coach n'y décide rien |
| Lecture des Profiles et Applications sous Coach Access | Jobbbox (périmètre, lecture seule) pour exécuter la séance que **Jobbbox vend** | **Coach sous-traitant** (art. 28) |
| Notes du coach **dans Jobbbox** | Jobbbox (où, combien de temps, qui lit), le coach en choisit le contenu (moyen non essentiel) | **Coach sous-traitant** |
| Notes ou enregistrement **hors Jobbbox** (carnet, logiciel du coach) | Le coach | Le coach serait **responsable distinct** : à interdire par contrat (P8) |
| Méthode de coaching propre au coach, fichier client personnel | Le coach | Responsable distinct ; hors périmètre si interdit |

**Position recommandée P8 [LR], à reprendre dans #518** : Jobbbox est **seul responsable**, le Human Coach **sous-traitant** pour tout ce qu'il fait dans Jobbbox. Le contrat B2B porte les clauses de l'art. 28(3) et interdit au coach d'enregistrer, de garder des notes ou de copier des données des Candidates hors de Jobbbox, et de les réutiliser (prospection, autre client). Cela colle au modèle actuel : Jobbbox vend, fixe le prix, encaisse, le coach est son prestataire (`issue-496` §7 ; #842 conclusion 1).

- **Ce qui ferait basculer vers la responsabilité conjointe** : un coach qui vend ses propres offres ou masterclasses (#848, option B « place de marché »), qui fixe ses durées de conservation, ou qui garde un fichier client pour lui. Si la carte #841 retient la place de marché, la qualification est **à reprendre** : chaque coach responsable de son activité, Jobbbox responsable de la plateforme, accord art. 26 pour la phase commune. **[Juriste]** si ce basculement est décidé.
- **Notes du coach : qui en est responsable ?** Jobbbox, dans la position P8. Le coach en est l'auteur, pas le responsable. Le Candidate y a accès (3.5).
- **AI Act art. 4 (maîtrise de l'IA)** : si le coach lit ou corrige le résumé produit par l'IA, il agit **pour le compte** de Jobbbox : le devoir de maîtrise de l'IA s'étend à lui (`issue-497` le marquait **Juriste**). Une courte formation (ce que fait le résumé, ses erreurs, ce qu'il ne faut pas en déduire) dans l'aide « Espace coach » y répond. **P9 [LR]**.

## 5. AI Act

### 5.1 Rôle

Jobbbox met le résumé de séance sur le marché sous son nom : il est **fournisseur** (art. 3(3) ; LD50 (11), S6), même sur le modèle d'un tiers. Le Human Coach, s'il lit le résumé dans le Coach space, agit sous l'autorité de Jobbbox : il n'est pas un déployeur distinct.

### 5.2 Art. 50 : information et marquage (#337)

- **50(1)** (interaction avec une IA) : ne vise pas le résumé, qui n'est pas une conversation. Rien de plus que l'AI disclosure existante.
- **50(2)** (marquage des contenus générés) : le **résumé** est un texte généré : il doit être **marqué dans un format lisible par machine** et détectable (S4, S6). Il entre dans le dispositif décidé par #337 (attribut sur l'élément HTML, métadonnées dans les exports DOCX et PDF).
  - **Calendrier** : le délai au 2 décembre 2026 ne vaut que pour les systèmes **déjà sur le marché avant le 2 août 2026** (`issue-318` §1, `issue-497`). Un résumé de séance lancé en 2027 doit être marqué **dès son lancement**.
  - **La transcription** : une transcription fidèle de la parole peut relever de l'exception des systèmes qui « n'altèrent pas substantiellement » les données d'entrée ; les lignes directrices finales y rangent la traduction (S6, [extrait]). Un résumé, lui, n'en relève pas. **P10 [LR]** : marquer aussi la transcription par prudence, le coût est nul une fois #337 livré.
- **Mention visible** : non exigée par 50(2) pour un texte remis au seul Candidate, mais due par **loyauté** (RGPD art. 5(1)(a)) et contre l'allégation trompeuse (C. conso. L121-2, `issue-497`) : « Résumé rédigé par une IA à partir de la transcription. Il peut contenir des erreurs : relisez-le. » **P11 [LR]**.
- **50(4)** : sans objet (rien n'est publié pour informer le public).

### 5.3 Art. 5(1)(f) : reconnaissance des émotions

- L'interdiction vise la mise sur le marché, la mise en service et l'utilisation de systèmes d'IA pour **inférer les émotions** d'une personne **sur le lieu de travail et dans les établissements d'enseignement**, sauf raisons médicales ou de sécurité (S4).
- Elle ne vise que les systèmes fondés sur des **données biométriques** (art. 3(39)) : une inférence tirée d'un **texte écrit** en sort (LD5 250-251, `issue-497` §4.4). Mais **la voix et le visage sont des données biométriques au sens de l'AI Act** pour ce qui est d'en déduire des émotions : analyser le **ton** de l'audio, c'est de la reconnaissance des émotions.
- **S'applique-t-elle à un service de coaching pour demandeurs d'emploi ?**
  - **Pour le Human Coach : oui.** La séance est **son lieu de travail** (virtuel), et les lignes directrices lisent « lieu de travail » largement, physique ou virtuel, sur toute la relation de travail (S5, [extrait]). Qu'il soit indépendant plutôt que salarié ne l'exclut pas clairement : les extraits lus n'en disent rien. **[Juriste]** si un jour une analyse du coach est envisagée. Toute mesure de « qualité » du coach tirée de sa voix ou de son visage est **interdite**.
  - **Pour le Candidate : probablement non au titre de l'interdiction**, avec deux réserves. (1) Les lignes directrices citent l'usage pendant le **recrutement** comme interdit (S5, [extrait]) : un Candidate en coaching n'est pas en recrutement chez Jobbbox, mais une simulation d'entretien analysée pour un employeur le serait. (2) Si Jobbbox devenait un organisme de formation (financement CPF, outplacement d'une Organisation), on se rapprocherait de l'« établissement d'enseignement » (la formation professionnelle y est incluse selon les lignes directrices, [non vérifié]). **[LR]**
  - **Hors interdiction**, la reconnaissance des émotions reste un système **à haut risque** (annexe III, point 1(c)) et impose au déployeur d'informer les personnes (art. 50(3)). Ce serait un tout autre produit.
- **Position P12 [LR]** : **le résumé est produit à partir du seul texte de la transcription** ; l'audio ne va à aucun modèle autre que celui de transcription ; aucune analyse du ton, du rythme, des silences ni du visage ; les consignes du résumé lui interdisent de qualifier l'état émotionnel de l'un ou l'autre (« le candidat semblait stressé »), ce qui sert aussi la minimisation (P6). Le contrat du fournisseur de transcription doit exclure toute analyse de sentiment ou d'émotion activée par défaut.

### 5.4 Annexe III, point 4 (emploi)

- Le point 4(a) vise les systèmes destinés au **recrutement ou à la sélection** (annonces ciblées, filtrage, évaluation des candidats) ; le 4(b), les décisions sur la relation de travail, dont l'**évaluation de la performance et du comportement**. Le projet de lignes directrices met hors champ les outils **à l'initiative du candidat** dont le résultat n'est partagé qu'avec lui (S7 ; `issue-497`).
- **Un résumé à l'usage du seul Candidate reste hors champ.** Il basculerait vers le haut risque s'il était :
  - transmis à un **employeur** ou à un recruteur (recommandation, « fiche candidat ») ;
  - lu par une **Organisation** (outplacement, ADR-0004) pour évaluer ou orienter ses bénéficiaires ;
  - utilisé pour **noter** le Candidate (« employabilité », « prêt pour l'entretien ») ;
  - utilisé pour **évaluer le Human Coach** (4(b), s'il est dans une relation de travail au sens du texte).
- **Position P13 [LR]** : le résumé n'évalue pas, ne note pas et ne classe pas ; il n'est partagé qu'à l'initiative du Candidate avec son Human Coach ; ni une Organisation ni un employeur n'y accèdent. Tout changement est un déclencheur **[Juriste]**. Calendrier : annexe III applicable au 2 décembre 2027 (Omnibus, `issue-318`).

## 6. Transferts hors UE (ADR-0007, ADR-0064)

- Aujourd'hui, la règle d'ADR-0007 (amendée le 2026-10-28) permet d'envoyer une tâche avec données personnelles **hors UE après Redaction**, sauf les tâches `euOnly` (lecture des emails, ADR-0052) et la voie d'identité.
- **La Redaction ne protège pas une transcription** : les noms prononcés (le Candidate par son coach, les tiers) ne sont pas ceux que Jobbbox connaît sous leur forme écrite, la parole transcrite les orthographie mal, et le contenu le plus sensible (santé, famille) n'est pas un identifiant. Une transcription expurgée reste une donnée sensible pseudonymisée.
- **Position P14 [LR]** : déclarer la **transcription** et le **résumé de séance** comme tâches **`euOnly`** (ADR-0055), refusées hors UE dans Paramètres comme la lecture des emails ; visio et enregistrement **dans l'UE** (auto-hébergés chez l'hébergeur actuel, ou un fournisseur de l'EEE dont la résidence est établie). C'est cohérent avec la raison même d'ADR-0052. **C'est un ajout à ADR-0007, à écrire en amendement** au cadrage.
- **Si un destinataire hors UE est retenu malgré tout** (fournisseur de visio ou de transcription américain) :
  - base de transfert : décision d'adéquation **DPF** (2023/1795, maintenue par le Tribunal dans *Latombe*, T-553/23, 3 septembre 2025 ; pourvoi possible devant la Cour, non vérifié) si le fournisseur est certifié, sinon **clauses contractuelles types** (2021/914) avec analyse d'impact du transfert (CEPD 01/2020) (S16, S17) ;
  - **ADR-0064** : c'est une **version substantielle** de la politique de confidentialité, publiée avant d'allumer le Tool, annoncée par le Préavis 30 jours avant (ADR-0072), et le Tool déclaré dans `recipients_outside_eu` et dans le Tool catalog (`packages/shared/src/tools.ts`) avec ses champs publics ;
  - à éviter pour l'audio : aucune Redaction n'est possible sur une voix.
- Le Tool catalog ne connaît aujourd'hui **aucun fournisseur de visio ni de transcription** (#842) : chacun sera un nouveau Tool, avec sa ligne au registre et sur la Recipient list.

## 7. Première passe `/legal:compliance-check`

### 7.1 Obligations

| # | Obligation | Texte | État | Priorité |
|---|---|---|---|---|
| O1 | Consentement de chaque participant avant la captation, par séance | C. pén. 226-1 ; RGPD 6(1)(a), 7 | À construire | Bloquant |
| O2 | Consentement explicite pour les données sensibles | RGPD 9(2)(a) ; C. pén. 226-19 | À construire | Bloquant |
| O3 | Retrait à tout moment, signal visible pendant l'enregistrement | RGPD 7(3), 5(1)(a) ; 226-1 | À construire | Bloquant |
| O4 | Information au point de collecte et dans la politique | RGPD 12, 13 | À rédiger | Bloquant |
| O5 | AIPD avant la mise en production | RGPD 35 ; liste CNIL | À faire | Bloquant |
| O6 | Entrée au registre et lignes des nouveaux destinataires | RGPD 30 | À rédiger | Bloquant (test CI) |
| O7 | Durées de conservation par couche, purge automatique | RGPD 5(1)(e) | À décider (§3.4) | Bloquant |
| O8 | Data export et effacement des trois objets | RGPD 15, 17, 20 | À construire | Bloquant |
| O9 | Contrat art. 28 avec le Human Coach (ou art. 26) | RGPD 26, 28 | #518 ouvert | Bloquant |
| O10 | Contrats art. 28 et base de transfert des fournisseurs visio et transcription | RGPD 28, 44-49 | Aucun fournisseur choisi | Bloquant |
| O11 | Marquage lisible par machine du résumé, dès le lancement | AI Act 50(2) | Dépend de #337 | Bloquant |
| O12 | Aucune inférence d'émotion à partir de la voix ou du visage | AI Act 5(1)(f) ; annexe III 1(c) | Exigence de conception | Bloquant |
| O13 | Maîtrise de l'IA des Human Coaches qui lisent le résumé | AI Act 4 | À rédiger (aide) | Élevée |
| O14 | Pas d'usage du résumé pour évaluer, noter ou transmettre à un employeur | AI Act annexe III 4 | Exigence de conception | Élevée |
| O15 | Interdire aux participants d'enregistrer eux-mêmes | C. pén. 226-1, 226-2 | CGU et contrat B2B | Élevée |

### 7.2 Risques

| Risque | Probabilité | Gravité | Réponse |
|---|---|---|---|
| Enregistrement démarré sans l'accord de l'un (bug, accord donné à la séance précédente) | Moyenne | Pénale (226-1, 226-2) et RGPD | Démarrage côté serveur conditionné aux deux accords de **cette** séance ; test E2E dédié |
| Consentement du coach jugé contraint | Moyenne | Base invalide pour sa part | P4, aucune mesure par coach |
| Transcription envoyée hors UE avec des noms et de la santé | Élevée sans P14 | Transfert illicite, données sensibles | P14 `euOnly` |
| Copie intégrale dans l'AI Message Log | Certaine sans P7 | Conservation excessive, accès super-admin | P7 |
| Le résumé reprend une maladie, un conflit, un jugement | Élevée | Données sensibles, préjudice | P6, consignes, relecture par le Candidate, rectification |
| Le résumé se trompe (attribution d'une phrase, fausse action) | Élevée | Loyauté, confiance | P11, édition par le Candidate |
| Fonction « analyse du ton » ajoutée plus tard, ou activée chez le fournisseur | Faible | **Pratique interdite** (amende jusqu'à 35 M€ ou 7 %, art. 99 AI Act, [non ouvert]) | P12, clause contractuelle, Guardrail de conception |
| Résumés partagés à une Organisation B2B | Faible aujourd'hui | Haut risque annexe III 4 | P13, déclencheur **[Juriste]** |
| Coach qui garde des notes ou des enregistrements chez lui | Moyenne | Responsable distinct non encadré, fuite | P8, clause, audit léger |
| Fuite de l'audio | Faible | Très grave | Audio supprimé vite (§3.4), chiffré au repos, aucun lien public durable |

### 7.3 Positions à valider dans la Legal Review (#507)

P1 consentement par séance · P2 sort de l'enregistrement partiel après un retrait · P3 audio seul · P4 refus du coach sans conséquence · P5 pistes séparées plutôt qu'empreinte vocale · P6 résumé sans données sensibles ni jugement · P7 rien du texte des séances dans l'AI Message Log · P8 coach sous-traitant, rien hors de Jobbbox · P9 maîtrise de l'IA des coachs · P10 marquer aussi la transcription · P11 mention visible « rédigé par une IA » · P12 aucune émotion, résumé tiré du texte seul · P13 résumé ni évaluatif ni transmis · P14 transcription et résumé `euOnly` · les durées du §3.4.

Déclencheurs **[Juriste]** proposés pour #507 : passage du Human Coach en vendeur (place de marché, #848) ; partage des résumés à une Organisation ou à un employeur ; toute analyse de la voix ou du visage ; un destinataire hors UE pour l'audio.

## 8. Ce qui reste ouvert faute d'avoir lu les textes

- Le texte exact de 226-1 et 226-19 dans leur version en vigueur (Légifrance refusé).
- Les articles du RGPD et de l'AI Act sur EUR-Lex (refusé) ; les paragraphes de LD5 sur le recrutement, les indépendants et la formation professionnelle (seuls des résumés de cabinets ont été lus aujourd'hui).
- Les 14 entrées exactes de la liste CNIL et la mise à jour éventuelle du référentiel CNIL sur l'enregistrement des appels (un site tiers parle d'un référentiel du 2 avril 2026, non vérifié).
- L'existence d'une fiche CNIL dédiée aux comptes rendus de réunion par IA.
- Le statut d'un éventuel pourvoi contre *Latombe*.

Il faut autoriser `www.legifrance.gouv.fr`, `eur-lex.europa.eu`, `www.cnil.fr` (et `artificialintelligenceact.eu`, `www.edpb.europa.eu`, `curia.europa.eu`) dans le réseau de l'environnement pour lever ces points avant la Legal Review.

## 9. Ce qu'il faut changer dans les textes

Aucune version n'est encore publiée dans `packages/help/legal/` : ces clauses entrent dans les premières versions, ou dans des versions substantielles si elles sont publiées avant. Chaque texte passe par une issue « Légal : » (`docs/agents/documentation.md`), au découpage final.

### Politique de confidentialité (information, jamais acceptée)

- Nouvelle section « Enregistrement et résumé des séances avec un coach humain » : finalité ; base (consentement, explicite pour les données sensibles) ; ce qui est enregistré (audio seul) ; qui lit quoi (Candidate, Human Coach, jamais les Administrators sauf support à la demande) ; durées par couche (§3.4) ; destinataires et lieu (UE, ou la Recipient list) ; retrait et ses effets ; droits (accès, export, rectification du résumé, effacement) ; ce que l'IA ne fait pas (aucune émotion, aucune évaluation).
- Section « IA dans Jobbbox » (ADR-0064) : la voie des séances (transcription et résumé dans l'UE si P14).
- Section « Human Coach » : la qualification retenue (#518) et ses conséquences pour le Candidate.
- Information du **Human Coach** lui-même sur le traitement de sa voix et de ses propos (il est aussi une personne concernée).
- Tout destinataire hors UE nouveau : version substantielle, Préavis (ADR-0064, ADR-0072).

### CGU

- Description de la fonction, facultative, et de ses limites (le résumé peut se tromper, ce n'est pas un avis professionnel).
- **Interdiction pour chaque participant d'enregistrer ou de diffuser la séance par ses propres moyens** (226-1, 226-2), et de partager le résumé en y mêlant les propos du coach sans son accord.
- Rappel que le Candidate peut refuser ou arrêter l'enregistrement sans conséquence.

### CGV

- La Coaching Session vendue est la même avec ou sans enregistrement : même prix, même durée ; le refus ou le retrait ne donne lieu ni à supplément ni à réduction.
- Si l'enregistrement ou le résumé devient une option payante, il faudra l'y décrire (information précontractuelle L221-5) ; non recommandé, car un paiement lié au consentement en fragilise la liberté.
- Ce que devient l'enregistrement en cas de Withdrawal (ADR-0071) : supprimé avec la séance retirée. **[LR]**

### Contrat B2B avec le Human Coach (#518)

- Clauses de sous-traitance art. 28(3) : instructions, confidentialité, sécurité, pas de sous-traitant ultérieur, aide aux droits, suppression à la fin, audit.
- Interdiction d'enregistrer, de prendre des notes ou de copier des données des Candidates hors de Jobbbox, et de les réutiliser.
- Consentement à l'enregistrement par séance, **refus sans aucune conséquence** (P4) ; Jobbbox ne mesure ni ne note le coach sur sa voix, son visage ou ses résumés (P12, P13).
- Information du coach sur le traitement de ses propres données (art. 13).
- Maîtrise de l'IA : lecture de l'aide dédiée avant d'accéder aux résumés (P9).
- Signalement de toute violation de données sous 24 h à Jobbbox (art. 33(2)).

## 10. Conséquences pour le cadrage (#851)

1. **Pré-requis technique** : une visio choisie par Jobbbox (intégrée ou robot), sans quoi ni consentement, ni signal, ni maîtrise de la conservation : amende ADR-0016 et ADR-0027.
2. **Amendement d'ADR-0007** : transcription et résumé `euOnly` (P14).
3. **Glossaire** : poser « Enregistrement de séance », « Transcription », « Résumé de séance », « Notes du coach » et le consentement à l'enregistrement, distinct de l'EU AI Consent et de l'Acceptance.
4. **Avant la production** : AIPD (O5), entrée au registre (O6), #518 signé (O9), #337 livré (O11).
5. **Issues « Légal : »** au découpage : politique de confidentialité, CGU, CGV, contrat B2B (#518).
