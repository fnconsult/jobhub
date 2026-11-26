"use server";

/**
 * What « Clés d'agent » changes (#1139, ADR-0118), super-admins only (the `agentKeys` resource):
 *  - `createAgentKey`: the key's value comes back once, in this action's answer, which the form shows in place: never in
 *    a redirect, an address or a cookie, and never kept (only its fingerprint is). The page is answered `no-store`;
 *  - `revokeAgentKey`: back to the tab, saying which key by its name.
 * Each is recorded in the Back Office Audit by the key's name, never its value.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAgentKeysBackOffice, requireBackOffice } from "@/admin/server";
import { parametresHref } from "@/platform-settings/parametres";
import { routes } from "@/routes";
import type { FieldError } from "@/validation";
import { AGENT_KEY_PARAMS } from "./agent-keys-params";

/** What the creation form shows after it was sent: the key created, with its value this once, or what to fix. */
export type CreateAgentKeyState = { created: { name: string; value: string; expiresAt: string } } | { errors: FieldError[] } | { refused: "name_taken" } | null;

export async function createAgentKey(_previous: CreateAgentKeyState, form: FormData): Promise<CreateAgentKeyState> {
  const { administrator } = await requireBackOffice("agentKeys", "write");
  const done = await getAgentKeysBackOffice().create(
    { id: administrator.id, email: administrator.email },
    { name: form.get("name") ?? undefined, scope: form.get("scope") ?? undefined, days: form.get("days") ?? undefined },
  );
  if (!done.ok) return "errors" in done ? { errors: done.errors } : { refused: done.refused };
  // The table lists the new key on this answer: the page is drawn again with it, its value in this state only.
  revalidatePath(routes.adminPlatformSettings);
  return { created: { name: done.key.name, value: done.value, expiresAt: done.key.expiresAt.toISOString() } };
}

export async function revokeAgentKey(form: FormData): Promise<void> {
  const { administrator } = await requireBackOffice("agentKeys", "write");
  const done = await getAgentKeysBackOffice().revoke({ id: administrator.id, email: administrator.email }, String(form.get(AGENT_KEY_PARAMS.key) ?? ""));
  redirect(parametresHref("agent_keys", done.ok ? { [AGENT_KEY_PARAMS.revoked]: done.key.name } : {}));
}
