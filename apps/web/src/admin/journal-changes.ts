import type { Recorded } from "./back-office";

/**
 * One thing a Back Office Audit entry changed: a field (null when the value is not a
 * set of fields), and its value before and after. `before` is absent when there was
 * nothing before (an addition), `after` when there is nothing after (a retirement).
 */
export interface JournalChange {
  field: string | null;
  before?: Recorded;
  after?: Recorded;
}

type Fields = { [key: string]: Recorded };

const isFields = (value: Recorded): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a: Recorded | undefined, b: Recorded | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** What changed between an entry's `before` and `after`, in field order: only the fields that differ. */
export function journalChanges(before: Recorded, after: Recorded): JournalChange[] {
  if (before === null && after === null) return [];
  if ((before === null || isFields(before)) && (after === null || isFields(after))) {
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
    return fields
      .filter((field) => !same(before?.[field], after?.[field]))
      .map((field) => ({
        field,
        ...(before !== null && { before: before[field] ?? null }),
        ...(after !== null && { after: after[field] ?? null }),
      }));
  }
  return [{ field: null, ...(before !== null && { before }), ...(after !== null && { after }) }];
}
