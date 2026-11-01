/**
 * Fictional offer emails (#445), written on the model of the corpus of #433 (kept outside the repo): the senders,
 * shapes and traps a real email shows, invented offers, companies and people. Never a real email. Each comes with the
 * reply a model following « Lire un email d'offres d'emploi » gives for it, for a stubbed AI.
 *
 *   inboundRequest(linkedInDigest.email(address), SECRET)  as the MTA posts it
 *   createFakeProvider({ id: "mistral", reply: replyToOfferEmail })   the stubbed AI's reply to each
 */
import { inboundEmail, type InboundTestEmail } from "./inbound-emails";

/** One fictional email, the words that tell it apart in its text, and the reply the AI gives it. */
export interface OfferEmailFixture {
  /** The email as the MTA posts it to `to`; `from` replaces the sender (a manual forward's is the Candidate's own address). */
  email(to: string, options?: { from?: string; messageId?: string; sentAt?: string }): InboundTestEmail;
  /** Words only this email's text holds. */
  marker: string;
  /** The JSON reply, as the model writes it. */
  reply: { kind: "alerte" | "recruteur" | "autre"; offers: Record<string, string>[] };
}

const LINKEDIN_OFFERS = [
  ["4012345601", "Responsable contrôle de gestion", "Exemple Industrie", "Lyon"],
  ["4012345602", "Directeur administratif et financier", "Société Fictive", "Villeurbanne"],
  ["4012345603", "Contrôleur financier", "Démo Logistique", "Lyon"],
  ["4012345604", "Head of Finance", "Startup Imaginaire", "Paris"],
  ["4012345605", "Responsable comptable", "Groupe Exemplaire", "Grenoble"],
  ["4012345606", "Finance Business Partner", "Inventé SAS", "Lyon"],
] as const;

const linkedInLink = (id: string) => `https://www.linkedin.com/comm/jobs/view/${id}/?trackingId=Zm9vYmFy%3D%3D&refId=ZmFrZQ&lipi=urn%3Ali%3Apage%3Aemail_job_alert&midToken=AQFake&trk=eml-email_job_alert_digest_01`;

/** A LinkedIn job alert digest of 6 offers, each behind a /comm/ tracking link. */
export const linkedInDigest: OfferEmailFixture = {
  marker: "Votre alerte emploi pour « directeur financier »",
  email: (to, options = {}) =>
    inboundEmail({
      from: options.from ?? "jobalerts-noreply@linkedin.com",
      to,
      messageId: options.messageId,
      sentAt: options.sentAt,
      subject: "« directeur financier » : 6 nouvelles offres",
      text: null,
      html: `<html><body><h2>Votre alerte emploi pour « directeur financier »</h2><table>
        ${LINKEDIN_OFFERS.map(([id, title, company, city]) => `<tr><td><a href="${linkedInLink(id)}">${title}</a><br>${company} · ${city}<br>Candidature simplifiée</td></tr>`).join("\n")}
        </table><a href="https://www.linkedin.com/comm/jobs/search/?keywords=directeur%20financier">Voir toutes les offres</a>
        <p>Vous recevez cet email car vous avez créé une alerte. Se désabonner.</p></body></html>`,
    }),
  reply: {
    kind: "alerte",
    offers: LINKEDIN_OFFERS.map(([id, title, employer, location]) => ({ title, employer, location, link: linkedInLink(id) })),
  },
};

const CADREMPLOI_OFFERS = [
  ["158700001", "Contrôleur de gestion industriel", "Exemple Mécanique", "Lyon (69)", "CDI", "55 – 60 k€"],
  ["158700002", "Responsable consolidation", "Société Fictive", "Paris (75)", "CDI", "70 – 80 k€"],
  ["158700003", "Directeur financier adjoint", "Cabinet Démo pour son client", "Nantes (44)", "CDD", ""],
] as const;

const cadremploiLink = (id: string) => `https://www.cadremploi.fr/emploi/detail_offre?offreId=${id}&utm_source=alerte&utm_medium=email&xtor=EPR-12-[alerte]`;

/** A Cadremploi alert whose text part is only CSS: its offers are in the HTML alone. */
export const cadremploiAlert: OfferEmailFixture = {
  marker: "Nouvelles offres correspondant à votre recherche",
  email: (to, options = {}) =>
    inboundEmail({
      from: options.from ?? "offres@alertes.cadremploi.fr",
      to,
      messageId: options.messageId,
      sentAt: options.sentAt,
      subject: "3 offres pour « finance »",
      text: "body { margin:0; padding:0; } .offre-titre { font-weight: bold; color: #1a1a1a; } @media (max-width: 600px) { .col { width: 100% } }",
      html: `<html><head><style>.offre-titre { font-weight: bold; }</style></head><body>
        <h1>Nouvelles offres correspondant à votre recherche</h1>
        ${CADREMPLOI_OFFERS.map(([id, title, company, city, contract, salary]) => `<div class="offre"><a class="offre-titre" href="${cadremploiLink(id)}">${title} H/F</a><p>${company} – ${city} – ${contract}${salary ? ` – ${salary}` : ""}</p></div>`).join("\n")}
        <img src="https://www.cadremploi.fr/pixel.gif?id=abc" alt="">
      </body></html>`,
    }),
  reply: {
    kind: "alerte",
    offers: CADREMPLOI_OFFERS.map(([id, title, company, city, contract, salary]) => ({
      title,
      ...(company.startsWith("Cabinet") ? { intermediary: "Cabinet Démo" } : { employer: company }),
      location: city,
      contract,
      ...(salary ? { salary } : {}),
      link: cadremploiLink(id),
    })),
  },
};

/** A Jobijoba promotion: companies « qui recrutent » and regions, no precise offer. */
export const jobijobaPromo: OfferEmailFixture = {
  marker: "Ces entreprises recrutent près de chez vous",
  email: (to, options = {}) =>
    inboundEmail({
      from: options.from ?? "newsletter@jobijoba.com",
      to,
      messageId: options.messageId,
      sentAt: options.sentAt,
      subject: "Ces entreprises recrutent près de chez vous !",
      text: null,
      html: `<html><body><h1>Ces entreprises recrutent près de chez vous</h1>
        <p><a href="https://www.jobijoba.com/fr/entreprise/exemple-distribution?utm_source=newsletter">Exemple Distribution</a> – 120 offres</p>
        <p><a href="https://www.jobijoba.com/fr/region/auvergne-rhone-alpes?utm_source=newsletter">Toutes les offres en Auvergne-Rhône-Alpes</a></p>
        <p><a href="https://www.jobijoba.com/fr/metier/finance?utm_source=newsletter">Les métiers de la finance</a></p></body></html>`,
    }),
  reply: { kind: "alerte", offers: [] },
};

/** A recruiter's message, forwarded by hand by the Candidate from their own address (a fictional recruiter and client). */
export const recruiterMessage: OfferEmailFixture = {
  marker: "Je me permets de vous contacter au sujet d'un poste",
  email: (to, options = {}) =>
    inboundEmail({
      from: options.from ?? "marie.dupont@example.fr",
      to,
      messageId: options.messageId,
      sentAt: options.sentAt,
      subject: "Fwd: Opportunité – Directeur administratif et financier",
      text: [
        "---------- Message transféré ---------",
        "De : Claire Exemple <claire.exemple@cabinet-fictif.test>",
        "Objet : Opportunité – Directeur administratif et financier",
        "",
        "Bonjour Marie,",
        "Je me permets de vous contacter au sujet d'un poste de Directeur administratif et financier (CDI) pour une ETI",
        "industrielle de 400 personnes basée à Lyon. Le poste encadre une équipe de 8 personnes et rapporte au Président.",
        "Rémunération : 95 – 110 k€. Seriez-vous disponible pour un échange cette semaine ?",
        "Claire Exemple – 06 00 00 00 00",
      ].join("\n"),
    }),
  reply: {
    kind: "recruteur",
    offers: [
      {
        title: "Directeur administratif et financier",
        intermediary: "Cabinet Fictif",
        location: "Lyon",
        contract: "CDI",
        salary: "95 – 110 k€",
        excerpt: "Poste de DAF dans une ETI industrielle de 400 personnes à Lyon, encadrant une équipe de 8 personnes et rapportant au Président.",
      },
    ],
  },
};

/** A job board's newsletter: articles, no offer. */
export const newsletter: OfferEmailFixture = {
  marker: "Les tendances du recrutement cette semaine",
  email: (to, options = {}) =>
    inboundEmail({
      from: options.from ?? "newsletter@welcometothejungle.com",
      to,
      messageId: options.messageId,
      sentAt: options.sentAt,
      subject: "Les tendances du recrutement cette semaine",
      text: null,
      html: `<html><body><h1>Les tendances du recrutement cette semaine</h1>
        <p><a href="https://www.welcometothejungle.com/fr/articles/negocier-son-salaire?utm_source=newsletter">Négocier son salaire en 2027</a></p>
        <p><a href="https://www.welcometothejungle.com/fr/articles/webinaire-reconversion">Webinaire : réussir sa reconversion</a></p></body></html>`,
    }),
  reply: { kind: "autre", offers: [] },
};

export const OFFER_EMAILS = [linkedInDigest, cadremploiAlert, jobijobaPromo, recruiterMessage, newsletter] as const;

/** The stubbed AI's reply to an offer_email_reading call: the reply of the fixture whose text it is given. */
export function replyToOfferEmail(input: { messages: { content: unknown }[] }): string {
  const prompt = input.messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  const fixture = OFFER_EMAILS.find((each) => prompt.includes(each.marker));
  return JSON.stringify(fixture?.reply ?? { kind: "autre", offers: [] });
}
