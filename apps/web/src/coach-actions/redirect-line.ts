/**
 * A Typed redirect (ADR-0114) as the browser and the server both read it: what it holds, whether a kept one is one, and its
 * line « page › section › object ». No server-only imports: the thread bundles it.
 */
import * as z from "zod";

/** A Typed redirect: where the Candidate does it themselves, shown under the reply as a link « page › section › object ». */
export interface TypedRedirect {
  page: string;
  /** The page's Section, when the object is in one. */
  section: string | null;
  object: string;
  /** Built by the server from the routes, never by the AI model. */
  href: string;
}

export const typedRedirectSchema: z.ZodType<TypedRedirect> = z.object({
  page: z.string().min(1).max(200),
  section: z.string().max(200).nullable(),
  object: z.string().min(1).max(200),
  // One of Jobbbox's own pages: a path, never another site (not « //… »).
  href: z.string().regex(/^\/(?![/\\])/).max(500),
});

/** A Typed redirect as kept, or null when it is not one (one saved by hand, or a link elsewhere). */
export const readTypedRedirect = (value: unknown): TypedRedirect | null => {
  const parsed = typedRedirectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** A Typed redirect in one line, as the AI Coach and the Candidate read it: « Profil Finance › CV de référence › Langues ». */
export const redirectLine = (redirect: TypedRedirect) => [redirect.page, redirect.section, redirect.object].filter(Boolean).join(" › ");
