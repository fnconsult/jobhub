// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox, Field, KeyValueRow, Radio, SegmentedControl, Select, Switch, Textarea, TextInput } from "./Field";
import { Pill } from "./Pill";
import { renderInFrench } from "./testing";

/** The text of the elements an element's aria-describedby names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

describe("Field (#462)", () => {
  it("names its control by its label and describes it with its hint", () => {
    renderInFrench(
      <Field label="Intitulé du poste" hint="Tel qu'il apparaît sur votre CV.">
        <TextInput defaultValue="Head of BU" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Intitulé du poste" });
    expect(description(input)).toBe("Tel qu'il apparaît sur votre CV.");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks its control invalid and reads it the error, after the hint", () => {
    renderInFrench(
      <Field label="Salaire minimum" hint="En euros par an." error="Saisissez un montant en euros, par exemple 80 000.">
        <TextInput defaultValue="quatre-vingt" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Salaire minimum" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toBe("En euros par an. Saisissez un montant en euros, par exemple 80 000.");
  });

  it("labels a select and a textarea the same way", () => {
    renderInFrench(
      <>
        <Field label="Lieu">
          <Select defaultValue="idf">
            <option value="idf">Île-de-France</option>
            <option value="75">Paris (75)</option>
          </Select>
        </Field>
        <Field label="Message au coach">
          <Textarea defaultValue="Je vise les ESN." />
        </Field>
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Lieu" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message au coach" })).toBeTruthy();
  });
});

describe("Checkbox, Radio and Switch (#462)", () => {
  it("toggle with Space, each named by its words", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderInFrench(
      <>
        <Checkbox label="CDI" />
        <Radio name="remote" label="Télétravail partiel" />
        <Switch label="Recevoir le Job Digest chaque lundi" checked={false} onCheckedChange={onCheckedChange} />
      </>,
    );
    await user.tab();
    await user.keyboard(" ");
    expect((screen.getByRole("checkbox", { name: "CDI" }) as HTMLInputElement).checked).toBe(true);
    await user.tab();
    await user.keyboard(" ");
    expect((screen.getByRole("radio", { name: "Télétravail partiel" }) as HTMLInputElement).checked).toBe(true);
    await user.tab();
    const toggle = screen.getByRole("switch", { name: "Recevoir le Job Digest chaque lundi" });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("a Checkbox or Radio with a hint (#466)", () => {
  it("describes its box with the hint under its words", () => {
    renderInFrench(
      <>
        <Checkbox name="roles" value="support" label="Support" hint="Lit les signalements et y répond." />
        <Radio name="kind" value="percent" label="Pourcentage" hint="De 1 à 100 %." />
      </>,
    );
    expect(description(screen.getByRole("checkbox", { name: "Support" }))).toBe("Lit les signalements et y répond.");
    expect(description(screen.getByRole("radio", { name: "Pourcentage" }))).toBe("De 1 à 100 %.");
  });
});

function Period() {
  const [value, setValue] = useState("week");
  return (
    <>
      <SegmentedControl
        label="Période"
        value={value}
        onValueChange={setValue}
        options={[
          { value: "week", label: "Semaine" },
          { value: "month", label: "Mois" },
          { value: "year", label: "Année" },
        ]}
      />
      <button type="button">Après</button>
    </>
  );
}

describe("SegmentedControl (#462)", () => {
  it("takes one Tab stop, on the chosen option", async () => {
    const user = userEvent.setup();
    renderInFrench(<Period />);
    expect(screen.getByRole("radiogroup", { name: "Période" })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Semaine" }));
    expect(screen.getByRole("radio", { name: "Semaine" }).getAttribute("aria-checked")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Après" }));
  });

  it("moves the choice and the focus with the arrow keys, wrapping round, Home and End to the ends", async () => {
    const user = userEvent.setup();
    renderInFrench(<Period />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    const month = screen.getByRole("radio", { name: "Mois" });
    expect(document.activeElement).toBe(month);
    expect(month.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Semaine" }).getAttribute("aria-checked")).toBe("false");
    await user.keyboard("{ArrowDown}{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Semaine" }));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Année" }));
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "Semaine" }).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Année" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("KeyValueRow (#462)", () => {
  it("names its control by its key and shows where the value comes from", () => {
    renderInFrench(
      <KeyValueRow label="Budget mensuel" source={<Pill tone="success">Back Office</Pill>}>
        <TextInput defaultValue="2,00 €" />
      </KeyValueRow>,
    );
    expect(screen.getByRole("textbox", { name: "Budget mensuel" })).toBeTruthy();
    expect(screen.getByText("Back Office")).toBeTruthy();
  });
});
