// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDraft, keepChecked, keepFile, keepSelected } from "./panel-drafts";

/** The Side Panel's « Profil » select as saveForm draws it at each render: the scored Profile selected, then « nouveau profil ». */
function profileSelect(scoredProfileId: string, profileIds = ["existing"]): HTMLSelectElement {
  const select = document.createElement("select");
  for (const id of profileIds) {
    const option = document.createElement("option");
    option.value = id;
    option.selected = id === scoredProfileId;
    select.append(option);
  }
  const fromCv = document.createElement("option");
  fromCv.value = "";
  select.append(fromCv);
  document.body.replaceChildren(select);
  return select;
}

function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

describe("a choice kept across the Side Panel's renders", () => {
  it("keeps « nouveau profil à partir de ce CV » when the panel is drawn again between the choice and « Enregistrer »", () => {
    const draft = createDraft<string>();
    const first = profileSelect("existing");
    keepSelected(first, draft, "job-1");
    expect(first.value).toBe("existing");
    choose(first, "");

    // A render (another tab in view, the Guest session changed) draws the form again, the scored Profile preselected.
    const drawnAgain = profileSelect("existing");
    keepSelected(drawnAgain, draft, "job-1");
    expect(drawnAgain.value).toBe("");
  });

  it("draws the scored Profile selected for another Job Offer, after a save, or once the choice is no longer offered", () => {
    const draft = createDraft<string>();
    const first = profileSelect("a", ["a", "b"]);
    keepSelected(first, draft, "job-1");
    choose(first, "b");

    const another = profileSelect("a", ["a", "b"]);
    keepSelected(another, draft, "job-2");
    expect(another.value).toBe("a");

    const gone = profileSelect("a", ["a"]);
    keepSelected(gone, draft, "job-1");
    expect(gone.value).toBe("a");

    draft.clear();
    const saved = profileSelect("a", ["a", "b"]);
    keepSelected(saved, draft, "job-1");
    expect(saved.value).toBe("a");
  });

  it("keeps the Guest's CGU box ticked for that version only, and never ticks it for them", () => {
    const draft = createDraft<boolean>();
    const box = () => Object.assign(document.createElement("input"), { type: "checkbox", checked: false });
    const untouched = box();
    keepChecked(untouched, draft, "2026-10-01");
    expect(untouched.checked).toBe(false);
    untouched.checked = true;
    untouched.dispatchEvent(new Event("change"));

    const drawnAgain = box();
    keepChecked(drawnAgain, draft, "2026-10-01");
    expect(drawnAgain.checked).toBe(true);
    const newVersion = box();
    keepChecked(newVersion, draft, "2026-11-01");
    expect(newVersion.checked).toBe(false);
  });

  it("keeps the CV file chosen, picked or dropped, until it is cleared", () => {
    const draft = createDraft<File>();
    const cv = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    // jsdom has no DataTransfer: a FileList of one file, as Chrome's would be.
    const listOf = (file: File) => ({ 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) }) as unknown as FileList;
    const fileInput = () => {
      const input = document.createElement("input");
      input.type = "file";
      let files: FileList | null = null;
      Object.defineProperty(input, "files", { get: () => files, set: (value: FileList) => (files = value) });
      return input;
    };

    const first = fileInput();
    const remember = keepFile(first, draft, "cv", listOf);
    expect(first.files).toBeNull();
    first.files = listOf(cv); // dropped on the drop zone: no change event
    remember();

    const drawnAgain = fileInput();
    keepFile(drawnAgain, draft, "cv", listOf);
    expect(drawnAgain.files?.[0]).toBe(cv);

    draft.clear(); // read and kept in the session, or « Effacer »
    const afterRead = fileInput();
    keepFile(afterRead, draft, "cv", listOf);
    expect(afterRead.files).toBeNull();
  });
});
