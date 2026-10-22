import type { ToolStatus } from "@/tools";

/** How a Tool's status is coloured: a key or setting missing stands out; a public API needs no key, and a Tool turned off, are neutral. */
export const STATUS_TONE: Record<ToolStatus, "success" | "danger" | undefined> = {
  configured: "success",
  disabled: undefined,
  key_missing: "danger",
  setting_missing: "danger",
  not_configured: "danger",
  no_key_needed: undefined,
};
