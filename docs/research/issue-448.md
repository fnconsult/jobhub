# Recherche #448 : explications fournisseur de la fiche Email intake (Back Office)

Carte : #426. Vérifié le 2026-10-28 auprès des docs officielles. Périmètre : seulement les faits que l'Assistant du Back Office doit énoncer correctement (domaine entrant et MX, webhook Brevo, puis inscription Microsoft, vérification Google, Yahoo OAuth). Le format du payload, le retry, l'IP et la sécurité du webhook sont dans `docs/research/issue-442.md` et ne sont pas répétés. Aucune API tierce n'est appelée par #448 : ce sont des textes d'explication.

## Domaine entrant et MX (Brevo)
Source : https://developers.brevo.com/docs/inbound-parse-webhooks
- Deux MX sur le sous-domaine de réception : priorité 10 `inbound1.sendinblue.com.` et priorité 20 `inbound2.sendinblue.com.`
- Le domaine de réception doit différer du domaine d'envoi (la page recommande un sous-domaine du type `reply.exemple.com`) ; le domaine doit d'abord être vérifié chez Brevo.
- La propagation DNS peut prendre plusieurs heures : à dire avant de tester.
- Webhook : `POST https://api.brevo.com/v3/webhooks` avec `type: "inbound"`, `events: ["inboundEmailProcessed"]`, `url`, `domain`. Tout mail à `*@<domaine>` est analysé puis envoyé à l'URL.
- Secret : Brevo ne signe pas le payload ; voir #442 (en-tête personnalisé ou `bearer`, comparaison en temps constant).
- Écart avec les ADR : ADR-0050 cite `alertes.jobbbox.ai` comme domaine entrant ; l'explication doit lire le domaine dans le Platform Setting, pas le coder en dur.
- Non documenté par cette page : région UE de Brevo pour l'inbound, taille maximale. Ne pas l'affirmer dans l'Assistant ; renvoyer au DPA (ADR-0051).

## Microsoft : inscription d'application et vérification de l'éditeur
Source : https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview (mise à jour 2026-06-15)
- Prérequis : compte Microsoft AI Cloud Partner Program (ex-MPN) vérifié, et c'est le compte global (PGA), pas un identifiant de lieu ; application inscrite avec un compte professionnel ou scolaire Entra (pas un compte Microsoft personnel) ; tenant associé au PGA ; domaine éditeur défini et différent de `*.onmicrosoft.com` ; domaine de l'e-mail du compte CPP égal au domaine éditeur ou domaine personnalisé vérifié du tenant.
- La personne qui lance la vérification : rôle Application Administrator ou Cloud Application Administrator dans Entra, et CPP Partner Admin ou Account Admin dans Partner Center, connectée avec MFA ; acceptation des conditions d'utilisation.
- Gratuit, sans licence. Pour qui remplit les prérequis : « minutes ». Le délai de création et vérification du compte CPP lui-même n'est pas donné par cette page (l'ADR parle d'un délai non publié : rien ne le contredit).
- Effet : badge « vérifié » à la demande de consentement. Avec le consentement par étape basé sur le risque activé, les utilisateurs ne peuvent pas consentir aux applications multi-tenant récentes (enregistrées après le 2020-11-08) non vérifiées qui demandent plus que la connexion et le profil de base ; l'écran affiche un avertissement.
- Non pris en charge dans les clouds nationaux ni les tenants B2C.

## Google : vérification et évaluation de sécurité
Source : https://support.google.com/cloud/answer/13464321
- Les applications qui demandent des portées restreintes doivent passer une évaluation de sécurité annuelle par un groupe d'évaluateurs agréé par Google. Les portées seulement sensibles n'y sont pas soumises.
- Non confirmé par cette page : le nom « CASA », la liste des portées Gmail restreintes, le coût (ADR : environ 1 000 à 5 000 EUR) et le délai (ADR : 1 à 3 mois). Ces chiffres viennent des notes précédentes (#427) et sont à citer comme estimations, avec la page « Security Assessment » (https://support.google.com/cloud/answer/13465431, non lue ici) pour les confirmer.

## Yahoo : OAuth et IMAP
Source : https://senders.yahooinc.com/developer/documentation
- OAuth 2.0 ; portées mail `mail-r` (lecture) et `mail-w` (écriture). Il faut des identifiants client et l'approbation de la portée mail après demande d'accès développeur ; l'approbation relève de la revue Yahoo, sans critères publiés.
- Yahoo et AOL partagent l'identité mais chaque espace de noms demande ses propres identifiants client.
- IMAP OAuth : `imap.mail.yahoo.com`, SASL `OAUTHBEARER` seulement si `AUTH=OAUTHBEARER` est annoncé ; SASL-IR pris en charge.
- Non couvert par cette page : l'interdiction d'accès automatisé dans les conditions d'utilisation de Yahoo (ADR-0050). Ne pas la présenter comme sourcée ici.

## Implications pour l'implémentation
- Écrire les textes d'explication avec ces seuls faits ; les points « non confirmé » doivent être formulés comme tels (ou omis) dans les libellés et la sortie de l'Assistant.
- Le test de l'Assistant (modèle simulé) doit vérifier la mention des deux MX et du sous-domaine distinct du domaine d'envoi, pas une valeur de domaine codée en dur.
