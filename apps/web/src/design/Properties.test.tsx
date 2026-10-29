// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Properties, Property } from "./Properties";
import { renderInFrench } from "./testing";

describe("Properties (#466)", () => {
  it("lists each term with its value, the list named by its label", () => {
    renderInFrench(
      <Properties label="Détails">
        <Property term="Catégorie">IA</Property>
        <Property term="Module">
          <code>packages/ai</code>
        </Property>
      </Properties>,
    );
    const list = document.querySelector("dl")!;
    expect(list.getAttribute("aria-label")).toBe("Détails");
    expect([...list.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Catégorie", "Module"]);
    expect([...list.querySelectorAll("dd")].map((value) => value.textContent)).toEqual(["IA", "packages/ai"]);
  });

  it("keeps a value's language, and its metadata under it", () => {
    renderInFrench(
      <Properties>
        <Property term="Servi" lang="en" meta="Version 2, validée">
          Take a break.
        </Property>
      </Properties>,
    );
    const values = document.querySelectorAll("dd");
    expect(values).toHaveLength(2);
    expect(values[0]!.getAttribute("lang")).toBe("en");
    expect(values[1]!.textContent).toBe("Version 2, validée");
    expect(screen.getByText("Servi").tagName).toBe("DT");
  });
});
