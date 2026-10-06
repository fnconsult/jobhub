"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/routes";

/** Restores `version` of a Profile's Master CV as its new current version, then shows the Profile. */
export function RestoreVersionButton({ profileId, version }: { profileId: string; version: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "restoring" | "failed">("idle");

  async function restore() {
    setState("restoring");
    try {
      const response = await fetch(`/api/profiles/${profileId}/master-cv/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!response.ok) throw new Error(`restore failed: ${response.status}`);
      router.push(routes.profile(profileId));
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={restore} disabled={state === "restoring"}>
        {state === "restoring" ? t("versions.restoring") : t("versions.restore", { version })}
      </button>
      {state === "failed" ? (
        <p className="notice" role="alert">
          {t("versions.restoreError")}
        </p>
      ) : null}
    </>
  );
}
