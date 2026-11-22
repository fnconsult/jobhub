// Written by `npm run build -w @jobhub/help` from legal/<text>/<YYYY-MM-DD>.<locale>.md: edit those, never this file.
import type { LegalTextVersion, LegalTextVersionRecord } from "./legal-texts";
import type { HelpLocale } from "./types";

export const LEGAL_TEXT_VERSIONS: Record<HelpLocale, readonly LegalTextVersion[]> = {
  "fr": [
    {
      "text": "cgu",
      "locale": "fr",
      "effective": "2027-01-04",
      "title": "Conditions générales d'utilisation",
      "change": "substantielle",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "Première version des conditions générales d'utilisation, avec la section « Invité (extension) ».",
      "inBrief": [
        "Jobbbox vous aide à chercher un emploi : un coach IA, vos CV, les offres et vos candidatures au même endroit.",
        "Il est réservé aux personnes de 18 ans ou plus.",
        "Le coach est une intelligence artificielle, pas une personne. Il peut se tromper : relisez ce qu'il prépare avant de l'utiliser. Jobbbox ne garantit aucune embauche.",
        "Vos contenus restent les vôtres. Vous pouvez les télécharger et supprimer votre compte à tout moment.",
        "Les offres payantes et les séances avec un coach humain relèvent de nos conditions générales de vente.",
        "Ce résumé n'a pas de valeur contractuelle : seules les sections ci-dessous vous engagent et nous engagent."
      ],
      "sections": [
        {
          "id": "objet",
          "number": 1,
          "title": "Objet et éditeur",
          "body": "Les présentes conditions générales d'utilisation (les « CGU ») fixent les règles d'utilisation de Jobbbox : le site jobbbox.ai, l'application web et l'extension de navigateur Jobbbox. Elles s'appliquent à toute personne qui crée un compte, et, pour sa partie « Invité (extension) », à toute personne qui utilise l'extension sans compte.\n\nJobbbox est édité par [À FOURNIR : dénomination sociale], dont l'identité et les coordonnées figurent dans les [mentions légales](/legal/mentions-legales). Vous pouvez nous écrire à {{contact-email}}.\n\nLes offres payantes (abonnements et séances avec un coach humain) sont régies en outre par nos [conditions générales de vente](/legal/cgv) (les « CGV »). Ce que nous faisons de vos données est décrit dans notre [politique de confidentialité](/legal/confidentialite)."
        },
        {
          "id": "definitions",
          "number": 2,
          "title": "Définitions",
          "body": "- **Coach IA** : l'assistant de Jobbbox avec lequel vous échangez dans l'application. C'est une intelligence artificielle, pas une personne.\n- **Coach humain** : un professionnel des ressources humaines sélectionné par Jobbbox, avec qui vous pouvez réserver une séance payante.\n- **Compte** : votre espace personnel dans Jobbbox, ouvert à votre adresse e-mail.\n- **Profil** : un projet de recherche d'emploi, avec ses critères de recherche et son CV de référence.\n- **CV de référence** : le CV d'un profil, à partir duquel Jobbbox prépare vos CV adaptés.\n- **Offre d'emploi** : une annonce publiée par un employeur ou un site d'emploi, que Jobbbox trouve, reçoit ou que vous ajoutez.\n- **Vos contenus** : tout ce que vous déposez ou écrivez dans Jobbbox : vos CV, vos messages, vos notes, les e-mails que vous nous transférez.\n- **Invité** : une personne qui utilise l'extension de navigateur sans compte."
        },
        {
          "id": "compte",
          "number": 3,
          "title": "Accès au service et compte",
          "body": "**Âge minimum.** Jobbbox est réservé aux personnes âgées de 18 ans ou plus. En créant un compte, vous déclarez avoir au moins 18 ans.\n\n**Connexion.** Vous vous connectez par un lien envoyé à votre adresse e-mail, ou, quand il est proposé, par un compte Google, Apple, Microsoft ou un autre fournisseur d'identité. Jobbbox ne vous demande pas de mot de passe. Vous pouvez ajouter une vérification en deux étapes dans Mon compte, rubrique Sécurité.\n\n**Un compte par personne.** Votre compte est personnel. Vous gardez l'accès à votre adresse e-mail et à vos moyens de connexion pour vous seul : toute action faite depuis votre compte est réputée faite par vous, sauf si vous nous signalez sans tarder un accès que vous n'avez pas autorisé.\n\n**Gratuité et offres payantes.** L'offre Gratuite donne accès à Jobbbox sans paiement, dans la limite de ses quotas. Les offres payantes donnent des quotas plus élevés ou des fonctionnalités en plus, selon les CGV."
        },
        {
          "id": "acceptation",
          "number": 4,
          "title": "Acceptation et modification des CGU",
          "body": "**Acceptation.** Après votre première connexion, nous vous présentons les présentes CGU, avec leur date de version. Vous les acceptez en cochant la case « J'accepte les CGU (version du …) », qui n'est jamais cochée d'avance, puis en choisissant « Accepter et continuer ». Tant que vous ne les avez pas acceptées, vous pouvez seulement télécharger vos données, supprimer votre compte, gérer votre abonnement et consulter nos textes légaux.\n\n**Consultation.** Chaque version des CGU reste consultable, imprimable et enregistrable à son adresse permanente, `/legal/cgu/<date de la version>`, même après l'entrée en vigueur d'une version plus récente.\n\n**Modification.** Nous pouvons modifier les présentes CGU. Une modification substantielle vous est annoncée par e-mail au moins trente jours avant son entrée en vigueur ; vous pouvez lire la nouvelle version dès cet e-mail. Elle vous est présentée pour acceptation à votre connexion suivante. Si vous ne l'acceptez pas, vous pouvez supprimer votre compte à tout moment et sans frais, et résilier votre abonnement dans les conditions des CGV. Une modification mineure, qui ne change ni vos droits ni vos obligations, s'applique sans nouvelle acceptation ; elle figure dans l'historique des versions. Une modification ne change jamais à elle seule le prix ou les caractéristiques essentielles d'une offre payante en cours : ces changements suivent les règles des CGV.\n\n**Preuve.** Nous conservons, pour chaque acceptation, la version acceptée, sa date et son heure. Cette preuve est conservée après la suppression de votre compte, sans votre nom ni votre adresse e-mail, pendant cinq ans, puis supprimée.\n\n**Langue.** Les CGU sont rédigées en français ; c'est le texte français qui fait foi. La version anglaise est une traduction."
        },
        {
          "id": "service",
          "number": 5,
          "title": "Ce que fait Jobbbox",
          "body": "Jobbbox vous aide à organiser et à mener votre recherche d'emploi. Selon votre offre, il vous permet notamment :\n\n- de créer un ou plusieurs profils, avec leurs critères de recherche, et de déposer votre CV, que Jobbbox lit pour en faire un CV de référence que vous pouvez modifier ;\n- de trouver des offres d'emploi : Jobbbox les cherche sur le web et auprès de sources publiques d'offres, reçoit celles que vous lui transférez par e-mail, et enregistre celles que vous ajoutez avec l'extension ;\n- de calculer un score de correspondance entre votre CV et une offre, et un score de lisibilité de votre CV par les logiciels de recrutement ;\n- de préparer des CV adaptés à une offre, des lettres de motivation et des messages d'approche ou de relance ;\n- de constituer un dossier sur l'employeur à partir de données publiques ;\n- de suivre vos candidatures et vos entretiens dans un agenda, avec des rappels ;\n- de recevoir, si vous le demandez, un récapitulatif régulier des nouvelles offres ;\n- d'échanger avec le coach IA, et de réserver une séance avec un coach humain.\n\n**Ce que Jobbbox ne fait pas.** Jobbbox ne postule pas à votre place et n'envoie aucun message en votre nom : il prépare des brouillons, que vous relisez, modifiez et envoyez vous-même. Jobbbox n'est ni un employeur, ni un cabinet de recrutement, ni une agence de placement, et **ne garantit aucun entretien ni aucune embauche**.\n\n**Vos CV adaptés.** Un CV adapté ne reprend que des faits présents dans votre CV de référence ou que vous avez confirmés. Il vous revient de vérifier, avant de l'envoyer, que tout ce qu'il contient est exact.\n\n**Les offres d'emploi.** Les offres viennent d'employeurs et de sites tiers. Nous ne vérifions pas leur exactitude et ne garantissons pas qu'elles soient toujours ouvertes ; Jobbbox signale une offre qu'il sait expirée. Jobbbox ne lit pas les sites dont les conditions d'utilisation l'interdisent.\n\n**Classement des offres.** Le score de correspondance, de 0 à 100, est calculé par des règles fixes, sans paiement d'aucun employeur ni d'aucun site. Il compare votre CV et vos critères à l'offre sur cinq critères, avec ce poids : les compétences (40), l'expérience (20), le lieu (15), le type de contrat (15) et le salaire (10). Un critère que l'offre ou vos critères ne permettent pas de comparer n'est pas compté ; un score qui repose sur moins de la moitié de ces poids est signalé « partiel ». Quand l'offre ne précise pas un élément, une intelligence artificielle peut lire le texte de l'offre (jamais votre CV) pour le trouver. Le détail du score est affiché avec lui."
        },
        {
          "id": "coach-ia",
          "number": 6,
          "title": "Le coach IA et l'intelligence artificielle",
          "body": "**Le coach est une IA.** Le coach IA vous le dit au début de chaque conversation, et vous répond franchement si vous le lui demandez. Ses réponses et les documents préparés avec l'IA peuvent contenir des erreurs ou des omissions : ce sont des suggestions, pas des conseils professionnels, juridiques ou financiers. Vous restez seul juge de ce que vous en faites.\n\n**Contrôles.** Des contrôles automatiques vérifient vos messages au coach et ses réponses : tentative de détourner le coach, fuite de données personnelles, conseil hors du champ de la recherche d'emploi ou dangereux, détresse. Un message peut ainsi être bloqué, ou une réponse remplacée par un message fixe ; il reste dans la conversation, marqué comme bloqué. Si un message laisse penser que vous êtes en détresse, le coach vous donne le numéro national de prévention du suicide, le 3114 ; personne n'est alerté. Ces contrôles réduisent les risques sans les supprimer.\n\n**Mémoire du coach.** Le coach peut vous proposer de retenir des éléments utiles d'une conversation à l'autre (vos objectifs, vos contraintes) ; un élément n'est retenu que si vous le confirmez, et vous pouvez le modifier ou le supprimer dans « Mémoire du coach ».\n\n**Où l'IA traite vos données.** Avant chaque envoi à un fournisseur d'IA, Jobbbox retire votre identité de la demande. Les fournisseurs, leur lieu de traitement et ce qu'ils reçoivent sont décrits dans la section [« IA dans Jobbbox »](/legal/confidentialite#ia) de la politique de confidentialité et dans la liste des [destinataires des données](/legal/destinataires)."
        },
        {
          "id": "coachs-humains",
          "number": 7,
          "title": "Les coachs humains",
          "body": "Vous pouvez réserver une séance vidéo payante avec un coach humain. La vente, le prix, la réservation, la rétractation et le remboursement d'une séance sont régis par les CGV ; Jobbbox reste votre seul interlocuteur.\n\nUn coach humain ne voit vos profils et vos candidatures que si vous lui en donnez l'accès, dans « Mes coachs humains » ; vous pouvez le lui retirer à tout moment. Il ne voit jamais la mémoire du coach IA ni vos notes de séance. Les retours qu'il vous a laissés vous restent acquis après le retrait de l'accès."
        },
        {
          "id": "contenus",
          "number": 8,
          "title": "Vos contenus",
          "body": "**Ils restent les vôtres.** Vous restez titulaire de vos contenus. Vous nous autorisez seulement à les conserver, les reproduire, les adapter et les transmettre aux prestataires nécessaires, dans la seule mesure où c'est utile pour vous rendre le service, et pour la durée de votre compte. Cette autorisation est gratuite et prend fin avec la suppression du contenu ou de votre compte, sous réserve des durées de conservation de la politique de confidentialité.\n\n**Ce que vous garantissez.** Vous déposez uniquement des contenus que vous avez le droit d'utiliser, exacts à votre connaissance. Vous ne transférez à Jobbbox que des e-mails que vous avez reçus vous-même. Les personnes nommées dans vos contenus (un ancien responsable, un recruteur) ont des droits sur leurs données : la politique de confidentialité dit ce que nous en faisons.\n\n**Les offres que vous ajoutez.** Une offre publique, que vous l'enregistriez depuis une page web ou la receviez dans une alerte d'un site d'emploi, peut être affichée à d'autres utilisateurs, sans aucune information sur vous. Une offre décrite dans le message d'un recruteur que vous nous transférez reste privée : vous seul la voyez.\n\n**Télécharger et supprimer.** Dans Mon compte, rubrique Mes données, vous téléchargez toutes vos données dans un fichier, et vous supprimez votre compte."
        },
        {
          "id": "regles",
          "number": 9,
          "title": "Règles d'utilisation",
          "body": "En utilisant Jobbbox, vous vous engagez à ne pas :\n\n- déposer ou envoyer un contenu illicite, diffamatoire, haineux, discriminatoire ou qui porte atteinte aux droits d'autrui ;\n- vous faire passer pour une autre personne, ou déposer le CV d'un tiers sans son accord ;\n- chercher à détourner le coach IA ou ses contrôles, à lui faire révéler ses instructions, ou à obtenir des données qui ne vous concernent pas ;\n- accéder au service par des moyens automatisés (robots, aspiration de données), sauf l'extension Jobbbox, ni perturber son fonctionnement ou sa sécurité ;\n- revendre, louer ou mettre le service à la disposition d'un tiers ;\n- utiliser les coordonnées d'un contact obtenues par Jobbbox pour autre chose que votre propre recherche d'emploi, ou en violation des règles sur la prospection.\n\n**Comment nous faisons respecter ces règles.** Des contrôles automatiques, décrits plus haut, s'appliquent aux échanges avec le coach IA. Pour le reste, une personne de l'équipe Jobbbox examine les cas qu'on lui signale. Nous pouvons retirer un contenu contraire à ces règles ou à la loi ; nous vous en informons, avec la raison, sauf si la loi nous l'interdit. Vous pouvez contester une décision en nous écrivant à {{contact-email}} ou par « Signaler un problème ».\n\n**Signaler un contenu.** Pour nous signaler un contenu illicite, suivez la section [« Signaler un contenu »](/legal/mentions-legales#signaler) des mentions légales. Ce point de contact répond en français et en anglais."
        },
        {
          "id": "disponibilite",
          "number": 10,
          "title": "Disponibilité et évolution du service",
          "body": "Nous faisons notre possible pour que Jobbbox soit accessible en permanence, mais il peut être interrompu pour une maintenance, une mise à jour ou une panne, chez nous ou chez un prestataire. Les services de tiers (sites d'emploi, fournisseurs d'IA, de recherche ou de paiement) peuvent aussi changer ou cesser.\n\nJobbbox évolue : nous ajoutons, modifions ou retirons des fonctionnalités, et annonçons les nouveautés sur la page Nouveautés. Une évolution d'une offre payante en cours suit les règles des CGV. Nous fournissons les mises à jour nécessaires pour que le service reste conforme ; vous bénéficiez de la garantie légale de conformité des services numériques (articles L224-25-12 et suivants du Code de la consommation).\n\nL'extension de navigateur fonctionne avec la version de l'application web en cours ; si elle est trop ancienne, elle vous demande de la mettre à jour."
        },
        {
          "id": "responsabilite",
          "number": 11,
          "title": "Responsabilité",
          "body": "Nous répondons des manquements à nos obligations dans les conditions du droit commun. Nous ne sommes pas responsables des décisions des employeurs, du contenu des offres et des sites tiers, ni d'un dommage dû à votre faute ou à un cas de force majeure.\n\nRien dans les présentes CGU ne limite ni n'exclut les droits que vous tenez de la loi, notamment votre droit à réparation en cas de manquement de notre part."
        },
        {
          "id": "resiliation",
          "number": 12,
          "title": "Suspension et fin du compte",
          "body": "**Par vous.** Vous pouvez supprimer votre compte à tout moment, sans frais et sans motif, dans Mon compte, rubrique Mes données, en confirmant par votre adresse e-mail. La suppression est immédiate : elle met d'abord fin à votre abonnement payant éventuel, puis efface vos données, dans les conditions de la politique de confidentialité.\n\n**Par nous.** Nous pouvons suspendre ou fermer votre compte :\n\n- sans préavis, en cas de manquement grave aux présentes CGU (fraude, atteinte à la sécurité du service ou aux droits d'autrui) ou sur demande d'une autorité ;\n- pour un autre manquement, après vous avoir écrit pour vous en donner la raison et vous laisser [À FOURNIR : délai, par exemple 15 jours] pour y remédier.\n\nNous vous informons par e-mail de la décision et de sa raison, et de la façon de la contester. En cas de fermeture de votre compte, vous pouvez d'abord télécharger vos données, sauf si la loi s'y oppose. Une offre payante en cours suit alors les règles des CGV.\n\nNous pouvons aussi fermer Jobbbox. Nous vous en prévenons alors par e-mail au moins [À FOURNIR : délai, par exemple 60 jours] à l'avance, pour vous laisser télécharger vos données ; la partie d'un abonnement payée et non utilisée vous est remboursée."
        },
        {
          "id": "donnees",
          "number": 13,
          "title": "Données personnelles",
          "body": "Nous traitons vos données personnelles comme le décrit notre [politique de confidentialité](/legal/confidentialite), qui précise aussi vos droits et comment les exercer. Les noms des prestataires qui reçoivent des données figurent dans la liste des [destinataires des données](/legal/destinataires)."
        },
        {
          "id": "invite",
          "number": 14,
          "title": "Invité (extension)",
          "body": "Cette section s'applique quand vous utilisez l'extension de navigateur Jobbbox sans compte. Vous l'acceptez en cochant la case de l'extension avant d'envoyer votre premier CV ; l'extension garde cette acceptation pour la seule durée de votre session.\n\n**Ce que vous pouvez faire.** Sans compte, vous pouvez enregistrer une offre d'emploi depuis la page que vous consultez, choisir votre CV, et obtenir un score de correspondance entre les deux.\n\n**Ce qui part chez nous, et ce qui reste chez vous.** Pour calculer le score, l'extension envoie votre CV à Jobbbox, qui le lit par des règles fixes, sans intelligence artificielle, et n'en garde rien. L'offre enregistrée est conservée sans aucune information sur vous, et oubliée au plus tard 24 heures après, si aucun utilisateur avec un compte ne l'a enregistrée entre-temps. Votre CV, l'offre et votre score restent dans votre navigateur, au plus 23 heures ; « Effacer mes données maintenant » les efface tout de suite, et fermer le navigateur aussi.\n\n**Vos engagements.** Vous avez au moins 18 ans. Vous n'utilisez que votre propre CV. Les règles d'utilisation, la limitation de responsabilité et l'absence de garantie d'embauche de ces CGU s'appliquent aussi à vous.\n\n**Créer un compte.** Si vous créez un compte ou vous connectez, votre CV devient un profil et l'offre une candidature dans ce compte. Vous acceptez alors l'ensemble des présentes CGU, sur l'écran prévu à cet effet."
        },
        {
          "id": "litiges",
          "number": 15,
          "title": "Droit applicable et litiges",
          "body": "Les présentes CGU sont soumises au droit français. Si vous résidez dans un autre pays de l'Union européenne, vous gardez la protection des règles impératives de votre pays.\n\nEn cas de difficulté, écrivez-nous d'abord à {{contact-email}}. Si notre réponse ne vous satisfait pas, vous pouvez recourir gratuitement au médiateur de la consommation indiqué dans les [mentions légales](/legal/mentions-legales#mediateur), dans les conditions des [CGV](/legal/cgv#litiges). À défaut d'accord, le litige peut être porté devant la juridiction compétente selon les règles du Code de procédure civile et du Code de la consommation, notamment celle du lieu où vous demeuriez au moment de l'utilisation du service."
        }
      ]
    }
  ],
  "en": [
    {
      "text": "cgu",
      "locale": "en",
      "effective": "2027-01-04",
      "title": "Terms of use",
      "change": "substantielle",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "First version of the terms of use, with the « Guest (extension) » section.",
      "inBrief": [
        "Jobbbox helps you look for a job: an AI coach, your CVs, job offers and your applications in one place.",
        "It is for people aged 18 or over.",
        "The coach is an artificial intelligence, not a person. It can be wrong: reread what it prepares before you use it. Jobbbox guarantees no hiring.",
        "Your content stays yours. You can download it and delete your account at any time.",
        "Paid plans and sessions with a human coach are governed by our terms of sale.",
        "This summary has no contractual value: only the sections below bind you and us."
      ],
      "sections": [
        {
          "id": "objet",
          "number": 1,
          "title": "Purpose and publisher",
          "body": "These general terms of use (the \"Terms\") set the rules for using Jobbbox: the jobbbox.ai site, the web app and the Jobbbox browser extension. They apply to anyone who creates an account and, for their « Guest (extension) » part, to anyone who uses the extension without an account.\n\nJobbbox is published by [À FOURNIR : dénomination sociale], whose identity and contact details are in the [legal notice](/legal/mentions-legales). You can write to us at {{contact-email}}.\n\nPaid plans (subscriptions and sessions with a human coach) are also governed by our [terms of sale](/legal/cgv) (the \"Terms of Sale\"). What we do with your data is described in our [privacy policy](/legal/confidentialite)."
        },
        {
          "id": "definitions",
          "number": 2,
          "title": "Definitions",
          "body": "- **AI coach**: the Jobbbox assistant you talk to in the app. It is an artificial intelligence, not a person.\n- **Human coach**: a human resources professional selected by Jobbbox, with whom you can book a paid session.\n- **Account**: your personal space in Jobbbox, opened with your email address.\n- **Profile**: a job search project, with its search criteria and its master CV.\n- **Master CV**: a profile's CV, from which Jobbbox prepares your tailored CVs.\n- **Job offer**: a posting published by an employer or a job site, which Jobbbox finds or receives, or which you add.\n- **Your content**: everything you upload or write in Jobbbox: your CVs, your messages, your notes, the emails you forward to us.\n- **Guest**: a person who uses the browser extension without an account."
        },
        {
          "id": "compte",
          "number": 3,
          "title": "Access to the service and account",
          "body": "**Minimum age.** Jobbbox is for people aged 18 or over. By creating an account, you state that you are at least 18.\n\n**Sign-in.** You sign in with a link sent to your email address or, where offered, with a Google, Apple, Microsoft or other identity provider account. Jobbbox does not ask you for a password. You can add two-step verification in My account, Security section.\n\n**One account per person.** Your account is personal. You keep access to your email address and your sign-in methods to yourself: any action taken from your account is deemed taken by you, unless you promptly tell us of access you did not authorise.\n\n**Free and paid plans.** The Free plan gives access to Jobbbox without payment, within its quotas. Paid plans give higher quotas or extra features, under the Terms of Sale."
        },
        {
          "id": "acceptation",
          "number": 4,
          "title": "Acceptance and changes to the Terms",
          "body": "**Acceptance.** After your first sign-in, we show you these Terms, with their version date. You accept them by ticking the box « I accept the Terms of use (version of …) », which is never ticked in advance, then choosing « Accept and continue ». Until you have accepted them, you can only download your data, delete your account, manage your subscription and read our legal texts.\n\n**Access.** Each version of the Terms remains readable, printable and saveable at its permanent address, `/legal/cgu/<version date>`, even after a later version takes effect.\n\n**Changes.** We may change these Terms. A substantial change is announced to you by email at least thirty days before it takes effect; you can read the new version from that email onwards. It is shown to you for acceptance at your next sign-in. If you do not accept it, you can delete your account at any time and at no cost, and cancel your subscription under the Terms of Sale. A minor change, which changes neither your rights nor your obligations, applies without a new acceptance; it appears in the version history. A change never by itself alters the price or the essential characteristics of a paid plan in progress: such changes follow the rules of the Terms of Sale.\n\n**Proof.** For each acceptance, we keep the version accepted and its date and time. This proof is kept after your account is deleted, without your name or email address, for five years, then deleted.\n\n**Language.** The Terms are written in French; the French text prevails. The English version is a translation."
        },
        {
          "id": "service",
          "number": 5,
          "title": "What Jobbbox does",
          "body": "Jobbbox helps you organise and carry out your job search. Depending on your plan, it lets you in particular:\n\n- create one or more profiles, with their search criteria, and upload your CV, which Jobbbox reads to make a master CV you can edit;\n- find job offers: Jobbbox searches for them on the web and with public sources of job offers, receives those you forward to it by email, and saves those you add with the extension;\n- compute a match score between your CV and an offer, and a score of how well applicant tracking software can read your CV;\n- prepare CVs tailored to an offer, cover letters and outreach or follow-up messages;\n- build a file on the employer from public data;\n- follow your applications and interviews in an agenda, with reminders;\n- receive, if you ask for it, a regular summary of new offers;\n- talk with the AI coach, and book a session with a human coach.\n\n**What Jobbbox does not do.** Jobbbox does not apply on your behalf and sends no message in your name: it prepares drafts, which you reread, edit and send yourself. Jobbbox is not an employer, a recruitment firm or a placement agency, and **guarantees no interview and no hiring**.\n\n**Your tailored CVs.** A tailored CV only uses facts present in your master CV or that you have confirmed. It is up to you to check, before sending it, that everything in it is accurate.\n\n**Job offers.** Offers come from employers and third-party sites. We do not check their accuracy and do not guarantee that they are still open; Jobbbox flags an offer it knows has expired. Jobbbox does not read sites whose terms of use forbid it.\n\n**Ranking of offers.** The match score, from 0 to 100, is computed by fixed rules, with no payment from any employer or site. It compares your CV and your criteria with the offer on five criteria, with this weight: skills (40), experience (20), location (15), contract type (15) and salary (10). A criterion that the offer or your criteria give nothing to compare is not counted; a score resting on less than half of these weights is marked \"partial\". When the offer does not state an item, an artificial intelligence may read the offer's text (never your CV) to find it. The score's breakdown is shown with it."
        },
        {
          "id": "coach-ia",
          "number": 6,
          "title": "The AI coach and artificial intelligence",
          "body": "**The coach is an AI.** The AI coach tells you so at the start of each conversation, and answers truthfully if you ask. Its replies and the documents prepared with AI may contain errors or omissions: they are suggestions, not professional, legal or financial advice. You alone decide what you do with them.\n\n**Checks.** Automatic checks review your messages to the coach and its replies: attempts to divert the coach, leaks of personal data, advice outside the scope of a job search or dangerous advice, distress. A message may thus be blocked, or a reply replaced by a fixed message; it stays in the conversation, marked as blocked. If a message suggests you are in distress, the coach gives you the French national suicide prevention number, 3114; no one is alerted. These checks reduce risks without removing them.\n\n**Coach memory.** The coach may offer to remember useful items from one conversation to the next (your goals, your constraints); an item is kept only if you confirm it, and you can edit or delete it in « Coach memory ».\n\n**Where AI processes your data.** Before each request is sent to an AI provider, Jobbbox takes your identity out of it. The providers, where they process data and what they receive are described in the [« IA dans Jobbbox »](/legal/confidentialite#ia) section of the privacy policy and in the list of [data recipients](/legal/destinataires)."
        },
        {
          "id": "coachs-humains",
          "number": 7,
          "title": "Human coaches",
          "body": "You can book a paid video session with a human coach. The sale, price, booking, withdrawal and refund of a session are governed by the Terms of Sale; Jobbbox remains your sole point of contact.\n\nA human coach sees your profiles and applications only if you give them access, in « My human coaches »; you can withdraw it at any time. They never see the AI coach's memory or your session notes. The feedback they left you stays yours after access is withdrawn."
        },
        {
          "id": "contenus",
          "number": 8,
          "title": "Your content",
          "body": "**It stays yours.** You remain the owner of your content. You only authorise us to store, reproduce, adapt and pass it to the necessary service providers, to the sole extent useful to provide the service to you, and for the life of your account. This authorisation is free of charge and ends when the content or your account is deleted, subject to the retention periods of the privacy policy.\n\n**What you warrant.** You only upload content you have the right to use and that is accurate to your knowledge. You only forward to Jobbbox emails you received yourself. People named in your content (a former manager, a recruiter) have rights over their data: the privacy policy says what we do with it.\n\n**Offers you add.** A public offer, whether you save it from a web page or receive it in a job site's alert, may be shown to other users, without any information about you. An offer described in a recruiter's message that you forward to us stays private: only you see it.\n\n**Download and delete.** In My account, My data section, you download all your data in one file, and you delete your account."
        },
        {
          "id": "regles",
          "number": 9,
          "title": "Rules of use",
          "body": "By using Jobbbox, you undertake not to:\n\n- upload or send content that is illegal, defamatory, hateful, discriminatory or infringes the rights of others;\n- impersonate another person, or upload a third party's CV without their consent;\n- try to divert the AI coach or its checks, make it reveal its instructions, or obtain data that does not concern you;\n- access the service by automated means (bots, data scraping), other than the Jobbbox extension, or disrupt its operation or security;\n- resell, rent or make the service available to a third party;\n- use a contact's details obtained through Jobbbox for anything other than your own job search, or in breach of the rules on direct marketing.\n\n**How we enforce these rules.** Automatic checks, described above, apply to exchanges with the AI coach. Otherwise, a member of the Jobbbox team examines the cases reported to them. We may remove content contrary to these rules or to the law; we tell you so, with the reason, unless the law forbids us. You can challenge a decision by writing to us at {{contact-email}} or with « Report a problem ».\n\n**Report content.** To report illegal content to us, follow the [« Report content »](/legal/mentions-legales#signaler) section of the legal notice. This point of contact answers in French and in English."
        },
        {
          "id": "disponibilite",
          "number": 10,
          "title": "Availability and changes to the service",
          "body": "We do our best to keep Jobbbox available at all times, but it may be interrupted for maintenance, an update or a failure, on our side or at a service provider. Third-party services (job sites, AI, search or payment providers) may also change or stop.\n\nJobbbox evolves: we add, change or remove features, and announce what is new on the What's new page. A change to a paid plan in progress follows the rules of the Terms of Sale. We provide the updates needed for the service to remain in conformity; you benefit from the legal guarantee of conformity of digital services (articles L224-25-12 et seq. of the French Consumer Code).\n\nThe browser extension works with the current version of the web app; if it is too old, it asks you to update it."
        },
        {
          "id": "responsabilite",
          "number": 11,
          "title": "Liability",
          "body": "We are liable for failures to meet our obligations under the ordinary rules of law. We are not liable for employers' decisions, for the content of offers and third-party sites, or for damage due to your fault or to force majeure.\n\nNothing in these Terms limits or excludes the rights you hold under the law, in particular your right to compensation if we fail to meet our obligations."
        },
        {
          "id": "resiliation",
          "number": 12,
          "title": "Suspension and end of the account",
          "body": "**By you.** You can delete your account at any time, at no cost and without giving a reason, in My account, My data section, confirming with your email address. Deletion is immediate: it first ends any paid subscription, then erases your data, under the privacy policy.\n\n**By us.** We may suspend or close your account:\n\n- without notice, for a serious breach of these Terms (fraud, harm to the security of the service or to the rights of others) or at the request of an authority;\n- for another breach, after writing to you to give the reason and leaving you [À FOURNIR : délai, par exemple 15 jours] to remedy it.\n\nWe inform you by email of the decision, its reason and how to challenge it. If your account is closed, you may first download your data, unless the law prevents it. A paid plan in progress then follows the rules of the Terms of Sale.\n\nWe may also close Jobbbox. We then tell you by email at least [À FOURNIR : délai, par exemple 60 jours] in advance, so that you can download your data; the paid and unused part of a subscription is refunded to you."
        },
        {
          "id": "donnees",
          "number": 13,
          "title": "Personal data",
          "body": "We process your personal data as described in our [privacy policy](/legal/confidentialite), which also sets out your rights and how to exercise them. The names of the service providers that receive data are in the list of [data recipients](/legal/destinataires)."
        },
        {
          "id": "invite",
          "number": 14,
          "title": "Guest (extension)",
          "body": "This section applies when you use the Jobbbox browser extension without an account. You accept it by ticking the extension's box before sending your first CV; the extension keeps this acceptance for your session only.\n\n**What you can do.** Without an account, you can save a job offer from the page you are viewing, choose your CV, and get a match score between the two.\n\n**What reaches us, and what stays with you.** To compute the score, the extension sends your CV to Jobbbox, which reads it by fixed rules, without artificial intelligence, and keeps nothing of it. The saved offer is kept without any information about you, and forgotten at the latest 24 hours later, unless a user with an account has saved it in the meantime. Your CV, the offer and your score stay in your browser, for 23 hours at most; « Delete my data now » erases them at once, and so does closing the browser.\n\n**Your commitments.** You are at least 18. You only use your own CV. The rules of use, the liability clause and the absence of any hiring guarantee in these Terms also apply to you.\n\n**Creating an account.** If you create an account or sign in, your CV becomes a profile and the offer an application in that account. You then accept these Terms in full, on the screen provided for that purpose."
        },
        {
          "id": "litiges",
          "number": 15,
          "title": "Applicable law and disputes",
          "body": "These Terms are governed by French law. If you live in another country of the European Union, you keep the protection of the mandatory rules of your country.\n\nIf there is a problem, first write to us at {{contact-email}}. If our answer does not satisfy you, you may refer the matter, free of charge, to the consumer mediator named in the [legal notice](/legal/mentions-legales#mediateur), under the conditions of the [Terms of Sale](/legal/cgv#litiges). Failing agreement, the dispute may be brought before the competent court under the rules of the French Code of Civil Procedure and Consumer Code, in particular the court of the place where you lived when using the service."
        }
      ]
    }
  ]
};

export const LEGAL_TEXT_REGISTRY: readonly LegalTextVersionRecord[] = [
  {
    "text": "cgu",
    "version": "2027-01-04",
    "url": "/legal/cgu/2027-01-04",
    "sha256": "9be8d8055dafff14c8352051902ad2fe26e628caff49384233deea94158afcf8",
    "change": "substantielle"
  }
];
