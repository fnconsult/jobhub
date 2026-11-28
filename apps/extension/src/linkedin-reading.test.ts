import type { LinkedInReading } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import type { JobbboxApi, LinkedInReadingKept } from "./jobbbox-api";
import { linkedInReadMessage, readLinkedInTab } from "./linkedin-reading";

const reading: LinkedInReading = {
  page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie-fictive/people/" },
  company: "Exemple Industrie Fictive",
  department: "Achats",
  people: [{ name: "Camille Fictive", role: "Responsable achats", company: "Exemple Industrie Fictive" }],
};

/** The web app keeping Readings: what it answers, and what it was sent. */
function keeping(answer: Awaited<ReturnType<JobbboxApi["keepLinkedInReading"]>>) {
  const sent: LinkedInReading[] = [];
  const api: Pick<JobbboxApi, "keepLinkedInReading"> = {
    async keepLinkedInReading(read) {
      sent.push(read);
      return answer;
    },
  };
  return { api, sent };
}

const kept = (overrides: Partial<LinkedInReadingKept> = {}): LinkedInReadingKept => ({
  company: "Exemple Industrie Fictive",
  peopleRead: 1,
  peopleKept: 1,
  filedIn: [{ kind: "application", id: "a-1", name: "Acheteur industriel H/F" }],
  ...overrides,
});

describe("reading the LinkedIn page in view, on the Candidate's click (ADR-0119, #1164)", () => {
  it("reads the page once, sends its Reading, and says where its people went", async () => {
    const web = keeping({ ok: true, ...kept() });
    let reads = 0;
    const outcome = await readLinkedInTab({ read: async () => (reads++, reading), api: web.api });

    expect(reads).toBe(1);
    expect(web.sent).toEqual([reading]);
    expect(outcome).toEqual({ state: "kept", ...kept() });
  });

  it("sends nothing when the page cannot be read (not one a Reading may be of, or the browser refused)", async () => {
    const web = keeping({ ok: true, ...kept() });
    expect(await readLinkedInTab({ read: async () => null, api: web.api })).toEqual({ state: "unreadable" });
    expect(await readLinkedInTab({ read: async () => Promise.reject(new Error("Cannot access contents of the page")), api: web.api })).toEqual({ state: "unreadable" });
    expect(web.sent).toEqual([]);
  });

  it("passes on why Jobbbox kept nothing", async () => {
    const web = keeping({ ok: false, error: "disabled" });
    expect(await readLinkedInTab({ read: async () => reading, api: web.api })).toEqual({ state: "failed", error: "disabled" });
  });
});

describe("what the Side Panel says of a LinkedIn Reading", () => {
  const { t } = createI18n("fr");
  const en = createI18n("en").t;

  it("names how many people were kept, at which company, and the Application or Target Company they went to", () => {
    expect(linkedInReadMessage({ state: "kept", ...kept() }, t)).toEqual({ text: "1 personne gardée chez Exemple Industrie Fictive : la candidature « Acheteur industriel H/F »." });
    const both = kept({ peopleKept: 3, filedIn: [...kept().filedIn, { kind: "target_company", id: "t-1", name: "Exemple Industrie Fictive" }] });
    expect(linkedInReadMessage({ state: "kept", ...both }, t).text).toBe(
      "3 personnes gardées chez Exemple Industrie Fictive : la candidature « Acheteur industriel H/F », l'entreprise cible « Exemple Industrie Fictive ».",
    );
    expect(linkedInReadMessage({ state: "kept", ...both }, en).text).toBe(
      "3 people kept at Exemple Industrie Fictive: the application “Acheteur industriel H/F”, the target company “Exemple Industrie Fictive”.",
    );
  });

  it("says when nobody is named on the page, and when nobody was kept for want of an Application or a Target Company", () => {
    expect(linkedInReadMessage({ state: "kept", ...kept({ peopleRead: 0, peopleKept: 0 }) }, t).text).toBe("Page lue : Exemple Industrie Fictive. Aucune personne n'y est nommée.");
    expect(linkedInReadMessage({ state: "kept", ...kept({ peopleKept: 0, filedIn: [] }) }, t).text).toMatch(/^Personne n'est gardé : Exemple Industrie Fictive n'est l'employeur/);
  });

  it("says, as an error, a page it cannot read and a reading Jobbbox refused", () => {
    expect(linkedInReadMessage({ state: "unreadable" }, t)).toEqual({ text: t("extension.linkedIn.unreadable"), error: true });
    expect(linkedInReadMessage({ state: "failed", error: "disabled" }, t)).toEqual({ text: t("extension.linkedIn.disabled"), error: true });
    expect(linkedInReadMessage({ state: "failed", error: "unreachable" }, t)).toEqual({ text: t("extension.unreachable"), error: true });
    expect(linkedInReadMessage({ state: "failed", error: "refused" }, t)).toEqual({ text: t("extension.installationNotRecognised"), error: true });
    expect(linkedInReadMessage({ state: "failed", error: "signed_out" }, t)).toEqual({ text: t("extension.signedOut"), error: true });
    expect(linkedInReadMessage({ state: "failed", error: "invalid" }, t)).toEqual({ text: t("extension.linkedIn.unreadable"), error: true });
  });
});
