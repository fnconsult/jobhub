import { describe, expect, it } from "vitest";
import { appleFailureEmail } from "./alerts";

describe("the alert of a failed Apple client secret", () => {
  it("tells the super-admins which provider, why, and where to fix it, in French", () => {
    const email = appleFailureEmail([{ id: "apple", reason: "invalid_apple_key" }], "https://app.jobbbox.fr");

    expect(email.subject).toBe("Jobbbox : la connexion avec Apple doit être réparée");
    expect(email.text).toContain("apple");
    expect(email.text).toContain("La clé .p8");
    expect(email.text).toContain("https://app.jobbbox.fr/admin/parametres?tab=connexion");
  });

  it("names each provider that failed", () => {
    const email = appleFailureEmail(
      [
        { id: "apple", reason: "missing_secret" },
        { id: "apple", reason: "no_master_key" },
      ],
      "https://app.jobbbox.fr",
    );

    expect(email.text.match(/^- apple/gm)).toHaveLength(2);
  });
});
