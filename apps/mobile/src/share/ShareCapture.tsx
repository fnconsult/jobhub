import { linkShared, shareCaptureAnswerSchema, type ShareCaptureAnswer, type SharedContent } from "@jobhub/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { useApi, type ApiFetch } from "../api/api";
import { paths } from "../navigation/pages";
import { useOnline } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { Field, FieldError } from "../ui/TextField";
import { forgetShare, usePendingShare } from "./pending-share";

/** What the screen says after « Envoyer à Jobbbox », when no Job Offer came of it. */
type Problem = Exclude<ShareCaptureAnswer, { jobOffer: unknown }> | { error: "failed" };

const NEEDS_TEXT = { forbidden_site: "shareCapture.needsText.forbiddenSite", unreadable: "shareCapture.needsText.unreadable", not_a_job_offer: "shareCapture.needsText.notAJobOffer" } as const;
const PROBLEMS = { not_a_job_offer: "shareCapture.notAJobOffer", invalid: "shareCapture.invalid", unavailable: "shareCapture.failed", failed: "shareCapture.failed" } as const;

const LINK_KEYS = { keyboardType: "url", autoCapitalize: "none", autoCorrect: false } as const;
/** A press on « Envoyer à Jobbbox » counts while the keyboard is up. */
const FORM_SCROLL = { keyboardShouldPersistTaps: "handled" } as const;

/** Each share's form, by the share: another share while the screen is open starts the form afresh. */
const forms = new WeakMap<SharedContent, number>();
let nextForm = 0;
const formOf = (shared: SharedContent) => {
  if (!forms.has(shared)) forms.set(shared, ++nextForm);
  return String(forms.get(shared));
};

/** Sends what was shared to the web app, which reads the link itself (never the device) or the text, and answers. */
async function send(api: ApiFetch, shared: SharedContent): Promise<ShareCaptureAnswer | { error: "failed" }> {
  try {
    const response = await api("/api/share-captures", { method: "POST", body: JSON.stringify(shared) });
    const answer = shareCaptureAnswerSchema.safeParse(await response.json());
    return answer.success ? answer.data : { error: "failed" };
  } catch {
    return { error: "failed" };
  }
}

/**
 * The capture screen of Share capture (#697, ADR-0076): what another app's share sheet gave the app, its link (the one
 * in its text, when it came as one text) and its text, for the Candidate to check and correct before « Envoyer à
 * Jobbbox » (as Android asks of an app receiving a share). The web app reads the link under the job discovery rules, never the device; where they refuse, the screen
 * says why and asks to share or paste the offer's text, then send again. The Private Job Offer made, what was shared is
 * forgotten and its conversation opens in the screen's place, « Scorer contre mon profil » suggested. « Annuler »
 * forgets it too. Nothing is sent offline (ADR-0076's amendment).
 */
export function ShareCapture() {
  const { t } = useTranslation();
  const shared = usePendingShare();
  if (shared) return <ShareForm key={formOf(shared)} shared={shared} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3] }}>
      <AppText variant="h2" heading>
        {t("shareCapture.title")}
      </AppText>
      <AppText>{t("shareCapture.nothing")}</AppText>
    </ScrollView>
  );
}

function ShareForm({ shared }: { shared: SharedContent }) {
  const { t } = useTranslation();
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const [url, setUrl] = useState(linkShared(shared) ?? "");
  const [text, setText] = useState(shared.text ?? "");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    setProblem(null);
    const answer = await send(api, { ...(url.trim() ? { url: url.trim() } : {}), ...(text.trim() ? { text } : {}) });
    setSending(false);
    if ("jobOffer" in answer) {
      router.replace(paths.conversation(answer.conversation.id));
      forgetShare();
      return;
    }
    setProblem(answer);
  };
  const cancel = () => {
    router.replace(paths.home);
    forgetShare();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3] }} {...FORM_SCROLL}>
      <AppText variant="h2" heading>
        {t("shareCapture.title")}
      </AppText>
      <AppText tone="secondary">{t("shareCapture.intro")}</AppText>
      <Field label={t("shareCapture.link")} value={url} onChangeText={setUrl} {...LINK_KEYS} />
      <Field label={t("shareCapture.text")} hint={t("shareCapture.textHint")} value={text} onChangeText={setText} multiline />
      {problem?.error === "text_needed" ? (
        <View role="alert">
          <AppText weight="semiBold">{t(NEEDS_TEXT[problem.reason])}</AppText>
        </View>
      ) : problem ? (
        <FieldError message={t(PROBLEMS[problem.error])} />
      ) : null}
      {online ? null : <AppText tone="secondary">{t("mobile.offline.writeDisabled")}</AppText>}
      {sending ? (
        <View role="status">
          <AppText tone="secondary">{t("shareCapture.sending")}</AppText>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Control look="primary" label={t("shareCapture.send")} disabled={sending || !online || (!url.trim() && !text.trim())} onPress={() => void submit()} />
        <Control label={t("shareCapture.cancel")} disabled={sending} onPress={cancel} />
      </View>
    </ScrollView>
  );
}
