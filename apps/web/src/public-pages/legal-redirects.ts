import { LEGAL_TEXT_DAY, type LegalTextId } from "@jobhub/help";

/**
 * The addresses of Légal that moved, and where they lead now: « IA dans Jobbbox » is a section of the privacy policy
 * (ADR-0064), and #470's Legal Documents became the Legal Texts (ADR-0062), the cookies a section too.
 */
const MOVED: Record<string, { text: LegalTextId; anchor?: string }> = {
  ia: { text: "confidentialite", anchor: "ia" },
  "conditions-utilisation": { text: "cgu" },
  cookies: { text: "confidentialite", anchor: "cookies" },
  "sous-traitants-et-ia": { text: "confidentialite", anchor: "ia" },
};
const LEGAL_PAGE = /^\/legal\/([^/]+)\/?$/;

/**
 * Where a request for `pathname` and `query` is permanently redirected (308, see proxy.ts), or null when it stays:
 * a moved Legal Text, and `?version=<YYYY-MM-DD>` (#470) to the version's dated address. The page's `lang` is kept;
 * a `?version=` that is no day is dropped.
 */
export function legalRedirect(pathname: string, query: URLSearchParams): string | null {
  const name = LEGAL_PAGE.exec(pathname)?.[1];
  if (!name) return null;
  const moved = MOVED[name];
  const version = query.get("version");
  if (!moved && version === null) return null;
  const text = moved?.text ?? name;
  const dated = version && LEGAL_TEXT_DAY.test(version) ? `/${version}` : "";
  const lang = query.get("lang");
  return `/legal/${text}${dated}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}${moved?.anchor ? `#${moved.anchor}` : ""}`;
}
