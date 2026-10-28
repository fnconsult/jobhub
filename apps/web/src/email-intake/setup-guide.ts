/**
 * What the Back Office Assistant knows of Email intake's setup, provider by provider (#448): the inbound domain and its
 * MX records, Brevo's inbound webhook and its secret, then, for later, Microsoft's app registration and publisher
 * verification, Google's verification and security assessment, Yahoo's OAuth.
 *
 *   emailIntakeSetupGuide("alertes.jobbbox.ai") // the text, for the inbound domain in use (EMAIL_INTAKE_DOMAIN)
 *
 * Only facts read in the providers' own documentation (docs/research/issue-448.md, checked 2026-10-28); what that
 * documentation does not confirm is said to be unconfirmed, an estimate. The domain is the Platform Setting's, never
 * written here.
 */
import { EMAIL_INTAKE_TOOL, parametresHref } from "../platform-settings/parametres";

/** Where Brevo's inbound webhook posts each email: the route apps/web/src/app/api/email-intake/inbound/route.ts. */
const INBOUND_PATH = "/api/email-intake/inbound";

/** Where Email intake is set up: the sheet of its Tool, Brevo Inbound, on the Sources tab of Paramètres. */
const SHEET = parametresHref("sources", { fournisseur: EMAIL_INTAKE_TOOL });

/** Email intake's setup, in French, for the inbound domain in use. */
export function emailIntakeSetupGuide(domain: string): string {
  return [
    `### Réception par email (Email intake) : configuration, fournisseur par fournisseur`,
    `La source « Réception par email » de l'onglet Sources de Paramètres transforme les emails d'offres que les candidats transfèrent à leur adresse de transfert en offres. Désactivée, chaque email reçu est écarté sans être lu. Elle est « Indisponible : en attente de validation du playbook » tant qu'aucune version du Task Playbook « Lire un email d'offres d'emploi » n'est servie. Ses réglages, sa clé et ses expéditeurs reconnus sont sur sa fiche (${SHEET}).`,
    `Expéditeurs reconnus : seuls sont lus les emails d'un expéditeur de la liste de la plateforme authentifié par son domaine (DMARC), ou par son adresse complète quand le domaine envoie pour plusieurs entreprises (jobs2web.com). Libellé « plateforme ou entreprise – site », pour la lecture seulement ; un expéditeur désactivé n'est plus lu. « Expéditeurs proposés » : ceux que des candidats ont ajoutés pour eux seuls, comptés sans nom ; les accepter les ajoute pour tous.`,
    `Domaine entrant et enregistrements MX (Brevo) : le domaine des adresses de transfert en vigueur est ${domain} (réglage EMAIL_INTAKE_DOMAIN). Il doit être différent du domaine d'envoi des emails de Jobbbox (Brevo recommande un sous-domaine dédié) et être d'abord vérifié chez Brevo.`,
    `- Enregistrements MX à créer chez l'hébergeur DNS de ${domain} : MX priorité 10 vers inbound1.sendinblue.com. et MX priorité 20 vers inbound2.sendinblue.com.`,
    `- La propagation DNS des MX peut prendre plusieurs heures : attendre avant de tester avec un vrai email.`,
    `- Changer EMAIL_INTAKE_DOMAIN ne change que les nouvelles adresses de transfert ; le nouveau domaine doit avoir ses propres MX.`,
    `Webhook entrant de Brevo et son secret : créer le webhook par l'API de Brevo (POST https://api.brevo.com/v3/webhooks) avec type « inbound », l'événement inboundEmailProcessed, le domaine ${domain} et l'URL {adresse de l'application}${INBOUND_PATH}. Brevo analyse chaque email envoyé à une adresse de ce domaine et le poste à cette URL. Brevo ne signe pas ce qu'il envoie : Jobbbox n'accepte que les envois portant le secret partagé BREVO_INBOUND_SECRET, dans l'en-tête x-inbound-secret (en-tête personnalisé du webhook) ou en jeton « Bearer » ; sans secret, tout est refusé. Le secret se remplace sur la fiche, en écriture seule, comme les autres clés ; le même doit être mis dans le webhook. Les envois ne sont acceptés que depuis les plages d'adresses IP de Brevo (réglage EMAIL_INTAKE_BREVO_IP_RANGES). EMAIL_INTAKE_DAILY_CAP plafonne les emails lus par jour et par boîte reliée ; EMAIL_INTAKE_BROAD_FILTER_THRESHOLD dit à partir de combien d'emails par jour le filtre d'un candidat est « trop large ». La documentation lue ne dit ni la région de traitement de Brevo pour la réception ni la taille maximale d'un email : ne pas l'affirmer, renvoyer au contrat de sous-traitance (DPA) de Brevo.`,
    `Plus tard, connexion de boîtes (aucune n'est proposée aujourd'hui) :`,
    `- Microsoft (Outlook, Hotmail, Live), inscription d'application et vérification de l'éditeur : il faut un compte Microsoft AI Cloud Partner Program (ex-MPN) vérifié, le compte global et non un lieu ; l'application inscrite avec un compte professionnel ou scolaire Entra (pas un compte Microsoft personnel), dans un tenant associé à ce compte ; un domaine éditeur défini, autre que *.onmicrosoft.com, et le domaine de l'email du compte partenaire égal au domaine éditeur ou à un domaine vérifié du tenant. La personne qui lance la vérification a le rôle Application Administrator ou Cloud Application Administrator dans Entra et Partner Admin ou Account Admin dans Partner Center, connectée avec l'authentification multifacteur, et accepte les conditions. Gratuit, sans licence, quelques minutes une fois les prérequis réunis ; le délai de création et de vérification du compte partenaire lui-même n'est pas publié. Effet : un badge « vérifié » sur la demande de consentement ; sans lui, quand le consentement par étape basé sur le risque est activé, les utilisateurs ne peuvent pas consentir à une application multi-tenant récente non vérifiée qui demande plus que la connexion et le profil. Non disponible dans les clouds nationaux ni les tenants B2C.`,
    `- Google (Gmail), vérification et évaluation de sécurité : une application qui demande des portées restreintes passe une évaluation de sécurité annuelle par un évaluateur agréé par Google ; des portées seulement sensibles n'y sont pas soumises. Le nom « CASA », la liste des portées Gmail restreintes, le coût (environ 1 000 à 5 000 €) et le délai (1 à 3 mois) sont des estimations de nos notes, non confirmé par la page lue : les présenter comme tels et renvoyer à la page « Security Assessment » de Google.`,
    `- Yahoo (et AOL), OAuth : OAuth 2.0 avec les portées mail-r (lecture) et mail-w (écriture) ; il faut des identifiants client et l'approbation de la portée mail après une demande d'accès développeur, laissée à la revue de Yahoo sans critères publiés. Yahoo et AOL partagent l'identité, mais chacun demande ses propres identifiants client. En IMAP : imap.mail.yahoo.com, SASL OAUTHBEARER seulement s'il est annoncé (AUTH=OAUTHBEARER), SASL-IR pris en charge.`,
  ].join("\n");
}
