import { describe, expect, it } from "vitest";
import { matchExchange, type ApplicationLead } from "./matching";

const BENCHLING: ApplicationLead = { id: "a-benchling", employer: "Benchling", website: null, contactEmails: [], messageIds: [] };
const RENAULT: ApplicationLead = { id: "a-renault", employer: "Groupe Renault SA", website: "https://www.renaultgroup.com/", contactEmails: [], messageIds: [] };
const ACME: ApplicationLead = { id: "a-acme", employer: "Acme Industrie", website: null, contactEmails: ["claire.martin@acme-industrie.fr"], messageIds: ["<first@acme-industrie.fr>"] };

const email = (from: string, threadIds: string[] = []) => ({ from, threadIds, recognisedSender: false });

describe("an email tied to an Application by rules, never by AI (#1099, ADR-0115)", () => {
  it("ties an email from the employer's domain to its Application", () => {
    expect(matchExchange(email("jane@benchling.com"), [BENCHLING, ACME])).toEqual({ kind: "tie", applicationId: "a-benchling" });
    // A subdomain of the employer's is its domain too.
    expect(matchExchange(email("talent@mail.benchling.com"), [BENCHLING])).toEqual({ kind: "tie", applicationId: "a-benchling" });
  });

  it("ties an email from the domain of the employer's website, as its Company Dossier gives it", () => {
    expect(matchExchange(email("rh@renaultgroup.com"), [BENCHLING, RENAULT])).toEqual({ kind: "tie", applicationId: "a-renault" });
  });

  it("ties an email from one of the Application's Enriched Contacts, whatever their domain", () => {
    expect(matchExchange(email("Claire.Martin@acme-industrie.fr"), [BENCHLING, ACME])).toEqual({ kind: "tie", applicationId: "a-acme" });
  });

  it("ties an email in the thread of an Exchange already kept, before any other rule", () => {
    expect(matchExchange(email("someone@gmail.com", ["<first@acme-industrie.fr>"]), [BENCHLING, ACME])).toEqual({ kind: "tie", applicationId: "a-acme" });
  });

  it("offers an email that matches several Applications, never ties it", () => {
    const other: ApplicationLead = { ...BENCHLING, id: "a-benchling-2" };
    expect(matchExchange(email("jane@benchling.com"), [BENCHLING, other])).toEqual({ kind: "offer", applicationIds: ["a-benchling", "a-benchling-2"] });
  });

  it("offers an email whose match is weak: the domain only holds the employer's name", () => {
    const renault: ApplicationLead = { ...RENAULT, website: null };
    expect(matchExchange(email("recrutement@renault-careers.fr"), [renault, BENCHLING])).toEqual({ kind: "offer", applicationIds: ["a-renault"] });
  });

  it("matches nothing from a free mailbox's domain, from a Recognised sender's domain, or from no Application's", () => {
    const gmail: ApplicationLead = { ...BENCHLING, employer: "Gmail" };
    expect(matchExchange(email("jane@gmail.com"), [gmail])).toEqual({ kind: "none" });
    // A job board's alert stays an offer email, even for an Application at that job board.
    expect(matchExchange({ ...email("alerts@benchling.com"), recognisedSender: true }, [BENCHLING])).toEqual({ kind: "none" });
    expect(matchExchange(email("news@lemonde.fr"), [BENCHLING, RENAULT, ACME])).toEqual({ kind: "none" });
  });

  it("never matches an employer's name too short to tell it apart", () => {
    const short: ApplicationLead = { ...BENCHLING, employer: "BNP" };
    expect(matchExchange(email("rh@bnpparibas.com"), [short])).toEqual({ kind: "none" });
    expect(matchExchange(email("rh@bnp.com"), [short])).toEqual({ kind: "tie", applicationId: "a-benchling" });
  });
});
