import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApi } from "../api/api-context";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { CoachProposalCard } from "./coach-reply";

type Problem = "conflict" | "undoConflict" | "failed";
type Decision = "accept" | "dismiss" | "undo";
const ACCEPT: Decision = "accept";
const DISMISS: Decision = "dismiss";
const UNDO: Decision = "undo";

/** The Upgrade Prompt a Plan Quota puts in a proposal's place (apps/web/src/billing/upgrade-prompt.ts): what was reached, and which Plan goes further. */
type UpgradePrompt = { title: string; message: string };
const upgradePromptOf = (prompt: unknown): UpgradePrompt | null => {
  if (typeof prompt !== "object" || prompt === null) return null;
  const { title, message } = prompt as Partial<UpgradePrompt>;
  return typeof title === "string" && typeof message === "string" ? { title, message } : null;
};

/**
 * A Coach proposal's Action Card under the reply that makes it (#715, ADR-0077), as on the web: « Proposé par votre
 * coach IA », what changes on which object, before → after, the Plan Quota it will use, then « Appliquer » and
 * « Ignorer », or once decided how, with « Annuler » while it can be undone. Refused by a Plan Quota, it says so as the
 * web's Upgrade Prompt does, without anything to buy: the subscription is managed on jobbbox.ai (ADR-0076).
 */
export function ProposalCard({ card, onChange }: { card: CoachProposalCard; onChange: (card: CoachProposalCard) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const { change } = card;
  const pending = card.status === "pending";
  const prompt = upgradePromptOf(change.quota?.prompt);
  const hour = (at: string) =>
    new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Paris" }).format(new Date(at));

  async function decide(decision: Decision) {
    setBusy(true);
    setProblem(null);
    const response = await api.fetch(`/api/action-cards/${encodeURIComponent(card.id)}`, { method: "POST", body: JSON.stringify({ decision }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { card?: CoachProposalCard; error?: string } | null;
    setBusy(false);
    if (response?.ok && body?.card) return onChange(body.card);
    setProblem(body?.error === "conflict" ? (decision === UNDO ? "undoConflict" : "conflict") : "failed");
  }

  return (
    <View style={{ gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <AppText variant="meta" tone="meta">
        {t("coachProposals.by")}
      </AppText>
      <AppText weight="semiBold">{`${change.what} · ${change.target.name}`}</AppText>
      {[{ what: change.what, before: change.before, after: change.after }, ...(change.also ?? [])].map((each, index) => (
        <AppText
          key={index}
        >{`${change.also?.length ? `${t("coachProposals.changeOf", { what: each.what })} ` : ""}${t("coachProposals.before")} ${each.before} → ${each.after}`}</AppText>
      ))}
      {change.quota && !prompt ? (
        <AppText variant="meta" tone="secondary">
          {change.quota.label}
        </AppText>
      ) : null}
      {card.status === "accepted" && card.decidedAt ? <AppText>{t("coachProposals.applied", { time: hour(card.decidedAt) })}</AppText> : null}
      {card.status === "dismissed" ? <AppText>{t("coachProposals.dismissed")}</AppText> : null}
      {card.status === "undone" && card.undoneAt ? <AppText>{t("coachProposals.undone", { time: hour(card.undoneAt) })}</AppText> : null}
      {problem ? <AppText tone="danger">{t(`coachProposals.problems.${problem}`)}</AppText> : null}
      {pending && prompt ? (
        <View role="alert" style={{ gap: space[1], padding: space[3], borderRadius: radius.card, backgroundColor: colors.warnSoft }}>
          <AppText weight="semiBold">{prompt.title}</AppText>
          <AppText>{prompt.message}</AppText>
          <AppText tone="secondary">{t("mobile.subscriptionOnWeb")}</AppText>
        </View>
      ) : null}
      {pending && !prompt ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Control label={t("coachProposals.apply")} look="primary" disabled={busy} onPress={() => void decide(ACCEPT)} />
          <Control label={t("coachProposals.dismiss")} look="secondary" disabled={busy} onPress={() => void decide(DISMISS)} />
        </View>
      ) : null}
      {card.status === "accepted" && card.undoable ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={t("coachProposals.undo")} look="secondary" disabled={busy} onPress={() => void decide(UNDO)} />
        </View>
      ) : null}
    </View>
  );
}
