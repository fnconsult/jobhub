import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { MySignalements, type MySignalement } from "@/components/MySignalements";
import { sharedPool } from "@/database/pool";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { signalementsOf, type Signalement } from "@/signalements";
import { signalementDay } from "@/signalements/day";
import { getSignalements, jobbboxVersion } from "@/signalements/server";

/**
 * Mon compte's « Mes signalements » Section (#377): the Signalements the Candidate sent, newest first, with the team's
 * replies. Opening it closes every Signalement notification.
 */
export default async function AccountSignalementsPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  await getSignalements().closeNotifications(candidate.id);
  const [signalements, locale, t] = await Promise.all([signalementsOf(sharedPool(), candidate.id), getRequestLocale(), getServerT()]);
  const now = new Date();
  const day = (at: Date) => signalementDay(at, now, locale);

  const shown = (signalement: Signalement): MySignalement => {
    const repliedAt = signalement.repliedAt ?? signalement.replyUpdatedAt;
    const changed = signalement.repliedAt && signalement.replyUpdatedAt && signalement.replyUpdatedAt > signalement.repliedAt;
    return {
      id: signalement.id,
      type: signalement.type,
      heading: t("mySignalements.heading", { type: t(`mySignalements.types.${signalement.type}`), date: day(signalement.createdAt) }),
      message: signalement.message,
      status: signalement.status,
      attached:
        signalement.attachedQuestion !== null && signalement.attachedCoachReply !== null
          ? { question: signalement.attachedQuestion, coachReply: signalement.attachedCoachReply }
          : null,
      reply: signalement.reply === null ? null : { text: signalement.reply, on: repliedAt ? day(repliedAt) : null, changedOn: changed ? day(signalement.replyUpdatedAt!) : null },
    };
  };

  return <MySignalements signalements={signalements.map(shown)} version={jobbboxVersion()} />;
}
