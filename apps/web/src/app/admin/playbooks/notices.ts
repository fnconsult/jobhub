/** What a Coaching Playbooks page says after an action (#225): a key under admin.coachingPlaybooks.notices, and whether it is an error. */
export const NOTICES = {
  created: false,
  saved: false,
  unchanged: false,
  validated: false,
  archived: false,
  restored: false,
  invalid: true,
  exists: true,
  model_not_allowed: true,
  unknown_sources: true,
  sources_cited: true,
  own_version: true,
  already_validated: true,
  not_latest: true,
  not_found: true,
  not_archivable: true,
  nameRequired: true,
  no_eval_run: true,
  caseAdded: false,
  caseSaved: false,
  caseRemoved: false,
  too_many: true,
  no_cases: true,
} as const;
export type Notice = keyof typeof NOTICES;

export const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

type Refused = { error: Notice; sources?: string[]; citedBy?: { source: string; playbooks: string[] }[] };

/** The query string a page is shown again with after an action: its notice, the version it concerns, and what a refusal names. */
export function noticeQuery(notice: Notice | Refused, version?: number): string {
  const refused = typeof notice === "string" ? null : notice;
  const detail = refused?.sources?.join(", ") ?? refused?.citedBy?.map((each) => `${each.source} (${each.playbooks.join(", ")})`).join(" ; ");
  const query = new URLSearchParams({ notice: refused ? refused.error : (notice as Notice) });
  if (version) query.set("version", String(version));
  if (detail) query.set("detail", detail);
  return `?${query}`;
}
