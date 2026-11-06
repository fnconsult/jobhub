import { coachConversationsResponseSchema } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { MessageSquare } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, TextInput, View } from "react-native";
import { useApi } from "../api/api";
import { useRead } from "../api/reads";
import { readKey } from "../offline/read-cache";
import { INTER, radius, space, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { ObjectRow } from "../ui/ObjectRow";
import { shareLinkAction } from "./links";
import { isCurrent, paths } from "./pages";

const FREE = ["free"] as const;
const FREE_PATH = "/api/coach/conversations?free=1";

/** The drawer's Free conversations (`GET /api/coach/conversations?free=1`), as the shell's title reads them too. */
export function useFreeConversations() {
  return useRead("coachConversations", FREE_PATH, coachConversationsResponseSchema, FREE);
}

/** The Sidebar's message after a rename or a delete that did not go through. */
type Notice = { text: string } | null;

/**
 * « Coach » in the Sidebar (ADR-0070, ADR-0076): the Candidate's Free conversations, most recently active first, each
 * opening its page; its menu (a long press, a right click, or VoiceOver's actions) opens, shares its link, renames it
 * in place, or deletes it once the system's Dialog confirms. A conversation deleted while shown leaves for the home page.
 */
export function FreeConversations({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const api = useApi();
  const queries = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const read = useFreeConversations();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const reread = () => queries.invalidateQueries({ queryKey: readKey("coachConversations") });
  const go = (path: string) => {
    onNavigate();
    router.navigate(path);
  };
  const address = (id: string) => `/api/coach/conversations/${encodeURIComponent(id)}`;

  async function rename() {
    if (!renaming) return;
    const response = await api(address(renaming.id), { method: "PATCH", body: JSON.stringify({ title: renaming.title }) }).catch(() => null);
    if (response?.ok) {
      setRenaming(null);
      setNotice(null);
      await reread();
    } else setNotice({ text: t(response?.status === 400 ? "coachPanel.listErrors.invalidTitle" : "coachPanel.listErrors.action") });
  }

  function confirmDelete(conversation: { id: string; title: string }) {
    Alert.alert(t("conversationFirst.deleteTitle", { title: conversation.title }), t("conversationFirst.deleteText"), [
      { text: t("coachPanel.cancel"), style: "cancel" },
      {
        text: t("coachPanel.delete"),
        style: "destructive",
        onPress: () =>
          void api(address(conversation.id), { method: "DELETE" })
            .catch(() => null)
            .then(async (response) => {
              if (!response?.ok && response?.status !== 404) return setNotice({ text: t("coachPanel.listErrors.action") });
              setNotice(null);
              if (isCurrent(pathname, paths.conversation(conversation.id))) router.replace(paths.home);
              await reread();
            }),
      },
    ]);
  }

  return (
    <View>
      <View style={{ paddingHorizontal: space[3], paddingVertical: space[1] }}>
        <AppText variant="meta" tone="meta" weight="semiBold">
          {t("conversationFirst.coach")}
        </AppText>
      </View>
      {read.isError && !read.data ? <AppText tone="secondary">{t("coachPanel.listErrors.load")}</AppText> : null}
      {notice ? (
        <View role="alert" style={{ paddingHorizontal: space[3] }}>
          <AppText tone="danger">{notice.text}</AppText>
        </View>
      ) : null}
      {(read.data?.conversations ?? []).map((conversation) => {
        const path = paths.conversation(conversation.id);
        if (renaming?.id === conversation.id)
          return (
            <View key={conversation.id} style={{ gap: space[1], padding: space[2] }}>
              <TextInput
                aria-label={t("conversationFirst.nameLabel")}
                value={renaming.title}
                onChangeText={(title) => setRenaming({ id: conversation.id, title })}
                onSubmitEditing={() => void rename()}
                autoFocus
                maxLength={80}
                style={{
                  minHeight: 44,
                  paddingHorizontal: space[2],
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  borderRadius: radius.control,
                  fontFamily: INTER.regular,
                  fontSize: type.fontSize.body,
                  color: colors.text,
                  backgroundColor: colors.surface,
                }}
              />
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Control label={t("coachPanel.save")} look="primary" onPress={() => void rename()} />
                <Control label={t("coachPanel.cancel")} look="secondary" onPress={() => (setRenaming(null), setNotice(null))} />
              </View>
            </View>
          );
        return (
          <ObjectRow
            key={conversation.id}
            label={conversation.title}
            icon={MessageSquare}
            current={isCurrent(pathname, path)}
            onPress={() => go(path)}
            actions={[
              { label: t("mobile.rowMenu.open"), onPress: () => go(path) },
              shareLinkAction(t("mobile.rowMenu.shareLink"), path),
              { label: t("coachPanel.rename"), onPress: () => setRenaming({ id: conversation.id, title: conversation.title }) },
              { label: t("coachPanel.delete"), onPress: () => confirmDelete(conversation) },
            ]}
          />
        );
      })}
    </View>
  );
}
