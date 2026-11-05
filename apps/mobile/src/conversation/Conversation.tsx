import { Plus, Send, Square } from "lucide-react-native";
import { useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useKeyCommand } from "../keyboard/key-commands";
import { useOnline } from "../offline/read-cache";
import { INTER, radius, space, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

export type Message = { id: string; from: "candidate" | "coach"; text: string };

/** The conversation keeps a reading width, centred in its space (ADR-0070): 44rem. */
const READING_REM = 44;
/** How close to the end of the thread, in points, still counts as reading the latest message. */
const AT_END_PT = 48;

const atEnd = ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) =>
  contentOffset.y + layoutMeasurement.height >= contentSize.height - AT_END_PT;

/**
 * A page's conversation with the AI Coach (ADR-0070): its thread, and at its foot the box, with « + » for a link or a
 * document and « Envoyer » or, while the reply streams, « Arrêter ». What it shows and sends is its caller's (#690
 * plugs it into `POST /api/coach`). Without network the box, « + » and « Envoyer » are disabled, and it says why (#701).
 */
export function Conversation({
  messages,
  streaming,
  onSend,
  onStop,
  onAttach,
}: {
  messages: readonly Message[];
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const online = useOnline();
  const [draft, setDraft] = useState("");
  const thread = useRef<ComponentRef<typeof ScrollView>>(null);
  // Whether the person reads the latest message: the thread follows it as it grows (a message, the reply streaming), but
  // stays where they scrolled back to when the window changes and the messages wrap again (Split View, a foldable).
  const following = useRef(true);
  const send = () => {
    const text = draft.trim();
    if (!text || !online) return;
    onSend(text);
    setDraft("");
    following.current = true;
  };
  // ⌘↩ (Ctrl on Android) sends, as « Envoyer » does; while the reply streams, the box offers « Arrêter » instead.
  useKeyCommand("send", streaming ? null : send);
  const readingWidth = READING_REM * 16 * fontScale;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={thread}
        aria-label={t("coachPanel.messagesLabel")}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => (following.current = atEnd(event.nativeEvent))}
        scrollEventThrottle={100}
        onContentSizeChange={() => (following.current ? thread.current?.scrollToEnd({ animated: true }) : undefined)}
        contentContainerStyle={styles.thread}
      >
        <View style={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", gap: space[4] }}>
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </View>
      </ScrollView>
      <View style={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", paddingBottom: space[2], gap: space[1] }}>
        {online ? null : (
          <AppText variant="meta" tone="secondary">
            {t("mobile.offline.conversationDisabled")}
          </AppText>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: space[1],
            padding: space[1],
            borderWidth: 1,
            borderColor: colors.borderStrong,
            borderRadius: radius.card * 2,
            backgroundColor: colors.surface,
          }}
        >
          <Control label={t("mobile.attach")} icon={Plus} iconOnly disabled={!online} onPress={onAttach} />
          <TextInput
            aria-label={t("coachPanel.messageLabel")}
            placeholder={t("coachPanel.messageLabel")}
            placeholderTextColor={colors.meta}
            value={draft}
            onChangeText={setDraft}
            editable={online}
            aria-disabled={!online}
            multiline
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 160,
              paddingHorizontal: space[2],
              paddingVertical: space[3],
              fontFamily: INTER.regular,
              fontSize: type.fontSize.body,
              color: colors.text,
            }}
          />
          {streaming ? (
            <Control label={t("coachPanel.stop")} icon={Square} look="secondary" onPress={onStop} />
          ) : (
            <Control label={t("mobile.send")} icon={Send} look="primary" disabled={!online} onPress={send} />
          )}
        </View>
      </View>
    </View>
  );
}

function Bubble({ message }: { message: Message }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (message.from === "candidate")
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "85%", padding: space[3], borderRadius: radius.card * 1.6, backgroundColor: colors.accentSoft }}>
        <AppText>{message.text}</AppText>
      </View>
    );
  // The coach's reply, under the words « Coach IA »: it says it is an AI at every width (AI Act art. 50(1)).
  return (
    <View style={{ gap: space[1] }}>
      <AppText variant="meta" tone="meta">
        {t("coachPanel.badge")}
      </AppText>
      <AppText>{message.text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // The thread sits on the box, the latest message just above it, as in a messaging app.
  thread: { flexGrow: 1, justifyContent: "flex-end", paddingVertical: space[4] },
});
