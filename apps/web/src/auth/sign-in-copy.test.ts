import { describe, expect, it } from "vitest";
import { signInCopy } from "./sign-in-copy";

describe("sign-in page copy", () => {
  it("mentions no provider when only the magic link is offered", () => {
    const copy = signInCopy({ providers: [] }, "fr");
    expect(copy.intro).toBe(
      "Pas de mot de passe à retenir : recevez un lien de connexion par e-mail. Si vous n'avez pas encore de compte, il sera créé.",
    );
    expect(copy.notice).toBeNull();
  });

  it("names the providers shown on the page", () => {
    expect(signInCopy({ providers: ["Google"] }, "fr").intro).toBe(
      "Pas de mot de passe à retenir : recevez un lien de connexion par e-mail, ou utilisez votre compte Google. Si vous n'avez pas encore de compte, il sera créé.",
    );
    expect(signInCopy({ providers: ["Google", "Apple", "Microsoft"] }, "fr").intro).toBe(
      "Pas de mot de passe à retenir : recevez un lien de connexion par e-mail, ou utilisez votre compte Google, Apple ou Microsoft. Si vous n'avez pas encore de compte, il sera créé.",
    );
  });

  it("says it in English", () => {
    expect(signInCopy({ providers: [] }, "en").intro).toBe(
      "No password to remember: get a sign-in link by email. If you don't have an account yet, one will be created.",
    );
    expect(signInCopy({ providers: ["Google", "Microsoft"] }, "en").intro).toBe(
      "No password to remember: get a sign-in link by email, or use your Google or Microsoft account. If you don't have an account yet, one will be created.",
    );
  });

  it("asks for a new link when a sign-in link is no longer valid", () => {
    for (const error of ["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]) {
      expect(signInCopy({ providers: ["Google"], error }, "fr").notice).toBe("Ce lien de connexion n'est plus valable. Demandez-en un nouveau ci-dessous.");
    }
  });

  it("after a failed sign-in, suggests the providers only when there are some", () => {
    expect(signInCopy({ providers: ["Google"], error: "access_denied" }, "fr").notice).toBe(
      "La connexion n'a pas abouti. Réessayez ci-dessous, avec Google ou en recevant un lien par e-mail.",
    );
    expect(signInCopy({ providers: [], error: "access_denied" }, "fr").notice).toBe("La connexion n'a pas abouti. Réessayez ci-dessous en recevant un lien par e-mail.");
    expect(signInCopy({ providers: [], error: "access_denied" }, "en").notice).toBe("Sign-in didn't go through. Try again below with a link by email.");
  });

  it("asks a person with an account to sign in by magic link first, then link the provider from Mon compte", () => {
    expect(signInCopy({ providers: ["Jobbbox SSO"], error: "account_not_linked" }, "fr").notice).toBe(
      "Un compte Jobbbox utilise déjà cette adresse e-mail. Connectez-vous d'abord en recevant un lien par e-mail, puis associez ce moyen de connexion à votre compte depuis « Mon compte ».",
    );
  });

  it("says a provider for the Jobbbox team is not for Candidates", () => {
    expect(signInCopy({ providers: [], error: "provider_not_allowed" }, "fr").notice).toBe(
      "Ce moyen de connexion est réservé à l'équipe Jobbbox. Connectez-vous ci-dessous en recevant un lien par e-mail.",
    );
  });
});
