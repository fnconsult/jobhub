import { describe, expect, it } from "vitest";
import { authenticationResults } from "./fixtures/inbound-emails";
import { SEEDED_RECOGNISED_SENDERS, senderStanding, type RecognisedSender } from "./recognised-senders";

const platform: RecognisedSender[] = [
  { match: "domain", value: "cadremploi.fr", label: "Cadremploi – cadremploi.fr" },
  { match: "domain", value: "diffusion.apec.fr", label: "APEC – apec.fr", aligned: true },
  { match: "address", value: "capgemitecp3-jobnotification@noreply12.jobs2web.com", label: "Capgemini – careers.capgemini.com" },
];
const standing = (from: string, results: string, sendingAddresses: string[] = ["marie.dupont@example.fr"]) =>
  senderStanding({ from, authenticationResults: results }, { recognisedSenders: platform, sendingAddresses });

describe("whose emails Email intake reads", () => {
  it("a Recognised sender's domain, or one under it, when DMARC passed for it", () => {
    expect(standing("offres@alertes.cadremploi.fr", authenticationResults("alertes.cadremploi.fr"))).toBe("recognised_sender");
    expect(standing("offres@cadremploi.fr", authenticationResults("cadremploi.fr"))).toBe("recognised_sender");
  });

  it("not one whose DMARC failed or was not checked, nor a look-alike domain", () => {
    expect(standing("offres@alertes.cadremploi.fr", authenticationResults("alertes.cadremploi.fr", { dmarc: "fail" }))).toBe("unrecognised");
    expect(standing("offres@alertes.cadremploi.fr", "")).toBe("unrecognised");
    expect(standing("offres@faux-cadremploi.fr", authenticationResults("faux-cadremploi.fr"))).toBe("unrecognised");
  });

  it("not one whose DMARC passed for another domain than its From", () => {
    expect(standing("offres@alertes.cadremploi.fr", "mx.jobbbox.test; dmarc=pass header.from=pirate.test")).toBe("unrecognised");
  });

  it("aligned SPF or DKIM only for a sender listed so (diffusion.apec.fr)", () => {
    const apecDkim = "mx.jobbbox.test; dkim=pass header.d=apec.fr; spf=none; dmarc=none header.from=diffusion.apec.fr";
    const apecSpf = "mx.jobbbox.test; dkim=none; spf=pass smtp.mailfrom=retour@bounce.apec.fr; dmarc=none header.from=diffusion.apec.fr";
    const unaligned = "mx.jobbbox.test; dkim=pass header.d=sendgrid.net; dmarc=none header.from=diffusion.apec.fr";
    expect(standing("noreply@diffusion.apec.fr", apecDkim)).toBe("recognised_sender");
    expect(standing("noreply@diffusion.apec.fr", apecSpf)).toBe("recognised_sender");
    expect(standing("noreply@diffusion.apec.fr", unaligned)).toBe("unrecognised");
    expect(standing("offres@alertes.cadremploi.fr", "mx.jobbbox.test; dkim=pass header.d=cadremploi.fr; dmarc=none header.from=alertes.cadremploi.fr")).toBe("unrecognised");
  });

  it("a shared sending platform only by its full address", () => {
    expect(standing("capgemitecp3-jobnotification@noreply12.jobs2web.com", authenticationResults("noreply12.jobs2web.com"))).toBe("recognised_sender");
    expect(standing("autre-jobnotification@noreply12.jobs2web.com", authenticationResults("noreply12.jobs2web.com"))).toBe("unrecognised");
  });

  it("a manual forward from one of the Candidate's own sending addresses, authenticated", () => {
    expect(standing("marie.dupont@example.fr", authenticationResults("example.fr"))).toBe("own_address");
    expect(standing("marie.dupont@example.fr", "mx.jobbbox.test; dkim=pass header.d=example.fr; dmarc=none header.from=example.fr")).toBe("own_address");
    expect(standing("marie.dupont@example.fr", authenticationResults("example.fr", { dmarc: "fail", dkim: null }))).toBe("unrecognised");
    expect(standing("jean.martin@example.fr", authenticationResults("example.fr"))).toBe("unrecognised");
  });

  it("Gmail's forwarding confirmation, kept for the setup wizard", () => {
    expect(standing("forwarding-noreply@google.com", authenticationResults("google.com"))).toBe("forwarding_confirmation");
    expect(standing("forwarding-noreply@google.com", authenticationResults("google.com", { dmarc: "fail", dkim: null }))).toBe("unrecognised");
  });

  it("reads the methods whatever their case or spacing", () => {
    expect(standing("offres@alertes.cadremploi.fr", "mx.jobbbox.test;\r\n\tDMARC=Pass (p=REJECT sp=REJECT dis=NONE) Header.From=Alertes.Cadremploi.fr")).toBe("recognised_sender");
  });
});

describe("the platform's Recognised senders at first", () => {
  it("are the corpus's job boards and careers sites, each labelled, apec's by aligned SPF or DKIM", () => {
    expect(SEEDED_RECOGNISED_SENDERS.map(({ match, value }) => `${match}:${value}`)).toEqual([
      "domain:linkedin.com",
      "domain:indeed.com",
      "domain:cadremploi.fr",
      "domain:hellowork.com",
      "domain:welcometothejungle.com",
      "domain:jobijoba.com",
      "domain:free-work.com",
      "domain:experteer.com",
      "domain:francetravail.fr",
      "domain:diffusion.apec.fr",
      "address:capgemitecp3-jobnotification@noreply12.jobs2web.com",
      "address:canal+group-jobnotification@noreply2.jobs2web.com",
    ]);
    expect(SEEDED_RECOGNISED_SENDERS.filter((sender) => sender.aligned).map(({ value }) => value)).toEqual(["diffusion.apec.fr"]);
    for (const sender of SEEDED_RECOGNISED_SENDERS) expect(sender.label, sender.value).toMatch(/^.+ – .+\..+$/);
  });
});
