# Recherche : prise de notes, transcription et résumé par IA d'une Coaching Session (#846)

Carte : #841. Suite de #842 (l'existant) et #843 (parcours). Lu le 2026-11-06 sur `main`.

## Question

Quel note taker pour le Human Coach, et quels fournisseurs pour transcrire et résumer une Coaching Session, dans l'UE et dans les voies IA de Jobbbox (ADR-0007, ADR-0064, ADR-0077) ?

## Méthode et limites

- Recherche web du 2026-11-06. **L'ouverture directe des pages a été refusée par le réseau de la session** pour `mistral.ai`, `deepgram.com` et `www.assemblyai.com` (résolution DNS refusée) ; les autres fournisseurs n'ont pas été tentés après ces trois refus. Les constats viennent donc des **extraits renvoyés par la recherche**. Chaque chiffre porte une marque :
  - **[officiel]** : extrait d'une page du fournisseur (site, documentation, blog officiel) ;
  - **[tiers]** : agrégateur de prix, article, guide universitaire ;
  - **[non vérifié]** : sources en désaccord, ou affirmation d'un concurrent.
- **Aucun essai réalisé** : aucune clé de fournisseur dans la session et les hôtes des API sont hors du réseau autorisé. Aucun enregistrement de personne réelle n'a été utilisé. L'essai prévu par l'issue (« un enregistrement de démo ») reste à faire avec un **échantillon synthétique** (voix de synthèse, dialogue coach–Candidate fictif en français), voir les questions ouvertes.
- Prix en dollars US hors taxes sauf mention ; convertis à l'heure d'audio (1 h = 60 min). Les prix de liste bougent vite (Voxtral 3 est sorti le 2026-10-20, Gladia a repassé ses prix en euros le 2026-10-15) : **à revérifier sur les pages officielles avant tout chiffrage**.
- Le RGPD et l'AI Act de l'enregistrement (base légale, consentement des deux personnes, AIPD) sont l'objet de #847 ; ce document ne les tranche pas, il signale où ils contraignent.

## Sources

Toutes consultées (par recherche) le 2026-11-06.

| # | Sujet | Page | Nature |
|---|---|---|---|
| S1 | Mistral Voxtral Transcribe 2 (fév. 2026) | https://mistral.ai/fr/news/voxtral-transcribe-2 | officiel |
| S2 | Mistral Voxtral 3 (2026-10-20) | https://mistral.ai/fr/news/voxtral-3/ , https://docs.mistral.ai/models/voxtral-mini-transcribe-3-0.md | officiel |
| S3 | Prix Voxtral 3 | https://fourweekmba.com/ai-mistrals-voxtral-3-transcribes-speech-from-0-0035-a-minute/ , https://www.orcarouter.ai/fr/blog/voxtral-3-voice-agents-api , https://www.llmreference.com/model/voxtral-mini-transcribe-realtime-3 | tiers |
| S4 | Mistral, rétention zéro (ZDR) | https://docs.mistral.ai/fr/admin/monitor-comply/zero-data-retention | officiel |
| S5 | Mistral, rétention API 30 jours | https://conductatlas.com/platform/mistral-ai/mistral-ai-privacy-policy/data-retention-api-inputoutput-30-day-rolling-window/ | tiers |
| S6 | Voxtral 3 en région UE chez des revendeurs | https://openrouter.ai/mistralai/voxtral-small-transcribe-3-0 , https://www.edenai.co/expert-models/mistral-voxtral-mini-transcribe-3-0 | tiers |
| S7 | Prix des modèles texte Mistral | https://pricepertoken.com/pricing-page/model/mistral-ai-mistral-medium-3 , https://www.benchlm.ai/mistral/api-pricing | tiers |
| S8 | Deepgram, point d'accès UE | https://deepgram.com/learn/deepgram-eu-endpoint-now-generally-available , https://developers.deepgram.com/trust-security/your-data | officiel |
| S9 | Deepgram, programme d'amélioration (`mip_opt_out`) | https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program | officiel |
| S10 | Prix Deepgram Nova-3 | https://www.activepieces.com/blog/deepgram-pricing-2026-per-minute-rates-and-add-ons , https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch , https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/ | tiers |
| S11 | Prix AssemblyAI, région UE | https://www.assemblyai.com/pricing.md | officiel |
| S12 | AssemblyAI, rétention et suppression | https://assemblyai.com/docs/data-retention-and-model-training , https://assemblyai.com/docs/data-controls , https://assemblyai.com/docs/delete-transcripts , https://www.assemblyai.com/docs/faq/does-assemblyai-offer-zero-data-retention | officiel |
| S13 | AssemblyAI, langues | https://assemblyai.com/blog/99-languages , https://www.assemblyai.com/models | officiel |
| S14 | Prix Speechmatics | https://costbench.com/software/ai-transcription-apis/speechmatics/ , https://www.usagepricing.com/blueprint/activity/speechmatics-2026-10-04-model-based-rate-card , https://pricingsaas.com/companies/speechmatics/diffs/2025Q2 | tiers |
| S15 | Speechmatics, sécurité, rétention, régions | https://docs.speechmatics.com/administration/security-and-compliance , https://docs.speechmatics.com/speech-to-text/batch/limits , https://docs.speechmatics.com/administration/regions | officiel |
| S16 | Speechmatics, diarisation incluse | https://www.speechmatics.com/how-we-compare/deepgram-alternative.md | officiel (argument commercial) |
| S17 | Gladia, prix | https://www.gladia.io/pricing , https://www.activepieces.com/blog/gladia-pricing-2026-plans-per-hour-rates-add-ons , https://www.usagepricing.com/blueprint/activity/gladia-2026-10-15-self-serve-euro-repricing | officiel / tiers |
| S18 | Gladia, rétention et UE | https://docs.gladia.io/chapters/limits-and-specifications/data-retention , https://www.gladia.io/blog/azure-speech-services-vs-gladia-enterprise-sla-data-residency-compliance-comparison | officiel |
| S19 | Gladia, diarisation asynchrone seulement | https://www.gladia.io/blog/gladia-async-api-for-meeting-transcription-integration-guide-and-best-practices | officiel |
| S20 | Benchmarks français | https://gladia.io/competitors/benchmarks , https://www.gladia.io/product/languages/french , https://soniox.com/media/SonioxFrenchBenchmarks2023.pdf | officiel (éditeur juge et partie) |
| S21 | Whisper / faster-whisper / WhisperX | https://vexascribe.com/fr/whisperx , https://docs.clore.ai/guides/guides_v2-fr/audio-et-voix/whisperx , https://huggingface.co/guillemefranc | tiers |
| S22 | Zoom AI Companion | https://imss.caltech.edu/services/voice-mobile-conference-calls/zoom/zoom-ai-companion , https://www.cuit.columbia.edu/node/1593 , https://compound.law/en-DE/tools/zoom/ , https://www.charles-stanley.co.uk/about-us/our-policies/privacy-notice/zoom-ai | tiers |
| S23 | Gemini dans Meet (« Prendre des notes pour moi ») | https://support.google.com/meet/answer/14754931?hl=en , https://workspaceupdates.googleblog.com/2025/03/more-languages-for-take-notes-for-me-in-google-meet.html , https://workspaceupdates.googleblog.com/2025/08/more-languages-suggested-next-steps-take-notes-google-meet-gemini.html | officiel |
| S24 | Copilot dans Teams (intelligent recap) | https://learn.microsoft.com/en-us/microsoftteams/intelligent-recap-calls-meetings , https://mc.merill.net/message/MC1275312 | officiel |
| S25 | Notes de coach (privées / partagées, modèles) | https://www.coachaccountable.com/knowledgeBase/sessionNotes/sharing , https://help.kajabi.com/articles/products/coaching/how-to-add-notes-for-clients , https://cohere.live/help/how-to-use-notes-in-1-1-sessions , https://paperbell.com/wp-content/uploads/2026/06/life-coaching-session-notes-template.pdf | officiel |
| S26 | BetterUp « Session Insights » (déjà lu par #843, S20) | https://support.betterup.com/hc/en-us/articles/46316887717915-Session-Insights-Member-Guide | officiel |
| R | Dépôt | ADR-0007 (et ses amendements du 2026-10-20 et du 2026-10-28), ADR-0064, ADR-0077 ; `CONTEXT.md` ; `packages/shared/src/tools.ts` ; `packages/ai/src/types.ts` ; `docs/privacy/register.md` ; `docs/research/issue-842.md` (branche `research/issue-842`) | — |

## Ce qu'impose l'existant

1. **Rien n'existe pendant ni après la séance** (#842) : la Coaching Session n'a qu'un `video_link` libre ; sa note est celle du Candidate seul, qu'un Human Coach ne voit jamais. Les notes du coach, l'enregistrement, la transcription et le résumé partent d'une page blanche.
2. **La couche IA ne sait pas traiter l'audio.** `packages/ai` n'a que des tâches texte (`TEXT_TASKS`) et la recherche web ; le mot `Transcript` y désigne la trace d'un appel dans l'AI Message Log, pas une transcription. Transcrire demande une nouvelle modalité dans la couche (entrée audio, durée au lieu de jetons dans `ai_usage`, prix à la minute dans la table de coûts).
3. **Les voies d'ADR-0007** : le fournisseur par défaut est Anthropic par son API directe, **hors UE, après Redaction** ; restent dans l'UE la route d'identité (Mistral, sous EU AI Consent) et les tâches marquées `euOnly` (lecture des e-mails d'offres, ADR-0052), que Paramètres refuse d'envoyer hors UE.
4. **Les limites de la Redaction** (ADR-0007, amendement du 2026-10-20) pèsent beaucoup plus sur une transcription que sur un CV : elle ne retire que ce que Jobbbox connaît de l'identité du Candidate. Dans une séance parlée passent **les noms de tiers** (manager, recruteur, collègue, proche), les noms d'employeurs, le prénom et le nom du Human Coach, et potentiellement des **données sensibles** (santé, burn-out, situation familiale, syndicat) : la Redaction ne les retire pas, et un nom propre ne se reconnaît pas à sa forme.
5. **Mistral est déjà un Tool et un destinataire dans l'UE** (`tools.ts`, id `mistral`, `residency: "eu"`, `api.eu.mistral.ai`, entité Mistral AI SAS, garanties « none_needed, adequacy »). L'ajouter pour l'audio change sa finalité et ses données dans la Recipient list, mais **pas son lieu** : c'est un changement mineur au sens d'ADR-0064. Tout autre fournisseur de transcription est un **nouveau destinataire**, et s'il est hors UE ou de résidence `unknown`, un changement substantiel de la politique de confidentialité.
6. **ADR-0077** : un Coach Action ne fait jamais d'écriture, le Candidate applique tout ; un texte qu'il n'a pas écrit, présent dans la vue (In view) ou revenu d'une lecture, **restreint le catalogue** (pas de Master CV, de Search Criteria ni de Coach Memory). Une transcription ou un compte rendu de séance est exactement ce genre de texte.
7. **Data export** : les Coaching Sessions y sont déjà (date, auteur du dernier changement, lien visio, Reschedules). Tout ce qu'on ajoute (notes partagées, compte rendu, transcription, Provenance) devra y entrer : « Every table tied to a Candidate must land in it ».

## Constats

### 1. Transcription : les fournisseurs

#### Mistral Voxtral (Mistral AI SAS, France)

- **Modèles** : Voxtral 3 sort le 2026-10-20 avec deux modèles par lot (Voxtral Mini Transcribe 3 et Voxtral Small Transcribe 3, avec diarisation et « context biasing ») et un modèle temps réel (Voxtral Mini Transcribe Realtime 3, latence < 500 ms) [officiel, S2]. Mini Transcribe 3 est encore en **préversion publique** dans sa page de documentation [officiel, S2]. La génération précédente, Voxtral Mini Transcribe V2 (février 2026), donne diarisation, biais de contexte jusqu'à 100 expressions et horodatage au mot, dans 13 langues dont le français et l'anglais [officiel, S1].
- **Qualité** : Mistral annonce ≈ 4 % de WER sur FLEURS en moyenne sur ses 10 premières langues pour V2 [officiel, S1], et pour Mini Transcribe 3 la 3e place sur FLEURS multilingue et sur la diarisation en anglais [officiel, S2]. **Aucun chiffre propre au français** ni à la diarisation en français trouvé.
- **Prix** : V2 0,003 $/min (0,18 $/h) par lot et 0,006 $/min (0,36 $/h) en temps réel [officiel, S1]. Voxtral 3 : Mini 0,0035 $/min (0,21 $/h), Small 0,0040 $/min (0,24 $/h), Realtime 0,008 $/min (0,48 $/h) [tiers, S3, concordants entre eux]. Pas de supplément de diarisation trouvé.
- **Lieu** : `api.eu.mistral.ai` est déjà la voie de Jobbbox ; **je n'ai pas pu confirmer que la route de transcription audio y est exposée** pour Voxtral 3 (des revendeurs servent Voxtral 3 en région UE [tiers, S6]). À vérifier en premier.
- **Rétention** : par défaut les entrées et sorties de l'API seraient gardées 30 jours glissants pour la détection d'abus [tiers, S5] ; la **rétention zéro (ZDR)** couvre le point d'accès de transcription, sur demande au support, sur les offres payantes, à la discrétion de Mistral [officiel, S4]. Le refus d'entraînement est distinct de la ZDR [officiel, S4].
- **DPA** : celui déjà signé pour la route d'identité ; à relire pour l'audio.

#### Deepgram (États-Unis)

- **Point d'accès UE** `api.eu.deepgram.com` disponible pour tous (annonce de décembre 2025, republiée le 2026-01-10), hébergé dans des régions AWS de l'UE, sans changement de clé ni de facturation ; Whisper hébergé exclu ; pas de bascule vers une autre région en cas de panne [officiel, S8]. La garantie complète « dans la région » demande **en plus** `mip_opt_out=true` à chaque requête, qui exclut l'audio du programme d'amélioration ; Deepgram rappelle ne pas être à l'abri d'une procédure légale étrangère [officiel, S8, S9].
- **Prix Nova-3** (sources en désaccord) : par lot 0,0043 à 0,0077 $/min (0,26 à 0,46 $/h) ; flux multilingue 0,0058 à 0,0092 $/min (0,35 à 0,55 $/h) ; **diarisation en option ≈ 0,002 $/min (0,12 $/h)** [tiers, S10, non vérifié].
- **Français** : modèle multilingue ; aucun WER français publié par Deepgram trouvé ; 6,2 % sur Multilingual LibriSpeech français selon le tableau de Gladia, le moins bon des cinq listés [officiel Gladia, juge et partie, S20].
- **Rétention** : seules les données du programme d'amélioration sont gardées pour l'entraînement ; une requête exclue n'est gardée que le temps du traitement [officiel, S9]. Société américaine : entité contractante et garanties de transfert à établir même avec le point d'accès UE.

#### AssemblyAI (États-Unis)

- **Région UE** au **même prix** que les États-Unis : `api.eu.assemblyai.com` et `streaming.eu.assemblyai.com` [officiel, S11].
- **Prix** : Universal-3.5 Pro 0,21 $/h, Universal-2 0,15 $/h ; **diarisation par lot +0,02 $/h** (standard) ou +0,065 $/h (expérimentale) [officiel, S11]. Diarisation en flux ≈ 0,12 $/h [tiers, non vérifié].
- **Français** : Universal couvre 99 langues dont le français, diarisation dans 95 [officiel, S13] ; Universal-3.5 Pro est annoncé sur 18 langues (à confirmer pour le français) ; le flux Universal-3 Pro couvre 6 langues dont le français [tiers]. 2,6 % de WER sur Multilingual LibriSpeech français (Universal-3) dans le tableau de Gladia, le meilleur des listés [S20, juge et partie].
- **Rétention** : durée de conservation réglable (1, 3, 7 ou 30 jours, ou sur mesure) dans « Data Controls » ; suppression immédiate par `DELETE` sur le serveur UE ; pas de ZDR formelle pour le lot selon une FAQ datée de 2024, ZDR du flux pour un compte exclu de l'entraînement [officiel, S12, sources internes en désaccord].

#### Speechmatics (Royaume-Uni)

- **Régions** : lot dans les trois régions (UE, États-Unis, Australie), temps réel en EU1 et US1 [officiel, S15]. Société britannique : le Royaume-Uni bénéficie d'une décision d'adéquation, à confirmer pour l'entité contractante et ses sous-traitants.
- **Rétention** : lot : audio, transcription et configuration gardés **7 jours** puis supprimés, suppression plus tôt par l'API ; temps réel : l'audio n'est **jamais enregistré ni stocké** [officiel, S15].
- **Prix** (Pro, sources en désaccord) : lot « standard » 0,24 $/h, « enhanced » 0,40 $/h, nouveau modèle multilingue Melia 1 dès 0,129 à 0,19 $/h (grille par modèle du 2026-10-04) ; temps réel 0,24 à 0,56 $/h [tiers, S14, non vérifié]. **Diarisation incluse, y compris en temps réel** [officiel, argument commercial, S16].
- **Français** : 55+ langues ; aucun chiffre français indépendant trouvé.

#### Gladia (Gladia SAS, Paris)

- **Lieu** : résidence UE par défaut, chez un hébergeur européen en France (OVHcloud selon des annuaires) [officiel S18, tiers]. Société française.
- **Prix** : grille repassée en euros le 2026-10-15 : lot 0,16 €/h (Solaria-3) ou 0,27 €/h (Solaria-1), temps réel 0,68 €/h, paliers de volume [tiers, S17] ; anciennes grilles en dollars : Starter 0,61 $/h lot, 0,75 $/h temps réel ; Growth (avec engagement) 0,20 $/h et 0,25 $/h [tiers, S17]. **Grilles contradictoires : à revérifier.**
- **Diarisation** : **par lot seulement**, pas dans l'API WebSocket temps réel [officiel, S19] ; modèle de diarisation de pyannoteAI selon une source [tiers].
- **Français** : son marché d'origine ; 4,8 % de WER sur Multilingual LibriSpeech français (Solaria), 18 % sur ses propres appels clients, 8,7 % sur accents [officiel, S20]. Ses propres chiffres placent AssemblyAI devant elle sur le français lu.
- **Rétention** : audio et transcription traités, métadonnées gardées pour la facturation, journaux immuables « pour une durée limitée » ; avec ZDR, rien n'est stocké au repos et l'envoi de fichier est remplacé par une URL [officiel, S18]. DPA non trouvé en ligne : à demander.

#### Whisper auto-hébergé (faster-whisper, WhisperX)

- **Pile** : faster-whisper (Whisper large-v3 ou large-v3-turbo en CTranslate2) + alignement wav2vec2 + **pyannote 3.x pour la diarisation**, assemblés par WhisperX ; ≈ 2 Go de dépendances ; modèles pyannote derrière une licence à accepter sur Hugging Face [tiers, S21]. Des ajustements français existent (ex. large-v3-turbo québécois) [S21].
- **Performances** : ≈ 12× le temps réel pour large-v3 sur une RTX 3090, 4 à 6 Go de VRAM pour la chaîne complète ; sur CPU, lent : préférer whisper.cpp [tiers, S21].
- **Coût** : GPU de location ≈ 0,30 à 2 $/jour sur une place de marché [tiers, S21] ; un GPU loué chez un hébergeur de l'UE ferait tomber l'heure d'audio sous 0,10 € **à la marge**, mais avec un coût fixe (GPU allumé ou démarrage à froid), une file d'attente au worker, une mise à jour des modèles et une évaluation à notre charge. **Estimation, non mesurée.**
- **Lieu** : chez l'hébergeur de Jobbbox (UE), aucun nouveau sous-traitant IA ; le Host est le destinataire (`hostedBy` dans `tools.ts`).
- Pas de temps réel prêt à l'emploi ; diarisation pyannote correcte sur deux voix nettes, plus fragile sur chevauchements [non vérifié].

#### Fournisseur visio (#845)

- Si #845 retient une visio intégrée (salle Jobbbox chez un fournisseur WebRTC), son enregistrement ou sa transcription native deviendrait la source de l'audio. Sans le choix de #845, je ne compare pas ici leurs offres ; la recommandation ci-dessous suppose seulement **un fichier audio ou un flux par piste** livré au worker. Un enregistrement **une piste par participant** rend la diarisation presque gratuite et fiable (chaque piste est un locuteur) : à demander au fournisseur de #845.

### 2. Tableau comparatif de la transcription

Prix à l'heure d'audio, par lot (après la séance) sauf mention. Diarisation comprise quand elle est payante à part.

| Fournisseur | FR / EN | Diarisation | Temps réel | Prix par lot ≈ /h (diarisation incluse) | Temps réel ≈ /h | Lieu des données | Rétention par défaut / ZDR | Destinataire nouveau ? |
|---|---|---|---|---|---|---|---|---|
| **Mistral Voxtral 3** (Mini / Small) | oui / oui ; pas de WER FR publié | oui, par lot | oui (Realtime 3) ; diarisation en temps réel non confirmée | 0,21–0,24 $ [tiers] (V2 : 0,18 $ [officiel]) | 0,48 $ [tiers] (V2 : 0,36 $ [officiel]) | UE (`api.eu.mistral.ai`) **si la route audio y est servie** [non vérifié] | 30 j [tiers] ; ZDR sur demande [officiel] | **Non** (Tool `mistral` existant, finalité à étendre) |
| **Deepgram** Nova-3 | oui / oui ; FR le plus faible du tableau Gladia | oui, +0,12 $/h | oui | 0,38–0,58 $ [tiers, non vérifié] | 0,47–0,67 $ [tiers] | UE avec `api.eu.deepgram.com` + `mip_opt_out` [officiel] ; société US | durée du traitement si exclu [officiel] | Oui, société US (garanties de transfert à établir) |
| **AssemblyAI** Universal | oui / oui ; FR le meilleur du tableau Gladia | oui, +0,02 $/h | oui (FR dans le flux) | 0,17–0,23 $ [officiel] | n. c. (diarisation flux ≈ 0,12 $ [tiers]) | UE (`api.eu.assemblyai.com`), même prix [officiel] ; société US | réglable 1 h à 30 j, suppression API [officiel] | Oui, société US |
| **Speechmatics** | oui / oui ; pas de chiffre FR | oui, incluse, aussi en temps réel [officiel, commercial] | oui (EU1) | 0,13–0,40 $ selon modèle [tiers] | 0,24–0,56 $ [tiers] | UE (région EU) ; société UK (adéquation) | lot 7 j, temps réel rien [officiel] | Oui, société UK |
| **Gladia** Solaria | oui (marché d'origine) / oui | **par lot seulement** [officiel] | oui, sans diarisation | 0,16–0,27 €/h [tiers] (anciennes grilles 0,20–0,61 $) | 0,68 €/h [tiers] | UE par défaut, France [officiel] ; société FR | journaux « limités » ; ZDR [officiel] | Oui, société FR (UE) |
| **Whisper auto-hébergé** (WhisperX) | oui / oui (selon le modèle) | pyannote | non prêt à l'emploi | < 0,10 € à la marge + coût fixe GPU [estimation] | — | Hébergeur de Jobbbox (UE) | la nôtre | Non (Host) |

Lecture : **sur le prix, tous se valent** : une Coaching Session d'une heure coûte entre 0,15 et 0,60 $ à transcrire, à comparer au Coaching Session Price. Le choix se joue sur **le lieu, le nombre de destinataires, la rétention et la qualité en français**, pas sur le coût.

### 3. Résumé et actions suivantes

- **Taille** : une heure de conversation en français fait ≈ 8 000 à 10 000 mots, ≈ 12 000 à 15 000 jetons. Un résumé de ≈ 1 500 jetons sur un modèle texte Mistral de milieu de gamme (≈ 0,40 $ / 2 $ par million de jetons en entrée / sortie pour Mistral Medium 3, remplacé par Medium 3.5 à 1,50 $ / 7,50 $ selon des tiers [tiers, S7]) coûte **de l'ordre d'un à quelques centimes**. Négligeable devant la transcription et devant le prix de la séance.
- **Quelle voie IA** (ADR-0007) :
  - **Anthropic en direct, hors UE, après Redaction** : la Redaction retire l'identité connue du Candidate, pas les noms de tiers, ni ceux du Human Coach s'ils sont prononcés, ni les données sensibles. Une transcription est **bien plus identifiante qu'un CV** et plus susceptible de porter des données de l'art. 9 RGPD. Envoyer hors UE serait un transfert à justifier (CCT) et à porter au registre, pour un gain de qualité qui ne compte pas ici (résumer est une tâche facile).
  - **Mistral dans l'UE** : deux façons de l'y garder.
    1. **Sous EU AI Consent** seulement : la route d'identité suppose le consentement du Candidate et rien d'autre ; un Candidate sans consentement n'aurait pas de résumé, ou un résumé hors UE. Et le consentement du Candidate ne couvre pas la voix ni les propos du Human Coach.
    2. **Tâche marquée `euOnly`** (comme la lecture des e-mails d'offres, ADR-0052) : la transcription et le résumé partent **toujours** vers Mistral UE, avec ou sans EU AI Consent ; Paramètres refuse déjà de router une tâche `euOnly` hors UE. C'est la voie qui ne dépend pas d'un choix du Candidate pour un traitement qui concerne aussi le coach, et que la base légale de #847 (probablement le consentement des deux à l'enregistrement) couvrira à part.
  - Dans les deux cas la Redaction s'applique quand même (elle retire les e-mails et téléphones prononcés et l'identité connue) : défense en profondeur.
- **Tool et Provenance** (catalogue `tools.ts`) :
  - La transcription Voxtral est un appel au Tool `mistral` (catégorie `ai_model`) ; sa fiche de destinataire passe de « identity_under_eu_ai_consent, forwarded_emails » à **« enregistrements de séance »** en plus (une nouvelle valeur de `RECIPIENT_DATA`) et sa finalité publique gagne la transcription. Un autre fournisseur serait un nouveau Tool, avec `residency`, `recipient`, `keys` et un réglage Paramètres.
  - Deux nouvelles tâches de la couche IA, par exemple `coaching_session_transcription` (audio, comptée en minutes) et `coaching_session_summary` (texte), toutes deux `euOnly`.
  - La Provenance du compte rendu : deux étapes (« transcrire », « résumer »), chacune avec fournisseur, lieu (endpoint et région), modèle servi, minutes ou jetons, durée et Outcome ; sans texte, sans Candidate, sans coût. La Provenance line montre « UE ».
  - `ai_usage` doit apprendre une unité « minutes d'audio » et la table de prix un prix à la minute (Coach Message Cost et rapport de consommation).
- **Plan Quota** : la séance est déjà payée à l'unité (Coaching Session Price, ADR-0016). Deux options :
  - **Inclus dans la Coaching Session** : une transcription et un résumé par séance payée, plafonnés en durée (par ex. 120 min) ; pas de nouveau Plan Quota. Le coût est connu et faible.
  - **Plan Quota « Résumés de séance » par semaine** : seulement si le résumé s'ouvre à des séances hors Jobbbox (un enregistrement importé). Je ne le recommande pas en phase 1.
- **Guardrails** : aujourd'hui les Guardrails gardent l'AI Coach, les Playbook Agents et le Back Office Assistant ; les autres tâches IA ont leurs propres règles (seule la lecture des e-mails a un Guardrail d'entrée). Le résumé de séance devrait suivre le modèle d'Email intake :
  - **entrée** : la transcription est une donnée (`<donnees>`), jamais une instruction (une phrase prononcée « ignore tes consignes » ne doit rien changer) ; Guardrail « contenu piégé » réglable ;
  - **sortie**, règles fixes toujours actives : aucun e-mail ni téléphone, **aucun nom de tiers** (remplacé par son rôle : « votre manager », « la recruteuse »), aucune donnée de santé ou autre catégorie particulière recopiée, pas de diagnostic ni de jugement sur la personne, pas d'inférence d'émotion ou d'état psychologique (l'AI Act interdit la reconnaissance des émotions dans le cadre du travail et de l'éducation, art. 5(1)(f) ; à confirmer par #847 pour le coaching de carrière), au plus N actions suivantes.
- **Actions suivantes** : le résumé produit une liste « Prochaines étapes » (pour le Candidate, pour le coach). Les transformer en objets (une Application à créer, une date d'Interview, une prochaine Coaching Session à dater) passe par les **Coach Actions** d'ADR-0077, c'est-à-dire des Action Cards que le Candidate applique. Deux contraintes :
  - le texte de la séance est un texte que le Candidate n'a pas écrit : seuls les Coach Actions **qui ne recopient aucun texte** restent offerts (créer l'Application, statut, dates d'Interview, Agenda) ; **ni Master CV, ni Search Criteria, ni Coach Memory** depuis la séance ;
  - un Coach Action est appelé par l'AI Coach dans une réponse ; la voie la plus simple est donc de **laisser l'AI Coach proposer** les cartes quand le Candidate ouvre le compte rendu dans sa Coach Conversation (« Transformer les prochaines étapes en actions »), plutôt que de faire écrire des cartes par la tâche de résumé, qui n'a pas de Coach Actions.

### 4. Ce que le Candidate voit et garde

Ce que font les plateformes de coaching (S25, S26) : notes **partagées** et notes **privées** séparées par séance ; BetterUp « Session Insights » publie au membre un résumé et des actions après la séance.

Proposition pour Jobbbox :

- **Compte rendu de séance** (terme proposé, à poser par #860) : rédigé par l'IA à partir de la transcription, **relu et validé par le Human Coach** avant d'être publié au Candidate (le coach peut l'éditer ou ne pas le publier). Une fois publié, il apparaît dans la **Coach Conversation de la Coaching Session** (l'objet a la sienne) comme un message à part, ni du Candidate ni de l'AI Coach, signé du coach, avec la mention « Rédigé avec l'IA, relu par votre coach » (AI Act art. 50) et sa Provenance line. L'AI Coach le lit ensuite **comme une donnée**.
- **Transcription** : visible du Candidate et du coach pendant une courte durée (par ex. 30 jours) puis purgée ; seul le compte rendu reste. **L'audio n'est jamais conservé** : supprimé dès la transcription réussie (et ZDR chez le fournisseur).
- **Prochaines étapes** : listées dans le compte rendu ; « Transformer en actions » ouvre l'AI Coach qui propose les Action Cards (ci-dessus). Rien ne s'écrit sans « Appliquer ».
- **Coach Memory** : rien d'automatique. Le Human Coach ne voit jamais la Coach Memory (CONTEXT.md) ; le Candidate peut, de lui-même, retenir un fait.
- **Coach Review** : reste attachée à un Tailored Document ; sans lien avec le compte rendu, sauf un renvoi « Documents relus pendant la séance » si le coach en cite un.
- **Data export** : le compte rendu (avec sa Provenance et l'auteur de sa validation), la transcription tant qu'elle existe, les notes partagées ; **les notes privées du coach sur le Candidate** sont aussi des données personnelles du Candidate : leur place dans l'export (droit d'accès, art. 15) est à trancher avec #847.
- **Suppression** : la Coaching Session n'est « jamais supprimée par le Candidate » ; mais le Candidate devrait pouvoir **effacer la transcription et le compte rendu** (comme « Effacer » une Coach Conversation), et retirer son accord à l'enregistrement avant ou pendant la séance. Avec le compte, tout part.
- **Et le Human Coach** : il garde ses notes privées et le compte rendu publié tant qu'il est le coach de la séance ; un Retired Human Coach ne lit plus rien (#842).

### 5. Les notes du coach

Ce que font les autres (S25) : CoachAccountable, Kajabi, Cohere séparent par séance une **note partagée** (lue par le client, souvent en lecture seule) et une **note privée** du coach ; Paperbell propose un modèle avec une rubrique « Réflexions du coach (privé) » à côté des objectifs, actions et prochaine séance ; CoachAccountable envoie des récapitulatifs par e-mail.

Proposition :

| Note | Qui écrit | Qui lit | Rattachée à | Dans le Data export |
|---|---|---|---|---|
| Note de la Coaching Session (existe) | Candidate | Candidate seul | la séance | oui |
| **Notes privées du coach** (nouveau) | Human Coach | Human Coach seul ; jamais l'IA ni l'AI Coach | la séance (et une vue par Candidate) | à trancher (#847) |
| **Compte rendu de séance** (nouveau) | IA puis Human Coach | Human Coach et Candidate ; l'AI Coach comme donnée | la séance, et sa Coach Conversation | oui |

- **Modèle de compte rendu**, rempli par l'IA ou à la main : Objectifs de la séance · Points abordés · Décisions · Prochaines étapes (Candidate) · Prochaines étapes (coach) · Ressources · Prochaine séance. Les rubriques tiennent dans les règles de sortie (pas de nom de tiers, pas de donnée sensible).
- **Sans IA** : le compte rendu doit pouvoir s'écrire à la main avec le même modèle. C'est aussi la voie quand l'un des deux refuse l'enregistrement, et la phase 1 la moins risquée.
- **Coach Access** : le coach voit la séance (prénom et initiale) sans Coach Access (#842). Écrire un compte rendu sur la séance ne demande pas plus ; mais la vue « par Candidate » de ses notes privées touche à ce que le coach sait du Candidate sans Coach Access : question ouverte.

### 6. Les note takers des visios tierces (séance hors Jobbbox)

Quand le `video_link` pointe vers Zoom, Meet ou Teams, ce sont les outils de l'organisateur.

| Outil | Ce qu'il fait | Français | Prévenir les participants | Où vont les données | Licence |
|---|---|---|---|---|---|
| **Zoom AI Companion** | résumé de réunion, prochaines étapes, envoyés à l'hôte (et partageables) | non confirmé par une source officielle trouvée | bandeau en réunion ; certains clients demandent de cliquer « OK » [tiers, S22] | stocké aux États-Unis selon une notice tierce, option de résidence UE dont l'inférence IA peut différer [tiers, S22] ; pas d'entraînement sur le contenu [tiers] | offre Zoom payante de l'hôte |
| **Gemini dans Meet** (« Prendre des notes pour moi ») | notes dans un Google Doc joint à l'événement, prochaines étapes suggérées | **oui** (ajouté en mars 2025) ; **une langue par réunion** [officiel, S23] | tous les participants sont prévenus, icône crayon [officiel, S23] | Google Workspace de l'organisateur | Workspace Business Standard ou plus, Enterprise, ou abonnement Google AI [officiel, S23] |
| **Copilot dans Teams** (intelligent recap) | récapitulatif, notes, tâches ; partageable aux externes par Outlook | à vérifier | transcription à activer (sauf mode sans transcription, Copilot) [officiel, S24] | tenant Microsoft 365 de l'organisateur (EU Data Boundary selon le tenant, non vérifié pour le recap) | Teams Premium ou Microsoft 365 Copilot ; en préversion publique en partie [officiel, S24] |

Constats :

- Jobbbox **n'est ni responsable ni sous-traitant** de ces outils : c'est le compte de l'organisateur (le Human Coach, ou son entreprise) qui les active. Si un Human Coach les utilise, c'est son traitement à lui ; le contrat coach (#518) et la charte devront dire ce qui est permis.
- Aucun ne connaît la Coaching Session ni la Coach Conversation : rien ne revient dans Jobbbox sans copier-coller. Importer leurs comptes rendus (API Zoom, Drive, Graph) ferait entrer du texte de tiers et ajouterait trois destinataires : **pas en phase 1**.
- Leurs exigences de licence (Workspace payant, Copilot) excluent la plupart des coachs indépendants : on ne peut pas bâtir le parcours dessus.
- Option sobre : le Human Coach peut **coller** un résumé dans le champ « Compte rendu de séance », qu'il relit avant publication comme un compte rendu IA. Les règles de sortie (pas de nom de tiers…) ne s'appliquent alors que si on repasse le texte collé dans la tâche de résumé : à trancher.

## Recommandation

1. **Phase 1, sans IA** : notes privées du coach et compte rendu de séance à la main, avec le modèle ci-dessus, publié au Candidate dans la Coach Conversation de la Coaching Session et dans le Data export. Valeur immédiate, aucun nouveau destinataire, et c'est le repli de toutes les phases suivantes.
2. **Phase 2, transcription par lot après la séance, puis compte rendu IA relu par le coach** :
   - **Transcription : Mistral Voxtral (Mini ou Small Transcribe 3) par `api.eu.mistral.ai`**, avec ZDR demandée : seul fournisseur qui n'ajoute **aucun destinataire** (le Tool `mistral` existe et est dans l'UE), français et anglais, diarisation, le moins cher. Conditions : confirmer que la route audio est servie sur le point d'accès UE et que la diarisation de Voxtral 3 tient sur un dialogue français (échantillon synthétique).
   - **Repli, si Voxtral déçoit en français ou n'est pas servi dans l'UE : Gladia** (société et hébergement en France, très bon français, diarisation par lot), puis **AssemblyAI région UE** (meilleur français mesuré, mais société américaine : garanties de transfert). Deepgram et Speechmatics n'apportent rien de décisif ici. **Whisper auto-hébergé** seulement si le volume dépasse des milliers d'heures par mois ou si le product owner refuse tout sous-traitant pour l'audio.
   - **Résumé : Mistral UE, tâche `coaching_session_summary` marquée `euOnly`**, pas Anthropic hors UE après Redaction : la Redaction ne retire pas les noms de tiers ni les données sensibles d'une séance parlée. Redaction appliquée quand même, règles de sortie fixes (pas de nom de tiers, pas de donnée sensible, pas d'inférence d'émotion), transcription marquée comme donnée.
   - **Relecture obligatoire par le Human Coach** avant publication ; mention IA ; Provenance en deux étapes.
   - **Audio jamais conservé** ; transcription purgée après 30 jours ; compte rendu gardé avec la Coaching Session.
   - **Prochaines étapes → Action Cards par l'AI Coach** (Coach Actions qui ne recopient rien), jamais de Master CV, de Search Criteria ni de Coach Memory depuis la séance.
   - **Pas de Plan Quota** : un compte rendu IA inclus par Coaching Session payée, plafonné en durée.
3. **Pas de temps réel** (sous-titres en direct) tant qu'un besoin d'accessibilité n'est pas posé : plus cher, diarisation moins sûre (absente chez Gladia), et rien à montrer pendant la séance.
4. **Visios tierces** : ne rien intégrer ; dire dans l'aide et le contrat coach ce qui est permis ; un compte rendu collé passe par la même relecture.
5. **Dépendances** : la source de l'audio dépend de #845 (demander l'enregistrement **une piste par participant**) ; la base légale, le consentement des deux personnes, l'AIPD, la durée de conservation et la place des notes privées dans le Data export dépendent de #847. Livraison : entrée au registre `docs/privacy/register.md`, mise à jour de la fiche `mistral` dans `tools.ts` (finalité, `RECIPIENT_DATA`), une issue « Légal : » pour la politique de confidentialité (nouveau traitement, destinataire UE inchangé), Help Articles « Espace coach » et « Mes coachs humains ».

## Questions ouvertes pour le product owner

1. **Phasage** : d'accord pour une phase 1 sans IA (notes et compte rendu à la main) avant la transcription ?
2. **Voie du résumé** : la transcription et le résumé toujours dans l'UE (`euOnly`, Mistral), même si la qualité d'Anthropic après Redaction est meilleure ? Ou seulement sous EU AI Consent ?
3. **Un seul sous-traitant** : préférez-vous Voxtral (aucun nouveau destinataire) même s'il est un peu moins bon en français que Gladia ou AssemblyAI, ou la meilleure qualité avec un nouveau destinataire ?
4. **Relecture par le coach** obligatoire avant que le Candidate voie le compte rendu, ou publication directe avec mention IA ?
5. **Transcription visible du Candidate** (30 jours) ou seulement le compte rendu ?
6. **Notes privées du coach** : vue par séance seulement, ou aussi par Candidate (même sans Coach Access) ? Dans le Data export du Candidate ?
7. **Coût** : compte rendu IA inclus dans le Coaching Session Price (une séance, plafond 120 min), ou un Plan Feature / Plan Quota ?
8. **Effacement** : le Candidate peut-il effacer transcription et compte rendu d'une séance qu'il ne peut pas supprimer ?
9. **Visios tierces** : interdire, tolérer ou encadrer l'usage de Zoom AI Companion, Gemini ou Copilot par les Human Coaches pendant une Coaching Session (contrat #518) ? Accepter un résumé collé ?
10. **Essai** : autorisez-vous l'ajout de `api.eu.mistral.ai` (audio), `api.gladia.io` et `api.eu.assemblyai.com` au réseau d'une session de test, avec des clés d'essai, pour mesurer WER et diarisation sur un **dialogue synthétique** en français (voix de synthèse, aucune personne réelle) ?
11. **Temps réel** : un besoin de sous-titres en direct (accessibilité, public de 40 ans et plus) à prévoir dès maintenant ?
