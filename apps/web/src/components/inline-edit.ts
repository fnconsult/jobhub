/**
 * What leaving an inline-edit field (blur, Enter, a new choice in a select)
 * does: save a changed value, leave an unchanged one alone, or put the saved
 * value back when a required field was left blank.
 */
export function inlineCommit({ saved, value, required }: { saved: string; value: string; required: boolean }): "save" | "unchanged" | "revert" {
  if (value.trim() === saved.trim()) return "unchanged";
  if (required && value.trim() === "") return "revert";
  return "save";
}
