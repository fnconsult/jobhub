import { describe, expect, it } from "vitest";
import { jobDigestEmail } from "./email";

const digest = (toHandle: number) => ({
  profileName: "DAF",
  count: 1,
  offers: [{ title: "DAF H/F", employer: "Acme Industrie", location: "Lyon", postedAt: null, score: 92, partial: false, url: "https://app.jobbbox.fr/offres/1?profil=p" }],
  digestUrl: "https://app.jobbbox.fr/job-digests/9",
  toHandle,
  offerBoxUrl: "https://app.jobbbox.fr/recherches",
  unsubscribeUrl: "https://app.jobbbox.fr/desabonnement?token=t",
});

describe("the Job Digest email's line of offers à traiter (#818, ADR-0090)", () => {
  it("says « Il vous reste N offres à traiter », leading to Recherches d'offres, after the button", () => {
    const { text, html } = jobDigestEmail(digest(4), "fr");
    expect(text).toContain("Voir l'offre :\nhttps://app.jobbbox.fr/job-digests/9\n\nIl vous reste 4 offres à traiter :\nhttps://app.jobbbox.fr/recherches");
    expect(html).toMatch(/<a [^>]*href="https:\/\/app\.jobbbox\.fr\/recherches"[^>]*>Il vous reste 4 offres à traiter<\/a>/);
  });

  it("in the singular for one, in English too", () => {
    expect(jobDigestEmail(digest(1), "fr").text).toContain("Il vous reste 1 offre à traiter :\nhttps://app.jobbbox.fr/recherches");
    expect(jobDigestEmail(digest(1), "en").text).toContain("You have 1 job offer left to handle:\nhttps://app.jobbbox.fr/recherches");
  });

  it("says nothing more at zero: the email is as it was", () => {
    const { text, html } = jobDigestEmail(digest(0), "fr");
    expect(text).not.toContain("à traiter");
    expect(text).not.toContain("/recherches");
    expect(html).not.toContain("/recherches");
  });
});
