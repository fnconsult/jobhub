// Written by `npm run build -w @jobhub/help` from legal/<text>/<YYYY-MM-DD>.<locale>.md: edit those, never this file.
import type { LegalTextVersion, LegalTextVersionRecord } from "./legal-texts";
import type { HelpLocale } from "./types";

export const LEGAL_TEXT_VERSIONS: Record<HelpLocale, readonly LegalTextVersion[]> = {
  "fr": [
    {
      "text": "mentions-legales",
      "locale": "fr",
      "effective": "2027-01-04",
      "title": "Mentions légales",
      "change": "mineure",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "Première version des mentions légales.",
      "inBrief": [
        "Jobbbox est édité par [À FOURNIR : dénomination sociale de l'éditeur].",
        "Pour nous écrire : {{contact-email}}.",
        "Le site est hébergé à Paris, sur un serveur de Hostinger International Ltd.",
        "Ce résumé n'a pas de valeur juridique : seules les sections ci-dessous font foi."
      ],
      "sections": [
        {
          "id": "editeur",
          "number": 1,
          "title": "Éditeur",
          "body": "Le site jobbbox.ai, l'application web Jobbbox et l'extension de navigateur Jobbbox sont édités par :\n\n- **Dénomination sociale** : [À FOURNIR : dénomination sociale]\n- **Forme juridique et capital social** : [À FOURNIR : forme juridique, montant du capital social]\n- **Siège social** : [À FOURNIR : adresse du siège social]\n- **Immatriculation** : [À FOURNIR : RCS de (ville) et numéro, ou numéro SIREN]\n- **Numéro de TVA intracommunautaire** : [À FOURNIR : numéro de TVA intracommunautaire]\n- **Téléphone** : [À FOURNIR : numéro de téléphone]\n- **Adresse électronique** : {{contact-email}}"
        },
        {
          "id": "publication",
          "number": 2,
          "title": "Directeur de la publication",
          "body": "[À FOURNIR : prénom et nom], en qualité de [À FOURNIR : fonction de représentant légal]."
        },
        {
          "id": "hebergeur",
          "number": 3,
          "title": "Hébergeur",
          "body": "Le site et l'application sont hébergés par **Hostinger International Ltd**, 61 Lordou Vironos Street, 6023 Larnaca, Chypre. Téléphone : [À FOURNIR : téléphone de l'hébergeur].\n\nLes serveurs qui hébergent l'application et ses données sont situés dans le centre de données de Hostinger à Paris (France)."
        },
        {
          "id": "mediateur",
          "number": 4,
          "title": "Médiateur de la consommation",
          "body": "Si un litige vous oppose à nous et que vous n'avez pas obtenu satisfaction auprès de nous par écrit, vous pouvez saisir gratuitement le médiateur de la consommation dont nous relevons :\n\n- [À FOURNIR : nom du médiateur]\n- [À FOURNIR : adresse postale du médiateur]\n- [À FOURNIR : site internet du médiateur, où le saisir en ligne]\n\nLes conditions de la médiation sont précisées dans nos [conditions générales de vente](/legal/cgv)."
        },
        {
          "id": "propriete-intellectuelle",
          "number": 5,
          "title": "Propriété intellectuelle",
          "body": "Le nom et le logo Jobbbox, la conception et le contenu du site et de l'application (textes, articles d'aide, vidéos, illustrations, mise en page) et leur code sont protégés par le droit de la propriété intellectuelle. Sauf mention contraire, ils appartiennent à l'éditeur. Toute reproduction ou réutilisation, totale ou partielle, sans son autorisation écrite est interdite, sauf dans les limites prévues par la loi, comme la copie privée ou la courte citation.\n\nLes offres d'emploi affichées dans Jobbbox appartiennent à leurs auteurs : Jobbbox les reprend avec un lien vers leur source. Les noms et logos d'autres sociétés sont la propriété de leurs titulaires ; un logo n'est affiché qu'avec l'autorisation écrite de son titulaire."
        },
        {
          "id": "signaler",
          "number": 6,
          "title": "Signaler un contenu",
          "body": "Si vous pensez qu'un contenu affiché par Jobbbox est illicite (une offre d'emploi frauduleuse ou discriminatoire, par exemple), écrivez-nous à {{contact-email}} en indiquant :\n\n- l'adresse exacte de la page ou de l'offre concernée ;\n- pourquoi vous estimez que ce contenu est illicite ;\n- votre nom et votre adresse électronique, sauf si votre signalement porte sur un contenu pédopornographique ou terroriste ;\n- que vous êtes de bonne foi en estimant que les informations de votre signalement sont exactes et complètes.\n\nNous accusons réception de votre signalement, l'examinons avec diligence et vous informons de notre décision et des moyens de la contester. Si vous avez un compte, vous pouvez aussi utiliser « Signaler un problème » dans l'application.\n\nCe point de contact est également celui des autorités. Vous pouvez nous écrire en français ou en anglais."
        },
        {
          "id": "textes",
          "number": 7,
          "title": "Nos autres textes",
          "body": "- [Conditions générales d'utilisation](/legal/cgu)\n- [Conditions générales de vente](/legal/cgv)\n- [Politique de confidentialité](/legal/confidentialite)\n- [Destinataires des données](/legal/destinataires)"
        }
      ]
    }
  ],
  "en": [
    {
      "text": "mentions-legales",
      "locale": "en",
      "effective": "2027-01-04",
      "title": "Legal notice",
      "change": "mineure",
      "approvedBy": "[À SIGNER : product owner]",
      "summary": "First version of the legal notice.",
      "inBrief": [
        "Jobbbox is published by [À FOURNIR : dénomination sociale de l'éditeur].",
        "To write to us: {{contact-email}}.",
        "The site is hosted in Paris, on a server of Hostinger International Ltd.",
        "This summary has no legal value: only the sections below are binding."
      ],
      "sections": [
        {
          "id": "editeur",
          "number": 1,
          "title": "Publisher",
          "body": "The jobbbox.ai site, the Jobbbox web app and the Jobbbox browser extension are published by:\n\n- **Company name**: [À FOURNIR : dénomination sociale]\n- **Legal form and share capital**: [À FOURNIR : forme juridique, montant du capital social]\n- **Registered office**: [À FOURNIR : adresse du siège social]\n- **Registration**: [À FOURNIR : RCS de (ville) et numéro, ou numéro SIREN]\n- **Intra-community VAT number**: [À FOURNIR : numéro de TVA intracommunautaire]\n- **Telephone**: [À FOURNIR : numéro de téléphone]\n- **Email address**: {{contact-email}}"
        },
        {
          "id": "publication",
          "number": 2,
          "title": "Publication director",
          "body": "[À FOURNIR : prénom et nom], as [À FOURNIR : fonction de représentant légal]."
        },
        {
          "id": "hebergeur",
          "number": 3,
          "title": "Host",
          "body": "The site and the app are hosted by **Hostinger International Ltd**, 61 Lordou Vironos Street, 6023 Larnaca, Cyprus. Telephone: [À FOURNIR : téléphone de l'hébergeur].\n\nThe servers that host the app and its data are in Hostinger's data centre in Paris (France)."
        },
        {
          "id": "mediateur",
          "number": 4,
          "title": "Consumer mediator",
          "body": "If you are in a dispute with us and have not obtained satisfaction from us in writing, you may refer it, free of charge, to the consumer mediator we belong to:\n\n- [À FOURNIR : nom du médiateur]\n- [À FOURNIR : adresse postale du médiateur]\n- [À FOURNIR : site internet du médiateur, où le saisir en ligne]\n\nThe terms of mediation are set out in our [terms of sale](/legal/cgv)."
        },
        {
          "id": "propriete-intellectuelle",
          "number": 5,
          "title": "Intellectual property",
          "body": "The Jobbbox name and logo, the design and content of the site and the app (texts, help articles, videos, illustrations, layout) and their code are protected by intellectual property law. Unless stated otherwise, they belong to the publisher. Any reproduction or reuse, in whole or in part, without its written permission is prohibited, except within the limits allowed by law, such as private copying or short quotation.\n\nThe job offers shown in Jobbbox belong to their authors: Jobbbox shows them with a link to their source. The names and logos of other companies belong to their owners; a logo is shown only with its owner's written permission."
        },
        {
          "id": "signaler",
          "number": 6,
          "title": "Report content",
          "body": "If you believe that content shown by Jobbbox is illegal (a fraudulent or discriminatory job offer, for example), write to us at {{contact-email}}, stating:\n\n- the exact address of the page or offer concerned;\n- why you consider this content illegal;\n- your name and email address, unless your report concerns child sexual abuse or terrorist content;\n- that you believe in good faith that the information in your report is accurate and complete.\n\nWe acknowledge receipt of your report, examine it diligently and inform you of our decision and of how to challenge it. If you have an account, you can also use « Report a problem » in the app.\n\nThis point of contact is also the one for authorities. You may write to us in French or in English."
        },
        {
          "id": "textes",
          "number": 7,
          "title": "Our other texts",
          "body": "- [Terms of use](/legal/cgu)\n- [Terms of sale](/legal/cgv)\n- [Privacy policy](/legal/confidentialite)\n- [Data recipients](/legal/destinataires)"
        }
      ]
    }
  ]
};

export const LEGAL_TEXT_REGISTRY: readonly LegalTextVersionRecord[] = [
  {
    "text": "mentions-legales",
    "version": "2027-01-04",
    "url": "/legal/mentions-legales/2027-01-04",
    "sha256": "a02651a1e28b420084e5c2c8c61479c57efb997f567460e35bdc0e27d3b30e82",
    "change": "mineure"
  }
];
