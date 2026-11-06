// The web app's Share capture route for the e2e tests (#697), as apps/web/src/app/api/share-captures answers it, only
// to a request carrying the signed-in Candidate's session cookie (401 otherwise): a link on a site whose rules let the
// server read it becomes a Private Job Offer; a Forbidden site (LinkedIn) asks for the text; a text long enough to be an
// offer's becomes one. The conversation it opens is saved on the fake Coach Conversation routes (src/coach/testing), as
// the web saves it. And `POST /api/match-score` for « Scorer contre mon profil », the Plan Quota refusing it when told.
import type { ShareCaptureAnswer } from "@jobhub/shared";
import type { FakeCoachWeb } from "../src/coach/testing";
import type { fakeWebApp } from "../src/session/testing";

/** A posting's page the server may read. */
export const READABLE_URL = "https://carrieres.groupe-seb.fr/offres/daf-lyon";
/** A posting on a Forbidden site: the server never reads it. */
export const LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4012345678";
/** The text of a posting, as copied from its page. */
export const OFFER_TEXT =
  "Contrôleur de gestion H/F, Airbus, Toulouse. CDI. Au sein de la direction financière, vous pilotez le budget et les clôtures mensuelles de la division Avions commerciaux. Vous avez au moins 5 ans d'expérience en contrôle de gestion industriel.";

type Body = { url?: string; text?: string };

export interface ShareRoute {
  /** What « Envoyer à Jobbbox » sent, in order. */
  sent: Body[];
  /** What « Scorer contre … » asked, in order. */
  scored: { jobOfferId: string; profileId: string }[];
  /** The Plan Quota refuses the next Match Score, as `quotaExceededResponse` answers. */
  quotaReached: boolean;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Share capture and Match Score routes, before `rest`, to `email`'s session. */
export function serveShareCapture(web: ReturnType<typeof fakeWebApp>, coach: FakeCoachWeb, email: string, rest: typeof globalThis.fetch): { fetch: typeof globalThis.fetch; route: ShareRoute } {
  const route: ShareRoute = { sent: [], scored: [], quotaReached: false };
  let offers = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (pathname !== "/api/share-captures" && pathname !== "/api/match-score") return rest(input, init);
    if (web.signedInAs(request.headers) !== email) return json({ error: "unauthorized" }, 401);
    const body = (await request.json()) as Body & { jobOfferId?: string; profileId?: string };
    if (pathname === "/api/match-score") {
      route.scored.push({ jobOfferId: String(body.jobOfferId), profileId: String(body.profileId) });
      if (route.quotaReached)
        return json(
          {
            error: "quota_exceeded",
            quota: "matchScores",
            prompt: { title: "Limite atteinte", message: "Vous avez utilisé vos 5 scores de correspondance de la semaine avec l'offre Gratuit. Passez à Premium pour en calculer davantage.", action: "Passer à Premium", href: "/abonnement" },
          },
          402,
        );
      return json({ score: 78, breakdown: {} });
    }
    route.sent.push(body);
    const url = body.url ?? body.text?.match(/https?:\/\/\S+/)?.[0];
    const offerText = (body.text ?? "").replace(url ?? "", "").trim().length >= 200;
    let title: string | null = null;
    if (url === READABLE_URL) title = "Directeur administratif et financier H/F";
    else if (offerText) title = "Contrôleur de gestion H/F";
    else if (url?.includes("linkedin.com")) return json({ error: "text_needed", reason: "forbidden_site" } satisfies ShareCaptureAnswer, 422);
    if (!title) return json({ error: "text_needed", reason: "not_a_job_offer" } satisfies ShareCaptureAnswer, 422);
    const jobOffer = { id: `offre-${++offers}`, title, employer: title.startsWith("Directeur") ? "Groupe Seb" : "Airbus" };
    const conversation = { id: `partage-${offers}`, title };
    coach.add({
      id: conversation.id,
      title,
      messages: [
        { from: "candidate", text: `Offre partagée depuis une autre app : ${title}` },
        {
          from: "coach",
          text: "J'ai enregistré cette offre dans Jobbbox. Elle n'est visible que par vous. Touchez « Scorer contre mon profil » pour voir si elle vous correspond.",
          jobOffer: { ...jobOffer, followed: false },
        },
      ],
    });
    return json({ jobOffer, conversation } satisfies ShareCaptureAnswer);
  };
  return { fetch, route };
}
