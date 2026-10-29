# Recherche pour l'issue #499 : aide, tutoriels et motions accessibles pour un public de 40 ans et plus

Vérifié le 2026-10-29 sur `origin/main` (`4bb35f1f`), contre WCAG 2.2, le RGAA 4.1.2, les guides WAI du W3C, MDN, et la documentation de chaque outil. Partie de la carte #494 ; débloque #506.

Cadre posé par la carte et par ADR-0035 / #341 :
- **pas de GIF** ;
- les motions sont des **vidéos explicatives courtes** et des **micro-animations dans l'interface, à la demande** ;
- **pas de visite guidée, aucune aide proactive** : rien ne démarre seul ;
- le plancher d'accessibilité est ADR-0009 (16 px, taille de texte réglable, 4,5:1, toujours un libellé visible, `prefers-reduced-motion` déjà respecté par les tokens `--motion-fast` / `--motion-slow`, vérifiés par `packages/shared/src/design/css.test.ts`).

## Réponse courte

1. **Chaque vidéo** est sous-titrée (WebVTT `kind="captions"`, FR et EN), accompagnée d'une **transcription descriptive** affichée à côté, et **narrée de façon à décrire tout ce qui est à l'écran** (« description intégrée »). On remplit ainsi WCAG 1.2.2, 1.2.3 et 1.2.5 (AA) et les critères RGAA 4.1, 4.3 et 4.5 sans piste d'audiodescription séparée. Aucune lecture automatique, aucune musique de fond, lecteur natif `<video controls>` utilisable au clavier.
2. **Chaque micro-animation** se lance seulement sur un clic (« Voir comment »), dure moins de 5 s ou peut être mise en pause, est décorative (`aria-hidden`) à côté d'étapes écrites, et sous `prefers-reduced-motion: reduce` se remplace par une image fixe plus les étapes. Elle se fait en CSS/SVG dans le dépôt, comme `ActivityGlyph`, sans nouvelle dépendance ; Lottie seulement si un designer produit les fichiers.
3. **Hébergement** : servir les fichiers MP4 et VTT depuis notre propre origine ou un stockage objet dans l'UE, avec le lecteur natif. Zéro tiers, zéro cookie, rien à déclarer de plus. Bunny Stream est l'alternative gérée acceptable (pas de cookie d'après sa doc), à condition de bloquer la réplication hors UE. PeerTube est trop lourd à opérer pour une petite équipe.
4. **Production** : captures **Playwright** (`recordVideo`) rejouées sur un jeu de données de démo, en FR et en EN, puis montage et sous-titres en code avec **Remotion**, gratuit jusqu'à 3 personnes (licence payante au-delà). Le script de narration est la source unique : il donne la voix, le VTT et la transcription, tous versionnés.
5. **Durée et ton** : une tâche par vidéo, 30 à 90 s, jamais plus de 2 min ; un débit lent, le vouvoiement, les mots de l'interface à l'identique, et des chapitres si la vidéo dépasse une minute.

## Sources

- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, Recommandation : https://www.w3.org/TR/WCAG22/
- W3C, *Understanding SC 2.3.3 Animation from Interactions* : https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html (techniques C39 : https://www.w3.org/WAI/WCAG22/Techniques/css/C39, SCR40 : https://www.w3.org/WAI/WCAG22/Techniques/client-side-script/SCR40)
- W3C WAI, *Making Audio and Video Media Accessible* : https://www.w3.org/WAI/media/av/ ; sous-pages : sous-titres https://www.w3.org/WAI/media/av/captions/, transcriptions https://www.w3.org/WAI/media/av/transcripts/, description https://www.w3.org/WAI/media/av/description/, description intégrée https://www.w3.org/WAI/media/av/av-content/#integrate-description, lecteurs https://www.w3.org/WAI/media/av/player/, planification https://www.w3.org/WAI/media/av/planning/
- W3C WAI, *Older Users and Web Accessibility* : https://www.w3.org/WAI/older-users/ et *How WCAG 2 applies to older users* : https://www.w3.org/WAI/older-users/developing/
- DINUM, *RGAA 4.1.2, critères et tests* : https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/
- MDN, `prefers-reduced-motion` : https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion ; WebVTT : https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API
- CNIL, *Cookies et autres traceurs : comment mettre mon site en conformité* : https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/comment-mettre-mon-site-web-en-conformite
- bunny.net, *Stream : Data and privacy* : https://bunny.net/docs/stream/data-and-privacy.md ; *Replication* : https://bunny.net/docs/stream/replication ; *Pricing* : https://bunny.net/docs/stream/pricing ; *Embedding videos* : https://docs.bunny.net/docs/stream-embedding-videos
- PeerTube, *Privacy guide* : https://docs.joinpeertube.org/admin/privacy-guide ; *Embed API* : https://docs.joinpeertube.org/api/embed-player ; dépôt (AGPL-3.0) : https://github.com/Chocobozzz/PeerTube
- Playwright, *Videos* : https://playwright.dev/docs/videos
- Remotion, *License FAQ* : https://www.remotion.dev/docs/license/faq ; licence : https://github.com/remotion-dev/remotion/blob/main/LICENSE.md ; tarifs : https://remotion.dev/pricing
- Lottie : https://github.com/airbnb/lottie-web (MIT) et https://github.com/LottieFiles/dotlottie-web (MIT)
- Rive, *Web (JS) runtime* : https://rive.app/docs/runtimes/web/web-js ; runtime (MIT) : https://github.com/rive-app/rive-wasm
- Guo, Kim, Rubin, *How video production affects student engagement: an empirical study of MOOC videos*, L@S 2014 : https://doi.org/10.1145/2556325.2566239

Licences des dépôts lues via l'API GitHub le 2026-10-29 (`gh api repos/<owner>/<repo>`) : rive-wasm MIT, lottie-web MIT, dotlottie-web MIT, PeerTube AGPL-3.0, Remotion « NOASSERTION » (licence propre, voir §4).

## 1. Quel référentiel

- ADR-0009 vise **WCAG 2.1 AA**. WCAG 2.2 est une Recommandation du W3C ; elle reprend 2.1 et retire un seul critère, 4.1.1 Parsing (« WCAG 2.2 has removed one success criterion, 4.1.1 Parsing », WCAG 2.2, introduction). Viser 2.2 AA ne coûte donc rien de plus que 2.1 AA, à quelques critères près, dont trois touchent l'aide : **2.5.8 Target Size (Minimum)** (24 × 24 px CSS, AA), **3.2.6 Consistent Help** (A) et 2.4.11 Focus Not Obscured (AA).
- **RGAA** : la version en vigueur publiée sur le site de la DINUM est la **4.1.2**. Des sources secondaires annoncent un RGAA 5 aligné sur WCAG 2.2 « avant fin 2026 » ; aucune publication officielle n'a été trouvée sur accessibilite.numerique.gouv.fr. À revérifier avant #506.
- **Proposition** : amender ADR-0009 pour viser WCAG 2.2 AA (à trancher dans la carte, pas ici).

## 2. Vidéos explicatives : ce qu'exigent WCAG 2.2 et le RGAA

Les vidéos sont des médias **préenregistrés synchronisés** (image et son).

| Exigence | WCAG 2.2 | RGAA 4.1.2 | Ce que Jobbbox fait |
|---|---|---|---|
| Sous-titres | 1.2.2 Captions (Prerecorded), A | 4.3 (présence), 4.4 (pertinence) | Fichier WebVTT `kind="captions"` par langue, `srclang="fr"` / `"en"`. Les sous-titres transcrivent aussi les sons utiles (bip, notification). |
| Alternative ou audiodescription | 1.2.3, A : audiodescription **ou** alternative textuelle | 4.1 (transcription ou AD), 4.2 (pertinence) | Transcription descriptive affichée sous la vidéo (dépliable), qui nomme aussi ce qui se voit. |
| Audiodescription | 1.2.5 Audio Description (Prerecorded), **AA** : une transcription ne suffit plus | 4.5 (AD synchronisée si nécessaire), 4.6 | **Description intégrée** : la narration dit tout ce qui est montré (« Cliquez sur **Envoyer au coach**, en bas du panneau à droite »). Aucune information visuelle n'est muette, donc aucune AD séparée n'est nécessaire. |
| Identification | — | 4.7 (média clairement identifiable) | Un titre en texte juste au-dessus de la vidéo, qui dit la tâche et la durée (« Postuler à une offre, 1 min 10 »). |
| Son automatique | 1.4.2 Audio Control, A (au-delà de 3 s) | 4.10 | **Jamais de lecture automatique.** Pas d'attribut `autoplay`. |
| Contrôle clavier et pointeur | 2.1.1 Keyboard, A | 4.11, 4.13 | Lecteur natif `<video controls>` : clavier, lecteurs d'écran, zoom, réglages de sous-titres du navigateur et du système. |
| Flashs | 2.3.1 Three Flashes, A | 13.7 | Pas de transitions clignotantes au montage. |
| Taille des cibles | 2.5.8, AA (24 px) | — | Bouton « Voir la vidéo » au moins à la hauteur des contrôles d'ADR-0009 (44 px, comme l'icône Signalement). |
| Langue des signes, alternative complète | 1.2.6, 1.2.8, AAA | — | Hors plancher. La transcription descriptive couvre déjà l'essentiel de 1.2.8. |

**La description intégrée est la recommandation du W3C** : l'intégrer dans la piste principale est « easier and better for accessibility » qu'une piste séparée, mais elle se prévoit dès le script (WAI, *Audio and Video Content* et *Planning*). Une **transcription descriptive** (paroles plus descriptions visuelles) est aussi ce qui sert les personnes sourdes et aveugles (WAI, *Transcripts*).

**Lecteur** (WAI, *Media Players*) : utilisable au clavier, focus visible, contrôles nommés, contraste suffisant, compatible avec le zoom, la commande vocale et les lecteurs d'écran ; en plus, vitesse de lecture réglable et réglage de l'apparence des sous-titres. Le `<video controls>` natif fournit tout cela sans code ; un lecteur maison ne s'impose pas.

**Ce que dit le W3C du public âgé** (WAI, *Older Users*) : difficulté à entendre les aigus et à séparer les sons, surtout **avec une musique de fond** ; mémoire à court terme réduite (tâches en plusieurs étapes) ; distraction par le mouvement ; dextérité réduite (petits boutons). D'où : pas de musique, une tâche par vidéo, des étapes écrites à côté, de grandes cibles.

**Aide cohérente** (WCAG 3.2.6, A) : un mécanisme d'aide répété sur plusieurs pages doit rester au même endroit relatif. C'est déjà le cas avec « Aide et coach » dans la Top Bar (ADR-0035). Les vidéos et animations vivent **dans** les Help Articles, ouvertes depuis ce même panneau ; elles ne créent pas un deuxième point d'entrée.

## 3. Micro-animations dans l'interface

### Exigences

- **2.2.2 Pause, Stop, Hide (A)** : un mouvement qui démarre seul, dure plus de 5 s et tourne en parallèle d'autre contenu doit pouvoir être mis en pause, arrêté ou masqué. Une animation **lancée par un clic** et **de moins de 5 s** ne tombe pas sous ce critère ; une boucle, si.
- **2.3.3 Animation from Interactions (AAA)** : on doit pouvoir désactiver un mouvement déclenché par une interaction, sauf s'il est essentiel. Le W3C compte comme mouvement ce qui glisse ou change de taille ; un changement de couleur ou d'opacité qui ne change ni taille, ni forme, ni position n'en est pas (*Understanding 2.3.3*). Techniques suffisantes : **C39** (requête CSS `prefers-reduced-motion`) et **SCR40** (la même en JavaScript). Ce critère AAA est hors plancher, mais Jobbbox l'applique déjà (tokens à 0 ms, glyphe immobile, ADR-0009) : il faut le garder.
- `prefers-reduced-motion` est « Baseline widely available » depuis janvier 2020 et suit les réglages de macOS, iOS, Windows, Android, GNOME et KDE (MDN). MDN recommande de remplacer le mouvement par un fondu d'opacité, qui ne déclenche pas les troubles vestibulaires.

### Recommandations

1. **À la demande seulement** : un bouton texte « Voir comment » dans le Help Article ou l'état vide. Aucune animation ne démarre au chargement, au survol, ni au premier passage (pas de tour, #341).
2. **Courte, sans boucle** : 2 à 5 s, une seule lecture, avec « Revoir ». Si elle dépasse 5 s, un bouton « Pause » libellé.
3. **Décorative** : `aria-hidden="true"`, et les étapes en texte juste à côté (ADR-0009 : jamais le seul endroit où vit une information). Le lecteur d'écran lit les étapes, pas l'animation.
4. **Mouvement réduit** : sous `prefers-reduced-motion: reduce`, l'image de l'état final, sans transition (ou un fondu d'opacité), plus les étapes. Un test, comme `css.test.ts`, vérifie la règle.
5. **Technique** : CSS et SVG dans le dépôt, sur les tokens `--motion-*`, comme `ActivityGlyph` et `activity-glyph-frames.ts`. Pas de dépendance, diffable en revue, et le thème et la taille de texte suivent d'eux-mêmes (`rem`).

### Lottie ou Rive, si un designer s'en charge

| | Lottie (lottie-web, dotlottie-web) | Rive |
|---|---|---|
| Licence du runtime | MIT | MIT (rive-wasm) |
| Format source | JSON (diffable) ou `.lottie` (zip) | `.riv` binaire ; l'éditeur est un service propriétaire |
| Interactivité | lecture linéaire | machines à états (`stateMachine`), liaison de données |
| Mouvement réduit | rien d'intégré : c'est à nous de ne pas lancer `play()` et d'afficher la dernière image | rien d'intégré dans la doc lue : même travail |
| Texte dans l'animation | rendu en tracés : ne suit pas la taille de texte ni la langue | idem |

Aucun des deux ne règle l'accessibilité à notre place, et le texte dessiné dans l'animation ne suit ni la taille choisie par le Candidate ni la langue. **Pour des micro-animations de quelques secondes, le CSS/SVG maison suffit** ; Lottie (JSON versionnable, runtime MIT) passe avant Rive si un jour un designer livre les animations, parce que la source reste lisible dans une pull request.

## 4. Production maintenable et versionnée

### Captures : Playwright

- `recordVideo: { dir }` sur un contexte, ou l'option `video` de la config ; le fichier est écrit **à la fermeture du contexte** (`await context.close()`).
- Par défaut la vidéo est **réduite pour tenir dans 800 × 800** : il faut fixer la taille (`recordVideo.size`) et le viewport à la même valeur, par exemple 1280 × 720.
- L'option `show: { actions }` surligne chaque action et l'affiche en sous-titre, avec une durée réglable (500 ms par défaut). Utile pour un brouillon ; pour la version publiée, on préfère nos propres sous-titres.
- Le dépôt a déjà Playwright (e2e, `@axe-core/playwright`). Un script de capture par vidéo, rejoué sur un **jeu de données de démo** (aucune donnée réelle de Candidate), en `fr` puis en `en`, régénère la vidéo quand l'écran change. C'est ce qui rend les vidéos maintenables : elles cassent comme un test, pas en silence.
- Pour la lisibilité à 40+ : le texte de l'interface capturée doit rester d'au moins 16 px **après** réduction dans le lecteur ; capturer avec une taille de texte agrandie (le réglage du Candidate, ADR-0009) et zoomer sur la zone d'action au montage.

### Montage, titres, sous-titres : Remotion

- Vidéo écrite en React : les captures Playwright, les titres, les zooms et les sous-titres se composent en code, dans le dépôt, et se rendent en MP4 en CI.
- **Licence** : gratuite pour les particuliers et les organisations **jusqu'à 3 personnes** (prestataires compris ; les effectifs s'additionnent en cas de collaboration). Au-delà : licence d'entreprise, 25 $/mois par personne qui écrit du code Remotion (agents de code compris), ou 0,01 $ par rendu automatisé avec un minimum de 100 $/mois (*License FAQ*). **À vérifier** : l'effectif de l'équipe qui touchera le code Remotion.
- Alternative sans licence : ffmpeg pour assembler les captures, et les sous-titres en WebVTT à part. Moins confortable pour les zooms et titres, mais aucune condition.

### Une source unique : le script

Par vidéo et par langue, un script de narration Markdown versionné (relu par une personne, comme les Help Articles : ADR-0035, ADR-0039). Il donne :
- la voix (enregistrée par une personne, ou synthétique) ;
- le fichier WebVTT, calé sur la voix ;
- la transcription descriptive affichée sous la vidéo.

Le FR fait foi (carte #494). Un test peut vérifier, comme pour les Help Articles, que chaque vidéo a FR et EN, un VTT et une transcription.

**Voix synthétique** : si la narration est générée, l'art. 50(2) de l'AI Act impose au **fournisseur** du système de synthèse un marquage lisible par machine ; voir `docs/research/issue-318.md`. Une voix neutre qui n'imite personne ne relève pas de l'hypertrucage (art. 50(4)). **Juriste** : à confirmer si la voix générée est retenue.

## 5. Hébergement dans l'UE sans cookie tiers

Le cadre exclut YouTube. Côté CNIL, seuls les traceurs strictement nécessaires au service demandé sont exemptés de consentement (préférences d'interface, équilibrage de charge, authentification…) ; un lecteur tiers qui dépose des traceurs relève du consentement.

| Option | Cookies et traceurs | Données dans l'UE | Effort pour une petite équipe | Avis |
|---|---|---|---|---|
| **Fichiers statiques chez nous** (MP4 H.264 + VTT, même origine ou stockage objet UE, `<video controls>`) | aucun tiers | oui, si l'hébergeur actuel est dans l'UE | très faible : quelques Mo par vidéo de 30 à 90 s | **Recommandé** |
| **Bunny Stream** | « does not set cookies or transmit PII » ; préférences et reprise en `localStorage` côté navigateur ; télémétrie technique « anonymised » vers des points CDN « worldwide » | région par défaut Francfort ; la réplication propose aussi des régions hors UE (Los Angeles, New York, Singapour…), qu'on ne peut plus retirer une fois ajoutées | faible : encodage HLS, lecteur iframe, sous-titres configurables | Acceptable si l'on veut du streaming adaptatif ; n'ajouter **aucune** région hors UE ; DPA et localisation de la télémétrie à vérifier (**Juriste**) |
| **PeerTube** (auto-hébergé) | en P2P, l'IP du spectateur est visible du tracker et des autres pairs ; désactivable par l'admin et par embed (`p2p=0`, depuis 4.1.0) | oui, si on l'héberge | élevé : une instance à tenir à jour, AGPL-3.0 | Pas pour nous : trop d'exploitation pour une poignée de vidéos |

**Pourquoi le statique suffit** : des vidéos de 30 à 90 s en 720p ou 1080p pèsent quelques Mo ; le streaming adaptatif n'apporte rien à cette échelle. Le lecteur natif est le plus accessible (§2), il n'y a aucun traceur, rien à ajouter au registre des traitements, et la question du bandeau cookies (« Not yet specified » de #494) reste fermée pour la vidéo. Fournir l'attribut `poster` (image fixe) et `preload="none"` ou `"metadata"` pour ne rien télécharger avant le clic.

## 6. Durée et ton

- **Durée** : sur 6,9 millions de sessions vidéo de MOOC, le temps d'engagement médian plafonne vers **6 minutes**, et les vidéos plus courtes sont regardées plus complètement (Guo, Kim, Rubin, 2014). Pour une aide d'interface, où l'on cherche une seule tâche, on vise bien moins : **30 à 90 s, une tâche par vidéo, 2 min au plus**. Au-delà d'une minute, des chapitres WebVTT (`kind="chapters"`).
- **Ton**, déduit des besoins listés par le W3C pour le public âgé et du style des Help Articles :
  - vouvoiement, phrases courtes, une action par phrase ;
  - les libellés de l'interface **mot pour mot**, en gras dans la transcription (« Envoyer au coach ») ;
  - un débit posé, des pauses entre les étapes, aucun jargon (ou le terme du glossaire, défini) ;
  - **pas de musique de fond** ;
  - commencer par le résultat (« En une minute, vous allez envoyer votre candidature ») et finir sur où retrouver l'aide (« Aide et coach »).
- **Visuel** : zoom sur la zone d'action, curseur agrandi, pas de transitions rapides, contraste de l'interface conservé (ADR-0009, 4,5:1).

## 7. Points ouverts

- **ADR-0009 vers WCAG 2.2 AA** : à décider dans la carte (#494) ; la recherche ne trouve aucun coût caché.
- **RGAA 5** : non publié officiellement à ce jour d'après le site de la DINUM ; revérifier avant d'écrire la déclaration d'accessibilité.
- **Effectif Remotion** : gratuit jusqu'à 3 personnes ; sinon licence ou ffmpeg.
- **Voix** : humaine ou synthétique (implications AI Act art. 50(2), **Juriste**).
- **Bunny Stream** (si retenu) : DPA, entité contractante et destination de la télémétrie, non trouvés dans la documentation lue (**Juriste**).
- **Emplacement des sources** (scripts, VTT, captures) : `packages/help` ou un paquet à part. À trancher dans #506, à la lumière d'ADR-0039.
