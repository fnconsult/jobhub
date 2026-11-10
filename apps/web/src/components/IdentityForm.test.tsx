// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { IdentityForm } from "./IdentityForm";

const MARIE = { givenName: "Marie", familyName: "Dupont", preferredName: "Marie" };

describe("IdentityForm, Mon compte › Identité (#918)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Given Name, Family Name and Preferred Name, each at most 80 characters, the Preferred Name explained", () => {
    renderInFrench(<IdentityForm names={MARIE} />);

    const given = screen.getByRole("textbox", { name: "Prénom" }) as HTMLInputElement;
    const family = screen.getByRole("textbox", { name: "Nom" }) as HTMLInputElement;
    const preferred = screen.getByRole("textbox", { name: "Comment souhaitez-vous que les coachs vous appellent ?" }) as HTMLInputElement;
    expect([given.value, family.value, preferred.value]).toEqual(["Marie", "Dupont", "Marie"]);
    expect([given.maxLength, family.maxLength, preferred.maxLength]).toEqual([80, 80, 80]);
    expect(given.autocomplete).toBe("given-name");
    expect(family.autocomplete).toBe("family-name");
    expect(preferred.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Le Coach IA et vos coachs vous appellent ainsi. Laissez vide pour ne pas être appelé par un nom.").id).toBe(preferred.getAttribute("aria-describedby"));
  });

  it("starts empty for a name not given", () => {
    renderInFrench(<IdentityForm names={{ givenName: null, familyName: null, preferredName: null }} />);

    expect((screen.getByRole("textbox", { name: "Prénom" }) as HTMLInputElement).value).toBe("");
  });

  it("saves the three at once, an emptied one cleared, and shows them as kept", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ givenName: "Marie-Hélène", familyName: "Dupont", preferredName: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderInFrench(<IdentityForm names={MARIE} />);
    const user = userEvent.setup();

    const given = screen.getByRole("textbox", { name: "Prénom" });
    await user.clear(given);
    await user.type(given, " Marie-Hélène ");
    await user.clear(screen.getByRole("textbox", { name: "Comment souhaitez-vous que les coachs vous appellent ?" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/identity",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ givenName: " Marie-Hélène ", familyName: "Dupont", preferredName: "" }) }),
    );
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Enregistré.");
    expect((given as HTMLInputElement).value).toBe("Marie-Hélène");
  });

  it("says so when it could not be saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderInFrench(<IdentityForm names={MARIE} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Votre identité n'a pas pu être enregistrée. Réessayez.");
  });
});
