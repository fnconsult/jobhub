import type { PlatformSettingSource } from "@/platform-settings/resolver";

/** How a Platform Setting's source is coloured, on Paramètres and on a Tool's page: the Back Office's stands out, env's is marked. */
export const SOURCE_TONE: Record<PlatformSettingSource, "success" | "accent" | undefined> = { back_office: "success", env: "accent", default: undefined };
