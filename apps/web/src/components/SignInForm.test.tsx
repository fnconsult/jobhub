// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { SignInForm } from "./SignInForm";

const { magicLink, emailOtp } = vi.hoisted(() => ({ magicLink: vi.fn(), emailOtp: vi.fn() }));
vi.mock("@/auth/client", () => ({ authClient: { signIn: { magicLink, emailOtp, social: vi.fn() } } }));

/** Better Auth's answer to a refused code (email OTP plugin). */
const refused = (code: "INVALID_OTP" | "OTP_EXPIRED" | "TOO_MANY_ATTEMPTS") => ({ data: null, error: { code, status: code === "TOO_MANY_ATTEMPTS" ? 403 : 400 } });

async function emailSentTo(address: string) {
  renderInFrench(<SignInForm providers={[]} callbackURL="/compte" errorURL="/connexion" />);
  await userEvent.type(screen.getByLabelText("Votre adresse e-mail"), address);
  await userEvent.click(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));
  await screen.findByLabelText("Saisir le code reçu par e-mail");
}

async function enterCode(code: string) {
  const field = screen.getByLabelText("Saisir le code reçu par e-mail");
  await userEvent.clear(field);
  await userEvent.type(field, code);
  await userEvent.click(screen.getByRole("button", { name: "Me connecter avec ce code" }));
  await screen.findByRole("alert");
}

const resendButton = () => screen.queryByRole("button", { name: "Recevoir un nouvel e-mail" });

describe("SignInForm — the sign-in email's code, refused (#755)", () => {
  beforeEach(() => {
    magicLink.mockReset().mockResolvedValue({ data: { status: true }, error: null });
    emailOtp.mockReset();
  });

  it("keeps « Recevoir un nouvel e-mail » once the code is spent, a code typed after it refused as wrong", async () => {
    await emailSentTo("camille@example.com");
    emailOtp.mockResolvedValueOnce(refused("TOO_MANY_ATTEMPTS")).mockResolvedValueOnce(refused("INVALID_OTP"));

    await enterCode("123456");
    expect(resendButton()).toBeTruthy();
    // Better Auth deleted the code: any code typed now is refused as wrong.
    await enterCode("654321");
    expect(screen.getByRole("alert").textContent).toContain("Ce code ne convient pas");
    expect(resendButton()).toBeTruthy();
  });

  it("offers a new email after a code refused as wrong, which may be one that no longer exists", async () => {
    await emailSentTo("camille@example.com");
    expect(resendButton()).toBeNull();
    emailOtp.mockResolvedValueOnce(refused("INVALID_OTP"));

    await enterCode("123456");
    expect(resendButton()).toBeTruthy();
  });

  it("still offers it once the new email is sent", async () => {
    await emailSentTo("camille@example.com");
    emailOtp.mockResolvedValueOnce(refused("OTP_EXPIRED"));
    await enterCode("123456");

    await userEvent.click(resendButton()!);

    expect(magicLink).toHaveBeenCalledTimes(2);
    expect(magicLink).toHaveBeenLastCalledWith(expect.objectContaining({ email: "camille@example.com" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(resendButton()).toBeTruthy();
  });
});
