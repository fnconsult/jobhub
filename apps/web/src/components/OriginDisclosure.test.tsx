// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderInFrench } from "@/design/testing";
import { OriginDisclosure } from "./OriginDisclosure";

describe("the « Origine » disclosure (#715, ADR-0077)", () => {
  it("says nothing until opened, then that the AI Coach proposed it and the Candidate applied it, and when", async () => {
    const { container } = renderInFrench(<OriginDisclosure appliedAt="2026-11-04T17:20:00.000Z" />);
    const details = container.querySelector("details")!;

    expect(details.open).toBe(false);
    await userEvent.click(screen.getByText("Origine"));

    expect(details.open).toBe(true);
    expect(details.textContent).toContain("Sur proposition de votre coach IA, appliqué par vous le 4 novembre 2026 à 18:20");
  });

  it("is not there for an element with no Origin", () => {
    const { container } = renderInFrench(<OriginDisclosure appliedAt={null} />);
    expect(container.textContent).toBe("");
  });
});
