// Written by `npm run build -w @jobhub/help` from legal/<text>/<YYYY-MM-DD>.<locale>.md: edit those, never this file.
import type { LegalTextVersion, LegalTextVersionRecord } from "./legal-texts";
import type { HelpLocale } from "./types";

export const LEGAL_TEXT_VERSIONS: Record<HelpLocale, readonly LegalTextVersion[]> = {
  "fr": [
    {
      "text": "cgv",
      "locale": "fr",
      "effective": "2027-01-04",
      "title": "Conditions générales de vente",
      "change": "substantielle",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "Première version des conditions générales de vente, avec le formulaire de rétractation.",
      "inBrief": [
        "Ces conditions s'appliquent aux abonnements payants de Jobbbox et aux séances avec un coach humain.",
        "Un abonnement est mensuel, sans durée minimale : vous le résiliez à tout moment, en deux clics, depuis la page Mon abonnement.",
        "Vous avez 14 jours pour vous rétracter, sans motif, avec « Renoncer au contrat ici ».",
        "Si nous réduisons ce que comprend votre offre, vous êtes prévenu 30 jours avant et pouvez résilier sans frais.",
        "Ce résumé n'a pas de valeur contractuelle : seules les sections ci-dessous vous engagent et nous engagent."
      ],
      "sections": [
        {
          "id": "objet",
          "number": 1,
          "title": "Objet, champ et vendeur",
          "body": "Les présentes conditions générales de vente (les « CGV ») régissent les ventes conclues en ligne sur Jobbbox entre vous, consommateur, et le vendeur :\n\n- les **abonnements** aux offres payantes de Jobbbox (les « offres ») ;\n- les **séances** en visio avec un coach humain (les « séances »).\n\nLe vendeur est [À FOURNIR : dénomination sociale, forme et capital], dont le siège est situé [À FOURNIR : adresse du siège social], immatriculée sous le numéro [À FOURNIR : RCS ou SIREN], numéro de TVA [À FOURNIR : TVA intracommunautaire], téléphone [À FOURNIR : téléphone], adresse électronique {{contact-email}} (« Jobbbox », « nous »). Ses mentions complètes figurent dans les [mentions légales](/legal/mentions-legales).\n\nL'utilisation du service, offre Gratuite comprise, est régie par nos [conditions générales d'utilisation](/legal/cgu) (les « CGU »), qui s'appliquent aussi à vous. En cas de contradiction sur une vente, les présentes CGV l'emportent."
        },
        {
          "id": "offres",
          "number": 2,
          "title": "Les offres",
          "body": "**Offre Gratuite et offres payantes.** L'offre Gratuite est sans paiement. Les offres payantes (aujourd'hui Standard et Premium) donnent plus que l'offre Gratuite, pour un prix mensuel.\n\n**Ce que comprend chaque offre.** Chaque offre se définit par :\n\n- ses **quotas** : le nombre de profils que vous pouvez avoir en même temps et, chaque semaine, le nombre de scores de correspondance, de scores ATS, de recherches d'offres et de contacts enrichis. Un quota peut être illimité, ou absent d'une offre. La semaine commence le lundi à 0 h, heure de Paris ; les quotas non utilisés ne se reportent pas ;\n- la fréquence à laquelle vous pouvez recevoir le récapitulatif des nouvelles offres ;\n- ses fonctionnalités incluses, comme une réduction sur le prix des séances.\n\nLe contenu et le prix de chaque offre sont présentés dans « Les offres », sur la page Mon abonnement, et rappelés sur la page « Votre commande » avant tout paiement. Ces informations font partie du contrat.\n\n**Fonctionnement.** Jobbbox est utilisable dans un navigateur web récent, sur ordinateur, tablette ou téléphone ; l'extension fonctionne avec le navigateur Google Chrome. Certaines fonctionnalités dépendent de services tiers (sites d'emploi, fournisseurs d'IA), décrits dans les CGU."
        },
        {
          "id": "prix",
          "number": 3,
          "title": "Prix et paiement",
          "body": "**Prix.** Les prix sont indiqués en euros, toutes taxes comprises. Le prix applicable est celui affiché sur la page « Votre commande » au moment de votre commande.\n\n**Paiement.** Le paiement se fait par carte bancaire, ou par un autre moyen proposé, sur la page sécurisée de notre prestataire de paiement, Stripe. Jobbbox ne voit jamais votre numéro de carte. Un abonnement est prélevé au début de chaque période mensuelle ; une séance est payée en une fois, à la commande. Vos factures sont disponibles dans « Factures et moyen de paiement », sur la page Mon abonnement.\n\n**Codes promo.** Un code promo s'applique à un abonnement, dans les conditions affichées lors de sa saisie (montant ou pourcentage, durée, offres concernées, date limite). Un code qui ne s'applique pas est refusé avec sa raison. Les séances n'acceptent pas de code promo.\n\n**Échec de paiement.** Si un prélèvement échoue, notre prestataire de paiement le présente à nouveau, et nous vous invitons, dans Jobbbox, à mettre à jour votre moyen de paiement ; vous gardez votre offre pendant ces nouvelles tentatives. [À CONFIRMER : ce qui se passe quand toutes les tentatives ont échoué (fin de l'abonnement et passage à l'offre Gratuite ?), selon les réglages de relance du compte Stripe.]\n\n**Évolution du prix d'un abonnement en cours.** Si nous augmentons le prix d'une offre, nous vous prévenons par e-mail au moins un mois avant le prélèvement concerné. Le nouveau prix ne s'applique qu'à partir de la période qui suit ce délai. Vous pouvez résilier votre abonnement sans frais avant cette date, depuis la page Mon abonnement."
        },
        {
          "id": "commande",
          "number": 4,
          "title": "Commande",
          "body": "**Récapitulatif.** Avant tout paiement, la page « Votre commande » récapitule votre commande : l'offre ou la séance choisie (avec le nom du coach), son prix toutes taxes comprises et, pour un abonnement, sa périodicité et sa reconduction automatique. Pour corriger votre choix, revenez en arrière avant de payer.\n\n**Acceptation des CGV.** Vous y acceptez les présentes CGV en cochant la case « J'accepte les CGV (version du …) », qui n'est jamais cochée d'avance. La version acceptée est identifiée par sa date et reste consultable, imprimable et enregistrable à son adresse permanente. Le contrat reste régi par la version acceptée lors de sa conclusion, sauf modification intervenue dans les conditions prévues par la loi et par les présentes CGV.\n\n**Demande d'exécution immédiate.** Une deuxième case, facultative et jamais cochée d'avance, vous permet de demander que le service commence immédiatement ; ses effets sont décrits à la section « Droit de rétractation ».\n\n**Paiement et conclusion.** « Passer au paiement » vous mène à la page de paiement de Stripe, où vous confirmez votre commande et votre obligation de payer. Le contrat est conclu à la confirmation du paiement.\n\n**Confirmation.** Nous vous confirmons la commande par e-mail dès réception du paiement : récapitulatif, montant payé, lien vers la version des CGV acceptée, votre choix d'exécution immédiate et ses effets, la date limite de rétractation, l'emplacement de « Renoncer au contrat ici » et le formulaire de rétractation. Conservez cet e-mail.\n\n**Preuve.** Nous conservons la preuve de votre acceptation des CGV (version, date et heure, référence du paiement, choix d'exécution immédiate) pendant dix ans à compter de la suppression de votre compte, sans votre nom ni votre adresse e-mail. Vous pouvez y accéder tant que votre compte existe, dans le téléchargement de vos données, et nous la demander ensuite à {{contact-email}}.\n\n**Changement d'offre en cours d'abonnement.** Si vous avez déjà un abonnement payant, vous changez d'offre dans « Gérer mon abonnement », sur la page de notre prestataire de paiement. [À CONFIRMER : prise d'effet et calcul au prorata d'un changement d'offre, selon les réglages du portail Stripe.] Un changement d'offre ne constitue pas un nouveau contrat et n'ouvre pas de nouveau délai de rétractation."
        },
        {
          "id": "resiliation",
          "number": 5,
          "title": "Durée et résiliation d'un abonnement",
          "body": "**Durée.** Un abonnement est conclu pour une durée indéterminée, sans durée minimale. Il se renouvelle automatiquement à la fin de chaque période mensuelle, jusqu'à sa résiliation.\n\n**Résiliation.** Vous pouvez le résilier à tout moment, sans frais et sans avoir à motiver votre demande, depuis votre compte : sur la page Mon abonnement, par le bouton « Résilier votre contrat », puis « Confirmer la résiliation ».\n\nLa résiliation prend effet à la fin de la période en cours, déjà payée. Jusqu'à cette date, vous conservez votre offre ; aucun prélèvement n'a lieu ensuite, et votre compte passe à l'offre Gratuite. La période en cours n'est pas remboursée, sauf rétractation dans son délai ou résiliation sans frais après une réduction de votre offre.\n\nNous vous adressons sans délai, par e-mail, un accusé de réception de votre résiliation, mentionnant la date de votre demande et la date à laquelle le contrat prend fin. Jusqu'à cette date, vous pouvez renoncer à votre résiliation avec « Gérer mon abonnement », sur la page Mon abonnement.\n\n**Suppression du compte.** Supprimer votre compte met fin immédiatement à votre abonnement. [À CONFIRMER : la période en cours est-elle remboursée au prorata ? Position prudente proposée : oui, comme pour une résiliation sans frais.]"
        },
        {
          "id": "evolution",
          "number": 6,
          "title": "Évolution des offres payantes",
          "body": "**Raisons.** Nous pouvons faire évoluer le contenu des offres payantes (quotas, fréquence du récapitulatif des offres, fonctionnalités incluses) pour l'une des raisons suivantes : évolution du coût des services de nos fournisseurs (recherche d'offres, intelligence artificielle, enrichissement de contacts) ; évolution légale ou réglementaire ; exigence de sécurité ; évolution ou arrêt d'un service tiers dont dépend la fonctionnalité.\n\n**Ce qui augmente** ce que comprend votre offre s'applique immédiatement, sans frais.\n\n**Ce qui réduit** ce que comprend votre offre (un quota plus petit, une limite là où il n'y en avait pas, un récapitulatif moins fréquent, une fonctionnalité retirée) vous est annoncé par e-mail au moins 30 jours avant sa date d'effet, avec ce qui change, la raison et la date. Jusqu'à cette date, votre offre reste inchangée ; la page Mon abonnement affiche aussi le changement à venir.\n\n**Votre droit de résilier sans frais.** Vous pouvez alors résilier votre abonnement sans frais, à tout moment avant la date d'effet et jusqu'à 30 jours après celle-ci, depuis le lien de l'e-mail ou par « Résilier sans frais » sur la page Mon abonnement. La résiliation prend effet immédiatement ; nous vous remboursons, au prorata, la part du prix payé qui correspond à la période restant à courir, sur le moyen de paiement utilisé, au plus tard dans les 14 jours.\n\nNous n'utilisons pas cette faculté pour modifier le prix : une hausse de prix suit la section « Prix et paiement »."
        },
        {
          "id": "seances",
          "number": 7,
          "title": "Séances avec un coach humain",
          "body": "**Qui vend, qui anime.** Jobbbox vend la séance et en fixe le prix. Elle est animée par un coach humain, professionnel des ressources humaines sélectionné par Jobbbox, qui intervient comme prestataire de Jobbbox. Jobbbox reste votre seul interlocuteur pour la séance, son paiement et toute réclamation.\n\n**Déroulement.** Une séance est un entretien en visio de [À FOURNIR : durée de la séance], sur votre recherche d'emploi. Après le paiement, vous choisissez un créneau sur la page de réservation du coach (service Cal.com), puis vous saisissez la date et le lien de la visio dans Jobbbox ; tant qu'elle n'a pas de date, la séance attend dans « À planifier », dans votre agenda. [À FOURNIR : délai dans lequel la séance doit être réservée et tenue, le cas échéant.]\n\n**Report et annulation.** [À FOURNIR : règles de report et d'annulation par vous et par le coach (délai de prévenance, nombre de reports, absence de l'une des parties), et remboursement hors délai de rétractation. Position prudente proposée : une séance que le coach annule ou ne tient pas est reportée ou remboursée en totalité, à votre choix ; une séance que vous annulez au moins 24 heures à l'avance peut être reportée.]\n\n**Coach qui cesse son activité.** Si le coach choisi cesse de collaborer avec Jobbbox avant votre séance, nous vous proposons un autre coach ou vous remboursons la séance en totalité, à votre choix.\n\n**Accès du coach.** Le coach ne voit vos profils et vos candidatures que si vous lui en donnez l'accès, selon les CGU."
        },
        {
          "id": "droit-de-retractation",
          "number": 8,
          "title": "Droit de rétractation",
          "body": "**Délai.** Vous pouvez vous rétracter d'un contrat, sans avoir à motiver votre décision ni à supporter d'autres coûts que ceux indiqués ci-dessous, dans un délai de quatorze jours à compter du lendemain de la conclusion du contrat : pour un abonnement, le jour de sa souscription ; pour une séance, le jour de son paiement. Le délai expire à la fin du quatorzième jour, heure de Paris ; s'il expire un samedi, un dimanche ou un jour férié, il est prolongé jusqu'à la fin du premier jour ouvrable suivant.\n\n**Comment.** Vous pouvez vous rétracter depuis votre compte, par la fonction « Renoncer au contrat ici » : sur la page Mon abonnement pour votre abonnement, et sur la séance, dans votre agenda, pour une séance. Vous y indiquez votre nom, le contrat concerné et l'adresse où recevoir l'accusé de réception, puis vous choisissez « Confirmer la rétractation ». Vous pouvez aussi nous adresser, avant la fin du délai, le [formulaire de rétractation](#retractation) ci-dessous ou toute autre déclaration dénuée d'ambiguïté, à {{contact-email}} ou par courrier à l'adresse du vendeur.\n\n**Accusé de réception.** Nous vous adressons sans délai, par e-mail, un accusé de réception de votre rétractation, mentionnant son contenu, sa date et son heure.\n\n**Effets sur un abonnement.** Votre abonnement prend fin immédiatement, sans attendre l'échéance de la période en cours, et votre compte repasse à l'offre Gratuite.\n\n- **Sans demande d'exécution immédiate**, nous vous remboursons la totalité des sommes versées.\n- **Avec demande d'exécution immédiate** (case cochée sur la page « Votre commande »), vous nous devez un montant proportionné au service fourni jusqu'à votre rétractation : nous vous remboursons les sommes versées, diminuées de la part correspondant au nombre de jours entiers écoulés depuis le début de la période payée ; le jour entamé n'est pas compté.\n\n**Effets sur une séance.**\n\n- **Sans demande d'exécution immédiate**, une rétractation dans le délai vous est remboursée en totalité, que la séance ait eu lieu ou non.\n- **Avec demande d'exécution immédiate et reconnaissance de la perte de votre droit** (case cochée sur la page « Votre commande »), vous pouvez vous rétracter tant que la séance n'a pas eu lieu, avec un remboursement total ; une fois la séance pleinement réalisée, vous ne pouvez plus vous rétracter.\n\nUne séance qui n'a pas encore eu lieu est annulée, et le coach en est prévenu.\n\n**Remboursement.** Nous vous remboursons au plus tard dans les quatorze jours suivant la réception de votre rétractation, par le même moyen de paiement que celui utilisé pour la commande, sans frais pour vous. Un contrat que vous n'avez pas payé, grâce à un code promo, peut être rétracté de la même façon, sans rien à rembourser.\n\n**Changement d'offre.** Le passage d'une offre à une autre au cours d'un même abonnement n'ouvre pas de nouveau délai de rétractation."
        },
        {
          "id": "garanties",
          "number": 9,
          "title": "Garanties légales",
          "body": "Vous bénéficiez de la garantie légale de conformité des contenus et services numériques (articles L224-25-12 et suivants du Code de la consommation). Pendant toute la durée de votre abonnement, nous devons vous fournir un service conforme au contrat, et les mises à jour nécessaires à sa conformité. En cas de défaut de conformité, vous pouvez demander sa mise en conformité ; à défaut, ou si le défaut est grave, vous pouvez obtenir une réduction du prix ou mettre fin au contrat avec remboursement. Signalez-nous tout défaut à {{contact-email}} ou par « Signaler un problème ».\n\nCes garanties s'appliquent sans frais pour vous et s'ajoutent aux autres droits que vous tenez de la loi."
        },
        {
          "id": "responsabilite",
          "number": 10,
          "title": "Responsabilité",
          "body": "Nous répondons de la bonne exécution des contrats conclus selon les présentes CGV, y compris des séances animées par un coach humain, dans les conditions du droit commun. Nous ne sommes pas responsables d'un dommage dû à votre faute, au fait imprévisible et insurmontable d'un tiers, ou à un cas de force majeure.\n\nJobbbox, ses offres et ses séances aident votre recherche d'emploi ; ils ne garantissent ni entretien ni embauche.\n\nRien dans les présentes CGV ne limite ni n'exclut les droits que vous tenez de la loi, notamment votre droit à réparation en cas de manquement de notre part."
        },
        {
          "id": "donnees",
          "number": 11,
          "title": "Données personnelles",
          "body": "Les données nécessaires à vos commandes (récapitulatif, acceptation des CGV, rétractation, résiliation) sont traitées comme le décrit notre [politique de confidentialité](/legal/confidentialite). Les données de paiement sont traitées par Stripe ; Jobbbox ne voit jamais votre numéro de carte."
        },
        {
          "id": "litiges",
          "number": 12,
          "title": "Réclamations, médiation et litiges",
          "body": "**Réclamation.** Pour toute réclamation, écrivez-nous à {{contact-email}} ou, connecté, par « Signaler un problème ».\n\n**Médiation.** Si nous n'avons pas trouvé de solution, vous pouvez, dans un délai d'un an à compter de votre réclamation écrite auprès de nous, saisir gratuitement le médiateur de la consommation dont nous relevons :\n\n- [À FOURNIR : nom du médiateur]\n- [À FOURNIR : adresse postale du médiateur]\n- [À FOURNIR : site internet du médiateur, où le saisir en ligne]\n\nLe recours au médiateur est facultatif : vous restez libre de saisir le juge.\n\n**Droit applicable.** Les présentes CGV sont soumises au droit français. Si vous résidez dans un autre pays de l'Union européenne, vous gardez la protection des règles impératives de votre pays. À défaut d'accord, le litige peut être porté devant la juridiction compétente selon les règles du Code de procédure civile et du Code de la consommation, notamment celle du lieu où vous demeuriez au moment de la conclusion du contrat.\n\n**Langue.** Les CGV sont rédigées en français ; c'est le texte français qui fait foi. La version anglaise est une traduction."
        },
        {
          "id": "retractation",
          "number": 13,
          "title": "Formulaire de rétractation",
          "body": "Le plus simple est d'utiliser « Renoncer au contrat ici », dans votre compte. Vous pouvez aussi remplir et nous renvoyer ce formulaire, uniquement si vous souhaitez vous rétracter du contrat.\n\n> À l'attention de [À FOURNIR : dénomination sociale], [À FOURNIR : adresse du siège social], adresse électronique : {{contact-email}} :\n>\n> Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous :\n>\n> - Abonnement à l'offre … / Séance avec le coach … (rayez la mention inutile)\n> - Commandé le … / payé le …\n> - Nom du consommateur : …\n> - Adresse électronique du compte Jobbbox : …\n> - Adresse du consommateur : …\n> - Signature du consommateur (uniquement en cas de notification du présent formulaire sur papier) : …\n> - Date : …"
        }
      ]
    }
  ],
  "en": [
    {
      "text": "cgv",
      "locale": "en",
      "effective": "2027-01-04",
      "title": "Terms of sale",
      "change": "substantielle",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "First version of the terms of sale, with the withdrawal form.",
      "inBrief": [
        "These terms apply to Jobbbox's paid subscriptions and to sessions with a human coach.",
        "A subscription is monthly, with no minimum term: you cancel it at any time, in two clicks, from the My subscription page.",
        "You have 14 days to withdraw, without giving a reason, with « Withdraw from the contract here ».",
        "If we reduce what your plan includes, you are told 30 days ahead and may cancel at no cost.",
        "This summary has no contractual value: only the sections below bind you and us."
      ],
      "sections": [
        {
          "id": "objet",
          "number": 1,
          "title": "Purpose, scope and seller",
          "body": "These general terms of sale (the \"Terms of Sale\") govern sales concluded online on Jobbbox between you, a consumer, and the seller:\n\n- **subscriptions** to Jobbbox's paid plans (the \"plans\");\n- video **sessions** with a human coach (the \"sessions\").\n\nThe seller is [À FOURNIR : dénomination sociale, forme et capital], whose registered office is at [À FOURNIR : adresse du siège social], registered under number [À FOURNIR : RCS ou SIREN], VAT number [À FOURNIR : TVA intracommunautaire], telephone [À FOURNIR : téléphone], email address {{contact-email}} (\"Jobbbox\", \"we\"). Its full details are in the [legal notice](/legal/mentions-legales).\n\nUse of the service, the Free plan included, is governed by our [terms of use](/legal/cgu) (the \"Terms of Use\"), which also apply to you. Where they conflict on a sale, these Terms of Sale prevail."
        },
        {
          "id": "offres",
          "number": 2,
          "title": "The plans",
          "body": "**Free plan and paid plans.** The Free plan involves no payment. The paid plans (currently Standard and Premium) give more than the Free plan, for a monthly price.\n\n**What each plan includes.** Each plan is defined by:\n\n- its **quotas**: the number of profiles you can hold at once and, each week, the number of match scores, ATS scores, job searches and enriched contacts. A quota may be unlimited, or not included in a plan. The week starts on Monday at midnight, Paris time; unused quotas do not carry over;\n- how often you can receive the summary of new offers;\n- its included features, such as a discount on the price of sessions.\n\nThe content and price of each plan are shown in « Plans », on the My subscription page, and recalled on the « Your order » page before any payment. This information forms part of the contract.\n\n**How it works.** Jobbbox can be used in a recent web browser, on a computer, tablet or phone; the extension works with the Google Chrome browser. Some features depend on third-party services (job sites, AI providers), described in the Terms of Use."
        },
        {
          "id": "prix",
          "number": 3,
          "title": "Price and payment",
          "body": "**Price.** Prices are stated in euros, all taxes included. The price that applies is the one shown on the « Your order » page when you order.\n\n**Payment.** Payment is made by bank card, or by another method offered, on the secure page of our payment provider, Stripe. Jobbbox never sees your card number. A subscription is charged at the start of each monthly period; a session is paid once, when ordered. Your invoices are available in « Invoices and payment method », on the My subscription page.\n\n**Promo codes.** A promo code applies to a subscription, under the conditions shown when it is entered (amount or percentage, duration, plans concerned, expiry date). A code that does not apply is refused with its reason. Sessions take no promo code.\n\n**Failed payment.** If a charge fails, our payment provider tries it again, and we ask you, in Jobbbox, to update your payment method; you keep your plan during these new attempts. [À CONFIRMER : ce qui se passe quand toutes les tentatives ont échoué (fin de l'abonnement et passage à l'offre Gratuite ?), selon les réglages de relance du compte Stripe.]\n\n**Change to the price of a subscription in progress.** If we raise the price of a plan, we tell you by email at least one month before the charge concerned. The new price applies only from the period following that notice. You may cancel your subscription at no cost before that date, from the My subscription page."
        },
        {
          "id": "commande",
          "number": 4,
          "title": "Order",
          "body": "**Summary.** Before any payment, the « Your order » page sums up your order: the plan or session chosen (with the coach's name), its price all taxes included and, for a subscription, how often it is charged and its automatic renewal. To correct your choice, go back before paying.\n\n**Acceptance of the Terms of Sale.** There, you accept these Terms of Sale by ticking the box « I accept the terms of sale (version of …) », which is never ticked in advance. The version accepted is identified by its date and remains readable, printable and saveable at its permanent address. The contract remains governed by the version accepted when it was concluded, except for a change made under the conditions set by law and by these Terms of Sale.\n\n**Request for immediate performance.** A second box, optional and never ticked in advance, lets you ask for the service to start immediately; its effects are described in the « Right of withdrawal » section.\n\n**Payment and conclusion.** « Go to payment » takes you to Stripe's payment page, where you confirm your order and your obligation to pay. The contract is concluded when payment is confirmed.\n\n**Confirmation.** We confirm the order by email as soon as payment is received: summary, amount paid, link to the version of the Terms of Sale accepted, your choice of immediate performance and its effects, the withdrawal deadline, where « Withdraw from the contract here » is, and the withdrawal form. Keep this email.\n\n**Proof.** We keep the proof of your acceptance of the Terms of Sale (version, date and time, payment reference, choice of immediate performance) for ten years from the deletion of your account, without your name or email address. You can access it while your account exists, in the download of your data, and ask us for it afterwards at {{contact-email}}.\n\n**Changing plan during a subscription.** If you already have a paid subscription, you change plan in « Manage my subscription », on our payment provider's page. [À CONFIRMER : prise d'effet et calcul au prorata d'un changement d'offre, selon les réglages du portail Stripe.] A change of plan is not a new contract and opens no new withdrawal period."
        },
        {
          "id": "resiliation",
          "number": 5,
          "title": "Term and cancellation of a subscription",
          "body": "**Term.** A subscription is concluded for an indefinite term, with no minimum term. It renews automatically at the end of each monthly period, until it is cancelled.\n\n**Cancellation.** You can cancel it at any time, at no cost and without giving a reason, from your account: on the My subscription page, with the « Cancel your contract » button, then « Confirm the cancellation ».\n\nCancellation takes effect at the end of the current period, already paid. Until then, you keep your plan; no further charge is made, and your account moves to the Free plan. The current period is not refunded, except for a withdrawal within its period or a cancellation at no cost after a reduction of your plan.\n\nWe send you without delay, by email, an acknowledgement of your cancellation, stating the date of your request and the date on which the contract ends. Until that date, you may go back on your cancellation with « Manage my subscription », on the My subscription page.\n\n**Deleting your account.** Deleting your account ends your subscription immediately. [À CONFIRMER : la période en cours est-elle remboursée au prorata ? Position prudente proposée : oui, comme pour une résiliation sans frais.]"
        },
        {
          "id": "evolution",
          "number": 6,
          "title": "Changes to paid plans",
          "body": "**Reasons.** We may change the content of paid plans (quotas, frequency of the offers summary, included features) for one of the following reasons: a change in the cost of our providers' services (job search, artificial intelligence, contact enrichment); a legal or regulatory change; a security requirement; a change to or the end of a third-party service on which the feature depends.\n\n**What increases** what your plan includes applies immediately, at no cost.\n\n**What reduces** what your plan includes (a smaller quota, a limit where there was none, a less frequent summary, a feature removed) is announced to you by email at least 30 days before its effective date, with what changes, the reason and the date. Until that date, your plan stays unchanged; the My subscription page also shows the coming change.\n\n**Your right to cancel at no cost.** You may then cancel your subscription at no cost, at any time before the effective date and up to 30 days after it, from the link in the email or with « Cancel at no cost » on the My subscription page. Cancellation takes effect immediately; we refund you, pro rata, the part of the price paid that covers the remaining period, to the payment method used, within 14 days at the latest.\n\nWe do not use this option to change the price: a price increase follows the « Price and payment » section."
        },
        {
          "id": "seances",
          "number": 7,
          "title": "Sessions with a human coach",
          "body": "**Who sells, who leads.** Jobbbox sells the session and sets its price. It is led by a human coach, a human resources professional selected by Jobbbox, acting as Jobbbox's service provider. Jobbbox remains your sole point of contact for the session, its payment and any complaint.\n\n**How it works.** A session is a video meeting of [À FOURNIR : durée de la séance] about your job search. After payment, you choose a slot on the coach's booking page (the Cal.com service), then enter the date and the video link in Jobbbox; until it has a date, the session waits in « To schedule », in your agenda. [À FOURNIR : délai dans lequel la séance doit être réservée et tenue, le cas échéant.]\n\n**Rescheduling and cancellation.** [À FOURNIR : règles de report et d'annulation par vous et par le coach (délai de prévenance, nombre de reports, absence de l'une des parties), et remboursement hors délai de rétractation. Position prudente proposée : une séance que le coach annule ou ne tient pas est reportée ou remboursée en totalité, à votre choix ; une séance que vous annulez au moins 24 heures à l'avance peut être reportée.]\n\n**Coach who stops working with us.** If the chosen coach stops working with Jobbbox before your session, we offer you another coach or refund the session in full, as you choose.\n\n**Coach access.** The coach sees your profiles and applications only if you give them access, under the Terms of Use."
        },
        {
          "id": "droit-de-retractation",
          "number": 8,
          "title": "Right of withdrawal",
          "body": "**Period.** You may withdraw from a contract, without giving a reason and without bearing costs other than those stated below, within fourteen days from the day after the contract was concluded: for a subscription, the day it was taken out; for a session, the day it was paid. The period ends at the end of the fourteenth day, Paris time; if it ends on a Saturday, a Sunday or a public holiday, it is extended to the end of the next working day.\n\n**How.** You can withdraw from your account, with the « Withdraw from the contract here » function: on the My subscription page for your subscription, and on the session, in your agenda, for a session. There you give your name, the contract concerned and the address where you wish to receive the acknowledgement, then choose « Confirm the withdrawal ». You may also send us, before the end of the period, the [withdrawal form](#retractation) below or any other unambiguous statement, at {{contact-email}} or by post to the seller's address.\n\n**Acknowledgement.** We send you without delay, by email, an acknowledgement of your withdrawal, stating its content, date and time.\n\n**Effects on a subscription.** Your subscription ends immediately, without waiting for the end of the current period, and your account returns to the Free plan.\n\n- **Without a request for immediate performance**, we refund all sums paid.\n- **With a request for immediate performance** (box ticked on the « Your order » page), you owe us an amount proportionate to the service provided until your withdrawal: we refund the sums paid, less the share matching the number of whole days elapsed since the start of the paid period; the day begun is not counted.\n\n**Effects on a session.**\n\n- **Without a request for immediate performance**, a withdrawal within the period is refunded in full, whether or not the session has taken place.\n- **With a request for immediate performance and acknowledgement of the loss of your right** (box ticked on the « Your order » page), you may withdraw as long as the session has not taken place, with a full refund; once the session has been fully performed, you can no longer withdraw.\n\nA session that has not yet taken place is cancelled, and the coach is told.\n\n**Refund.** We refund you within fourteen days at the latest of receiving your withdrawal, using the same payment method as for the order, at no cost to you. A contract you did not pay for, thanks to a promo code, can be withdrawn from in the same way, with nothing to refund.\n\n**Change of plan.** Moving from one plan to another during the same subscription opens no new withdrawal period."
        },
        {
          "id": "garanties",
          "number": 9,
          "title": "Legal guarantees",
          "body": "You benefit from the legal guarantee of conformity of digital content and services (articles L224-25-12 et seq. of the French Consumer Code). Throughout your subscription, we must provide a service in conformity with the contract, and the updates needed to keep it in conformity. If there is a lack of conformity, you may ask for it to be brought into conformity; failing that, or if the defect is serious, you may obtain a price reduction or end the contract with a refund. Report any defect to us at {{contact-email}} or with « Report a problem ».\n\nThese guarantees apply at no cost to you and are in addition to the other rights you hold under the law."
        },
        {
          "id": "responsabilite",
          "number": 10,
          "title": "Liability",
          "body": "We are liable for the proper performance of contracts concluded under these Terms of Sale, including sessions led by a human coach, under the ordinary rules of law. We are not liable for damage due to your fault, to the unforeseeable and insurmountable act of a third party, or to force majeure.\n\nJobbbox, its plans and its sessions support your job search; they guarantee no interview and no hiring.\n\nNothing in these Terms of Sale limits or excludes the rights you hold under the law, in particular your right to compensation if we fail to meet our obligations."
        },
        {
          "id": "donnees",
          "number": 11,
          "title": "Personal data",
          "body": "The data needed for your orders (summary, acceptance of the Terms of Sale, withdrawal, cancellation) are processed as described in our [privacy policy](/legal/confidentialite). Payment data are processed by Stripe; Jobbbox never sees your card number."
        },
        {
          "id": "litiges",
          "number": 12,
          "title": "Complaints, mediation and disputes",
          "body": "**Complaint.** For any complaint, write to us at {{contact-email}} or, when signed in, with « Report a problem ».\n\n**Mediation.** If we have not found a solution, you may, within one year of your written complaint to us, refer the matter free of charge to the consumer mediator we belong to:\n\n- [À FOURNIR : nom du médiateur]\n- [À FOURNIR : adresse postale du médiateur]\n- [À FOURNIR : site internet du médiateur, où le saisir en ligne]\n\nUsing the mediator is optional: you remain free to go to court.\n\n**Applicable law.** These Terms of Sale are governed by French law. If you live in another country of the European Union, you keep the protection of the mandatory rules of your country. Failing agreement, the dispute may be brought before the competent court under the rules of the French Code of Civil Procedure and Consumer Code, in particular the court of the place where you lived when the contract was concluded.\n\n**Language.** The Terms of Sale are written in French; the French text prevails. The English version is a translation."
        },
        {
          "id": "retractation",
          "number": 13,
          "title": "Withdrawal form",
          "body": "The simplest way is to use « Withdraw from the contract here », in your account. You may also fill in and return this form, only if you wish to withdraw from the contract.\n\n> To [À FOURNIR : dénomination sociale], [À FOURNIR : adresse du siège social], email address: {{contact-email}}:\n>\n> I hereby give notice that I withdraw from my contract for the provision of the following service:\n>\n> - Subscription to the … plan / Session with coach … (delete as appropriate)\n> - Ordered on … / paid on …\n> - Name of consumer: …\n> - Email address of the Jobbbox account: …\n> - Address of consumer: …\n> - Signature of consumer (only if this form is notified on paper): …\n> - Date: …"
        }
      ]
    }
  ]
};

export const LEGAL_TEXT_REGISTRY: readonly LegalTextVersionRecord[] = [
  {
    "text": "cgv",
    "version": "2027-01-04",
    "url": "/legal/cgv/2027-01-04",
    "sha256": "d97f63ef98006c3c1db823e03cb0fa75d62da9be0da105c4b2c4e2b7bc4168a7",
    "change": "substantielle"
  }
];
