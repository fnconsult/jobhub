import type { EnrichedContactsResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useEnrichedContacts } from "../api/reads";
import { ReadState } from "../screens/ReadState";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { TextLink } from "../ui/TextLink";
import { applicationFormats } from "./application-formats";

/** Whether the web shows an Application's « Contacts » Section: while a contact-data provider is on, or some were found. */
export const showsContacts = (state: EnrichedContactsResponse) => state.enabled || state.contacts.length > 0;

/**
 * The Application's « Contacts » Section (#691), as the web's (EnrichedContactsPanel), to read: the people found at the
 * employer, and the Enriched Contacts with their work e-mails and phones (to write or call from the device) and where
 * and when they were obtained. Looking for people and asking a person's details, which counts against the Plan Quota,
 * are done on jobbbox.ai (ADR-0076). The device never keeps them (READS).
 */
export function EnrichedContacts({ applicationId }: { applicationId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const formats = applicationFormats(i18n.language);
  return (
    <ReadState read={useEnrichedContacts(applicationId)} notFound={t("mobile.applications.notFound")}>
      {(state) => (
        <View style={{ gap: space[3] }}>
          <AppText variant="h3" heading>
            {t("enrichedContacts.title")}
          </AppText>
          {!state.enabled ? <AppText tone="secondary">{t("mobile.applications.contactsOff")}</AppText> : null}
          {state.found.length > 0 ? (
            <>
              <AppText weight="semiBold" heading>
                {t("enrichedContacts.foundTitle")}
              </AppText>
              {state.found.map((person) => (
                <AppText key={person.id}>{named(person)}</AppText>
              ))}
            </>
          ) : null}
          {state.contacts.length > 0 ? (
            <>
              <AppText weight="semiBold" heading>
                {t("enrichedContacts.contactsTitle")}
              </AppText>
              <AppText tone="secondary">{t("enrichedContacts.personalData")}</AppText>
              {state.contacts.map((contact) => (
                <View key={contact.id} style={{ gap: space[1], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <AppText weight="semiBold">{named(contact)}</AppText>
                  {contact.emails.map((email) => (
                    <View key={email}>
                      <AppText variant="meta" tone="secondary">
                        {t("enrichedContacts.email")}
                      </AppText>
                      <TextLink label={email} url={`mailto:${email}`} />
                    </View>
                  ))}
                  {contact.phones.map((phone) => (
                    <View key={phone}>
                      <AppText variant="meta" tone="secondary">
                        {t("enrichedContacts.phone")}
                      </AppText>
                      <TextLink label={phone} url={`tel:${phone.replace(/[^\d+]/g, "")}`} />
                    </View>
                  ))}
                  <AppText variant="meta" tone="meta">
                    {t("enrichedContacts.source", { provider: t(`enrichedContacts.providers.${contact.source.provider}`), date: formats.date(contact.source.retrievedAt) })}
                  </AppText>
                </View>
              ))}
              <AppText tone="secondary">{t("enrichedContacts.useInOutreach")}</AppText>
            </>
          ) : state.found.length === 0 ? (
            <AppText>{t("enrichedContacts.foundNone")}</AppText>
          ) : null}
          {state.enabled ? <AppText tone="secondary">{t("mobile.applications.contactsOnWeb")}</AppText> : null}
        </View>
      )}
    </ReadState>
  );
}

/** « Claire Durand · DRH »: a person and their position, when known. */
const named = ({ name, jobTitle }: { name: string; jobTitle: string | null }) => (jobTitle ? `${name} · ${jobTitle}` : name);
