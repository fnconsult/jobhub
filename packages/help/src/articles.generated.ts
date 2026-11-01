// Written by `npm run build -w @jobhub/help` from articles/<locale>/<id>.md: edit those, never this file.
import type { HelpArticle, HelpLocale } from "./types";

export const ARTICLES: Record<HelpLocale, readonly HelpArticle[]> = {
  "fr": [
    {
      "id": "page-home",
      "locale": "fr",
      "kind": "page",
      "title": "Accueil",
      "synonyms": [
        "accueil",
        "démarrer",
        "commencer",
        "début",
        "par où commencer",
        "nouvelle conversation"
      ],
      "route": "/",
      "body": "L'accueil est votre point de départ dans Jobbbox. Le menu mène à vos candidatures, à votre agenda, à vos recherches d'offres et à vos Job Digests ; « Mon compte » est en bas du menu.\n\nPour commencer, créez un profil : votre CV de référence et vos critères de recherche. Votre coach s'en sert pour chercher des offres et préparer vos candidatures.\n\nUne question ? Ouvrez « Aide et coach » en haut de la page.\n\nAvec la nouvelle présentation, l'accueil est une nouvelle conversation avec votre coach IA. Écrivez dans la zone de message, en bas de la page, ou choisissez une suggestion juste au-dessus : « Chercher des offres », « Ajouter une candidature », « Planifier un entretien », « Demander au coach ». La conversation est enregistrée à votre premier message et apparaît sous « Coach » dans le menu, où vous pouvez la renommer ou la supprimer. « Nouvelle conversation », en haut du menu, en commence une autre ; « Effacer », en haut de la page, en supprime tous les messages.\n\nPendant que vous écrivez, les articles de l'aide qui correspondent s'affichent au-dessus de la zone de message, « Dans l'aide, sans IA », à la place des suggestions. Un article s'ouvre à côté de la conversation, comme « Comment marche cette page ? » tant que la conversation est vide ; « Demander au coach » y commence une question à son sujet.\nEn bas du menu, « Aide et légal » mène au centre d'aide (« Aide »), aux textes légaux (« Légal ») et à ce qui change dans Jobbbox (« Nouveautés »). Sur téléphone, ces liens sont dans le menu."
    },
    {
      "id": "page-conversation",
      "locale": "fr",
      "kind": "page",
      "title": "Conversation avec le coach",
      "synonyms": [
        "conversation",
        "discussion",
        "coach",
        "coach IA",
        "renommer une conversation",
        "supprimer une conversation"
      ],
      "route": "/conversations/[id]",
      "body": "Cette page est l'une de vos conversations avec votre coach IA, rouverte depuis « Coach » dans le menu. Elle reprend vos messages et ses réponses ; sous chaque réponse, une ligne discrète dit ce qui l'a produite, et « Cela répond à votre question ? » vous permet de le dire.\n\nÉcrivez dans la zone de message, en bas de la page. Pendant que le coach répond, « Arrêter » interrompt sa réponse.\n\nPour renommer ou supprimer la conversation, ouvrez ses actions (« … ») à côté de son nom dans le menu. « Effacer », en haut de la page, en supprime tous les messages ; la mémoire du coach reste."
    },
    {
      "id": "page-new-profile",
      "locale": "fr",
      "kind": "page",
      "title": "Créer un profil",
      "synonyms": [
        "nouveau profil",
        "créer",
        "déposer mon cv",
        "questionnaire",
        "commencer"
      ],
      "route": "/profils/nouveau",
      "body": "Un profil, c'est un métier que vous visez : un CV de référence et des critères de recherche. Vous pouvez en avoir plusieurs, selon votre offre.\n\nSi vous avez un CV, déposez-le : votre coach le lit et vous propose un CV de référence. Sinon, répondez à ses questions sur votre parcours, une à la fois ; comptez une dizaine de minutes.\n\nDans les deux cas, vous vérifiez et corrigez tout avant d'enregistrer. Rien n'est ajouté que vous n'ayez dit."
    },
    {
      "id": "page-agenda",
      "locale": "fr",
      "kind": "page",
      "title": "Entretiens et rendez-vous",
      "synonyms": [
        "agenda",
        "calendrier",
        "entretien",
        "rendez-vous",
        "semaine",
        "mois",
        "séance"
      ],
      "route": "/agenda",
      "body": "L'agenda montre vos entretiens et vos séances avec un coach humain. Affichez-le en liste (les prochains rendez-vous, jour par jour), par semaine ou par mois.\n\nAjoutez un entretien avec « Ajouter un entretien », ou depuis la rubrique « Entretiens » d'une candidature à l'étape « Entretien ».\n\nLes rendez-vous passés restent visibles, en plus pâle. La veille à 18 h, Jobbbox peut vous envoyer un e-mail de rappel : réglez-le dans Mon compte, rubrique Rappels.\n\nPendant les 14 jours qui suivent le paiement d'une séance avec un coach humain, et tant qu'elle n'a pas eu lieu, « Renoncer au contrat ici » l'annule et vous la rembourse en entier ; le coach est prévenu."
    },
    {
      "id": "page-job-digests",
      "locale": "fr",
      "kind": "page",
      "title": "Job Digests",
      "synonyms": [
        "digest",
        "sélection",
        "offres par e-mail",
        "recevoir",
        "fréquence",
        "alerte"
      ],
      "route": "/job-digests",
      "body": "Un Job Digest est une sélection de nouvelles offres qui correspondent aux critères de recherche d'un profil. Vous le recevez par e-mail et le retrouvez sur cette page.\n\nPour chaque profil, choisissez de le recevoir et à quelle fréquence, dans la limite de votre offre : chaque semaine le lundi à 7 h, ou chaque jour à 7 h (heure de Paris).\n\nSeules les offres que vous n'avez pas encore vues y figurent. S'il n'y en a aucune, rien n'est envoyé."
    },
    {
      "id": "page-profile",
      "locale": "fr",
      "kind": "page",
      "title": "La page d'un profil",
      "synonyms": [
        "profil",
        "métier",
        "critères",
        "versions",
        "télécharger",
        "archiver",
        "dupliquer"
      ],
      "route": "/profils/[id]",
      "body": "Un profil rassemble votre CV de référence et vos critères de recherche pour un métier. Ses rubriques : Propositions, CV de référence, ATS Score, Télécharger et Gérer.\n\nCommencez par l'ATS Score : il dit si les logiciels de recrutement liront bien votre CV. Les corrections que propose votre coach apparaissent dans « Propositions » ; acceptez-les ou ignorez-les une par une.\n\nChaque enregistrement du CV de référence crée une nouvelle version, et vous pouvez revenir à une version précédente. « Gérer » permet de renommer, dupliquer ou archiver le profil."
    },
    {
      "id": "page-application",
      "locale": "fr",
      "kind": "page",
      "title": "La page d'une candidature",
      "synonyms": [
        "candidature",
        "documents",
        "correspondance",
        "entretiens",
        "dossier entreprise",
        "lettre de motivation",
        "statut"
      ],
      "route": "/candidatures/[id]",
      "body": "Elle rassemble tout ce qui concerne une offre que vous suivez, en rubriques : Propositions, Documents, Correspondance, Entretiens, Avis des coachs, Dossier entreprise, Contacts et L'offre.\n\nCommencez par « Correspondance » pour voir ce qui colle et ce qui manque, puis préparez votre CV adapté et votre lettre de motivation dans « Documents ». Vous les vérifiez toujours avant de les enregistrer.\n\nMettez le statut à jour quand vous avancez : « Postulée » quand vous avez envoyé votre candidature, « Entretien » pour noter vos entretiens. Si elle reste sans réponse, votre coach vous propose une relance."
    },
    {
      "id": "page-job-offer",
      "locale": "fr",
      "kind": "page",
      "title": "La page d'une offre",
      "synonyms": [
        "offre",
        "annonce",
        "poste",
        "enregistrer",
        "suivre"
      ],
      "route": "/offres/[id]",
      "body": "Elle montre l'offre d'emploi : l'employeur, le lieu, le type de contrat, le télétravail et le salaire quand ils sont indiqués, les compétences demandées et le texte de l'offre.\n\nLe score de correspondance dit à quel point le CV de référence d'un de vos profils correspond à l'offre. Choisissez le profil à utiliser, puis « Enregistrer l'offre » : elle devient une candidature que vous suivez dans « Mes candidatures »."
    },
    {
      "id": "page-job-search",
      "locale": "fr",
      "kind": "page",
      "title": "Le résultat d'une recherche",
      "synonyms": [
        "résultat",
        "offres trouvées",
        "recherche terminée"
      ],
      "route": "/recherches/[id]",
      "body": "Cette page montre une recherche d'offres et les offres qu'elle a trouvées, classées par score de correspondance avec le profil.\n\nOuvrez une offre pour la lire en entier, puis enregistrez-la pour la suivre dans vos candidatures. « Relancer une recherche » en lance une nouvelle pour le même profil."
    },
    {
      "id": "page-applications",
      "locale": "fr",
      "kind": "page",
      "title": "Mes candidatures",
      "synonyms": [
        "candidatures",
        "suivi",
        "offres suivies",
        "tableau",
        "liste",
        "statut",
        "archivée",
        "à traiter",
        "tout voir"
      ],
      "route": "/candidatures",
      "body": "Cette page rassemble toutes les offres que vous suivez. Chaque offre enregistrée devient une candidature, liée à l'un de vos profils.\n\nAffichez-les en liste ou en tableau, une colonne par statut : À postuler, Postulée, Relancée, Entretien, Offre reçue, Acceptée, Refusée, Abandonnée. Filtrez par profil ou par statut ; les candidatures archivées restent masquées sauf si vous demandez à les voir.\n\nOuvrez une candidature pour préparer vos documents, voir le score de correspondance et noter vos entretiens.\n\nAvec la nouvelle présentation, « Mes candidatures » est une conversation avec votre coach IA, la même à chaque visite. Vos candidatures en cours y sont listées dans une carte : leur statut, leur score de correspondance et celles « à traiter », quand une relance est prête ou qu'une candidature reste sans réponse. Cliquez sur une ligne pour ouvrir la candidature ; « Les afficher » montre aussi les candidatures archivées. Demandez au coach laquelle traiter en premier, ou partez d'une suggestion au-dessus de la zone de message : « Ajouter une candidature », « Chercher des offres ».\n\nDans le menu, « Mes candidatures » se déroule sur vos candidatures les plus récentes, et sur celles à traiter, marquées d'un point ; « Tout voir » mène à cette page. La flèche à côté replie ou déroule la liste, et ce navigateur s'en souvient."
    },
    {
      "id": "page-human-coaches",
      "locale": "fr",
      "kind": "page",
      "title": "Mes coachs humains",
      "synonyms": [
        "coach humain",
        "séance",
        "visio",
        "professionnel",
        "rh",
        "accès coach",
        "réserver"
      ],
      "route": "/coachs",
      "body": "En plus de votre coach IA, vous pouvez réserver une séance en visio avec un professionnel RH sélectionné par Jobbbox. « Réserver une séance avec … » ouvre d'abord la page Votre commande de séance : le récapitulatif, la case d'acceptation des CGV et la demande que le service commence immédiatement. Payez la séance, puis choisissez votre créneau.\n\nAvec votre accord, un coach peut lire vos profils et vos candidatures, et commenter vos documents de candidature. Il ne peut rien modifier, et vous retirez cet accès à tout moment."
    },
    {
      "id": "page-subscription",
      "locale": "fr",
      "kind": "page",
      "title": "Mon abonnement",
      "synonyms": [
        "abonnement",
        "prix",
        "payer",
        "paiement",
        "premium",
        "standard",
        "gratuite",
        "résilier",
        "résiliation"
      ],
      "route": "/abonnement",
      "body": "Cette page montre votre offre (Gratuite, Standard ou Premium) et ce qu'elle comprend : le nombre de profils, et chaque semaine les scores, les recherches d'offres et les contacts enrichis.\n\n« Résilier votre contrat » arrête votre abonnement à la fin de la période déjà payée, en deux clics depuis cette page. Une fois la résiliation programmée, la page affiche « Votre offre actuelle : <offre> jusqu'au <date> ».\n\n« Gérer mon abonnement » ouvre la page sécurisée de Stripe, notre prestataire de paiement : c'est là que vous changez d'offre ou de moyen de paiement, et que vous annulez une résiliation programmée. Jobbbox ne voit jamais votre numéro de carte.\n\n« Choisir l'offre … » ouvre d'abord la page Votre commande : le récapitulatif de l'offre, la case d'acceptation des CGV et la demande que le service commence immédiatement, avant le paiement sur la page de Stripe.\n\nPendant les 14 jours qui suivent votre abonnement, « Renoncer au contrat ici » vous permet de vous rétracter, sans motif : votre abonnement est annulé tout de suite et vous repassez à l'offre Gratuite. Le montant payé vous est remboursé en entier, ou, si vous avez demandé que le service commence immédiatement, moins la part des jours écoulés depuis le début de la période. Changer d'offre dans Stripe ne fait pas repartir ce délai.\n\nSi nous baissons ce que comprend votre offre (moins de recherches d'offres par semaine, une fonctionnalité retirée…), vous en êtes prévenu par e-mail au moins 30 jours avant, avec la raison et la date. Un encadré « Votre offre … change le … » l'affiche aussi sur cette page : son bouton « Résilier sans frais » arrête votre abonnement tout de suite, et la part de la période payée qui n'aura pas servi vous est remboursée au prorata. Vous pouvez le faire jusqu'à 30 jours après la date du changement."
    },
    {
      "id": "page-account",
      "locale": "fr",
      "kind": "page",
      "title": "Mon compte",
      "synonyms": [
        "compte",
        "paramètres",
        "réglages",
        "préférences",
        "langue",
        "thème",
        "mode sombre",
        "connexion",
        "rappels"
      ],
      "route": "/compte",
      "body": "Mon compte rassemble vos réglages, en rubriques : Profils, Relances, Rappels, IA européenne, Connexion, Préférences, Outils et Mes données.\n\nDans Préférences, changez la langue de l'interface, la taille du texte et le thème : Clair, Sombre, ou Système, qui suit le réglage de votre appareil. Le thème et la taille du texte sont retenus sur cet appareil. Dans Relances, choisissez après combien de jours ouvrés votre coach propose une relance ; dans Rappels, l'e-mail de rappel la veille de vos rendez-vous.\n\nMes données permet de télécharger toutes vos données ou de supprimer votre compte.\n\nAvec la nouvelle présentation, « Aide », en haut de la page, ouvre cet article à côté de la page. « Demander au coach » y commence une nouvelle conversation avec votre coach IA à propos de Mon compte."
    },
    {
      "id": "page-acceptance",
      "locale": "fr",
      "kind": "page",
      "title": "Nos conditions d'utilisation",
      "synonyms": [
        "CGU",
        "conditions d'utilisation",
        "accepter",
        "acceptation",
        "nouvelle version",
        "case à cocher",
        "accepter et continuer"
      ],
      "route": "/acceptation",
      "body": "Cet écran s'affiche après la connexion quand les conditions générales d'utilisation (CGU) attendent votre accord : la première fois, puis à chaque nouvelle version qui change vos droits. Une version mineure ne vous est pas redemandée.\n\n« Lire les CGU » ouvre la version à accepter, avec sa date. Cochez « J'accepte les CGU (version du JJ/MM/AAAA) », puis « Accepter et continuer » : vous revenez à la page que vous vouliez ouvrir. La case n'est jamais cochée pour vous, et l'écran ne revient pas pour la même version.\n\nTant que vous n'avez pas accepté, vous pouvez toujours ouvrir Mes données, pour télécharger vos données ou supprimer votre compte, et Abonnement, pour vous rétracter ou résilier. Votre abonnement continue de courir.\n\nEn anglais, l'écran rappelle que le texte français fait foi."
    },
    {
      "id": "page-job-searches",
      "locale": "fr",
      "kind": "page",
      "title": "Recherches d'offres",
      "synonyms": [
        "recherche",
        "chercher",
        "trouver",
        "nouvelles offres",
        "lancer"
      ],
      "route": "/recherches",
      "body": "Votre coach cherche des offres d'emploi selon les critères de recherche d'un profil. Choisissez le profil, ou tous vos profils actifs, puis lancez la recherche.\n\nLa page se met à jour toute seule pendant la recherche, et vous pouvez l'arrêter. Les dernières offres trouvées s'affichent avec leur score de correspondance.\n\nChaque recherche compte une fois dans le quota de votre offre. Si elle échoue, ou si vous l'arrêtez avant qu'elle ait trouvé une offre, elle ne compte pas."
    },
    {
      "id": "page-withdrawal",
      "locale": "fr",
      "kind": "page",
      "title": "Renoncer au contrat ici",
      "synonyms": [
        "rétractation",
        "rétracter",
        "renoncer",
        "remboursement",
        "rembourser",
        "annuler",
        "14 jours",
        "délai de rétractation"
      ],
      "route": "/abonnement/retractation",
      "body": "Cette page vous permet de vous rétracter d'un contrat conclu sur Jobbbox, sans donner de motif : votre abonnement à une offre, pendant les 14 jours qui suivent sa souscription, ou une séance avec un coach humain, pendant les 14 jours qui suivent son paiement. Une séance réservée avec la demande que le service commence immédiatement ne peut plus faire l'objet d'une rétractation une fois qu'elle a eu lieu. Le délai court jusqu'à la fin du 14e jour, heure de Paris ; si ce jour est un samedi, un dimanche ou un jour férié, il est prolongé jusqu'au jour ouvrable suivant.\n\nVérifiez le contrat, sa date et le montant payé, indiquez votre nom, puis choisissez où recevoir l'accusé de réception : l'adresse de votre compte ou une autre. « Confirmer la rétractation » annule le contrat tout de suite et vous rembourse sur le moyen de paiement utilisé ; selon votre banque, le remboursement apparaît sous 5 à 10 jours ouvrés. Le remboursement est entier, sauf pour un abonnement souscrit avec la demande que le service commence immédiatement : vous payez alors le service déjà fourni, et la page indique le montant « Remboursé si vous confirmez maintenant » (le montant payé, moins la part des jours écoulés depuis le début de la période).\n\nVous recevez aussitôt par e-mail un accusé de réception avec la date et l'heure de votre rétractation : conservez-le."
    },
    {
      "id": "page-subscription-reduction",
      "locale": "fr",
      "kind": "page",
      "title": "Résilier sans frais",
      "synonyms": [
        "baisse",
        "offre réduite",
        "changement d'offre",
        "remboursement",
        "prorata",
        "résilier",
        "résiliation"
      ],
      "route": "/abonnement/baisse",
      "body": "Quand nous baissons ce que comprend votre offre payante, vous recevez un e-mail au moins 30 jours avant la date du changement : ce qui change, pourquoi et à quelle date. Si ce changement ne vous convient pas, vous pouvez résilier sans frais.\n\nCette page, ouverte depuis l'e-mail ou depuis Mon abonnement, rappelle ce qui change, la raison et la date. « Confirmer la résiliation » arrête votre abonnement tout de suite : vous repassez à l'offre Gratuite, et nous vous remboursons au prorata la part de la période payée qui n'aura pas servi. Le remboursement apparaît sur votre relevé sous 5 à 10 jours.\n\nVous pouvez résilier ainsi avant la date du changement, ou jusqu'à 30 jours après. Si vous gardez votre abonnement, vous n'avez rien à faire."
    },
    {
      "id": "page-subscription-cancellation",
      "locale": "fr",
      "kind": "page",
      "title": "Résilier votre contrat",
      "synonyms": [
        "résilier",
        "résiliation",
        "arrêter",
        "annuler",
        "abonnement",
        "désabonner",
        "fin du contrat",
        "prélèvement"
      ],
      "route": "/abonnement/resiliation",
      "body": "Cette page résilie votre abonnement à une offre payante. Elle indique votre offre et la date de fin du contrat, c'est-à-dire la fin de la période déjà payée : vous gardez votre offre jusqu'à cette date, aucun prélèvement ne suit, puis vous passez à l'offre Gratuite.\n\n« Confirmer la résiliation » enregistre votre demande. Vous recevez aussitôt par e-mail un accusé de réception avec la date de votre demande et la date de fin du contrat : conservez-le.\n\nVous changez d'avis ? Jusqu'à la date de fin, annulez la résiliation depuis Mon abonnement, avec « Gérer mon abonnement »."
    },
    {
      "id": "page-job-digest",
      "locale": "fr",
      "kind": "page",
      "title": "Un Job Digest",
      "synonyms": [
        "digest",
        "sélection",
        "offres reçues"
      ],
      "route": "/job-digests/[id]",
      "body": "Ce Job Digest rassemble les nouvelles offres trouvées pour un profil, classées par score de correspondance.\n\nOuvrez une offre pour la lire, puis enregistrez-la pour la suivre dans vos candidatures. Un Job Digest ne compte dans aucun quota."
    },
    {
      "id": "page-order",
      "locale": "fr",
      "kind": "page",
      "title": "Votre commande",
      "synonyms": [
        "commande",
        "commander",
        "payer",
        "paiement",
        "cgv",
        "conditions générales de vente",
        "récapitulatif",
        "exécution immédiate",
        "demande expresse"
      ],
      "route": "/abonnement/commande",
      "body": "Cette page s'affiche quand vous choisissez une offre, avant le paiement. Le récapitulatif rappelle l'offre, son prix TTC, sa périodicité et sa reconduction : l'abonnement est reconduit automatiquement jusqu'à sa résiliation.\n\nQuand nos conditions générales de vente sont publiées, cochez « J'accepte les CGV (version du JJ/MM/AAAA) » pour continuer ; le lien juste au-dessus ouvre cette version. La case n'est jamais cochée pour vous.\n\nLa deuxième case, « Je demande que le service commence immédiatement », est facultative. Sans elle, vous payez et votre offre commence de la même façon, mais une rétractation vous est remboursée en entier. Avec elle, une rétractation vous rembourse le montant payé, moins la part des jours écoulés depuis le début de la période.\n\n« Passer au paiement » ouvre la page sécurisée de Stripe, notre prestataire de paiement. Une fois le paiement confirmé, vous recevez par e-mail la confirmation de votre commande, avec le lien vers la version des CGV acceptée et l'emplacement de « Renoncer au contrat ici » : conservez-la.\n\nSi vous avez déjà une offre payante, vous changez d'offre sur la page de Stripe, depuis « Gérer mon abonnement », sans passer par cette page."
    },
    {
      "id": "page-coaching-order",
      "locale": "fr",
      "kind": "page",
      "title": "Votre commande de séance",
      "synonyms": [
        "commande",
        "séance",
        "coach humain",
        "payer",
        "paiement",
        "cgv",
        "conditions générales de vente",
        "exécution immédiate",
        "demande expresse"
      ],
      "route": "/coachs/commande",
      "body": "Cette page s'affiche quand vous réservez une séance avec un coach humain, avant le paiement. Le récapitulatif rappelle le coach et le prix TTC de la séance, un paiement unique, sans reconduction.\n\nQuand nos conditions générales de vente sont publiées, cochez « J'accepte les CGV (version du JJ/MM/AAAA) » pour continuer ; le lien juste au-dessus ouvre cette version. La case n'est jamais cochée pour vous.\n\nLa deuxième case est facultative : « Je demande que le service commence immédiatement. Je comprends qu'en cas de rétractation je paierai le service déjà fourni et que je perds mon droit de rétractation une fois la séance réalisée. » Sans elle, vous payez et réservez votre séance de la même façon, et une rétractation dans les 14 jours vous est remboursée en entier, même si la séance a eu lieu. Avec elle, vous pouvez vous rétracter tant que la séance n'a pas eu lieu, remboursé en entier ; plus après.\n\n« Passer au paiement » ouvre la page sécurisée de Stripe, notre prestataire de paiement. Une fois le paiement confirmé, vous recevez par e-mail la confirmation de votre commande : conservez-la."
    },
    {
      "id": "glossary-ats-score",
      "locale": "fr",
      "kind": "glossary",
      "title": "ATS Score",
      "synonyms": [
        "score ats",
        "logiciel de recrutement",
        "robot",
        "lisibilité",
        "mots-clés",
        "lecture du cv"
      ],
      "route": null,
      "body": "Les recruteurs utilisent des logiciels de recrutement (ATS) qui lisent votre CV avant une personne. L'ATS Score, sur 100, dit si ces logiciels liront bien votre CV de référence pour le métier visé.\n\nIl combine la lisibilité (coordonnées, titre, expériences datées…) et les mots-clés du métier. Il se calcule sans IA, par des règles fixes, et ne dépend d'aucune offre.\n\nLes corrections pour l'améliorer, elles, viennent de votre coach : vous les retrouvez dans les Propositions du profil."
    },
    {
      "id": "glossary-tailored-cv",
      "locale": "fr",
      "kind": "glossary",
      "title": "CV adapté",
      "synonyms": [
        "cv personnalisé",
        "cv sur mesure",
        "adapter",
        "tailored cv"
      ],
      "route": null,
      "body": "Une copie de votre CV de référence adaptée à une offre : votre coach reformule, réordonne, coupe et met en avant ce qu'il contient, sans jamais rien inventer.\n\nSi l'offre demande ce que votre CV ne montre pas, il vous pose la question ; ce n'est ajouté que si vous confirmez. Vous vérifiez la proposition avant de l'enregistrer.\n\nIl se prépare dans la rubrique « Documents » de la candidature, avec le score de correspondance avant et après."
    },
    {
      "id": "glossary-master-cv",
      "locale": "fr",
      "kind": "glossary",
      "title": "CV de référence",
      "synonyms": [
        "cv principal",
        "cv complet",
        "master cv",
        "version"
      ],
      "route": null,
      "body": "Votre CV complet pour un profil : celui d'où partent tous vos CV adaptés. Jobbbox n'y ajoute jamais rien que vous n'ayez dit.\n\nChaque enregistrement crée une nouvelle version ; vous pouvez revoir les versions précédentes et revenir à l'une d'elles."
    },
    {
      "id": "glossary-clear-conversation",
      "locale": "fr",
      "kind": "glossary",
      "title": "Effacer la conversation",
      "synonyms": [
        "effacer",
        "vider la conversation",
        "supprimer les messages",
        "recommencer la conversation"
      ],
      "route": null,
      "body": "« Effacer », en haut d'une page qui est une conversation avec votre coach IA, supprime tous les messages de cette conversation. Jobbbox vous demande d'abord de confirmer ; « Annuler » ne supprime rien. Pendant que le coach répond, « Effacer » attend : interrompez d'abord sa réponse avec « Arrêter ».\n\nLa mémoire du coach reste : ce que vous lui avez demandé de retenir n'est pas effacé. La page redevient une nouvelle conversation."
    },
    {
      "id": "glossary-job-digest",
      "locale": "fr",
      "kind": "glossary",
      "title": "Job Digest",
      "synonyms": [
        "digest",
        "sélection d'offres",
        "offres par e-mail",
        "alerte",
        "newsletter"
      ],
      "route": null,
      "body": "Un e-mail régulier, aussi visible dans Jobbbox, avec les nouvelles offres qui correspondent aux critères de recherche d'un profil.\n\nVous l'activez profil par profil, chaque semaine (le lundi à 7 h) ou chaque jour (à 7 h), selon votre offre. Il ne contient que des offres que vous n'avez pas encore vues, et ne compte dans aucun autre quota.\n\nVous pouvez vous désabonner depuis l'e-mail, sans vous connecter."
    },
    {
      "id": "glossary-coach-memory",
      "locale": "fr",
      "kind": "glossary",
      "title": "Mémoire du coach",
      "synonyms": [
        "mémoire",
        "mémoire du coach",
        "retenir",
        "ce que le coach retient",
        "souvenirs",
        "oublier"
      ],
      "route": null,
      "body": "La mémoire du coach, ce sont les faits clés que votre coach IA retient de vous d'une conversation à l'autre : vos objectifs, vos contraintes, vos décisions. Rien n'y est ajouté sans votre accord : dans une conversation, « Que retenir de cette conversation ? » lui fait proposer des éléments, et seuls ceux que vous confirmez avec « Retenir » sont gardés. Elle tient 30 éléments au plus.\n\nAvec la nouvelle présentation, « Mémoire du coach » est sous « Coach » dans le menu : elle s'ouvre à côté de la conversation, où vous pouvez modifier ou supprimer chaque élément. « Fermer » ou la touche Échap la referme.\n\nEffacer une conversation ne touche pas à la mémoire du coach. Elle est supprimée avec votre compte."
    },
    {
      "id": "glossary-proposals",
      "locale": "fr",
      "kind": "glossary",
      "title": "Propositions de votre coach",
      "synonyms": [
        "proposition",
        "suggestion",
        "carte",
        "accepter",
        "ignorer",
        "refuser"
      ],
      "route": null,
      "body": "Votre coach place des propositions dans vos pages : des corrections de CV après un ATS Score, une relance à envoyer, une candidature à classer comme abandonnée.\n\nVous acceptez ou ignorez chacune. Rien n'est fait sans votre accord : accepter applique le changement proposé.\n\nUne proposition que votre coach ne fait plus disparaît d'elle-même."
    },
    {
      "id": "glossary-plan-quota",
      "locale": "fr",
      "kind": "glossary",
      "title": "Quota",
      "synonyms": [
        "limite",
        "utilisation",
        "crédits",
        "plafond",
        "utilisation cette semaine"
      ],
      "route": null,
      "body": "Ce que votre offre comprend : le nombre de profils que vous pouvez avoir, et chaque semaine le nombre de scores de correspondance, d'ATS Scores, de recherches d'offres et de contacts enrichis, ainsi que la fréquence du Job Digest.\n\nLa barre « Utilisation cette semaine », en bas du menu, montre où vous en êtes. Le décompte repart à zéro chaque lundi à 0 h (heure de Paris).\n\nParler à votre coach ne compte pas dans le quota.\n\nUne hausse de votre offre s'applique tout de suite. Une baisse vous est annoncée par e-mail au moins 30 jours avant, et vous pouvez alors résilier sans frais, avec un remboursement au prorata."
    },
    {
      "id": "glossary-job-search",
      "locale": "fr",
      "kind": "glossary",
      "title": "Recherche d'offres",
      "synonyms": [
        "recherche",
        "chercher des offres",
        "trouver des offres",
        "job search"
      ],
      "route": null,
      "body": "Une recherche que votre coach fait pour un profil, selon ses critères de recherche, sur les sites d'emploi. Les offres trouvées sont classées par score de correspondance.\n\nElle se lance depuis la page Recherches d'offres, ou en le demandant à votre coach. Elle compte une fois dans le quota de votre offre, sauf si elle échoue ou si vous l'arrêtez avant qu'elle ait trouvé une offre."
    },
    {
      "id": "glossary-follow-up",
      "locale": "fr",
      "kind": "glossary",
      "title": "Relance",
      "synonyms": [
        "relancer",
        "rappeler",
        "sans réponse",
        "e-mail de relance"
      ],
      "route": null,
      "body": "Un e-mail que votre coach rédige quand une candidature reste « Postulée » ou « Relancée » trop longtemps sans nouvelles. Il apparaît comme une proposition dans la page de la candidature.\n\nJobbbox n'envoie rien à l'employeur : copiez le texte, envoyez-le depuis votre messagerie, puis marquez-le comme envoyé. La candidature passe alors à « Relancée ».\n\nLe délai avant une relance se règle dans Mon compte, rubrique Relances."
    },
    {
      "id": "glossary-withdrawal",
      "locale": "fr",
      "kind": "glossary",
      "title": "Rétractation",
      "synonyms": [
        "rétracter",
        "renoncer",
        "délai de rétractation",
        "14 jours",
        "remboursement"
      ],
      "route": null,
      "body": "Votre droit de renoncer, sans motif, à un contrat conclu en ligne : pendant 14 jours après votre abonnement à une offre, ou après le paiement d'une séance avec un coach humain.\n\nSur Jobbbox, utilisez « Renoncer au contrat ici », sur la page Mon abonnement ou sur la séance dans l'agenda. Le contrat s'arrête tout de suite et vous recevez un accusé de réception par e-mail. Vous êtes remboursé en entier, sauf si, à la commande, vous avez demandé que le service commence immédiatement : un abonnement vous est alors remboursé moins la part des jours écoulés, et une séance qui a eu lieu ne peut plus faire l'objet d'une rétractation."
    },
    {
      "id": "glossary-match-score",
      "locale": "fr",
      "kind": "glossary",
      "title": "Score de correspondance",
      "synonyms": [
        "match score",
        "correspondance",
        "compatibilité",
        "note",
        "pourcentage",
        "adéquation"
      ],
      "route": null,
      "body": "Une note sur 100 qui dit à quel point un CV correspond à une offre : compétences, expérience, lieu, type de contrat et salaire.\n\nLe détail montre, critère par critère, ce qui correspond et ce qui manque. Un critère dont l'offre ou vos critères ne disent rien ne compte pas ; si trop peu de critères ont pu être comparés, le score est dit partiel.\n\nIl est calculé avec le CV de référence du profil, et avec votre CV adapté si vous en avez un."
    },
    {
      "id": "faq-text-size",
      "locale": "fr",
      "kind": "faq",
      "title": "Comment agrandir le texte ?",
      "synonyms": [
        "taille du texte",
        "police",
        "agrandir",
        "écriture",
        "petit",
        "gros caractères",
        "zoom"
      ],
      "route": null,
      "body": "Dans Mon compte, rubrique Préférences : la réglette « Taille du texte » a quatre crans, Petit, Standard, Moyen et Grand.\n\nVotre choix est gardé sur cet appareil. Sur un autre ordinateur ou un autre téléphone, réglez-le à nouveau."
    },
    {
      "id": "faq-data-export-deletion",
      "locale": "fr",
      "kind": "faq",
      "title": "Comment récupérer ou supprimer mes données ?",
      "synonyms": [
        "données",
        "rgpd",
        "supprimer",
        "effacer",
        "export",
        "télécharger",
        "vie privée",
        "fermer mon compte"
      ],
      "route": null,
      "body": "Dans Mon compte, rubrique Mes données : « Télécharger toutes mes données » vous donne un fichier avec tout ce que Jobbbox garde sur vous, y compris les versions des CGU et CGV que vous avez acceptées.\n\nAu même endroit, « Supprimer définitivement mon compte » le ferme tout de suite, après que vous avez saisi votre adresse e-mail pour confirmer. Vos profils, CV, candidatures et documents sont effacés, définitivement sous 30 jours au plus, et votre abonnement prend fin. Seule la preuve des conditions que vous avez acceptées (CGU et CGV : quelle version, quand) est gardée, sans votre nom ni votre adresse e-mail : 5 ans pour les CGU, 10 ans pour les CGV.\n\nTéléchargez vos données avant si vous souhaitez les garder."
    },
    {
      "id": "faq-follow-up-recruiter",
      "locale": "fr",
      "kind": "faq",
      "title": "Comment relancer un recruteur ?",
      "synonyms": [
        "relance",
        "relancer",
        "rappeler",
        "sans réponse",
        "sans nouvelles",
        "recontacter",
        "e-mail"
      ],
      "route": null,
      "body": "Quand une candidature reste « Postulée » trop longtemps, votre coach propose un e-mail de relance dans la page de la candidature. Vous pouvez aussi lui demander d'en rédiger un.\n\nJobbbox n'envoie rien à votre place : copiez le texte, envoyez-le depuis votre messagerie, puis marquez-le comme envoyé. La candidature passe à « Relancée ».\n\nLe délai avant la proposition se règle dans Mon compte, rubrique Relances."
    },
    {
      "id": "faq-signalement",
      "locale": "fr",
      "kind": "faq",
      "title": "Comment signaler un problème ou joindre l'équipe ?",
      "synonyms": [
        "signalement",
        "signaler",
        "bug",
        "problème",
        "idée",
        "support",
        "équipe",
        "personne",
        "joindre",
        "parler à quelqu'un"
      ],
      "route": null,
      "body": "Pour un problème ou une idée, faites un signalement : « Signaler un problème » ou « Proposer une idée », en bas du panneau « Aide et coach ». Vous le trouvez aussi avec l'icône à côté de « Mon compte », dans le menu sur téléphone.\n\nPour poser une question à une personne, demandez d'abord à votre coach IA. Si sa réponse ne vous aide pas, répondez « Non » sous sa réponse : « Poser la question à l'équipe » envoie votre question et la réponse du coach à l'équipe Jobbbox.\n\nL'équipe Jobbbox lit chaque signalement. Vous suivez son statut et la réponse de l'équipe dans Jobbbox.\n\nIl n'y a pas d'adresse e-mail de support : le signalement est le moyen de joindre une personne.\n\nAvec la nouvelle présentation, où chaque page est une conversation avec votre coach IA, « Signaler un problème » et « Proposer une idée » sont sous la zone de message, et l'icône reste à côté de « Mon compte ». Le formulaire s'ouvre à côté de la conversation, sans la cacher ; « Fermer » ou la touche Échap le referme et votre brouillon est gardé. « Poser la question à l'équipe » s'y ouvre aussi."
    },
    {
      "id": "faq-help-and-ai",
      "locale": "fr",
      "kind": "faq",
      "title": "Est-ce que l'aide utilise l'IA ?",
      "synonyms": [
        "intelligence artificielle",
        "robot",
        "humain",
        "écrit par",
        "aide",
        "coach ia"
      ],
      "route": null,
      "body": "Non. L'aide est écrite et relue par l'équipe Jobbbox. Elle fonctionne même quand l'IA est indisponible et ne compte dans aucun quota.\n\nSeul votre coach répond avec l'IA, et ses réponses le disent. Quand l'aide n'a pas la réponse, « Envoyer au coach » lui pose votre question.\n\nSi votre coach a dû répondre à une question sur l'utilisation de Jobbbox, la question est notée, sans votre nom, pour que l'équipe écrive l'article qui manque."
    },
    {
      "id": "faq-legal-texts",
      "locale": "fr",
      "kind": "faq",
      "title": "Où lire les conditions et la politique de confidentialité ?",
      "synonyms": [
        "CGU",
        "CGV",
        "conditions générales",
        "conditions d'utilisation",
        "conditions de vente",
        "confidentialité",
        "cookies",
        "mentions légales",
        "légal",
        "version",
        "historique"
      ],
      "route": null,
      "body": "Sur la page Légal, ouverte à tous, sans compte : les Conditions générales d'utilisation, les Conditions générales de vente, la Politique de confidentialité (avec ses sections sur les cookies et sur l'IA dans Jobbbox) et les Mentions légales. Chaque texte se télécharge avec « Télécharger en PDF ».\n\nChaque texte porte sa date d'entrée en vigueur. Une version n'est jamais modifiée : une correction donne une nouvelle version. Le lien « Versions précédentes » mène à l'« Historique des versions » : chaque version, sa date, « Substantielle » ou « Mineure », et une ligne qui résume le changement.\n\nUne ancienne version reste lisible à son adresse datée, marquée « Version archivée : voir la version en vigueur ». Une version substantielle à venir s'y lit déjà, marquée « Version à venir » avec sa date d'entrée en vigueur : l'e-mail qui vous en prévient y mène. Le texte français fait foi ; la traduction anglaise le rappelle en tête."
    },
    {
      "id": "faq-legal-text-notice",
      "locale": "fr",
      "kind": "faq",
      "title": "Pourquoi ai-je reçu un e-mail sur les conditions ?",
      "synonyms": [
        "e-mail",
        "mail",
        "préavis",
        "conditions",
        "CGU",
        "CGV",
        "confidentialité",
        "nouvelle version",
        "changement",
        "accepter",
        "politique de confidentialité"
      ],
      "route": null,
      "body": "Jobbbox vous écrit quand il publie une version substantielle des Conditions générales d'utilisation, des Conditions générales de vente ou de la Politique de confidentialité : au moins 30 jours avant son entrée en vigueur. L'e-mail nomme le texte, sa date d'entrée en vigueur et ce qui change, avec « Lire la nouvelle version » et l'« Historique des versions ». Une version mineure, une coquille corrigée par exemple, ne donne lieu à aucun e-mail.\n\nC'est un e-mail de service : vous le recevez même si vous ne recevez pas nos actualités. Il ne contient ni image ni lien de suivi, et vous ne le recevez qu'une fois par version.\n\nPour les Conditions générales d'utilisation, Jobbbox vous demandera d'accepter la nouvelle version à votre première connexion à partir de sa date d'entrée en vigueur. Pour les Conditions générales de vente, elle s'appliquera à vos prochains achats. La Politique de confidentialité ne s'accepte pas : après sa date d'entrée en vigueur, un avis « Notre politique de confidentialité a changé le … » s'affiche une fois dans votre espace, et « J'ai compris » le ferme."
    },
    {
      "id": "faq-quota-renewal",
      "locale": "fr",
      "kind": "faq",
      "title": "Quand mon quota se renouvelle-t-il ?",
      "synonyms": [
        "renouvellement",
        "renouvelle",
        "lundi",
        "limite atteinte",
        "remise à zéro",
        "utilisation"
      ],
      "route": null,
      "body": "Chaque lundi à 0 h (heure de Paris). La barre « Utilisation cette semaine », en bas du menu, montre où vous en êtes.\n\nParler à votre coach ne compte pas dans le quota. Une recherche d'offres qui échoue, ou que vous arrêtez avant qu'elle ait trouvé une offre, ne compte pas non plus.\n\nPour en avoir plus chaque semaine, changez d'offre depuis Mon abonnement."
    }
  ],
  "en": [
    {
      "id": "page-job-digest",
      "locale": "en",
      "kind": "page",
      "title": "A Job Digest",
      "synonyms": [
        "digest",
        "selection",
        "offers received"
      ],
      "route": "/job-digests/[id]",
      "body": "This Job Digest gathers the new job offers found for a profile, ranked by Match Score.\n\nOpen a job offer to read it, then save it to follow it in your applications. A Job Digest never counts against a quota."
    },
    {
      "id": "page-job-offer",
      "locale": "en",
      "kind": "page",
      "title": "A job offer's page",
      "synonyms": [
        "job offer",
        "posting",
        "job",
        "save",
        "follow"
      ],
      "route": "/offres/[id]",
      "body": "It shows the job offer: the employer, the location, the contract type, remote work and the salary when given, the skills asked for and the job offer's text.\n\nThe Match Score says how well the Master CV of one of your profiles fits the job offer. Choose the profile to use, then « Save the job offer »: it becomes an application you follow in « My applications »."
    },
    {
      "id": "page-job-search",
      "locale": "en",
      "kind": "page",
      "title": "A job search's results",
      "synonyms": [
        "results",
        "job offers found",
        "finished search"
      ],
      "route": "/recherches/[id]",
      "body": "This page shows one job search and the job offers it found, ranked by Match Score with the profile.\n\nOpen a job offer to read it in full, then save it to follow it in your applications. « Search again » starts a new search for the same profile."
    },
    {
      "id": "page-profile",
      "locale": "en",
      "kind": "page",
      "title": "A profile's page",
      "synonyms": [
        "profile",
        "role",
        "criteria",
        "versions",
        "download",
        "archive",
        "duplicate"
      ],
      "route": "/profils/[id]",
      "body": "A profile gathers your Master CV and your search criteria for one role. Its sections: Suggestions, Master CV, ATS Score, Download and Manage.\n\nStart with the ATS Score: it says whether recruitment software will read your CV well. The fixes your coach proposes appear in « Suggestions »; accept or dismiss them one by one.\n\nEach time you save the Master CV, a new version is created, and you can go back to an earlier one. « Manage » lets you rename, duplicate or archive the profile."
    },
    {
      "id": "page-application",
      "locale": "en",
      "kind": "page",
      "title": "An application's page",
      "synonyms": [
        "application",
        "documents",
        "match",
        "interviews",
        "company dossier",
        "cover letter",
        "status"
      ],
      "route": "/candidatures/[id]",
      "body": "It gathers everything about a job offer you follow, in sections: Suggestions, Documents, Match, Interviews, Coach reviews, Company dossier, Contacts and The job offer.\n\nStart with « Match » to see what fits and what is missing, then prepare your Tailored CV and your cover letter in « Documents ». You always check them before saving.\n\nUpdate the status as you go: « Applied » once you have sent your application, « Interview » to record your interviews. If it gets no answer, your coach suggests a follow-up."
    },
    {
      "id": "page-subscription-reduction",
      "locale": "en",
      "kind": "page",
      "title": "Cancel at no cost",
      "synonyms": [
        "reduction",
        "reduced plan",
        "plan change",
        "refund",
        "prorata",
        "cancel",
        "cancellation"
      ],
      "route": "/abonnement/baisse",
      "body": "When we reduce what your paid plan includes, you get an email at least 30 days before the date of the change: what changes, why and on which date. If the change does not suit you, you can cancel at no cost.\n\nThis page, opened from the email or from My subscription, sets out what changes, the reason and the date. « Confirm the cancellation » stops your subscription at once: you are back on the Free plan, and we refund prorata the part of the paid period that will not have been used. The refund shows on your statement within 5 to 10 days.\n\nYou can cancel this way before the date of the change, or up to 30 days after it. If you keep your subscription, there is nothing to do."
    },
    {
      "id": "page-subscription-cancellation",
      "locale": "en",
      "kind": "page",
      "title": "Cancel your contract",
      "synonyms": [
        "cancel",
        "cancellation",
        "stop",
        "end",
        "subscription",
        "unsubscribe",
        "end of the contract",
        "charge"
      ],
      "route": "/abonnement/resiliation",
      "body": "This page cancels your subscription to a paid plan. It shows your plan and the date the contract ends, which is the end of the period already paid for: you keep your plan until that date, you are not charged again, and you then move to the Free plan.\n\n« Confirm the cancellation » records your request. You at once receive an acknowledgement by email, with the date of your request and the date the contract ends: keep it.\n\nChanged your mind? Until the end date, undo the cancellation from My subscription, with « Manage my subscription »."
    },
    {
      "id": "page-conversation",
      "locale": "en",
      "kind": "page",
      "title": "Conversation with the coach",
      "synonyms": [
        "conversation",
        "chat",
        "coach",
        "AI coach",
        "rename a conversation",
        "delete a conversation"
      ],
      "route": "/conversations/[id]",
      "body": "This page is one of your conversations with your AI coach, reopened from « Coach » in the menu. It holds your messages and its replies; under each reply, a quiet line says what produced it, and « Did this answer your question? » lets you say so.\n\nWrite in the message box at the foot of the page. While the coach is replying, « Stop » interrupts its reply.\n\nTo rename or delete the conversation, open its actions (« … ») beside its name in the menu. « Clear », at the top of the page, deletes all its messages; the coach's memory stays."
    },
    {
      "id": "page-new-profile",
      "locale": "en",
      "kind": "page",
      "title": "Create a profile",
      "synonyms": [
        "new profile",
        "create",
        "upload my cv",
        "questionnaire",
        "start"
      ],
      "route": "/profils/nouveau",
      "body": "A profile is a role you are aiming for: a Master CV and search criteria. You can have several, depending on your plan.\n\nIf you have a CV, upload it: your coach reads it and proposes a Master CV. If not, answer its questions about your career, one at a time; allow about ten minutes.\n\nEither way, you check and correct everything before saving. Nothing is added that you did not say."
    },
    {
      "id": "page-home",
      "locale": "en",
      "kind": "page",
      "title": "Home",
      "synonyms": [
        "home",
        "start",
        "get started",
        "beginning",
        "where to start",
        "new conversation"
      ],
      "route": "/",
      "body": "The home page is where you start in Jobbbox. The menu leads to your applications, your agenda, your job searches and your Job Digests; « My account » is at the foot of the menu.\n\nTo begin, create a profile: your Master CV and your search criteria. Your coach uses them to search for job offers and prepare your applications.\n\nA question? Open « Help and coach » at the top of the page.\n\nWith the new layout, the home page is a new conversation with your AI coach. Write in the message box at the foot of the page, or pick a suggestion just above it: « Search for job offers », « Add an application », « Schedule an interview », « Ask the coach ». The conversation is saved with your first message and appears under « Coach » in the menu, where you can rename or delete it. « New conversation », at the top of the menu, starts another one; « Clear », at the top of the page, deletes all its messages.\n\nWhile you write, the help's matching articles show above the message box, « In the help, without AI », in place of the suggestions. An article opens beside the conversation, as « How does this page work? » does while the conversation is empty; « Ask the coach » there starts a question about it.\nAt the foot of the menu, « Help and legal » leads to the Help Centre (« Help »), the legal texts (« Legal ») and what's new in Jobbbox (« What's new »). On a phone, these links are in the menu."
    },
    {
      "id": "page-agenda",
      "locale": "en",
      "kind": "page",
      "title": "Interviews and appointments",
      "synonyms": [
        "agenda",
        "calendar",
        "interview",
        "appointment",
        "week",
        "month",
        "session"
      ],
      "route": "/agenda",
      "body": "The agenda shows your interviews and your sessions with a human coach. Show it as a list (upcoming appointments, day by day), by week or by month.\n\nAdd an interview with « Add an interview », or from the « Interviews » section of an application at the « Interview » stage.\n\nPast appointments stay visible, dimmed. The day before at 6 pm, Jobbbox can email you a reminder: set it in My account, under Reminders.\n\nFor 14 days after you pay for a session with a human coach, and as long as it has not taken place, « Renoncer au contrat ici » (withdraw from the contract here) cancels it and refunds it in full; the coach is told."
    },
    {
      "id": "page-job-digests",
      "locale": "en",
      "kind": "page",
      "title": "Job Digests",
      "synonyms": [
        "digest",
        "selection",
        "offers by email",
        "receive",
        "frequency",
        "alert"
      ],
      "route": "/job-digests",
      "body": "A Job Digest is a selection of new job offers matching a profile's search criteria. You get it by email and find it on this page too.\n\nFor each profile, choose whether to receive it and how often, within your plan: every week on Monday at 7 am, or every day at 7 am (Paris time).\n\nOnly job offers you have not seen yet are in it. When there are none, nothing is sent."
    },
    {
      "id": "page-job-searches",
      "locale": "en",
      "kind": "page",
      "title": "Job searches",
      "synonyms": [
        "search",
        "look for",
        "find",
        "new job offers",
        "start"
      ],
      "route": "/recherches",
      "body": "Your coach searches for job offers that meet a profile's search criteria. Choose the profile, or all your active profiles, then start the search.\n\nThe page updates by itself while the search runs, and you can stop it. The latest job offers found are shown with their Match Score.\n\nEach search counts once against your plan's quota. If it fails, or if you stop it before it has found a job offer, it does not count."
    },
    {
      "id": "page-account",
      "locale": "en",
      "kind": "page",
      "title": "My account",
      "synonyms": [
        "account",
        "settings",
        "preferences",
        "language",
        "theme",
        "dark mode",
        "sign-in",
        "reminders"
      ],
      "route": "/compte",
      "body": "My account gathers your settings, in sections: Profiles, Follow-ups, Reminders, European AI, Sign-in, Preferences, Tools and My data.\n\nIn Preferences, change the interface language, the text size and the theme: Light, Dark, or System, which follows your device's setting. The theme and the text size are remembered on this device. In Follow-ups, choose after how many working days your coach suggests a follow-up; in Reminders, the reminder email the day before your appointments.\n\nMy data lets you download all your data or delete your account.\n\nWith the new layout, « Help », at the top of the page, opens this article beside the page. « Ask the coach » there starts a new conversation with your AI coach about My account."
    },
    {
      "id": "page-applications",
      "locale": "en",
      "kind": "page",
      "title": "My applications",
      "synonyms": [
        "applications",
        "tracking",
        "saved offers",
        "board",
        "list",
        "status",
        "archived",
        "to handle",
        "see all"
      ],
      "route": "/candidatures",
      "body": "This page gathers every job offer you follow. Each job offer you save becomes an application, linked to one of your profiles.\n\nShow them as a list or as a board, one column per status: To apply, Applied, Followed up, Interview, Offer received, Accepted, Rejected, Abandoned. Filter by profile or by status; archived applications stay hidden unless you ask to see them.\n\nOpen an application to prepare your documents, see the Match Score and record your interviews.\n\nWith the new layout, « My applications » is a conversation with your AI coach, the same one at each visit. Your applications in progress are listed in a card: their status, their Match Score and those « to handle », when a follow-up is ready or an application still has no answer. Click a line to open the application; « Show them » also shows the archived applications. Ask the coach which one to handle first, or start from a suggestion above the message box: « Add an application », « Search for job offers ».\n\nIn the menu, « My applications » unfolds into your most recent applications, and those to handle, marked with a dot; « See all » leads to this page. The arrow beside it folds or unfolds the list, and this browser remembers it."
    },
    {
      "id": "page-human-coaches",
      "locale": "en",
      "kind": "page",
      "title": "My human coaches",
      "synonyms": [
        "human coach",
        "session",
        "video call",
        "professional",
        "hr",
        "coach access",
        "book"
      ],
      "route": "/coachs",
      "body": "On top of your AI coach, you can book a video session with an HR professional selected by Jobbbox. « Book a session with … » first opens the Your session order page: the summary, the box to accept the terms of sale and the request for the service to start at once. Pay for the session, then pick your time.\n\nWith your consent, a coach can read your profiles and applications, and comment on your application documents. They cannot change anything, and you can withdraw this access at any time."
    },
    {
      "id": "page-subscription",
      "locale": "en",
      "kind": "page",
      "title": "My subscription",
      "synonyms": [
        "subscription",
        "price",
        "pay",
        "payment",
        "premium",
        "standard",
        "free",
        "cancel",
        "cancellation"
      ],
      "route": "/abonnement",
      "body": "This page shows your plan (Free, Standard or Premium) and what it includes: the number of profiles, and each week the scores, job searches and enriched contacts.\n\n« Cancel your contract » ends your subscription at the end of the period already paid for, in two clicks from this page. Once the cancellation is scheduled, the page shows « Your current Plan: <plan> until <date> ».\n\n« Manage my subscription » opens the secure page of Stripe, our payment provider: that is where you change plan or payment method, and where you undo a scheduled cancellation. Jobbbox never sees your card number.\n\n« Choose the … Plan » first opens the Your order page: the plan's summary, the box to accept the terms of sale and the request for the service to start at once, before payment on Stripe's page.\n\nFor 14 days after you subscribe, « Renoncer au contrat ici » (withdraw from the contract here) lets you withdraw, without a reason: your subscription is cancelled at once and you are back on the Free plan. What you paid is refunded in full or, if you asked for the service to start at once, less the share of the days elapsed since the start of the period. Changing plan in Stripe does not start this period again.\n\nIf we reduce what your plan includes (fewer job searches a week, a feature removed…), you are told by email at least 30 days ahead, with the reason and the date. A « Your … plan changes on … » box also shows it on this page: its « Cancel at no cost » button stops your subscription at once, and the part of the paid period that will not have been used is refunded to you prorata. You can do so up to 30 days after the date of the change."
    },
    {
      "id": "page-acceptance",
      "locale": "en",
      "kind": "page",
      "title": "Our terms of use",
      "synonyms": [
        "terms of use",
        "accept",
        "acceptance",
        "new version",
        "checkbox",
        "accept and continue"
      ],
      "route": "/acceptation",
      "body": "This screen shows after you sign in when the Terms of use are waiting for your agreement: the first time, then for each new version that changes your rights. A minor version is not asked again.\n\n« Read the Terms of use » opens the version to accept, with its date. Tick « I accept the Terms of use (version of …) », then « Accept and continue »: you go back to the page you wanted to open. The box is never ticked for you, and the screen does not come back for the same version.\n\nUntil you accept, you can still open My data, to download your data or delete your account, and Subscription, to withdraw or cancel. Your subscription keeps running.\n\nIn English, the screen says the French text prevails."
    },
    {
      "id": "page-withdrawal",
      "locale": "en",
      "kind": "page",
      "title": "Withdraw from the contract here",
      "synonyms": [
        "withdrawal",
        "withdraw",
        "renounce",
        "refund",
        "cancel",
        "14 days",
        "cooling-off period"
      ],
      "route": "/abonnement/retractation",
      "body": "This page lets you withdraw from a contract made on Jobbbox, without giving a reason: your subscription to a plan, for 14 days after you subscribed, or a session with a human coach, for 14 days after you paid for it. A session booked with the request for the service to start at once can no longer be withdrawn from once it has taken place. The period runs to the end of the 14th day, Paris time; when that day is a Saturday, a Sunday or a public holiday, it runs on to the next working day.\n\nCheck the contract, its date and the amount paid, enter your name, then choose where to receive the acknowledgement: your account's address or another one. « Confirmer la rétractation » (confirm the withdrawal) ends the contract at once and refunds you to the payment method you used; depending on your bank, the refund shows within 5 to 10 business days. The refund is in full, but for a subscription taken with the request for the service to start at once: you then pay for the service already provided, and the page shows the amount « Refunded if you confirm now » (the amount paid, less the share of the days elapsed since the start of the period).\n\nYou get an acknowledgement by email straight away, with the date and time of your withdrawal: keep it."
    },
    {
      "id": "page-order",
      "locale": "en",
      "kind": "page",
      "title": "Your order",
      "synonyms": [
        "order",
        "buy",
        "pay",
        "payment",
        "terms of sale",
        "cgv",
        "summary",
        "immediate performance",
        "start at once"
      ],
      "route": "/abonnement/commande",
      "body": "This page shows when you choose a plan, before payment. The summary gives the plan, its price including VAT, how often it is charged and that it renews: the subscription renews automatically until you cancel it.\n\nOnce our terms of sale are published, tick « I accept the terms of sale (version of …) » to go on; the link just above opens that version. The French text prevails. The box is never ticked for you.\n\nThe second box, « I ask for the service to start at once », is optional. Without it, you pay and your plan starts just the same, but a withdrawal is refunded in full. With it, a withdrawal refunds the amount paid, less the share of the days elapsed since the start of the period.\n\n« Go to payment » opens the secure page of Stripe, our payment provider. Once the payment is confirmed, you receive the confirmation of your order by email, with the link to the version of the terms of sale you accepted and where to find « Renoncer au contrat ici » (withdraw from the contract here): keep it.\n\nIf you already have a paid plan, you change plans on Stripe's page, from « Manage my subscription », without this page."
    },
    {
      "id": "page-coaching-order",
      "locale": "en",
      "kind": "page",
      "title": "Your session order",
      "synonyms": [
        "order",
        "session",
        "human coach",
        "pay",
        "payment",
        "terms of sale",
        "cgv",
        "immediate performance",
        "start at once"
      ],
      "route": "/coachs/commande",
      "body": "This page shows when you book a session with a human coach, before payment. The summary gives the coach and the session's price including VAT, a one-off payment that does not renew.\n\nOnce our terms of sale are published, tick « I accept the terms of sale (version of …) » to go on; the link just above opens that version. The French text prevails. The box is never ticked for you.\n\nThe second box is optional: « I ask for the service to start at once. I understand that if I withdraw, I will pay for the service already provided, and that I lose my right of withdrawal once the session has taken place. » Without it, you pay and book your session just the same, and a withdrawal within 14 days is refunded in full, even once the session has taken place. With it, you may withdraw as long as the session has not taken place, refunded in full; no longer afterwards.\n\n« Go to payment » opens the secure page of Stripe, our payment provider. Once the payment is confirmed, you receive the confirmation of your order by email: keep it."
    },
    {
      "id": "glossary-ats-score",
      "locale": "en",
      "kind": "glossary",
      "title": "ATS Score",
      "synonyms": [
        "ats",
        "applicant tracking system",
        "recruitment software",
        "robot",
        "readability",
        "keywords"
      ],
      "route": null,
      "body": "Recruiters use applicant tracking systems (ATS) that read your CV before a person does. The ATS Score, out of 100, says whether this software will read your Master CV well for the role you are aiming for.\n\nIt combines readability (contact details, headline, dated jobs…) and the role's keywords. It is worked out without AI, by fixed rules, and does not depend on any job offer.\n\nThe fixes to improve it come from your coach: you find them in the profile's Suggestions."
    },
    {
      "id": "glossary-clear-conversation",
      "locale": "en",
      "kind": "glossary",
      "title": "Clear the conversation",
      "synonyms": [
        "clear",
        "empty the conversation",
        "delete the messages",
        "start the conversation over"
      ],
      "route": null,
      "body": "« Clear », at the top of a page that is a conversation with your AI coach, deletes all the messages of that conversation. Jobbbox asks you to confirm first; « Cancel » deletes nothing. While the coach is replying, « Clear » waits: stop its reply first with « Stop ».\n\nThe coach's memory stays: what you asked it to remember is not cleared. The page becomes a new conversation again."
    },
    {
      "id": "glossary-coach-memory",
      "locale": "en",
      "kind": "glossary",
      "title": "Coach memory",
      "synonyms": [
        "memory",
        "coach memory",
        "remember",
        "what the coach remembers",
        "forget"
      ],
      "route": null,
      "body": "The coach's memory is the key facts your AI coach remembers about you from one conversation to the next: your goals, your constraints, your decisions. Nothing goes into it without your consent: in a conversation, « What should my coach remember from this conversation? » has it suggest items, and only those you confirm with « Remember » are kept. It holds 30 items at most.\n\nWith the new layout, « Coach memory » is under « Coach » in the menu: it opens beside the conversation, where you can edit or delete each item. « Close » or the Escape key closes it.\n\nClearing a conversation leaves the coach's memory untouched. It is deleted with your account."
    },
    {
      "id": "glossary-follow-up",
      "locale": "en",
      "kind": "glossary",
      "title": "Follow-up",
      "synonyms": [
        "follow up",
        "chase",
        "no answer",
        "no reply",
        "reminder email"
      ],
      "route": null,
      "body": "An email your coach drafts when an application has stayed « Applied » or « Followed up » too long without news. It appears as a proposal in the application's page.\n\nJobbbox sends nothing to the employer: copy the text, send it from your own mailbox, then mark it as sent. The application then moves to « Followed up ».\n\nThe delay before a follow-up is set in My account, under Follow-ups."
    },
    {
      "id": "glossary-job-digest",
      "locale": "en",
      "kind": "glossary",
      "title": "Job Digest",
      "synonyms": [
        "digest",
        "job offer selection",
        "offers by email",
        "alert",
        "newsletter"
      ],
      "route": null,
      "body": "A regular email, also shown in Jobbbox, with the new job offers matching a profile's search criteria.\n\nYou turn it on profile by profile, every week (on Monday at 7 am) or every day (at 7 am), depending on your plan. It only holds job offers you have not seen yet, and never counts against your other quotas.\n\nYou can unsubscribe from the email, without signing in."
    },
    {
      "id": "glossary-job-search",
      "locale": "en",
      "kind": "glossary",
      "title": "Job search",
      "synonyms": [
        "search",
        "look for job offers",
        "find job offers"
      ],
      "route": null,
      "body": "A search your coach runs for a profile, following its search criteria, on job sites. The job offers found are ranked by Match Score.\n\nYou start one from the Job searches page, or by asking your coach. It counts once against your plan's quota, unless it fails or you stop it before it has found a job offer."
    },
    {
      "id": "glossary-master-cv",
      "locale": "en",
      "kind": "glossary",
      "title": "Master CV",
      "synonyms": [
        "main cv",
        "full cv",
        "reference cv",
        "version"
      ],
      "route": null,
      "body": "Your full CV for a profile: the one every Tailored CV starts from. Jobbbox never adds anything to it that you did not say.\n\nEach save creates a new version; you can look at earlier versions and go back to one of them."
    },
    {
      "id": "glossary-match-score",
      "locale": "en",
      "kind": "glossary",
      "title": "Match Score",
      "synonyms": [
        "match",
        "fit",
        "compatibility",
        "rating",
        "percentage"
      ],
      "route": null,
      "body": "A score out of 100 that says how well a CV fits a job offer: skills, experience, location, contract type and salary.\n\nThe breakdown shows, criterion by criterion, what matches and what is missing. A criterion the job offer or your criteria say nothing about does not count; when too few criteria could be compared, the score is called partial.\n\nIt is worked out with the profile's Master CV, and with your Tailored CV if you have one."
    },
    {
      "id": "glossary-plan-quota",
      "locale": "en",
      "kind": "glossary",
      "title": "Quota",
      "synonyms": [
        "limit",
        "usage",
        "credits",
        "allowance",
        "usage this week"
      ],
      "route": null,
      "body": "What your plan includes: the number of profiles you can have, and each week the number of Match Scores, ATS Scores, job searches and enriched contacts, as well as the Job Digest frequency.\n\nThe « Usage this week » bar, at the foot of the menu, shows where you stand. The count starts again from zero every Monday at midnight (Paris time).\n\nTalking to your coach does not count against the quota.\n\nAn increase in your plan applies at once. A reduction is announced to you by email at least 30 days ahead, and you can then cancel at no cost, with a prorata refund."
    },
    {
      "id": "glossary-tailored-cv",
      "locale": "en",
      "kind": "glossary",
      "title": "Tailored CV",
      "synonyms": [
        "custom cv",
        "adapted cv",
        "tailor",
        "targeted cv"
      ],
      "route": null,
      "body": "A copy of your Master CV adapted to one job offer: your coach rephrases, reorders, cuts and highlights what it says, and never invents anything.\n\nWhen the job offer asks for something your CV does not show, it asks you; it is added only if you confirm. You check the proposal before saving it.\n\nIt is prepared in the application's « Documents » section, with the Match Score before and after."
    },
    {
      "id": "glossary-withdrawal",
      "locale": "en",
      "kind": "glossary",
      "title": "Withdrawal",
      "synonyms": [
        "withdraw",
        "renounce",
        "cooling-off period",
        "14 days",
        "refund"
      ],
      "route": null,
      "body": "Your right to renounce a contract made online, without a reason: for 14 days after you subscribe to a plan, or after you pay for a session with a human coach.\n\nOn Jobbbox, use « Renoncer au contrat ici » (withdraw from the contract here), on the My subscription page or on the session in the agenda. The contract stops at once and you get an acknowledgement by email. You are refunded in full, unless you asked at the order for the service to start at once: a subscription is then refunded less the share of the days elapsed, and a session that has taken place can no longer be withdrawn from."
    },
    {
      "id": "glossary-proposals",
      "locale": "en",
      "kind": "glossary",
      "title": "Your coach's proposals",
      "synonyms": [
        "proposal",
        "suggestion",
        "card",
        "accept",
        "dismiss",
        "reject"
      ],
      "route": null,
      "body": "Your coach places proposals in your pages: CV fixes after an ATS Score, a follow-up to send, an application to mark as abandoned.\n\nYou accept or dismiss each one. Nothing is done without your consent: accepting applies the proposed change.\n\nA proposal your coach no longer makes disappears by itself."
    },
    {
      "id": "faq-help-and-ai",
      "locale": "en",
      "kind": "faq",
      "title": "Does the help use AI?",
      "synonyms": [
        "artificial intelligence",
        "robot",
        "human",
        "written by",
        "help",
        "ai coach"
      ],
      "route": null,
      "body": "No. The help is written and checked by the Jobbbox team. It works even when the AI is unavailable and never counts against a quota.\n\nOnly your coach answers with AI, and its replies say so. When the help has no answer, « Send to the coach » asks it your question.\n\nIf your coach had to answer a question about using Jobbbox, the question is noted, without your name, so the team can write the missing article."
    },
    {
      "id": "faq-follow-up-recruiter",
      "locale": "en",
      "kind": "faq",
      "title": "How do I follow up with a recruiter?",
      "synonyms": [
        "follow-up",
        "follow up",
        "chase",
        "no answer",
        "no reply",
        "contact again",
        "email"
      ],
      "route": null,
      "body": "When an application stays « Applied » too long, your coach proposes a follow-up email in the application's page. You can also ask it to draft one.\n\nJobbbox sends nothing on your behalf: copy the text, send it from your own mailbox, then mark it as sent. The application moves to « Followed up ».\n\nThe delay before the proposal is set in My account, under Follow-ups."
    },
    {
      "id": "faq-data-export-deletion",
      "locale": "en",
      "kind": "faq",
      "title": "How do I get or delete my data?",
      "synonyms": [
        "data",
        "gdpr",
        "delete",
        "erase",
        "export",
        "download",
        "privacy",
        "close my account"
      ],
      "route": null,
      "body": "In My account, under My data: « Download all my data » gives you one file with everything Jobbbox keeps about you, including the versions of the Terms of use and Terms of sale you accepted.\n\nIn the same place, « Permanently delete my account » closes it at once, once you have typed your email address to confirm. Your profiles, CVs, applications and documents are erased, for good within 30 days at most, and your subscription ends. Only the proof of the terms you accepted (Terms of use and Terms of sale: which version, when) is kept, without your name or email address: 5 years for the Terms of use, 10 years for the Terms of sale.\n\nDownload your data first if you want to keep it."
    },
    {
      "id": "faq-text-size",
      "locale": "en",
      "kind": "faq",
      "title": "How do I make the text larger?",
      "synonyms": [
        "text size",
        "font",
        "larger",
        "bigger",
        "small",
        "large print",
        "zoom"
      ],
      "route": null,
      "body": "In My account, under Preferences: the « Text size » slider has four steps, Small, Standard, Medium and Large.\n\nYour choice is kept on this device. On another computer or phone, set it again."
    },
    {
      "id": "faq-signalement",
      "locale": "en",
      "kind": "faq",
      "title": "How do I report a problem or reach the team?",
      "synonyms": [
        "feedback",
        "report",
        "bug",
        "problem",
        "idea",
        "support",
        "team",
        "person",
        "reach",
        "talk to someone"
      ],
      "route": null,
      "body": "For a problem or an idea, send feedback: « Report a problem » or « Suggest an idea », at the foot of the « Help and coach » panel. You also find it with the icon beside « My account », in the menu on phones.\n\nTo ask a person a question, ask your AI coach first. If its reply doesn't help, answer « No » under it: « Ask the team » sends your question and the coach's reply to the Jobbbox team.\n\nThe Jobbbox team reads every piece of feedback. You follow its status and the team's reply in Jobbbox.\n\nThere is no support email address: feedback is how you reach a person.\n\nWith the new layout, where each page is a conversation with your AI coach, « Report a problem » and « Suggest an idea » are under the message box, and the icon stays beside « My account ». The form opens beside the conversation, without hiding it; « Close » or the Escape key closes it and your draft is kept. « Ask the team » opens there too."
    },
    {
      "id": "faq-quota-renewal",
      "locale": "en",
      "kind": "faq",
      "title": "When does my quota renew?",
      "synonyms": [
        "renewal",
        "renew",
        "reset",
        "monday",
        "limit reached",
        "usage"
      ],
      "route": null,
      "body": "Every Monday at midnight (Paris time). The « Usage this week » bar, at the foot of the menu, shows where you stand.\n\nTalking to your coach does not count against the quota. A job search that fails, or that you stop before it has found a job offer, does not count either.\n\nTo get more each week, change plan from My subscription."
    },
    {
      "id": "faq-legal-texts",
      "locale": "en",
      "kind": "faq",
      "title": "Where can I read the terms and the privacy policy?",
      "synonyms": [
        "terms of use",
        "terms of sale",
        "terms and conditions",
        "privacy",
        "cookies",
        "legal notice",
        "legal",
        "version",
        "history"
      ],
      "route": null,
      "body": "On the Legal page, open to everyone, with no account: the Terms of use, the Terms of sale, the Privacy policy (with its sections on cookies and on AI in Jobbbox) and the Legal notice. Each text downloads with « Download as PDF ».\n\nEach text shows the date it took effect. A version is never changed: a correction makes a new version. The « Previous versions » link leads to the « Version history »: each version, its date, « Substantial » or « Minor », and a line that sums up the change.\n\nAn earlier version stays readable at its dated address, marked « Archived version: see the version in effect ». An upcoming substantial version can already be read there, marked « Upcoming version » with the date it takes effect: the email telling you of it leads there. The French text prevails; the English translation says so at the top."
    },
    {
      "id": "faq-legal-text-notice",
      "locale": "en",
      "kind": "faq",
      "title": "Why did I get an email about the terms?",
      "synonyms": [
        "email",
        "mail",
        "notice",
        "terms",
        "terms of use",
        "terms of sale",
        "privacy",
        "new version",
        "change",
        "accept",
        "privacy policy"
      ],
      "route": null,
      "body": "Jobbbox writes to you when it publishes a substantial version of the Terms of use, the Terms of sale or the Privacy policy: at least 30 days before it takes effect. The email names the text, the date it takes effect and what changes, with « Read the new version » and the « Version history ». A minor version, a typo corrected for instance, gets no email.\n\nIt is a service email: you get it even if you do not receive our news. It has no image and no tracking link, and you get it only once per version.\n\nFor the Terms of use, Jobbbox will ask you to accept the new version the first time you sign in from the date it takes effect. For the Terms of sale, it will apply to your next purchases. The Privacy policy is not accepted: after it takes effect, a notice « Our privacy policy changed on … » shows once in your workspace, and « Got it » closes it."
    }
  ]
};
