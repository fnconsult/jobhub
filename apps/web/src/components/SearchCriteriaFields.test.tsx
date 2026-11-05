// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "@/design/Drawer";
import { renderInFrench } from "@/design/testing";
import { LocationsInput } from "./SearchCriteriaFields";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn() }) }));

const FULL = ["Lyon", "Bordeaux (33)", "Pays de la Loire", "Genève", "Remote"];

/**
 * The places in a Drawer (Radix Dialog, as « Modifier les critères » shows them). `renderedBetween`: the places are rendered
 * once more, unchanged, between « Retirer » and the new list: what a `router.refresh()` of an earlier save, committing
 * as the Candidate clicks, does to the Profile page (#776).
 */
function Places({ renderedBetween = false }: { renderedBetween?: boolean }) {
  const [value, setValue] = useState(FULL);
  const [, setRenders] = useState(0);
  function onChange(next: string[]) {
    if (!renderedBetween) return setValue(next);
    setRenders((n) => n + 1);
    setTimeout(() => setValue(next), 0);
  }
  return (
    <Drawer open title="Critères">
      <LocationsInput inline keepOne value={value} onChange={onChange} />
    </Drawer>
  );
}

const input = () => screen.getByRole("combobox", { name: "Ajouter un lieu" });

describe("LocationsInput: the focus after « Retirer » (#776)", () => {
  it("removing a place from a full list puts the focus on the input that comes back", async () => {
    const user = userEvent.setup();
    renderInFrench(<Places />);
    await user.click(screen.getByRole("button", { name: "Retirer Bordeaux (33)" }));
    expect(document.activeElement).toBe(input());
  });

  it("still does when the places render once more, unchanged, before the new list arrives", async () => {
    const user = userEvent.setup();
    renderInFrench(<Places renderedBetween />);
    await user.click(screen.getByRole("button", { name: "Retirer Bordeaux (33)" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(screen.queryAllByRole("listitem")).toHaveLength(4);
    expect(document.activeElement).toBe(input());
  });
});
