// Written by `npm run build -w @jobhub/help` from motions/<locale>/<id>.md: edit those, never this file.
import type { MotionScript } from "./motion-scripts";
import type { HelpLocale } from "./types";

export const MOTION_SCRIPTS: Record<HelpLocale, readonly MotionScript[]> = {
  "fr": [
    {
      "id": "commencer",
      "locale": "fr",
      "title": "Commencer : de l'inscription à votre premier profil",
      "viewer": "visitor",
      "routes": [
        "/",
        "/connexion",
        "/compte",
        "/profils/nouveau",
        "/profils/[id]"
      ],
      "steps": [
        {
          "title": "Se connecter",
          "actions": [
            {
              "action": "goto",
              "path": "/"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Se connecter"
              }
            }
          ],
          "narration": "Cliquez sur « Se connecter », en haut de chaque page publique."
        },
        {
          "title": "Recevoir votre lien de connexion",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Votre adresse e-mail"
              },
              "text": "claire.nouvelle@motions.jobbbox.test"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Recevoir mon lien de connexion"
              }
            }
          ],
          "narration": "Saisissez « Votre adresse e-mail », puis cliquez sur « Recevoir mon lien de connexion »."
        },
        {
          "title": "Ouvrir l'e-mail",
          "actions": [
            {
              "action": "open-email",
              "subject": "Votre lien de connexion à Jobbbox"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Me connecter à Jobbbox"
              }
            }
          ],
          "narration": "Ouvrez l'e-mail « Votre lien de connexion à Jobbbox » et cliquez sur « Me connecter à Jobbbox », dans les 15 minutes. Votre compte est créé, avec l'offre Gratuit. Si Jobbbox vous demande d'accepter les CGU, lisez-les, cochez la case puis cliquez sur « Accepter et continuer »."
        },
        {
          "title": "Créer votre premier profil",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Créer mon premier profil"
              }
            }
          ],
          "narration": "Dans Mon compte, rubrique Profils, cliquez sur « Créer mon premier profil ». Votre coach vous accueille dans la conversation."
        },
        {
          "title": "Déposer votre CV",
          "actions": [
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Votre CV"
              },
              "file": "cv-claire-demo.pdf"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Lire mon CV"
              }
            }
          ],
          "narration": "Déposez votre CV dans la carte « J'ai un CV », en PDF ou en Word, puis cliquez sur « Lire mon CV ». Sans CV, cliquez plutôt sur « Répondre aux questions de mon coach »."
        },
        {
          "title": "Confirmer ce que votre coach a lu",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Votre réponse"
              },
              "text": "Responsable comptable"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Envoyer au coach"
              }
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Votre réponse"
              },
              "text": "Lyon"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Envoyer au coach"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Passer cette question"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Passer cette question"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Passer cette question"
              }
            }
          ],
          "narration": "Pendant la lecture, la carte « Profil en construction » montre ce que votre coach trouve dans votre CV, puis se replie. Il vous fait confirmer le poste visé et le lieu qu'il a lus : cliquez sur « Oui, … », ou écrivez le vôtre. Il ne vous demande ensuite que ce qu'un CV ne dit pas, le type de contrat, le télétravail et le salaire minimum, et chaque question se passe avec « Passer cette question »."
        },
        {
          "title": "Lire le résumé",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Votre recherche d'offres"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Voir le détail"
              }
            }
          ],
          "narration": "Votre coach résume ce qu'il a compris dans la carte « Votre recherche d'offres ». Cliquez sur « Voir le détail » pour vérifier votre CV et vos critères de recherche."
        },
        {
          "title": "Vérifier le détail",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "complementary",
                "name": "Vérifiez votre CV et vos critères de recherche"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "checkbox",
                "name": "CDI"
              }
            }
          ],
          "narration": "Dans le volet qui s'ouvre à côté de la conversation, vérifiez votre CV et vos critères de recherche, comme le « Poste recherché » et le « Lieu ». Corrigez ce qui doit l'être, ici le type de contrat : le résumé se met à jour."
        },
        {
          "title": "Votre profil est prêt",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Cela semble correct"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Continuer vers mon profil"
              }
            }
          ],
          "narration": "Si le résumé est juste, cliquez sur « Cela semble correct ». Vos premières offres s'affichent dans « Activité », à la fin de la recherche offerte que votre coach a lancée : « Dans l'activité » vous y mène. Sans attendre, cliquez sur « Continuer vers mon profil » : votre premier profil est prêt."
        }
      ],
      "hash": "c90d9b29d963"
    },
    {
      "id": "extension-analyser-offre",
      "locale": "fr",
      "title": "Analyser une offre avec l'extension, sans compte",
      "viewer": "guest",
      "routes": [],
      "steps": [
        {
          "title": "Ouvrir une offre",
          "actions": [
            {
              "action": "goto",
              "page": "@offre-de-demo"
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            }
          ],
          "narration": "Sans compte, l'extension Jobbbox compare votre CV à une offre d'emploi et calcule son Match Score. Ouvrez la page d'une offre d'emploi, puis cliquez sur « Analyser cette offre », le bouton que l'extension ajoute à la page."
        },
        {
          "title": "Le panneau de l'extension",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            },
            {
              "action": "goto",
              "page": "@panneau-extension"
            }
          ],
          "narration": "Le panneau de l'extension s'ouvre à droite et montre l'offre capturée. Si le bouton n'apparaît pas sur la page, ouvrez l'extension Jobbbox depuis la barre de votre navigateur."
        },
        {
          "title": "Déposer votre CV",
          "actions": [
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Votre CV"
              },
              "file": "cv-claire-demo.pdf"
            }
          ],
          "narration": "Glissez votre CV dans « Glissez votre CV ici », ou cliquez sur « Choisir un fichier » pour le choisir."
        },
        {
          "title": "Calculer le Match Score",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Calculer mon Match Score"
              }
            }
          ],
          "narration": "Cliquez sur « Calculer mon Match Score », en bas du panneau."
        },
        {
          "title": "Lire le détail",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "heading",
                "name": "Détail du Match Score"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "text",
                "text": "Absentes de votre CV : Power BI"
              }
            }
          ],
          "narration": "Le score s'affiche sur 100, avec le « Détail du Match Score » : pour chaque critère, ce qui correspond et ce qui ne correspond pas."
        },
        {
          "title": "Un autre CV, ou tout effacer",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Utiliser un autre CV"
              }
            },
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Effacer mes données maintenant"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Effacer mes données maintenant"
              }
            }
          ],
          "narration": "Pour comparer un autre CV, cliquez sur « Utiliser un autre CV ». Pour tout effacer, cliquez sur « Effacer mes données maintenant »."
        }
      ],
      "hash": "ab3a9d0d8c6c"
    },
    {
      "id": "extension-creer-compte",
      "locale": "fr",
      "title": "Créer son compte depuis l'extension et garder son travail",
      "viewer": "guest",
      "routes": [
        "/connexion",
        "/compte",
        "/candidatures/[id]"
      ],
      "steps": [
        {
          "title": "Votre Match Score, sans compte",
          "actions": [
            {
              "action": "goto",
              "page": "@offre-de-demo"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            },
            {
              "action": "goto",
              "page": "@panneau-extension"
            },
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Votre CV"
              },
              "file": "cv-claire-demo.pdf"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Calculer mon Match Score"
              }
            }
          ],
          "narration": "Sans compte, votre CV et l'offre sont effacés au plus tard 24 heures après votre première analyse, ou dès que vous fermez votre navigateur. En créant votre compte, vous les gardez."
        },
        {
          "title": "Créer votre compte",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Créer mon compte et garder cette offre"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Créer mon compte et garder cette offre"
              }
            }
          ],
          "narration": "Dans le panneau de l'extension, une fois votre Match Score calculé, cliquez sur « Créer mon compte et garder cette offre ». Jobbbox s'ouvre dans un nouvel onglet."
        },
        {
          "title": "Votre adresse e-mail",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Votre adresse e-mail"
              },
              "text": "claire.invitee@motions.jobbbox.test"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Recevoir mon lien de connexion"
              }
            }
          ],
          "narration": "Saisissez « Votre adresse e-mail », puis cliquez sur « Recevoir mon lien de connexion »."
        },
        {
          "title": "Ouvrir l'e-mail",
          "actions": [
            {
              "action": "open-email",
              "subject": "Votre lien de connexion à Jobbbox"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Me connecter à Jobbbox"
              }
            }
          ],
          "narration": "Ouvrez l'e-mail « Votre lien de connexion à Jobbbox » et cliquez sur « Me connecter à Jobbbox », dans les 15 minutes : votre compte est créé, sans mot de passe. Si Jobbbox vous demande d'accepter les CGU, lisez-les, cochez la case puis cliquez sur « Accepter et continuer »."
        },
        {
          "title": "Revenir à l'offre",
          "actions": [
            {
              "action": "goto",
              "page": "@panneau-extension"
            }
          ],
          "narration": "Revenez à l'onglet de l'offre : le panneau de l'extension se met à jour tout seul. Votre CV est devenu votre profil, et l'offre est enregistrée dans vos candidatures, au statut « À postuler »."
        },
        {
          "title": "Voir votre candidature",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Voir ma candidature"
              }
            }
          ],
          "narration": "Cliquez sur « Voir ma candidature » pour l'ouvrir dans Jobbbox."
        }
      ],
      "hash": "9238bc2a9dd6"
    },
    {
      "id": "postuler-cv-adapte",
      "locale": "fr",
      "title": "Postuler avec un CV adapté",
      "viewer": "candidate",
      "routes": [
        "/candidatures",
        "/candidatures/[id]",
        "/candidatures/[id]/documents"
      ],
      "steps": [
        {
          "title": "Ouvrir la candidature",
          "actions": [
            {
              "action": "goto",
              "path": "/candidatures"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Atelier Dumas · Responsable comptable"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Documents"
              }
            }
          ],
          "narration": "Ouvrez la candidature « Responsable comptable », puis sa rubrique « Documents »."
        },
        {
          "title": "Proposer un CV adapté",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Proposer un CV adapté"
              }
            },
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "complementary",
                "name": "Documents"
              }
            }
          ],
          "narration": "Cliquez sur « Proposer un CV adapté ». « Proposition prête : vérifiez les changements avant d'enregistrer. » s'affiche, avec le score de correspondance avant et après."
        },
        {
          "title": "Répondre aux questions du coach",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Non"
              }
            }
          ],
          "narration": "Sous « Questions du coach », l'offre demande ce que votre CV ne montre pas. Répondez « Oui, je l'ai » ou « Non ». Ici, « Non » : rien n'est ajouté."
        },
        {
          "title": "Accepter ou refuser chaque changement",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Enregistrer le CV adapté"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Refuser"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Enregistrer le CV adapté"
              }
            }
          ],
          "narration": "Sous « Changements par rapport au CV de référence », cliquez sur « Accepter » ou « Refuser » pour chaque changement. Un changement refusé garde ce que dit votre CV de référence. Cliquez ensuite sur « Enregistrer le CV adapté »."
        },
        {
          "title": "Télécharger le CV adapté",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Télécharger en PDF"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "radio",
                "name": "Moderne"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Télécharger en PDF"
              }
            }
          ],
          "narration": "Sous « Télécharger ce CV adapté », choisissez un modèle de CV, ici « Moderne », puis « Télécharger en PDF » ou « Télécharger en Word (.docx) »."
        },
        {
          "title": "Postuler, puis changer le statut",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Fiche"
              }
            },
            {
              "action": "select",
              "target": {
                "by": "role",
                "role": "combobox",
                "name": "Statut"
              },
              "option": "Postulée"
            }
          ],
          "narration": "Envoyez votre candidature vous-même, sur le site de l'offre ou par e-mail : Jobbbox n'envoie rien à votre place. Puis, dans la fiche de la candidature, mettez le « Statut » à « Postulée »."
        }
      ],
      "hash": "2d2d64be47fa"
    },
    {
      "id": "reserver-seance-coach",
      "locale": "fr",
      "title": "Réserver et payer une séance avec un coach humain",
      "viewer": "candidate",
      "routes": [
        "/coachs",
        "/coachs/commande"
      ],
      "steps": [
        {
          "title": "Choisir un coach",
          "actions": [
            {
              "action": "goto",
              "path": "/coachs"
            },
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Choisir un coach"
              }
            },
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Choisir un coach"
              }
            }
          ],
          "narration": "Dans le menu, ouvrez « Mes coachs humains ». Sous « Choisir un coach », chaque coach se présente."
        },
        {
          "title": "Votre commande",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Réserver une séance avec Sophie Démo"
              }
            }
          ],
          "narration": "Cliquez sur « Réserver une séance avec … » pour le coach de votre choix. Sur la page « Votre commande », vérifiez le récapitulatif, puis cochez « J'accepte les CGV » quand la case s'affiche."
        },
        {
          "title": "Payer",
          "actions": [
            {
              "action": "pay",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Passer au paiement"
              }
            }
          ],
          "narration": "Cliquez sur « Passer au paiement », puis payez sur la page sécurisée de Stripe, notre prestataire de paiement, que cette vidéo ne montre pas. De retour dans Jobbbox, « Paiement reçu. Choisissez maintenant le créneau de votre séance. » s'affiche."
        },
        {
          "title": "Choisir votre créneau",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Choisir mon créneau avec Sophie Démo sur Cal.com"
              }
            }
          ],
          "narration": "Cliquez sur « Choisir mon créneau avec … sur Cal.com » et réservez votre créneau."
        },
        {
          "title": "Saisir la date",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "J'ai réservé : saisir la date de la séance avec Sophie Démo"
              }
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Date et heure de la séance (heure de Paris)"
              },
              "text": "2027-03-16T10:00"
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Lien de la visio (facultatif)"
              },
              "text": "https://visio.exemple.invalid/seance-demo"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Enregistrer"
              }
            }
          ],
          "narration": "Revenez dans Jobbbox et cliquez sur « J'ai réservé : saisir la date ». Saisissez la « Date et heure de la séance (heure de Paris) » et, si vous l'avez, le « Lien de la visio (facultatif) », puis cliquez sur « Enregistrer »."
        },
        {
          "title": "Rejoindre la visio",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Rejoindre la visio avec Sophie Démo"
              }
            }
          ],
          "narration": "La séance rejoint votre agenda. Le jour venu, cliquez sur « Rejoindre la visio avec … », dans « Mes coachs humains », sous « Mes séances payées »."
        }
      ],
      "hash": "01f582ffed44"
    },
    {
      "id": "transferer-offres-email",
      "locale": "fr",
      "title": "Transférer vos offres reçues par e-mail",
      "viewer": "candidate",
      "routes": [
        "/compte/reception-email",
        "/compte/reception-email/assistant",
        "/recherches"
      ],
      "steps": [
        {
          "title": "Réception par email",
          "actions": [
            {
              "action": "goto",
              "path": "/compte/reception-email"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Configurer le transfert pas à pas"
              }
            }
          ],
          "narration": "Dans Mon compte, ouvrez la rubrique « Réception par email », puis cliquez sur « Configurer le transfert pas à pas »."
        },
        {
          "title": "Votre messagerie",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "radio",
                "name": "Gmail"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continuer"
              }
            }
          ],
          "narration": "À la question « Quelle messagerie reçoit vos alertes d'offres ? », choisissez la vôtre, ici Gmail, puis cliquez sur « Continuer »."
        },
        {
          "title": "Activer la réception",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "main",
                "name": null
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Activer et continuer"
              }
            }
          ],
          "narration": "Lisez ce qui est lu et ce qui est gardé, puis cliquez sur « Activer et continuer ». La date d'activation est enregistrée."
        },
        {
          "title": "Votre adresse de transfert",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Copier l'adresse"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continuer"
              }
            }
          ],
          "narration": "Cliquez sur « Copier l'adresse » : c'est votre adresse de transfert, à vous seul."
        },
        {
          "title": "Dans Gmail",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continuer"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continuer"
              }
            }
          ],
          "narration": "Avec Gmail, sur un ordinateur, ajoutez cette adresse de transfert dans les paramètres de Gmail, comme le guide l'indique. Jobbbox vous montre le code de confirmation de Gmail. Créez ensuite le filtre Gmail qui transfère seulement vos alertes, jamais tout votre courrier."
        },
        {
          "title": "Le premier email",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continuer"
              }
            }
          ],
          "narration": "Attendez votre prochaine alerte, ou transférez-en une à la main : « Premier email reçu le … » confirme que le transfert marche."
        },
        {
          "title": "Vos offres reçues par email",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "goto",
              "path": "/recherches"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Reçues par email"
              }
            }
          ],
          "narration": "Ouvrez la page Recherches d'offres : les offres de vos emails arrivent dans « Offres à traiter », avec la puce « Email ». Au pied de la boîte, « Reçues par email » les range sous le profil qui leur correspond le mieux, ou dans « Non classées » quand aucun profil n'atteint 60."
        }
      ],
      "hash": "86bf42d108dc"
    }
  ],
  "en": [
    {
      "id": "commencer",
      "locale": "en",
      "title": "Getting started: from signing up to your first profile",
      "viewer": "visitor",
      "routes": [
        "/",
        "/connexion",
        "/compte",
        "/profils/nouveau",
        "/profils/[id]"
      ],
      "steps": [
        {
          "title": "Sign in",
          "actions": [
            {
              "action": "goto",
              "path": "/en"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Sign in"
              }
            }
          ],
          "narration": "Click « Sign in », at the top of every public page."
        },
        {
          "title": "Get your sign-in link",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Your email address"
              },
              "text": "claire.new@motions.jobbbox.test"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Send me a sign-in link"
              }
            }
          ],
          "narration": "Enter « Your email address », then click « Send me a sign-in link »."
        },
        {
          "title": "Open the email",
          "actions": [
            {
              "action": "open-email",
              "subject": "Your Jobbbox sign-in link"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Sign in to Jobbbox"
              }
            }
          ],
          "narration": "Open the email « Your Jobbbox sign-in link » and click « Sign in to Jobbbox », within 15 minutes. Your account is created, on the Free Plan. If Jobbbox asks you to accept the Terms of use, read them, tick the box then click « Accept and continue »."
        },
        {
          "title": "Create your first profile",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Create my first profile"
              }
            }
          ],
          "narration": "In My account, under Profiles, click « Create my first profile ». Your coach welcomes you in the conversation."
        },
        {
          "title": "Drop your CV",
          "actions": [
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Your CV"
              },
              "file": "cv-claire-demo.pdf"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Read my CV"
              }
            }
          ],
          "narration": "Drop your CV in the « I have a CV » card, as a PDF or a Word file, then click « Read my CV ». Without a CV, click « Answer my coach's questions » instead."
        },
        {
          "title": "Confirm what your coach read",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Your answer"
              },
              "text": "Responsable comptable"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Send to the coach"
              }
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Your answer"
              },
              "text": "Lyon"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Send to the coach"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Skip this question"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Skip this question"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Skip this question"
              }
            }
          ],
          "narration": "While it reads, the « Profile in progress » card shows what your coach finds in your CV, then folds. It has you confirm the target role and the place it read: click « Yes, … », or write your own. It then asks only what a CV does not say, the contract type, remote work and the minimum salary, and each question can be skipped with « Skip this question »."
        },
        {
          "title": "Read the summary",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Your job search"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "See the details"
              }
            }
          ],
          "narration": "Your coach sums up what it understood in the « Your job search » card. Click « See the details » to check your CV and search criteria."
        },
        {
          "title": "Check the details",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "complementary",
                "name": "Check your CV and your search criteria"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "checkbox",
                "name": "Permanent (CDI)"
              }
            }
          ],
          "narration": "In the pane that opens beside the conversation, check your CV and search criteria, such as the « Target role » and the « Location ». Correct what needs it, here the contract type: the summary updates."
        },
        {
          "title": "Your profile is ready",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "That looks right"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Continue to my profile"
              }
            }
          ],
          "narration": "If the summary is right, click « That looks right ». Your first job offers show in « Activity », at the end of the search on us your coach started: « In Activity » takes you there. Without waiting, click « Continue to my profile »: your first profile is ready."
        }
      ],
      "hash": "968686eb2e6e"
    },
    {
      "id": "extension-analyser-offre",
      "locale": "en",
      "title": "Analyse a job offer with the extension, without an account",
      "viewer": "guest",
      "routes": [],
      "steps": [
        {
          "title": "Open a job offer",
          "actions": [
            {
              "action": "goto",
              "page": "@offre-de-demo"
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            }
          ],
          "narration": "Without an account, the Jobbbox extension compares your CV with a job offer and computes its Match Score. Open a job offer's page, then click « Analyse this offer », the button the extension adds to the page."
        },
        {
          "title": "The extension's panel",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            },
            {
              "action": "goto",
              "page": "@panneau-extension"
            }
          ],
          "narration": "The extension's panel opens on the right and shows the captured job offer. If the button does not show on the page, open the Jobbbox extension from your browser's toolbar."
        },
        {
          "title": "Drop your CV",
          "actions": [
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Votre CV"
              },
              "file": "cv-claire-demo.pdf"
            }
          ],
          "narration": "Drag your CV onto « Drop your CV here », or click « Choose a file » to pick it."
        },
        {
          "title": "Compute the Match Score",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Calculer mon Match Score"
              }
            }
          ],
          "narration": "Click « Compute my Match Score », at the bottom of the panel."
        },
        {
          "title": "Read the breakdown",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "heading",
                "name": "Détail du Match Score"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "text",
                "text": "Absentes de votre CV : Power BI"
              }
            }
          ],
          "narration": "The score shows out of 100, with the « Match Score breakdown »: for each criterion, what matches and what does not."
        },
        {
          "title": "Another CV, or delete everything",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Utiliser un autre CV"
              }
            },
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Effacer mes données maintenant"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Effacer mes données maintenant"
              }
            }
          ],
          "narration": "To compare another CV, click « Use another CV ». To delete everything, click « Delete my data now »."
        }
      ],
      "hash": "e5d2d0db88fc"
    },
    {
      "id": "extension-creer-compte",
      "locale": "en",
      "title": "Create your account from the extension and keep your work",
      "viewer": "guest",
      "routes": [
        "/connexion",
        "/compte",
        "/candidatures/[id]"
      ],
      "steps": [
        {
          "title": "Your Match Score, without an account",
          "actions": [
            {
              "action": "goto",
              "page": "@offre-de-demo"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Analyser cette offre avec Jobbbox"
              }
            },
            {
              "action": "goto",
              "page": "@panneau-extension"
            },
            {
              "action": "upload",
              "target": {
                "by": "label",
                "text": "Votre CV"
              },
              "file": "cv-claire-demo.pdf"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Calculer mon Match Score"
              }
            }
          ],
          "narration": "Without an account, your CV and the job offer are deleted at the latest 24 hours after your first analysis, or as soon as you close your browser. By creating your account, you keep them."
        },
        {
          "title": "Create your account",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Créer mon compte et garder cette offre"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Créer mon compte et garder cette offre"
              }
            }
          ],
          "narration": "In the extension's panel, once your Match Score is computed, click « Create my account and keep this job offer ». Jobbbox opens in a new tab."
        },
        {
          "title": "Your email address",
          "actions": [
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Your email address"
              },
              "text": "claire.guest@motions.jobbbox.test"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Send me a sign-in link"
              }
            }
          ],
          "narration": "Enter « Your email address », then click « Send me a sign-in link »."
        },
        {
          "title": "Open the email",
          "actions": [
            {
              "action": "open-email",
              "subject": "Your Jobbbox sign-in link"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Sign in to Jobbbox"
              }
            }
          ],
          "narration": "Open the email « Your Jobbbox sign-in link » and click « Sign in to Jobbbox », within 15 minutes: your account is created, without a password. If Jobbbox asks you to accept the Terms of use, read them, tick the box then click « Accept and continue »."
        },
        {
          "title": "Go back to the job offer",
          "actions": [
            {
              "action": "goto",
              "page": "@panneau-extension"
            }
          ],
          "narration": "Go back to the job offer's tab: the extension's panel updates by itself. Your CV has become your profile, and the job offer is saved in your applications, as “To apply”."
        },
        {
          "title": "See your application",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "See my application"
              }
            }
          ],
          "narration": "Click « See my application » to open it in Jobbbox."
        }
      ],
      "hash": "9ce0774d5cc2"
    },
    {
      "id": "postuler-cv-adapte",
      "locale": "en",
      "title": "Apply with a tailored CV",
      "viewer": "candidate",
      "routes": [
        "/candidatures",
        "/candidatures/[id]",
        "/candidatures/[id]/documents"
      ],
      "steps": [
        {
          "title": "Open the application",
          "actions": [
            {
              "action": "goto",
              "path": "/candidatures"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Atelier Dumas · Responsable comptable"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Documents"
              }
            }
          ],
          "narration": "Open the « Responsable comptable » application, then its « Documents » section."
        },
        {
          "title": "Propose a tailored CV",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Propose a tailored CV"
              }
            },
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "complementary",
                "name": "Documents"
              }
            }
          ],
          "narration": "Click « Propose a tailored CV ». « Proposal ready: check the changes before saving. » shows, with the match score before and after."
        },
        {
          "title": "Answer the coach's questions",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "No"
              }
            }
          ],
          "narration": "Under « The coach's questions », the job offer asks for what your CV does not show. Answer « Yes, I have it » or « No ». Here, « No »: nothing is added."
        },
        {
          "title": "Accept or reject each change",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Save the tailored CV"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Reject"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Save the tailored CV"
              }
            }
          ],
          "narration": "Under « Changes from the reference CV », click « Accept » or « Reject » for each change. A rejected change keeps what your Master CV says. Then click « Save the tailored CV »."
        },
        {
          "title": "Download the tailored CV",
          "actions": [
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Download as PDF"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "radio",
                "name": "Modern"
              }
            },
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Download as PDF"
              }
            }
          ],
          "narration": "Under « Download this tailored CV », choose a CV template, here « Modern », then « Download as PDF » or « Download as Word (.docx) »."
        },
        {
          "title": "Apply, then change the status",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Fiche"
              }
            },
            {
              "action": "select",
              "target": {
                "by": "role",
                "role": "combobox",
                "name": "Status"
              },
              "option": "Applied"
            }
          ],
          "narration": "Send your application yourself, on the job offer's site or by email: Jobbbox sends nothing on your behalf. Then, in the application's fiche, set the « Status » to « Applied »."
        }
      ],
      "hash": "b4c3abc9278f"
    },
    {
      "id": "reserver-seance-coach",
      "locale": "en",
      "title": "Book and pay for a session with a human coach",
      "viewer": "candidate",
      "routes": [
        "/coachs",
        "/coachs/commande"
      ],
      "steps": [
        {
          "title": "Choose a coach",
          "actions": [
            {
              "action": "goto",
              "path": "/coachs"
            },
            {
              "action": "scroll",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Choose a coach"
              }
            },
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "region",
                "name": "Choose a coach"
              }
            }
          ],
          "narration": "In the menu, open « My human coaches ». Under « Choose a coach », each coach introduces themselves."
        },
        {
          "title": "Your order",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Book a session with Sophie Démo"
              }
            }
          ],
          "narration": "Click « Book a session with … » for the coach of your choice. On the « Your order » page, check the summary, then tick « I accept the terms of sale » when the box shows."
        },
        {
          "title": "Pay",
          "actions": [
            {
              "action": "pay",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Go to payment"
              }
            }
          ],
          "narration": "Click « Go to payment », then pay on the secure page of Stripe, our payment provider, which this video does not show. Back in Jobbbox, « Payment received. Now pick the time of your session. » shows."
        },
        {
          "title": "Pick your time",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Pick my time with Sophie Démo on Cal.com"
              }
            }
          ],
          "narration": "Click « Pick my time with … on Cal.com » and book your time."
        },
        {
          "title": "Enter the date",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "I've booked: enter the date of the session with Sophie Démo"
              }
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Session date and time (Paris time)"
              },
              "text": "2027-03-16T10:00"
            },
            {
              "action": "fill",
              "target": {
                "by": "label",
                "text": "Video call link (optional)"
              },
              "text": "https://visio.exemple.invalid/seance-demo"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Save"
              }
            }
          ],
          "narration": "Come back to Jobbbox and click « I've booked: enter the date ». Enter the « Session date and time (Paris time) » and, if you have it, the « Video call link (optional) », then click « Save »."
        },
        {
          "title": "Join the video call",
          "actions": [
            {
              "action": "hover",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Join the video call with Sophie Démo"
              }
            }
          ],
          "narration": "The session joins your agenda. On the day, click « Join the video call with … », in « My human coaches », under « My paid sessions »."
        }
      ],
      "hash": "35b0692f7ab7"
    },
    {
      "id": "transferer-offres-email",
      "locale": "en",
      "title": "Forward the job offers you receive by email",
      "viewer": "candidate",
      "routes": [
        "/compte/reception-email",
        "/compte/reception-email/assistant",
        "/recherches"
      ],
      "steps": [
        {
          "title": "Email intake",
          "actions": [
            {
              "action": "goto",
              "path": "/compte/reception-email"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Set up forwarding step by step"
              }
            }
          ],
          "narration": "In My account, open the « Email intake » section, then click « Set up forwarding step by step »."
        },
        {
          "title": "Your mailbox",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "radio",
                "name": "Gmail"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continue"
              }
            }
          ],
          "narration": "At « Which mailbox gets your job alerts? », choose yours, here Gmail, then click « Continue »."
        },
        {
          "title": "Switch it on",
          "actions": [
            {
              "action": "zoom",
              "target": {
                "by": "role",
                "role": "main",
                "name": null
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Switch on and continue"
              }
            }
          ],
          "narration": "Read what is read and what is kept, then click « Switch on and continue ». The date you switched it on is recorded."
        },
        {
          "title": "Your forwarding address",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Copy the address"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continue"
              }
            }
          ],
          "narration": "Click « Copy the address »: it is your forwarding address, yours alone."
        },
        {
          "title": "In Gmail",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continue"
              }
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continue"
              }
            }
          ],
          "narration": "With Gmail, on a computer, add this forwarding address in Gmail's settings, as the guide shows. Jobbbox shows you Gmail's confirmation code. Then create the Gmail filter that forwards only your alerts, never all your mail."
        },
        {
          "title": "The first email",
          "actions": [
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "button",
                "name": "Continue"
              }
            }
          ],
          "narration": "Wait for your next alert, or forward one by hand: « First email received on … » confirms forwarding works."
        },
        {
          "title": "Your job offers received by email",
          "actions": [
            {
              "action": "zoom",
              "target": null
            },
            {
              "action": "goto",
              "path": "/recherches"
            },
            {
              "action": "click",
              "target": {
                "by": "role",
                "role": "link",
                "name": "Received by email"
              }
            }
          ],
          "narration": "Open the Job searches page: the job offers from your emails arrive in « Offers to handle », with the « Email » chip. At the foot of the box, « Received by email » sorts them under the profile they match best, or in « Unclassified » when no profile reaches 60."
        }
      ],
      "hash": "fd23fb5d7896"
    }
  ]
};
