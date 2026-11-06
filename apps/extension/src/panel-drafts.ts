/**
 * What the person chose in the Side Panel's forms and has not sent yet (#797). The panel draws itself again
 * whenever the posting in view, the Guest session or the update asked changes, and each form with it: a choice is
 * kept here, outside the drawing, and given back to the form drawn next, until it is sent or no longer applies.
 */

/** One choice kept across renders, for one `key` (the Job Offer, the CGU version): another key finds none. */
export interface Draft<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
}

export function createDraft<T>(): Draft<T> {
  let kept: { key: string; value: T } | undefined;
  return {
    get: (key) => (kept?.key === key ? kept.value : undefined),
    set: (key, value) => {
      kept = { key, value };
    },
    clear: () => {
      kept = undefined;
    },
  };
}

/** A select drawn again keeps the option chosen in the last one, while it is still offered; otherwise the one drawn selected. */
export function keepSelected(select: HTMLSelectElement, draft: Draft<string>, key: string): void {
  const kept = draft.get(key);
  if (kept !== undefined && Array.from(select.options).some((option) => option.value === kept)) select.value = kept;
  select.addEventListener("change", () => draft.set(key, select.value));
}

/** A checkbox drawn again is ticked if the person had ticked the last one; never ticked for them otherwise. */
export function keepChecked(input: HTMLInputElement, draft: Draft<boolean>, key: string): void {
  if (draft.get(key)) input.checked = true;
  input.addEventListener("change", () => draft.set(key, input.checked));
}

/** The browser's FileList of one file, as a file input takes it (a DataTransfer's, in Chrome and Edge). */
export function fileListOf(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}

/**
 * A file input drawn again holds the file chosen in the last one. `remember` is called with the input's file whenever
 * it is chosen (picked or dropped), which the caller does after setting `files` itself.
 */
export function keepFile(input: HTMLInputElement, draft: Draft<File>, key: string, listOf: (file: File) => FileList = fileListOf): () => void {
  const kept = draft.get(key);
  if (kept) input.files = listOf(kept);
  const remember = () => {
    const file = input.files?.[0];
    if (file) draft.set(key, file);
    else draft.clear();
  };
  input.addEventListener("change", remember);
  return remember;
}
