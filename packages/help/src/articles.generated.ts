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
        "par où commencer"
      ],
      "route": "/",
      "body": "L'accueil est votre point de départ dans Jobbbox. Le menu mène à vos candidatures, à votre agenda, à vos recherches d'offres et à vos Job Digests ; « Mon compte » est en bas du menu.\n\nPour commencer, créez un profil : votre CV de référence et vos critères de recherche. Votre coach s'en sert pour chercher des offres et préparer vos candidatures.\n\nUne question ? Ouvrez « Aide et coach » en haut de la page."
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
      "body": "L'agenda montre vos entretiens et vos séances avec un coach humain. Affichez-le en liste (les prochains rendez-vous, jour par jour), par semaine ou par mois.\n\nAjoutez un entretien avec « Ajouter un entretien », ou depuis la rubrique « Entretiens » d'une candidature à l'étape « Entretien ».\n\nLes rendez-vous passés restent visibles, en plus pâle. La veille à 18 h, Jobbbox peut vous envoyer un e-mail de rappel : réglez-le dans Mon compte, rubrique Rappels."
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
        "archivée"
      ],
      "route": "/candidatures",
      "body": "Cette page rassemble toutes les offres que vous suivez. Chaque offre enregistrée devient une candidature, liée à l'un de vos profils.\n\nAffichez-les en liste ou en tableau, une colonne par statut : À postuler, Postulée, Relancée, Entretien, Offre reçue, Acceptée, Refusée, Abandonnée. Filtrez par profil ou par statut ; les candidatures archivées restent masquées sauf si vous demandez à les voir.\n\nOuvrez une candidature pour préparer vos documents, voir le score de correspondance et noter vos entretiens."
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
      "body": "En plus de votre coach IA, vous pouvez réserver une séance en visio avec un professionnel RH sélectionné par Jobbbox. Payez la séance, puis choisissez votre créneau.\n\nAvec votre accord, un coach peut lire vos profils et vos candidatures, et commenter vos documents de candidature. Il ne peut rien modifier, et vous retirez cet accès à tout moment."
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
        "résilier"
      ],
      "route": "/abonnement",
      "body": "Cette page montre votre offre (Gratuite, Standard ou Premium) et ce qu'elle comprend : le nombre de profils, et chaque semaine les scores, les recherches d'offres et les contacts enrichis.\n\n« Gérer mon abonnement » ouvre la page sécurisée de Stripe, notre prestataire de paiement : c'est là que vous changez d'offre ou résiliez. Jobbbox ne voit jamais votre numéro de carte."
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
        "connexion",
        "rappels"
      ],
      "route": "/compte",
      "body": "Mon compte rassemble vos réglages, en rubriques : Profils, Relances, Rappels, IA européenne, Connexion, Préférences, Outils et Mes données.\n\nDans Préférences, changez la langue de l'interface et la taille du texte. Dans Relances, choisissez après combien de jours ouvrés votre coach propose une relance ; dans Rappels, l'e-mail de rappel la veille de vos rendez-vous.\n\nMes données permet de télécharger toutes vos données ou de supprimer votre compte."
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
      "body": "Ce que votre offre comprend : le nombre de profils que vous pouvez avoir, et chaque semaine le nombre de scores de correspondance, d'ATS Scores, de recherches d'offres et de contacts enrichis, ainsi que la fréquence du Job Digest.\n\nLa barre « Utilisation cette semaine », en bas du menu, montre où vous en êtes. Le décompte repart à zéro chaque lundi à 0 h (heure de Paris).\n\nParler à votre coach ne compte pas dans le quota."
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
      "body": "Dans Mon compte, rubrique Mes données : « Télécharger toutes mes données » vous donne un fichier avec tout ce que Jobbbox garde sur vous.\n\nAu même endroit, « Supprimer définitivement mon compte » le ferme tout de suite, après que vous avez saisi votre adresse e-mail pour confirmer. Vos profils, CV, candidatures et documents sont effacés, définitivement sous 30 jours au plus, et votre abonnement prend fin.\n\nTéléchargez vos données avant si vous souhaitez les garder."
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
        "joindre"
      ],
      "route": null,
      "body": "Faites un signalement : « Signaler un problème », « Proposer une idée » ou « Poser une question », en bas du panneau « Aide et coach ». Sur téléphone, vous le trouvez aussi dans le menu.\n\nL'équipe Jobbbox lit chaque signalement. Vous suivez son statut et la réponse de l'équipe dans Jobbbox.\n\nIl n'y a pas d'adresse e-mail de support : le signalement est le moyen de joindre une personne."
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
        "where to start"
      ],
      "route": "/",
      "body": "The home page is where you start in Jobbbox. The menu leads to your applications, your agenda, your job searches and your Job Digests; « My account » is at the foot of the menu.\n\nTo begin, create a profile: your Master CV and your search criteria. Your coach uses them to search for job offers and prepare your applications.\n\nA question? Open « Help and coach » at the top of the page."
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
      "body": "The agenda shows your interviews and your sessions with a human coach. Show it as a list (upcoming appointments, day by day), by week or by month.\n\nAdd an interview with « Add an interview », or from the « Interviews » section of an application at the « Interview » stage.\n\nPast appointments stay visible, dimmed. The day before at 6 pm, Jobbbox can email you a reminder: set it in My account, under Reminders."
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
        "sign-in",
        "reminders"
      ],
      "route": "/compte",
      "body": "My account gathers your settings, in sections: Profiles, Follow-ups, Reminders, European AI, Sign-in, Preferences, Tools and My data.\n\nIn Preferences, change the interface language and the text size. In Follow-ups, choose after how many working days your coach suggests a follow-up; in Reminders, the reminder email the day before your appointments.\n\nMy data lets you download all your data or delete your account."
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
        "archived"
      ],
      "route": "/candidatures",
      "body": "This page gathers every job offer you follow. Each job offer you save becomes an application, linked to one of your profiles.\n\nShow them as a list or as a board, one column per status: To apply, Applied, Followed up, Interview, Offer received, Accepted, Rejected, Abandoned. Filter by profile or by status; archived applications stay hidden unless you ask to see them.\n\nOpen an application to prepare your documents, see the Match Score and record your interviews."
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
      "body": "On top of your AI coach, you can book a video session with an HR professional selected by Jobbbox. Pay for the session, then pick your time.\n\nWith your consent, a coach can read your profiles and applications, and comment on your application documents. They cannot change anything, and you can withdraw this access at any time."
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
        "cancel"
      ],
      "route": "/abonnement",
      "body": "This page shows your plan (Free, Standard or Premium) and what it includes: the number of profiles, and each week the scores, job searches and enriched contacts.\n\n« Manage my subscription » opens the secure page of Stripe, our payment provider: that is where you change plan or cancel. Jobbbox never sees your card number."
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
      "body": "What your plan includes: the number of profiles you can have, and each week the number of Match Scores, ATS Scores, job searches and enriched contacts, as well as the Job Digest frequency.\n\nThe « Usage this week » bar, at the foot of the menu, shows where you stand. The count starts again from zero every Monday at midnight (Paris time).\n\nTalking to your coach does not count against the quota."
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
      "body": "In My account, under My data: « Download all my data » gives you one file with everything Jobbbox keeps about you.\n\nIn the same place, « Permanently delete my account » closes it at once, once you have typed your email address to confirm. Your profiles, CVs, applications and documents are erased, for good within 30 days at most, and your subscription ends.\n\nDownload your data first if you want to keep it."
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
        "reach"
      ],
      "route": null,
      "body": "Send feedback: « Report a problem », « Suggest an idea » or « Ask a question », at the foot of the « Help and coach » panel. On phones, you also find it in the menu.\n\nThe Jobbbox team reads every piece of feedback. You follow its status and the team's reply in Jobbbox.\n\nThere is no support email address: feedback is how you reach a person."
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
    }
  ]
};
