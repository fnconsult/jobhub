// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { TwoStepSetup } from "./TwoStepSetup";
import { TwoStepVerificationSettings } from "./TwoStepVerificationSettings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ON = {
  enabledAt: new Date("2026-11-02T09:30:00Z"),
  factors: [
    { kind: "authenticator_app" as const, addedAt: new Date("2026-11-02T09:30:00Z"), lastUsedAt: null },
    { kind: "backup_codes" as const, addedAt: new Date("2026-11-02T09:30:00Z"), lastUsedAt: null },
  ],
  backupCodesLeft: 10,
};

describe("Mon compte, « Sécurité »: Two-step verification", () => {
  it("lets a Candidate turn it off", () => {
    renderInFrench(<TwoStepVerificationSettings status={ON} locale="fr" mandatory={false} />);

    expect(screen.getByRole("button", { name: "Désactiver" })).toBeTruthy();
    expect(screen.queryByText(/obligatoire/)).toBeNull();
  });

  it("has no « Désactiver » for an Administrator or a Human Coach, and says why (#665)", () => {
    renderInFrench(<TwoStepVerificationSettings status={ON} locale="fr" mandatory />);

    expect(screen.queryByRole("button", { name: "Désactiver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Régénérer les codes de secours" })).toBeTruthy();
    expect(screen.getByText(/obligatoire pour les administrateurs et les coachs/)).toBeTruthy();
  });
});

describe("Setting it up before anything else, on the second step's page (#665)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts with the QR code and the key, confirms the app's first code, shows the backup codes once, then goes on", async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ method: init.method ?? "GET", url, ...(typeof init.body === "string" ? { body: init.body } : {}) });
        if (init.method === "POST") return Response.json({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: "otpauth://totp/Jobbbox:claire?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
        return Response.json({ backupCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] });
      }),
    );
    const onDone = vi.fn();
    renderInFrench(<TwoStepSetup endpoint="/api/two-step-verification/setup" onDone={onDone} />);
    const user = userEvent.setup();

    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    await user.type(screen.getByLabelText("Code affiché par l'application"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByText("aaaaa-bbbbb")).toBeTruthy();
    expect(calls).toEqual([
      { method: "POST", url: "/api/two-step-verification/setup" },
      { method: "PUT", url: "/api/two-step-verification/setup", body: JSON.stringify({ code: "123456" }) },
    ]);
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "J'ai gardé mes codes" }));
    expect(onDone).toHaveBeenCalled();
  });
});
