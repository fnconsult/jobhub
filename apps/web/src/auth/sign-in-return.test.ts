import { describe, expect, it } from "vitest";
import { safeReturnPath, signInHref } from "./sign-in-return";

describe("the page sign-in brings back to", () => {
  it.each(["/compte", "/recherches?profil=3", "/candidatures/12#notes"])("keeps %s, a path of this site", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "compte", "/a\nb", "", null])("refuses %s", (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });
});

describe("the sign-in address", () => {
  it("brings back to the page, and says the session expired", () => {
    expect(signInHref("/compte/preferences", true)).toBe("/connexion?suite=%2Fcompte%2Fpreferences&raison=session-expiree");
  });

  it("is plain sign-in for a first visit with no page to come back to", () => {
    expect(signInHref(null, false)).toBe("/connexion");
    expect(signInHref("//evil.example", false)).toBe("/connexion");
  });
});
