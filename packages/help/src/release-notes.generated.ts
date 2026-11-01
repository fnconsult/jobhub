// Written by `npm run build -w @jobhub/help` from releases/<locale>/X.Y.Z.md: edit those, never this file.
import type { ReleaseNote } from "./release-notes";
import type { HelpLocale } from "./types";

export const RELEASE_NOTES: Record<HelpLocale, readonly ReleaseNote[]> = {
  "fr": [
    {
      "version": "0.1.0",
      "locale": "fr",
      "date": "2026-10-30",
      "title": "Jobbbox, la première version",
      "tags": [
        "candidature",
        "extension",
        "coach-ia",
        "confidentialite",
        "accessibilite"
      ],
      "image": null,
      "announce": false,
      "intro": "Jobbbox vous accompagne dans votre recherche d'emploi, de votre CV jusqu'à l'entretien. Voici, en quelques lignes, tout ce que vous pouvez déjà y faire. Pour le détail d'une page, ouvrez « Aide et coach » en haut de l'écran.",
      "changes": [
        {
          "kind": "new",
          "text": "**Une connexion sans mot de passe** : recevez un lien de connexion par e-mail ou, quand la page le propose, utilisez votre compte Google, Apple ou Microsoft."
        },
        {
          "kind": "new",
          "text": "**Vos profils** : un profil, c'est un métier que vous visez. Déposez votre CV (PDF ou Word) ou répondez aux questions de votre coach, puis vérifiez tout avant d'enregistrer. Selon votre offre, vous pouvez avoir plusieurs profils."
        },
        {
          "kind": "new",
          "text": "**Votre CV de référence** : modifiez-le, revenez à une version précédente et téléchargez-le en PDF ou en Word. L'ATS Score vous dit si les logiciels de recrutement le liront bien ; acceptez ou ignorez une par une les corrections que propose votre coach."
        },
        {
          "kind": "new",
          "text": "**Vos critères de recherche** : le métier, les lieux, les secteurs, le contrat, le télétravail et le salaire que vous visez, et les entreprises qui vous intéressent, dans « Entreprises cibles »."
        },
        {
          "kind": "new",
          "text": "**Des recherches d'offres** : votre coach cherche des offres selon les critères d'un profil, sur des sites d'emploi, dont France Travail, et sur des sites carrières d'employeurs. Suivez la recherche pendant qu'elle avance, et arrêtez-la si vous le souhaitez."
        },
        {
          "kind": "new",
          "text": "**Un score de correspondance pour chaque offre** : il dit à quel point l'offre vous correspond, critère par critère (compétences, expérience, lieu, salaire, contrat)."
        },
        {
          "kind": "new",
          "text": "**Les Job Digests** : recevez par e-mail, chaque semaine ou chaque jour, les nouvelles offres qui correspondent à un profil, selon votre offre."
        },
        {
          "kind": "new",
          "text": "**La réception par email** : transférez à votre adresse de transfert vos alertes d'offres et les messages de recruteurs ; Jobbbox en tire les offres, que vous retrouvez dans « Reçues par email ». « Configurer le transfert pas à pas » vous guide pour Gmail, Outlook.com et iCloud."
        },
        {
          "kind": "new",
          "text": "**Le suivi de vos candidatures** : chaque offre enregistrée devient une candidature, que vous suivez en liste ou en tableau, de « À postuler » à « Acceptée »."
        },
        {
          "kind": "new",
          "text": "**Vos documents de candidature** : votre coach prépare un CV adapté à l'offre et une lettre de motivation, sans rien ajouter que votre CV ne dise. Vous vérifiez chaque changement avant d'enregistrer, puis vous les téléchargez en PDF ou en Word."
        },
        {
          "kind": "new",
          "text": "**Les relances** : quand une candidature reste sans réponse, votre coach vous propose un e-mail de relance. Jobbbox n'envoie rien à votre place : vous l'envoyez depuis votre messagerie."
        },
        {
          "kind": "new",
          "text": "**Le dossier entreprise** : ce qu'il faut savoir de l'employeur, tiré de sources publiques, et, selon votre offre, des contacts à qui écrire."
        },
        {
          "kind": "new",
          "text": "**Vos entretiens et rendez-vous** : notez vos entretiens et vos séances avec un coach, voyez-les en liste, par semaine ou par mois, ajoutez-les à votre calendrier, et recevez un e-mail de rappel la veille."
        },
        {
          "kind": "new",
          "text": "**L'extension Chrome** : sur la page d'une offre, « Analyser cette offre » calcule son score de correspondance avec votre CV et l'enregistre dans vos candidatures. Sans compte, votre CV et l'offre restent dans votre navigateur et sont effacés en moins de 24 heures ; en créant votre compte, vous les gardez."
        },
        {
          "kind": "new",
          "text": "**Votre coach IA** : dans « Aide et coach », posez-lui vos questions à tout moment ; lui parler ne compte dans aucun quota. Il dit toujours qu'il est une IA. Vos conversations sont gardées, et la « Mémoire du coach » ne retient que ce que vous confirmez."
        },
        {
          "kind": "new",
          "text": "**Activité IA** : ce bouton, en haut de la page, montre ce que l'IA a fait pour vous : ses étapes, les sites lus et le modèle utilisé."
        },
        {
          "kind": "new",
          "text": "**Des coachs humains** : réservez une séance en visio avec un professionnel RH sélectionné par Jobbbox. Avec votre accord, que vous retirez quand vous voulez, il lit vos profils et vos candidatures et commente vos documents, sans pouvoir rien modifier."
        },
        {
          "kind": "new",
          "text": "**Votre abonnement** : une offre gratuite et des offres payantes, réglées sur la page sécurisée de Stripe, où vous changez d'offre, résiliez et retrouvez vos factures. Les codes promo sont acceptés. La barre en bas du menu montre votre utilisation de la semaine, renouvelée chaque lundi."
        },
        {
          "kind": "new",
          "text": "**Vos données** : dans Mon compte, rubrique Mes données, téléchargez toutes vos données ou supprimez votre compte. Rubrique IA européenne, vous pouvez demander que ce qui contient vos données d'identité soit traité par Mistral AI, une IA européenne."
        },
        {
          "kind": "new",
          "text": "**Un texte à votre taille** : dans Mon compte, rubrique Préférences, la réglette « Taille du texte » a quatre crans, de Petit à Grand. Les boutons sont assez grands pour le doigt, et les pages se lisent au clavier comme avec un lecteur d'écran. L'interface existe en français et en anglais."
        },
        {
          "kind": "new",
          "text": "**De l'aide, et une équipe qui vous lit** : des articles d'aide écrits par l'équipe, sans IA, dans « Aide et coach ». « Signaler un problème » et « Proposer une idée » écrivent à l'équipe ; vous suivez ses réponses dans Mon compte, rubrique Mes signalements."
        }
      ]
    }
  ],
  "en": [
    {
      "version": "0.1.0",
      "locale": "en",
      "date": "2026-10-30",
      "title": "Jobbbox, the first version",
      "tags": [
        "candidature",
        "extension",
        "coach-ia",
        "confidentialite",
        "accessibilite"
      ],
      "image": null,
      "announce": false,
      "intro": "Jobbbox helps you with your job search, from your CV to the interview. Here, in a few lines, is everything you can already do with it. For the details of a page, open « Help and coach » at the top of the screen.",
      "changes": [
        {
          "kind": "new",
          "text": "**Sign in without a password**: get a sign-in link by email or, when the page offers it, use your Google, Apple or Microsoft account."
        },
        {
          "kind": "new",
          "text": "**Your profiles**: a profile is a job you are aiming for. Upload your CV (PDF or Word) or answer your coach's questions, then check everything before you save. Depending on your plan, you can have several profiles."
        },
        {
          "kind": "new",
          "text": "**Your Master CV**: edit it, go back to an earlier version, and download it as PDF or Word. The ATS Score tells you whether recruitment software will read it well; accept or ignore, one by one, the fixes your coach suggests."
        },
        {
          "kind": "new",
          "text": "**Your search criteria**: the job, places, sectors, contract, remote work and salary you are looking for, and the companies you care about, in « Target companies »."
        },
        {
          "kind": "new",
          "text": "**Job searches**: your coach looks for job offers that match a profile's criteria, on job sites, France Travail among them, and on employers' career sites. Follow the search as it goes, and stop it if you wish."
        },
        {
          "kind": "new",
          "text": "**A Match Score for every offer**: it tells you how well the offer suits you, criterion by criterion (skills, experience, place, salary, contract)."
        },
        {
          "kind": "new",
          "text": "**Job Digests**: get the new offers that match a profile by email, every week or every day, depending on your plan."
        },
        {
          "kind": "new",
          "text": "**Email intake**: forward your job alerts and recruiters' messages to your forwarding address; Jobbbox picks out the offers, which you find under « Received by email ». « Set up forwarding step by step » guides you through Gmail, Outlook.com and iCloud."
        },
        {
          "kind": "new",
          "text": "**Following your applications**: every offer you save becomes an application, which you follow as a list or a board, from « To apply » to « Accepted »."
        },
        {
          "kind": "new",
          "text": "**Your application documents**: your coach drafts a CV tailored to the offer and a cover letter, adding nothing your CV does not say. You check every change before you save, then download them as PDF or Word."
        },
        {
          "kind": "new",
          "text": "**Follow-ups**: when an application gets no answer, your coach suggests a follow-up email. Jobbbox never sends anything for you: you send it from your own mailbox."
        },
        {
          "kind": "new",
          "text": "**The company dossier**: what to know about the employer, from public sources, and, depending on your plan, contacts to write to."
        },
        {
          "kind": "new",
          "text": "**Your interviews and appointments**: note your interviews and your sessions with a coach, see them as a list, by week or by month, add them to your calendar, and get a reminder email the day before."
        },
        {
          "kind": "new",
          "text": "**The Chrome extension**: on a job offer's page, « Analyse this offer » works out its Match Score against your CV and saves it to your applications. Without an account, your CV and the offer stay in your browser and are erased within 24 hours; create your account to keep them."
        },
        {
          "kind": "new",
          "text": "**Your AI Coach**: in « Help and coach », ask it anything, at any time; talking to it never counts against a quota. It always says it is an AI. Your conversations are kept, and « Coach memory » only holds what you confirm."
        },
        {
          "kind": "new",
          "text": "**AI activity**: this button, at the top of the page, shows what the AI did for you: its steps, the sites it read and the model it used."
        },
        {
          "kind": "new",
          "text": "**Human coaches**: book a video session with an HR professional chosen by Jobbbox. With your consent, which you can withdraw at any time, they read your profiles and applications and comment on your documents, without being able to change anything."
        },
        {
          "kind": "new",
          "text": "**Your subscription**: a free plan and paid plans, paid on Stripe's secure page, where you change plan, cancel and find your invoices. Promotion codes are accepted. The bar at the bottom of the menu shows how much you have used this week; it renews every Monday."
        },
        {
          "kind": "new",
          "text": "**Your data**: in My account, under My data, download all your data or delete your account. Under European AI, you can ask that whatever holds your identity details be processed by Mistral AI, a European AI."
        },
        {
          "kind": "new",
          "text": "**Text at your size**: in My account, under Preferences, the « Text size » slider has four steps, from Small to Large. Buttons are big enough for a finger, and pages can be read with a keyboard or a screen reader. The interface is in French and in English."
        },
        {
          "kind": "new",
          "text": "**Help, and a team that reads you**: help articles written by the team, without AI, in « Help and coach ». « Report a problem » and « Suggest an idea » write to the team; follow its replies in My account, under My feedback."
        }
      ]
    }
  ]
};
