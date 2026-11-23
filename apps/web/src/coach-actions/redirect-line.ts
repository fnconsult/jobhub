/**
 * A Typed redirect (ADR-0114) as the browser and the server both read it: what it holds, whether a kept one is one, and its
 * line « page › section › object ». No server-only imports: the thread bundles it.
 */
import { typedRedirectSchema, type TypedRedirect } from "@jobhub/shared/reads";

/** A Typed redirect: where the Candidate does it themselves, shown under the reply as a link « page › section › object ». */
export { typedRedirectSchema, type TypedRedirect };

/** A Typed redirect as kept, or null when it is not one (one saved by hand, or a link elsewhere). */
export const readTypedRedirect = (value: unknown): TypedRedirect | null => {
  const parsed = typedRedirectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** A Typed redirect in one line, as the AI Coach and the Candidate read it: « Profil Finance › CV de référence › Langues ». */
export const redirectLine = (redirect: TypedRedirect) => [redirect.page, redirect.section, redirect.object].filter(Boolean).join(" › ");
