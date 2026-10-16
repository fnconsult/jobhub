import { describe, expect, it } from "vitest";
import { signInCopy } from "./sign-in-copy";

describe("sign-in page copy", () => {
  it("does not mention Google when Google sign-in is not configured", () => {
    const copy = signInCopy({ googleEnabled: false }, "fr");
    expect(copy.intro).toBe(
      "Pas de mot de passe à retenir : recevez un lien de connexion par e-mail. Si vous n'avez pas encore de compte, il sera créé.",
    );
    expect(copy.notice).toBeNull();
  });

  it("offers the Google account when Google sign-in is configured", () => {
    expect(signInCopy({ googleEnabled: true }, "fr").intro).toBe(
      "Pas de mot de passe à retenir : recevez un lien de connexion par e-mail, ou utilisez votre compte Google. Si vous n'avez pas encore de compte, il sera créé.",
    );
  });

  it("says it in English", () => {
    expect(signInCopy({ googleEnabled: false }, "en").intro).toBe(
      "No password to remember: get a sign-in link by email. If you don't have an account yet, one will be created.",
    );
    expect(signInCopy({ googleEnabled: true }, "en").intro).toBe(
      "No password to remember: get a sign-in link by email, or use your Google account. If you don't have an account yet, one will be created.",
    );
  });

  it("asks for a new link when a sign-in link is no longer valid", () => {
    for (const error of ["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]) {
      expect(signInCopy({ googleEnabled: true, error }, "fr").notice).toBe(
        "Ce lien de connexion n'est plus valable. Demandez-en un nouveau ci-dessous.",
      );
    }
  });

  it("after a failed sign-in, suggests Google only when Google sign-in is configured", () => {
    expect(signInCopy({ googleEnabled: true, error: "access_denied" }, "fr").notice).toBe(
      "La connexion n'a pas abouti. Réessayez ci-dessous, avec Google ou en recevant un lien par e-mail.",
    );
    expect(signInCopy({ googleEnabled: false, error: "access_denied" }, "fr").notice).toBe(
      "La connexion n'a pas abouti. Réessayez ci-dessous en recevant un lien par e-mail.",
    );
    expect(signInCopy({ googleEnabled: false, error: "access_denied" }, "en").notice).toBe(
      "Sign-in didn't go through. Try again below with a link by email.",
    );
  });
});
