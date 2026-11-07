"use client";

import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { liveView } from "@/ai-activity/live";
import { StopButton } from "@/components/AiActivity";
import { useAiActivityLive } from "@/components/AiActivityLive";

const NO_ACTIONS: never[] = [];

/**
 * The Candidate's AI action under way on this page (#333), as the compact Top Bar's « Activité » shows it while it runs
 * (#897): its name, « Activité IA » and the step under way (« Démarrage » before its first, « Arrêt en cours… » once
 * stopped), and its stop icon (#369). Null when none runs, or outside AiActivityLiveProvider.
 */
export function useActivityRun(): { name: string; stop: ReactNode } | null {
  const { t } = useTranslation();
  const live = useAiActivityLive();
  const pathname = usePathname();
  const actions = live?.actions ?? NO_ACTIONS;
  const underWay = useMemo(() => liveView(actions, pathname).underWay, [actions, pathname]);
  if (!live || !underWay) return null;
  const step = underWay.status === "stopping" ? t("aiActivity.live.stopping") : underWay.current ? t(`aiActivity.steps.${underWay.current.label}`) : t("aiActivity.live.starting");
  return { name: `${t("aiActivity.label")} ${step}`, stop: <StopButton action={underWay} stop={live.stop} /> };
}
