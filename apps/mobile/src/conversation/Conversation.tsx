import { FileText, Link, Plus, Send, Square, type LucideIcon } from "lucide-react-native";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { DroppedItem } from "../attach/attachment";
import { DropTarget } from "../attach/DropTarget";
import { useKeyCommand } from "../keyboard/key-commands";
import { useOnline } from "../offline/read-cache";
import { INTER, radius, space, TARGET, type, useTheme } from "../theme/theme";
import { TAPS_REACH_CONTROLS } from "../session/GateScreen";
import { AppText, BAR_MAX_SCALE, CappedTextScale, WHOLE_FROM_FONT_SCALE } from "../ui/AppText";
import { Control } from "../ui/Control";
import { usePointerHover } from "../ui/pointer";

/** The conversation keeps a reading width, centred in its space (ADR-0070): 44rem. */
const READING_REM = 44;
/** How close to the end of the thread, in points, still counts as reading the latest message. */
const AT_END_PT = 48;

const atEnd = ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) => contentOffset.y + layoutMeasurement.height >= contentSize.height - AT_END_PT;

/**
 * The thread's scroll, for what in it stays pinned at its top while it scrolls (the Offer box's tier on a phone, #899):
 * `y`, how far it is scrolled, driven on the native side as React Native's sticky headers are; `top`, where its content
 * (`lead`, then the messages) starts in it, once laid out.
 */
export type ThreadScroll = { y: Animated.Value; top: number | null };
const ThreadScrollContext = createContext<ThreadScroll | null>(null);

/** The scroll of the conversation's thread this is in; null outside one. */
export const useThreadScroll = () => useContext(ThreadScrollContext);

/** The thread's scroll offset, on the native side, into `scrollY`: what is pinned moves with it at every frame. */
const SCROLL_OFFSET = (scrollY: Animated.Value) => [{ nativeEvent: { contentOffset: { y: scrollY } } }];

/**
 * A page's conversation with the AI Coach (ADR-0070), as it is drawn: its thread (`children`, at its reading width,
 * following the latest message), and at its foot the box, with « + » for a link or a document and « Envoyer » or,
 * while the reply is on its way, « Arrêter ». « + » opens its menu above the box, « Coller un lien d'offre » and
 * « Joindre un CV » (#696); on a tablet a document or a link dropped on the box goes to `attach.drop`. `aboveBox` (the
 * suggestions, the help's articles) and `belowBox` (the Signalement links) sit around it. `lead`, the page's own view
 * before the thread (Recherches d'offres' Offer box, ADR-0090): the page then opens on it, and only what is sent brings
 * the thread down to its latest message. What it shows and sends is its caller's (CoachConversation). Without network
 * the box, « + » and « Envoyer » are disabled, nothing dropped is taken, and it says why (#701).
 */
export function Conversation({
  draft,
  onDraftChange,
  streaming,
  onSend,
  onStop,
  attach,
  aboveBox,
  belowBox,
  inputRef,
  lead,
  children,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  streaming: boolean;
  /** The draft, trimmed, to send: its caller empties the box. */
  onSend: (text: string) => void;
  onStop: () => void;
  /** What « + » offers, and what is dropped on the box (useAttach). */
  attach: { pasteLink: () => void; pickCv: () => void; drop: (items: DroppedItem[]) => void };
  aboveBox?: ReactNode;
  belowBox?: ReactNode;
  /** The box, for its caller to put the focus in it. */
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const online = useOnline();
  const thread = useRef<ComponentRef<typeof ScrollView>>(null);
  // Whether the person reads the latest message: the thread follows it as it grows (a message, the reply streaming), but
  // stays where they scrolled back to when the window changes and the messages wrap again (Split View, a foldable).
  // Under a page's own view (`lead`), the page opens on it: nothing follows until something is sent.
  const following = useRef(lead === undefined);
  const [scrollY] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!thread.current) return;
    const attached = Animated.attachNativeEvent(thread.current, "onScroll", SCROLL_OFFSET(scrollY), undefined);
    return () => attached.detach();
  }, [scrollY]);
  const [contentTop, setContentTop] = useState<number | null>(null);
  const threadScroll = useMemo(() => ({ y: scrollY, top: contentTop }), [scrollY, contentTop]);
  const [attaching, setAttaching] = useState(false);
  // From the size where texts are shown whole, the box's own button (« Envoyer », « Arrêter ») is its icon, named by its
  // words: in words, at iOS's largest size on an iPhone SE, it took the whole box, cut in two and past the screen's edge,
  // and left the message field no width (#705).
  const buttonIconOnly = fontScale >= WHOLE_FROM_FONT_SCALE;
  // And what sits under the box (the Signalement links) ends the thread, which scrolls to it: pinned under the box, it
  // took most of an iPhone SE's height at iOS's largest size, and left the thread, the page's own view with it, a strip.
  const belowBoxInThread = fontScale >= WHOLE_FROM_FONT_SCALE;
  const choose = (chosen: () => void) => {
    setAttaching(false);
    chosen();
  };
  const send = () => {
    const text = draft.trim();
    if (!text || !online || streaming) return;
    onSend(text);
    following.current = true;
  };
  // ⌘↩ (Ctrl on Android) sends, as « Envoyer » does; while the reply streams, the box offers « Arrêter » instead.
  useKeyCommand("send", streaming ? null : send);
  const readingWidth = READING_REM * 16 * fontScale;

  return (
    <View style={{ flex: 1 }}>
      {/* Its offset followed on the native side at every frame, for what stays pinned in it (useThreadScroll). */}
      <ScrollView
        ref={thread}
        testID="conversation-thread"
        aria-label={t("coachPanel.messagesLabel")}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => (following.current = atEnd(event.nativeEvent))}
        scrollEventThrottle={16}
        onContentSizeChange={() => (following.current ? thread.current?.scrollToEnd({ animated: true }) : undefined)}
        contentContainerStyle={styles.thread}
      >
        <View
          onLayout={(event: LayoutChangeEvent) => setContentTop(event.nativeEvent.layout.y)}
          style={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", gap: space[4] }}
        >
          <ThreadScrollContext.Provider value={threadScroll}>
            {lead}
            {children}
          </ThreadScrollContext.Provider>
          {belowBoxInThread ? belowBox : null}
          {/* Layout-neutral end marker: key-screen captures wait until the whole thread has reached its end. */}
          <View testID="conversation-end" style={{ position: "absolute", bottom: 0, left: 0, width: 1, height: 1 }} />
        </View>
      </ScrollView>
      {/* What sits above the box (suggestions, the help found while typing) scrolls and shrinks when the thread leaves it
          too little room: the box keeps its own, above the keyboard and on the screen, at any text size (#705). */}
      {/* The box is the conversation's bar: its texts grow up to twice their size, as the shell's bars do (BAR_MAX_SCALE)
          and iOS's own. Growing freely, it took 272 of an iPhone SE's 667 points at the largest size, and left the
          thread less than an Application's card title (#705). */}
      <CappedTextScale scale={BAR_MAX_SCALE}>
        <View testID="conversation-box" style={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", flexShrink: 1, paddingBottom: space[2], gap: space[1] }}>
        {/* For the e2e flows (#705), a line a touch target above the box: an element of the thread whose top is above it
            has room for its tap above the box. Maestro compares elements by their tops only, and a button whose top was
            just above the box's had its centre, where Maestro taps, in it. Laid over nothing, touched by nothing. */}
        <View testID="conversation-tap-line" style={{ position: "absolute", left: 0, right: 0, top: -TARGET, height: 1, pointerEvents: "none" }} />
        {aboveBox ? (
          <ScrollView testID="conversation-above-box" style={styles.aboveBox} keyboardShouldPersistTaps={TAPS_REACH_CONTROLS}>
            {aboveBox}
          </ScrollView>
        ) : null}
        {online ? null : (
          <AppText variant="meta" tone="secondary">
            {t("mobile.offline.conversationDisabled")}
          </AppText>
        )}
        {attaching && online ? (
          <View
            role="menu"
            aria-label={t("mobile.attachments.menu")}
            style={{ alignSelf: "flex-start", padding: space[1], borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, backgroundColor: colors.surface }}
          >
            <MenuItem label={t("mobile.attachments.pasteLink")} icon={Link} onPress={() => choose(attach.pasteLink)} />
            <MenuItem label={t("mobile.attachments.joinCv")} icon={FileText} onPress={() => choose(attach.pickCv)} />
          </View>
        ) : null}
        <DropTarget
          onDrop={(items) => (online ? attach.drop(items) : undefined)}
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
          <Control label={t("mobile.attach")} icon={Plus} iconOnly expanded={attaching && online} disabled={!online} onPress={() => setAttaching((open) => !open)} />
          <TextInput
            ref={inputRef}
            testID="coach-message"
            aria-label={t("coachPanel.messageLabel")}
            placeholder={t("coachPanel.messageLabel")}
            placeholderTextColor={colors.meta}
            value={draft}
            onChangeText={onDraftChange}
            editable={online}
            aria-disabled={!online}
            maxFontSizeMultiplier={BAR_MAX_SCALE}
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
            <Control label={t("coachPanel.stop")} icon={Square} iconOnly={buttonIconOnly} look="secondary" onPress={onStop} />
          ) : (
            <Control label={t("mobile.send")} icon={Send} iconOnly={buttonIconOnly} look="primary" disabled={!online} onPress={send} />
          )}
        </DropTarget>
        {belowBoxInThread ? null : belowBox}
        </View>
      </CappedTextScale>
    </View>
  );
}

/** One of « + »'s choices: 44 pt high at least, its icon beside its words, highlighted under a pointer. */
function MenuItem({ label, icon: Icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  return (
    <Pressable
      role="menuitem"
      aria-label={label}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        backgroundColor: pressed || hovered ? colors.hover : "transparent",
      })}
    >
      <Icon color={colors.secondary} size={20} aria-hidden />
      <AppText>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The thread sits on the box, the latest message just above it, as in a messaging app.
  thread: { flexGrow: 1, justifyContent: "flex-end", paddingVertical: space[4] },
  aboveBox: { flexGrow: 0, flexShrink: 1 },
});
