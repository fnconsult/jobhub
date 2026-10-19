/** What a Coaching Playbooks page says after an action (#225, ADR-0026): a key under admin.coachingPlaybooks.notices, and whether it is an error. */
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
  task_instructions: true,
  own_version: true,
  already_validated: true,
  not_latest: true,
  not_found: true,
  not_archivable: true,
  nameRequired: true,
} as const;
export type Notice = keyof typeof NOTICES;

export const isNotice = (value: unknown): value is Notice => typeof value === "string" && Object.hasOwn(NOTICES, value);

type Refused = { error: Notice; sources?: string[]; citedBy?: { source: string; playbooks: string[] }[]; problems?: string[] };

/** The query string a page is shown again with after an action: its notice, the version it concerns, and what a refusal names. */
export function noticeQuery(notice: Notice | Refused, version?: number): string {
  const refused = typeof notice === "string" ? null : notice;
  const detail =
    refused?.sources?.join(", ") ?? refused?.citedBy?.map((each) => `${each.source} (${each.playbooks.join(", ")})`).join(" ; ") ?? refused?.problems?.join(", ");
  const query = new URLSearchParams({ notice: refused ? refused.error : (notice as Notice) });
  if (version) query.set("version", String(version));
  if (detail) query.set("detail", detail);
  return `?${query}`;
}
