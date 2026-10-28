import { describe, expect, it } from "vitest";
import { offerLink } from "./offer-links";

describe("offerLink: the offer's own link, as a Recognised sender's module reads it from the link in its email (#445)", () => {
  it("takes the offer id out of a LinkedIn alert link, its tracking dropped", () => {
    expect(offerLink("https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=AbC%3D%3D&refId=xyz&lipi=urn%3Ali&midToken=AQ&trk=eml-email_job_alert")).toBe(
      "https://www.linkedin.com/jobs/view/4012345678/",
    );
  });

  it("takes the offer id out of an Indeed alert link (jk), whatever its path", () => {
    expect(offerLink("https://fr.indeed.com/rc/clk/dl?jk=a1b2c3d4e5f60718&from=ja&qd=xyz&rd=1&tk=1abc")).toBe("https://fr.indeed.com/viewjob?jk=a1b2c3d4e5f60718");
    expect(offerLink("https://cts.indeed.com/v3/H4sIAAAA?jk=0f9e8d7c6b5a4321&utm_source=jobalert")).toBe("https://fr.indeed.com/viewjob?jk=0f9e8d7c6b5a4321");
  });

  it("keeps the offer id parameter a job board names its offers by, and drops the rest (Cadremploi)", () => {
    expect(offerLink("https://www.cadremploi.fr/emploi/detail_offre?offreId=158765432&utm_source=alerte&utm_medium=email&xtor=EPR-12")).toBe(
      "https://www.cadremploi.fr/emploi/detail_offre?offreId=158765432",
    );
  });

  it("keeps the path of a job board whose offer is its path (HelloWork, Welcome to the Jungle, APEC, France Travail), without tracking", () => {
    expect(offerLink("https://www.hellowork.com/fr-fr/emplois/56789012.html?utm_campaign=alerte&at_medium=email")).toBe("https://www.hellowork.com/fr-fr/emplois/56789012.html");
    expect(offerLink("https://www.welcometothejungle.com/fr/companies/acme/jobs/chef-de-projet_lyon?o=123&utm_source=alert")).toBe(
      "https://www.welcometothejungle.com/fr/companies/acme/jobs/chef-de-projet_lyon",
    );
    expect(offerLink("https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543W?xtor=EPR-104")).toBe(
      "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543W",
    );
    expect(offerLink("https://candidat.francetravail.fr/offres/recherche/detail/195ABCD?at_campaign=alerte")).toBe("https://candidat.francetravail.fr/offres/recherche/detail/195ABCD");
  });

  it("opens a click-tracking redirect to reach the offer's link", () => {
    const target = encodeURIComponent("https://www.hellowork.com/fr-fr/emplois/56789012.html?utm_source=alerte");
    expect(offerLink(`https://click.mail.jobijoba.com/track?u=${target}&id=998`)).toBe("https://www.hellowork.com/fr-fr/emplois/56789012.html");
  });

  it("drops only the usual tracking parameters of any other site", () => {
    expect(offerLink("https://careers.example.com/jobs/1234?lang=fr&utm_source=newsletter&gclid=abc")).toBe("https://careers.example.com/jobs/1234?lang=fr");
  });

  it("gives no link for what is not one (a mailto, a relative path, words)", () => {
    expect(offerLink("mailto:jeanne@example.com")).toBeNull();
    expect(offerLink("/emploi/123")).toBeNull();
    expect(offerLink("Voir l'offre")).toBeNull();
  });
});
