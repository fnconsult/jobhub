import type { ShownLegalTextRead } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { MarkdownBody } from "./markdown";

/**
 * A Legal Text Version as the app shows it (#689): its title, « En bref », its numbered sections, each the repo's own
 * Markdown; in English, marked as a translation the French text prevails over.
 */
export function LegalTextView({ text, webAppUrl }: { text: ShownLegalTextRead; webAppUrl: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[4], padding: space[4], borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }}>
      <AppText variant="h2">{text.title}</AppText>
      {text.translation ? <AppText tone="secondary">{t("legal.translation")}</AppText> : null}
      {text.inBrief.length ? (
        <View role="list" style={{ gap: space[1] }}>
          {text.inBrief.map((line) => (
            <View key={line} role="listitem">
              <AppText>{line}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {text.sections.map((section) => (
        <View key={section.title} style={{ gap: space[2] }}>
          <AppText variant="h3">{section.title}</AppText>
          <MarkdownBody markdown={section.body} webAppUrl={webAppUrl} />
        </View>
      ))}
    </View>
  );
}
