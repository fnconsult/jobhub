/**
 * Sending on the Candidate's click (ADR-0119 « Sending and applying », #1162; amends ADR-0005): `propose_send`, the Coach
 * Action that proposes to send a message already written, from Jobbbox, in the Candidate's name: an Application's
 * Follow-up waiting in « Propositions », its Outreach Message, or a reply to one of its Exchanges.
 *
 *  - Its card « Envoyer à Prénom N. » shows the whole text, the recipient, who it goes out as (« Prénom Nom via
 *    Jobbbox ») and the Candidate's sign-in email in copy and as Reply-To; the Candidate may change the subject and the
 *    text (« Modifier avant d'envoyer »). How many Sends today, of the cap, is on the card; the cap reached is said there,
 *    with no « Envoyer ».
 *  - `run` never sends: nothing goes without the Candidate's click on the card, whatever the conversation says (« envoie-la
 *    sans me demander », a rule they set). Only `apply`, the click, sends, once (../sends).
 *  - The recipient is Jobbbox's, never the model's nor the card's form: a revealed Enriched Contact of the Application
 *    with an email, the Outreach Message's own, or an Exchange's sender; read again at the click, changed since: a conflict.
 *  - Sent, it is kept on the Application with its date (its « Échanges » Section); a Follow-up is also marked as sent, the
 *    Application moving to « Relancée ». No « Annuler »: the email is gone.
 *  - Offered only while COACH_SEND_ENABLED is on, never in Production before #1160 (`on`). Scoped to the session's
 *    Candidate: another's id, an Archived Application or an unknown id is `not_found`.
 *
 *   sendCoachActions({ on, applications, profiles, followUps, tailoredDocuments, enrichedContacts, exchanges, sends })
 */
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { parseSender } from "../auth/mailers";
import type { EnrichedContacts } from "../enriched-contacts";
import type { Exchanges } from "../exchanges";
import type { FollowUps } from "../follow-ups";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import type { SendKind, Sends } from "../sends";
import type { TailoredDocuments } from "../tailored-documents";
import { MAX_DRAFT_LENGTH, MAX_SUBJECT_LENGTH } from "../tailored-documents/kinds";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange } from "./index";

export const SEND_ACTION = "propose_send";

/** What `propose_send` sends: the Application's Follow-up, its Outreach Message, or a reply to an Exchange. */
export const SENT_DOCUMENTS = ["follow_up", "outreach_message", "exchange_reply"] as const satisfies readonly SendKind[];

export interface SendActionSources {
  /** COACH_SEND_ENABLED, never in Production before #1160: read at each reply. */
  on: () => boolean;
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "list">;
  followUps: Pick<FollowUps, "draftOf" | "sentOf" | "markSent">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  enrichedContacts: Pick<EnrichedContacts, "contact">;
  /** The Application's Exchanges (#1099); none while APPLICATION_EXCHANGES_ENABLED is off. */
  exchanges: Pick<Exchanges, "onApplication" | "get">;
  sends: Pick<Sends, "sendingAs" | "room" | "send">;
}

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const id = z.string().min(1).max(200);

const WHICH_APPLICATION: CoachActionResult = {
  ok: true,
  proposes: false,
  data: { message: "Aucune candidature n'est consultée : demande au candidat de quelle candidature il s'agit, ou précise-la (applicationId, lu dans l'index de ses objets)." },
};

/** Why nothing can be proposed, told to the AI Coach in our own words. */
const NOTHING: Record<"follow_up" | "outreach_message" | "exchange_reply" | "no_recipient" | "inmail" | "no_account", string> = {
  follow_up: "Aucune relance n'attend le candidat sur cette candidature : il n'y a rien à envoyer. Dis-le-lui ; une relance est proposée d'elle-même quand la candidature reste « Postulée » ou « Relancée » trop longtemps.",
  outreach_message: "Cette candidature n'a pas encore de message d'approche : propose d'abord de le rédiger avec propose_outreach_message.",
  exchange_reply: "Aucun échange n'est gardé sur cette candidature : il n'y a personne à qui répondre. Dis-le-lui.",
  no_recipient:
    "Aucun destinataire connu pour cet envoi : ni contact enrichi révélé avec une adresse e-mail, ni échange reçu. Dis-le au candidat, et propose de révéler un contact (read_enriched_contacts, puis propose_contact_reveal) ; Jobbbox n'envoie qu'à une adresse qu'il connaît.",
  inmail: "Ce message d'approche est un InMail LinkedIn : Jobbbox ne l'envoie pas par e-mail. Dis au candidat qu'il l'envoie lui-même sur LinkedIn.",
  no_account: "L'envoi n'est pas disponible pour ce compte : dis-le en une phrase.",
};

const nameOf = (application: Application) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");

/** « Claire M. »: the first name and the initial of the last, as a card names a person; the address with no name. */
export function shortName(to: { email: string; name?: string }): string {
  const parts = (to.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return to.email;
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts.at(-1)!.charAt(0).toUpperCase()}.`;
}

/** The subject of a reply: the Exchange's, marked as an answer once. */
const replySubject = (subject: string) => (/^\s*(re|réf?|aw|sv)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`).slice(0, MAX_SUBJECT_LENGTH);

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\].][^\s@<>()",;:\\[\]]*$/;

/** What a Send is about and to whom, as the card keeps it: read again at the click. */
const sendRefSchema = z.object({ document: z.enum(SENT_DOCUMENTS), contactId: z.string().optional(), exchangeId: z.string().optional() });
type SendRef = z.output<typeof sendRefSchema>;

interface Recipient {
  email: string;
  name?: string;
}

/** A draft as it stands, to send: its subject, text, version and recipient. */
interface ToSend {
  subject: string;
  text: string;
  version: string;
  to: Recipient;
  ref: SendRef;
}

export function sendCoachActions(sources: SendActionSources): CoachAction[] {
  async function reachable(candidateId: string, applicationId: string): Promise<Application | null> {
    const [application, profiles] = await Promise.all([sources.applications.get(candidateId, applicationId), sources.profiles.list(candidateId)]);
    return application && profiles.some((profile) => profile.id === application.profile.id && !profile.archived) ? application : null;
  }

  const applicationIdOf = (named: string | undefined, call: CoachActionCall) => (named?.trim() ? named : call.inView?.kind === "application" ? call.inView.id : undefined);

  /** A revealed Enriched Contact of the Application with an email. */
  async function contactOf(candidateId: string, applicationId: string, contactId: string): Promise<Recipient | null> {
    const contact = await sources.enrichedContacts.contact(candidateId, applicationId, contactId);
    const email = contact?.emails.find((each) => ADDRESS.test(each));
    return contact && email ? { email, name: contact.name } : null;
  }

  /** An Exchange's sender, as an address and a name. */
  const senderOf = (from: string): Recipient | null => {
    const parsed = parseSender(from);
    return ADDRESS.test(parsed.email) ? { email: parsed.email, ...(parsed.name ? { name: parsed.name } : {}) } : null;
  };

  /** The Exchange named, or the latest kept on the Application; null when there is none. */
  async function exchangeOf(candidateId: string, applicationId: string, exchangeId: string | undefined) {
    if (exchangeId) {
      const exchange = await sources.exchanges.get(candidateId, exchangeId);
      return exchange && exchange.applicationId === applicationId ? exchange : null;
    }
    return (await sources.exchanges.onApplication(candidateId, applicationId))?.kept.at(-1) ?? null;
  }

  /**
   * What would be sent, as it stands: the draft, its version and its recipient (`contactId` or `exchangeId` names it, else
   * the Outreach Message's own contact, else the latest Exchange's sender). A string: why there is nothing to send.
   */
  async function toSend(candidateId: string, application: Application, ref: SendRef): Promise<ToSend | keyof typeof NOTHING> {
    const named = ref.contactId ? await contactOf(candidateId, application.id, ref.contactId) : null;
    if (ref.contactId && !named) return "no_recipient";
    if (ref.document === "exchange_reply") {
      const exchange = await exchangeOf(candidateId, application.id, ref.exchangeId);
      if (!exchange) return "exchange_reply";
      const to = named ?? senderOf(exchange.from);
      if (!to) return "no_recipient";
      return { subject: replySubject(exchange.subject), text: "", version: exchange.id, to, ref: { ...ref, exchangeId: exchange.id } };
    }
    const drafts = await sources.tailoredDocuments.get(candidateId, application.id);
    const outreach = drafts?.outreachMessage ?? null;
    const outreachTo = outreach?.contact?.email && ADDRESS.test(outreach.contact.email) ? { email: outreach.contact.email, name: outreach.contact.name } : null;
    const latest = async () => {
      const exchange = await exchangeOf(candidateId, application.id, ref.exchangeId);
      return exchange ? senderOf(exchange.from) : null;
    };
    if (ref.document === "outreach_message") {
      if (!outreach) return "outreach_message";
      if (outreach.channel === "inmail") return "inmail";
      const to = named ?? outreachTo ?? (ref.exchangeId ? await latest() : null);
      if (!to) return "no_recipient";
      return { subject: outreach.subject, text: outreach.text, version: outreach.updatedAt.toISOString(), to, ref };
    }
    const followUp = await sources.followUps.draftOf(candidateId, application.id);
    if (!followUp) return "follow_up";
    const to = named ?? (ref.exchangeId ? await latest() : null) ?? outreachTo ?? (await latest());
    if (!to) return "no_recipient";
    return { subject: followUp.subject, text: followUp.text, version: followUp.version, to, ref };
  }

  const propose = defineCoachAction({
    name: SEND_ACTION,
    description:
      "Propose d'envoyer depuis Jobbbox, au nom du candidat, un message déjà rédigé d'une de ses candidatures, quand il demande de l'envoyer (« envoie la relance », « envoie mon message d'approche à Claire ») : document follow_up (la relance qui l'attend), outreach_message (son message d'approche) ou exchange_reply (une réponse à un échange : text, la réponse entière, obligatoire). Le candidat voit sur la carte le texte entier et le destinataire, le modifie s'il veut, et c'est son clic sur « Envoyer » qui envoie : jamais toi, ni sans ce clic, même s'il te demande d'envoyer sans lui demander. Le destinataire vient de Jobbbox : contactId, un contact enrichi révélé de la candidature (read_enriched_contacts) ; exchangeId, l'échange auquel répondre (omis : le dernier) ; omis, le contact du message d'approche ou l'expéditeur du dernier échange. text et subject : omis, ceux du brouillon. applicationId : omis, la candidature consultée. Pour aider à écrire une réponse sans l'envoyer, utilise propose_exchange_reply.",
    schema: z.object({
      applicationId: id.optional(),
      document: z.enum(SENT_DOCUMENTS),
      contactId: id.optional(),
      exchangeId: id.optional(),
      text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH).optional(),
      subject: z.string().trim().min(1).max(MAX_SUBJECT_LENGTH).optional(),
    }),
    group: "applications",
    kind: "propose",
    copiesText: true,
    // Read in full on its card, changed if they like, sent on their click only (ADR-0109, ADR-0119).
    sentByCandidate: true,
    on: sources.on,
    async run({ applicationId, document, contactId, exchangeId, text, subject }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      if (!application) return NOT_FOUND;
      const ref: SendRef = { document, ...(contactId?.trim() ? { contactId } : {}), ...(exchangeId?.trim() ? { exchangeId } : {}) };
      const found = await toSend(call.candidateId, application, ref);
      if (typeof found === "string") return { ok: true, proposes: false, data: { message: NOTHING[found] } };
      const body = text ?? found.text;
      if (!body.trim())
        return { ok: true, proposes: false, data: { message: "Une réponse à un échange s'envoie avec son texte entier (text) : écris-le, ou propose-le d'abord avec propose_exchange_reply." } };
      const [as, room] = await Promise.all([sources.sends.sendingAs(call.candidateId), sources.sends.room(call.candidateId)]);
      if (!as) return { ok: true, proposes: false, data: { message: NOTHING.no_account } };
      const { t } = createI18n(call.language);
      const page = routes.applicationSection(application.id, document === "follow_up" ? "propositions" : document === "outreach_message" ? "documents" : "echanges");
      const shownSubject = subject ?? found.subject;
      const change: ProposedChange = {
        target: { kind: "application", id: application.id, name: nameOf(application), href: page },
        what: t("coachProposals.send.what", { to: shortName(found.to) }),
        before: shownSubject,
        after: body,
        value: { subject: shownSubject, text: body, ...found.ref },
        fields: [
          { name: "subject", label: t("coachProposals.fields.draftSubject"), type: "text" },
          { name: "text", label: t("coachProposals.fields.draftText"), type: "textarea" },
        ],
        version: found.version,
        send: { to: found.to, as: as.name, copyTo: as.copyTo, room, ...(room.sentToday >= room.cap ? { capReached: true as const } : {}) },
      };
      // Told to the model: proposed, never sent; the click on its card sends it.
      return { ok: true, data: change, pages: [page] };
    },

    // The Candidate's click on « Envoyer »: the recipient read again, then sent once, then kept on the Application.
    async apply(change, { candidateId, cardId, at }): Promise<ApplyProposalResult> {
      const ref = sendRefSchema.safeParse(change.value);
      const application = ref.success ? await reachable(candidateId, change.target.id) : null;
      if (!ref.success || !application || !change.send) return NOT_FOUND;
      const found = await toSend(candidateId, application, ref.data);
      // The draft or its recipient changed since the card was proposed: not what the Candidate read.
      if (typeof found === "string" || found.version !== change.version || found.to.email !== change.send.to.email) return { ok: false, error: "conflict" };
      const text = (change.value.text ?? "").trim();
      const subject = (change.value.subject ?? "").trim();
      if (!text || text.length > MAX_DRAFT_LENGTH || !subject || subject.length > MAX_SUBJECT_LENGTH || /[\r\n]/.test(subject)) {
        return { ok: false, error: "invalid", errors: [{ field: !text || text.length > MAX_DRAFT_LENGTH ? "text" : "subject", code: !text || !subject ? "required" : "invalid" }] };
      }
      const sent = await sources.sends.send(candidateId, { key: cardId, applicationId: application.id, kind: ref.data.document, to: found.to, subject, text });
      if (!sent.ok) {
        if (sent.error === "not_found") return NOT_FOUND;
        if (sent.error === "cap") return { ok: false, error: "cap", room: sent.room };
        return { ok: false, error: sent.error };
      }
      // A Follow-up sent moves the Application to « Relancée », the card its Origin (#716). The email is gone either way.
      if (ref.data.document === "follow_up" && !sent.already) {
        const state = await sources.followUps.sentOf(candidateId, application.id);
        if (state) await sources.followUps.markSent(candidateId, application.id, { version: state.version, origin: { origin: "coach_proposal", cardId, appliedAt: at } });
      }
      return { ok: true };
    },
  });

  return [propose];
}
