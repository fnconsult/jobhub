import { describe, expect, it } from "vitest";
import { signInCodeRefusal, typedSignInCode } from "./sign-in-code";

describe("the sign-in email's code, as typed (#686)", () => {
  it("is its digits, whatever a mail client or a person adds between them", () => {
    expect(typedSignInCode(" 428 193 ")).toBe("428193");
    expect(typedSignInCode("428-193")).toBe("428193");
  });

  it("says why it was refused, in the catalogue's words", () => {
    expect(signInCodeRefusal("INVALID_OTP")).toBe("signIn.codeWrong");
    expect(signInCodeRefusal("OTP_EXPIRED")).toBe("signIn.codeExpired");
    expect(signInCodeRefusal("TOO_MANY_ATTEMPTS")).toBe("signIn.codeTooManyTries");
    expect(signInCodeRefusal(undefined)).toBe("signIn.error");
    expect(signInCodeRefusal("SECOND_STEP_REQUIRED")).toBe("signIn.error");
  });
});
