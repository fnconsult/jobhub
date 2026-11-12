import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { useTranslation } from "react-i18next";
import { fromByteArray } from "base64-js";
import type { PublicCoachPage } from "@jobhub/shared/coaching-profiles";
import { useApi } from "../api/api";
import { AppText } from "../ui/AppText";
import { space, radius } from "../theme/theme";
function CoachPortrait({ url, name }: { url: string; name: string }) {
  const api = useApi(),
    { t } = useTranslation();
  const [source, setSource] = useState<{ uri: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // All authenticated downloads use the API transport, which refuses redirects off the configured origin.
    // Give Image only local bytes; the system image downloader never receives a session cookie.
    void api(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/webp") return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 2 * 1024 * 1024) return;
        if (active) setSource({ uri: `data:image/webp;base64,${fromByteArray(bytes)}` });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, api]);
  return source ? (
    <Image source={source} accessibilityLabel={t("coachPage.photoAlt", { name })} style={{ width: 96, height: 96, borderRadius: radius.md }} />
  ) : null;
}
/** The API includes only the approved profile; portraits stay in this signed-in screen's memory. */
export function CoachProfile({ name, page }: { name: string; page: PublicCoachPage }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space[2] }}>
      {page.photoUrl ? <CoachPortrait key={page.photoUrl} url={page.photoUrl} name={name} /> : null}
      <AppText>{page.presentation}</AppText>
      {page.specialties.length ? (
        <AppText>
          {t("coachPage.specialties")}: {page.specialties.join(", ")}
        </AppText>
      ) : null}
      {page.languages.length ? (
        <AppText>
          {t("coachPage.languages")}: {page.languages.join(", ")}
        </AppText>
      ) : null}
    </View>
  );
}
