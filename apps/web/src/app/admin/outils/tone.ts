import type { ToolStatus } from "@/tools";

/** How a Tool's status is coloured: a key missing stands out; a public API needs no key and is neutral. */
export const STATUS_TONE: Record<ToolStatus, "success" | "danger" | undefined> = {
  configured: "success",
  key_missing: "danger",
  not_configured: "danger",
  no_key_needed: undefined,
};
