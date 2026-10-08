import type { CvContent, JobOffer, MatchScore } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createJobbboxApi } from "./jobbbox-api";

const WEB_ORIGIN = "https://app.jobbbox.fr";
const jobOffer: JobOffer = { id: "jo-1", source: { url: "https://www.apec.fr/offre/1" }, title: "DAF", content: "Poste de DAF." };
const cv = { fullName: "Marie Dupont", skills: ["IFRS"] } as CvContent;
const matchScore = { score: 72 } as MatchScore;

/** The web app's API as the extension reaches it: one canned reply per path. */
function webApp(replies: Record<string, Response | (() => Response)>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const reply = replies[url.replace(WEB_ORIGIN, "")];
    if (!reply) throw new TypeError("Failed to fetch");
    return typeof reply === "function" ? reply() : reply;
  };
  return { fetch, calls };
}

describe("the Jobbbox API, from the extension", () => {
  it("captures a Job Offer with the browser's session, so a signed-in Candidate keeps it", async () => {
    const app = webApp({ "/api/job-offers": Response.json(jobOffer) });
    const captured = { source: jobOffer.source, title: jobOffer.title, content: jobOffer.content };

    expect(await createJobbboxApi(WEB_ORIGIN, app.fetch).capture(captured)).toEqual({ ok: true, jobOffer });
    expect(app.calls[0]?.init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify(captured) });
  });

  it("reads a CV file and scores it against a Job Offer", async () => {
    const app = webApp({
      "/api/cv/draft": Response.json({ masterCv: cv, searchCriteria: { targetRole: "DAF", location: "Lyon" } }),
      "/api/match-score": Response.json(matchScore),
    });
    const api = createJobbboxApi(WEB_ORIGIN, app.fetch);

    expect(await api.readCv(new File(["%PDF"], "cv.pdf"))).toEqual({ ok: true, cv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    expect((app.calls[0]?.init.body as FormData).get("cv")).toBeInstanceOf(File);
    expect(await api.score("jo-1", cv)).toEqual({ ok: true, matchScore });
    expect(JSON.parse(String(app.calls[1]?.init.body))).toEqual({ jobOfferId: "jo-1", cv });
  });

  it("says why a CV could not be read, or a Job Offer scored", async () => {
    const api = createJobbboxApi(
      WEB_ORIGIN,
      webApp({
        "/api/cv/draft": () => Response.json({ error: "empty" }, { status: 400 }),
        "/api/match-score": () => Response.json({ error: "not_found" }, { status: 404 }),
      }).fetch,
    );

    expect(await api.readCv(new File([""], "scan.pdf"))).toEqual({ ok: false, error: "empty" });
    expect(await api.score("jo-gone", cv)).toEqual({ ok: false, error: "job_offer_gone" });
  });

  it("passes on the Upgrade Prompt when the Candidate's Plan allows no more Match Scores this month", async () => {
    const prompt = {
      title: "You have reached your Plan's limit",
      message: "You have used the 3 Match Scores included this month in the Free Plan. Upgrade to Standard to use more.",
      upgradeTo: "standard",
      action: "Upgrade to Standard",
      href: "/abonnement",
    };
    const api = createJobbboxApi(
      WEB_ORIGIN,
      webApp({ "/api/match-score": () => Response.json({ error: "quota_exceeded", quota: "matchScores", prompt }, { status: 402 }) }).fetch,
    );

    expect(await api.score("jo-1", cv)).toEqual({
      ok: false,
      error: "quota_exceeded",
      prompt: { message: prompt.message, action: "Upgrade to Standard", href: "/abonnement" },
    });
  });

  it("passes on a prompt without an action when no Plan offers more", async () => {
    const prompt = { title: "Limit", message: "No Plan includes more.", upgradeTo: null, action: null, href: "/abonnement" };
    const api = createJobbboxApi(WEB_ORIGIN, webApp({ "/api/match-score": () => Response.json({ error: "quota_exceeded", prompt }, { status: 402 }) }).fetch);

    expect(await api.score("jo-1", cv)).toEqual({ ok: false, error: "quota_exceeded", prompt: { message: "No Plan includes more.", action: null, href: "/abonnement" } });
  });

  it("says when the web app cannot be reached", async () => {
    const api = createJobbboxApi(WEB_ORIGIN, webApp({}).fetch);

    expect(await api.capture({ source: {}, title: "DAF", content: "Poste." })).toEqual({ ok: false, error: "unreachable" });
    expect(await api.readCv(new File(["%PDF"], "cv.pdf"))).toEqual({ ok: false, error: "unreachable" });
    expect(await api.score("jo-1", cv)).toEqual({ ok: false, error: "unreachable" });
  });
});
