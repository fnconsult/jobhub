import { describe, expect, it } from "vitest";
import { createApolloProvider } from "./apollo";
import { createKasprProvider } from "./kaspr";
import { ContactProviderError } from "./types";

/** A fetch that fails as some HTTP stacks do: quoting the request, its key header included. */
const echoingFailure = (key: string) => (async () => {
  throw new Error(`request failed: headers {"x-api-key":"${key}","authorization":"Bearer ${key}"}`);
}) as never;

describe("a contact provider's error (#208)", () => {
  it.each([
    ["Apollo", (key: string) => createApolloProvider({ apiKey: key, fetch: echoingFailure(key) }).findPeople!({ companyName: "Acme", jobTitles: ["DRH"], limit: 1 })],
    ["Kaspr", (key: string) => createKasprProvider({ apiKey: key, fetch: echoingFailure(key) }).getContactDetails({ providerPersonId: "claire-martin-example" })],
  ])("from %s never carries its key", async (_, call) => {
    const key = "contact-key-0123456789abcdef";

    const error = await call(key).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ContactProviderError);
    expect((error as Error).message).not.toContain("0123456789");
    expect((error as Error).message).toContain("request failed");
  });

  it("is scrubbed of anything credential-shaped, whatever made it", () => {
    expect(new ContactProviderError("apollo", "failed", "smtp://user:hunter2@relay.example and api_key=abcdef123456").message).not.toMatch(/hunter2|abcdef123456/);
  });
});
