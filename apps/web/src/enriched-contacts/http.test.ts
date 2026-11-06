import { enrichedContactsResponseSchema } from "@jobhub/shared/reads";
import { describe, expect, it } from "vitest";
import { enrichedContactsRead } from "./http";

describe("the Enriched Contacts, as their GET answers the app (ADR-0076, #691)", () => {
  it("answers the people found and the Enriched Contacts with where and when their details were obtained, never the provider's own ids", () => {
    const foundAt = new Date("2026-11-01T10:00:00.000Z");
    const read = enrichedContactsResponseSchema.parse(
      JSON.parse(
        JSON.stringify(
          enrichedContactsRead({
            enabled: true,
            searchable: true,
            found: [{ id: "c1", name: "Paul Martin", source: { provider: "lusha", providerPersonId: "lusha-1", foundAt } }],
            contacts: [
              {
                id: "c2",
                name: "Claire Durand",
                jobTitle: "DRH",
                emails: ["claire.durand@acme.fr"],
                phones: ["+33 4 72 00 00 00"],
                source: { provider: "lusha", providerPersonId: "lusha-2", foundAt, retrievedAt: new Date("2026-11-02T08:00:00.000Z") },
              },
            ],
          }),
        ),
      ),
    );
    expect(read).toEqual({
      enabled: true,
      searchable: true,
      found: [{ id: "c1", name: "Paul Martin", jobTitle: null }],
      contacts: [
        {
          id: "c2",
          name: "Claire Durand",
          jobTitle: "DRH",
          emails: ["claire.durand@acme.fr"],
          phones: ["+33 4 72 00 00 00"],
          source: { provider: "lusha", retrievedAt: "2026-11-02T08:00:00.000Z" },
        },
      ],
    });
  });
});
