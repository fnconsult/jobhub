// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileUpload } from "./FileUpload";
import { I18nProvider } from "@/i18n/I18nProvider";
import { renderInFrench } from "./testing";

const RULES = { maxBytes: 10 * 1024 * 1024, extensions: ["pdf", "docx"] };
const MESSAGES = { too_large: "Ce fichier dépasse 10 Mo.", unsupported_format: "Ce fichier n'est pas un PDF." };

function upload(props: Partial<Parameters<typeof FileUpload>[0]> = {}) {
  return renderInFrench(
    <FileUpload name="cv" label="Votre CV" prompt="Glissez votre CV ici" hint="PDF ou Word, 10 Mo maximum." rules={RULES} problems={MESSAGES} {...props} />,
  );
}

const pdf = (size: number, name = "CV-Marie.pdf") => {
  const file = new File(["%PDF"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("FileUpload (#468)", () => {
  it("shows the chosen file's row, its name and size, and tells the page", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    upload({ onChange });
    const file = pdf(412_000);
    await user.upload(screen.getByLabelText("Votre CV"), file);
    expect(screen.getByText("CV-Marie.pdf")).toBeTruthy();
    expect(screen.getByText("402 Ko")).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(file);
    expect(screen.queryByText("Glissez votre CV ici")).toBeNull();
  });

  it("says why a file over the limit is refused, as a Note, and keeps the drop zone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    upload({ onChange });
    await user.upload(screen.getByLabelText("Votre CV"), pdf(10 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert").textContent).toContain("Ce fichier dépasse 10 Mo.");
    expect(screen.getByText("Glissez votre CV ici")).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect((screen.getByLabelText("Votre CV") as HTMLInputElement).value).toBe("");
  });

  it("goes back to the drop zone when the chosen file is removed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    upload({ onChange });
    await user.upload(screen.getByLabelText("Votre CV"), pdf(1000));
    await user.click(screen.getByRole("button", { name: "Retirer CV-Marie.pdf" }));
    expect(screen.getByText("Glissez votre CV ici")).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("highlights the drop zone while a file is dragged over it", () => {
    upload();
    const zone = screen.getByText("Glissez votre CV ici").closest("[data-drop-zone]")!;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone.getAttribute("data-over")).toBe("true");
    fireEvent.dragLeave(zone);
    expect(zone.getAttribute("data-over")).toBeNull();
  });

  it("refuses a dropped file of another format", () => {
    upload();
    const zone = screen.getByText("Glissez votre CV ici").closest("[data-drop-zone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "photo.png")], types: ["Files"] } });
    expect(screen.getByRole("alert").textContent).toContain("Ce fichier n'est pas un PDF.");
  });

  it("while the file is read, says so beside its glyph, with a progress bar and a Stop named for what it stops", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { rerender } = upload();
    await user.upload(screen.getByLabelText("Votre CV"), pdf(1000));
    rerender(
      <I18nProvider locale="fr">
        <FileUpload
          name="cv"
          label="Votre CV"
          prompt="Glissez votre CV ici"
          hint="PDF ou Word, 10 Mo maximum."
          rules={RULES}
          problems={MESSAGES}
          reading={{ label: "Lecture de votre CV en cours…", stopLabel: "Arrêter la lecture du CV", onStop }}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("Lecture de votre CV en cours…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Lecture de votre CV en cours…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retirer CV-Marie.pdf" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Arrêter la lecture du CV" }));
    expect(onStop).toHaveBeenCalled();
  });
});
