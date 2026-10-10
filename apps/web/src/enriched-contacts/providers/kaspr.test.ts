import { describe, expect, it } from "vitest";
import { createKasprProvider } from "./kaspr";
import { recordedFetch } from "./recorded-fetch";

/** The profile answer as Kaspr's integrator guides show it (UNCONFIRMED, see docs/research/issue-23.md). Names made up. */
const PROFILE_ANSWER = {
  profile: {
    id: "claire-martin-example",
    name: "Claire Martin",
    title: "DRH",
    company: { name: "Acme Industrie" },
    professionalEmails: ["claire.martin@acme-industrie.fr"],
    personalEmails: ["claire.martin@gmail.example"],
    phones: ["+33 6 00 00 00 00"],
  },
};

describe("Kaspr adapter", () => {
  it("offers no search by company and job title: Kaspr only enriches a known profile", () => {
    expect(createKasprProvider({ apiKey: "k", fetch: recordedFetch().fetch }).findPeople).toBeNull();
  });

  it("reveals a profile's work emails and phones, never its personal emails", async () => {
    const api = recordedFetch({ body: PROFILE_ANSWER });
    const kaspr = createKasprProvider({ apiKey: "kaspr-test-key", fetch: api.fetch });

    expect(await kaspr.getContactDetails({ providerPersonId: "claire-martin-example" })).toEqual({
      providerPersonId: "claire-martin-example",
      name: "Claire Martin",
      jobTitle: "DRH",
      emails: ["claire.martin@acme-industrie.fr"],
      phones: ["+33 6 00 00 00 00"],
    });
    const [request] = api.requests;
    expect(request!.url).toBe("https://api.developers.kaspr.io/profile/linkedin");
    expect(request!.headers.authorization).toBe("Bearer kaspr-test-key");
    expect(request!.body).toEqual({ id: "claire-martin-example" });
  });

  it("gives null when Kaspr has no such profile", async () => {
    const kaspr = createKasprProvider({ apiKey: "k", fetch: recordedFetch({ status: 404, body: { message: "Not found" } }).fetch });
    expect(await kaspr.getContactDetails({ providerPersonId: "nobody" })).toBeNull();
  });

  it("reports a refused key as a provider error", async () => {
    const kaspr = createKasprProvider({ apiKey: "bad", fetch: recordedFetch({ status: 403, body: {} }).fetch });
    await expect(kaspr.getContactDetails({ providerPersonId: "x" })).rejects.toMatchObject({ provider: "kaspr", reason: "unauthorized" });
  });
});
