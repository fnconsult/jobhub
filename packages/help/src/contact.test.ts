import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL_TOKEN, fillContactEmail } from "./contact";

describe("fillContactEmail (#552)", () => {
  it("writes the address in as a mailto link wherever the text has the token", () => {
    expect(fillContactEmail(`Écrivez à ${CONTACT_EMAIL_TOKEN}, ou à ${CONTACT_EMAIL_TOKEN}.`, " bonjour@jobbbox.fr ", "fr")).toBe(
      "Écrivez à [bonjour@jobbbox.fr](mailto:bonjour@jobbbox.fr), ou à [bonjour@jobbbox.fr](mailto:bonjour@jobbbox.fr).",
    );
  });

  it("without an address, sends the reader to the legal notice, in their language", () => {
    expect(fillContactEmail(`Écrivez à ${CONTACT_EMAIL_TOKEN}.`, undefined, "fr")).toBe("Écrivez à l'adresse indiquée dans les mentions légales.");
    expect(fillContactEmail(`Write to ${CONTACT_EMAIL_TOKEN}.`, "", "en")).toBe("Write to the address given in the legal notice.");
  });

  it("writes the bare address for a text shown without Markdown", () => {
    expect(fillContactEmail(`Écrivez à ${CONTACT_EMAIL_TOKEN}.`, "bonjour@jobbbox.fr", "fr", { plain: true })).toBe("Écrivez à bonjour@jobbbox.fr.");
  });

  it("leaves a text without the token alone", () => {
    expect(fillContactEmail("Rien à remplir.", "bonjour@jobbbox.fr", "fr")).toBe("Rien à remplir.");
  });
});
